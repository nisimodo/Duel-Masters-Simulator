// wsrv.nl で縮めたカード画像を全カード分読み込み直す (wsrv.nl に縮めた画像を残しておくため。GitHub Actions で毎週実行)
//   node scripts/warm-images.mjs [--limit N]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// src/lib/cards.ts の cardImage / cardImageSmall と同じURL (warm-images.test.ts で一致を確かめている)
export const IMG_BASE = 'https://dm.takaratomy.co.jp/wp-content/card/cardimage/';
export const smallUrl = (full) => `https://wsrv.nl/?url=${encodeURIComponent(full)}&w=300&output=webp&q=75`;

/** そのカードで表示する縮めた画像のURL (裏面に別の画像があるカードは両面) */
export function urlsFor(card) {
  const urls = [smallUrl(IMG_BASE + card.img)];
  // (ツインパクト (tw) は1枚の画像に両面が載っている)
  if (card.f.length > 1 && !card.tw && /a\.jpg$/.test(card.img)) urls.push(smallUrl(IMG_BASE + card.img.replace(/a\.jpg$/, 'b.jpg')));
  return urls;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 1枚読み込む。混んでいる (429・5xx) 時は間を空けてやり直す */
async function warm(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'duema-online image cache warmer (weekly)' } });
      await res.arrayBuffer();
      if (res.ok) return { ok: true, cached: /HIT/i.test(res.headers.get('cf-cache-status') ?? '') || /HIT/i.test(res.headers.get('x-cache-status') ?? '') };
      if (res.status !== 429 && res.status < 500) return { ok: false, status: res.status };
    } catch {
      // 回線のエラーはやり直す
    }
    await sleep(5000 * 2 ** attempt);
  }
  return { ok: false, status: 'retry' };
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const { cards } = JSON.parse(fs.readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
  const urls = [...new Set(cards.flatMap(urlsFor))].slice(0, limit);
  // wsrv.nl と公式サイトに負担をかけないよう、同時に3枚まで・1枚ごとに少し間を空ける
  const CONCURRENCY = 3;
  let next = 0;
  let ok = 0;
  let cached = 0;
  const failed = [];
  const started = Date.now();
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      const r = await warm(u);
      if (r.ok) {
        ok++;
        if (r.cached) cached++;
      } else failed.push(`${r.status} ${decodeURIComponent(u.replace(/^.*?url=/, '').replace(/&.*$/, ''))}`);
      const done = ok + failed.length;
      if (done % 500 === 0) console.log(`${done}/${urls.length} (${Math.round((Date.now() - started) / 1000)}秒)`);
      await sleep(150);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`完了: ${urls.length}枚中 ${ok}枚 (うち wsrv.nl に残っていた ${cached}枚)・失敗 ${failed.length}枚・${Math.round((Date.now() - started) / 60000)}分`);
  if (failed.length) console.log(failed.slice(0, 50).join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) await main();
