// 押して発動する任意効果 (S・トリガー / G・ストライク / 革命チェンジ・侵略 / 「〜してもよい」) の判定
import { abilityPick } from '../engine/engine';
import type { Action, GameState, Pending } from '../engine/types';

export interface Activation {
  /** 押すと発動できるカード (光らせる) */
  cards: number[];
  /** 発動しない時のアクション (null: 使わないことはできない) */
  skip: Action | null;
  /** 同時に誘発した能力の順番を選ぶ (押したカードの能力を次に処理する) */
  order?: boolean;
  /** 表示用 */
  title: string;
}

/** 自分の保留中の処理が「カードを押して発動する」ものならその内容 */
export function activationOf(s: GameState, pending: Pending | null): Activation | null {
  if (!pending) return null;
  if (pending.kind === 'trigger') return { cards: [pending.iid], skip: { t: 'trigger', use: false }, title: pending.trigger ? 'S・トリガー' : 'G・ストライク' };
  if (pending.kind === 'attackOpt') return { cards: pending.options, skip: { t: 'attackOpt', iid: null }, title: '革命チェンジ / 侵略' };
  // 使うと決めた能力の続きの「〜してもよい」は、カードを押し直さずに確認だけ出す
  if (pending.kind === 'choice' && pending.mode === 'yesno' && !pending.exec.activated) {
    const src = pending.exec.src;
    return { cards: s.cards[src] ? [src] : [], skip: { t: 'choose', yes: false }, title: '任意の効果' };
  }
  return null;
}

/** 同時に誘発した自分の能力が2つ以上ある時: その発生源のカードを光らせ、押した能力から処理する */
export function orderActivation(s: GameState, me: number): Activation | null {
  const pk = abilityPick(s);
  if (!pk || pk.indices.length < 2 || pk.player !== me) return null;
  const cards = [...new Set(pk.indices.map((i) => (s.pending[i] as Extract<Pending, { kind: 'ability' }>).src))];
  return { cards, skip: null, title: '同時に発動する能力 (押した順に処理します)', order: true };
}
