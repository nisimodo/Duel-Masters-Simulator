import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 重ねない時のカードの間隔 */
const GAP = 4;

/**
 * カードを横に並べ、入りきらない時はシールドのように重ねる。
 * 重ねるのはカードの半分まで。それでも入らない時は改行する
 */
export function OverlapRow({ children, layoutKey, after }: { children: ReactNode; layoutKey: string; after?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  // 重ねる量 (px) と、各行の先頭のカードの番号
  const [lay, setLay] = useState<{ overlap: number; starts: number[] }>({ overlap: -GAP, starts: [0] });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const boxes = [...el.querySelectorAll<HTMLElement>(':scope > [data-ov]')];
      if (!boxes.length) return;
      const ws = boxes.map((b) => b.offsetWidth);
      // (小数点以下の丸めで最後のカードが改行されないように少し余らせる)
      const W = el.clientWidth - 2;
      const total = ws.reduce((a, b) => a + b, 0);
      let overlap = -GAP;
      if (total + GAP * (ws.length - 1) > W && ws.length > 1) overlap = Math.min(Math.min(...ws) / 2, Math.ceil((total - W) / (ws.length - 1)));
      const starts = [0];
      let x = 0;
      ws.forEach((w, k) => {
        const add = k === starts[starts.length - 1] ? w : w - overlap;
        if (k > starts[starts.length - 1] && x + add > W) {
          starts.push(k);
          x = w;
        } else x += add;
      });
      setLay((prev) => (prev.overlap === overlap && prev.starts.join() === starts.join() ? prev : { overlap, starts }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutKey]);

  return (
    <div ref={ref} className="overlap-row">
      {items.map((child, k) => [
        k > 0 && lay.starts.includes(k) && <div key={`br${k}`} className="overlap-break" />,
        <div key={(child as { key?: string | null }).key ?? k} data-ov style={{ marginLeft: lay.starts.includes(k) ? 0 : -lay.overlap }}>
          {child}
        </div>,
      ])}
      {after}
    </div>
  );
}
