// テストプレイ: 2つのデッキをCPU同士で何度も高速に対戦させ、勝率と勝因・敗因を見る
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context';
import { subscribeDecks } from '../data/api';
import { DeckSection, DeckTile, FormatBadge } from '../components/DeckGrid';
import { expandDeck, presetToDeck, splitByFormat, type Deck } from '../lib/deck';
import { addGame, emptyStats, simulateGame, type SimStats } from '../engine/sim';
import type { CardDB } from '../lib/cards';
import { Modal } from '../game/dialogs';
import { deckReport, downloadBlob, pct, renderResultImage, type ImageShape } from '../lib/resultImage';

interface Option {
  id: string;
  deck: Deck;
  preset: boolean;
}

function DeckSlot({ db, label, opt, active, onClick }: { db: CardDB; label: string; opt: Option | null; active: boolean; onClick: () => void }) {
  return (
    <button className={`testplay-slot${active ? ' active' : ''}`} onClick={onClick}>
      <b>{label}</b>
      {opt ? (
        <DeckTile db={db} deck={opt.deck} showUpdated={false} />
      ) : (
        <div className="muted small" style={{ padding: 20 }}>
          下の一覧からデッキを選んでください
        </div>
      )}
    </button>
  );
}

/** デッキごとの結果 */
function DeckReport({ db, st, p, name }: { db: CardDB; st: SimStats; p: 0 | 1; name: string }) {
  const q = (1 - p) as 0 | 1;
  const { wins, losses, finishers: fin, usage } = deckReport(db, st, p);
  const total = st.wins[p] + st.wins[q];
  return (
    <div className="panel col" style={{ flex: '1 1 320px', minWidth: 0 }}>
      <h3 style={{ margin: 0 }}>
        {p === 0 ? 'A' : 'B'}: {name}
      </h3>
      <div>
        勝率 <b className="testplay-big">{pct(st.wins[p], st.games)}</b> ({st.wins[p]}勝 {st.wins[q]}敗{st.draws ? ` ${st.draws}分` : ''}){total < st.games && <span className="small muted"> ・ 決着した試合での勝率 {pct(st.wins[p], total)}</span>}
      </div>
      <div className="small">
        先攻 {pct(st.firstWins[p], st.firstGames[p])} ({st.firstGames[p]}試合) ・ 後攻 {pct(st.wins[p] - st.firstWins[p], st.games - st.firstGames[p])} ({st.games - st.firstGames[p]}試合)
      </div>
      <b>勝因 (勝った時の決着)</b>
      {wins.length ? (
        <ul className="testplay-list">
          {wins.map(([r, n]) => (
            <li key={r}>
              {r} <span className="muted">{n}回</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="small muted">なし</div>
      )}
      {fin.length > 0 && (
        <>
          <b>とどめを刺したカード</b>
          <ul className="testplay-list">
            {fin.map(([n, c]) => (
              <li key={n}>
                《{n}》 <span className="muted">{c}回</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <b>敗因 (負けた時の決着)</b>
      {losses.length ? (
        <ul className="testplay-list">
          {losses.map(([r, n]) => (
            <li key={r}>
              {r} <span className="muted">{n}回</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="small muted">なし</div>
      )}
      <b>よく使ったカード (使った試合での勝率)</b>
      <span className="small muted">
        <span className="ok">緑</span>: デッキ全体の勝率より10%以上高い ・ <span className="warn">橙</span>: 10%以上低い (3試合以上使ったカード)
      </span>
      <table className="testplay-table small">
        <thead>
          <tr>
            <th>カード</th>
            <th>使った試合</th>
            <th>勝率</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.name}>
              <td>《{u.name}》</td>
              <td>{u.n}</td>
              <td className={u.n >= 3 && u.w / u.n >= st.wins[p] / Math.max(1, st.games) + 0.1 ? 'ok' : u.n >= 3 && u.w / u.n <= st.wins[p] / Math.max(1, st.games) - 0.1 ? 'warn' : ''}>{pct(u.w, u.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ISSUE_LABEL = { manual: '自動で処理できない効果 (CPUは一部だけ実行)', error: '内部エラー', stuck: '進行不能', unfinished: '決着しなかった試合' } as const;

/** うまく処理できなかったこと (カードの不具合の手がかり) */
function IssueReport({ db, st }: { db: CardDB; st: SimStats }) {
  const list = Object.values(st.issues).sort((a, b) => b.games - a.games);
  return (
    <div className="panel col">
      <b>うまく処理できなかった効果 ({list.length}件)</b>
      {!list.length ? (
        <div className="small ok">✓ すべての効果を自動で処理できました</div>
      ) : (
        <table className="testplay-table small">
          <thead>
            <tr>
              <th>種類</th>
              <th>カード</th>
              <th>内容</th>
              <th>起きた試合</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 30).map((i, k) => (
              <tr key={k}>
                <td className={i.kind === 'manual' ? 'muted' : 'warn'}>{ISSUE_LABEL[i.kind]}</td>
                <td>{i.cid ? `《${db.byId.get(i.cid)?.name ?? i.cid}》` : '-'}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{i.text}</td>
                <td>{i.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function TestPlay() {
  const { user, db } = useApp();
  const [decks, setDecks] = useState<Deck[]>([]);
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);
  const options = useMemo<Option[]>(() => {
    if (!db) return [];
    const mine = decks.filter((d) => d.type === 'duema').map((d) => ({ id: d.id, deck: d, preset: false }));
    const presets = db.presets.map((p) => ({ id: p.id, deck: presetToDeck(db, p.id).deck, preset: true }));
    return [...mine, ...presets];
  }, [db, decks]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [pick, setPick] = useState<[string | null, string | null]>([null, null]);
  const [count, setCount] = useState(50);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [running, setRunning] = useState(false);
  const [names, setNames] = useState<[string, string]>(['', '']);
  // 結果を出したデッキ (画像に使う。対戦の後で選び直しても変わらない)
  const [resultDecks, setResultDecks] = useState<[Deck, Deck] | null>(null);
  // 結果画像のプレビュー (保存ボタンで保存する)
  const [preview, setPreview] = useState<{ shape: ImageShape; blob: Blob; url: string } | null>(null);
  const [making, setMaking] = useState<ImageShape | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const cancel = useRef(false);
  if (!db || !user) return null;

  const optA = options.find((o) => o.id === pick[0]) ?? null;
  const optB = options.find((o) => o.id === pick[1]) ?? null;
  const choose = (id: string) => {
    const next: [string | null, string | null] = [...pick];
    next[slot] = id;
    setPick(next);
    if (slot === 0 && !next[1]) setSlot(1);
  };
  const tile = (o: Option) => (
    <DeckTile
      key={o.id}
      db={db}
      deck={o.deck}
      showUpdated={!o.preset}
      selected={pick[0] === o.id || pick[1] === o.id}
      okNote={pick[0] === o.id && pick[1] === o.id ? 'A・B (ミラー)' : pick[0] === o.id ? 'デッキA' : pick[1] === o.id ? 'デッキB' : undefined}
      onClick={() => choose(o.id)}
    />
  );
  const mine = options.filter((o) => !o.preset);
  const split = splitByFormat(db, mine, (o) => o.deck);
  const L = (cid: string) => db.byId.get(cid);

  const run = async () => {
    if (!optA || !optB) return;
    cancel.current = false;
    setRunning(true);
    setNames([optA.deck.name, optB.deck.name]);
    setResultDecks([optA.deck, optB.deck]);
    const st = emptyStats();
    setStats({ ...st });
    const a = expandDeck(optA.deck);
    const b = expandDeck(optB.deck);
    let last = performance.now();
    for (let i = 0; i < count && !cancel.current; i++) {
      const g = simulateGame(
        {
          mode: 'duema',
          seed: Math.floor(Math.random() * 2 ** 31),
          createdAt: 0,
          // 先攻は交互にする
          first: i % 2,
          players: [
            { uid: 'test:a', name: 'A', cpu: true, ...a },
            { uid: 'test:b', name: 'B', cpu: true, ...b },
          ],
        },
        L,
      );
      addGame(st, g);
      // 画面が固まらないように、少しずつ表示を更新して手を離す
      if (performance.now() - last > 120 || i === count - 1) {
        setStats(structuredClone(st));
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    setStats(structuredClone(st));
    setRunning(false);
  };

  const showImage = async (shape: ImageShape) => {
    if (!stats || !resultDecks) return;
    setMaking(shape);
    try {
      const blob = await renderResultImage(db, stats, resultDecks, shape);
      setPreview({ shape, blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      alert(`画像を作れませんでした: ${e instanceof Error ? e.message : e}`);
    } finally {
      setMaking(null);
    }
  };
  const saveImage = () => {
    if (!preview) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    downloadBlob(preview.blob, `testplay-${stamp}-${preview.shape === 'landscape' ? '16x9' : '9x16'}.png`);
  };

  return (
    <div className="page col">
      <h2>テストプレイ</h2>
      <p className="small muted">2つのデッキをCPU同士で何度も対戦させて、勝率と勝因・敗因を調べます。先攻は1試合ごとに交互です。対戦はこのブラウザの中だけで行い、記録は残りません。</p>
      <div className="panel col">
        <div className="row" style={{ alignItems: 'stretch' }}>
          <DeckSlot db={db} label="デッキA" opt={optA} active={slot === 0} onClick={() => setSlot(0)} />
          <div className="testplay-vs">VS</div>
          <DeckSlot db={db} label="デッキB" opt={optB} active={slot === 1} onClick={() => setSlot(1)} />
          <div className="col" style={{ justifyContent: 'center', gap: 8 }}>
            <label className="row small">
              対戦回数
              <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} style={{ width: 90 }} />
            </label>
            {running ? (
              <button className="danger" onClick={() => (cancel.current = true)}>
                中止
              </button>
            ) : (
              <button className="primary" disabled={!optA || !optB} onClick={run}>
                対戦開始
              </button>
            )}
          </div>
        </div>
        <span className="small muted">
          {slot === 0 ? 'デッキA' : 'デッキB'} を選んでいます。上の枠を押すと、選ぶ側を切り替えられます。
        </span>
        <div className="deck-pick-grid col" style={{ gap: 8 }}>
          {(['original', 'advance'] as const).map((f) => (
            <DeckSection key={f} title={<>マイデッキ <FormatBadge format={f} /></>}>
              {split[f].map(tile)}
            </DeckSection>
          ))}
          <DeckSection title="プリセット">{options.filter((o) => o.preset).map(tile)}</DeckSection>
        </div>
      </div>

      {stats && (
        <>
          <div className="panel col">
            <div className="row">
              <b className="grow">
                結果 {stats.games}/{count}試合{running ? ' (対戦中…)' : ''}
              </b>
              {stats.decided > 0 && <span className="small muted">平均 {Math.round((stats.turnSum / stats.decided) * 10) / 10} ターンで決着</span>}
              {!running && stats.games > 0 && (
                <span className="row small" style={{ gap: 6 }}>
                  結果画像
                  <button disabled={!!making} onClick={() => showImage('landscape')} title="1920×1080 のプレビューを表示">
                    {making === 'landscape' ? '作成中…' : '横長 16:9'}
                  </button>
                  <button disabled={!!making} onClick={() => showImage('portrait')} title="1080×1920 のプレビューを表示">
                    {making === 'portrait' ? '作成中…' : '縦長 9:16'}
                  </button>
                </span>
              )}
            </div>
            <div className="testplay-bar">
              <div className="a" style={{ width: pct(stats.wins[0], stats.games) }}>
                {stats.wins[0] > 0 && `A ${pct(stats.wins[0], stats.games)}`}
              </div>
              <div className="d" style={{ width: pct(stats.draws, stats.games) }} />
              <div className="b" style={{ width: pct(stats.wins[1], stats.games) }}>
                {stats.wins[1] > 0 && `B ${pct(stats.wins[1], stats.games)}`}
              </div>
            </div>
            <div className="testplay-progress">
              <div style={{ width: pct(stats.games, count) }} />
            </div>
            {stats.draws > 0 && <span className="small muted">引き分け・決着なし {stats.draws}試合 (6000手以内に終わらなかった試合を含みます)</span>}
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <DeckReport db={db} st={stats} p={0} name={names[0]} />
            <DeckReport db={db} st={stats} p={1} name={names[1]} />
          </div>
          <IssueReport db={db} st={stats} />
        </>
      )}
      {preview && (
        <Modal title="結果画像のプレビュー" onClose={() => setPreview(null)}>
          <div className="row small" style={{ gap: 6 }}>
            {(['landscape', 'portrait'] as const).map((sh) => (
              <button key={sh} className={preview.shape === sh ? 'primary' : ''} disabled={!!making} onClick={() => preview.shape !== sh && showImage(sh)}>
                {making === sh ? '作成中…' : sh === 'landscape' ? '横長 16:9' : '縦長 9:16'}
              </button>
            ))}
            <span className="grow" />
            <button className="primary" onClick={saveImage}>
              保存
            </button>
          </div>
          <img className="result-preview" src={preview.url} alt="テストプレイの結果画像" style={preview.shape === 'landscape' ? { width: 'min(860px, 88vw)' } : { height: 'min(70vh, 1200px)' }} />
        </Modal>
      )}
    </div>
  );
}
