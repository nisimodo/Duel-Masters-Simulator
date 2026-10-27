import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { deleteDeck, subscribeDecks } from '../data/api';
import { mainSize, validateDeck, type Deck } from '../lib/deck';
import { DeckThumb } from '../components/CardView';

export default function DeckList() {
  const { user, db } = useApp();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const nav = useNavigate();
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);
  if (!db || !user) return null;

  const section = (type: 'duema' | 'duepa', title: string) => {
    const list = (decks ?? []).filter((d) => d.type === type);
    return (
      <div className="panel col">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            {title}
          </h3>
          <button className="primary" onClick={() => nav(`/decks/new?type=${type}`)}>
            ＋ 新規作成
          </button>
        </div>
        {decks == null && <div className="muted">読み込み中…</div>}
        {decks != null && !list.length && <div className="muted">デッキがありません</div>}
        {list.map((d) => {
          const issues = validateDeck(db, d);
          return (
            <div key={d.id} className="member">
              <DeckThumb db={db} deck={d} width={40} />
              <div className="col grow" style={{ gap: 0 }}>
                <Link to={`/decks/${d.id}`}>
                  <b>{d.name}</b>
                </Link>
                <span className="small muted">
                  {mainSize(d)}枚 {Object.keys(d.hyper).length ? `/ 超次元${Object.values(d.hyper).reduce((a, b) => a + b, 0)}` : ''}{' '}
                  {Object.keys(d.gr).length ? `/ GR${Object.values(d.gr).reduce((a, b) => a + b, 0)}` : ''} ・ 更新{' '}
                  {new Date(d.updatedAt).toLocaleString()}
                </span>
                {issues.length > 0 ? (
                  <span className="small warn">⚠ レギュレーション違反: {issues[0]}{issues.length > 1 ? ` 他${issues.length - 1}件` : ''}</span>
                ) : (
                  <span className="small ok">✓ 通常ルールで使用可能</span>
                )}
              </div>
              <button className="small" onClick={() => nav(`/decks/${d.id}`)}>
                編集
              </button>
              <button className="small danger" onClick={() => confirm(`「${d.name}」を削除しますか？`) && deleteDeck(user.uid, d.id)}>
                削除
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="page col">
      {section('duema', 'デュエマ用デッキ (40枚)')}
      {section('duepa', 'デュエパ用デッキ (60枚)')}
    </div>
  );
}
