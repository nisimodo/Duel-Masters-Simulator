// 結果画像のプレビューと保存 (テストプレイ・オンライン対戦で共通)
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../game/dialogs';
import { downloadBlob, type ImageShape, type ResultImage } from '../lib/resultImage';

/**
 * make: 画像を作る (timeoutMs: カード画像を待つ時間)。
 * name: 保存するファイル名の先頭
 */
export function ResultImageDialog({ make, name, shape: initial, onClose }: { make: (shape: ImageShape, timeoutMs: number) => Promise<ResultImage>; name: string; shape: ImageShape; onClose: () => void }) {
  const [preview, setPreview] = useState<{ shape: ImageShape; blob: Blob; url: string; missingThumbs: number } | null>(null);
  const [making, setMaking] = useState<ImageShape | 'reload' | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  /** reload: カード画像を読み込み直す (長めに待つ) */
  const show = async (shape: ImageShape, reload = false) => {
    setMaking(reload ? 'reload' : shape);
    try {
      const { blob, missingThumbs } = await make(shape, reload ? 30000 : 10000);
      autoTry.current = 0;
      setPreview({ shape, blob, url: URL.createObjectURL(blob), missingThumbs });
    } catch (e) {
      alert(`画像を作れませんでした: ${e instanceof Error ? e.message : e}`);
    } finally {
      setMaking(null);
    }
  };
  // 開いた時に作る
  useEffect(() => {
    void show(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // カード画像を読み込めなかった時は、裏で取得し続けて、読み込めたらプレビューを自動で作り直す
  const autoTry = useRef(0);
  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    if (!preview || preview.missingThumbs === 0 || making) return;
    if (autoTry.current >= 10) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      autoTry.current++;
      try {
        const r = await make(preview.shape, 60000);
        // (待っている間に閉じた・切り替えた時は何もしない)
        if (!cancelled && r.missingThumbs < preview.missingThumbs) setPreview({ shape: preview.shape, blob: r.blob, url: URL.createObjectURL(r.blob), missingThumbs: r.missingThumbs });
        // まだ読み込めなければ、もう一度試す
        else if (!cancelled) setAutoTick((x) => x + 1);
      } catch {
        // 作り直せなくても今のプレビューのまま
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [preview, making, make, autoTick]);

  const save = () => {
    if (!preview) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    downloadBlob(preview.blob, `${name}-${stamp}-${preview.shape === 'landscape' ? 'yoko' : 'tate'}.png`);
  };
  const shape = preview?.shape ?? initial;
  return (
    <Modal title="結果画像のプレビュー" onClose={onClose}>
      <div className="row small" style={{ gap: 6 }}>
        {(['landscape', 'portrait'] as const).map((sh) => (
          <button key={sh} className={shape === sh ? 'primary' : ''} disabled={!!making} onClick={() => preview?.shape !== sh && show(sh)}>
            {making === sh ? '作成中…' : sh === 'landscape' ? '横長' : '縦長'}
          </button>
        ))}
        <span className="grow" />
        <button disabled={!!making || !preview} onClick={() => show(shape, true)} title="カードの画像を取得し直して、画像を作り直す">
          {making === 'reload' ? '再取得中…' : '↻ 再読み込み'}
        </button>
        <button className="primary" disabled={!!making || !preview} onClick={save}>
          保存
        </button>
      </div>
      {preview && preview.missingThumbs > 0 && (
        <div className="small caution">
          カード画像を読み込めなかったため、{preview.missingThumbs}つのデッキは文明の色で代わりに表示しています。読み込めたら自動でプレビューを更新します (「再読み込み」ですぐに取得し直すこともできます。初めて使うカードは時間がかかることがあります)。
        </div>
      )}
      {preview ? (
        <img className="result-preview" src={preview.url} alt="結果画像" style={preview.shape === 'landscape' ? { width: 'min(860px, 88vw)' } : { height: 'min(70vh, 1200px)', maxWidth: '88vw', objectFit: 'contain' }} />
      ) : (
        <div className="muted small">画像を作成中…</div>
      )}
    </Modal>
  );
}
