// 公式カード検索 (dm.takaratomy.co.jp/card/) からカード情報を収集する。
// 同名カード(イラスト違い・再録)は公式の「同名カードを表示しない」で除外される。
// 中断しても再実行すれば続きから取得する。
//   node scripts/scrape-official.mjs            一覧 + 詳細を取得
//   node scripts/scrape-official.mjs --refresh  一覧を取り直して新カードのみ追加取得
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://dm.takaratomy.co.jp';
const OUT_DIR = path.resolve('data/raw');
const IDS_FILE = path.join(OUT_DIR, 'official-ids.json');
const DETAIL_FILE = path.join(OUT_DIR, 'official-cards.jsonl');
const WAIT_MS = 900;
const UA = 'Mozilla/5.0 (private DM card db builder; low rate)';

fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, body) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'User-Agent': UA,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      console.warn(`retry ${i + 1} ${url}: ${e.message}`);
      await sleep(5000 * (i + 1));
    }
  }
  throw new Error(`failed: ${url}`);
}

async function collectIds() {
  const ids = [];
  const seen = new Set();
  let last = 1;
  for (let page = 1; page <= last; page++) {
    const html = await get(`${BASE}/card/`, `pagenum=${page}&sort=release_old`);
    const m = html.match(/data-page="(\d+)">最後/);
    if (m) last = Math.max(last, Number(m[1]));
    for (const [, id] of html.matchAll(/detail\/\?id=([^'"&]+)/g)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    console.log(`list ${page}/${last} total=${ids.length}`);
    await sleep(WAIT_MS);
  }
  return ids;
}

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

function cell(block, cls) {
  const m = block.match(new RegExp(`<td class='${cls}[^']*'>([\\s\\S]*?)</td>`));
  return m ? decode(m[1]) : '';
}

function parseDetail(id, html) {
  const start = html.indexOf("class='cardDetail");
  if (start < 0) return null;
  const body = html.slice(start);
  const blocks = body.split("<div class='card-itself'>").slice(1);
  const faces = blocks.map((b) => {
    const nameM = b.match(/<h3 class='card-name'>([\s\S]*?)<span class='packname'>([\s\S]*?)<\/span>/);
    const imgM = b.match(/<div class="card-img">\s*<img src="([^"]*)"/);
    const skillsM = b.match(/<td class='skills full'>([\s\S]*?)<\/td>/);
    const flavorM = b.match(/<td class='flavor full'>([\s\S]*?)<\/td>/);
    const skills = skillsM
      ? [...skillsM[1].matchAll(/<li>([\s\S]*?)(?=<li>|$)/g)].map((x) => decode(x[1])).filter(Boolean)
      : [];
    return {
      name: nameM ? decode(nameM[1]) : '',
      pack: nameM ? decode(nameM[2]) : '',
      img: imgM ? imgM[1] : '',
      type: cell(b, 'type'),
      civ: cell(b, 'civil'),
      rarity: cell(b, 'rarelity'),
      power: cell(b, 'power'),
      cost: cell(b, 'cost'),
      mana: cell(b, 'mana'),
      race: cell(b, 'race'),
      skills,
      flavor: flavorM ? decode(flavorM[1]) : '',
    };
  });
  return { id, faces };
}

async function main() {
  let ids;
  if (fs.existsSync(IDS_FILE) && !process.argv.includes('--refresh')) {
    ids = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
  } else {
    ids = await collectIds();
    fs.writeFileSync(IDS_FILE, JSON.stringify(ids));
  }
  const done = new Set();
  if (fs.existsSync(DETAIL_FILE)) {
    for (const line of fs.readFileSync(DETAIL_FILE, 'utf8').split('\n')) {
      if (line.trim()) done.add(JSON.parse(line).id);
    }
  }
  const todo = ids.filter((id) => !done.has(id));
  console.log(`details: ${done.size} done, ${todo.length} remaining`);
  const out = fs.createWriteStream(DETAIL_FILE, { flags: 'a' });
  let n = 0;
  let next = 0;
  // 3並列 (各ワーカーは1リクエストごとに待つ) で公式サイトに負荷をかけすぎないようにする
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      const html = await get(`${BASE}/card/detail/?id=${encodeURI(id)}`);
      const card = parseDetail(id, html);
      if (card) out.write(JSON.stringify(card) + '\n');
      else console.warn(`parse failed: ${id}`);
      if (++n % 50 === 0) console.log(`detail ${n}/${todo.length}`);
      await sleep(WAIT_MS);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  out.end();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
