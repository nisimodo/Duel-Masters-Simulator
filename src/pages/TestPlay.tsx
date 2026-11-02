// テストプレイ: 2つ (デュエパは4つまで) のデッキをCPU同士で何度も高速に対戦させ、勝率と勝因・敗因を見る
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useFavs } from '../context';
import { DeckViewDialog, ViewButton } from '../components/DeckViewDialog';
import { favFirst, subscribeDecks } from '../data/api';
import { DeckSection, DeckTile, FormatBadge } from '../components/DeckGrid';
import { expandDeck, presetToDeck, splitByFormat, type Deck } from '../lib/deck';
import { addGame, emptyStats, simulateGame, type SimStats } from '../engine/sim';
import type { CardDB } from '../lib/cards';
import { ResultImageDialog } from '../components/ResultImageDialog';
import { deckLetter, deckReport, pct, renderResultImage, SIDE_COLORS, type ImageShape } from '../lib/resultImage';

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
        // デッキを選んだ時と同じ大きさの空の枠
        <div className="deck-tile testplay-empty">
          <div className="deck-tile-main">
            <div className="deck-tile-thumb">
              <div className="deck-thumb-empty deck-tile-random">?</div>
            </div>
            <div className="deck-tile-body">
              <div className="deck-tile-name muted">未選択</div>
              <div className="small muted">下の一覧からデッキを選んでください</div>
            </div>
          </div>
        </div>
      )}
    </button>
  );
}

/** デッキごとの結果 */
function DeckReport({ db, st, p, name }: { db: CardDB; st: SimStats; p: number; name: string }) {
  const { wins, losses, finishers: fin, usage, lost, avgPlace } = deckReport(db, st, p);
  const total = st.games - st.draws;
  const multi = st.players > 2;
  return (
    <div className="panel col" style={{ flex: '1 1 320px', minWidth: 0, borderLeft: `4px solid ${SIDE_COLORS[p % SIDE_COLORS.length].bar}` }}>
      <h3 style={{ margin: 0 }}>
        {deckLetter(p)}: {name}
      </h3>
      <div>
        勝率 <b className="testplay-big">{pct(st.wins[p], st.games)}</b> ({st.wins[p]}勝 {lost}敗{st.draws ? ` ${st.draws}分` : ''}){total < st.games && <span className="small muted"> ・ 決着した試合での勝率 {pct(st.wins[p], total)}</span>}
      </div>
      <div className="small">
        先攻 {pct(st.firstWins[p], st.firstGames[p])} ({st.firstGames[p]}試合) ・ {multi ? 'それ以外' : '後攻'} {pct(st.wins[p] - st.firstWins[p], st.games - st.firstGames[p])} ({st.games - st.firstGames[p]}試合)
        {multi && avgPlace != null && ` ・ 平均順位 ${avgPlace}位`}
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
  const { favs, toggle } = useFavs();
  const [decks, setDecks] = useState<Deck[]>([]);
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);
  // 対戦の形式: デュエマ / 通常デュエパ / デュエパもどき (デュエマ用のデッキをデュエパのルールで)
  const [mode, setMode] = useState<'duema' | 'duepa' | 'modoki'>('duema');
  const deckType = mode === 'duepa' ? 'duepa' : 'duema';
  const options = useMemo<Option[]>(() => {
    if (!db) return [];
    const mine = decks.filter((d) => d.type === deckType).map((d) => ({ id: d.id, deck: d, preset: false }));
    const presets = db.presets.filter((p) => (p.mode ?? 'duema') === deckType).map((p) => ({ id: p.id, deck: presetToDeck(db, p.id).deck, preset: true }));
    // お気に入りを先に
    return favFirst([...mine, ...presets], favs, (o) => o.id);
  }, [db, decks, favs, deckType]);
  // デュエパの対戦人数 (デュエマは2人)
  const [duepaPlayers, setDuepaPlayers] = useState(4);
  const nDecks = mode === 'duema' ? 2 : duepaPlayers;
  const [slot, setSlot] = useState(0);
  // 中身を見ているデッキ
  const [view, setView] = useState<Deck | null>(null);
  const [pick, setPick] = useState<(string | null)[]>([null, null, null, null]);
  const [count, setCount] = useState(50);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [running, setRunning] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  // 結果を出したデッキ (画像に使う。対戦の後で選び直しても変わらない)
  const [resultDecks, setResultDecks] = useState<Deck[] | null>(null);
  // 結果画像のプレビュー (保存ボタンで保存する)
  const [preview, setPreview] = useState<ImageShape | null>(null);
  const makeImage = useCallback((shape: ImageShape, timeoutMs: number) => renderResultImage(db!, stats!, resultDecks!, shape, timeoutMs), [db, stats, resultDecks]);

  const cancel = useRef(false);
  if (!db || !user) return null;

  const opts = Array.from({ length: nDecks }, (_, i) => options.find((o) => o.id === pick[i]) ?? null);
  const ready = opts.every((o) => !!o);
  const choose = (id: string) => {
    const next = [...pick];
    next[slot] = id;
    setPick(next);
    // まだ選んでいない次の枠へ
    const empty = Array.from({ length: nDecks }, (_, i) => (slot + 1 + i) % nDecks).find((i) => !next[i]);
    if (empty != null) setSlot(empty);
  };
  const pickNote = (id: string) => {
    const ls = pick.slice(0, nDecks).flatMap((p, i) => (p === id ? [deckLetter(i)] : []));
    return ls.length ? `デッキ${ls.join('・')}` : undefined;
  };
  const tile = (o: Option) => (
    <DeckTile
      key={o.id}
      db={db}
      deck={o.deck}
      showUpdated={!o.preset}
      actions={<ViewButton onClick={() => setView(o.deck)} />}
      fav={favs.has(o.id)}
      onFav={() => toggle(o.id)}
      selected={pick.slice(0, nDecks).includes(o.id)}
      okNote={pickNote(o.id)}
      onClick={() => choose(o.id)}
    />
  );
  const mine = options.filter((o) => !o.preset);
  const split = splitByFormat(db, mine, (o) => o.deck);
  const L = (cid: string) => db.byId.get(cid);

  const run = async () => {
    if (!ready) return;
    const ds = opts.map((o) => o!.deck);
    cancel.current = false;
    setRunning(true);
    setNames(ds.map((d) => d.name));
    setResultDecks(ds);
    const st = emptyStats(ds.length);
    setStats(structuredClone(st));
    const expanded = ds.map(expandDeck);
    let last = performance.now();
    for (let i = 0; i < count && !cancel.current; i++) {
      const g = simulateGame(
        {
          mode: mode === 'duema' ? 'duema' : 'duepa',
          seed: Math.floor(Math.random() * 2 ** 31),
          createdAt: 0,
          // 先攻は順番に交代する
          first: i % ds.length,
          players: expanded.map((d, k) => ({ uid: `test:${k}`, name: deckLetter(k), cpu: true, ...d })),
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

  return (
    <div className="page col">
      <h2>テストプレイ</h2>
      <p className="small muted">デッキをCPU同士で何度も対戦させて、勝率と勝因・敗因を調べます (デュエパは4つまで)。先攻は1試合ごとに交代します。対戦はこのブラウザの中だけで行い、記録は残りません。</p>
      <div className="panel col">
        <div className="row small">
          <b>形式</b>
          {(
            [
              ['duema', 'デュエマ'],
              ['duepa', '通常デュエパ (60枚・パートナー)'],
              ['modoki', 'デュエパもどき (デュエマ用のデッキ)'],
            ] as const
          ).map(([m, label]) => (
            <label key={m}>
              <input
                type="radio"
                disabled={running}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  // (デッキの種類が変わる時は選び直す)
                  if ((m === 'duepa') !== (mode === 'duepa')) setPick([null, null, null, null]);
                  setSlot(0);
                }}
              />{' '}
              {label}
            </label>
          ))}
        </div>
        {mode !== 'duema' && (
          <div className="row small">
            <b>人数</b>
            {[2, 3, 4].map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  disabled={running}
                  checked={duepaPlayers === n}
                  onChange={() => {
                    setDuepaPlayers(n);
                    if (slot >= n) setSlot(0);
                  }}
                />{' '}
                {n}人
              </label>
            ))}
            <span className="muted">デュエパのルール (手札とシールド6枚・先攻も1ターン目に引く・勝敗を直接決める効果と追加ターンは無効 など) で、最後の1人になるまで対戦します。</span>
          </div>
        )}
        <div className={`row testplay-slots${nDecks > 2 ? ' many' : ''}`} style={{ alignItems: 'stretch' }}>
          {opts.map((o, i) => (
            <Fragment key={i}>
              {i > 0 && <div className="testplay-vs">VS</div>}
              <DeckSlot db={db} label={`デッキ${deckLetter(i)}`} opt={o} active={slot === i} onClick={() => setSlot(i)} />
            </Fragment>
          ))}
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
              <button className="primary" disabled={!ready} onClick={run}>
                対戦開始
              </button>
            )}
          </div>
        </div>
        <span className="small muted">
          デッキ{deckLetter(slot)} を選んでいます。上の枠を押すと、選ぶ枠を切り替えられます。
        </span>
        <div className="deck-pick-grid col" style={{ gap: 8 }}>
          {deckType === 'duepa' ? (
            <DeckSection title="マイデッキ (デュエパ)">{mine.map(tile)}</DeckSection>
          ) : (
            (['original', 'advance'] as const).map((f) => (
              <DeckSection key={f} title={<>マイデッキ <FormatBadge format={f} /></>}>
                {split[f].map(tile)}
              </DeckSection>
            ))
          )}
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
                  <button onClick={() => setPreview('landscape')} title="横幅1920のプレビューを表示 (文字が多い時は縦に伸ばします)">
                    横長
                  </button>
                  <button onClick={() => setPreview('portrait')} title="横幅1080のプレビューを表示 (文字が多い時は縦に伸ばします)">
                    縦長
                  </button>
                </span>
              )}
            </div>
            <div className="testplay-bar">
              {stats.wins.map((w, p) => (
                <div key={p} style={{ width: pct(w, stats.games), background: SIDE_COLORS[p % SIDE_COLORS.length].bar }}>
                  {w > 0 && `${deckLetter(p)} ${pct(w, stats.games)}`}
                </div>
              ))}
              <div className="d" style={{ width: pct(stats.draws, stats.games) }} />
            </div>
            <div className="testplay-progress">
              <div style={{ width: pct(stats.games, count) }} />
            </div>
            {stats.draws > 0 && <span className="small muted">引き分け・決着なし {stats.draws}試合 (6000手以内に終わらなかった試合を含みます)</span>}
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {names.map((n, p) => (
              <DeckReport key={p} db={db} st={stats} p={p} name={n} />
            ))}
          </div>
          <IssueReport db={db} st={stats} />
        </>
      )}
      {preview && stats && resultDecks && <ResultImageDialog make={makeImage} name="testplay" shape={preview} onClose={() => setPreview(null)} />}
      {view && <DeckViewDialog db={db} deck={view} onClose={() => setView(null)} />}
    </div>
  );
}
