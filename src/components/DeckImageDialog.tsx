// デッキリストの画像のプレビュー: 見てから「ダウンロード」か「キャンセル」を選ぶ
import { useEffect, useState } from 'react';
import { Modal } from '../game/dialogs';
import type { CardDB } from '../lib/cards';
import type { Deck } from '../lib/deck';
import { renderDeckImage } from '../lib/deckImage';
import { downloadBlob } from '../lib/resultImage';

/** ファイル名に使えない文字を除いたデッキ名 */
const fileName = (name: string) => `${name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'deck'}.png`;

export function DeckImageDialog({ db, deck, onClose }: { db: CardDB; deck: Deck; onClose: () => void }) {
  const [img, setImg] = useState<{ blob: Blob; url: string; missing: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 画像を作り直す回数 (再読み込み)
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    renderDeckImage(db, deck, tries ? 30000 : 10000)
      .then((r) => {
        if (!cancelled) setImg({ ...r, url: URL.createObjectURL(r.blob) });
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // (開いた時のデッキで作る)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);
  useEffect(
    () => () => {
      if (img) URL.revokeObjectURL(img.url);
    },
    [img],
  );
  const loading = !img && !err;
  return (
    <Modal title="デッキリストの画像" onClose={onClose}>
      {loading && <div className="muted">画像を作っています… (カード画像を読み込み中)</div>}
      {err && <div className="warn small">画像を作れませんでした: {err}</div>}
      {img && (
        <>
          {img.missing > 0 && (
            <div className="small caution">
              ⚠ {img.missing}種類のカード画像を読み込めなかったため、文明の色とカード名で表示しています。「再読み込み」で取得し直せます。
            </div>
          )}
          <img className="deck-image-preview" src={img.url} alt={`${deck.name} のデッキリスト`} />
        </>
      )}
      <div className="row">
        <button className="primary" disabled={!img} onClick={() => img && (downloadBlob(img.blob, fileName(deck.name)), onClose())}>
          ダウンロード
        </button>
        <button onClick={onClose}>キャンセル</button>
        {img && img.missing > 0 && (
          <button
            className="small"
            onClick={() => {
              setImg(null);
              setTries(tries + 1);
            }}
          >
            再読み込み
          </button>
        )}
      </div>
    </Modal>
  );
}
