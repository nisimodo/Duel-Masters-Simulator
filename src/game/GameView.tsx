import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { backend } from '../backend';
import { CardBack, CardDetail, CardImg } from '../components/CardView';
import { useApp } from '../context';
import type { Profile, Room } from '../data/api';
import type { Card, CardDB } from '../lib/cards';
import { cpuPlan, hintActions } from '../engine/cpu';
import { preloadCardImages } from '../lib/preload';
import { AbilityOrderDialog, ActivationDialog } from './Activation';
import { activationOf, orderActivation } from './activationOf';
import { MoveAnimator } from './MoveAnimator';
import { hintsFromText, type EffectHint } from '../engine/effects';
import { EVENT_LABEL } from '../lib/triggers';
import { AWAY_CPU_MS, abilityPick, attackTargets, tapAbilityOf, autoPay, canAttackWith, crossCost, decider, duelistTargets, faceOf, manaSummonLeft, nameOf, power, untappedMana } from '../engine/engine';
import type { Action, ZoneName } from '../engine/types';
import { Modal, PayDialog, PendingDialog, ZoneViewer } from './dialogs';
import { canPlayFromZone, costOf } from '../engine/statics';
import { useGameSync } from './useGameSync';
import { GachaRoulette, type GachaSpin } from './GachaRoulette';
import { NARROW, useMedia } from '../lib/useMedia';

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
  // Esc でメニューを閉じる
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  /** 光っているカードを押して開いた「効果の発動」 */
  const [actOpen, setActOpen] = useState<number | null>(null);
  const [pay, setPay] = useState<{ iid: number; face: number } | null>(null);
  /** カードを何枚か選ぶダイアログ (ハイパー化でタップするクリーチャー等) */
  const [pick, setPick] = useState<{ title: string; n: number; cands: number[]; picks: number[]; done: (picks: number[]) => void } | null>(null);
  // ガチャのルーレット: 新しく回った分を順番に表示する (開いた時点の記録は再生しない)
  const gachaSeen = useRef<number | null>(null);
  const [gachaQueue, setGachaQueue] = useState<GachaSpin[]>([]);
  const gachaCount = s?.gachaLog?.length ?? 0;
  useEffect(() => {
    if (!s) return;
    if (gachaSeen.current == null) {
      gachaSeen.current = gachaCount;
      return;
    }
    if (gachaCount > gachaSeen.current) {
      const fresh = (s.gachaLog ?? []).slice(gachaSeen.current).map((g) => ({ kind: g.kind, roll: g.roll, playerName: s.players[g.player]?.name ?? '' }));
      gachaSeen.current = gachaCount;
      setGachaQueue((q) => [...q, ...fresh]);
    }
  }, [gachaCount, s]);
  const gachaDone = useCallback(() => setGachaQueue((q) => q.slice(1)), []);
  const [viewer, setViewer] = useState<{ kind: ViewerKind; player: number; iid?: number } | null>(null);
  const [toast, setToast] = useState('');
  const [breakPicks, setBreakPicks] = useState<number[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [note, setNote] = useState('');
  const narrow = useMedia(NARROW);
  // 縦が短い画面 (タブレット横向き・ノートPC) でも相手側をコンパクトにして手札を見えるようにする
  const short = useMedia('(max-height: 820px)');
  /** スマホ等で下から引き出すパネル */
  const [drawer, setDrawer] = useState<'none' | 'detail' | 'log'>('none');
  const [detailModal, setDetailModal] = useState<{ card: Card; face?: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const me = s && user ? s.players.findIndex((p) => p.uid === user.uid) : -1;
  // 効果でシールドや山札を見た時は、自分にだけ表示する
  const peekCount = me >= 0 ? (s?.players[me]?.peek.length ?? 0) : 0;
  const peekPrev = useRef(peekCount);
  useEffect(() => {
    if (peekCount > peekPrev.current && !viewer) setViewer({ kind: 'peek', player: me });
    peekPrev.current = peekCount;
  }, [peekCount]);
  const viewerIdx = me >= 0 ? me : 0;

  // 対戦に使う全員のデッキのカード画像を先に読み込んでおく (自分のカードから)
  const hasState = !!s;
  useEffect(() => {
    if (!s) return;
    const ids = [...new Set([...s.cards].sort((a, b) => Number(b.owner === me) - Number(a.owner === me)).map((c) => c.cid))];
    return preloadCardImages(ids.map((id) => db.byId.get(id)).filter((c): c is Card => !!c));
    // (対戦ごとに1回だけ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.gameId, hasState]);

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
  // CPU同士の対戦を観戦する時は、CPUの速さを変えられる
  const [cpuDelay, setCpuDelay] = useState(650);
  const cpuBusy = useRef(false);
  const [cpuTick, setCpuTick] = useState(0);
  useEffect(() => {
    if (!s || s.phase === 'over' || !isRunner || cpuBusy.current) return;
    const d = decider(s);
    // 退出して戻らないプレイヤーもCPUが代わりに操作する
    if (d == null || !(s.players[d].cpu || s.players[d].away === 'cpu')) return;
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
    }, cpuDelay);
    return () => clearTimeout(t);
  }, [s, isRunner, L, submit, cpuTick, cpuDelay]);

  // ---- 対戦中の退出・復帰 ----
  // 退出 (タブを閉じた等) をログに出し、1分戻らなければCPUに切り替える。戻ったら操作を戻す。
  // 判定と送信はCPUを動かしている人が行う (戻った本人も自分の復帰を送る)
  const presenceSent = useRef(new Set<string>());
  useEffect(() => {
    if (!s || s.phase === 'over' || !user) return;
    const timers: number[] = [];
    s.players.forEach((pl, i) => {
      if (pl.cpu || pl.lost) return;
      const online = !!room.members[pl.uid]?.online;
      if (!isRunner && pl.uid !== user.uid) return;
      const send = (state: 'left' | 'cpu' | 'back', at?: number) => {
        // (同じ状態から同じ送信を繰り返さない)
        const k = `${i}:${state}:${s.seq}`;
        if (presenceSent.current.has(k)) return;
        presenceSent.current.add(k);
        void submit(i, { t: 'presence', state, ...(at != null ? { at } : {}) });
      };
      if (online && pl.away) send('back');
      else if (!isRunner) return;
      else if (!online && !pl.away) send('left', Date.now());
      else if (!online && pl.away === 'left') timers.push(window.setTimeout(() => send('cpu'), Math.max(0, (pl.awaySince ?? 0) + AWAY_CPU_MS - Date.now())));
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [s, room.members, isRunner, user, submit]);

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
  /** カードを押して発動する効果 (同時に誘発した能力の順番・S・トリガー・革命チェンジ・「〜してもよい」) */
  const activation = orderActivation(s, me) ?? activationOf(s, myPending);
  /** CPU同士の対戦: 観戦者に手札を見せる */
  const allCpu = s.players.every((p) => p.cpu);
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
    const simple = !f.isEvolution && !(f.statics ?? []).some((x) => x.s === 'sasageru' || x.s === 'hyperEnergy' || x.s === 'gzero');
    if (simple && costOf(s, L, me, iid, face) === 0) act({ t: 'play', iid, face, pay: [] });
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

  /** 「マナゾーン/墓地から召喚してもよい」カードの召喚メニュー */
  const summonFromItems = (iid: number, items: MenuItem[]) => {
    const c = s.cards[iid];
    if (c.owner !== me) return;
    cardAt(iid).faces.forEach((f, fi) => {
      if (cardAt(iid).hyper && fi > 0) return;
      const mg = (f.statics ?? []).find((x) => x.s === 'mugen');
      if (c.zone === 'grave' && mg && mg.s === 'mugen') items.push({ label: `ムゲンクライム (${mg.n}体タップ + コスト${mg.cost})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
      const fg = (f.statics ?? []).find((x) => x.s === 'fushigi');
      if (c.zone === 'grave' && fg && fg.s === 'fushigi') items.push({ label: `フシギバース (基本コスト${fg.n})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
      if (c.zone === 'grave' && (f.statics ?? []).some((x) => x.s === 'abyss')) items.push({ label: `アビスラッシュ (墓地から召喚)`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
      const fromZone = me >= 0 && (f.isCreature || f.isSpell) && canPlayFromZone(s, L, me, iid, f);
      if (f.isCreature && c.zone === 'mana' && me >= 0 && manaSummonLeft(s, L, me, iid) > 0 && !fromZone)
        items.push({ label: `マナゾーンから召喚 (コスト${costOf(s, L, me, iid, fi)})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
      if (fromZone)
        items.push({ label: `${f.isSpell ? '唱える' : '召喚'} (コスト${costOf(s, L, me, iid, fi)})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
      const mb = (f.statics ?? []).find((x) => x.s === 'manaBakutan');
      if (c.zone === 'mana' && mb && mb.s === 'manaBakutan') items.push({ label: `マナ爆誕 (コスト${mb.cost})`, onClick: () => startPlay(iid, fi), disabled: !isMyTurn });
    });
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
          if (card.hyper && fi > 0) return;
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
          if ((f.statics ?? []).some((x) => x.s === 'dynamo')) {
            const cands = s.players[me].battle.filter((b) => b !== iid && (faceOf(s, L, b)?.statics ?? []).some((x) => x.s === 'dynamo'));
            items.push({
              label: 'ダイナモ (パワーと能力を他のダイナモに加える)',
              disabled: !isMyTurn || !cands.length || !canAttackWith(s, L, iid),
              onClick: () => setPick({ title: 'パワーと能力を加えるダイナモを選ぶ', n: 1, cands, picks: [], done: ([onto]) => act({ t: 'dynamo', iid, onto }) }),
            });
          }
          if ((f.statics ?? []).some((x) => x.s === 'rinne')) items.push({ label: '輪廻∞: 呪文側を唱える (コストは支払う)', disabled: !isMyTurn, onClick: () => act({ t: 'rinne', iid }) });
          if (c.zone === 'battle' && tapAbilityOf(s, L, iid)) items.push({ label: 'タップして能力を使う (攻撃のかわり)', disabled: !isMyTurn || c.tapped, onClick: () => act({ t: 'tapAbility', iid }) });
          const hz = card.hyper && c.face === 0 ? card.faces[0].statics.find((x) => x.s === 'hyperize') : undefined;
          if (hz && hz.s === 'hyperize') {
            const cands = s.players[me].battle.filter((b) => b !== iid && !s.cards[b].tapped && faceOf(s, L, b)?.isCreature);
            items.push({
              label: `ハイパー化 (他のクリーチャーを${hz.n}体タップ)`,
              disabled: !isMyTurn || cands.length < hz.n,
              onClick: () => setPick({ title: `ハイパー化: タップするクリーチャーを${hz.n}体選ぶ`, n: hz.n, cands, picks: [], done: (taps) => act({ t: 'hyperize', iid, taps }) }),
            });
          }
        }
        if (own && f && /クロスギア/.test(f.type)) {
          const cands = s.players[me].battle.filter((b) => faceOf(s, L, b)?.isCreature);
          items.push({
            label: 'クリーチャーにクロスする…',
            disabled: !isMyTurn || !cands.length,
            onClick: () =>
              setPick({
                title: `${f.name} をクロスするクリーチャーを選ぶ`,
                n: 1,
                cands,
                picks: [],
                done: ([onto]) => {
                  const pay = autoPay(s, L, me, f.civs, crossCost(s, L, iid, onto));
                  if (!pay) alert('マナが足りません');
                  else act({ t: 'cross', iid, onto, pay });
                },
              }),
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
        summonFromItems(iid, items);
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
        if (c.zone === 'grave' || c.zone === 'hyper') summonFromItems(iid, items);
        if (own) {
          card.faces.forEach((f, fi) => {
            if (card.hyper && fi > 0) return;
            if (f.isCreature || f.isSpell || c.zone === 'hyper')
              items.push({ label: `${f.name} をコストを支払わずに使う`, onClick: () => act({ t: 'play', iid, face: fi, pay: [], free: true, force: true }) });
          });
          items.push(...moveItems(iid, [c.zone as ZoneName]));
        } else if (c.zone === 'grave' || c.zone === 'hyper') items.push(...moveItems(iid, [c.zone as ZoneName]));
        break;
      case 'partner':
        if (own && /デュエリスト/.test(card.faces[0].type)) {
          const used = s.players[me].duelistTurn === s.turn;
          const ts = duelistTargets(s, L, me, iid);
          for (const t of ts) items.push({ label: `デュエリスト: 《${cardAt(t).faces[0].name}》を実行 (コスト${cardAt(t).faces[0].cost})`, disabled: !isMyTurn || used, onClick: () => act({ t: 'duelist', iid, target: t }) });
          if (!ts.length) items.push({ label: 'デュエリスト: 実行できるデュエルメイトがありません', disabled: true, onClick: () => {} });
          break;
        }
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
    if (activation?.cards.includes(iid)) {
      setActOpen(iid);
      return;
    }
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
    const card = cardAt(iid);
    const face = c.zone === 'battle' || c.zone === 'hyper' ? c.face : undefined;
    setHover({ card, face });
    openMenu(e, nameOf(s, L, iid), [{ label: '🔍 カードの詳細', onClick: () => setDetailModal({ card, face }) }, ...cardMenu(iid)]);
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
    // 裏向きのマナは相手には見えない
    if (c.zone === 'mana' && c.manaDown && c.owner !== me)
      return <CardBack key={iid} width={opts.width} title="裏向きのマナ" onClick={(e) => onCardClick(iid, e)} />;
    return (
      <CardImg
        key={iid}
        card={card}
        face={c.face}
        width={opts.width}
        tapped={c.tapped}
        target={isTarget}
        selected={selected}
        glow={activation?.cards.includes(iid)}
        onHover={hov(iid)}
        onClick={(e) => onCardClick(iid, e)}
        onContextMenu={(e) => openMenu(e, nameOf(s, L, iid), cardMenu(iid))}
      >
        {opts.showPower && pw != null && <span className={`pw${c.powerMod ? ' mod' : ''}`}>{pw}</span>}
        {(c.under.length > 0 || (c.zone === 'battle' && c.sick && f?.isCreature && !f.kw.speedAttacker) || c.noAttack || (c.zone === 'mana' && c.manaDown)) && (
          <span className="tag">
            {c.under.length > 0 && `+${c.under.length} `}
            {c.zone === 'battle' && c.sick && f?.isCreature && !f.kw.speedAttacker && '酔 '}
            {c.noAttack && '✕攻'}
            {c.zone === 'mana' && c.manaDown && '裏'}
          </span>
        )}
      </CardImg>
    );
  };

  const pile = (label: string, count: number, node: ReactNode, onClick?: (e: MouseEvent) => void, anchor?: string) => (
    <div className="pile" data-anchor={anchor} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
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
        {pl.away === 'left' && ' (退出中)'}
        {pl.away === 'cpu' && ' (退出中・CPUが操作)'}
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
      <div className="zone hand" data-anchor={`${p}-hand`} style={{ minHeight: pos === 'compact' ? 40 : undefined }}>
        {pl.hand.map((i) =>
          self || s.cards[i].revealed || allCpu ? (
            renderCard(i)
          ) : (
            <CardBack key={i} sleeve={sleeve} width={pos === 'compact' ? 30 : 46} />
          ),
        )}
        {!pl.hand.length && <span className="muted small">手札なし</span>}
      </div>
    );
    const shields = (
      <div className="row shields-row" data-anchor={`${p}-shield`} style={{ gap: 3 }}>
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
      <div className="row piles-row" style={{ gap: 6, alignItems: 'flex-end' }}>
        {pile('山札', pl.deck.length, <CardBack sleeve={sleeve} width={40} />, (e) => openMenu(e, '山札', deckMenu(p)), `${p}-deck`)}
        {pile(
          '墓地',
          pl.grave.length,
          graveTop != null ? <CardImg card={cardAt(graveTop)} width={40} /> : <div className="card" style={{ width: 40, background: '#0004' }} />,
          () => setViewer({ kind: 'grave', player: p }),
          `${p}-grave`,
        )}
        {(pl.hyper.length > 0 || s.mode === 'duema') &&
          pile('超次元', pl.hyper.length, <div className="card" style={{ width: 40, background: '#4c1d95' }} />, () => setViewer({ kind: 'hyper', player: p }), `${p}-hyper`)}
        {(pl.gr.length > 0 || s.mode === 'duema') &&
          pile('GR', pl.gr.length, <CardBack sleeve={null} width={40} />, (e) =>
            openMenu(e, '超GRゾーン', self ? [{ label: 'GR召喚', onClick: () => act({ t: 'grSummon' }) }, { label: '中身を見る', onClick: () => setViewer({ kind: 'gr', player: p }) }] : []),
          `${p}-gr`)}
        {pl.partner.map((i) =>
          pile(/デュエリスト/.test(L(s.cards[i].cid)?.faces[0]?.type ?? '') ? 'デュエリスト' : 'パートナー', 1, s.cards[i].faceUp ? renderCard(i, { width: 40 }) : <CardBack sleeve={sleeve} width={40} />, undefined),
        )}
      </div>
    );
    const battle = (
      <div className="zone" data-anchor={`${p}-battle`} onClick={() => mode.kind === 'stack' && setMode({ kind: 'none' })}>
        {pl.battle.map((i) => renderCard(i, { showPower: true, width: pos === 'compact' ? 44 : undefined }))}
        {!pl.battle.length && <span className="muted small">バトルゾーン</span>}
      </div>
    );
    const mana = (
      <div className="zone mana" data-anchor={`${p}-mana`} onClick={(e) => e.target === e.currentTarget && setViewer({ kind: 'mana', player: p })}>
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
        <div key={p} className={cls} style={style} data-anchor={`${p}-area`}>
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
        <div key={p} className={cls} style={style} data-anchor={`${p}-area`}>
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
      <div key={p} className={cls} style={style} data-anchor={`${p}-area`}>
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
  // (同時に誘発した能力の順番を選んでいる間は、選ばれた能力から処理する)
  const ordering = (abilityPick(s)?.indices.length ?? 0) >= 2;
  const ability = pending?.kind === 'ability' && !ordering ? pending : null;
  const hints = ability ? hintsFromText(ability.effect.split('\n')) : [];
  const queuedAbilities = s.pending.filter((x) => x.kind === 'ability').length;
  const waitingFor = s.players[decider(s) ?? s.active]?.name;

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
        {others.length === 1 && !narrow && !short ? renderPlayer(others[0], 'top') : others.map((p) => renderPlayer(p, 'compact'))}
        {activation && (
          <div className="banner activation-banner">
            <span>
              ⚡ <b>{activation.title}</b>: 光っているカードを押すと発動する効果を確認できます
            </span>
            <span className="activation-cards">
              {activation.cards.map((i) => (
                <CardImg key={i} card={cardAt(i)} face={s.cards[i].zone === 'battle' ? s.cards[i].face : 0} width={34} glow onHover={hov(i)} onClick={() => setActOpen(i)} />
              ))}
            </span>
            {activation.skip && (
              <button className="small" onClick={() => (setActOpen(null), activation.skip && act(activation.skip))}>
                スキップ
              </button>
            )}
          </div>
        )}
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

      <div className={`side${narrow ? ' side-narrow' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="col" style={{ padding: 8, gap: 6 }}>
          <div className="row">
            <b className="grow">
              ターン{s.turn} ・ {s.players[s.active].name}
            </b>
            <span className="badge">{room.rules.mode === 'duema' ? `デュエマ ${room.rules.hof === 'zero' ? '殿堂ゼロ' : ''}${room.rules.format === 'original' ? ' オリジナル' : ''}` : 'デュエパ'}</span>
          </div>
          {me < 0 && (
            <div className="row small" style={{ gap: 6 }}>
              <span className="muted grow">観戦中{allCpu ? ' (CPU同士の対戦・手札を表示)' : ''}</span>
              {isRunner && allCpu && s.phase !== 'over' && (
                <select value={cpuDelay} onChange={(e) => setCpuDelay(Number(e.target.value))} title="CPUの速さ">
                  <option value={1500}>ゆっくり</option>
                  <option value={650}>ふつう</option>
                  <option value={200}>はやい</option>
                </select>
              )}
              {room.hostUid === user?.uid && s.phase !== 'over' && (
                <button className="small danger" onClick={() => confirm('対戦を中止してルームに戻りますか？') && onBackToLobby()}>
                  中止
                </button>
              )}
            </div>
          )}
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
                        スキップ
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="small muted">処理中です…</div>
              )}
            </div>
          )}
        {narrow && (
            <div className="row">
              <button className={`small${drawer === 'detail' ? ' primary' : ''}`} onClick={() => setDrawer(drawer === 'detail' ? 'none' : 'detail')}>
                🔍 詳細
              </button>
              <button className={`small${drawer === 'log' ? ' primary' : ''}`} onClick={() => setDrawer(drawer === 'log' ? 'none' : 'log')}>
                📜 ログ
              </button>
              <span className="grow" />
              <button className="small" onClick={onLeave}>
                退出
              </button>
            </div>
          )}
        </div>
        {(!narrow || drawer === 'detail') && (
          <>
        <div style={{ padding: 8, borderTop: '1px solid var(--line)', maxHeight: '42vh', overflow: 'auto' }}>
          <CardDetail db={db} card={hover?.card ?? null} face={hover?.face} />
        </div>
          </>
        )}
        {(!narrow || drawer === 'log') && (
          <>
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
          </>
        )}
        {!narrow && (
        <div className="row" style={{ padding: 6 }}>
          <button className="small" onClick={onLeave}>
            ルームから退出
          </button>
        </div>
        )}
      </div>

      {activation?.order && actOpen != null && activation.cards.includes(actOpen) && (
        <AbilityOrderDialog
          key={`${s.seq}-${actOpen}`}
          s={s}
          L={L}
          iid={actOpen}
          onHover={(c) => setHover(c ? { card: c } : null)}
          onClose={() => setActOpen(null)}
          onSubmit={(a) => (setActOpen(null), act(a))}
        />
      )}
      {myPending && activation && !activation.order && activation.skip && actOpen != null && activation.cards.includes(actOpen) && (
        <ActivationDialog
          key={`${s.seq}-${actOpen}`}
          s={s}
          L={L}
          pending={myPending}
          iid={actOpen}
          skip={activation.skip!}
          onHover={(c) => setHover(c ? { card: c } : null)}
          onClose={() => setActOpen(null)}
          onSubmit={(a) => (setActOpen(null), act(a))}
        />
      )}
      {myPending && !activation && myPending.kind !== 'breakSel' && myPending.kind !== 'ability' && (
        <PendingDialog
          key={s.seq}
          s={s}
          L={L}
          db={db}
          pending={myPending}
          breakPicks={breakPicks}
          onHover={(c) => setHover(c ? { card: c } : null)}
          onSubmit={(a) => act(a)}
        />
      )}
      {pick && (
        <Modal title={pick.title} onClose={() => setPick(null)}>
          <div className="row">
            {pick.cands.map((b) => (
              <CardImg
                key={b}
                card={cardAt(b)}
                face={s.cards[b].face}
                width={70}
                selected={pick.picks.includes(b)}
                onHover={(c) => setHover(c ? { card: c } : null)}
                onClick={() => setPick({ ...pick, picks: pick.picks.includes(b) ? pick.picks.filter((x) => x !== b) : [...pick.picks, b] })}
              />
            ))}
          </div>
          <button
            className="primary"
            disabled={pick.picks.length !== pick.n}
            onClick={() => {
              pick.done(pick.picks);
              setPick(null);
            }}
          >
            決定 ({pick.picks.length}/{pick.n})
          </button>
        </Modal>
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
      {gachaQueue[0] && <GachaRoulette key={gachaCount - gachaQueue.length} spin={gachaQueue[0]} onDone={gachaDone} />}
      {detailModal && (
        <Modal title="カードの詳細" onClose={() => setDetailModal(null)}>
          <CardDetail db={db} card={detailModal.card} face={detailModal.face} />
        </Modal>
      )}
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
      <MoveAnimator s={s} L={L} me={me} showAll={allCpu} sleeveOf={sleeveOf} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
