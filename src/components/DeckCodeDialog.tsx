// デッキコードの表示 (コピー) と入力
import { useEffect, useState } from 'react';
import { Modal } from '../game/dialogs';
import type { CardDB } from '../lib/cards';
import type { Deck } from '../lib/deck';
import { DeckCodeError, deckFromCode, deckToCode } from '../lib/deckCode';

/** デッキのコードを表示する */
export function DeckCodeDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    deckToCode(deck).then((c) => alive && setCode(c));
    return () => {
      alive = false;
    };
  }, [deck]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // コピーできない時は選択だけしておく (手でコピーしてもらう)
      (document.getElementById('deck-code-text') as HTMLTextAreaElement | null)?.select();
    }
  };
  return (
    <Modal title={`デッキコード: ${deck.name}`} onClose={onClose}>
      <div className="small muted">デッキ編成の画面の「コードを入力」にこのコードを入れると、同じデッキを作れます。</div>
      <textarea id="deck-code-text" className="deck-code" readOnly value={code || '作成中…'} onFocus={(e) => e.currentTarget.select()} />
      <div className="row">
        <button className="primary" disabled={!code} onClick={copy}>
          {copied ? '✓ コピーしました' : 'コピー'}
        </button>
        <button onClick={onClose}>閉じる</button>
      </div>
    </Modal>
  );
}

/** コードを入力してデッキを作る (onLoad に読み取ったデッキを渡す) */
export function DeckCodeInputDialog({ db, onLoad, onClose }: { db: CardDB; onLoad: (deck: Deck, notFound: string[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const { deck, notFound } = await deckFromCode(text, db);
      onLoad(deck, notFound);
    } catch (e) {
      setError(e instanceof DeckCodeError ? e.message : 'デッキコードを読み取れませんでした');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="デッキコードを入力" onClose={onClose}>
      <div className="small muted">「デッキコード」で作ったコードを貼り付けてください。今のデッキの中身 (名前・カード) は、コードのデッキで置き換わります。</div>
      <textarea className="deck-code" autoFocus placeholder="DM1…" value={text} onChange={(e) => setText(e.target.value)} />
      {error && <div className="small error">{error}</div>}
      <div className="row">
        <button className="primary" disabled={!text.trim() || busy} onClick={load}>
          読み込む
        </button>
        <button onClick={onClose}>キャンセル</button>
      </div>
    </Modal>
  );
}
