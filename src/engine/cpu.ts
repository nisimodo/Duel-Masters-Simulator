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
import { stripReminder } from '../lib/triggers';
import { effectHints, hintsFromText, type EffectHint } from './effects';
import {
  applyAction,
  attackTargets,
  autoPay,
  canAttackWith,
  crossCost,
  luresFor,
  mustAttackers,
  playCost,
  cardCivs,
  faceOf,
  kwOf,
  power,
  untappedMana,
  type Lookup,
} from './engine';
import { matchesCond } from './cond';
import { costOf } from './statics';
import { mainOpp, matchesSel, programOf } from './interp';
import type { Action, GameState } from './types';
import type { Op } from '../rules/ops';

const opps = (s: GameState, p: number) => s.players.map((_, i) => i).filter((i) => i !== p && !s.players[i].lost);

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

  const score = (i: number) => {
    const card = L(s.cards[i].cid);
    if (!card) return -99;
    const faces = card.faces;
    const maxCost = Math.max(...faces.map((f) => f.cost));
    const minCost = Math.min(...faces.map((f) => f.cost));
    const multi = card.civs.length > 1;
    const bringsCiv = card.civs.some((c) => !manaCivs.has(c));
    const isRemoval = faces.some((_f, fi) => effectHints(card, fi).some((h) => REMOVAL.includes(h.kind)));
    const holdForAttack = faces.some((f) => f.kw.revChange || f.kw.invasion);
    let sc = 0;
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
      } else if (h.kind === 'draw' || h.kind === 'manaTop') v += 6 * h.n;
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
        (f.statics ?? []).some(
          (x) =>
            (x.s === 'summonFrom' && x.zone === s.cards[i].zone) ||
            (x.s === 'manaBakutan' && s.cards[i].zone === 'mana') ||
            ((x.s === 'mugen' || x.s === 'fushigi' || x.s === 'abyss') && s.cards[i].zone === 'grave'),
        ),
    ),
  );
  for (const h of [...me.hand, ...me.partner.filter((i) => s.cards[i].faceUp), ...fromOtherZones]) {
    const card = L(s.cards[h].cid);
    if (!card) continue;
    card.faces.forEach((f, fi) => {
      if (card.hyper && fi > 0) return;
      if (s.cards[h].zone === 'partner' && !f.isCreature) return;
      if (s.cards[h].zone !== 'hand' && s.cards[h].zone !== 'partner' && !f.isCreature) return;
      // G・ゼロが使えるならコストを支払わずに
      const gz = playCost(s, L, p, { t: 'play', iid: h, face: fi, pay: [], gzero: true }, fi) === 0;
      // マナ爆誕 (マナゾーンから) / J・O・E・B・A・D (普通に出せない時だけ軽くして出す)
      let alt: 'joe' | 'bad' | 'mana' | 'mugen' | 'fushigi' | 'abyss' | 'galaxy' | undefined;
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
      } else if (!gz && costOf(s, L, p, h, fi) > mana) {
        const d = st.find((x) => x.s === 'discountSummon');
        if (d && d.s === 'discountSummon') alt = d.kind;
        else if (st.some((x) => x.s === 'galaxy') && s.cards[h].zone === 'hand') alt = 'galaxy';
      }
      const altCost = alt ? playCost(s, L, p, { t: 'play', iid: h, face: fi, pay: [], alt, taps }, fi) : null;
      if (alt && typeof altCost !== 'number') return;
      const cost = gz ? 0 : alt ? (altCost as number) : costOf(s, L, p, h, fi);
      if (cost > mana) return;
      const pay = gz ? [] : autoPay(s, L, p, f.civs as Civ[], cost);
      if (!pay) return;
      const rv = removalValue(card, fi);
      if (f.isCreature) {
        let evo: number[] | undefined;
        const em = (f.statics ?? []).find((x) => x.s === 'evoMulti');
        if (f.isEvolution && em && em.s === 'evoMulti') {
          // 進化GV / 超無限進化: 条件に合う弱いクリーチャーから必要な数だけ
          const bases = me.battle.filter((b) => faceOf(s, L, b)?.isCreature && matchesSel(s, L, b, em.sel)).sort((a, b) => threatOf(s, L, a) - threatOf(s, L, b));
          if (bases.length < em.min) return;
          evo = bases.slice(0, em.exact ? em.min : Math.max(em.min, bases.length));
        } else if (f.isEvolution) {
          const base = [...me.battle]
            .filter((b) => {
              const bf = faceOf(s, L, b);
              const bc = L(s.cards[b].cid);
              return bf && (bf.isCreature || (bf.statics ?? []).some((x) => x.s === 'sinkalize')) && bc && (!f.kw.evoCond || matchesCond(f.kw.evoCond, bc, bf));
            })
            .sort((a, b) => power(s, L, a) - power(s, L, b))[0];
          if (base == null) return;
          evo = [base];
        }
        // 革命チェンジ/侵略持ちは、攻撃時に使える場面なら温存
        if (
          (f.kw.revChange || f.kw.invasion) &&
          me.battle.some((b) => {
            const bc = L(s.cards[b].cid);
            const bf = faceOf(s, L, b);
            return bc && bf && ((f.kw.revChange && matchesCond(f.kw.revChange, bc, bf)) || (f.kw.invasion && matchesCond(f.kw.invasion, bc, bf)));
          })
        )
          return;
        let value = f.cost * 10 + (f.power ?? 0) / 1000 + Math.min(f.kw.breaker, 5) * 3 + rv;
        if (f.kw.blocker && defensive) value += 20;
        if (f.kw.speedAttacker) value += 5;
        value += metaScore(f) / 2; // 自分のメタカードも価値が高い
        if (alt === 'joe' || alt === 'bad' || alt === 'abyss') value = value * 0.6; // ターンの終わりに離れる
        if (alt === 'galaxy') value = value * 0.4; // シールドとして置くだけ
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo, gzero: gz || undefined, alt, taps }, value });
      } else if (/オーラ/.test(f.type)) {
        // オーラ: 一番強い自分のGRクリーチャーに (いなければGR召喚して) 付ける
        const holder = me.battle.filter((b) => /GR/.test(faceOf(s, L, b)?.type ?? '')).sort((a, b) => power(s, L, b) - power(s, L, a))[0];
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo: holder != null ? [holder] : [] }, value: f.cost * 7 });
      } else if (/クロスギア/.test(f.type)) {
        // クロスギア: クリーチャーがいる時だけジェネレート
        if (me.battle.some((b) => faceOf(s, L, b)?.isCreature)) cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 5 });
      } else if (f.isSpell) {
        if (rv <= 0) return; // 効果を処理できない/対象がいない呪文は使わない
        cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 6 + rv });
      }
    });
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

  for (const iid of attackers) {
    const f = faceOf(s, L, iid)!;
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
  for (const o of ops) {
    if (o.op === 'draw') v += (o.who === 'self' ? 4 : -4) * o.n;
    else if (o.op === 'top') v += o.to === 'mana' || o.to === 'manaTapped' ? 3 * o.n : o.to === 'shield' ? 4 * o.n : o.to === 'hand' ? 4 * o.n : 1;
    else if (o.op === 'choose' && o.target.ref === 'sel') {
      const sel = o.target.sel;
      const hostile = o.purpose === 'hostile';
      const pool = opps(s, p).flatMap((x) => s.players[x].battle);
      if (hostile && sel.owner !== 'self') v += pool.length ? 8 + Math.max(...pool.map((i) => threatOf(s, L, i))) : -2;
      else if (o.purpose === 'sacrifice') v -= 5;
      else v += 4;
    } else if (o.op === 'discard') v += o.who === 'opp' ? 5 : -4;
    else if (o.op === 'grSummon') v += 6 * o.n;
    else if (o.op === 'breakShield') v += 3;
    else if (o.op === 'tap' || o.op === 'power' || o.op === 'restrict') v += 2;
    else if (o.op === 'optional' || o.op === 'if') v += opsValue(s, p, L, o.op === 'if' ? o.body : o.body) / 2;
  }
  return v;
}

function chooseForChoice(s: GameState, p: number, L: Lookup, top: Extract<GameState['pending'][number], { kind: 'choice' }>): Action {
  if (top.mode === 'yesno') {
    const op = top.exec.ops[0];
    const deckLow = s.players[p].deck.length <= 8;
    const risky = op?.op === 'optional' && op.body.some((o) => o.op === 'draw' || (o.op === 'top' && o.who === 'self'));
    if (deckLow && risky) return { t: 'choose', yes: false };
    if (op?.op === 'optional' && opsValue(s, p, L, op.body) < 0 && !top.exec.ops.slice(1).some((o) => o.op === 'if' && o.cond.c === 'did'))
      return { t: 'choose', yes: false };
    return { t: 'choose', yes: true };
  }
  if (top.mode === 'modal') {
    const op = top.exec.ops[0];
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
  const ranked = [...top.options].sort((a, b) => score(b) - score(a));
  const n = top.purpose === 'sacrifice' ? top.min : top.max;
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
  const top = s.pending[0];
  if (top) {
    if (top.player !== p) return null;
    switch (top.kind) {
      case 'attackOpt': {
        const att = s.attack!.attacker;
        const cur = power(s, L, att, true);
        let best: number | null = null;
        let bestP = cur;
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
        const sorted = [...top.blockers].sort((a, b) => power(s, L, a) - power(s, L, b));
        // ガードマン: 守られるクリーチャーより価値が低い/生き残るなら身代わりに
        if (at.targetCard != null)
          for (const g of top.guards ?? []) {
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
          return { t: 'trigger', use: true, face: Math.max(0, fi) };
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
    if (cands.length) return cands[0].a;
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
    for (const iid of me.battle) {
      const f = faceOf(s, L, iid);
      if (!f?.tapAbility || s.cards[iid].tapped || (s.cards[iid].sick && !kwOf(s, L, iid).speedAttacker)) continue;
      // 処理できる効果で、攻撃しても相手のシールドを割れない程度のクリーチャーなら使う
      if (!programOf(f.tapAbility).complete) continue;
      if (power(s, L, iid, true) >= 6000 && s.players[mainOpp(s, p)].shield.length <= 2) continue;
      return { t: 'tapAbility', iid };
    }
  }

  // 3. 攻撃 (「可能なら攻撃する」「可能ならこのクリーチャーを攻撃する」に従う)
  let atk = chooseAttack(s, p, L);
  if (!atk) {
    const must = mustAttackers(s, L, p)[0];
    if (must != null) {
      const tg = attackTargets(s, L, must);
      atk = tg.players.length ? { t: 'attack', attacker: must, player: tg.players[0] } : { t: 'attack', attacker: must, player: s.cards[tg.cards[0]].owner, card: tg.cards[0] };
    }
  }
  if (atk && atk.t === 'attack') {
    const lures = luresFor(s, L, atk.attacker);
    if (lures.length && !(atk.card != null && lures.includes(atk.card))) atk = { t: 'attack', attacker: atk.attacker, player: s.cards[lures[0]].owner, card: lures[0] };
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
  if (top?.kind === 'ability' && top.player === p) {
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
