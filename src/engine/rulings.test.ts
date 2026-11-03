// 総合ルールの変更点 (裁定) を実際のカードで確かめる
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { abilityPick, applyAction, canAttackWith, createGame, moveCard, removeSeal } from './engine';
import { abilitiesIgnored } from './statics';
import type { Action, GameState } from './types';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards as { id: string; n: string; f: { n: string }[] }[];
const NAMES = ['怒流牙 佐助の超人', '新世界王 ヴォルゼオス・バラモルド', '王の思念', 'Library of Alexandria', '13番目の計画', '切札電融 モモムゲン', '神聖龍 エモーショナル・ハードコア', 'Black Lotus', 'FORBIDDEN STAR ～世界最後の日～', 'ミノガミ&オウ禍武斗', '虹出づる繭 ミノガミ', '全虹帝 ミノガミ'];
const picked = raw.filter((c) => c.f.some((f) => NAMES.includes(f.n)) || NAMES.includes(c.n));
const vanilla = { id: 'vanilla', n: 'vanilla', img: '', f: [{ n: 'vanilla', t: 'クリーチャー', c: 'N', co: 1, p: '1000', r: ['テスト'], x: [] }] };
const sa = { id: 'sa', n: 'sa', img: '', f: [{ n: 'sa', t: 'クリーチャー', c: 'F', co: 1, p: '3000', r: ['テスト'], x: ['スピードアタッカー'] }] };
const mk = (id: string, t: string, c: string, co: number, p: string | null, x: string[]) => ({ id, n: id, img: '', f: [{ n: id, t, c, co, p, r: ['テスト'], x }] });
const extra = [
  mk('d2a', 'D2フィールド', 'F', 1, null, []),
  mk('d2b', 'D2フィールド', 'F', 1, null, []),
  mk('exAtk', 'クリーチャー', 'F', 1, '3000', ['EXライフ', 'スピードアタッカー']),
  mk('rc', 'クリーチャー', 'F', 5, '9000', ['革命チェンジ：火のクリーチャー']),
  mk('neo', 'NEOクリーチャー', 'N', 1, '5000', ['NEO進化：自分のクリーチャー１体の上に置いてもよい。']),
  mk('drawSp', '呪文', 'N', 1, null, ['カードを１枚引く。']),
  { id: 'cmdF', n: 'cmdF', img: '', f: [{ n: 'cmdF', t: 'クリーチャー', c: 'F', co: 5, p: '5000', r: ['アウトレイジ', 'コマンド'], x: [] }] },
];
const db = buildDB([vanilla, sa, ...extra, ...picked] as never, { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] }, []);
const L = (cid: string) => db.byId.get(cid);
const idOf = (name: string) => [...db.byId.values()].find((c) => c.faces.some((f) => f.name === name) || c.name === name)!.id;

function setup(zones: { p: number; cid: string; zone: 'hand' | 'battle' | 'mana' }[], mana = 5, extraMain: string[] = []): GameState {
  let s = createGame(
    {
      mode: 'duema',
      seed: 1,
      createdAt: 0,
      players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: [...Array(30).fill('vanilla'), ...zones.filter((z) => z.p === p).map((z) => z.cid)], hyper: p === 0 ? extraMain : [], gr: [], partner: null })),
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
const act = (s: GameState, p: number, a: Action) => {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return r.state;
};
const find = (s: GameState, p: number, zone: 'hand' | 'battle' | 'mana' | 'grave' | 'deck', cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);
const drain = (s: GameState, until?: (s: GameState) => boolean) => {
  for (let k = 0; k < 30 && s.pending.length && !until?.(s); k++) {
    const pk = abilityPick(s);
    if (pk && pk.indices.length >= 2) {
      s = act(s, pk.player, { t: 'pickAbility', index: pk.indices[0], use: true });
      continue;
    }
    const top = s.pending[0];
    const a: Action =
      top.kind === 'choice' ? { t: 'choose', yes: true, picks: top.options?.slice(0, top.min ?? 0) ?? [], options: [0] } : top.kind === 'attackOpt' ? { t: 'attackOpt', iid: null } : top.kind === 'block' ? { t: 'block', blocker: null } : top.kind === 'breakSel' ? { t: 'breakSel', shields: s.players[top.target].shield.slice(0, top.count) } : { t: 'resolve', use: true };
    s = act(s, top.player, a);
  }
  return s;
};

describe('総合ルールの変更点', () => {
  it('ニンジャ・ストライク: 1回の攻撃中に1枚だけ、ターンの終わりに山札の一番下に置く', () => {
    const nin = idOf('怒流牙 佐助の超人');
    let s = setup([{ p: 0, cid: 'sa', zone: 'battle' }, { p: 1, cid: nin, zone: 'hand' }, { p: 1, cid: nin, zone: 'hand' }]);
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    s = drain(s, (x) => x.pending[0]?.kind === 'block');
    const top = s.pending[0];
    expect(top?.kind === 'block' && top.ninjas.length).toBe(2);
    const n1 = top.kind === 'block' ? top.ninjas[0] : -1;
    s = act(s, 1, { t: 'block', ninja: n1 });
    s = drain(s, (x) => x.pending[0]?.kind === 'block');
    const top2 = s.pending[0];
    expect(top2?.kind === 'block' ? top2.ninjas.length : 0).toBe(0);
    s = drain(s);
    expect(s.cards[n1].zone).toBe('battle');
    s = act(s, 0, { t: 'endTurn' });
    s = drain(s);
    expect(s.cards[n1].zone).toBe('deck');
    expect(s.players[1].deck[0]).toBe(n1);
  });

  it('キング・セル: 単独では使えず、揃っていれば合体させて召喚する (812)', () => {
    const king = idOf('新世界王 ヴォルゼオス・バラモルド');
    const other = idOf('王の思念');
    const cardKing = L(king)!;
    const kf = cardKing.faces.findIndex((f) => f.type === 'キング・クリーチャー');
    let s = setup([{ p: 0, cid: king, zone: 'hand' }, { p: 0, cid: other, zone: 'hand' }], 8);
    const k = find(s, 0, 'hand', king)!;
    const o = find(s, 0, 'hand', other)!;
    expect(applyAction(s, 0, { t: 'play', iid: k, face: 0, pay: [] }, L).error).toMatch(/使えません/);
    moveCard(s, L, o, 'grave');
    const pay = s.players[0].mana.slice(0, 7);
    expect(applyAction(s, 0, { t: 'play', iid: k, face: kf, pay }, L).error).toMatch(/揃って/);
    // もう1種をマナゾーンに置いて合体
    moveCard(s, L, o, 'mana');
    s = act(s, 0, { t: 'play', iid: k, face: kf, pay: s.players[0].mana.filter((m) => m !== o).slice(0, 7) });
    s = drain(s);
    expect(s.cards[k].zone).toBe('battle');
    expect(s.cards[o].zone).toBe('under');
    expect(s.cards[k].under).toContain(o);
  });

  it('土地: 使えず、バトルゾーンに置かれたら墓地へ。手札がちょうど7枚ならタップして1枚引く (313)', () => {
    const land = idOf('Library of Alexandria');
    let s = setup([{ p: 0, cid: land, zone: 'hand' }]);
    const l = find(s, 0, 'hand', land)!;
    expect(applyAction(s, 0, { t: 'play', iid: l, face: 0, pay: [] }, L).error).toMatch(/使えません/);
    moveCard(s, L, l, 'battle');
    expect(s.cards[l].zone).toBe('grave');
    moveCard(s, L, l, 'mana');
    while (s.players[0].hand.length < 7) moveCard(s, L, s.players[0].deck.at(-1)!, 'hand');
    s = act(s, 0, { t: 'manaAbility', iid: l });
    expect(s.players[0].hand.length).toBe(8);
    expect(s.cards[l].tapped).toBe(true);
  });

  it('ルール・プラス: 超次元ゾーンに置いてゲームを始め、デッキは45枚 (314)', () => {
    const plan = L(idOf('13番目の計画'))!;
    expect(plan.zone).toBe('hyper');
  });

  it('能力を無視しあう時は、先にバトルゾーンに出ていたほうを優先する (608.5)', () => {
    const mm = idOf('切札電融 モモムゲン');
    const eh = idOf('神聖龍 エモーショナル・ハードコア');
    const s = setup([{ p: 0, cid: eh, zone: 'battle' }, { p: 1, cid: mm, zone: 'battle' }]);
    const e = find(s, 0, 'battle', eh)!;
    const m = find(s, 1, 'battle', mm)!;
    s.cards[e].chosenName = L(mm)!.faces[0].name;
    // エモーショナル・ハードコアが先
    s.cards[e].enterSeq = 1;
    s.cards[m].enterSeq = 2;
    expect(abilitiesIgnored(s, L, m)).toBe(true);
    expect(abilitiesIgnored(s, L, e)).toBe(false);
    // モモムゲンが先
    s.cards[e].enterSeq = 3;
    expect(abilitiesIgnored(s, L, m)).toBe(false);
    expect(abilitiesIgnored(s, L, e)).toBe(true);
  });
  it('別のD2フィールドが出たら、先にあったD2フィールドは墓地へ (703.4n)', () => {
    let s = setup([{ p: 0, cid: 'd2a', zone: 'battle' }, { p: 1, cid: 'd2b', zone: 'hand' }]);
    const a = find(s, 0, 'battle', 'd2a')!;
    const b = find(s, 1, 'hand', 'd2b')!;
    moveCard(s, L, b, 'battle');
    expect(s.cards[a].zone).toBe('grave');
    expect(s.cards[b].zone).toBe('battle');
  });

  it('入れ替えで攻撃中のクリーチャーが移動しなければ、入れ替えは行わない (701.26b)', () => {
    let s = setup([{ p: 0, cid: 'exAtk', zone: 'battle' }, { p: 0, cid: 'rc', zone: 'hand' }]);
    const x = find(s, 0, 'battle', 'exAtk')!;
    s.cards[x].exShield = s.players[0].shield.at(-1);
    const r = find(s, 0, 'hand', 'rc')!;
    s = act(s, 0, { t: 'attack', attacker: x, player: 1 });
    expect(s.pending[0]?.kind).toBe('attackOpt');
    s = act(s, 0, { t: 'attackOpt', iid: r });
    expect(s.cards[x].zone).toBe('battle');
    expect(s.cards[r].zone).toBe('hand');
    expect(s.attack?.attacker).toBe(x);
  });

  it('NEO進化クリーチャーは、出たターンに下のクリーチャーがなくなると召喚酔いする (802.3)', () => {
    let s = setup([{ p: 0, cid: 'vanilla', zone: 'battle' }, { p: 0, cid: 'neo', zone: 'hand' }]);
    const v = find(s, 0, 'battle', 'vanilla')!;
    const n = find(s, 0, 'hand', 'neo')!;
    s = act(s, 0, { t: 'play', iid: n, face: 0, pay: s.players[0].mana.slice(0, 1), evo: [v] });
    s = drain(s);
    expect(s.cards[v].zone).toBe('under');
    expect(canAttackWith(s, L, n)).toBe(true);
    moveCard(s, L, v, 'grave');
    expect(canAttackWith(s, L, n)).toBe(false);
  });

  it('Artifact 《Black Lotus》: 封印を付けて出て、封印は山札の下へ。なくなれば墓地に置き、次のカードのコストを3少なくする (312)', () => {
    const bl = idOf('Black Lotus');
    let s = setup([{ p: 0, cid: bl, zone: 'hand' }, { p: 0, cid: 'rc', zone: 'hand' }]);
    const b = find(s, 0, 'hand', bl)!;
    s = act(s, 0, { t: 'play', iid: b, face: 0, pay: [] });
    s = drain(s);
    expect(s.cards[b].zone).toBe('battle');
    expect(s.cards[b].under.length).toBe(3);
    for (let k = 0; k < 3; k++) {
      s = act(s, 0, { t: 'endTurn' });
      s = drain(s);
      s = act(s, 1, { t: 'endTurn' });
      s = drain(s);
    }
    expect(s.cards[b].zone).toBe('grave');
    expect(s.players[0].nextUse?.n).toBe(3);
  });

  it('切札電融 モモムゲン: 多色ではない呪文の効果を無視する', () => {
    let s = setup([{ p: 1, cid: idOf('切札電融 モモムゲン'), zone: 'battle' }, { p: 0, cid: 'drawSp', zone: 'hand' }]);
    const h = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'drawSp')!, face: 0, pay: s.players[0].mana.slice(0, 1) });
    s = drain(s);
    expect(s.players[0].hand.length).toBe(h - 1);
  });
  it('FORBIDDEN STAR → 終焉の禁断 ドルマゲドンX (最終禁断・禁断コア)', () => {
    const fs0 = idOf('FORBIDDEN STAR ～世界最後の日～');
    let s = setup([{ p: 0, cid: 'vanilla', zone: 'battle' }, { p: 0, cid: 'cmdF', zone: 'hand' }, { p: 0, cid: 'cmdF', zone: 'hand' }], 10, [fs0]);
    // デッキの40枚には含めない (デッキの外からゲーム開始時にバトルゾーンへ)
    expect(L(fs0)!.zone).toBe('hyper');
    const f = find(s, 0, 'battle', fs0)!;
    for (const m of s.players[0].mana) s.cards[m].cid = 'sa';
    expect(s.cards[f].under.length).toBe(4);
    // コマンド・イニシャルズ・《禁断》でしか攻撃できない
    expect(canAttackWith(s, L, find(s, 0, 'battle', 'vanilla')!)).toBe(false);
    // 闇または火のコスト5以上のコマンドを召喚すると、各ターン1つだけ封印を外す
    const [c1, c2] = s.players[0].hand.filter((i) => s.cards[i].cid === 'cmdF');
    s = act(s, 0, { t: 'play', iid: c1, face: 0, pay: s.players[0].mana.slice(0, 5) });
    s = drain(s, (x) => x.pending[0]?.kind === 'choice');
    // 外す封印の位置は4か所から選べる。右下を選んでも、最初の3つは3種類の能力のどれかをランダムに使う
    const q0 = s.pending[0];
    expect(q0?.kind === 'choice' && q0.mode === 'modal' && q0.labels?.length).toBe(4);
    s = act(s, 0, { t: 'choose', options: [3] });
    s = drain(s);
    expect(s.cards[f].under.length).toBe(3);
    expect(s.cards[f].corners).toEqual([0, 1, 2]);
    expect(s.cards[f].cornerFx?.length).toBe(2);
    expect(L(s.cards[f].cid)!.faces[s.cards[f].face].name).toBe('FORBIDDEN STAR ～世界最後の日～');
    s = act(s, 0, { t: 'play', iid: c2, face: 0, pay: s.players[0].mana.filter((m) => !s.cards[m].tapped).slice(0, 5) });
    s = drain(s);
    expect(s.cards[f].under.length).toBe(3);
    // 封印がすべて外れたら禁断爆発
    for (let k = 0; k < 3; k++) {
      removeSeal(s, L, f);
      s = drain(act(s, 0, { t: 'note', m: '' }));
    }
    // 3種類の能力を1回ずつ使い、最後の封印で禁断爆発
    expect(s.cards[f].cornerFx).toEqual([]);
    expect(['破壊', 'スレイヤー', 'パワーアタッカー'].every((w) => s.log.some((l) => l.m.includes('の封印を外した →') && l.m.includes(w)))).toBe(true);
    expect(L(s.cards[f].cid)!.faces[s.cards[f].face].name).toBe('終焉の禁断 ドルマゲドンX');
    expect(s.cards[f].cores).toBe(4);
    expect(s.log.some((l) => l.m.includes('の能力 (禁断爆発した時)'))).toBe(true);
    // 離れる時、かわりに禁断コアを2枚下に置き、シールドを1つ墓地に (2回まで)
    const sh = s.players[0].shield.length;
    moveCard(s, L, f, 'grave');
    s = drain(s);
    expect(s.cards[f].zone).toBe('battle');
    expect(s.players[0].shield.length).toBe(sh - 1);
    moveCard(s, L, f, 'grave');
    s = drain(s);
    expect(s.cards[f].zone).toBe('battle');
    expect(s.cards[f].cores).toBe(0);
    moveCard(s, L, f, 'grave');
    s = drain(s);
    expect(s.cards[f].zone).toBe('grave');
    expect(s.players[0].lost).toBe(true);
  });
  it('ミノガミ&オウ禍武斗: 各プレイヤーのマナのツインパクト呪文を唱え、すべて唱えた後にエレメント側を出す', () => {
    const mo = idOf('ミノガミ&オウ禍武斗');
    const twin = idOf('虹出づる繭 ミノガミ');
    let s = setup([{ p: 0, cid: mo, zone: 'hand' }, { p: 0, cid: twin, zone: 'mana' }, { p: 1, cid: twin, zone: 'mana' }], 9);
    const m = find(s, 0, 'hand', mo)!;
    const t0 = find(s, 0, 'mana', twin)!;
    const t1 = find(s, 1, 'mana', twin)!;
    s = act(s, 0, { t: 'play', iid: m, face: 0, pay: s.players[0].mana.filter((i) => i !== t0).slice(0, 9) });
    for (let k = 0; k < 30 && s.pending.length; k++) {
      const pk = abilityPick(s);
      if (pk && pk.indices.length >= 2) {
        s = act(s, pk.player, { t: 'pickAbility', index: pk.indices[0], use: true });
        continue;
      }
      const top = s.pending[0];
      // ツインパクトはそれぞれ選ぶ。帝の目覚めで手札に戻すのは選ばない
      const a: Action =
        top.kind === 'choice'
          ? top.mode === 'yesno'
            ? { t: 'choose', yes: false }
            : { t: 'choose', picks: (() => { const tw = top.options.filter((i) => (i === t0 || i === t1) && s.cards[i].zone === 'mana').slice(0, 1); return tw.length ? tw : top.options.filter((i) => i !== t0 && i !== t1).slice(0, top.min ?? 0); })() }
          : { t: 'resolve', use: true };
      s = act(s, top.player, a);
    }
    // 1枚目 (自分の) を唱えて解決し、2枚目 (相手の) を唱える。2枚目の《帝の目覚め》は、解決済みで墓地にある1枚目をマナゾーンに置く
    expect(s.cards[t0].zone).toBe('mana');
    // すべて唱えた後、相手のツインパクトは持ち主 (相手) の墓地からエレメント側が出る
    expect(s.cards[t1].zone).toBe('battle');
    expect(s.players[1].battle).toContain(t1);
    expect(L(s.cards[t1].cid)!.faces[s.cards[t1].face].name).toBe('虹出づる繭 ミノガミ');
    expect(s.log.filter((l) => l.m.includes('帝の目覚め') && l.m.includes('唱える')).length).toBe(2);
  });

  it('T.2.D.: 表向きにしたツインパクトカードを手札に加えるかマナゾーンに置く', () => {
    const mo = idOf('ミノガミ&オウ禍武斗');
    const twin = idOf('虹出づる繭 ミノガミ');
    let s = setup([{ p: 0, cid: mo, zone: 'hand' }, { p: 0, cid: twin, zone: 'hand' }, { p: 0, cid: 'vanilla', zone: 'hand' }], 4);
    const m = find(s, 0, 'hand', mo)!;
    const tw = find(s, 0, 'hand', twin)!;
    const v = s.players[0].hand.find((i) => s.cards[i].cid === 'vanilla')!;
    // 山札の上: ツインパクトとふつうのカード
    for (const i of [v, tw]) {
      s.players[0].hand.splice(s.players[0].hand.indexOf(i), 1);
      s.cards[i].zone = 'deck';
      s.players[0].deck.push(i);
    }
    const fi = L(mo)!.faces.findIndex((f) => f.isSpell);
    s = act(s, 0, { t: 'play', iid: m, face: fi, pay: s.players[0].mana.slice(0, 4) });
    for (let k = 0; k < 10 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', picks: [] } : { t: 'resolve', use: true });
    }
    // 手札に加えなかったツインパクトはマナゾーンへ、ツインパクトでないカードは山札の下へ
    expect(s.cards[tw].zone).toBe('mana');
    expect(s.cards[v].zone).toBe('deck');
    expect(s.players[0].deck[0]).toBe(v);
  });
  it('ミノガミ&オウ禍武斗: 1枚ずつ解決してから次を唱え、両方のエレメント側が出る', () => {
    const mo = idOf('ミノガミ&オウ禍武斗');
    const twin = idOf('全虹帝 ミノガミ');
    let s = setup([{ p: 0, cid: mo, zone: 'hand' }, { p: 0, cid: twin, zone: 'mana' }, { p: 1, cid: twin, zone: 'mana' }], 9);
    const t0 = find(s, 0, 'mana', twin)!;
    const t1 = find(s, 1, 'mana', twin)!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', mo)!, face: 0, pay: s.players[0].mana.filter((i) => i !== t0).slice(0, 9) });
    for (let k = 0; k < 30 && s.pending.length; k++) {
      const pk = abilityPick(s);
      if (pk && pk.indices.length >= 2) {
        s = act(s, pk.player, { t: 'pickAbility', index: pk.indices[0], use: true });
        continue;
      }
      const top = s.pending[0];
      const a: Action = top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true } : { t: 'choose', picks: top.options.filter((i) => i === t0 || i === t1).slice(0, 1).length ? top.options.filter((i) => i === t0 || i === t1).slice(0, 1) : top.options.slice(0, Math.max(1, top.min ?? 0)) }) : { t: 'resolve', use: true };
      s = act(s, top.player, a);
    }
    expect(s.cards[t0].zone).toBe('battle');
    expect(s.cards[t1].zone).toBe('battle');
    expect(s.players[0].battle).toContain(t0);
    expect(s.players[1].battle).toContain(t1);
    // 1枚目の効果 (山札の上から1枚をマナゾーンへ) が、2枚目を唱える前に解決している
    const logs = s.log.map((l) => l.m);
    const c1 = logs.findIndex((m) => m.includes('ハザード・パクト') && m.includes('唱える'));
    const c2 = logs.findIndex((m, k) => k > c1 && m.includes('ハザード・パクト') && m.includes('唱える'));
    expect(logs.slice(c1, c2).some((m) => m.includes('マナ'))).toBe(true);
  });
  it('T.2.D.: 手札に加えるほうを選んだツインパクトは手札へ、選ばなかったツインパクトはマナゾーンへ', () => {
    const mo = idOf('ミノガミ&オウ禍武斗');
    const twin = idOf('虹出づる繭 ミノガミ');
    const twin2 = idOf('全虹帝 ミノガミ');
    let s = setup([{ p: 0, cid: mo, zone: 'hand' }, { p: 0, cid: twin, zone: 'hand' }, { p: 0, cid: twin2, zone: 'hand' }], 4);
    const m = find(s, 0, 'hand', mo)!;
    const a = find(s, 0, 'hand', twin)!;
    const b = find(s, 0, 'hand', twin2)!;
    for (const i of [a, b]) {
      s.players[0].hand.splice(s.players[0].hand.indexOf(i), 1);
      s.cards[i].zone = 'deck';
      s.players[0].deck.push(i);
    }
    const fi = L(mo)!.faces.findIndex((f) => f.isSpell);
    s = act(s, 0, { t: 'play', iid: m, face: fi, pay: s.players[0].mana.slice(0, 4) });
    for (let k = 0; k < 10 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', picks: top.options.includes(a) ? [a] : [] } : { t: 'resolve', use: true });
    }
    expect(s.cards[a].zone).toBe('hand');
    expect(s.cards[b].zone).toBe('mana');
    expect(s.cards[m].zone).toBe('grave');
  });
});
