// 名詞句 (「相手のパワー5000以下のクリーチャー」等) を選択条件 Sel に変換する。
// 理解できない語が残った場合は null を返す (誤動作するより手動処理に回す)。
import type { Civ, Sel, SelZone } from './ops';

const CIV: Record<string, Civ> = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };

const KINDS: [RegExp, Sel['kind'], Partial<Sel>?][] = [
  [/シールド$/, 'card', { zones: ['shield'] }],
  [/クリーチャー(?:また|か)はタマシード$|クリーチャーかタマシード$/, 'creatureOrTama'],
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

/** 漢字を含む種族 */
const KANJI_RACE = /^(革命軍|マスター革命軍|S級侵略者|侵略者(ZERO)?|超化獣|チーム(切札|零|銀河)|鬼札王国|鬼レクスターズ|月光王国|美孔麗王国|暴拳王国|不死樹王国|魔導具|(ハムカツ|ドレミ|テック|アクミ|ダママ|イメン)団|裁きの紋章Z?|(生徒会|アオハル)組|禁断|ドラゴンの花嫁|アウトレイジ(猫|犬)?|[゠-ヿー・]+(爆|閃|號|炎|風|海|邪))$/;

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
    changed ||= take(/^自分のマナゾーンにあるカードの枚数より、?コストが小さい/, () => (sel.costVs = { by: 'mana', cmp: 'lt' }));
    changed ||= take(/^自分のマナゾーンにあるカードの枚数以下のコストを持つ/, () => (sel.costVs = { by: 'mana', cmp: 'le' }));
    changed ||= take(/^自分の手札の枚数以下のコストを持つ/, () => (sel.costVs = { by: 'hand', cmp: 'le' }));
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
    changed ||= take(/^名前に《([^》]+)》(とある|を持つ)/, (m) => (sel.nameHas = m[1]));
    changed ||= take(/^コスト(\d+)以下の/, (m) => (sel.costMax = +m[1]));
    changed ||= take(/^コスト(\d+)以上の/, (m) => (sel.costMin = +m[1]));
    changed ||= take(/^コスト(\d+)の/, (m) => ((sel.costMin = +m[1]), (sel.costMax = +m[1])));
    changed ||= take(/^パワー(\d+)以下の/, (m) => (sel.powerMax = +m[1]));
    changed ||= take(/^パワー(\d+)以上の/, (m) => (sel.powerMin = +m[1]));
    changed ||= take(/^「([^」]+)」を持つ/, (m) => (sel.hasKw = m[1]));
    changed ||= take(/^、?「([^」]+)」(?:以外の|を持たない)/, (m) => (sel.hasKwNot = m[1]));
    changed ||= take(/^(タップされていない|タップしていない)/, () => (sel.tapped = false));
    changed ||= take(/^(タップされている|タップしている|タップ状態の)/, () => (sel.tapped = true));
    changed ||= take(/^((光|水|闇|火|自然)((または|か|、|と|・)(光|水|闇|火|自然))*)(?:ではない|以外の)/, (m) => {
      sel.civNot = [...m[1].matchAll(/光|水|闇|火|自然/g)].map((x) => CIV[x[0]]);
    });
    changed ||= take(/^(アンタップされている|アンタップしている|アンタップ状態の)/, () => (sel.tapped = false));
    changed ||= take(/^無色ではない/, () => (sel.notColorless = true));
    changed ||= take(/^クリーチャー(ではない|以外の)/, () => (sel.notCreature = true));
    changed ||= take(/^サイキックではない/, () => (sel.notPsychic = true));
    changed ||= take(/^、?((?:光|水|闇|火|自然)(?:、(?:光|水|闇|火|自然))+)いずれかの/, (m) => (sel.civs = [...m[1].matchAll(/光|水|闇|火|自然/g)].map((x) => CIV[x[0]])));
    changed ||= take(/^([゠-ヿー・]{2,})(?:ではない|以外の)/, (m) => (sel.racesNot = [m[1]]));
    changed ||= take(/^無色の?/, () => (sel.colorless = true));
    changed ||= take(/^多色ではない/, () => (sel.monocolor = true));
    changed ||= take(/^多色の?/, () => (sel.multicolor = true));
    changed ||= take(/^単色の?/, () => (sel.mono = true));
    changed ||= take(/^非進化の?/, () => (sel.nonEvolution = true));
    changed ||= take(/^(?:進化ではない|進化以外の|進化クリーチャーではない|進化クリーチャー以外の|進化でない)/, () => (sel.nonEvolution = true));
    changed ||= take(/^(?:このクリーチャーよりパワーが小さい|パワーがこのクリーチャーより小さい|このクリーチャーよりパワーの小さい)/, () => (sel.powerLtSelf = true));
    changed ||= take(/^(?:そのクリーチャーよりパワーが小さい|そのクリーチャーよりパワーの小さい|パワーがそのクリーチャーより小さい)/, () => (sel.powerLtIt = true));
    changed ||= take(/^、?パワーが一番小さい/, () => (sel.extreme = 'minPower'));
    changed ||= take(/^、?(?:パワーが一番大きい|一番パワーの大きい)/, () => (sel.extreme = 'maxPower'));
    changed ||= take(/^(このクリーチャー|これ)よりコストが小さい/, () => (sel.costLtSelf = true));
    changed ||= take(/^((光|水|闇|火|自然)((または|か|、|と|・)(光|水|闇|火|自然))*)の/, (m) => {
      sel.civs = [...m[1].matchAll(/光|水|闇|火|自然/g)].map((x) => CIV[x[0]]);
      if (/と/.test(m[1])) sel.civAll = true;
    });
    if (!changed) break;
  }
  if (!zoneSet && defaults.zones) sel.zones = defaults.zones;

  // 末尾の種類
  let kindSet = false;
  const nm = p.match(/^《([^》]+)》$/);
  if (nm) {
    sel.name = nm[1];
    sel.kind = 'card';
    p = '';
    kindSet = true;
  }
  for (const [re, kind, extra] of KINDS) {
    const m = p.match(re);
    if (m) {
      sel.kind = kind;
      Object.assign(sel, extra);
      p = p.slice(0, m.index);
      kindSet = true;
      break;
    }
  }
  p = p.replace(/の$/, '').replace(/・$/, '');
  // 「自身の手札」「自分のマナゾーン」のようにゾーンだけなら、そこにあるカード
  if (!kindSet && !p && zoneSet && /(手札|マナゾーン|墓地|山札)(にある)?$/.test(phrase.replace(/\s+/g, ''))) sel.kind = 'card';
  if (p) {
    // 残りは種族 (「ドラゴン」「ジャイアントまたはコマンド」等)
    const races = p.split(/または|か|、|と|・(?=[^゠-ヿ])/).filter(Boolean);
    if (!races.every((r) => RACE_WORD.test(r) || KANJI_RACE.test(r))) return null;
    sel.races = races.map((r) => r.replace(/[<>＜＞]/g, ''));
    if (sel.kind === 'card' && !/カード$/.test(phrase)) sel.kind = 'creature';
  }
  return sel;
}
