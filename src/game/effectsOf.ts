// カードの詳細に出す「このカードに付いている効果」(誰の効果か・いつまでか)
import type { Lookup } from '../engine/engine';
import { staticEffectsOn } from '../engine/statics';
import type { GameState } from '../engine/types';

export interface EffectRow {
  /** 効果を出しているカードの名前 (null: 出どころが分からないもの) */
  src: string | null;
  /** 手動で変えたもの (メニューの「パワー +1000」など) */
  manual?: boolean;
  /** 付いている能力・パワーの修正 */
  items: string[];
  /** 残りの期間 */
  dur: string;
}

const signed = (n: number) => `パワー${n >= 0 ? '+' : ''}${n}`;

/** 一時的な能力の「パワー+N」などは、まとめて数字で見せる */
function kwLabel(k: string) {
  return k.replace(/^(バトル中)?パワー([+-]\d+)$/, (_m, b: string | undefined, n: string) => `${b ?? ''}パワー${n}`);
}

/** 今のターンから数えて、プレイヤー p の次のターンが始まるまでのターン数 */
function turnsUntil(s: GameState, p: number): number {
  const alive = s.players.map((_, i) => i).filter((i) => !s.players[i].lost);
  const at = alive.indexOf(s.active);
  for (let k = 1; k <= alive.length; k++) if (alive[(at + k) % alive.length] === p) return k;
  return alive.length;
}

export function effectsOf(s: GameState, L: Lookup, iid: number, me: number): EffectRow[] {
  const c = s.cards[iid];
  if (!c || c.zone !== 'battle') return [];
  const name = (cid: string | null | undefined) => (cid ? (L(cid)?.name ?? null) : null);
  const untilText = (until: number) => {
    if (until === -1) return 'このターンの終わりまで (あと1ターン)';
    if (until === -2) return 'ずっと';
    const who = until === me ? '自分' : (s.players[until]?.name ?? '');
    return `${who}の次のターンのはじめまで (あと${turnsUntil(s, until)}ターン)`;
  };
  const rows: EffectRow[] = [];
  const add = (src: string | null, items: string[], dur: string, manual = false) => {
    const r = rows.find((x) => x.src === src && x.dur === dur && !!x.manual === manual);
    if (r) r.items.push(...items.filter((i) => !r.items.includes(i)));
    else rows.push({ src, items: [...items], dur, ...(manual ? { manual } : {}) });
  };
  // 常在型能力 (発生源がバトルゾーンなどにある間)
  for (const e of staticEffectsOn(s, L, iid)) {
    const items = [...e.kws.map(kwLabel), ...(e.power ? [signed(e.power)] : [])];
    add(name(s.cards[e.src]?.cid), items, 'そのカードがある間');
  }
  // 効果で一時的に与えられた能力
  for (const g of c.grants ?? []) if (g.kws.length) add(name(g.src), g.kws.map(kwLabel), untilText(g.until));
  // このターンのパワー修正
  let rest = c.powerMod;
  for (const p of c.powerSrc ?? []) {
    rest -= p.n;
    if (p.n) add(p.cid ? name(p.cid) : null, [signed(p.n)], untilText(-1), !p.cid);
  }
  if (rest) add(null, [signed(rest)], untilText(-1));
  if (c.battleMod) add(null, [signed(c.battleMod)], 'このバトルの終わりまで');
  // 攻撃・ブロックの制限
  if (c.noAttack) add(null, ['攻撃できない'], untilText(-1));
  if (c.restrict) {
    const r = c.restrict;
    const what = [r.attack && '攻撃できない', r.block && 'ブロックできない', r.noAttackPlayer != null && `${r.noAttackPlayer === me ? '自分' : s.players[r.noAttackPlayer]?.name}を攻撃できない`].filter((x): x is string => !!x);
    if (what.length) add(null, what, r.untilEnd != null ? `${r.until === me ? '自分' : s.players[r.until]?.name}の次のターンの終わりまで` : untilText(r.until));
  }
  return rows;
}
