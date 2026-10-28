// テストプレイの結果を1枚の画像 (横 16:9 / 縦 9:16) にする
import type { SimStats } from '../engine/sim';
import { cardImage, type CardDB, type Civ } from './cards';
import { deckCivs, deckThumb, type Deck } from './deck';

export type ImageShape = 'landscape' | 'portrait';

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-');

/** 片方のデッキから見た集計 (画面の表示と画像で共通) */
export function deckReport(db: CardDB, st: SimStats, p: 0 | 1) {
  const q = (1 - p) as 0 | 1;
  const byCount = (pick: 0 | 1) =>
    Object.entries(st.reasons)
      .map(([r, v]) => [r, v[pick]] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  return {
    wins: byCount(p),
    losses: byCount(q),
    finishers: Object.entries(st.finishers[p]).sort((a, b) => b[1] - a[1]).slice(0, 5),
    usage: Object.entries(st.usage[p])
      .map(([cid, [n, w]]) => ({ name: db.byId.get(cid)?.name ?? cid, n, w }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10),
    rate: st.wins[p] / Math.max(1, st.games),
  };
}

const C = {
  bg: '#12141c',
  panel: '#1b1e2a',
  line: '#343a50',
  text: '#e8eaf2',
  muted: '#9aa0b8',
  accent: '#f0b429',
  ok: '#3fb950',
  warn: '#f0883e',
  a: '#1d4d8f',
  b: '#8f1d3a',
  d: '#555',
};
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

/** カード画像を読み込む (別サイトの画像は CORS が許されない時は使わない) */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // (画面のカード画像と同じく、参照元を送らない)
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function font(ctx: CanvasRenderingContext2D, px: number, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`;
}

/** 幅に収まらない文字は … で切る */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

const CIV_COLOR: Record<Civ, string> = { L: '#d9b730', W: '#2f6fd6', D: '#5a5a6e', F: '#c93a3f', N: '#2f9a45' };

interface Side {
  name: string;
  thumb: HTMLImageElement | null;
  /** 画像が使えない時に代わりに描く (デッキの文明の色とカード名) */
  civs: Civ[];
  thumbName: string;
  rep: ReturnType<typeof deckReport>;
  p: 0 | 1;
}

/** デッキの見出し (サムネイル・名前・勝率) */
function drawHead(ctx: CanvasRenderingContext2D, st: SimStats, s: Side, x: number, y: number, w: number, h: number) {
  const q = (1 - s.p) as 0 | 1;
  roundRect(ctx, x, y, w, h, 20, C.panel);
  ctx.fillStyle = s.p === 0 ? C.a : C.b;
  ctx.fillRect(x, y + 20, 8, h - 40);
  const tw = Math.round((h - 48) * (5 / 7));
  const th = h - 48;
  if (s.thumb) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + 32, y + 24, tw, th, 10);
    ctx.clip();
    ctx.drawImage(s.thumb, x + 32, y + 24, tw, th);
    ctx.restore();
  } else {
    // 文明の色の帯と、サムネイルのカード名
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + 32, y + 24, tw, th, 10);
    ctx.clip();
    const civs = s.civs.length ? s.civs : (['D'] as Civ[]);
    civs.forEach((c, i) => {
      ctx.fillStyle = CIV_COLOR[c];
      ctx.fillRect(x + 32 + (tw * i) / civs.length, y + 24, Math.ceil(tw / civs.length), th);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x + 32, y + 24, tw, th);
    font(ctx, 24, true);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const chars = [...s.thumbName];
    const lines: string[] = [];
    let cur = '';
    for (const ch of chars) {
      if (ctx.measureText(cur + ch).width > tw - 24) (lines.push(cur), (cur = ''));
      cur += ch;
    }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 5);
    shown.forEach((l, i) => ctx.fillText(l, x + 32 + tw / 2, y + 24 + th / 2 + (i - (shown.length - 1) / 2) * 32 + 8));
    ctx.textAlign = 'left';
    ctx.restore();
  }
  const tx = x + 32 + tw + 32;
  const maxW = x + w - 32 - tx;
  ctx.textBaseline = 'alphabetic';
  font(ctx, 30, true);
  ctx.fillStyle = s.p === 0 ? '#7fb0ff' : '#ff8fab';
  ctx.fillText(s.p === 0 ? 'デッキA' : 'デッキB', tx, y + 60);
  font(ctx, 38, true);
  ctx.fillStyle = C.text;
  ctx.fillText(fit(ctx, s.name, maxW), tx, y + 108);
  font(ctx, 110, true);
  ctx.fillStyle = C.accent;
  ctx.fillText(pct(st.wins[s.p], st.games), tx, y + Math.round(h * 0.62));
  font(ctx, 30);
  ctx.fillStyle = C.text;
  ctx.fillText(fit(ctx, `${st.wins[s.p]}勝 ${st.wins[q]}敗${st.draws ? ` ${st.draws}分` : ''}`, maxW), tx, y + Math.round(h * 0.77));
  ctx.fillStyle = C.muted;
  font(ctx, 26);
  ctx.fillText(fit(ctx, `先攻 ${pct(st.firstWins[s.p], st.firstGames[s.p])} ・ 後攻 ${pct(st.wins[s.p] - st.firstWins[s.p], st.games - st.firstGames[s.p])}`, maxW), tx, y + Math.round(h * 0.9));
}

/** 見出しつきの短い一覧 */
function drawList(ctx: CanvasRenderingContext2D, title: string, rows: { left: string; right: string; color?: string }[], x: number, y: number, w: number, max: number): number {
  font(ctx, 28, true);
  ctx.fillStyle = C.text;
  ctx.fillText(fit(ctx, title, w), x, y);
  y += 12;
  font(ctx, 26);
  if (!rows.length) {
    ctx.fillStyle = C.muted;
    ctx.fillText('なし', x, y + 38);
    return y + 38 + 60;
  }
  for (const r of rows.slice(0, max)) {
    y += 38;
    ctx.fillStyle = r.color ?? C.muted;
    ctx.textAlign = 'right';
    ctx.fillText(r.right, x + w, y);
    const rw = ctx.measureText(r.right).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, r.left, w - rw - 20), x, y);
  }
  // 次の見出しの位置
  return y + 60;
}

/** 勝因・敗因・よく使ったカード */
function drawDetail(ctx: CanvasRenderingContext2D, s: Side, x: number, y: number, w: number, h: number) {
  roundRect(ctx, x, y, w, h, 20, C.panel);
  // どちらのデッキか分かるよう、見出しと同じ色の帯
  ctx.fillStyle = s.p === 0 ? C.a : C.b;
  ctx.fillRect(x, y + 20, 8, h - 40);
  const pad = 32;
  const usage = s.rep.usage.slice(0, 6).map((u) => {
    const r = u.w / Math.max(1, u.n);
    const color = u.n >= 3 && r >= s.rep.rate + 0.1 ? C.ok : u.n >= 3 && r <= s.rep.rate - 0.1 ? C.warn : C.muted;
    return { left: `《${u.name}》`, right: `${u.n}試合 ${pct(u.w, u.n)}`, color };
  });
  const reasons = (list: readonly (readonly [string, number])[]) => list.map(([r, n]) => ({ left: r, right: `${n}回` }));
  // 左に勝因・敗因、右によく使ったカード (幅が狭い時は 勝因・敗因 の行を減らす)
  // (カード名が長いので右の列を広く)
  const lw = (w - pad * 3) * 0.42;
  const rw = w - pad * 3 - lw;
  const rowsFit = Math.max(1, Math.floor((h - pad * 2 - 28 * 2 - 60 - 12 * 2) / 38 / 2));
  const ly = drawList(ctx, '勝因', reasons(s.rep.wins), x + pad, y + pad + 28, lw, Math.min(3, rowsFit));
  drawList(ctx, '敗因', reasons(s.rep.losses), x + pad, ly, lw, Math.min(3, rowsFit));
  drawList(ctx, 'よく使ったカード (使った試合の勝率)', usage, x + pad * 2 + lw, y + pad + 28, rw, Math.min(6, Math.floor((h - pad * 2 - 28 - 12) / 38)));
}

/** 勝率の帯 */
function drawBar(ctx: CanvasRenderingContext2D, st: SimStats, x: number, y: number, w: number, h: number) {
  const n = Math.max(1, st.games);
  const wa = (st.wins[0] / n) * w;
  const wd = (st.draws / n) * w;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.clip();
  ctx.fillStyle = '#252a3a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.a;
  ctx.fillRect(x, y, wa, h);
  ctx.fillStyle = C.d;
  ctx.fillRect(x + wa, y, wd, h);
  ctx.fillStyle = C.b;
  ctx.fillRect(x + wa + wd, y, w - wa - wd, h);
  ctx.restore();
  font(ctx, Math.round(h * 0.5), true);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  if (st.wins[0]) ctx.fillText(`A ${pct(st.wins[0], st.games)}`, x + 24, y + h / 2);
  ctx.textAlign = 'right';
  if (st.wins[1]) ctx.fillText(`B ${pct(st.wins[1], st.games)}`, x + w - 24, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** 結果の画像 (PNG) を作る */
export async function renderResultImage(db: CardDB, st: SimStats, decks: [Deck, Deck], shape: ImageShape): Promise<Blob> {
  const [W, H] = shape === 'landscape' ? [1920, 1080] : [1080, 1920];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await document.fonts?.ready;
  const thumbs = await Promise.all(
    decks.map((d) => {
      const id = deckThumb(d);
      const card = id ? db.byId.get(id) : undefined;
      return card ? loadImage(cardImage(card)) : Promise.resolve(null);
    }),
  );
  const sides: Side[] = ([0, 1] as const).map((p) => {
    const id = deckThumb(decks[p]);
    return { name: decks[p].name, thumb: thumbs[p], civs: deckCivs(db, decks[p]), thumbName: (id && db.byId.get(id)?.name) || '', rep: deckReport(db, st, p), p };
  });

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const M = 48;
  // 見出し
  font(ctx, 52, true);
  ctx.fillStyle = C.text;
  ctx.fillText('テストプレイ結果', M, M + 52);
  const avg = st.decided ? `平均 ${Math.round((st.turnSum / st.decided) * 10) / 10} ターン` : '';
  const sub = [`${st.games}試合`, avg, new Date().toLocaleDateString('ja-JP')].filter(Boolean).join(' ・ ');
  font(ctx, 30);
  ctx.fillStyle = C.muted;
  if (shape === 'landscape') {
    ctx.textAlign = 'right';
    ctx.fillText(sub, W - M, M + 50);
    ctx.textAlign = 'left';
  } else ctx.fillText(sub, M, M + 104);

  if (shape === 'landscape') {
    const cw = (W - M * 3) / 2;
    const top = M + 96;
    const hh = 340;
    drawHead(ctx, st, sides[0], M, top, cw, hh);
    drawHead(ctx, st, sides[1], M * 2 + cw, top, cw, hh);
    drawBar(ctx, st, M, top + hh + 24, W - M * 2, 56);
    const dy = top + hh + 24 + 56 + 24;
    const dh = H - dy - M - 40;
    drawDetail(ctx, sides[0], M, dy, cw, dh);
    drawDetail(ctx, sides[1], M * 2 + cw, dy, cw, dh);
  } else {
    const cw = W - M * 2;
    let y = M + 140;
    const hh = 320;
    drawHead(ctx, st, sides[0], M, y, cw, hh);
    y += hh + 24;
    drawBar(ctx, st, M, y, cw, 56);
    y += 56 + 24;
    drawHead(ctx, st, sides[1], M, y, cw, hh);
    y += hh + 24;
    const dh = (H - y - M - 40 - 24) / 2;
    drawDetail(ctx, sides[0], M, y, cw, dh);
    drawDetail(ctx, sides[1], M, y + dh + 24, cw, dh);
  }
  // フッター
  font(ctx, 24);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText('デュエマ オンライン ・ CPU同士の対戦結果', W - M, H - M + 8);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}

/** ファイルとして保存する */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
