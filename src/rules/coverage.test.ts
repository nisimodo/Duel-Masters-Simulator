// 全カードの能力がどれだけ自動処理できるかを計測する。
//   COVER=1 npx vitest run src/rules/coverage.test.ts
import fs from 'node:fs';
import { it } from 'vitest';
import { parseEffect } from './parse';
import { normText, stripReminder } from './text';
import { parseTriggers, spellEffectLines } from '../lib/triggers';

interface RawCard {
  n: string;
  f: { n: string; t: string; x: string[] }[];
}

export function coverage() {
  const cards: RawCard[] = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards;
  const stat = { trigTotal: 0, trigAuto: 0, spellTotal: 0, spellAuto: 0, otherLines: 0 };
  const miss: Record<string, number> = {};
  const noteMiss = (s: string) => {
    const k = s.replace(/\d+/g, 'N').replace(/《[^》]*》/g, '《X》');
    miss[k] = (miss[k] ?? 0) + 1;
  };
  for (const c of cards)
    for (const f of c.f) {
      const lines = mergeModal(f.x);
      if (f.t.includes('呪文')) {
        const eff = spellEffectLines(lines);
        if (eff.length) {
          stat.spellTotal++;
          const p = parseEffect(eff.join('。'));
          if (p.complete) stat.spellAuto++;
          else p.unparsed.forEach(noteMiss);
        }
      }
      const trigs = parseTriggers(lines);
      for (const t of trigs) {
        stat.trigTotal++;
        const p = parseEffect(t.effect);
        if (p.complete) stat.trigAuto++;
        else p.unparsed.forEach(noteMiss);
      }
      if (!f.t.includes('呪文')) stat.otherLines += lines.length - trigs.length;
    }
  return { stat, miss: Object.entries(miss).sort((a, b) => b[1] - a[1]) };
}

/** ▼で始まる選択肢の行を前の行に連結 */
export function mergeModal(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const t = normText(l);
    if (/^[▼▶►・]/.test(t) && out.length && /次のうちいずれか|選ぶ/.test(stripReminder(out[out.length - 1]))) out[out.length - 1] += '▼' + t.replace(/^[▼▶►・]/, '');
    else out.push(l);
  }
  return out;
}

it.skipIf(!process.env.COVER)('coverage', () => {
  const { stat, miss } = coverage();
  const pct = (a: number, b: number) => ((a / b) * 100).toFixed(1) + '%';
  console.log(
    `triggered: ${stat.trigAuto}/${stat.trigTotal} (${pct(stat.trigAuto, stat.trigTotal)})  spells: ${stat.spellAuto}/${stat.spellTotal} (${pct(stat.spellAuto, stat.spellTotal)})`,
  );
  fs.writeFileSync(process.env.MISS_OUT ?? 'coverage-miss.log', miss.map(([k, v]) => `${v}\t${k}`).join('\n'));
});
