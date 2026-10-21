// ドギラゴン・ガチャ / ドキンダム・ガチャのルーレット表示
// チェックカードの画像の上でハイライトが行を巡り、だんだん遅くなって出た目で止まる。
import { useEffect, useRef, useState } from 'react';
import { GACHA, GACHA_ROWS, type GachaKind } from '../rules/gacha';

export interface GachaSpin {
  kind: GachaKind;
  roll: number;
  playerName: string;
}

/** 止まるまでの1コマごとの間隔 (ms)。最後のコマが出た目になるように回数を調整する */
function schedule(roll: number): number[] {
  const steps = 18 + ((roll - 18) % 6 + 6) % 6; // 0 から数えて最後の位置が roll
  return Array.from({ length: steps + 1 }, (_, i) => 50 + Math.round(Math.pow(i / steps, 3) * 380));
}

export function GachaRoulette({ spin, onDone }: { spin: GachaSpin; onDone: () => void }) {
  const g = GACHA[spin.kind];
  const [pos, setPos] = useState(0);
  const [stopped, setStopped] = useState(false);
  // 親の再描画で onDone が変わっても回し直さない
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const delays = schedule(spin.roll);
    setStopped(false);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setPos(i % 6);
      if (i >= delays.length - 1) {
        setStopped(true);
        timer = setTimeout(() => done.current(), 1800);
        return;
      }
      timer = setTimeout(tick, delays[i]);
      i++;
    };
    tick();
    return () => clearTimeout(timer);
    // spin が変わるたびに回し直す
  }, [spin]);

  const row = GACHA_ROWS[pos];
  const face = g.faces[spin.roll];
  return (
    <div className="gacha-overlay" onClick={() => stopped && onDone()}>
      <div className="gacha-box" onClick={(e) => e.stopPropagation()}>
        <div className="gacha-title">
          {spin.playerName} の {g.name}
        </div>
        <div className="gacha-card">
          <img src={`${import.meta.env.BASE_URL}${g.image}`} alt={g.name} draggable={false} />
          <div className={`gacha-hl${stopped ? ' stop' : ''}`} style={{ top: `${row.top}%`, height: `${row.height}%` }} />
        </div>
        <div className="gacha-result">{stopped ? `${face.label}！ ${face.effect}` : 'ルーレット中…'}</div>
        {stopped && (
          <button className="primary small" onClick={onDone}>
            閉じる
          </button>
        )}
      </div>
    </div>
  );
}
