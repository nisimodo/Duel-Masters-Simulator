// 名詞句 (「相手のパワー5000以下のクリーチャー」等) を選択条件 Sel に変換する。
// 理解できない語が残った場合は null を返す (誤動作するより手動処理に回す)。
import type { Civ, Sel, SelZone } from './ops';

const CIV: Record<string, Civ> = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };

const KINDS: [RegExp, Sel['kind'], Partial<Sel>?][] = [
  [/シールド$/, 'card', { zones: ['shield'] }],
  [/サイキック・クリーチャー$/, 'psychic'],
  [/GRクリーチャー$/, 'gr'],
  [/進化クリーチャー$/, 'creature', { evolution: true }],
  [/クリーチャー$/, 'creature'],
  [/ツインパクトカード$/, 'card', { twinpact: true }],
  [/呪文$/, 'spell'],
  [/エレメント$/, 'element'],
  [/クロスギア$/, 'crossgear'],
  [/(D2)?フィールド$/, 'field'],
  [/タマシード$/, 'tamaseed'],
  [/オーラ$/, 'aura'],
  [/城$/, 'castle'],
  [/ドラグハート(・ウエポン|・フォートレス)?$/, 'dragheart'],
  [/デュエリスト$/, 'duelist'],
  [/カード$/, 'card'],
];

const ZONE_WORDS: [RegExp, SelZone][] = [
  [/墓地(にある)?/, 'grave'],
  [/マナゾーン(にある)?/, 'mana'],
  [/手札(にある)?/, 'hand'],
  [/シールドゾーン(にある)?/, 'shield'],
  [/超次元ゾーン(にある)?/, 'hyper'],
  [/超GR(ゾーン)?(にある)?/, 'gr'],
  [/山札(にある)?/, 'deck'],
];

/** 種族などとして許す語 (カタカナ・英字・記号) */
const RACE_WORD = /^[゠-ヿー・=＝<>＜＞A-Za-z0-9.'’!！]+$/;

export function parseSel(phrase: string, defaults: Partial<Sel> = {}): Sel | null {
  let p = phrase.replace(/\s+/g, '').replace(/の、/g, 'の').replace(/^、/, '').trim();
  const sel: Sel = { owner: 'any', zones: ['battle'], kind: 'creature', ...defaults };
  let zoneSet = false;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = p.match(re);
    if (!m) return false;
    fn(m);
    p = p.slice(0, m.index) + p.slice((m.index ?? 0) + m[0].length);
    return true;
  };

  // 前置きの場所・持ち主
  for (let guard = 0; guard < 12; guard++) {
    let changed = false;
    changed ||= take(/^バトルゾーンにある/, () => ((sel.zones = ['battle']), (zoneSet = true)));
    changed ||= take(/^自分のマナゾーンにあるカードと同じ文明を持つ、?/, () => (sel.civShareMana = true));
    changed ||= take(/^〈種族〉の/, () => (sel.raceRef = true));
    changed ||= take(/^〈文明〉の/, () => (sel.civRef = true));
    changed ||= take(/^〈数字コスト〉の/, () => (sel.costRef = true));
    changed ||= take(/^〈数字パワー〉の/, () => (sel.powerRef = true));
    changed ||= take(/^(自分|相手|各プレイヤー|すべてのプレイヤー|いずれかのプレイヤー)の/, (m) => {
      sel.owner = m[1] === '自分' ? 'self' : m[1] === '相手' ? 'opp' : 'any';
    });
    for (const [re, z] of ZONE_WORDS) {
      changed ||= take(new RegExp('^' + re.source + 'の?'), () => {
        sel.zones = [z];
        zoneSet = true;
      });
    }
    changed ||= take(/^他の/, () => (sel.other = true));
    changed ||= take(/^名前に《([^》]+)》とある/, (m) => (sel.nameHas = m[1]));
    changed ||= take(/^コスト(\d+)以下の/, (m) => (sel.costMax = +m[1]));
    changed ||= take(/^コスト(\d+)以上の/, (m) => (sel.costMin = +m[1]));
    changed ||= take(/^コスト(\d+)の/, (m) => ((sel.costMin = +m[1]), (sel.costMax = +m[1])));
    changed ||= take(/^パワー(\d+)以下の/, (m) => (sel.powerMax = +m[1]));
    changed ||= take(/^パワー(\d+)以上の/, (m) => (sel.powerMin = +m[1]));
    changed ||= take(/^「([^」]+)」を持つ/, (m) => (sel.hasKw = m[1]));
    changed ||= take(/^(タップされていない|タップしていない)/, () => (sel.tapped = false));
    changed ||= take(/^(タップされている|タップしている|タップ状態の)/, () => (sel.tapped = true));
    changed ||= take(/^((光|水|闇|火|自然)((または|か|、|と|・)(光|水|闇|火|自然))*)以外の/, (m) => {
      sel.civNot = [...m[1].matchAll(/光|水|闇|火|自然/g)].map((x) => CIV[x[0]]);
    });
    changed ||= take(/^(アンタップされている|アンタップしている|アンタップ状態の)/, () => (sel.tapped = false));
    changed ||= take(/^無色ではない/, () => (sel.notColorless = true));
    changed ||= take(/^クリーチャーではない/, () => (sel.notCreature = true));
    changed ||= take(/^無色の?/, () => (sel.colorless = true));
    changed ||= take(/^多色ではない/, () => (sel.monocolor = true));
    changed ||= take(/^多色の?/, () => (sel.multicolor = true));
    changed ||= take(/^単色の?/, () => (sel.mono = true));
    changed ||= take(/^非進化の?/, () => (sel.nonEvolution = true));
    changed ||= take(/^進化ではない/, () => (sel.nonEvolution = true));
    changed ||= take(/^このクリーチャーよりパワーが小さい/, () => (sel.powerLtSelf = true));
    changed ||= take(/^(このクリーチャー|これ)よりコストが小さい/, () => (sel.costLtSelf = true));
    changed ||= take(/^((光|水|闇|火|自然)((または|か|、|と|・)(光|水|闇|火|自然))*)の/, (m) => {
      sel.civs = [...m[1].matchAll(/光|水|闇|火|自然/g)].map((x) => CIV[x[0]]);
      if (/と/.test(m[1])) sel.civAll = true;
    });
    if (!changed) break;
  }
  if (!zoneSet && defaults.zones) sel.zones = defaults.zones;

  // 末尾の種類
  for (const [re, kind, extra] of KINDS) {
    const m = p.match(re);
    if (m) {
      sel.kind = kind;
      Object.assign(sel, extra);
      p = p.slice(0, m.index);
      break;
    }
  }
  p = p.replace(/の$/, '').replace(/・$/, '');
  if (p) {
    // 残りは種族 (「ドラゴン」「ジャイアントまたはコマンド」等)
    const races = p.split(/または|か|、|・(?=[^゠-ヿ])/).filter(Boolean);
    if (!races.every((r) => RACE_WORD.test(r))) return null;
    sel.races = races.map((r) => r.replace(/[<>＜＞]/g, ''));
    if (sel.kind === 'card' && !/カード$/.test(phrase)) sel.kind = 'creature';
  }
  return sel;
}
