import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { CIV_COLOR, CIV_NAME, cardImage, cardImageSmall, type Card, type CardDB } from '../lib/cards';
import { keywordBadges } from '../lib/keywords';
import { deckThumb, type Deck } from '../lib/deck';
import type { EffectRow } from '../game/effectsOf';

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
  /** 横向きの枠で表示する (バトルゾーンのフィールドなど) */
  wide?: boolean;
}

/** 横向きのカード (フィールド・オレガ・オーラ)。画像は横長のものと、横向きのカードを縦長に回して載せたものがある */
export const isWideCard = (type: string) => /フィールド|オレガ・オーラ/.test(type);

/** 小さくした画像がこの時間で読み込めなければ、公式の画像に切り替える (wsrv.nl がまだ縮めていないカードは時間がかかる) */
const SMALL_TIMEOUT_MS = 4000;

/** 公式画像を (小さくして) 表示。読み込めない場合は公式の元の画像、それも駄目なら文明色のテキストカードにする */
export function CardImg({ card, face = 0, width, tapped, selected, target, glow, onClick, onContextMenu, onHover, children, title, wide }: CardImgProps) {
  // stage 0: 小さくした画像 / 1: 公式の元の画像 / 2: 文字だけ (別のカードになったら最初から)
  const key = `${card.id}:${face}`;
  // land: 画像が横長か (読み込んでから分かる)
  const [img, setImg] = useState<{ key: string; stage: number; loaded: boolean; land?: boolean }>({ key, stage: 0, loaded: false });
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
      className={`card${wide ? ' wide' : ''}${tapped ? ' tapped' : ''}${selected ? ' selected' : ''}${target ? ' target' : ''}${glow ? ' glow' : ''}`}
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
          // 画像の向きが枠と違う時は回して全体を見せる (横長の画像を縦の枠に / 縦長に載せた横向きのカードを横の枠に)
          className={img.land != null && img.land !== !!wide ? (wide ? 'rot-ccw' : 'rot-cw') : undefined}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            const im = e.currentTarget;
            setImg((x) => (x.key === key ? { ...x, loaded: true, land: im.naturalWidth > im.naturalHeight } : x));
          }}
          onError={() => setImg((x) => (x.key === key ? { ...x, stage: x.stage + 1, loaded: false } : x))}
          draggable={false}
        />
      )}
      {children}
    </div>
  );
}

export function CardBack({ sleeve, width, onClick, onContextMenu, children, title }: { sleeve?: string | null; width?: number; onClick?: (e: MouseEvent) => void; onContextMenu?: (e: MouseEvent) => void; children?: ReactNode; title?: string }) {
  return (
    <div className="card" style={width ? ({ '--w': `${width}px` } as CSSProperties) : undefined} onClick={onClick} onContextMenu={onContextMenu} title={title}>
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

/** カードの詳細 (画像 + テキスト)。effects: 対戦中にそのカードに付いている効果 */
export function CardDetail({ db, card, face, effects, imgWidth = 130 }: { db: CardDB; card: Card | null; face?: number; effects?: EffectRow[]; imgWidth?: number | string }) {
  if (!card) return <div className="muted small">カードにマウスを乗せると詳細を表示します</div>;
  const faces = face != null && !card.twin ? [card.faces[face] ?? card.faces[0]] : card.faces;
  const shownFace = face && !card.twin ? face : 0;
  // 2面のカードは面ごとに名前を出すので、ふりがなも面ごと
  const multi = card.twin || card.faces.length > 1;
  const reading = (fi: number) => card.readings[fi] ?? (fi === 0 ? card.readings[0] : undefined);
  return (
    <div className="col card-detail">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <CardImg key={face} card={card} width={imgWidth} face={shownFace} />
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <Ruby text={card.name} reading={multi ? undefined : reading(0)} />
          <div className="row">
            <CivDots card={card} />
            <RegBadge db={db} card={card} />
          </div>
          <span className="small muted">{card.id}</span>
        </div>
      </div>
      {effects && effects.length > 0 && (
        <div className="col card-effects">
          <b className="small">付いている効果</b>
          {effects.map((e, i) => (
            <div key={i} className="card-effect">
              <span className="eff-src">{e.manual ? '手動で変更' : e.src ? `《${e.src}》の効果` : '効果'}</span>
              {e.items.map((it) => (
                <span key={it} className={`badge${/パワー-/.test(it) ? ' minus' : /パワー\+/.test(it) ? ' plus' : ''}`}>
                  {it}
                </span>
              ))}
              <span className="small muted">{e.dur}</span>
            </div>
          ))}
        </div>
      )}
      {faces.map((f, i) => {
        const fi = card.faces.indexOf(f);
        return (
          <div key={i} className="col" style={{ gap: 2, borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 6 : 0 }}>
            {multi && <Ruby text={f.name} reading={reading(fi)} />}
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
        );
      })}
    </div>
  );
}

/** カード名とその上のふりがな (読みが名前と同じ時は出さない) */
function Ruby({ text, reading }: { text: string; reading?: string }) {
  return (
    <span className="col card-name">
      {reading && reading !== text && <span className="furigana">{reading}</span>}
      <b>{text}</b>
    </span>
  );
}

// マウスの位置 (カードの詳細を、カーソルと反対側に出すため)
let pointerX = 0;
if (typeof window !== 'undefined') window.addEventListener('mousemove', (e) => (pointerX = e.clientX), { passive: true });

/**
 * マウスを乗せている間に出すカードの詳細。画面の高さに収まるように文字と画像を小さくして、
 * スクロールしなくても全文が見えるようにする (カーソルと反対側に出す)。
 * avoidRight: 右側にある固定のパネルの幅 (そこには重ねない)
 */
export function HoverDetail({ db, card, face, effects, avoidRight = 0 }: { db: CardDB; card: Card; face?: number; effects?: EffectRow[]; avoidRight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const left = pointerX > (window.innerWidth - avoidRight) / 2;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 収まるまで少しずつ小さくする
    let fs = 1;
    el.style.setProperty('--fs', '1');
    while (el.scrollHeight > el.clientHeight + 1 && fs > 0.55) {
      fs = Math.round((fs - 0.05) * 100) / 100;
      el.style.setProperty('--fs', String(fs));
    }
  }, [card, face, effects]);
  return (
    <div ref={ref} className="hover-detail" style={left ? { left: 8 } : { right: avoidRight + 8 }}>
      <CardDetail db={db} card={card} face={face} effects={effects} imgWidth="calc(120px * var(--fs, 1))" />
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
