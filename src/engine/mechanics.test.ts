// 名前のある能力 (B・A・D・マナ爆誕・エターナル・Ω・ガードマン 等) のテスト
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, breakCount, createGame, kwOf, power } from './engine';
import { programOf } from './interp';
import { spellEffectLines } from '../lib/triggers';
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
    { id: 'gear', n: 'gear', img: '', f: [{ n: 'gear', t: 'クロスギア', c: 'F', co: 2, p: null, r: [], x: ['クロスギア', 'これをクロスしたクリーチャーのパワーは+3000される。'] }] },
    {
      id: 'psy',
      n: 'psy',
      img: '',
      f: [
        { n: 'psy', t: 'サイキック・クリーチャー', c: 'F', co: 5, p: '5000', r: ['テスト'], x: ['覚醒-自分のターンのはじめに、このクリーチャーをコストの大きいほうに裏返す。'] },
        { n: 'psy覚醒', t: 'サイキック・クリーチャー', c: 'F', co: 10, p: '15000', r: ['テスト'], x: ['解除(このクリーチャーがバトルゾーンを離れる時、バトルゾーンを離れるかわりに、コストの小さいほうに裏返す)'] },
      ],
    },
    { id: 'godA', n: 'godA', img: '', f: [{ n: '神A', t: 'クリーチャー', c: 'F', co: 3, p: '3000', r: ['ゴッド'], x: ['G・リンク《神B》の左横'] }] },
    { id: 'godB', n: 'godB', img: '', f: [{ n: '神B', t: 'クリーチャー', c: 'F', co: 3, p: '4000', r: ['ゴッド'], x: ['G・リンク《神A》の右横', 'W・ブレイカー'] }] },
    {
      id: 'dh',
      n: 'dh',
      img: '',
      f: [
        { n: 'dh', t: 'ドラグハート・ウエポン', c: 'F', co: 2, p: null, r: [], x: ['龍解:自分のターンの終わりに、これを装備したクリーチャーがタップされていれば、このドラグハートをクリーチャー側に裏返し、アンタップする。'] },
        { n: 'dh龍', t: 'ドラグハート・クリーチャー', c: 'F', co: 7, p: '9000', r: ['テスト'], x: [] },
      ],
    },
    cr('galaxy', 8, 8000, ['ギャラクシールド [ll03](このカードを使うコストの代わりに、 [ll03]を支払ってもよい。そうしたら、このカードを表向きにし、新しいシールドとしてシールドゾーンに置く)', '自分のターンのはじめに、このクリーチャーが表向きで自分のシールドゾーンにあれば、コストを支払ったものとして召喚する。']),
    cr('fushigi', 9, 9000, ['フシギバース [nn09](自分のクリーチャーを1体タップしてマナゾーンに置き、[nn09]からそのクリーチャーのコストを引いた数のコストを支払って、このクリーチャーを自分の墓地から召喚してもよい)']),
    cr('big', 6, 6000, []),
    { id: 'ex1', n: 'ex1', img: '', f: [{ n: '暴剣王A', t: 'エグザイル・クリーチャー', c: 'F', co: 1, p: '1000', r: [], x: ['自分の他の、名前に《暴剣》とあるエグザイル・クリーチャーをバトルゾーンに出すことはできない。'] }] },
    { id: 'ex2', n: 'ex2', img: '', f: [{ n: '暴剣王B', t: 'エグザイル・クリーチャー', c: 'F', co: 1, p: '1000', r: [], x: ['自分の他の、名前に《暴剣》とあるエグザイル・クリーチャーをバトルゾーンに出すことはできない。'] }] },
    { id: 'chance', n: 'chance', img: '', f: [{ n: 'chance', t: '呪文', c: 'F', co: 9, p: null, r: [], x: ['アタック・チャンス-テスト(自分のテストが攻撃する時、この呪文をコストを支払わずに唱えてもよい)', 'カードを2枚引く。'] }] },
    cr('space', 1, 1000, ['スペース・チャージ:火(自分のマナゾーンに火のカードが置かれた時、このクリーチャーの q 能力を使ってもよい)', 'q カードを1枚引く。']),
    cr('ddd', 6, 6000, ['D・D・D [ff02](自分のクリーチャーが攻撃する時、このカードを [ff02]支払って自分の手札から実行してもよい)']),
    cr('must', 1, 2000, ['スピードアタッカー', 'このクリーチャーは、可能であれば毎ターン攻撃する。']),
    cr('lure', 1, 1000, ['相手のクリーチャーは、可能ならこのクリーチャーを攻撃する。']),
    { id: 'jc', n: 'jc', img: '', f: [{ n: 'jc', t: 'クリーチャー', c: 'F', co: 2, p: '2000', r: ['ジョーカーズ'], x: ['このクリーチャーが攻撃する時、このクリーチャーと自分のマナゾーンにあるコスト5以下のジョーカーズ1体を入れ替えてもよい。', 'スピードアタッカー'] }] },
    { id: 'jm', n: 'jm', img: '', f: [{ n: 'jm', t: 'クリーチャー', c: 'F', co: 5, p: '5000', r: ['ジョーカーズ'], x: [] }] },
    {
      id: 'cellA',
      n: 'cellA',
      img: '',
      f: [
        { n: 'セルA', t: 'サイキック・クリーチャー', c: 'F', co: 4, p: '4000', r: [], x: ['覚醒 (サイキック)リンク - 自分のターンのはじめに、バトルゾーンに自分の《セルB》があれば、そのクリーチャーとこのクリーチャーを裏返しリンクさせる。'] },
        { n: 'スーパー', t: 'サイキック・スーパー・クリーチャー', c: 'F', co: 15, p: '20000', r: [], x: ['T・ブレイカー', 'リンク解除(このクリーチャーがバトルゾーンを離れる時、そのサイキック・セルのいずれか1枚を選んで超次元ゾーンに戻し、残りのカードを裏返す)'] },
      ],
    },
    {
      id: 'cellB',
      n: 'cellB',
      img: '',
      f: [
        { n: 'セルB', t: 'サイキック・クリーチャー', c: 'F', co: 7, p: '7000', r: [], x: [] },
        { n: 'スーパー', t: 'サイキック・スーパー・クリーチャー', c: 'F', co: 15, p: '20000', r: [], x: ['T・ブレイカー'] },
      ],
    },
    cr('silent', 2, 2000, ['サイレントスキル(自分のターンのはじめに、このクリーチャーがタップされていたら、アンタップするかわりに次の能力を使ってもよい)', 'カードを2枚引く。']),
    { id: 'aura', n: 'aura', img: '', f: [{ n: 'aura', t: 'オレガ・オーラ', c: 'F', co: 2, p: '+6000', r: [], x: ['これを付けたクリーチャーのパワーを+6000する。', 'これを付けたクリーチャーに「パワード・ブレイカー」を与える。'] }] },
    { id: 'grc', n: 'grc', img: '', f: [{ n: 'grc', t: 'GRクリーチャー', c: 'F', co: 2, p: '2000', r: [], x: [] }] },
    cr('marshal', 3, 3000, ['マーシャル・タッチ(このクリーチャーをバトルゾーンに出した時、自分の他のクリーチャーを1体、バトルゾーンから手札に戻してもよい。そうした場合、このクリーチャーの能力を使う)', 'カードを2枚引く。']),
    cr('meta', 3, 3000, ['メタモーフ(自分のマナゾーンに7枚以上カードがあれば、このクリーチャーは次の能力を得る)', 'W・ブレイカー']),
    { id: 'cyc', n: 'cyc', img: '', f: [{ n: 'cyc', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['サイクロン(このターン、この呪文を唱える直前にクリーチャーを召喚していれば、この呪文を唱えた後、墓地に置くかわりに自分の手札に戻す)', 'カードを1枚引く。'] }] },
    { id: 'baku2', n: 'baku2', img: '', f: [{ n: 'baku2', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['次のうちいずれかひとつを選ぶ。', '▶カードを1枚引く。', '▶カードを2枚引く。', '爆進ダブル(バトルゾーンに自分の進化クリーチャーがあれば、この効果を両方とも選んでもよい)'] }] },
    cr('ek', 3, 3000, ['エターナル・Κ(このクリーチャーが離れる時、かわりに自分のマナゾーンにある裏向きのカードを3枚、表向きにしてもよい)']),
    cr('crystal', 6, 6000, ['水晶ソウル3(このクリーチャーを召喚する時、自分のマナゾーンにある裏向きのカードのマナの数字は3になる)']),
    cr('downer', 1, 1000, ['このクリーチャーが出た時、自分のマナゾーンのカードを1枚、裏向きにしてもよい。']),
    cr('repl', 3, 3000, ['このクリーチャーが破壊される時、墓地に置くかわりに自分の他のクリーチャーを1体破壊してもよい。']),
    cr('sgo', 3, 3000, ['シールド・ゴー(このクリーチャーが破壊された時、新しいシールドとして自分のシールドゾーンに表向きのまま加える。このクリーチャーが表向きで、シールドゾーンを離れる時、かわりに自分の墓地に置く)']),
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

  it('クロスギア: crosses onto a creature and stays when the creature leaves', () => {
    let s = setup([
      { p: 0, cid: 'gear', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const g = find(s, 0, 'battle', 'gear')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'cross', iid: g, onto: v, pay: freeMana(s, 0, 2) });
    expect(s.cards[g].parent).toBe(v);
    expect(power(s, L, v)).toBe(4000);
    s = act(s, 0, { t: 'move', iid: v, to: 'grave' });
    expect(s.cards[g].zone).toBe('battle');
  });

  it('覚醒 / 解除: flips up at turn start and flips back instead of leaving', () => {
    let s = setup([{ p: 0, cid: 'psy', zone: 'battle' }]);
    const ps = find(s, 0, 'battle', 'psy')!;
    const face = L('psy')!.faces;
    expect(face[0].triggers.length).toBe(1);
    expect(face[1].statics.some((x) => x.s === 'release')).toBe(true);
    s.cards[ps].face = 1;
    s = act(s, 0, { t: 'move', iid: ps, to: 'grave' });
    expect(s.cards[ps].zone).toBe('battle');
    expect(s.cards[ps].face).toBe(0);
  });

  it('G・リンク: links gods into one creature with summed power', () => {
    let s = setup([
      { p: 0, cid: 'godA', zone: 'battle' },
      { p: 0, cid: 'godB', zone: 'hand' },
    ]);
    const a = find(s, 0, 'battle', 'godA')!;
    const b = find(s, 0, 'hand', 'godB')!;
    s = act(s, 0, { t: 'play', iid: b, face: 0, pay: freeMana(s, 0, 3) });
    expect(s.cards[b].linkedTo).toBe(a);
    expect(power(s, L, a)).toBe(7000);
    expect(kwOf(s, L, a).breaker).toBe(2);
    s = act(s, 0, { t: 'move', iid: a, to: 'grave' });
    expect(s.cards[b].zone).toBe('battle');
  });

  it('龍解: equipped dragheart flips to a creature at end of turn if the holder is tapped', () => {
    let s = setup([
      { p: 0, cid: 'dh', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle', tapped: true },
    ]);
    const d = find(s, 0, 'battle', 'dh')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'stack', iid: d, onto: v });
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 5 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.cards[d].zone).toBe('battle');
    expect(s.cards[d].face).toBe(1);
  });

  it('ギャラクシールド: becomes a face-up shield and is summoned at turn start', () => {
    let s = setup([{ p: 0, cid: 'galaxy', zone: 'hand' }]);
    const g = find(s, 0, 'hand', 'galaxy')!;
    s = act(s, 0, { t: 'play', iid: g, face: 0, pay: freeMana(s, 0, 3), alt: 'galaxy' });
    expect(s.cards[g].zone).toBe('shield');
    expect(s.cards[g].faceUp).toBe(true);
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 8 && s.cards[g].zone !== 'battle'; k++) {
      const top = s.pending[0];
      if (top) s = act(s, top.player, { t: 'resolve', use: true });
      else s = act(s, s.active, { t: 'endTurn' });
    }
    expect(s.cards[g].zone).toBe('battle');
  });

  it('フシギバース: puts a creature into mana and summons from the graveyard', () => {
    let s = setup([
      { p: 0, cid: 'fushigi', zone: 'hand' },
      { p: 0, cid: 'big', zone: 'battle' },
    ]);
    const f = find(s, 0, 'hand', 'fushigi')!;
    const b = find(s, 0, 'battle', 'big')!;
    s = act(s, 0, { t: 'move', iid: f, to: 'grave' });
    s = act(s, 0, { t: 'play', iid: f, face: 0, pay: freeMana(s, 0, 3), alt: 'fushigi', taps: [b] });
    expect(s.cards[f].zone).toBe('battle');
    expect(s.cards[b].zone).toBe('mana');
  });

  it('エグザイル: cannot have two exiles sharing the name', () => {
    const s = setup([
      { p: 0, cid: 'ex1', zone: 'battle' },
      { p: 0, cid: 'ex2', zone: 'hand' },
    ]);
    expect(applyAction(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'ex2')!, face: 0, pay: freeMana(s, 0, 1) }, L).error).toMatch(/エグザイル/);
  });

  it('アタック・チャンス: offers to cast the spell for free when attacking', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 0, cid: 'chance', zone: 'hand' },
    ]);
    const ch = find(s, 0, 'hand', 'chance')!;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    for (let k = 0; k < 6 && s.cards[ch].zone === 'hand' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[ch].zone).toBe('grave');
  });

  it('スペース・チャージ: uses the q ability when a matching card goes to mana', () => {
    let s = setup([
      { p: 0, cid: 'space', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'hand' },
    ]);
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'charge', iid: find(s, 0, 'hand', 'vanilla')! });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.players[0].hand.length).toBe(hand);
  });

  it('D・D・D: can be used from hand by paying its cost when a creature attacks', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 0, cid: 'ddd', zone: 'hand' },
    ]);
    const d = find(s, 0, 'hand', 'ddd')!;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    for (let k = 0; k < 6 && s.cards[d].zone === 'hand' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[d].zone).toBe('battle');
    expect(s.players[0].mana.filter((m) => s.cards[m].tapped).length).toBe(2);
  });

  it('可能なら攻撃する / 可能ならこのクリーチャーを攻撃する', () => {
    const s = setup([
      { p: 0, cid: 'must', zone: 'battle' },
      { p: 1, cid: 'lure', zone: 'battle', tapped: true },
    ]);
    const m = find(s, 0, 'battle', 'must')!;
    expect(applyAction(s, 0, { t: 'endTurn' }, L).error).toMatch(/攻撃しなければ/);
    expect(applyAction(s, 0, { t: 'attack', attacker: m, player: 1 }, L).error).toMatch(/攻撃しなければ/);
    expect(applyAction(s, 0, { t: 'attack', attacker: m, player: 1, card: find(s, 1, 'battle', 'lure')! }, L).error).toBeNull();
  });

  it('Jチェンジ: swaps with a joker in the mana zone', () => {
    let s = setup([
      { p: 0, cid: 'jc', zone: 'battle' },
      { p: 0, cid: 'jm', zone: 'mana' },
    ]);
    const jc = find(s, 0, 'battle', 'jc')!;
    const jm = find(s, 0, 'mana', 'jm')!;
    s = act(s, 0, { t: 'attack', attacker: jc, player: 1 });
    for (let k = 0; k < 8 && s.cards[jm].zone !== 'battle' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [jm] }) : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[jm].zone).toBe('battle');
    expect(s.cards[jc].zone).toBe('mana');
  });

  it('覚醒リンク / リンク解除', () => {
    let s = setup([
      { p: 0, cid: 'cellA', zone: 'battle' },
      { p: 0, cid: 'cellB', zone: 'battle' },
    ]);
    const a = find(s, 0, 'battle', 'cellA')!;
    const b = find(s, 0, 'battle', 'cellB')!;
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 10 && s.cards[a].face === 0; k++) {
      const top = s.pending[0];
      if (top) s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
      else s = act(s, s.active, { t: 'endTurn' });
    }
    expect(s.cards[a].face).toBe(1);
    expect(s.cards[b].cellOf).toBe(a);
    expect(power(s, L, a)).toBe(20000);
    s.active = 0;
    s.pending = [];
    s = act(s, 0, { t: 'move', iid: a, to: 'grave' });
    expect(s.cards[a].zone).toBe('hyper');
    expect(s.cards[b].zone).toBe('battle');
    expect(s.cards[b].face).toBe(0);
  });

  it('サイレントスキル: stays tapped and uses the ability instead of untapping', () => {
    let s = setup([{ p: 0, cid: 'silent', zone: 'battle', tapped: true }]);
    const sl = find(s, 0, 'battle', 'silent')!;
    s = act(s, 0, { t: 'endTurn' });
    // 相手のターンを終える
    for (let k = 0; k < 6 && s.active !== 0; k++) s = act(s, s.active, s.pending.length ? { t: 'resolve', use: true } : { t: 'endTurn' });
    const hand = s.players[0].hand.length;
    const top = s.pending[0];
    expect(top?.kind).toBe('choice');
    s = act(s, 0, { t: 'choose', yes: true, picks: [], options: [0] });
    expect(s.cards[sl].tapped).toBe(true);
    expect(s.players[0].hand.length).toBeGreaterThanOrEqual(hand + 2);
  });

  it('オーラ: attaches to a GR creature and grants パワード・ブレイカー', () => {
    let s = setup([
      { p: 0, cid: 'aura', zone: 'hand' },
      { p: 0, cid: 'grc', zone: 'battle' },
    ]);
    const g = find(s, 0, 'battle', 'grc')!;
    const au = find(s, 0, 'hand', 'aura')!;
    s = act(s, 0, { t: 'play', iid: au, face: 0, pay: freeMana(s, 0, 2), evo: [g] });
    expect(s.cards[au].parent).toBe(g);
    expect(power(s, L, g)).toBe(8000);
    expect(breakCount(s, L, g)).toBe(2);
  });

  it('マーシャル・タッチ: returning another creature uses its own ability', () => {
    let s = setup([
      { p: 0, cid: 'marshal', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const v = find(s, 0, 'battle', 'vanilla')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'marshal')!, face: 0, pay: freeMana(s, 0, 3) });
    for (let k = 0; k < 8 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [v] }) : { t: 'resolve', use: true });
    }
    expect(s.cards[v].zone).toBe('hand');
    // 手札: -1 (召喚) +1 (戻した) +2 (能力)
    expect(s.players[0].hand.length).toBe(hand + 2);
  });

  it('メタモーフ: gains the ability with 7+ mana', () => {
    const few = setup([{ p: 0, cid: 'meta', zone: 'battle' }], 3);
    expect(kwOf(few, L, find(few, 0, 'battle', 'meta')!).breaker).toBe(1);
    const many = setup([{ p: 0, cid: 'meta', zone: 'battle' }], 7);
    expect(kwOf(many, L, find(many, 0, 'battle', 'meta')!).breaker).toBe(2);
  });

  it('サイクロン: returns to hand when a creature was summoned right before', () => {
    let s = setup([
      { p: 0, cid: 'vanilla', zone: 'hand' },
      { p: 0, cid: 'cyc', zone: 'hand' },
    ]);
    const cy = find(s, 0, 'hand', 'cyc')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'vanilla')!, face: 0, pay: freeMana(s, 0, 1) });
    s = act(s, 0, { t: 'play', iid: cy, face: 0, pay: freeMana(s, 0, 1) });
    expect(s.cards[cy].zone).toBe('hand');
  });

  it('爆進ダブル: both options are allowed only with an evolution creature', () => {
    const f = L('baku2')!.faces[0];
    const prog = programOf(spellEffectLines(f.text).join('。'));
    const mod = prog.ops.find((o) => o.op === 'modal');
    expect(mod && mod.op === 'modal' && mod.bonus).toBeTruthy();
  });

  it('エターナル・Κ / 水晶ソウル / 裏向きのマナ', () => {
    let s = setup([
      { p: 0, cid: 'ek', zone: 'battle' },
      { p: 0, cid: 'crystal', zone: 'hand' },
    ], 4);
    const mana = s.players[0].mana;
    for (const m of mana.slice(0, 3)) s.cards[m].manaDown = true;
    const ek = find(s, 0, 'battle', 'ek')!;
    s = act(s, 0, { t: 'move', iid: ek, to: 'grave' });
    expect(s.cards[ek].zone).toBe('battle');
    expect(mana.every((m) => !s.cards[m].manaDown)).toBe(true);
    // 水晶ソウル: 裏向き1枚(3) + 表向き3枚 = 6
    s.cards[mana[0]].manaDown = true;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'crystal')!, face: 0, pay: mana.slice(0, 4) });
    expect(find(s, 0, 'battle', 'crystal')).toBeDefined();
  });

  it('マナゾーンのカードを裏向きにする', () => {
    let s = setup([{ p: 0, cid: 'downer', zone: 'hand' }]);
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'downer')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [s.players[0].mana[1]] }) : { t: 'resolve', use: true });
    }
    expect(s.players[0].mana.filter((m) => s.cards[m].manaDown).length).toBe(1);
  });

  it('破壊される時、かわりに自分の他のクリーチャーを破壊する', () => {
    let s = setup([
      { p: 0, cid: 'repl', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const r = find(s, 0, 'battle', 'repl')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'move', iid: r, to: 'grave' });
    for (let k = 0; k < 4 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', picks: [v] } : { t: 'resolve', use: true });
    }
    expect(s.cards[r].zone).toBe('battle');
    expect(s.cards[v].zone).toBe('grave');
  });

  it('シールド・ゴー: becomes a face-up shield when destroyed, and goes to the graveyard when it leaves', () => {
    let s = setup([{ p: 0, cid: 'sgo', zone: 'battle' }]);
    const g = find(s, 0, 'battle', 'sgo')!;
    s = act(s, 0, { t: 'move', iid: g, to: 'grave' });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.cards[g].zone).toBe('shield');
    expect(s.cards[g].faceUp).toBe(true);
    s = act(s, 0, { t: 'move', iid: g, to: 'hand' });
    expect(s.cards[g].zone).toBe('grave');
  });
});
