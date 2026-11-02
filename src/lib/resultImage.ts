// テストプレイ・オンライン対戦の結果を1枚の画像 (横長 / 縦長) にする
import type { SimStats } from '../engine/sim';
import { cardImageSmall, type CardDB, type Civ } from './cards';
import { deckCivs, deckThumb, type Deck } from './deck';

export type ImageShape = 'landscape' | 'portrait';

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-');

/** デッキの記号 (A・B・C・D) */
export const deckLetter = (p: number) => String.fromCharCode(65 + p);

/** 片方のデッキから見た集計 (画面の表示と画像で共通) */
export function deckReport(db: CardDB, st: SimStats, p: number) {
  const sorted = (m: Record<string, number>) =>
    Object.entries(m)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  const wins: Record<string, number> = {};
  for (const [r, v] of Object.entries(st.reasons)) wins[r] = v[p] ?? 0;
  return {
    wins: sorted(wins),
    losses: sorted(st.losses[p] ?? {}),
    finishers: Object.entries(st.finishers[p] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
    usage: Object.entries(st.usage[p] ?? {})
      .map(([cid, [n, w]]) => ({ name: db.byId.get(cid)?.name ?? cid, n, w }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10),
    rate: st.wins[p] / Math.max(1, st.games),
    /** 負けた試合数 (引き分け・決着なしを除く) */
    lost: st.games - st.wins[p] - st.draws,
    /** 平均順位 (3人以上の時) */
    avgPlace: st.placed[p] ? Math.round((st.placeSum[p] / st.placed[p]) * 100) / 100 : null,
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
  d: '#555',
};
/** デッキごとの色 (帯・見出し) */
export const SIDE_COLORS = [
  { bar: '#1d4d8f', label: '#7fb0ff' },
  { bar: '#8f1d3a', label: '#ff8fab' },
  { bar: '#1d7a4a', label: '#7fe0a8' },
  { bar: '#6a3d9a', label: '#c9a7ff' },
  { bar: '#8a6a12', label: '#ffd77a' },
];
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

/** カード画像を読み込む (別サイトの画像は CORS が許されない時は使わない) */
export function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // (画面のカード画像と同じく、参照元を送らない)
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), timeoutMs);
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

/** 幅に収まるように折り返す (切らずに全部見せる) */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of [...text]) {
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur || !lines.length) lines.push(cur);
  // 閉じかっこだけの行にしない (前の行の最後の文字を連れてくる)
  const last = lines.length - 1;
  if (last > 0 && /^[》）」』、。]+$/.test(lines[last]) && lines[last - 1].length > 1) {
    lines[last] = lines[last - 1].slice(-1) + lines[last];
    lines[last - 1] = lines[last - 1].slice(0, -1);
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

const CIV_COLOR: Record<Civ, string> = { L: '#d9b730', W: '#2f6fd6', D: '#5a5a6e', F: '#c93a3f', N: '#2f9a45' };

interface Row {
  left: string;
  right: string;
  color?: string;
}
interface Section {
  title: string;
  rows: Row[];
  /** 2列で並べる時の列 (0: 左 / 1: 右) */
  col: 0 | 1;
}

/** 画像の1つのデッキ (見出し + 一覧) */
export interface Side {
  /** 見出しの一番上 (「デッキA」・プレイヤー名) */
  tag: string;
  bar: string;
  tagColor: string;
  /** デッキ名 */
  name: string;
  /** 大きく出す数字 (勝率・順位) */
  big: string;
  bigColor?: string;
  /** 数字の下の行 */
  lines: { text: string; color?: string }[];
  thumb: HTMLImageElement | null;
  /** 画像が使えない時に代わりに描く (デッキの文明の色とカード名) */
  civs: Civ[];
  thumbName: string;
  sections: Section[];
}

/** デッキの見出し (サムネイル・名前・数字) */
function drawHead(ctx: CanvasRenderingContext2D, s: Side, x: number, y: number, w: number, h: number) {
  roundRect(ctx, x, y, w, h, 20, C.panel);
  ctx.fillStyle = s.bar;
  ctx.fillRect(x, y + 20, 8, h - 40);
  const th = h - 48;
  const tw = Math.round(th * (5 / 7));
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
    const shown = wrap(ctx, s.thumbName, tw - 24).slice(0, 5);
    shown.forEach((l, i) => ctx.fillText(l, x + 32 + tw / 2, y + 24 + th / 2 + (i - (shown.length - 1) / 2) * 32 + 8));
    ctx.textAlign = 'left';
    ctx.restore();
  }
  const tx = x + 32 + tw + 32;
  const maxW = x + w - 32 - tx;
  ctx.textBaseline = 'alphabetic';
  // 枠が大きい時は文字も大きくする
  const k = Math.min(1.6, Math.max(1, h / 340));
  const px = (n: number) => Math.round(n * k);
  // デッキ名は2行まで折り返す
  font(ctx, px(36), true);
  const nameLines = wrap(ctx, s.name, maxW);
  const names = nameLines.length > 2 ? [nameLines[0], fit(ctx, nameLines.slice(1).join(''), maxW)] : nameLines;
  // 上から順に、行の高さ (文字の上端・下端) を測って重ならないように並べる
  const lines: { text: string; px: number; bold: boolean; color: string; gap: number; big?: boolean }[] = [
    { text: s.tag, px: px(28), bold: true, color: s.tagColor, gap: 0 },
    ...names.map((n, i) => ({ text: n, px: px(36), bold: true, color: C.text, gap: px(i ? 4 : 10) })),
    { text: s.big, px: px(104), bold: true, color: s.bigColor ?? C.accent, gap: px(14), big: true },
    ...s.lines.map((l, i) => ({ text: l.text, px: px(i ? 26 : 30), bold: false, color: l.color ?? (i ? C.muted : C.text), gap: px(i ? 10 : 14) })),
  ];
  const metric = (l: (typeof lines)[number]) => {
    font(ctx, l.px, l.bold);
    const m = ctx.measureText(l.text || '0');
    // 大きな数字は字面 (数字の上端・下端) で詰める
    if (l.big) return { up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent };
    return { up: m.fontBoundingBoxAscent ?? l.px * 0.88, down: m.fontBoundingBoxDescent ?? l.px * 0.12 };
  };
  const total = () => lines.reduce((a, l) => a + l.gap + metric(l).up + metric(l).down, 0);
  // 高さに収まらなければ数字を小さくする
  const big = lines.find((l) => l.big)!;
  while (total() > h - 40 && big.px > 48) big.px -= 4;
  let cy = y + Math.max(20, (h - total()) / 2);
  for (const l of lines) {
    const m = metric(l);
    cy += l.gap + m.up;
    font(ctx, l.px, l.bold);
    ctx.fillStyle = l.color;
    ctx.fillText(fit(ctx, l.text, maxW), tx, cy);
    cy += m.down;
  }
}

const ROW_H = 36;
const TITLE_H = 40;
const SECTION_GAP = 28;

/**
 * 見出しつきの一覧。名前が長い時は切らずに折り返す。
 * draw が false の時は高さだけ測る
 */
function drawList(ctx: CanvasRenderingContext2D, sec: Section, x: number, y: number, w: number, draw: boolean): number {
  font(ctx, 28, true);
  let cy = y + 28;
  if (draw) {
    ctx.fillStyle = C.text;
    for (const [i, l] of wrap(ctx, sec.title, w).entries()) ctx.fillText(l, x, cy + i * 34);
  }
  cy += (wrap(ctx, sec.title, w).length - 1) * 34 + (TITLE_H - 28);
  font(ctx, 26);
  if (!sec.rows.length) {
    if (draw) {
      ctx.fillStyle = C.muted;
      ctx.fillText('なし', x, cy + 28);
    }
    return cy + ROW_H - y;
  }
  for (const r of sec.rows) {
    const rw = ctx.measureText(r.right).width;
    const lines = wrap(ctx, r.left, w - rw - 20);
    if (draw) {
      ctx.fillStyle = r.color ?? C.muted;
      ctx.textAlign = 'right';
      ctx.fillText(r.right, x + w, cy + 28);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.text;
      lines.forEach((l, i) => ctx.fillText(l, x + (i ? 16 : 0), cy + 28 + i * 32));
    }
    cy += ROW_H + (lines.length - 1) * 32;
  }
  return cy - y;
}

const PAD = 32;
/** 一覧を2列に分ける幅 */
const TWO_COLS_MIN = 760;

/** 勝因・敗因・よく使ったカード (draw が false の時は高さだけ測る) */
function drawDetail(ctx: CanvasRenderingContext2D, s: Side, x: number, y: number, w: number, h: number, draw: boolean): number {
  if (draw) {
    roundRect(ctx, x, y, w, h, 20, C.panel);
    // どのデッキか分かるよう、見出しと同じ色の帯
    ctx.fillStyle = s.bar;
    ctx.fillRect(x, y + 20, 8, h - 40);
  }
  const inner = w - PAD * 2;
  const stack = (secs: Section[], sx: number, sw: number) => {
    let cy = y + PAD;
    secs.forEach((sec, i) => (cy += drawList(ctx, sec, sx, cy, sw, draw) + (i < secs.length - 1 ? SECTION_GAP : 0)));
    return cy - y + PAD;
  };
  if (w >= TWO_COLS_MIN) {
    // 左に勝因・敗因、右によく使ったカード (カード名が長いので右の列を広く)
    const lw = Math.round((inner - PAD) * 0.42);
    const rw = inner - PAD - lw;
    return Math.max(
      stack(
        s.sections.filter((x) => x.col === 0),
        x + PAD,
        lw,
      ),
      stack(
        s.sections.filter((x) => x.col === 1),
        x + PAD * 2 + lw,
        rw,
      ),
    );
  }
  return stack(s.sections, x + PAD, inner);
}

/** 勝率の帯 (デッキの数だけ色を分ける) */
function drawBar(ctx: CanvasRenderingContext2D, st: SimStats, x: number, y: number, w: number, h: number) {
  const n = Math.max(1, st.games);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.clip();
  ctx.fillStyle = '#252a3a';
  ctx.fillRect(x, y, w, h);
  // デッキごとの勝ち → 引き分け の順に並べる
  const segs = [...st.wins.map((v, p) => ({ v, color: SIDE_COLORS[p % SIDE_COLORS.length].bar, label: `${deckLetter(p)} ${pct(v, st.games)}` })), { v: st.draws, color: C.d, label: '' }];
  const labels: { text: string; cx: number; w: number }[] = [];
  let cx = x;
  for (const sg of segs) {
    const sw = (sg.v / n) * w;
    ctx.fillStyle = sg.color;
    ctx.fillRect(cx, y, sw, h);
    if (sg.label && sg.v > 0) labels.push({ text: sg.label, cx: cx + sw / 2, w: sw });
    cx += sw;
  }
  ctx.restore();
  font(ctx, Math.round(h * 0.5), true);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // (入りきらない細い帯には書かない)
  for (const l of labels) if (ctx.measureText(l.text).width < l.w - 16) ctx.fillText(l.text, l.cx, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** 結果の画像 (PNG) を作る */
export interface ResultImage {
  blob: Blob;
  /** カード画像を読み込めず、文明の色で代わりに描いたデッキの数 */
  missingThumbs: number;
}

/** デッキのサムネイル画像を読み込む */
function loadThumbs(db: CardDB, decks: (Deck | null)[], timeoutMs: number) {
  return Promise.all(
    decks.map((d) => {
      const id = d ? deckThumb(d) : null;
      const card = id ? db.byId.get(id) : undefined;
      // (縮めた画像は別サイトからの読み込みが許されているので、画像に描ける)
      return card ? loadImage(cardImageSmall(card), timeoutMs) : Promise.resolve(null);
    }),
  );
}

const thumbInfo = (db: CardDB, d: Deck | null) => {
  const id = d ? deckThumb(d) : null;
  return { civs: d ? deckCivs(db, d) : [], thumbName: (id && db.byId.get(id)?.name) || '' };
};

/**
 * 見出し・(勝率の帯)・デッキごとの枠を並べて描く。
 * 文字を切らずに全部見せるため、画像の高さは中身に合わせて伸ばす (最低でも 16:9 / 9:16)
 */
async function renderSides(opts: { title: string; sub: string; footer: string; sides: Side[]; shape: ImageShape; bar?: SimStats; missingThumbs: number }): Promise<ResultImage> {
  const { title, sub, footer, sides, shape, bar } = opts;
  const W = shape === 'landscape' ? 1920 : 1080;
  const minH = shape === 'landscape' ? 1080 : 1920;
  const M = 48;
  const n = sides.length;
  const cols = shape === 'portrait' ? 1 : n === 3 || n >= 5 ? 3 : Math.min(n, 2);
  const cw = (W - M * (cols + 1)) / cols;
  const hasDetail = sides.some((s) => s.sections.length);
  const nRows = Math.ceil(n / cols);
  const top0 = shape === 'landscape' ? M + 96 : M + 140;
  // 一覧がない時 (オンライン対戦) は、見出しの枠を大きくして画面いっぱいに並べる
  const hh = hasDetail ? (cols >= 3 ? 300 : 320) : Math.round(Math.max(300, Math.min(cw * 0.62, (minH - top0 - M - 40 - 24 * (nRows - 1)) / nRows)));
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  await document.fonts?.ready;
  // 1段ごとの、一覧の高さ (同じ段の枠はそろえる)
  const rows: number[][] = [];
  for (let i = 0; i < n; i += cols) rows.push(sides.slice(i, i + cols).map((_, k) => i + k));
  const detailH = rows.map((r) => (hasDetail ? Math.max(...r.map((i) => drawDetail(measure, sides[i], 0, 0, cw, 0, false))) : 0));
  const barH = bar ? 56 + 24 : 0;
  const rowH = (k: number) => hh + (hasDetail ? 24 + detailH[k] : 0);
  const body = barH + rows.reduce((a, _, k) => a + rowH(k) + 24, 0) - 24;
  // (見出しの枠だけの時は上下の真ん中に置く)
  const top = hasDetail ? top0 : Math.max(top0, top0 + (minH - top0 - M - 40 - body) / 2);
  const content = top + body + M + 40;
  // 短い時は一覧の枠を伸ばして、元の縦横比にする
  if (content < minH && hasDetail) {
    const extra = (minH - content) / rows.length;
    detailH.forEach((_, k) => (detailH[k] += extra));
  }
  const H = Math.max(minH, Math.ceil(content));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // 見出し
  font(ctx, 52, true);
  ctx.fillStyle = C.text;
  ctx.fillText(title, M, M + 52);
  font(ctx, 30);
  ctx.fillStyle = C.muted;
  if (shape === 'landscape') {
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, sub, W - M * 2 - ctx.measureText(title).width - 200), W - M, M + 50);
    ctx.textAlign = 'left';
  } else ctx.fillText(fit(ctx, sub, W - M * 2), M, M + 104);

  let y = top;
  if (bar) {
    drawBar(ctx, bar, M, y, W - M * 2, 56);
    y += 56 + 24;
  }
  rows.forEach((r, k) => {
    r.forEach((i, c) => {
      const x = M + c * (cw + M);
      drawHead(ctx, sides[i], x, y, cw, hh);
      if (hasDetail) drawDetail(ctx, sides[i], x, y + hh + 24, cw, detailH[k], true);
    });
    y += rowH(k) + 24;
  });
  // フッター
  font(ctx, 24);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText(footer, W - M, H - M + 8);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve({ blob: b, missingThumbs: opts.missingThumbs }) : reject(new Error('画像を作れませんでした'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * テストプレイの結果の画像 (PNG) を作る。
 * thumbTimeoutMs: カード画像を待つ時間 (まだ wsrv.nl が縮めていない画像は時間がかかるので、読み込み直す時は長めに待つ)
 */
export async function renderResultImage(db: CardDB, st: SimStats, decks: Deck[], shape: ImageShape, thumbTimeoutMs = 10000): Promise<ResultImage> {
  const thumbs = await loadThumbs(db, decks, thumbTimeoutMs);
  const multi = decks.length > 2;
  const sides: Side[] = decks.map((d, p) => {
    const rep = deckReport(db, st, p);
    const usage = rep.usage.slice(0, 6).map((u) => {
      const r = u.w / Math.max(1, u.n);
      const color = u.n >= 3 && r >= rep.rate + 0.1 ? C.ok : u.n >= 3 && r <= rep.rate - 0.1 ? C.warn : C.muted;
      return { left: `《${u.name}》`, right: `${u.n}試合 ${pct(u.w, u.n)}`, color };
    });
    const reasons = (list: [string, number][]) => list.slice(0, 4).map(([r, n]) => ({ left: r, right: `${n}回` }));
    const col = SIDE_COLORS[p % SIDE_COLORS.length];
    return {
      tag: `デッキ${deckLetter(p)}`,
      bar: col.bar,
      tagColor: col.label,
      name: d.name,
      big: pct(st.wins[p], st.games),
      lines: [
        { text: `${st.wins[p]}勝 ${rep.lost}敗${st.draws ? ` ${st.draws}分` : ''}${multi && rep.avgPlace != null ? ` ・ 平均${rep.avgPlace}位` : ''}` },
        { text: `先攻 ${pct(st.firstWins[p], st.firstGames[p])} ・ ${multi ? 'それ以外' : '後攻'} ${pct(st.wins[p] - st.firstWins[p], st.games - st.firstGames[p])}` },
      ],
      thumb: thumbs[p],
      ...thumbInfo(db, d),
      sections: [
        { title: '勝因', rows: reasons(rep.wins), col: 0 as const },
        { title: '敗因', rows: reasons(rep.losses), col: 0 as const },
        { title: 'よく使ったカード (使った試合の勝率)', rows: usage, col: 1 as const },
      ],
    };
  });
  const avg = st.decided ? `平均 ${Math.round((st.turnSum / st.decided) * 10) / 10} ターン` : '';
  return renderSides({
    title: 'テストプレイ結果',
    sub: [`${st.games}試合`, avg, new Date().toLocaleDateString('ja-JP')].filter(Boolean).join(' ・ '),
    footer: 'デュエマ オンライン ・ CPU同士の対戦結果',
    sides,
    shape,
    bar: st,
    missingThumbs: decks.filter((d, p) => deckThumb(d) && !thumbs[p]).length,
  });
}

/** オンライン対戦の1人分 (順位の順に並べて渡す) */
export interface OnlineEntry {
  name: string;
  cpu: boolean;
  deck: Deck | null;
  /** 順位 (決まらなかった時は null) */
  place: number | null;
}

/** オンライン対戦の結果の画像 (プレイヤー名・デッキ名・サムネイル・順位) */
export async function renderOnlineResultImage(db: CardDB, entries: OnlineEntry[], info: { mode: string; reason: string; turns: number }, shape: ImageShape, thumbTimeoutMs = 10000): Promise<ResultImage> {
  const thumbs = await loadThumbs(
    db,
    entries.map((e) => e.deck),
    thumbTimeoutMs,
  );
  const sides: Side[] = entries.map((e, i) => {
    const col = SIDE_COLORS[i % SIDE_COLORS.length];
    const win = e.place === 1;
    return {
      tag: `${e.name}${e.cpu ? ' (CPU)' : ''}`,
      bar: win ? C.accent : col.bar,
      tagColor: win ? C.accent : col.label,
      name: e.deck?.name ?? '(デッキ不明)',
      big: e.place != null ? `${e.place}位` : '引き分け',
      bigColor: win ? C.accent : C.text,
      lines: win ? [{ text: '勝利！', color: C.accent }] : [],
      thumb: thumbs[i],
      ...thumbInfo(db, e.deck),
      sections: [],
    };
  });
  return renderSides({
    title: '対戦結果',
    sub: [info.mode, `${info.turns}ターン`, info.reason && `決着: ${info.reason}`, new Date().toLocaleDateString('ja-JP')].filter(Boolean).join(' ・ '),
    footer: 'デュエマ オンライン',
    sides,
    shape,
    missingThumbs: entries.filter((e, i) => e.deck && deckThumb(e.deck) && !thumbs[i]).length,
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
