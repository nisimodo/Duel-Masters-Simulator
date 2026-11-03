// デッキコード: デッキの中身を1行の文字列にする (編成画面で入力するとデッキを再現できる)
//
// 形式 (v1): "DM1" + base64url( deflate-raw( JSON ) )
//   JSON = { t: 'duema' | 'duepa', n: デッキ名, m: [[カードID, 枚数], …], h: 超次元, g: 超GR, p: パートナー, s: サムネイル }
//   (h・g・p・s は空なら省く。カードIDは public/data/cards.json の id)
// Node では zlib.inflateRawSync で読める (scripts/deck-code.mjs)
import type { CardDB } from './cards';
import { emptyDeck, type Deck, type DeckType } from './deck';

export const DECK_CODE_PREFIX = 'DM1';

interface Payload {
  t: DeckType;
  n: string;
  m: [string, number][];
  h?: [string, number][];
  g?: [string, number][];
  p?: string;
  s?: string;
}

const entries = (m: Record<string, number>): [string, number][] =>
  Object.entries(m)
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** デッキをコードにする */
export async function deckToCode(deck: Deck): Promise<string> {
  const p: Payload = { t: deck.type, n: deck.name, m: entries(deck.main) };
  if (Object.keys(deck.hyper).length) p.h = entries(deck.hyper);
  if (Object.keys(deck.gr).length) p.g = entries(deck.gr);
  if (deck.partner) p.p = deck.partner;
  if (deck.thumb) p.s = deck.thumb;
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(p)), new CompressionStream('deflate-raw'));
  return DECK_CODE_PREFIX + toBase64Url(bytes);
}

export class DeckCodeError extends Error {}

/**
 * コードからデッキを作る (id・更新日時は空)。
 * db を渡すと、カードDBにないカードは除いて notFound に入れる
 */
export async function deckFromCode(code: string, db?: CardDB): Promise<{ deck: Deck; notFound: string[] }> {
  const s = code.replace(/\s+/g, '');
  if (!s.startsWith(DECK_CODE_PREFIX)) throw new DeckCodeError('デッキコードではありません (「DM1」で始まるコードを入力してください)');
  let p: Payload;
  try {
    const bytes = await pipe(fromBase64Url(s.slice(DECK_CODE_PREFIX.length)), new DecompressionStream('deflate-raw'));
    p = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DeckCodeError('デッキコードを読み取れませんでした (途中で切れていないか確認してください)');
  }
  if (!p || (p.t !== 'duema' && p.t !== 'duepa') || !Array.isArray(p.m)) throw new DeckCodeError('デッキコードの中身が正しくありません');
  const notFound: string[] = [];
  const known = (id: unknown): id is string => {
    if (typeof id !== 'string') return false;
    if (db && !db.byId.has(id)) {
      notFound.push(id);
      return false;
    }
    return true;
  };
  const toMap = (list: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!Array.isArray(list)) return out;
    for (const e of list) {
      if (!Array.isArray(e)) continue;
      const [id, n] = e;
      if (known(id) && Number.isInteger(n) && n > 0) out[id] = (out[id] ?? 0) + n;
    }
    return out;
  };
  const deck: Deck = {
    ...emptyDeck(p.t),
    name: typeof p.n === 'string' && p.n ? p.n : emptyDeck(p.t).name,
    main: toMap(p.m),
    hyper: toMap(p.h),
    gr: toMap(p.g),
    partner: p.p != null && known(p.p) ? p.p : null,
    thumb: p.s != null && (!db || db.byId.has(p.s)) ? p.s : null,
    updatedAt: 0,
  };
  return { deck, notFound };
}
