// 効果プログラム (src/rules/ops.ts) の実行。
// 決定的に動き (乱数はゲームの乱数)、プレイヤーの選択が必要になったら 'choice' を積んで中断する。
import { CIV_NAME, type Card, type Face } from '../lib/cards';
import type { Cond, Count, Dest, Op, Sel, Target } from '../rules/ops';
import { parseEffect } from '../rules/parse';
import {
  attackTargets,
  battle,
  breakShields,
  cardCivs,
  drawCards,
  log,
  moveCard,
  removeSeal,
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
import { canBeChosen, isSealed } from './statics';
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
  if (k === 'duelist' && !t.includes('デュエリスト')) return false;
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
  if (sel.notColorless && !civs.length) return false;
  if (sel.notCreature && L(s.cards[iid].cid)?.faces[s.cards[iid].face]?.isCreature) return false;
  if (sel.raceRef || sel.civRef || sel.costRef || sel.powerRef) {
    const cv = s.chosenValue ?? {};
    const f = L(s.cards[iid].cid)?.faces[s.cards[iid].face];
    if (sel.raceRef && !(cv.race && (f?.races ?? []).some((r) => r.includes(cv.race!)))) return false;
    if (sel.civRef && !(cv.civ && civs.some((x) => CIV_NAME[x] === cv.civ))) return false;
    if (sel.costRef && !(cv.num != null && f?.cost === cv.num)) return false;
    if (sel.powerRef && !(cv.num != null && power(s, L, iid) === cv.num)) return false;
  }
  if (sel.civShareMana) {
    const have = new Set(s.players[s.cards[iid].owner].mana.flatMap((m) => cardCivs(L, s.cards[m].cid)));
    if (!civs.some((x) => have.has(x))) return false;
  }
  if (sel.multicolor && civs.length < 2) return false;
  if (sel.monocolor && civs.length >= 2) return false;
  if (sel.faceDown != null && !!s.cards[iid].manaDown !== sel.faceDown) return false;
  if (sel.civInMana) {
    const have = new Set(s.players[s.cards[iid].owner].mana.flatMap((m) => cardCivs(L, s.cards[m].cid)));
    if (!civs.every((x) => have.has(x))) return false;
  }
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
  if (sel.kind === 'card' && !sel.twinpact && !sel.civs && !sel.races && sel.costMin == null && sel.costMax == null && !sel.colorless && !sel.notColorless && !sel.notCreature && !sel.civShareMana && !sel.raceRef && !sel.civRef && !sel.costRef && !sel.powerRef && !sel.multicolor && !sel.monocolor && !sel.civInMana && sel.faceDown == null) return true;
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
    case 'and':
      return evalCond(s, L, ex, c.a) && evalCond(s, L, ex, c.b);
    case 'oppMore':
      return opp[c.zone].length > me[c.zone].length;
    case 'selfFaceUpShield': {
      const sc = s.cards[ex.src];
      return sc?.zone === 'shield' && sc.faceUp;
    }
    case 'equippedTapped': {
      const par = s.cards[ex.src]?.parent;
      return par != null && s.cards[par].zone === 'battle' && s.cards[par].tapped;
    }
    case 'linked': {
      const root = s.cards[ex.src]?.linkedTo ?? ex.src;
      const on = s.cards[root]?.under.some((u) => s.cards[u].linkedTo === root) ?? false;
      return c.neg ? !on : on;
    }
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
      // G・リンクで下になったゴッドの「このクリーチャー」はリンクしたクリーチャー全体
      return [s.cards[ex.src]?.linkedTo ?? ex.src];
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
  manaDown: 'mana',
  hyper: 'hyper',
  shield: 'shield',
  shieldUp: 'shield',
  deckBottom: 'deck',
  deckTop: 'deck',
  battle: 'battle',
  battleTapped: 'battle',
};

function moveTo(s: GameState, L: Lookup, ex: Exec, iid: number, to: Dest, reveal = false) {
  const c = s.cards[iid];
  if (!c || c.zone === 'gone') return;
  // 超次元ゾーンに置けるのはサイキック・ドラグハートだけ (それ以外はその場にとどまる)
  if (to === 'hyper' && L(c.cid)?.zone !== 'hyper') {
    log(s, ex.player, `${q(nameOf(s, L, iid))} は超次元ゾーンに置けない`);
    return;
  }
  const nm = nameOf(s, L, iid);
  const multi = cardCivs(L, c.cid).length > 1;
  const zone = DEST_ZONE[to];
  moveCard(s, L, iid, zone, {
    pos: to === 'deckBottom' ? 'bottom' : 'top',
    tapped: to === 'manaTapped' || to === 'battleTapped' || (zone === 'mana' && multi),
    faceUp: zone === 'shield' ? to === 'shieldUp' : undefined,
  });
  if (to === 'manaDown') s.cards[iid].manaDown = true;
  const hidden = zone === 'hand' || zone === 'deck' || zone === 'shield';
  log(s, ex.player, `${hidden && !reveal ? 'カード' : q(nm)} を${ZONE_JA[zone]}へ`);
}
const ZONE_JA: Record<string, string> = { grave: '墓地', hand: '手札', mana: 'マナゾーン', shield: 'シールド', deck: '山札', battle: 'バトルゾーン' };

/** ドラグハート・ウエポンを、この能力のクリーチャー (いなければ一番強い自分のクリーチャー) に装備する */
function equipWeapon(s: GameState, L: Lookup, ex: Exec, w: number) {
  const pl = s.players[s.cards[w].owner];
  const isCr = (i: number) => s.cards[i].zone === 'battle' && !!L(s.cards[i].cid)?.faces[s.cards[i].face]?.isCreature;
  const holder = isCr(ex.src) && s.cards[ex.src].owner === s.cards[w].owner ? ex.src : [...pl.battle].filter(isCr).sort((a, b) => power(s, L, b) - power(s, L, a))[0];
  if (holder == null || s.cards[w].zone !== 'battle') return;
  pl.battle = pl.battle.filter((b) => b !== w);
  s.cards[w].zone = 'under';
  s.cards[w].parent = holder;
  s.cards[holder].under.push(w);
  log(s, ex.player, `${q(nameOf(s, L, w))} を ${q(nameOf(s, L, holder))} に装備した`);
}

const maxCost = (L: Lookup, cid: string) => Math.max(...(L(cid)?.faces.map((f) => f.cost) ?? [0]));

// ---------- 実行 ----------

/** 効果プログラムの実行を開始する */
export function startExec(s: GameState, L: Lookup, player: number, src: number, ops: Op[], name: string, spellBy?: number) {
  runExec(s, L, { player, src, ops: [...ops], it: [], looked: [], did: false, name, spellBy });
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
  } else if (op.op === 'shieldStack') {
    ex.ops.shift();
    const host = (answer.picks ?? [])[0] ?? s.players[ex.player].shield[0];
    const hc = host != null ? s.cards[host] : undefined;
    const deck = s.players[ex.player].deck;
    for (let k = 0; hc && k < op.n && deck.length; k++) {
      const t = deck.pop()!;
      s.cards[t].zone = 'under';
      s.cards[t].parent = host!;
      s.cards[t].faceUp = false;
      hc.under.push(t);
    }
    if (hc) log(s, ex.player, `シールドの下に${op.n}枚重ねた`);
  } else if (op.op === 'topOrBottom') {
    ex.ops.shift();
    const top = (answer.options ?? [1])[0] === 0;
    for (const i of ex.pendingIds ?? []) moveTo(s, L, ex, i, top ? 'deckTop' : 'deckBottom');
    ex.pendingIds = undefined;
  } else if (op.op === 'chooseValue') {
    ex.ops.shift();
    const v = (ex.valueLabels ?? [])[(answer.options ?? [0])[0]];
    if (v != null) {
      s.chosenValue = op.kind === 'race' ? { race: v } : op.kind === 'civ' ? { civ: v } : { num: +v };
      log(s, ex.player, `${op.kind === 'race' ? '種族' : op.kind === 'civ' ? '文明' : '数字'}「${v}」を選んだ`);
    }
  } else if (op.op === 'modal') {
    ex.ops.shift();
    const picked = (answer.options ?? [0]).slice(0, op.pick);
    const bodies = picked.flatMap((i) => op.options[i]?.body ?? []);
    ex.ops.unshift(...bodies);
  }
  runExec(s, L, ex);
}

/** 種族・文明・数字の選択肢 (種族はバトルゾーンと手札にあるものを多い順に) */
export function valueLabels(s: GameState, L: Lookup, kind: 'race' | 'civ' | 'number', max?: number, exclude?: string): string[] {
  if (kind === 'civ') return ['光', '水', '闇', '火', '自然'].filter((c) => !exclude?.includes(c));
  if (kind === 'number') return Array.from({ length: (max ?? 12) + 1 }, (_, i) => String(i));
  const count = new Map<string, number>();
  for (const pl of s.players)
    for (const i of [...pl.battle, ...pl.hand, ...pl.grave])
      for (const r of L(s.cards[i].cid)?.faces[s.cards[i].face]?.races ?? []) if (!exclude || !r.includes(exclude)) count.set(r, (count.get(r) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map((x) => x[0]);
}

/** ガチンコ・ジャッジ (power: パワー・ガチンコ・ジャッジ)。互いに山札の上を見せ、自分が相手以上なら勝ち。見せたカードは山札の下へ */
function judge(s: GameState, L: Lookup, me: number, byPower: boolean): boolean {
  const o = mainOpp(s, me);
  const mine = s.players[me].deck[s.players[me].deck.length - 1];
  const theirs = s.players[o].deck[s.players[o].deck.length - 1];
  const val = (i: number | undefined) =>
    i == null ? -1 : byPower ? Math.max(0, ...(L(s.cards[i].cid)?.faces.map((f) => f.power ?? 0) ?? [0])) : Math.max(...(L(s.cards[i].cid)?.faces.map((f) => f.cost) ?? [0]));
  const win = mine != null && val(mine) >= val(theirs);
  log(s, me, `${byPower ? 'パワー・' : ''}ガチンコ・ジャッジ: ${mine != null ? q(nameOf(s, L, mine)) : 'なし'}(${val(mine)}) vs ${theirs != null ? q(nameOf(s, L, theirs)) : 'なし'}(${val(theirs)}) → ${win ? '勝ち' : '負け'}`);
  for (const [p2, i] of [
    [me, mine],
    [o, theirs],
  ] as const) {
    if (i == null) continue;
    const d = s.players[p2].deck;
    d.splice(d.indexOf(i), 1);
    d.unshift(i);
  }
  return win;
}

function ask(s: GameState, ex: Exec, p: Omit<Extract<GameState['pending'][number], { kind: 'choice' }>, 'kind' | 'exec'>) {
  s.pending.unshift({ kind: 'choice', exec: ex, ...p });
}

export function runExec(s: GameState, L: Lookup, ex: Exec) {
  const prevSpell = s.curSpellBy;
  s.curSpellBy = ex.spellBy;
  try {
    runExecInner(s, L, ex);
  } finally {
    s.curSpellBy = prevSpell;
  }
}

function runExecInner(s: GameState, L: Lookup, ex: Exec) {
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
          // 表向きにしたカードは「それ」で参照される
          ex.it = op.to === 'reveal' ? [...ids] : [];
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
          sumCostMax: cnt.sumCostMax,
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
          else if (op.what === 'attackMe') c.restrict = { attack: false, block: false, until: ex.player, noAttackPlayer: ex.player };
          else if (op.what === 'attackOpp') c.restrict = { attack: false, block: false, until: ex.player, noAttackPlayer: mainOpp(s, ex.player) };
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
      case 'shuffle': {
        const who = op.who === 'opp' ? mainOpp(s, ex.player) : ex.player;
        shuffleArr(s, s.players[who].deck);
        s.players[who].peek = [];
        log(s, ex.player, '山札をシャッフル');
        break;
      }
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
            if (/ドラグハート・ウエポン/.test(card.faces[fi].type)) equipWeapon(s, L, ex, i);
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
        // 爆進ダブル等: 条件を満たせば両方とも選べる
        const all = !!op.bonus && evalCond(s, L, ex, op.bonus);
        ask(s, ex, {
          player: ex.player,
          mode: 'modal',
          prompt: `${ex.name}: 次のうちいずれか${op.pick}つを選ぶ${all ? ' (すべて選んでもよい)' : ''}`,
          options: [],
          labels: op.options.map((o) => o.label),
          min: Math.min(op.pick, op.options.length),
          max: all ? op.options.length : Math.min(op.pick, op.options.length),
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
      case 'payPlay': {
        const c = s.cards[ex.src];
        const card = c && L(c.cid);
        if (!card || c.zone !== 'hand') break;
        const fi = Math.max(0, card.faces.findIndex((f) => f.isCreature || f.isSpell));
        const pay = autoPay(s, L, c.owner, card.faces[fi].civs, op.cost);
        if (!pay) {
          log(s, ex.player, `${q(card.name)}: マナが足りないので使えない`);
          break;
        }
        for (const m of pay) s.cards[m].tapped = true;
        log(s, ex.player, `${q(card.faces[fi].name)} をコスト${op.cost}で手札から使う`);
        playCard(s, c.owner, { t: 'play', iid: ex.src, face: fi, pay: [], free: true, force: true }, L);
        break;
      }
      case 'swap': {
        const self = s.cards[ex.src];
        const other = ex.it.find((i) => s.cards[i].zone === 'mana' || s.cards[i].zone === 'grave');
        if (other == null || self?.zone !== 'battle') break;
        const zone = s.cards[other].zone as 'mana' | 'grave';
        log(s, ex.player, `${q(nameOf(s, L, ex.src))} と ${q(nameOf(s, L, other))} を入れ替えた`);
        // 攻撃中の入れ替え (Jチェンジ) は、出たクリーチャーがタップして攻撃を引き継ぐ
        const attacking = s.attack?.attacker === ex.src;
        moveCard(s, L, other, 'battle', { tapped: attacking });
        if (attacking) s.attack!.attacker = other;
        moveCard(s, L, ex.src, zone);
        break;
      }
      case 'superLink': {
        const root = ex.src;
        const rc = s.cards[root];
        const card = rc && L(rc.cid);
        if (!card || rc.zone !== 'battle' || rc.face !== 0 || card.faces.length < 2) break;
        const pl = s.players[rc.owner];
        const cells: number[] = [];
        for (const n of op.names) {
          const b = pl.battle.find((x) => x !== root && !cells.includes(x) && (L(s.cards[x].cid)?.faces[s.cards[x].face]?.name ?? '').includes(n));
          if (b == null) break;
          cells.push(b);
        }
        if (cells.length !== op.names.length) break;
        const tapped = [root, ...cells].some((x) => s.cards[x].tapped);
        const sick = [root, ...cells].every((x) => s.cards[x].sick);
        for (const b of cells) {
          pl.battle = pl.battle.filter((x) => x !== b);
          const bc = s.cards[b];
          rc.under.push(...bc.under);
          for (const u of bc.under) s.cards[u].parent = root;
          bc.under = [];
          bc.zone = 'under';
          bc.parent = root;
          bc.cellOf = root;
          bc.face = 1;
        }
        rc.under.push(...cells);
        rc.face = 1;
        rc.tapped = tapped;
        rc.sick = sick;
        log(s, ex.player, `覚醒リンク: ${q(card.faces[1].name)} になった`);
        break;
      }
      case 'seal': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          const c = s.cards[i];
          if (c.zone !== 'battle') continue;
          const deck = s.players[c.owner].deck;
          for (let k = 0; k < op.n && deck.length; k++) {
            const top = deck.pop()!;
            const tc = s.cards[top];
            tc.zone = 'under';
            tc.parent = i;
            tc.sealOf = i;
            tc.faceUp = false;
            c.under.push(top);
          }
          log(s, ex.player, `${q(nameOf(s, L, i))} に封印を${op.n}つ付けた`);
        }
        break;
      }
      case 'unseal': {
        const owner = ex.player;
        for (let k = 0; k < op.n; k++) {
          const host = op.from === 'self' ? ex.src : s.players[owner].battle.find((b) => isSealed(s, b));
          if (host == null || !isSealed(s, host)) break;
          removeSeal(s, L, host);
        }
        break;
      }
      case 'chooseValue': {
        const labels = valueLabels(s, L, op.kind, op.max, op.exclude);
        if (!labels.length) break;
        ex.valueLabels = labels;
        ask(s, ex, {
          player: ex.player,
          mode: 'modal',
          prompt: `${ex.name}: ${op.kind === 'race' ? '種族' : op.kind === 'civ' ? '文明' : '数字'}を1つ選ぶ`,
          options: [],
          labels,
          min: 1,
          max: 1,
          purpose: op.hostile ? 'hostile' : 'benefit',
        });
        return;
      }
      case 'redirectAttack': {
        const at = s.attack;
        if (!at || at.owner === ex.player) break;
        const tg = attackTargets(s, L, at.attacker);
        const self = s.cards[ex.src]?.linkedTo ?? ex.src;
        const to =
          op.to === 'self'
            ? tg.cards.includes(self)
              ? self
              : null
            : at.targetCard != null
              ? null
              : (tg.cards.filter((c) => s.cards[c].owner === ex.player).sort((a, b) => power(s, L, a) - power(s, L, b))[0] ?? null);
        if (to == null || at.targetCard === to) break;
        at.targetCard = to;
        at.targetPlayer = s.cards[to].owner;
        log(s, ex.player, `攻撃先が ${q(nameOf(s, L, to))} に変わった`);
        break;
      }
      case 'endOfTurnBottom': {
        // 召喚した後のこのクリーチャー (it に入っていればそれ)
        const t = ex.it.find((i) => s.cards[i].zone === 'battle') ?? ex.src;
        if (s.cards[t]?.zone === 'battle') s.cards[t].endOfTurn = 'abyss';
        if (s.attack) s.attack.ninjaUsed = true;
        break;
      }
      case 'oncePerGame': {
        const used = (s.onceGame ??= []);
        if (used.includes(ex.src)) {
          ex.did = false;
          log(s, ex.player, 'ゲーム中に一度だけの能力はもう使った');
        } else used.push(ex.src);
        break;
      }
      case 'stackUnder': {
        const self = s.cards[ex.src];
        const other = ex.it.find((i) => s.cards[i].zone !== 'gone' && i !== ex.src);
        if (other == null || !self) break;
        const [top, bottom] = op.what === 'it' ? [ex.src, other] : [other, ex.src];
        const tc = s.cards[top];
        const bc = s.cards[bottom];
        if (tc.zone !== 'battle') break;
        // 元の場所から取り除いて下に置く
        if (bc.zone === 'under' && bc.parent != null) s.cards[bc.parent].under = s.cards[bc.parent].under.filter((u) => u !== bottom);
        else if (bc.zone !== 'gone') {
          const arr = s.players[bc.owner][bc.zone as 'deck'] as number[] | undefined;
          if (arr) arr.splice(arr.indexOf(bottom), 1);
        }
        bc.zone = 'under';
        bc.parent = top;
        tc.under.push(bottom);
        log(s, ex.player, `${q(nameOf(s, L, bottom))} を ${q(nameOf(s, L, top))} の下に置いた`);
        break;
      }
      case 'faceDown':
      case 'faceUp': {
        for (const i of resolveRef(s, ex, op.target) ?? []) {
          if (s.cards[i].zone !== 'mana') continue;
          s.cards[i].manaDown = op.op === 'faceDown';
        }
        log(s, ex.player, `マナゾーンのカードを${op.op === 'faceUp' ? '表向き' : '裏向き'}にした`);
        break;
      }
      case 'toggleTap': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          if (s.cards[i].zone !== 'battle') continue;
          s.cards[i].tapped = !s.cards[i].tapped;
          log(s, ex.player, `${q(nameOf(s, L, i))} を${s.cards[i].tapped ? 'タップ' : 'アンタップ'}`);
        }
        break;
      }
      case 'useMarked': {
        const root = s.cards[ex.src]?.linkedTo ?? ex.src;
        const push = (iid: number) => {
          const c = s.cards[iid];
          const f = L(c.cid)?.faces[c.face];
          const eff = f?.marked?.[op.key];
          if (!eff) return;
          s.pending.push({ kind: 'ability', player: ex.player, src: iid, cid: c.cid, face: c.face, event: 'spell', text: `${op.key} ${eff}`, effect: eff, optional: false, auto: false });
          log(s, ex.player, `${q(nameOf(s, L, iid))} の ${op.key} 能力を使う`);
        };
        push(root);
        if (op.others) {
          const others = s.players[ex.player].battle.filter((b) => b !== root && L(s.cards[b].cid)?.faces[s.cards[b].face]?.marked?.[op.key]);
          others.sort((a, b) => power(s, L, b) - power(s, L, a));
          for (const b of others.slice(0, op.others)) push(b);
        }
        break;
      }
      case 'lockSpells': {
        for (let o = 0; o < s.players.length; o++) {
          if (o === ex.player || s.players[o].lost) continue;
          if (op.until === 'turn') s.players[o].spellLockTurn = s.turn;
          else s.players[o].spellLockUntil = ex.player;
          s.players[o].spellLockCost = op.costMax;
        }
        log(s, ex.player, `相手は${op.until === 'turn' ? 'このターン' : '次のターンのはじめまで'}呪文を唱えられない`);
        break;
      }
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
          if (!card || card.faces.length < 2 || card.twin) continue;
          if (c.zone !== 'battle' && !(c.zone === 'under' && op.to === 'creature')) continue;
          const before = nameOf(s, L, i);
          const costs = card.faces.map((f) => f.cost);
          let next = (c.face + 1) % card.faces.length;
          if (op.to === 'big') next = costs.indexOf(Math.max(...costs));
          else if (op.to === 'small') next = costs.indexOf(Math.min(...costs));
          else if (op.to === 'creature') next = Math.max(0, card.faces.findIndex((f) => f.isCreature));
          if (next === c.face) continue;
          // 装備・クロスされていたドラグハートは、クリーチャーになって単独でバトルゾーンに残る
          if (c.zone === 'under' && c.parent != null) {
            const par = s.cards[c.parent];
            par.under = par.under.filter((u) => u !== i);
            c.parent = null;
            c.zone = 'battle';
            s.players[c.owner].battle.push(i);
            c.sick = false;
          }
          c.face = next;
          if (op.to === 'creature') c.tapped = false;
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
      case 'topOrBottom': {
        const ids = (resolveRef(s, ex, op.target) ?? []).filter((i) => s.cards[i].zone !== 'gone');
        if (!ids.length) break;
        ex.valueLabels = ['山札の上', '山札の下'];
        ex.pendingIds = ids;
        ask(s, ex, { player: op.chooser === 'opp' ? mainOpp(s, ex.player) : ex.player, mode: 'modal', prompt: `${ex.name}: 山札の上か下を選ぶ`, options: [], labels: ex.valueLabels, min: 1, max: 1, purpose: 'neutral' });
        return;
      }
      case 'drawItPlus': {
        const d = drawCards(s, ex.player, ex.it.length * (op.mult ?? 1) + op.plus);
        log(s, ex.player, `カードを${d}枚引いた`);
        break;
      }
      case 'atTurnEnd': {
        (s.endTurnExecs ??= []).push({ ...ex, ops: [...op.body], it: [...ex.it], looked: [...ex.looked] });
        break;
      }
      case 'extraTurn': {
        s.extraTurnFor = ex.player;
        log(s, ex.player, 'このターンの後に、もう一度自分のターンを行う');
        break;
      }
      case 'destroyExtreme': {
        const who = op.owner === 'self' ? ex.player : mainOpp(s, ex.player);
        const cs = s.players[who].battle.filter((b) => L(s.cards[b].cid)?.faces[s.cards[b].face]?.isCreature).sort((a, b) => power(s, L, a) - power(s, L, b));
        for (const b of (op.max ? cs.reverse() : cs).slice(0, op.n)) {
          log(s, ex.player, `${q(nameOf(s, L, b))} を破壊`);
          moveCard(s, L, b, 'grave');
        }
        break;
      }
      case 'shieldStack': {
        const pl = s.players[ex.player];
        if (!pl.shield.length) break;
        ask(s, ex, { player: ex.player, mode: 'cards', prompt: `${ex.name}: 下に重ねるシールドを選ぶ`, options: [...pl.shield], min: 1, max: 1, purpose: 'benefit' });
        return;
      }
      case 'setPower': {
        const ids = op.target.ref === 'sel' ? candidates(s, L, ex, op.target.sel) : (resolveRef(s, ex, op.target) ?? []);
        for (const i of ids) {
          if (s.cards[i].zone !== 'battle') continue;
          s.cards[i].powerMod += op.value - power(s, L, i);
          log(s, ex.player, `${q(nameOf(s, L, i))} のパワーを${op.value}にした`);
        }
        break;
      }
      case 'drawPer': {
        const n = Math.floor(candidates(s, L, ex, op.sel).length / (op.each ?? 1)) * (op.mult ?? 1);
        const d = drawCards(s, ex.player, n);
        log(s, ex.player, `カードを${d}枚引いた`);
        break;
      }
      case 'janken': {
        ex.did = rand(s) < 0.5;
        log(s, ex.player, `ジャンケン → ${ex.did ? '勝ち' : '負け'}`);
        break;
      }
      case 'payLater': {
        (s.debts ??= []).push({ player: ex.player, cost: op.cost });
        log(s, ex.player, `次の自分のターンのはじめにコスト${op.cost}を支払う (支払えなければ負け)`);
        break;
      }
      case 'gachinkoLoop': {
        let wins = 0;
        for (let k = 0; k < (op.times ?? 40); k++) {
          const w = judge(s, L, ex.player, !!op.power);
          if (w) wins++;
          else if (op.times == null) break;
        }
        ex.wins = wins;
        ex.did = wins > 0;
        log(s, ex.player, `ガチンコ・ジャッジに${wins}回勝った`);
        break;
      }
      case 'repeatWins': {
        ex.ops.shift();
        for (let k = 0; k < (ex.wins ?? 0); k++) ex.ops.unshift(...op.body);
        continue;
      }
      case 'gachinko': {
        ex.did = judge(s, L, ex.player, !!op.power);
        ex.wins = ex.did ? 1 : 0;
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
