// テストプレイ: CPU同士の対戦を画面なしで最後まで進め、勝敗と使ったカードを集計する
import { cpuPlan } from './cpu';
import { applyAction, createGame, decider, type Lookup } from './engine';
import { programOf } from './interp';
import type { Action, GameInit, GameState } from './types';

export interface SimGame {
  /** 勝ったプレイヤー (0 = デッキA, 1 = デッキB)。引き分け・決着なしは null */
  winner: 0 | 1 | null;
  /** 先攻のプレイヤー */
  first: number;
  turns: number;
  /** 決着の理由 (「ダイレクトアタック」「山札切れ」など)。決着しなければ「決着なし」 */
  reason: string;
  /** とどめを刺したカードの名前 (ダイレクトアタックしたクリーチャー) */
  finisher: string | null;
  /** 各プレイヤーが使った (召喚・唱えた・S・トリガー・革命チェンジ) カードID */
  played: [string[], string[]];
  /** うまく処理できなかったこと (解析できない能力・内部エラー・進行不能・決着なし) */
  issues: SimIssue[];
}

export interface SimIssue {
  kind: 'manual' | 'error' | 'stuck' | 'unfinished';
  /** 原因のカードID (分かる時) */
  cid?: string;
  text: string;
}

const FALLBACK: Action[] = [{ t: 'resolve', use: false }, { t: 'choose', picks: [], yes: false, options: [0] }, { t: 'trigger', use: false }, { t: 'endTurn' }];

/** 1試合を最後まで進める (時間がかかりすぎた試合は決着なし) */
export function simulateGame(init: GameInit, L: Lookup, maxSteps = 6000): SimGame {
  let s: GameState = createGame(init, L);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  const note = (p: number, a: Action) => {
    const iid = a.t === 'play' ? a.iid : a.t === 'attackOpt' ? a.iid : a.t === 'trigger' && a.use ? (s.pending[0]?.kind === 'trigger' ? s.pending[0].iid : null) : null;
    if (iid != null && p < 2) played[p].add(s.cards[iid].cid);
  };
  const issues: SimIssue[] = [];
  const seenManual = new Set<string>();
  const lastLog = () => s.log.slice(-4).map((x) => x.m).join(' / ');
  let k = 0;
  for (; k < maxSteps && s.phase !== 'over'; k++) {
    const p = decider(s);
    if (p == null) break;
    // 解析できない能力は CPU が手動の手順で処理する (効果の一部しか実行されないことがある)
    const top = s.pending[0];
    if (top?.kind === 'ability' && top.player === p && !programOf(top.effect).complete) {
      const key = `${top.cid}|${top.effect}`;
      if (!seenManual.has(key)) {
        seenManual.add(key);
        issues.push({ kind: 'manual', cid: top.cid, text: top.effect });
      }
    }
    let moved = false;
    for (const a of cpuPlan(s, p, L)) {
      const r = applyAction(s, p, a, L);
      if (r.error?.startsWith('内部エラー')) {
        const iid = 'iid' in a && typeof a.iid === 'number' ? a.iid : top && 'src' in top ? top.src : null;
        issues.push({ kind: 'error', cid: iid != null ? s.cards[iid]?.cid : undefined, text: `${r.error} (${a.t})` });
      }
      if (!r.error) {
        // 使ったカードは、行動する前の状態で調べる (applyAction は元の状態を変えない)
        note(p, a);
        s = r.state;
        moved = true;
      }
    }
    if (!moved) {
      let ok = false;
      for (const a of FALLBACK) {
        const r = applyAction(s, p, a, L);
        if (!r.error) {
          s = r.state;
          ok = true;
          break;
        }
      }
      if (!ok) {
        const t = s.pending[0];
        issues.push({ kind: 'stuck', cid: t && 'src' in t ? s.cards[t.src]?.cid : t && 'iid' in t ? s.cards[t.iid]?.cid : undefined, text: `進行不能 (${t?.kind ?? s.turnStep}): ${lastLog()}` });
        break;
      }
    }
  }
  const over = s.phase === 'over';
  if (!over && k >= maxSteps) issues.push({ kind: 'unfinished', text: `${maxSteps}手で決着せず (ターン${s.turn}): ${lastLog()}` });
  const w = over && s.winners.length === 1 ? s.winners[0] : null;
  let finisher: string | null = null;
  if (over && /ダイレクトアタック/.test(s.endReason)) {
    for (let i = s.log.length - 1; i >= 0; i--) {
      const m = s.log[i].m.match(/^《(.+?)》 のダイレクトアタック！/);
      if (m) {
        finisher = m[1];
        break;
      }
    }
  }
  return {
    winner: w === 0 || w === 1 ? w : null,
    first: s.firstPlayer,
    turns: s.turn,
    reason: over ? s.endReason || '不明' : '決着なし',
    finisher,
    played: [[...played[0]], [...played[1]]],
    issues,
  };
}

export interface SimStats {
  games: number;
  wins: [number, number];
  draws: number;
  /** 先攻だった試合数と、そのうちの勝ち数 */
  firstGames: [number, number];
  firstWins: [number, number];
  turnSum: number;
  decided: number;
  /** 決着の理由 → [Aの勝ち, Bの勝ち, 決着なし] */
  reasons: Record<string, [number, number, number]>;
  /** とどめを刺したカード名 → 回数 (デッキごと) */
  finishers: [Record<string, number>, Record<string, number>];
  /** カードID → [使った試合数, そのうち勝った数] (デッキごと) */
  usage: [Record<string, [number, number]>, Record<string, [number, number]>];
  /** うまく処理できなかったこと → 起きた試合数 */
  issues: Record<string, SimIssue & { games: number }>;
}

export function emptyStats(): SimStats {
  return { games: 0, wins: [0, 0], draws: 0, firstGames: [0, 0], firstWins: [0, 0], turnSum: 0, decided: 0, reasons: {}, finishers: [{}, {}], usage: [{}, {}], issues: {} };
}

export function addGame(st: SimStats, g: SimGame) {
  st.games++;
  if (g.winner == null) st.draws++;
  else {
    st.wins[g.winner]++;
    st.decided++;
    st.turnSum += g.turns;
  }
  if (g.first === 0 || g.first === 1) {
    st.firstGames[g.first]++;
    if (g.winner === g.first) st.firstWins[g.first]++;
  }
  const r = (st.reasons[g.reason] ??= [0, 0, 0]);
  r[g.winner ?? 2]++;
  if (g.winner != null && g.finisher) st.finishers[g.winner][g.finisher] = (st.finishers[g.winner][g.finisher] ?? 0) + 1;
  for (const i of g.issues) {
    const key = `${i.kind}|${i.cid ?? ''}|${i.kind === 'manual' ? i.text : i.text.replace(/:.*$/, '')}`;
    (st.issues[key] ??= { ...i, games: 0 }).games++;
  }
  for (const p of [0, 1] as const)
    for (const cid of g.played[p]) {
      const u = (st.usage[p][cid] ??= [0, 0]);
      u[0]++;
      if (g.winner === p) u[1]++;
    }
}
