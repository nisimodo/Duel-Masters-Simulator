import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildDB, findByName } from './cards';
import { deckThumb, presetToDeck, validateDeck } from './deck';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
const reg = JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8'));
const presets = JSON.parse(fs.readFileSync('public/data/presets.json', 'utf8'));
const db = buildDB(raw.cards, reg, presets);

it('all hall-of-fame names resolve to cards', () => {
  const missing = [...reg.premium, ...reg.hof, ...reg.premiumCombos.flat()].filter((n: string) => !findByName(db, n));
  expect(missing).toEqual([]);
});

it('presets resolve and are legal', () => {
  for (const p of db.presets) {
    const { deck, notFound } = presetToDeck(db, p.id);
    expect(notFound, p.name).toEqual([]);
    expect(validateDeck(db, deck), p.name).toEqual([]);
    // サムネイルに指定したカードがデッキに入っていて、サムネイルになる
    if (p.thumb) expect(db.byId.get(deckThumb(deck) ?? '')?.name, p.name).toBe(findByName(db, p.thumb)?.name);
  }
});

it('copy-limit and deck-size exceptions from card text', () => {
  const pon = findByName(db, 'はずれポンの助')!;
  const one = findByName(db, '黒ひげ危機一発')!;
  const plan = findByName(db, '13番目の計画')!;
  const grDog = findByName(db, 'ＧＲの犬 ワンワンワン')!;
  expect(pon.faces[0].kw.maxCopies).toBe(999);
  expect(one.faces[0].kw.maxCopies).toBe(1);
  expect(plan.faces[0].kw.deckSizeBonus).toBe(5);
  expect(grDog.faces[0].kw.maxCopies).toBe(999);

  const base = presetToDeck(db, db.presets[0].id).deck;
  // はずれポンの助 10枚 + 他30枚 = 40枚 → 枚数制限の違反なし
  const d1 = structuredClone(base);
  d1.main = Object.fromEntries(Object.entries(d1.main).slice(0, 0));
  d1.main[pon.id] = 40;
  expect(validateDeck(db, d1)).toEqual([]);
  // 13番目の計画を1枚入れると45枚が必要
  const d2 = structuredClone(base);
  d2.main[plan.id] = 1;
  expect(validateDeck(db, d2).join()).toContain('45枚');
  // GRの犬は2枚より多く超GRに入れられる
  const d3 = structuredClone(base);
  d3.gr = { [grDog.id]: 12 };
  expect(validateDeck(db, d3)).toEqual([]);
});
