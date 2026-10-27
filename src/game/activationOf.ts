// 押して発動する任意効果 (S・トリガー / G・ストライク / 革命チェンジ・侵略 / 「〜してもよい」) の判定
import type { Action, GameState, Pending } from '../engine/types';

export interface Activation {
  /** 押すと発動できるカード (光らせる) */
  cards: number[];
  /** 発動しない時のアクション */
  skip: Action;
  /** 表示用 */
  title: string;
}

/** 自分の保留中の処理が「カードを押して発動する」ものならその内容 */
export function activationOf(s: GameState, pending: Pending | null): Activation | null {
  if (!pending) return null;
  if (pending.kind === 'trigger') return { cards: [pending.iid], skip: { t: 'trigger', use: false }, title: pending.trigger ? 'S・トリガー' : 'G・ストライク' };
  if (pending.kind === 'attackOpt') return { cards: pending.options, skip: { t: 'attackOpt', iid: null }, title: '革命チェンジ / 侵略' };
  if (pending.kind === 'choice' && pending.mode === 'yesno') {
    const src = pending.exec.src;
    return { cards: s.cards[src] ? [src] : [], skip: { t: 'choose', yes: false }, title: '任意の効果' };
  }
  return null;
}
