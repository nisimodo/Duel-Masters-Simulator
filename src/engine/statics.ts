// 常在型能力の適用 (パワー・キーワード・コスト・選ばれない・攻撃可否・マナの文明)
import type { AbilityGroup, Civ, Face } from '../lib/cards';
import type { Sel } from '../rules/ops';
import type { StaticCond, StaticSpec, StaticTarget, StaticWhen } from '../rules/statics';
import { matchesSel, mainOpp } from './interp';
import type { Lookup } from './engine';
import type { GameState } from './types';

export interface ActiveStatic {
  src: number;
  owner: number;
  spec: StaticSpec;
}

const faceAt = (s: GameState, L: Lookup, iid: number): Face | undefined => L(s.cards[iid].cid)?.faces[s.cards[iid].face];
const hasGroup = (f: Face | undefined, kind: AbilityGroup['kind']) => !!f?.groups?.some((g) => g.kind === kind);

/**
 * このクリーチャーが今使える条件つき・共有の能力
 *   ウェーブストライカー: 他にウェーブストライカーが2体以上 / アクセル: クロスギアがクロスされている
 *   サバイバー: 自分の他のサバイバーのoS能力も持つ / 超魂X: 下にあるカードの超魂X能力も持つ
 */
export function effGroups(s: GameState, L: Lookup, iid: number): AbilityGroup[] {
  const c = s.cards[iid];
  const f = faceAt(s, L, iid);
  if (!f) return [];
  if (c.zone !== 'battle') return (f.groups ?? []).filter((g) => g.kind === 'survivor' || g.kind === 'soul');
  const out: AbilityGroup[] = [];
  for (const g of f.groups ?? []) {
    if (g.kind === 'wave') {
      let n = 0;
      for (const pl of s.players) for (const b of pl.battle) if (b !== iid && hasGroup(faceAt(s, L, b), 'wave')) n++;
      if (n < 2) continue;
    }
    if (g.kind === 'accel' && !c.under.some((u) => /クロスギア/.test(L(s.cards[u].cid)?.faces[0]?.type ?? ''))) continue;
    if (g.kind === 'meta' && s.players[c.owner].mana.length < 7) continue;
    if (g.kind === 'oniOff' && s.players[c.owner].shield.length + s.players[mainOpp(s, c.owner)].shield.length <= (g.n ?? 0)) continue;
    if (g.kind === 'fortE' && !(c.paidRaces ?? []).some((r) => g.civ != null && r.includes(g.civ))) continue;
    if (g.kind === 'odrive' && !(g.civ ? (c.odrive ?? []).includes(g.civ) : (c.odrive ?? []).length > 0)) continue;
    if (g.kind === 'turbo' && !(s.brokeThisTurn ?? []).some((b) => b !== iid && s.cards[b].owner === c.owner)) continue;
    if (g.kind === 'sforce' && (c.forceShield == null || s.cards[c.forceShield].zone !== 'shield')) continue;
    out.push(g);
  }
  if (f.races.some((r) => r.includes('サバイバー')))
    for (const b of s.players[c.owner].battle) {
      if (b === iid) continue;
      for (const g of faceAt(s, L, b)?.groups ?? []) if (g.kind === 'survivor') out.push(g);
    }
  for (const u of c.under) for (const g of L(s.cards[u].cid)?.faces[0]?.groups ?? []) if (g.kind === 'soul') out.push(g);
  return out;
}

/** バトルゾーンで有効な常在型能力 (クロスギア等は下に重なっていても「これをクロスした」系が有効) */
export function activeStatics(s: GameState, L: Lookup): ActiveStatic[] {
  const out: ActiveStatic[] = [];
  s.players.forEach((pl, p) => {
    if (pl.lost) return;
    // 城: シールドを要塞化している間、能力が有効
    for (const sh of pl.shield)
      for (const u of s.cards[sh].under) {
        if (s.cards[u].fortOf !== sh) continue;
        for (const spec of L(s.cards[u].cid)?.faces[0]?.statics ?? []) out.push({ src: u, owner: p, spec });
      }
    for (const iid of pl.battle) {
      const c = s.cards[iid];
      const f = L(c.cid)?.faces[c.face];
      // 封印が付いているカードの能力は無視 (封印が付いていれば離れない、だけは有効)
      if (isSealed(s, iid)) {
        for (const spec of f?.statics ?? []) if (spec.s === 'sealStay') out.push({ src: iid, owner: p, spec });
        continue;
      }
      for (const spec of f?.statics ?? []) out.push({ src: iid, owner: p, spec });
      if (f?.groups || c.under.length || f?.races.some((r) => r.includes('サバイバー')))
        for (const g of effGroups(s, L, iid)) for (const spec of g.statics) out.push({ src: iid, owner: p, spec });
      for (const u of c.under) {
        const uc = s.cards[u];
        const uf = L(uc.cid)?.faces[uc.face];
        if (uc.fortOf != null) continue;
        // G・リンクしたゴッドの能力は、リンクしたクリーチャー全体の能力
        if (uc.linkedTo === iid) for (const spec of uf?.statics ?? []) out.push({ src: iid, owner: p, spec });
        else for (const spec of uf?.statics ?? []) if (isCrossSpec(spec)) out.push({ src: u, owner: p, spec });
      }
    }
  });
  return out;
}

const isCrossSpec = (spec: StaticSpec) => (spec.s === 'power' || spec.s === 'grant') && spec.target.t === 'cross';

/** 発生源から見た持ち主の関係も含めて Sel に合うか */
function relMatch(s: GameState, L: Lookup, a: ActiveStatic, iid: number, sel: Sel): boolean {
  const c = s.cards[iid];
  if (!sel.zones.includes(c.zone as never)) return false;
  if (sel.owner === 'self' && c.owner !== a.owner) return false;
  if (sel.owner === 'opp' && c.owner === a.owner) return false;
  if (sel.other && iid === a.src) return false;
  return matchesSel(s, L, iid, sel, true);
}

function targetMatch(s: GameState, L: Lookup, a: ActiveStatic, tg: StaticTarget, iid: number): boolean {
  if (tg.t === 'self') return iid === a.src;
  if (tg.t === 'cross') return s.cards[a.src].parent === iid;
  return relMatch(s, L, a, iid, tg.sel);
}

export interface PowerCtx {
  attacking?: boolean;
  inBattle?: boolean;
  blocking?: boolean;
  /** バトルの相手 */
  foe?: number;
}

function whenOk(s: GameState, a: ActiveStatic, when: StaticWhen, ctx: PowerCtx): boolean {
  switch (when) {
    case 'always':
      return true;
    case 'battle':
      return !!ctx.inBattle;
    case 'attack':
      return !!ctx.attacking;
    case 'block':
      return !!ctx.blocking;
    case 'oppTurn':
      return s.active !== a.owner;
    case 'ownTurn':
      return s.active === a.owner;
  }
}

/** 常在型能力を含まないパワー (条件判定用・無限ループ防止) */
export function basePower(s: GameState, L: Lookup, iid: number): number {
  const c = s.cards[iid];
  const f = L(c.cid)?.faces[c.face];
  return (f?.power ?? 0) + c.powerMod;
}

function countRel(s: GameState, L: Lookup, a: ActiveStatic, sel: Sel): number {
  let n = 0;
  s.players.forEach((pl, p) => {
    if (pl.lost) return;
    if (sel.owner === 'self' && p !== a.owner) return;
    if (sel.owner === 'opp' && p === a.owner) return;
    for (const z of sel.zones) for (const i of (pl[z as 'battle'] as number[]) ?? []) if (relMatch(s, L, a, i, sel)) n++;
  });
  return n;
}

function condOk(s: GameState, L: Lookup, a: ActiveStatic, cond: StaticCond | undefined, iid: number): boolean {
  if (!cond) return true;
  switch (cond.c) {
    case 'powerAtLeast':
      return basePower(s, L, iid) + staticPowerOnly(s, L, iid) >= cond.n;
    case 'powerAtMost':
      return basePower(s, L, iid) + staticPowerOnly(s, L, iid) <= cond.n;
    case 'totalShieldsLE':
      return s.players[a.owner].shield.length + s.players[mainOpp(s, a.owner)].shield.length <= cond.n;
    case 'countAtLeast':
      return countRel(s, L, a, cond.sel) >= cond.n;
    case 'linked':
      return isLinked(s, a.src);
    case 'shieldsLE':
      return s.players[a.owner].shield.length <= cond.n;
    case 'countLess':
      return countRel(s, L, a, cond.sel) < cond.n;
    case 'oppShieldsLess':
      return s.players[mainOpp(s, a.owner)].shield.length < cond.n;
    case 'manaAllCiv': {
      const mana = s.players[a.owner].mana;
      return mana.length > 0 && mana.every((m) => (L(s.cards[m].cid)?.civs ?? []).every((x) => x === cond.civ) && (L(s.cards[m].cid)?.civs ?? []).length > 0);
    }
    case 'shieldsMore':
      return s.players[a.owner].shield.length > s.players[mainOpp(s, a.owner)].shield.length;
    case 'selfNew':
      return !!s.cards[a.src]?.sick;
    case 'handLE':
      return s.players[a.owner].hand.length <= cond.n;
    case 'spellsThisTurn': {
      const sc = s.players[a.owner].spellsCast;
      return sc?.turn === s.turn && sc.n >= cond.n;
    }
  }
}

/** 「〜なければ、このタマシードはクリーチャーとして扱わない」でクリーチャーでない */
export function notCreatureNow(s: GameState, L: Lookup, iid: number): boolean {
  const c = s.cards[iid];
  const sp = (faceAt(s, L, iid)?.statics ?? []).find((x) => x.s === 'creatureOnlyIf');
  if (!sp || sp.s !== 'creatureOnlyIf' || c.zone !== 'battle') return false;
  return !condOk(s, L, { src: iid, owner: c.owner, spec: sp }, sp.cond, iid);
}

/** パワーへの常在型能力の修正 (攻撃中・バトル中などの文脈つき) */
export function staticPower(s: GameState, L: Lookup, iid: number, ctx: PowerCtx = {}): number {
  let d = 0;
  for (const a of activeStatics(s, L)) {
    const sp = a.spec;
    if (sp.s !== 'power') continue;
    if (!whenOk(s, a, sp.when, ctx) || !targetMatch(s, L, a, sp.target, iid)) continue;
    if (sp.cond && sp.cond.c !== 'powerAtLeast' && sp.cond.c !== 'powerAtMost' && !condOk(s, L, a, sp.cond, iid)) continue;
    if (sp.vs && (ctx.foe == null || !matchesSel(s, L, ctx.foe, { ...sp.vs, zones: ['battle'] }))) continue;
    if (sp.perCiv) {
      const civs = new Set(s.players[a.owner].mana.flatMap((m) => L(s.cards[m].cid)?.civs ?? []));
      d += civs.size * sp.delta;
      continue;
    }
    if (sp.perUnder) {
      d += (s.cards[a.src]?.under.length ?? 0) * sp.delta;
      continue;
    }
    d += sp.per ? Math.floor(countRel(s, L, a, sp.per.sel) / sp.per.each) * sp.delta : sp.delta;
  }
  return d;
}

/** 条件なしの常時のパワー修正だけ (powerAtLeast 判定用) */
function staticPowerOnly(s: GameState, L: Lookup, iid: number): number {
  let d = 0;
  for (const a of activeStatics(s, L)) {
    const sp = a.spec;
    if (sp.s !== 'power' || sp.when !== 'always' || sp.cond || !targetMatch(s, L, a, sp.target, iid)) continue;
    d += sp.per ? Math.floor(countRel(s, L, a, sp.per.sel) / sp.per.each) * sp.delta : sp.delta;
  }
  return d;
}

/** 常在型能力で得ているキーワード */
export function staticKws(s: GameState, L: Lookup, iid: number): string[] {
  const out: string[] = [];
  for (const a of activeStatics(s, L)) {
    const sp = a.spec;
    if (sp.s !== 'grant') continue;
    if (!whenOk(s, a, sp.when, {}) || !targetMatch(s, L, a, sp.target, iid)) continue;
    if (!condOk(s, L, a, sp.cond, iid)) continue;
    out.push(...sp.kws);
  }
  return out;
}

/** 封印が付いているか */
export function isSealed(s: GameState, iid: number): boolean {
  return (s.cards[iid]?.under ?? []).some((u) => s.cards[u].sealOf === iid);
}

/** G・リンクしているか (一番上のカード / 下のカードどちらでも) */
export function isLinked(s: GameState, iid: number): boolean {
  const c = s.cards[iid];
  if (!c) return false;
  if (c.linkedTo != null) return true;
  return c.under.some((u) => s.cards[u].linkedTo === iid);
}

/** そのカード自身が持つ常在型能力 */
export function ownStatics(s: GameState, L: Lookup, iid: number): StaticSpec[] {
  const c = s.cards[iid];
  return L(c.cid)?.faces[c.face]?.statics ?? [];
}

/** 相手 (chooser) がこのカードを選べるか */
export function canBeChosen(s: GameState, L: Lookup, iid: number, chooser: number, bySpell = false): boolean {
  const c = s.cards[iid];
  if (c.zone === 'battle' && isSealed(s, iid)) return false;
  if (c.owner === chooser || c.zone !== 'battle') return true;
  if (c.justDive != null) return false;
  if ((c.grants ?? []).some((g) => g.kws.includes('選ばれない'))) return false;
  return !ownStatics(s, L, iid).some((x) => x.s === 'untargetable' && (!x.bySpellOnly || bySpell));
}

/** カードを使うコスト (常在型能力による増減を含む。召喚時に選ぶ軽減は含まない) */
export function costOf(s: GameState, L: Lookup, p: number, iid: number, faceIdx: number): number {
  const c = s.cards[iid];
  const f = L(c.cid)?.faces[faceIdx];
  if (!f) return 0;
  const base = f.cost;
  let reduce = 0;
  let floor = 0;
  let add = 0;
  const action = f.isSpell ? 'cast' : f.isCreature ? 'summon' : 'use';
  for (const a of activeStatics(s, L)) {
    const sp = a.spec;
    if (sp.s !== 'cost') continue;
    const sideOk = sp.side === 'any' || (sp.side === 'self' ? a.owner === p : a.owner !== p);
    if (!sideOk) continue;
    if (sp.action !== 'use' && sp.action !== action) continue;
    if (!matchesSel(s, L, iid, { ...sp.sel, zones: [c.zone as never] })) continue;
    if (sp.delta < 0) {
      reduce += -sp.delta;
      floor = Math.max(floor, sp.floor);
    } else add += sp.delta;
  }
  let cost = base + add;
  if (reduce) cost = Math.max(Math.min(cost, Math.max(floor, 0)), cost - reduce);
  // 「このターン、次に召喚する〇〇のコストをN少なくする」
  const ns = s.players[p].nextSummon;
  if (ns && ns.turn === s.turn && f.isCreature && matchesSel(s, L, iid, { ...ns.sel, zones: [c.zone as never] })) cost = Math.max(1, cost - ns.n);
  // 条件つきの「このクリーチャーの召喚コストをN少なくする」
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'selfCost' || !condOk(s, L, { src: iid, owner: p, spec: sp }, sp.cond, iid)) continue;
    cost = sp.delta < 0 ? Math.max(Math.min(cost, sp.floor), cost + sp.delta) : cost + sp.delta;
  }
  // シンパシー (自分の〇〇1体につき1少なく)
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'sympathy') continue;
    const n = s.players[p][sp.zone ?? 'battle'].filter((b) => matchesSel(s, L, b, sp.sel)).length;
    if (n) cost = Math.max(Math.min(cost, sp.floor), cost - n);
  }
  return Math.max(0, cost);
}

/** そのプレイヤーのマナが全文明を持つか */
export function rainbowMana(s: GameState, L: Lookup, p: number): boolean {
  return activeStatics(s, L).some((a) => a.owner === p && a.spec.s === 'rainbowMana');
}

/** マナに置く時タップして置くカードか */
export function entersManaTapped(L: Lookup, cid: string): boolean {
  const card = L(cid);
  if (!card) return false;
  return card.civs.length > 1 || card.faces.some((f) => (f.statics ?? []).some((x) => x.s === 'tapMana'));
}

export const ALL_CIVS: Civ[] = ['L', 'W', 'D', 'F', 'N'];
