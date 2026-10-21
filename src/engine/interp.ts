// 効果プログラム (src/rules/ops.ts) の実行。
// 決定的に動き (乱数はゲームの乱数)、プレイヤーの選択が必要になったら 'choice' を積んで中断する。
import type { Card, Face } from '../lib/cards';
import type { Cond, Count, Dest, Op, Sel, Target } from '../rules/ops';
import { parseEffect } from '../rules/parse';
import {
  battle,
  breakShields,
  cardCivs,
  drawCards,
  log,
  moveCard,
  nameOf,
  playCard,
  autoPay,
  power,
  q,
  rand,
  shuffleArr,
  type Lookup,
} from './engine';
import type { Exec, GameState, ZoneName } from './types';
import { canBeChosen } from './statics';
import { spellEffectLines } from '../lib/triggers';

// ---------- 解析結果のキャッシュ ----------
const progCache = new Map<string, ReturnType<typeof parseEffect>>();
export function programOf(effect: string) {
  let p = progCache.get(effect);
  if (!p) {
    p = parseEffect(effect);
    progCache.set(effect, p);
  }
  return p;
}

// ---------- 相手の決定 ----------
/** 「相手」 (デュエマは対戦相手、デュエパは次の手番の相手) */
export function mainOpp(s: GameState, p: number): number {
  const n = s.players.length;
  for (let k = 1; k < n; k++) {
    const o = (p + k) % n;
    if (!s.players[o].lost) return o;
  }
  return p;
}
const opps = (s: GameState, p: number) => s.players.map((_, i) => i).filter((i) => i !== p && !s.players[i].lost);

// ---------- 選択条件 ----------
function faceMatches(card: Card, f: Face, sel: Sel, s: GameState, L: Lookup, iid: number, noStatic = false): boolean {
  const k = sel.kind;
  const t = f.type;
  if (k === 'creature' && !f.isCreature) return false;
  if (k === 'spell' && !f.isSpell) return false;
  if (k === 'psychic' && !t.includes('サイキック')) return false;
  if (k === 'dragheart' && !t.includes('ドラグハート')) return false;
  if (k === 'gr' && !t.includes('GR')) return false;
  if (k === 'crossgear' && !t.includes('クロスギア')) return false;
  if (k === 'field' && !t.includes('フィールド')) return false;
  if (k === 'tamaseed' && !t.includes('タマシード')) return false;
  if (k === 'aura' && !t.includes('オーラ')) return false;
  if (k === 'castle' && !t.includes('城')) return false;
  if (sel.evolution && !f.isEvolution) return false;
  if (sel.nonEvolution && f.isEvolution) return false;
  if (sel.twinpact && !card.twin) return false;
  const civs = card.twin ? card.civs : f.civs.length ? f.civs : card.civs;
  if (sel.civs?.length) {
    if (sel.civAll ? !sel.civs.every((c) => civs.includes(c)) : !sel.civs.some((c) => civs.includes(c))) return false;
  }
  if (sel.civNot?.length && sel.civNot.some((c) => civs.includes(c))) return false;
  if (sel.colorless && civs.length) return false;
  if (sel.multicolor && civs.length < 2) return false;
  if (sel.mono && civs.length !== 1) return false;
  if (sel.races?.length && !sel.races.some((r) => f.races.some((x) => x.includes(r)))) return false;
  if (sel.nameHas && !f.name.includes(sel.nameHas) && !card.name.includes(sel.nameHas)) return false;
  if (sel.costMin != null && f.cost < sel.costMin) return false;
  if (sel.costMax != null && f.cost > sel.costMax) return false;
  const c = s.cards[iid];
  // 常在型能力の評価中は、無限ループを避けるため常在型能力を含まないパワーで判定
  const pw = c.zone === 'battle' ? (noStatic ? (f.power ?? 0) + c.powerMod : power(s, L, iid)) : (f.power ?? 0);
  if (sel.powerMin != null && pw < sel.powerMin) return false;
  if (sel.powerMax != null && pw > sel.powerMax) return false;
  if (sel.tapped != null && c.zone === 'battle' && c.tapped !== sel.tapped) return false;
  if (sel.hasKw) {
    const kw = sel.hasKw;
    const has =
      (kw === 'ブロッカー' && f.kw.blocker) ||
      (kw === 'スピードアタッカー' && f.kw.speedAttacker) ||
      (kw === 'S・トリガー' && f.kw.shieldTrigger) ||
      f.text.some((x) => x.normalize('NFKC').startsWith(kw));
    if (!has) return false;
  }
  return true;
}

/** カードが条件に合うか (バトルゾーンでは今の面、それ以外はどちらかの面) */
export function matchesSel(s: GameState, L: Lookup, iid: number, sel: Sel, noStatic = false): boolean {
  const c = s.cards[iid];
  const card = L(c.cid);
  if (!card) return false;
  if (sel.kind === 'card' && !sel.twinpact && !sel.civs && !sel.races && sel.costMin == null && sel.costMax == null && !sel.colorless && !sel.multicolor) return true;
  const faces = c.zone === 'battle' ? [card.faces[c.face] ?? card.faces[0]] : card.faces;
  return faces.some((f) => faceMatches(card, f, sel, s, L, iid, noStatic));
}

function candidates(s: GameState, L: Lookup, ex: Exec, sel: Sel): number[] {
  const owners = sel.owner === 'self' ? [ex.player] : sel.owner === 'opp' ? opps(s, ex.player) : s.players.map((_, i) => i).filter((i) => !s.players[i].lost);
  const out: number[] = [];
  for (const o of owners)
    for (const z of sel.zones) {
      const arr = z === 'deckTop' ? s.players[o].deck.slice(-1) : (s.players[o][z as ZoneName] as number[] | undefined);
      if (!arr) continue;
      for (const iid of arr) {
        if (sel.other && iid === ex.src) continue;
        if (sel.powerLtSelf && !(power(s, L, iid) < power(s, L, ex.src))) continue;
        if (sel.costLtSelf && !(maxCost(L, s.cards[iid].cid) < maxCost(L, s.cards[ex.src].cid))) continue;
        if (!canBeChosen(s, L, iid, ex.player, s.cards[ex.src] ? !!L(s.cards[ex.src].cid)?.faces.some((f) => f.isSpell) && s.cards[ex.src].zone !== 'battle' : false)) continue;
        if (matchesSel(s, L, iid, sel)) out.push(iid);
      }
    }
  return out;
}

function evalCond(s: GameState, L: Lookup, ex: Exec, c: Cond): boolean {
  const cmp = (a: number, op: string, b: number) => (op === '>=' ? a >= b : op === '<=' ? a <= b : a === b);
  const me = s.players[ex.player];
  const opp = s.players[mainOpp(s, ex.player)];
  switch (c.c) {
    case 'count':
      return cmp(candidates(s, L, ex, c.sel).length, c.cmp, c.n);
    case 'shields':
      return cmp((c.who === 'self' ? me : opp).shield.length, c.cmp, c.n);
    case 'shieldsCmp':
      return c.cmp === 'oppMore' ? opp.shield.length > me.shield.length : c.cmp === 'selfMore' ? me.shield.length > opp.shield.length : opp.shield.length <= me.shield.length;
    case 'handCount':
      return cmp((c.who === 'self' ? me : opp).hand.length, c.cmp, c.n);
    case 'itMatches': {
      const pool = ex.it.length ? ex.it : ex.looked;
      return pool.length > 0 && pool.every((i) => matchesSel(s, L, i, c.sel));
    }
    case 'itCount':
      return cmp(ex.it.length, c.cmp, c.n);
    case 'distinctCosts': {
      // ツインパクトはどちらの面のコストとしても扱える
      const opts = ex.looked.map((i) => L(s.cards[i].cid)?.faces.map((f) => f.cost) ?? [0]);
      const go = (k: number, used: Set<number>): boolean => k === opts.length || opts[k].some((c2) => !used.has(c2) && go(k + 1, new Set([...used, c2])));
      return go(0, new Set());
    }
    case 'did':
      return ex.did;
    case 'shieldsLess':
      return (c.who === 'self' ? me : opp).shield.length < c.n;
    case 'selfTapped':
      return !!s.cards[ex.src]?.tapped;
  }
}

// ---------- 対象 ----------
function resolveRef(s: GameState, ex: Exec, t: Target): number[] | null {
  switch (t.ref) {
    case 'it': {
      // 「それ」: 直前に選んだカード。選んでいなければ表向きにした/見たカード
      const base = ex.it.length ? ex.it : ex.looked;
      return base.filter((i) => s.cards[i].zone !== 'gone');
    }
    case 'self':
      return [ex.src];
    case 'rest':
      return ex.looked.filter((i) => !ex.it.includes(i));
    case 'saved':
      return (ex.saved ?? []).filter((i) => s.cards[i].zone !== 'gone');
    default:
      return null;
  }
}

const DEST_ZONE: Record<Dest, ZoneName> = {
  grave: 'grave',
  hand: 'hand',
  mana: 'mana',
  manaTapped: 'mana',
  shield: 'shield',
  deckBottom: 'deck',
  deckTop: 'deck',
  battle: 'battle',
  battleTapped: 'battle',
};

function moveTo(s: GameState, L: Lookup, ex: Exec, iid: number, to: Dest, reveal = false) {
  const c = s.cards[iid];
  if (!c || c.zone === 'gone') return;
  const nm = nameOf(s, L, iid);
  const multi = cardCivs(L, c.cid).length > 1;
  const zone = DEST_ZONE[to];
  moveCard(s, L, iid, zone, {
    pos: to === 'deckBottom' ? 'bottom' : 'top',
    tapped: to === 'manaTapped' || to === 'battleTapped' || (zone === 'mana' && multi),
    faceUp: zone === 'shield' ? false : undefined,
  });
  const hidden = zone === 'hand' || zone === 'deck' || zone === 'shield';
  log(s, ex.player, `${hidden && !reveal ? 'カード' : q(nm)} を${ZONE_JA[zone]}へ`);
}
const ZONE_JA: Record<string, string> = { grave: '墓地', hand: '手札', mana: 'マナゾーン', shield: 'シールド', deck: '山札', battle: 'バトルゾーン' };

const maxCost = (L: Lookup, cid: string) => Math.max(...(L(cid)?.faces.map((f) => f.cost) ?? [0]));

// ---------- 実行 ----------

/** 効果プログラムの実行を開始する */
export function startExec(s: GameState, L: Lookup, player: number, src: number, ops: Op[], name: string) {
  runExec(s, L, { player, src, ops: [...ops], it: [], looked: [], did: false, name });
}

/** 選択への回答を受けて再開する */
export function resumeExec(s: GameState, L: Lookup, ex: Exec, answer: { picks?: number[]; yes?: boolean; options?: number[] }) {
  const op = ex.ops[0];
  if (!op) return;
  if (op.op === 'choose' || op.op === 'discard' || op.op === 'breakShield') {
    ex.it = answer.picks ?? [];
    ex.ops.shift();
    if (op.op === 'discard') {
      for (const i of ex.it) moveTo(s, L, ex, i, 'grave', true);
    } else if (op.op === 'breakShield') {
      if (ex.it.length) breakShields(s, L, s.cards[ex.it[0]].owner, ex.it, ex.player);
    }
  } else if (op.op === 'optional') {
    ex.ops.shift();
    ex.did = !!answer.yes;
    if (answer.yes) ex.ops.unshift(...op.body);
  } else if (op.op === 'modal') {
    ex.ops.shift();
    const picked = (answer.options ?? [0]).slice(0, op.pick);
    const bodies = picked.flatMap((i) => op.options[i]?.body ?? []);
    ex.ops.unshift(...bodies);
  }
  runExec(s, L, ex);
}

function ask(s: GameState, ex: Exec, p: Omit<Extract<GameState['pending'][number], { kind: 'choice' }>, 'kind' | 'exec'>) {
  s.pending.unshift({ kind: 'choice', exec: ex, ...p });
}

export function runExec(s: GameState, L: Lookup, ex: Exec) {
  let guard = 0;
  while (ex.ops.length && guard++ < 500) {
    if (s.phase === 'over') return;
    const op = ex.ops[0];
    switch (op.op) {
      case 'draw': {
        const who = op.who === 'self' ? ex.player : mainOpp(s, ex.player);
        const d = drawCards(s, who, op.n);
        log(s, who, `${s.players[who].name}: カードを${d}枚引いた`);
        break;
      }
      case 'top': {
        const who = op.who === 'self' ? ex.player : mainOpp(s, ex.player);
        const deck = s.players[who].deck;
        const ids = deck.slice(-op.n).reverse();
        if (op.to === 'look' || op.to === 'reveal') {
          ex.looked = ids;
          ex.it = [];
          if (op.to === 'reveal') log(s, who, `山札の上から${ids.length}枚を表向きにした: ${ids.map((i) => q(nameOf(s, L, i))).join('、')}`);
          else {
            s.players[ex.player].peek = [...ids];
            log(s, who, `山札の上から${ids.length}枚を見た`);
          }
        } else {
          for (const i of ids) {
            if (op.to === 'shield') {
              moveCard(s, L, i, 'shield', { faceUp: false });
              log(s, who, '山札の上から1枚をシールド化');
            } else moveTo(s, L, ex, i, op.to, op.to !== 'hand');
          }
        }
        break;
      }
      case 'lookDeck': {
        ex.looked = [...s.players[ex.player].deck];
        ex.it = [];
        log(s, ex.player, '山札を見た');
        break;
      }
      case 'choose': {
        const t = op.target;
        let cands: number[];
        let cnt: Count | undefined;
        let chooser = ex.player;
        if (t.ref === 'sel') {
          cands = candidates(s, L, ex, t.sel);
          cnt = t.count;
          if (t.chooser === 'opp') chooser = mainOpp(s, ex.player);
          if (t.chooser === 'opp' && t.sel.owner === 'opp') cands = cands.filter((i) => s.cards[i].owner === chooser);
        } else if (t.ref === 'looked') {
          cands = ex.looked.filter((i) => s.cards[i].zone !== 'gone' && (!t.sel || matchesSel(s, L, i, t.sel)));
          cnt = t.count ?? { n: 1, upTo: false };
        } else if (t.ref === 'under') {
          cands = [...(s.cards[ex.src]?.under ?? [])];
          cnt = t.count;
        } else {
          ex.it = resolveRef(s, ex, t) ?? [];
          break;
        }
        if (!cands.length) {
          ex.it = [];
          break;
        }
        if (!cnt || 'all' in cnt) {
          ex.it = cands;
          break;
        }
        const n = Math.min(cnt.n, cands.length);
        if (!cnt.upTo && cands.length <= cnt.n) {
          ex.it = cands;
          break;
        }
        ask(s, ex, {
          player: chooser,
          mode: 'cards',
          prompt: `${ex.name}: ${op.prompt}`,
          options: cands,
          min: cnt.upTo ? 0 : n,
          max: n,
          purpose: op.purpose,
          sumPowerMax: cnt.sumPowerMax,
        });
        return;
      }
      case 'move': {
        const ids = resolveRef(s, ex, op.target) ?? [];
        for (const i of ids) moveTo(s, L, ex, i, op.to, op.reveal);
        break;
      }
      case 'destroy': {
        const ids = (resolveRef(s, ex, op.target) ?? []).filter((i) => s.cards[i].zone === 'battle');
        for (const i of ids) {
          log(s, ex.player, `${q(nameOf(s, L, i))} を破壊`);
          moveCard(s, L, i, 'grave');
        }
        break;
      }
      case 'tap':
      case 'untap': {
        for (const i of resolveRef(s, ex, op.target) ?? []) {
          const c = s.cards[i];
          if (c.zone !== 'battle' && c.zone !== 'mana') continue;
          c.tapped = op.op === 'tap';
          log(s, ex.player, `${q(nameOf(s, L, i))} を${op.op === 'tap' ? 'タップ' : 'アンタップ'}`);
        }
        break;
      }
      case 'power': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          if (s.cards[i].zone !== 'battle') continue;
          s.cards[i].powerMod += op.delta;
          log(s, ex.player, `${q(nameOf(s, L, i))} のパワー${op.delta >= 0 ? '+' : ''}${op.delta}`);
        }
        break;
      }
      case 'restrict': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          const c = s.cards[i];
          if (op.what === 'untap') c.noUntap = true;
          else if (op.what === 'attack') c.noAttack = true;
          else c.restrict = { attack: true, block: true, until: ex.player };
        }
        break;
      }
      case 'discard': {
        const who = op.who === 'self' ? ex.player : mainOpp(s, ex.player);
        const hand = s.players[who].hand;
        if (!hand.length) break;
        if ('all' in op.count) {
          for (const i of [...hand]) moveTo(s, L, ex, i, 'grave', true);
          break;
        }
        const n = Math.min(op.count.n, hand.length);
        if (op.how === 'random') {
          for (let k = 0; k < n; k++) {
            const h = s.players[who].hand;
            const pick = h[Math.floor(rand(s) * h.length)];
            moveTo(s, L, ex, pick, 'grave', true);
          }
          break;
        }
        const chooser = op.how === 'ownerChooses' ? who : ex.player;
        if (hand.length <= n && !op.count.upTo) {
          for (const i of [...hand]) moveTo(s, L, ex, i, 'grave', true);
          break;
        }
        ask(s, ex, { player: chooser, mode: 'cards', prompt: `${ex.name}: 手札を${n}枚${op.count.upTo ? 'まで' : ''}選んで捨てる`, options: [...hand], min: op.count.upTo ? 0 : n, max: n, purpose: chooser === who ? 'sacrifice' : 'hostile' });
        return;
      }
      case 'grSummon': {
        for (let k = 0; k < op.n; k++) {
          const gr = s.players[ex.player].gr;
          const top = gr[gr.length - 1];
          if (top == null) break;
          log(s, ex.player, `GR召喚 → ${q(nameOf(s, L, top))}`);
          moveCard(s, L, top, 'battle');
        }
        break;
      }
      case 'shuffle':
        shuffleArr(s, s.players[ex.player].deck);
        s.players[ex.player].peek = [];
        log(s, ex.player, '山札をシャッフル');
        break;
      case 'battle': {
        const a = resolveRef(s, ex, op.a) ?? [];
        const b = resolveRef(s, ex, op.b) ?? [];
        const x = a[0];
        const y = op.a.ref === op.b.ref ? a[1] : b[0];
        if (x != null && y != null && s.cards[x].zone === 'battle' && s.cards[y].zone === 'battle') battle(s, L, x, y);
        break;
      }
      case 'breakShield': {
        const o = mainOpp(s, ex.player);
        const sh = s.players[o].shield;
        if (!sh.length) break;
        const n = Math.min(op.n, sh.length);
        if (sh.length <= n) {
          breakShields(s, L, o, [...sh], ex.player);
          break;
        }
        ask(s, ex, { player: ex.player, mode: 'cards', prompt: `${ex.name}: ブレイクするシールドを${n}つ選ぶ`, options: [...sh], min: n, max: n, purpose: 'hostile' });
        return;
      }
      case 'play': {
        for (const i of resolveRef(s, ex, op.target) ?? []) {
          const c = s.cards[i];
          const card = L(c.cid);
          if (!card || c.zone === 'battle' || c.zone === 'gone') continue;
          let fi = card.faces.findIndex((f) => (op.mode === 'cast' ? f.isSpell : op.mode === 'summon' || op.mode === 'put' ? f.isCreature || !f.isSpell : true));
          if (fi < 0) fi = 0;
          if (op.mode === 'put') {
            log(s, ex.player, `${q(card.faces[fi].name)} をバトルゾーンに出した`);
            moveCard(s, L, i, 'battle', { face: fi });
          } else {
            const owner = c.owner;
            playCard(s, owner, { t: 'play', iid: i, face: fi, pay: [], free: true, force: true }, L);
          }
          ex.it = [i];
        }
        break;
      }
      case 'optional': {
        ask(s, ex, { player: ex.player, mode: 'yesno', prompt: `${ex.name}: ${op.prompt}`, options: [], min: 0, max: 1, purpose: 'benefit' });
        return;
      }
      case 'if': {
        ex.ops.shift();
        const ok = evalCond(s, L, ex, op.cond);
        ex.ops.unshift(...(ok ? op.body : (op.else ?? [])));
        continue;
      }
      case 'modal': {
        ask(s, ex, {
          player: ex.player,
          mode: 'modal',
          prompt: `${ex.name}: 次のうちいずれか${op.pick}つを選ぶ`,
          options: [],
          labels: op.options.map((o) => o.label),
          min: Math.min(op.pick, op.options.length),
          max: Math.min(op.pick, op.options.length),
          purpose: 'benefit',
        });
        return;
      }
      case 'repeat': {
        ex.ops.shift();
        for (let k = 0; k < op.n; k++) ex.ops.unshift(...op.body);
        continue;
      }
      case 'note':
        if (op.text) log(s, ex.player, op.text);
        break;
      case 'save':
        ex.saved = [...ex.it];
        break;
      case 'castSelfSpell': {
        // このカードの呪文側の効果を、呪文として解決する (カードは今の場所のまま)
        const c = s.cards[ex.src];
        const card = c && L(c.cid);
        const fi = card ? card.faces.findIndex((f) => f.isSpell) : -1;
        if (card && fi >= 0) {
          const lines = spellEffectLines(card.faces[fi].text);
          log(s, ex.player, `${q(card.faces[fi].name)} を唱えた (コストを支払わずに)`);
          if (lines.length)
            s.pending.push({ kind: 'ability', player: ex.player, src: ex.src, cid: c.cid, face: fi, event: 'spell', text: lines.join('\n'), effect: lines.join('\n'), optional: false, auto: false });
        }
        break;
      }
      case 'kirifuPlay': {
        for (const i of ex.it) {
          const card = L(s.cards[i].cid);
          const fi = card ? card.faces.findIndex((f) => (f.statics ?? []).some((x) => x.s === 'kirifu')) : -1;
          if (!card || fi < 0) continue;
          const spec = card.faces[fi].statics.find((x) => x.s === 'kirifu');
          const cost = spec && spec.s === 'kirifu' ? spec.cost : 0;
          const pay = autoPay(s, L, ex.player, card.faces[fi].civs, cost) ?? autoPay(s, L, ex.player, [], cost);
          if (!pay) continue;
          playCard(s, ex.player, { t: 'play', iid: i, face: fi, pay, alt: 'kirifu', force: true }, L);
        }
        break;
      }
      case 'revealUntil': {
        const deck = s.players[ex.player].deck;
        const shown: number[] = [];
        let found: number | null = null;
        for (let k = deck.length - 1; k >= 0; k--) {
          const i = deck[k];
          shown.push(i);
          const ok = matchesSel(s, L, i, op.sel) && (!op.sel.costLtSelf || maxCost(L, s.cards[i].cid) < maxCost(L, s.cards[ex.src].cid));
          if (ok) {
            found = i;
            break;
          }
        }
        ex.looked = shown;
        ex.it = found != null ? [found] : [];
        log(s, ex.player, `山札の上から${shown.length}枚を表向きにした${found != null ? ` → ${q(nameOf(s, L, found))}` : ' (見つからなかった)'}`);
        break;
      }
      case 'handToDeck': {
        const pl = s.players[ex.player];
        for (const i of [...pl.hand]) moveCard(s, L, i, 'deck', { pos: 'top' });
        log(s, ex.player, '手札をすべて山札に加えた');
        break;
      }
      case 'flip': {
        for (const i of resolveRef(s, ex, op.target) ?? []) {
          const c = s.cards[i];
          const card = L(c.cid);
          if (!card || card.faces.length < 2 || card.twin || c.zone !== 'battle') continue;
          const before = nameOf(s, L, i);
          c.face = (c.face + 1) % card.faces.length;
          log(s, ex.player, `${q(before)} を裏返して ${q(card.faces[c.face].name)} に`);
        }
        break;
      }
      case 'afterAttack': {
        // 攻撃中なら攻撃の終わりに、そうでなければすぐに実行
        ex.ops.shift();
        const later: Exec = { ...ex, ops: [...op.body] };
        if (s.attack) (s.delayed ??= []).push(later);
        else ex.ops.unshift(...op.body);
        continue;
      }
      case 'each':
        ex.ops.shift();
        ex.ops.unshift(...op.body);
        continue;
      case 'grant': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          const c = s.cards[i];
          if (c.zone !== 'battle') continue;
          (c.grants ??= []).push({ kws: op.kws, until: op.until === 'turn' ? -1 : op.until === 'perm' ? -2 : ex.player });
          log(s, ex.player, `${q(nameOf(s, L, i))} に${op.kws.map((k) => `「${k}」`).join('')}を与えた`);
        }
        break;
      }
      case 'gachinko': {
        // 互いに山札の上を見せ合い、自分のコストが相手以上なら勝ち。見せたカードは山札の下へ
        const o = mainOpp(s, ex.player);
        const mine = s.players[ex.player].deck[s.players[ex.player].deck.length - 1];
        const theirs = s.players[o].deck[s.players[o].deck.length - 1];
        const cost = (i: number | undefined) => (i == null ? -1 : Math.max(...(L(s.cards[i].cid)?.faces.map((f) => f.cost) ?? [0])));
        const win = mine != null && cost(mine) >= cost(theirs);
        log(s, ex.player, `ガチンコ・ジャッジ: ${mine != null ? q(nameOf(s, L, mine)) : 'なし'}(${cost(mine)}) vs ${theirs != null ? q(nameOf(s, L, theirs)) : 'なし'}(${cost(theirs)}) → ${win ? '勝ち' : '負け'}`);
        for (const [p2, i] of [
          [ex.player, mine],
          [o, theirs],
        ] as const) {
          if (i == null) continue;
          const d = s.players[p2].deck;
          d.splice(d.indexOf(i), 1);
          d.unshift(i);
        }
        ex.did = win;
        break;
      }
      case 'lookHand': {
        const o = mainOpp(s, ex.player);
        ex.looked = [...s.players[o].hand];
        ex.it = [];
        for (const i of ex.looked) if (!s.players[ex.player].peek.includes(i)) s.players[ex.player].peek.push(i);
        log(s, ex.player, `${s.players[o].name} の手札を見た`);
        break;
      }
    }
    ex.ops.shift();
  }
}
