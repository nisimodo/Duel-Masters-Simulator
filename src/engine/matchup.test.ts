import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildDB, findByName } from '../lib/cards';
import { emptyDeck, expandDeck, validateDeck } from '../lib/deck';
import { effectHints } from './effects';

const KIYONAGA: [string, number][] = [
  ['五輪の求道者 清永', 4], ['キングダム・オウ禍武斗 / 轟破天九十九語', 2], ['ナ・チュラルゴ・デンジャー / ナチュラル・トラップ', 4],
  ['音卿の精霊龍 ラフルル・ラブ / 「未来から来る、だからミラクル」', 1], ['アカシック・ゼノン', 4], ['メヂカラ・コバルト・カイザー / アイド・ワイズ・シャッター', 3],
  ['同期の妖精 / ド浮きの動悸', 4], ['全虹帝 ミノガミ / ハザード・パクト', 4], ['天雷龍姫エリザベス / インビンシブル・フォートレス', 4],
  ['怪盗妖精カサブランカ / 「信じていたのに裏切られるなんて！」', 4], ['配球の超人 / 記録的剛球', 2], ['蒼狼の豊穣 ワクムテラス / オリジナル・ライフ', 4],
];
const GIANT: [string, number][] = [
  ['超重竜 ゴルファンタジスタ', 4], ['チアスカーレット アカネ', 2], ['五番龍 レイクポーチャー ParZero', 2], ['超球の超人 / 父なるタッチダウン', 1],
  ['完璧妖精マリニャンX', 2], ['終の怒流牙 ドルゲユキムラ', 1], ['銀河竜 ゴルファンタジスタ', 2], ['チアスペース アカネ', 4], ['同期の妖精 / ド浮きの動悸', 4],
  ['爆翠月 アカネ', 4], ['アシステスト・シネラリア', 4], ['キャディ・ビートル', 4], ['とこしえの超人', 4], ['ナイター・ファイアフライ', 2],
];

export function loadMatchup() {
  const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
  const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), []);
  const mk = (name: string, list: [string, number][]) => {
    const d = emptyDeck('duema');
    d.name = name;
    const missing: string[] = [];
    for (const [n, c] of list) {
      const card = findByName(db, n);
      if (!card) missing.push(n);
      else d.main[card.id] = (d.main[card.id] ?? 0) + c;
    }
    return { deck: d, missing };
  };
  return { db, kiyonaga: mk('清永', KIYONAGA), giant: mk('ジャイアント', GIANT) };
}

// DM26-SD1「ドキドキつよいデッキ 25の王道」の 清永デッキ と ジャイアントデッキ。
// 対戦シミュレーションは時間がかかるので SIM=1 の時だけ実行する:  SIM=1 N=400 npx vitest run src/engine/matchup.test.ts
it('decks resolve', () => {
  const { db, kiyonaga, giant } = loadMatchup();
  for (const x of [kiyonaga, giant]) {
    expect(x.missing).toEqual([]);
    expect(validateDeck(db, x.deck)).toEqual([]);
    if (!process.env.SIM) continue;
    console.log(x.deck.name, 'missing:', x.missing, 'issues:', validateDeck(db, x.deck), 'size', expandDeck(x.deck).main.length);
    for (const id of Object.keys(x.deck.main)) {
      if (!process.env.SIM) break;
      const c = db.byId.get(id)!;
      const kws = c.faces.map((f, fi) => `${f.name}[${f.cost}] trig:${f.triggers.map((t) => t.events.join('+')).join(',') || '-'} hints:${effectHints(c, fi).map((h) => h.kind).join(',') || '-'} kw:${[f.kw.shieldTrigger && 'ST', f.kw.blocker && 'BL', f.kw.machFighter && 'MF', f.kw.speedAttacker && 'SA', f.kw.breaker > 1 && `B${f.kw.breaker}`].filter(Boolean).join(',')}`);
      console.log('  ', kws.join(' || '));
    }
  }
});

import { cpuPlan } from './cpu';
import { applyAction, createGame, decider } from './engine';
import type { GameState } from './types';

it.skipIf(!process.env.SIM)('simulate 清永 vs ジャイアント', () => {
  const { db, kiyonaga, giant } = loadMatchup();
  const L = (c: string) => db.byId.get(c);
  const decks = [kiyonaga.deck, giant.deck];
  const N = Number(process.env.N ?? 100);
  const stats = {
    wins: [0, 0],
    winsFirst: [0, 0],
    firstCount: [0, 0],
    turns: [] as number[],
    reasons: {} as Record<string, number>,
    abilities: [0, 0],
    triggers: [0, 0],
    revChange: [0, 0],
    unfinished: 0,
  };
  let sample: string[] = [];
  for (let g = 0; g < N; g++) {
    let s: GameState = createGame(
      { mode: 'duema', seed: 1000 + g * 17, createdAt: 0, players: decks.map((d, i) => ({ uid: 'p' + i, name: d.name, cpu: true, ...expandDeck(d) })) },
      L,
    );
    // 先攻を交互に (席は固定、seedで決まる先攻を数える)
    for (let k = 0; k < 4000 && s.phase !== 'over'; k++) {
      const p = decider(s)!;
      let moved = false;
      for (const a of cpuPlan(s, p, L)) {
        const r = applyAction(s, p, a, L);
        if (!r.error) {
          s = r.state;
          moved = true;
        }
      }
      if (!moved) {
        for (const a of [{ t: 'resolve', use: false }, { t: 'endTurn' }] as const) {
          const r = applyAction(s, p, a, L);
          if (!r.error) {
            s = r.state;
            break;
          }
        }
      }
    }
    if (s.phase !== 'over') {
      stats.unfinished++;
      continue;
    }
    const w = s.winners[0];
    stats.wins[w]++;
    stats.firstCount[s.firstPlayer]++;
    if (w === s.firstPlayer) stats.winsFirst[w]++;
    stats.turns.push(s.turn);
    stats.reasons[s.endReason] = (stats.reasons[s.endReason] ?? 0) + 1;
    for (const l of s.log) {
      if (l.p == null) continue;
      if (l.m.startsWith('⚡')) stats.abilities[l.p]++;
      if (l.m.startsWith('S・トリガー発動')) stats.triggers[l.p]++;
      if (l.m.startsWith('革命チェンジ')) stats.revChange[l.p]++;
    }
    if (g === 0) sample = s.log.map((l) => l.m);
  }
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const out = {
    games: N,
    [decks[0].name]: { wins: stats.wins[0], asFirst: `${stats.winsFirst[0]}/${stats.firstCount[0]}`, abilities: stats.abilities[0], sTriggers: stats.triggers[0], revChange: stats.revChange[0] },
    [decks[1].name]: { wins: stats.wins[1], asFirst: `${stats.winsFirst[1]}/${stats.firstCount[1]}`, abilities: stats.abilities[1], sTriggers: stats.triggers[1], revChange: stats.revChange[1] },
    avgTurns: avg(stats.turns),
    minTurns: Math.min(...stats.turns),
    maxTurns: Math.max(...stats.turns),
    reasons: stats.reasons,
    unfinished: stats.unfinished,
  };
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(process.env.SAMPLE_LOG ?? 'sample-game.log', sample.join('\n'));
}, 600000);
