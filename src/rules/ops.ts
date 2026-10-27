// 効果テキストを解釈した結果の「効果プログラム」の型。
// エンジン (src/engine/interp.ts) がこれを実行し、選択が必要な時はプレイヤー (CPU) に問い合わせる。

export type Civ = 'L' | 'W' | 'D' | 'F' | 'N';
export type SelZone = 'battle' | 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'hyper' | 'gr' | 'deckTop' | 'underSelf';

/** カードの選択条件 */
export interface Sel {
  /** 誰のカードか */
  owner: 'self' | 'opp' | 'any';
  zones: SelZone[];
  /** カードの種類 */
  kind: 'creature' | 'spell' | 'card' | 'element' | 'crossgear' | 'field' | 'tamaseed' | 'aura' | 'castle' | 'psychic' | 'dragheart' | 'gr' | 'duelist' | 'creatureOrTama';
  civs?: Civ[];
  /** この文明を持たない (「闇以外の」) */
  civNot?: Civ[];
  /** 全ての文明を持つ必要がある (「光と水のクリーチャー」) */
  civAll?: boolean;
  colorless?: boolean;
  multicolor?: boolean;
  /** 多色ではない */
  monocolor?: boolean;
  /** その文明がすべて自分のマナゾーンにある */
  civInMana?: boolean;
  /** 無色ではない */
  notColorless?: boolean;
  /** クリーチャーではない */
  notCreature?: boolean;
  /** サイキックではない */
  notPsychic?: boolean;
  /** コストが (自分のマナの枚数 / 手札の枚数) より小さい・以下 */
  costVs?: { by: 'mana' | 'hand' | 'shield'; cmp: 'lt' | 'le' | 'ge'; ofOwner?: boolean };
  /** この効果のカード自身 */
  self?: boolean;
  /** 「その種族の」「選んだ文明の」「その数字と同じコストの/パワーの」 (直前に選んだ値) */
  raceRef?: boolean;
  /** 選んだカード名 */
  nameRef?: boolean;
  civRef?: boolean;
  costRef?: boolean;
  powerRef?: boolean;
  /** 自分のマナゾーンにあるカードと同じ文明を持つ */
  civShareMana?: boolean;
  /** 裏向き (true) / 表向き (false) のカードだけ */
  faceDown?: boolean;
  /** 表向きのシールド */
  shieldFaceUp?: boolean;
  mono?: boolean;
  races?: string[];
  /** この種族ではない */
  racesNot?: string[];
  nameHas?: string;
  /** 名前にこの文字列を含まない (「《X》以外の」「名前に《X》とあるクリーチャー以外の」) */
  nameNot?: string;
  /** 《名前》のカード */
  name?: string;
  costMin?: number;
  costMax?: number;
  powerMin?: number;
  powerMax?: number;
  tapped?: boolean;
  /** 「ブロッカー」を持つ 等 */
  hasKw?: string;
  /** この能力を持たない */
  hasKwNot?: string;
  /** 自分以外 (「他の」) */
  other?: boolean;
  /** このクリーチャーよりパワーが小さい */
  powerLtSelf?: boolean;
  /** その中でパワーが一番小さい / 大きい */
  extreme?: 'minPower' | 'maxPower';
  /** it (選んだクリーチャー) よりパワーが小さい */
  powerLtIt?: boolean;
  /** it よりコストが小さい */
  costLtIt?: boolean;
  /** it と同じコスト */
  costEqIt?: boolean;
  /** it と共通の文明を持つ */
  civShareIt?: boolean;
  /** コストが数えた数より小さい */
  costLtCount?: boolean;
  /** このターンに出た (召喚酔いしている) */
  enteredThisTurn?: boolean;
  /** it のコスト以下 (「その選んだクリーチャーのコスト以下の」「こうして捨てた手札以下のコストを持つ」) */
  costLeIt?: boolean;
  /** コストが it のコスト + N */
  costItPlus?: number;
  /** コストが数えた数以下 */
  costLeCount?: boolean;
  /** このクリーチャーよりコストが小さい */
  costLtSelf?: boolean;
  evolution?: boolean;
  nonEvolution?: boolean;
  twinpact?: boolean;
  /** どれかに合えばよい (「ドラゴンまたはクロスギア」) */
  or?: Sel[];
}

export type Count = { n: number; upTo: boolean; sumPowerMax?: number; sumCostMax?: number; fromCount?: boolean } | { all: true };

export type Dest = 'grave' | 'hand' | 'mana' | 'manaTapped' | 'manaDown' | 'shield' | 'shieldUp' | 'deckBottom' | 'deckTop' | 'battle' | 'battleTapped' | 'hyper';

/** 効果の対象 */
export type Target =
  | { ref: 'it' } // 直前に選んだカード (「その」「それ」)
  | { ref: 'self' } // この効果の発生源のカード
  | { ref: 'looked'; sel?: Sel; count?: Count } // 山札から見ている/表向きにしたカード (条件・枚数で絞って選ぶ)
  | { ref: 'rest' } // 見ている中で選ばれなかったカード (「残り」)
  | { ref: 'under'; count: Count; sel?: Sel } // このクリーチャーの下にあるカード
  | { ref: 'saved' } // 先に選んで保存しておいたカード
  | { ref: 'host' } // これを装備/クロスしたクリーチャー
  | { ref: 'blocker' } // この攻撃をブロックしたクリーチャー
  | { ref: 'underIt' } // 選んだクリーチャーの下にあるカードすべて
  | { ref: 'leftBehind' } // スター進化で離れた時、下にあったクリーチャー
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
  /** 自分と相手のシールドの数の合計がN以下 */
  | { c: 'totalShieldsLE'; n: number }
  /** 相手の (手札/マナ/シールド) が自分より多い */
  | { c: 'oppMore'; zone: 'hand' | 'mana' | 'shield' | 'battle'; self?: boolean }
  /** このクリーチャーの下にその種類のカードがある (タマシードから進化している) */
  | { c: 'underHas'; kind: 'tamaseed' }
  /** このクリーチャーにカードがN枚以上含まれている */
  | { c: 'selfCardsGE'; n: number }
  /** このクリーチャーの下にあるカードの数 */
  | { c: 'underCount'; cmp: '>=' | '<='; n: number }
  /** そのターン中に他の「ファイナル革命」をまだ使っていない (満たせば使ったことにする) */
  | { c: 'finalRev' }
  /** 手札が1枚もないプレイヤーがいる */
  | { c: 'anyHandEmpty' }
  /** このカードに封印が1つもない */
  | { c: 'noSeals' }
  /** このターン、他にN体以上クリーチャーが破壊されている */
  | { c: 'destroyedThisTurn'; n: number }
  /** このカードは墓地に置かれる直前に進化クリーチャーの下にあった */
  | { c: 'wasUnderEvo' }
  /** 自分のマナゾーンのカードがすべてその文明 */
  | { c: 'manaAllCiv'; civ: Civ }
  /** 自分のマナゾーンにすべての文明が揃っている */
  | { c: 'manaEveryCiv' }
  /** 両方を満たす */
  | { c: 'and'; a: Cond; b: Cond }
  | { c: 'or'; a: Cond; b: Cond }
  | { c: 'not'; a: Cond }
  /** 今の攻撃がこのターン最初の攻撃 */
  | { c: 'firstAttack' }
  /** このターンにN枚以上自分のシールドがブレイクされている */
  | { c: 'brokenGE'; n: number; neg?: boolean }
  /** これを装備/クロスしたクリーチャーがタップしている */
  | { c: 'equippedTapped' }
  /** このクリーチャーがリンクしている (neg: していない) */
  | { c: 'linked'; neg?: boolean }
  /** このクリーチャーが表向きで自分のシールドゾーンにある */
  | { c: 'selfFaceUpShield' }
  /** バトルゾーンにある自分のクリーチャーの数が自分のシールドの数以上 */
  | { c: 'creaturesGEShields'; strict?: boolean }
  /** シールドがN枚未満のプレイヤーがいる */
  | { c: 'anyShieldsLess'; n: number }
  /** このカードは直前までバトルゾーンにあった */
  | { c: 'wasInBattle' }
  /** 選んだカードのコストの合計がN以上 */
  | { c: 'costSum'; sel: Sel; n: number }
  /** S・トリガー・プラス: 相手のターン中で、そのターンに自分のシールドが2つ以上ブレイクされている ({x+} 能力) */
  | { c: 'stPlus' }
  /** その呪文をこのゾーンから唱えた */
  | { c: 'itCastFrom'; zone: 'hand' | 'grave' }
  /** このターン、自分のこの名前のカードがバトルゾーンに出た */
  | { c: 'enteredNameThisTurn'; name: string }
  /** 相手がこのターン、マナゾーンのカードをタップせずにクリーチャーを出すか呪文を唱えた */
  | { c: 'oppFreePlay' }
  /** そのクリーチャーがマナを支払わずに出た */
  | { c: 'itFreeEntered' }
  /** そのクリーチャーがこのターンに攻撃した */
  | { c: 'itAttacked' }
  /** 相手がこのターンにN枚以上引いた */
  | { c: 'oppDrewGE'; n: number }
  /** 自分のバトルゾーンのカードに5文明すべてがある */
  | { c: 'elemEveryCiv' }
  /** 見せた・見たカードがすべてクリーチャーで、コストが同じ */
  | { c: 'lookedSameCost' }
  /** このターンに自分が攻撃した回数 / 唱えた呪文の数 */
  | { c: 'turnCount'; what: 'attacks' | 'spells'; cmp: '>=' | '<=' | '=='; n: number }

export type Op =
  | { op: 'draw'; n: number; upTo?: boolean; who: 'self' | 'opp' | 'itOwner' }
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
  | { op: 'restrict'; target: Target; what: 'attack' | 'attackNext' | 'block' | 'attackBlock' | 'untap' | 'attackMe' | 'attackOpp' }
  | { op: 'discard'; who: 'self' | 'opp'; count: Count; how: 'choose' | 'random' | 'ownerChooses' }
  | { op: 'grSummon'; n: number }
  | { op: 'shuffle'; who?: 'opp' }
  | { op: 'battle'; a: Target; b: Target }
  | { op: 'breakShield'; n: number; own?: boolean }
  /** シールド・山札を見る (自分だけに見える。見たカードは looked) */
  | { op: 'peek'; who: 'self' | 'opp'; zone: 'shield' | 'deck'; n?: number }
  /** sel に合うカードの数だけパワーを変える (このターン) */
  | { op: 'powerPer'; target: Target; per: Sel; each: number; delta: number }
  /** パワーをN倍にする (このターン) */
  | { op: 'multPower'; target: Target; times: number }
  | { op: 'play'; target: Target; mode: 'use' | 'summon' | 'cast' | 'put' }
  | { op: 'optional'; body: Op[]; prompt: string; byOpp?: boolean }
  | { op: 'if'; cond: Cond; body: Op[]; else?: Op[] }
  | { op: 'modal'; pick: number; options: { label: string; body: Op[] }[]; bonus?: Cond; optional?: boolean }
  | { op: 'repeat'; n: number; body: Op[] }
  /** sel に合うカードの数だけ body をくり返す (「自分の〇〇1体につき、〜」) */
  | { op: 'repeatPer'; sel: Sel; body: Op[] }
  /** 各プレイヤーが (手番のプレイヤーから順に) body を行う */
  | { op: 'forEachPlayer'; body: Op[] }
  /** 効果を使うプレイヤーを変える (forEachPlayer の中で使う) */
  | { op: 'setPlayer'; p: number }
  | { op: 'asPlayer'; who: 'self' | 'opp'; body: Op[] }
  /** 直前に it にしたカードの数 (sel に合うもの) だけ body をくり返す (「こうして捨てたカード1枚につき、〜」) */
  | { op: 'repeatIt'; sel?: Sel; body: Op[]; saved?: boolean }
  /** キーワード能力を一時的に与える */
  | { op: 'grant'; target: Target; kws: string[]; until: 'turn' | 'nextOwnTurn' | 'perm' }
  /** 記号つきの能力を使う (others: 自分の他のクリーチャーN体の同じ能力も) */
  | { op: 'useMarked'; key: string; others?: number; perLooked?: Sel; byCiv?: boolean }
  /** ドギラゴン・ガチャ / ドキンダム・ガチャを回して、その能力を使う */
  | { op: 'gacha'; kind: 'dogiragon' | 'dokindam'; times: number }
  /** このターン、次に召喚する〇〇のコストをN少なくする */
  | { op: 'nextSummonDiscount'; sel: Sel; n: number; grants?: string[] }
  /** このターン、クリーチャーをN体マナゾーンから召喚できる */
  | { op: 'manaSummon'; n: number }
  /** it の「出た時」の能力を使う (prefix で始まる能力は除く) */
  | { op: 'useEnterOf'; exclude?: string }
  /** 相手は各ターンN度しか攻撃もブロックもできない (次の自分のターンのはじめまで) */
  | { op: 'actLimit'; n: number }
  /** バトルゾーンに同じ名前のクリーチャーがN体以上あるものを it にする */
  | { op: 'pickSameName'; n: number; ofIt?: boolean }
  /** 無月の門: 自分の魔導具を (バトルゾーンと墓地から each 個ずつ / 合計 total 個) 選び、その上にこのクリーチャーを召喚する */
  | { op: 'mugetsu'; each?: number; total?: number }
  /** 選んだカード (it) 以外の、そのゾーンのカードをすべて to に置く */
  | { op: 'moveOthers'; zone: 'mana' | 'hand' | 'battle'; who: 'self' | 'opp'; to: Dest }
  /** バトルの後で body を行う */
  | { op: 'afterBattle'; body: Op[] }
  /** 数える (sel に合うカードの数 / 文明の数)。結果は「その数」で使う */
  | { op: 'countSet'; sel?: Sel; civsOf?: 'mana' | 'battle'; cardsOfIt?: boolean; aurasOf?: 'it' | 'host'; underSelf?: boolean; players?: boolean }
  /** 「その数だけ〜」: 数えた数 (なければ直前に選んだ数) だけ body をくり返す */
  | { op: 'repeatCount'; body: Op[] }
  /** it のコストと同じ枚数のカードを引く */
  | { op: 'drawItCost' }
  /** この零龍星雲を自分の《滅亡の起源 零無》にリンクする (4枚目で零龍卍誕) */
  | { op: 'zeroLink' }
  /** バトルする it のかわりに、このクリーチャーがバトルする */
  | { op: 'battleInstead' }
  /** 攻撃しているクリーチャーを破壊する */
  | { op: 'destroyAttacker' }
  /** このターン (または次の自分のターンのはじめまで)、自分はゲームに負けず、相手はゲームに勝てない */
  | { op: 'noLose'; until: 'turn' | 'nextOwnTurn' }
  /** 自分はゲームに勝つ (相手全員が負ける) */
  | { op: 'winGame' }
  | { op: 'loseGame' }
  /** 攻撃を中止する */
  | { op: 'cancelAttack' }
  /** 自分の山札の一番下のカードを to に置く */
  | { op: 'deckBottomTo'; to: 'grave' | 'mana' | 'hand' }
  /** このカードを it (バトルゾーンのクリーチャー) の上に置く */
  | { op: 'putOnTop' }
  /** このオーラを it のクリーチャーに付ける */
  | { op: 'attachTo' }
  /** ターンの残りをとばす */
  | { op: 'skipTurn' }
  /** 山札を一番下のN枚を残してすべて墓地に置く */
  | { op: 'millExcept'; who: 'self' | 'opp'; keep: number }
  /** このカードを [コスト] 支払って手札から使う (D・D・D 等) */
  | { op: 'payPlay'; cost: number }
  /** このクリーチャーと it を入れ替える (it はバトルゾーンへ、このクリーチャーは it がいたゾーンへ) */
  | { op: 'swap' }
  /** 手札にあるこのクリーチャーと、バトルゾーンの it を入れ替える (ニンジャ・チェンジ) */
  | { op: 'handSwap' }
  /** 覚醒リンク: 指定の名前のサイキック・クリーチャーとこのクリーチャーを裏返してリンクさせる */
  | { op: 'superLink'; names: string[] }
  | { op: 'manaUntapLimit'; n: number }
  | { op: 'noBattle' }
  /** 封印を付ける (山札の上から裏向きで) */
  | { op: 'seal'; target: Target; n: number }
  /** 封印を外して墓地に置く (self: このカードから / any: 自分のカードのどれかから) */
  | { op: 'unseal'; from: 'self' | 'any'; n: number }
  /** 種族・文明・数字を1つ選ぶ (hostile: 相手に不利な効果に使う) */
  | { op: 'chooseValue'; kind: 'race' | 'civ' | 'number' | 'name'; max?: number; exclude?: string; hostile: boolean; byOpp?: boolean }
  /** 攻撃中の相手クリーチャーの攻撃先を変える (self: このクリーチャー / creature: 自分のクリーチャーのどれか) */
  | { op: 'redirectAttack'; to: 'self' | 'creature' }
  /** このターンの終わりに、このクリーチャーを山札の下に置く */
  | { op: 'endOfTurnBottom' }
  /** ゲーム中に一度だけ (2回目以降は「そうしたら」が成立しない) */
  | { op: 'oncePerGame' }
  /** it をこのカードの下に置く (what: 'it') / このカードを it の下に置く (what: 'self') */
  | { op: 'stackUnder'; what: 'it' | 'self' }
  /** マナゾーンのカードを裏向き/表向きにする */
  | { op: 'faceDown' | 'faceUp'; target: Target }
  /** タップしていればアンタップ、していなければタップ */
  | { op: 'toggleTap'; target: Target }
  /** 相手は呪文を唱えられない */
  | { op: 'lockSpells'; until: 'turn' | 'nextOwnTurn'; costMax?: number; costRef?: boolean }
  | { op: 'lockSummon'; costMax?: number }
  /** it の枚数 + plus 枚引く */
  | { op: 'drawItPlus'; plus: number; mult?: number }
  /** このターンの終わりに body を実行する (it はその時点の it) */
  | { op: 'atTurnEnd'; body: Op[] }
  /** このターン、〜した時に effect を使う (一時的な誘発型能力) */
  | { op: 'tempTrigger'; event: 'ownAttack' | 'oppDestroyed' | 'otherOwnEnter' | 'spellOwn' | 'ownShieldBroken' | 'oppShieldBroken'; effect: string; optional: boolean }
  /** 次の自分のターンのはじめまで、ハイパーモードを解放する */
  | { op: 'hyperMode'; target: Target }
  /** 次の自分のターンのはじめに body を実行する */
  | { op: 'atNextTurnStart'; body: Op[]; opp?: boolean }
  /** ガチンコ・ジャッジ (勝てば did = true) */
  | { op: 'gachinko'; power?: boolean }
  /** 次の自分のターンのはじめにコストを支払う。支払えなければ負ける (逆転撃) */
  | { op: 'payLater'; cost: number }
  /** 山札の上か下に置く (chooser が選ぶ) */
  | { op: 'topOrBottom'; target: Target; chooser: 'self' | 'opp' }
  /** sel に合うカードの数だけ引く (each 体につき mult 枚) */
  | { op: 'drawPer'; sel: Sel; each?: number; mult?: number }
  /** このターンの後に自分のターンを追加する */
  | { op: 'extraTurn' }
  /** ジョーカーズの心絵: 各プレイヤーはクリーチャーとタマシードを最大1つずつ残し、残りを山札に加えてシャッフルし、その数だけシールド化する */
  | { op: 'kokoroe' }
  /** 手札をすべて山札の下に置いて同じ枚数引く */
  | { op: 'cycleHand' }
  /** シールドをすべて山札の下に置いて同じ枚数シールド化する */
  | { op: 'cycleShields' }
  /** 表向きにして持ち主のシールド1つの上に置く */
  | { op: 'shieldOnTop'; target: Target }
  /** 5.S.D.: 持ち主の山札の上から4枚目に横向きに刺す */
  | { op: 'stab'; target: Target }
  /** 「この能力は各ターン1度しか使えない」: 使っていれば残りを実行しない */
  | { op: 'oncePerTurn' }
  /** 相手のバトルゾーンのカードの能力を無視する (costRef: 選んだ数字と同じコストだけ) */
  | { op: 'ignoreAbilities'; until: 'turn' | 'nextOwnTurn'; costRef?: boolean }
  /** クロスギアをコストを支払わずにクロスする (onto: pick は自分のクリーチャーから自動で選ぶ) */
  | { op: 'crossFree'; gear: Target; onto: 'self' | 'it' | 'pick'; otherOnly?: boolean }
  /** パワーが一番小さい (max: 大きい) クリーチャーを破壊する */
  | { op: 'destroyExtreme'; owner: 'self' | 'opp'; max: boolean; n: number }
  /** 山札の上からN枚を、選んだ自分のシールドの下に重ねる */
  | { op: 'shieldStack'; n: number }
  /** パワーをNにする (このターン) */
  | { op: 'setPower'; target: Target; value: number }
  /** 相手とジャンケンで勝敗を決める (勝てば did) */
  | { op: 'janken' }
  /** 負けるまで (times: N回) ガチンコ・ジャッジし、勝った数を数える */
  | { op: 'gachinkoLoop'; power?: boolean; times?: number }
  /** 勝った数だけ body を繰り返す */
  | { op: 'repeatWins'; body: Op[] }
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
  | { op: 'castSelfSpell'; it?: boolean }
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
