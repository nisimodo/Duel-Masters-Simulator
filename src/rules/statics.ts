// 常在型能力 (パワー修正・キーワード付与・コスト増減・選ばれない 等) の解析
import type { Civ, Cond, Sel } from './ops';
import { parseCond } from './parse';

const CIV_OF: Record<string, Civ> = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };
import { parseSel } from './selector';
import { normText, stripReminder } from './text';

/** 誰に効くか (発生源のカードから見て) */
export type StaticTarget = { t: 'self' } | { t: 'cross' } | { t: 'sel'; sel: Sel };

export type ReplaceSubj = { t: 'self' } | { t: 'host' } | { t: 'sel'; sel: Sel; incSelf?: boolean };
export type ReplaceZone = 'hand' | 'mana' | 'deckTop' | 'deckBottom' | 'deckShuffle' | 'shield' | 'underSrc';

/** 効いている条件 */
export type StaticWhen = 'battle' | 'attack' | 'block' | 'oppTurn' | 'ownTurn' | 'always';

export type StaticCond =
  | { c: 'powerAtLeast'; n: number }
  | { c: 'totalShieldsLE'; n: number } // 鬼タイム: 自分と相手のシールドの合計
  | { c: 'countAtLeast'; sel: Sel; n: number }
  /** このターン、自分が呪文をN枚以上唱えている */
  | { c: 'spellsThisTurn'; n: number }
  /** 自分のシールドが N 枚以下 */
  | { c: 'shieldsLE'; n: number }
  /** 自分の手札が N 枚以下 */
  | { c: 'handLE'; n: number }
  /** このクリーチャーが出たターン */
  | { c: 'selfNew' }
  /** パワーがN以下 */
  | { c: 'powerAtMost'; n: number }
  /** このクリーチャーがタップされている */
  | { c: 'selfTapped'; oppTurn?: boolean }
  /** sel に合うものが N 個未満 */
  | { c: 'countLess'; sel: Sel; n: number }
  /** 相手のシールドが N 枚未満 */
  | { c: 'oppShieldsLess'; n: number }
  /** 自分のマナゾーンのカードがすべてその文明 */
  | { c: 'manaAllCiv'; civ: Civ }
  /** 自分のシールドが相手より多い */
  | { c: 'shieldsMore' }
  | { c: 'linked' };

export type StaticSpec =
  | { s: 'power'; target: StaticTarget; delta: number; when: StaticWhen; per?: { sel: Sel; each: number }; cond?: StaticCond; vs?: Sel; perCiv?: boolean; perUnder?: boolean }
  /** この条件を満たす時だけ召喚できる */
  | { s: 'summonOnlyIf'; cond: StaticCond }
  | { s: 'grant'; target: StaticTarget; kws: string[]; when: StaticWhen; cond?: StaticCond }
  | { s: 'cost'; side: 'self' | 'opp' | 'any'; sel: Sel; action: 'summon' | 'cast' | 'use'; delta: number; floor: number }
  | { s: 'untargetable'; bySpellOnly: boolean }
  | { s: 'noAttacked' }
  | { s: 'attackUntapped'; sel?: Sel }
  | { s: 'cantAttackCreatures' }
  | { s: 'unblockableBy'; maxPower?: number; smallerThanSelf?: boolean; sel?: Sel; vsCreature?: boolean }
  /** 自分のクリーチャーは、それよりパワーが小さいクリーチャーにブロックされない */
  | { s: 'ownUnblockableSmaller' }
  /** このクリーチャーは sel に攻撃されない */
  | { s: 'noAttackedBy'; sel: Sel }
  | { s: 'tapMana' }
  | { s: 'rainbowMana' }
  | { s: 'summonFrom'; zone: 'mana' | 'grave' | 'hyper'; cond?: StaticCond }
  /** 自分の〇〇を墓地・マナゾーンから召喚してもよい (バトルゾーンにある間) */
  | { s: 'summonFromSel'; sel: Sel; zone: 'mana' | 'grave' }
  | { s: 'sympathy'; sel: Sel; floor: number; zone?: 'battle' | 'mana'; each?: number }
  /** 出たターンに攻撃できないクリーチャー (全員) */
  | { s: 'newNoAttackSel'; sel: Sel }
  /** 召喚する時、手札をN枚捨てれば召喚コストをD少なくする */
  | { s: 'discardDiscount'; n: number; d: number }
  /** 相手の〇〇は攻撃/ブロックできない */
  | { s: 'oppRestrict'; sel: Sel; attack: boolean; block: boolean; all?: boolean }
  /** 相手はコストを支払わずにクリーチャーを召喚したり呪文を唱えたりできない */
  | { s: 'noFreePlay' }
  | { s: 'sasageru'; n: number }
  | { s: 'gzero'; cond: StaticCond }
  | { s: 'hyperEnergy' }
  | { s: 'poweredBreaker' }
  /** 離れる時、かわりに手札へ (エターナル・Ω) */
  | { s: 'leaveToHand' }
  /** 破壊される時、墓地に置くかわりに別の場所へ */
  | { s: 'destroyTo'; zone: 'hand' | 'mana' | 'deckBottom' | 'deckTop' | 'shield' }
  /** エスケープ: 破壊される時、かわりにシールドを1つ手札へ */
  | { s: 'escape' }
  /** セイバー: 自分の〇〇が破壊される時、かわりにこのクリーチャーを破壊 */
  | { s: 'saver'; sel: Sel }
  /** シールド・セイバー: シールドがブレイクされる時、かわりにこのクリーチャーを破壊 */
  | { s: 'shieldSaver' }
  /** ガードマン: 自分の他のクリーチャーが攻撃される時、かわりにこのクリーチャーを攻撃させる */
  | { s: 'guardman' }
  /** J・O・E / B・A・D: コストをN少なくして召喚し、ターンの終わりに処理 */
  | { s: 'discountSummon'; kind: 'joe' | 'bad'; n: number }
  /** マナ爆誕: マナゾーンからコストNで召喚 */
  | { s: 'manaBakutan'; cost: number }
  /** キリフダッシュ: シールドをブレイクした攻撃の終わりに、コストNで召喚 */
  | { s: 'kirifu'; cost: number }
  /** ハイパー化: 自分の他のクリーチャーをN体タップしてハイパーモードになる */
  | { s: 'hyperize'; n: number }
  /** Zラッシュ: シールドが離れたら、次の自分のターンのはじめまでハイパーモード */
  | { s: 'zrush' }
  /** シンカライズ: このタマシードを進化元にできる */
  | { s: 'sinkalize' }
  /** ムゲンクライムN: 自分のクリーチャーをN体タップし、コストを支払って手札か墓地から召喚 */
  | { s: 'mugen'; n: number; cost: number }
  /** 解除: バトルゾーンを離れるかわりにコストの小さいほうに裏返す */
  | { s: 'release' }
  /** クロスする時のコスト軽減 */
  | { s: 'crossDiscount'; sel: Sel; n: number }
  /** G・リンク: 指定の名前のゴッド (names) か、左/右/中央 G・リンクを持つゴッドとリンクする */
  | { s: 'glink'; names?: string[]; side?: 'L' | 'R' | 'C' }
  /** ギャラクシールド: コストNを支払って表向きのシールドとして置く */
  | { s: 'galaxy'; cost: number }
  /** フシギバース: 自分のクリーチャー1体をマナに置き、N - そのコスト を支払って墓地から召喚 */
  | { s: 'fushigi'; n: number }
  /** アビスラッシュ: 墓地から召喚し、このターンプレイヤーを攻撃でき、ターンの終わりに山札の下へ */
  | { s: 'abyss' }
  /** 自分の他の、名前に《X》とあるエグザイル・クリーチャーを出せない */
  | { s: 'exileLimit'; name: string }
  /** アタック・チャンス: 条件に合う自分のクリーチャーが攻撃する時、手札からコストを支払わずに唱えてもよい */
  | { s: 'attackChance'; sel: Sel }
  /** 表向きでシールドゾーンを離れる時、かわりに墓地に置く */
  | { s: 'faceUpShieldToGrave' }
  /** 可能なら毎ターン攻撃する */
  | { s: 'mustAttack' }
  /** 相手のクリーチャーは可能ならこのクリーチャーを攻撃する */
  | { s: 'lure' }
  /** 相手は呪文を唱えることができない */
  | { s: 'oppSpellLock'; sel?: Sel; ownTurn?: boolean; all?: boolean }
  /** このクリーチャーの攻撃中、相手は「G・ストライク」を使えない */
  | { s: 'noGStrike' }
  /** 召喚する時、手札から〇〇をN枚見せれば召喚コストがD少なくなる (見せられれば自動で見せる) */
  | { s: 'revealDiscount'; sel: Sel; n: number; d: number; floor: number }
  /** 条件を満たさなければ、バトルゾーンにあるこのタマシードはクリーチャーとして扱わない */
  | { s: 'creatureOnlyIf'; cond: StaticCond }
  /** 誰も sel のクリーチャーを召喚できない */
  | { s: 'noSummonSel'; sel: Sel }
  /** すべてのクリーチャーは、可能であれば攻撃する */
  | { s: 'allMustAttack' }
  /** 自分は「S・トリガー」能力を使えない */
  | { s: 'noSTrigger'; who?: 'opp' | 'all'; civ?: Civ }
  /** 誰もターンを追加できない */
  | { s: 'noExtraTurn' }
  /** リンク解除: 離れる時、サイキック・セル1枚を超次元ゾーンへ戻し、残りを裏返す */
  | { s: 'linkRelease' }
  /** エターナル・Κ: 離れる時、かわりに裏向きのマナをN枚表向きにする */
  | { s: 'eternalK'; n: number }
  /** 水晶ソウルN: 召喚する時、裏向きのマナはN枚分になる */
  | { s: 'crystalSoul'; n: number }
  /**
   * 汎用の置換効果 「(主語)が破壊される/離れる時、(条件なら、)かわりに〜」
   * act: stay=とどまる / redirect=墓地のかわりに zone へ / pay=effect を実行してとどまる
   */
  | { s: 'replaceMove'; subj: ReplaceSubj; on: 'destroy' | 'leave'; act: 'stay' | 'redirect' | 'pay'; zone?: ReplaceZone; effect?: string; cond?: Cond; oppTurn?: boolean; oppSpell?: boolean; fromHand?: boolean; oncePerTurn?: boolean }
  /** このクリーチャーが破壊される/離れる時、かわりに〜 (effect を実行してとどまる) */
  | { s: 'replaceLeave'; on: 'destroy' | 'leave'; effect: string; cross?: boolean }
  /** コストを支払うかわりに、自分の〇〇をN体タップして使う */
  | { s: 'tapCast'; sel: Sel; n: number }
  /** タップしてバトルゾーンに出る */
  | { s: 'entersTapped' }
  /** 出たターンでも相手プレイヤーを攻撃できる */
  | { s: 'hastePlayer' }
  /** 破壊されない (inBattle: バトル中だけ) */
  | { s: 'indestructible'; inBattle?: boolean }
  /** 自分のターンのはじめにアンタップしない */
  | { s: 'noUntapStart'; cond?: StaticCond }
  /** 封印が付いていれば離れない */
  | { s: 'sealStay' }
  /** 可能であればブロックする */
  | { s: 'mustBlock' }
  /** 相手のクリーチャーは、可能であればブロックする */
  | { s: 'oppMustBlock' }
  /** サバキZ: 裁きの紋章が自分のシールドゾーンから手札に加えられた時、それを捨ててこのクリーチャーを召喚できる */
  | { s: 'sabakiZ' }
  /** S・バック: その条件のカードがシールドから手札に加えられた時、それを捨ててこのクリーチャーを出せる */
  | { s: 'sBack'; sel: Sel }
  /** 自分のターン中、クリーチャーをN体、自分のマナゾーンから召喚してもよい */
  | { s: 'manaSummonTurn'; n: number; sel?: Sel; newOnly?: boolean }
  /** 攻撃の終わりにアンタップする */
  | { s: 'untapAfterAttack' }
  /** このクリーチャーの攻撃の終わりに、このクリーチャーを破壊する */
  | { s: 'destroyAfterAttack' }
  /** このクリーチャーはシールドをブレイクできない */
  | { s: 'noBreak' }
  /** G・ブレイカー: 相手のシールドをすべてブレイクし、その攻撃の後、自分のシールドをすべてブレイクする */
  | { s: 'gBreaker' }
  /** このクリーチャーは召喚できない */
  | { s: 'noSummon'; fromHand?: boolean }
  /** 相手のクリーチャーは出たターン、攻撃できない */
  | { s: 'oppNewNoAttackAll' }
  /** 相手のクリーチャーは可能なら攻撃する */
  | { s: 'oppMustAttack'; cond?: StaticCond }
  /** 輪廻∞: このカードの呪文側を、バトルゾーンに置いたまま (コストを支払って) 唱えてもよい。そうした時 bonus */
  | { s: 'rinne'; bonus?: string }
  /** 相手のクリーチャーは出たターン、自分を攻撃できない */
  | { s: 'oppNewNoAttack' }
  /** 相手のクリーチャーは自分を攻撃できない (条件つき) */
  | { s: 'oppNoAttackMe'; cond?: StaticCond }
  /** タップされていないクリーチャーを攻撃できる (条件つき) */
  | { s: 'attackUntappedIf'; cond: StaticCond }
  /** 条件つきで、このクリーチャーの召喚コストを増減する */
  | { s: 'selfCost'; delta: number; cond?: StaticCond; floor: number }
  /** 〇ステルス: 相手のマナゾーンにその文明のカードがあればブロックされない */
  | { s: 'stealth'; civ: Civ }
  /** 〇スレイヤー: その文明のクリーチャーとバトルした時、相手を破壊する */
  | { s: 'civSlayer'; civs: Civ[] }
  /** 相手のカードはマナゾーンにタップして置かれる */
  | { s: 'oppManaTapped' }
  /** 相手のクリーチャーはタップしてバトルゾーンに出る */
  | { s: 'oppEntersTapped'; sel?: Sel; all?: boolean }
  /** バトルに勝っても、バトルの後に破壊される */
  | { s: 'dieAfterBattle' }
  /** どの種族の進化クリーチャーも上に置ける */
  | { s: 'anyEvoBase' }
  /** 選んでよい (効果に影響しない) 注記 */
  | { s: 'note' }
  /** 「火・自然ブロッカー」「ドラゴン・ブロッカー」: 条件に合う相手クリーチャーだけブロックできる */
  | { s: 'limitedBlocker'; sel: Sel }
  /** 離れる時、条件を満たせばかわりにとどまる */
  | { s: 'stayIf'; cond: 'always' | 'tapped' | 'oppSpell' | 'hasUnder'; powerGt?: number; ownSel?: Sel; oppSel?: Sel }
  /** 「ブロックされた/ブロックした場合、バトルは行われない」 */
  | { s: 'noBlockBattle'; blocking: boolean }
  /** シールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く */
  | { s: 'breakToGrave' }
  /** バトルゾーンを離れない */
  | { s: 'neverLeave' }
  /** このカードがバトルゾーン以外のゾーンにあれば負ける */
  | { s: 'loseIfLeave' }
  /** 城: 自分のシールドをN枚選び、付けて要塞化する */
  | { s: 'castle'; n: number }
  /** タップしていても、アンタップしてブロックできる */
  | { s: 'untapBlocker' }
  /** 相手のターン中に手札から捨てられる時、かわりにバトルゾーンに出す */
  | { s: 'discardToBattle' }
  /** ダイナモ: タップして、パワーと能力を自分の他のダイナモ1体に加える */
  | { s: 'dynamo' }
  /** デッキ進化: 山札の上のクリーチャーを進化元にする */
  | { s: 'deckEvo' }
  /** O・ドライブ: 召喚する時に、文明ごとに追加でN枚タップすれば能力を得る */
  | { s: 'odrive'; reqs: { civ: string; n: number }[] }
  /** バズレンダ: 追加でコストNを好きな回数支払い、{OL} 能力を 1+その回数 使う */
  | { s: 'buzz'; n: number }
  /** ビビッドロー: 自分のターン中、攻撃の前にドローした時に表向きにすれば、このターンコストNで召喚できる */
  | { s: 'vivid'; cost: number }
  /** 進化GV・超無限進化: N体 (以上) を重ねた上に置く */
  | { s: 'evoMulti'; min: number; exact: boolean; sel: Sel }
  /** ソウルシフト: 進化元のコストだけ召喚コストが少なくなる */
  | { s: 'soulShift' }
  /** NEO進化クリーチャーとして召喚するならコストをN少なく */
  | { s: 'neoDiscount'; n: number; from?: string }
  /** ウラ・ニンジャ・ストライクN(文明): 相手のクリーチャーが攻撃した時、手札から召喚してターンの終わりに山札の下へ */
  | { s: 'uraNinja'; n: number; civ?: string }
  /** マナ進化・手札進化: 進化元を他のゾーンから選ぶ */
  | { s: 'evoFrom'; zone: 'mana' | 'hand'; sel: Sel; n: number };

function floorOf(t: string): number {
  // 「ただし、コストは1以下にはならない」→ 最低2、「コストは1より少なくならない」→ 最低1
  const m1 = t.match(/コストは(\d+)以下に(は)?ならない/);
  if (m1) return +m1[1] + 1;
  const m2 = t.match(/コストは(\d+)より少なくならない/);
  if (m2) return +m2[1];
  return 1;
}

function target(phrase: string): StaticTarget | null {
  const p = phrase.replace(/\s+/g, '').replace(/^バトルゾーンにある/, '').replace(/^すべての/, '');
  if (/^この(クリーチャー|タマシード|カード)$/.test(p)) return { t: 'self' };
  if (/^これを(クロスした|付けた|装備した)(クリーチャー)?$/.test(p)) return { t: 'cross' };
  const m = p.match(/^(.+?)(?:すべて|全体)?$/);
  if (m) {
    const sel = parseSel(m[1].replace(/すべて$/, ''));
    if (sel) return { t: 'sel', sel };
  }
  return null;
}

function parseCondPrefix(t: string): { cond?: StaticCond; rest: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:鬼タイム:)?自分と相手のシールドの数が合計(\d+)つ以下なら、(.+)$/))) return { cond: { c: 'totalShieldsLE', n: +m[1] }, rest: m[2] };
  if ((m = t.match(/^(?:バトルゾーンにある)?自分の他のクリーチャーが(\d+)体以下なら、(.+)$/))) return { cond: { c: 'countLess', sel: { owner: 'self', zones: ['battle'], kind: 'creature', other: true }, n: +m[1] + 1 }, rest: m[2] };
  if ((m = t.match(/^自分の(墓地|マナゾーン|手札)に(.+?)が(\d+)(?:体|枚|つ)(?:以上|でも)あれば、(.+)$/))) {
    const z = m[1] === '墓地' ? 'grave' : m[1] === '手札' ? 'hand' : 'mana';
    const sel = parseSel(m[2], { zones: [z] });
    if (sel) return { cond: { c: 'countAtLeast', sel: { ...sel, owner: 'self', zones: [z], kind: /カード$/.test(m[2]) ? 'card' : sel.kind }, n: +m[3] }, rest: m[4] };
  }
  if ((m = t.match(/^相手の(墓地|マナゾーン|手札)に(.+?)が(\d+)(?:体|枚|つ)(?:以上|でも)あれば、(.+)$/))) {
    const z = m[1] === '墓地' ? 'grave' : m[1] === '手札' ? 'hand' : 'mana';
    const sel = parseSel(m[2], { zones: [z] });
    if (sel) return { cond: { c: 'countAtLeast', sel: { ...sel, owner: 'opp', zones: [z], kind: /カード$/.test(m[2]) ? 'card' : sel.kind }, n: +m[3] }, rest: m[4] };
  }
  if ((m = t.match(/^自分の(墓地|マナゾーン)に(.+?)が(\d+)(?:体|枚|つ)以上なければ、(.+)$/))) {
    const z = m[1] === '墓地' ? 'grave' : 'mana';
    const sel = parseSel(m[2], { zones: [z] });
    if (sel) return { cond: { c: 'countLess', sel: { ...sel, owner: 'self', zones: [z], kind: /カード$/.test(m[2]) ? 'card' : sel.kind }, n: +m[3] }, rest: m[4] };
  }
  if ((m = t.match(/^(?:バトルゾーンに)?自分の([^、]+?)が(?:(\d+)(?:体|枚|つ)以上)?なければ、(.+)$/))) {
    const sel = parseSel('自分の' + m[1]);
    if (sel) return { cond: { c: 'countLess', sel, n: m[2] ? +m[2] : 1 }, rest: m[3] };
  }
  if ((m = t.match(/^自分の(光|水|闇|火|自然)のクリーチャーまたは(?:光|水|闇|火|自然)のタマシードが合計(\d+)つ以上(あれば|なければ)、(.+)$/))) {
    const sel: Sel = { owner: 'self', zones: ['battle'], kind: 'creatureOrTama', civs: [CIV_OF[m[1]]] };
    return { cond: m[3] === 'あれば' ? { c: 'countAtLeast', sel, n: +m[2] } : { c: 'countLess', sel, n: +m[2] }, rest: m[4] };
  }
  if ((m = t.match(/^自分のマナゾーンに裏向きのカードが(\d+)枚以上(あれば|なければ)、(.+)$/))) {
    const sel: Sel = { owner: 'self', zones: ['mana'], kind: 'card', faceDown: true };
    return { cond: m[2] === 'あれば' ? { c: 'countAtLeast', sel, n: +m[1] } : { c: 'countLess', sel, n: +m[1] }, rest: m[3] };
  }
  if ((m = t.match(/^バトルゾーンまたはマナゾーンに自分の(.+?)が合計(\d+)(?:枚|体|つ)以上あれば、(.+)$/)) && parseSel('自分の' + m[1])) {
    return { cond: { c: 'countAtLeast', sel: { ...parseSel('自分の' + m[1])!, zones: ['battle', 'mana'] }, n: +m[2] }, rest: m[3] };
  }
  if ((m = t.match(/^自分のマナゾーン(?:にある|の)カードがすべて(光|水|闇|火|自然)のカード(?:であれば|なら|である間)、(.+)$/))) return { cond: { c: 'manaAllCiv', civ: CIV_OF[m[1]] }, rest: m[2] };
  if ((m = t.match(/^(?:ラビリンス[:：])?自分のシールド(?:の数)?が相手(?:のシールド)?より多ければ、(.+)$/))) return { cond: { c: 'shieldsMore' }, rest: m[1] };
  if ((m = t.match(/^バトルゾーンに他に自分のクリーチャーがなければ、(.+)$/))) return { cond: { c: 'countLess', sel: { owner: 'self', zones: ['battle'], kind: 'creature', other: true }, n: 1 }, rest: m[1] };
  if ((m = t.match(/^相手のシールドが(\d+)(?:つ|枚)以下(?:なら|であれば)、(.+)$/))) return { cond: { c: 'oppShieldsLess', n: +m[1] + 1 }, rest: m[2] };
  if ((m = t.match(/^相手にシールドが(\d+)(?:つ|枚)もなければ、(.+)$/))) return { cond: { c: 'oppShieldsLess', n: +m[1] }, rest: m[2] };
  if ((m = t.match(/^このクリーチャーは、?(?:バトルゾーンに)?出(?:た|した)ターン(?:の間)?、(.+)$/))) return { cond: { c: 'selfNew' }, rest: 'このクリーチャーは' + m[1] };
  if ((m = t.match(/^自分の手札が(\d+)枚もない(?:時|なら)、(.+)$/))) return { cond: { c: 'handLE', n: +m[1] - 1 }, rest: m[2] };
  if ((m = t.match(/^このクリーチャーがタップ(?:されて|して)(?:いる|いれば|いる時|いる間)、?(.+)$/))) return { cond: { c: 'selfTapped' }, rest: m[1] };
  if ((m = t.match(/^(?:バトルゾーンに)?相手の([^、]+?)が(\d+)(?:体|枚|つ)以上あれば、(.+)$/)) && !/(マナゾーン|墓地|手札|シールド)/.test(m[1]) && parseSel('相手の' + m[1])) return { cond: { c: 'countAtLeast', sel: parseSel('相手の' + m[1])!, n: +m[2] }, rest: m[3] };
  if ((m = t.match(/^相手の(マナゾーン|墓地)に(.+?)があれば、(.+)$/))) {
    const z = m[1] === '墓地' ? 'grave' : 'mana';
    const sel = parseSel(m[2], { zones: [z] });
    if (sel) return { cond: { c: 'countAtLeast', sel: { ...sel, owner: 'opp', zones: [z], kind: /カード$/.test(m[2]) ? 'card' : sel.kind }, n: 1 }, rest: m[3] };
  }
  // 「バトルゾーンに自分の〇〇が他にN体でもあれば / もなければ / 他になければ」
  if ((m = t.match(/^バトルゾーンに(タップされていない)?自分の(.+?)が他に(?:(\d+)体(でも|以上)あれば|(\d+)体以上出ているなら|(\d+)体もなければ|(な)ければ)、(.+)$/))) {
    const sel = parseSel('自分の' + m[2]);
    if (sel) {
      const sl: Sel = { ...sel, other: true, ...(m[1] ? { tapped: false } : {}) };
      const atLeast = m[3] ?? m[5];
      if (atLeast) return { cond: { c: 'countAtLeast', sel: sl, n: +atLeast }, rest: m[8] };
      return { cond: { c: 'countLess', sel: sl, n: m[6] ? +m[6] : 1 }, rest: m[8] };
    }
  }
  if ((m = t.match(/^自分のシールドゾーンに表向きのカードがあれば、(.+)$/))) return { cond: { c: 'countAtLeast', sel: { owner: 'self', zones: ['shield'], kind: 'card', shieldFaceUp: true }, n: 1 }, rest: m[1] };
  if ((m = t.match(/^バトルゾーンにある自分のクリーチャーがこのクリーチャーだけ(?:なら|であれば)、(.+)$/))) return { cond: { c: 'countLess', sel: { owner: 'self', zones: ['battle'], kind: 'creature', other: true }, n: 1 }, rest: m[1] };
  if ((m = t.match(/^相手のターン(?:中)?に、?このクリーチャーがタップされて(?:いれば|いる時|いる間)、?(.+)$/))) return { cond: { c: 'selfTapped', oppTurn: true }, rest: m[1] };
  if ((m = t.match(/^(?:G・G・G[:：])?自分の手札が(\d+)枚以下(?:なら|であれば)、(.+)$/))) return { cond: { c: 'handLE', n: +m[1] }, rest: m[2] };
  if ((m = t.match(/^自分のシールドが(\d+)(?:つ|枚)もなければ、(.+)$/))) return { cond: { c: 'shieldsLE', n: +m[1] - 1 }, rest: m[2] };
  if ((m = t.match(/^自分のシールドが(\d+)(?:つ|枚)以下(?:の時|なら|であれば)、(.+)$/))) return { cond: { c: 'shieldsLE', n: +m[1] }, rest: m[2] };
  if ((m = t.match(/^(?:バトルゾーンに)?自分の([^、]+?)が(?:あれば|ある間)、(.+)$/)) && !/\d+(?:体|枚|つ)以上$/.test(m[1])) {
    const sel = parseSel('自分の' + m[1]);
    if (sel) return { cond: { c: 'countAtLeast', sel, n: 1 }, rest: m[2] };
  }
  if ((m = t.match(/^(?:バトルゾーンに)?自分の(.+?)が(\d+)(?:体|枚|つ)以上(?:バトルゾーンに)?あれば、(.+)$/))) {
    const sel = parseSel('自分の' + m[1]);
    return sel ? { cond: { c: 'countAtLeast', sel, n: +m[2] }, rest: m[3] } : null;
  }
  return { rest: t };
}

/** 1行の常在型能力を解析 */
export function parseStaticLine(raw: string): StaticSpec[] | null {
  const full = normText(raw);
  const t0 = stripReminder(full)
    .replace(/\s+/g, '')
    .replace(/。$/, '')
    .replace(/はすべて、(「)/, 'は$1')
    .replace(/すべてに、(「)/, 'すべてに$1')
    .replace(/^(これをクロスしたクリーチャー|このクリーチャー)は、(「)/, '$1は$2')
    .replace(/^G・ゼロ[-－ー―]/, 'G・ゼロ:')
    .replace(/^シビルカウント\d+[:：]/, '')
    .replace(/シールドをもう(\d+)(枚|つ)ブレイクする$/, 'シールドをさらに$1$2ブレイクする')
    .replace(/^(W・)?シンパシー[:：](.+?)および/, '$1シンパシー:$2または')
    .replace(/^(?:バトルゾーンにある)?自分のクリーチャーがこのクリーチャーだけ(?:なら|であれば)、(?:このクリーチャーの)?パワーを/, 'バトルゾーンに自分の他のクリーチャーがなければ、このクリーチャーのパワーを')
    .replace(/^この(?:クリーチャー|呪文|カード)が(?:自分の)?シールドゾーンにあり、/, '')
    .replace(/コストを最大(\d+)少なく/, 'コストを$1少なく')
    .replace(/マナゾーンでタップされているカード/g, 'マナゾーンにあるタップされているカード')
    .replace(/^革命\d+[:：―\-－ー]/, '')
    .replace(/^水晶武装\d*[:：]/, '')
    .replace(/^(?:このクリーチャーが)?バトルゾーンにある間(?:に)?、/, '')
    .replace(/アウトレイジ犬(\d+)匹につき/, 'アウトレイジ$1体につき')
    .replace(/のパワーはー(\d)/, 'のパワーは-$1')
    .replace(/のパワーは(?:それぞれ|、)\+/, 'のパワーは+')
    .replace(/^このクリーチャーのパワーは(自分の(?:墓地|マナゾーン)にある.+?\d+(?:体|枚)につき)\+(\d+)される$/, '$1、このクリーチャーのパワーを+$2する')
    .replace(/^バトルゾーンにある(すべての|自分の)/, '$1')
    .replace(/^(自分の[^、「]+?)はそれぞれ「/, '$1は「')
    .replace(/^すべての(.+?)と(.+?)のパワーは/, 'すべての$1または$2のパワーは')
    .replace(/^バトル中の(自分の[^、]*?クリーチャー)のパワーを\+/, 'バトル中、$1すべてのパワーを+')
    // 条件つきのS・トリガー: 「〜があり、このクリーチャーが自分のシールドゾーンにあれば」「自分のシールドゾーンにあるこのクリーチャーに」
    .replace(/(以上)?あり、この(?:クリーチャー|呪文|カード)が(?:自分の)?シールドゾーンにあれば、/, '$1あれば、')
    .replace(/、(?:自分の)?シールドゾーンにあるこの(?:クリーチャー|呪文|カード)に「S・トリガー」を与える$/, '、このクリーチャーに「S・トリガー」を与える')
    .replace(/、この呪文に「S・トリガー」を与える$/, '、このクリーチャーに「S・トリガー」を与える');
  let m: RegExpMatchArray | null;

  // ---- キーワード系 ----
  if (/^パワード・ブレイカー/.test(t0)) return [{ s: 'poweredBreaker' }];
  if (/^エターナル・Ω/.test(t0) || /^このクリーチャーが(バトルゾーンを)?離れる時、かわりに(持ち主の|自分の)?手札に戻す$/.test(t0)) return [{ s: 'leaveToHand' }];
  if (/^エスケープ/.test(t0)) return [{ s: 'escape' }];
  if (/^(スーパー)?ガードマン/.test(t0)) return [{ s: 'guardman' }];
  if (/^シールド・セイバー/.test(t0)) return [{ s: 'shieldSaver' }];
  if ((m = t0.match(/^(?:ウルトラ・)?セイバー[:：](.+)$/))) {
    const sel = parseSel('自分の' + m[1]);
    return sel ? [{ s: 'saver', sel }] : null;
  }
  if ((m = t0.match(/^(J・O・E|B・A・D)(\d+)/))) return [{ s: 'discountSummon', kind: m[1] === 'J・O・E' ? 'joe' : 'bad', n: +m[2] }];
  if ((m = t0.match(/^マナ爆誕(\d+)/))) return [{ s: 'manaBakutan', cost: +m[1] }];
  if ((m = t0.match(/^キリフダッシュ(?:\[[a-z]*(\d+)\]|(\d+))/))) return [{ s: 'kirifu', cost: +(m[1] ?? m[2]) }];
  if ((m = t0.match(/^(?:OVER)?ハイパー化[:：]自分の他のクリーチャーを(\d+)体タップする/))) return [{ s: 'hyperize', n: +m[1] }];
  if (/^Zラッシュ/.test(t0)) return [{ s: 'zrush' }];
  if (/^シンカライズ/.test(t0)) return [{ s: 'sinkalize' }];
  if ((m = full.replace(/\s+/g, '').match(/^ギャラクシールド\[[a-z]*(\d+)\]/))) return [{ s: 'galaxy', cost: +m[1] }];
  if ((m = full.replace(/\s+/g, '').match(/^フシギバース\[[a-z]*(\d+)\]/))) return [{ s: 'fushigi', n: +m[1] }];
  if (/^アビスラッシュ/.test(t0)) return [{ s: 'abyss' }];
  if (/^リンク解除/.test(t0)) return [{ s: 'linkRelease' }];
  if (/^ソウルシフト/.test(t0)) return [{ s: 'soulShift' }];
  if (/^サバキZ/.test(t0)) return [{ s: 'sabakiZ' }];
  if ((m = t0.match(/^S・バック[-－ー:：]([^(（]+)/))) {
    const ph = m[1].replace(/のカード$/, '');
    const sel = parseSel(/(カード|クリーチャー|呪文)$/.test(ph) ? ph : ph + 'のカード') ?? parseSel(ph + 'カード');
    if (sel) return [{ s: 'sBack', sel: { ...sel, zones: ['hand'] } }];
  }
  if ((m = t0.match(/^自分のターン中、クリーチャーを(\d+)体、自分のマナゾーンから召喚してもよい$/))) return [{ s: 'manaSummonTurn', n: +m[1] }];
  if ((m = t0.match(/^このクリーチャーが(?:バトルゾーンに)?出たターンの間、クリーチャーを(\d+)体、自分のマナゾーンから召喚してもよい$/))) return [{ s: 'manaSummonTurn', n: +m[1], newOnly: true }];
  if ((m = t0.match(/^自分のターン中、(.+?)を(\d+)体、自分のマナゾーンから召喚してもよい$/)) && parseSel(m[1], { zones: ['mana'] })) return [{ s: 'manaSummonTurn', n: +m[2], sel: { ...parseSel(m[1], { zones: ['mana'] })!, owner: 'self', zones: ['mana'] } }];
  if ((m = t0.match(/^このクリーチャーを召喚する時、自分の手札を(\d+)枚捨ててもよい。そうしたら、このクリーチャーの召喚コストを(\d+)少なくする/))) return [{ s: 'discardDiscount', n: +m[1], d: +m[2] }];
  if ((m = t0.match(/^自分のマナゾーンにある(.+?)(\d+)体につき、このクリーチャーを召喚するコストは(\d+)少なくなる/) ?? t0.match(/^自分のマナゾーンにある(.+?)(\d+)(?:体|枚)につき、このクリーチャーの召喚コストを(\d+)少なくする/))) {
    const sel = parseSel(m[1], { zones: ['mana'] });
    if (sel && m[2] === '1' && m[3] === '1') return [{ s: 'sympathy', sel: { ...sel, owner: 'self', zones: ['mana'] }, floor: floorOf(full), zone: 'mana' }];
  }
  // 「パワー3000以上のクリーチャーは攻撃できない」: 誰のクリーチャーでも
  if ((m = t0.match(/^((?!この|これ|自分|相手|その)[^、]*?クリーチャー)は(?:すべて)?、?(攻撃もブロックも|攻撃|ブロック)(?:することが)?できない$/)) && parseSel(m[1]))
    return [{ s: 'oppRestrict', sel: parseSel(m[1])!, attack: /攻撃/.test(m[2]), block: /ブロック/.test(m[2]), all: parseSel(m[1])!.owner !== 'opp' }];
  if ((m = t0.match(/^相手の(.+?)は、?(攻撃・ブロック|攻撃もブロックも|攻撃|ブロック)(?:することが)?できない$/))) {
    const sel = parseSel(m[1]);
    if (sel) return [{ s: 'oppRestrict', sel, attack: /攻撃/.test(m[2]), block: /ブロック/.test(m[2]) }];
  }
  if (/^相手(プレイヤー)?はコストを支払わずにクリーチャーを召喚したり呪文を唱えたりできない$/.test(t0) || /^相手は、?コストを支払わずに呪文を唱えられない$/.test(t0)) return [{ s: 'noFreePlay' }];
  if (/^このクリーチャーがタップされている間、相手の攻撃クリーチャーは可能であればこのクリーチャーを攻撃する$/.test(t0)) return [{ s: 'lure' }];
  if (/^ハンティング$/.test(t0))
    return [{ s: 'power', target: { t: 'self' }, delta: 1000, when: 'battle', per: { sel: { owner: 'self', zones: ['battle'], kind: 'creature', races: ['ハンター'] }, each: 1 } }];
  if (/^このクリーチャーを、?(自分の)?マナゾーンから召喚してもよい$/.test(t0)) return [{ s: 'summonFrom', zone: 'mana' }];
  if (/^このクリーチャーはタップして出て、自分のターンのはじめにアンタップしない$/.test(t0)) return [{ s: 'entersTapped' }, { s: 'noUntapStart' }];
  if (/^(各ターン、)?このクリーチャーの(最初の)?攻撃の終わりに、このクリーチャーをアンタップする$/.test(t0)) return [{ s: 'untapAfterAttack' }];
  if (/^このクリーチャーの攻撃の終わりに、このクリーチャーを破壊する$/.test(t0)) return [{ s: 'destroyAfterAttack' }];
  if (/^このクリーチャーは、?シールドをブレイクできない$/.test(t0) || /^ヌル・ブレイカー/.test(t0)) return [{ s: 'noBreak' }];
  if (/^G・ブレイカー/.test(t0)) return [{ s: 'gBreaker' }];
  if (/^このクリーチャーは、?召喚できない$/.test(t0)) return [{ s: 'noSummon' }];
  // ゲーム開始時の配置はゲームの準備で行う
  if (/^この(?:最終)?禁断フィールドは、ゲーム開始時、/.test(t0) || /^ゲーム開始時、このカードと、異なる\d+種類の零龍星雲を/.test(t0) || /^ゲーム開始時、相手はもう\d+枚カードを引く$/.test(t0)) return [{ s: 'note' }];
  if ((m = t0.match(/^このクリーチャーを召喚する時、自分の手札から(.+?)を(\d+)(?:枚|体)、?相手に見せてもよい。そう(?:した場合|したら)、このクリーチャーの召喚コストは(?:最大)?(\d+)少なくなる/)) && parseSel(m[1], { zones: ['hand'] }))
    return [{ s: 'revealDiscount', sel: { ...parseSel(m[1], { zones: ['hand'] })!, zones: ['hand'] }, n: +m[2], d: +m[3], floor: floorOf(full) }];
  if (/^このクリーチャーは、?自分の手札から召喚できない$/.test(t0)) return [{ s: 'noSummon', fromHand: true }];
  if (/^自分のターン中、相手は呪文を唱えられない$/.test(t0)) return [{ s: 'oppSpellLock', ownTurn: true }];
  if (/^相手のクリーチャーは、?(?:バトルゾーンに)?出たターン(?:に|の間)?、?攻撃できない$/.test(t0)) return [{ s: 'oppNewNoAttackAll' }];
  if (/^相手のクリーチャーは(?:すべて)?、?可能(?:なら|であれば)攻撃する$/.test(t0)) return [{ s: 'oppMustAttack' }];
  // 「相手のクリーチャーが攻撃している間、このクリーチャーは「ブロッカー」を得る」: ブロックできるのは相手の攻撃中だけなので常に持つ
  if (/^相手のクリーチャーが攻撃している間、このクリーチャーは「ブロッカー」を得る$/.test(t0)) return [{ s: 'grant', target: { t: 'self' }, kws: ['ブロッカー'], when: 'always' }];
  if (/^相手はこのクリーチャーを選べない$/.test(t0)) return [{ s: 'untargetable', bySpellOnly: false }];
  if ((m = t0.match(/^このクリーチャーは、?パワーが(\d+)以下の間、?バトルゾーンを離れず、すべてのバトルに勝つ$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: ['離れない', 'すべてのバトルに勝つ'], when: 'always', cond: { c: 'powerAtMost', n: +m[1] } }];
  if ((m = t0.match(/^自分のマナゾーンにある文明(\d+)つにつき、このクリーチャーのパワーを\+(\d+)する$/)))
    return [{ s: 'power', target: { t: 'self' }, delta: +m[2], when: 'always', perCiv: true }];
  if ((m = t0.match(/^このクリーチャーの下にあるカード(\d+)枚につき、このクリーチャーのパワーを\+(\d+)する$/)) ?? t0.match(/^このクリーチャーのパワーは、このクリーチャーの下にあるカード(\d+)枚につき\+(\d+)される$/))
    return [{ s: 'power', target: { t: 'self' }, delta: +m![2], when: 'always', perUnder: true }];
  if ((m = t0.match(/^このクリーチャーは、?自分の手札が(\d+)枚以下(?:の時)?(?:なら|しか)?召喚できる$/))) return [{ s: 'summonOnlyIf', cond: { c: 'handLE', n: +m[1] } }];
  if (/^呪文を唱えたターン(?:のみ|にしか)、?このクリーチャーを召喚(?:することが)?できる$/.test(t0)) return [{ s: 'summonOnlyIf', cond: { c: 'spellsThisTurn', n: 1 } }];
  if ((m = t0.match(/^輪廻∞[:：]このカードの呪文側を、?バトルゾーンに置いたまま唱えてもよい。?(?:そうした時、(.+))?$/))) return [{ s: 'rinne', bonus: m[1] }];
  if (/^相手のクリーチャーは、?(?:バトルゾーンに)?出たターン、?自分を攻撃できない$/.test(t0)) return [{ s: 'oppNewNoAttack' }];
  if ((m = t0.match(/^(光|水|闇|火|自然)ステルス/))) return [{ s: 'stealth', civ: CIV_OF[m[1]] }];
  if ((m = t0.match(/^((?:光|水|闇|火|自然)(?:・(?:光|水|闇|火|自然))*)スレイヤー/))) return [{ s: 'civSlayer', civs: m[1].split('・').map((x) => CIV_OF[x]) }];
  if (/^このクリーチャーは、?タップしてバトルゾーンに置かれる$/.test(t0)) return [{ s: 'entersTapped' }];
  if (/^相手のクリーチャーが攻撃する場合、可能であればこのクリーチャーを攻撃する$/.test(t0)) return [{ s: 'lure' }];
  if (/^このクリーチャーを、自分の墓地から召喚してもよい$/.test(t0)) return [{ s: 'summonFrom', zone: 'grave' }];
  if ((m = t0.match(/^この呪文を(?:自分の)?(マナゾーン|墓地)から唱えてもよい$/))) return [{ s: 'summonFrom', zone: m[1] === '墓地' ? 'grave' : 'mana' }];
  if (/^(バトルゾーンに置く時、このカードはタップして置く|このクリーチャーはタップして出る)$/.test(t0)) return [{ s: 'entersTapped' }];
  if (/^飛行$/.test(t0)) return [{ s: 'note' }];
  if (/^∞パワーアタッカー$/.test(t0)) return [{ s: 'grant', target: { t: 'self' }, kws: ['パワーアタッカー+999999'], when: 'attack' }];
  if ((m = t0.match(/^(これを(?:付けた|装備した|クロスした)クリーチャー)は、?ブロックされない$/))) return [{ s: 'grant', target: { t: 'cross' }, kws: ['ブロックされない'], when: 'always' }];
  if (/^相手のカードはマナゾーンにタップして置かれる$/.test(t0) || /^相手は、?自身のマナゾーンにカードを置く時、?タップして置く$/.test(t0) || /^相手はカードをマナゾーンに置く時、?タップして置く$/.test(t0)) return [{ s: 'oppManaTapped' }];
  if (/^相手のクリーチャーは、?バトルゾーンに出す時タップして置く$/.test(t0) || /^相手のクリーチャーはタップしてバトルゾーンに出る$/.test(t0)) return [{ s: 'oppEntersTapped' }];
  if (/^相手(?:の)?クリーチャーは、?タップされた状態でバトルゾーンに(?:出る|置かれる)$/.test(t0)) return [{ s: 'oppEntersTapped' }];
  if (/^相手のカードは、?タップされた状態でマナゾーンに置かれる$/.test(t0)) return [{ s: 'oppManaTapped' }];
  if (/^このクリーチャーは、?タップされた状態でバトルゾーンに(?:出る|置かれる)$/.test(t0)) return [{ s: 'entersTapped' }];
  if (/^このクリーチャーは、?可能(?:なら|であれば)、?毎ターン、?相手プレイヤーを攻撃する$/.test(t0)) return [{ s: 'mustAttack' }];
  if (/^このクリーチャーは、?攻撃可能であれば、?必ず攻撃しなければならない$/.test(t0)) return [{ s: 'mustAttack' }];
  if (/^このクリーチャーはバトルに勝っても、バトルの(後|あと)、(破壊される|持ち主の墓地に置かれる)$/.test(t0)) return [{ s: 'dieAfterBattle' }];
  if (/^相手は呪文を唱えられない$/.test(t0)) return [{ s: 'oppSpellLock' }];
  if ((m = t0.match(/^相手は、?(.+?)の?呪文を唱えられない$/))) {
    const ph = m[1].replace(/ではない$/, '以外の');
    const sel = parseSel(ph + '呪文') ?? parseSel(ph + 'の呪文');
    if (sel) return [{ s: 'oppSpellLock', sel }];
  }
  if (/^このクリーチャーの攻撃中、相手は「G・ストライク」を使えない$/.test(t0)) return [{ s: 'noGStrike' }];
  if (/^このクリーチャーは、?毎ターン攻撃しなければならない$/.test(t0)) return [{ s: 'mustAttack' }];
  if (/^相手のクリーチャーが攻撃するなら、可能ならこのクリーチャーを攻撃する$/.test(t0)) return [{ s: 'lure' }];
  if (/^(どんな|どの)種族の進化クリーチャーを?、?このクリーチャーの上に置いてもよい$/.test(t0) || /^このクリーチャーの上に、?(どんな|どの)種族の進化クリーチャーを置いてもよい$/.test(t0)) return [{ s: 'anyEvoBase' }];
  if (/^このクリーチャーをタップして(バトルゾーンに)?出してもよい$/.test(t0)) return [{ s: 'note' }];
  if ((m = t0.match(/^(.+?)・?ブロッカー$/)) && !/パワード|スーパー|ナイト|ジャスト/.test(m[1])) {
    const words = m[1].split('・');
    const civs = words.map((w) => ({ 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' })[w as '光']).filter(Boolean) as Civ[];
    if (civs.length === words.length) return [{ s: 'limitedBlocker', sel: { owner: 'any', zones: ['battle'], kind: 'creature', civs } }];
    const sel = parseSel(m[1]);
    if (sel) return [{ s: 'limitedBlocker', sel }];
  }
  // 「このクリーチャーが離れる時、カードがこれの下にあれば、かわりに下にあるカードをすべて墓地に置く」
  if (/^このクリーチャーが(?:バトルゾーンを)?離れる時、カードがこ(?:れ|のクリーチャー)の下にあれば、かわりに下にあるカードをすべて墓地に置く$/.test(t0)) return [{ s: 'stayIf', cond: 'hasUnder' }];
  {
    const nb = t0.match(/^このクリーチャー(?:の攻撃)?が(ブロックされた|攻撃をブロックした)(?:場合|とき|時)、バトルは行われない。?ただし、両クリーチャーはタップしたままである$/);
    if (nb) return [{ s: 'noBlockBattle', blocking: nb[1] !== 'ブロックされた' }];
  }
  // 「このクリーチャーがバトルゾーンを離れる時、〜なら、離れるかわりにとどまる」
  {
    const st = t0.match(/^(相手の呪文(?:の効果で|によって))?(バトルゾーンに(自分|相手)の(.+?)があり、)?このクリーチャーがバトルゾーン(?:を|から)離れる時、(.*?)(?:このクリーチャーは)?(?:バトルゾーンを離れるかわりにとどまる|離れるかわりにとどまる|バトルゾーンから離れずにとどまる)$/);
    if (st) {
      const pre = st[5];
      let pm: RegExpMatchArray | null;
      if (st[1]) return [{ s: 'stayIf', cond: 'oppSpell' }];
      if (st[2]) {
        const sel = parseSel(`${st[3]}の${st[4]}`);
        if (sel) return [{ s: 'stayIf', cond: 'always', ...(st[3] === '自分' ? { ownSel: sel } : { oppSel: sel }) }];
      }
      if (pre === '') return [{ s: 'stayIf', cond: 'always' }];
      if (/^タップされていれば、$/.test(pre)) return [{ s: 'stayIf', cond: 'tapped' }];
      if ((pm = pre.match(/^そのパワーが(\d+)より大きければ、$/))) return [{ s: 'stayIf', cond: 'always', powerGt: +pm[1] }];
      if ((pm = pre.match(/^バトルゾーンに(自分|相手)の(.+?)があれば、$/))) {
        const sel = parseSel(`${pm[1]}の${pm[2]}`);
        if (sel) return [{ s: 'stayIf', cond: 'always', ...(pm[1] === '自分' ? { ownSel: sel } : { oppSel: sel }) }];
      }
    }
  }
  if (/^このクリーチャーが(?:相手の)?シールドをブレイクする時、相手は(?:その(?:シールド)?|それ)を(?:自身の)?手札に加えるかわりに、?(?:持ち主の)?墓地に置く$/.test(t0)) return [{ s: 'breakToGrave' }];
  if (/^この(鼓動|最終禁断フィールド|禁断フィールド|フィールド|カード|クリーチャー)は(、)?(バトルゾーンを)?離れない$/.test(t0) || /^零龍カードはバトルゾーンを離れない$/.test(t0)) return [{ s: 'neverLeave' }];
  if (/^このカードがバトルゾーン以外のゾーンにあれば、(クリーチャーをすべて破壊し、)?自分はゲームに負ける$/.test(t0)) return [{ s: 'loseIfLeave' }];
  if ((m = t0.match(/^(自分のクリーチャー|このクリーチャー)は(?:すべて)?、?すべてのバトルに勝つ$/)))
    return [{ s: 'grant', target: m[1] === 'このクリーチャー' ? { t: 'self' } : { t: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' } }, kws: ['すべてのバトルに勝つ'], when: 'always' }];
  if ((m = t0.match(/^城[-ー―:：?]?自分のシールドを(ひとつ|1つ|\d+つ)選び、このカードを付けて要塞化する/))) return [{ s: 'castle', n: /\d/.test(m[1]) ? +m[1].replace('つ', '') : 1 }];
  if (/^このクリーチャーをアンタップして、相手クリーチャーの攻撃先をこのクリーチャー(または自分のタップしているクリーチャー)?に変更してもよい$/.test(t0)) return [{ s: 'untapBlocker' }];
  if (/^(相手のターン中[に、]|相手の呪文の効果または(?:相手の)?クリーチャーの能力によって、)このクリーチャーが(自分の)?手札から捨てられる時、墓地に置くかわりに(自分の)?バトルゾーンに(?:出(してもよい|す)|置く)$/.test(t0)) return [{ s: 'discardToBattle' }];
  if ((m = t0.match(/^このクリーチャーが?は?、?リンクして(?:いる(?:間|時)|いれば)、(?:このクリーチャーは)?シールドをさらに(\d+)枚ブレイクする$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: [`ブレイク+${m[1]}`], when: 'always', cond: { c: 'linked' } }];
  if (/^ダイナモ$/.test(t0)) return [{ s: 'dynamo' }];
  if (/^デッキ進化[-ー―:：]/.test(t0)) return [{ s: 'deckEvo' }];
  if (/^O・ドライブ/.test(t0)) {
    const reqs = [...t0.matchAll(/(光|水|闇|火|自然)x(\d+)/g)].map((x) => ({ civ: x[1], n: +x[2] }));
    if (reqs.length) return [{ s: 'odrive', reqs }];
  }
  // 「自分のアンノウンの召喚コストを1、ゼニスの召喚コストを1少なくしてもよい」
  if ((m = t0.match(/^自分の(.+?)の召喚コストを(\d+)、(.+?)の召喚コストを(\d+)少なく(?:する|してもよい)(?:[、。]?ただし.*)?$/))) {
    const a = parseSel(m[1], { zones: ['hand', 'mana', 'grave', 'shield', 'deck'] });
    const b = parseSel(m[3], { zones: ['hand', 'mana', 'grave', 'shield', 'deck'] });
    if (a && b)
      return [
        { s: 'cost', side: 'self', sel: { ...a, kind: 'creature' }, action: 'summon', delta: -m[2], floor: floorOf(full) },
        { s: 'cost', side: 'self', sel: { ...b, kind: 'creature' }, action: 'summon', delta: -m[4], floor: floorOf(full) },
      ];
  }
  if ((m = full.replace(/\s+/g, '').match(/^バズレンダ\[[a-z]*(\d+)\]/))) return [{ s: 'buzz', n: +m[1] }];
  if ((m = full.replace(/\s+/g, '').match(/^ビビッドロー\[[a-z]*(\d+)\]/))) return [{ s: 'vivid', cost: +m[1] }];
  if (/^このクリーチャーは、?可能(であれば|なら)ブロックする$/.test(t0)) return [{ s: 'mustBlock' }];
  if (/^相手のクリーチャーは、?可能(であれば|なら)ブロックする$/.test(t0)) return [{ s: 'oppMustBlock' }];
  if ((m = t0.match(/^(進化GV|超無限進化)[-ー―:：]?(名前に《.+?》とある)?自分の(.+?)(\d+)体(以上)?(?:を重ねた上に置く|の上に置く)$/))) {
    const words = m[3].replace(/のいずれか$/, '');
    const list = words.split('、');
    let sel: Sel | null;
    if (list.length > 1) sel = { owner: 'self', zones: ['battle'], kind: 'creature', races: list };
    else sel = parseSel('自分の' + (m[2] ?? '') + words);
    if (sel) return [{ s: 'evoMulti', min: +m[4], exact: m[1] === '進化GV' && !m[5], sel }];
  }
  if (/^封印が付いていれば、この(タマシード|クリーチャー|カード|フィールド)は(バトルゾーンを)?離れない$/.test(t0)) return [{ s: 'sealStay' }];
  if ((m = t0.match(/^NEO進化クリーチャーとして召喚するなら、このクリーチャーの召喚コストを(\d+)少なくする$/))) return [{ s: 'neoDiscount', n: +m[1] }];
  if ((m = t0.match(/^(タマシード|クリーチャー)から進化するなら、このクリーチャーの召喚コストを(\d+)少なくする$/))) return [{ s: 'neoDiscount', n: +m[2], from: m[1] }];
  if ((m = full.replace(/\s+/g, '').match(/^ウラ・ニンジャ・ストライク(\d+)(?:\((光|水|闇|火|自然)\))?/))) return [{ s: 'uraNinja', n: +m[1], civ: m[2] }];
  if ((m = t0.match(/^(マナ|手札)進化[-ー―:：](.+?)を(\d+)体自分の(?:マナゾーン|手札)から選び、このクリーチャーをその上に重ねつつバトルゾーンに出す$/))) {
    const sel = parseSel(m[2]);
    return sel ? [{ s: 'evoFrom', zone: m[1] === 'マナ' ? 'mana' : 'hand', sel, n: +m[3] }] : null;
  }
  if ((m = t0.match(/^コストを支払うかわりに、自分の(.+?)を(\d+)体タップして、?この(呪文|クリーチャー)を(唱え|召喚し)てもよい$/))) {
    const sel = parseSel('自分の' + m[1]);
    return sel ? [{ s: 'tapCast', sel, n: +m[2] }] : null;
  }
  if ((m = t0.match(/^このクリーチャーが(破壊される|バトルゾーンを離れる|離れる)時、(?:墓地に置く|バトルゾーンを離れる)?かわりに、?(.+?(?:破壊|捨て|手札に(?:加え|戻)|墓地に置|山札の(?:一番)?下に置|表向きに|タップ).+)$/)))
    return [{ s: 'replaceLeave', on: m[1] === '破壊される' ? 'destroy' : 'leave', effect: m[2] }];
  if (/^これをクロスしたクリーチャーが破壊される時、そのクリーチャーは墓地に置かれるかわりにバトルゾーンにとどまる$/.test(t0)) return [{ s: 'replaceLeave', on: 'destroy', effect: '', cross: true }];
  if ((m = t0.match(/^これをクロスしたクリーチャーが破壊される時、(?:墓地に置く)?かわりに、?(.+)$/))) return [{ s: 'replaceLeave', on: 'destroy', effect: m[1], cross: true }];
  if (/^エターナル・Κ/.test(t0)) return [{ s: 'eternalK', n: +(full.match(/裏向きのカードを(\d+)枚/)?.[1] ?? 3) }];
  if ((m = t0.match(/^水晶ソウル(\d+)/))) return [{ s: 'crystalSoul', n: +m[1] }];
  if ((m = t0.match(/^パワード・ブロッカー\+?(\d+)/))) return [{ s: 'power', target: { t: 'self' }, delta: +m[1], when: 'block' }];
  if (/^このクリーチャーは、?可能(であれば|なら(ば)?)、?毎ターン攻撃する$/.test(t0)) return [{ s: 'mustAttack' }];
  if (/^相手のクリーチャーは、?可能(であれば|なら(ば)?)、?このクリーチャーを攻撃する$/.test(t0)) return [{ s: 'lure' }];
  // 「相手のターン中、このクリーチャーがタップされていて、そのターンにまだ攻撃を受けていない場合、〜」
  // (攻撃できるのはタップしているクリーチャーなので、条件は攻撃先の判定で満たされる)
  if (/^(相手のターン中、)?このクリーチャーが、?(相手のターン中に)?タップ(され|し)てい(て|る)、?そのターン(に)?まだ攻撃(を受けていない場合|されていなければ)、相手のクリーチャーは、?可能(であれば|なら(ば)?)、?このクリーチャーを攻撃する$/.test(t0))
    return [{ s: 'lure' }];
  if (/^相手は呪文を唱えることができない$/.test(t0)) return [{ s: 'oppSpellLock' }];
  if ((m = t0.match(/^自分の他の、?名前に《(.+?)》とある(?:エグザイル・)?クリーチャー(?:をバトルゾーンに出すことはできない|は出せない)$/))) return [{ s: 'exileLimit', name: m[1] }];
  if ((m = t0.match(/^アタック・チャンス[-ー―:：]?(.+)$/))) {
    const sel = parseSel(m[1].replace(/^ハイパーモード状態の/, ''));
    return sel ? [{ s: 'attackChance', sel }] : null;
  }
  if (/^このクリーチャーが表向きで、?シールドゾーンを離れる時、かわりに(自分の)?墓地に置く$/.test(t0)) return [{ s: 'faceUpShieldToGrave' }];
  // 鬼タイム: 自分と相手のシールドの合計がN以下なら、パワー+N / キーワード
  if ((m = t0.match(/^鬼タイム[:：]?自分と相手のシールドの数が合計(\d+)つ以下なら、このクリーチャーのパワーを\+(\d+)(?:し、((?:「[^」]+」(?:と|、)?)+)を与える)?$/))) {
    const cond: StaticCond = { c: 'totalShieldsLE', n: +m[1] };
    const out: StaticSpec[] = [{ s: 'power', target: { t: 'self' }, delta: +m[2], when: 'always', cond }];
    if (m[3]) out.push({ s: 'grant', target: { t: 'self' }, kws: [...m[3].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when: 'always', cond });
    return out;
  }
  if ((m = t0.match(/^鬼タイム[:：]?自分と相手のシールドの数が合計(\d+)つ以下なら、このクリーチャーに((?:「[^」]+」(?:と|、)?)+)を与える$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when: 'always', cond: { c: 'totalShieldsLE', n: +m[1] } }];
  if (/^解除$/.test(t0) || /^(このクリーチャーが)?バトルゾーンを離れる時、(バトルゾーンを離れる)?かわりに、?(コストの小さいほう|フォートレス側)に裏返す$/.test(t0) || /^バトルゾーンを離れるかわりに、?(コストの小さいほう|フォートレス側)に裏返す$/.test(t0))
    return [{ s: 'release' }];
  if ((m = t0.match(/^このカードを(.+?)にクロスする時、そのコストを(?:最大)?(\d+)少なくしてもよい/))) {
    const sel = parseSel(m[1]);
    return sel ? [{ s: 'crossDiscount', sel, n: +m[2] }] : null;
  }
  if ((m = t0.match(/^(左|右|中央)G・リンク$/))) return [{ s: 'glink', side: m[1] === '左' ? 'L' : m[1] === '右' ? 'R' : 'C' }];
  if (/^G・リンク/.test(t0)) {
    const names = [...t0.matchAll(/《([^》]+)》/g)].map((x) => x[1]);
    return names.length ? [{ s: 'glink', names }] : null;
  }
  if ((m = t0.match(/^このクリーチャーは、?リンクしている(?:時|間)、?((?:「[^」]+」(?:と|、)?)+)を得る$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: [...m[1].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when: 'always', cond: { c: 'linked' } }];
  if ((m = full.replace(/\s+/g, '').match(/^ムゲンクライム(\d+).*?\[[a-z]*(\d+)\]/))) return [{ s: 'mugen', n: +m[1], cost: +m[2] }];
  if ((m = t0.match(/^このクリーチャーが(?:破壊される|バトルゾーンから(?:自分の)?墓地に置かれる)時、(?:墓地に置く)?かわりに(?:自分の|持ち主の)?(手札に(?:戻す|加える)|マナゾーンに置く|山札の(?:一番)?(?:下|上)に置く|シールド(?:ゾーンに|として)(?:裏向きにして)?(?:加える|置く))$/))) {
    const z = /手札/.test(m[1]) ? 'hand' : /マナ/.test(m[1]) ? 'mana' : /山札の(?:一番)?上/.test(m[1]) ? 'deckTop' : /山札/.test(m[1]) ? 'deckBottom' : 'shield';
    return [{ s: 'destroyTo', zone: z }];
  }
  if ((m = t0.match(/^(W・)?シンパシー[:：](.+)$/))) {
    const sel = parseSel(m[2]);
    return sel ? [{ s: 'sympathy', sel: { ...sel, owner: 'self' }, floor: floorOf(full), each: m[1] ? 2 : undefined }] : null;
  }
  if ((m = t0.match(/^(.+?)は、?出たターンに?攻撃できない$/)) && !/^(相手|自分)の/.test(m[1]) && parseSel(m[1])) return [{ s: 'newNoAttackSel', sel: parseSel(m[1])! }];
  if ((m = t0.match(/^ササゲール(\d+)/))) return [{ s: 'sasageru', n: +m[1] }];
  if (/^ハイパーエナジー/.test(t0)) return [{ s: 'hyperEnergy' }];
  if ((m = t0.match(/^G・ゼロ[:：]このターン(?:中)?(?:に)?、?(?:自分が|自分の)?呪文を(?:(\d+)枚以上)?唱えていれば/))) return [{ s: 'gzero', cond: { c: 'spellsThisTurn', n: m[1] ? +m[1] : 1 } }];
  if ((m = t0.match(/^G・ゼロ[:：](?:バトルゾーンに)?(自分の)?(.+?)が(?:(\d+)(?:体|枚|つ)(?:以上|でも))?あれば/))) {
    const sel0 = parseSel((m[1] ?? '') + m[2]);
    const sel = sel0 && { ...sel0, owner: m[1] ? sel0.owner : ('any' as const) };
    if (sel) return [{ s: 'gzero', cond: { c: 'countAtLeast', sel, n: m[3] ? +m[3] : 1 } }];
  }
  if ((m = t0.match(/^G・ゼロ[:：](.+?)、このクリーチャーをコストを支払わずに召喚してもよい$/))) {
    const r = parseCondPrefix(m[1] + '、_');
    if (r?.cond && r.rest === '_') return [{ s: 'gzero', cond: r.cond }];
    return null;
  }
  if (/^(マナゾーンに置く時、)?このカードはタップして(マナゾーンに)?置く$/.test(t0) || /^この(カード|クロスギア|クリーチャー|呪文)は、?マナゾーンにタップして置かれる$/.test(t0)) return [{ s: 'tapMana' }];
  if (/^このクリーチャーは、?タップしてバトルゾーンに出る$/.test(t0) || /^バトルゾーンに出す時、このクリーチャーはタップして置く$/.test(t0)) return [{ s: 'entersTapped' }];
  if (/^このクリーチャーは、?(バトルゾーンに)?出(た|した)ターン(?:の間)?、?相手プレイヤーを攻撃できる$/.test(t0)) return [{ s: 'hastePlayer' }];
  if (/^このクリーチャーは、?破壊されない$/.test(t0)) return [{ s: 'indestructible' }];
  if (/^バトル中、このクリーチャーは、?破壊されない$/.test(t0) || /^このクリーチャーは、?バトル中破壊されない$/.test(t0)) return [{ s: 'indestructible', inBattle: true }];
  if ((m = t0.match(/^誰も(.+?)を召喚できない$/)) && parseSel(m[1])) return [{ s: 'noSummonSel', sel: { ...parseSel(m[1])!, zones: ['hand', 'mana', 'grave', 'shield', 'deck', 'hyper'] } }];
  if (/^すべてのクリーチャーは、?可能(?:であれば|なら)(?:毎ターン)?攻撃する$/.test(t0)) return [{ s: 'allMustAttack' }];
  if (/^このクリーチャーは、?可能なら毎ターン、?クリーチャーを攻撃する$/.test(t0)) return [{ s: 'mustAttack' }];
  if (/^自分は「S・トリガー」能力を使えない$/.test(t0)) return [{ s: 'noSTrigger' }];
  if ((m = t0.match(/^誰も(光|水|闇|火|自然)のカードの「S・トリガー」(?:能力)?を使えない$/))) return [{ s: 'noSTrigger', who: 'all', civ: CIV_OF[m[1]] }];
  if (/^(相手|誰も)は?「S・トリガー」(?:能力)?を使えない$/.test(t0)) return [{ s: 'noSTrigger', who: /^相手/.test(t0) ? 'opp' : 'all' }];
  if ((m = t0.match(/^誰も、?(.+?呪文)を唱え(?:ることが|ることは|られ)?(?:でき)?ない$/)) && parseSel(m[1])) return [{ s: 'oppSpellLock', sel: { ...parseSel(m[1])!, kind: 'spell' }, all: true }];
  if ((m = t0.match(/^誰も、?(.+?クリーチャー)を召喚したり、(.+?呪文)を唱えることは(?:でき)?ない$/)) && parseSel(m[1]) && parseSel(m[2]))
    return [
      { s: 'noSummonSel', sel: { ...parseSel(m[1])!, zones: ['hand', 'mana', 'grave', 'shield', 'deck', 'hyper'] } },
      { s: 'oppSpellLock', sel: { ...parseSel(m[2])!, kind: 'spell' }, all: true },
    ];
  if ((m = t0.match(/^((?:進化)?クリーチャー|[^、]+?クリーチャー)は、?タップされた状態でバトルゾーンに出る$/)) && !/^(相手|自分)/.test(m[1]) && parseSel(m[1])) return [{ s: 'oppEntersTapped', sel: parseSel(m[1])!, all: true }];
  if (/^誰もターンを追加できない$/.test(t0)) return [{ s: 'noExtraTurn' }];
  if (/^相手の呪文を唱えるコストは無限のマナを必要とする$/.test(t0)) return [{ s: 'oppSpellLock' }];
  if (/^∞ソウルシフト/.test(t0)) return [{ s: 'soulShift' }];
  if (/^このクリーチャーは、?(?:自分のターンのはじめに)?アンタップしない$/.test(t0)) return [{ s: 'noUntapStart' }];
  if (/^このクリーチャーはタップしてバトルゾーンに置かれ、自分のターンのはじめにアンタップしない$/.test(t0)) return [{ s: 'entersTapped' }, { s: 'noUntapStart' }];
  if ((m = t0.match(/^(光|水|闇|火|自然)のクリーチャーを召喚するコストと(?:光|水|闇|火|自然)の呪文を唱えるコストは、?それぞれ([+-])(\d+)される$/))) {
    const civ = CIV_OF[m[1]];
    const d = (m[2] === '-' ? -1 : 1) * +m[3];
    return [
      { s: 'cost', side: 'any', sel: { owner: 'any', zones: ['hand', 'mana', 'grave', 'shield', 'deck'], kind: 'creature', civs: [civ] }, action: 'summon', delta: d, floor: 1 },
      { s: 'cost', side: 'any', sel: { owner: 'any', zones: ['hand', 'mana', 'grave', 'shield', 'deck'], kind: 'spell', civs: [civ] }, action: 'cast', delta: d, floor: 1 },
    ];
  }
  if ((m = t0.match(/^すべての(.+?)は、?(攻撃(?:また|も)はブロック|攻撃もブロックも|攻撃|ブロック)されない$/)) && parseSel(m[1])) {
    const kws = m[2] === '攻撃' ? ['攻撃されない'] : m[2] === 'ブロック' ? ['ブロックされない'] : ['攻撃されない', 'ブロックされない'];
    return [{ s: 'grant', target: { t: 'sel', sel: parseSel(m[1])! }, kws, when: 'always' }];
  }
  if ((m = t0.match(/^((?:自分|相手)の.+?)は、?(攻撃(?:また|も)はブロック|攻撃もブロックも|攻撃|ブロック)されない$/))) {
    const tg = target(m[1]);
    const kws = m[2] === '攻撃' ? ['攻撃されない'] : m[2] === 'ブロック' ? ['ブロックされない'] : ['攻撃されない', 'ブロックされない'];
    if (tg) return [{ s: 'grant', target: tg, kws, when: 'always' }];
  }
  if (/^このクリーチャーは、?攻撃もブロックもされない$/.test(t0)) return [{ s: 'noAttacked' }, { s: 'grant', target: { t: 'self' }, kws: ['ブロックされない'], when: 'always' }];
  if (/^自分のマナゾーンにあるカード(を|は)、?すべての文明(のカードとして扱う|を持つ)$/.test(t0)) return [{ s: 'rainbowMana' }];
  if ((m = t0.match(/^このクリーチャー(?:を|は)、?(?:自分の)?(マナゾーン|墓地|超次元ゾーン)から召喚してもよい$/))) return [{ s: 'summonFrom', zone: m[1] === '墓地' ? 'grave' : m[1] === '超次元ゾーン' ? 'hyper' : 'mana' }];
  if ((m = t0.replace(/^自分の(墓地|マナゾーン)から(.+?)を召喚してもよい$/, '$2を自分の$1から召喚してもよい').match(/^([^、]+?)を、?自分の(墓地|マナゾーン)から召喚してもよい$/)) && !/^この|\d/.test(m[1])) {
    const zone = m[2] === '墓地' ? 'grave' : 'mana';
    const sel = parseSel(m[1].replace(/と(進化ではない|進化)/g, 'または$1').replace(/^進化ではない(.+?)または進化ではない/, '進化ではない$1または'), { zones: [zone] });
    if (sel) return [{ s: 'summonFromSel', sel: { ...sel, owner: 'self', zones: [zone], kind: 'creature' }, zone }];
  }

  // ---- 攻撃・ブロック・選択 ----
  if (/^このクリーチャーは攻撃されない$/.test(t0)) return [{ s: 'noAttacked' }];
  if (/^このクリーチャーは、?(タップされていない|アンタップしている|アンタップされている)クリーチャーを攻撃できる$/.test(t0)) return [{ s: 'attackUntapped' }];
  if ((m = t0.match(/^このクリーチャーは、?(?:タップされていない|アンタップしている|アンタップされている)(.+?クリーチャー)を攻撃できる$/)) && parseSel(m[1])) return [{ s: 'attackUntapped', sel: parseSel(m[1])! }];
  if (/^このクリーチャーは、?クリーチャーを攻撃できない$/.test(t0)) return [{ s: 'cantAttackCreatures' }];
  if ((m = t0.match(/^このクリーチャーは、?パワー(\d+)以下のクリーチャーにブロックされない$/))) return [{ s: 'unblockableBy', maxPower: +m[1] }];
  if ((m = t0.match(/^(このクリーチャー|これをクロスしたクリーチャー|自分の.+?)は(?:すべて)?、?シールドをさらに(?:もう)?(\d+)(?:枚|つ)ブレイクする$/)) && (/^(この|これを)/.test(m[1]) || parseSel(m[1])))
    return [{ s: 'grant', target: m[1] === 'このクリーチャー' ? { t: 'self' } : m[1] === 'これをクロスしたクリーチャー' ? { t: 'cross' } : { t: 'sel', sel: parseSel(m[1])! }, kws: [`ブレイク+${m[2]}`], when: 'always' }];
  // 「このクリーチャーのパワーは+Nされ、〜」「これをクロスしたクリーチャーは「〜」を得、〜」: 2つに分ける
  if ((m = t0.match(/^(このクリーチャー|これをクロスしたクリーチャー)(?:のパワーは([+-]\d+)され|は((?:「[^」]+」(?:と|、)?)+)を得)、(.+)$/))) {
    const a = parseStaticLine(m[2] ? `${m[1]}のパワーは${m[2]}される` : `${m[1]}は${m[3]}を得る`);
    const b = parseStaticLine(`${m[1]}は${m[4]}`);
    if (a && b) return [...a, ...b];
  }
  if (/^相手のターン中、相手がバトルゾーンにあるクリーチャーを選ぶ時、このクリーチャーは選ばれない$/.test(t0)) return [{ s: 'untargetable', bySpellOnly: false }];
  if (/^自分のクリーチャーは(?:すべて)?、?それよりパワーが小さいクリーチャーにブロックされない$/.test(t0)) return [{ s: 'ownUnblockableSmaller' }];
  if (/^このクリーチャーは、?クリーチャーを攻撃する時(?:、)?ブロックされない$/.test(t0)) return [{ s: 'unblockableBy', vsCreature: true }];
  if ((m = t0.match(/^このクリーチャーは、?(.+?)に(攻撃(?:また|も)はブロック|攻撃|ブロック)されない$/)) && parseSel(m[1])) {
    const sel = parseSel(m[1])!;
    const out: StaticSpec[] = [];
    if (/攻撃/.test(m[2])) out.push({ s: 'noAttackedBy', sel });
    if (/ブロック/.test(m[2])) out.push({ s: 'unblockableBy', sel });
    return out;
  }
  if ((m = t0.match(/^(.+?)は、?このクリーチャーを攻撃(?:することが)?できない$/)) && parseSel(m[1])) return [{ s: 'noAttackedBy', sel: parseSel(m[1])! }];
  if (/^このクリーチャーは、?(このクリーチャー|これ)よりパワーが小さいクリーチャーにブロックされない$/.test(t0)) return [{ s: 'unblockableBy', smallerThanSelf: true }];
  if (/^このクリーチャーは、?(呪文によって)?相手に選ばれない$/.test(t0) || /^(呪文の効果(によって|で))?((?:バトルゾーンにある)?自分のクリーチャーを相手が|相手がバトルゾーンにあるクリーチャーを|相手がクリーチャーを)選ぶ時、このクリーチャーを?は?選(ぶことはできない|ばれない|べない)$/.test(t0))
    return [{ s: 'untargetable', bySpellOnly: /呪文/.test(t0) }];
  if (/^このクリーチャーはブロックされず、相手に選ばれない$/.test(t0)) return [{ s: 'untargetable', bySpellOnly: false }];

  // ---- 条件付き 「鬼タイム:〜なら、」「自分の〇〇がN体以上あれば、」 ----
  const cp = parseCondPrefix(t0);
  if (!cp) return null;
  const t = cp.cond ? cp.rest.replace(/^パワーを/, 'このクリーチャーのパワーを') : cp.rest;
  const cond = cp.cond;
  if (cond && /^相手のクリーチャーは(?:すべて)?、?可能(?:なら|であれば)攻撃する$/.test(t)) return [{ s: 'oppMustAttack', cond }];
  if (cond && (/^自分は攻撃されない$/.test(t) || /^相手のクリーチャーは、?自分を攻撃できない$/.test(t))) return [{ s: 'oppNoAttackMe', cond }];
  if (cond?.c === 'selfNew' && /^このクリーチャーは、?(?:タップされていない|アンタップされている|アンタップしている)クリーチャーを攻撃できる$/.test(t)) return [{ s: 'attackUntappedIf', cond }];

  // ---- パワー ----
  let when: StaticWhen = 'always';
  let body = t;
  let vs: Sel | undefined;
  if ((m = t.match(/^(「[^」]+」を持つクリーチャー|[^、「]+?)とバトル(?:する時|する間|している間|中)、(.+)$/)) && parseSel(m[1])) {
    when = 'battle';
    vs = parseSel(m[1])!;
    body = m[2];
  } else if ((m = t.match(/^(バトル|攻撃|ブロック)中、(.+)$/))) {
    when = m[1] === 'バトル' ? 'battle' : m[1] === '攻撃' ? 'attack' : 'block';
    body = m[2];
  } else if ((m = t.match(/^(相手|自分)のターン中、(.+)$/))) {
    when = m[1] === '相手' ? 'oppTurn' : 'ownTurn';
    body = m[2];
  }
  // 「〜N枚につき、このクリーチャーのパワーを+Nする」
  if ((m = body.match(/^(.+?)(\d+)(?:枚|体|つ)につき、(.+?)のパワー(?:を|は)([+-])(\d+)(?:する|される)$/))) {
    const sel = parseSel(m[1].replace(/^バトルゾーンにある/, ''), { zones: ['battle'] }) ?? perZone(m[1]);
    const tg = target(m[3]);
    if (sel && tg) return [{ s: 'power', target: tg, delta: (m[4] === '-' ? -1 : 1) * +m[5], when, per: { sel, each: +m[2] }, cond }];
  }
  // 「攻撃中、このクリーチャーのパワーを、〜N枚につき+Nする」
  if ((m = body.match(/^(.+?)のパワー(?:を|は)、(.+?)(\d+)(?:枚|体|つ)につき([+-])(\d+)(?:する|される)$/))) {
    const tg = target(m[1]);
    const sel = parseSel(m[2].replace(/^バトルゾーンにある/, ''), { zones: ['battle'] }) ?? perZone(m[2]);
    if (sel && tg) return [{ s: 'power', target: tg, delta: (m[4] === '-' ? -1 : 1) * +m[5], when, per: { sel, each: +m[3] }, cond }];
  }
  // 「〇〇のパワーを+Nし、「W・ブレイカー」を与える」「パワーは+Nされ、「W・ブレイカー」を得る」
  if ((m = body.match(/^(.+?)のパワー(?:を|は)([+-])(\d+)(?:する|される|し|され)(?:、((?:「[^」]+」(?:と|、)?)+)を(?:与える|得る))?$/))) {
    const tg = target(m[1]);
    if (tg) {
      const out: StaticSpec[] = [{ s: 'power', target: tg, delta: (m[2] === '-' ? -1 : 1) * +m[3], when, cond, vs }];
      if (m[4]) out.push({ s: 'grant', target: tg, kws: [...m[4].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond });
      return out;
    }
  }
  // ---- 条件を満たさなければクリーチャーとして扱わない ----
  if (cond && /^バトルゾーンにあるこのタマシードはクリーチャーとして扱わない$/.test(body)) {
    // 条件は「〜なければ」なので、満たす (countLess でない) 時だけクリーチャー
    const pos: StaticCond = cond.c === 'countLess' ? { c: 'countAtLeast', sel: cond.sel, n: cond.n } : cond;
    return [{ s: 'creatureOnlyIf', cond: pos }];
  }
  // ---- 条件つきで、このクリーチャーの召喚コストを増減 ----
  if (cond && (m = body.match(/^(?:このクリーチャーの(?:召喚)?|この呪文(?:を唱える|の))コストを(\d+)(少なく|多く)する(?:[、。]?ただし.*)?$/)))
    return [{ s: 'selfCost', delta: (m[2] === '少なく' ? -1 : 1) * +m[1], cond, floor: floorOf(full) }];
  // 「〜あれば、この呪文をコストを支払わずに唱えてもよい」: コスト0として扱う
  if (cond && /^この(?:呪文|クリーチャー)を(?:自分の手札から)?コストを支払わずに(?:唱え|召喚し)てもよい$/.test(body)) return [{ s: 'selfCost', delta: -99, cond, floor: 0 }];
  // ---- 条件つきの「ブロックされない」「攻撃できない」など ----
  if (cond && (m = body.replace(/することが(でき)/, '$1').match(/^このクリーチャーは、?(ブロックされない|攻撃されない|攻撃できない|相手プレイヤーを攻撃できない)$/))) {
    const kw = m[1] === '相手プレイヤーを攻撃できない' ? 'プレイヤー攻撃不可' : m[1];
    return [{ s: 'grant', target: { t: 'self' }, kws: [kw], when, cond }];
  }
  // ---- キーワード付与 ----
  if ((m = body.match(/^このクリーチャーは、?パワーが(\d+)以上の時、((?:「[^」]+」(?:と|、)?)+)を得る$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond: { c: 'powerAtLeast', n: +m[1] } }];
  if ((m = body.match(/^(.+?)(?:は|に)(?:すべて)?((?:「[^」]+」(?:と|、)?)+)を(?:得る|与える)$/))) {
    const tg = target(m[1]);
    if (tg) return [{ s: 'grant', target: tg, kws: [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond }];
  }

  // ---- コスト ----
  if ((m = t.replace(/^(自分|相手)の、/, '$1の').match(/^(自分|相手)?の?(.+?)を(召喚|唱える|使う|実行する)(?:する)?コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる|してもよい)(?:[、。]?ただし.*)?$/)) ||
    (m = t.replace(/^(自分|相手)の、/, '$1の').match(/^(自分|相手)?の?(.+?)の(召喚)コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる|してもよい)(?:[、。]?ただし.*)?$/))) {
    const sel = parseSel(m[2], { zones: ['hand', 'mana', 'grave', 'shield', 'deck'] });
    if (sel) {
      const action = m[3] === '召喚' ? 'summon' : m[3] === '唱える' ? 'cast' : 'use';
      if (action === 'summon' && sel.kind === 'card') sel.kind = 'creature';
      if (action === 'cast') sel.kind = 'spell';
      return [{ s: 'cost', side: m[1] === '相手' ? 'opp' : m[1] === '自分' ? 'self' : 'any', sel, action, delta: (m[5] === '少なく' ? -1 : 1) * +m[4], floor: floorOf(full) }];
    }
  }
  // 条件つき: 条件を外した残りを解析し、条件に対応した能力 (パワー・能力の付与) なら条件を付ける
  if (cond && t !== t0) {
    const inner = parseStaticLine(t);
    if (inner?.length && inner.every((x) => (x.s === 'grant' || x.s === 'power' || x.s === 'noUntapStart' || x.s === 'summonFrom') && !x.cond)) return inner.map((x) => ({ ...x, cond }) as StaticSpec);
  }
  const rm = parseReplaceMove(t0);
  if (rm) return [rm];
  return null;
}

/** 墓地に置くかわりの行き先 (「手札に戻す」「山札に戻してシャッフルする」) */
function replaceZoneOf(v0: string): ReplaceZone | null {
  const v = v0
    .replace(/戻してもよい$/, '戻す')
    .replace(/加えてもよい$/, '加える')
    .replace(/置いてもよい$/, '置く')
    .replace(/シャッフルしてもよい$/, 'シャッフルする')
    .replace(/^(?:(?:この|その)(?:クリーチャー|ゴッド|カード)を)/, '')
    .replace(/^(?:自分の|持ち主の)/, '');
  if (/^手札に(?:戻す|加える)(?:かマナゾーンに置く)?$/.test(v)) return 'hand';
  if (/^(?:タップして)?(?:自分の|持ち主の)?マナゾーンに置く$/.test(v)) return 'mana';
  if (/^山札の(?:一番)?上に置く$/.test(v)) return 'deckTop';
  if (/^山札の(?:一番)?下に置く$/.test(v)) return 'deckBottom';
  if (/^山札に(?:戻して|加えて)、?シャッフルする$/.test(v)) return 'deckShuffle';
  if (/^(?:裏向きにして|裏向きにし、|表向きにして、?)?(?:新しいシールドとして、?)?(?:自分の)?シールド(?:ゾーン)?に(?:裏向きにして)?(?:加える|置く)$/.test(v)) return 'shield';
  if (/^このクリーチャーの下に置く$/.test(v)) return 'underSrc';
  return null;
}

function parseReplaceMove(t1: string): StaticSpec | null {
  // 「ただし、その「S・トリガー」は使えない」は無視する
  let t = t1.replace(/^(?:マナ武装\d+|龍回避|龍魂回避)[:：―\-ー?]/, '').replace(/。ただし、.+$/, '');
  const once = /^各ターンに(?:一|1)度、/.test(t);
  t = t.replace(/^各ターンに(?:一|1)度、/, '');
  // 「〜してもよい。そうした場合、このクリーチャーは墓地に置かれるかわりにバトルゾーンにとどまる」
  t = t.replace(/^(.+?時、)(.+?てもよい)。(?:そうした場合|そうしたら|その場合)、(?:この|その)クリーチャーは(?:墓地に置かれる|バトルゾーンを離れる|離れる)かわりに(?:バトルゾーンに)?とどまる$/, '$1かわりに$2');
  if (/。/.test(t)) return null;
  const m = t.match(/^(相手のターン中に|相手の呪文によって)?(.+?)が(破壊される|バトルゾーンを離れる|離れる|バトルゾーンから自分の墓地に置かれる)(?:時|とき)、(.+)$/);
  if (!m) return null;
  let subj: ReplaceSubj | null = null;
  const sp = m[2].replace(/^自分の、/, '自分の');
  if (/^このクリーチャー$/.test(sp)) subj = { t: 'self' };
  else if (/^これを(?:装備|付け|クロス)したクリーチャー$/.test(sp)) subj = { t: 'host' };
  else {
    const both = sp.match(/^このクリーチャーまたは(自分の.+)$/);
    const ph = both ? both[1] : sp;
    if (!/自分の/.test(ph) || /相手の/.test(ph)) return null;
    const sel = parseSel(ph.replace(/^(.+?)自分の(.+)$/, '自分の$1$2').replace(/^自分の名前に/, '名前に'));
    if (!sel) return null;
    subj = { t: 'sel', sel: { ...sel, owner: 'self' }, incSelf: !!both };
  }
  const on: 'destroy' | 'leave' = /破壊|墓地/.test(m[3]) ? 'destroy' : 'leave';
  let body = m[4];
  let cond: Cond | undefined;
  const cm = body.match(/^([^、]+?(?:れば|なら|ならば))、(.+)$/);
  if (cm && !/かわりに/.test(cm[1])) {
    const c = parseCond(cm[1].replace(/(?:であれば|ならば|なら|れば)$/, ''));
    if (!c) return null;
    cond = c;
    body = cm[2];
  }
  const base = { s: 'replaceMove' as const, subj, on, ...(cond ? { cond } : {}), ...(once ? { oncePerTurn: true } : {}), ...(m[1] === '相手のターン中に' ? { oppTurn: true } : {}), ...(m[1] === '相手の呪文によって' ? { oppSpell: true } : {}) };
  // とどまる
  if (/^(?:(?:この|その)クリーチャーは)?(?:墓地に置(?:かれる|く)|バトルゾーンを離れる|離れる)?かわりに(?:バトルゾーンに)?とどまる$/.test(body)) return { ...base, act: 'stay' };
  // 墓地のかわりに別の場所へ
  const rd = body.match(/^(?:(?:この|その)(?:クリーチャー|ゴッド|カード)を)?(?:墓地に置く|墓地におく|破壊する)?かわりに、?(.+)$/);
  // 主語が他のクリーチャーの時の「かわりにこのクリーチャーを〜」は、このクリーチャーが身代わりになる
  if (rd && !(subj.t !== 'self' && /^このクリーチャーを/.test(rd[1]))) {
    const z = replaceZoneOf(rd[1]);
    if (z && (on === 'destroy' || z === 'hand')) return { ...base, act: 'redirect', zone: z };
  }
  // かわりに〜を支払って、とどまる
  let eff: string | null = null;
  const dm = body.match(/^(?!かわりに)(.+?)(?:を)?(?:(\d+)体)?、?かわりに破壊(する|してもよい)$/);
  if (dm) eff = dm[1] === 'このクリーチャー' || dm[1] === 'このクリーチャーを' ? `このクリーチャーを破壊${dm[3]}` : `${dm[1].replace(/を?(\d+)体$/, '')}を${dm[2] ?? dm[1].match(/(\d+)体$/)?.[1] ?? 1}体破壊${dm[3]}`;
  const pm = !eff && body.match(/^(?:(?:この|その)クリーチャーを)?(?:墓地に置く|墓地におく|離れる|バトルゾーンを離れる)?かわりに、?(.+)$/);
  if (pm) eff = pm[1];
  if (!eff) return null;
  return { ...base, act: 'pay', effect: eff, ...(/^このカードを(?:自分の)?手札から捨て/.test(eff) ? { fromHand: true } : {}) };
}

/** 「自分のマナゾーンにあるカード」「自分の墓地にある火のカード」 */
function perZone(phrase: string): Sel | null {
  const m = phrase.match(/^(自分|相手)の(墓地|マナゾーン|手札|シールドゾーン)にある(.+)$/);
  if (!m) return null;
  const zone = ({ 墓地: 'grave', マナゾーン: 'mana', 手札: 'hand', シールドゾーン: 'shield' } as const)[m[2] as '墓地'];
  const sel = parseSel(m[3], { zones: [zone] });
  if (!sel) return null;
  sel.zones = [zone];
  sel.owner = m[1] === '自分' ? 'self' : 'opp';
  if (sel.kind === 'creature' && /カード$/.test(m[3])) sel.kind = 'card';
  return sel;
}

/** カードの全テキスト行から常在型能力を集める */
export function parseStatics(lines: string[]): StaticSpec[] {
  const out: StaticSpec[] = [];
  for (const l of lines) {
    const r = parseStaticLine(l);
    if (r) out.push(...r);
  }
  return out;
}
