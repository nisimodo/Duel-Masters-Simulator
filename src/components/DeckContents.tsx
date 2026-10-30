// デッキの中身の一覧 (カードの種類ごとに枚数つき)。カードを押すと詳細を出す
import { useState } from 'react';
import type { Card, CardDB } from '../lib/cards';
import { frontCost } from '../lib/deckImage';
import { mainSize, type Deck } from '../lib/deck';
import { CardDetail, CardImg } from './CardView';

/** コスト順 (同じコストは枚数が多い順) の (カード, 枚数) */
function entries(db: CardDB, m: Record<string, number>): { card: Card; n: number }[] {
  return Object.entries(m)
    .map(([cid, n]) => ({ card: db.byId.get(cid), n }))
    .filter((x): x is { card: Card; n: number } => !!x.card && x.n > 0)
    .sort((a, b) => frontCost(a.card) - frontCost(b.card) || b.n - a.n || a.card.id.localeCompare(b.card.id));
}

export function DeckContents({ db, deck }: { db: CardDB; deck: Deck }) {
  const [detail, setDetail] = useState<Card | null>(null);
  const partner = deck.partner ? db.byId.get(deck.partner) : undefined;
  const sections = [
    { title: `メインデッキ (${mainSize(deck) - (partner ? 1 : 0)})`, list: entries(db, deck.main) },
    { title: 'パートナー', list: partner ? [{ card: partner, n: 1 }] : [] },
    { title: '超GRゾーン', list: entries(db, deck.gr) },
    { title: '超次元ゾーン', list: entries(db, deck.hyper) },
  ].filter((s) => s.list.length);
  return (
    <div className="col deck-contents">
      {sections.map((s) => (
        <div key={s.title} className="col" style={{ gap: 4 }}>
          <b className="small">{s.title}</b>
          <div className="deck-contents-grid">
            {s.list.map(({ card, n }) => (
              <CardImg key={card.id} card={card} width={72} selected={detail === card} title={card.name} onClick={() => setDetail(detail === card ? null : card)}>
                <span className="count-badge">×{n}</span>
              </CardImg>
            ))}
          </div>
        </div>
      ))}
      {detail ? <CardDetail db={db} card={detail} /> : <span className="small muted">カードを押すと詳細を表示します</span>}
    </div>
  );
}
