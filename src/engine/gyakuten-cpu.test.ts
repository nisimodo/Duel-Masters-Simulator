import { expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { cpuPlan } from './cpu';
import { applyAction, createGame, decider } from './engine';
import type { GameState } from './types';

// ---- テスト用の架空カード ----
const db = buildDB(
  [
    { id: 'vanilla', n: 'バニラ', img: '', f: [{ n: 'バニラ', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['テスト'], x: [] }] },
    { id: 'sa', n: '速攻', img: '', f: [{ n: '速攻', t: 'クリーチャー', c: 'F', co: 1, p: '3000', r: ['テスト'], x: ['スピードアタッカー'] }] },
    {
      id: 'gyaku',
      n: '正義の逆転撃',
      img: '',
      f: [
        {
          n: '正義の逆転撃',
          t: '呪文',
          c: 'L',
          co: 3,
          p: null,
          r: [],
          x: [
            '逆転撃{ll03}：クリーチャーが自分を攻撃する時、その攻撃中にまだ「逆転撃」を使っていなければ、この呪文を自分の手札からコストを支払わずに唱えてもよい。そうしたら、次の自分のターンのはじめに{ll03}を支払う。支払えなければ、自分はゲームに負ける。',
            'カードを１枚引く。',
          ],
        },
      ],
    },
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

/** CPU (player 0) の手札に逆転撃、マナ mana 枚。相手 (player 1) のスピードアタッカーが CPU を攻撃したところ */
function attacked(mana: number): GameState {
  const deck = [...Array(30).fill('vanilla'), 'gyaku', 'sa'];
  let s = structuredClone(
    createGame({ mode: 'duema', seed: 5, createdAt: 0, players: [0, 1].map((p) => ({ uid: `u${p}`, name: `P${p}`, cpu: p === 0, main: deck, hyper: [], gr: [], partner: null })) }, L),
  );
  const take = (p: number, cid: string) => {
    const pl = s.players[p];
    for (const z of ['deck', 'shield', 'hand'] as const) {
      const iid = pl[z].find((i) => s.cards[i].cid === cid);
      if (iid == null) continue;
      pl[z].splice(pl[z].indexOf(iid), 1);
      return iid;
    }
    throw new Error(cid);
  };
  const put = (p: number, cid: string, zone: 'battle' | 'hand' | 'mana') => {
    const iid = take(p, cid);
    s.cards[iid].zone = zone;
    s.players[p][zone].push(iid);
    return iid;
  };
  put(0, 'gyaku', 'hand');
  for (let i = 0; i < mana; i++) put(0, 'vanilla', 'mana');
  const atk = put(1, 'sa', 'battle');
  s.active = 1;
  s.pending = [];
  s.turnStep = 'main';
  const r = applyAction(s, 1, { t: 'attack', attacker: atk, player: 0 }, L);
  expect(r.error).toBeFalsy();
  s = r.state;
  // CPU が選ぶ間だけ進める
  for (let k = 0; k < 10 && decider(s) === 0; k++) {
    let moved = false;
    for (const a of cpuPlan(s, 0, L)) {
      const x = applyAction(s, 0, a, L);
      if (!x.error) {
        s = x.state;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return s;
}
const inHand = (s: GameState) => s.players[0].hand.some((i) => s.cards[i].cid === 'gyaku');

it('CPU: 次のターンのはじめにコストを支払えない時は逆転撃を使わない', () => {
  const s = attacked(2);
  expect(inHand(s)).toBe(true);
  expect(s.debts ?? []).toEqual([]);
});

it('CPU: コストを支払える時は逆転撃を使う', () => {
  const s = attacked(3);
  expect(inHand(s)).toBe(false);
  expect(s.debts).toEqual([{ player: 0, cost: 3 }]);
});
