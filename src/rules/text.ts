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
