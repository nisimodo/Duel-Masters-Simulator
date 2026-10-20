import type { DeckType } from '../lib/deck';

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
}

export type Pending =
  | { kind: 'attackOpt'; player: number; options: number[] }
  | { kind: 'block'; player: number; blockers: number[]; ninjas: number[] }
  | { kind: 'breakSel'; player: number; target: number; count: number }
  | { kind: 'trigger'; player: number; iid: number; strike: boolean; trigger: boolean }
  | { kind: 'partner'; player: number; iid: number }
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
    };

export interface AttackState {
  attacker: number;
  owner: number;
  targetPlayer: number;
  targetCard: number | null;
  blocked: number | null;
  step: 'opt' | 'atkTrig' | 'block' | 'resolve' | 'breaking' | 'done';
  /** バトルする時/ブロックされなかった時の能力を発動済み */
  preFired?: boolean;
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
}

export type Action =
  | { t: 'charge'; iid: number }
  | { t: 'play'; iid: number; face: number; pay: number[]; evo?: number[]; free?: boolean; force?: boolean }
  | { t: 'attack'; attacker: number; player: number; card?: number | null; force?: boolean }
  | { t: 'attackOpt'; iid: number | null }
  | { t: 'block'; blocker?: number | null; ninja?: number }
  | { t: 'breakSel'; shields: number[] }
  | { t: 'trigger'; use: boolean; face?: number; target?: number | null }
  | { t: 'partner'; yes: boolean }
  | { t: 'resolve'; use: boolean }
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
