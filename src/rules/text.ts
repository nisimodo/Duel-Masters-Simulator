// カードテキストの正規化

/** NFKC + 古いカードのルビ付きキーワード 「S(シールド)・トリガー」「W(ダブル)・ブレイカー」 を通常表記に */
export function normText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/([A-Za-z])\([゠-ヿー]+\)/g, '$1')
    .replace(/^\{[A-Z]+\}\s*/, '')
    // 古い表記の統一: 「出たとき」→「出た時」、「戻してよい」→「戻してもよい」
    .replace(/とき/g, '時')
    .replace(/([てで])よい/g, '$1もよい')
    .replace(/そうしたなら/g, 'そうしたら')
    .replace(/[−－]/g, '-')
    .replace(/そのあと、/g, 'その後、')
    .replace(/自分自身/g, '自身')
    .replace(/　/g, ' ')
    // 「覚醒-自分のターンのはじめに、〜裏返す」「龍解:〜」は、そのまま誘発型能力として読む
    .replace(/^\s*(覚醒|龍解)\s*[-ー―:]\s*/, '')
    .trim();
}

/** 括弧内の注釈 (リマインダーテキスト) を除く (二重括弧まで) */
export function stripReminder(s: string): string {
  let prev = '';
  let cur = s;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/[（(][^（()）]*[)）]/g, '');
  }
  return cur;
}

/** 文に分割 (。区切り) */
export function sentences(s: string): string[] {
  return s
    .split('。')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 全角数字・漢数字を含む数を数値に */
export function num(s: string): number {
  const t = s.normalize('NFKC');
  const kanji: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, ひと: 1, ふた: 2 };
  if (kanji[t] != null) return kanji[t];
  return Number(t);
}

/** ▼▶で始まる選択肢の行を前の行に連結 */
export function mergeModal(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const t = normText(l);
    if (/^[▼▶►・]/.test(t) && out.length && /次のうちいずれか|選ぶ/.test(stripReminder(out[out.length - 1]))) out[out.length - 1] += '▼' + t.replace(/^[▼▶►・]/, '');
    else out.push(l);
  }
  return out;
}

export type AbilityGroupKind = 'wave' | 'accel' | 'survivor' | 'soul';

const GROUP_HEAD: [RegExp, AbilityGroupKind][] = [
  [/^ウェーブストライカー/, 'wave'],
  [/^アクセル/, 'accel'],
  [/^超魂X/, 'soul'],
];
export const TAP_ABILITY = /^このクリーチャーで攻撃する(かわりに|代わりに)、タップして次の能力を使ってもよい/;

/**
 * カードのテキスト行を、常に有効な行・条件つき/共有の能力 (ウェーブストライカー・アクセル・超魂X・サバイバーのoS能力)・
 * タップ能力 (攻撃するかわりにタップして使う能力) に分ける
 */
export const MARKED_LINE = /^(q|oP|oB|xB)\s+(.+)$|^(◇)\s*(.+)$/;

export function splitAbilities(lines: string[]): {
  main: string[];
  groups: { kind: AbilityGroupKind; lines: string[] }[];
  tap: string | null;
  marked: Record<string, string[]>;
} {
  const main: string[] = [];
  const marked: Record<string, string[]> = {};
  const groups = new Map<AbilityGroupKind, string[]>();
  const push = (k: AbilityGroupKind | null, l: string) => {
    if (!k) main.push(l);
    else groups.set(k, [...(groups.get(k) ?? []), l]);
  };
  let cur: AbilityGroupKind | null = null;
  let tap: string[] | null = null;
  let inTap = false;
  for (const raw of lines) {
    const t = normText(raw).trim();
    if (inTap) {
      if (!tap!.length) {
        tap!.push(t.replace(/。$/, ''));
        continue;
      }
      if (/^[▼▶►]/.test(t)) {
        tap!.push('▼' + t.replace(/^[▼▶►]/, ''));
        continue;
      }
      inTap = false;
    }
    if (TAP_ABILITY.test(stripReminder(t).replace(/\s+/g, ''))) {
      main.push(raw);
      tap = [];
      inTap = true;
      continue;
    }
    // 「このクリーチャーの q 能力を使う」などで使われる、記号つきの能力
    const mk = t.match(MARKED_LINE);
    if (mk) {
      const key = mk[1] ?? mk[3];
      (marked[key] ??= []).push((mk[2] ?? mk[4]).replace(/。$/, ''));
      continue;
    }
    const head = GROUP_HEAD.find(([re]) => re.test(t));
    if (head) {
      main.push(raw);
      cur = head[1];
      if (!groups.has(cur)) groups.set(cur, []);
      continue;
    }
    const sv = t.indexOf('oS');
    if (sv >= 0 && !/^サバイバー/.test(t)) {
      const before = t.slice(0, sv).trim();
      if (before) push(cur, before);
      push('survivor', t.slice(sv + 2).trim());
      continue;
    }
    push(cur, raw);
  }
  return { main, groups: [...groups].map(([kind, ls]) => ({ kind, lines: ls })), tap: tap?.length ? tap.join('。').replace(/。▼/g, '▼') : null, marked };
}
