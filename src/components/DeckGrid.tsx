// デッキのグリッド表示 (サムネ・デッキ名・枚数・文明・オリジナル/アドバンス)
import type { ReactNode } from 'react';
import { CIV_COLOR, CIV_NAME, type CardDB } from '../lib/cards';
import { countOf, deckCivs, deckFormat, FORMAT_LABEL, mainSize, type Deck, type DeckFormat } from '../lib/deck';
import { DeckThumb } from './CardView';

export function FormatBadge({ format }: { format: DeckFormat }) {
  return <span className={`badge fmt-${format}`}>{FORMAT_LABEL[format]}</span>;
}

interface TileProps {
  db: CardDB;
  /** null はランダム生成など中身がまだないデッキ */
  deck: Deck | null;
  title?: string;
  /** 使えない理由 (あれば選べない) */
  issues?: string[];
  /** 使える時に出す一言 */
  okNote?: string;
  /** 使えるが気をつけること (アドバンスのルームでのオリジナルのデッキなど) */
  caution?: string;
  selected?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  /** 更新日時を出す (プリセットなどでは出さない) */
  showUpdated?: boolean;
}

export function DeckTile({ db, deck, title, issues = [], okNote, caution, selected, onClick, actions, showUpdated = true }: TileProps) {
  const disabled = issues.length > 0 && !!onClick;
  const fmt = deck ? deckFormat(db, deck) : null;
  const hyper = deck ? countOf(deck.hyper) : 0;
  const gr = deck ? countOf(deck.gr) : 0;
  const body = (
    <>
      <div className="deck-tile-thumb">{deck ? <DeckThumb db={db} deck={deck} width="100%" /> : <div className="deck-thumb-empty deck-tile-random">?</div>}</div>
      <div className="deck-tile-name" title={title ?? deck?.name}>
        {title ?? deck?.name}
      </div>
      {deck && (
        <div className="deck-tile-info small muted">
          <span>{mainSize(deck)}枚</span>
          {hyper > 0 && <span>超次元{hyper}</span>}
          {gr > 0 && <span>GR{gr}</span>}
          <span className="deck-tile-civs">
            {deckCivs(db, deck).map((c) => (
              <span key={c} className="civdot" style={{ background: CIV_COLOR[c] }} title={CIV_NAME[c]} />
            ))}
          </span>
        </div>
      )}
      <div className="deck-tile-badges">
        {fmt && <FormatBadge format={fmt} />}
        {selected && <span className="badge sel">選択中</span>}
      </div>
      {caution && issues.length === 0 && <div className="small caution deck-tile-note">⚠ {caution}</div>}
      {issues.length > 0 ? (
        <div className="small warn deck-tile-note" title={issues.join('\n')}>
          ⚠ {issues[0]}
          {issues.length > 1 ? ` 他${issues.length - 1}件` : ''}
        </div>
      ) : (
        okNote && <div className="small ok deck-tile-note">✓ {okNote}</div>
      )}
      {showUpdated && deck && deck.updatedAt > 0 && <div className="small muted">更新 {new Date(deck.updatedAt).toLocaleDateString()}</div>}
    </>
  );
  return (
    <div className={`deck-tile${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${onClick ? ' clickable' : ''}`}>
      {onClick ? (
        <button className="deck-tile-main" disabled={disabled} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="deck-tile-main">{body}</div>
      )}
      {actions && <div className="deck-tile-actions">{actions}</div>}
    </div>
  );
}

export function DeckGrid({ children }: { children: ReactNode }) {
  return <div className="deck-grid">{children}</div>;
}

/** 見出しつきのグリッド。中身がなければ empty を出す (empty も無ければ何も出さない) */
export function DeckSection({ title, note, empty, children }: { title: ReactNode; note?: ReactNode; empty?: ReactNode; children: ReactNode[] }) {
  if (!children.length && !empty) return null;
  return (
    <div className="deck-section col">
      <div className="deck-section-head">
        <b>{title}</b>
        {note && <span className="small muted">{note}</span>}
      </div>
      {children.length ? <DeckGrid>{children}</DeckGrid> : <div className="muted small">{empty}</div>}
    </div>
  );
}
