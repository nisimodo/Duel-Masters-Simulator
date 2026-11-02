// デッキの中身を見るダイアログ (みんなのデッキ・デッキ一覧・デッキ選択で共通)。画像で保存もできる
import { useState, type ReactNode } from 'react';
import { Modal } from '../game/dialogs';
import type { CardDB } from '../lib/cards';
import type { Deck } from '../lib/deck';
import { DeckContents } from './DeckContents';
import { DeckImageDialog } from './DeckImageDialog';

/** actions: 「インポート」など、画面ごとのボタン (閉じる・画像で保存の前に出す) */
export function DeckViewDialog({ db, deck, title, onClose, actions }: { db: CardDB; deck: Deck; title?: string; onClose: () => void; actions?: ReactNode }) {
  const [image, setImage] = useState(false);
  return (
    <>
      <Modal title={title ?? deck.name} onClose={onClose}>
        <DeckContents db={db} deck={deck} />
        <div className="row">
          {actions}
          <button onClick={() => setImage(true)}>画像で保存</button>
          <button onClick={onClose}>閉じる</button>
        </div>
      </Modal>
      {image && <DeckImageDialog db={db} deck={deck} onClose={() => setImage(false)} />}
    </>
  );
}

/** デッキのタイルに付ける「中身を見る」ボタン (タイルを押した時の選択とは別に開く) */
export function ViewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="small"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      中身を見る
    </button>
  );
}
