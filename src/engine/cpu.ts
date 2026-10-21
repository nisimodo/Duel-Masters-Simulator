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
import type { Card, Civ, Face } from '../lib/cards';
import { stripReminder } from '../lib/triggers';
import { effectHints, hintsFromText, type EffectHint } from './effects';
import {
  applyAction,
  attackTargets,
  autoPay,
  canAttackWith,
  cardCivs,
  faceOf,
  power,
  untappedMana,
  type Lookup,
} from './engine';
import { matchesCond } from './cond';
import type { Action, GameState } from './types';

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
    case 'breakOpp': {
      if (targets) return targets.map((iid) => ({ t: 'breakManual', iid }) as Action);
      const o = targetOpponent(s, p, L);
      return o == null ? [] : s.players[o].shield.slice(0, h.n).map((iid) => ({ t: 'breakManual', iid }) as Action);
    }
  }
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
      if (REMOVAL.includes(h.kind)) {
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

  for (const h of [...me.hand, ...me.partner.filter((i) => s.cards[i].faceUp)]) {
    const card = L(s.cards[h].cid);
    if (!card) continue;
    card.faces.forEach((f, fi) => {
      if (f.cost > mana) return;
      if (s.cards[h].zone === 'partner' && !f.isCreature) return;
      const pay = autoPay(s, L, p, f.civs as Civ[], f.cost);
      if (!pay) return;
      const rv = removalValue(card, fi);
      if (f.isCreature) {
        let evo: number[] | undefined;
        if (f.isEvolution) {
          const base = [...me.battle]
            .filter((b) => {
              const bf = faceOf(s, L, b);
              const bc = L(s.cards[b].cid);
              return bf?.isCreature && bc && (!f.kw.evoCond || matchesCond(f.kw.evoCond, bc, bf));
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
        cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo }, value });
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

  // 3. 攻撃
  const atk = chooseAttack(s, p, L);
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
