// 常在型能力の適用 (パワー・キーワード・コスト・選ばれない・攻撃可否・マナの文明)
import type { AbilityGroup, Civ, Face } from '../lib/cards';
import type { Sel } from '../rules/ops';
import { parseSel } from '../rules/selector';
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
    // 城: シールドを要塞化している間、能力が有効 / G城: 表向きでシールドゾーンにある間、能力が有効
    for (const sh of pl.shield) {
      if (s.cards[sh].faceUp && /G城$/.test(L(s.cards[sh].cid)?.faces[0]?.type ?? '')) for (const spec of L(s.cards[sh].cid)?.faces[0]?.statics ?? []) out.push({ src: sh, owner: p, spec });
      for (const u of s.cards[sh].under) {
        if (s.cards[u].fortOf !== sh) continue;
        for (const spec of L(s.cards[u].cid)?.faces[0]?.statics ?? []) out.push({ src: u, owner: p, spec });
      }
    }
    for (const iid of pl.battle) {
      const c = s.cards[iid];
      const f = L(c.cid)?.faces[c.face];
      // 封印が付いているカードの能力は無視 (封印が付いていれば離れない、だけは有効)
      if (sealIgnored(s, L, iid)) {
        for (const spec of f?.statics ?? []) if (spec.s === 'sealStay') out.push({ src: iid, owner: p, spec });
        continue;
      }
      if (abilitiesIgnored(s, L, iid)) continue;
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

/** このターンの記録 (なければ空) */
function turnStatLite(s: GameState, p: number) {
  const ts = s.players[p].turnStat;
  return ts?.turn === s.turn ? ts : { nonCreatureUsed: 0 };
}

/** 条件つきの常在型能力が今有効か */
export function staticCondOk(s: GameState, L: Lookup, a: ActiveStatic): boolean {
  const cond = (a.spec as { cond?: StaticCond }).cond;
  return !cond || condOk(s, L, a, cond, a.src);
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
    case 'selfTapped':
      return !!s.cards[a.src]?.tapped && (!cond.oppTurn || s.active !== s.cards[a.src].owner);
    case 'selfNew':
      return !!s.cards[a.src]?.sick;
    case 'handLE':
      return s.players[a.owner].hand.length <= cond.n;
    case 'spellsThisTurn': {
      const sc = s.players[a.owner].spellsCast;
      return sc?.turn === s.turn && sc.n >= cond.n;
    }
    case 'startOpps':
      return s.players.length - 1 >= cond.n;
    case 'drewLess': {
      const d = s.players[a.owner].draws;
      return (d?.turn === s.turn ? d.n : 0) < cond.n;
    }
    case 'noOtherAttacked':
      return !s.players[a.owner].battle.some((b) => b !== a.src && s.cards[b].attackedTurn === s.turn);
    case 'noNonCreatureUsed':
      return !(turnStatLite(s, a.owner).nonCreatureUsed ?? 0);
    case 'inHand':
      return s.cards[a.src]?.zone === 'hand';
    case 'crossAtLeast':
      return (s.cards[a.src]?.under ?? []).filter((u) => /クロスギア/.test(L(s.cards[u].cid)?.faces[s.cards[u].face]?.type ?? '')).length >= cond.n;
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
  for (const a of activeStatics(s, L)) d += staticPowerBy(s, L, a, iid, ctx);
  return d;
}

/** 1つの常在型能力によるパワーの修正 (当てはまらなければ 0) */
function staticPowerBy(s: GameState, L: Lookup, a: ActiveStatic, iid: number, ctx: PowerCtx): number {
  const sp = a.spec;
  if (sp.s !== 'power') return 0;
  if (!whenOk(s, a, sp.when, ctx) || !targetMatch(s, L, a, sp.target, iid)) return 0;
  if (sp.cond && sp.cond.c !== 'powerAtLeast' && sp.cond.c !== 'powerAtMost' && !condOk(s, L, a, sp.cond, iid)) return 0;
  if (sp.vs && (ctx.foe == null || !matchesSel(s, L, ctx.foe, { ...sp.vs, zones: ['battle'] }))) return 0;
  if (sp.perCiv) {
    const civs = new Set((sp.perCiv === 'battle' ? s.players[a.owner].battle : s.players[a.owner].mana).flatMap((m) => L(s.cards[m].cid)?.civs ?? []));
    return civs.size * sp.delta;
  }
  if (sp.perUnder) return (s.cards[a.src]?.under.length ?? 0) * sp.delta;
  return sp.per ? Math.floor(countRel(s, L, a, sp.per.sel) / sp.per.each) * sp.delta : sp.delta;
}

/** 他のカードの常在型能力から受けている効果 (カードの詳細の表示用。発生源ごとのパワー修正とキーワード) */
export function staticEffectsOn(s: GameState, L: Lookup, iid: number): { src: number; power: number; kws: string[] }[] {
  const out: { src: number; power: number; kws: string[] }[] = [];
  if (s.cards[iid]?.zone !== 'battle') return out;
  for (const a of activeStatics(s, L)) {
    if (a.src === iid) continue;
    const sp = a.spec;
    let power = 0;
    let kws: string[] = [];
    if (sp.s === 'power') power = staticPowerBy(s, L, a, iid, {});
    else if (sp.s === 'grant' && whenOk(s, a, sp.when, {}) && targetMatch(s, L, a, sp.target, iid) && condOk(s, L, a, sp.cond, iid)) kws = sp.kws;
    if (!power && !kws.length) continue;
    const e = out.find((x) => x.src === a.src);
    if (e) {
      e.power += power;
      e.kws.push(...kws.filter((k) => !e.kws.includes(k)));
    } else out.push({ src: a.src, power, kws: [...kws] });
  }
  return out;
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

/** 封印が付いていて能力が無視されるか (封印で無視されるのはクリーチャーなど。Artifact・フィールドは封印が付いていても能力を持つ) */
export function sealIgnored(s: GameState, L: Lookup, iid: number): boolean {
  if (!isSealed(s, iid)) return false;
  const c = s.cards[iid];
  return !/Artifact|フィールド/.test(L(c.cid)?.faces[c.face]?.type ?? '');
}

/** 効果で能力を無視されているか (「相手のクリーチャーの能力すべてを無視する」「その数字と同じコストの相手のエレメントの能力を無視し」) */
/** バトルゾーンのカード by が、その能力で target の能力を無視させるか (他の能力に無視されているかは見ない) */
function ignoresDirect(s: GameState, L: Lookup, by: number, target: number): boolean {
  const bc = s.cards[by];
  const tc = s.cards[target];
  if (by === target || bc.zone !== 'battle' || isSealed(s, by)) return false;
  const bst = L(bc.cid)?.faces[bc.face]?.statics ?? [];
  const tf = L(tc.cid)?.faces[tc.face];
  // 神聖龍 エモーショナル・ハードコア: バトルゾーンにある間、選んだ名前のクリーチャーの能力を無視する
  if (bc.chosenName && bc.chosenName === tf?.name && bst.some((x) => x.s === 'ignoreChosenName')) return true;
  // 切札電融 モモムゲン: 多色ではないクリーチャーの能力を無視する
  if (tf?.isCreature && (tf.civs?.length ?? 0) < 2 && bst.some((x) => x.s === 'ignoreNonMulti')) return true;
  return false;
}

/** バトルゾーンで、他のカードの能力を無視させている有効なカード (総合ルール 608.5) */
function ignoringNow(s: GameState, L: Lookup, by: number, target: number): boolean {
  if (!ignoresDirect(s, L, by, target)) return false;
  // 互いに無視しあう時は、先にバトルゾーンに出ていたほうを優先し、もう一方は無視されたものとする
  if (ignoresDirect(s, L, target, by) && (s.cards[target].enterSeq ?? 0) < (s.cards[by].enterSeq ?? 0)) return false;
  // 無視させているカード自身が、(target 以外の) 他のカードに無視されていれば効かない
  for (const pl of s.players)
    for (const o of pl.battle) {
      if (o === by || o === target || !ignoresDirect(s, L, o, by)) continue;
      if (ignoresDirect(s, L, by, o) && (s.cards[by].enterSeq ?? 0) < (s.cards[o].enterSeq ?? 0)) continue;
      return false;
    }
  return true;
}

/** 多色ではない呪文の効果が無視されるか (切札電融 モモムゲン) */
export function spellEffectIgnored(s: GameState, L: Lookup, cid: string, face: number): boolean {
  const f = L(cid)?.faces[face];
  if (!f || (f.civs?.length ?? 0) >= 2) return false;
  return s.players.some((pl) => pl.battle.some((b) => (faceOf0(s, L, b)?.statics ?? []).some((x) => x.s === 'ignoreNonMulti') && !isSealed(s, b) && !abilitiesIgnored(s, L, b)));
}
const faceOf0 = (s: GameState, L: Lookup, iid: number) => L(s.cards[iid].cid)?.faces[s.cards[iid].face];

export function abilitiesIgnored(s: GameState, L: Lookup, iid: number): boolean {
  const c = s.cards[iid];
  if (!c || c.zone !== 'battle') return false;
  for (const pl of s.players) for (const b of pl.battle) if (ignoringNow(s, L, b, iid)) return true;
  if (!s.ignoreAbil?.length) return false;
  return s.ignoreAbil.some((x) => x.by !== c.owner && (x.iid == null || x.iid === iid) && (x.turn == null || x.turn === s.turn) && (x.costEq == null || (L(c.cid)?.faces[c.face]?.cost ?? -1) === x.costEq));
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
export function canBeChosen(s: GameState, L: Lookup, iid: number, chooser: number, bySpell = false, src?: number): boolean {
  const c = s.cards[iid];
  if (c.zone === 'battle' && isSealed(s, iid)) return false;
  if (c.owner === chooser || c.zone !== 'battle') return true;
  // 英知の防壁・衒影の精霊 リアリテル 「自分のエレメントは、(その文明を持つ)呪文によって選ばれない」
  if (bySpell) {
    const civs = src != null && s.cards[src] ? (L(s.cards[src].cid)?.civs ?? []) : [];
    const guarded = (s.players[c.owner].spellGuard ?? []).some((g) => (g.nextOwn ? !(s.turn > g.turn && s.active === c.owner) : s.turn === g.turn) && (!g.civ || (civs as string[]).includes(g.civ)));
    if (guarded) return false;
  }
  if (c.justDive != null) return false;
  if ((c.grants ?? []).some((g) => g.kws.includes('選ばれない') || (bySpell && g.kws.includes('呪文で選ばれない')))) return false;
  // 「自分のドラゴンは、呪文によって相手に選ばれない」などで得ている
  const sk = staticKws(s, L, iid);
  if (sk.includes('選ばれない') || (bySpell && sk.includes('呪文で選ばれない'))) return false;
  return !ownStatics(s, L, iid).some((x) => x.s === 'untargetable' && (!x.bySpellOnly || bySpell) && (!x.cond || staticCondOk(s, L, { src: iid, owner: c.owner, spec: x })));
}

/** 手札以外 (墓地・マナゾーン・超次元ゾーン) から召喚・詠唱できるか (「このクリーチャーを墓地から召喚してもよい」「〇〇を自分の墓地から召喚してもよい」) */
/** キング・クリーチャー: 合体させるほかのキング・セル (自分の手札・マナゾーン)。揃っていなければ undefined */
export function kingCellsFor(s: GameState, L: Lookup, p: number, iid: number, face: Face): number[] | undefined {
  const need = face.text.map((l) => l.match(/キング・セル((?:《[^》]+》)+)が揃っていれば/)).find(Boolean)?.[1].match(/《([^》]+)》/g)?.map((x) => x.slice(1, -1));
  const c = s.cards[iid];
  const self = L(c.cid)?.faces[0]?.name;
  if (!need?.length || !self || !need.includes(self) || (c.zone !== 'hand' && c.zone !== 'mana')) return undefined;
  const out: number[] = [];
  for (const n of need) {
    if (n === self) continue;
    const pl = s.players[p];
    const k = [...pl.hand, ...pl.mana].find((x) => x !== iid && !out.includes(x) && L(s.cards[x].cid)?.faces[0]?.name === n);
    if (k == null) return undefined;
    out.push(k);
  }
  return out;
}

export function canPlayFromZone(s: GameState, L: Lookup, p: number, iid: number, face: Face): boolean {
  const c = s.cards[iid];
  if (face.type === 'キング・クリーチャー' && c.zone === 'mana' && kingCellsFor(s, L, p, iid, face)) return true;
  if ((face.statics ?? []).some((x) => x.s === 'summonFrom' && x.zone === c.zone && condOk(s, L, { src: iid, owner: p, spec: x }, x.cond, iid))) return true;
  if (!face.isCreature || (c.zone !== 'grave' && c.zone !== 'mana')) return false;
  return activeStatics(s, L).some((a) => {
    const sp = a.spec;
    if (a.owner !== p || sp.s !== 'summonFromSel' || sp.zone !== c.zone || !matchesSel(s, L, iid, sp.sel)) return false;
    if (sp.perTurn == null) return true;
    // 「自分のターン中、N体」: 自分のターンだけ、このターンに墓地から召喚した数が N 未満
    const used = s.players[p].graveSummons?.turn === s.turn ? s.players[p].graveSummons!.n : 0;
    return s.active === p && used < sp.perTurn;
  });
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
    if (sp.cond && !staticCondOk(s, L, a)) continue;
    // 「自分の墓地にある〇〇」のようにゾーンを1つに限るものは、そのゾーンから実行する時だけ
    if (sp.sel.zones.length === 1 && sp.sel.zones[0] !== c.zone) continue;
    if (!matchesSel(s, L, iid, { ...sp.sel, zones: [c.zone as never] })) continue;
    // 「各ターン、N体目の召喚コスト」: このターンに召喚した、条件に合うクリーチャーの数
    if (sp.nth != null) {
      const ts = s.players[p].turnStat;
      const done = ts?.turn === s.turn ? (ts.summonedCivs ?? []).filter((cv) => !sp.sel.civs?.length || cv.some((x) => sp.sel.civs!.includes(x))).length : 0;
      if (done !== sp.nth - 1) continue;
    }
    if (sp.delta < 0) {
      reduce += -sp.delta;
      floor = Math.max(floor, sp.floor);
    } else add += sp.delta;
  }
  let cost = base + add;
  if (reduce) cost = Math.max(Math.min(cost, Math.max(floor, 0)), cost - reduce);
  // 「このターン、次に召喚する〇〇のコストをN少なくする」
  const nu = s.players[p].nextUse;
  if (nu && nu.turn === s.turn) cost = Math.max(Math.min(cost, nu.floor), cost - nu.n);
  const ns = s.players[p].nextSummon;
  if (ns && ns.turn === s.turn && f.isCreature && matchesSel(s, L, iid, { ...ns.sel, zones: [c.zone as never] })) cost = Math.max(1, cost - ns.n);
  // 手札から〇〇を見せて軽減 (見せられるなら自動で見せる)
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'revealDiscount') continue;
    const n = s.players[p].hand.filter((h) => h !== iid && matchesSel(s, L, h, sp.sel)).length;
    if (n >= sp.n) cost = Math.max(Math.min(cost, sp.floor), cost - sp.d);
  }
  // 条件つきの「このクリーチャーの召喚コストをN少なくする」
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'selfCost' || !condOk(s, L, { src: iid, owner: p, spec: sp }, sp.cond, iid)) continue;
    cost = sp.delta < 0 ? Math.max(Math.min(cost, sp.floor), cost + sp.delta) : cost + sp.delta;
  }
  // 「このターン自分が引いたカード1枚につき1少なくする」
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'costPerDraw') continue;
    const d = s.players[p].draws;
    const n = d?.turn === s.turn ? d.n : 0;
    if (n) cost = Math.max(Math.min(cost, sp.floor), cost - Math.floor(n * sp.n));
  }
  // 「相手のエレメントの文明1つにつき1少なくする」
  for (const sp of f.statics ?? []) {
    if (sp.s !== 'costPerOppCivs') continue;
    const civs = new Set(s.players.filter((_, o) => o !== p).flatMap((pl) => pl.battle.flatMap((b) => cardCivs0(L, s.cards[b].cid))));
    if (civs.size) cost = Math.max(Math.min(cost, sp.floor), cost - civs.size * sp.each);
  }
  // シンパシー (自分の〇〇1体につき1少なく / W・シンパシーは2少なく)
  const syms: { sel: Sel; floor: number; zone?: 'battle' | 'mana' | 'grave' | 'shield'; each?: number; ofOpp?: boolean }[] = [];
  for (const sp of f.statics ?? []) if (sp.s === 'sympathy') syms.push(sp);
  // 他のカードから与えられたシンパシー (「自分の手札にある〇〇すべてに「シンパシー:〜」を与える」)
  if (c.zone === 'hand')
    for (const a of activeStatics(s, L)) {
      const sp = a.spec;
      if (sp.s !== 'grant' || a.owner !== p || sp.target.t !== 'sel' || !sp.target.sel.zones.includes('hand')) continue;
      if (!matchesSel(s, L, iid, { ...sp.target.sel, zones: ['hand'] })) continue;
      for (const kw of sp.kws) {
        const m = kw.match(/^(W・)?シンパシー[:：](.+)$/);
        const sel = m && parseSel(m[2]);
        if (sel) syms.push({ sel: { ...sel, owner: 'self' }, floor: 1, each: m![1] ? 2 : undefined });
      }
    }
  for (const sp of syms) {
    const n = s.players[sp.ofOpp ? mainOpp(s, p) : p][sp.zone ?? 'battle'].filter((b) => matchesSel(s, L, b, sp.sel)).length * (sp.each ?? 1);
    if (n) cost = Math.max(Math.min(cost, sp.floor), cost - n);
  }
  return Math.max(0, cost);
}

const cardCivs0 = (L: Lookup, cid: string) => L(cid)?.civs ?? [];

/** そのプレイヤーのマナが全文明を持つか */
export function rainbowMana(s: GameState, L: Lookup, p: number, forIid?: number): boolean {
  return activeStatics(s, L).some((a) => {
    const sp = a.spec;
    if (a.owner !== p || sp.s !== 'rainbowMana') return false;
    if (!sp.sel && !sp.zone) return true;
    // 実行するカードを限る能力は、何を実行するかが分かる時だけ
    const c = forIid != null ? s.cards[forIid] : undefined;
    if (!c) return false;
    if (sp.zone && c.zone !== sp.zone) return false;
    return !sp.sel || matchesSel(s, L, forIid!, { ...sp.sel, zones: [c.zone as never] });
  });
}

/** マナに置く時タップして置くカードか */
export function entersManaTapped(L: Lookup, cid: string): boolean {
  const card = L(cid);
  if (!card) return false;
  return card.civs.length > 1 || card.faces.some((f) => (f.statics ?? []).some((x) => x.s === 'tapMana'));
}

export const ALL_CIVS: Civ[] = ['L', 'W', 'D', 'F', 'N'];
