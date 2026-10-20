// 公式の殿堂レギュレーションページから 殿堂 / プレミアム殿堂 / コンビ を取得して
// data/regulation.json に保存する。  node scripts/scrape-regulation.mjs
import fs from 'node:fs';

const URL = 'https://dm.takaratomy.co.jp/rule/regulation/';

const html = await (await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
const lines = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]*>/g, '\n')
  .replace(/&amp;/g, '&')
  .replace(/&#8217;/g, '’')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const nameOf = (s) => {
  const m = s.match(/^[《≪](.+)[》≫]$/);
  return m ? m[1].trim() : null;
};

const sections = {
  'プレミアム殿堂コンビカード': 'premiumCombos',
  'プレミアム殿堂超次元コンビカード': 'premiumHyperCombos',
  'プレミアム殿堂入りカード': 'premium',
  '殿堂入りカード': 'hof',
  '殿堂解除カード': null,
};

const out = { source: URL, fetchedAt: new Date().toISOString(), premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] };
let cur;
let started = false;
let pair = [];
for (const line of lines) {
  if (line in sections) {
    if (line === 'プレミアム殿堂コンビカード') started = true;
    if (!started) continue;
    cur = sections[line];
    if (cur === null) break;
    pair = [];
    continue;
  }
  if (!started || !cur) continue;
  const n = nameOf(line);
  if (!n) continue;
  if (cur === 'premiumCombos' || cur === 'premiumHyperCombos') {
    pair.push(n);
    if (pair.length === 2) {
      out[cur].push(pair);
      pair = [];
    }
  } else if (!out[cur].includes(n)) {
    out[cur].push(n);
  }
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/regulation.json', JSON.stringify(out, null, 1));
console.log(
  `premium=${out.premium.length} hof=${out.hof.length} combos=${out.premiumCombos.length} hyperCombos=${out.premiumHyperCombos.length}`,
);
