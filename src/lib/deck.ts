// デッキの型・レギュレーション判定・ランダム生成
import { mainFace, findByName, type Card, type CardDB, type Civ } from './cards';

export type DeckType = 'duema' | 'duepa';

export interface Deck {
  id: string;
  name: string;
  type: DeckType;
  main: Record<string, number>;
  hyper: Record<string, number>;
  gr: Record<string, number>;
  partner: string | null;
  /** デッキのサムネイルにするカード (デュエパはパートナー) */
  thumb?: string | null;
  updatedAt: number;
  /** みんなのデッキに投稿している */
  shared?: boolean;
}

export interface RoomRules {
  mode: DeckType;
  /** 通常ルール or 殿堂ゼロ */
  hof: 'normal' | 'zero';
  /** アドバンス or オリジナル */
  format: 'advance' | 'original';
}

export const DEFAULT_RULES: Record<DeckType, RoomRules> = {
  duema: { mode: 'duema', hof: 'normal', format: 'advance' },
  duepa: { mode: 'duepa', hof: 'normal', format: 'advance' },
};

export function emptyDeck(type: DeckType): Deck {
  return {
    id: '',
    name: type === 'duema' ? '新しいデッキ' : '新しいデュエパデッキ',
    type,
    main: {},
    hyper: {},
    gr: {},
    partner: null,
    updatedAt: Date.now(),
  };
}

/** デッキのサムネイルのカード: デュエパはパートナー、デュエマは選んだカード (なければ一番多く入れているカード) */
export function deckThumb(deck: Pick<Deck, 'type' | 'main' | 'hyper' | 'gr' | 'partner' | 'thumb'>): string | null {
  if (deck.type === 'duepa' && deck.partner) return deck.partner;
  const inDeck = (cid: string) => !!(deck.main[cid] || deck.hyper[cid] || deck.gr[cid] || deck.partner === cid);
  if (deck.thumb && inDeck(deck.thumb)) return deck.thumb;
  const top = Object.entries(deck.main).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? Object.keys(deck.hyper)[0] ?? deck.partner ?? null;
}

export const countOf = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

export type DeckFormat = 'original' | 'advance';

/**
 * デュエマのデッキの区分。超次元・超GRゾーンやゲーム開始時に置かれるカードを使っていればアドバンス、
 * なければオリジナル (オリジナルのデッキはアドバンスでも使える)。デュエパのデッキは null
 */
export function deckFormat(db: CardDB, deck: Pick<Deck, 'type' | 'main' | 'hyper' | 'gr' | 'partner'>): DeckFormat | null {
  if (deck.type !== 'duema') return null;
  if (countOf(deck.hyper) || countOf(deck.gr)) return 'advance';
  const ids = [...Object.keys(deck.main), ...(deck.partner ? [deck.partner] : [])];
  return ids.some((id) => db.byId.get(id)?.faces.some((f) => f.kw.startsInPlay)) ? 'advance' : 'original';
}

export const FORMAT_LABEL: Record<DeckFormat, string> = { original: 'オリジナル', advance: 'アドバンス' };

/** デュエマのデッキをオリジナル / アドバンスに分ける */
export function splitByFormat<T>(db: CardDB, items: T[], deckOf: (x: T) => Deck | null) {
  const original: T[] = [];
  const advance: T[] = [];
  const other: T[] = [];
  for (const x of items) {
    const d = deckOf(x);
    const f = d ? deckFormat(db, d) : null;
    (f === 'original' ? original : f === 'advance' ? advance : other).push(x);
  }
  return { original, advance, other };
}

/** デッキに入っている文明 (メイン・超次元・超GR・パートナー) */
export function deckCivs(db: CardDB, deck: Deck): Civ[] {
  const set = new Set<Civ>();
  for (const id of [...Object.keys(deck.main), ...Object.keys(deck.hyper), ...Object.keys(deck.gr), ...(deck.partner ? [deck.partner] : [])])
    for (const c of db.byId.get(id)?.civs ?? []) set.add(c);
  return (['L', 'W', 'D', 'F', 'N'] as Civ[]).filter((c) => set.has(c));
}

export function mainSize(deck: Deck) {
  return countOf(deck.main) + (deck.type === 'duepa' && deck.partner ? 1 : 0);
}

export const DECK_SIZE: Record<DeckType, number> = { duema: 40, duepa: 60 };

/** カードのテキストによるデッキ枚数の増加 (例: 《13番目の計画》) */
export function deckSizeBonus(db: CardDB, deck: Deck): number {
  let bonus = 0;
  for (const [id, n] of Object.entries(deck.main)) {
    const b = Math.max(0, ...(db.byId.get(id)?.faces.map((f) => f.kw.deckSizeBonus) ?? [0]));
    bonus += b * n;
  }
  return bonus;
}

/** 同名カードの上限枚数 */
export function copyLimit(db: CardDB, card: Card, rules: RoomRules): number {
  const special = card.faces.map((f) => f.kw.maxCopies).find((v) => v != null) ?? null;
  const base = rules.mode === 'duepa' ? 1 : 4;
  if (rules.mode === 'duema' && rules.hof === 'normal') {
    const st = db.regStatus.get(card.id);
    if (st === 'premium') return 0;
    if (st === 'hof') return Math.min(1, special ?? 1);
  }
  if (rules.mode === 'duepa' && db.regStatus.get(card.id) === 'premium') return 0;
  return special ?? base;
}

function comboViolations(db: CardDB, ids: Set<string>, combos: [string, string][], label: string) {
  const out: string[] = [];
  for (const [a, b] of combos) {
    const ca = findByName(db, a);
    const cb = findByName(db, b);
    if (ca && cb && ids.has(ca.id) && ids.has(cb.id)) out.push(`${label}《${ca.name}》と《${cb.name}》は同時に入れられません`);
  }
  return out;
}

/** レギュレーション違反の一覧を返す (空ならOK) */
export function validateDeck(db: CardDB, deck: Deck, rules: RoomRules = DEFAULT_RULES[deck.type]): string[] {
  const issues: string[] = [];
  if (deck.type !== rules.mode) {
    issues.push(rules.mode === 'duema' ? 'デュエパ用のデッキは使えません' : 'デュエマ用のデッキは使えません');
    return issues;
  }
  const allIds = new Set([...Object.keys(deck.main), ...Object.keys(deck.hyper), ...Object.keys(deck.gr)]);
  if (deck.partner) allIds.add(deck.partner);
  const missing = [...allIds].filter((id) => !db.byId.has(id));
  if (missing.length) issues.push(`カードDBに存在しないカードがあります (${missing.join(', ')})`);

  const counts = new Map<string, number>();
  const add = (m: Record<string, number>) => {
    for (const [id, n] of Object.entries(m)) counts.set(id, (counts.get(id) ?? 0) + n);
  };
  add(deck.main);
  add(deck.hyper);
  add(deck.gr);
  if (deck.partner) counts.set(deck.partner, (counts.get(deck.partner) ?? 0) + 1);

  for (const [id, n] of counts) {
    const card = db.byId.get(id);
    if (!card) continue;
    const unlimited = card.faces.some((f) => f.kw.maxCopies === 999);
    const lim = deck.gr[id] && !unlimited ? Math.min(2, copyLimit(db, card, rules)) : copyLimit(db, card, rules);
    if (n > lim) {
      const st = db.regStatus.get(id);
      if (lim === 0) issues.push(`《${card.name}》は${st === 'premium' ? 'プレミアム殿堂' : '使用不可'}のため入れられません`);
      else issues.push(`《${card.name}》は${lim}枚までです (${n}枚)${st === 'hof' && rules.hof === 'normal' ? ' [殿堂入り]' : ''}`);
    }
  }
  for (const [zone, m] of [
    ['main', deck.main],
    ['hyper', deck.hyper],
    ['gr', deck.gr],
  ] as const) {
    for (const id of Object.keys(m)) {
      const card = db.byId.get(id);
      if (card && card.zone !== zone) issues.push(`《${card.name}》はこのゾーンに入れられません`);
    }
  }

  const size = mainSize(deck);
  const hyper = countOf(deck.hyper);
  const gr = countOf(deck.gr);

  const target = DECK_SIZE[rules.mode] + deckSizeBonus(db, deck);
  if (rules.mode === 'duema') {
    if (size !== target) issues.push(`メインデッキは${target}枚にしてください (現在${size}枚)`);
    if (hyper > 8) issues.push(`超次元ゾーンは8枚までです (現在${hyper}枚)`);
    if (gr !== 0 && gr !== 12) issues.push(`超GRゾーンは0枚か12枚にしてください (現在${gr}枚)`);
    if (rules.hof === 'normal') {
      issues.push(...comboViolations(db, allIds, db.reg.premiumCombos, 'プレミアム殿堂コンビ:'));
      issues.push(...comboViolations(db, allIds, db.reg.premiumHyperCombos, 'プレミアム殿堂超次元コンビ:'));
    }
    if (rules.format === 'original') {
      if (hyper) issues.push('オリジナルでは超次元ゾーンを使えません');
      if (gr) issues.push('オリジナルでは超GRゾーンを使えません');
      for (const id of allIds) {
        const c = db.byId.get(id);
        if (c?.faces.some((f) => f.kw.startsInPlay)) issues.push(`オリジナルでは《${c.name}》(ゲーム開始時に置かれるカード)を使えません`);
      }
    }
  } else {
    if (size !== target) issues.push(`デッキはパートナーを含めて${target}枚にしてください (現在${size}枚)`);
    if (hyper || gr) issues.push('デュエパでは超次元・超GRゾーンを使えません');
    const partner = deck.partner ? db.byId.get(deck.partner) : undefined;
    if (!partner) issues.push('パートナーを設定してください');
    else {
      const f = mainFace(partner);
      if (!f.isCreature || f.cost < 5) issues.push('パートナーはコスト5以上のクリーチャーにしてください');
      const allowed = new Set<Civ>(partner.civs);
      for (const id of Object.keys(deck.main)) {
        const c = db.byId.get(id);
        if (c && c.civs.some((cv) => !allowed.has(cv))) issues.push(`《${c.name}》はパートナーの文明に含まれません`);
      }
    }
    issues.push(...comboViolations(db, allIds, db.reg.premiumCombos, 'プレミアム殿堂コンビ:'));
    for (const id of allIds) {
      const c = db.byId.get(id);
      if (c?.faces.some((f) => f.kw.startsInPlay)) issues.push(`《${c.name}》(ゲーム開始時に置かれるカード)は使えません`);
    }
  }
  return [...new Set(issues)];
}

// ---------- ランダム生成 ----------

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** レギュレーションに違反しない完全ランダムデッキを作る */
export function randomDeck(db: CardDB, type: DeckType, rules: RoomRules = DEFAULT_RULES[type]): Deck {
  const deck = emptyDeck(type);
  deck.name = type === 'duema' ? 'ランダムデッキ' : 'ランダムデュエパデッキ';
  const usable = (c: Card) =>
    c.zone === 'main' &&
    copyLimit(db, c, rules) > 0 &&
    !c.faces.some((f) => f.kw.startsInPlay) &&
    !(rules.mode === 'duema' && rules.format === 'original' && c.faces.some((f) => f.kw.startsInPlay));
  if (type === 'duema') {
    const pool = shuffle(db.cards.filter(usable));
    let size = 0;
    for (const c of pool) {
      if (size >= 40) break;
      const n = Math.min(copyLimit(db, c, rules), 4, 40 - size, 1 + Math.floor(Math.random() * 4));
      if (n <= 0) continue;
      deck.main[c.id] = n;
      if (validateDeck(db, deck, rules).some((i) => i.includes('同時に'))) {
        delete deck.main[c.id];
        continue;
      }
      size += n;
    }
  } else {
    const partners = db.cards.filter((c) => usable(c) && mainFace(c).isCreature && mainFace(c).cost >= 5 && c.civs.length > 0);
    const partner = partners[Math.floor(Math.random() * partners.length)];
    deck.partner = partner.id;
    const allowed = new Set(partner.civs);
    const pool = shuffle(db.cards.filter((c) => usable(c) && c.id !== partner.id && c.civs.every((cv) => allowed.has(cv))));
    for (const c of pool) {
      if (countOf(deck.main) >= 59) break;
      deck.main[c.id] = 1;
      if (validateDeck(db, deck, rules).some((i) => i.includes('同時に'))) delete deck.main[c.id];
    }
  }
  return deck;
}

/** プリセットデッキ(カード名と枚数)を Deck に変換 */
export function presetToDeck(db: CardDB, presetId: string): { deck: Deck; notFound: string[] } {
  const p = db.presets.find((x) => x.id === presetId);
  const deck = emptyDeck(p?.mode ?? 'duema');
  const notFound: string[] = [];
  if (!p) return { deck, notFound };
  deck.name = p.name;
  // デュエパ: パートナーの1枚はメインデッキに入れず、パートナーにする
  const partner = p.partner ? findByName(db, p.partner) : undefined;
  if (p.partner && !partner) notFound.push(p.partner);
  if (partner) deck.partner = partner.id;
  let partnerSkipped = false;
  for (const [name, n0] of p.cards) {
    const c = findByName(db, name);
    let n = n0;
    if (c && partner && c.id === partner.id && !partnerSkipped) {
      partnerSkipped = true;
      n--;
    }
    if (!c) notFound.push(name);
    else if (n > 0) deck[c.zone === 'main' ? 'main' : c.zone][c.id] = ((deck[c.zone === 'main' ? 'main' : c.zone][c.id] ?? 0) + n);
  }
  if (p.thumb) deck.thumb = findByName(db, p.thumb)?.id ?? null;
  return { deck, notFound };
}

/** ゲーム用にカードIDの配列へ展開 */
export function expandDeck(deck: Deck) {
  const ex = (m: Record<string, number>) => Object.entries(m).flatMap(([id, n]) => Array<string>(n).fill(id));
  return { main: ex(deck.main), hyper: ex(deck.hyper), gr: ex(deck.gr), partner: deck.partner };
}
