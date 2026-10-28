import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { CIV_COLOR, CIV_NAME, cardImage, cardImageSmall, type Card, type CardDB } from '../lib/cards';
import { keywordBadges } from '../lib/keywords';
import { deckThumb, type Deck } from '../lib/deck';

export function civGradient(card: Card): string {
  const cs = card.civs.length ? card.civs.map((c) => CIV_COLOR[c]) : [CIV_COLOR.Z];
  return cs.length === 1 ? cs[0] : `linear-gradient(135deg, ${cs.join(', ')})`;
}

export function CivDots({ card }: { card: Card }) {
  return (
    <span>
      {(card.civs.length ? card.civs : (['Z'] as const)).map((c) => (
        <span key={c} className="civdot" style={{ background: CIV_COLOR[c] }} title={c === 'Z' ? '無色' : CIV_NAME[c]} />
      ))}
    </span>
  );
}

interface CardImgProps {
  card: Card;
  face?: number;
  width?: number | string;
  tapped?: boolean;
  selected?: boolean;
  target?: boolean;
  /** 押すと効果を発動できる (光らせる) */
  glow?: boolean;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onHover?: (c: Card | null) => void;
  children?: ReactNode;
  title?: string;
}

/** 小さくした画像がこの時間で読み込めなければ、公式の画像に切り替える (wsrv.nl がまだ縮めていないカードは時間がかかる) */
const SMALL_TIMEOUT_MS = 4000;

/** 公式画像を (小さくして) 表示。読み込めない場合は公式の元の画像、それも駄目なら文明色のテキストカードにする */
export function CardImg({ card, face = 0, width, tapped, selected, target, glow, onClick, onContextMenu, onHover, children, title }: CardImgProps) {
  // stage 0: 小さくした画像 / 1: 公式の元の画像 / 2: 文字だけ (別のカードになったら最初から)
  const key = `${card.id}:${face}`;
  const [img, setImg] = useState({ key, stage: 0, loaded: false });
  if (img.key !== key) setImg({ key, stage: 0, loaded: false });
  const stage = img.key === key ? img.stage : 0;
  const loaded = img.key === key && img.loaded;
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (stage !== 0 || loaded) return;
    let t = 0;
    // 画面に出ていない画像 (遅延読み込みでまだ読み込みが始まっていない) は待ち続ける
    const check = () => {
      const el = imgRef.current;
      const r = el?.getBoundingClientRect();
      const visible = !document.hidden && !!r && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0;
      if (visible && el && !el.complete) setImg((x) => (x.key === key && x.stage === 0 ? { ...x, stage: 1 } : x));
      else t = window.setTimeout(check, SMALL_TIMEOUT_MS);
    };
    t = window.setTimeout(check, SMALL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [key, stage, loaded]);
  const f = card.faces[face] ?? card.faces[0];
  const useText = stage >= 2;
  const style: CSSProperties = width != null ? ({ '--w': typeof width === 'number' ? `${width}px` : width } as CSSProperties) : {};
  return (
    <div
      className={`card${tapped ? ' tapped' : ''}${selected ? ' selected' : ''}${target ? ' target' : ''}${glow ? ' glow' : ''}`}
      style={style}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      title={title}
    >
      {useText ? (
        <div className="textcard" style={{ background: civGradient(card) }}>
          <span className="tc">{f.cost}</span>
          <span className="tn" style={{ marginTop: 16 }}>
            {f.name}
          </span>
          <span style={{ opacity: 0.85 }}>{f.type}</span>
          {f.power != null && <span style={{ marginTop: 'auto', fontWeight: 'bold' }}>{f.powerText}</span>}
        </div>
      ) : (
        <img
          ref={imgRef}
          src={stage === 0 ? cardImageSmall(card, face) : cardImage(card, face)}
          alt={card.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setImg((x) => (x.key === key ? { ...x, loaded: true } : x))}
          onError={() => setImg((x) => (x.key === key ? { ...x, stage: x.stage + 1, loaded: false } : x))}
          draggable={false}
        />
      )}
      {children}
    </div>
  );
}

export function CardBack({ sleeve, width, onClick, children, title }: { sleeve?: string | null; width?: number; onClick?: (e: MouseEvent) => void; children?: ReactNode; title?: string }) {
  return (
    <div className="card" style={width ? ({ '--w': `${width}px` } as CSSProperties) : undefined} onClick={onClick} title={title}>
      <div className="cardback">{sleeve ? <img src={sleeve} alt="" draggable={false} /> : 'DM'}</div>
      {children}
    </div>
  );
}

export function RegBadge({ db, card }: { db: CardDB; card: Card }) {
  const st = db.regStatus.get(card.id);
  if (st === 'premium') return <span className="badge premium">プレミアム殿堂</span>;
  if (st === 'hof') return <span className="badge hof">殿堂入り</span>;
  return null;
}

/** カードの詳細 (画像 + テキスト) */
export function CardDetail({ db, card, face }: { db: CardDB; card: Card | null; face?: number }) {
  if (!card) return <div className="muted small">カードにマウスを乗せると詳細を表示します</div>;
  const faces = face != null && !card.twin ? [card.faces[face] ?? card.faces[0]] : card.faces;
  return (
    <div className="col">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <CardImg key={face} card={card} width={130} face={face && !card.twin ? face : 0} />
        <div className="col grow" style={{ gap: 2 }}>
          <b>{card.name}</b>
          <div className="row">
            <CivDots card={card} />
            <RegBadge db={db} card={card} />
          </div>
          <span className="small muted">{card.id}</span>
        </div>
      </div>
      {faces.map((f, i) => (
        <div key={i} className="col" style={{ gap: 2, borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 6 : 0 }}>
          {(card.twin || card.faces.length > 1) && <b>{f.name}</b>}
          <div className="small">
            {f.type} / コスト {f.cost}
            {f.powerText ? ` / パワー ${f.powerText}` : ''}
          </div>
          {f.races.length > 0 && <div className="small muted">{f.races.join(' / ')}</div>}
          <div className="row" style={{ gap: 3 }}>
            {keywordBadges(f.kw).map((b) => (
              <span key={b} className="badge">
                {b}
              </span>
            ))}
          </div>
          <div className="detail-text">{f.text.join('\n')}</div>
        </div>
      ))}
    </div>
  );
}

/** デッキのサムネイル (デュエパはパートナー、デュエマは選んだカード) */
export function DeckThumb({ db, deck, width = 40 }: { db: CardDB; deck: Deck; width?: number | string }) {
  const id = deckThumb(deck);
  const card = id ? db.byId.get(id) : undefined;
  if (card) return <CardImg card={card} width={width} />;
  return <div className="deck-thumb-empty" style={typeof width === 'number' ? { width, height: Math.round(width * 1.4) } : { width, aspectRatio: '5 / 7' }} />;
}
