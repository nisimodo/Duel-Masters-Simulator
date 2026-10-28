// 任意で発動する効果 (S・トリガー / G・ストライク / 革命チェンジ・侵略 / 「〜してもよい」) を、
// 光っているカードを押して発動する。強制効果はエンジンが自動で処理するのでここには来ない。
import { useState } from 'react';
import type { Card } from '../lib/cards';
import { normText } from '../rules/text';
import { CardImg } from '../components/CardView';
import { abilityPick, faceOf, nameOf, type Lookup } from '../engine/engine';
import type { Action, GameState, Pending } from '../engine/types';
import { Modal } from './dialogs';

/** 効果の文から、その能力が書いてある行を探す (光らせる行) */
function matchLine(lines: string[], prompt: string): number {
  const body = normText(prompt.replace(/^[^:：]*[:：]\s*/, '')).replace(/\s+/g, '');
  for (let len = Math.min(12, body.length); len >= 5; len -= 3)
    for (let i = 0; i + len <= body.length; i += 3) {
      const chunk = body.slice(i, i + len);
      const k = lines.findIndex((l) => normText(l).replace(/\s+/g, '').includes(chunk));
      if (k >= 0) return k;
    }
  return -1;
}

/** 光っているカードを押した時の、発動する効果の表示 */
export function ActivationDialog({
  s,
  L,
  pending,
  iid,
  skip,
  onSubmit,
  onClose,
  onHover,
}: {
  s: GameState;
  L: Lookup;
  pending: Pending;
  iid: number;
  /** 発動しない時のアクション */
  skip: Action;
  onSubmit: (a: Action) => void;
  onClose: () => void;
  onHover: (c: Card | null) => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const c = s.cards[iid];
  const card = L(c.cid)!;
  const faceIdx = c.zone === 'battle' ? c.face : 0;
  const face = faceOf(s, L, iid) ?? card.faces[faceIdx];

  // 光らせる行と、発動ボタン
  let glow = (_l: string, _i: number) => false;
  const buttons: { label: string; action: Action | null }[] = [];
  let extra: React.ReactNode = null;
  if (pending.kind === 'trigger') {
    glow = (l) => /^(S・トリガー|スーパー・S・トリガー|G・ストライク)/.test(normText(l));
    if (pending.trigger)
      card.faces.forEach((f, i) => {
        if (f.kw.shieldTrigger) buttons.push({ label: `${f.name} を${f.isCreature ? '召喚' : '唱える'}`, action: { t: 'trigger', use: true, face: i } });
      });
    if (pending.strike) {
      const opp = s.players
        .map((_, i) => i)
        .filter((i) => i !== pending.player)
        .flatMap((i) => s.players[i].battle)
        .filter((i) => faceOf(s, L, i)?.isCreature);
      extra = (
        <div className="col" style={{ gap: 4 }}>
          <span className="small">G・ストライク: 相手のクリーチャーを1体選ぶ (このターン攻撃できない)</span>
          <div className="row">
            {opp.map((o) => (
              <CardImg key={o} card={L(s.cards[o].cid)!} face={s.cards[o].face} width={64} selected={target === o} onHover={onHover} onClick={() => setTarget(o)} />
            ))}
          </div>
        </div>
      );
      buttons.push({ label: 'G・ストライクを使う', action: target != null ? { t: 'trigger', use: true, target } : null });
    }
  } else if (pending.kind === 'attackOpt') {
    glow = (l) => /^(革命チェンジ|侵略|S級侵略|侵略ZERO|S級不死)/.test(normText(l));
    const atk = s.attack ? nameOf(s, L, s.attack.attacker) : '';
    buttons.push({ label: atk ? `${atk} と入れ替えて発動` : '発動', action: { t: 'attackOpt', iid } });
  } else if (pending.kind === 'choice') {
    const k = matchLine(face.text, pending.prompt);
    glow = (_l, i) => i === k;
    buttons.push({ label: '発動', action: { t: 'choose', yes: true } });
  }
  const lines = face.text;
  const anyGlow = lines.some((l, i) => glow(l, i));

  return (
    <Modal title={`効果の発動: ${face.name}`} onClose={onClose}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <CardImg card={card} face={faceIdx} width={110} onHover={onHover} />
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <div className="effect-lines">
            {lines.map((l, i) => (
              <div key={i} className={glow(l, i) ? 'effect-line glow' : 'effect-line'}>
                {l}
              </div>
            ))}
          </div>
          {pending.kind === 'choice' && (
            <div className={anyGlow ? 'small muted' : 'effect-line glow'}>{pending.prompt.replace(/^[^:：]*[:：]\s*/, '')}</div>
          )}
          {extra}
          <div className="row">
            {buttons.map((b, i) => (
              <button key={i} className="gold glow-btn" disabled={!b.action} onClick={() => b.action && onSubmit(b.action)}>
                ⚡ {b.label}
              </button>
            ))}
            <button onClick={() => onSubmit(skip)}>スキップ</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 同時に誘発した能力の順番を選ぶ: 押したカードの能力 (同じカードに複数あればそれぞれ) を次に処理する */
export function AbilityOrderDialog({
  s,
  L,
  iid,
  onSubmit,
  onClose,
  onHover,
}: {
  s: GameState;
  L: Lookup;
  iid: number;
  onSubmit: (a: Action) => void;
  onClose: () => void;
  onHover: (c: Card | null) => void;
}) {
  const pk = abilityPick(s);
  const list = (pk?.indices ?? []).flatMap((i) => {
    const x = s.pending[i];
    return x.kind === 'ability' && x.src === iid ? [{ i, x }] : [];
  });
  const c = s.cards[iid];
  const card = L(c.cid)!;
  const faceIdx = c.zone === 'battle' ? c.face : 0;
  const face = faceOf(s, L, iid) ?? card.faces[faceIdx];
  const lines = face.text;
  const lit = new Set(list.map(({ x }) => matchLine(lines, x.text)));
  return (
    <Modal title={`効果の発動: ${face.name}`} onClose={onClose}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <CardImg card={card} face={faceIdx} width={110} onHover={onHover} />
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <div className="effect-lines">
            {lines.map((l, k) => (
              <div key={k} className={lit.has(k) ? 'effect-line glow' : 'effect-line'}>
                {l}
              </div>
            ))}
          </div>
          <span className="small muted">同時に発動する能力のうち、この能力を先に処理します。残りの能力は、この後に続けて選べます。</span>
          {list.map(({ i, x }) => (
            <div key={i} className="col" style={{ gap: 4 }}>
              {list.length > 1 && <div className="effect-line glow">{x.text}</div>}
              <div className="row">
                <button className="gold glow-btn" onClick={() => onSubmit({ t: 'pickAbility', index: i, use: true, activate: true })}>
                  ⚡ 発動
                </button>
                {x.optional && <button onClick={() => onSubmit({ t: 'pickAbility', index: i, use: false })}>使わない</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

