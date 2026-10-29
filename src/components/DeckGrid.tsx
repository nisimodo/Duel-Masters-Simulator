// デッキのグリッド表示 (サムネ・デッキ名・枚数・文明・オリジナル/アドバンス)
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CIV_COLOR, CIV_NAME, type CardDB } from '../lib/cards';
import { countOf, deckCivs, deckFormat, FORMAT_LABEL, mainSize, type Deck, type DeckFormat } from '../lib/deck';
import { DeckThumb } from './CardView';

/** 1行に収まらない文字は、切らずに横幅を縮めて (文字の縦横比を変えて) 収める */
export function FitText({ text, className }: { text: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    // (offsetWidth は縮める前の幅)
    // (幅は整数に丸められるので、端の文字が欠けないよう少し余裕を持たせる)
    const update = () => setScale(i.offsetWidth > b.clientWidth && b.clientWidth > 0 ? (b.clientWidth - 2) / (i.offsetWidth + 1) : 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div ref={box} className={`fit-text${className ? ` ${className}` : ''}`} title={text}>
      <span ref={inner} style={scale < 1 ? { transform: `scaleX(${scale})` } : undefined}>
        {text}
      </span>
    </div>
  );
}

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
  /** お気に入り (onFav があれば★を押して付け外しできる) */
  fav?: boolean;
  onFav?: () => void;
  /** バッジの横に出す一言 (投稿中・投稿者など) */
  tag?: ReactNode;
}

export function DeckTile({ db, deck, title, issues = [], okNote, caution, selected, onClick, actions, showUpdated = true, fav, onFav, tag }: TileProps) {
  const disabled = issues.length > 0 && !!onClick;
  const fmt = deck ? deckFormat(db, deck) : null;
  const hyper = deck ? countOf(deck.hyper) : 0;
  const gr = deck ? countOf(deck.gr) : 0;
  const body = (
    <>
      <div className="deck-tile-thumb">{deck ? <DeckThumb db={db} deck={deck} width="100%" /> : <div className="deck-thumb-empty deck-tile-random">?</div>}</div>
      <div className="deck-tile-body">
        <FitText className="deck-tile-name" text={title ?? deck?.name ?? ''} />
        {deck && (
          <div className="deck-tile-info muted">
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
          {tag}
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
      </div>
    </>
  );
  return (
    <div className={`deck-tile${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${onClick ? ' clickable' : ''}${fav ? ' fav' : ''}`}>
      {(onFav || fav) && (
        <button
          className={`deck-fav${fav ? ' on' : ''}`}
          disabled={!onFav}
          title={fav ? 'お気に入りから外す' : 'お気に入りに登録'}
          aria-label={fav ? 'お気に入りから外す' : 'お気に入りに登録'}
          aria-pressed={!!fav}
          onClick={(e) => {
            e.stopPropagation();
            onFav?.();
          }}
        >
          {fav ? '★' : '☆'}
        </button>
      )}
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
