// カードデータ取得の進み具合をリアルタイム表示する (Ctrl+C で終了)
//   node scripts/progress.mjs
import fs from 'node:fs';

const IDS = 'data/raw/official-ids.json';
const DETAIL = 'data/raw/official-cards.jsonl';
const total = fs.existsSync(IDS) ? JSON.parse(fs.readFileSync(IDS, 'utf8')).length : 0;
const count = () => (fs.existsSync(DETAIL) ? fs.readFileSync(DETAIL, 'utf8').split('\n').filter((l) => l.trim()).length : 0);

const history = [];
function tick() {
  const n = count();
  const now = Date.now();
  history.push([now, n]);
  while (history.length > 1 && now - history[0][0] > 120000) history.shift(); // 直近2分で速度を計算
  const [t0, n0] = history[0];
  const perMin = now > t0 ? ((n - n0) / (now - t0)) * 60000 : 0;
  const pct = total ? (n / total) * 100 : 0;
  const width = 30;
  const bar = '█'.repeat(Math.round((pct / 100) * width)).padEnd(width, '░');
  const remain = Math.max(0, total - n);
  const eta = perMin > 0 ? `残り約${Math.ceil(remain / perMin)}分` : '計測中…';
  const done = total && n >= total ? ' ✅ 完了!' : '';
  process.stdout.write(`\r${bar} ${pct.toFixed(1)}%  ${n.toLocaleString()} / ${total.toLocaleString()}枚  ${perMin.toFixed(0)}枚/分  ${eta}${done}      `);
}
tick();
setInterval(tick, 3000);
