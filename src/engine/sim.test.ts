import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { expandDeck, presetToDeck } from '../lib/deck';
import { addGame, emptyStats, simulateGame } from './sim';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
const reg = JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8'));
const presets = JSON.parse(fs.readFileSync('public/data/presets.json', 'utf8'));
const db = buildDB(raw.cards, reg, presets);
const L = (c: string) => db.byId.get(c);

it('テストプレイ: プリセット同士をCPUで最後まで対戦させて集計する', () => {
  const a = presetToDeck(db, db.presets[0].id).deck;
  const b = presetToDeck(db, db.presets[1].id).deck;
  const st = emptyStats();
  for (let i = 0; i < 4; i++) {
    const g = simulateGame(
      {
        mode: 'duema',
        seed: 11 + i * 7,
        createdAt: 0,
        players: [
          { uid: 'a', name: 'A', cpu: true, ...expandDeck(a) },
          { uid: 'b', name: 'B', cpu: true, ...expandDeck(b) },
        ],
      },
      L,
    );
    expect(g.turns).toBeGreaterThan(0);
    expect(g.played[0].length + g.played[1].length).toBeGreaterThan(0);
    addGame(st, g);
  }
  expect(st.games).toBe(4);
  expect(st.wins[0] + st.wins[1] + st.draws).toBe(4);
  expect(Object.values(st.reasons).reduce((x, r) => x + r[0] + r[1] + r[2], 0)).toBe(4);
}, 60000);
