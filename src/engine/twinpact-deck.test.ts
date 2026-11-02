// ツインパクト・ミノガミデッキ (アカシック・C / チェンジザ / オウ禍武斗 等) の能力のテスト (実際のカードデータを使う)
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, breakShields, createGame, decider, moveCard, payCovers, settle as settleEngine } from './engine';
import { cpuPlan } from './cpu';
import type { GameState } from './types';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
const vanilla = { id: 'vanilla', n: 'vanilla', img: '', f: [{ n: 'vanilla', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['テスト'], x: [] }] };
const db = buildDB([...raw.cards, vanilla], JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), []);
const L = (cid: string) => db.byId.get(cid);

const ID = {
  akashic: 'dm23bd6-006',
  kondama: 'dmbd08-a-005',
  magicH: 'dm23rp2-S02',
  changeza: 'dmrp06-s05',
  reredi: 'dmbd08-a-003',
  orzekia: 'dmex04-011',
  kuromame: 'dmrp05-009',
  ouKabuto: 'dm26rp3-004',
  baraHyo: 'dmrp08-mh02',
  baraMei: 'dmrp08-mh03',
  shiZen: 'dmex19-s14',
};

type Z = 'hand' | 'battle' | 'mana' | 'grave' | 'shield';
/** 指定のカードを各ゾーンに置いた2人対戦 (player 0 のメインステップ) */
function setup(zones: { p: number; cid: string; zone: Z; tapped?: boolean }[]): GameState {
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
    s.cards[iid].zone = z.zone;
    s.cards[iid].tapped = !!z.tapped;
    s.cards[iid].sick = false;
    s.cards[iid].faceUp = z.zone !== 'shield';
    pl[z.zone].push(iid);
  }
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

/** 積まれた能力・選択を CPU の判断ですべて解決する */
function settle(s: GameState): GameState {
  settleEngine(s, L);
  for (let k = 0; k < 200 && s.pending.length; k++) {
    const p = decider(s);
    if (p == null) break;
    let moved = false;
    for (const a of cpuPlan(s, p, L)) {
      const r = applyAction(s, p, a, L);
      if (!r.error) {
        s = r.state;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return s;
}

const find = (s: GameState, p: number, zone: Z, cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);

describe('ツインパクト・ミノガミデッキ', () => {
  it('黒豆だんしゃく: 相手の「出た時」能力を持つクリーチャーが出たらマナへ (自分自身・能力なしは対象外)', () => {
    let s = setup([{ p: 0, cid: ID.kuromame, zone: 'battle' }, { p: 1, cid: ID.changeza, zone: 'hand' }, { p: 1, cid: 'vanilla', zone: 'hand' }, { p: 0, cid: ID.kuromame, zone: 'hand' }]);
    const cz = find(s, 1, 'hand', ID.changeza)!;
    const v = s.players[1].hand.find((i) => s.cards[i].cid === 'vanilla')!;
    moveCard(s, L, cz, 'battle');
    moveCard(s, L, v, 'battle');
    s = settle(s);
    expect(s.cards[cz].zone).toBe('mana');
    expect(s.cards[v].zone).toBe('battle');
    const km2 = find(s, 0, 'hand', ID.kuromame)!;
    moveCard(s, L, km2, 'battle');
    s = settle(s);
    expect(s.cards[km2].zone).toBe('battle');
  });

  it('アカシック・C: マナゾーンのツインパクトカードはすべての文明を持つ', () => {
    const s = setup([{ p: 0, cid: ID.kondama, zone: 'mana' }]);
    const m = find(s, 0, 'mana', ID.kondama)!;
    expect(payCovers(L, s, [m], ['D'])).toBe(false);
    const s2 = setup([{ p: 0, cid: ID.kondama, zone: 'mana' }, { p: 0, cid: ID.akashic, zone: 'battle' }]);
    expect(payCovers(L, s2, [find(s2, 0, 'mana', ID.kondama)!], ['D'])).toBe(true);
    // ツインパクトではないカードは変わらない
    const s3 = setup([{ p: 0, cid: 'vanilla', zone: 'mana' }, { p: 0, cid: ID.akashic, zone: 'battle' }]);
    expect(payCovers(L, s3, [s3.players[0].mana[0]], ['D'])).toBe(false);
  });

  it('龍装艦 チェンジザ: コスト5以下の呪文をはじめて捨てた時、その呪文を唱えられる (各ターン1度)', () => {
    let s = setup([{ p: 0, cid: ID.changeza, zone: 'battle' }, { p: 0, cid: ID.kuromame, zone: 'hand' }, { p: 0, cid: ID.kuromame, zone: 'hand' }]);
    const [a, b] = s.players[0].hand.filter((i) => s.cards[i].cid === ID.kuromame);
    moveCard(s, L, a, 'grave');
    expect(s.pending.some((x) => x.kind === 'ability' && x.event === 'ownDiscard')).toBe(true);
    s = settle(s);
    // 捨てた《黒豆だんしゃく》の呪文側 (白米男しゃく) を唱えた
    expect(s.log.some((x) => /《白米男しゃく》 を唱えた/.test(x.m))).toBe(true);
    moveCard(s, L, b, 'grave');
    expect(s.pending.some((x) => x.kind === 'ability' && x.event === 'ownDiscard')).toBe(false);
  });

  it('マジック・H・コレクター: ツインパクトがブレイクされたら、捨てて手札のツインパクトの片側を使える', () => {
    let s = setup([{ p: 0, cid: ID.magicH, zone: 'battle' }, { p: 0, cid: ID.kuromame, zone: 'shield' }, { p: 0, cid: ID.reredi, zone: 'hand' }, { p: 1, cid: 'vanilla', zone: 'battle' }]);
    const sh = find(s, 0, 'shield', ID.kuromame)!;
    const rd = find(s, 0, 'hand', ID.reredi)!;
    s.active = 1;
    breakShields(s, L, 0, [sh], 1);
    expect(s.pending.some((x) => x.kind === 'choice' && /S・バック:ツインパクト/.test(x.prompt))).toBe(true);
    s = settle(s);
    expect(s.cards[sh].zone).toBe('grave');
    expect(s.cards[rd].zone).not.toBe('hand');
  });

  it('ミノガミ&オウ禍武斗: 各プレイヤーのマナのツインパクト呪文を唱え、その後エレメント側を持ち主が出す', () => {
    let s = setup([
      { p: 0, cid: ID.ouKabuto, zone: 'hand' },
      { p: 0, cid: ID.kuromame, zone: 'mana' },
      { p: 0, cid: 'vanilla', zone: 'mana' },
      { p: 0, cid: 'vanilla', zone: 'mana' },
      { p: 1, cid: ID.kondama, zone: 'mana' },
      { p: 1, cid: 'vanilla', zone: 'mana' },
      { p: 1, cid: 'vanilla', zone: 'mana' },
    ]);
    const ok = find(s, 0, 'hand', ID.ouKabuto)!;
    const mine = find(s, 0, 'mana', ID.kuromame)!;
    const theirs = find(s, 1, 'mana', ID.kondama)!;
    moveCard(s, L, ok, 'battle');
    s = settle(s);
    expect(s.cards[mine].zone).toBe('battle');
    expect(s.players[0].battle).toContain(mine);
    expect(s.cards[theirs].zone).toBe('battle');
    expect(s.players[1].battle).toContain(theirs);
  });

  it('天地命動 バラギアラ: 「召喚によって出た時」だけマナをアンタップする', () => {
    const f = db.byId.get(ID.baraHyo)!.faces[0];
    expect(f.triggers.find((t) => t.events.includes('enter'))?.howEnter).toBe('summon');
  });

  it('輪廻暴冥・レレディのツインパクト・マップはツインパクトとして扱う', () => {
    expect(db.byId.get(ID.baraMei)!.twin).toBe(true);
    expect(db.byId.get(ID.baraMei)!.faces.map((f) => f.name)).toEqual(['天地命動 バラギアラ', '輪廻暴冥']);
    const map = db.byId.get(ID.reredi)!.faces[1];
    expect(map.cost).toBe(1);
    expect(map.text.length).toBe(1);
  });
});
