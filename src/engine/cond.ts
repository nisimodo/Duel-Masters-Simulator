import type { Card, Face } from '../lib/cards';
import type { CondSpec } from '../lib/keywords';

/** 革命チェンジ/侵略の条件にクリーチャーが合うか (テキスト解析による近似判定) */
export function matchesCond(cond: CondSpec, card: Card, face: Face): boolean {
  if (!face.isCreature) return false;
  if (cond.civs.length && !cond.civs.some((c) => face.civs.includes(c as never) || card.civs.includes(c as never))) return false;
  if (cond.minCost != null && face.cost < cond.minCost) return false;
  if (cond.maxCost != null && face.cost > cond.maxCost) return false;
  if (cond.nameHas && !face.name.includes(cond.nameHas) && !card.name.includes(cond.nameHas)) return false;
  if (cond.words.length) {
    const hay = [...face.races, face.type, face.name].join('/');
    if (!cond.words.some((w) => hay.includes(w))) return false;
  }
  return true;
}
