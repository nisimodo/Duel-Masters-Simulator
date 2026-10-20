import { useMemo, useState } from 'react';
import { CardBack, CardImg } from '../components/CardView';
import type { Card, CardDB, Civ } from '../lib/cards';
import { matchesCond } from '../engine/cond';
import { autoPay, faceOf, nameOf, payCovers, power, type Lookup } from '../engine/engine';
import type { Action, GameState, Pending } from '../engine/types';

export function Modal({ children, onClose, title }: { children: React.ReactNode; onClose?: () => void; title?: string }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal col" onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>
              {title}
            </h3>
            {onClose && (
              <button className="small" onClick={onClose}>
                閉じる
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** 召喚・呪文のコスト支払いダイアログ */
export function PayDialog({
  s,
  L,
  me,
  iid,
  face,
  onSubmit,
  onClose,
  onHover,
}: {
  s: GameState;
  L: Lookup;
  me: number;
  iid: number;
  face: number;
  onSubmit: (a: Action) => void;
  onClose: () => void;
  onHover: (c: Card | null) => void;
}) {
  const card = L(s.cards[iid].cid)!;
  const f = card.faces[face];
  const mana = s.players[me].mana.filter((m) => !s.cards[m].tapped);
  const [pay, setPay] = useState<number[]>(() => autoPay(s, L, me, f.civs as Civ[], f.cost) ?? []);
  const [showAll, setShowAll] = useState(false);
  const baseCands = s.players[me].battle.filter((b) => {
    const bf = faceOf(s, L, b);
    if (!bf) return false;
    if (showAll) return true;
    const bc = L(s.cards[b].cid)!;
    return bf.isCreature && (!f.kw.evoCond || matchesCond(f.kw.evoCond, bc, bf));
  });
  const [evo, setEvo] = useState<number[]>(() => (baseCands.length === 1 ? [baseCands[0]] : []));
  const ok = pay.length === f.cost && payCovers(L, s, pay, f.civs as Civ[]);
  const needEvo = f.isEvolution && f.isCreature;
  const verb = f.isCreature ? '召喚する' : f.isSpell ? '唱える' : '出す';
  const toggle = (m: number) => setPay(pay.includes(m) ? pay.filter((x) => x !== m) : [...pay, m]);
  return (
    <Modal title={`${f.name} を${verb}`} onClose={onClose}>
      <div className="small">
        コスト {f.cost} / 文明 {f.civs.length ? f.civs.join(',') : '無色'} ・ 選択中 {pay.length}枚{' '}
        {ok ? <span className="ok">✓ 支払い可能</span> : <span className="warn">コスト・文明が合いません</span>}
      </div>
      <div className="small muted">使うマナをクリックで選択 (コスト軽減などは「支払いを調整して出す」)</div>
      <div className="row">
        {mana.map((m) => (
          <CardImg key={m} card={L(s.cards[m].cid)!} width={56} selected={pay.includes(m)} onClick={() => toggle(m)} onHover={onHover} />
        ))}
        {!mana.length && <span className="muted">アンタップのマナがありません</span>}
      </div>
      {needEvo && (
        <>
          <div className="row">
            <b>進化元を選択</b>
            <label className="small">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 条件外も表示
            </label>
            {f.kw.evoCond && <span className="small muted">条件: {f.kw.evoCond.text}</span>}
          </div>
          <div className="row">
            {baseCands.map((b) => (
              <CardImg
                key={b}
                card={L(s.cards[b].cid)!}
                face={s.cards[b].face}
                width={56}
                selected={evo.includes(b)}
                onClick={() => setEvo(evo.includes(b) ? evo.filter((x) => x !== b) : [...evo, b])}
                onHover={onHover}
              />
            ))}
            {!baseCands.length && <span className="muted small">進化元がいません</span>}
          </div>
        </>
      )}
      <div className="row">
        <button className="primary" disabled={!ok || (needEvo && !evo.length)} onClick={() => onSubmit({ t: 'play', iid, face, pay, evo })}>
          {verb}
        </button>
        <button onClick={() => onSubmit({ t: 'play', iid, face, pay, evo, force: true })}>支払いを調整して出す ({pay.length}枚タップ)</button>
        <button onClick={() => onSubmit({ t: 'play', iid, face, pay: [], evo, free: true, force: true })}>コストを支払わずに出す</button>
      </div>
    </Modal>
  );
}

/** 自分が選択する必要がある処理 */
export function PendingDialog({
  s,
  L,
  db,
  pending,
  onSubmit,
  onHover,
  breakPicks,
}: {
  s: GameState;
  L: Lookup;
  db: CardDB;
  pending: Pending;
  onSubmit: (a: Action) => void;
  onHover: (c: Card | null) => void;
  breakPicks: number[];
}) {
  const img = (iid: number, extra?: { selected?: boolean; onClick?: () => void }) => (
    <CardImg key={iid} card={L(s.cards[iid].cid)!} face={s.cards[iid].zone === 'battle' ? s.cards[iid].face : 0} width={90} onHover={onHover} {...extra} />
  );
  const [target, setTarget] = useState<number | null>(null);
  const oppCreatures = useMemo(
    () =>
      s.players
        .map((_, i) => i)
        .filter((i) => i !== pending.player)
        .flatMap((i) => s.players[i].battle)
        .filter((i) => faceOf(s, L, i)?.isCreature),
    [s, L, pending.player],
  );
  void db;
  switch (pending.kind) {
    case 'attackOpt':
      return (
        <Modal title="革命チェンジ / 侵略">
          <div className="small">攻撃中: {nameOf(s, L, s.attack!.attacker)} ・ 使うカードを選んでください</div>
          <div className="row">{pending.options.map((o) => img(o, { onClick: () => onSubmit({ t: 'attackOpt', iid: o }) }))}</div>
          <button onClick={() => onSubmit({ t: 'attackOpt', iid: null })}>使わない</button>
        </Modal>
      );
    case 'block': {
      const at = s.attack!;
      return (
        <Modal title="ブロック">
          <div className="small">
            {nameOf(s, L, at.attacker)} (パワー{power(s, L, at.attacker, true)}) が {at.targetCard != null ? nameOf(s, L, at.targetCard) : 'あなた'} を攻撃しています
          </div>
          {pending.blockers.length > 0 && <b>ブロッカー</b>}
          <div className="row">
            {pending.blockers.map((b) => (
              <div key={b} className="col" style={{ alignItems: 'center' }}>
                {img(b)}
                <button className="small" onClick={() => onSubmit({ t: 'block', blocker: b })}>
                  ブロック ({power(s, L, b)})
                </button>
              </div>
            ))}
          </div>
          {pending.ninjas.length > 0 && <b>ニンジャ・ストライク</b>}
          <div className="row">
            {pending.ninjas.map((n) => (
              <div key={n} className="col" style={{ alignItems: 'center' }}>
                {img(n)}
                <button className="small" onClick={() => onSubmit({ t: 'block', ninja: n })}>
                  召喚
                </button>
              </div>
            ))}
          </div>
          <button className="primary" onClick={() => onSubmit({ t: 'block', blocker: null })}>
            ブロックしない
          </button>
        </Modal>
      );
    }
    case 'breakSel':
      return (
        <div className="banner">
          ブレイクするシールドを{pending.count}枚選んでください (相手のシールドをクリック) {breakPicks.length}/{pending.count}
          <button className="primary small" style={{ marginLeft: 8 }} disabled={breakPicks.length !== pending.count} onClick={() => onSubmit({ t: 'breakSel', shields: breakPicks })}>
            ブレイク
          </button>
          <button
            className="small"
            style={{ marginLeft: 4 }}
            onClick={() => onSubmit({ t: 'breakSel', shields: s.players[pending.target].shield.slice(-pending.count) })}
          >
            おまかせ
          </button>
        </div>
      );
    case 'trigger': {
      const card = L(s.cards[pending.iid].cid)!;
      const trigFaces = card.faces.map((f, i) => ({ f, i })).filter((x) => x.f.kw.shieldTrigger);
      return (
        <Modal title={pending.trigger ? 'S・トリガー' : 'G・ストライク'}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {img(pending.iid)}
            <div className="col">
              <b>{card.name}</b>
              {pending.trigger &&
                trigFaces.map(({ f, i }) => (
                  <button key={i} className="primary" onClick={() => onSubmit({ t: 'trigger', use: true, face: i })}>
                    {f.name} を使う ({f.isCreature ? '召喚' : '唱える'})
                  </button>
                ))}
              {pending.strike && (
                <>
                  <div className="small">G・ストライク: 相手のクリーチャー1体を選ぶ (このターン攻撃できない)</div>
                  <div className="row">
                    {oppCreatures.map((o) => img(o, { selected: target === o, onClick: () => setTarget(o) }))}
                  </div>
                  <button disabled={target == null} onClick={() => onSubmit({ t: 'trigger', use: true, target })}>
                    G・ストライクを使う
                  </button>
                </>
              )}
              <button onClick={() => onSubmit({ t: 'trigger', use: false })}>使わない (手札に加える)</button>
            </div>
          </div>
        </Modal>
      );
    }
    case 'partner':
      return (
        <Modal title="パートナー">
          <div className="row">
            {img(pending.iid)}
            <div className="col">
              <div>パートナーが{s.cards[pending.iid].zone === 'gone' ? '除外' : 'バトルゾーンを離れ'}ました。裏向きでパートナーゾーンに戻しますか？</div>
              <button className="primary" onClick={() => onSubmit({ t: 'partner', yes: true })}>
                戻す
              </button>
              <button onClick={() => onSubmit({ t: 'partner', yes: false })}>戻さない</button>
            </div>
          </div>
        </Modal>
      );
  }
}

/** ゾーンの中身を一覧表示 (墓地・超次元・山札サーチなど) */
export function ZoneViewer({
  title,
  s,
  L,
  iids,
  hidden,
  sleeve,
  onCard,
  onClose,
  onHover,
  footer,
}: {
  title: string;
  s: GameState;
  L: Lookup;
  iids: number[];
  hidden?: boolean;
  sleeve?: string | null;
  onCard?: (iid: number, e: React.MouseEvent) => void;
  onClose: () => void;
  onHover: (c: Card | null) => void;
  footer?: React.ReactNode;
}) {
  return (
    <Modal title={`${title} (${iids.length}枚)`} onClose={onClose}>
      <div className="row" style={{ maxWidth: 820 }}>
        {iids.map((i) =>
          hidden ? (
            <CardBack key={i} sleeve={sleeve} width={80} />
          ) : (
            <CardImg key={i} card={L(s.cards[i].cid)!} face={s.cards[i].face} width={80} onHover={onHover} onClick={(e) => onCard?.(i, e)} />
          ),
        )}
        {!iids.length && <span className="muted">カードがありません</span>}
      </div>
      {footer}
    </Modal>
  );
}
