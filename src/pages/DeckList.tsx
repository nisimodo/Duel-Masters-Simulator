import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { deleteDeck, subscribeDecks } from '../data/api';
import { DEFAULT_RULES, splitByFormat, validateDeck, type Deck } from '../lib/deck';
import { DeckSection, DeckTile, FormatBadge } from '../components/DeckGrid';

export default function DeckList() {
  const { user, db } = useApp();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const nav = useNavigate();
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);
  if (!db || !user) return null;

  const tile = (d: Deck, okNote: string, issues: string[]) => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      issues={issues}
      okNote={okNote}
      onClick={() => nav(`/decks/${d.id}`)}
      actions={
        <>
          <button className="small" onClick={() => nav(`/decks/${d.id}`)}>
            編集
          </button>
          <button className="small danger" onClick={() => confirm(`「${d.name}」を削除しますか？`) && deleteDeck(user.uid, d.id)}>
            削除
          </button>
        </>
      }
    />
  );

  const duema = (decks ?? []).filter((d) => d.type === 'duema');
  const duepa = (decks ?? []).filter((d) => d.type === 'duepa');
  const { original, advance } = splitByFormat(db, duema, (d) => d);

  return (
    <div className="page col">
      <div className="panel col">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            デュエマ用デッキ (40枚)
          </h3>
          <button className="primary" onClick={() => nav('/decks/new?type=duema')}>
            ＋ 新規作成
          </button>
        </div>
        {decks == null && <div className="muted">読み込み中…</div>}
        {decks != null && (
          <>
            <DeckSection
              title={<FormatBadge format="original" />}
              note="超次元・超GRゾーンとゲーム開始時に置かれるカードを使わないデッキ (アドバンスのルームでも使えます)"
              empty="オリジナルのデッキはありません"
            >
              {original.map((d) => tile(d, 'オリジナル・アドバンス可', validateDeck(db, d, { ...DEFAULT_RULES.duema, format: 'original' })))}
            </DeckSection>
            <DeckSection
              title={<FormatBadge format="advance" />}
              note="超次元・超GRゾーンやゲーム開始時に置かれるカードを使うデッキ (オリジナルのルームでは使えません)"
              empty="アドバンスのデッキはありません"
            >
              {advance.map((d) => tile(d, 'アドバンスで使用可', validateDeck(db, d, DEFAULT_RULES.duema)))}
            </DeckSection>
          </>
        )}
      </div>
      <div className="panel col">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            デュエパ用デッキ (60枚)
          </h3>
          <button className="primary" onClick={() => nav('/decks/new?type=duepa')}>
            ＋ 新規作成
          </button>
        </div>
        {decks == null && <div className="muted">読み込み中…</div>}
        {decks != null && (
          <DeckSection title="デッキ" empty="デッキがありません">
            {duepa.map((d) => tile(d, '使用可能', validateDeck(db, d)))}
          </DeckSection>
        )}
      </div>
    </div>
  );
}
