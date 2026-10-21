// カードDBの型と読み込み
import { parseKeywords, type Keywords } from './keywords';
import { parseTriggers, type TriggerSpec } from './triggers';
import { parseStatics, type StaticSpec } from '../rules/statics';
import { collectKwDefs, expandKwLines, type KwDef } from '../rules/kwdefs';
import { mergeModal, normText, splitAbilities, stripReminder, type AbilityGroupKind } from '../rules/text';

export type Civ = 'L' | 'W' | 'D' | 'F' | 'N';
export const CIVS: Civ[] = ['L', 'W', 'D', 'F', 'N'];
export const CIV_NAME: Record<Civ, string> = { L: '光', W: '水', D: '闇', F: '火', N: '自然' };
export const CIV_COLOR: Record<Civ | 'Z', string> = {
  L: '#e8c840',
  W: '#3a8fd8',
  D: '#6b5a7a',
  F: '#d84a3a',
  N: '#3fa04a',
  Z: '#9a9a9a',
};

interface RawFace {
  n: string;
  t: string;
  c: string;
  co: number | null;
  p: string | null;
  r: string[];
  x: string[];
}
interface RawCard {
  id: string;
  n: string;
  img: string;
  f: RawFace[];
  tw?: 1;
  /** カード名の読み */
  y?: string[];
}

export interface Face {
  name: string;
  type: string;
  civs: Civ[];
  cost: number;
  power: number | null;
  powerText: string | null;
  races: string[];
  text: string[];
  kw: Keywords;
  /** 誘発型能力 */
  triggers: TriggerSpec[];
  /** 常在型能力 */
  statics: StaticSpec[];
  isCreature: boolean;
  isSpell: boolean;
  isEvolution: boolean;
  /** 条件つき・共有される能力 (ウェーブストライカー / アクセル / サバイバー / 超魂X) */
  groups?: AbilityGroup[];
  /** 「攻撃するかわりに、タップして次の能力を使ってもよい」の効果 */
  tapAbility?: string;
  /** サイレントスキルで使う能力 */
  silentSkill?: string;
  /** 記号つきの能力 (q / oP / oB / xB / ◇)。他の能力から「〜能力を使う」で使う */
  marked?: Record<string, string>;
}

export interface AbilityGroup {
  kind: AbilityGroupKind;
  triggers: TriggerSpec[];
  statics: StaticSpec[];
}

/** 能力として与えられるキーワード (条件つきの行に書かれたもの) */
const GRANT_KWS = ['ブロッカー', 'スピードアタッカー', 'マッハファイター', 'スレイヤー', 'ジャストダイバー', 'W・ブレイカー', 'T・ブレイカー', 'Q・ブレイカー', 'ワールド・ブレイカー'];

export type DeckZone = 'main' | 'hyper' | 'gr';

export interface Card {
  id: string;
  name: string;
  img: string;
  faces: Face[];
  twin: boolean;
  civs: Civ[];
  zone: DeckZone;
  /** カード名の読み (Wiki のルビから) */
  readings: string[];
  /** 全テキスト(検索用) */
  search: string;
  /** ハイパー化/Zラッシュを持つ (2面目はハイパーモード。手札からは1面目だけ使う) */
  hyper?: boolean;
}

export const IMG_BASE = 'https://dm.takaratomy.co.jp/wp-content/card/cardimage/';

export function cardImage(card: Card, face = 0): string {
  // サイキック・ドラグハート等の裏面は ...b.jpg
  if (face > 0 && !card.twin && /a\.jpg$/.test(card.img)) return IMG_BASE + card.img.replace(/a\.jpg$/, 'b.jpg');
  return IMG_BASE + card.img;
}

function toFace(f: RawFace, defs: Map<string, KwDef>): Face {
  // 名前のある能力は定義 (注釈) に展開して解釈する
  const sp = splitAbilities(mergeModal(f.x));
  const abilityLines = expandKwLines(sp.main, defs);
  const groups: AbilityGroup[] = sp.groups.map((g) => {
    const al = expandKwLines(g.lines, defs);
    const statics = parseStatics(al);
    const kws = g.lines.map((l) => stripReminder(normText(l)).replace(/\s+/g, '').replace(/。$/, '')).filter((x) => GRANT_KWS.includes(x));
    if (kws.length) statics.push({ s: 'grant', target: { t: 'self' }, kws, when: 'always' });
    return { kind: g.kind, triggers: parseTriggers(al), statics };
  });
  const power = f.p ? Number((f.p.normalize('NFKC').match(/-?\d+/) || ['0'])[0]) : null;
  return {
    name: f.n,
    type: f.t,
    civs: f.c.split('') as Civ[],
    cost: f.co ?? 0,
    power: f.p?.includes('∞') ? 999999 : power,
    powerText: f.p,
    races: f.r,
    text: f.x,
    kw: parseKeywords(sp.main, f.t),
    triggers: parseTriggers(abilityLines),
    statics: [
      ...parseStatics(abilityLines),
      ...(f.x.some((l) => /表向きで、?シールドゾーンを離れる時、かわりに(自分の)?墓地に置く/.test(normText(l))) ? [{ s: 'faceUpShieldToGrave' as const }] : []),
    ],
    isCreature: f.t.includes('クリーチャー'),
    isSpell: f.t.includes('呪文'),
    isEvolution: f.t.startsWith('進化') || f.t.includes('進化'),
    groups: groups.length ? groups : undefined,
    tapAbility: sp.tap ?? undefined,
    silentSkill: sp.silent ?? undefined,
    marked: Object.keys(sp.marked).length ? Object.fromEntries(Object.entries(sp.marked).map(([k, v]) => [k, v.join('。')])) : undefined,
  };
}

function toCard(r: RawCard, defs: Map<string, KwDef>): Card {
  const faces = r.f.map((f) => toFace(f, defs));
  const civSet = new Set<Civ>();
  // サイキック等の裏面は表と同じ文明扱い。ツインパクトは両面の文明。
  for (const f of r.tw ? faces : faces.slice(0, 1)) f.civs.forEach((c) => civSet.add(c));
  const t = faces[0].type;
  let zone: DeckZone = 'main';
  if (t.includes('サイキック') || t.includes('ドラグハート')) zone = 'hyper';
  else if (t.includes('GR')) zone = 'gr';
  return {
    id: r.id,
    name: r.n,
    img: r.img,
    faces,
    twin: !!r.tw,
    civs: CIVS.filter((c) => civSet.has(c)),
    zone,
    readings: r.y ?? [],
    hyper:
      !r.tw &&
      zone === 'main' &&
      faces.length === 2 &&
      faces.every((f) => f.isCreature) &&
      faces[0].name === faces[1].name &&
      faces[0].statics.some((x) => x.s === 'hyperize' || x.s === 'zrush'),
    search: [r.n, ...faces.flatMap((f) => [f.type, ...f.races, ...f.text])].join('\n'),
  };
}

export interface Regulation {
  premium: string[];
  hof: string[];
  premiumCombos: [string, string][];
  premiumHyperCombos: [string, string][];
}

export interface PresetDeck {
  id: string;
  name: string;
  cards: [string, number][];
}

export interface CardDB {
  cards: Card[];
  byId: Map<string, Card>;
  byName: Map<string, Card>;
  reg: Regulation;
  /** カードID -> 'premium' | 'hof' */
  regStatus: Map<string, 'premium' | 'hof'>;
  presets: PresetDeck[];
  races: string[];
  builtAt: string;
}

export const normName = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[“”"″]/g, '"')
    .replace(/[’‘']/g, "'")
    .replace(/[≪《]/g, '')
    .replace(/[≫》]/g, '');

let dbPromise: Promise<CardDB> | null = null;

export function loadCardDB(): Promise<CardDB> {
  if (!dbPromise) dbPromise = fetchDB();
  return dbPromise;
}

async function fetchJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name} の読み込みに失敗しました`);
  return res.json();
}

async function fetchDB(): Promise<CardDB> {
  const [raw, reg, presets] = await Promise.all([
    fetchJSON<{ builtAt: string; cards: RawCard[] }>('cards.json'),
    fetchJSON<Regulation>('regulation.json'),
    fetchJSON<PresetDeck[]>('presets.json'),
  ]);
  return buildDB(raw.cards, reg, presets, raw.builtAt);
}

export function buildDB(rawCards: RawCard[], reg: Regulation, presets: PresetDeck[], builtAt = ''): CardDB {
  const defs = collectKwDefs(rawCards.flatMap((c) => c.f.flatMap((f) => f.x)));
  const cards = rawCards.map((r) => toCard(r, defs));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const byName = new Map<string, Card>();
  for (const c of cards) {
    byName.set(normName(c.name), c);
    if (c.twin || c.faces.length > 1) for (const f of c.faces) if (!byName.has(normName(f.name))) byName.set(normName(f.name), c);
  }
  const regStatus = new Map<string, 'premium' | 'hof'>();
  for (const n of reg.hof) {
    const c = findByName({ byName } as CardDB, n);
    if (c) regStatus.set(c.id, 'hof');
  }
  for (const n of reg.premium) {
    const c = findByName({ byName } as CardDB, n);
    if (c) regStatus.set(c.id, 'premium');
  }
  const raceSet = new Set<string>();
  for (const c of cards) for (const f of c.faces) f.races.forEach((r) => raceSet.add(r));
  return {
    cards,
    byId,
    byName,
    reg,
    regStatus,
    presets,
    races: [...raceSet].sort(),
    builtAt,
  };
}

export function findByName(db: CardDB, name: string): Card | undefined {
  const hit = db.byName.get(normName(name));
  if (hit) return hit;
  // 「表面 / 裏面」と書かれたサイキック・覚醒カード等は各面の名前で探す
  for (const part of name.split(/\s*\/\s*/)) {
    const c = db.byName.get(normName(part));
    if (c) return c;
  }
  return undefined;
}

/** カードの主たる面 (クリーチャー面があればそれ) */
export function mainFace(card: Card): Face {
  return card.faces.find((f) => f.isCreature) ?? card.faces[0];
}
