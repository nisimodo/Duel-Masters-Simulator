import fs from 'node:fs';
import { it } from 'vitest';
import { normText, stripReminder } from './text';
import { parseTriggers } from '../lib/triggers';
import { mergeModal } from './coverage.test';
it.skipIf(!process.env.SFREQ)('static freq', () => {
  const cards = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards as { f: { t: string; x: string[] }[] }[];
  const freq: Record<string, number> = {};
  let total = 0;
  for (const c of cards) for (const f of c.f) {
    if (f.t.includes('呪文')) continue;
    const lines = mergeModal(f.x);
    const trig = new Set(parseTriggers(lines).map((t) => t.text));
    for (const l of lines) {
      if (trig.has(l)) continue;
      let t = stripReminder(normText(l)).replace(/\s+/g, '');
      if (!t) continue;
      total++;
      t = t.replace(/\d+/g, 'N').replace(/《[^》]*》/g, '《X》');
      freq[t] = (freq[t] ?? 0) + 1;
    }
  }
  const arr = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(process.env.OUT ?? 'static.log', `total ${total}\n` + arr.map(([k, v]) => `${v}\t${k}`).join('\n'));
});
