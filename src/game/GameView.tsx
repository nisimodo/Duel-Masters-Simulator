import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { backend } from '../backend';
import { CardBack, CardDetail, CardImg } from '../components/CardView';
import { useApp } from '../context';
import type { Profile, Room } from '../data/api';
import type { Card, CardDB } from '../lib/cards';
import { cpuPlan, hintActions } from '../engine/cpu';
import { hintsFromText, type EffectHint } from '../engine/effects';
import { EVENT_LABEL } from '../lib/triggers';
import { attackTargets, canAttackWith, decider, faceOf, nameOf, power, untappedMana } from '../engine/engine';
import type { Action, ZoneName } from '../engine/types';
import { Modal, PayDialog, PendingDialog, ZoneViewer } from './dialogs';
import { useGameSync } from './useGameSync';

interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

type Mode =
  | { kind: 'none' }
  | { kind: 'attack'; attacker: number }
  | { kind: 'effect'; hint: EffectHint; picks: number[] }
  | { kind: 'stack'; iid: number };

type ViewerKind = 'grave' | 'hyper' | 'deck' | 'peek' | 'under' | 'gr' | 'mana' | 'hand';

const ZONE_JA: Record<string, string> = { grave: '墓地', hyper: '超次元ゾーン', deck: '山札', peek: '山札の上', under: '下にあるカード', gr: '超GRゾーン', mana: 'マナゾーン', hand: '手札' };

export default function GameView({ room, db, onBackToLobby, onLeave }: { room: Room; db: CardDB; onBackToLobby: () => void; onLeave: () => void }) {
  const { user } = useApp();
  const { state: s, submit, L, error } = useGameSync(room.gameId, db);
  const [hover, setHover] = useState<{ card: Card; face?: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: MenuItem[] } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [pay, setPay] = useState<{ iid: number; face: number } | null>(null);
  const [viewer, setViewer] = useState<{ kind: ViewerKind; player: number; iid?: number } | null>(null);
  const [toast, setToast] = useState('');
  const [breakPicks, setBreakPicks] = useState<number[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [note, setNote] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const me = s && user ? s.players.findIndex((p) => p.uid === user.uid) : -1;
  const viewerIdx = me >= 0 ? me : 0;

  // スリーブ・プレイマットを読み込む
  const uids = useMemo(() => s?.players.filter((p) => !p.cpu).map((p) => p.uid).join(',') ?? '', [s?.players]);
  useEffect(() => {
    if (!uids) return;
    for (const uid of uids.split(',')) {
      backend.get<Profile>(`users/${uid}`).then((p) => p && setProfiles((x) => ({ ...x, [uid]: p })));
    }
  }, [uids]);
  const sleeveOf = (p: number) => {
    const pl = s?.players[p];
    if (!pl) return null;
    if (pl.cpu) {
      const cpuId = pl.uid.replace(/^cpu:/, '');
      const by = room.cpus[cpuId]?.addedBy;
      return by ? profiles[by]?.sleeve : null;
    }
    return profiles[pl.uid]?.sleeve;
  };

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [s?.log.length]);
  useEffect(() => {
    if (s?.pending[0]?.kind !== 'breakSel') setBreakPicks([]);
  }, [s?.pending]);

  const act = useCallback(
    async (a: Action, p = me) => {
      if (p < 0) return;
      const err = await submit(p, a);
      if (err) setToast(err);
      return err;
    },
    [me, submit],
  );

  // ---- CPU (ルームのホストが代わりに動かす) ----
  const onlineMembers = Object.entries(room.members).filter(([, m]) => m.online).map(([u]) => u).sort();
  const runner = room.members[room.hostUid]?.online ? room.hostUid : onlineMembers[0];
  const isRunner = !!user && runner === user.uid;
  const cpuBusy = useRef(false);
  const [cpuTick, setCpuTick] = useState(0);
  useEffect(() => {
    if (!s || s.phase === 'over' || !isRunner || cpuBusy.current) return;
    const d = decider(s);
    if (d == null || !s.players[d].cpu) return;
    const t = setTimeout(async () => {
      if (cpuBusy.current) return;
      cpuBusy.current = true;
      try {
        const plan = cpuPlan(s, d, L);
        let any = false;
        for (const a of plan) {
          const e = await submit(d, a);
          if (e) break;
          any = true;
        }
        if (!any) {
          // 予定の行動が通らなかった時の保険 (どれか1つ通れば先に進む)
          const top = s.pending[0];
          const fallbacks: Action[] = [
            { t: 'resolve', use: false },
            { t: 'block', blocker: null },
            { t: 'attackOpt', iid: null },
            { t: 'trigger', use: false },
            { t: 'partner', yes: false },
            ...(top?.kind === 'breakSel' ? [{ t: 'breakSel', shields: s.players[top.target].shield.slice(0, top.count) } as Action] : []),
            { t: 'endTurn' },
          ];
          for (const f of fallbacks) if (!(await submit(d, f))) break;
        }
      } finally {
        cpuBusy.current = false;
        setCpuTick((x) => x + 1);
      }
    }, 650);
    return () => clearTimeout(t);
  }, [s, isRunner, L, submit, cpuTick]);

  // ---- 結果の記録 ----
  useEffect(() => {
    if (!s || s.phase !== 'over' || !isRunner || room.lastResult) return;
    const names: Record<string, string> = {};
    s.players.forEach((p) => (names[p.uid.replace(/[.#$[\]/]/g, '_')] = p.name));
    backend.update(`rooms/${room.key}`, {
      lastResult: { winners: s.winners.map((w) => s.players[w].uid), names, reason: s.endReason, at: Date.now() },
    });
  }, [s, isRunner, room.key, room.lastResult]);

  if (error) return <div className="page error">{error}</div>;
  if (!s) return <div className="page muted">対戦を準備中…</div>;

  const pending = s.pending[0];
  const myPending = pending && pending.player === me ? pending : null;
  const isMyTurn = s.active === me && !pending && s.phase !== 'over';
  const L2 = L;
  const cardAt = (iid: number) => L2(s.cards[iid].cid)!;
  const hov = (iid: number) => (c: Card | null) => setHover(c ? { card: c, face: s.cards[iid].zone === 'battle' || s.cards[iid].zone === 'hyper' ? s.cards[iid].face : undefined } : null);
  const openMenu = (e: MouseEvent, title: string, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (!items.length) return;
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 40), title, items });
  };

  const startPlay = (iid: number, face: number) => {
    const c = cardAt(iid);
    const f = c.faces[face];
    if (f.cost === 0 && !f.isEvolution) act({ t: 'play', iid, face, pay: [] });
    else setPay({ iid, face });
  };

  // ---- カードごとのメニュー ----
  const moveItems = (iid: number, except: ZoneName[] = []): MenuItem[] => {
    const opts: [ZoneName, string, 'top' | 'bottom' | undefined][] = [
      ['battle', 'バトルゾーンへ', undefined],
      ['hand', '手札へ', undefined],
      ['mana', 'マナゾーンへ', undefined],
      ['grave', '墓地へ (破壊)', undefined],
      ['shield', 'シールドへ', undefined],
      ['deck', '山札の上へ', 'top'],
      ['deck', '山札の下へ', 'bottom'],
    ];
    return opts
      .filter(([z]) => !except.includes(z))
      .map(([z, label, pos]) => ({ label, onClick: () => act({ t: 'move', iid, to: z, pos }) }));
  };

  const cardMenu = (iid: number): MenuItem[] => {
    const c = s.cards[iid];
    const card = cardAt(iid);
    const own = c.owner === me;
    const items: MenuItem[] = [];
    if (me < 0 || s.phase === 'over') return items;
    if (mode.kind === 'stack') return items;
    switch (c.zone) {
      case 'hand':
        if (!own) break;
        card.faces.forEach((f, fi) => {
          const verb = f.isCreature ? '召喚' : f.isSpell ? '唱える' : '使う';
          items.push({ label: `${card.twin ? f.name + ' を' : ''}${verb} (コスト${f.cost})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
        });
        items.push({ label: 'マナチャージ', onClick: () => act({ t: 'charge', iid }), disabled: !isMyTurn || s.players[me].charged });
        items.push({ sep: true, label: '' });
        items.push({ label: c.revealed ? '公開をやめる' : '公開する', onClick: () => act({ t: 'reveal', iid, v: !c.revealed }) });
        items.push(...moveItems(iid, ['hand']));
        break;
      case 'battle': {
        const f = faceOf(s, L, iid);
        if (own && f?.isCreature) {
          items.push({
            label: '攻撃する',
            disabled: !isMyTurn || !canAttackWith(s, L, iid),
            onClick: () => setMode({ kind: 'attack', attacker: iid }),
          });
        }
        items.push({ label: c.tapped ? 'アンタップ' : 'タップ', onClick: () => act({ t: 'tap', iid, v: !c.tapped }) });
        items.push({ label: 'パワー +1000', onClick: () => act({ t: 'power', iid, delta: 1000 }) });
        items.push({ label: 'パワー −1000', onClick: () => act({ t: 'power', iid, delta: -1000 }) });
        items.push({
          label: 'パワーを指定して変更…',
          onClick: () => {
            const v = prompt('パワーの増減 (例: 3000, -2000)');
            if (v && !isNaN(Number(v))) act({ t: 'power', iid, delta: Number(v) });
          },
        });
        if (card.faces.length > 1 && !card.twin) items.push({ label: '裏返す (覚醒・解除など)', onClick: () => act({ t: 'flip', iid }) });
        items.push({ label: c.noAttack ? '攻撃制限を解除' : 'このターン攻撃できない', onClick: () => act({ t: 'noAttack', iid }) });
        if (c.under.length) items.push({ label: `下のカードを見る (${c.under.length})`, onClick: () => setViewer({ kind: 'under', player: c.owner, iid }) });
        if (own) items.push({ label: '他のカードの下に重ねる…', onClick: () => setMode({ kind: 'stack', iid }) });
        items.push({ sep: true, label: '' });
        items.push(...moveItems(iid, ['battle']));
        break;
      }
      case 'mana':
        items.push({ label: c.tapped ? 'アンタップ' : 'タップ', onClick: () => act({ t: 'tap', iid, v: !c.tapped }) });
        if (own) items.push({ label: 'コストを支払わずに使う', onClick: () => act({ t: 'play', iid, face: 0, pay: [], free: true, force: true }) });
        items.push(...moveItems(iid, ['mana']));
        break;
      case 'shield':
        items.push({ label: own ? '手札に加える (ブレイク)' : 'ブレイクする', onClick: () => act({ t: 'breakManual', iid }) });
        if (own) items.push({ label: 'コストを支払わずに使う (シールドから)', onClick: () => act({ t: 'play', iid, face: 0, pay: [], free: true, force: true }) });
        items.push(...moveItems(iid, ['shield', 'hand']).filter((x) => own || !x.label.startsWith('山札')));
        break;
      case 'grave':
      case 'hyper':
      case 'deck':
      case 'gr':
        if (own) {
          card.faces.forEach((f, fi) => {
            if (f.isCreature || f.isSpell || c.zone === 'hyper')
              items.push({ label: `${f.name} をコストを支払わずに使う`, onClick: () => act({ t: 'play', iid, face: fi, pay: [], free: true, force: true }) });
          });
          items.push(...moveItems(iid, [c.zone as ZoneName]));
        } else if (c.zone === 'grave' || c.zone === 'hyper') items.push(...moveItems(iid, [c.zone as ZoneName]));
        break;
      case 'partner':
        if (own && c.faceUp) {
          const f = card.faces.find((x) => x.isCreature) ?? card.faces[0];
          items.push({ label: `召喚 (コスト${f.cost})`, disabled: !isMyTurn, onClick: () => startPlay(iid, card.faces.indexOf(f)) });
        }
        break;
      case 'under':
        items.push(...moveItems(iid));
        break;
    }
    return items;
  };

  // ---- クリック処理 (攻撃対象・効果対象の選択) ----
  const attackTg = mode.kind === 'attack' ? attackTargets(s, L, mode.attacker) : null;
  const effectCands = (() => {
    if (mode.kind !== 'effect') return [] as number[];
    const h = mode.hint;
    const opps = s.players.map((_, i) => i).filter((i) => i !== me && !s.players[i].lost);
    if (h.target === 'oppShield') return opps.flatMap((o) => s.players[o].shield);
    const pool = h.target === 'anyCreature' ? s.players.flatMap((p) => p.battle) : opps.flatMap((o) => s.players[o].battle);
    return pool.filter((i) => faceOf(s, L, i)?.isCreature && (h.maxPower == null || power(s, L, i) <= h.maxPower));
  })();

  const onCardClick = (iid: number, e: MouseEvent) => {
    e.stopPropagation();
    const c = s.cards[iid];
    if (mode.kind === 'attack') {
      if (attackTg?.cards.includes(iid)) {
        act({ t: 'attack', attacker: mode.attacker, player: c.owner, card: iid });
        setMode({ kind: 'none' });
      }
      return;
    }
    if (mode.kind === 'effect') {
      if (effectCands.includes(iid)) {
        const picks = mode.picks.includes(iid) ? mode.picks.filter((x) => x !== iid) : [...mode.picks, iid].slice(-mode.hint.n);
        setMode({ ...mode, picks });
      }
      return;
    }
    if (mode.kind === 'stack') {
      if (c.zone === 'battle' && iid !== mode.iid) act({ t: 'stack', iid: mode.iid, onto: iid });
      setMode({ kind: 'none' });
      return;
    }
    if (myPending?.kind === 'breakSel' && c.zone === 'shield' && c.owner === myPending.target) {
      setBreakPicks(breakPicks.includes(iid) ? breakPicks.filter((x) => x !== iid) : [...breakPicks, iid].slice(-myPending.count));
      return;
    }
    openMenu(e, c.zone === 'hand' && c.owner !== me ? 'カード' : nameOf(s, L, iid), cardMenu(iid));
  };

  const runHint = async (h: EffectHint, targets?: number[]) => {
    for (const a of hintActions(s, me, L, h, targets)) {
      const err = await act(a);
      if (err) break;
    }
  };

  // ---- 描画 ----
  const renderCard = (iid: number, opts: { width?: number; showPower?: boolean } = {}) => {
    const c = s.cards[iid];
    const card = cardAt(iid);
    const f = faceOf(s, L, iid);
    const isTarget = (attackTg?.cards.includes(iid) ?? false) || effectCands.includes(iid);
    const selected = (mode.kind === 'effect' && mode.picks.includes(iid)) || breakPicks.includes(iid) || (mode.kind === 'attack' && mode.attacker === iid);
    const pw = f?.isCreature ? power(s, L, iid) : null;
    return (
      <CardImg
        key={iid}
        card={card}
        face={c.face}
        width={opts.width}
        tapped={c.tapped}
        target={isTarget}
        selected={selected}
        onHover={hov(iid)}
        onClick={(e) => onCardClick(iid, e)}
        onContextMenu={(e) => openMenu(e, nameOf(s, L, iid), cardMenu(iid))}
      >
        {opts.showPower && pw != null && <span className={`pw${c.powerMod ? ' mod' : ''}`}>{pw}</span>}
        {(c.under.length > 0 || (c.zone === 'battle' && c.sick && f?.isCreature && !f.kw.speedAttacker) || c.noAttack) && (
          <span className="tag">
            {c.under.length > 0 && `+${c.under.length} `}
            {c.zone === 'battle' && c.sick && f?.isCreature && !f.kw.speedAttacker && '酔 '}
            {c.noAttack && '✕攻'}
          </span>
        )}
      </CardImg>
    );
  };

  const pile = (label: string, count: number, node: ReactNode, onClick?: (e: MouseEvent) => void) => (
    <div className="pile" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      {node}
      <span>
        {label} {count}
      </span>
    </div>
  );

  const playerTag = (p: number) => {
    const pl = s.players[p];
    const targetable = attackTg?.players.includes(p);
    return (
      <span
        className={`player-name${targetable ? ' target' : ''}`}
        onClick={() => {
          if (targetable && mode.kind === 'attack') {
            act({ t: 'attack', attacker: mode.attacker, player: p });
            setMode({ kind: 'none' });
          }
        }}
      >
        {s.active === p && '▶ '}
        {pl.name}
        {pl.cpu && ' (CPU)'}
        {pl.lost && ` — 敗北${pl.place ? ` (${pl.place}位)` : ''}`}
        {targetable && ' ← ここを攻撃'}
      </span>
    );
  };

  const deckMenu = (p: number): MenuItem[] => {
    if (p !== me) return [];
    return [
      { label: 'カードを1枚引く', onClick: () => act({ t: 'draw', n: 1 }) },
      {
        label: '山札の上を見る…',
        onClick: () => {
          const n = Number(prompt('何枚見ますか？', '3'));
          if (n > 0) act({ t: 'peekTop', n }).then((e) => !e && setViewer({ kind: 'peek', player: me }));
        },
      },
      { label: '山札をサーチ (全部見る)', onClick: () => (act({ t: 'note', m: '山札を見た' }), setViewer({ kind: 'deck', player: me })) },
      { label: '山札をシャッフル', onClick: () => act({ t: 'shuffle' }) },
      { label: '上から1枚をマナへ', onClick: () => act({ t: 'manaFromDeck', n: 1 }) },
      { label: '上から1枚をシールド化', onClick: () => act({ t: 'shieldFromDeck', n: 1 }) },
      { label: '上から1枚を墓地へ', onClick: () => act({ t: 'mill', n: 1 }) },
    ];
  };

  const renderPlayer = (p: number, pos: 'top' | 'bottom' | 'compact') => {
    const pl = s.players[p];
    const self = p === me;
    const sleeve = sleeveOf(p);
    const mat = pl.cpu ? null : profiles[pl.uid]?.playmat;
    const handNode = (
      <div className="zone hand" style={{ minHeight: pos === 'compact' ? 40 : undefined }}>
        {pl.hand.map((i) =>
          self || s.cards[i].revealed ? (
            renderCard(i)
          ) : (
            <CardBack key={i} sleeve={sleeve} width={pos === 'compact' ? 30 : 46} />
          ),
        )}
        {!pl.hand.length && <span className="muted small">手札なし</span>}
      </div>
    );
    const shields = (
      <div className="row" style={{ gap: 3 }}>
        {pl.shield.map((i, k) => (
          <CardBack
            key={i}
            sleeve={sleeve}
            width={pos === 'compact' ? 32 : 44}
            title={`シールド${k + 1}`}
            onClick={(e) => onCardClick(i, e)}
          >
            {(breakPicks.includes(i) || (mode.kind === 'effect' && mode.picks.includes(i))) && <span className="count">✓</span>}
            {effectCands.includes(i) && !breakPicks.includes(i) && <span className="tag">対象</span>}
            {myPending?.kind === 'breakSel' && myPending.target === p && !breakPicks.includes(i) && <span className="tag">選択</span>}
          </CardBack>
        ))}
        {!pl.shield.length && <span className="muted small">シールドなし</span>}
      </div>
    );
    const graveTop = pl.grave[pl.grave.length - 1];
    const piles = (
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        {pile('山札', pl.deck.length, <CardBack sleeve={sleeve} width={40} />, (e) => openMenu(e, '山札', deckMenu(p)))}
        {pile('墓地', pl.grave.length, graveTop != null ? <CardImg card={cardAt(graveTop)} width={40} /> : <div className="card" style={{ width: 40, background: '#0004' }} />, () =>
          setViewer({ kind: 'grave', player: p }),
        )}
        {(pl.hyper.length > 0 || s.mode === 'duema') &&
          pile('超次元', pl.hyper.length, <div className="card" style={{ width: 40, background: '#4c1d95' }} />, () => setViewer({ kind: 'hyper', player: p }))}
        {(pl.gr.length > 0 || s.mode === 'duema') &&
          pile('GR', pl.gr.length, <CardBack sleeve={null} width={40} />, (e) =>
            openMenu(e, '超GRゾーン', self ? [{ label: 'GR召喚', onClick: () => act({ t: 'grSummon' }) }, { label: '中身を見る', onClick: () => setViewer({ kind: 'gr', player: p }) }] : []),
          )}
        {pl.partner.map((i) =>
          pile('パートナー', 1, s.cards[i].faceUp ? renderCard(i, { width: 40 }) : <CardBack sleeve={sleeve} width={40} />, undefined),
        )}
      </div>
    );
    const battle = (
      <div className="zone" onClick={() => mode.kind === 'stack' && setMode({ kind: 'none' })}>
        {pl.battle.map((i) => renderCard(i, { showPower: true, width: pos === 'compact' ? 44 : undefined }))}
        {!pl.battle.length && <span className="muted small">バトルゾーン</span>}
      </div>
    );
    const mana = (
      <div className="zone mana" onClick={(e) => e.target === e.currentTarget && setViewer({ kind: 'mana', player: p })}>
        {pl.mana.map((i) => renderCard(i, { width: pos === 'compact' ? 30 : 48 }))}
        <span className="muted small">
          マナ {untappedMana(s, p)}/{pl.mana.length}
        </span>
      </div>
    );
    const header = (
      <div className="row">
        {playerTag(p)}
        <span className="small muted">
          手札{pl.hand.length} シールド{pl.shield.length} 山札{pl.deck.length}
        </span>
      </div>
    );
    const style = mat ? { backgroundImage: `linear-gradient(rgba(10,12,20,.55), rgba(10,12,20,.55)), url(${mat})` } : undefined;
    const cls = `player-area${s.active === p ? ' active' : ''}${pl.lost ? ' lost' : ''}${pos === 'compact' ? ' opp-compact' : ''}`;
    if (pos === 'bottom')
      return (
        <div key={p} className={cls} style={style}>
          {battle}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {shields}
            {piles}
          </div>
          {mana}
          {header}
          {handNode}
        </div>
      );
    if (pos === 'top')
      return (
        <div key={p} className={cls} style={style}>
          {header}
          {handNode}
          {mana}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {shields}
            {piles}
          </div>
          {battle}
        </div>
      );
    return (
      <div key={p} className={cls} style={style}>
        {header}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col grow" style={{ gap: 2 }}>
            {battle}
            {mana}
          </div>
          <div className="col" style={{ gap: 2 }}>
            {shields}
            {piles}
          </div>
        </div>
      </div>
    );
  };

  const order = s.players.map((_, i) => (viewerIdx + i) % s.players.length);
  const others = order.slice(1);
  const ability = pending?.kind === 'ability' ? pending : null;
  const hints = ability ? hintsFromText(ability.effect.split('\n')) : [];
  const queuedAbilities = s.pending.filter((x) => x.kind === 'ability').length;
  const waitingFor = pending ? s.players[pending.player]?.name : s.players[s.active]?.name;

  // ビューア
  let viewerNode: ReactNode = null;
  if (viewer) {
    const pl = s.players[viewer.player];
    let iids: number[] = [];
    let hidden = false;
    if (viewer.kind === 'under') iids = viewer.iid != null ? s.cards[viewer.iid].under : [];
    else if (viewer.kind === 'peek') iids = pl.peek;
    else if (viewer.kind === 'deck') iids = [...pl.deck].reverse();
    else iids = pl[viewer.kind];
    if (viewer.kind === 'gr' && viewer.player !== me) hidden = true;
    viewerNode = (
      <ZoneViewer
        title={`${pl.name} の${ZONE_JA[viewer.kind]}`}
        s={s}
        L={L}
        iids={iids}
        hidden={hidden}
        sleeve={sleeveOf(viewer.player)}
        onHover={(c) => setHover(c ? { card: c } : null)}
        onClose={() => {
          if (viewer.kind === 'peek') act({ t: 'peekEnd' });
          setViewer(null);
        }}
        onCard={(i, e) => openMenu(e, nameOf(s, L, i), cardMenu(i).length ? cardMenu(i) : moveItems(i))}
        footer={
          viewer.kind === 'deck' || viewer.kind === 'peek' ? (
            <div className="row">
              <span className="small muted">カードをクリックして移動できます。</span>
              <button onClick={() => (act({ t: 'shuffle' }), setViewer(null))}>シャッフルして閉じる</button>
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <div className="game" onClick={() => setMenu(null)}>
      <div className="board">
        {others.length === 1 ? renderPlayer(others[0], 'top') : others.map((p) => renderPlayer(p, 'compact'))}
        {(mode.kind !== 'none' || myPending?.kind === 'breakSel') && (
          <div className="banner">
            {mode.kind === 'attack' && (
              <>
                攻撃対象を選んでください (赤枠のクリーチャー or プレイヤー名){' '}
                <button className="small" onClick={() => setMode({ kind: 'none' })}>
                  キャンセル
                </button>{' '}
                <button
                  className="small"
                  onClick={() => {
                    const target = s.players.findIndex((x, i) => i !== me && !x.lost);
                    act({ t: 'attack', attacker: mode.attacker, player: target, force: true });
                    setMode({ kind: 'none' });
                  }}
                >
                  制限を無視してプレイヤーを攻撃
                </button>
              </>
            )}
            {mode.kind === 'effect' && (
              <>
                {mode.hint.label}: 対象を選んでください ({mode.picks.length}/{mode.hint.n === 99 ? '全' : mode.hint.n}){' '}
                <button className="primary small" onClick={() => (runHint(mode.hint, mode.picks), setMode({ kind: 'none' }))}>
                  決定
                </button>{' '}
                <button className="small" onClick={() => setMode({ kind: 'none' })}>
                  キャンセル
                </button>
              </>
            )}
            {mode.kind === 'stack' && (
              <>
                重ねる先のカードをクリック{' '}
                <button className="small" onClick={() => setMode({ kind: 'none' })}>
                  キャンセル
                </button>
              </>
            )}
            {myPending?.kind === 'breakSel' && <PendingDialog s={s} L={L} db={db} pending={myPending} onSubmit={(a) => act(a)} onHover={(c) => setHover(c ? { card: c } : null)} breakPicks={breakPicks} />}
          </div>
        )}
        {renderPlayer(order[0], 'bottom')}
      </div>

      <div className="side" onClick={(e) => e.stopPropagation()}>
        <div className="col" style={{ padding: 8, gap: 6 }}>
          <div className="row">
            <b className="grow">
              ターン{s.turn} ・ {s.players[s.active].name}
            </b>
            <span className="badge">{room.rules.mode === 'duema' ? `デュエマ ${room.rules.hof === 'zero' ? '殿堂ゼロ' : ''}${room.rules.format === 'original' ? ' オリジナル' : ''}` : 'デュエパ'}</span>
          </div>
          {me < 0 && <div className="small muted">観戦中</div>}
          {s.phase !== 'over' && pending && pending.player !== me && <div className="small warn">{waitingFor} の選択を待っています…</div>}
          {s.phase !== 'over' && !pending && s.active !== me && <div className="small muted">{waitingFor} のターンです</div>}
          {isMyTurn && (
            <div className="row">
              <span className="small">{s.players[me].charged ? '✓ チャージ済' : '○ マナチャージ可'}</span>
              <span className="grow" />
              <button className="gold" onClick={() => (act({ t: 'endTurn' }), setMode({ kind: 'none' }))}>
                ターン終了
              </button>
            </div>
          )}
          {me >= 0 && s.phase !== 'over' && (
            <div className="row">
              <button className="small" onClick={(e) => openMenu(e, '山札', deckMenu(me))}>
                山札操作 ▾
              </button>
              <button
                className="small"
                onClick={(e) =>
                  openMenu(
                    e,
                    'その他',
                    [
                      ...s.players
                        .map((pl, i) => ({ pl, i }))
                        .filter(({ i, pl }) => i !== me && !pl.lost)
                        .map(({ pl, i }) => ({ label: `${pl.name} の手札をランダムに1枚捨てさせる`, onClick: () => act({ t: 'discardRandom', player: i }) })),
                      { label: 'GR召喚', onClick: () => act({ t: 'grSummon' }) },
                      { sep: true, label: '' },
                      { label: '投了する', onClick: () => confirm('投了しますか？') && act({ t: 'concede' }) },
                    ],
                  )
                }
              >
                その他 ▾
              </button>
              {room.hostUid === user?.uid && (
                <button className="small danger" onClick={() => confirm('対戦を中止してルームに戻りますか？') && onBackToLobby()}>
                  中止
                </button>
              )}
            </div>
          )}
          {ability && s.phase !== 'over' && (
            <div className="col panel" style={{ padding: 6, gap: 4, borderColor: 'var(--accent)' }}>
              <div className="row small" style={{ gap: 4 }}>
                <b className="grow">
                  ⚡ {s.players[ability.player].name}: {db.byId.get(ability.cid)?.faces[ability.face]?.name}
                </b>
                <span className="badge">{EVENT_LABEL[ability.event as keyof typeof EVENT_LABEL] ?? ability.event}</span>
                {queuedAbilities > 1 && <span className="badge">残り{queuedAbilities}</span>}
              </div>
              <div
                className="detail-text small"
                onMouseEnter={() => {
                  const c = db.byId.get(ability.cid);
                  if (c) setHover({ card: c, face: ability.face });
                }}
              >
                {ability.text}
              </div>
              {ability.player === me ? (
                <>
                  {hints.map((h, i) => (
                    <button key={i} className="small" onClick={() => (h.target ? setMode({ kind: 'effect', hint: h, picks: [] }) : runHint(h))}>
                      ▶ {h.label}
                      {h.target ? ' (対象を選ぶ)' : ''}
                    </button>
                  ))}
                  <div className="small muted">
                    {hints.length ? 'ボタンで効果を実行するか、' : ''}カードをクリックして効果を処理してから「処理完了」を押してください
                  </div>
                  <div className="row">
                    <button className="primary small" onClick={() => (setMode({ kind: 'none' }), act({ t: 'resolve', use: true }))}>
                      処理完了
                    </button>
                    {ability.optional && (
                      <button className="small" onClick={() => (setMode({ kind: 'none' }), act({ t: 'resolve', use: false }))}>
                        使わない
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="small muted">処理中です…</div>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--line)', maxHeight: '42vh', overflow: 'auto' }}>
          <CardDetail db={db} card={hover?.card ?? null} face={hover?.face} />
        </div>
        <div className="log" ref={logRef}>
          {s.log.map((l, i) => (
            <div key={i} style={{ color: l.m.startsWith('──') ? 'var(--accent)' : undefined }}>
              {l.m}
            </div>
          ))}
        </div>
        {me >= 0 && (
          <form
            className="row"
            style={{ padding: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) act({ t: 'note', m: note.trim() });
              setNote('');
            }}
          >
            <input className="grow" placeholder="メッセージ / メモ" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="small">送信</button>
          </form>
        )}
        <div className="row" style={{ padding: 6 }}>
          <button className="small" onClick={onLeave}>
            ルームから退出
          </button>
        </div>
      </div>

      {myPending && myPending.kind !== 'breakSel' && myPending.kind !== 'ability' && (
        <PendingDialog
          s={s}
          L={L}
          db={db}
          pending={myPending}
          breakPicks={breakPicks}
          onHover={(c) => setHover(c ? { card: c } : null)}
          onSubmit={(a) => act(a)}
        />
      )}
      {pay && (
        <PayDialog
          s={s}
          L={L}
          me={me}
          iid={pay.iid}
          face={pay.face}
          onHover={(c) => setHover(c ? { card: c } : null)}
          onClose={() => setPay(null)}
          onSubmit={async (a) => {
            const err = await act(a);
            if (!err) setPay(null);
          }}
        />
      )}
      {viewerNode}
      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="head">{menu.title}</div>
          {menu.items.map((it, i) =>
            it.sep ? (
              <div key={i} className="sep" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  setMenu(null);
                  it.onClick?.();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
      {s.phase === 'over' && (
        <Modal title="対戦結果">
          <h2 style={{ color: 'var(--accent)' }}>{s.winners.length ? `${s.winners.map((w) => s.players[w].name).join('、')} の勝利！` : '引き分け'}</h2>
          <div className="small muted">決着: {s.endReason}</div>
          {s.mode === 'duepa' && (
            <ol>
              {[...s.players]
                .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
                .map((p) => (
                  <li key={p.uid}>{p.name}</li>
                ))}
            </ol>
          )}
          <div className="row">
            <button className="primary" onClick={onBackToLobby}>
              ルームに戻る
            </button>
          </div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
