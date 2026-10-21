import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { cpuDecide, cpuPlan, metaScore } from './cpu';
import { createGame } from './engine';
import type { GameState } from './types';

const cr = (id: string, cost: number, power: number, text: string[] = [], civ = 'F') => ({
  id,
  n: id,
  img: '',
  f: [{ n: id, t: 'クリーチャー', c: civ, co: cost, p: String(power), r: ['テスト'], x: text }],
});
const sp = (id: string, cost: number, text: string[], civ = 'F') => ({
  id,
  n: id,
  img: '',
  f: [{ n: id, t: '呪文', c: civ, co: cost, p: null, r: [], x: text }],
});

const db = buildDB(
  [
    cr('vanilla', 1, 1000),
    cr('cheap', 2, 2000),
    cr('cheap2', 3, 3000),
    cr('big', 7, 9000, ['W・ブレイカー']),
    cr('huge', 9, 15000, ['T・ブレイカー']),
    cr('multi', 5, 5000, [], 'FN'),
    cr('meta', 3, 2000, ['相手は呪文を唱えられない。']),
    cr('beater', 5, 8000),
    cr('blocker', 3, 3000, ['ブロッカー']),
    cr('attacker', 2, 4000, ['スピードアタッカー']),
    sp('kill', 3, ['相手のクリーチャーを1体破壊する。']),
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

interface Setup {
  hand?: string[];
  mana?: number;
  myBattle?: string[];
  oppBattle?: string[];
  oppShields?: number;
  myShields?: number;
  oppTapped?: boolean;
}

/** CPU = player 0 のメイン段階を作る */
function setup(o: Setup): GameState {
  const deck = Array(40).fill('vanilla');
  const s = structuredClone(
    createGame(
      {
        mode: 'duema',
        seed: 3,
        createdAt: 0,
        players: [
          { uid: 'cpu', name: 'CPU', cpu: true, main: [...deck], hyper: [], gr: [], partner: null },
          { uid: 'opp', name: 'OPP', cpu: false, main: [...deck], hyper: [], gr: [], partner: null },
        ],
      },
      L,
    ),
  );
  const fresh = (p: number, cid: string, zone: 'hand' | 'battle' | 'mana' | 'shield') => {
    const iid = s.cards.length;
    s.cards.push({ iid, cid, owner: p, zone, tapped: false, sick: false, face: 0, under: [], parent: null, powerMod: 0, noAttack: false, faceUp: zone !== 'shield', revealed: false });
    s.players[p][zone].push(iid);
    return iid;
  };
  s.players[0].hand = [];
  for (const c of o.hand ?? []) fresh(0, c, 'hand');
  for (let i = 0; i < (o.mana ?? 0); i++) fresh(0, 'vanilla', 'mana');
  for (const c of o.myBattle ?? []) fresh(0, c, 'battle');
  for (const c of o.oppBattle ?? []) {
    const i = fresh(1, c, 'battle');
    s.cards[i].tapped = !!o.oppTapped;
  }
  if (o.oppShields != null) s.players[1].shield = s.players[1].shield.slice(0, o.oppShields);
  if (o.myShields != null) s.players[0].shield = s.players[0].shield.slice(0, o.myShields);
  s.active = 0;
  s.turn = 5;
  s.turnStep = 'main';
  s.phase = 'main';
  s.pending = [];
  return s;
}
const cidOf = (s: GameState, iid: number) => s.cards[iid].cid;

describe('CPU priorities', () => {
  it('detects meta abilities', () => {
    expect(metaScore(db.byId.get('meta')!.faces[0])).toBeGreaterThan(0);
    expect(metaScore(db.byId.get('beater')!.faces[0])).toBe(0);
  });

  it('early game: charges multicolor / high-cost cards and keeps cheap ones', () => {
    const s = setup({ hand: ['cheap', 'multi', 'cheap2'], mana: 1 });
    const a = cpuDecide(s, 0, L)!;
    expect(a.t).toBe('charge');
    expect(cidOf(s, (a as { iid: number }).iid)).toBe('multi');
    const s2 = setup({ hand: ['cheap', 'huge'], mana: 2 });
    expect(cidOf(s2, (cpuDecide(s2, 0, L) as { iid: number }).iid)).toBe('huge');
  });

  it('mid/late game: keeps a castable high-cost card and buries a cheap one', () => {
    const s = setup({ hand: ['cheap', 'big'], mana: 6 });
    const a = cpuDecide(s, 0, L)!;
    expect(a.t).toBe('charge');
    expect(cidOf(s, (a as { iid: number }).iid)).toBe('cheap');
    // チャージ後は 7 マナで big を出す
    s.players[0].charged = true;
    for (const iid of s.players[0].hand.filter((i) => cidOf(s, i) === 'cheap')) {
      s.players[0].hand.splice(s.players[0].hand.indexOf(iid), 1);
      s.cards[iid].zone = 'mana';
      s.players[0].mana.push(iid);
    }
    const b = cpuDecide(s, 0, L)!;
    expect(b.t).toBe('play');
    expect(cidOf(s, (b as { iid: number }).iid)).toBe('big');
  });

  it('removes a meta card before developing, and targets it over a stronger vanilla', () => {
    const s = setup({ hand: ['kill', 'beater'], mana: 8, oppBattle: ['beater', 'meta'] });
    s.players[0].charged = true;
    const a = cpuDecide(s, 0, L)!;
    expect(a.t).toBe('play');
    expect(cidOf(s, (a as { iid: number }).iid)).toBe('kill');
  });

  it('effect targeting prefers the meta card', () => {
    const s = setup({ oppBattle: ['beater', 'meta'] });
    const metaIid = s.players[1].battle.find((i) => cidOf(s, i) === 'meta')!;
    s.pending = [
      { kind: 'ability', player: 0, src: 0, cid: 'kill', face: 0, event: 'spell', text: '', effect: '相手のクリーチャーを1体破壊する。', optional: false, auto: false },
    ];
    const plan = cpuPlan(s, 0, L);
    expect(plan[0]).toEqual({ t: 'move', iid: metaIid, to: 'grave' });
  });

  it('goes all-in when it has lethal', () => {
    const s = setup({ myBattle: ['attacker', 'attacker'], oppShields: 1 });
    s.players[0].charged = true;
    const a = cpuDecide(s, 0, L)!;
    expect(a).toMatchObject({ t: 'attack', player: 1 });
  });

  it('hunts a tapped meta creature it can beat', () => {
    const s = setup({ myBattle: ['beater'], oppBattle: ['meta'], oppTapped: true });
    s.players[0].charged = true;
    const a = cpuDecide(s, 0, L)!;
    expect(a.t).toBe('attack');
    expect(cidOf(s, (a as { card: number }).card)).toBe('meta');
  });

  it('keeps blockers home when it could lose next turn', () => {
    const s = setup({ myBattle: ['blocker'], oppBattle: ['big', 'big'], myShields: 2 });
    s.players[0].charged = true;
    expect(cpuDecide(s, 0, L)).toEqual({ t: 'endTurn' });
  });
});

import { hintsFromText } from './effects';
describe('mass removal', () => {
  it('parses conditions', () => {
    expect(hintsFromText(['コスト5以上のクリーチャーをすべて、持ち主の手札に戻す。'])[0]).toMatchObject({ kind: 'massBounce', minCost: 5, oppOnly: false });
    expect(hintsFromText(['相手のパワー3000以下のクリーチャーをすべて破壊する。'])[0]).toMatchObject({ kind: 'massDestroy', maxPower: 3000, oppOnly: true });
  });
  it('CPU bounces every matching creature on both sides', () => {
    const s = setup({ myBattle: ['big', 'cheap'], oppBattle: ['beater', 'meta'] });
    s.pending = [
      { kind: 'ability', player: 0, src: 0, cid: 'x', face: 0, event: 'spell', text: '', effect: 'コスト5以上のクリーチャーをすべて、持ち主の手札に戻す。', optional: false, auto: false },
    ];
    const moved = cpuPlan(s, 0, L)
      .filter((a) => a.t === 'move')
      .map((a) => cidOf(s, (a as { iid: number }).iid))
      .sort();
    expect(moved).toEqual(['beater', 'big']);
  });
});

describe('reveal and play for free (清永)', () => {
  const KIYO = 'このクリーチャーが攻撃する時、自分の山札の上から３枚を表向きにする。それらがすべて異なるコストなら、その中から、コスト９以下のエレメントを好きな数、コストを支払わずに使ってもよい。残りをすべてマナゾーンに置く。';
  it('parses 清永', () => {
    expect(hintsFromText([KIYO])[0]).toMatchObject({ kind: 'revealPlay', n: 3, maxCost: 9, playType: 'element', distinct: true, rest: 'mana' });
  });
  it('plays revealed cards with different costs, and sends the rest to mana', () => {
    const s = setup({});
    const deck = s.players[0].deck;
    // 山札の上 (配列の末尾) を cheap(2), beater(5), huge(9) にする
    const put = (cid: string) => {
      const iid = deck.pop()!;
      s.cards[iid].cid = cid;
      return iid;
    };
    const a = put('cheap');
    const b = put('beater');
    const c = put('huge');
    deck.push(a, b, c);
    s.pending = [{ kind: 'ability', player: 0, src: 0, cid: 'x', face: 0, event: 'attack', text: '', effect: KIYO, optional: true, auto: false }];
    const plan = cpuPlan(s, 0, L);
    expect(plan.filter((x) => x.t === 'play').map((x) => cidOf(s, (x as { iid: number }).iid)).sort()).toEqual(['beater', 'cheap', 'huge']);
  });
  it('plays nothing when costs are not all different', () => {
    const s = setup({});
    const deck = s.players[0].deck;
    const ids = deck.slice(-3);
    s.cards[ids[0]].cid = 'cheap';
    s.cards[ids[1]].cid = 'cheap';
    s.cards[ids[2]].cid = 'beater';
    s.pending = [{ kind: 'ability', player: 0, src: 0, cid: 'x', face: 0, event: 'attack', text: '', effect: KIYO, optional: true, auto: false }];
    const plan = cpuPlan(s, 0, L);
    expect(plan.filter((x) => x.t === 'play')).toEqual([]);
    expect(plan.filter((x) => x.t === 'move' && x.to === 'mana').length).toBe(3);
  });
});
