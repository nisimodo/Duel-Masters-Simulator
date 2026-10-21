// カードテキストの正規化

/** NFKC + 古いカードのルビ付きキーワード 「S(シールド)・トリガー」「W(ダブル)・ブレイカー」 を通常表記に */
export function normText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\uFE0E\uFE0F\u200B]/g, '')
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
    .replace(/^\s*覚醒\s*\(サイキック\)\s*リンク\s*[-ー―:]\s*/, '')
    // 革命Nトリガー: 「クリーチャーが自分を攻撃する時、〜」は相手のクリーチャーが攻撃する時の、手札からの能力
    .replace(/^\s*革命\d+トリガー\s*[-ー―:]\s*クリーチャーが自分を攻撃する時/, '相手のクリーチャーが自分を攻撃する時')
    // 逆転撃{ll03}:クリーチャーが自分を攻撃する時、その攻撃中にまだ「逆転撃」を使っていなければ、〜
    .replace(/^\s*逆転撃\s*\{[a-z]*\d+\}\s*[:：]\s*クリーチャーが自分を攻撃する時、(その攻撃中にまだ「逆転撃」を使っていなければ、)?/, '相手のクリーチャーが自分を攻撃する時、')
    .replace(/\{([a-z]*)(\d+)\}/g, '[$1$2]')
    .replace(/^\s*(覚醒|龍解|龍回避|禁断解放|禁断機動)\s*[-ー―:]\s*/, '')
    // 条件の名前 (本文の条件をそのまま読む)
    .replace(/^\s*(龍?マナ武装|レインボーナス)\s*\d*\s*[:：]\s*/, '')
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

export type AbilityGroupKind = 'wave' | 'accel' | 'survivor' | 'soul' | 'meta' | 'turbo' | 'sforce' | 'odrive';

const GROUP_HEAD: [RegExp, AbilityGroupKind][] = [
  [/^ウェーブストライカー/, 'wave'],
  [/^アクセル/, 'accel'],
  [/^超魂X/, 'soul'],
  [/^メタモーフ/, 'meta'],
  [/^ターボラッシュ/, 'turbo'],
  [/^シールド・フォース/, 'sforce'],
];
/** 次の行を「このクリーチャーの能力」として使うキーワード */
const NEXT_ABILITY_HEAD = /^(マーシャル・タッチ|返霊\s*\d*)\s*[(（]/;
export const TAP_ABILITY = /^このクリーチャーで攻撃する(かわりに|代わりに)、タップして次の能力を使ってもよい/;
/** サイレントスキル: 自分のターンのはじめに、タップしていればアンタップするかわりに次の能力を使ってもよい */
const SILENT_SKILL = /^サイレントスキル/;

/**
 * カードのテキスト行を、常に有効な行・条件つき/共有の能力 (ウェーブストライカー・アクセル・超魂X・サバイバーのoS能力)・
 * タップ能力 (攻撃するかわりにタップして使う能力) に分ける
 */
export const MARKED_LINE = /^(q|oP|oB|xB)\s+(.+)$|^(◇)\s*(.+)$/;

export function splitAbilities(lines: string[]): {
  main: string[];
  groups: { kind: AbilityGroupKind; lines: string[] }[];
  tap: string | null;
  silent: string | null;
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
  let silent: string[] | null = null;
  let inSilent = false;
  let nextAbility = false;
  let odrive = 0; // 0: なし / 1: 次の行を取る / 2: 「水:」で始まる行を取る
  for (const raw of lines) {
    const t = normText(raw).trim();
    // O・ドライブ: 次の行と、「水:」「自然:」で始まる行が追加の支払いをした時の能力
    if (odrive) {
      if (odrive === 1 || /^(光|水|闇|火|自然)[:：]/.test(t)) {
        push('odrive', raw);
        odrive = 2;
        continue;
      }
      odrive = 0;
    }
    if (/^O・ドライブ/.test(t)) {
      main.push(raw);
      odrive = 1;
      if (!groups.has('odrive')) groups.set('odrive', []);
      continue;
    }
    if (nextAbility) {
      nextAbility = false;
      (marked['能力'] ??= []).push(t.replace(/。$/, ''));
      continue;
    }
    if (NEXT_ABILITY_HEAD.test(t)) {
      main.push(raw);
      nextAbility = true;
      continue;
    }
    if (inSilent) {
      if (!silent!.length) {
        silent!.push(t.replace(/。$/, ''));
        continue;
      }
      if (/^[▼▶►]/.test(t)) {
        silent!.push('▼' + t.replace(/^[▼▶►]/, ''));
        continue;
      }
      inSilent = false;
    }
    if (SILENT_SKILL.test(t)) {
      main.push(raw);
      silent = [];
      inSilent = true;
      continue;
    }
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
    // バズレンダの {OL} 能力
    if (/^\s*\{OL\}/.test(raw.normalize('NFKC'))) {
      (marked['OL'] ??= []).push(t.replace(/。$/, ''));
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
  return { main, groups: [...groups].map(([kind, ls]) => ({ kind, lines: ls })), tap: tap?.length ? tap.join('。').replace(/。▼/g, '▼') : null, silent: silent?.length ? silent.join('。').replace(/。▼/g, '▼') : null, marked };
}
