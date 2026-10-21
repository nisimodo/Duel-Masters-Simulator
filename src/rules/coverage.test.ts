// 全カードの能力がどれだけ自動処理できるかを計測する。
//   COVER=1 npx vitest run src/rules/coverage.test.ts
import fs from 'node:fs';
import { it } from 'vitest';
import { parseEffect } from './parse';
import { mergeModal, normText, splitAbilities, stripReminder } from './text';
import { parseTriggers, spellEffectLines } from '../lib/triggers';
import { parseStaticLine } from './statics';
import { collectKwDefs, expandKwLines } from './kwdefs';

interface RawCard {
  n: string;
  f: { n: string; t: string; x: string[] }[];
}

export function coverage() {
  const cards: RawCard[] = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards;
  const defs = collectKwDefs(cards.flatMap((c) => c.f.flatMap((f) => f.x)));
  const stat = { trigTotal: 0, trigAuto: 0, spellTotal: 0, spellAuto: 0, otherLines: 0, kwLines: 0, staticOk: 0 };
  const smiss: Record<string, number> = {};
  const miss: Record<string, number> = {};
  const noteMiss = (s: string) => {
    const k = s.replace(/\d+/g, 'N').replace(/《[^》]*》/g, '《X》');
    miss[k] = (miss[k] ?? 0) + 1;
  };
  for (const c of cards)
    for (const f of c.f) {
      const sp = splitAbilities(mergeModal(f.x));
      const lines = [...sp.main, ...sp.groups.flatMap((g) => g.lines)];
      const abilityLines = expandKwLines(lines, defs);
      // タップ能力 (攻撃するかわりにタップして使う)・記号つきの能力は効果として数える
      for (const eff of [sp.tap, sp.silent, ...Object.values(sp.marked).map((x) => x.join('。'))]) {
        if (!eff) continue;
        stat.trigTotal++;
        const p = parseEffect(eff);
        if (p.complete) stat.trigAuto++;
        else p.unparsed.forEach(noteMiss);
      }
      if (f.t.includes('呪文')) {
        const eff = spellEffectLines(lines);
        if (eff.length) {
          stat.spellTotal++;
          const p = parseEffect(eff.join('。'));
          if (p.complete) stat.spellAuto++;
          else p.unparsed.forEach(noteMiss);
        }
      }
      const trigs = parseTriggers(abilityLines);
      for (const t of trigs) {
        stat.trigTotal++;
        const p = parseEffect(t.effect);
        if (p.complete) stat.trigAuto++;
        else p.unparsed.forEach(noteMiss);
      }
      if (!f.t.includes('呪文')) {
        const trigText = new Set(trigs.map((x) => x.text));
        for (const l of lines) {
          if (trigText.has(l)) continue;
          const t = stripReminder(normText(l)).replace(/\s+/g, '').replace(/。$/, '');
          if (!t) continue;
          stat.otherLines++;
          if (KW_LINE.test(t)) stat.kwLines++;
          else if (parseStaticLine(l) || expandKwLines([l], defs).slice(1).some((x) => parseStaticLine(x) || parseTriggers([x]).some((tr) => parseEffect(tr.effect).complete))) stat.staticOk++;
          else {
            const k = t.replace(/\d+/g, 'N').replace(/《[^》]*》/g, '《X》');
            smiss[k] = (smiss[k] ?? 0) + 1;
          }
        }
      }
    }
  return { stat, miss: Object.entries(miss).sort((a, b) => b[1] - a[1]), smiss: Object.entries(smiss).sort((a, b) => b[1] - a[1]) };
}

/** エンジンがキーワードとして処理する行 */
const KW_LINE = /^(W・ブレイカー|T・ブレイカー|Q・ブレイカー|ワールド・ブレイカー|ブロッカー|S・トリガー|スーパー・S・トリガー|スピードアタッカー|マッハファイター|G・ストライク|スレイヤー|パワーアタッカー\+?N?|EXライフ|ジャストダイバー|チャージャー|革命チェンジ|S級侵略|侵略|ニンジャ・ストライク|(NEO|G-NEO|スター|究極|墓地|S-MAX)?進化[-ー―:－]|進化$|このクリーチャーは、?(相手プレイヤーを)?攻撃(することが)?できない|このクリーチャーはブロックされない|ウェーブストライカー|アクセル|超魂X|サバイバー|Zラッシュ|シンカライズ|ムゲンクライム\d+|クロスギア|解除$|(左|右|中央)?G・リンク|ギャラクシールド|フシギバース|バズレンダ\[[a-z]*\d+\]|ビビッドロー\[[a-z]*\d+\]|ソウルシフト|ウラ・ニンジャ・ストライク\d+|∞ブレイカー|エターナル・Κ|水晶ソウル\d+|水晶チャージャー|メタモーフ|ターボラッシュ|シールド・フォース|パワード・ブロッカー\+?\d+|サイレントスキル|リンク解除|※覚醒リンクするために必要なカード|このクリーチャーは、ブロックされない|(このカード|《[^》]+》)は、?\d+枚より多くデッキに入れることができる|アビスラッシュ|アタック・チャンス|スペース・チャージ|キズナプラス|このクリーチャーで攻撃する(かわりに|代わりに)、タップして次の能力を使ってもよい)/;

export { mergeModal };

it.skipIf(!process.env.COVER)('coverage', () => {
  const { stat, miss, smiss } = coverage();
  const pct = (a: number, b: number) => ((a / b) * 100).toFixed(1) + '%';
  console.log(
    `triggered: ${stat.trigAuto}/${stat.trigTotal} (${pct(stat.trigAuto, stat.trigTotal)})  spells: ${stat.spellAuto}/${stat.spellTotal} (${pct(stat.spellAuto, stat.spellTotal)})  static/keyword lines: ${stat.kwLines + stat.staticOk}/${stat.otherLines} (${pct(stat.kwLines + stat.staticOk, stat.otherLines)}; keyword ${stat.kwLines}, static ${stat.staticOk})`,
  );
  fs.writeFileSync(process.env.MISS_OUT ?? 'coverage-miss.log', miss.map(([k, v]) => `${v}\t${k}`).join('\n'));
  fs.writeFileSync((process.env.MISS_OUT ?? 'coverage-miss.log') + '.static', smiss.map(([k, v]) => `${v}\t${k}`).join('\n'));
});
