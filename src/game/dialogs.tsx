import { matchesSel } from '../engine/interp';
import { CIV_NAME } from '../lib/cards';
import { useMemo, useState } from 'react';
import { CardBack, CardImg } from '../components/CardView';
import type { Card, CardDB, Civ } from '../lib/cards';
import { matchesCond } from '../engine/cond';
import { autoPay, faceOf, nameOf, payCovers, playCost, power, type Lookup } from '../engine/engine';
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
  const statics = f.statics ?? [];
  const sasaN = statics.some((x) => x.s === 'sasageru');
  const heOn = statics.some((x) => x.s === 'hyperEnergy');
  const gz = statics.find((x) => x.s === 'gzero');
  const [sasa, setSasa] = useState<number[]>([]);
  const [he, setHe] = useState<number[]>([]);
  const [gzero, setGzero] = useState(false);
  const disc = statics.find((x) => x.s === 'discountSummon');
  const inMana = s.cards[iid].zone === 'mana' && statics.some((x) => x.s === 'manaBakutan');
  const mugen = statics.find((x) => x.s === 'mugen');
  const fushigi = statics.find((x) => x.s === 'fushigi');
  const galaxy = statics.find((x) => x.s === 'galaxy');
  const fromGrave = s.cards[iid].zone === 'grave';
  const graveAlts = fromGrave ? ([mugen && 'mugen', fushigi && 'fushigi', statics.some((x) => x.s === 'abyss') && 'abyss'].filter(Boolean) as ('mugen' | 'fushigi' | 'abyss')[]) : [];
  const inGrave = fromGrave && !!mugen;
  const [alt, setAlt] = useState<'joe' | 'bad' | 'mana' | 'mugen' | 'fushigi' | 'abyss' | 'galaxy' | 'tapCast' | 'vivid' | undefined>(inMana ? 'mana' : graveAlts[0]);
  const isAura = /オーラ/.test(f.type);
  const tapCast = statics.find((x) => x.s === 'tapCast');
  const vivid = statics.find((x) => x.s === 'vivid');
  const vividOk = !!vivid && s.cards[iid].vividTurn === s.turn && s.cards[iid].zone === 'hand';
  const buzz = statics.find((x) => x.s === 'buzz');
  const odrive = statics.find((x) => x.s === 'odrive');
  const dd = statics.find((x) => x.s === 'discardDiscount');
  const [discards, setDiscards] = useState<number[]>([]);
  const [odCivs, setOdCivs] = useState<string[]>([]);
  // O・ドライブで追加でタップするマナ (支払いに使わないマナから文明が合うものを選ぶ)
  const odPay = (() => {
    if (!odrive || odrive.s !== 'odrive') return [] as number[];
    const free = mana.filter((m) => !pay.includes(m));
    const out: number[] = [];
    for (const r of odrive.reqs) {
      if (!odCivs.includes(r.civ)) continue;
      const cs = free.filter((m) => !out.includes(m) && L(s.cards[m].cid)!.civs.some((x) => CIV_NAME[x] === r.civ)).slice(0, r.n);
      if (cs.length === r.n) out.push(...cs);
    }
    return out;
  })();
  const [buzzN, setBuzzN] = useState(0);
  const [taps, setTaps] = useState<number[]>([]);
  const costNow = (opts: { sasa: number[]; he: number[]; gzero: boolean; alt?: typeof alt; taps?: number[] }) => {
    const c = playCost(s, L, me, { t: 'play', iid, face, pay: [], alt, taps, ...opts }, face);
    return typeof c === 'number' ? c : null;
  };
  const cost = costNow({ sasa, he, gzero });
  const costErr = playCost(s, L, me, { t: 'play', iid, face, pay: [], sasa, he, gzero, alt, taps }, face);
  const tapCands = s.players[me].battle.filter((b) => b !== iid && faceOf(s, L, b)?.isCreature && !s.cards[b].tapped);
  const [pay, setPay] = useState<number[]>(() => autoPay(s, L, me, f.civs as Civ[], costNow({ sasa: [], he: [], gzero: false }) ?? f.cost) ?? []);
  const sasaCands = s.players[me].battle.filter((b) => b !== iid && (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'sasageru'));
  const heCands = s.players[me].battle.filter((b) => b !== iid && faceOf(s, L, b)?.isCreature && !s.cards[b].tapped);
  const refreshPay = (opts: { sasa: number[]; he: number[]; gzero: boolean; alt?: typeof alt; taps?: number[] }) => {
    const c = costNow(opts);
    if (c != null) setPay(autoPay(s, L, me, f.civs as Civ[], c) ?? []);
  };
  const [showAll, setShowAll] = useState(false);
  const ef = statics.find((x) => x.s === 'evoFrom');
  const baseZone = ef && ef.s === 'evoFrom' ? ef.zone : 'battle';
  const baseCands = (baseZone === 'mana' ? s.players[me].mana : baseZone === 'hand' ? s.players[me].hand.filter((h) => h !== iid) : s.players[me].battle).filter((b) => {
    const bf = faceOf(s, L, b);
    if (!bf) return false;
    if (showAll) return true;
    if (isAura) return bf.isCreature && /GR/.test(bf.type);
    const em = statics.find((x) => x.s === 'evoMulti');
    if (em && em.s === 'evoMulti') return bf.isCreature && matchesSel(s, L, b, em.sel);
    const bc = L(s.cards[b].cid)!;
    return (bf.isCreature || (bf.statics ?? []).some((x) => x.s === 'sinkalize')) && (!f.kw.evoCond || (bf.statics ?? []).some((x) => x.s === 'anyEvoBase') || matchesCond(f.kw.evoCond, bc, bf));
  });
  const [evo, setEvo] = useState<number[]>(() => (baseCands.length === 1 ? [baseCands[0]] : []));
  // ソウルシフト・NEO進化の軽減は進化元によって変わる
  const costEvo =
    (evo.length && statics.some((x) => x.s === 'soulShift' || x.s === 'neoDiscount')) || (dd && discards.length === (dd.s === 'discardDiscount' ? dd.n : 0))
      ? playCost(s, L, me, { t: 'play', iid, face, pay: [], evo, alt, taps, sasa, he, gzero, discards: discards.length ? discards : undefined }, face)
      : cost;
  const realCost = typeof costEvo === 'number' ? costEvo : cost;
  const totalCost = realCost != null && buzz && buzz.s === 'buzz' ? realCost + buzzN * buzz.n : realCost;
  const ok = totalCost != null && pay.length === totalCost && (totalCost === 0 || payCovers(L, s, pay, f.civs as Civ[]));
  const needEvo = (f.isEvolution && f.isCreature) || isAura;
  const verb = f.isCreature ? '召喚する' : f.isSpell ? '唱える' : '出す';
  const toggle = (m: number) => setPay(pay.includes(m) ? pay.filter((x) => x !== m) : [...pay, m]);
  return (
    <Modal title={`${f.name} を${verb}`} onClose={onClose}>
      <div className="small">
        コスト {cost ?? '-'}
        {cost != null && cost !== f.cost ? ` (元のコスト ${f.cost})` : ''} / 文明 {f.civs.length ? f.civs.join(',') : '無色'} ・ 選択中 {pay.length}枚{' '}
        {ok ? <span className="ok">✓ 支払い可能</span> : <span className="warn">{typeof costErr === 'string' ? costErr : 'コスト・文明が合いません'}</span>}
      </div>
      {gz && (
        <label className="small">
          <input
            type="checkbox"
            checked={gzero}
            onChange={(e) => {
              setGzero(e.target.checked);
              refreshPay({ sasa, he, gzero: e.target.checked });
            }}
          />{' '}
          G・ゼロ (コストを支払わずに召喚)
        </label>
      )}
      {inMana && <div className="small">マナ爆誕: マナゾーンから召喚します</div>}
      {graveAlts.length > 1 && (
        <div className="row small">
          墓地からの召喚方法:
          {graveAlts.map((g) => (
            <label key={g}>
              <input
                type="radio"
                checked={alt === g}
                onChange={() => {
                  setAlt(g);
                  setTaps([]);
                  refreshPay({ sasa, he, gzero, alt: g, taps: [] });
                }}
              />
              {{ mugen: 'ムゲンクライム', fushigi: 'フシギバース', abyss: 'アビスラッシュ' }[g]}
            </label>
          ))}
        </div>
      )}
      {vividOk && vivid && vivid.s === 'vivid' && (
        <label className="small">
          <input
            type="checkbox"
            checked={alt === 'vivid'}
            onChange={(e) => {
              const v = e.target.checked ? 'vivid' : undefined;
              setAlt(v);
              refreshPay({ sasa, he, gzero, alt: v, taps });
            }}
          />{' '}
          ビビッドロー (コスト{vivid.cost}で召喚)
        </label>
      )}
      {dd && dd.s === 'discardDiscount' && (
        <div className="col" style={{ gap: 2 }}>
          <b className="small">手札を{dd.n}枚捨てると、召喚コストが{dd.d}少なくなる ({discards.length}/{dd.n})</b>
          <div className="row">
            {s.players[me].hand
              .filter((h) => h !== iid)
              .map((h) => (
                <CardImg
                  key={h}
                  card={L(s.cards[h].cid)!}
                  width={50}
                  selected={discards.includes(h)}
                  onHover={onHover}
                  onClick={() => {
                    const next = discards.includes(h) ? discards.filter((x) => x !== h) : [...discards, h].slice(-dd.n);
                    setDiscards(next);
                  }}
                />
              ))}
          </div>
        </div>
      )}
      {odrive && odrive.s === 'odrive' && (
        <div className="row small">
          O・ドライブ (追加でタップ):
          {odrive.reqs.map((r) => (
            <label key={r.civ}>
              <input type="checkbox" checked={odCivs.includes(r.civ)} onChange={(e) => setOdCivs(e.target.checked ? [...odCivs, r.civ] : odCivs.filter((x) => x !== r.civ))} />
              {r.civ}×{r.n}
            </label>
          ))}
          {odCivs.length > 0 && <span className="muted"> → 追加で{odPay.length}枚タップ</span>}
        </div>
      )}
      {buzz && buzz.s === 'buzz' && (
        <label className="small">
          バズレンダ: 追加でコスト{buzz.n}を
          <input type="number" min={0} max={20} value={buzzN} style={{ width: 48 }} onChange={(e) => setBuzzN(Math.max(0, +e.target.value || 0))} />
          回支払う (能力を{1 + buzzN}回使う / 合計コスト {(cost ?? 0) + buzzN * buzz.n})
        </label>
      )}
      {tapCast && tapCast.s === 'tapCast' && (
        <div className="col" style={{ gap: 2 }}>
          <label className="small">
            <input
              type="checkbox"
              checked={alt === 'tapCast'}
              onChange={(e) => {
                const v = e.target.checked ? 'tapCast' : undefined;
                setAlt(v);
                setTaps([]);
                refreshPay({ sasa, he, gzero, alt: v, taps: [] });
              }}
            />{' '}
            コストを支払うかわりに、自分のクリーチャーを{tapCast.n}体タップする
          </label>
          {alt === 'tapCast' && (
            <div className="row">
              {tapCands.map((b) => (
                <CardImg
                  key={b}
                  card={L(s.cards[b].cid)!}
                  face={s.cards[b].face}
                  width={50}
                  selected={taps.includes(b)}
                  onHover={onHover}
                  onClick={() => {
                    const next = taps.includes(b) ? taps.filter((x) => x !== b) : [...taps, b];
                    setTaps(next);
                    refreshPay({ sasa, he, gzero, alt, taps: next });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {alt === 'abyss' && <div className="small">アビスラッシュ: このターンプレイヤーを攻撃でき、ターンの終わりに山札の下に置かれます</div>}
      {galaxy && galaxy.s === 'galaxy' && s.cards[iid].zone === 'hand' && (
        <label className="small">
          <input
            type="checkbox"
            checked={alt === 'galaxy'}
            onChange={(e) => {
              const v = e.target.checked ? 'galaxy' : undefined;
              setAlt(v);
              refreshPay({ sasa, he, gzero, alt: v, taps });
            }}
          />{' '}
          ギャラクシールド (コスト{galaxy.cost}で表向きのシールドとして置く)
        </label>
      )}
      {alt === 'fushigi' && fushigi && fushigi.s === 'fushigi' && (
        <div className="col" style={{ gap: 2 }}>
          <b className="small">フシギバース: マナゾーンに置く自分のクリーチャーを1体 (コスト{fushigi.n} − そのクリーチャーのコスト)</b>
          <div className="row">
            {s.players[me].battle
              .filter((b) => faceOf(s, L, b)?.isCreature)
              .map((b) => (
                <CardImg
                  key={b}
                  card={L(s.cards[b].cid)!}
                  face={s.cards[b].face}
                  width={50}
                  selected={taps.includes(b)}
                  onHover={onHover}
                  onClick={() => {
                    const next = taps.includes(b) ? [] : [b];
                    setTaps(next);
                    refreshPay({ sasa, he, gzero, alt, taps: next });
                  }}
                />
              ))}
          </div>
        </div>
      )}
      {mugen && mugen.s === 'mugen' && (
        <div className="col" style={{ gap: 2 }}>
          {inGrave ? (
            alt === 'mugen' && <b className="small">ムゲンクライム: 墓地から召喚します</b>
          ) : (
            <label className="small">
              <input
                type="checkbox"
                checked={alt === 'mugen'}
                onChange={(e) => {
                  const v = e.target.checked ? 'mugen' : undefined;
                  setAlt(v);
                  refreshPay({ sasa, he, gzero, alt: v, taps });
                }}
              />{' '}
              ムゲンクライム (自分のクリーチャーを{mugen.n}体タップし、コスト{mugen.cost}で召喚)
            </label>
          )}
          {alt === 'mugen' && (
            <>
              <span className="small">タップするクリーチャー ({taps.length}/{mugen.n})</span>
              <div className="row">
                {tapCands.map((b) => (
                  <CardImg
                    key={b}
                    card={L(s.cards[b].cid)!}
                    face={s.cards[b].face}
                    width={50}
                    selected={taps.includes(b)}
                    onHover={onHover}
                    onClick={() => {
                      const next = taps.includes(b) ? taps.filter((x) => x !== b) : [...taps, b];
                      setTaps(next);
                      refreshPay({ sasa, he, gzero, alt, taps: next });
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {disc && disc.s === 'discountSummon' && !inMana && (
        <label className="small">
          <input
            type="checkbox"
            checked={alt === disc.kind}
            onChange={(e) => {
              const v = e.target.checked ? disc.kind : undefined;
              setAlt(v);
              refreshPay({ sasa, he, gzero, alt: v });
            }}
          />{' '}
          {disc.kind === 'joe' ? 'J・O・E' : 'B・A・D'} (コストを{disc.n}少なくして召喚し、ターンの終わりに{disc.kind === 'joe' ? '山札の下に置く' : '破壊する'})
        </label>
      )}
      {sasaN && sasaCands.length > 0 && (
        <div className="col" style={{ gap: 2 }}>
          <b className="small">ササゲール: 破壊する自分のクリーチャー (コストが異なるもの)</b>
          <div className="row">
            {sasaCands.map((b) => (
              <CardImg
                key={b}
                card={L(s.cards[b].cid)!}
                face={s.cards[b].face}
                width={50}
                selected={sasa.includes(b)}
                onHover={onHover}
                onClick={() => {
                  const next = sasa.includes(b) ? sasa.filter((x) => x !== b) : [...sasa, b];
                  setSasa(next);
                  refreshPay({ sasa: next, he, gzero });
                }}
              />
            ))}
          </div>
        </div>
      )}
      {heOn && heCands.length > 0 && (
        <div className="col" style={{ gap: 2 }}>
          <b className="small">ハイパーエナジー: タップする自分のクリーチャー (コストが異なるもの、1体につき-2)</b>
          <div className="row">
            {heCands.map((b) => (
              <CardImg
                key={b}
                card={L(s.cards[b].cid)!}
                face={s.cards[b].face}
                width={50}
                selected={he.includes(b)}
                onHover={onHover}
                onClick={() => {
                  const next = he.includes(b) ? he.filter((x) => x !== b) : [...he, b];
                  setHe(next);
                  refreshPay({ sasa, he: next, gzero });
                }}
              />
            ))}
          </div>
        </div>
      )}
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
            <b>{isAura ? '付けるGRクリーチャー (選ばなければGR召喚して付ける)' : '進化元を選択'}</b>
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
        <button className="primary" disabled={!ok || (needEvo && !isAura && !evo.length && !/NEO/.test(f.type) && !statics.some((x) => x.s === 'deckEvo'))} onClick={() => onSubmit({ t: 'play', iid, face, pay, evo, sasa, he, gzero, alt, taps: alt === 'mugen' || alt === 'fushigi' || alt === 'tapCast' ? taps : undefined, buzz: buzzN || undefined, odrivePay: odPay.length ? odPay : undefined, discards: dd && dd.s === 'discardDiscount' && discards.length === dd.n ? discards : undefined })}>
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
  const [picks, setPicks] = useState<number[]>([]);
  switch (pending.kind) {
    case 'choice': {
      const ok = picks.length >= pending.min && picks.length <= pending.max;
      if (pending.mode === 'yesno')
        return (
          <Modal title="確認">
            <div>{pending.prompt}</div>
            <div className="row">
              <button className="primary" onClick={() => onSubmit({ t: 'choose', yes: true })}>
                はい
              </button>
              <button onClick={() => onSubmit({ t: 'choose', yes: false })}>いいえ</button>
            </div>
          </Modal>
        );
      if (pending.mode === 'modal')
        return (
          <Modal title="効果を選ぶ">
            <div className="small">
              {pending.prompt} ({picks.length}/{pending.max})
            </div>
            <div className="col">
              {(pending.labels ?? []).map((l, i) => (
                <button
                  key={i}
                  className={picks.includes(i) ? 'primary' : ''}
                  style={{ textAlign: 'left', whiteSpace: 'normal' }}
                  onClick={() => setPicks(picks.includes(i) ? picks.filter((x) => x !== i) : [...picks, i].slice(-pending.max))}
                >
                  ▼ {l}
                </button>
              ))}
            </div>
            <button className="primary" disabled={!ok} onClick={() => onSubmit({ t: 'choose', options: picks })}>
              決定
            </button>
          </Modal>
        );
      return (
        <Modal title="カードを選ぶ">
          <div className="small">
            {pending.prompt} ({picks.length}/{pending.min === pending.max ? pending.max : `${pending.min}～${pending.max}`})
          </div>
          <div className="row" style={{ maxWidth: 820 }}>
            {pending.options.map((o) => (
              <div key={o} className="col" style={{ alignItems: 'center', gap: 2 }}>
                {s.cards[o].zone === 'shield' ? (
                  // シールドは裏向きのまま選ぶ
                  <CardBack width={90} onClick={() => setPicks(picks.includes(o) ? picks.filter((x) => x !== o) : [...picks, o].slice(-pending.max))}>
                    {picks.includes(o) && <span className="count">✓</span>}
                  </CardBack>
                ) : (
                  img(o, {
                    selected: picks.includes(o),
                    onClick: () => setPicks(picks.includes(o) ? picks.filter((x) => x !== o) : [...picks, o].slice(-pending.max)),
                  })
                )}
                <span className="small muted">{s.players[s.cards[o].owner]?.name}</span>
              </div>
            ))}
          </div>
          <button className="primary" disabled={!ok} onClick={() => onSubmit({ t: 'choose', picks })}>
            決定
          </button>
        </Modal>
      );
    }
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
      // 選ぶ前に破壊されるなどして、もうブロックできないクリーチャーは出さない
      const blockers = pending.blockers.filter((b) => s.cards[b].zone === 'battle' && !s.cards[b].tapped);
      return (
        <Modal title="ブロック">
          <div className="small">
            {nameOf(s, L, at.attacker)} (パワー{power(s, L, at.attacker, true)}) が {at.targetCard != null ? nameOf(s, L, at.targetCard) : 'あなた'} を攻撃しています
          </div>
          {blockers.length > 0 && <b>ブロッカー</b>}
          <div className="row">
            {blockers.map((b) => (
              <div key={b} className="col" style={{ alignItems: 'center' }}>
                {img(b)}
                <button className="small" onClick={() => onSubmit({ t: 'block', blocker: b })}>
                  ブロック ({power(s, L, b)})
                </button>
              </div>
            ))}
          </div>
          {(pending.guards ?? []).length > 0 && <b>ガードマン (かわりに攻撃される)</b>}
          <div className="row">
            {(pending.guards ?? []).map((g) => (
              <div key={g} className="col" style={{ alignItems: 'center' }}>
                {img(g)}
                <button className="small" onClick={() => onSubmit({ t: 'block', guard: g })}>
                  ガード ({power(s, L, g)})
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
