// テストプレイ: CPU同士の対戦を画面なしで最後まで進め、勝敗と使ったカードを集計する
import { cpuPlan } from './cpu';
import { applyAction, createGame, decider, type Lookup } from './engine';
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
}

const FALLBACK: Action[] = [{ t: 'resolve', use: false }, { t: 'choose', picks: [], yes: false, options: [0] }, { t: 'endTurn' }];

/** 1試合を最後まで進める (時間がかかりすぎた試合は決着なし) */
export function simulateGame(init: GameInit, L: Lookup, maxSteps = 6000): SimGame {
  let s: GameState = createGame(init, L);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  const note = (p: number, a: Action) => {
    const iid = a.t === 'play' ? a.iid : a.t === 'attackOpt' ? a.iid : a.t === 'trigger' && a.use ? (s.pending[0]?.kind === 'trigger' ? s.pending[0].iid : null) : null;
    if (iid != null && p < 2) played[p].add(s.cards[iid].cid);
  };
  for (let k = 0; k < maxSteps && s.phase !== 'over'; k++) {
    const p = decider(s);
    if (p == null) break;
    let moved = false;
    for (const a of cpuPlan(s, p, L)) {
      const r = applyAction(s, p, a, L);
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
      if (!ok) break;
    }
  }
  const over = s.phase === 'over';
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
}

export function emptyStats(): SimStats {
  return { games: 0, wins: [0, 0], draws: 0, firstGames: [0, 0], firstWins: [0, 0], turnSum: 0, decided: 0, reasons: {}, finishers: [{}, {}], usage: [{}, {}] };
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
  for (const p of [0, 1] as const)
    for (const cid of g.played[p]) {
      const u = (st.usage[p][cid] ??= [0, 0]);
      u[0]++;
      if (g.winner === p) u[1]++;
    }
}
