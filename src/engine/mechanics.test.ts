// 名前のある能力 (B・A・D・マナ爆誕・エターナル・Ω・ガードマン 等) のテスト
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, createGame, kwOf, power } from './engine';
import type { Action, GameState } from './types';

const cr = (id: string, cost: number, power: number, text: string[], civ = 'F') => ({
  id,
  n: id,
  img: '',
  f: [{ n: id, t: 'クリーチャー', c: civ, co: cost, p: String(power), r: ['テスト'], x: text }],
});

const db = buildDB(
  [
    cr('vanilla', 1, 1000, []),
    cr('bad', 4, 5000, ['B・A・D2(このクリーチャーを、コストを2少なくして召喚してもよい。そうしたら、このターンの終わりにこのクリーチャーを破壊する)']),
    cr('baku', 5, 5000, ['マナ爆誕3(このクリーチャーを自分のマナゾーンから、コスト3を支払って召喚してもよい)']),
    cr('omega', 1, 5000, ['エターナル・Ω(このクリーチャーがバトルゾーンを離れる時、かわりに手札に戻す)']),
    cr('guard', 1, 6000, ['ガードマン(自分の他のクリーチャーが攻撃される時、このクリーチャーをタップしてもよい。そうした場合、攻撃クリーチャーはかわりにこのクリーチャーを攻撃する)']),
    cr('sa', 1, 3000, ['スピードアタッカー']),
    {
      id: 'hyper',
      n: 'hyper',
      img: '',
      f: [
        { n: 'hyper', t: 'クリーチャー', c: 'F', co: 3, p: '3000', r: ['テスト'], x: ['ハイパー化:自分の他のクリーチャーを1体タップする。'] },
        { n: 'hyper', t: 'クリーチャー', c: 'F', co: 3, p: '9000', r: ['テスト'], x: ['ハイパー化:自分の他のクリーチャーを1体タップする。', 'W・ブレイカー'] },
      ],
    },
    cr('tapper', 1, 1000, ['このクリーチャーで攻撃するかわりに、タップして次の能力を使ってもよい。', 'カードを2枚引く。']),
    { id: 'sv1', n: 'sv1', img: '', f: [{ n: 'sv1', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['サバイバー'], x: ['oS このクリーチャーのパワーは+2000される。', 'サバイバー(自分のサバイバーはすべて、上のoS 能力を持つ)'] }] },
    { id: 'sv2', n: 'sv2', img: '', f: [{ n: 'sv2', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['サバイバー'], x: [] }] },
    cr('wave', 1, 1000, ['ウェーブストライカー(バトルゾーンに「ウェーブストライカー」を持つクリーチャーが他に2体以上あれば、このクリーチャーは次の能力を得る)', 'W・ブレイカー']),
    cr('mugen', 7, 7000, ['ムゲンクライム2(自分のクリーチャーを2体タップし、[ff02]支払って、このクリーチャーを自分の手札または墓地から召喚してもよい)']),
    { id: 'kill', n: 'kill', img: '', f: [{ n: 'kill', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['相手のクリーチャーを1体破壊する。'] }] },
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

/** 指定のカードを各ゾーンに置いた2人対戦 (player 0 のメインステップ) */
function setup(zones: { p: number; cid: string; zone: 'hand' | 'battle' | 'mana'; tapped?: boolean }[], mana = 3): GameState {
  const extra = zones.map((z) => z.cid);
  let s = createGame(
    {
      mode: 'duema',
      seed: 1,
      createdAt: 0,
      players: [0, 1].map((p) => ({
        uid: 'u' + p,
        name: 'P' + p,
        cpu: false,
        main: [...Array(30).fill('vanilla'), ...extra.filter((_, i) => zones[i].p === p)],
        hyper: [],
        gr: [],
        partner: null,
      })),
    },
    L,
  );
  s = structuredClone(s);
  const used = new Set<number>();
  for (const z of zones) {
    const pl = s.players[z.p];
    let iid: number | undefined;
    for (const from of ['deck', 'shield', 'hand'] as const) {
      iid = pl[from].find((i) => s.cards[i].cid === z.cid && !used.has(i));
      if (iid != null) {
        pl[from].splice(pl[from].indexOf(iid), 1);
        break;
      }
    }
    if (iid == null) throw new Error('not found ' + z.cid);
    used.add(iid);
    s.cards[iid].zone = z.zone;
    s.cards[iid].tapped = !!z.tapped;
    s.cards[iid].sick = false;
    pl[z.zone].push(iid);
  }
  for (let p = 0; p < 2; p++)
    for (let i = 0; i < mana; i++) {
      const iid = s.players[p].deck.pop()!;
      s.cards[iid].zone = 'mana';
      s.players[p].mana.push(iid);
    }
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

function act(s: GameState, p: number, a: Action): GameState {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return r.state;
}
const find = (s: GameState, p: number, zone: 'hand' | 'battle' | 'mana' | 'grave', cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);
const freeMana = (s: GameState, p: number, n: number, not?: number) => s.players[p].mana.filter((i) => !s.cards[i].tapped && i !== not).slice(0, n);

describe('named mechanics', () => {
  it('B・A・D: summons cheaper and is destroyed at end of turn', () => {
    let s = setup([{ p: 0, cid: 'bad', zone: 'hand' }]);
    const iid = find(s, 0, 'hand', 'bad')!;
    expect(applyAction(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 2) }, L).error).toBeTruthy();
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 2), alt: 'bad' });
    expect(s.cards[iid].zone).toBe('battle');
    s = act(s, 0, { t: 'endTurn' });
    expect(s.cards[iid].zone).toBe('grave');
  });

  it('マナ爆誕: summons from the mana zone', () => {
    let s = setup([{ p: 0, cid: 'baku', zone: 'mana' }]);
    const iid = find(s, 0, 'mana', 'baku')!;
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 3, iid), alt: 'mana' });
    expect(s.cards[iid].zone).toBe('battle');
  });

  it('エターナル・Ω: returns to hand instead of being destroyed', () => {
    let s = setup([
      { p: 0, cid: 'kill', zone: 'hand' },
      { p: 1, cid: 'omega', zone: 'battle' },
    ]);
    const om = find(s, 1, 'battle', 'omega')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'kill')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 5 && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.kind === 'choice') s = act(s, top.player, { t: 'choose', picks: [om] });
      else if (top.kind === 'ability') s = act(s, top.player, { t: 'resolve', use: true });
      else break;
    }
    expect(s.cards[om].zone).toBe('hand');
  });

  it('ガードマン: redirects an attack on another creature', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 1, cid: 'vanilla', zone: 'battle', tapped: true },
      { p: 1, cid: 'guard', zone: 'battle' },
    ]);
    const sa = find(s, 0, 'battle', 'sa')!;
    const victim = s.players[1].battle.find((i) => s.cards[i].cid === 'vanilla')!;
    const g = find(s, 1, 'battle', 'guard')!;
    s = act(s, 0, { t: 'attack', attacker: sa, player: 1, card: victim });
    const top = s.pending[0];
    expect(top.kind).toBe('block');
    expect(top.kind === 'block' && top.guards).toContain(g);
    s = act(s, 1, { t: 'block', guard: g });
    // 3000 vs 6000 → アタッカーが負け、守られたクリーチャーは無事
    expect(s.cards[victim].zone).toBe('battle');
    expect(s.cards[sa].zone).toBe('grave');
  });

  it('ハイパー化: taps another creature and switches to the hyper face', () => {
    let s = setup([
      { p: 0, cid: 'hyper', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const h = find(s, 0, 'battle', 'hyper')!;
    const v = s.players[0].battle.find((i) => i !== h)!;
    s = act(s, 0, { t: 'hyperize', iid: h, taps: [v] });
    expect(s.cards[h].face).toBe(1);
    expect(s.cards[v].tapped).toBe(true);
    expect(power(s, L, h)).toBe(9000);
  });

  it('tap ability: taps instead of attacking and resolves the effect', () => {
    let s = setup([{ p: 0, cid: 'tapper', zone: 'battle' }]);
    const t = find(s, 0, 'battle', 'tapper')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'tapAbility', iid: t });
    for (let k = 0; k < 3 && s.pending.length; k++) s = act(s, 0, { t: 'resolve', use: true });
    expect(s.cards[t].tapped).toBe(true);
    expect(s.players[0].hand.length).toBe(hand + 2);
  });

  it('サバイバー: other survivors share the oS ability', () => {
    const s = setup([
      { p: 0, cid: 'sv1', zone: 'battle' },
      { p: 0, cid: 'sv2', zone: 'battle' },
    ]);
    expect(power(s, L, find(s, 0, 'battle', 'sv1')!)).toBe(3000);
    expect(power(s, L, find(s, 0, 'battle', 'sv2')!)).toBe(3000);
  });

  it('ウェーブストライカー: needs two other wave strikers', () => {
    const two = setup([
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 0, cid: 'wave', zone: 'battle' },
    ]);
    expect(kwOf(two, L, two.players[0].battle[0]).breaker).toBe(1);
    const three = setup([
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 1, cid: 'wave', zone: 'battle' },
    ]);
    expect(kwOf(three, L, three.players[0].battle[0]).breaker).toBe(2);
  });

  it('ムゲンクライム: taps two creatures and summons from the graveyard', () => {
    let s = setup([
      { p: 0, cid: 'mugen', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const m = find(s, 0, 'hand', 'mugen')!;
    s = act(s, 0, { t: 'move', iid: m, to: 'grave' });
    const taps = s.players[0].battle.slice(0, 2);
    s = act(s, 0, { t: 'play', iid: m, face: 0, pay: freeMana(s, 0, 2), alt: 'mugen', taps });
    expect(s.cards[m].zone).toBe('battle');
    expect(taps.every((b) => s.cards[b].tapped)).toBe(true);
  });
});
