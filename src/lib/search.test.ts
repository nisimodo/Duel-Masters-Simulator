import { describe, expect, it } from 'vitest';
import { buildDB } from './cards';
import { emptyQuery, searchCards } from './search';

const card = (id: string, n: string, y?: string[]) => ({
  id,
  n,
  img: '',
  f: [{ n, t: 'クリーチャー', c: 'F', co: 3, p: '3000', r: [], x: [] }],
  ...(y ? { y } : {}),
});

const db = buildDB(
  [
    card('a', 'ボルシャック・栄光・ルピア', ['ボルシャック・えいこう・ルピア']),
    card('b', '∑龍', ['ウィンロン']),
    card('c', 'アクア・ソルジャー'),
    card('d', '竹馬の超人 / テイクバック・チャージャー', ['たけうまのちょうじん']),
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const names = (name: string) => searchCards(db, { ...emptyQuery, name }).map((c) => c.id);

describe('name search', () => {
  it('matches the reading in hiragana without separators', () => {
    expect(names('ぼるしゃっくえいこうるぴあ')).toEqual(['a']);
    expect(names('えいこう')).toEqual(['a']);
  });
  it('matches the name while ignoring 「・」', () => {
    expect(names('ボルシャック栄光ルピア')).toEqual(['a']);
    expect(names('アクアソルジャー')).toEqual(['c']);
    expect(names('あくあそるじゃー')).toEqual(['c']);
  });
  it('matches symbol names by reading and by either sigma character', () => {
    expect(names('うぃんろん')).toEqual(['b']);
    expect(names('ウィンロン')).toEqual(['b']);
    expect(names('Σ龍')).toEqual(['b']);
  });
  it('matches twinpact faces and their readings', () => {
    expect(names('たけうま')).toEqual(['d']);
    expect(names('テイクバックチャージャー')).toEqual(['d']);
  });
});
