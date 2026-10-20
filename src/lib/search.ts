import type { Card, CardDB, Civ } from './cards';

export interface SearchQuery {
  name: string;
  text: string;
  race: string;
  civs: (Civ | 'Z')[];
  /** any = いずれかを含む / all = すべて含む / exact = 完全一致 */
  civMode: 'any' | 'all' | 'exact';
  costMin: string;
  costMax: string;
  powerMin: string;
  powerMax: string;
  type: string;
  zone: '' | 'main' | 'hyper' | 'gr';
  reg: '' | 'hof' | 'premium' | 'free';
}

export const emptyQuery: SearchQuery = {
  name: '',
  text: '',
  race: '',
  civs: [],
  civMode: 'any',
  costMin: '',
  costMax: '',
  powerMin: '',
  powerMax: '',
  type: '',
  zone: '',
  reg: '',
};

export const CARD_TYPES: { label: string; test: (t: string) => boolean }[] = [
  { label: 'クリーチャー', test: (t) => t.includes('クリーチャー') },
  { label: '進化クリーチャー', test: (t) => t.includes('進化') && t.includes('クリーチャー') },
  { label: '呪文', test: (t) => t.includes('呪文') },
  { label: 'クロスギア', test: (t) => t.includes('クロスギア') },
  { label: '城', test: (t) => t.includes('城') },
  { label: 'サイキック', test: (t) => t.includes('サイキック') },
  { label: 'ドラグハート', test: (t) => t.includes('ドラグハート') },
  { label: 'GRクリーチャー', test: (t) => t.includes('GR') },
  { label: 'オーラ', test: (t) => t.includes('オーラ') },
  { label: 'フィールド', test: (t) => t.includes('フィールド') },
  { label: 'タマシード', test: (t) => t.includes('タマシード') },
  { label: 'ゼニス', test: (t) => t.includes('ゼニス') },
  { label: 'ツインパクト', test: () => true },
];

const nz = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
const hira2kata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const key = (s: string) => hira2kata(nz(s));

const numOr = (s: string, d: number) => (s.trim() === '' || isNaN(Number(s)) ? d : Number(s));

// 検索用の正規化済み文字列キャッシュ
const nameKey = new WeakMap<Card, string>();
const textKey = new WeakMap<Card, string>();

export function searchCards(db: CardDB, q: SearchQuery): Card[] {
  const name = key(q.name);
  const text = key(q.text);
  const race = key(q.race);
  const cMin = numOr(q.costMin, -Infinity);
  const cMax = numOr(q.costMax, Infinity);
  const pMin = numOr(q.powerMin, -Infinity);
  const pMax = numOr(q.powerMax, Infinity);
  const typeTest = CARD_TYPES.find((t) => t.label === q.type)?.test;
  return db.cards.filter((c) => {
    if (q.zone && c.zone !== q.zone) return false;
    if (name) {
      let k = nameKey.get(c);
      if (k == null) nameKey.set(c, (k = key(c.name + c.faces.map((f) => f.name).join(''))));
      if (!k.includes(name)) return false;
    }
    if (text) {
      let k = textKey.get(c);
      if (k == null) textKey.set(c, (k = key(c.search)));
      if (!k.includes(text)) return false;
    }
    if (race && !c.faces.some((f) => f.races.some((r) => key(r).includes(race)))) return false;
    if (q.civs.length) {
      const cs: (Civ | 'Z')[] = c.civs.length ? c.civs : ['Z'];
      if (q.civMode === 'any' && !q.civs.some((x) => cs.includes(x))) return false;
      if (q.civMode === 'all' && !q.civs.every((x) => cs.includes(x))) return false;
      if (q.civMode === 'exact' && (cs.length !== q.civs.length || !q.civs.every((x) => cs.includes(x)))) return false;
    }
    if (cMin !== -Infinity || cMax !== Infinity) {
      if (!c.faces.some((f) => f.cost >= cMin && f.cost <= cMax)) return false;
    }
    if (pMin !== -Infinity || pMax !== Infinity) {
      if (!c.faces.some((f) => f.power != null && f.power >= pMin && f.power <= pMax)) return false;
    }
    if (typeTest && !c.faces.some((f) => typeTest(f.type))) return false;
    if (q.type === 'ツインパクト' && !c.twin) return false;
    if (q.reg) {
      const st = db.regStatus.get(c.id);
      if (q.reg === 'free' ? !!st : st !== q.reg) return false;
    }
    return true;
  });
}
