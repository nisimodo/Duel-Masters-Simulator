// 名前に「ミノガミ」が入っているカードの能力を実際のカードで確かめる (ツインパクトは呪文側も)
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { abilityPick, applyAction, attackTargets, createGame, lose, manaCivs, moveCard } from './engine';
import type { Action, GameState } from './types';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards as { n: string; f: { n: string }[] }[];
const picked = raw.filter((c) => c.n.includes('ミノガミ'));
const cr = (id: string, civ: string, co: number, p: string, races: string[] = ['テスト']) => ({ id, n: id, img: '', f: [{ n: id, t: 'クリーチャー', c: civ, co, p, r: races, x: [] }] });
const twin = (id: string, civ: string, co: number, p: string, spCo: number) => ({
  id,
  n: `${id} / ${id}s`,
  img: '',
  tw: 1,
  f: [
    { n: id, t: 'クリーチャー', c: civ, co, p, r: ['テスト'], x: [] },
    { n: id + 's', t: '呪文', c: civ, co: spCo, p: null, r: [], x: ['カードを１枚引く。'] },
  ],
});
const extra = [
  cr('vanilla', 'N', 1, '1000'),
  cr('sa', 'F', 1, '3000'),
  cr('rex', 'N', 3, '3000', ['レクスターズ']),
  cr('c4', 'N', 4, '4000'),
  cr('wat', 'W', 1, '1000'),
  twin('twA', 'N', 2, '1000', 1),
  twin('twL', 'L', 2, '1000', 1),
  twin('twBig', 'N', 7, '13000', 2),
];
const db = buildDB([...extra, ...picked] as never, { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] }, []);
const L = (cid: string) => db.byId.get(cid);
const idOf = (name: string) => [...db.byId.values()].find((c) => c.faces.some((f) => f.name === name))!.id;
const spellFace = (cid: string) => L(cid)!.faces.findIndex((f) => f.isSpell);

type Z = 'hand' | 'battle' | 'mana' | 'grave' | 'shield' | 'deckTop';
/** zones のカードを置いた対戦を作る (deckTop は後に書いたものほど上) */
function setup(zones: { p: number; cid: string; zone: Z }[], mana = 5): GameState {
  let s = createGame(
    {
      mode: 'duema',
      seed: 1,
      createdAt: 0,
      players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: [...Array(30).fill('vanilla'), ...zones.filter((z) => z.p === p).map((z) => z.cid)], hyper: [], gr: [], partner: null })),
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
    s.cards[iid].sick = false;
    if (z.zone === 'deckTop') {
      s.cards[iid].zone = 'deck';
      pl.deck.push(iid);
    } else {
      s.cards[iid].zone = z.zone;
      pl[z.zone].push(iid);
    }
  }
  for (let p = 0; p < 2; p++)
    for (let i = 0; i < mana; i++) {
      // (山札の上に置いたカードはマナにしない)
      const k = s.players[p].deck.findIndex((x) => !used.has(x));
      const [iid] = s.players[p].deck.splice(k, 1);
      s.cards[iid].zone = 'mana';
      s.players[p].mana.push(iid);
    }
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}
const act = (s: GameState, p: number, a: Action) => {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return r.state;
};
const find = (s: GameState, p: number, zone: 'hand' | 'battle' | 'mana' | 'grave' | 'shield', cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);
/** 保留をすべて処理する。カードの選択は pick が返したカード (返さなければ最小限)。「〜してもよい」は使う */
function run(s: GameState, pick: (prompt: string, options: number[]) => number[] | undefined = () => undefined, yes = true) {
  for (let k = 0; k < 40 && s.pending.length; k++) {
    const pk = abilityPick(s);
    if (pk && pk.indices.length >= 2) {
      s = act(s, pk.player, { t: 'pickAbility', index: pk.indices[0], use: true });
      continue;
    }
    const top = s.pending[0];
    const a: Action =
      top.kind === 'choice'
        ? top.mode === 'yesno'
          ? { t: 'choose', yes }
          : { t: 'choose', yes: true, picks: pick(top.prompt, top.options) ?? top.options.slice(0, top.min), options: [0] }
        : top.kind === 'attackOpt'
          ? { t: 'attackOpt', iid: null }
          : top.kind === 'block'
            ? { t: 'block', blocker: null }
            : top.kind === 'breakSel'
              ? { t: 'breakSel', shields: s.players[top.target].shield.slice(0, top.count) }
              : top.kind === 'trigger'
                ? { t: 'trigger', use: false }
                : { t: 'resolve', use: true };
    s = act(s, top.player, a);
  }
  return s;
}
const endTurns = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = run(act(s, s.active, { t: 'endTurn' }));
  return s;
};

describe('虹出づる繭 ミノガミ / 帝の目覚め', () => {
  const id = () => idOf('虹出づる繭 ミノガミ');
  it('W・ブレイカー', () => {
    expect(L(id())!.faces[0].kw.breaker).toBe(2);
  });
  it('このクリーチャーを自分のマナゾーンから召喚できる', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'mana' }], 6);
    const m = find(s, 0, 'mana', id())!;
    s = run(act(s, 0, { t: 'play', iid: m, face: 0, pay: s.players[0].mana.filter((x) => x !== m).slice(0, 6) }));
    expect(s.cards[m].zone).toBe('battle');
  });
  it('自分のターンのはじめに、ツインパクトカードを1枚マナゾーンから手札に戻してもよい', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'twA', zone: 'mana' }], 2);
    const tw = find(s, 0, 'mana', 'twA')!;
    s = run(act(s, 0, { t: 'endTurn' }), (_, o) => o.filter((x) => x === tw));
    expect(s.cards[tw].zone).toBe('mana');
    s = run(act(s, 1, { t: 'endTurn' }), (_, o) => o.filter((x) => x === tw));
    expect(s.active).toBe(0);
    expect(s.cards[tw].zone).toBe('hand');
  });
  it('自分のマナゾーンにあるツインパクトカードを、すべての文明のカードとして扱う', () => {
    let s = setup([{ p: 0, cid: 'twA', zone: 'mana' }, { p: 0, cid: 'sa', zone: 'mana' }, { p: 0, cid: id(), zone: 'hand' }], 0);
    const tw = find(s, 0, 'mana', 'twA')!;
    expect(manaCivs(s, L, tw)).toEqual(['N']);
    moveCard(s, L, find(s, 0, 'hand', id())!, 'battle');
    expect([...manaCivs(s, L, tw)].sort()).toEqual(['D', 'F', 'L', 'N', 'W']);
    // ツインパクトでないマナはそのまま
    expect(manaCivs(s, L, find(s, 0, 'mana', 'sa')!)).toEqual(['F']);
  });
  it('帝の目覚め (自然): 墓地のカードをマナゾーンにタップして置き、その後ツインパクトを1枚マナゾーンから手札に戻せる', () => {
    const fi = spellFace(id());
    expect(L(id())!.faces[fi].civs).toEqual(['N']);
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: 'vanilla', zone: 'grave' }, { p: 0, cid: 'twA', zone: 'mana' }], 3);
    const g = find(s, 0, 'grave', 'vanilla')!;
    const tw = find(s, 0, 'mana', 'twA')!;
    const sp = find(s, 0, 'hand', id())!;
    s = run(act(s, 0, { t: 'play', iid: sp, face: fi, pay: s.players[0].mana.filter((x) => x !== tw).slice(0, 3) }), (_, o) => (o.includes(g) ? [g] : o.filter((x) => x === tw)));
    expect(s.cards[g].zone).toBe('mana');
    expect(s.cards[g].tapped).toBe(true);
    expect(s.cards[tw].zone).toBe('hand');
    expect(s.cards[sp].zone).toBe('grave');
  });
});

describe('始虹帝 ミノガミ', () => {
  const id = () => idOf('始虹帝 ミノガミ');
  it('マッハファイター', () => {
    expect(L(id())!.faces[0].kw.machFighter).toBe(true);
  });
  it('攻撃する時、山札の上から3枚を表向きにし、ツインパクトをマナゾーンへ、残りを山札の下へ。1枚につきパワー+5000', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'vanilla', zone: 'deckTop' }, { p: 0, cid: 'twA', zone: 'deckTop' }, { p: 0, cid: 'twBig', zone: 'deckTop' }], 2);
    const [v, a, b] = s.players[0].deck.slice(-3);
    expect(s.cards[b].cid).toBe('twBig');
    const mi = find(s, 0, 'battle', id())!;
    s = run(act(s, 0, { t: 'attack', attacker: mi, player: 1 }));
    expect(s.cards[a].zone).toBe('mana');
    expect(s.cards[b].zone).toBe('mana');
    expect(s.cards[v].zone).toBe('deck');
    expect(s.players[0].deck[0]).toBe(v);
    expect(s.cards[mi].powerMod).toBe(10000);
  });
  it('マッハファイター: 出たターンでも相手のアンタップのクリーチャーを攻撃できる (プレイヤーは攻撃できない)', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 1, cid: 'vanilla', zone: 'battle' }], 5);
    const me = find(s, 0, 'hand', id())!;
    s = run(act(s, 0, { t: 'play', iid: me, face: 0, pay: s.players[0].mana.slice(0, 5) }));
    const tg = attackTargets(s, L, me);
    expect(tg.cards).toContain(find(s, 1, 'battle', 'vanilla')!);
    expect(tg.players).toEqual([]);
  });
  it('攻撃する時: ツインパクトが1枚もなければマナゾーンに置かず、パワーも上がらない。3枚とも山札の下へ', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'sa', zone: 'deckTop' }, { p: 0, cid: 'c4', zone: 'deckTop' }, { p: 0, cid: 'rex', zone: 'deckTop' }], 2);
    const top3 = s.players[0].deck.slice(-3);
    const m0 = s.players[0].mana.length;
    const mi = find(s, 0, 'battle', id())!;
    s = run(act(s, 0, { t: 'attack', attacker: mi, player: 1 }));
    expect(s.players[0].mana.length).toBe(m0);
    expect(s.cards[mi].powerMod).toBe(0);
    expect([...s.players[0].deck.slice(0, 3)].sort()).toEqual([...top3].sort());
  });
  it('攻撃する時: 表向きにしなければ何も起こらない', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'twA', zone: 'deckTop' }], 2);
    const deck = [...s.players[0].deck];
    const mi = find(s, 0, 'battle', id())!;
    s = run(act(s, 0, { t: 'attack', attacker: mi, player: 1 }), () => undefined, false);
    expect(s.players[0].deck).toEqual(deck);
    expect(s.cards[mi].powerMod).toBe(0);
  });
  it('攻撃する時: 上がったパワーはこのターンだけ', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'twA', zone: 'deckTop' }], 2);
    const mi = find(s, 0, 'battle', id())!;
    s = run(act(s, 0, { t: 'attack', attacker: mi, player: 1 }));
    expect(s.cards[mi].powerMod).toBe(5000);
    s = endTurns(s, 1);
    expect(s.cards[mi].powerMod).toBe(0);
  });
  it('無敵虹帝: 負ける時、かわりにマナゾーンのカードを8枚山札の下に置く', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }], 8);
    const d0 = s.players[0].deck.length;
    lose(s, 0, 'テスト');
    s = run(s);
    expect(s.players[0].lost).toBeFalsy();
    expect(s.players[0].mana.length).toBe(0);
    expect(s.players[0].deck.length).toBe(d0 + 8);
  });
  it('無敵虹帝: ダイレクトアタックされても、相手が「ゲームに勝つ」効果を使っても、かわりにマナを山札の下へ。8枚ないと負ける', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 1, cid: 'sa', zone: 'battle' }], 8);
    for (const sh of s.players[0].shield.splice(0)) {
      s.cards[sh].zone = 'grave';
      s.players[0].grave.push(sh);
    }
    s.active = 1;
    s = run(act(s, 1, { t: 'attack', attacker: find(s, 1, 'battle', 'sa')!, player: 0 }));
    expect(s.players[0].lost).toBeFalsy();
    expect(s.players[0].mana.length).toBe(0);
    // マナがないので、もう一度ダイレクトアタックされたら負ける
    s.cards[find(s, 1, 'battle', 'sa')!].tapped = false;
    s = run(act(s, 1, { t: 'attack', attacker: find(s, 1, 'battle', 'sa')!, player: 0 }));
    expect(s.players[0].lost).toBe(true);
  });
  it('無敵虹帝: バトルゾーンにいなければ使えない', () => {
    const s = setup([{ p: 0, cid: id(), zone: 'hand' }], 8);
    lose(s, 0, 'テスト');
    expect(s.players[0].lost).toBe(true);
  });
});

describe('全虹帝 ミノガミ / ハザード・パクト', () => {
  const id = () => idOf('全虹帝 ミノガミ');
  it('マッハファイター', () => {
    expect(L(id())!.faces[0].kw.machFighter).toBe(true);
  });
  it('出た時、ツインパクトカードを1枚、自分の墓地からマナゾーンに置く', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: 'twA', zone: 'grave' }, { p: 0, cid: 'vanilla', zone: 'grave' }], 5);
    const tw = find(s, 0, 'grave', 'twA')!;
    const v = find(s, 0, 'grave', 'vanilla')!;
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id())!, face: 0, pay: s.players[0].mana.slice(0, 5) }));
    expect(s.cards[tw].zone).toBe('mana');
    expect(s.cards[v].zone).toBe('grave');
  });
  it('攻撃する時、マナゾーンのツインパクトの枚数よりコストの小さいクリーチャーを1体マナゾーンから出せる', () => {
    // マナゾーンのツインパクトは4枚 → コスト3以下 (rex) は出せるが、コスト4 (c4) は出せない
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'c4', zone: 'mana' }, { p: 0, cid: 'rex', zone: 'mana' }, { p: 0, cid: 'twA', zone: 'mana' }, { p: 0, cid: 'twL', zone: 'mana' }, { p: 0, cid: 'twBig', zone: 'mana' }, { p: 0, cid: id(), zone: 'mana' }], 0);
    const c4 = find(s, 0, 'mana', 'c4')!;
    const rex = find(s, 0, 'mana', 'rex')!;
    let seen: number[] = [];
    s = run(act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', id())!, player: 1 }), (_, o) => {
      if (!o.includes(rex)) return undefined;
      seen = o;
      return [rex];
    });
    expect(seen).not.toContain(c4);
    expect(s.cards[rex].zone).toBe('battle');
    expect(s.cards[c4].zone).toBe('mana');
  });
  it('ハザード・パクト (自然): 山札の上をマナゾーンに置き、ツインパクトならカードを1枚引く', () => {
    const fi = spellFace(id());
    expect(L(id())!.faces[fi].civs).toEqual(['N']);
    const go = (top: string) => {
      let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: top, zone: 'deckTop' }], 3);
      const t = s.players[0].deck.at(-1)!;
      const h0 = s.players[0].hand.length;
      s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id())!, face: fi, pay: s.players[0].mana.slice(0, 3) }));
      expect(s.cards[t].zone).toBe('mana');
      return s.players[0].hand.length - (h0 - 1);
    };
    expect(go('twA')).toBe(1);
    expect(go('vanilla')).toBe(0);
  });
});

describe('ミノガミ ＜サガ.Star＞', () => {
  const id = () => idOf('ミノガミ ＜サガ.Star＞');
  it('W・ブレイカー・G・ストライク・スター進化', () => {
    const f = L(id())!.faces[0];
    expect(f.kw.breaker).toBe(2);
    expect(f.kw.gStrike).toBe(true);
    expect(f.isEvolution).toBe(true);
  });
  it('「G・ストライク」で相手に見せた時、山札の上が進化ではないレクスターズなら出し、その上に置く', () => {
    const go = (top: string) => {
      let s = setup([{ p: 1, cid: 'sa', zone: 'battle' }, { p: 0, cid: id(), zone: 'shield' }, { p: 0, cid: top, zone: 'deckTop' }], 0);
      const st = find(s, 0, 'shield', id())!;
      const t = s.players[0].deck.at(-1)!;
      // シールドはサガ.Star の1つだけ
      for (const sh of s.players[0].shield.filter((x) => x !== st)) {
        s.players[0].shield.splice(s.players[0].shield.indexOf(sh), 1);
        s.cards[sh].zone = 'grave';
        s.players[0].grave.push(sh);
      }
      s.active = 1;
      const atk = find(s, 1, 'battle', 'sa')!;
      s = act(s, 1, { t: 'attack', attacker: atk, player: 0 });
      for (let k = 0; k < 10 && s.pending[0]?.kind !== 'trigger'; k++) {
        const top = s.pending[0];
        s = act(s, top.player, top.kind === 'breakSel' ? { t: 'breakSel', shields: [st] } : top.kind === 'block' ? { t: 'block', blocker: null } : top.kind === 'attackOpt' ? { t: 'attackOpt', iid: null } : { t: 'resolve', use: true });
      }
      expect(s.pending[0]?.kind).toBe('trigger');
      s = act(s, 0, { t: 'trigger', use: true, target: atk });
      s = run(s);
      expect(s.cards[atk].noAttack).toBe(true);
      return { st: s.cards[st], t: s.cards[t], stIid: st };
    };
    const ok = go('rex');
    expect(ok.st.zone).toBe('battle');
    expect(ok.t.zone).toBe('under');
    expect(ok.t.parent).toBe(ok.stIid);
    // レクスターズでなければ出さず、サガ.Star は手札に残る
    const ng = go('vanilla');
    expect(ng.st.zone).toBe('hand');
    expect(ng.t.zone).toBe('deck');
  });
  it('出た時、相手のクリーチャーとバトルし、勝ったらカードを1枚引ける', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: 'rex', zone: 'battle' }, { p: 1, cid: 'sa', zone: 'battle' }, { p: 0, cid: 'wat', zone: 'mana' }], 4);
    const opp = find(s, 1, 'battle', 'sa')!;
    const me = find(s, 0, 'hand', id())!;
    const h0 = s.players[0].hand.length;
    s = run(act(s, 0, { t: 'play', iid: me, face: 0, pay: s.players[0].mana.slice(0, 5), evo: [find(s, 0, 'battle', 'rex')!] }), (_, o) => (o.includes(opp) ? [opp] : undefined));
    expect(s.cards[me].zone).toBe('battle');
    expect(s.cards[opp].zone).toBe('grave');
    expect(s.players[0].hand.length).toBe(h0 - 1 + 1);
  });
});

describe('始全虹帝 ミノガミ / 自然の肯定', () => {
  const id = () => idOf('始全虹帝 ミノガミ');
  it('マッハファイター・W・ブレイカー', () => {
    const f = L(id())!.faces[0];
    expect(f.kw.machFighter).toBe(true);
    expect(f.kw.breaker).toBe(2);
  });
  it('出た時、自分のマナゾーンにあるツインパクトカードをすべてアンタップする', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: 'twA', zone: 'mana' }, { p: 0, cid: 'twL', zone: 'mana' }], 6);
    const tws = s.players[0].mana.filter((m) => L(s.cards[m].cid)?.twin);
    expect(tws.length).toBe(2);
    const pay = [...tws, ...s.players[0].mana.filter((m) => !tws.includes(m)).slice(0, 4)];
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id())!, face: 0, pay }));
    for (const m of tws) expect(s.cards[m].tapped).toBe(false);
    expect(s.players[0].mana.filter((m) => s.cards[m].tapped).length).toBe(4);
  });
  it('自然の肯定 (自然): 墓地のツインパクトをすべてマナゾーンに置き、マナの枚数以下のコストのクリーチャーをマナゾーンから出せる', () => {
    const fi = spellFace(id());
    expect(L(id())!.faces[fi].civs).toEqual(['N']);
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }, { p: 0, cid: 'twA', zone: 'grave' }, { p: 0, cid: 'twL', zone: 'grave' }, { p: 0, cid: 'vanilla', zone: 'grave' }, { p: 0, cid: 'twBig', zone: 'mana' }], 7);
    const a = find(s, 0, 'grave', 'twA')!;
    const l = find(s, 0, 'grave', 'twL')!;
    const v = find(s, 0, 'grave', 'vanilla')!;
    const big = find(s, 0, 'mana', 'twBig')!;
    // マナは 8 + 2 = 10 枚 → コスト7の twBig を出せる
    let seen: number[] = [];
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id())!, face: fi, pay: [...s.players[0].mana] }), (_, o) => {
      if (!o.includes(big)) return undefined;
      seen = o;
      return [big];
    });
    expect(s.cards[a].zone).toBe('mana');
    expect(s.cards[l].zone).toBe('mana');
    expect(s.cards[v].zone).toBe('grave');
    expect(seen).toContain(big);
    expect(s.cards[big].zone).toBe('battle');
  });
});

describe('大虹帝 ミノガミ / 「ミノマルちゃん！わたしがついてるわ！」', () => {
  const id = () => idOf('大虹帝 ミノガミ');
  it('G-NEO進化・T・ブレイカー', () => {
    const f = L(id())!.faces[0];
    expect(f.kw.breaker).toBe(3);
    expect(f.type).toMatch(/G-NEO/);
  });
  it('攻撃する時、自分のツインパクト・クリーチャーの呪文側を、バトルゾーンに置いたまま唱えられる', () => {
    let s = setup([{ p: 0, cid: id(), zone: 'battle' }, { p: 0, cid: 'twA', zone: 'battle' }], 0);
    const tw = find(s, 0, 'battle', 'twA')!;
    const h0 = s.players[0].hand.length;
    s = run(act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', id())!, player: 1 }), (_, o) => (o.includes(tw) ? [tw] : undefined));
    expect(s.cards[tw].zone).toBe('battle');
    expect(s.players[0].hand.length).toBe(h0 + 1);
  });
  it('自分のターンのはじめに、パワー12000以上のクリーチャーがあれば墓地から手札に戻せる', () => {
    const go = (other: string) => {
      let s = setup([{ p: 0, cid: id(), zone: 'grave' }, { p: 0, cid: other, zone: 'battle' }], 0);
      const me = find(s, 0, 'grave', id())!;
      s = endTurns(s, 2);
      expect(s.active).toBe(0);
      return s.cards[me].zone;
    };
    expect(go('twBig')).toBe('hand');
    expect(go('twA')).toBe('grave');
  });
  it('「ミノマルちゃん！わたしがついてるわ！」(自然): 山札の上から1枚をマナゾーンに置く', () => {
    const fi = spellFace(id());
    expect(L(id())!.faces[fi].civs).toEqual(['N']);
    let s = setup([{ p: 0, cid: id(), zone: 'hand' }], 2);
    const top = s.players[0].deck.at(-1)!;
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id())!, face: fi, pay: s.players[0].mana.slice(0, 2) }));
    expect(s.cards[top].zone).toBe('mana');
  });
});

describe('ミノガミ&オウ禍武斗 / T.２.D.', () => {
  it('マッハファイター・T・ブレイカー (出た時の能力と T.２.D. の詳しいテストは rulings.test.ts)', () => {
    const f = L(idOf('ミノガミ&オウ禍武斗'))!.faces[0];
    expect(f.kw.machFighter).toBe(true);
    expect(f.kw.breaker).toBe(3);
  });
  it('出た時、各プレイヤーのマナゾーンからツインパクト呪文を1枚ずつ唱え、その後エレメント側を出す', () => {
    const id = idOf('ミノガミ&オウ禍武斗');
    let s = setup([{ p: 0, cid: id, zone: 'hand' }, { p: 0, cid: 'twA', zone: 'mana' }, { p: 1, cid: 'twL', zone: 'mana' }], 9);
    const a = find(s, 0, 'mana', 'twA')!;
    const l = find(s, 1, 'mana', 'twL')!;
    const h0 = s.players[0].hand.length;
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id)!, face: 0, pay: s.players[0].mana.filter((m) => m !== a).slice(0, 9) }), (_, o) => o.filter((x) => x === a || x === l));
    // どちらの呪文 (カードを1枚引く) も自分が唱え、その後それぞれの持ち主のバトルゾーンにエレメント側が出る
    expect(s.players[0].hand.length).toBe(h0 - 1 + 2);
    expect(s.cards[a].zone).toBe('battle');
    expect(s.cards[l].zone).toBe('battle');
    expect(s.players[1].battle).toContain(l);
  });
  it('T.２.D. (自然): 山札の上2枚のツインパクトは手札かマナゾーンへ、残りは山札の下へ', () => {
    const id = idOf('ミノガミ&オウ禍武斗');
    const fi = spellFace(id);
    expect(L(id)!.faces[fi].civs).toEqual(['N']);
    let s = setup([{ p: 0, cid: id, zone: 'hand' }, { p: 0, cid: 'vanilla', zone: 'deckTop' }, { p: 0, cid: 'twA', zone: 'deckTop' }], 4);
    const [v, tw] = s.players[0].deck.slice(-2);
    s = run(act(s, 0, { t: 'play', iid: find(s, 0, 'hand', id)!, face: fi, pay: s.players[0].mana.slice(0, 4) }), (_, o) => (o.includes(tw) ? [tw] : undefined));
    expect(s.cards[tw].zone).toBe('hand');
    expect(s.players[0].deck[0]).toBe(v);
  });
});
