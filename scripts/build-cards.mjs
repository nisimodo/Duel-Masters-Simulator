// data/raw/official-cards.jsonl を アプリ用の public/data/cards.json に変換する。
// 殿堂情報 (data/regulation.json) とプリセット (data/presets.json) もコピーする。
//   node scripts/build-cards.mjs
import fs from 'node:fs';

const CIV = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };

const raw = fs
  .readFileSync('data/raw/official-cards.jsonl', 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const norm = (s) => s.replace(/\r/g, '').replace(/ /g, ' ').trim();

function num(s) {
  s = norm(s || '');
  if (!s || s === '-') return null;
  if (s.includes('∞')) return 999999;
  const m = s.normalize('NFKC').match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function face(f, name) {
  const lines = f.skills
    .flatMap((s) => norm(s).split(/\n+/))
    .map((s) => s.trim())
    .filter(Boolean);
  // 公式のテキストで文の途中 (「〜を」「〜、」等) で改行されている行は、次の行とつなげる
  const text = [];
  for (const l of lines) {
    const prev = text[text.length - 1];
    if (prev != null && /[をにがはでと、の]$/.test(prev) && !/[。）)」]$/.test(prev)) text[text.length - 1] = prev + l;
    else text.push(l);
  }
  return {
    n: name,
    t: norm(f.type),
    c: norm(f.civ)
      .split('/')
      .map((c) => CIV[c])
      .filter(Boolean)
      .join(''),
    co: num(f.cost),
    p: norm(f.power) || null,
    r: norm(f.race)
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean),
    x: text,
  };
}

// カード名の読み (scripts/scrape-readings.mjs で Wiki のルビから取得)。
// Wiki で見つからない名前は、名前中の (カタカナ) 表記、それも無ければ形態素解析 (kuromoji) の推定読みで補う。
import kuromoji from 'kuromoji';

const readings = fs.existsSync('data/raw/readings.json') ? JSON.parse(fs.readFileSync('data/raw/readings.json', 'utf8')) : {};
const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((e, t) => (e ? rej(e) : res(t))),
);
const HAS_KANJI = /[㐀-鿿々〆]/;
let fallbackCount = 0;
function readingOf(name) {
  if (readings[name]) return readings[name];
  if (!HAS_KANJI.test(name)) return null;
  // 「神拳の超人(アヴァランチ・ジャイアント)」のように読みが名前に含まれている
  const paren = name.match(/[(（]([^()（）]+)[)）]/);
  if (paren && !HAS_KANJI.test(paren[1])) return paren[1];
  fallbackCount++;
  return tokenizer
    .tokenize(name)
    .map((t) => (t.reading && t.reading !== '*' ? t.reading : t.surface_form))
    .join('');
}
const readingsOf = (names) => [...new Set(names.map(readingOf).filter(Boolean))];

// 公式のカード検索でテキストが空になっている面 (カードの表記どおりに補う)
const FACE_FIX = {
  // レレディ・バ・グーバ / ツインパクト・マップ
  'dmbd08-a-003': { 1: { c: 'N', co: 1, x: ['自分の山札の上から３枚を表向きにする。その中からツインパクトカードを１枚、自分の手札に加える。残りを好きな順序で自分の山札の一番下に置く。'] } },
};

const cards = [];
const seenNames = new Set();
for (const c of raw) {
  if (!c.faces.length) continue;
  const fullName = norm(c.faces[0].name);
  if (seenNames.has(fullName)) continue; // 念のため同名を除外
  seenNames.add(fullName);
  // 公式の表記は「A / B」と「A/B」が混ざっている (面ごとに違うこともある)
  const slashParts = (s) => norm(s).split(/\s*\/\s*/);
  const twin =
    c.faces.length === 2 && slashParts(fullName).length === 2 && c.faces.every((f) => slashParts(f.name).join('/') === slashParts(fullName).join('/'));
  const parts = twin ? slashParts(fullName) : null;
  const faces = c.faces.map((f, i) => face(f, twin ? (parts[i] ?? fullName) : norm(f.name)));
  // 公式のデータが空の面を補う
  for (const [i, fx] of Object.entries(FACE_FIX[c.id] ?? {})) Object.assign(faces[+i], fx);
  const img = c.faces[0].img.replace('/wp-content/card/cardimage/', '');
  const card = { id: c.id, n: fullName, img, f: faces };
  if (twin) card.tw = 1;
  const y = readingsOf([fullName, ...c.faces.map((f) => norm(f.name)), ...(parts ?? [])]);
  if (y.length) card.y = y;
  cards.push(card);
}

fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/cards.json', JSON.stringify({ builtAt: new Date().toISOString(), cards }));
fs.copyFileSync('data/regulation.json', 'public/data/regulation.json');
fs.copyFileSync('data/presets.json', 'public/data/presets.json');
const size = fs.statSync('public/data/cards.json').size;
console.log(`cards=${cards.length} withReading=${cards.filter((c) => c.y).length} fallback=${fallbackCount} size=${(size / 1024 / 1024).toFixed(1)}MB`);
