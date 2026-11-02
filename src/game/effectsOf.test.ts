import { expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, createGame } from '../engine/engine';
import type { GameState } from '../engine/types';
import { effectsOf } from './effectsOf';

// ---- テスト用の架空カード ----
const cr = (id: string, name: string, text: string[]) => ({ id, n: name, img: '', f: [{ n: name, t: 'クリーチャー', c: 'F', co: 1, p: '5000', r: ['テスト'], x: text }] });
const db = buildDB(
  [
    cr('vanilla', 'バニラ', []),
    cr('bakt', '竜皇神テスト', ['自分の他のクリーチャーすべてに「ブロッカー」と「スピードアタッカー」を与える。']),
    { id: 'giro', n: 'ギロチンテスト', img: '', f: [{ n: 'ギロチンテスト', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['このターン、相手のクリーチャーすべてのパワーを-2000する。'] }] },
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

/** player 0 の手札に呪文、両方のバトルゾーンに指定のクリーチャー */
function setup(battle0: string[], battle1: string[]): GameState {
  const deck = [...Array(30).fill('vanilla'), 'giro', ...battle0, ...battle1];
  const s = structuredClone(
    createGame({ mode: 'duema', seed: 1, createdAt: 0, players: [0, 1].map((p) => ({ uid: `u${p}`, name: `P${p}`, cpu: false, main: deck, hyper: [], gr: [], partner: null })) }, L),
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
  };
  battle0.forEach((c) => put(0, c, 'battle'));
  battle1.forEach((c) => put(1, c, 'battle'));
  put(0, 'giro', 'hand');
  put(0, 'vanilla', 'mana');
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

it('カードの詳細: 常在型能力で受けている効果と、その発生源', () => {
  const s = setup(['bakt', 'vanilla'], []);
  const v = s.players[0].battle.find((i) => s.cards[i].cid === 'vanilla')!;
  const rows = effectsOf(s, L, v, 0);
  expect(rows).toEqual([{ src: '竜皇神テスト', items: ['ブロッカー', 'スピードアタッカー'], dur: 'そのカードがある間' }]);
  // 発生源自身には出さない
  const b = s.players[0].battle.find((i) => s.cards[i].cid === 'bakt')!;
  expect(effectsOf(s, L, b, 0)).toEqual([]);
});

it('カードの詳細: 呪文によるこのターンのパワー修正と、手動の修正', () => {
  let s = setup([], ['vanilla']);
  const spell = s.players[0].hand.find((i) => s.cards[i].cid === 'giro')!;
  const r = applyAction(s, 0, { t: 'play', iid: spell, face: 0, pay: [s.players[0].mana[0]] }, L);
  expect(r.error).toBeFalsy();
  s = r.state;
  const v = s.players[1].battle[0];
  expect(effectsOf(s, L, v, 0)).toEqual([{ src: 'ギロチンテスト', items: ['パワー-2000'], dur: 'このターンの終わりまで (あと1ターン)' }]);
  s = applyAction(s, 0, { t: 'power', iid: v, delta: 1000 }, L).state;
  expect(effectsOf(s, L, v, 0)[1]).toEqual({ src: null, manual: true, items: ['パワー+1000'], dur: 'このターンの終わりまで (あと1ターン)' });
  // ターンが終わると消える
  s = applyAction(s, 0, { t: 'endTurn' }, L).state;
  expect(effectsOf(s, L, v, 0)).toEqual([]);
});
