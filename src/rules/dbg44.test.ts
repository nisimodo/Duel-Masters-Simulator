import fs from 'node:fs';
import { it } from 'vitest';
import { parseStaticLine } from './statics';
import { parseEffect } from './parse';
it.skipIf(!process.env.DUMP44)('dbg44', () => {
  const cards = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cards)
    for (const f of c.f)
      for (const l of f.x) {
        if (seen.has(l)) continue;
        seen.add(l);
        const st = parseStaticLine(l);
        const ef = parseEffect(l.replace(/^.{1,90}?(時|はじめに|終わりに)、/, ''));
        out.push(`${l}\t${JSON.stringify(st)}\t${ef.complete ? JSON.stringify(ef.ops) : 'X'}`);
      }
  fs.writeFileSync(process.env.DUMP44!, out.join('\n'));
});
