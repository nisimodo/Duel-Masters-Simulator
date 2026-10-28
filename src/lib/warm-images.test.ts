// 毎週読み込み直す画像のURL (scripts/warm-images.mjs) が、画面に出す縮めた画像のURLと同じか
import fs from 'node:fs';
import { expect, it } from 'vitest';
// @ts-expect-error (型のない .mjs)
import { urlsFor } from '../../scripts/warm-images.mjs';
import { buildDB, cardImageSmall } from './cards';

it('warm-images と画面の縮めた画像のURLが同じ', () => {
  const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
  const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), []);
  let checked = 0;
  for (const rc of raw.cards) {
    const card = db.byId.get(rc.id);
    if (!card) continue;
    const shown = new Set(card.faces.map((_, fi) => cardImageSmall(card, fi)));
    expect(new Set(urlsFor(rc) as string[])).toEqual(shown);
    checked++;
  }
  expect(checked).toBeGreaterThan(1000);
});
