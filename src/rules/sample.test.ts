import fs from 'node:fs';
import { it } from 'vitest';
import { parseEffect } from './parse';
import type { Op, Target } from './ops';
import { parseTriggers } from '../lib/triggers';
import { mergeModal } from './coverage.test';

const tgt = (t: Target): string =>
  t.ref === 'sel'
    ? `[${t.sel.owner}:${t.sel.zones.join('/')}:${t.sel.kind}${t.sel.civs ? ':' + t.sel.civs.join('') : ''}${t.sel.races ? ':' + t.sel.races.join('/') : ''}${t.sel.costMax != null ? ':c<=' + t.sel.costMax : ''}${t.sel.costMin != null ? ':c>=' + t.sel.costMin : ''}${t.sel.powerMax != null ? ':p<=' + t.sel.powerMax : ''}${t.sel.tapped != null ? ':tap=' + t.sel.tapped : ''}${t.sel.other ? ':other' : ''} ${'all' in t.count ? 'ALL' : t.count.n + (t.count.upTo ? 'まで' : '')} by ${t.chooser}]`
    : t.ref;
export const show = (ops: Op[]): string =>
  ops
    .map((o) => {
      switch (o.op) {
        case 'choose': return `choose${tgt(o.target)}`;
        case 'move': return `move(${tgt(o.target)}→${o.to})`;
        case 'destroy': case 'tap': case 'untap': case 'flip': return `${o.op}(${tgt(o.target)})`;
        case 'optional': return `opt{${show(o.body)}}`;
        case 'if': return `if(${JSON.stringify(o.cond).slice(0, 60)}){${show(o.body)}}${o.else ? `else{${show(o.else)}}` : ''}`;
        case 'modal': return `modal${o.pick}{${o.options.map((x) => show(x.body)).join(' | ')}}`;
        case 'play': return `play-${o.mode}(${tgt(o.target)})`;
        case 'power': return `power(${tgt(o.target)},${o.delta})`;
        case 'grant': return `grant(${tgt(o.target)},${o.kws.join('+')},${o.until})`;
        case 'top': return `top${o.n}→${o.to}(${o.who})`;
        case 'draw': return `draw${o.n}(${o.who})`;
        case 'discard': return `discard(${o.who},${'all' in o.count ? 'ALL' : o.count.n},${o.how})`;
        case 'afterAttack': return `after{${show(o.body)}}`;
        default: return o.op + ('n' in o ? (o as { n: number }).n : '');
      }
    })
    .join(' ; ');

it.skipIf(!process.env.SAMPLE)('sample', () => {
  const cards = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')).cards as { f: { n: string; t: string; x: string[] }[] }[];
  const out: string[] = [];
  let seed = Number(process.env.SAMPLE) || 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const all: { name: string; text: string; ops: Op[] }[] = [];
  for (const c of cards) for (const f of c.f) for (const t of parseTriggers(mergeModal(f.x))) {
    const p = parseEffect(t.effect);
    if (p.complete) all.push({ name: f.n, text: t.text, ops: p.ops });
  }
  for (let i = 0; i < 40; i++) {
    const a = all[Math.floor(rnd() * all.length)];
    out.push(`■${a.name}\n  ${a.text}\n  => ${show(a.ops)}`);
  }
  fs.writeFileSync(process.env.OUT ?? 'sample.log', out.join('\n'));
});
