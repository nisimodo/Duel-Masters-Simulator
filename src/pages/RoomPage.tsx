import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backend } from '../backend';
import { useApp } from '../context';
import {
  addCpu,
  encodeDeck,
  enterRoom,
  leaveRoom,
  watchPresence,
  MAX_PLAYERS,
  playerCount,
  removeCpu,
  subscribeDecks,
  subscribeRoom,
  updateMember,
  type Room,
} from '../data/api';
import GameView from '../game/GameView';
import { DeckThumb } from '../components/CardView';
import { DeckSection, DeckTile, FormatBadge } from '../components/DeckGrid';
import { deckFormat, expandDeck, presetToDeck, randomDeck, splitByFormat, validateDeck, type Deck, type RoomRules } from '../lib/deck';
import type { CardDB } from '../lib/cards';
import type { GameInit } from '../engine/types';

function rulesLabel(room: Room) {
  if (room.rules.mode === 'duepa') return 'デュエパーティー';
  return `デュエマ / ${room.rules.hof === 'zero' ? '殿堂ゼロ' : '通常ルール'} / ${room.rules.format === 'original' ? 'オリジナル' : 'アドバンス'}`;
}

async function startGame(room: Room) {
  const humans = Object.entries(room.members)
    .filter(([, m]) => m.role === 'player' && m.deck)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const cpus = Object.entries(room.cpus).sort((a, b) => a[1].addedAt - b[1].addedAt);
  const init: GameInit = {
    mode: room.rules.mode,
    seed: Math.floor(Math.random() * 2 ** 31),
    createdAt: Date.now(),
    players: [
      ...humans.map(([uid, m]) => ({ uid, name: m.name, cpu: false, ...expandDeck(m.deck!) })),
      ...cpus.map(([id, c]) => ({ uid: `cpu:${id}`, name: c.name, cpu: true, ...expandDeck(c.deck) })),
    ],
  };
  const gameId = backend.newKey('games');
  await backend.set(`games/${gameId}/init`, init);
  const old = room.gameId;
  await backend.update(`rooms/${room.key}`, { status: 'playing', gameId, lastResult: null });
  if (old) backend.remove(`games/${old}`);
}

async function backToLobby(room: Room) {
  const updates: Record<string, unknown> = { status: 'lobby' };
  for (const uid of Object.keys(room.members)) updates[`members/${uid}/ready`] = false;
  await backend.update(`rooms/${room.key}`, updates);
}

/** ルームで出すデッキの区分: オリジナルのルームではアドバンスのデッキは出さない。アドバンスのルームではアドバンスを先に */
function roomFormats(rules: RoomRules): ('original' | 'advance')[] {
  return rules.format === 'original' ? ['original'] : ['advance', 'original'];
}

function formatNote(rules: RoomRules, f: 'original' | 'advance') {
  if (rules.format === 'advance' && f === 'original') return 'オリジナルのデッキです (このルームでも使えます)';
  return f === 'original' ? '超次元・超GR・ゲーム開始時に置かれるカードなし' : '超次元・超GR・ゲーム開始時に置かれるカードあり';
}

/** アドバンスのルームでオリジナルのデッキを選ぶ時の注意 */
function formatCaution(db: CardDB, rules: RoomRules, d: Deck | null) {
  return rules.mode === 'duema' && rules.format === 'advance' && d && deckFormat(db, d) === 'original' ? 'オリジナルのデッキです' : undefined;
}

function CpuAdder({ db, room, myDecks, uid }: { db: CardDB; room: Room; myDecks: Deck[]; uid: string }) {
  const [sel, setSel] = useState('');
  const options = useMemo(() => {
    const list: { id: string; group: 'mine' | 'preset' | 'random'; label: string; deck: () => Deck; issues: string[]; preview: Deck | null }[] = [];
    for (const d of myDecks.filter((x) => x.type === room.rules.mode)) {
      list.push({ id: d.id, group: 'mine', label: d.name, deck: () => d, issues: validateDeck(db, d, room.rules), preview: d });
    }
    if (room.rules.mode === 'duema')
      for (const p of db.presets) {
        const { deck } = presetToDeck(db, p.id);
        list.push({ id: p.id, group: 'preset', label: p.name, deck: () => deck, issues: validateDeck(db, deck, room.rules), preview: deck });
      }
    list.push({ id: 'random', group: 'random', label: 'ランダム生成', deck: () => randomDeck(db, room.rules.mode, room.rules), issues: [], preview: null });
    return list;
  }, [db, myDecks, room.rules]);
  const full = playerCount(room) >= MAX_PLAYERS[room.rules.mode];
  const chosen = options.find((o) => o.id === sel);
  const tile = (o: (typeof options)[number]) => (
    <DeckTile
      key={o.id}
      db={db}
      deck={o.preview}
      title={o.label}
      issues={o.issues}
      caution={formatCaution(db, room.rules, o.preview)}
      selected={sel === o.id}
      showUpdated={o.group === 'mine'}
      onClick={() => setSel(sel === o.id ? '' : o.id)}
    />
  );
  const mine = options.filter((o) => o.group === 'mine');
  // オリジナルのルームではアドバンスのデッキは出さない
  const presets = options.filter((o) => o.group === 'preset' && (room.rules.format !== 'original' || !o.preview || deckFormat(db, o.preview) !== 'advance'));
  const random = options.filter((o) => o.group === 'random');
  const split = splitByFormat(db, mine, (o) => o.preview);
  return (
    <div className="col" style={{ gap: 6 }}>
      {!full && <span className="small muted">CPUのデッキを選択</span>}
      {!full && <div className="deck-pick-grid col" style={{ gap: 8 }}>
        {room.rules.mode === 'duema' ? (
          roomFormats(room.rules).map((f) => (
            <DeckSection key={f} title={<>マイデッキ <FormatBadge format={f} /></>} note={formatNote(room.rules, f)}>
              {split[f].map(tile)}
            </DeckSection>
          ))
        ) : (
          <DeckSection title="マイデッキ">{mine.map(tile)}</DeckSection>
        )}
        <DeckSection title="プリセット">{presets.map(tile)}</DeckSection>
        <DeckSection title="ランダム" note="ルームのルールに合うデッキをその場で作ります">
          {random.map(tile)}
        </DeckSection>
      </div>}
      <div className="row">
        <button disabled={!chosen || full || chosen.issues.length > 0} onClick={() => chosen && addCpu(room, uid, chosen.deck()).then(() => setSel(''))}>
          CPUを追加
        </button>
        {full && <span className="small muted">満員です</span>}
      </div>
    </div>
  );
}

export default function RoomPage() {
  const { key } = useParams();
  const { user, db } = useApp();
  const nav = useNavigate();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !key) return;
    let alive = true;
    let stopPresence = () => {};
    enterRoom(user.uid, user.name, key)
      .then(() => {
        // このタブを開いている間はオンライン (閉じると退出として扱われる)
        if (alive) stopPresence = watchPresence(key, user.uid);
      })
      .catch((e) => setErr(String(e.message || e)));
    const unsub = subscribeRoom(key, setRoom);
    return () => {
      alive = false;
      stopPresence();
      unsub();
    };
  }, [user, key]);
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);

  const me = room && user ? room.members[user.uid] : undefined;
  const isHost = !!room && !!user && room.hostUid === user.uid;

  // 対戦する全員が準備完了したらホストが自動で開始
  const players = room ? Object.entries(room.members).filter(([, m]) => m.role === 'player') : [];
  const count = room ? playerCount(room) : 0;
  const enough = room ? (room.rules.mode === 'duema' ? count === 2 : count >= 2 && count <= 5) : false;
  const allReady = players.length > 0 && players.every(([, m]) => m.ready && m.deck);
  /** 人間のプレイヤーがいない (CPU同士の対戦を観戦する) */
  const cpuOnly = !!room && players.length === 0 && Object.keys(room.cpus).length > 0;
  useEffect(() => {
    if (!room || !isHost || room.status !== 'lobby' || !enough || !allReady) return;
    const t = setTimeout(() => startGame(room).catch((e) => setErr(String(e.message || e))), 900);
    return () => clearTimeout(t);
  }, [room, isHost, enough, allReady]);

  if (!db || !user) return null;
  if (err && (!room || !me))
    return (
      <div className="page col">
        <div className="error">{err}</div>
        <Link to="/">トップへ戻る</Link>
      </div>
    );
  if (room === undefined) return <div className="page muted">ルームに接続中…</div>;
  if (room === null)
    return (
      <div className="page col">
        <div>ルームは閉じられました。</div>
        <Link to="/">トップへ戻る</Link>
      </div>
    );

  const leave = async () => {
    await leaveRoom(user.uid, room);
    nav(`/play/${room.rules.mode}`);
  };

  if (room.status === 'playing' && room.gameId)
    return <GameView key={room.gameId} room={room} db={db} onBackToLobby={() => backToLobby(room)} onLeave={leave} />;

  const myDecks = decks.filter((d) => d.type === room.rules.mode);
  const selectDeck = (id: string) => {
    const d = myDecks.find((x) => x.id === id) ?? null;
    updateMember(room.key, user.uid, { deckId: d?.id ?? null, deck: d ? (encodeDeck(d) as unknown as Deck) : null, ready: false });
  };
  const toggleReady = () => {
    const d = myDecks.find((x) => x.id === me?.deckId);
    if (!d) return;
    // 準備完了時に最新のデッキ内容を反映
    updateMember(room.key, user.uid, { ready: !me?.ready, deck: encodeDeck(d) as unknown as Deck });
  };
  const max = MAX_PLAYERS[room.rules.mode];
  const canBecomePlayer = count < max;
  const myDeck = myDecks.find((d) => d.id === me?.deckId);
  const deckTile = (d: Deck) => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      issues={validateDeck(db, d, room.rules)}
      okNote="このルームで使用可能"
      caution={formatCaution(db, room.rules, d)}
      selected={me?.deckId === d.id}
      onClick={() => selectDeck(me?.deckId === d.id ? '' : d.id)}
    />
  );
  const myIssues = myDeck ? validateDeck(db, myDeck, room.rules) : [];

  return (
    <div className="page col">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          ルーム
        </h2>
        <span className="badge">{rulesLabel(room)}</span>
        <button onClick={leave}>退出</button>
      </div>
      {room.lastResult && (
        <div className="panel small">
          前回の結果: <b>{room.lastResult.winners.map((w) => room.lastResult!.names[w.replace(/[.#$[\]/]/g, '_')] ?? w).join('、') || '引き分け'}</b> の勝利 ({room.lastResult.reason})
        </div>
      )}
      {/* 左: 対戦するプレイヤー・観戦・CPUの追加 / 右: あなたのデッキ選択 */}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="panel col">
            <b>
              対戦するプレイヤー ({count}/{max})
            </b>
            {players.map(([uid, m]) => (
              <div key={uid} className="member">
                <span className={`dot${m.online ? ' on' : ''}`} />
                <b>{m.name}</b>
                {uid === room.hostUid && <span className="badge">ホスト</span>}
                {m.deck && <DeckThumb db={db} deck={m.deck} width={28} />}
                <span className="grow small muted">{m.deck ? m.deck.name : 'デッキ未選択'}</span>
                {m.ready ? <span className="ok">準備完了</span> : <span className="muted">準備中</span>}
              </div>
            ))}
            {Object.entries(room.cpus).map(([id, c]) => (
              <div key={id} className="member">
                <span className="dot on" />
                <b>{c.name}</b>
                <span className="badge">CPU</span>
                <DeckThumb db={db} deck={c.deck} width={28} />
                <span className="grow small muted">{c.deck.name}</span>
                <span className="ok">準備完了</span>
                {(isHost || c.addedBy === user.uid) && (
                  <button className="small danger" onClick={() => removeCpu(room, id)}>
                    削除
                  </button>
                )}
              </div>
            ))}
            {!enough && (
              <div className="small muted">
                {room.rules.mode === 'duema' ? '2人そろうと対戦できます' : '2～5人そろうと対戦できます'} (CPUを追加することもできます)
              </div>
            )}
            {cpuOnly && enough ? (
              isHost ? (
                <div className="row">
                  <button className="primary" onClick={() => startGame(room).catch((e) => setErr(String(e.message || e)))}>
                    CPU同士の対戦を観戦する
                  </button>
                </div>
              ) : (
                <div className="small muted">ホストが開始するとCPU同士の対戦を観戦できます</div>
              )
            ) : (
              <>
                {enough && !allReady && <div className="small muted">全員が準備完了すると対戦が始まります</div>}
                {enough && allReady && <div className="ok">まもなく対戦開始…</div>}
              </>
            )}
            {!players.length && !enough && (
              <div className="small muted">全員が観戦にまわってCPUを{room.rules.mode === 'duema' ? '2体' : '2～5体'}追加すると、CPU同士の対戦を観戦できます</div>
            )}
          </div>

          <div className="panel col">
            <b>観戦</b>
            {Object.entries(room.members)
              .filter(([, m]) => m.role === 'spectator')
              .map(([uid, m]) => (
                <div key={uid} className="member">
                  <span className={`dot${m.online ? ' on' : ''}`} />
                  {m.name}
                  {uid === room.hostUid && <span className="badge">ホスト</span>}
                </div>
              ))}
          </div>

          <div className="panel col">
            <b>CPUの追加</b>
            <CpuAdder db={db} room={room} myDecks={decks} uid={user.uid} />
          </div>
        </div>

        {me && (
          <div className="panel col" style={{ flex: '2 1 360px', minWidth: 0 }}>
            <b>あなた ({me.role === 'player' ? '対戦する' : '観戦する'})</b>
            <div className="row">
              {me.role === 'spectator' ? (
                <button disabled={!canBecomePlayer} onClick={() => updateMember(room.key, user.uid, { role: 'player', ready: false })}>
                  対戦する側にまわる
                </button>
              ) : (
                <button onClick={() => updateMember(room.key, user.uid, { role: 'spectator', ready: false })}>観戦する側にまわる</button>
              )}
            </div>
            {me.role === 'player' && (
              <>
                <div className="deck-pick-grid col" style={{ gap: 8 }}>
                  {room.rules.mode === 'duema' ? (
                    roomFormats(room.rules).map((f) => (
                      <DeckSection key={f} title={<FormatBadge format={f} />} note={formatNote(room.rules, f)} empty="デッキがありません">
                        {splitByFormat(db, myDecks, (d) => d)[f].map(deckTile)}
                      </DeckSection>
                    ))
                  ) : (
                    <DeckSection title="デッキ">{myDecks.map(deckTile)}</DeckSection>
                  )}
                </div>
                <div className="row">
                  <button className={me.ready ? '' : 'primary'} disabled={!myDeck || myIssues.length > 0} onClick={toggleReady}>
                    {me.ready ? '準備完了を取り消す' : '準備完了'}
                  </button>
                </div>
                {!myDecks.length && (
                  <div className="warn small">
                    このルールで使えるデッキがありません。<Link to="/decks">デッキを作成</Link>してください。
                  </div>
                )}
                {myDecks.length > 0 && myDecks.every((d) => validateDeck(db, d, room.rules).length > 0) && (
                  <div className="warn small">このルームのレギュレーションで使えるデッキがありません。</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
