// デッキ「バカ連ドラ」(デュエパ) のテストプレイで処理できなかった能力
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, createGame, decider, power } from './engine';
import { programOf, startExec } from './interp';
import { abilitiesIgnored } from './statics';
import type { Action, GameState } from './types';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), []);
const L = (cid: string) => db.byId.get(cid);

// 能力のないカード
const V = 'dmd17-006'; // 水 2 / 2000
const FV = 'dm01-097'; // 火 2 / 2000
const DV = 'dm08-049'; // 火のドラゴン 4 / 4000
const BIG = 'dmx01-009'; // 火 7 / 25000
const CIP = 'dmsd01-005'; // 出た時、カードを1枚引く
const SP = 'dm36-086'; // 呪文

type Zone = 'hand' | 'battle' | 'mana' | 'grave' | 'deck' | 'hyper';
/** player 0 のターンのメイン。place のカードを置き、deckTop は山札の上 (最後が一番上) */
function setup(place: { p: number; cid: string; zone: Zone; tapped?: boolean; face?: number }[], deckTop: { p: number; cids: string[] }[] = []): GameState {
  const extra = [...place.map((x) => x.cid), ...deckTop.flatMap((d) => d.cids)];
  const deck = [...Array(30).fill(V), ...extra];
  const s = structuredClone(createGame({ mode: 'duema', seed: 1, createdAt: 0, players: [0, 1].map((p) => ({ uid: `u${p}`, name: `P${p}`, cpu: false, main: deck, hyper: [], gr: [], partner: null })) }, L));
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
  for (const x of place) {
    const iid = take(x.p, x.cid);
    const c = s.cards[iid];
    c.zone = x.zone;
    c.tapped = !!x.tapped;
    c.face = x.face ?? 0;
    c.sick = false;
    s.players[x.p][x.zone].push(iid);
  }
  for (const d of deckTop)
    for (const cid of d.cids) {
      const iid = take(d.p, cid);
      s.cards[iid].zone = 'deck';
      s.players[d.p].deck.push(iid);
    }
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

/** 保留中の処理を進める (任意の効果は使う。カードは prefer に合うものから選ぶ) */
function drive(s: GameState, prefer?: (s: GameState, iid: number) => boolean): GameState {
  for (let k = 0; k < 60; k++) {
    const p = decider(s);
    const top = s.pending[0];
    if (p == null || !top) break;
    let a: Action;
    if (top.kind === 'ability') a = { t: 'resolve', use: true };
    else if (top.kind === 'choice') {
      if (top.mode === 'yesno') a = { t: 'choose', yes: true };
      else if (top.mode === 'modal') a = { t: 'choose', options: [0] };
      else {
        const opts = [...top.options].sort((x, y) => Number(!!prefer?.(s, y)) - Number(!!prefer?.(s, x)));
        a = { t: 'choose', picks: opts.slice(0, top.max) };
      }
    } else if (top.kind === 'trigger') a = { t: 'trigger', use: false };
    else if (top.kind === 'block') a = { t: 'block', blocker: null };
    else if (top.kind === 'breakSel') a = { t: 'breakSel', shields: s.players[top.target].shield.slice(0, top.count) };
    else if (top.kind === 'attackOpt') a = { t: 'attackOpt', iid: null };
    else a = { t: 'partner', yes: false };
    const r = applyAction(s, p, a, L);
    if (r.error) throw new Error(`${r.error} (${top.kind} ${JSON.stringify(a)})`);
    s = r.state;
  }
  return s;
}
const act = (s: GameState, p: number, a: Action) => {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return drive(r.state);
};
const find = (s: GameState, p: number, zone: Zone, cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);
/** カードの能力 (n 番目の誘発型能力) を、そのカードの能力として実行する */
function run(s: GameState, src: number, trig: number, subject?: number) {
  const c = s.cards[src];
  const f = L(c.cid)!.faces[c.face];
  startExec(s, L, c.owner, src, programOf(f.triggers![trig].effect).ops, f.name, undefined, subject);
}

describe('バカ連ドラの能力', () => {
  it('水神 ミヅハノメノカミ: 相手の山札からクリーチャーが出るまで表向きにして墓地に置き、その「出た時」の能力を自分が使う', () => {
    let s = setup([{ p: 0, cid: 'dm25ex2-004', zone: 'battle' }], [{ p: 1, cids: [CIP, SP, SP] }]);
    const deck1 = s.players[1].deck.length;
    const hand0 = s.players[0].hand.length;
    run(s, find(s, 0, 'battle', 'dm25ex2-004')!, 0);
    s = drive(s);
    expect(find(s, 1, 'grave', CIP)).toBeDefined();
    expect(s.players[1].deck.length).toBe(deck1 - 1);
    // ツタンカーネンの「出た時、カードを1枚引く」を自分が使った
    expect(s.players[0].hand.length).toBe(hand0 + 1);
  });

  it('禁時混成王 ドキンダンテXXII: 次の自分のターンのはじめまで、相手のクリーチャーの能力を無視する', () => {
    let s = setup([
      { p: 0, cid: 'dmrp18-km3', zone: 'battle' },
      { p: 1, cid: CIP, zone: 'battle' },
    ]);
    const opp = find(s, 1, 'battle', CIP)!;
    run(s, find(s, 0, 'battle', 'dmrp18-km3')!, 0);
    s = drive(s);
    expect(abilitiesIgnored(s, L, opp)).toBe(true);
    s = act(s, 0, { t: 'endTurn' });
    expect(abilitiesIgnored(s, L, opp)).toBe(true);
    s = act(s, 1, { t: 'endTurn' });
    expect(s.active).toBe(0);
    expect(abilitiesIgnored(s, L, opp)).toBe(false);
  });

  it('桜龍パーフェクト・スターズ: 超次元ゾーンに置いたドラゴンに、次の自分のターンのはじめまでなる', () => {
    let s = setup(
      [
        { p: 0, cid: 'dm26ex3-025', zone: 'battle' },
        { p: 0, cid: DV, zone: 'hand' },
      ],
      [{ p: 0, cids: [V] }],
    );
    const ps = find(s, 0, 'battle', 'dm26ex3-025')!;
    run(s, ps, 0);
    s = drive(s, (st, i) => st.cards[i].cid === DV);
    expect(find(s, 0, 'hyper', DV)).toBeDefined();
    expect(s.cards[ps].cid).toBe(DV);
    expect(power(s, L, ps)).toBe(4000);
    s = act(s, 0, { t: 'endTurn' });
    expect(s.cards[ps].cid).toBe(DV);
    s = act(s, 1, { t: 'endTurn' });
    expect(s.cards[ps].cid).toBe('dm26ex3-025');
    expect(s.cards[ps].became).toBeUndefined();
  });

  it('桜龍パーフェクト・スターズ: ドラゴンでなければ、そのクリーチャーにはならない', () => {
    let s = setup([
      { p: 0, cid: 'dm26ex3-025', zone: 'battle' },
      { p: 0, cid: FV, zone: 'hand' },
    ]);
    const ps = find(s, 0, 'battle', 'dm26ex3-025')!;
    run(s, ps, 0);
    s = drive(s, (st, i) => st.cards[i].cid === FV);
    expect(find(s, 0, 'hyper', FV)).toBeDefined();
    expect(s.cards[ps].cid).toBe('dm26ex3-025');
  });

  it('蒼き王道 ドギラゴン超: 攻撃した多色クリーチャーよりコストが小さいクリーチャーをマナゾーンから出す', () => {
    let s = setup([
      { p: 0, cid: 'dm24rp1-DM1', zone: 'battle', face: 1 },
      { p: 0, cid: DV, zone: 'mana' },
      { p: 0, cid: 'dm25rp1-DM1', zone: 'mana' },
    ]);
    const dogi = find(s, 0, 'battle', 'dm24rp1-DM1')!;
    s = act(s, 0, { t: 'attack', attacker: dogi, player: 1 });
    // コスト6のドギラゴン超より小さいコスト4のドラゴンを出す (コスト6は出せない)
    expect(find(s, 0, 'battle', DV)).toBeDefined();
    expect(find(s, 0, 'mana', 'dm25rp1-DM1')).toBeDefined();
  });

  it('無量大龍 トゥリナーツァッチ: 相手は自身のターンのはじめに、クリーチャーを1体しかアンタップできない', () => {
    let s = setup([
      { p: 0, cid: 'dmrp16-s08', zone: 'battle' },
      { p: 1, cid: V, zone: 'battle', tapped: true },
      { p: 1, cid: DV, zone: 'battle', tapped: true },
      { p: 1, cid: FV, zone: 'battle', tapped: true },
    ]);
    s = act(s, 0, { t: 'endTurn' });
    const untapped = s.players[1].battle.filter((i) => !s.cards[i].tapped).map((i) => s.cards[i].cid);
    expect(untapped).toEqual([DV]);
    // (誘発型能力として「処理できない効果」にならない)
    expect(L('dmrp16-s08')!.faces[0].triggers!.some((t) => t.events.includes('turnStartOpp'))).toBe(false);
  });

  it('無量大龍 トゥリナーツァッチ: バトルゾーンと墓地に自分のクリーチャーがそれぞれ13体以上あれば勝つ', () => {
    const many = (zone: Zone, n: number) => Array.from({ length: n }, () => ({ p: 0, cid: V, zone }));
    let s = setup([{ p: 0, cid: 'dmrp16-s08', zone: 'battle' }, ...many('battle', 12), ...many('grave', 12)]);
    const tz = find(s, 0, 'battle', 'dmrp16-s08')!;
    const t = L('dmrp16-s08')!.faces[0].triggers!.findIndex((x) => x.events.includes('turnEndOwn'));
    run(s, tz, t);
    s = drive(s);
    expect(s.phase).not.toBe('over');
    const g = s.players[0].deck.find((i) => s.cards[i].cid === V)!;
    s.players[0].deck.splice(s.players[0].deck.indexOf(g), 1);
    s.cards[g].zone = 'grave';
    s.players[0].grave.push(g);
    run(s, tz, t);
    s = drive(s);
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([0]);
  });

  it('王闘竜皇 ボルシャック・ドラゴン: バトルに勝った時、このクリーチャー以下のパワーの火のクリーチャーをマナゾーンから出す', () => {
    let s = setup([
      { p: 0, cid: 'dm25rp1-DM1', zone: 'battle' },
      { p: 0, cid: FV, zone: 'mana' },
      { p: 0, cid: BIG, zone: 'mana' },
      { p: 0, cid: V, zone: 'mana' },
    ]);
    const t = L('dm25rp1-DM1')!.faces[0].triggers!.findIndex((x) => x.events.includes('winBattle'));
    run(s, find(s, 0, 'battle', 'dm25rp1-DM1')!, t);
    s = drive(s);
    // パワー6000以下の火のクリーチャーだけ出せる (25000 と水は出せない)
    expect(find(s, 0, 'battle', FV)).toBeDefined();
    expect(find(s, 0, 'mana', BIG)).toBeDefined();
    expect(find(s, 0, 'mana', V)).toBeDefined();
  });

  it('決闘者・チャージャー: 山札の上から3枚のうち《ボルシャック》と名前にあるカードを手札に加え、残りを山札の下に置く', () => {
    let s = setup([{ p: 0, cid: 'dmex04-027', zone: 'hand' }], [{ p: 0, cids: [V, 'dm25rp1-DM1', FV] }]);
    const spell = find(s, 0, 'hand', 'dmex04-027')!;
    const f = L('dmex04-027')!.faces[1];
    expect(f.isSpell).toBe(true);
    s = applyAction(s, 0, { t: 'play', iid: spell, face: 1, pay: [], free: true, force: true }, L).state;
    s = drive(s);
    expect(find(s, 0, 'hand', 'dm25rp1-DM1')).toBeDefined();
    const bottom = s.players[0].deck.slice(0, 2).map((i) => s.cards[i].cid).sort();
    expect(bottom).toEqual([FV, V].sort());
  });

  it('帝哲人＜声出していけヨ！＞: バトルに勝った時、負けたクリーチャーのコストと同じ枚数まで山札の上からマナゾーンに置く', () => {
    let s = setup([
      { p: 0, cid: 'dm26ex3-071', zone: 'battle', face: 1 },
      { p: 1, cid: DV, zone: 'battle', tapped: true },
    ]);
    const tei = find(s, 0, 'battle', 'dm26ex3-071')!;
    const opp = find(s, 1, 'battle', DV)!;
    const mana = s.players[0].mana.length;
    // 実際のバトル: 帝哲人 (8000) が 紅神龍メルガルス (コスト4・4000) に勝つ
    s = act(s, 0, { t: 'attack', attacker: tei, player: 1, card: opp });
    expect(find(s, 1, 'grave', DV)).toBeDefined();
    expect(s.players[0].mana.length).toBe(mana + 4);
  });
});
