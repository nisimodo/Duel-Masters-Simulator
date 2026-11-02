// カード一覧の表示の大きさを +/− ボタンで変える (このブラウザに覚えておく)
import { useState } from 'react';

const STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const DEFAULT = STEPS.indexOf(1);

function load(key: string): number {
  try {
    const v = Number(localStorage.getItem(`cardSize:${key}`));
    return Number.isInteger(v) && v >= 0 && v < STEPS.length && localStorage.getItem(`cardSize:${key}`) != null ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** key: 画面ごとの名前。[倍率, 倍率を変えるボタン] */
export function useCardScale(key: string): [number, React.ReactNode] {
  const [i, setI] = useState(() => load(key));
  const set = (n: number) => {
    const v = Math.max(0, Math.min(STEPS.length - 1, n));
    setI(v);
    try {
      localStorage.setItem(`cardSize:${key}`, String(v));
    } catch {
      // 覚えておけなくても、今の画面では変わる
    }
  };
  const buttons = (
    <span className="size-buttons" title="カードの表示の大きさ">
      <button className="small" disabled={i === 0} onClick={() => set(i - 1)} aria-label="カードを小さく">
        −
      </button>
      <span className="small muted">{Math.round(STEPS[i] * 100)}%</span>
      <button className="small" disabled={i === STEPS.length - 1} onClick={() => set(i + 1)} aria-label="カードを大きく">
        ＋
      </button>
    </span>
  );
  return [STEPS[i], buttons];
}
