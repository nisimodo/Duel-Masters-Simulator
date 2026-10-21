// たくさんのランダムデッキでCPU同士を対戦させて、内部エラーや進行不能がないか調べる
//   FUZZ=300 npx vitest run src/engine/fuzz.test.ts
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { expandDeck, randomDeck } from '../lib/deck';
import { cpuPlan } from './cpu';
import { applyAction, createGame, decider } from './engine';

it.skipIf(!process.env.FUZZ)('fuzz', () => {
  const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
  const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), []);
  const L = (c: string) => db.byId.get(c);
  const N = Number(process.env.FUZZ);
  const errors: Record<string, number> = {};
  let stuck = 0;
  let unfinished = 0;
  const origErr = console.error;
  console.error = () => {};
  for (let g = 0; g < N; g++) {
    const mode = g % 5 === 0 ? 'duepa' : 'duema';
    const n = mode === 'duepa' ? 3 : 2;
    let s = createGame({ mode, seed: 7 + g * 13, createdAt: 0, players: Array.from({ length: n }, (_, i) => ({ uid: 'p' + i, name: 'P' + i, cpu: true, ...expandDeck(randomDeck(db, mode)) })) }, L);
    let k = 0;
    for (; k < 3000 && s.phase !== 'over'; k++) {
      const p = decider(s)!;
      let moved = false;
      for (const a of cpuPlan(s, p, L)) {
        const r = applyAction(s, p, a, L);
        if (r.error?.startsWith('内部エラー')) errors[r.error] = (errors[r.error] ?? 0) + 1;
        if (!r.error) {
          s = r.state;
          moved = true;
        }
      }
      if (!moved) {
        const fb = [{ t: 'resolve', use: false }, { t: 'choose', picks: [], yes: false, options: [0] }, { t: 'endTurn' }] as const;
        let ok = false;
        for (const a of fb) {
          const r = applyAction(s, p, a, L);
          if (!r.error) {
            s = r.state;
            ok = true;
            break;
          }
        }
        if (!ok) {
          stuck++;
          break;
        }
      }
    }
    if (s.phase !== 'over') unfinished++;
  }
  console.error = origErr;
  console.log({ games: N, stuck, unfinished, errors });
  expect(stuck).toBe(0);
}, 600000);
