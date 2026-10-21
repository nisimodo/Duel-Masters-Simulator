// 効果テキストを解釈した結果の「効果プログラム」の型。
// エンジン (src/engine/interp.ts) がこれを実行し、選択が必要な時はプレイヤー (CPU) に問い合わせる。

export type Civ = 'L' | 'W' | 'D' | 'F' | 'N';
export type SelZone = 'battle' | 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'hyper' | 'gr' | 'deckTop';

/** カードの選択条件 */
export interface Sel {
  /** 誰のカードか */
  owner: 'self' | 'opp' | 'any';
  zones: SelZone[];
  /** カードの種類 */
  kind: 'creature' | 'spell' | 'card' | 'element' | 'crossgear' | 'field' | 'tamaseed' | 'aura' | 'castle' | 'psychic' | 'dragheart' | 'gr';
  civs?: Civ[];
  /** この文明を持たない (「闇以外の」) */
  civNot?: Civ[];
  /** 全ての文明を持つ必要がある (「光と水のクリーチャー」) */
  civAll?: boolean;
  colorless?: boolean;
  multicolor?: boolean;
  /** 多色ではない */
  monocolor?: boolean;
  mono?: boolean;
  races?: string[];
  nameHas?: string;
  costMin?: number;
  costMax?: number;
  powerMin?: number;
  powerMax?: number;
  tapped?: boolean;
  /** 「ブロッカー」を持つ 等 */
  hasKw?: string;
  /** 自分以外 (「他の」) */
  other?: boolean;
  /** このクリーチャーよりパワーが小さい */
  powerLtSelf?: boolean;
  /** このクリーチャーよりコストが小さい */
  costLtSelf?: boolean;
  evolution?: boolean;
  nonEvolution?: boolean;
  twinpact?: boolean;
}

export type Count = { n: number; upTo: boolean; sumPowerMax?: number } | { all: true };

export type Dest = 'grave' | 'hand' | 'mana' | 'manaTapped' | 'shield' | 'deckBottom' | 'deckTop' | 'battle' | 'battleTapped';

/** 効果の対象 */
export type Target =
  | { ref: 'it' } // 直前に選んだカード (「その」「それ」)
  | { ref: 'self' } // この効果の発生源のカード
  | { ref: 'looked'; sel?: Sel; count?: Count } // 山札から見ている/表向きにしたカード (条件・枚数で絞って選ぶ)
  | { ref: 'rest' } // 見ている中で選ばれなかったカード (「残り」)
  | { ref: 'under'; count: Count } // このクリーチャーの下にあるカード
  | { ref: 'saved' } // 先に選んで保存しておいたカード
  | { ref: 'sel'; sel: Sel; count: Count; chooser: 'self' | 'opp' };

/** 選択の目的 (CPU が選ぶ基準になる) */
export type Purpose = 'hostile' | 'benefit' | 'sacrifice' | 'neutral';

export type Cond =
  | { c: 'count'; sel: Sel; cmp: '>=' | '<=' | '=='; n: number }
  | { c: 'shields'; who: 'self' | 'opp'; cmp: '>=' | '<=' | '=='; n: number }
  | { c: 'shieldsCmp'; cmp: 'oppMore' | 'selfMore' | 'oppLessOrEq' }
  | { c: 'shieldsLess'; who: 'self' | 'opp'; n: number }
  | { c: 'handCount'; who: 'self' | 'opp'; cmp: '>=' | '<=' | '=='; n: number }
  | { c: 'itMatches'; sel: Sel } // 「そのカードがクリーチャーなら」
  | { c: 'itCount'; cmp: '>=' | '<=' | '=='; n: number }
  | { c: 'distinctCosts' } // 表向きにしたカードがすべて異なるコスト
  | { c: 'did' } // 直前の「〜してもよい」を実行した / ガチンコ・ジャッジに勝った
  | { c: 'selfTapped' }
  /** これを装備/クロスしたクリーチャーがタップしている */
  | { c: 'equippedTapped' }
  /** このクリーチャーがリンクしている (neg: していない) */
  | { c: 'linked'; neg?: boolean }
  /** このクリーチャーが表向きで自分のシールドゾーンにある */
  | { c: 'selfFaceUpShield' }

export type Op =
  | { op: 'draw'; n: number; upTo?: boolean; who: 'self' | 'opp' }
  /** 山札の上から N 枚を移動する / 見る / 表向きにする */
  | { op: 'top'; n: number; to: Dest | 'look' | 'reveal'; who: 'self' | 'opp'; nth?: boolean }
  /** 自分の山札をすべて見る (サーチ) */
  | { op: 'lookDeck' }
  /** カードを選んで it に入れる */
  | { op: 'choose'; target: Target; purpose: Purpose; prompt: string }
  | { op: 'move'; target: Target; to: Dest; reveal?: boolean }
  | { op: 'destroy'; target: Target }
  | { op: 'tap' | 'untap'; target: Target }
  | { op: 'power'; target: Target; delta: number; until: 'turn' }
  | { op: 'restrict'; target: Target; what: 'attack' | 'block' | 'attackBlock' | 'untap' }
  | { op: 'discard'; who: 'self' | 'opp'; count: Count; how: 'choose' | 'random' | 'ownerChooses' }
  | { op: 'grSummon'; n: number }
  | { op: 'shuffle' }
  | { op: 'battle'; a: Target; b: Target }
  | { op: 'breakShield'; n: number }
  | { op: 'play'; target: Target; mode: 'use' | 'summon' | 'cast' | 'put' }
  | { op: 'optional'; body: Op[]; prompt: string }
  | { op: 'if'; cond: Cond; body: Op[]; else?: Op[] }
  | { op: 'modal'; pick: number; options: { label: string; body: Op[] }[] }
  | { op: 'repeat'; n: number; body: Op[] }
  /** キーワード能力を一時的に与える */
  | { op: 'grant'; target: Target; kws: string[]; until: 'turn' | 'nextOwnTurn' | 'perm' }
  /** 記号つきの能力を使う (others: 自分の他のクリーチャーN体の同じ能力も) */
  | { op: 'useMarked'; key: string; others?: number }
  /** このカードを [コスト] 支払って手札から使う (D・D・D 等) */
  | { op: 'payPlay'; cost: number }
  /** このクリーチャーと it を入れ替える (it はバトルゾーンへ、このクリーチャーは it がいたゾーンへ) */
  | { op: 'swap' }
  /** タップしていればアンタップ、していなければタップ */
  | { op: 'toggleTap'; target: Target }
  /** 相手は呪文を唱えられない */
  | { op: 'lockSpells'; until: 'turn' | 'nextOwnTurn' }
  /** ガチンコ・ジャッジ (勝てば did = true) */
  | { op: 'gachinko' }
  /** 相手の手札を見る (looked に入れる) */
  | { op: 'lookHand'; who: 'opp' }
  /** 裏返す (覚醒・解除など) */
  | { op: 'flip'; target: Target; to?: 'big' | 'small' | 'creature' }
  /** 攻撃 (バトル) が終わった後に実行する */
  | { op: 'afterAttack'; body: Op[] }
  /** 相手 (各プレイヤー) に対して同じ処理 */
  | { op: 'each'; body: Op[] }
  /** キリフダッシュで召喚 (it のカードをコストを支払って) */
  | { op: 'kirifuPlay' }
  /** このカードの呪文側を唱える (ラスト・バースト等) */
  | { op: 'castSelfSpell' }
  /** 山札の上から条件に合うカードが出るまで表向きにする (見つかったカードが it、全部が looked) */
  | { op: 'revealUntil'; sel: Sel }
  /** 今選んでいるカードを保存 (2つ目の選択のため) */
  | { op: 'save' }
  /** 手札をすべて山札に加える */
  | { op: 'handToDeck' }
  | { op: 'note'; text: string };

/** 解析結果 */
export interface Program {
  ops: Op[];
  /** すべての文を解釈できた */
  complete: boolean;
  /** 解釈できなかった文 */
  unparsed: string[];
}
