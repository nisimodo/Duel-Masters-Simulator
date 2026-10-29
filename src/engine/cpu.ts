// CPU の思考ルーチン (キーワード能力と効果アシストで処理できる範囲で戦う)
//
// 優先度の考え方
//  1. マナチャージ: 序盤は多色・高コスト・足りない文明のカードをマナへ (低コストは手札に残す)。
//     中盤以降は「次に出せる高コスト」を手札に残し、低コストカードをマナに埋める。
//  2. 除去優先: 相手のバトルゾーンに自分を縛るメタカードや強いクリーチャーがあれば、
//     それを除去できるカード (呪文・出た時能力) を最優先で使い、対象も脅威度の高い順に選ぶ。
//  3. 展開: 残りのマナで一番価値の高いカードから出す (革命チェンジ/侵略持ちは温存)。
//  4. 攻撃: とどめを刺せるなら総攻撃。メタクリーチャーを倒せるなら優先して攻撃。
//     シールドが少なく次の相手ターンで負けそうならブロッカーは守りに残す。勝てないブロッカーへの無駄な攻撃はしない。
import { CIV_NAME, type Card, type Civ, type Face } from '../lib/cards';
import { spellEffectLines, stripReminder } from '../lib/triggers';
import { effectHints, hintsFromText, type EffectHint } from './effects';
import {
  applyAction,
  attackTargets,
  autoPay,
  nameOf,
  crystalOf,
  canAttackWith,
  crossCost,
  luresFor,
  mustAttackers,
  duelistTargets,
  tapAbilityOf,
  playCost,
  cardCivs,
  faceOf,
  kwOf,
  power,
  untappedMana,
  abilityPick,
  type Lookup,
} from './engine';
import { matchesCond } from './cond';
import { activeStatics, canPlayFromZone, costOf } from './statics';
import { mainOpp, matchesSel, programOf } from './interp';
import type { Action, GameState } from './types';
import type { Op } from '../rules/ops';

const opps = (s: GameState, p: number) => s.players.map((_, i) => i).filter((i) => i !== p && !s.players[i].lost);

/** 古い考え方で動かすプレイヤー (新旧のCPUを対戦させて強さを比べる時だけ使う) */
let LEGACY = new Set<number>();
/** 新しい考え方のうち使うもの (空ならすべて。比べる時だけ絞る) */
let ONLY = new Set<string>();
export function setCpuLegacy(players: number[], only: string[] = []) {
  LEGACY = new Set(players);
  ONLY = new Set(only);
}
/** プレイヤーごとに止める考え方 (比べる時だけ使う) */
let OFF = new Map<number, Set<string>>();
export function setCpuOff(player: number, feats: string[]) {
  OFF = new Map(feats.length ? [[player, new Set(feats)]] : []);
}
/** その考え方を使うか */
const on = (p: number, feat: 'spell' | 'element' | 'charge' | 'deck' | 'extra' | 'mass' | 'hand' | 'modal' | 'decline' | 'rev') => !LEGACY.has(p) && (!ONLY.size || ONLY.has(feat)) && !OFF.get(p)?.has(feat);

/** 呪文の効果・タマシード等の「出た時」の効果を解釈した命令 (価値の見積もり用) */
const faceOpsCache = new WeakMap<Face, Op[]>();
function faceOps(f: Face): Op[] {
  let ops = faceOpsCache.get(f);
  if (!ops) {
    if (f.isSpell) ops = programOf(spellEffectLines(f.text).join('\n')).ops;
    else ops = (f.triggers ?? []).filter((t) => t.events.includes('enter')).flatMap((t) => programOf(t.effect).ops);
    faceOpsCache.set(f, ops);
  }
  return ops;
}

/** 命令の中に op があるか (「〜してもよい」「〜なら」の中も調べる) */
function hasOp(ops: unknown, name: Op['op']): boolean {
  if (!Array.isArray(ops)) return false;
  return ops.some((o) => o && typeof o === 'object' && ((o as Op).op === name || Object.values(o).some((v) => Array.isArray(v) && (hasOp(v, name) || v.some((x) => x && typeof x === 'object' && 'body' in x && hasOp((x as { body: unknown }).body, name))))));
}
/** 追加ターンを得る呪文・カード */
const givesExtraTurn = (f: Face | undefined) => !!f && hasOp(faceOps(f), 'extraTurn');
/** 「攻撃する時、呪文を手札からコストを支払わずに唱えてもよい」 */
const castsOnAttack = (f: Face | undefined) => !!f && (f.triggers ?? []).some((t) => t.events.includes('attack') && programOf(t.effect).ops.some((o) => o.op === 'optional' && o.body.some((x) => x.op === 'play' && x.mode === 'cast')));
/** 攻撃すると追加ターンを得るクリーチャー (攻撃時の能力そのもの、または手札の追加ターン呪文を唱える) */
function extraTurnAttacker(s: GameState, p: number, L: Lookup, iid: number): boolean {
  if (!on(p, 'extra') || noExtraTurn(s, L)) return false;
  const f = faceOf(s, L, iid);
  if (!f) return false;
  if ((f.triggers ?? []).some((t) => t.events.includes('attack') && hasOp(programOf(t.effect).ops, 'extraTurn'))) return true;
  return castsOnAttack(f) && s.players[p].hand.some((h) => L(s.cards[h].cid)?.faces.some((x) => x.isSpell && givesExtraTurn(x)));
}
const noExtraTurn = (s: GameState, L: Lookup) => activeStatics(s, L).some((x) => x.spec.s === 'noExtraTurn');

/** 革命チェンジで出した時の「出た時」の効果の価値 (使えないファイナル革命は数えない) */
function revEnterValue(s: GameState, p: number, L: Lookup, f: Face): number {
  const me = s.players[p];
  const unwrap = (ops: Op[]): Op[] =>
    ops.flatMap((o) => {
      if (o.op !== 'if' || o.cond.c !== 'finalRev') return [o];
      const ok = me.finalRevTurn !== s.turn && !(o.cond.game && me.finalRevUsed);
      return ok ? unwrap(o.body) : [];
    });
  return (f.triggers ?? []).filter((t) => t.events.includes('enter') && t.howEnter !== 'summon').reduce((a, t) => a + opsValue(s, p, L, unwrap(programOf(t.effect).ops)), 0);
}

// ---------- 評価 ----------

/** 相手を縛る「メタ」能力のテキスト */
const META_PATTERNS: RegExp[] = [
  /相手は.{0,30}(できない|唱えられない|出せない|使えない|召喚できない)/,
  /相手の.{0,20}(呪文|クリーチャー|カード).{0,20}(コスト|召喚コスト).{0,10}多く/,
  /(唱える|召喚する)コストを.{0,10}多く/,
  /相手が.{0,30}(時|たび)、/,
  /相手のクリーチャーは.{0,20}(タップして|出る時|攻撃できない|ブロックできない)/,
  /相手の.{0,15}(山札|墓地|マナ)から.{0,20}(出せない|唱えられない|できない)/,
  /相手は.{0,10}カードを.{0,10}(引けない|置けない)/,
];

const metaCache = new WeakMap<Face, number>();
/** メタ能力の強さ (0 = なし) */
export function metaScore(f: Face | undefined): number {
  if (!f) return 0;
  let v = metaCache.get(f);
  if (v == null) {
    v = 0;
    for (const raw of f.text) {
      const l = stripReminder(raw.normalize('NFKC'));
      if (META_PATTERNS.some((re) => re.test(l))) v += 10;
    }
    metaCache.set(f, Math.min(v, 30));
  }
  return v;
}

/** 相手のカードが自分にとってどれだけ脅威か */
export function threatOf(s: GameState, L: Lookup, iid: number): number {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  if (!f) return 0;
  let t = metaScore(f);
  if (f.isCreature) {
    t += power(s, L, iid) / 2000;
    t += (Math.min(f.kw.breaker, 5) - 1) * 2;
    if (f.kw.blocker) t += 2;
    if (f.kw.speedAttacker || f.kw.machFighter) t += 1;
    if (f.kw.slayer) t += 1;
    t += c.under.length; // 進化・侵略で重なっている
    t += f.triggers.filter((x) => x.events.includes('attack')).length * 2; // 攻撃時に何かしてくる
  } else {
    t += 1; // クロスギア・フィールド等
  }
  return t;
}

const REMOVAL: EffectHint['kind'][] = ['destroy', 'bounce', 'manaSend', 'powerMinus', 'tapOpp'];

/** カードの面がすぐ (このターン / 次のターン) 出せそうか */
const castableWithin = (f: Face, mana: number, extra: number) => f.cost <= mana + extra;

function oppCreaturesByThreat(s: GameState, p: number, L: Lookup, maxPower?: number) {
  return opps(s, p)
    .flatMap((o) => s.players[o].battle)
    .filter((i) => faceOf(s, L, i)?.isCreature && (maxPower == null || power(s, L, i) <= maxPower))
    .sort((a, b) => threatOf(s, L, b) - threatOf(s, L, a));
}

/** 効果アシストを具体的なアクションに変換する (targets 未指定なら脅威度の高い順に自動で選ぶ) */
export function hintActions(s: GameState, p: number, L: Lookup, h: EffectHint, targets?: number[]): Action[] {
  const ranked = oppCreaturesByThreat(s, p, L, h.maxPower);
  const pickCreatures = () => targets ?? ranked.slice(0, h.n);
  switch (h.kind) {
    case 'draw':
      return [{ t: 'draw', n: h.n }];
    case 'manaTop':
      return [{ t: 'manaFromDeck', n: h.n }];
    case 'shieldTop':
      return [{ t: 'shieldFromDeck', n: h.n }];
    case 'mill':
      return [{ t: 'mill', n: h.n }];
    case 'destroy':
      return pickCreatures().map((iid) => ({ t: 'move', iid, to: 'grave' }) as Action);
    case 'bounce':
      return pickCreatures().map((iid) => ({ t: 'move', iid, to: 'hand' }) as Action);
    case 'manaSend':
      return pickCreatures().map((iid) => ({ t: 'move', iid, to: 'mana' }) as Action);
    case 'tapOpp':
      return (targets ?? ranked.filter((i) => !s.cards[i].tapped).slice(0, h.n)).map((iid) => ({ t: 'tap', iid, v: true }) as Action);
    case 'powerMinus':
      return pickCreatures().map((iid) => ({ t: 'power', iid, delta: h.delta ?? 0 }) as Action);
    case 'discardRandom': {
      const target = targets?.[0] ?? opps(s, p).sort((a, b) => s.players[b].hand.length - s.players[a].hand.length)[0];
      return target == null ? [] : Array.from({ length: h.n }, () => ({ t: 'discardRandom', player: target }) as Action);
    }
    case 'grSummon':
      return Array.from({ length: h.n }, () => ({ t: 'grSummon' }) as Action);
    case 'revealPlay':
      return revealPlayActions(s, p, L, h);
    case 'massBounce':
    case 'massDestroy': {
      // 条件に合うクリーチャーをすべて (oppOnly でなければ自分のも)
      const all = (h.oppOnly ? opps(s, p) : s.players.map((_, i) => i))
        .flatMap((o) => s.players[o].battle)
        .filter((i) => {
          const f = faceOf(s, L, i);
          if (!f?.isCreature) return false;
          if (h.minCost != null && f.cost < h.minCost) return false;
          if (h.maxCost != null && f.cost > h.maxCost) return false;
          if (h.maxPower != null && power(s, L, i) > h.maxPower) return false;
          return true;
        });
      return all.map((iid) => ({ t: 'move', iid, to: h.kind === 'massBounce' ? 'hand' : 'grave' }) as Action);
    }
    case 'breakOpp': {
      if (targets) return targets.map((iid) => ({ t: 'breakManual', iid }) as Action);
      const o = targetOpponent(s, p, L);
      return o == null ? [] : s.players[o].shield.slice(0, h.n).map((iid) => ({ t: 'breakManual', iid }) as Action);
    }
  }
}

/** 全体除去を含む面を使った時の損得 (相手の被害 - 自分の被害)。全体除去がなければ 0 */
function massNet(s: GameState, p: number, L: Lookup, f: Face): number {
  let net = 0;
  for (const h of hintsFromText(f.text)) {
    if (h.kind !== 'massBounce' && h.kind !== 'massDestroy') continue;
    for (const a of hintActions(s, p, L, h)) {
      const iid = (a as { iid: number }).iid;
      net += s.cards[iid].owner === p ? -threatOf(s, L, iid) - 2 : threatOf(s, L, iid);
    }
  }
  return net;
}

/**
 * 「山札の上から N 枚を表向きにし、条件に合うものをコストを支払わずに使い、残りを○○に置く」
 * ツインパクトはどちらの面のコストとしても扱えるので、条件 (すべて異なるコスト) を満たしつつ
 * 一番価値が高くなる面の組み合わせを選ぶ。
 */
function revealPlayActions(s: GameState, p: number, L: Lookup, h: EffectHint): Action[] {
  const deck = s.players[p].deck;
  const top = deck.slice(-h.n).reverse();
  if (!top.length) return [];
  const cards = top.map((i) => L(s.cards[i].cid));
  const playable = (f: Face) =>
    (h.maxCost == null || f.cost <= h.maxCost) &&
    (h.playType === 'creature' ? f.isCreature : h.playType === 'spell' ? f.isSpell : true) &&
    massNet(s, p, L, f) >= 0;
  // 面の選び方を総当たり (最大 2^N 通り)
  let best: { faces: number[]; value: number } | null = null;
  const choose = (k: number, picked: number[]) => {
    if (k === top.length) {
      const costs = picked.map((fi, j) => cards[j]?.faces[fi]?.cost ?? -1);
      if (h.distinct && new Set(costs).size !== costs.length) return;
      const value = picked.reduce((a, fi, j) => {
        const f = cards[j]?.faces[fi];
        return a + (f && playable(f) ? 10 + f.cost + (f.isCreature ? 3 : 0) : 0);
      }, 0);
      if (!best || value > best.value) best = { faces: [...picked], value };
      return;
    }
    const n = cards[k]?.faces.length ?? 1;
    for (let fi = 0; fi < n; fi++) choose(k + 1, [...picked, fi]);
  };
  choose(0, []);
  const names = cards.map((c) => (c ? `《${c.name}》` : '?')).join('、');
  const out: Action[] = [{ t: 'note', m: `山札の上から${top.length}枚を表向きにした: ${names}` }];
  const chosen = best as { faces: number[]; value: number } | null;
  const rest: number[] = [];
  top.forEach((iid, j) => {
    const fi = chosen?.faces[j] ?? 0;
    const f = cards[j]?.faces[fi];
    if (chosen && f && playable(f)) out.push({ t: 'play', iid, face: fi, pay: [], free: true, force: true });
    else rest.push(iid);
  });
  if (!chosen) out.push({ t: 'note', m: '条件を満たさないため、使えるカードはなかった' });
  for (const iid of rest) {
    if (h.rest === 'mana') out.push({ t: 'move', iid, to: 'mana' });
    else if (h.rest === 'grave') out.push({ t: 'move', iid, to: 'grave' });
    else if (h.rest === 'hand') out.push({ t: 'move', iid, to: 'hand' });
    else out.push({ t: 'move', iid, to: 'deck', pos: 'bottom' });
  }
  return out;
}

/** 攻撃・効果の主な相手 (デュエパ: シールドが少ない相手、同数なら脅威の大きい相手) */
function targetOpponent(s: GameState, p: number, L: Lookup): number | undefined {
  const boardThreat = (o: number) => s.players[o].battle.reduce((a, i) => a + threatOf(s, L, i), 0);
  return opps(s, p).sort((a, b) => s.players[a].shield.length - s.players[b].shield.length || boardThreat(b) - boardThreat(a))[0];
}

/** 次の相手ターンに受けうるブレイク数 (相手の攻撃できそうなクリーチャーの合計) */
function incomingBreaks(s: GameState, p: number, L: Lookup): number {
  let n = 0;
  for (const o of opps(s, p))
    for (const i of s.players[o].battle) {
      const f = faceOf(s, L, i);
      if (f?.isCreature && !f.kw.cantAttack && !f.kw.cantAttackPlayer) n += Math.min(f.kw.breaker, 5);
    }
  return n;
}

/** 次の相手ターンに負ける危険がある */
function underPressure(s: GameState, p: number, L: Lookup): boolean {
  const myBlockers = s.players[p].battle.filter((i) => faceOf(s, L, i)?.kw.blocker).length;
  return incomingBreaks(s, p, L) >= s.players[p].shield.length + 1 + myBlockers;
}

// ---------- マナチャージ ----------

function chooseCharge(s: GameState, p: number, L: Lookup): number | null {
  const me = s.players[p];
  if (!me.hand.length) return null;
  const mana = me.mana.length;
  // マナが十分あり手札が少ないならチャージしない
  if (mana >= 7 && me.hand.length < 3) return null;
  if (mana >= 10) return null;
  const early = mana < 4;
  const manaCivs = new Set(me.mana.flatMap((i) => cardCivs(L, s.cards[i].cid)));
  const threats = oppCreaturesByThreat(s, p, L).length > 0;

  // 攻撃する時に手札の呪文を唱えるクリーチャー (《水晶の王 ゴスペル》など) が自分のデッキにあるか
  const enabler = on(p, 'extra') && s.cards.some((c) => c.owner === p && L(c.cid)?.faces.some((f) => castsOnAttack(f)));
  const score = (i: number) => {
    const card = L(s.cards[i].cid);
    if (!card) return -99;
    const faces = card.faces;
    const maxCost = Math.max(...faces.map((f) => f.cost));
    const minCost = Math.min(...faces.map((f) => f.cost));
    // 墓地・マナ・バトルゾーンの枚数でコストが下がっていくカード (あとで軽く出せる切り札)
    const scaling = on(p, 'charge') && faces.some((f) => f.cost >= 7 && (f.statics ?? []).some((x) => x.s === 'sympathy'));
    const multi = card.civs.length > 1;
    const bringsCiv = card.civs.some((c) => !manaCivs.has(c));
    const isRemoval = faces.some((_f, fi) => effectHints(card, fi).some((h) => REMOVAL.includes(h.kind)));
    const holdForAttack = faces.some((f) => f.kw.revChange || f.kw.invasion);
    let sc = 0;
    // コストが下がっていく切り札はマナに置かない (手札に2枚以上あれば1枚はマナへ置いてよい)
    const dup = me.hand.filter((x) => s.cards[x].cid === s.cards[i].cid).length > 1;
    if (scaling && !dup) sc -= 25;
    // 相手のターンなどに手札から使える切り札 (鬼エンド・逆転撃 等) は手札に残す
    if (on(p, 'charge') && !dup && faces.some((f) => (f.triggers ?? []).some((t) => t.fromHand))) sc -= 15;
    // 追加ターンを得るカードは手札に残す (コスト99の呪文など、効果で唱えるもの)
    // (コストが大きいほどマナに置きやすくなる分を打ち消す。2枚以上あっても高いコストだけで優先はしない)
    if (enabler && faces.some((f) => givesExtraTurn(f))) sc -= dup ? 4 + maxCost : 200;
    if (early) {
      // 序盤: 低コストを出すために、多色・高コスト・足りない文明をマナへ
      if (multi) sc += 8;
      if (maxCost >= 6) sc += 4 + maxCost;
      if (bringsCiv) sc += 10;
      if (minCost <= 3) sc -= 10;
    } else {
      // 中盤以降: 出せる高コストは残し、低コストをマナへ埋める
      if (minCost <= 3) sc += 10 - minCost;
      if (maxCost >= 5 && castableWithin(faces[0], mana, 2)) sc -= 15;
      if (bringsCiv) sc += 6;
      if (multi) sc += 2;
    }
    if (isRemoval && threats) sc -= 8; // 除去は手札に残す
    if (holdForAttack) sc -= 6;
    if (faces.some((f) => f.kw.shieldTrigger)) sc -= 1;
    return sc;
  };
  return [...me.hand].sort((a, b) => score(b) - score(a))[0];
}

// ---------- カードの使用 ----------

interface PlayCand {
  a: Action;
  value: number;
}

function playCandidates(s: GameState, p: number, L: Lookup): PlayCand[] {
  const me = s.players[p];
  const mana = untappedMana(s, p);
  const defensive = underPressure(s, p, L);
  const cands: PlayCand[] = [];

  const removalValue = (card: Card, fi: number) => {
    let v = 0;
    for (const h of effectHints(card, fi)) {
      if (h.kind === 'massBounce' || h.kind === 'massDestroy') {
        const hit = hintActions(s, p, L, h).map((a) => (a as { iid: number }).iid);
        const theirs = hit.filter((i) => s.cards[i].owner !== p).reduce((a, i) => a + threatOf(s, L, i), 0);
        const mine = hit.filter((i) => s.cards[i].owner === p).length * 4;
        v += Math.max(0, theirs * 4 - mine);
      } else if (REMOVAL.includes(h.kind)) {
        const targets = oppCreaturesByThreat(s, p, L, h.maxPower);
        if (!targets.length) continue;
        const t = threatOf(s, L, targets[0]);
        v += 25 + t * 4;
        if (metaScore(faceOf(s, L, targets[0])) > 0) v += 60; // メタカードの除去は最優先
      } else if (h.kind === 'draw' || h.kind === 'manaTop') v += (on(p, 'deck') && me.deck.length <= 8 ? -6 : 6) * h.n;
      else if (h.kind === 'shieldTop') v += defensive ? 15 : 6;
      else if (h.kind === 'discardRandom') v += 8;
      else if (h.kind === 'grSummon') v += 10;
    }
    return v;
  };

  const fromOtherZones = [...me.mana, ...me.grave, ...me.hyper].filter((i) =>
    L(s.cards[i].cid)?.faces.some(
      (f) =>
        f.isCreature &&
        (canPlayFromZone(s, L, p, i, f) ||
        (f.statics ?? []).some(
          (x) =>
            (x.s === 'manaBakutan' && s.cards[i].zone === 'mana') ||
            ((x.s === 'mugen' || x.s === 'fushigi' || x.s === 'abyss') && s.cards[i].zone === 'grave'),
        )),
    ),
  );
  // 水晶ソウル: 裏向きのマナは1枚でN枚分として使える
  const manaBase = mana;
  const downMana = me.mana.filter((i) => !s.cards[i].tapped && s.cards[i].manaDown).length;
  for (const h of [...me.hand, ...me.partner.filter((i) => s.cards[i].faceUp), ...fromOtherZones]) {
    const card = L(s.cards[h].cid);
    if (!card) continue;
    card.faces.forEach((f, fi) => {
      const crystal = crystalOf(f);
      const mana = crystal ? manaBase + downMana * (crystal - 1) : manaBase;
      if (card.hyper && fi > 0) return;
      if (s.cards[h].zone === 'partner' && !f.isCreature) return;
      if (s.cards[h].zone !== 'hand' && s.cards[h].zone !== 'partner' && !f.isCreature) return;
      // G・ゼロが使えるならコストを支払わずに
      const gz = playCost(s, L, p, { t: 'play', iid: h, face: fi, pay: [], gzero: true }, fi) === 0;
      // マナ爆誕 (マナゾーンから) / J・O・E・B・A・D (普通に出せない時だけ軽くして出す)
      let alt: 'joe' | 'bad' | 'mana' | 'mugen' | 'fushigi' | 'abyss' | 'galaxy' | 'vivid' | 'tapCast' | undefined;
      let taps: number[] | undefined;
      const st = f.statics ?? [];
      const mg = st.find((x) => x.s === 'mugen');
      const fg = st.find((x) => x.s === 'fushigi');
      if (s.cards[h].zone === 'mana' && st.some((x) => x.s === 'manaBakutan')) alt = 'mana';
      else if (s.cards[h].zone === 'grave' && fg && fg.s === 'fushigi' && !mg) {
        // フシギバース: コストの大きい (攻撃に使わない) クリーチャーをマナへ
        const b = me.battle.filter((x) => faceOf(s, L, x)?.isCreature && x !== h).sort((x, y) => (faceOf(s, L, y)?.cost ?? 0) - (faceOf(s, L, x)?.cost ?? 0) || threatOf(s, L, x) - threatOf(s, L, y))[0];
        if (b == null || threatOf(s, L, b) > (f.cost ?? 0) * 2) return;
        alt = 'fushigi';
        taps = [b];
      } else if (s.cards[h].zone === 'grave' && st.some((x) => x.s === 'abyss') && !mg) alt = 'abyss';
      else if (mg && mg.s === 'mugen' && (s.cards[h].zone === 'grave' || (!gz && costOf(s, L, p, h, fi) > mana))) {
        // ムゲンクライム: 攻撃できないクリーチャーから優先してタップ
        const free = me.battle
          .filter((b) => b !== h && !s.cards[b].tapped && faceOf(s, L, b)?.isCreature)
          .sort((a, b) => Number(canAttackWith(s, L, a)) - Number(canAttackWith(s, L, b)) || threatOf(s, L, a) - threatOf(s, L, b));
        if (free.length < mg.n) return;
        alt = 'mugen';
        taps = free.slice(0, mg.n);
      } else if (s.cards[h].vividTurn === s.turn && st.some((x) => x.s === 'vivid' && x.cost < costOf(s, L, p, h, fi))) {
        alt = 'vivid';
      } else if (!gz && costOf(s, L, p, h, fi) > mana) {
        const d = st.find((x) => x.s === 'discountSummon');
        const tc = st.find((x) => x.s === 'tapCast');
        if (d && d.s === 'discountSummon') alt = d.kind;
        else if (tc && tc.s === 'tapCast') {
          // タップして唱える: 攻撃に使わない条件に合うクリーチャーをタップ
          const free = me.battle
            .filter((b) => b !== h && !s.cards[b].tapped && matchesSel(s, L, b, tc.sel))
            .sort((a, b) => Number(canAttackWith(s, L, a)) - Number(canAttackWith(s, L, b)) || threatOf(s, L, a) - threatOf(s, L, b));
          if (free.length >= tc.n) {
            alt = 'tapCast';
            taps = free.slice(0, tc.n);
          }
        } else if (st.some((x) => x.s === 'galaxy') && s.cards[h].zone === 'hand') alt = 'galaxy';
      }
      const altCost = alt ? playCost(s, L, p, { t: 'play', iid: h, face: fi, pay: [], alt, taps }, fi) : null;
      if (alt && typeof altCost !== 'number') return;
      let cost = gz ? 0 : alt ? (altCost as number) : costOf(s, L, p, h, fi);
      // マナが足りない時の軽減: ササゲール / ハイパーエナジー / 手札を捨てて軽減
      let sasa: number[] | undefined;
      let he: number[] | undefined;
      let discards: number[] | undefined;
      if (!gz && !alt && cost > mana && f.isCreature) {
        const base = { t: 'play' as const, iid: h, face: fi, pay: [] as number[] };
        if (st.some((x) => x.s === 'sasageru')) {
          // ササゲール: ササゲールを持つ、コストの異なる弱いクリーチャーを破壊する
          const seen = new Set<number>();
          const pick = me.battle
            .filter((b) => b !== h && (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'sasageru'))
            .sort((a, b) => threatOf(s, L, a) - threatOf(s, L, b))
            .filter((b) => {
              const c0 = faceOf(s, L, b)?.cost ?? -1;
              if (seen.has(c0)) return false;
              seen.add(c0);
              return true;
            });
          for (let k = 1; k <= pick.length; k++) {
            const r = playCost(s, L, p, { ...base, sasa: pick.slice(0, k) }, fi);
            if (typeof r === 'number' && r <= mana) {
              sasa = pick.slice(0, k);
              cost = r;
              break;
            }
          }
        }
        if (!sasa && st.some((x) => x.s === 'hyperEnergy')) {
          // ハイパーエナジー: 攻撃できない/弱い、コストの異なるクリーチャーをタップ
          const seen = new Set<number>();
          const pick = me.battle
            .filter((b) => b !== h && !s.cards[b].tapped && faceOf(s, L, b)?.isCreature)
            .sort((a, b) => Number(canAttackWith(s, L, a)) - Number(canAttackWith(s, L, b)) || threatOf(s, L, a) - threatOf(s, L, b))
            .filter((b) => {
              const c0 = faceOf(s, L, b)?.cost ?? -1;
              if (seen.has(c0)) return false;
              seen.add(c0);
              return true;
            });
          for (let k = 1; k <= pick.length; k++) {
            const r = playCost(s, L, p, { ...base, he: pick.slice(0, k) }, fi);
            if (typeof r === 'number' && r <= mana) {
              he = pick.slice(0, k);
              cost = r;
              break;
            }
          }
        }
        const dd = st.find((x) => x.s === 'discardDiscount');
        if (!sasa && !he && dd && dd.s === 'discardDiscount') {
          // 手札を捨てて軽減: コストの小さい手札から捨てる
          const others = me.hand.filter((x) => x !== h).sort((a, b) => (L(s.cards[a].cid)?.faces[0]?.cost ?? 0) - (L(s.cards[b].cid)?.faces[0]?.cost ?? 0));
          if (others.length >= dd.n) {
            const r = playCost(s, L, p, { ...base, discards: others.slice(0, dd.n) }, fi);
            if (typeof r === 'number' && r <= mana) {
              discards = others.slice(0, dd.n);
              cost = r;
            }
          }
        }
      }
      if (cost > mana) return;
      // バズレンダ: 余ったマナで追加で支払う
      const bz = st.find((x) => x.s === 'buzz');
      const buzz = bz && bz.s === 'buzz' && !alt && !gz ? Math.floor((mana - cost) / bz.n) : 0;
      cost += buzz * (bz && bz.s === 'buzz' ? bz.n : 0);
      const pay = gz ? [] : autoPay(s, L, p, f.civs as Civ[], cost, crystalOf(f));
      if (!pay) return;
      const rv = removalValue(card, fi);
      if (f.isCreature) {
        let evo: number[] | undefined;
        const em = (f.statics ?? []).find((x) => x.s === 'evoMulti');
        if (f.isEvolution && em && em.s === 'evoMulti') {
          // 進化GV / 超無限進化: 条件に合う弱いクリーチャーから必要な数だけ
          // (超無限進化・Ω / 進化GV・Ω は墓地・マナゾーンからも。墓地 → マナ → バトルゾーンの順に使う)
          const zones = em.zones ?? ['battle'];
          const pool = zones.flatMap((z) =>
            (me[z] as number[])
              .filter((b) => b !== h && L(s.cards[b].cid)?.faces.some((x) => x.isCreature) && matchesSel(s, L, b, { ...em.sel, zones: [z] }))
              .sort((a, b) => (z === 'battle' ? threatOf(s, L, a) - threatOf(s, L, b) : 0)),
          );
          const bases = em.oneEach ? zones.map((z) => pool.find((b) => s.cards[b].zone === z)).filter((b): b is number => b != null) : pool;
          if (bases.length < em.min) return;
          evo = em.oneEach ? bases : bases.slice(0, em.exact ? em.min : Math.max(em.min, Math.min(bases.length, 3)));
        } else if (f.isEvolution) {
          const base = [...me.battle]
            .filter((b) => {
              const bf = faceOf(s, L, b);
              const bc = L(s.cards[b].cid);
              return bf && (bf.isCreature || (bf.statics ?? []).some((x) => x.s === 'sinkalize')) && bc && (!f.kw.evoCond || matchesCond(f.kw.evoCond, bc, bf));
            })
            .sort((a, b) => power(s, L, a) - power(s, L, b))[0];
          if (base == null) {
            if (!(f.statics ?? []).some((x) => x.s === 'deckEvo')) return;
            evo = [];
          } else evo = [base];
        }
        // 革命チェンジ/侵略持ちは、攻撃時に使える場面なら温存
        if (
          (f.kw.revChange || f.kw.invasion) &&
          me.battle.some((b) => {
            const bc = L(s.cards[b].cid);
            const bf = faceOf(s, L, b);
            return bc && bf && ((f.kw.revChange && matchesCond(f.kw.revChange, bc, bf, power(s, L, b, true))) || (f.kw.invasion && matchesCond(f.kw.invasion, bc, bf, power(s, L, b, true))));
          })
        )
          return;
        let value = f.cost * 10 + (f.power ?? 0) / 1000 + Math.min(f.kw.breaker, 5) * 3 + rv;
        if (f.kw.blocker && defensive) value += 20;
        if (f.kw.speedAttacker) value += 5;
        value += metaScore(f) / 2; // 自分のメタカードも価値が高い
        if (alt === 'joe' || alt === 'bad' || alt === 'abyss') value = value * 0.6; // ターンの終わりに離れる
        if (alt === 'galaxy') value = value * 0.4; // シールドとして置くだけ
        // O・ドライブ: 余ったマナで追加の支払いができれば払う
        let odrivePay: number[] | undefined;
        const od = st.find((x) => x.s === 'odrive');
        if (od && od.s === 'odrive') {
          const free = me.mana.filter((m) => !s.cards[m].tapped && !pay.includes(m));
          const out: number[] = [];
          for (const r of od.reqs) {
            const cs = free.filter((m) => !out.includes(m) && cardCivs(L, s.cards[m].cid).some((x) => CIV_NAME[x] === r.civ)).slice(0, r.n);
            if (cs.length === r.n) out.push(...cs);
          }
          if (out.length) {
            odrivePay = out;
            value += 10;
          }
        }
        if (discards) value -= discards.length * 6;
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo, gzero: gz || undefined, alt, taps, buzz: buzz || undefined, odrivePay, sasa, he, discards }, value: value + buzz * 8 });
      } else if (/城$/.test(f.type)) {
        // G城: 表向きでシールド化される (シールドが増える) / 城: 要塞化できるシールドがあれば
        if (/G城$/.test(f.type)) cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 6 });
        else if (me.shield.some((sh) => !s.cards[sh].under.some((u) => s.cards[u].fortOf === sh))) cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 5 });
      } else if (/オーラ/.test(f.type)) {
        // オーラ: 一番強い自分のGRクリーチャーに (いなければGR召喚して) 付ける
        const holder = me.battle.filter((b) => /GR/.test(faceOf(s, L, b)?.type ?? '')).sort((a, b) => power(s, L, b) - power(s, L, a))[0];
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo: holder != null ? [holder] : [] }, value: f.cost * 7 });
      } else if (/クロスギア/.test(f.type)) {
        // クロスギア: クリーチャーがいる時だけジェネレート
        if (me.battle.some((b) => faceOf(s, L, b)?.isCreature)) cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 5 });
      } else if (f.isSpell) {
        // 効果の価値: 効果アシストで分かる除去・ドローと、解釈した効果の見積もりの大きいほう
        // ツインパクトの呪文側は、使うとクリーチャー側を失うので控えめに
        const pv = on(p, 'spell') ? opsValue(s, p, L, faceOps(f)) - (card.faces.some((x) => x.isCreature) ? 8 : 0) : 0;
        const v = Math.max(rv, pv);
        if (v <= 0) return; // 効果を処理できない/対象がいない呪文は使わない
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, alt: alt === 'tapCast' ? 'tapCast' : undefined, taps: alt === 'tapCast' ? taps : undefined }, value: f.cost * 6 + v });
      } else if (on(p, 'element') && /タマシード|フィールド/.test(f.type) && s.cards[h].zone === 'hand') {
        // タマシード・フィールド: バトルゾーンに残って働くので、出た時の効果の価値を足して出す
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo: f.isEvolution ? [] : undefined }, value: f.cost * 6 + Math.max(4, opsValue(s, p, L, faceOps(f)) + rv) });
      }
    });
  }
  // 輪廻∞: バトルゾーンにあるツインパクトの呪文側を唱える
  for (const b of me.battle) {
    const card = L(s.cards[b].cid);
    if (!card || !(faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'rinne')) continue;
    const fi = card.faces.findIndex((f) => f.isSpell);
    if (fi < 0 || costOf(s, L, p, b, fi) > mana) continue;
    const rv = removalValue(card, fi);
    if (rv <= 0) continue;
    cands.push({ a: { t: 'rinne', iid: b }, value: card.faces[fi].cost * 6 + rv + 10 });
  }
  // メタカードの除去には大きな加点をしているので、除去が最優先になる
  return cands.sort((a, b) => b.value - a.value);
}

// ---------- 攻撃 ----------

function chooseAttack(s: GameState, p: number, L: Lookup): Action | null {
  const me = s.players[p];
  const target = targetOpponent(s, p, L);
  if (target == null) return null;
  const attackers = me.battle
    .filter((i) => canAttackWith(s, L, i) && !faceOf(s, L, i)!.kw.cantAttack)
    .sort((a, b) => power(s, L, b, true) - power(s, L, a, true));
  if (!attackers.length) return null;

  const tp = s.players[target];
  const oppBlockers = tp.battle.filter((b) => faceOf(s, L, b)?.kw.blocker && !s.cards[b].tapped);
  const canHitPlayer = (i: number) => attackTargets(s, L, i).players.includes(target);
  const playerHitters = attackers.filter(canHitPlayer);
  // とどめ判定: ブロッカーに止められる分を除いても、全シールド + ダイレクトアタックに届く
  // ブロッカーの数だけ (ブレイク数の多い順に) 止められると仮定し、残りでシールドを割り切ってもう1体通るか
  const breaks = playerHitters.map((i) => Math.min(faceOf(s, L, i)!.kw.breaker, 5)).sort((a, b) => b - a);
  const effective = breaks.slice(Math.min(oppBlockers.length, breaks.length));
  let rem = tp.shield.length;
  let lethal = false;
  for (const b of effective) {
    if (rem <= 0) {
      lethal = true;
      break;
    }
    rem -= b;
  }
  const defensive = underPressure(s, p, L);

  // 山札が少ない時は、攻撃する時に自分の山札を減らすクリーチャーで攻撃しない (とどめを刺せる時は別)
  const selfMill = (i: number) => (faceOf(s, L, i)?.triggers ?? []).some((t) => t.events.includes('attack') && programOf(t.effect).ops.some((o) => (o.op === 'top' && o.who === 'self') || (o.op === 'draw' && o.who === 'self')));
  const deckLow = on(p, 'deck') && me.deck.length <= 6;
  // 攻撃すると追加ターンを得られるなら、ブロッカーでも真っ先にプレイヤーへ攻撃する
  for (const iid of attackers) {
    if (!extraTurnAttacker(s, p, L, iid)) continue;
    const tg = attackTargets(s, L, iid);
    if (tg.players.includes(target)) return { t: 'attack', attacker: iid, player: target };
    if (tg.cards.length) return { t: 'attack', attacker: iid, player: s.cards[tg.cards[0]].owner, card: tg.cards[0] };
  }
  for (const iid of attackers) {
    const f = faceOf(s, L, iid)!;
    if (deckLow && !lethal && selfMill(iid)) continue;
    const myP = power(s, L, iid, true);
    const tg = attackTargets(s, L, iid);
    // 1. タップしているメタクリーチャー・強いクリーチャーを倒せるなら優先
    const huntable = tg.cards
      .filter((t) => power(s, L, t) < myP || (power(s, L, t) === myP && threatOf(s, L, t) >= 8))
      .sort((a, b) => threatOf(s, L, b) - threatOf(s, L, a));
    if (huntable.length && (metaScore(faceOf(s, L, huntable[0])) > 0 || threatOf(s, L, huntable[0]) >= 6) && !lethal) {
      return { t: 'attack', attacker: iid, player: s.cards[huntable[0]].owner, card: huntable[0] };
    }
    // 2. とどめを刺せるなら総攻撃
    if (lethal && tg.players.includes(target)) return { t: 'attack', attacker: iid, player: target };
    // 3. 負けそうな時はブロッカーを守りに残す
    if (f.kw.blocker && (me.battle.length < 3 || (defensive && me.shield.length <= 2))) continue;
    // 4. プレイヤーへ攻撃 (自分より強いブロッカーに一方的に倒されるなら控える)
    if (tg.players.includes(target)) {
      const stronger = oppBlockers.some((b) => power(s, L, b) > myP);
      const plenty = attackers.length >= oppBlockers.length + 2;
      if (!stronger || plenty) return { t: 'attack', attacker: iid, player: target };
    }
    // 5. 倒せるタップ状態のクリーチャーを攻撃
    if (huntable.length) return { t: 'attack', attacker: iid, player: s.cards[huntable[0]].owner, card: huntable[0] };
  }
  return null;
}

// ---------- 効果の選択 ----------

/** 自分のカードの価値 (高いほど手放したくない) */
function ownValue(s: GameState, L: Lookup, iid: number): number {
  const c = s.cards[iid];
  const card = L(c.cid);
  if (!card) return 0;
  const f = c.zone === 'battle' ? (card.faces[c.face] ?? card.faces[0]) : (card.faces.find((x) => x.isCreature) ?? card.faces[0]);
  let v = f.cost * 2 + (f.power ?? 0) / 2000 + Math.min(f.kw.breaker, 5);
  if (f.kw.blocker) v += 1;
  if (f.kw.shieldTrigger && c.zone === 'hand') v -= 1;
  v += metaScore(f) / 3;
  return v;
}

/** 効果の選択肢 (opsの塊) のおおまかな価値 */
function opsValue(s: GameState, p: number, L: Lookup, ops: Op[]): number {
  let v = 0;
  // 山札が少ない時は、自分の山札を減らす効果はマイナス (山札切れで負けないように)
  const low = on(p, 'deck') && s.players[p].deck.length <= 8;
  // 手札が十分にある時は、引いてもあまり得にならない
  const handFull = on(p, 'hand') && s.players[p].hand.length >= 10;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    const nx = ops[k + 1];
    // 「各プレイヤーは〜をすべて山札の下に置く」など、自分のクリーチャーも巻き込む全体の効果は差し引きで見る
    if (on(p, 'mass') && o.op === 'choose' && o.target.ref === 'sel' && o.target.count && 'all' in o.target.count && o.target.sel.owner !== 'opp' && o.target.sel.zones.includes('battle') && (nx?.op === 'move' || nx?.op === 'destroy') && nx.target.ref === 'it') {
      const sel = { ...o.target.sel, owner: 'any' as const };
      const hit = s.players.flatMap((pl) => pl.battle).filter((i) => matchesSel(s, L, i, sel));
      const mine = hit.filter((i) => s.cards[i].owner === p);
      if (mine.length || o.target.sel.owner === 'any') {
        v += hit.filter((i) => s.cards[i].owner !== p).reduce((a, i) => a + 4 + threatOf(s, L, i), 0) - mine.reduce((a, i) => a + 6 + ownValue(s, L, i), 0);
        k++;
        continue;
      }
    }
    if (o.op === 'draw') v += (o.who === 'self' ? (low ? -6 : handFull ? 1 : 4) : -4) * o.n;
    else if (o.op === 'top' && o.who === 'self' && low && o.to !== 'look' && o.to !== 'reveal') v -= 6 * o.n;
    else if (o.op === 'top') v += o.to === 'mana' || o.to === 'manaTapped' ? 3 * o.n : o.to === 'shield' ? 4 * o.n : o.to === 'hand' ? 4 * o.n : 1;
    // 「その中から〜を1枚、手札に加える」: 山札から探す
    else if (o.op === 'choose' && o.target.ref === 'looked' && nx?.op === 'move' && nx.to === 'hand') v += 4;
    // 「自分のマナゾーンにあるカードを1枚、裏向きにする」: 水晶ソウルのカードを使うデッキなら得
    else if (o.op === 'choose' && o.target.ref === 'sel' && o.target.sel.zones.includes('mana') && o.target.sel.owner === 'self' && nx?.op === 'faceDown') {
      const pl = s.players[p];
      v += [...pl.hand, ...pl.deck].some((i) => L(s.cards[i].cid)?.faces.some((f) => crystalOf(f) != null)) ? 3 : -2;
      k++;
    } else if (o.op === 'choose' && o.target.ref === 'sel') {
      const sel = o.target.sel;
      const hostile = o.purpose === 'hostile';
      const pool = opps(s, p).flatMap((x) => s.players[x].battle);
      if (hostile && sel.owner !== 'self') v += pool.length ? 8 + Math.max(...pool.map((i) => threatOf(s, L, i))) : -2;
      else if (o.purpose === 'sacrifice') v -= 5;
      else v += 4;
    } else if (o.op === 'discard') v += o.who === 'opp' ? 5 : -4;
    else if (o.op === 'grSummon') v += 6 * o.n;
    else if (o.op === 'extraTurn' && on(p, 'extra') && !noExtraTurn(s, L)) v += 40;
    else if (on(p, 'rev') && (o.op === 'lockSummon' || o.op === 'noLose')) v += 8;
    else if (on(p, 'rev') && o.op === 'lockSpells') v += 4;
    else if (on(p, 'rev') && o.op === 'grant') v += 3;
    else if (o.op === 'breakShield') v += 3;
    else if (o.op === 'tap' || o.op === 'power' || o.op === 'restrict') v += 2;
    else if (o.op === 'optional' || o.op === 'if') v += opsValue(s, p, L, o.op === 'if' ? o.body : o.body) / 2;
    else if (o.op === 'modal' && on(p, 'modal')) v += Math.max(0, ...o.options.map((x) => opsValue(s, p, L, x.body)));
  }
  return v;
}

function chooseForChoice(s: GameState, p: number, L: Lookup, top: Extract<GameState['pending'][number], { kind: 'choice' }>): Action {
  if (top.mode === 'yesno') {
    const op = top.exec.ops[0];
    const deckLow = s.players[p].deck.length <= 8;
    const risky = op?.op === 'optional' && op.body.some((o) => o.op === 'draw' || (o.op === 'top' && o.who === 'self'));
    if (deckLow && risky) return { t: 'choose', yes: false };
    // 「呪文を1枚、手札から唱えてもよい」: 唱えて得になる呪文がなければ唱えない
    const [c0, c1] = op?.op === 'optional' ? op.body : [];
    if (on(p, 'decline') && c0?.op === 'choose' && c0.target.ref === 'sel' && c1?.op === 'play' && c1.mode === 'cast') {
      const sel = c0.target.sel;
      const pool = sel.zones.flatMap((z) => (s.players[p] as unknown as Record<string, number[]>)[z] ?? []).filter((i) => matchesSel(s, L, i, { ...sel, owner: 'any' }));
      const best = Math.max(-1, ...pool.map((i) => Math.max(...(L(s.cards[i].cid)?.faces.filter((f) => f.isSpell).map((f) => opsValue(s, p, L, faceOps(f))) ?? [-1]))));
      if (best <= 0) return { t: 'choose', yes: false };
    }
    if (op?.op === 'optional' && opsValue(s, p, L, op.body) < 0 && !top.exec.ops.slice(1).some((o) => o.op === 'if' && o.cond.c === 'did'))
      return { t: 'choose', yes: false };
    // タブラサ・チャンタラム 「(マナゾーンに置いた) それを裏向きにしてもよい」: 水晶ソウルのカードを使うデッキの時だけ
    // (水晶設計図・ワスプメリサ 「自分のマナゾーンにあるカードを1枚、裏向きにしてもよい」も)
    if (op?.op === 'optional' && (c0?.op === 'faceDown' ? op.body.length === 1 : c0?.op === 'choose' && c1?.op === 'faceDown' && op.body.length === 2)) {
      const pl = s.players[p];
      const hasCrystal = [...pl.hand, ...pl.deck].some((i) => L(s.cards[i].cid)?.faces.some((f) => crystalOf(f) != null));
      return { t: 'choose', yes: hasCrystal };
    }
    return { t: 'choose', yes: true };
  }
  if (top.mode === 'modal') {
    const op = top.exec.ops[0];
    if (op?.op === 'topOrBottom') {
      // 自分のカードで良いもの (コスト4以上) なら上、相手のカードや弱いカードは下
      const ids = top.exec.pendingIds ?? [];
      const good = ids.some((i) => s.cards[i].owner === p && (L(s.cards[i].cid)?.faces[0]?.cost ?? 0) >= 4);
      return { t: 'choose', options: [good ? 0 : 1] };
    }
    // カード名: 相手のいちばん強いクリーチャーの名前 (なければ見えている名前の1つ目)
    if (op?.op === 'chooseValue' && op.kind === 'name') {
      const strongest = oppCreaturesByThreat(s, p, L).map((i) => nameOf(s, L, i)).find((n) => n !== op.exclude);
      if (strongest) return { t: 'choose', value: strongest };
      return { t: 'choose', options: (top.labels ?? []).length ? [0] : [] };
    }
    if (op?.op === 'chooseValue') {
      // 有利な効果なら自分の、不利な効果なら相手のクリーチャーで一番多い種族・文明・コスト
      const who = op.hostile ? s.players.filter((_, i) => i !== p).flatMap((pl) => pl.battle) : [...s.players[p].battle, ...s.players[p].hand];
      const tally = new Map<string, number>();
      for (const i of who) {
        const f = faceOf(s, L, i) ?? L(s.cards[i].cid)?.faces[0];
        if (!f) continue;
        const keys = op.kind === 'race' ? f.races : op.kind === 'civ' ? f.civs.map((c) => CIV_NAME[c]) : [String(f.cost)];
        for (const k of keys) tally.set(k, (tally.get(k) ?? 0) + 1);
      }
      const labels = top.labels ?? [];
      let best = 0;
      let bestN = -1;
      labels.forEach((l, i) => {
        const n = [...tally.entries()].filter(([k]) => k.includes(l) || l.includes(k)).reduce((a, [, v]) => a + v, 0);
        if (n > bestN) (best = i), (bestN = n);
      });
      return { t: 'choose', options: [best] };
    }
    // プレイヤーを選ぶ: 自分を入れて、残りは順に
    if (op?.op === 'choosePlayers') {
      const ids = top.exec.chosenPlayers ?? [];
      const order = [ids.indexOf(p), ...ids.map((_, k) => k).filter((k) => ids[k] !== p)].filter((k) => k >= 0);
      return { t: 'choose', options: order.slice(0, top.min) };
    }
    if (op?.op !== 'modal') return { t: 'choose', options: [0] };
    const scored = op.options.map((o, i) => ({ i, v: opsValue(s, p, L, o.body) })).sort((a, b) => b.v - a.v);
    return { t: 'choose', options: scored.slice(0, top.max).map((x) => x.i) };
  }
  // カードを選ぶ
  const score = (i: number) => {
    const mine = s.cards[i].owner === p;
    if (top.purpose === 'hostile') return mine ? -100 - ownValue(s, L, i) : threatOf(s, L, i) + ownValue(s, L, i) / 4;
    if (top.purpose === 'sacrifice') return -ownValue(s, L, i);
    if (top.purpose === 'benefit') return mine ? ownValue(s, L, i) : -threatOf(s, L, i);
    return 0;
  };
  // 選んだカードをそのまま唱える時は、呪文の効果の価値で選ぶ (追加ターンの呪文を最優先)
  const next = top.exec.ops[1];
  const casting = on(p, 'extra') && top.purpose === 'benefit' && top.exec.ops[0]?.op === 'choose' && next?.op === 'play' && next.mode === 'cast';
  const castScore = (i: number) => {
    const f = L(s.cards[i].cid)?.faces.find((x) => x.isSpell);
    return f ? opsValue(s, p, L, faceOps(f)) + f.cost / 10 : -99;
  };
  const ranked = [...top.options].sort((a, b) => (casting ? castScore(b) - castScore(a) : score(b) - score(a)));
  const n = top.purpose === 'sacrifice' ? top.min : top.max;
  if (top.distinct) {
    // 異なるカードタイプ・コストのものだけ: 価値の高い順に、同じ種類は1枚まで
    // (ゾーンが異なる・種族が異なるものも同じ。コストの合計の上限があれば超えないように)
    const seen = new Set<string>();
    const picks: number[] = [];
    let sum = 0;
    for (const i of [...top.options].sort((a, b) => ownValue(s, L, b) - ownValue(s, L, a))) {
      const cd = L(s.cards[i].cid);
      const keys = top.distinct === 'race' ? (cd?.faces.flatMap((f) => f.races) ?? []) : [top.distinct === 'zone' ? s.cards[i].zone : top.distinct === 'cost' ? String(cd?.faces[0]?.cost) : (cd?.faces.map((f) => (f.isCreature ? 'クリーチャー' : f.isSpell ? '呪文' : f.type)).join('/') ?? '')];
      const cost = cd?.faces[0]?.cost ?? 0;
      if (keys.some((k) => seen.has(k)) || picks.length >= top.max || (top.sumCostMax != null && sum + cost > top.sumCostMax)) continue;
      for (const k of keys) seen.add(k);
      sum += cost;
      picks.push(i);
    }
    return { t: 'choose', picks };
  }
  if (top.sumCostMin != null) {
    // コストの合計の下限: 価値の低い順に、合計が届くまで選ぶ (届かなければ選ばない)
    const picks: number[] = [];
    let sum = 0;
    for (const i of [...top.options].sort((a, b) => ownValue(s, L, a) - ownValue(s, L, b))) {
      if (sum >= top.sumCostMin || picks.length >= top.max) break;
      picks.push(i);
      sum += L(s.cards[i].cid)?.faces[0]?.cost ?? 0;
    }
    return { t: 'choose', picks: sum >= top.sumCostMin ? picks : [] };
  }
  // 「その中から1枚を選ぶ。その選んだカードとコストが同じ相手のクリーチャーを〜」: 一番多く巻き込めるコストのカード
  const nx = top.exec.ops[1];
  if (top.purpose === 'neutral' && nx?.op === 'choose' && nx.target.ref === 'sel' && nx.target.sel.costEqIt) {
    const sel = nx.target.sel;
    const hits = (i: number) => {
      const co = L(s.cards[i].cid)?.faces[0]?.cost;
      return s.players.flatMap((pl, o) => (o === p ? [] : pl.battle)).filter((b) => matchesSel(s, L, b, { ...sel, costEqIt: undefined }) && faceOf(s, L, b)?.cost === co).reduce((a, b) => a + 1 + threatOf(s, L, b), 0);
    };
    return { t: 'choose', picks: [...top.options].sort((a, b) => hits(b) - hits(a)).slice(0, Math.max(1, top.min)) };
  }
  if (top.sumCostMax != null) {
    // コストの合計の上限内で、価値の高い順に詰める
    const picks: number[] = [];
    let sum = 0;
    for (const i of ranked) {
      const co = L(s.cards[i].cid)?.faces[0]?.cost ?? 0;
      if (sum + co <= top.sumCostMax && picks.length < top.max) {
        picks.push(i);
        sum += co;
      }
    }
    return { t: 'choose', picks };
  }
  if (top.sumPowerMax != null) {
    // パワーの合計の上限内で、価値の高い順に詰める
    const picks: number[] = [];
    let sum = 0;
    for (const i of ranked) {
      const pw = power(s, L, i);
      if (sum + pw <= top.sumPowerMax && picks.length < top.max) {
        picks.push(i);
        sum += pw;
      }
    }
    return { t: 'choose', picks };
  }
  return { t: 'choose', picks: ranked.slice(0, Math.max(top.min, n)) };
}

// ---------- 判断 ----------

/** CPUの次の一手 (null = 何もしない) */
export function cpuDecide(s: GameState, p: number, L: Lookup): Action | null {
  // 同時に誘発した自分の能力: 価値の高いものから処理する (「〜してもよい」を使うかは、処理する時にいつも通り判断する)
  const pk = abilityPick(s);
  if (pk && pk.indices.length >= 2) {
    if (pk.player !== p) return null;
    const val = (i: number) => {
      const x = s.pending[i];
      return x.kind === 'ability' ? opsValue(s, p, L, programOf(x.effect).ops) : 0;
    };
    const best = [...pk.indices].sort((a, b) => val(b) - val(a))[0];
    return { t: 'pickAbility', index: best, use: true };
  }
  const top = s.pending[0];
  if (top) {
    if (top.player !== p) return null;
    switch (top.kind) {
      case 'attackOpt': {
        const att = s.attack!.attacker;
        const cur = power(s, L, att, true);
        let best: number | null = null;
        let bestP = cur;
        if (on(p, 'rev')) {
          // 入れ替えた後のパワーと「出た時」(「革命チェンジ」によって出た時・ファイナル革命を含む) の効果で選ぶ
          let bestV = 0;
          for (const o of top.options) {
            const card = L(s.cards[o].cid)!;
            const f = card.faces.find((x) => x.isCreature) ?? card.faces[0];
            const v = ((f.power ?? 0) - cur) / 2000 + revEnterValue(s, p, L, f) + (f.kw.invasion ? 5 : 0);
            if (v > bestV) (best = o), (bestV = v);
          }
          return { t: 'attackOpt', iid: best };
        }
        for (const o of top.options) {
          const card = L(s.cards[o].cid)!;
          const f = card.faces.find((x) => x.isCreature) ?? card.faces[0];
          const pw = f.power ?? 0;
          if (f.kw.invasion || pw > bestP) {
            best = o;
            bestP = pw;
          }
        }
        return { t: 'attackOpt', iid: best };
      }
      case 'block': {
        const at = s.attack!;
        const ap = power(s, L, at.attacker, true);
        const breaker = faceOf(s, L, at.attacker)?.kw.breaker ?? 1;
        const shields = s.players[p].shield.length;
        // 選ぶ前に破壊されるなどして、もうブロックできないクリーチャーは除く
        const sorted = top.blockers.filter((b) => s.cards[b].zone === 'battle' && !s.cards[b].tapped).sort((a, b) => power(s, L, a) - power(s, L, b));
        // 「可能であればブロックする」
        const oppMust = activeStatics(s, L).some((x) => x.owner !== p && x.spec.s === 'oppMustBlock');
        const must = sorted.find((b) => oppMust || (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'mustBlock') || (s.cards[b].grants ?? []).some((g) => g.kws.includes('強制ブロック')));
        if (must != null) return { t: 'block', blocker: must };
        // ガードマン: 守られるクリーチャーより価値が低い/生き残るなら身代わりに
        if (at.targetCard != null)
          for (const g of (top.guards ?? []).filter((x) => s.cards[x].zone === 'battle' && !s.cards[x].tapped)) {
            if (power(s, L, g) > ap || threatOf(s, L, at.targetCard) > threatOf(s, L, g)) return { t: 'block', guard: g };
          }
        // 生き残って倒せる → ブロック
        const survive = sorted.find((b) => power(s, L, b) > ap);
        if (survive != null) return { t: 'block', blocker: survive };
        // 負けそう・ダイレクトアタック → 身を挺してブロック
        if (at.targetCard == null && (shields === 0 || shields <= breaker)) return { t: 'block', blocker: sorted[0] ?? null };
        // 相打ちで脅威を消せる
        const trade = sorted.find((b) => power(s, L, b) === ap);
        if (trade != null && threatOf(s, L, at.attacker) >= threatOf(s, L, trade)) return { t: 'block', blocker: trade };
        return { t: 'block', blocker: null };
      }
      case 'breakSel':
        return { t: 'breakSel', shields: s.players[top.target].shield.slice(0, top.count) };
      case 'trigger': {
        const card = L(s.cards[top.iid].cid);
        if (!card) return { t: 'trigger', use: false };
        if (top.trigger) {
          const fi = card.faces.findIndex((f) => f.kw.shieldTrigger);
          const use: Action = { t: 'trigger', use: true, face: Math.max(0, fi) };
          // 「相手はコスト7のカードを実行できない」などで使えない時は使わない
          return applyAction(s, p, use, L).error ? { t: 'trigger', use: false } : use;
        }
        // G・ストライク: 一番危険な攻撃可能クリーチャーを止める
        const ranked = oppCreaturesByThreat(s, p, L).filter((i) => !s.cards[i].tapped);
        const att = s.attack?.attacker ?? ranked[0];
        return { t: 'trigger', use: att != null, target: att ?? null };
      }
      case 'partner':
        return { t: 'partner', yes: true };
      case 'ability':
        return { t: 'resolve', use: true };
      case 'choice':
        return chooseForChoice(s, p, L, top);
    }
  }
  if (s.active !== p || s.phase === 'over') return null;
  const me = s.players[p];

  // 1. マナチャージ (先にチャージして、そのマナも使う)
  if (!me.charged && s.phase === 'main') {
    const pick = chooseCharge(s, p, L);
    if (pick != null) return { t: 'charge', iid: pick };
  }

  // 2. 除去・召喚・呪文 (価値の高い順)
  if (s.phase === 'main') {
    const cands = playCandidates(s, p, L);
    // 実際に実行できるものだけ (コストの見積もりが合わない等で失敗するものは飛ばす)
    for (const c of cands.slice(0, 8)) if (!applyAction(s, p, c.a, L).error) return c.a;
  }

  // 2.5 ハイパー化 (攻撃できないクリーチャーだけでタップできる時) / タップして使う能力 / クロス
  if (s.phase === 'main') {
    const creatures = me.battle.filter((b) => faceOf(s, L, b)?.isCreature).sort((a, b) => threatOf(s, L, b) - threatOf(s, L, a));
    for (const g of me.battle) {
      const gf = faceOf(s, L, g);
      if (!gf || !/クロスギア/.test(gf.type) || !creatures.length) continue;
      const onto = creatures[0];
      const pay = autoPay(s, L, p, gf.civs as Civ[], crossCost(s, L, g, onto));
      if (pay) return { t: 'cross', iid: g, onto, pay };
    }
    const idle = me.battle.filter((b) => !s.cards[b].tapped && faceOf(s, L, b)?.isCreature && !canAttackWith(s, L, b));
    for (const iid of me.battle) {
      const card = L(s.cards[iid].cid);
      const hz = card?.hyper && s.cards[iid].face === 0 ? card.faces[0].statics.find((x) => x.s === 'hyperize') : undefined;
      if (!hz || hz.s !== 'hyperize') continue;
      const taps = idle.filter((b) => b !== iid).slice(0, hz.n);
      if (taps.length === hz.n) return { t: 'hyperize', iid, taps };
    }
    // ダイナモ: 攻撃できるダイナモが2体以上いれば、弱いほうのパワーと能力を強いほうに加える
    const dyn = me.battle.filter((b) => (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'dynamo') && canAttackWith(s, L, b) && !faceOf(s, L, b)!.kw.cantAttack);
    if (dyn.length >= 2) {
      const sorted = [...dyn].sort((a, b) => power(s, L, a) - power(s, L, b));
      return { t: 'dynamo', iid: sorted[0], onto: sorted[sorted.length - 1] };
    }
    // デュエリスト: 実行できる一番コストの大きいデュエルメイトを実行する
    for (const d of me.partner) {
      if (me.duelistTurn === s.turn) break;
      const ts = duelistTargets(s, L, p, d);
      if (!ts.length) continue;
      const best = ts.reduce((a, b) => ((L(s.cards[b].cid)?.faces[0]?.cost ?? 0) > (L(s.cards[a].cid)?.faces[0]?.cost ?? 0) ? b : a));
      return { t: 'duelist', iid: d, target: best };
    }
    for (const iid of me.battle) {
      const ta = tapAbilityOf(s, L, iid);
      if (!ta || s.cards[iid].tapped || (s.cards[iid].sick && !kwOf(s, L, iid).speedAttacker)) continue;
      // いっしょにタップするマナが足りなければ使えない
      if (ta.tapMana && me.mana.filter((m) => !s.cards[m].tapped).length < ta.tapMana) continue;
      // 可能なら攻撃しなければならないクリーチャーは攻撃に回す
      if (mustAttackers(s, L, p).includes(iid)) continue;
      // 処理できる効果で、攻撃しても相手のシールドを割れない程度のクリーチャーなら使う
      if (!programOf(ta.text).complete) continue;
      if (power(s, L, iid, true) >= 6000 && s.players[mainOpp(s, p)].shield.length <= 2) continue;
      return { t: 'tapAbility', iid };
    }
  }

  // 3. 攻撃 (「可能なら攻撃する」「可能ならこのクリーチャーを攻撃する」に従う)
  let atk = chooseAttack(s, p, L);
  if (!atk) {
    const must = mustAttackers(s, L, p)[0];
    if (must != null) {
      // 実際に宣言できる攻撃先を選ぶ
      const tg = attackTargets(s, L, must);
      const tries: Action[] = [
        ...tg.players.map((pl) => ({ t: 'attack' as const, attacker: must, player: pl })),
        ...tg.cards.map((c) => ({ t: 'attack' as const, attacker: must, player: s.cards[c].owner, card: c })),
      ];
      atk = tries.find((a) => !applyAction(s, p, a, L).error) ?? null;
    }
  }
  if (atk && atk.t === 'attack') {
    const lures = luresFor(s, L, atk.attacker);
    if (lures.length && !(atk.card != null && lures.includes(atk.card))) atk = { t: 'attack', attacker: atk.attacker, player: s.cards[lures[0]].owner, card: lures[0] };
    // 宣言できない攻撃なら、ターンを終える (攻撃の強制で終われない時は別の攻撃先を試す)
    if (applyAction(s, p, atk, L).error) atk = null;
  }
  if (!atk) {
    for (const b of mustAttackers(s, L, p)) {
      const tg = attackTargets(s, L, b);
      const tries: Action[] = [
        ...tg.players.map((pl) => ({ t: 'attack' as const, attacker: b, player: pl })),
        ...tg.cards.map((c) => ({ t: 'attack' as const, attacker: b, player: s.cards[c].owner, card: c })),
      ];
      atk = tries.find((a) => !applyAction(s, p, a, L).error) ?? null;
      if (atk) break;
    }
  }
  if (atk) return atk;

  return { t: 'endTurn' };
}

/**
 * CPU の行動をまとめて返す。
 * 誘発型能力・呪文の効果は、検出できた効果を実行してから「処理完了」にする。
 */
export function cpuPlan(s: GameState, p: number, L: Lookup): Action[] {
  const top = s.pending[0];
  // (同時に誘発した能力の順番を選ぶのが先)
  const pk = abilityPick(s);
  const ordering = !!pk && pk.indices.length >= 2;
  if (!ordering && top?.kind === 'ability' && top.player === p) {
    const out: Action[] = [];
    let cur = s;
    for (const h of hintsFromText(top.effect.split('\n'))) {
      // 自分の山札を削る効果は任意なら使わない
      if (h.kind === 'mill' && top.optional) continue;
      for (const ea of hintActions(cur, p, L, h)) {
        const r = applyAction(cur, p, ea, L);
        if (!r.error) {
          out.push(ea);
          cur = r.state;
        }
      }
    }
    out.push({ t: 'resolve', use: true });
    return out;
  }
  const a = cpuDecide(s, p, L);
  return a ? [a] : [];
}
