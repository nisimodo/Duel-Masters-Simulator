import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useFavs } from '../context';
import { deleteDeck, favFirst, saveDeck, subscribeDecks } from '../data/api';
import { DEFAULT_RULES, presetToDeck, splitByFormat, validateDeck, type Deck, type DeckType } from '../lib/deck';
import { DeckSection, DeckTile, FormatBadge } from '../components/DeckGrid';

export default function DeckList() {
  const { user, db } = useApp();
  const { favs, toggle } = useFavs();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [msg, setMsg] = useState('');
  const nav = useNavigate();
  useEffect(() => (user ? subscribeDecks(user.uid, setDecks) : undefined), [user]);
  const presets = useMemo(() => (db ? db.presets.map((p) => ({ ...presetToDeck(db, p.id).deck, id: p.id, name: p.name, type: (p.mode ?? 'duema') as DeckType })) : []), [db]);
  if (!db || !user) return null;

  const tile = (d: Deck, okNote: string, issues: string[]) => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      issues={issues}
      okNote={okNote}
      fav={favs.has(d.id)}
      onFav={() => toggle(d.id)}
      tag={d.shared && <span className="badge shared">投稿中</span>}
      onClick={() => nav(`/decks/${d.id}`)}
      actions={
        <>
          <button className="small" onClick={() => nav(`/decks/${d.id}`)}>
            編集
          </button>
          <button className="small danger" onClick={() => confirm(`「${d.name}」を削除しますか？${d.shared ? '\n(みんなのデッキへの投稿も取り下げられます)' : ''}`) && deleteDeck(user.uid, d.id)}>
            削除
          </button>
        </>
      }
    />
  );

  /** プリセット・投稿されたデッキを自分のデッキにコピーして開く */
  const copyToMine = async (d: Deck, from: string) => {
    const id = await saveDeck(user.uid, { ...d, id: '', shared: false });
    setMsg(`「${d.name}」を${from}から自分のデッキにコピーしました`);
    nav(`/decks/${id}`);
  };
  const presetTile = (d: Deck) => (
    <DeckTile
      key={d.id}
      db={db}
      deck={d}
      title={d.name}
      showUpdated={false}
      fav={favs.has(d.id)}
      onFav={() => toggle(d.id)}
      actions={
        <button className="small" onClick={() => copyToMine(d, 'プリセット')}>
          コピーして編集
        </button>
      }
    />
  );
  const byType = (t: DeckType) => favFirst((decks ?? []).filter((d) => d.type === t), favs, (d) => d.id);
  const duema = byType('duema');
  const duepa = byType('duepa');
  const { original, advance } = splitByFormat(db, duema, (d) => d);
  const presetsOf = (t: DeckType) => favFirst(presets.filter((d) => d.type === t), favs, (d) => d.id);

  return (
    <div className="page col">
      {msg && (
        <div className="panel row small ok">
          <span className="grow">✓ {msg}</span>
          <button className="small" onClick={() => setMsg('')}>
            閉じる
          </button>
        </div>
      )}
      <div className="panel col">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            デュエマ用デッキ (40枚)
          </h3>
          <button className="primary" onClick={() => nav('/decks/new?type=duema')}>
            ＋ 新規作成
          </button>
        </div>
        <span className="small muted">☆を押すとお気に入りに登録され、デッキ一覧やデッキ選択で上に出ます。</span>
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
        <DeckSection title="プリセット" note="「コピーして編集」で自分のデッキにできます">
          {presetsOf('duema').map(presetTile)}
        </DeckSection>
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
        <DeckSection title="プリセット" note="「コピーして編集」で自分のデッキにできます">
          {presetsOf('duepa').map(presetTile)}
        </DeckSection>
      </div>
    </div>
  );
}
