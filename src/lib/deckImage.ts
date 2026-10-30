// デッキリストを1枚の画像 (PNG) にする: デッキ名・文明・フォーマットと、カードを1枚ずつ並べたメインデッキ / 超GR / 超次元 / パートナー
import { cardImageSmall, CIV_NAME, mainFace, type Card, type CardDB, type Civ } from './cards';
import { deckCivs, deckFormat, FORMAT_LABEL, type Deck } from './deck';
import { loadImage } from './resultImage';

const C = {
  bg: '#ffffff',
  text: '#1d1f27',
  muted: '#6b7080',
  line: '#d7dae2',
  card: '#e9ebf0',
};
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
const CIV_FILL: Record<Civ | 'Z', string> = { L: '#c9a90f', W: '#3d9be9', D: '#6f6f78', F: '#e0384e', N: '#4f9a52', Z: '#9aa0b0' };

const M = 28;
const CW = 140;
const CH = 196;
const GAP = 6;
const MAIN_COLS = 8;
const SIDE_COLS = 4;
const SIDE_GAP = 36;

/** 枚数ぶん並べた、コスト順のカード */
function expand(db: CardDB, m: Record<string, number>): Card[] {
  return Object.entries(m)
    .map(([cid, n]) => ({ card: db.byId.get(cid), n }))
    .filter((x): x is { card: Card; n: number } => !!x.card && x.n > 0)
    .sort((a, b) => mainFace(a.card).cost - mainFace(b.card).cost || a.card.id.localeCompare(b.card.id))
    .flatMap((x) => Array<Card>(x.n).fill(x.card));
}

const gridH = (n: number, cols: number) => (n ? Math.ceil(n / cols) * (CH + GAP) - GAP : 0);
const gridW = (cols: number) => cols * CW + (cols - 1) * GAP;

function font(ctx: CanvasRenderingContext2D, px: number, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`;
}

/** 「── メインデッキ ──」の見出し */
function heading(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number) {
  font(ctx, 30);
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = C.line;
  const mid = y + 20;
  ctx.fillRect(x, mid, (w - tw) / 2 - 24, 3);
  ctx.fillRect(x + (w + tw) / 2 + 24, mid, (w - tw) / 2 - 24, 3);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 31);
  ctx.textAlign = 'left';
}

/** カードを1枚描く (画像が無ければ文明の色と名前) */
function drawCard(ctx: CanvasRenderingContext2D, card: Card, img: HTMLImageElement | null, x: number, y: number) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, CW, CH, 7);
  ctx.clip();
  if (img) ctx.drawImage(img, x, y, CW, CH);
  else {
    const civs = card.civs.length ? card.civs : (['Z'] as const);
    civs.forEach((c, i) => {
      ctx.fillStyle = CIV_FILL[c];
      ctx.fillRect(x + (CW / civs.length) * i, y, CW / civs.length + 1, CH);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, CW, CH);
    ctx.fillStyle = '#fff';
    font(ctx, 17, true);
    // カード名を幅に合わせて折り返す
    let line = '';
    let ly = y + 30;
    for (const ch of card.name) {
      if (ctx.measureText(line + ch).width > CW - 16) {
        ctx.fillText(line, x + 8, ly);
        line = '';
        ly += 22;
        if (ly > y + CH - 30) break;
      }
      line += ch;
    }
    if (ly <= y + CH - 30) ctx.fillText(line, x + 8, ly);
    font(ctx, 16, true);
    ctx.fillText(String(mainFace(card).cost), x + 8, y + CH - 12);
  }
  ctx.restore();
}

export interface DeckImage {
  blob: Blob;
  /** 画像を読み込めず、文明の色で代わりに描いたカードの種類数 */
  missing: number;
}

/** デッキリストの画像を作る (timeoutMs: カード画像を待つ時間) */
export async function renderDeckImage(db: CardDB, deck: Deck, timeoutMs = 10000): Promise<DeckImage> {
  const main = expand(db, deck.main);
  const sides = [
    { title: '超GRゾーン', cards: expand(db, deck.gr) },
    { title: '超次元ゾーン', cards: expand(db, deck.hyper) },
    { title: 'パートナー', cards: deck.partner && db.byId.get(deck.partner) ? [db.byId.get(deck.partner)!] : [] },
  ].filter((s) => s.cards.length);

  // 画像は種類ごとに1回だけ読み込む
  const uniq = [...new Set([...main, ...sides.flatMap((s) => s.cards)])];
  const imgs = new Map<Card, HTMLImageElement | null>();
  await Promise.all(uniq.map(async (c) => imgs.set(c, await loadImage(cardImageSmall(c), timeoutMs))));
  await document.fonts?.ready;

  const mainW = gridW(MAIN_COLS);
  const sideW = gridW(SIDE_COLS);
  const W = M * 2 + mainW + (sides.length ? SIDE_GAP + sideW : 0);
  // (見出しの下、フォーマットの行と重ならない位置から)
  const HEAD = 228;
  const SEC = 64;
  const mainBottom = HEAD + SEC + gridH(main.length, MAIN_COLS);
  const sideBottom = sides.reduce((y, s) => y + SEC + gridH(s.cards.length, SIDE_COLS) + 28, HEAD) - 28;
  const H = Math.max(mainBottom, sideBottom) + 96;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出し: デッキ名 (左上)・文明とフォーマット (右上)
  font(ctx, 46, true);
  ctx.fillStyle = C.text;
  let name = deck.name;
  const nameMax = W - M * 2 - 360;
  while (name.length > 1 && ctx.measureText(name).width > nameMax) name = name.slice(0, -2) + '…';
  ctx.fillText(name, M, M + 52);
  const civs: (Civ | 'Z')[] = deckCivs(db, deck);
  if (!civs.length) civs.push('Z');
  font(ctx, 28, true);
  let cx = W - M;
  for (const c of [...civs].reverse()) {
    const label = c === 'Z' ? '無色' : CIV_NAME[c];
    const bw = Math.max(74, ctx.measureText(label).width + 36);
    cx -= bw;
    ctx.fillStyle = CIV_FILL[c];
    ctx.beginPath();
    ctx.roundRect(cx, M + 80, bw, 52, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx + bw / 2, M + 116);
    ctx.textAlign = 'left';
    cx -= 12;
  }
  const fmt = deckFormat(db, deck);
  font(ctx, 26);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'right';
  ctx.fillText(deck.type === 'duepa' ? 'デュエパ (60枚)' : `フォーマット：${fmt ? FORMAT_LABEL[fmt] : '-'}`, W - M, M + 170);
  ctx.textAlign = 'left';

  // メインデッキ
  heading(ctx, `メインデッキ (${main.length})`, M, HEAD, mainW);
  main.forEach((c, i) => drawCard(ctx, c, imgs.get(c) ?? null, M + (i % MAIN_COLS) * (CW + GAP), HEAD + SEC + Math.floor(i / MAIN_COLS) * (CH + GAP)));

  // 右の列: 超GR・超次元・パートナー
  let y = HEAD;
  const sx = M + mainW + SIDE_GAP;
  for (const s of sides) {
    heading(ctx, s.title, sx, y, sideW);
    s.cards.forEach((c, i) => drawCard(ctx, c, imgs.get(c) ?? null, sx + (i % SIDE_COLS) * (CW + GAP), y + SEC + Math.floor(i / SIDE_COLS) * (CH + GAP)));
    y += SEC + gridH(s.cards.length, SIDE_COLS) + 28;
  }

  // フッター
  ctx.fillStyle = C.line;
  ctx.fillRect(0, H - 72, W, 2);
  font(ctx, 26, true);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  ctx.fillText('デュエマ オンライン', W / 2, H - 26);
  ctx.textAlign = 'left';

  const missing = uniq.filter((c) => !imgs.get(c)).length;
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve({ blob: b, missing }) : reject(new Error('画像を作れませんでした'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}
