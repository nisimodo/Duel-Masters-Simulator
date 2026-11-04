import { useEffect, useRef, useState } from 'react';
import { cropImage } from '../lib/image';

interface Props {
  img: HTMLImageElement;
  title: string;
  /** 出力サイズ (縦横比もこれで決まる) */
  outW: number;
  outH: number;
  quality?: number;
  /** 枠の最大幅 (px) */
  maxViewW?: number;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}

const MAX_ZOOM = 6;

/**
 * 画像の切り抜きダイアログ。枠の縦横比は出力サイズと同じ。
 * ドラッグで移動、スライダー・ホイール・ピンチで拡大縮小。
 */
export default function ImageCropper({ img, title, outW, outH, quality = 0.8, maxViewW = 560, onCancel, onDone }: Props) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const aspect = outW / outH;

  // 枠の大きさ (画面に収まるように)
  const calcView = () => {
    const vw0 = Math.min(maxViewW, window.innerWidth - 56);
    const vh0 = Math.min(vw0 / aspect, window.innerHeight * 0.55);
    return { vw: Math.round(vh0 * aspect), vh: Math.round(vh0) };
  };
  const [{ vw, vh }, setView] = useState(calcView);
  useEffect(() => {
    const onResize = () => setView(calcView());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, maxViewW]);

  // 状態は「元画像上の中心座標」と「拡大率」で持つ (枠の大きさが変わっても位置がずれない)
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: iw / 2, y: ih / 2 });

  const baseScale = Math.max(vw / iw, vh / ih); // zoom=1 で枠を覆う倍率
  const scale = baseScale * zoom; // 表示 px / 元画像 px

  const clampCenter = (c: { x: number; y: number }, z: number) => {
    const s = baseScale * z;
    const hw = vw / s / 2;
    const hh = vh / s / 2;
    return {
      x: Math.min(Math.max(c.x, hw), iw - hw),
      y: Math.min(Math.max(c.y, hh), ih - hh),
    };
  };
  const c = clampCenter(center, zoom);

  const setZoomClamped = (z: number) => {
    const nz = Math.min(Math.max(z, 1), MAX_ZOOM);
    setZoom(nz);
    setCenter((prev) => clampCenter(prev, nz));
  };

  // ---- ドラッグ・ピンチ ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const live = useRef({ c, zoom, scale });
  live.current = { c, zoom, scale };

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: dist(), zoom: live.current.zoom };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const d = dist();
      if (pinch.current.dist > 0) setZoomClamped((pinch.current.zoom * d) / pinch.current.dist);
      return;
    }
    const { c: cur, scale: s } = live.current;
    const dx = (e.clientX - prev.x) / s;
    const dy = (e.clientY - prev.y) / s;
    setCenter(clampCenter({ x: cur.x - dx, y: cur.y - dy }, live.current.zoom));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // ホイール (passive: false で登録してページのスクロールを止める)
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomClamped(live.current.zoom * Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh, baseScale]);

  const done = () => {
    const w = vw / scale;
    const h = vh / scale;
    onDone(cropImage(img, { x: c.x - w / 2, y: c.y - h / 2, w, h }, outW, outH, quality));
  };

  // 画像の左上の表示位置
  const left = vw / 2 - c.x * scale;
  const top = vh / 2 - c.y * scale;

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal col cropper" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="small muted">ドラッグで位置を、スライダー・ホイール・ピンチで大きさを調整できます。</p>
        <div
          ref={viewRef}
          className="cropper-view"
          style={{ width: vw, height: vh }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={img.src}
            alt=""
            draggable={false}
            style={{ left, top, width: iw * scale, height: ih * scale }}
          />
        </div>
        <div className="row cropper-zoom">
          <span className="small muted">縮小</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomClamped(Number(e.target.value))}
          />
          <span className="small muted">拡大</span>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            className="small"
            onClick={() => {
              setZoom(1);
              setCenter({ x: iw / 2, y: ih / 2 });
            }}
          >
            リセット
          </button>
          <button onClick={onCancel}>キャンセル</button>
          <button className="primary" onClick={done}>
            この範囲で設定
          </button>
        </div>
      </div>
    </div>
  );
}
