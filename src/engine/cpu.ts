// CPU の思考ルーチン (キーワード能力と効果アシストで処理できる範囲で戦う)
import type { Civ } from '../lib/cards';
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

/** 効果アシストを具体的なアクションに変換する (targets 未指定なら自動で選ぶ) */
export function hintActions(s: GameState, p: number, L: Lookup, h: EffectHint, targets?: number[]): Action[] {
  const oppCreatures = opps(s, p)
    .flatMap((o) => s.players[o].battle)
    .filter((i) => faceOf(s, L, i)?.isCreature && (h.maxPower == null || power(s, L, i) <= h.maxPower))
    .sort((a, b) => power(s, L, b) - power(s, L, a));
  const pickCreatures = () => targets ?? oppCreatures.slice(0, h.n);
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
      return (targets ?? oppCreatures.filter((i) => !s.cards[i].tapped).slice(0, h.n)).map((iid) => ({ t: 'tap', iid, v: true }) as Action);
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
      const o = opps(s, p).sort((a, b) => s.players[a].shield.length - s.players[b].shield.length)[0];
      return o == null ? [] : s.players[o].shield.slice(0, h.n).map((iid) => ({ t: 'breakManual', iid }) as Action);
    }
  }
}

function weakestOpponent(s: GameState, p: number) {
  return opps(s, p).sort((a, b) => s.players[a].shield.length - s.players[b].shield.length)[0];
}

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
        const survive = sorted.find((b) => power(s, L, b) > ap);
        if (survive != null) return { t: 'block', blocker: survive };
        if (at.targetCard == null && (shields === 0 || shields <= breaker)) return { t: 'block', blocker: sorted[0] ?? null };
        const trade = sorted.find((b) => power(s, L, b) === ap);
        if (trade != null && ap >= 5000) return { t: 'block', blocker: trade };
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
        const att = s.attack?.attacker ?? opps(s, p).flatMap((o) => s.players[o].battle).find((i) => !s.cards[i].tapped);
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

  // 1. マナチャージ
  if (!me.charged && s.phase === 'main' && me.hand.length && (me.mana.length < 7 || me.hand.length >= 3)) {
    const manaCivs = new Set(me.mana.flatMap((i) => cardCivs(L, s.cards[i].cid)));
    const handCivs = me.hand.flatMap((i) => cardCivs(L, s.cards[i].cid));
    const missing = handCivs.find((c) => !manaCivs.has(c));
    const score = (i: number) => {
      const card = L(s.cards[i].cid);
      if (!card) return 0;
      const f = card.faces[0];
      let sc = f.cost;
      if (f.cost <= me.mana.length + 1) sc -= 10; // すぐ使えるカードは残す
      if (missing && card.civs.includes(missing)) sc += 6;
      if (card.civs.length > 1) sc -= 2; // 多色はタップインなので少し避ける
      if (card.faces.some((x) => x.kw.shieldTrigger)) sc -= 1;
      return sc;
    };
    const pick = [...me.hand].sort((a, b) => score(b) - score(a))[0];
    return { t: 'charge', iid: pick };
  }

  // 2. 召喚・呪文
  if (s.phase === 'main') {
    const mana = untappedMana(s, p);
    const cands: { a: Action; value: number }[] = [];
    for (const h of [...me.hand, ...me.partner.filter((i) => s.cards[i].faceUp)]) {
      const card = L(s.cards[h].cid);
      if (!card) continue;
      card.faces.forEach((f, fi) => {
        if (f.cost > mana) return;
        if (s.cards[h].zone === 'partner' && !f.isCreature) return;
        const pay = autoPay(s, L, p, f.civs as Civ[], f.cost);
        if (!pay) return;
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
          // 革命チェンジ/侵略持ちは攻撃時に使うため温存
          if ((f.kw.revChange || f.kw.invasion) && me.battle.some((b) => {
            const bc = L(s.cards[b].cid);
            const bf = faceOf(s, L, b);
            return bc && bf && ((f.kw.revChange && matchesCond(f.kw.revChange, bc, bf)) || (f.kw.invasion && matchesCond(f.kw.invasion, bc, bf)));
          }))
            return;
          cands.push({ a: { t: 'play', iid: h, face: fi, pay, evo }, value: f.cost * 10 + (f.power ?? 0) / 1000 + 5 });
        } else if (f.isSpell) {
          const hints = effectHints(card, fi);
          if (!hints.length) return;
          const useful = hints.some((x) => !x.target || opps(s, p).some((o) => s.players[o].battle.length));
          if (!useful) return;
          cands.push({ a: { t: 'play', iid: h, face: fi, pay }, value: f.cost * 10 });
        }
      });
    }
    cands.sort((a, b) => b.value - a.value);
    if (cands.length) return cands[0].a;
  }

  // 3. 攻撃
  for (const iid of me.battle) {
    if (!canAttackWith(s, L, iid)) continue;
    const f = faceOf(s, L, iid)!;
    if (f.kw.cantAttack) continue;
    const tg = attackTargets(s, L, iid);
    const myP = power(s, L, iid, true);
    const target = weakestOpponent(s, p);
    if (target == null) break;
    const blockers = s.players[target].battle.filter((b) => faceOf(s, L, b)?.kw.blocker && !s.cards[b].tapped);
    // 倒せるタップ状態のクリーチャーを優先
    const beatable = tg.cards.filter((t) => power(s, L, t) < myP).sort((a, b) => power(s, L, b) - power(s, L, a));
    const lethal = s.players[target].shield.length === 0 && !blockers.length;
    if (lethal && tg.players.includes(target)) return { t: 'attack', attacker: iid, player: target };
    if (beatable.length && power(s, L, beatable[0]) >= 3000) return { t: 'attack', attacker: iid, player: s.cards[beatable[0]].owner, card: beatable[0] };
    if (f.kw.blocker && me.battle.length < 3) continue; // ブロッカーは守りに残す
    if (tg.players.includes(target)) {
      const strongerBlocker = blockers.some((b) => power(s, L, b) >= myP);
      if (!strongerBlocker || me.battle.length >= 4) return { t: 'attack', attacker: iid, player: target };
    }
    if (beatable.length) return { t: 'attack', attacker: iid, player: s.cards[beatable[0]].owner, card: beatable[0] };
  }

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
