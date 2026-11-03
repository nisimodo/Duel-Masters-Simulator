// デッキコード (DM1…) を読む・作る (Node だけで動く。アプリと同じ形式: src/lib/deckCode.ts)
//
//   node scripts/deck-code.mjs <コード>            デッキの中身をカード名つきで表示
//   node scripts/deck-code.mjs --json <コード>     中身を JSON で表示 (アプリの Deck の形)
//   node scripts/deck-code.mjs encode <JSONファイル>  JSON (下の形) からコードを作る
//     JSON = { "t": "duema" | "duepa", "n": "デッキ名", "m": [["カードID", 枚数], …], "h"?: […], "g"?: […], "p"?: "パートナーのID", "s"?: "サムネイルのID" }
//     (m などは { "カードID": 枚数 } の形でもよい。カード名を書いた場合は名前からIDを探す)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'DM1';

function loadCards() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/cards.json'), 'utf8'));
  const byId = new Map(raw.cards.map((c) => [c.id, c]));
  const byName = new Map();
  for (const c of raw.cards) {
    if (!byName.has(c.n)) byName.set(c.n, c.id);
    for (const f of c.f ?? []) if (!byName.has(f.n)) byName.set(f.n, c.id);
  }
  return { byId, byName };
}

export function decode(code) {
  const s = code.replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('デッキコードではありません (DM1 で始まりません)');
  return JSON.parse(zlib.inflateRawSync(Buffer.from(s.slice(PREFIX.length), 'base64url')).toString('utf8'));
}

export function encode(payload) {
  return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url');
}

const toMap = (list) => Object.fromEntries(list ?? []);

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n'));
    return;
  }
  if (cmd === 'encode') {
    const { byId, byName } = loadCards();
    const p = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
    const id = (k) => (byId.has(k) ? k : (byName.get(k) ?? (console.error(`見つからないカード: ${k}`), k)));
    const list = (v) => (v == null ? undefined : (Array.isArray(v) ? v : Object.entries(v)).map(([k, n]) => [id(k), n]).sort((a, b) => a[0].localeCompare(b[0])));
    const out = { t: p.t ?? 'duema', n: p.n ?? '無題', m: list(p.m) ?? [] };
    for (const k of ['h', 'g']) if (p[k] && list(p[k]).length) out[k] = list(p[k]);
    if (p.p) out.p = id(p.p);
    if (p.s) out.s = id(p.s);
    console.log(encode(out));
    return;
  }
  const json = cmd === '--json';
  const p = decode(json ? rest.join('') : [cmd, ...rest].join(''));
  if (json) {
    console.log(JSON.stringify({ name: p.n, type: p.t, main: toMap(p.m), hyper: toMap(p.h), gr: toMap(p.g), partner: p.p ?? null, thumb: p.s ?? null }, null, 2));
    return;
  }
  const { byId } = loadCards();
  const name = (cid) => byId.get(cid)?.n ?? `(カードDBにない: ${cid})`;
  const sum = (l) => (l ?? []).reduce((a, [, n]) => a + n, 0);
  console.log(`${p.n} (${p.t === 'duepa' ? 'デュエパ' : 'デュエマ'})`);
  if (p.p) console.log(`パートナー: ${name(p.p)} [${p.p}]`);
  if (p.s) console.log(`サムネイル: ${name(p.s)} [${p.s}]`);
  for (const [label, list] of [['メインデッキ', p.m], ['超次元ゾーン', p.h], ['超GRゾーン', p.g]]) {
    if (!list?.length) continue;
    console.log(`\n${label} (${sum(list)}枚)`);
    for (const [cid, n] of list) console.log(`  ${n} × ${name(cid)} [${cid}]`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
