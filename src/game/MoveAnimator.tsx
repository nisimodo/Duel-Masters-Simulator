// カードの移動を、移動元の置き場から移動先の置き場へ飛ぶアニメーションで見せる (「山札▶手札」などのラベルつき)
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CardImg, CardBack } from '../components/CardView';
import type { Lookup } from '../engine/engine';
import type { GameState } from '../engine/types';

const ZONE_LABEL: Record<string, string> = {
  deck: '山札',
  hand: '手札',
  battle: 'バトルゾーン',
  grave: '墓地',
  mana: 'マナ',
  shield: 'シールド',
  hyper: '超次元',
  gr: '超GR',
  partner: 'パートナー',
  under: '下に重ねる',
  gone: '除外',
};
/** 誰からも見える置き場 */
const PUBLIC = new Set(['battle', 'grave', 'mana', 'hyper', 'partner']);
/** 一度に飛ばす最大数 (まとめて動いた時は最後の分だけ) */
const MAX_AT_ONCE = 8;
const DURATION = 900;
const STAGGER = 140;

interface Flight {
  key: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
  cid: string | null;
  face: number;
  label: string;
  owner: number;
}

function anchorRect(owner: number, zone: string): DOMRect | null {
  const el = document.querySelector(`[data-anchor="${owner}-${zone}"]`) ?? document.querySelector(`[data-anchor="${owner}-area"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function MoveAnimator({ s, L, me, showAll, sleeveOf }: { s: GameState; L: Lookup; me: number; showAll: boolean; sleeveOf: (p: number) => string | null | undefined }) {
  const seen = useRef<number | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seq = s.moveSeq ?? 0;

  useEffect(() => {
    // 開いた時点までの移動は再生しない
    if (seen.current == null) {
      seen.current = seq;
      return;
    }
    if (seq <= seen.current) return;
    const fresh = (s.moves ?? []).filter((m) => m.n > seen.current!).slice(-MAX_AT_ONCE);
    seen.current = seq;
    const add: Flight[] = [];
    fresh.forEach((m, k) => {
      const a = anchorRect(m.owner, m.from);
      const b = anchorRect(m.owner, m.to);
      if (!a || !b) return;
      const c = s.cards[m.iid];
      // 見えない置き場どうしの移動 (相手の山札→手札など) は裏向きで飛ばす
      const visible = showAll || PUBLIC.has(m.from) || (PUBLIC.has(m.to) && !(m.to === 'mana' && c.manaDown)) || (m.owner === me && (m.to === 'hand' || m.from === 'hand') && m.to !== 'shield' && m.to !== 'deck') || c.revealed;
      add.push({
        key: m.n,
        x: a.left + a.width / 2,
        y: a.top + a.height / 2,
        dx: b.left + b.width / 2 - (a.left + a.width / 2),
        dy: b.top + b.height / 2 - (a.top + a.height / 2),
        delay: k * STAGGER,
        cid: visible ? c.cid : null,
        face: c.zone === 'battle' ? c.face : 0,
        label: `${ZONE_LABEL[m.from] ?? m.from}▶${ZONE_LABEL[m.to] ?? m.to}`,
        owner: m.owner,
      });
    });
    if (!add.length) return;
    setFlights((f) => [...f, ...add]);
    const ids = new Set(add.map((x) => x.key));
    // 次の移動が来ても消し忘れないよう、片付けはアンマウント時だけ取り消す
    timers.current.push(setTimeout(() => setFlights((f) => f.filter((x) => !ids.has(x.key))), DURATION + add.length * STAGGER + 100));
  }, [seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!flights.length) return null;
  return (
    <div className="move-layer">
      {flights.map((f) => {
        const card = f.cid ? L(f.cid) : undefined;
        return (
          <div
            key={f.key}
            className="move-flight"
            style={{ left: f.x, top: f.y, '--dx': `${f.dx}px`, '--dy': `${f.dy}px`, animationDelay: `${f.delay}ms`, animationDuration: `${DURATION}ms` } as CSSProperties}
          >
            <div className="move-label">{f.label}</div>
            {card ? <CardImg card={card} face={f.face} width={52} /> : <CardBack sleeve={sleeveOf(f.owner)} width={52} />}
          </div>
        );
      })}
    </div>
  );
}
