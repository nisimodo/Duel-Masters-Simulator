// たくさんのランダムデッキでCPU同士を対戦させて、内部エラーや進行不能がないか調べる
//   FUZZ=300 npx vitest run src/engine/fuzz.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    const replay = process.env.FUZZ_REPLAY ? JSON.parse(fs.readFileSync(process.env.FUZZ_REPLAY, 'utf8')) : null;
    const init = replay ?? { mode, seed: 7 + g * 13, createdAt: 0, players: Array.from({ length: n }, (_, i) => ({ uid: 'p' + i, name: 'P' + i, cpu: true, ...expandDeck(randomDeck(db, mode)) })) } as const;
    let s = createGame(init, L);
    let k = 0;
    for (; k < 6000 && s.phase !== 'over'; k++) {
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
          const errs = [...cpuPlan(s, p, L), ...fb].map((a) => `${a.t}: ${applyAction(s, p, a as never, L).error}`);
          if (process.env.FUZZ_REPLAY) console.log('PLAN', JSON.stringify(cpuPlan(s, p, L)), 'P', p, 'LOG', JSON.stringify(s.log.slice(-8).map((x) => x.m)), 'PEND', JSON.stringify(s.pending));
          console.log('STUCK', g, JSON.stringify(errs), JSON.stringify(s.attack), s.turnStep, s.phase, s.players[p].battle.map((b) => `${L(s.cards[b].cid)?.name}${s.cards[b].tapped ? '(T)' : ''}${s.cards[b].sick ? '(酔)' : ''}`));
          // 再現用にゲームの初期設定を残す (FUZZ_REPLAY=ファイル で同じゲームを再生できる)
          fs.writeFileSync(path.join(os.tmpdir(), `duema-fuzz-stuck-${g}.json`), JSON.stringify(init));
          stuck++;
          break;
        }
      }
    }
    if (s.phase !== 'over') {
      unfinished++;
      console.log('UNFINISHED', g, s.turn, JSON.stringify(s.log.slice(-16).map((x) => x.m)), JSON.stringify(s.pending.map((x) => x.kind)));
    }
  }
  console.error = origErr;
  console.log({ games: N, stuck, unfinished, errors });
  expect(stuck).toBe(0);
}, 600000);
