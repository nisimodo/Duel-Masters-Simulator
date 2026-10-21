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
