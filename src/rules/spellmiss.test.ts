import fs from 'node:fs';
import { it } from 'vitest';
import { parseEffect } from './parse';
import { mergeModal } from './text';
import { spellEffectLines } from '../lib/triggers';
it.skipIf(!process.env.SPELLMISS)('spell misses', () => {
  const cards = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards;
  const first: Record<string, number> = {};
  let single = 0;
  for (const c of cards)
    for (const f of c.f) {
      if (!f.t.includes('呪文')) continue;
      const eff = spellEffectLines(mergeModal(f.x));
      if (!eff.length) continue;
      const p = parseEffect(eff.join('。'));
      if (p.complete) continue;
      if (p.unparsed.length === 1) single++;
      const k = (p.unparsed[0] ?? '(incomplete without unparsed)').replace(/\d+/g, 'N').replace(/《[^》]*》/g, '《X》');
      first[k] = (first[k] ?? 0) + 1;
    }
  const out = Object.entries(first).sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(process.env.SPELLMISS!, `single-miss spells: ${single}\n` + out.map(([k, v]) => `${v}\t${k}`).join('\n'));
});
