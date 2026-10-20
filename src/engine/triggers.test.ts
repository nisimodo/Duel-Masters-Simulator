import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { parseTriggers } from '../lib/triggers';
import { applyAction, createGame } from './engine';
import type { Action, GameState } from './types';

describe('parseTriggers', () => {
  const ev = (t: string) => parseTriggers([t]).flatMap((x) => x.events);
  it('detects common timings', () => {
    expect(ev('このクリーチャーが出た時、カードを1枚引く。')).toEqual(['enter']);
    expect(ev('このクリーチャーをバトルゾーンに出した時、カードを1枚引く。')).toEqual(['enter']);
    expect(ev('このクリーチャーが出た時または攻撃する時、相手のクリーチャーを1体破壊する。').sort()).toEqual(['attack', 'enter']);
    expect(ev('相手が呪文を唱えた時、カードを1枚引いてもよい。')).toEqual(['spellOpp']);
    expect(ev('このクリーチャーが破壊された時、カードを1枚引く。')).toEqual(['destroyed']);
    expect(ev('自分のターンのはじめに、山札の上から1枚目をマナゾーンに置く。')).toEqual(['turnStartOwn']);
    expect(ev('自分のターンの終わりに、このクリーチャーをアンタップする。')).toEqual(['turnEndOwn']);
    expect(ev('相手のクリーチャーが出た時、そのクリーチャーをタップする。')).toEqual(['oppEnter']);
    expect(ev('このクリーチャーがバトルに勝った時、カードを1枚引く。')).toEqual(['winBattle']);
    expect(ev('このクリーチャーが相手プレイヤーを攻撃してブロックされなかった時、カードを1枚引く。')).toEqual(['unblocked']);
    expect(ev('これをクロスしたクリーチャーが攻撃する時、カードを1枚引く。')).toEqual(['crossAttack']);
    expect(ev('相手のターン中、このクリーチャーが出た時、カードを1枚引く。')).toEqual(['enter']);
  });
  it('ignores keyword reminder text and replacement effects', () => {
    expect(ev('ブロッカー(相手クリーチャーが攻撃する時、このクリーチャーをタップしてその攻撃を阻止してもよい。その後、その相手クリーチャーとバトルする)')).toEqual([]);
    // 置換効果は発生後に提示する (自動実行はしない)
    expect(ev('このクリーチャーが破壊される時、かわりに手札に戻す。')).toEqual(['destroyed']);
    expect(parseTriggers(['このクリーチャーが破壊される時、かわりに手札に戻す。'])[0].auto).toBe(false);
    expect(ev('革命チェンジ:火または自然のコスト5以上のドラゴン(自分の火または自然のコスト5以上のドラゴンが攻撃する時、そのクリーチャーと手札のこのクリーチャーと入れ替えてもよい)')).toEqual([]);
  });
  it('marks simple mandatory effects as auto', () => {
    expect(parseTriggers(['このクリーチャーが出た時、カードを1枚引く。'])[0].auto).toBe(true);
    expect(parseTriggers(['このクリーチャーが出た時、カードを1枚引いてもよい。'])[0].auto).toBe(false);
    expect(parseTriggers(['このクリーチャーが出た時、相手のクリーチャーを1体破壊する。'])[0].auto).toBe(false);
  });
});

// ---- テスト用の架空カード ----
const cr = (id: string, name: string, cost: number, power: number, text: string[], civ = 'F') => ({
  id,
  n: name,
  img: '',
  f: [{ n: name, t: 'クリーチャー', c: civ, co: cost, p: String(power), r: ['テスト'], x: text }],
});
const sp = (id: string, name: string, cost: number, text: string[], civ = 'F') => ({
  id,
  n: name,
  img: '',
  f: [{ n: name, t: '呪文', c: civ, co: cost, p: null, r: [], x: text }],
});

const db = buildDB(
  [
    cr('draw', 'ドロー君', 1, 1000, ['このクリーチャーが出た時、カードを1枚引く。']),
    cr('watch', '呪文見張り', 1, 1000, ['相手が呪文を唱えた時、カードを1枚引いてもよい。']),
    cr('atk', 'アタッカー', 1, 3000, ['スピードアタッカー', 'このクリーチャーが攻撃する時、カードを1枚引く。']),
    cr('start', '朝の精', 1, 1000, ['自分のターンのはじめに、山札の上から1枚目をマナゾーンに置く。']),
    cr('dead', '遺言', 1, 1000, ['このクリーチャーが破壊された時、カードを2枚引く。']),
    cr('vanilla', 'バニラ', 1, 1000, []),
    sp('kill', '破壊呪文', 1, ['相手のクリーチャーを1体破壊する。']),
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

/** 手札を指定して2人対戦を作る (先攻 = player 0、ターン2から開始) */
function setup(hand0: string[], hand1: string[], battle1: string[] = []): GameState {
  const deck = Array(30).fill('vanilla');
  let s = createGame(
    {
      mode: 'duema',
      seed: 1,
      createdAt: 0,
      players: [
        { uid: 'a', name: 'A', cpu: false, main: [...deck, ...hand0], hyper: [], gr: [], partner: null },
        { uid: 'b', name: 'B', cpu: false, main: [...deck, ...hand1, ...battle1], hyper: [], gr: [], partner: null },
      ],
    },
    L,
  );
  // 手札とバトルゾーンを強制的に組み替える
  s = structuredClone(s);
  const take = (p: number, cid: string) => {
    const pl = s.players[p];
    const iid = pl.deck.find((i) => s.cards[i].cid === cid)!;
    pl.deck.splice(pl.deck.indexOf(iid), 1);
    return iid;
  };
  for (const [p, list] of [
    [0, hand0],
    [1, hand1],
  ] as const) {
    for (const cid of list) {
      const iid = take(p, cid);
      s.cards[iid].zone = 'hand';
      s.players[p].hand.push(iid);
    }
  }
  for (const cid of battle1) {
    const iid = take(1, cid);
    s.cards[iid].zone = 'battle';
    s.players[1].battle.push(iid);
  }
  s.active = 0;
  // マナを用意
  for (let p = 0; p < 2; p++)
    for (let i = 0; i < 3; i++) {
      const iid = s.players[p].deck.pop()!;
      s.cards[iid].zone = 'mana';
      s.players[p].mana.push(iid);
    }
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

function act(s: GameState, p: number, a: Action): GameState {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return r.state;
}
const handIid = (s: GameState, p: number, cid: string) => s.players[p].hand.find((i) => s.cards[i].cid === cid)!;
const pay1 = (s: GameState, p: number) => [s.players[p].mana.find((i) => !s.cards[i].tapped)!];

describe('triggered abilities', () => {
  it('auto-resolves a mandatory "出た時" draw', () => {
    let s = setup(['draw'], []);
    const before = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: handIid(s, 0, 'draw'), face: 0, pay: pay1(s, 0) });
    expect(s.pending).toEqual([]);
    expect(s.players[0].hand.length).toBe(before - 1 + 1);
    expect(s.log.some((l) => l.m.includes('出た時'))).toBe(true);
  });

  it('spell effect waits for resolution, then opponent "相手が呪文を唱えた時" triggers', () => {
    let s = setup(['kill'], [], ['watch']);
    s = act(s, 0, { t: 'play', iid: handIid(s, 0, 'kill'), face: 0, pay: pay1(s, 0) });
    expect(s.pending.map((x) => x.kind === 'ability' && x.event)).toEqual(['spell', 'spellOpp']);
    expect(s.pending[0].player).toBe(0);
    expect(s.pending[1].player).toBe(1);
    // ターンプレイヤーは保留中に攻撃・ターン終了できない
    expect(applyAction(s, 0, { t: 'endTurn' }, L).error).toBeTruthy();
    // 呪文の効果を手動で処理 (相手の見張りを破壊)
    const target = s.players[1].battle[0];
    s = act(s, 0, { t: 'move', iid: target, to: 'grave' });
    s = act(s, 0, { t: 'resolve', use: true });
    // 見張りは破壊されたが、唱えた時の能力はすでに誘発しているので相手が処理する
    expect(s.pending[0].player).toBe(1);
    s = act(s, 1, { t: 'resolve', use: false });
    expect(s.pending).toEqual([]);
  });

  it('"攻撃する時" resolves before the block / break step', () => {
    let s = setup(['atk'], []);
    s = act(s, 0, { t: 'play', iid: handIid(s, 0, 'atk'), face: 0, pay: pay1(s, 0) });
    const att = s.players[0].battle[0];
    const shields = s.players[1].shield.length;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'attack', attacker: att, player: 1 });
    // 自動ドロー → ブレイクするシールドの選択まで進む
    expect(s.players[0].hand.length).toBe(hand + 1);
    expect(s.pending[0].kind).toBe('breakSel');
    s = act(s, 0, { t: 'breakSel', shields: [s.players[1].shield[0]] });
    expect(s.players[1].shield.length).toBe(shields - 1);
    expect(s.attack).toBeNull();
  });

  it('"破壊された時" triggers when destroyed by a manual move', () => {
    let s = setup(['dead'], []);
    s = act(s, 0, { t: 'play', iid: handIid(s, 0, 'dead'), face: 0, pay: pay1(s, 0) });
    const iid = s.players[0].battle[0];
    const hand = s.players[0].hand.length;
    s = act(s, 1, { t: 'move', iid, to: 'grave' });
    expect(s.players[0].hand.length).toBe(hand + 2);
  });

  it('"自分のターンのはじめに" resolves before the draw on the next turn', () => {
    let s = setup(['start'], []);
    s = act(s, 0, { t: 'play', iid: handIid(s, 0, 'start'), face: 0, pay: pay1(s, 0) });
    s = act(s, 0, { t: 'endTurn' });
    s = act(s, 1, { t: 'endTurn' });
    const manaBefore = 3;
    expect(s.active).toBe(0);
    expect(s.players[0].mana.length).toBe(manaBefore + 1);
    expect(s.turnStep).toBe('main');
  });
});
