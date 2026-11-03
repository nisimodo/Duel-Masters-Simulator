// デッキコードのデッキを CPU 同士で対戦させる (テストプレイと同じ集計を文字で出す)。
// 環境変数 DECKS にコードを2〜4つ (空白区切り) 入れた時だけ動く:
//   DECKS="DM1… DM1…" GAMES=50 npx vitest run src/lib/deckCode.sim.test.ts
//   (MODE=modoki: デュエマ用のデッキをデュエパのルールで / デュエパのデッキは自動でデュエパ)
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { addGame, emptyStats, simulateGame } from '../engine/sim';
import { buildDB } from './cards';
import { expandDeck, validateDeck } from './deck';
import { deckFromCode } from './deckCode';
import { deckLetter, deckReport, pct } from './resultImage';

const codes = (process.env.DECKS ?? '').split(/[\s,]+/).filter(Boolean);

it.skipIf(codes.length < 2)('デッキコードのデッキで対戦する', async () => {
  const raw = JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8'));
  const db = buildDB(raw.cards, JSON.parse(fs.readFileSync('public/data/regulation.json', 'utf8')), JSON.parse(fs.readFileSync('public/data/presets.json', 'utf8')));
  const L = (cid: string) => db.byId.get(cid);
  const decks = await Promise.all(codes.map((c) => deckFromCode(c, db)));
  const out: string[] = [];
  decks.forEach(({ deck, notFound }, p) => {
    out.push(`デッキ${deckLetter(p)}: ${deck.name} (${deck.type})`);
    if (notFound.length) out.push(`  ⚠ カードDBにないカード: ${notFound.join('、')}`);
    for (const i of validateDeck(db, deck)) out.push(`  ⚠ ${i}`);
  });
  const duepa = decks.some((d) => d.deck.type === 'duepa') || process.env.MODE === 'modoki';
  expect(duepa || decks.length === 2, 'デュエマは2つのデッキで対戦します').toBe(true);
  const games = Number(process.env.GAMES ?? 20);
  const st = emptyStats(decks.length);
  const ex = decks.map((d) => expandDeck(d.deck));
  for (let i = 0; i < games; i++)
    addGame(
      st,
      simulateGame({ mode: duepa ? 'duepa' : 'duema', seed: (i + 1) * 7919, createdAt: 0, first: i % ex.length, players: ex.map((d, k) => ({ uid: `d${k}`, name: deckLetter(k), cpu: true, ...d })) }, L),
    );
  out.push('', `${st.games}試合 (${duepa ? 'デュエパのルール' : 'デュエマ'})${st.decided ? ` ・ 平均 ${Math.round((st.turnSum / st.decided) * 10) / 10} ターンで決着` : ''}${st.draws ? ` ・ 決着なし ${st.draws}` : ''}`);
  decks.forEach(({ deck }, p) => {
    const r = deckReport(db, st, p);
    out.push(
      '',
      `■ ${deckLetter(p)}: ${deck.name}  勝率 ${pct(st.wins[p], st.games)} (${st.wins[p]}勝 ${r.lost}敗)${r.avgPlace != null && decks.length > 2 ? ` 平均${r.avgPlace}位` : ''}`,
      `  勝因: ${r.wins.map(([k, n]) => `${k} ${n}`).join(' / ') || 'なし'}`,
      `  敗因: ${r.losses.map(([k, n]) => `${k} ${n}`).join(' / ') || 'なし'}`,
      `  よく使ったカード: ${r.usage.slice(0, 8).map((u) => `《${u.name}》${u.n}試合${pct(u.w, u.n)}`).join(' / ')}`,
    );
  });
  const issues = Object.values(st.issues).sort((a, b) => b.games - a.games);
  if (issues.length) out.push('', 'うまく処理できなかった効果:', ...issues.slice(0, 15).map((i) => `  [${i.kind}] ${i.cid ? `《${L(i.cid)?.name ?? i.cid}》 ` : ''}${i.text.slice(0, 120)} (${i.games}試合)`));
  const report = out.join('\n');
  // (vitest の画面に出ないこともあるので、ファイルにも書く)
  fs.writeFileSync(process.env.OUT ?? 'deck-sim-report.txt', report + '\n');
  process.stdout.write(`\n${report}\n`);
}, 600000);
