import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
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

/** 開閉できる見出し (最初は閉じている) */
function Fold({ title, extra, className, children }: { title: ReactNode; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <details className={`fold${className ? ` ${className}` : ''}`}>
      <summary>
        <span className="fold-title">{title}</span>
        {extra}
      </summary>
      <div className="fold-body col">{children}</div>
    </details>
  );
}

/** ルームで選べるプリセットのデッキ (オリジナルのルームではアドバンスのデッキは出さない) */
function usePresetDecks(db: CardDB, rules: RoomRules) {
  return useMemo(() => {
    return db.presets
      .filter((p) => (p.mode ?? 'duema') === rules.mode)
      .map((p) => ({ ...presetToDeck(db, p.id).deck, id: p.id, name: p.name }))
      .filter((d) => rules.mode !== 'duema' || rules.format !== 'original' || deckFormat(db, d) !== 'advance');
  }, [db, rules]);
}

/** 「マイデッキ」「プリセット」の開閉と「ランダム生成」ボタン (プレイヤーとCPUで共通) */
function DeckFolds({
  db,
  rules,
  mine,
  presets,
  tile,
  random,
}: {
  db: CardDB;
  rules: RoomRules;
  mine: Deck[];
  presets: Deck[];
  tile: (d: Deck, kind: 'mine' | 'preset') => ReactNode;
  random: ReactNode;
}) {
  const split = splitByFormat(db, mine, (d) => d);
  return (
    <>
      <Fold title={`マイデッキ (${mine.length})`}>
        <div className="deck-pick-grid col" style={{ gap: 8 }}>
          {rules.mode === 'duema' ? (
            roomFormats(rules).map((f) => (
              <DeckSection key={f} title={<FormatBadge format={f} />} note={formatNote(rules, f)} empty="デッキがありません">
                {split[f].map((d) => tile(d, 'mine'))}
              </DeckSection>
            ))
          ) : (
            <DeckSection title="デッキ" empty="デッキがありません">
              {mine.map((d) => tile(d, 'mine'))}
            </DeckSection>
          )}
        </div>
      </Fold>
      {presets.length > 0 && (
        <Fold title={`プリセット (${presets.length})`}>
          <div className="deck-pick-grid col" style={{ gap: 8 }}>
            <DeckSection title="プリセット">{presets.map((d) => tile(d, 'preset'))}</DeckSection>
          </div>
        </Fold>
      )}
      <div className="row">{random}</div>
    </>
  );
}

/** 自分のデッキを選ぶ (マイデッキ・プリセット・ランダム生成) */
function PlayerDeckPicker({ db, room, myDecks, uid }: { db: CardDB; room: Room; myDecks: Deck[]; uid: string }) {
  const me = room.members[uid];
  const presets = usePresetDecks(db, room.rules);
  const pick = (d: Deck | null) => updateMember(room.key, uid, { deckId: d?.id ?? null, deck: d ? (encodeDeck(d) as unknown as Deck) : null, ready: false });
  const tile = (d: Deck, kind: 'mine' | 'preset') => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      title={kind === 'preset' ? d.name : undefined}
      issues={validateDeck(db, d, room.rules)}
      okNote="このルームで使用可能"
      caution={formatCaution(db, room.rules, d)}
      selected={me?.deckId === d.id}
      showUpdated={kind === 'mine'}
      onClick={() => pick(me?.deckId === d.id ? null : d)}
    />
  );
  return (
    <Fold title="プレイヤーのデッキ" className="fold-top">
      <DeckFolds
        db={db}
        rules={room.rules}
        mine={myDecks}
        presets={presets}
        tile={tile}
        random={
          <button className={me?.deckId === 'random' ? 'primary' : ''} onClick={() => pick({ ...randomDeck(db, room.rules.mode, room.rules), id: 'random', name: 'ランダム生成' })}>
            ランダム生成{me?.deckId === 'random' ? ' (選択中・押すと作り直す)' : ''}
          </button>
        }
      />
    </Fold>
  );
}

/** CPUのデッキを選んで追加する */
function CpuAdder({ db, room, myDecks, uid }: { db: CardDB; room: Room; myDecks: Deck[]; uid: string }) {
  const [sel, setSel] = useState('');
  const presets = usePresetDecks(db, room.rules);
  const full = playerCount(room) >= MAX_PLAYERS[room.rules.mode];
  const chosen = sel === 'random' ? null : (myDecks.find((d) => d.id === sel) ?? presets.find((d) => d.id === sel));
  const ok = sel === 'random' || (!!chosen && validateDeck(db, chosen, room.rules).length === 0);
  const add = (e: MouseEvent) => {
    // (見出しの開閉はしない)
    e.preventDefault();
    if (!ok || full) return;
    const deck = sel === 'random' ? randomDeck(db, room.rules.mode, room.rules) : chosen!;
    addCpu(room, uid, deck).then(() => setSel(''));
  };
  const tile = (d: Deck, kind: 'mine' | 'preset') => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      title={kind === 'preset' ? d.name : undefined}
      issues={validateDeck(db, d, room.rules)}
      caution={formatCaution(db, room.rules, d)}
      selected={sel === d.id}
      showUpdated={kind === 'mine'}
      onClick={() => setSel(sel === d.id ? '' : d.id)}
    />
  );
  return (
    <Fold
      title="CPUのデッキ"
      className="fold-top"
      extra={
        <>
          <button className="small primary" disabled={!ok || full} onClick={add}>
            CPUを追加
          </button>
          {full && <span className="small muted">満員です</span>}
        </>
      }
    >
      <DeckFolds
        db={db}
        rules={room.rules}
        mine={myDecks}
        presets={presets}
        tile={tile}
        random={
          <button className={sel === 'random' ? 'primary' : ''} onClick={() => setSel(sel === 'random' ? '' : 'random')}>
            ランダム生成{sel === 'random' ? ' (選択中)' : ''}
          </button>
        }
      />
      {!chosen && sel !== 'random' && <span className="small muted">デッキを選んでから「CPUを追加」を押してください</span>}
    </Fold>
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
  // 選んだデッキ: マイデッキは最新の内容、プリセット・ランダム生成はルームに送ったもの
  const myDeck = myDecks.find((d) => d.id === me?.deckId) ?? (me?.deckId ? (me.deck ?? undefined) : undefined);
  const toggleReady = () => {
    if (!myDeck) return;
    // 準備完了時に最新のデッキ内容を反映
    updateMember(room.key, user.uid, { ready: !me?.ready, deck: encodeDeck(myDeck) as unknown as Deck });
  };
  const max = MAX_PLAYERS[room.rules.mode];
  const canBecomePlayer = count < max;
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
      {/* 左: 対戦するプレイヤー・観戦・CPUの追加 / 右: あなたのデッキ選択 (スマホではCPUの追加より上に自分のデッキ選択) */}
      <div className="row room-cols" style={{ alignItems: 'flex-start' }}>
        <div className="col room-left" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="panel col room-players">
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

          <div className="panel col room-specs">
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

          <div className="panel col room-cpu">
            <CpuAdder db={db} room={room} myDecks={myDecks} uid={user.uid} />
          </div>
        </div>

        {me && (
          <div className="panel col room-me" style={{ flex: '2 1 360px', minWidth: 0 }}>
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
                <PlayerDeckPicker db={db} room={room} myDecks={myDecks} uid={user.uid} />
                <div className="small">
                  選択中のデッキ: {myDeck ? <b>{myDeck.name}</b> : <span className="muted">なし</span>}
                  {myIssues.length > 0 && <span className="warn"> (このルームでは使えません: {myIssues[0]})</span>}
                </div>
                <div className="row">
                  <button className={me.ready ? '' : 'primary'} disabled={!myDeck || myIssues.length > 0} onClick={toggleReady}>
                    {me.ready ? '準備完了を取り消す' : '準備完了'}
                  </button>
                </div>
                {!myDecks.length && (
                  <div className="small muted">
                    マイデッキがありません。<Link to="/decks">デッキを作成</Link>するか、プリセット・ランダム生成から選んでください。
                  </div>
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
