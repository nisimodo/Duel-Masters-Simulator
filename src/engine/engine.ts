// デュエル・マスターズ ルールエンジン (決定的: 同じ初期状態とアクション列からは必ず同じ状態になる)
// キーワード能力とゲームの進行は自動、カード固有の効果は手動操作アクションで処理する。
import type { Card, Civ, Face } from '../lib/cards';
import { parseKeywords, type Keywords } from '../lib/keywords';
import { matchesCond } from './cond';
import { hintsFromText } from './effects';
import { matchesSel, programOf, resumeExec, runExec, startExec } from './interp';
import { EVENT_LABEL, isAutoEffect, spellEffectLines, type TrigEvent, type TriggerSpec } from '../lib/triggers';
import type { Action, CardInst, GameInit, GameState, Pending, PlayerState, ZoneName } from './types';

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
  const base: Keywords = f ? f.kw : EMPTY_KW;
  const g = s.cards[iid].grants;
  if (!g?.length) return base;
  const k: Keywords = { ...base };
  for (const kw of g.flatMap((x) => x.kws)) {
    if (kw === 'ブロッカー') k.blocker = true;
    else if (kw === 'スピードアタッカー') k.speedAttacker = true;
    else if (kw === 'マッハファイター') k.machFighter = true;
    else if (kw === 'スレイヤー') k.slayer = true;
    else if (kw === 'ブロックされない') k.unblockable = true;
    else if (kw === 'ジャストダイバー') k.justDiver = true;
    else if (kw === 'W・ブレイカー') k.breaker = Math.max(k.breaker, 2);
    else if (kw === 'T・ブレイカー') k.breaker = Math.max(k.breaker, 3);
    else if (kw === 'Q・ブレイカー') k.breaker = Math.max(k.breaker, 4);
    else if (kw === 'ワールド・ブレイカー') k.breaker = 99;
    else {
      const pa = kw.match(/^パワーアタッカー\+(\d+)$/);
      if (pa) k.powerAttacker += +pa[1];
    }
  }
  return k;
}
const EMPTY_KW = parseKeywords([], '');

export const isCreature = (s: GameState, L: Lookup, iid: number) => !!faceOf(s, L, iid)?.isCreature;

export function power(s: GameState, L: Lookup, iid: number, attacking = false): number {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  let p = (f?.power ?? 0) + c.powerMod;
  if (attacking && f) p += kwOf(s, L, iid).powerAttacker;
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
  opts: { pos?: 'top' | 'bottom'; tapped?: boolean; faceUp?: boolean; face?: number; silent?: boolean } = {},
): ZoneName {
  const c = s.cards[iid];
  const card = L(c.cid);
  const from = c.zone;
  const prevFace = c.face;
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
  if (dest === 'battle') c.sick = true;
  // 下にあったカードも同じゾーンへ (誘発はしない)
  for (const u of under) {
    const uc = s.cards[u];
    uc.parent = null;
    uc.zone = 'gone';
    const uCard = L(uc.cid);
    let ud: ZoneName = to === 'battle' ? 'grave' : to;
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
    if (dest === 'battle' && from !== 'battle') {
      fireSelf(s, L, iid, c.face, ['enter']);
      fireWatchers(s, L, c.owner, iid, 'otherOwnEnter', 'oppEnter');
    }
  }
  return dest;
}

// ---------- 誘発型能力 ----------
const MAX_PENDING = 80;

function pushAbility(s: GameState, L: Lookup, src: number, faceIdx: number, spec: TriggerSpec, event: TrigEvent) {
  if (s.pending.length >= MAX_PENDING) return;
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
  for (const spec of f.triggers ?? []) {
    const ev = spec.events.find((e) => events.includes(e));
    if (ev) pushAbility(s, L, iid, faceIdx, spec, ev);
  }
}

/** バトルゾーンにある他のカードの能力 (自分側 ownEv / 相手側 oppEv) */
function fireWatchers(s: GameState, L: Lookup, actor: number, exclude: number | null, ownEv: TrigEvent | null, oppEv: TrigEvent | null, subject: number | null = exclude) {
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const p = (s.active + k) % n;
    if (s.players[p].lost) continue;
    const ev = p === actor ? ownEv : oppEv;
    if (!ev) continue;
    for (const iid of s.players[p].battle) {
      if (iid === exclude) continue;
      const f = faceOf(s, L, iid);
      if (!f) continue;
      for (const spec of f.triggers ?? []) {
        if (!spec.events.includes(ev)) continue;
        // 「自分の光のハンターが出た時」などは、そのカードが条件に合う時だけ
        if (spec.subject && subject != null && !matchesSel(s, L, subject, spec.subject)) continue;
        pushAbility(s, L, iid, s.cards[iid].face, spec, ev);
      }
    }
  }
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
  for (const iid of [...pl.mana, ...pl.battle]) {
    const c = s.cards[iid];
    if (c.noUntap) c.noUntap = false;
    else c.tapped = false;
    c.sick = false;
  }
  // 「次の○○のターンのはじめまで」の制限を解除
  s.usedOnce = [];
  for (const c of s.cards) {
    if (c.restrict && c.restrict.until === p) c.restrict = undefined;
    if (c.grants) c.grants = c.grants.filter((g) => g.until !== p);
  }
  log(s, null, `── ターン${s.turn}: ${pl.name} ──`);
  // ターンのはじめの能力 → (advance で) ドロー
  fireWatchers(s, L, p, null, 'turnStartOwn', 'turnStartOpp');
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
export function payCovers(L: Lookup, s: GameState, pay: number[], need: Civ[]): boolean {
  if (pay.length < need.length) return need.length === 0;
  const opts = pay.map((i) => cardCivs(L, s.cards[i].cid));
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
  const civsOf = (i: number) => cardCivs(L, s.cards[i].cid);
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
  if (!f?.isCreature || c.zone !== 'battle' || c.tapped || c.noAttack || c.restrict?.attack) return false;
  const k = kwOf(s, L, iid);
  if (c.sick && !k.speedAttacker && !k.machFighter) return false;
  return true;
}

export function attackTargets(s: GameState, L: Lookup, iid: number): { players: number[]; cards: number[] } {
  const c = s.cards[iid];
  const f = faceOf(s, L, iid);
  if (!f) return { players: [], cards: [] };
  const opps = opponentsOf(s, c.owner);
  const k = kwOf(s, L, iid);
  const sickOnlyMach = c.sick && !k.speedAttacker;
  const players = sickOnlyMach || k.cantAttackPlayer ? [] : opps;
  const cards: number[] = [];
  for (const o of opps)
    for (const t of s.players[o].battle) {
      const tf = faceOf(s, L, t);
      if (!tf?.isCreature) continue;
      if (s.cards[t].tapped || (k.machFighter && c.sick)) cards.push(t);
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
        return f?.isCreature && kwOf(s, L, b).blocker && !s.cards[b].tapped && !s.cards[b].restrict?.block && b !== a.targetCard;
      });
  const manaCount = s.players[def].mana.length;
  const ninjas = s.players[def].hand.filter((h) => {
    const card = L(s.cards[h].cid);
    return card?.faces.some((f) => f.isCreature && f.kw.ninjaStrike != null && f.kw.ninjaStrike <= manaCount);
  });
  if (blockers.length || ninjas.length) {
    s.pending.unshift({ kind: 'block', player: def, blockers, ninjas });
  } else resolveAttack(s, L);
}

export function battle(s: GameState, L: Lookup, att: number, def: number) {
  const pa = power(s, L, att, true);
  const pd = power(s, L, def);
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
  if (killD) {
    log(s, null, `${q(nd)} は破壊された`);
    moveCard(s, L, def, 'grave');
  }
  if (killA) {
    log(s, null, `${q(na)} は破壊された`);
    moveCard(s, L, att, 'grave');
  }
  if (killD && !killA) fireSelf(s, L, att, s.cards[att].face, ['winBattle']);
  if (killA && !killD) fireSelf(s, L, def, s.cards[def].face, ['winBattle']);
}

export function breakShields(s: GameState, L: Lookup, target: number, shields: number[], by: number | null, breaker: number | null = null) {
  const pl = s.players[target];
  for (const sh of shields) {
    if (s.cards[sh].zone !== 'shield') continue;
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
  const n = Math.min(kwOf(s, L, a.attacker).breaker, def.shield.length);
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
      const multi = cardCivs(L, c.cid).length > 1;
      moveCard(s, L, a.iid, 'mana', { tapped: multi });
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
      }
      const targetPlayer = a.card != null ? s.cards[a.card].owner : a.player;
      if (targetPlayer === p || s.players[targetPlayer]?.lost) return '攻撃対象が不正です';
      c.tapped = true;
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
    case 'endTurn': {
      if (s.attack) return '攻撃の処理中です';
      if (s.turnStep !== 'main') return '今はターンを終了できません';
      log(s, p, 'ターン終了');
      beginEndTurn(s, L);
      return null;
    }
    default:
      return '今は実行できない操作です';
  }
}

export function playCard(s: GameState, p: number, a: Extract<Action, { t: 'play' }>, L: Lookup): Result {
  const c = s.cards[a.iid];
  const card = L(c.cid);
  if (!card) return 'カード情報がありません';
  const fromZones = ['hand', 'mana', 'grave', 'hyper', 'shield', 'deck', 'partner'];
  if (c.owner !== p || !fromZones.includes(c.zone)) return 'このカードは使えません';
  if (c.zone !== 'hand' && c.zone !== 'partner' && !a.free && !a.force) return '手札以外から使う場合は「コストを支払わずに使う」を選んでください';
  if (c.zone === 'partner' && !c.faceUp) return '裏向きのパートナーは召喚できません';
  const face = card.faces[a.face] ?? card.faces[0];
  if (c.zone === 'partner' && !face.isCreature) return 'パートナーの呪文側は唱えられません';
  // 支払い
  if (!a.free) {
    const me = s.players[p];
    for (const m of a.pay) {
      const mc = s.cards[m];
      if (mc.owner !== p || mc.zone !== 'mana' || mc.tapped) return 'マナの選択が不正です';
    }
    if (new Set(a.pay).size !== a.pay.length) return 'マナの選択が不正です';
    if (!a.force) {
      if (a.pay.length !== face.cost) return `コスト${face.cost}分のマナを選んでください`;
      if (!payCovers(L, s, a.pay, face.civs)) return '文明が足りません';
    }
    void me;
    for (const m of a.pay) s.cards[m].tapped = true;
  }
  const name = face.name;
  const how = a.free ? '(コストを支払わずに)' : '';
  if (face.isCreature) {
    let bases: number[] = [];
    if (face.isEvolution) {
      bases = (a.evo ?? []).filter((b) => s.cards[b]?.zone === 'battle' && s.cards[b].owner === p);
      if (!bases.length && !a.force) return '進化元のクリーチャーを選んでください';
    }
    const wasTapped = bases.some((b) => s.cards[b].tapped);
    log(s, p, `${q(name)} を${bases.length ? '進化' : ''}召喚${how}`);
    moveCard(s, L, a.iid, 'battle', { face: card.faces.indexOf(face) });
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
        log(s, p, 'EXライフ: 山札の上から1枚をシールドに追加');
      }
    }
  } else if (face.isSpell) {
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
    moveCard(s, L, a.iid, charger ? 'mana' : 'grave', { tapped: charger && card.civs.length > 1 });
    if (charger) log(s, p, 'チャージャーでマナゾーンへ');
    fireWatchers(s, L, p, null, 'spellOwn', 'spellOpp');
    fireWatchers(s, L, p, null, 'spellAny', 'spellAny');
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
      if (a.blocker != null) {
        if (!top.blockers.includes(a.blocker) || s.cards[a.blocker].zone !== 'battle') return 'ブロックできないクリーチャーです';
        s.cards[a.blocker].tapped = true;
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
