import type { DeckType } from '../lib/deck';
import type { Op, Purpose } from '../rules/ops';

export type ZoneName = 'deck' | 'hand' | 'mana' | 'battle' | 'shield' | 'grave' | 'hyper' | 'gr' | 'partner';
export const ZONE_LABEL: Record<ZoneName, string> = {
  deck: '山札',
  hand: '手札',
  mana: 'マナゾーン',
  battle: 'バトルゾーン',
  shield: 'シールドゾーン',
  grave: '墓地',
  hyper: '超次元ゾーン',
  gr: '超GRゾーン',
  partner: 'パートナーゾーン',
};

export interface CardInst {
  iid: number;
  cid: string;
  owner: number;
  /** 'under' = 他のカードの下 (進化元など) */
  zone: ZoneName | 'under' | 'gone';
  tapped: boolean;
  /** このターンにバトルゾーンに出た (召喚酔い) */
  sick: boolean;
  /** 使用中の面 (ツインパクト・サイキックの裏面) */
  face: number;
  under: number[];
  parent: number | null;
  /** ターン終了時まで有効なパワー修正 */
  powerMod: number;
  /** このターン攻撃できない (G・ストライク等) */
  noAttack: boolean;
  /** 表向きか (シールド・パートナー用) */
  faceUp: boolean;
  /** 全員に公開中 (手札公開等) */
  revealed: boolean;
  /** パートナーが裏向きになったターン */
  downTurn?: number;
  /** 「次の○○のターンのはじめまで攻撃/ブロックできない」 (解除するプレイヤー) */
  restrict?: { attack: boolean; block: boolean; until: number; noAttackPlayer?: number };
  /** 次のアンタップを1回しない */
  noUntap?: boolean;
  /** ジャストダイバー (このプレイヤーの次のターンのはじめまで選ばれず攻撃されない) */
  justDive?: number;
  /** EXライフで置いたシールド */
  exShield?: number;
  /** ターンの終わりの処理 (J・O・E: 山札の下へ置いて1枚引く / B・A・D: 破壊) */
  endOfTurn?: 'joe' | 'bad' | 'abyss';
  /** Zラッシュでハイパーモード中 (このプレイヤーのターンのはじめに戻る) */
  hyperUntil?: number;
  /** G・リンクで下に重なっているゴッド (リンク先の一番上のカード) */
  linkedTo?: number;
  /** 覚醒リンクで下に重なっているサイキック・セル (一番上のカード) */
  cellOf?: number;
  /** O・ドライブで追加で支払った文明 */
  odrive?: string[];
  /** 召喚する時にタップしたマナのカードの種族 (フォートE) */
  paidRaces?: string[];
  /** バズレンダで追加で支払った回数 */
  buzz?: number;
  /** ビビッドローで表向きにしたターン */
  vividTurn?: number;
  /** 城として要塞化しているシールド */
  fortOf?: number;
  /** 封印としてこのカードの上に置かれている (付いているカード) */
  sealOf?: number;
  /** 裏向きのマナ (文明を持たない) */
  manaDown?: boolean;
  /** シールド・フォースで選んだシールド */
  forceShield?: number;
  /** 効果で一時的に得たキーワード能力 (until: -1 = ターンの終わりまで / n = プレイヤーnの次のターンのはじめまで) */
  grants?: { kws: string[]; until: number }[];
}

export interface PlayerState {
  uid: string;
  name: string;
  cpu: boolean;
  lost: boolean;
  /** 脱落順 (デュエパ) */
  place: number | null;
  deck: number[];
  hand: number[];
  mana: number[];
  battle: number[];
  shield: number[];
  grave: number[];
  hyper: number[];
  gr: number[];
  partner: number[];
  /** このプレイヤーだけが見ているカード (山札の上を見る等) */
  peek: number[];
  charged: boolean;
  /** このターン、次に召喚するクリーチャーのコスト軽減 */
  nextSummon?: { turn: number; sel: import('../rules/ops').Sel; n: number };
  /** このターン、マナゾーンから召喚できる残りの数 */
  manaSummon?: { turn: number; left: number; staticUsed?: number };
  /** このターン最後に使ったカードの種類 (サイクロン用) */
  lastPlay?: { turn: number; kind: 'creature' | 'spell' | 'other' };
  /** 唱えられない呪文のコストの上限 (なければすべて) */
  spellLockCost?: number;
  /** 唱えられないのはこのコストの呪文だけ */
  spellLockCostEq?: number;
  /** 呪文を唱えられない (このターン番号の間 / このプレイヤーの次のターンのはじめまで) */
  spellLockTurn?: number;
  spellLockUntil?: number;
  /** 「自分はゲームに負けず、相手はゲームに勝てない」 */
  noLose?: { turn?: number; until?: number };
  /** このターンに唱えた呪文の数 */
  spellsCast?: { turn: number; n: number };
  /** このターンに攻撃した回数 */
  attacks?: { turn: number; n: number };
  /** このターンにブレイクされたシールドの数 */
  broken?: { turn: number; n: number };
  /** 「次の自分のターンのはじめまで、相手は各ターンN度しか攻撃もブロックもできない」 (until のプレイヤーのターンのはじめまで) */
  actLimit?: { until: number; n: number; turn: number; atk: number; blk: number };
}

export type Pending =
  | { kind: 'attackOpt'; player: number; options: number[] }
  | { kind: 'block'; player: number; blockers: number[]; ninjas: number[]; guards?: number[] }
  | { kind: 'breakSel'; player: number; target: number; count: number }
  | { kind: 'trigger'; player: number; iid: number; strike: boolean; trigger: boolean }
  | { kind: 'partner'; player: number; iid: number }
  | {
      kind: 'choice';
      player: number;
      mode: 'cards' | 'yesno' | 'modal';
      prompt: string;
      /** 選択肢のカード (cards) */
      options: number[];
      /** 選択肢の文 (modal) */
      labels?: string[];
      min: number;
      max: number;
      purpose: Purpose;
      /** 選んだクリーチャーのパワーの合計の上限 */
      sumPowerMax?: number;
      sumCostMax?: number;
      exec: Exec;
    }
  | {
      kind: 'ability';
      player: number;
      /** 能力の発生源 */
      src: number;
      cid: string;
      face: number;
      event: string;
      text: string;
      effect: string;
      optional: boolean;
      /** 選択や条件がないので自動で実行する */
      auto: boolean;
      /** 誘発させたカード (「そのクリーチャー」「そのカード」) */
      subject?: number;
    };

/** 実行中の効果プログラム */
export interface Exec {
  player: number;
  src: number;
  ops: Op[];
  it: number[];
  looked: number[];
  /** 2つ目の選択の前に保存したカード */
  saved?: number[];
  did: boolean;
  /** 表示用の名前 */
  name: string;
  /** この効果が呪文なら唱えたプレイヤー */
  spellBy?: number;
  /** 選択待ちの対象 */
  pendingIds?: number[];
  /** ガチンコ・ジャッジに勝った数 */
  wins?: number;
  /** 種族・文明・数字の選択肢 */
  valueLabels?: string[];
}

export interface AttackState {
  /** この攻撃中にニンジャ・ストライク等を使った */
  ninjaUsed?: boolean;
  attacker: number;
  owner: number;
  targetPlayer: number;
  targetCard: number | null;
  blocked: number | null;
  step: 'opt' | 'atkTrig' | 'block' | 'resolve' | 'breaking' | 'done';
  /** バトルする時/ブロックされなかった時の能力を発動済み */
  preFired?: boolean;
  /** この攻撃でシールドをブレイクした (キリフダッシュ) */
  broke?: boolean;
}

export interface LogEntry {
  p: number | null;
  m: string;
}

export interface GameInitPlayer {
  uid: string;
  name: string;
  cpu: boolean;
  main: string[];
  hyper: string[];
  gr: string[];
  partner: string | null;
}

export interface GameInit {
  mode: DeckType;
  seed: number;
  players: GameInitPlayer[];
  createdAt: number;
}

export interface GameState {
  /** 回したガチャの記録 (画面のルーレット表示用) */
  gachaLog?: { kind: 'dogiragon' | 'dokindam'; roll: number; player: number }[];
  /** ターンの残りをとばす */
  skipTurnRest?: boolean;
  /** 実行中の効果が呪文なら、唱えたプレイヤー */
  curSpellBy?: number;
  /** ターンの終わりに実行する効果 */
  endTurnExecs?: Exec[];
  /** 「バトルの後で〜」(今のバトルが終わった後に実行) */
  afterBattleExecs?: Exec[];
  /** このターンだけの誘発型能力 */
  tempTriggers?: { player: number; src: number; turn: number; event: string; effect: string; optional: boolean }[];
  /** 「次の自分のターンのはじめに〜」(そのプレイヤーのターンのはじめに実行) */
  startTurnExecs?: Exec[];
  /** このプレイヤーの今のターンの後に、もう一度そのプレイヤーのターン */
  extraTurnFor?: number;
  /** 次のターンのはじめに支払うコスト (逆転撃) */
  debts?: { player: number; cost: number }[];
  /** 直前に選んだ種族・文明・数字 */
  chosenValue?: { race?: string; civ?: string; num?: number };
  /** このターンに誘発した能力の数 (無限ループ防止) */
  turnTriggers?: number;
  /** バトルの結果でクリーチャーを破壊している最中 */
  inBattleNow?: boolean;
  /** 「ゲーム中に一度」を使ったカード */
  onceGame?: number[];
  /** このターンにシールドをブレイクしたクリーチャー (ターボラッシュ用) */
  brokeThisTurn?: number[];
  mode: DeckType;
  rng: number;
  players: PlayerState[];
  cards: CardInst[];
  turn: number;
  active: number;
  firstPlayer: number;
  phase: 'main' | 'attack' | 'over';
  /** ターン内の段階 (はじめ・メイン・終わり) */
  turnStep: 'start' | 'main' | 'ending';
  pending: Pending[];
  attack: AttackState | null;
  log: LogEntry[];
  winners: number[];
  endReason: string;
  /** 適用済みアクション数 */
  seq: number;
  /** パートナーカードのiid (デュエパ) */
  partnerIids: number[];
  /** 攻撃の後に実行する効果 */
  delayed?: Exec[];
  /** このターンに使った「各ターンに1度」の能力 */
  usedOnce?: string[];
}

export type Action =
  | { t: 'charge'; iid: number }
  | {
      t: 'play';
      iid: number;
      face: number;
      pay: number[];
      evo?: number[];
      free?: boolean;
      force?: boolean;
      /** ササゲールで破壊する自分のクリーチャー */
      sasa?: number[];
      /** ハイパーエナジーでタップする自分のクリーチャー */
      he?: number[];
      /** G・ゼロでコストを支払わずに召喚 */
      gzero?: boolean;
      /** 別の出し方 (J・O・E / B・A・D / マナ爆誕 / キリフダッシュ) */
      alt?: 'joe' | 'bad' | 'mana' | 'kirifu' | 'mugen' | 'galaxy' | 'fushigi' | 'abyss' | 'tapCast' | 'vivid';
      /** 召喚する時に捨てる手札 (手札を捨ててコストを少なくする) */
      discards?: number[];
      /** バズレンダで追加で支払う回数 */
      buzz?: number;
      /** O・ドライブで追加でタップするマナ */
      odrivePay?: number[];
      /** ムゲンクライムでタップする自分のクリーチャー */
      taps?: number[];
    }
  | { t: 'hyperize'; iid: number; taps: number[] }
  | { t: 'tapAbility'; iid: number }
  /** ダイナモ: iid をタップして onto にパワーと能力を加える */
  | { t: 'dynamo'; iid: number; onto: number }
  /** クロスギアをクリーチャーにクロスする */
  | { t: 'cross'; iid: number; onto: number; pay: number[] }
  | { t: 'attack'; attacker: number; player: number; card?: number | null; force?: boolean }
  | { t: 'attackOpt'; iid: number | null }
  | { t: 'block'; blocker?: number | null; ninja?: number; guard?: number }
  | { t: 'breakSel'; shields: number[] }
  | { t: 'trigger'; use: boolean; face?: number; target?: number | null }
  | { t: 'partner'; yes: boolean }
  | { t: 'resolve'; use: boolean }
  | { t: 'choose'; picks?: number[]; yes?: boolean; options?: number[] }
  | { t: 'endTurn' }
  | { t: 'concede' }
  // ---- 手動操作 (カード固有の効果を処理するため) ----
  | { t: 'move'; iid: number; to: ZoneName; pos?: 'top' | 'bottom'; tapped?: boolean; faceUp?: boolean }
  | { t: 'tap'; iid: number; v: boolean }
  | { t: 'draw'; n: number }
  | { t: 'shuffle' }
  | { t: 'peekTop'; n: number }
  | { t: 'peekEnd' }
  | { t: 'shieldFromDeck'; n: number }
  | { t: 'manaFromDeck'; n: number; tapped?: boolean }
  | { t: 'mill'; n: number }
  | { t: 'breakManual'; iid: number }
  | { t: 'power'; iid: number; delta: number }
  | { t: 'flip'; iid: number }
  | { t: 'stack'; iid: number; onto: number }
  | { t: 'grSummon' }
  | { t: 'discardRandom'; player: number }
  | { t: 'reveal'; iid: number; v: boolean }
  | { t: 'noAttack'; iid: number }
  | { t: 'note'; m: string };

export interface ActionEnvelope {
  p: number;
  a: Action;
}
