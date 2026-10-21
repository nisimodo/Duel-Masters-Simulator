// デュエル・マスターズ ルールエンジン (決定的: 同じ初期状態とアクション列からは必ず同じ状態になる)
// キーワード能力とゲームの進行は自動、カード固有の効果は手動操作アクションで処理する。
import { CIV_NAME, type Card, type Civ, type Face } from '../lib/cards';
import { parseKeywords, type Keywords } from '../lib/keywords';
import { matchesCond } from './cond';
import { hintsFromText } from './effects';
import { matchesSel, programOf, resumeExec, runExec, startExec } from './interp';
import { activeStatics, ALL_CIVS, costOf, effGroups, isSealed, entersManaTapped, ownStatics, rainbowMana, staticKws, staticPower, type PowerCtx } from './statics';
import { EVENT_LABEL, isAutoEffect, spellEffectLines, type TrigEvent, type TriggerSpec } from '../lib/triggers';
import type { Action, CardInst, GameInit, GameState, Pending, PlayerState, ZoneName } from './types';
import { normText } from '../rules/text';

export type Lookup = (cid: string) => Card | undefined;

// ---------- 乱数 (mulberry32) ----------
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffleArr(s: GameState, a: number[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// ---------- 基本ヘルパ ----------
export const cardOf = (s: GameState, iid: number) => s.cards[iid];
export function faceOf(s: GameState, L: Lookup, iid: number): Face | undefined {
  const c = s.cards[iid];
  const card = L(c.cid);
  return card?.faces[c.face] ?? card?.faces[0];
}
export function nameOf(s: GameState, L: Lookup, iid: number): string {
  const c = s.cards[iid];
  const card = L(c.cid);
  if (!card) return '???';
  if (c.zone === 'battle' || c.zone === 'hyper') return card.faces[c.face]?.name ?? card.name;
  return card.name;
}
export const q = (n: string) => `《${n}》`;

export function log(s: GameState, p: number | null, m: string) {
  s.log.push({ p, m });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

/** 一時的に与えられたものも含めたキーワード能力 */
export function kwOf(s: GameState, L: Lookup, iid: number): Keywords {
  const f = faceOf(s, L, iid);
  // 封印が付いているクリーチャーは能力を持たない
  if (s.cards[iid].zone === 'battle' && isSealed(s, iid)) return EMPTY_KW;
  const base: Keywords = f ? f.kw : EMPTY_KW;
  const g = s.cards[iid].grants;
  const extra = s.cards[iid].zone === 'battle' ? staticKws(s, L, iid) : [];
  const links = s.cards[iid].under.filter((u) => s.cards[u].linkedTo === iid);
  if (!g?.length && !extra.length && !links.length) return base;
  const k: Keywords = { ...base };
  for (const u of links) {
    const lk = L(s.cards[u].cid)?.faces[s.cards[u].face]?.kw;
    if (!lk) continue;
    k.breaker = Math.max(k.breaker, lk.breaker);
    k.blocker ||= lk.blocker;
    k.speedAttacker ||= lk.speedAttacker;
    k.machFighter ||= lk.machFighter;
    k.slayer ||= lk.slayer;
    k.powerAttacker += lk.powerAttacker;
  }
  for (const kw of [...(g ?? []).flatMap((x) => x.kws), ...extra]) {
    if (kw === 'ブロッカー') k.blocker = true;
    else if (kw === 'スピードアタッカー') k.speedAttacker = true;
    else if (kw === 'マッハファイター') k.machFighter = true;
    else if (kw === 'スレイヤー') k.slayer = true;
    else if (kw === 'ブロックされない') k.unblockable = true;
    else if (kw === 'ジャストダイバー') k.justDiver = true;
    else if (kw === 'W・ブレイカー') k.breaker = Math.max(k.breaker, 2);
    else if (kw === 'T・ブレイカー') k.breaker = Math.max(k.breaker, 3);
    else if (kw === 'Q・ブレイカー') k.breaker = Math.max(k.breaker, 4);
    else if (kw === 'ワールド・ブレイカー' || kw === '∞ブレイカー') k.breaker = 99;
    else if (/^ブレイク\+\d+$/.test(kw)) k.breaker += +kw.slice(4);
    else {
      const pa = kw.match(/^パワーアタッカー\+(\d+)$/);
      if (pa) k.powerAttacker += +pa[1];
    }
  }
  return k;
}
const EMPTY_KW = parseKeywords([], '');

export const isCreature = (s: GameState, L: Lookup, iid: number) => !!faceOf(s, L, iid)?.isCreature;

export function power(s: GameState, L: Lookup, iid: number, attacking = false, ctx: PowerCtx = {}): number {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  let p = (f?.power ?? 0) + c.powerMod;
  for (const u of c.under) if (s.cards[u].linkedTo === iid) p += L(s.cards[u].cid)?.faces[s.cards[u].face]?.power ?? 0;
  // 「次の自分のターンのはじめまでパワー+N」は一時的な能力として持っている
  for (const g of c.grants ?? []) for (const k of g.kws) if (/^パワー[+-]\d+$/.test(k)) p += +k.slice(3);
  if (attacking && f) p += kwOf(s, L, iid).powerAttacker;
  if (c.zone === 'battle') p += staticPower(s, L, iid, { ...ctx, attacking: attacking || ctx.attacking });
  return p;
}

export function cardCivs(L: Lookup, cid: string): Civ[] {
  return L(cid)?.civs ?? [];
}

const opponentsOf = (s: GameState, p: number) => s.players.map((_, i) => i).filter((i) => i !== p && !s.players[i].lost);

/** zone配列からiidを取り除く */
export function detach(s: GameState, iid: number) {
  const c = s.cards[iid];
  if (c.zone === 'under') {
    if (c.parent != null) {
      const par = s.cards[c.parent];
      par.under = par.under.filter((x) => x !== iid);
    }
  } else if (c.zone !== 'gone') {
    const pl = s.players[c.owner];
    const arr = pl[c.zone] as number[];
    const i = arr.indexOf(iid);
    if (i >= 0) arr.splice(i, 1);
  }
  // 誰かが見ているカードなら外す
  for (const pl of s.players) {
    const i = pl.peek.indexOf(iid);
    if (i >= 0) pl.peek.splice(i, 1);
  }
  c.parent = null;
}

function resetCard(c: CardInst) {
  c.grants = undefined;
  c.manaDown = undefined;
  c.restrict = undefined;
  c.noUntap = undefined;
  c.tapped = false;
  c.sick = false;
  c.powerMod = 0;
  c.noAttack = false;
  c.revealed = false;
}

/**
 * カードを移動する。進化元など下にあるカードも同じゾーンへ移動する。
 * サイキック/ドラグハートは超次元ゾーンへ、GRクリーチャーは超GRゾーンの一番下へ戻る。
 * バトルゾーンに出た時・離れた時の誘発型能力もここで発動する (silent で抑止)。
 */
export function moveCard(
  s: GameState,
  L: Lookup,
  iid: number,
  to: ZoneName,
  opts: { pos?: 'top' | 'bottom'; tapped?: boolean; faceUp?: boolean; face?: number; silent?: boolean; noReplace?: boolean } = {},
): ZoneName {
  const c = s.cards[iid];
  const card = L(c.cid);
  const from = c.zone;
  const prevFace = c.face;
  // EXライフ: 離れるかわりに、そのシールドを墓地に置く
  if (from === 'battle' && to !== 'battle' && !opts.silent && c.exShield != null && s.cards[c.exShield]?.zone === 'shield') {
    const sh = c.exShield;
    c.exShield = undefined;
    moveCard(s, L, sh, 'grave', { silent: true });
    log(s, c.owner, `EXライフ: ${q(card?.faces[c.face]?.name ?? '')} は離れるかわりにシールドを1つ墓地に置いた`);
    return 'battle';
  }
  // 置換効果 (エターナル・Ω / 破壊される時かわりに / エスケープ / セイバー)
  if (from === 'battle' && to !== 'battle' && !opts.silent && !opts.noReplace) {
    const own = card?.faces[c.face]?.statics ?? [];
    // 一時的に離れない
    if ((c.grants ?? []).some((g) => g.kws.includes('離れない'))) {
      log(s, c.owner, `${q(card!.faces[c.face].name)} は離れない`);
      return 'battle';
    }
    // 封印が付いていれば離れない
    if (isSealed(s, iid) && own.some((x) => x.s === 'sealStay')) {
      log(s, c.owner, `${q(card!.faces[c.face].name)} は封印が付いているので離れない`);
      return 'battle';
    }
    // 破壊されない
    if (to === 'grave' && own.some((x) => x.s === 'indestructible' && (!x.inBattle || s.inBattleNow))) {
      log(s, c.owner, `${q(card!.faces[c.face].name)} は破壊されない`);
      return 'battle';
    }
    // リンク解除: サイキック・セル1枚 (このカード) を超次元ゾーンへ戻し、残りは裏返ってバトルゾーンに残る
    const cells = c.under.filter((u) => s.cards[u].cellOf === iid);
    if (cells.length && own.some((x) => x.s === 'linkRelease')) {
      const pl0 = s.players[c.owner];
      for (const u of cells) {
        const uc = s.cards[u];
        c.under = c.under.filter((x) => x !== u);
        uc.zone = 'battle';
        uc.parent = null;
        uc.cellOf = undefined;
        uc.face = 0;
        uc.tapped = c.tapped;
        uc.sick = false;
        pl0.battle.push(u);
      }
      log(s, c.owner, `リンク解除: ${q(card!.faces[c.face].name)} のサイキック・セルが裏返ってバトルゾーンに残る`);
      c.face = 0;
      return moveCard(s, L, iid, 'hyper', { ...opts, noReplace: true });
    }
    // 「破壊される時、かわりに自分の〜」: 払えるなら払ってとどまる
    for (const rl of own) {
      if (rl.s !== 'replaceLeave' || (rl.on === 'destroy' && to !== 'grave')) continue;
      const prog = programOf(rl.effect);
      // 「〜してもよい」は、払える時は払う (払わずに離れる選択はしない)
      const ops = prog.ops.length === 1 && prog.ops[0].op === 'optional' ? prog.ops[0].body : prog.ops;
      if (!prog.complete || !canPay(s, L, c.owner, iid, ops)) continue;
      log(s, c.owner, `${q(card!.faces[c.face].name)} は離れるかわりに「${rl.effect}」`);
      startExec(s, L, c.owner, iid, ops, card!.faces[c.face].name);
      return 'battle';
    }
    // エターナル・Κ: 裏向きのマナをN枚表向きにして、とどまる
    const ek = own.find((x) => x.s === 'eternalK');
    if (ek && ek.s === 'eternalK') {
      const down = s.players[c.owner].mana.filter((m) => s.cards[m].manaDown);
      if (down.length >= ek.n) {
        for (const m of down.slice(0, ek.n)) s.cards[m].manaDown = false;
        log(s, c.owner, `エターナル・Κ: 裏向きのマナを${ek.n}枚表向きにして、${q(card!.faces[c.face].name)} はとどまる`);
        return 'battle';
      }
    }
    // 解除: 離れるかわりにコストの小さいほうに裏返す
    if (own.some((x) => x.s === 'release') && card && card.faces.length > 1) {
      const costs = card.faces.map((f) => f.cost);
      const small = costs.indexOf(Math.min(...costs));
      if (c.face !== small) {
        const before = card.faces[c.face].name;
        c.face = small;
        log(s, c.owner, `解除: ${q(before)} はバトルゾーンを離れるかわりに ${q(card.faces[small].name)} に裏返った`);
        return 'battle';
      }
    }
    if (own.some((x) => x.s === 'leaveToHand') && to !== 'hand') {
      log(s, c.owner, `エターナル・Ω: ${q(card!.faces[c.face].name)} は手札に戻る`);
      return moveCard(s, L, iid, 'hand', opts);
    }
    if (to === 'grave') {
      const dt = own.find((x) => x.s === 'destroyTo');
      if (dt && dt.s === 'destroyTo') {
        const z: ZoneName = dt.zone === 'deckBottom' ? 'deck' : dt.zone;
        log(s, c.owner, `${q(card!.faces[c.face].name)} は墓地に置くかわりに${{ hand: '手札', mana: 'マナゾーン', deck: '山札の下', shield: 'シールド' }[z as 'hand']}へ`);
        return moveCard(s, L, iid, z, { ...opts, pos: dt.zone === 'deckBottom' ? 'bottom' : opts.pos, faceUp: z === 'shield' ? false : opts.faceUp });
      }
      const pl0 = s.players[c.owner];
      if (own.some((x) => x.s === 'escape') && pl0.shield.length) {
        const sh = pl0.shield[pl0.shield.length - 1];
        moveCard(s, L, sh, 'hand', { silent: true });
        log(s, c.owner, `エスケープ: ${q(card!.faces[c.face].name)} は破壊されるかわりにシールドを1つ手札に加えた`);
        return 'battle';
      }
      // セイバー: 自分の他のクリーチャーがかわりに破壊される
      for (const sv of pl0.battle) {
        if (sv === iid) continue;
        const svs = faceOf(s, L, sv)?.statics ?? [];
        const spec = svs.find((x) => x.s === 'saver');
        if (spec && spec.s === 'saver' && matchesSel(s, L, iid, spec.sel)) {
          log(s, c.owner, `セイバー: ${q(nameOf(s, L, sv))} がかわりに破壊される`);
          moveCard(s, L, sv, 'grave', { noReplace: true });
          return 'battle';
        }
      }
    }
  }
  // 表向きのシールド (ギャラクシールド等) が離れる時、かわりに墓地へ
  if (from === 'shield' && c.faceUp && to !== 'grave' && to !== 'battle' && !opts.noReplace && (card?.faces[0]?.statics ?? []).some((x) => x.s === 'faceUpShieldToGrave')) {
    log(s, c.owner, `${q(card!.faces[0].name)} はシールドゾーンを離れるかわりに墓地へ`);
    return moveCard(s, L, iid, 'grave', { ...opts, noReplace: true });
  }
  // スター進化: 離れる時、一番上のカードだけが離れる
  if (from === 'battle' && to !== 'battle' && c.under.length && /スター進化/.test(card?.faces[c.face]?.type ?? '')) {
    const [first, ...restUnder] = c.under;
    const fc = s.cards[first];
    const arr = s.players[fc.owner].battle;
    arr.splice(arr.indexOf(iid) >= 0 ? arr.indexOf(iid) : arr.length, 0, first);
    fc.zone = 'battle';
    fc.parent = null;
    fc.under = restUnder;
    for (const u of restUnder) s.cards[u].parent = first;
    fc.tapped = c.tapped;
    c.under = [];
    log(s, c.owner, `スター進化: ${q(nameOf(s, L, first))} がバトルゾーンに残る`);
  }
  // G・リンク: 離れるのは1枚だけで、残りのゴッドはバトルゾーンに残る
  if (from === 'battle' && to !== 'battle') {
    const links = c.under.filter((u) => s.cards[u].linkedTo === iid);
    if (links.length) {
      const [first, ...rest] = links;
      const fc = s.cards[first];
      const arr = s.players[fc.owner].battle;
      arr.splice(arr.indexOf(iid) >= 0 ? arr.indexOf(iid) : arr.length, 0, first);
      fc.zone = 'battle';
      fc.parent = null;
      fc.linkedTo = undefined;
      fc.tapped = c.tapped;
      fc.under = [...rest, ...c.under.filter((u) => !links.includes(u) && /クロスギア|ドラグハート/.test(L(s.cards[u].cid)?.faces[0]?.type ?? ''))];
      for (const u of fc.under) {
        s.cards[u].parent = first;
        if (s.cards[u].linkedTo != null) s.cards[u].linkedTo = first;
      }
      c.under = c.under.filter((u) => !links.includes(u) && !fc.under.includes(u));
      log(s, c.owner, `G・リンク: ${q(nameOf(s, L, first))} がバトルゾーンに残る`);
    }
    // クロスギアはクリーチャーが離れてもバトルゾーンに残る
    for (const u of [...c.under]) {
      const uc = s.cards[u];
      if (!/クロスギア/.test(L(uc.cid)?.faces[0]?.type ?? '')) continue;
      c.under = c.under.filter((x) => x !== u);
      uc.parent = null;
      uc.zone = 'battle';
      s.players[uc.owner].battle.push(u);
    }
  }
  const under = from === 'battle' ? [...c.under] : [];
  detach(s, iid);
  let dest: ZoneName = to;
  if (card && to !== 'battle') {
    if (card.zone === 'hyper' && to !== 'hyper') dest = 'hyper';
    if (card.zone === 'gr' && to !== 'gr') dest = 'gr';
  }
  const pl = s.players[c.owner];
  resetCard(c);
  c.under = [];
  c.zone = dest;
  if (dest !== 'battle' && dest !== 'hyper') c.face = 0;
  if (opts.face != null) c.face = opts.face;
  c.tapped = !!opts.tapped;
  c.faceUp = opts.faceUp ?? !(dest === 'shield' || dest === 'deck' || dest === 'gr');
  const arr = pl[dest] as number[];
  const pos = opts.pos ?? (dest === 'gr' ? 'bottom' : 'top');
  // 配列の末尾 = 山札の上 / 最新
  if (pos === 'top') arr.push(iid);
  else arr.unshift(iid);
  if (dest === 'battle') {
    c.sick = true;
    if ((card?.faces[c.face]?.statics ?? []).some((x) => x.s === 'entersTapped')) c.tapped = true;
    if (card?.faces[c.face]?.kw.justDiver) c.justDive = c.owner;
  }
  // 下にあったカードも同じゾーンへ (誘発はしない)
  for (const u of under) {
    const uc = s.cards[u];
    uc.parent = null;
    uc.zone = 'gone';
    const uCard = L(uc.cid);
    let ud: ZoneName = to === 'battle' || uc.sealOf != null ? 'grave' : to;
    uc.sealOf = undefined;
    if (uCard?.zone === 'hyper') ud = 'hyper';
    if (uCard?.zone === 'gr') ud = 'gr';
    resetCard(uc);
    uc.zone = ud;
    uc.face = 0;
    uc.faceUp = !(ud === 'shield' || ud === 'deck' || ud === 'gr');
    const ua = s.players[uc.owner][ud] as number[];
    if ((opts.pos ?? (ud === 'gr' ? 'bottom' : 'top')) === 'top') ua.push(u);
    else ua.unshift(u);
  }
  // Zラッシュ: シールドが離れたら、次の自分のターンのはじめまでハイパーモード
  if (from === 'shield' && dest !== 'shield') {
    for (const b of s.players[c.owner].battle) {
      const bc = s.cards[b];
      const bcard = L(bc.cid);
      if (bc.face === 0 && bcard?.hyper && bcard.faces[0].statics.some((x) => x.s === 'zrush')) {
        bc.face = 1;
        bc.hyperUntil = c.owner;
        log(s, c.owner, `Zラッシュ: ${q(bcard.faces[0].name)} がハイパーモードになった`);
      }
    }
  }
  if (s.mode === 'duepa' && from === 'battle' && dest !== 'battle' && isPartnerCard(s, iid)) {
    s.pending.push({ kind: 'partner', player: c.owner, iid });
  }
  if (!opts.silent) {
    if (from === 'battle' && dest !== 'battle') {
      const destroyed = dest === 'grave';
      fireSelf(s, L, iid, prevFace, destroyed ? ['destroyed', 'leave'] : ['leave']);
      if (destroyed) fireWatchers(s, L, c.owner, iid, 'otherOwnDestroyed', 'oppDestroyed');
    }
    if (dest === 'grave' && from !== 'grave') fireSelf(s, L, iid, prevFace, ['toGrave']);
    if (dest === 'mana' && from !== 'mana') {
      fireSelf(s, L, iid, 0, ['toManaSelf']);
      fireWatchers(s, L, c.owner, null, 'ownManaPut', null, iid);
    }
    if (dest === 'shield' && c.faceUp && from !== 'shield') fireSelf(s, L, iid, 0, ['toShieldFaceUp']);
    if (dest === 'battle' && from !== 'battle' && (card?.faces[c.face]?.races ?? []).some((r) => r.includes('コマンド'))) {
      const host = s.players[c.owner].battle.find((b) => b !== iid && isSealed(s, b));
      if (host != null) removeSeal(s, L, host);
    }
    if (dest === 'battle' && from !== 'battle' && card?.faces[c.face]?.marked?.OL && (card.faces[c.face].statics ?? []).some((x) => x.s === 'buzz')) {
      const eff = card.faces[c.face].marked!.OL;
      for (let k = 0; k < 1 + (c.buzz ?? 0); k++)
        s.pending.push({ kind: 'ability', player: c.owner, src: iid, cid: c.cid, face: c.face, event: 'enter', text: `バズレンダ: ${eff}`, effect: eff, optional: false, auto: false });
    }
    if (dest === 'battle' && from !== 'battle') {
      if (card?.faces[c.face]?.groups?.some((g) => g.kind === 'sforce')) c.forceShield = s.players[c.owner].shield[s.players[c.owner].shield.length - 1];
      gLink(s, L, iid);
      fireSelf(s, L, iid, c.face, ['enter']);
      fireWatchers(s, L, c.owner, iid, 'otherOwnEnter', 'oppEnter');
    }
  }
  return dest;
}

/** ブレイクするシールドの数 (パワード・ブレイカー: パワー6000ごとにさらに1つ) */
export function breakCount(s: GameState, L: Lookup, iid: number): number {
  const k = kwOf(s, L, iid);
  const powered = (faceOf(s, L, iid)?.statics ?? []).some((x) => x.s === 'poweredBreaker') || staticKws(s, L, iid).includes('パワード・ブレイカー') || (s.cards[iid].grants ?? []).some((g) => g.kws.includes('パワード・ブレイカー'));
  return powered ? k.breaker + Math.floor(power(s, L, iid, true) / 6000) : k.breaker;
}

/** 置換効果の支払い (最初の選択) ができるか */
function canPay(s: GameState, L: Lookup, p: number, self: number, ops: import('../rules/ops').Op[]): boolean {
  const first = ops.find((o) => o.op !== 'optional') ?? ops[0];
  const op = first?.op === 'optional' ? first.body[0] : first;
  if (!op) return false;
  if (op.op === 'choose' && op.target.ref === 'sel') {
    const sel = op.target.sel;
    const n = op.target.count && 'n' in op.target.count ? (op.target.count.n ?? 1) : 1;
    let have = 0;
    for (const z of sel.zones) for (const i of (s.players[p][z as 'battle'] as number[] | undefined) ?? []) if (i !== self && matchesSel(s, L, i, sel)) have++;
    return have >= n;
  }
  if (op.op === 'discard') return s.players[p].hand.length >= ('n' in op.count ? (op.count.n ?? 1) : 1);
  return true;
}

/** 「可能なら毎ターン攻撃する」で、まだ攻撃できるクリーチャー */
export function mustAttackers(s: GameState, L: Lookup, p: number): number[] {
  return s.players[p].battle.filter((b) => {
    if (!(faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'mustAttack')) return false;
    if (!canAttackWith(s, L, b) || faceOf(s, L, b)?.kw.cantAttack) return false;
    const tg = attackTargets(s, L, b);
    // 実際に攻撃を宣言できるか (挑発などの制限も含めて) 確かめる
    const tries = [...tg.cards.map((c) => ({ player: s.cards[c].owner, card: c as number | null })), ...tg.players.map((pl) => ({ player: pl, card: null }))];
    return tries.some((t) => !applyAction(s, p, { t: 'attack', attacker: b, player: t.player, card: t.card }, L).error);
  });
}

/** 「相手のクリーチャーは可能ならこのクリーチャーを攻撃する」で、このクリーチャーが攻撃しなければならない相手 */
export function luresFor(s: GameState, L: Lookup, attacker: number): number[] {
  const tg = attackTargets(s, L, attacker);
  return tg.cards.filter((t) => (faceOf(s, L, t)?.statics ?? []).some((x) => x.s === 'lure') || (s.cards[t].grants ?? []).some((g) => g.kws.includes('挑発')));
}

/** 封印を1つ外して墓地に置く (なくなれば「封印がすべてなくなった時」) */
export function removeSeal(s: GameState, L: Lookup, host: number) {
  const hc = s.cards[host];
  const seal = [...hc.under].reverse().find((u) => s.cards[u].sealOf === host);
  if (seal == null) return;
  hc.under = hc.under.filter((u) => u !== seal);
  const sc = s.cards[seal];
  sc.sealOf = undefined;
  sc.parent = null;
  sc.zone = 'grave';
  sc.faceUp = true;
  s.players[sc.owner].grave.push(seal);
  log(s, hc.owner, `${q(nameOf(s, L, host))} の封印を1つ外した`);
  fireSelf(s, L, host, hc.face, ['unsealOne']);
  if (!isSealed(s, host)) fireSelf(s, L, host, hc.face, ['unsealedAll']);
}

/** クロスギアをクロスするコスト (「〜にクロスする時、コストを少なく」を含む) */
export function crossCost(s: GameState, L: Lookup, gear: number, onto: number): number {
  const gf = faceOf(s, L, gear);
  let cost = gf?.cost ?? 0;
  for (const x of gf?.statics ?? []) if (x.s === 'crossDiscount' && matchesSel(s, L, onto, x.sel)) cost = Math.max(1, cost - x.n);
  return cost;
}

/** G・リンク: 出たゴッドを、条件に合う自分のゴッドにリンクする (リンク先が一番上のまま、出たゴッドが下に入る) */
function gLink(s: GameState, L: Lookup, iid: number) {
  const c = s.cards[iid];
  const gl = (L(c.cid)?.faces[c.face]?.statics ?? []).find((x) => x.s === 'glink');
  if (!gl || gl.s !== 'glink') return;
  const glOf = (i: number) => (L(s.cards[i].cid)?.faces[s.cards[i].face]?.statics ?? []).find((x) => x.s === 'glink');
  const group = (top: number) => [top, ...s.cards[top].under.filter((u) => s.cards[u].linkedTo === top)];
  const ok = (top: number) => {
    if (top === iid || !faceOf(s, L, top)?.isCreature) return false;
    const g = group(top);
    if (gl.names) return g.some((i) => gl.names!.some((n) => L(s.cards[i].cid)?.faces[s.cards[i].face]?.name.includes(n)));
    const sides = g.map((i) => glOf(i)).map((x) => (x && x.s === 'glink' ? x.side : undefined));
    if (sides.includes(gl.side)) return false;
    return sides.some((x) => x && x !== gl.side);
  };
  const top = s.players[c.owner].battle.find(ok);
  if (top == null) return;
  const t = s.cards[top];
  s.players[c.owner].battle = s.players[c.owner].battle.filter((b) => b !== iid);
  c.zone = 'under';
  c.parent = top;
  c.linkedTo = top;
  t.under.push(iid);
  log(s, c.owner, `G・リンク: ${q(nameOf(s, L, iid))} が ${q(nameOf(s, L, top))} とリンクした`);
}

// ---------- 誘発型能力 ----------
const MAX_PENDING = 80;
const MAX_TURN_TRIGGERS = 300;

function pushAbility(s: GameState, L: Lookup, src: number, faceIdx: number, spec: TriggerSpec, event: TrigEvent) {
  if (s.pending.length >= MAX_PENDING) return;
  // 無限ループ防止: 1ターンに誘発する能力の数に上限
  s.turnTriggers = (s.turnTriggers ?? 0) + 1;
  if (s.turnTriggers > MAX_TURN_TRIGGERS) {
    if (s.turnTriggers === MAX_TURN_TRIGGERS + 1) log(s, null, '能力の誘発が多すぎるため、このターンはこれ以上自動で誘発しません (無限ループ防止)');
    return;
  }
  if (spec.oncePerTurn) {
    const key = `${src}|${spec.text}`;
    if ((s.usedOnce ??= []).includes(key)) return;
    s.usedOnce.push(key);
  }
  const c = s.cards[src];
  const card = L(c.cid);
  const owner = c.owner;
  if (s.players[owner]?.lost) return;
  s.pending.push({
    kind: 'ability',
    player: owner,
    src,
    cid: c.cid,
    face: faceIdx,
    event,
    text: spec.text,
    effect: spec.effect,
    optional: spec.optional,
    auto: spec.auto,
  });
  log(s, owner, `⚡ ${q(card?.faces[faceIdx]?.name ?? '???')} の能力 (${EVENT_LABEL[event]})`);
}

/** そのカード自身の「～時」能力 */
function fireSelf(s: GameState, L: Lookup, iid: number, faceIdx: number, events: TrigEvent[]) {
  const f = L(s.cards[iid].cid)?.faces[faceIdx];
  if (!f) return;
  if (s.cards[iid].zone === 'battle' && isSealed(s, iid) && !events.some((e) => e === 'unsealOne' || e === 'unsealedAll')) return;
  for (const spec of [...(f.triggers ?? []), ...effGroups(s, L, iid).flatMap((g) => g.triggers)]) {
    const ev = spec.events.find((e) => events.includes(e));
    if (ev) pushAbility(s, L, iid, faceIdx, spec, ev);
  }
  // リンクしているゴッドの「このクリーチャーが〜時」
  if (s.cards[iid].zone === 'battle')
    for (const u of s.cards[iid].under) {
      if (s.cards[u].linkedTo !== iid) continue;
      const uf = L(s.cards[u].cid)?.faces[s.cards[u].face];
      for (const spec of uf?.triggers ?? []) {
        const ev = spec.events.find((e) => events.includes(e) && e !== 'enter');
        if (ev) pushAbility(s, L, u, s.cards[u].face, spec, ev);
      }
    }
}

/** バトルゾーンにある他のカードの能力 (自分側 ownEv / 相手側 oppEv) */
function fireWatchers(s: GameState, L: Lookup, actor: number, exclude: number | null, ownEv: TrigEvent | null, oppEv: TrigEvent | null, subject: number | null = exclude) {
  fireHand(s, L, actor, ownEv, oppEv, subject);
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const p = (s.active + k) % n;
    if (s.players[p].lost) continue;
    const ev = p === actor ? ownEv : oppEv;
    if (!ev) continue;
    for (const iid of s.players[p].battle) {
      if (iid === exclude || isSealed(s, iid)) continue;
      const f = faceOf(s, L, iid);
      if (!f) continue;
      for (const spec of [...(f.triggers ?? []), ...effGroups(s, L, iid).flatMap((g) => g.triggers)]) {
        if (!spec.events.includes(ev) || spec.fromHand) continue;
        // 「自分の光のハンターが出た時」などは、そのカードが条件に合う時だけ
        if (spec.subject && subject != null && !matchesSel(s, L, subject, spec.subject)) continue;
        pushAbility(s, L, iid, s.cards[iid].face, spec, ev);
      }
      // (手札から使う能力は下でまとめて)
      // 下にあるリンクしたゴッド・装備したドラグハート・クロスギアの能力 (龍解など)
      for (const u of s.cards[iid].under) {
        const uc = s.cards[u];
        const ucard = L(uc.cid);
        if (uc.linkedTo !== iid && !/ドラグハート|クロスギア/.test(ucard?.faces[uc.face]?.type ?? '')) continue;
        for (const spec of ucard?.faces[uc.face]?.triggers ?? []) {
          if (!spec.events.includes(ev)) continue;
          if (spec.subject && subject != null && !matchesSel(s, L, subject, spec.subject)) continue;
          pushAbility(s, L, u, uc.face, spec, ev);
        }
      }
    }
  }
}

/** 手札にあるカードの「〜時、このカードを手札から使ってもよい」 */
function fireHand(s: GameState, L: Lookup, actor: number, ownEv: TrigEvent | null, oppEv: TrigEvent | null, subject: number | null) {
  s.players.forEach((pl, p) => {
    if (pl.lost) return;
    const ev = p === actor ? ownEv : oppEv;
    if (!ev) return;
    for (const h of pl.hand) {
      const card = L(s.cards[h].cid);
      card?.faces.forEach((f, fi) => {
        for (const spec of f.triggers ?? []) {
          if (!spec.fromHand || !spec.events.includes(ev)) continue;
          if (spec.subject && subject != null && !matchesSel(s, L, subject, spec.subject)) continue;
          pushAbility(s, L, h, fi, spec, ev);
        }
      });
    }
  });
}

/** 自動で実行できる効果を実行する */
function execAuto(s: GameState, L: Lookup, p: number, effect: string) {
  const pl = s.players[p];
  for (const h of hintsFromText([effect])) {
    for (let i = 0; i < h.n; i++) {
      if (h.kind === 'draw') {
        if (!drawCards(s, p, 1)) break;
      } else if (h.kind === 'manaTop' || h.kind === 'mill' || h.kind === 'shieldTop') {
        const top = pl.deck[pl.deck.length - 1];
        if (top == null) break;
        if (h.kind === 'shieldTop') {
          detach(s, top);
          s.cards[top].zone = 'shield';
          s.cards[top].faceUp = false;
          pl.shield.push(top);
        } else moveCard(s, L, top, h.kind === 'mill' ? 'grave' : 'mana', { tapped: h.kind === 'manaTop' && cardCivs(L, s.cards[top].cid).length > 1 });
      } else if (h.kind === 'grSummon') {
        const top = pl.gr[pl.gr.length - 1];
        if (top == null) break;
        moveCard(s, L, top, 'battle');
        log(s, p, `GR召喚 → ${q(nameOf(s, L, top))}`);
      }
    }
    log(s, p, `自動処理: ${h.label}`);
  }
}

function isPartnerCard(s: GameState, iid: number) {
  return s.partnerIids.includes(iid);
}

/** ドロー時の判定 (ビビッドロー) に使うカード情報。applyAction のたびに設定する */
let vividLookup: Lookup | null = null;

export function drawCards(s: GameState, p: number, n: number) {
  const pl = s.players[p];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const top = pl.deck.pop();
    if (top == null) break;
    const c = s.cards[top];
    c.zone = 'hand';
    c.faceUp = true;
    pl.hand.push(top);
    drawn++;
    // ビビッドロー: 自分のターン中、攻撃の前にドローしたら表向きにする
    if (s.active === p && !s.attack && s.phase !== 'over' && (vividLookup?.(c.cid)?.faces[0]?.statics ?? []).some((x) => x.s === 'vivid')) {
      c.vividTurn = s.turn;
      c.revealed = true;
    }
  }
  return drawn;
}

// ---------- ゲーム作成 ----------
export function createGame(init: GameInit, L: Lookup): GameState {
  const s: GameState = {
    mode: init.mode,
    rng: init.seed >>> 0,
    players: [],
    cards: [],
    turn: 1,
    active: 0,
    firstPlayer: 0,
    phase: 'main',
    turnStep: 'start',
    pending: [],
    attack: null,
    log: [],
    winners: [],
    endReason: '',
    seq: 0,
    partnerIids: [],
  };
  const mk = (cid: string, owner: number, zone: ZoneName): number => {
    const iid = s.cards.length;
    s.cards.push({
      iid,
      cid,
      owner,
      zone,
      tapped: false,
      sick: false,
      face: 0,
      under: [],
      parent: null,
      powerMod: 0,
      noAttack: false,
      faceUp: zone === 'hyper' || zone === 'partner',
      revealed: false,
    });
    return iid;
  };
  init.players.forEach((ip, p) => {
    const pl: PlayerState = {
      uid: ip.uid,
      name: ip.name,
      cpu: ip.cpu,
      lost: false,
      place: null,
      deck: [],
      hand: [],
      mana: [],
      battle: [],
      shield: [],
      grave: [],
      hyper: [],
      gr: [],
      partner: [],
      peek: [],
      charged: false,
    };
    s.players.push(pl);
    for (const cid of ip.main || []) pl.deck.push(mk(cid, p, 'deck'));
    for (const cid of ip.hyper || []) pl.hyper.push(mk(cid, p, 'hyper'));
    for (const cid of ip.gr || []) pl.gr.push(mk(cid, p, 'gr'));
    if (ip.partner) {
      const id = mk(ip.partner, p, 'partner');
      pl.partner.push(id);
      s.partnerIids.push(id);
    }
    shuffleArr(s, pl.deck);
    shuffleArr(s, pl.gr);
  });
  const n = init.mode === 'duepa' ? 6 : 5;
  s.players.forEach((pl, p) => {
    for (let i = 0; i < n; i++) {
      const top = pl.deck.pop();
      if (top == null) break;
      s.cards[top].zone = 'shield';
      s.cards[top].faceUp = false;
      pl.shield.push(top);
    }
    drawCards(s, p, n);
  });
  s.firstPlayer = Math.floor(rand(s) * s.players.length);
  s.active = s.firstPlayer;
  log(s, null, `ゲーム開始！ 先攻は ${s.players[s.active].name}`);
  for (const pl of s.players) {
    const starters = pl.deck.filter((i) => L(s.cards[i].cid)?.faces.some((f) => f.kw.startsInPlay));
    if (starters.length)
      log(s, null, `${pl.name}: ゲーム開始時に置くカードがあります (${starters.map((i) => q(L(s.cards[i].cid)!.name)).join('、')}) — 手動で配置してください`);
  }
  startTurn(s, L);
  settle(s, L);
  return s;
}

// ---------- ターン進行 ----------
function startTurn(s: GameState, L: Lookup) {
  const p = s.active;
  const pl = s.players[p];
  pl.charged = false;
  s.phase = 'main';
  s.turnStep = 'start';
  // サイレントスキル: タップしていれば、アンタップするかわりに能力を使ってもよい
  const silent = pl.battle.filter((b) => s.cards[b].tapped && !s.cards[b].noUntap && faceOf(s, L, b)?.silentSkill && programOf(faceOf(s, L, b)!.silentSkill!).complete);
  for (const b of silent) s.cards[b].noUntap = true;
  for (const iid of [...pl.mana, ...pl.battle]) {
    const c = s.cards[iid];
    if (c.noUntap) c.noUntap = false;
    else if (!(c.zone === 'battle' && (faceOf(s, L, iid)?.statics ?? []).some((x) => x.s === 'noUntapStart'))) c.tapped = false;
    c.sick = false;
  }
  for (const b of silent) {
    const f = faceOf(s, L, b)!;
    startExec(s, L, p, b, [
      { op: 'optional', body: programOf(f.silentSkill!).ops, prompt: `サイレントスキル: アンタップするかわりに「${f.silentSkill}」を使う` },
      { op: 'if', cond: { c: 'did' }, body: [], else: [{ op: 'untap', target: { ref: 'self' } }] },
    ], f.name);
  }
  // 「次の○○のターンのはじめまで」の制限を解除
  s.usedOnce = [];
  s.turnTriggers = 0;
  for (const pl2 of s.players) if (pl2.spellLockUntil === p) pl2.spellLockUntil = undefined;
  for (const c of s.cards) {
    if (c.hyperUntil === p) {
      if (c.zone === 'battle') c.face = 0;
      c.hyperUntil = undefined;
    }
    if (c.justDive === p) c.justDive = undefined;
    if (c.restrict && c.restrict.until === p) c.restrict = undefined;
    if (c.grants) c.grants = c.grants.filter((g) => g.until !== p);
  }
  log(s, null, `── ターン${s.turn}: ${pl.name} ──`);
  // 逆転撃: 支払えなければ負け
  for (const d of (s.debts ?? []).filter((x) => x.player === p)) {
    const avail = pl.mana.filter((m) => !s.cards[m].tapped);
    if (avail.length >= d.cost) {
      for (const m of avail.slice(0, d.cost)) s.cards[m].tapped = true;
      log(s, p, `コスト${d.cost}を支払った`);
    } else {
      log(s, p, `コスト${d.cost}を支払えないのでゲームに負けた`);
      pl.lost = true;
    }
  }
  s.debts = (s.debts ?? []).filter((x) => x.player !== p);
  // ターンのはじめの能力 → (advance で) ドロー
  fireWatchers(s, L, p, null, 'turnStartOwn', 'turnStartOpp');
  // 表向きのシールド (ギャラクシールド等) の「自分のターンのはじめに」
  for (const sh of [...pl.shield]) if (s.cards[sh].faceUp) fireSelf(s, L, sh, 0, ['turnStartOwn']);
}

/** ターンのはじめの能力が解決した後のドロー */
function drawStep(s: GameState) {
  const p = s.active;
  const pl = s.players[p];
  s.turnStep = 'main';
  const skipDraw = s.mode === 'duema' && s.turn === 1;
  if (!skipDraw) {
    if (pl.deck.length === 0) lose(s, p, '山札切れ');
    else drawCards(s, p, 1);
  }
}

function beginEndTurn(s: GameState, L: Lookup) {
  s.turnStep = 'ending';
  fireWatchers(s, L, s.active, null, 'turnEndOwn', 'turnEndOpp');
}

/** ターンの終わりの能力が解決した後の後始末 */
function finishEndTurn(s: GameState, L: Lookup) {
  const p = s.active;
  // J・O・E: 山札の下に置いて1枚引く / B・A・D: 破壊する / アビスラッシュ・ウラ・ニンジャ: 山札の下へ
  for (const iid of s.players.flatMap((pl) => [...pl.battle])) {
    const c = s.cards[iid];
    if (c.endOfTurn === 'bad') {
      c.endOfTurn = undefined;
      log(s, p, `B・A・D: ${q(nameOf(s, L, iid))} を破壊`);
      moveCard(s, L, iid, 'grave');
    } else if (c.endOfTurn === 'abyss') {
      c.endOfTurn = undefined;
      log(s, p, `アビスラッシュ: ${q(nameOf(s, L, iid))} を山札の下に置く`);
      moveCard(s, L, iid, 'deck', { pos: 'bottom' });
    } else if (c.endOfTurn === 'joe') {
      c.endOfTurn = undefined;
      log(s, p, `J・O・E: ${q(nameOf(s, L, iid))} を山札の下に置き、カードを1枚引く`);
      moveCard(s, L, iid, 'deck', { pos: 'bottom' });
      drawCards(s, p, 1);
    }
  }
  s.brokeThisTurn = [];
  for (const c of s.cards) {
    c.powerMod = 0;
    c.noAttack = false;
    if (c.grants) c.grants = c.grants.filter((g) => g.until !== -1);
  }
  for (const iid of s.players[p].battle) {
    const f = faceOf(s, L, iid);
    if (f?.kw.untapAtEnd) s.cards[iid].tapped = false;
  }
  // パートナーを表向きに
  for (const iid of s.players[p].partner) {
    const c = s.cards[iid];
    if (!c.faceUp && (c.downTurn ?? 0) < s.turn) {
      c.faceUp = true;
      log(s, p, 'パートナーが表向きになった');
    }
  }
  for (const pl of s.players) pl.peek = [];
  advanceTurn(s, L);
}

function advanceTurn(s: GameState, L: Lookup) {
  if (s.phase === 'over') return;
  let next = s.active;
  for (let i = 0; i < s.players.length; i++) {
    next = (next + 1) % s.players.length;
    if (!s.players[next].lost) break;
  }
  s.active = next;
  s.turn++;
  s.attack = null;
  s.pending = s.pending.filter((x) => x.kind === 'partner' || x.kind === 'ability' || x.kind === 'trigger');
  startTurn(s, L);
}

function offerKirifu(s: GameState, L: Lookup, p: number) {
  const mana = untappedMana(s, p);
  const cands = s.players[p].hand.filter((h) =>
    L(s.cards[h].cid)?.faces.some((f) => (f.statics ?? []).some((x) => x.s === 'kirifu' && x.cost <= mana)),
  );
  if (!cands.length) return;
  s.pending.unshift({
    kind: 'choice',
    player: p,
    mode: 'cards',
    prompt: 'キリフダッシュ: 召喚するクリーチャーを選ぶ (選ばなければ召喚しない)',
    options: cands,
    min: 0,
    max: 1,
    purpose: 'benefit',
    exec: { player: p, src: cands[0], ops: [{ op: 'choose', target: { ref: 'it' }, purpose: 'benefit', prompt: '' }, { op: 'kirifuPlay' }], it: [], looked: [], did: false, name: 'キリフダッシュ' },
  });
}

/**
 * 保留中の処理がなくなったら、止まっていたゲームの流れ (攻撃・ターン進行) を進める。
 * 何か進めたら true。
 */
function advance(s: GameState, L: Lookup): boolean {
  if (s.phase === 'over') return false;
  const top = s.pending[0];
  if (top) {
    if (top.kind === 'ability') {
      // 効果テキストを完全に解釈できた能力は自動で実行 (選択が必要なら 'choice' を積む)
      const prog = programOf(top.effect);
      if (prog.complete) {
        s.pending.shift();
        const nm = L(top.cid)?.faces[top.face]?.name ?? '';
        startExec(s, L, top.player, top.src, prog.ops, q(nm));
        return true;
      }
      if (top.auto) {
        s.pending.shift();
        if (s.cards[top.src]) execAuto(s, L, top.player, top.effect);
        return true;
      }
    }
    return false;
  }
  const a = s.attack;
  if (a) {
    if (s.cards[a.attacker].zone !== 'battle' && (a.step === 'atkTrig' || a.step === 'resolve' || a.step === 'block')) {
      s.attack = null;
      return true;
    }
    if (a.step === 'atkTrig') {
      blockStep(s, L);
      return true;
    }
    if (a.step === 'resolve') {
      resolveAttack(s, L);
      return true;
    }
    if (a.step === 'breaking' || a.step === 'done') {
      s.attack = null;
      // キリフダッシュ: シールドをブレイクした攻撃の終わりに召喚できる
      if (a.broke) offerKirifu(s, L, a.owner);
      // 「攻撃の後、〜」を実行
      const later = s.delayed ?? [];
      s.delayed = [];
      for (const ex of later) runExec(s, L, ex);
      return true;
    }
    return false;
  }
  if (s.turnStep === 'start') {
    drawStep(s);
    return true;
  }
  if (s.turnStep === 'ending') {
    finishEndTurn(s, L);
    return true;
  }
  return false;
}

/** 状態の確認とゲームの流れを落ち着くまで進める */
function settle(s: GameState, L: Lookup) {
  for (let i = 0; i < 200; i++) {
    checkState(s, L);
    if (!advance(s, L)) break;
  }
  checkState(s, L);
}

export function lose(s: GameState, p: number, reason: string) {
  const pl = s.players[p];
  if (pl.lost || s.phase === 'over') return;
  pl.lost = true;
  pl.place = s.players.filter((x) => !x.lost).length + 1;
  log(s, p, `${pl.name} の敗北 (${reason})`);
  s.endReason = reason;
  const alive = s.players.map((_, i) => i).filter((i) => !s.players[i].lost);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winners = alive;
    s.pending = [];
    s.attack = null;
    if (alive.length) {
      s.players[alive[0]].place = 1;
      log(s, alive[0], `${s.players[alive[0]].name} の勝利！`);
    }
    return;
  }
  // デュエパ: 脱落者のカードはゲームから除外
  for (const z of ['battle', 'mana', 'shield', 'hand', 'grave', 'deck', 'partner'] as const) {
    for (const iid of [...pl[z]]) {
      s.cards[iid].zone = 'gone';
    }
    pl[z] = [];
  }
  s.pending = s.pending.filter((x) => x.player !== p);
  if (s.attack && (s.attack.targetPlayer === p || s.attack.owner === p)) s.attack = null;
}

function checkState(s: GameState, L: Lookup) {
  if (s.phase === 'over') return;
  for (let p = 0; p < s.players.length; p++) {
    const pl = s.players[p];
    if (pl.lost) continue;
    if (pl.deck.length === 0) lose(s, p, '山札切れ');
  }
  if ((s.phase as string) === 'over') return;
  // パワー0以下のクリーチャーは破壊
  for (const pl of s.players) {
    for (const iid of [...pl.battle]) {
      const f = faceOf(s, L, iid);
      if (f?.isCreature && f.power != null && power(s, L, iid) <= 0) {
        log(s, s.cards[iid].owner, `${q(nameOf(s, L, iid))} はパワー0以下で破壊された`);
        moveCard(s, L, iid, 'grave');
      }
    }
  }
  if (s.players[s.active].lost) advanceTurn(s, L);
}

// ---------- マナ ----------
/** 文明条件を満たすか (マナの各カードは1つの文明しか出せない) */
/** マナとして出す文明 (裏向きのマナは文明を持たない) */
export function manaCivs(s: GameState, L: Lookup, iid: number): Civ[] {
  const c = s.cards[iid];
  return c.zone === 'mana' && c.manaDown ? [] : cardCivs(L, c.cid);
}

export function payCovers(L: Lookup, s: GameState, pay: number[], need: Civ[]): boolean {
  if (pay.length < need.length) return need.length === 0;
  const rainbow = pay.length > 0 && rainbowMana(s, L, s.cards[pay[0]].owner);
  const opts = pay.map((i) => (rainbow ? ALL_CIVS : manaCivs(s, L, i)));
  const used = new Array(pay.length).fill(false);
  const go = (k: number): boolean => {
    if (k === need.length) return true;
    for (let i = 0; i < opts.length; i++) {
      if (!used[i] && opts[i].includes(need[k])) {
        used[i] = true;
        if (go(k + 1)) return true;
        used[i] = false;
      }
    }
    return false;
  };
  return go(0);
}

/** 支払いに使うマナを自動選択 (足りなければ null) */
export function autoPay(s: GameState, L: Lookup, p: number, need: Civ[], cost: number): number[] | null {
  const avail = s.players[p].mana.filter((i) => !s.cards[i].tapped);
  if (avail.length < cost) return null;
  if (cost === 0) return [];
  const rainbow = rainbowMana(s, L, p);
  const civsOf = (i: number) => (rainbow ? ALL_CIVS : manaCivs(s, L, i));
  // 必要文明を少ない文明のカードから優先で確保
  const chosen: number[] = [];
  const pool = [...avail].sort((a, b) => civsOf(a).length - civsOf(b).length);
  for (const civ of need) {
    const idx = pool.findIndex((i) => civsOf(i).includes(civ));
    if (idx < 0) return null;
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  // 残りは必要文明に関係ないカードから
  pool.sort((a, b) => {
    const ra = civsOf(a).some((c) => need.includes(c)) ? 1 : 0;
    const rb = civsOf(b).some((c) => need.includes(c)) ? 1 : 0;
    return ra - rb || civsOf(b).length - civsOf(a).length;
  });
  while (chosen.length < cost && pool.length) chosen.push(pool.shift()!);
  if (chosen.length < cost) return null;
  return payCovers(L, s, chosen, need) ? chosen.slice(0, cost) : null;
}

export const untappedMana = (s: GameState, p: number) => s.players[p].mana.filter((i) => !s.cards[i].tapped).length;

// ---------- 攻撃関連 ----------
export function canAttackWith(s: GameState, L: Lookup, iid: number): boolean {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  if (!f?.isCreature || c.zone !== 'battle' || c.tapped || c.noAttack || c.restrict?.attack || isSealed(s, iid)) return false;
  const k = kwOf(s, L, iid);
  if (c.sick && !k.speedAttacker && !k.machFighter && !ownStatics(s, L, iid).some((x) => x.s === 'hastePlayer')) return false;
  return true;
}

export function attackTargets(s: GameState, L: Lookup, iid: number): { players: number[]; cards: number[] } {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  if (!f) return { players: [], cards: [] };
  const opps = opponentsOf(s, c.owner);
  const k = kwOf(s, L, iid);
  const mine = ownStatics(s, L, iid);
  const sickOnlyMach = c.sick && !k.speedAttacker && !mine.some((x) => x.s === 'hastePlayer');
  const players = sickOnlyMach || k.cantAttackPlayer ? [] : opps.filter((o) => o !== c.restrict?.noAttackPlayer);
  const cards: number[] = [];
  // 出たターンにプレイヤーだけ攻撃できる (マッハファイターでなければクリーチャーは攻撃できない)
  if (c.sick && !k.speedAttacker && !k.machFighter) return { players, cards };
  if (mine.some((x) => x.s === 'cantAttackCreatures')) return { players, cards };
  const untappedOk = (k.machFighter && c.sick) || mine.some((x) => x.s === 'attackUntapped');
  for (const o of opps)
    for (const t of s.players[o].battle) {
      const tf = faceOf(s, L, t);
      if (!tf?.isCreature) continue;
      const tc = s.cards[t];
      if (tc.justDive != null || isSealed(s, t) || ownStatics(s, L, t).some((x) => x.s === 'noAttacked')) continue;
      if (tc.tapped || untappedOk) cards.push(t);
    }
  return { players, cards };
}

function attackOptions(s: GameState, L: Lookup): number[] {
  const a = s.attack!;
  const owner = a.owner;
  const att = L(s.cards[a.attacker].cid);
  const attFace = faceOf(s, L, a.attacker);
  if (!att || !attFace) return [];
  return s.players[owner].hand.filter((h) => {
    const card = L(s.cards[h].cid);
    if (!card) return false;
    return card.faces.some(
      (f) => (f.kw.revChange && matchesCond(f.kw.revChange, att, attFace)) || (f.kw.invasion && matchesCond(f.kw.invasion, att, attFace)),
    );
  });
}

/** 攻撃する時の能力を発動 (解決後に advance がブロックへ進める) */
function queueAttackTriggers(s: GameState, L: Lookup) {
  const a = s.attack!;
  a.step = 'atkTrig';
  fireSelf(s, L, a.attacker, s.cards[a.attacker].face, ['attack']);
  for (const u of s.cards[a.attacker].under) fireSelf(s, L, u, 0, ['crossAttack']);
  fireWatchers(s, L, a.owner, null, 'ownAttack', 'oppAttack', a.attacker);
  if (a.targetCard != null) fireSelf(s, L, a.targetCard, s.cards[a.targetCard].face, ['attacked']);
  // ウラ・ニンジャ・ストライク: 攻撃された側の手札から
  s.players.forEach((pl, dp) => {
    if (dp === a.owner || pl.lost) return;
    for (const h of pl.hand) {
      const hc = s.cards[h];
      const f = L(hc.cid)?.faces[0];
      const un = (f?.statics ?? []).find((x) => x.s === 'uraNinja');
      if (!f || !un || un.s !== 'uraNinja' || a.ninjaUsed) continue;
      if (pl.mana.length < un.n) continue;
      if (un.civ && !pl.mana.some((m) => cardCivs(L, s.cards[m].cid).some((c) => CIV_NAME[c] === un.civ))) continue;
      s.pending.push({ kind: 'ability', player: dp, src: h, cid: hc.cid, face: 0, event: 'oppAttack', text: `ウラ・ニンジャ・ストライク: ${f.name}`, effect: 'このクリーチャーをコストを支払わずに召喚してもよい。そのターンの終わりに、このクリーチャーを山札の下に置く', optional: true, auto: false });
    }
  });
  // アタック・チャンス: 手札の呪文をコストを支払わずに唱えてもよい
  for (const h of s.players[a.owner].hand) {
    const hc = s.cards[h];
    const card = L(hc.cid);
    card?.faces.forEach((f, fi) => {
      const ac = (f.statics ?? []).find((x) => x.s === 'attackChance');
      if (!ac || ac.s !== 'attackChance' || !f.isSpell || !matchesSel(s, L, a.attacker, { ...ac.sel, zones: ['battle'] })) return;
      const eff = 'この呪文をコストを支払わずに唱えてもよい';
      s.pending.push({ kind: 'ability', player: a.owner, src: h, cid: hc.cid, face: fi, event: 'ownAttack', text: `アタック・チャンス: ${f.name}`, effect: eff, optional: true, auto: false });
    });
  }
}

function blockStep(s: GameState, L: Lookup) {
  const a = s.attack!;
  a.step = 'block';
  const def = a.targetPlayer;
  const attFace = faceOf(s, L, a.attacker);
  const blockers = attFace && kwOf(s, L, a.attacker).unblockable
    ? []
    : s.players[def].battle.filter((b) => {
        const f = faceOf(s, L, b);
        if (!(f?.isCreature && kwOf(s, L, b).blocker && !s.cards[b].tapped && !s.cards[b].restrict?.block && b !== a.targetCard)) return false;
        // 「パワーN以下のクリーチャーにブロックされない」等
        const ap = power(s, L, a.attacker, true);
        return !ownStatics(s, L, a.attacker).some(
          (x) => x.s === 'unblockableBy' && ((x.maxPower != null && power(s, L, b) <= x.maxPower) || (x.smallerThanSelf && power(s, L, b) < ap)),
        );
      });
  const manaCount = s.players[def].mana.length;
  const ninjas = s.players[def].hand.filter((h) => {
    const card = L(s.cards[h].cid);
    return card?.faces.some((f) => f.isCreature && f.kw.ninjaStrike != null && f.kw.ninjaStrike <= manaCount);
  });
  // ガードマン: 自分の他のクリーチャーが攻撃される時、かわりにこのクリーチャーを攻撃させる
  const guards =
    a.targetCard != null
      ? s.players[def].battle.filter((b) => b !== a.targetCard && !s.cards[b].tapped && (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'guardman'))
      : [];
  if (blockers.length || ninjas.length || guards.length) {
    s.pending.unshift({ kind: 'block', player: def, blockers, ninjas, guards });
  } else resolveAttack(s, L);
}

export function battle(s: GameState, L: Lookup, att: number, def: number) {
  const blocking = s.attack?.blocked === def;
  const pa = power(s, L, att, s.attack?.attacker === att, { inBattle: true });
  const pd = power(s, L, def, false, { inBattle: true, blocking });
  const na = nameOf(s, L, att);
  const nd = nameOf(s, L, def);
  log(s, null, `バトル: ${q(na)}(${pa}) vs ${q(nd)}(${pd})`);
  const fa = faceOf(s, L, att)!;
  const fd = faceOf(s, L, def)!;
  let killA = pa <= pd;
  let killD = pd <= pa;
  if (killA && kwOf(s, L, att).slayer) killD = true;
  if (killD && kwOf(s, L, def).slayer) killA = true;
  void fa;
  void fd;
  s.inBattleNow = true;
  if (killD) {
    log(s, null, `${q(nd)} は破壊された`);
    moveCard(s, L, def, 'grave');
  }
  if (killA) {
    log(s, null, `${q(na)} は破壊された`);
    moveCard(s, L, att, 'grave');
  }
  s.inBattleNow = false;
  if (killD && !killA) fireSelf(s, L, att, s.cards[att].face, ['winBattle']);
  if (killA && !killD) fireSelf(s, L, def, s.cards[def].face, ['winBattle']);
}

export function breakShields(s: GameState, L: Lookup, target: number, shields: number[], by: number | null, breaker: number | null = null) {
  const pl = s.players[target];
  if (breaker != null && s.attack) s.attack.broke = true;
  for (const sh of shields) {
    if (s.cards[sh].zone !== 'shield') continue;
    // シールド・セイバー: かわりにこのクリーチャーを破壊
    const saver = pl.battle.find((b) => (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'shieldSaver'));
    if (saver != null) {
      log(s, target, `シールド・セイバー: ${q(nameOf(s, L, saver))} がシールドのかわりに破壊される`);
      moveCard(s, L, saver, 'grave');
      continue;
    }
    moveCard(s, L, sh, 'hand');
    const card = L(s.cards[sh].cid);
    const trigger = !!card?.faces.some((f) => f.kw.shieldTrigger);
    const strike = !!card?.faces.some((f) => f.kw.gStrike);
    if (trigger || strike) s.pending.push({ kind: 'trigger', player: target, iid: sh, strike, trigger });
  }
  log(s, by, `${pl.name} のシールドを${shields.length}枚ブレイク`);
  if (breaker != null && s.cards[breaker].zone === 'battle') fireSelf(s, L, breaker, s.cards[breaker].face, ['breakShield']);
  fireWatchers(s, L, target, null, 'ownShieldBroken', null);
}

function resolveAttack(s: GameState, L: Lookup) {
  const a = s.attack!;
  if (s.cards[a.attacker].zone !== 'battle') {
    s.attack = null;
    return;
  }
  // 「バトルする時」「ブロックされなかった時」の能力を先に解決する
  if (!a.preFired) {
    a.preFired = true;
    const before = s.pending.length;
    const foe = a.blocked ?? a.targetCard;
    if (foe != null) {
      if (s.cards[foe].zone === 'battle') {
        fireSelf(s, L, a.attacker, s.cards[a.attacker].face, ['battle']);
        fireSelf(s, L, foe, s.cards[foe].face, ['battle']);
      }
    } else {
      fireSelf(s, L, a.attacker, s.cards[a.attacker].face, ['unblocked']);
      fireWatchers(s, L, a.owner, null, null, 'oppUnblocked');
    }
    if (s.pending.length > before) {
      a.step = 'resolve';
      return;
    }
  }
  if (a.blocked != null) {
    a.step = 'done';
    if (s.cards[a.blocked].zone === 'battle') battle(s, L, a.attacker, a.blocked);
    return;
  }
  if (a.targetCard != null) {
    a.step = 'done';
    if (s.cards[a.targetCard].zone === 'battle') battle(s, L, a.attacker, a.targetCard);
    return;
  }
  const def = s.players[a.targetPlayer];
  if (def.lost) {
    s.attack = null;
    return;
  }
  if (def.shield.length === 0) {
    log(s, a.owner, `${q(nameOf(s, L, a.attacker))} のダイレクトアタック！`);
    s.attack = null;
    lose(s, a.targetPlayer, 'ダイレクトアタック');
    return;
  }
  const n = Math.min(breakCount(s, L, a.attacker), def.shield.length);
  if (n > 0) (s.brokeThisTurn ??= []).push(a.attacker);
  a.step = 'breaking';
  if (n < def.shield.length) {
    s.pending.unshift({ kind: 'breakSel', player: a.owner, target: a.targetPlayer, count: n });
  } else {
    breakShields(s, L, a.targetPlayer, [...def.shield], a.owner, a.attacker);
  }
}

// ---------- アクション適用 ----------
type Result = string | null; // エラーメッセージ or null

const MANUAL = new Set([
  'move',
  'tap',
  'draw',
  'shuffle',
  'peekTop',
  'peekEnd',
  'shieldFromDeck',
  'manaFromDeck',
  'mill',
  'breakManual',
  'power',
  'flip',
  'stack',
  'grSummon',
  'discardRandom',
  'reveal',
  'noAttack',
  'note',
  'concede',
]);

export function isManual(a: Action) {
  return MANUAL.has(a.t);
}

/** アクションを適用する。不正なら状態を変えずにエラー文字列を返す。 */
export function applyAction(s0: GameState, p: number, a: Action, L: Lookup): { state: GameState; error: Result } {
  const s = structuredClone(s0);
  vividLookup = L;
  try {
    const err = apply(s, p, a, L);
    if (err) return { state: s0, error: err };
    s.seq++;
    settle(s, L);
  } catch (e) {
    // 想定外のエラーでも全員が同じ結果 (この操作は無効) になるようにする
    console.error(e);
    return { state: s0, error: `内部エラー: ${(e as Error).message}` };
  }
  return { state: s, error: null };
}

function apply(s: GameState, p: number, a: Action, L: Lookup): Result {
  if (s.phase === 'over') return 'ゲームは終了しています';
  const me = s.players[p];
  if (!me || me.lost) return '操作できません';
  if (isManual(a)) return applyManual(s, p, a, L);
  // 「コストを支払わずに使う」は効果の処理中 (能力の解決待ち等) でも自分のカードなら使える
  if (a.t === 'play' && a.free) return playCard(s, p, a, L);

  const top: Pending | undefined = s.pending[0];
  if (top) {
    if (top.player !== p) return '相手の選択を待っています';
    return applyPending(s, p, a, top, L);
  }
  if (s.active !== p) return 'あなたのターンではありません';

  switch (a.t) {
    case 'charge': {
      if (me.charged) return 'このターンは既にマナチャージしました';
      if (s.turnStep !== 'main') return '今はマナチャージできません';
      if (s.phase !== 'main') return '攻撃中はマナチャージできません';
      const c = s.cards[a.iid];
      if (c.owner !== p || c.zone !== 'hand') return '手札のカードを選んでください';
      moveCard(s, L, a.iid, 'mana', { tapped: entersManaTapped(L, c.cid) });
      me.charged = true;
      log(s, p, `${q(nameOf(s, L, a.iid))} をマナチャージ`);
      return null;
    }
    case 'play': {
      if (s.turnStep !== 'main') return '今は使えません';
      if (s.phase !== 'main' && !a.force) return '攻撃を始めた後は召喚・呪文の使用はできません (手動操作は可能)';
      return playCard(s, p, a, L);
    }
    case 'attack': {
      const c = s.cards[a.attacker];
      if (c.owner !== p || c.zone !== 'battle') return '自分のクリーチャーを選んでください';
      const f = faceOf(s, L, a.attacker);
      if (s.turnStep !== 'main') return '今は攻撃できません';
      if (!a.force) {
        if (!canAttackWith(s, L, a.attacker)) return 'このクリーチャーは攻撃できません';
        if (f?.kw.cantAttack) return 'このクリーチャーは攻撃できません (テキスト)';
        const tg = attackTargets(s, L, a.attacker);
        if (a.card != null ? !tg.cards.includes(a.card) : !tg.players.includes(a.player)) return 'その対象は攻撃できません';
        const lures = luresFor(s, L, a.attacker);
        if (lures.length && !(a.card != null && lures.includes(a.card))) return `可能なら ${q(nameOf(s, L, lures[0]))} を攻撃しなければなりません`;
      }
      const targetPlayer = a.card != null ? s.cards[a.card].owner : a.player;
      if (targetPlayer === p || s.players[targetPlayer]?.lost) return '攻撃対象が不正です';
      c.tapped = true;
      fireSelf(s, L, a.attacker, c.face, ['tapped']);
      s.phase = 'attack';
      s.attack = { attacker: a.attacker, owner: p, targetPlayer, targetCard: a.card ?? null, blocked: null, step: 'opt' };
      log(
        s,
        p,
        `${q(nameOf(s, L, a.attacker))} で ${a.card != null ? q(nameOf(s, L, a.card)) : s.players[targetPlayer].name} を攻撃`,
      );
      const opts = attackOptions(s, L);
      if (opts.length) s.pending.unshift({ kind: 'attackOpt', player: p, options: opts });
      else queueAttackTriggers(s, L);
      return null;
    }
    case 'hyperize': {
      const c = s.cards[a.iid];
      if (c.owner !== p || c.zone !== 'battle') return '自分のクリーチャーを選んでください';
      if (s.turnStep !== 'main' || s.attack) return '今はハイパー化できません';
      const card = L(c.cid);
      const hz = card?.faces[0].statics.find((x) => x.s === 'hyperize');
      if (!card?.hyper || !hz || hz.s !== 'hyperize' || c.face !== 0) return 'ハイパー化できません';
      const taps = [...new Set(a.taps)];
      if (taps.length !== hz.n || taps.some((b) => b === a.iid || s.cards[b].owner !== p || s.cards[b].zone !== 'battle' || s.cards[b].tapped || !faceOf(s, L, b)?.isCreature))
        return `タップしていない自分の他のクリーチャーを${hz.n}体選んでください`;
      for (const b of taps) s.cards[b].tapped = true;
      c.face = 1;
      log(s, p, `ハイパー化: ${q(card.faces[0].name)} (${taps.map((b) => q(nameOf(s, L, b))).join('、')} をタップ)`);
      return null;
    }
    case 'cross': {
      const g = s.cards[a.iid];
      const onto = s.cards[a.onto];
      const gf = faceOf(s, L, a.iid);
      if (g.owner !== p || !gf || !/クロスギア/.test(gf.type)) return '自分のクロスギアを選んでください';
      if (g.zone !== 'battle' && g.zone !== 'under') return 'バトルゾーンにあるクロスギアを選んでください';
      if (!onto || onto.owner !== p || onto.zone !== 'battle' || !faceOf(s, L, a.onto)?.isCreature) return 'クロスする自分のクリーチャーを選んでください';
      if (g.parent === a.onto) return '既にそのクリーチャーにクロスしています';
      if (s.turnStep !== 'main' || s.attack) return '今はクロスできません';
      const cost = crossCost(s, L, a.iid, a.onto);
      for (const m of a.pay) {
        const mc = s.cards[m];
        if (mc.owner !== p || mc.zone !== 'mana' || mc.tapped) return 'マナの選択が不正です';
      }
      if (new Set(a.pay).size !== a.pay.length || a.pay.length !== cost) return `コスト${cost}分のマナを選んでください`;
      if (cost > 0 && !payCovers(L, s, a.pay, gf.civs)) return '文明が足りません';
      for (const m of a.pay) s.cards[m].tapped = true;
      if (g.zone === 'under' && g.parent != null) s.cards[g.parent].under = s.cards[g.parent].under.filter((u) => u !== a.iid);
      else s.players[p].battle = s.players[p].battle.filter((b) => b !== a.iid);
      g.zone = 'under';
      g.parent = a.onto;
      onto.under.push(a.iid);
      log(s, p, `${q(gf.name)} を ${q(nameOf(s, L, a.onto))} にクロスした`);
      return null;
    }
    case 'tapAbility': {
      const c = s.cards[a.iid];
      const f = faceOf(s, L, a.iid);
      if (c.owner !== p || c.zone !== 'battle' || !f?.tapAbility) return 'タップして使う能力がありません';
      if (s.turnStep !== 'main' || s.attack) return '今は使えません';
      if (c.tapped) return 'タップしているクリーチャーは使えません';
      if (c.sick && !kwOf(s, L, a.iid).speedAttacker) return '召喚酔いしているので使えません';
      c.tapped = true;
      fireSelf(s, L, a.iid, c.face, ['tapped']);
      log(s, p, `${q(f.name)} をタップして能力を使った`);
      pushAbility(s, L, a.iid, c.face, { events: ['tapAbility'], text: f.tapAbility, effect: f.tapAbility, optional: false, auto: false }, 'tapAbility');
      return null;
    }
    case 'endTurn': {
      if (s.attack) return '攻撃の処理中です';
      if (s.turnStep !== 'main') return '今はターンを終了できません';
      const must = mustAttackers(s, L, p);
      if (must.length) return `${q(nameOf(s, L, must[0]))} は可能なら攻撃しなければなりません`;
      log(s, p, 'ターン終了');
      beginEndTurn(s, L);
      return null;
    }
    default:
      return '今は実行できない操作です';
  }
}

/** 召喚・呪文の最終的なコスト (常在型能力 + ササゲール/ハイパーエナジー/G・ゼロ)。不正なら理由の文字列 */
export function playCost(s: GameState, L: Lookup, p: number, a: Extract<Action, { t: 'play' }>, fi: number): number | string {
  const c = s.cards[a.iid];
  const face = L(c.cid)!.faces[fi];
  const statics = face.statics ?? [];
  if (a.alt === 'joe' || a.alt === 'bad') {
    const d = statics.find((x) => x.s === 'discountSummon');
    if (!d || d.s !== 'discountSummon' || d.kind !== a.alt) return 'この召喚方法は使えません';
    return Math.max(1, costOf(s, L, p, a.iid, fi) - d.n);
  }
  if (a.alt === 'mana') {
    const d = statics.find((x) => x.s === 'manaBakutan');
    if (!d || d.s !== 'manaBakutan' || c.zone !== 'mana') return 'マナ爆誕は使えません';
    return d.cost;
  }
  if (a.alt === 'mugen') {
    const d = statics.find((x) => x.s === 'mugen');
    if (!d || d.s !== 'mugen' || (c.zone !== 'hand' && c.zone !== 'grave')) return 'ムゲンクライムは使えません';
    const taps = [...new Set(a.taps ?? [])];
    if (taps.length !== d.n || taps.some((b) => b === a.iid || s.cards[b].owner !== p || s.cards[b].zone !== 'battle' || s.cards[b].tapped || !faceOf(s, L, b)?.isCreature))
      return `タップしていない自分のクリーチャーを${d.n}体選んでください`;
    return d.cost;
  }
  if (a.alt === 'vivid') {
    const d = statics.find((x) => x.s === 'vivid');
    if (!d || d.s !== 'vivid' || c.vividTurn !== s.turn || c.zone !== 'hand') return 'ビビッドローは使えません';
    return d.cost;
  }
  if (a.alt === 'tapCast') {
    const d = statics.find((x) => x.s === 'tapCast');
    if (!d || d.s !== 'tapCast') return 'この方法では使えません';
    const taps = [...new Set(a.taps ?? [])];
    if (taps.length !== d.n || taps.some((b) => b === a.iid || s.cards[b].owner !== p || s.cards[b].zone !== 'battle' || s.cards[b].tapped || !matchesSel(s, L, b, d.sel)))
      return `タップしていない条件に合う自分のクリーチャーを${d.n}体選んでください`;
    return 0;
  }
  if (a.alt === 'galaxy') {
    const d = statics.find((x) => x.s === 'galaxy');
    if (!d || d.s !== 'galaxy' || c.zone !== 'hand') return 'ギャラクシールドは使えません';
    return d.cost;
  }
  if (a.alt === 'fushigi') {
    const d = statics.find((x) => x.s === 'fushigi');
    if (!d || d.s !== 'fushigi' || c.zone !== 'grave') return 'フシギバースは使えません';
    const b = a.taps?.[0];
    const bf = b != null ? faceOf(s, L, b) : undefined;
    if (b == null || a.taps!.length !== 1 || !bf?.isCreature || s.cards[b].owner !== p || s.cards[b].zone !== 'battle') return 'マナゾーンに置く自分のクリーチャーを1体選んでください';
    return Math.max(1, d.n - bf.cost);
  }
  if (a.alt === 'abyss') {
    if (!statics.some((x) => x.s === 'abyss') || c.zone !== 'grave') return 'アビスラッシュは使えません';
    return costOf(s, L, p, a.iid, fi);
  }
  if (a.alt === 'kirifu') {
    const d = statics.find((x) => x.s === 'kirifu');
    if (!d || d.s !== 'kirifu') return 'キリフダッシュは使えません';
    return d.cost;
  }
  if (a.gzero) {
    const g = statics.find((x) => x.s === 'gzero');
    if (!g || g.s !== 'gzero') return 'G・ゼロを使えません';
    const n = s.players[p].battle.filter((b) => g.cond.c === 'countAtLeast' && matchesSel(s, L, b, g.cond.sel)).length;
    if (g.cond.c === 'countAtLeast' && n < g.cond.n) return 'G・ゼロの条件を満たしていません';
    return 0;
  }
  let cost = costOf(s, L, p, a.iid, fi);
  const bz = statics.find((x) => x.s === 'buzz');
  if (a.buzz && bz && bz.s === 'buzz') cost += a.buzz * bz.n;
  // ソウルシフト: 進化元のコストだけ少なく / NEO進化として召喚するならN少なく
  const base = a.evo?.find((b) => s.cards[b]?.owner === p);
  if (base != null && statics.some((x) => x.s === 'soulShift')) cost = Math.max(1, cost - (faceOf(s, L, base)?.cost ?? 0));
  const neo = statics.find((x) => x.s === 'neoDiscount');
  if (base != null && neo && neo.s === 'neoDiscount') cost = Math.max(0, cost - neo.n);
  if (a.sasa?.length) {
    if (!statics.some((x) => x.s === 'sasageru')) return 'このクリーチャーはササゲールで召喚できません';
    const costs = new Set<number>();
    let red = 0;
    for (const b of a.sasa) {
      const bc = s.cards[b];
      const bf = faceOf(s, L, b);
      const ss = bf?.statics?.find((x) => x.s === 'sasageru');
      if (!bf || bc.owner !== p || bc.zone !== 'battle' || !ss || ss.s !== 'sasageru') return 'ササゲールを持つ自分のクリーチャーを選んでください';
      if (costs.has(bf.cost)) return 'ササゲールはコストが異なるクリーチャーを選んでください';
      costs.add(bf.cost);
      red += ss.n;
    }
    cost = Math.max(Math.min(cost, 1), cost - red);
  }
  if (a.he?.length) {
    if (!statics.some((x) => x.s === 'hyperEnergy')) return 'このクリーチャーはハイパーエナジーを持っていません';
    const costs = new Set<number>();
    for (const b of a.he) {
      const bc = s.cards[b];
      const bf = faceOf(s, L, b);
      if (!bf?.isCreature || bc.owner !== p || bc.zone !== 'battle' || bc.tapped || b === a.iid) return 'タップしていない自分のクリーチャーを選んでください';
      if (costs.has(bf.cost)) return 'ハイパーエナジーはコストが異なるクリーチャーを選んでください';
      costs.add(bf.cost);
    }
    cost = Math.max(Math.min(cost, 1), cost - 2 * a.he.length);
  }
  return cost;
}

export function playCard(s: GameState, p: number, a: Extract<Action, { t: 'play' }>, L: Lookup): Result {
  const c = s.cards[a.iid];
  const card = L(c.cid);
  if (!card) return 'カード情報がありません';
  const fromZones = ['hand', 'mana', 'grave', 'hyper', 'shield', 'deck', 'partner'];
  if (c.owner !== p || !fromZones.includes(c.zone)) return 'このカードは使えません';
  const face = card.faces[a.face] ?? card.faces[0];
  const fromOk =
    c.zone === 'hand' ||
    c.zone === 'partner' ||
    (face.isCreature && (face.statics ?? []).some((x) => x.s === 'summonFrom' && x.zone === c.zone)) ||
    (a.alt === 'mana' && c.zone === 'mana') ||
    (a.alt === 'mugen' && c.zone === 'grave') ||
    ((a.alt === 'fushigi' || a.alt === 'abyss') && c.zone === 'grave');
  if (!fromOk && !a.free && !a.force) return '手札以外から使う場合は「コストを支払わずに使う」を選んでください';
  if (c.zone === 'partner' && !c.faceUp) return '裏向きのパートナーは召喚できません';
  if (c.zone === 'partner' && !face.isCreature) return 'パートナーの呪文側は唱えられません';
  // 支払い
  if (!a.free) {
    const me = s.players[p];
    for (const m of a.pay) {
      const mc = s.cards[m];
      if (mc.owner !== p || mc.zone !== 'mana' || mc.tapped) return 'マナの選択が不正です';
    }
    if (new Set(a.pay).size !== a.pay.length) return 'マナの選択が不正です';
    const fi = card.faces.indexOf(face);
    const cost = playCost(s, L, p, a, fi);
    if (typeof cost === 'string') return cost;
    const crystal = (face.statics ?? []).find((x) => x.s === 'crystalSoul');
    if (!a.force && crystal && crystal.s === 'crystalSoul') {
      // 水晶ソウル: 裏向きのマナはN枚分
      const val = a.pay.reduce((n, m) => n + (s.cards[m].manaDown ? crystal.n : 1), 0);
      if (val < cost || a.pay.length > cost) return `コスト${cost}分のマナを選んでください (裏向きのマナは${crystal.n}枚分)`;
      const up = a.pay.filter((m) => !s.cards[m].manaDown);
      if (!payCovers(L, s, up.length ? up : a.pay, face.civs)) return '文明が足りません';
    } else if (!a.force) {
      if (a.pay.length !== cost) return `コスト${cost}分のマナを選んでください`;
      if (cost > 0 && !payCovers(L, s, a.pay, face.civs)) return '文明が足りません';
    }
    void me;
    for (const m of a.pay) s.cards[m].tapped = true;
    // ササゲール: 破壊 / ハイパーエナジー: タップ
    for (const b of a.sasa ?? []) {
      log(s, p, `ササゲール: ${q(nameOf(s, L, b))} を破壊`);
      moveCard(s, L, b, 'grave');
    }
    for (const b of a.he ?? []) s.cards[b].tapped = true;
    if (a.alt === 'tapCast') {
      for (const b of a.taps ?? []) s.cards[b].tapped = true;
      log(s, p, `${(a.taps ?? []).length}体タップして、コストを支払うかわりにした`);
    }
    if (a.alt === 'mugen') {
      for (const b of a.taps ?? []) s.cards[b].tapped = true;
      log(s, p, `ムゲンクライム: ${(a.taps ?? []).length}体タップ`);
    }
    if (a.alt === 'fushigi') {
      const b = a.taps![0];
      log(s, p, `フシギバース: ${q(nameOf(s, L, b))} をマナゾーンに置く`);
      moveCard(s, L, b, 'mana', { tapped: true });
    }
    if (a.alt === 'galaxy') {
      log(s, p, `ギャラクシールド: ${q(face.name)} を表向きのシールドとして置いた`);
      moveCard(s, L, a.iid, 'shield', { faceUp: true });
      return null;
    }
    if (a.he?.length) log(s, p, `ハイパーエナジー: ${a.he.length}体タップ`);
  }
  const name = face.name;
  const how = a.free ? '(コストを支払わずに)' : '';
  if (face.isCreature && !a.force) {
    // エグザイル: 名前に《X》とある他のエグザイル・クリーチャーは出せない
    const mine = s.players[p].battle.filter((b) => b !== a.iid);
    const limits = [...mine.flatMap((b) => (faceOf(s, L, b)?.statics ?? []).map((x) => ({ x, b }))), ...(face.statics ?? []).map((x) => ({ x, b: -1 }))];
    for (const { x, b } of limits) {
      if (x.s !== 'exileLimit') continue;
      const clash = b >= 0 ? face.name.includes(x.name) && /エグザイル/.test(face.type) : mine.some((m) => (faceOf(s, L, m)?.name ?? '').includes(x.name) && /エグザイル/.test(faceOf(s, L, m)?.type ?? ''));
      if (clash) return `名前に《${x.name}》とあるエグザイル・クリーチャーは同時に出せません`;
    }
  }
  if (face.isCreature) {
    let bases: number[] = [];
    if (face.isEvolution) {
      const ef = (face.statics ?? []).find((x) => x.s === 'evoFrom');
      const baseZone = ef && ef.s === 'evoFrom' ? ef.zone : 'battle';
      bases = (a.evo ?? []).filter((b) => s.cards[b]?.zone === baseZone && s.cards[b].owner === p && b !== a.iid);
      // NEO進化・G-NEO進化は進化元なしでも召喚できる
      if (!bases.length && !a.force && !/NEO/.test(face.type)) return '進化元のクリーチャーを選んでください';
      // 進化GV / 超無限進化: 必要な数の進化元
      const em = (face.statics ?? []).find((x) => x.s === 'evoMulti');
      if (em && em.s === 'evoMulti' && !a.force) {
        if (bases.length < em.min || (em.exact && bases.length !== em.min)) return `進化元を${em.min}体${em.exact ? '' : '以上'}選んでください`;
        if (bases.some((b) => !matchesSel(s, L, b, em.sel))) return '進化元の条件に合わないクリーチャーがあります';
      }
    }
    const wasTapped = bases.some((b) => s.cards[b].tapped);
    log(s, p, `${q(name)} を${bases.length ? '進化' : ''}召喚${how}${a.alt === 'joe' ? ' (J・O・E)' : a.alt === 'bad' ? ' (B・A・D)' : a.alt === 'mana' ? ' (マナ爆誕)' : a.alt === 'kirifu' ? ' (キリフダッシュ)' : a.alt === 'mugen' ? ' (ムゲンクライム)' : ''}`);
    c.buzz = a.buzz;
    moveCard(s, L, a.iid, 'battle', { face: card.faces.indexOf(face) });
    if (a.alt === 'joe' || a.alt === 'bad') c.endOfTurn = a.alt;
    s.players[p].lastPlay = { turn: s.turn, kind: 'creature' };
    if (a.alt === 'abyss') {
      c.endOfTurn = 'abyss';
      (c.grants ??= []).push({ kws: ['スピードアタッカー'], until: -1 });
    }
    if (bases.length) {
      for (const b of bases) {
        const bc = s.cards[b];
        const subs = [b, ...bc.under];
        detach(s, b);
        for (const x of subs) {
          if (x !== b) {
            s.cards[x].parent = null;
          }
          s.cards[x].zone = 'under';
          s.cards[x].parent = a.iid;
          resetCard(s.cards[x]);
        }
        bc.under = [];
        c.under.push(...subs);
      }
      c.sick = false; // 進化クリーチャーは召喚酔いしない
      c.tapped = wasTapped;
    }
    if (face.kw.exLife) {
      const top = s.players[p].deck.pop();
      if (top != null) {
        s.cards[top].zone = 'shield';
        s.cards[top].faceUp = false;
        s.players[p].shield.push(top);
        c.exShield = top;
        log(s, p, 'EXライフ: 山札の上から1枚をシールドに追加');
      }
    }
  } else if (face.isSpell) {
    const me = s.players[p];
    if (me.spellLockUntil != null || me.spellLockTurn === s.turn) {
      if (!a.force) return 'このターンは呪文を唱えられません';
    }
    if (!a.force && activeStatics(s, L).some((x) => x.owner !== p && x.spec.s === 'oppSpellLock')) return '相手の能力で呪文を唱えられません';
    const charger = face.kw.charger;
    const fi = card.faces.indexOf(face);
    log(s, p, `${q(name)} を唱えた${how}`);
    // 呪文の効果 → 唱えた時の能力 の順に解決
    const lines = spellEffectLines(face.text);
    if (lines.length) {
      const effect = lines.join('\n');
      s.pending.push({
        kind: 'ability',
        player: p,
        src: a.iid,
        cid: c.cid,
        face: fi,
        event: 'spell',
        text: effect,
        effect,
        optional: false,
        auto: lines.length === 1 && isAutoEffect(lines[0], false),
      });
    }
    const kwLine = (re: RegExp) => face.text.some((l) => re.test(normText(l)));
    // ナイト・マジック: 自分のナイトがいれば、もう一度使ってもよい
    if (lines.length && kwLine(/^ナイト・マジック/) && s.players[p].battle.some((b) => (faceOf(s, L, b)?.races ?? []).some((r) => r.includes('ナイト')))) {
      const effect = lines.join('\n');
      s.pending.push({ kind: 'ability', player: p, src: a.iid, cid: c.cid, face: fi, event: 'spell', text: `ナイト・マジック: ${effect}`, effect, optional: true, auto: false });
    }
    // サイクロン: 直前にクリーチャーを召喚していれば手札に戻る
    const cyclone = kwLine(/^サイクロン/) && me.lastPlay?.turn === s.turn && me.lastPlay.kind === 'creature';
    if (cyclone) log(s, p, 'サイクロン: 手札に戻る');
    const crystalCharger = kwLine(/^水晶チャージャー/);
    const toBottom = face.text.some((l) => /唱えた後、(この呪文を)?墓地に置くかわりに(自分の)?山札の(一番)?下に置く/.test(normText(l)));
    if (crystalCharger) {
      moveCard(s, L, a.iid, 'mana');
      c.manaDown = true;
      log(s, p, '水晶チャージャー: 裏向きにしてマナゾーンへ');
    } else if (toBottom && !cyclone) {
      moveCard(s, L, a.iid, 'deck', { pos: 'bottom' });
      log(s, p, '唱えた後、山札の下へ');
    } else moveCard(s, L, a.iid, cyclone ? 'hand' : charger ? 'mana' : 'grave', { tapped: charger && card.civs.length > 1 });
    if (charger) log(s, p, 'チャージャーでマナゾーンへ');
    fireWatchers(s, L, p, null, 'spellOwn', 'spellOpp');
    fireWatchers(s, L, p, null, 'spellAny', 'spellAny');
    me.lastPlay = { turn: s.turn, kind: 'spell' };
  } else if (/オーラ/.test(face.type)) {
    // オーラ: 自分のGRクリーチャーに付ける (選んでいなければGR召喚して付ける)
    let holder = (a.evo ?? []).find((b) => s.cards[b]?.zone === 'battle' && s.cards[b].owner === p && faceOf(s, L, b)?.isCreature);
    if (holder == null) {
      const gr = s.players[p].gr;
      const top = gr[gr.length - 1];
      if (top != null) {
        log(s, p, `GR召喚 → ${q(nameOf(s, L, top))}`);
        moveCard(s, L, top, 'battle');
        holder = top;
      }
    }
    if (holder == null) {
      log(s, p, `${q(name)} を付けるクリーチャーがいないので墓地へ`);
      moveCard(s, L, a.iid, 'grave');
      return null;
    }
    detach(s, a.iid);
    c.zone = 'under';
    c.parent = holder;
    c.face = card.faces.indexOf(face);
    s.cards[holder].under.push(a.iid);
    log(s, p, `${q(name)} を ${q(nameOf(s, L, holder))} に付けた${how}`);
    fireSelf(s, L, a.iid, c.face, ['attached']);
  } else {
    log(s, p, `${q(name)} (${face.type}) をバトルゾーンに出した${how}`);
    moveCard(s, L, a.iid, 'battle', { face: card.faces.indexOf(face) });
  }
  return null;
}

function applyPending(s: GameState, p: number, a: Action, top: Pending, L: Lookup): Result {
  switch (top.kind) {
    case 'attackOpt': {
      if (a.t !== 'attackOpt') return '革命チェンジ/侵略を使うか選んでください';
      s.pending.shift();
      const at = s.attack!;
      if (a.iid == null || !top.options.includes(a.iid)) {
        queueAttackTriggers(s, L);
        return null;
      }
      const card = L(s.cards[a.iid].cid)!;
      const attCard = L(s.cards[at.attacker].cid)!;
      const attFace = faceOf(s, L, at.attacker)!;
      const rc = card.faces.findIndex((f) => f.kw.revChange && matchesCond(f.kw.revChange, attCard, attFace));
      const inv = card.faces.findIndex((f) => f.kw.invasion && matchesCond(f.kw.invasion, attCard, attFace));
      const oldName = nameOf(s, L, at.attacker);
      if (rc >= 0) {
        // 革命チェンジ: 攻撃中のクリーチャーを手札に戻し、入れ替えて出す
        moveCard(s, L, at.attacker, 'hand');
        moveCard(s, L, a.iid, 'battle', { tapped: true, face: rc });
        s.cards[a.iid].sick = false;
        at.attacker = a.iid;
        log(s, p, `革命チェンジ！ ${q(oldName)} → ${q(card.faces[rc].name)}`);
      } else if (inv >= 0) {
        // 侵略: 攻撃中のクリーチャーの上に重ねる
        const base = at.attacker;
        const subs = [base, ...s.cards[base].under];
        detach(s, base);
        moveCard(s, L, a.iid, 'battle', { tapped: true, face: inv });
        const nc = s.cards[a.iid];
        nc.sick = false;
        for (const x of subs) {
          s.cards[x].zone = 'under';
          s.cards[x].parent = a.iid;
          resetCard(s.cards[x]);
        }
        s.cards[base].under = [];
        nc.under = subs;
        at.attacker = a.iid;
        log(s, p, `侵略！ ${q(oldName)} → ${q(card.faces[inv].name)}`);
      }
      const more = attackOptions(s, L);
      if (more.length) s.pending.unshift({ kind: 'attackOpt', player: p, options: more });
      else queueAttackTriggers(s, L);
      return null;
    }
    case 'block': {
      if (a.t !== 'block') return 'ブロックするか選んでください';
      if (a.ninja != null) {
        if (!top.ninjas.includes(a.ninja)) return 'ニンジャ・ストライクできないカードです';
        const card = L(s.cards[a.ninja].cid)!;
        const fi = card.faces.findIndex((f) => f.isCreature && f.kw.ninjaStrike != null);
        log(s, p, `ニンジャ・ストライク！ ${q(card.faces[Math.max(0, fi)].name)} を召喚 (ターン終了時の処理は手動で)`);
        s.pending.shift();
        moveCard(s, L, a.ninja, 'battle', { face: Math.max(0, fi) });
        // 出た時の能力を解決してから、もう一度ブロックの選択へ
        s.attack!.step = 'atkTrig';
        return null;
      }
      s.pending.shift();
      const at = s.attack!;
      if (a.guard != null) {
        if (!(top.guards ?? []).includes(a.guard)) return 'ガードマンを使えません';
        s.cards[a.guard].tapped = true;
        log(s, p, `ガードマン: ${q(nameOf(s, L, a.guard))} がかわりに攻撃される`);
        at.targetCard = a.guard;
        at.step = 'resolve';
        return null;
      }
      if (a.blocker != null) {
        if (!top.blockers.includes(a.blocker) || s.cards[a.blocker].zone !== 'battle') return 'ブロックできないクリーチャーです';
        s.cards[a.blocker].tapped = true;
        fireSelf(s, L, a.blocker, s.cards[a.blocker].face, ['tapped']);
        at.blocked = a.blocker;
        log(s, p, `${q(nameOf(s, L, a.blocker))} でブロック`);
        fireSelf(s, L, a.blocker, s.cards[a.blocker].face, ['block']);
        fireSelf(s, L, at.attacker, s.cards[at.attacker].face, ['blocked']);
      }
      at.step = 'resolve';
      return null;
    }
    case 'breakSel': {
      if (a.t !== 'breakSel') return 'ブレイクするシールドを選んでください';
      const def = s.players[top.target];
      const sel = [...new Set(a.shields)].filter((x) => def.shield.includes(x));
      if (sel.length !== top.count) return `シールドを${top.count}枚選んでください`;
      s.pending.shift();
      breakShields(s, L, top.target, sel, p, s.attack?.attacker ?? null);
      return null;
    }
    case 'trigger': {
      if (a.t !== 'trigger') return 'S・トリガーを使うか選んでください';
      s.pending.shift();
      const c = s.cards[top.iid];
      if (a.use && c.zone === 'hand') {
        const card = L(c.cid)!;
        if (top.strike && a.target != null && !top.trigger) {
          const t = s.cards[a.target];
          if (t?.zone === 'battle') {
            t.noAttack = true;
            log(s, p, `G・ストライク！ ${q(nameOf(s, L, a.target))} はこのターン攻撃できない`);
          }
        } else {
          const fi = a.face ?? card.faces.findIndex((f) => f.kw.shieldTrigger);
          const face = card.faces[fi] ?? card.faces[0];
          log(s, p, `S・トリガー発動！ ${q(face.name)}`);
          const err = playCard(s, p, { t: 'play', iid: top.iid, face: card.faces.indexOf(face), pay: [], free: true, force: true }, L);
          if (err) return err;
          const ob = face.marked?.oB;
          if (ob && s.players[p].shield.length === 0) {
            log(s, p, `スーパー・S・トリガー: シールドが0なので追加の能力`);
            s.pending.push({ kind: 'ability', player: p, src: top.iid, cid: s.cards[top.iid].cid, face: card.faces.indexOf(face), event: 'spell', text: `oB ${ob}`, effect: ob, optional: false, auto: false });
          }
        }
      }
      return null;
    }
    case 'choice': {
      if (a.t !== 'choose') return '選択してください';
      if (top.mode === 'cards') {
        const picks = [...new Set(a.picks ?? [])].filter((x) => top.options.includes(x));
        if (picks.length < top.min || picks.length > top.max) return top.min === top.max ? `${top.min}枚選んでください` : `${top.min}～${top.max}枚選んでください`;
        if (top.sumPowerMax != null && picks.reduce((a2, i) => a2 + power(s, L, i), 0) > top.sumPowerMax) return `パワーの合計が${top.sumPowerMax}以下になるように選んでください`;
        if (top.sumCostMax != null && picks.reduce((a2, i) => a2 + (L(s.cards[i].cid)?.faces[0]?.cost ?? 0), 0) > top.sumCostMax) return `コストの合計が${top.sumCostMax}以下になるように選んでください`;
        s.pending.shift();
        resumeExec(s, L, top.exec, { picks });
      } else if (top.mode === 'yesno') {
        s.pending.shift();
        resumeExec(s, L, top.exec, { yes: !!a.yes });
      } else {
        const opts = [...new Set(a.options ?? [])].filter((x) => x >= 0 && x < (top.labels?.length ?? 0));
        if (opts.length < top.min || opts.length > top.max) return `${top.min}つ選んでください`;
        s.pending.shift();
        resumeExec(s, L, top.exec, { options: opts });
      }
      return null;
    }
    case 'ability': {
      if (a.t !== 'resolve') return '能力の処理を完了してください';
      s.pending.shift();
      log(s, p, a.use ? `処理完了: ${q(L(top.cid)?.faces[top.face]?.name ?? '')}` : `使わなかった: ${q(L(top.cid)?.faces[top.face]?.name ?? '')}`);
      return null;
    }
    case 'partner': {
      if (a.t !== 'partner') return 'パートナーをパートナーゾーンに戻すか選んでください';
      s.pending.shift();
      const c = s.cards[top.iid];
      if (a.yes && c.zone !== 'gone') {
        detach(s, top.iid);
        c.zone = 'partner';
        c.faceUp = false;
        c.downTurn = s.turn;
        s.players[c.owner].partner.push(top.iid);
        log(s, p, 'パートナーを裏向きでパートナーゾーンに戻した');
      }
      return null;
    }
  }
}

function applyManual(s: GameState, p: number, a: Action, L: Lookup): Result {
  const me = s.players[p];
  const who = me.name;
  switch (a.t) {
    case 'move': {
      const c = s.cards[a.iid];
      if (!c || c.zone === 'gone') return 'カードが見つかりません';
      const hidden = c.zone === 'hand' || c.zone === 'deck' || c.zone === 'shield' || c.zone === 'gr' || c.zone === 'under';
      if (c.owner !== p && (c.zone === 'hand' || c.zone === 'deck')) return '相手の手札・山札は直接動かせません';
      const fromZ = c.zone;
      const nm = nameOf(s, L, a.iid);
      const dest = moveCard(s, L, a.iid, a.to, { pos: a.pos, tapped: a.tapped, faceUp: a.faceUp });
      const reveal = !(hidden && (dest === 'hand' || dest === 'deck' || dest === 'shield'));
      log(
        s,
        p,
        `${who}: ${reveal ? q(nm) : 'カード'} を ${zoneJa(fromZ)} → ${zoneJa(dest)}${a.pos === 'bottom' ? '(下)' : ''}${c.owner !== p ? ` (${s.players[c.owner].name}のカード)` : ''}`,
      );
      return null;
    }
    case 'tap': {
      const c = s.cards[a.iid];
      if (!c || (c.zone !== 'battle' && c.zone !== 'mana')) return 'タップできません';
      c.tapped = a.v;
      log(s, p, `${who}: ${q(nameOf(s, L, a.iid))} を${a.v ? 'タップ' : 'アンタップ'}`);
      return null;
    }
    case 'draw': {
      const n = Math.max(0, Math.min(a.n, 99));
      const d = drawCards(s, p, n);
      log(s, p, `${who}: カードを${d}枚引いた`);
      return null;
    }
    case 'shuffle': {
      shuffleArr(s, me.deck);
      me.peek = [];
      log(s, p, `${who}: 山札をシャッフル`);
      return null;
    }
    case 'peekTop': {
      me.peek = me.deck.slice(-Math.max(1, a.n)).reverse();
      log(s, p, `${who}: 山札の上から${me.peek.length}枚を見た`);
      return null;
    }
    case 'peekEnd': {
      me.peek = [];
      return null;
    }
    case 'shieldFromDeck': {
      let k = 0;
      for (let i = 0; i < a.n; i++) {
        const top = me.deck.pop();
        if (top == null) break;
        s.cards[top].zone = 'shield';
        s.cards[top].faceUp = false;
        me.shield.push(top);
        k++;
      }
      log(s, p, `${who}: 山札の上から${k}枚をシールド化`);
      return null;
    }
    case 'manaFromDeck': {
      const names: string[] = [];
      for (let i = 0; i < a.n; i++) {
        const top = me.deck[me.deck.length - 1];
        if (top == null) break;
        moveCard(s, L, top, 'mana', { tapped: a.tapped || cardCivs(L, s.cards[top].cid).length > 1 });
        names.push(q(nameOf(s, L, top)));
      }
      log(s, p, `${who}: 山札の上から ${names.join('、')} をマナに置いた`);
      return null;
    }
    case 'mill': {
      const names: string[] = [];
      for (let i = 0; i < a.n; i++) {
        const top = me.deck[me.deck.length - 1];
        if (top == null) break;
        moveCard(s, L, top, 'grave');
        names.push(q(nameOf(s, L, top)));
      }
      log(s, p, `${who}: 山札の上から ${names.join('、')} を墓地に置いた`);
      return null;
    }
    case 'breakManual': {
      const c = s.cards[a.iid];
      if (!c || c.zone !== 'shield') return 'シールドを選んでください';
      breakShields(s, L, c.owner, [a.iid], p);
      return null;
    }
    case 'power': {
      const c = s.cards[a.iid];
      if (!c || c.zone !== 'battle') return 'バトルゾーンのカードを選んでください';
      c.powerMod += a.delta;
      log(s, p, `${who}: ${q(nameOf(s, L, a.iid))} のパワー ${a.delta >= 0 ? '+' : ''}${a.delta} (ターン終了まで)`);
      return null;
    }
    case 'flip': {
      const c = s.cards[a.iid];
      const card = L(c.cid);
      if (!card || card.faces.length < 2) return '裏返せないカードです';
      const before = nameOf(s, L, a.iid);
      c.face = (c.face + 1) % card.faces.length;
      log(s, p, `${who}: ${q(before)} を裏返して ${q(card.faces[c.face].name)} に`);
      return null;
    }
    case 'stack': {
      const c = s.cards[a.iid];
      const onto = s.cards[a.onto];
      if (!c || !onto || onto.zone !== 'battle' || a.iid === a.onto) return '重ねられません';
      if (c.owner !== p && (c.zone === 'hand' || c.zone === 'deck')) return '相手の手札・山札は動かせません';
      const nm = nameOf(s, L, a.iid);
      const subs = c.zone === 'battle' ? [...c.under] : [];
      detach(s, a.iid);
      c.under = [];
      for (const x of [a.iid, ...subs]) {
        s.cards[x].zone = 'under';
        s.cards[x].parent = a.onto;
        resetCard(s.cards[x]);
        onto.under.push(x);
      }
      log(s, p, `${who}: ${q(nm)} を ${q(nameOf(s, L, a.onto))} の下に置いた`);
      return null;
    }
    case 'grSummon': {
      const top = me.gr[me.gr.length - 1];
      if (top == null) return '超GRゾーンにカードがありません';
      moveCard(s, L, top, 'battle');
      log(s, p, `${who}: GR召喚 → ${q(nameOf(s, L, top))}`);
      return null;
    }
    case 'discardRandom': {
      const t = s.players[a.player];
      if (!t || !t.hand.length) return '手札がありません';
      const pick = t.hand[Math.floor(rand(s) * t.hand.length)];
      moveCard(s, L, pick, 'grave');
      log(s, p, `${who}: ${t.name} の手札から ${q(nameOf(s, L, pick))} をランダムに捨てさせた`);
      return null;
    }
    case 'reveal': {
      const c = s.cards[a.iid];
      if (!c || c.owner !== p) return '自分のカードを選んでください';
      c.revealed = a.v;
      if (a.v) log(s, p, `${who}: ${q(nameOf(s, L, a.iid))} を公開`);
      return null;
    }
    case 'noAttack': {
      const c = s.cards[a.iid];
      if (!c || c.zone !== 'battle') return 'バトルゾーンのカードを選んでください';
      c.noAttack = !c.noAttack;
      log(s, p, `${who}: ${q(nameOf(s, L, a.iid))} は${c.noAttack ? 'このターン攻撃できない' : '攻撃制限を解除'}`);
      return null;
    }
    case 'note': {
      log(s, p, `${who}: ${a.m.slice(0, 200)}`);
      return null;
    }
    case 'concede': {
      lose(s, p, '投了');
      return null;
    }
  }
  return '不明な操作です';
}

const zoneJa = (z: string) =>
  ({
    deck: '山札',
    hand: '手札',
    mana: 'マナ',
    battle: 'バトルゾーン',
    shield: 'シールド',
    grave: '墓地',
    hyper: '超次元',
    gr: '超GR',
    partner: 'パートナーゾーン',
    under: '下',
    gone: '除外',
  })[z] ?? z;

/** 現在、誰の入力待ちか */
export function decider(s: GameState): number | null {
  if (s.phase === 'over') return null;
  return s.pending[0]?.player ?? s.active;
}
