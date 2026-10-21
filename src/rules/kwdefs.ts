// 名前のある能力の定義 (注釈) を全カードから集め、注釈なしで書かれたカードでも同じ能力として解釈する。
//   例: 「ラスト・バースト(このクリーチャーが破壊された時、このカードの呪文側を…)」
import { normText } from './text';

/** エンジンが直接処理する (注釈を能力として解釈してはいけない) キーワード */
const ENGINE_KW = new Set([
  'ブロッカー',
  'S・トリガー',
  'シールド・トリガー',
  'スーパー・S・トリガー',
  'S・トリガー・プラス',
  'スピードアタッカー',
  'マッハファイター',
  'ジャストダイバー',
  'W・ブレイカー',
  'T・ブレイカー',
  'Q・ブレイカー',
  'ワールド・ブレイカー',
  'パワード・ブレイカー',
  'スレイヤー',
  'パワーアタッカー',
  'EXライフ',
  'チャージャー',
  'G・ストライク',
  '革命チェンジ',
  '侵略',
  'S級侵略',
  'ニンジャ・ストライク',
  'シンパシー',
  'ササゲール',
  'ハイパーエナジー',
  'G・ゼロ',
  '進化',
  'NEO進化',
  'G-NEO進化',
  'スター進化',
  '究極進化',
  'ガードマン',
  'スーパーガードマン',
  'エスケープ',
  'エターナル・Ω',
  'セイバー',
  'シールド・セイバー',
  'ウルトラ・セイバー',
  'J・O・E',
  'B・A・D',
  'マナ爆誕',
  'キリフダッシュ',
  'ムゲンクライム',
  'ウェーブストライカー',
  'アクセル',
  '超魂X',
  'ハイパー化',
  'Zラッシュ',
  'シンカライズ',
  'G・リンク',
  '左G・リンク',
  '右G・リンク',
  '中央G・リンク',
  'クロスギア',
  '解除',
  'ギャラクシールド',
  'フシギバース',
  'アビスラッシュ',
  'アタック・チャンス',
  'サバイバー',
  'ウェーブストライカー',
  'アクセル',
  '超魂X',
  'クロスギア',
]);

const DEF_RE = /^([^\s:：(（[\d]+?)\s*(\d+)?\s*(\[[^\]]*\])?\s*[(（](.{6,})[)）]\s*$/;

export interface KwDef {
  template: string;
  hasN: boolean;
}

/** エンジンが直接処理するキーワード (「革命チェンジ―火のドラゴン」のような条件つきも含む) */
const isEngineKw = (kw: string) => ENGINE_KW.has(kw) || ENGINE_KW.has(kw.split(/[―\-－ー:：]/)[0]);

/** 全カードのテキスト行から「キーワード → 定義」を作る */
export function collectKwDefs(allLines: Iterable<string>): Map<string, KwDef> {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of allLines) {
    const t = normText(raw);
    const m = t.match(DEF_RE);
    if (!m) continue;
    const [, kw, n, , def] = m;
    if (isEngineKw(kw) || kw.length > 14) continue;
    const template = n ? def.split(n).join('{N}') : def;
    const key = `${kw}\u0000${n ? 1 : 0}`;
    const c = counts.get(key) ?? new Map<string, number>();
    c.set(template, (c.get(template) ?? 0) + 1);
    counts.set(key, c);
  }
  const out = new Map<string, KwDef>();
  for (const [key, c] of counts) {
    const [kw, hasN] = key.split('\u0000');
    const best = [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.set(kw + (hasN === '1' ? '#N' : ''), { template: best, hasN: hasN === '1' });
  }
  return out;
}

/** 能力の解析用に行を展開する: 注釈つきなら注釈の中身、注釈なしのキーワードなら辞書の定義を追加 */
export function expandKwLines(lines: string[], defs: Map<string, KwDef>): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    out.push(raw);
    const t = normText(raw);
    const m = t.match(DEF_RE);
    if (m) {
      if (!isEngineKw(m[1])) out.push(m[4]);
      continue;
    }
    // 「スペース・チャージ:火(〜)」のように、キーワードの後ろに条件がついたもの
    const param = t.match(/^([^\s:：(（]{2,20}?)[:：\-―]([^(（]{1,20})[(（](.{6,})[)）]\s*$/);
    if (param) {
      if (!isEngineKw(param[1])) out.push(param[3]);
      continue;
    }
    const bare = t.match(/^([^\s:：(（[\d]+?)\s*(\d+)?\s*(\[[^\]]*\])?\s*$/);
    if (!bare || isEngineKw(bare[1])) continue;
    const d = defs.get(bare[1] + (bare[2] ? '#N' : ''));
    if (d) out.push(bare[2] ? d.template.split('{N}').join(bare[2]) : d.template);
  }
  return out;
}
