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

  it('対戦中の退出・CPUへの切り替え・復帰 (ログに出し、ゲームは同じ状態のまま)', () => {
    const d = expandDeck(randomDeck(db, 'duema'));
    let s = createGame({ mode: 'duema', seed: 3, createdAt: 0, first: 0, players: [{ uid: 'a', name: 'A', cpu: false, ...d }, { uid: 'b', name: 'B', cpu: false, ...d }] }, L);
    const step = (p: number, a: Parameters<typeof applyAction>[2]) => {
      const r = applyAction(s, p, a, L);
      if (!r.error) s = r.state;
      return r.error;
    };
    // 退出していないのにCPUへ切り替え・復帰はできない
    expect(step(1, { t: 'presence', state: 'cpu' })).toBeTruthy();
    expect(step(1, { t: 'presence', state: 'back' })).toBeTruthy();
    // 相手のターン中でも、誰が送っても受け付ける
    expect(step(1, { t: 'presence', state: 'left', at: 1000 })).toBeNull();
    expect(s.players[1].away).toBe('left');
    expect(s.players[1].awaySince).toBe(1000);
    expect(s.log.at(-1)?.m).toMatch(/B が退出しました/);
    expect(step(1, { t: 'presence', state: 'left' })).toBeTruthy();
    expect(step(1, { t: 'presence', state: 'cpu' })).toBeNull();
    expect(s.players[1].away).toBe('cpu');
    expect(s.log.at(-1)?.m).toMatch(/CPUが代わりに操作/);
    // CPUが代わりに動かせる
    expect(cpuPlan(s, decider(s) ?? 0, L).length).toBeGreaterThan(0);
    expect(step(1, { t: 'presence', state: 'back' })).toBeNull();
    expect(s.players[1].away).toBeUndefined();
    expect(s.log.at(-1)?.m).toMatch(/B が戻りました。CPUから操作を戻します/);
  });
});

