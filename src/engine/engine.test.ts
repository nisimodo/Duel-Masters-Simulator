import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDB, type CardDB } from '../lib/cards';
import { expandDeck, randomDeck, validateDeck, presetToDeck } from '../lib/deck';
import { cpuPlan } from './cpu';
import { applyAction, createGame, decider } from './engine';
import type { GameInit, GameState } from './types';

function loadDB(): CardDB {
  const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
  const reg = JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8'));
  const presets = JSON.parse(fs.readFileSync('public/data/presets.json', 'utf8'));
  return buildDB(raw.cards, reg, presets);
}

const db = loadDB();
const L = (cid: string) => db.byId.get(cid);

function runGame(init: GameInit, maxSteps = 3000): GameState {
  let s = createGame(init, L);
  let steps = 0;
  while (s.phase !== 'over' && steps < maxSteps) {
    const p = decider(s)!;
    const plan = cpuPlan(s, p, L);
    if (!plan.length) throw new Error('CPU stuck');
    let progressed = false;
    for (const a of plan) {
      const r = applyAction(s, p, a, L);
      if (!r.error) {
        s = r.state;
        progressed = true;
      }
    }
    if (!progressed) {
      const r = applyAction(s, p, { t: 'endTurn' }, L);
      if (r.error) throw new Error(`stuck: ${r.error} ${JSON.stringify(s.pending)}`);
      s = r.state;
    }
    steps++;
  }
  return s;
}

describe('engine', () => {
  it('random duema decks are valid', () => {
    for (let i = 0; i < 5; i++) {
      const d = randomDeck(db, 'duema');
      expect(validateDeck(db, d)).toEqual([]);
    }
  });

  it('random duepa decks are valid', () => {
    for (let i = 0; i < 3; i++) {
      const d = randomDeck(db, 'duepa');
      const issues = validateDeck(db, d);
      // カードプールが少ない場合は60枚に届かないことがある
      expect(issues.filter((x) => !x.includes('60枚'))).toEqual([]);
    }
  });

  it('presets resolve', () => {
    for (const p of db.presets) {
      const { notFound } = presetToDeck(db, p.id);
      if (db.cards.length > 10000) expect(notFound).toEqual([]);
    }
  });

  it('CPU vs CPU duema games finish', () => {
    let finished = 0;
    for (let g = 0; g < 30; g++) {
      const a = expandDeck(randomDeck(db, 'duema'));
      const b = expandDeck(randomDeck(db, 'duema'));
      const s = runGame({
        mode: 'duema',
        seed: g * 7919 + 1,
        createdAt: 0,
        players: [
          { uid: 'a', name: 'A', cpu: true, ...a },
          { uid: 'b', name: 'B', cpu: true, ...b },
        ],
      });
      if (s.phase === 'over') finished++;
      // カードの整合性: 全カードがちょうど1つの場所にある
      const seen = new Map<number, number>();
      s.players.forEach((pl) => {
        for (const z of ['deck', 'hand', 'mana', 'battle', 'shield', 'grave', 'hyper', 'gr', 'partner'] as const)
          for (const i of pl[z]) {
            seen.set(i, (seen.get(i) ?? 0) + 1);
            expect(s.cards[i].zone).toBe(z);
          }
      });
      for (const c of s.cards) {
        if (c.zone === 'under') expect(s.cards[c.parent!].under).toContain(c.iid);
        else if (c.zone !== 'gone') expect(seen.get(c.iid)).toBe(1);
      }
    }
    expect(finished).toBeGreaterThan(20);
  });

  it('CPU vs CPU duepa 4 players finish', () => {
    for (let g = 0; g < 5; g++) {
      const players = [0, 1, 2, 3].map((i) => {
        const d = randomDeck(db, 'duepa');
        return { uid: 'p' + i, name: 'P' + i, cpu: true, ...expandDeck(d) };
      });
      const s = runGame({ mode: 'duepa', seed: g + 99, createdAt: 0, players }, 6000);
      expect(s.phase).toBe('over');
      expect(s.winners.length).toBe(1);
    }
  });
});
