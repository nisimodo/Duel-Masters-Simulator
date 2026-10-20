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
  const text = f.skills
    .flatMap((s) => norm(s).split(/\n+/))
    .map((s) => s.trim())
    .filter(Boolean);
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

const cards = [];
const seenNames = new Set();
for (const c of raw) {
  if (!c.faces.length) continue;
  const fullName = norm(c.faces[0].name);
  if (seenNames.has(fullName)) continue; // 念のため同名を除外
  seenNames.add(fullName);
  const twin = c.faces.length === 2 && c.faces.every((f) => norm(f.name) === fullName) && fullName.includes(' / ');
  const parts = twin ? fullName.split(' / ') : null;
  const faces = c.faces.map((f, i) => face(f, twin ? (parts[i] ?? fullName) : norm(f.name)));
  const img = c.faces[0].img.replace('/wp-content/card/cardimage/', '');
  const card = { id: c.id, n: fullName, img, f: faces };
  if (twin) card.tw = 1;
  cards.push(card);
}

fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/cards.json', JSON.stringify({ builtAt: new Date().toISOString(), cards }));
fs.copyFileSync('data/regulation.json', 'public/data/regulation.json');
fs.copyFileSync('data/presets.json', 'public/data/presets.json');
const size = fs.statSync('public/data/cards.json').size;
console.log(`cards=${cards.length} size=${(size / 1024 / 1024).toFixed(1)}MB`);
