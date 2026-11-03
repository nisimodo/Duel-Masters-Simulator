import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildDB } from './cards';
import { presetToDeck } from './deck';
import { DECK_CODE_PREFIX, DeckCodeError, deckFromCode, deckToCode } from './deckCode';

const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), JSON.parse(fs.readFileSync('public/data/presets.json', 'utf8')));

describe('デッキコード', () => {
  it('すべてのプリセットをコードにして、同じデッキに戻せる', async () => {
    for (const p of db.presets) {
      const { deck } = presetToDeck(db, p.id);
      deck.thumb = Object.keys(deck.main)[0] ?? null;
      const code = await deckToCode(deck);
      expect(code.startsWith(DECK_CODE_PREFIX)).toBe(true);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await deckFromCode(code, db);
      expect(back.notFound).toEqual([]);
      expect(back.deck).toMatchObject({ type: deck.type, name: deck.name, main: deck.main, hyper: deck.hyper, gr: deck.gr, partner: deck.partner, thumb: deck.thumb });
    }
  });

  it('Node の zlib でも読める (scripts/deck-code.mjs と同じ方法)', async () => {
    const { deck } = presetToDeck(db, db.presets[0].id);
    const code = await deckToCode(deck);
    const json = JSON.parse(zlib.inflateRawSync(Buffer.from(code.slice(3), 'base64url')).toString('utf8'));
    expect(json.t).toBe(deck.type);
    expect(Object.fromEntries(json.m)).toEqual(deck.main);
  });

  it('前後の空白・改行は無視し、カードDBにないカードは notFound に出す', async () => {
    const { deck } = presetToDeck(db, db.presets[0].id);
    deck.main['no-such-card'] = 2;
    const code = await deckToCode(deck);
    const back = await deckFromCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `, db);
    expect(back.notFound).toEqual(['no-such-card']);
    expect(back.deck.main['no-such-card']).toBeUndefined();
  });

  it('壊れたコードはエラーにする', async () => {
    await expect(deckFromCode('hello')).rejects.toBeInstanceOf(DeckCodeError);
    await expect(deckFromCode('DM1@@@@')).rejects.toBeInstanceOf(DeckCodeError);
    const code = await deckToCode(presetToDeck(db, db.presets[0].id).deck);
    await expect(deckFromCode(code.slice(0, code.length - 8))).rejects.toBeInstanceOf(DeckCodeError);
  });
});
