import { useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

/** 画面の端からの余白 */
const MARGIN = 8;
/** クリックした位置と吹き出しの間 (矢印の分) */
const GAP = 10;

/**
 * カードをクリックした時の操作メニュー (吹き出し)。
 * クリックした位置の下 (入らなければ上の広いほう) に出し、画面に収まらない分はスクロールする
 */
export function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number; arrowX: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(el.offsetWidth, vw - MARGIN * 2);
      const natural = el.scrollHeight;
      const spaceBelow = vh - y - GAP - MARGIN;
      const spaceAbove = y - GAP - MARGIN;
      const below = natural <= spaceBelow || spaceBelow >= spaceAbove;
      const maxH = Math.max(60, below ? spaceBelow : spaceAbove);
      const h = Math.min(natural, maxH);
      const left = Math.max(MARGIN, Math.min(x - w / 2, vw - w - MARGIN));
      const top = below ? y + GAP : y - GAP - h;
      setPos({ left, top, maxH, arrowX: Math.max(14, Math.min(x - left, w - 14)), below });
    };
    place();
    // 画面の大きさが変わったら閉じる (位置がずれるため)
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [x, y, items, onClose]);

  return (
    <div
      className={`ctx-pop${pos ? (pos.below ? ' below' : ' above') : ''}`}
      style={pos ? { left: pos.left, top: pos.top, ['--arrow-x' as string]: `${pos.arrowX}px` } : { left: 0, top: 0, visibility: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ctx" ref={ref} style={pos ? { maxHeight: pos.maxH } : undefined}>
        <div className="head">{title}</div>
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="sep" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                onClose();
                it.onClick?.();
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
