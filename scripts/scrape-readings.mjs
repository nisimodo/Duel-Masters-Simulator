// デュエル・マスターズ Wiki (dmwiki.net) のカードページ見出しのルビから、カード名の読みを取得する。
// 漢字や記号を含む名前だけが対象。中断しても再実行すれば続きから取得する。
//   node scripts/scrape-readings.mjs
import fs from 'node:fs';

const OUT = 'data/raw/readings.json';
const WAIT_MS = 1500;
const WORKERS = 2;
const UA = 'Mozilla/5.0 (private DM deck builder; reading lookup; low rate)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = fs
  .readFileSync('data/raw/official-cards.jsonl', 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// かな・英数字・記号だけの名前は読み不要
const KANA_ONLY = /^[ぁ-ゖァ-ー\s0-9A-Za-z０-９Ａ-Ｚａ-ｚ・･=＝\-－ー!！?？.,。、『』「」《》()（）&＆+＋:：/／☆★♪'’"“”~～#＃]+$/;

const names = new Set();
for (const c of raw) {
  const full = c.faces[0].name.trim();
  if (!KANA_ONLY.test(full)) names.add(full);
  for (const f of c.faces) {
    const n = f.name.trim();
    if (n !== full && !KANA_ONLY.test(n)) names.add(n);
    // ツインパクトは各面の名前でも探せるように
    if (n.includes(' / ')) for (const part of n.split(' / ')) if (!KANA_ONLY.test(part)) names.add(part.trim());
  }
}

/** Wiki のページ名の揺れに対応した候補 */
function variants(name) {
  const v = new Set();
  const add = (s) => v.add(s);
  add(name);
  add(name.normalize('NFKC'));
  add(name.replace(/∑/g, 'Σ'));
  add(name.replace(/ \/ /g, '/'));
  add(name.replace(/ \/ /g, '／'));
  add(name.normalize('NFKC').replace(/∑/g, 'Σ').replace(/ \/ /g, '/'));
  add(name.replace(/\s+/g, ''));
  return [...v];
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

/** 見出し h2 のルビを読みに置き換えた文字列 */
function extractReading(html) {
  const m = html.match(/<h2 id="content_1_0">([\s\S]*?)<\/h2>/);
  if (!m) return null;
  let h = m[1].replace(/<a class="anchor_super"[\s\S]*$/, '');
  if (!/<ruby>/.test(h)) return { reading: null, title: decode(h.replace(/<[^>]+>/g, '')).trim() };
  h = h.replace(/<ruby>[\s\S]*?<rt>([\s\S]*?)<\/rt>[\s\S]*?<\/ruby>/g, '$1');
  const reading = decode(h.replace(/<[^>]+>/g, ''))
    .replace(/[《》]/g, '')
    .trim();
  return { reading, title: null };
}

async function fetchPage(title) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://dmwiki.net/${encodeURIComponent(`《${title}》`)}`, { headers: { 'User-Agent': UA } });
      const html = await res.text();
      if (/<title>[^<]*の編集 - /.test(html)) return null; // ページが存在しない
      return html;
    } catch (e) {
      console.warn(`retry ${title}: ${e.message}`);
      await sleep(5000 * (i + 1));
    }
  }
  return null;
}

const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = [...names].filter((n) => !(n in done));
console.log(`names=${names.size} done=${Object.keys(done).length} todo=${todo.length}`);

let next = 0;
let n = 0;
let lastSave = Date.now();
const save = () => fs.writeFileSync(OUT, JSON.stringify(done, null, 0));

async function worker() {
  while (next < todo.length) {
    const name = todo[next++];
    let result = null; // null = 見つからない, '' = ページはあるがルビなし
    for (const v of variants(name)) {
      const html = await fetchPage(v);
      await sleep(WAIT_MS);
      if (!html) continue;
      const r = extractReading(html);
      result = r?.reading ?? '';
      break;
    }
    done[name] = result;
    if (++n % 50 === 0) console.log(`readings ${n}/${todo.length}`);
    if (Date.now() - lastSave > 15000) {
      save();
      lastSave = Date.now();
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, worker));
save();
const vals = Object.values(done);
console.log(`done: found=${vals.filter((v) => v).length} noRuby=${vals.filter((v) => v === '').length} missing=${vals.filter((v) => v === null).length}`);
