// カードテキストから誘発型能力 (「～時、」「～はじめに、」「～終わりに、」) を抽出する
import { hintsFromText, SIMPLE_KINDS } from '../engine/effects';
import { MARKED_LINE, mergeModal, normText, stripReminder } from '../rules/text';
import { parseSel } from '../rules/selector';
import { parseStaticLine } from '../rules/statics';
import type { Sel } from '../rules/ops';

export type TrigEvent =
  | 'enter' // このクリーチャーが出た時
  | 'otherOwnEnter' // 自分の(他の)クリーチャーが出た時
  | 'oppEnter' // 相手のクリーチャーが出た時 / 相手がクリーチャーを召喚した時
  | 'attack' // このクリーチャーが攻撃する時
  | 'ownAttack' // 自分のクリーチャーが攻撃する時
  | 'oppAttack' // 相手のクリーチャーが攻撃する時
  | 'block' // このクリーチャーがブロックした時
  | 'winBattle' // このクリーチャーがバトルに勝った時
  | 'destroyed' // このクリーチャーが破壊された時
  | 'otherOwnDestroyed'
  | 'oppDestroyed'
  | 'leave' // このクリーチャーがバトルゾーンを離れた時
  | 'breakShield' // このクリーチャーがシールドをブレイクした時
  | 'ownShieldBroken' // 自分のシールドがブレイクされた時
  | 'oppShieldBroken' // 相手のシールドがブレイクされた時 (1枚ごと)
  | 'spellOwn' // 自分が呪文を唱えた時
  | 'spellOpp' // 相手が呪文を唱えた時
  | 'spellAny'
  | 'attacked' // このクリーチャーが攻撃された時
  | 'blocked' // このクリーチャーがブロックされた時
  | 'unblocked' // このクリーチャーが攻撃してブロックされなかった時
  | 'oppUnblocked' // 相手のクリーチャーが攻撃してブロックされなかった時
  | 'battle' // このクリーチャーがバトルする時
  | 'toGrave' // このカードが墓地に置かれた時
  | 'crossAttack' // これをクロスしたクリーチャーが攻撃する時
  | 'turnStartOwn'
  | 'turnStartOpp'
  | 'turnEndOwn'
  | 'turnEndOpp'
  | 'tapAbility' // 攻撃するかわりにタップして使う能力
  | 'ownManaPut' // 自分のマナゾーンに〇〇が置かれた時
  | 'toManaSelf' // このカードをマナゾーンに置いた時
  | 'toShieldFaceUp' // このクリーチャーが表向きでシールドゾーンに置かれた時
  | 'attached' // これをクリーチャーに付けた時
  | 'tapped' // このクリーチャーがタップした時
  | 'ownWinBattle' // 自分のクリーチャーがバトルに勝った時
  | 'unsealOne' // このカードから封印が外された時
  | 'unsealedAll' // このカードの封印がすべてなくなった時
  | 'evolvedOn' // シンカパワー: このクリーチャーが進化する時
  | 'mugetsuUsed' // 自分の「無月の門」能力を使った時
  | 'attackEnd' // このクリーチャーの攻撃の終わりに
  | 'otherOwnLeave' // 自分の他のクリーチャーが離れた時
  | 'oppToGrave' // カードが相手の墓地に置かれた時
  | 'flipped' // このクリーチャーが龍解した時 / 覚醒した時
  | 'ownShieldAdded' // 自分のシールドゾーンにカードが置かれた時
  | 'ownShieldLeft' // カードが自分のシールドゾーンを離れた時
  | 'ownBattle' // 自分の(他の)〇〇がバトルする時
  | 'ownAttacked' // 自分のクリーチャーが攻撃された時
  | 'oppSTrigger' // 相手が「S・トリガー」を使った時
  | 'ownDraw' // 自分がカードを引いた時
  | 'oppDraw' // 相手がカードを引いた時
  | 'chosenByOpp' // 相手がこのクリーチャーを選んだ時
  | 'loseBattle' // このクリーチャーがバトルに負けた時
  | 'godLinked' // このクリーチャーがゴッドとリンクした時
  | 'crossDestroyed' // これをクロス/装備/付けたクリーチャーが破壊された時
  | 'crossWin' // これをクロス/装備/付けたクリーチャーがバトルに勝った時
  | 'zeroBirth' // 零龍卍誕した時
  | 'ownToGrave' // カードを自分の墓地に置いた時
  | 'ownGraveToBattle'; // カードを自分の墓地からバトルゾーンに出した時

export const EVENT_LABEL: Record<TrigEvent | 'spell', string> = {
  enter: '出た時',
  otherOwnEnter: '自分のクリーチャーが出た時',
  oppEnter: '相手のクリーチャーが出た時',
  attack: '攻撃する時',
  ownAttack: '自分のクリーチャーが攻撃する時',
  oppAttack: '相手のクリーチャーが攻撃する時',
  block: 'ブロックした時',
  winBattle: 'バトルに勝った時',
  destroyed: '破壊された時',
  otherOwnDestroyed: '自分のクリーチャーが破壊された時',
  oppDestroyed: '相手のクリーチャーが破壊された時',
  leave: 'バトルゾーンを離れた時',
  breakShield: 'シールドをブレイクした時',
  ownShieldBroken: 'シールドがブレイクされた時',
  oppShieldBroken: '相手のシールドをブレイクした時',
  spellOwn: '自分が呪文を唱えた時',
  spellOpp: '相手が呪文を唱えた時',
  spellAny: '呪文が唱えられた時',
  attacked: '攻撃された時',
  blocked: 'ブロックされた時',
  unblocked: 'ブロックされなかった時',
  oppUnblocked: '相手のクリーチャーがブロックされなかった時',
  battle: 'バトルする時',
  toGrave: '墓地に置かれた時',
  crossAttack: 'クロスしたクリーチャーが攻撃する時',
  turnStartOwn: '自分のターンのはじめ',
  turnStartOpp: '相手のターンのはじめ',
  turnEndOwn: '自分のターンの終わり',
  turnEndOpp: '相手のターンの終わり',
  tapAbility: 'タップして使う能力',
  ownManaPut: 'マナゾーンにカードが置かれた時',
  toManaSelf: 'マナゾーンに置いた時',
  toShieldFaceUp: '表向きでシールドゾーンに置かれた時',
  attached: 'クリーチャーに付けた時',
  tapped: 'タップした時',
  ownWinBattle: '自分のクリーチャーがバトルに勝った時',
  unsealOne: '封印が外された時',
  unsealedAll: '封印がすべてなくなった時',
  evolvedOn: '進化する時',
  mugetsuUsed: '「無月の門」能力を使った時',
  attackEnd: '攻撃の終わり',
  otherOwnLeave: '自分の他のクリーチャーが離れた時',
  oppToGrave: '相手の墓地にカードが置かれた時',
  flipped: '龍解・覚醒した時',
  ownShieldAdded: 'シールドゾーンにカードが置かれた時',
  ownShieldLeft: 'シールドゾーンを離れた時',
  ownBattle: '自分のクリーチャーがバトルする時',
  ownAttacked: '自分のクリーチャーが攻撃された時',
  oppSTrigger: '相手が「S・トリガー」を使った時',
  ownDraw: '自分がカードを引いた時',
  oppDraw: '相手がカードを引いた時',
  chosenByOpp: '相手に選ばれた時',
  loseBattle: 'バトルに負けた時',
  godLinked: 'リンクした時',
  crossDestroyed: '付けたクリーチャーが破壊された時',
  crossWin: '付けたクリーチャーがバトルに勝った時',
  zeroBirth: '零龍卍誕した時',
  ownToGrave: 'カードを自分の墓地に置いた時',
  ownGraveToBattle: 'カードを自分の墓地からバトルゾーンに出した時',
  spell: '呪文の効果',
};

export interface TriggerSpec {
  events: TrigEvent[];
  /** 「自分の光のハンターが出た時」の「光のハンター」 (他のカードの出入り・攻撃・破壊で誘発する時の条件) */
  subject?: Sel;
  /** 「各ターンに1度」「各ターン、はじめて〜時」 */
  oncePerTurn?: boolean;
  /** 元のテキスト (表示用) */
  text: string;
  /** 効果部分 */
  effect: string;
  optional: boolean;
  /** 選択や条件がなく、自動で実行できる */
  auto: boolean;
  /** 手札にある時に使う能力 (「このカードを自分の手札から実行してもよい」など) */
  fromHand?: boolean;
  /** 墓地にある時にも使う能力 (無月の門) */
  fromGrave?: boolean;
  /** 「自分の〇〇が出た時」(「他の」がない) は、このカード自身が出た時も誘発する */
  includeSelf?: boolean;
  /** 「召喚以外の方法で出た時」 / 「召喚によって出た時」 */
  howEnter?: 'notSummon' | 'summon' | 'revChange';
  /** 「自分のターン中に」「相手のターン中に」だけ誘発する */
  turn?: 'own' | 'opp';
}

const SKIP = /^(ブロッカー|革命チェンジ|S級侵略|侵略|ニンジャ・ストライク|S・トリガー|シールド・トリガー|スーパー・S・トリガー|G・ストライク|スピードアタッカー|マッハファイター|ジャストダイバー|スレイヤー|[WTQ]・ブレイカー|ワールド・ブレイカー|EXライフ|チャージャー|G・ゼロ|シンパシー|パワーアタッカー)/;

const SKIP_TRIG = /^(革命チェンジ|S級侵略|侵略|ニンジャ・ストライク)/;

export { stripReminder };

const CONDITIONAL = /もし|場合|かわりに|選|それ|その後|かつ|あれば|なければ|以外|好きな|または|ごとに|につき|見て|公開/;

export function isAutoEffect(effect: string, optional: boolean): boolean {
  if (optional || CONDITIONAL.test(effect) || effect.length > 45) return false;
  const hints = hintsFromText([effect]);
  return hints.length > 0 && hints.every((h) => SIMPLE_KINDS.includes(h.kind));
}

export function parseTriggers(rawLines: string[]): TriggerSpec[] {
  const out: TriggerSpec[] = [];
  for (const raw of rawLines) {
    const line = stripReminder(normText(raw)).trim().replace(/^自分のターンが終わる時、/, '自分のターンの終わりに、').replace(/^このクリーチャーの各ブレイクの前に、/, 'このクリーチャーがシールドをブレイクする時、')
      // 古い表記: 「このクリーチャーがバトルゾーンにある間、〜たびに」
      .replace(/^このクリーチャーがバトルゾーンにある間(?:に)?、(?=.{1,80}?(?:時|たびに?|はじめに|終わりに)、)/, '')
      .replace(/^(.{1,80}?)(?:置かれる|出る|出た)たびに?、/, (_, x) => `${x}${/置かれる/.test(_) ? '置かれた' : '出た'}時、`);
    if (!line || SKIP_TRIG.test(line)) continue;
    // 「とどまる」「手札に加えるかわりに墓地に置く」は常在型能力として処理
    if (/(離れるかわりにとどまる|離れずにとどまる)$|^このクリーチャーがシールドをブレイクする時、相手は.*手札に加えるかわりに、?(持ち主の)?墓地に置く/.test(line.replace(/\s+/g, '').replace(/。$/, '')) && /^(相手の呪文(の効果で|によって))?(バトルゾーンに.+?があり、)?このクリーチャーが/.test(line)) continue;
    if (/^これをクロスしたクリーチャーが破壊される時、.*かわりに/.test(line.replace(/\s+/g, ''))) continue;
    if (/^このクリーチャーが(破壊される|バトルゾーンを離れる|離れる)時、(カードがこ(れ|のクリーチャー)の下にあれば、)?(墓地に置く|バトルゾーンを離れる)?かわりに、?.+(破壊|捨て|手札に(加え|戻)|墓地に置|マナゾーンに置|山札の(一番)?(下|上)に置|表向きに|タップ|裏返)/.test(line.replace(/\s+/g, ''))) continue;
    // 汎用の置換効果 (「〜が破壊される時、かわりに〜」「〜が出る時、かわりに〜」・鬼S-MAX進化・5.S.D.) は常在型能力として処理
    if (/かわりに|横向き|順番を入れ替え|^シビルカウント/.test(line) && (parseStaticLine(raw) ?? []).some((x) => ['replaceMove', 'enterReplace', 'oniSmax', 'breakToDeck4', 'note', 'power', 'grant'].includes(x.s))) continue;
    // S・トリガー・プラスで与えられる {x+} 能力は、効果の側に印を残す (条件は効果を解釈する時に付ける)
    const stPlus = /^\{x\+\}/.test(line);
    const m = line.replace(/^\{x\+\}\s*/, '').match(/^(.{1,90}?)(時|はじめに|終わりに)、(.+)$/s);
    if (!m) continue;
    let clause = m[1] + m[2];
    let effect = (stPlus ? '{x+}' : '') + m[3];
    // 「自分の手札から/墓地から呪文を唱えた時」: 唱えたゾーンを効果の側で調べる
    const cfz = clause.replace(/\s+/g, '').match(/^自分の(手札|墓地)から呪文を唱えた時$/);
    if (cfz) effect = `〈${cfz[1]}から唱えた〉${effect}`;
    // 「このクリーチャーが出た時、またはこのクリーチャーが攻撃する時、〜」
    for (let k = 0; k < 4 && /^(または|あるいは)/.test(effect); k++) {
      const more = effect.match(/^((?:または|あるいは).{1,80}?(?:時|はじめに|終わりに))、(.+)$/s);
      if (!more) break;
      clause += more[1];
      effect = more[2];
    }
    const self = /この(クリーチャー|カード|タマシード|クロスギア|フィールド|城|オーラ|ドラグハート)/.test(clause);
    const opp = /相手/.test(clause);
    const own = /自分/.test(clause);
    const ev = new Set<TrigEvent>();
    if (/ターンのはじめに/.test(clause)) {
      if (own || /各|すべての|いずれか/.test(clause) || !opp) ev.add('turnStartOwn');
      if (opp || /各|すべての|いずれか/.test(clause)) ev.add('turnStartOpp');
    }
    if (/ターンの終わりに/.test(clause)) {
      if (own || /各|すべての|いずれか/.test(clause) || !opp) ev.add('turnEndOwn');
      if (opp || /各|すべての|いずれか/.test(clause)) ev.add('turnEndOpp');
    }
    const cross = /(クロスした|付けた|装備した)クリーチャー/.test(clause);
    if (/(出た|出した|召喚した)時/.test(clause)) {
      if (self) ev.add('enter');
      else if (/他のクリーチャーが/.test(clause) && !own && !opp) (ev.add('otherOwnEnter'), ev.add('oppEnter'));
      else if (opp) ev.add('oppEnter');
      else if (own) ev.add('otherOwnEnter');
    }
    if (/ブロックされなかった時/.test(clause)) {
      if (self) ev.add('unblocked');
      else if (opp) ev.add('oppUnblocked');
    } else if (/攻撃する時|攻撃またはブロックした時/.test(clause)) {
      if (cross) ev.add('crossAttack');
      else if (self) ev.add('attack');
      else if (opp) ev.add('oppAttack');
      else if (own) ev.add('ownAttack');
    }
    if (/攻撃された時/.test(clause) && self) ev.add('attacked');
    if (/ブロックされた時/.test(clause) && self) ev.add('blocked');
    if (/ブロック(した|する)時/.test(clause) && self) ev.add('block');
    if (/バトルに勝った時/.test(clause) && self) ev.add('winBattle');
    else if (/自分の(.+?)?クリーチャーがバトルに勝った時/.test(clause)) ev.add('ownWinBattle');
    if (/バトルする時/.test(clause) && self) ev.add('battle');
    // 「破壊される時」「離れる時」は置換効果だが、処理を忘れないよう発生後に提示する
    if (/破壊(された|される)時/.test(clause)) {
      if (self) ev.add('destroyed');
      else if (opp) ev.add('oppDestroyed');
      else if (own) ev.add('otherOwnDestroyed');
    }
    if (/離れ(た|る)時/.test(clause) && self) ev.add('leave');
    if (/墓地に置かれた時/.test(clause) && self) ev.add('toGrave');
    if (/ブレイク(した|する)時/.test(clause) && self) ev.add('breakShield');
    if (/ブレイクされた時/.test(clause) && /自分のシールド/.test(clause)) ev.add('ownShieldBroken');
    const manaPut = clause.match(/自分のマナゾーンに(.+?)が置かれた時/);
    if (manaPut) ev.add('ownManaPut');
    if (/この(カード|クリーチャー)を(自分の)?(手札から)?マナゾーンに置いた時/.test(clause)) ev.add('toManaSelf');
    if (/表向きで(自分の)?シールドゾーンに置かれた時/.test(clause) && self) ev.add('toShieldFaceUp');
    if (/^これを(クリーチャーに)?付けた時/.test(clause)) ev.add('attached');
    if (/タップ(した|された)時/.test(clause) && self && !/攻撃/.test(clause)) ev.add('tapped');
    if (/封印がすべて(なくなった|外れた)時/.test(clause)) ev.add('unsealedAll');
    if (/この(クリーチャー|タマシード)が進化する時/.test(clause)) ev.add('evolvedOn');
    if (/自分の「無月の門」能力を使った時/.test(clause)) ev.add('mugetsuUsed');
    if (/この(?:クリーチャー|ドラグハート)が(?:龍解|覚醒|禁断爆発|禁断解放)した時/.test(clause)) ev.add('flipped');
    if (/自分のシールドゾーンにカードが置かれた時/.test(clause)) ev.add('ownShieldAdded');
    if (/カードが自分のシールドゾーンを離れた時|自分のシールドが(?:シールドゾーンを)?離れた時/.test(clause)) ev.add('ownShieldLeft');
    if (/他のクリーチャーが破壊された時/.test(clause) && !own && !opp) (ev.add('otherOwnDestroyed'), ev.add('oppDestroyed'));
    if (/このクリーチャーがバトルした時/.test(clause)) ev.add('battle');
    if (/このクリーチャーがバトルゾーンから(?:自分の)?墓地に置かれる時/.test(clause)) ev.add('destroyed');
    if (/^自分の(?:他の)?[^、]+?が(?:相手(?:の)?クリーチャーと)?バトルする時/.test(clause) && !self) ev.add('ownBattle');
    if (/^自分の[^、]*?クリーチャーが攻撃された時/.test(clause)) ev.add('ownAttacked');
    if (/相手が「S・トリガー」(?:能力)?を使った時/.test(clause)) ev.add('oppSTrigger');
    if (/相手が(?:この(?:クリーチャー|カード)|バトルゾーンにあるこのクリーチャー)を選んだ時/.test(clause)) ev.add('chosenByOpp');
    if (/このクリーチャーがバトルに負けた時/.test(clause)) ev.add('loseBattle');
    if (/このクリーチャーが零龍卍誕した時/.test(clause)) ev.add('zeroBirth');
    if (/^カードを自分の墓地に置いた時/.test(clause)) ev.add('ownToGrave');
    if (/^カードを自分の墓地からバトルゾーンに出した時/.test(clause)) ev.add('ownGraveToBattle');
    if (/これを(?:クロスした|装備した|付けた)クリーチャーが破壊(?:された|される)時/.test(clause)) ev.add('crossDestroyed');
    if (/これを(?:クロスした|装備した|付けた)クリーチャーがバトルに勝った時/.test(clause)) ev.add('crossWin');
    if (/このクリーチャーが(?:ゴッドと|他のカード\d+枚と)?リンクした時/.test(clause)) ev.add('godLinked');
    if (/^(?:各ターン、)?クリーチャーが破壊された時/.test(clause)) (ev.add('otherOwnDestroyed'), ev.add('oppDestroyed'));
    if (/^(?:鬼エンド[:：])?クリーチャーが攻撃する時/.test(clause)) (ev.add('ownAttack'), ev.add('oppAttack'));
    if (/^このクリーチャーを表向きにして(?:自分の)?シールドゾーンに(?:加えた|置いた)時/.test(clause)) ev.add('toShieldFaceUp');
    if (/^このクリーチャーの攻撃の終わりに$/.test(clause)) ev.add('attackEnd');
    if (/^(?:各ターン(?:に)?(?:1|一)度、)?自分の他の[^、]+?が(?:バトルゾーンを)?離れた時$/.test(clause)) ev.add('otherOwnLeave');
    if (/^カードが(?:どこからでも)?相手の墓地に置かれた時$|^相手の墓地にカードが置かれた時$/.test(clause)) ev.add('oppToGrave');
    if (/相手がカードを引いた時/.test(clause)) ev.add('oppDraw');
    else if (/自分がカードを引いた時/.test(clause)) ev.add('ownDraw');
    if (/^自分の[^、]+?がバトルに勝った時/.test(clause) && !self) ev.add('ownWinBattle');
    if (/(このカード|これ)から封印が外された時/.test(clause)) ev.add('unsealOne');
    if (/呪文を唱えた時/.test(clause)) {
      if (/相手が/.test(clause)) ev.add('spellOpp');
      else if (/自分が|^自分の(?:手札|墓地)から|^自分の[^、]+?呪文を唱えた時$/.test(clause)) ev.add('spellOwn');
      else ev.add('spellAny');
    }
    if (!ev.size) continue;
    if (ev.has('attackEnd') && (parseStaticLine(raw) ?? []).some((x) => ['untapAfterAttack', 'winAfterAttack', 'destroyAfterAttack'].includes(x.s))) continue;
    const optional = /てもよい|ことができる/.test(effect);
    // 他のカードを見張る能力の対象 (「自分の(他の)〇〇が出た時」「相手が〇〇を召喚した時」)
    let subject: Sel | undefined;
    const watch = [...ev].some((e) => /^(otherOwn|opp)(Enter|Destroyed|Attack)$|^own(Attack|Battle|WinBattle|Attacked)$/.test(e));
    if (watch) {
      const sm =
        clause.match(/(?:自分|相手)の(?:他の)?(.+?)(?:が|を)(?:バトルゾーンに)?(?:出(?:た|した)|召喚した|攻撃する|破壊された|(?:相手(?:の)?クリーチャーと)?バトルする|バトルに勝った|攻撃された)時/) ??
        clause.match(/相手が(.+?)を(?:バトルゾーンに)?(?:出(?:した)?|召喚した)時/);
      if (sm && !/^クリーチャー$/.test(sm[1])) subject = parseSel(sm[1]) ?? undefined;
    }
    // 「自分の魔導具呪文を唱えた時」: 唱えた呪文が条件に合う時だけ
    const spellOf = ev.has('spellOwn') && clause.match(/^自分の([^、]+?)呪文を唱えた時$/);
    if (spellOf && !/^(?:手札|墓地)から$/.test(spellOf[1])) {
      const ss = parseSel(spellOf[1].replace(/の$/, '') + '呪文');
      if (ss) subject = { ...ss, zones: ['hand', 'grave', 'mana', 'deck', 'shield', 'battle'] };
    }
    const lv = ev.has('otherOwnLeave') && clause.match(/自分の他の([^、]+?)が(?:バトルゾーンを)?離れた時$/);
    if (lv && !/^クリーチャー$/.test(lv[1])) {
      const ls = parseSel(lv[1]);
      if (ls) subject = { ...ls, zones: ['hand', 'grave', 'mana', 'deck', 'shield', 'battle'] };
    }
    if (manaPut && !/^カード$/.test(manaPut[1])) {
      const ms = parseSel(manaPut[1]);
      if (ms) subject = { ...ms, zones: ['mana'] };
    }
    const oncePerTurn = /各ターン(に)?(1|一)度|各ターン、.*はじめて|各ターンはじめて/.test(clause) || /この能力は、?各ターン(1|一)度しか使えない/.test(effect);
    const eff0 = effect.replace(/\s+/g, '');
    const fromHand = /^(この(カード|クリーチャー|呪文)を|これを).{0,30}?(自分の)?手札から/.test(eff0) || /^このクリーチャーが自分の手札にあれば/.test(eff0) || /このクリーチャーを手札から表向きに/.test(eff0) || /手札にあるこのクリーチャーと/.test(eff0) || /この呪文を(?:自分の)?(?:手札から)?(コストを支払わずに)?唱え/.test(eff0);
    const fromGrave = /このクリーチャーを自分の(?:手札または)?墓地から/.test(eff0);
    const howEnter = /「革命チェンジ」によって(?:バトルゾーンに)?出た時/.test(clause) ? ('revChange' as const) : /召喚以外の方法で/.test(clause) ? ('notSummon' as const) : /召喚によって出た時|を召喚した時/.test(clause) ? ('summon' as const) : undefined;
    const turnM = clause.match(/^(自分|相手)のターン(?:中)?に?、?/);
    const turn = turnM ? (turnM[1] === '自分' ? ('own' as const) : ('opp' as const)) : undefined;
    const includeSelf = ev.has('otherOwnEnter') && !/他の/.test(clause) && /自分の[^、]+?が(?:バトルゾーンに)?出た時/.test(clause) ? true : undefined;
    out.push({ events: [...ev], text: raw, effect, optional, auto: isAutoEffect(effect, optional), subject, oncePerTurn, fromHand: fromHand || fromGrave || undefined, fromGrave: fromGrave || undefined, includeSelf, howEnter, turn });
  }
  return out;
}

/** キーワードだけの行 (「D・D・D [ll03]」「ハイパーエナジー」「アタック・チャンス:〜」など。文になっていない) */
function isKeywordOnly(l: string): boolean {
  const t = l.replace(/\s+/g, '');
  if (t.length > 40 || /[をに、]/.test(t) || /^爆進ダブル/.test(t)) return false;
  return !/(する|す|る|た|い)$/.test(t) || /^[^。]{2,20}[:：\-―]/.test(t);
}

/** 呪文の効果として解決するテキスト (キーワード行を除く) */
/** 「この呪文を自分の手札から唱えた後、この呪文を墓地からコストを支払わずに唱えてもよい」 (呪文を出す処理で行う) */
export const RECAST = /^(xB)?\s*この呪文を自分の手札から唱えた後、この呪文を(自分の)?墓地からコストを支払わずに唱えてもよい/;

export function spellEffectLines(lines: string[]): string[] {
  return mergeModal(lines)
    .map((l) => stripReminder(normText(l)).trim())
    .filter((l) => l && !SKIP.test(l) && !/^(このカードを)?マナゾーンに置く時/.test(l) && !/^この(呪文|カード)は/.test(l) && !MARKED_LINE.test(l) && !/^(ナイト・マジック|サイクロン|水晶チャージャー)$/.test(l) && !isKeywordOnly(l) && !/^この(カード|呪文)を(自分の)?(手札から)?マナゾーンに置いた時/.test(l) && !/^革命\d+トリガー/.test(l) && !/^相手のクリーチャーが自分を攻撃する時/.test(l) && !RECAST.test(l) && !(/時、/.test(l) && parseTriggers([l]).some((x) => x.fromHand)) && !/^この呪文を、?(自分の)?(マナゾーン|墓地)から唱えてもよい。?(そうしたら、唱えた後、墓地に置くかわりに(自分の)?山札の(一番)?下に置く。?)?$/.test(normText(l).replace(/\s+/g, '')) && !isCastStatic(l));
}

/** 「〜あれば、この呪文に「S・トリガー」を与える」「〜あれば、この呪文をコストを支払わずに唱えてもよい」 (常在型として処理する) */
function isCastStatic(l: string) {
  if (!/「S・トリガー」を与える。?$|この呪文を(?:自分の手札から)?コストを支払わずに唱えてもよい。?$|この呪文(?:を唱える|の)コストを\d+少なくする/.test(l)) return false;
  return !!parseStaticLine(l)?.some((x) => (x.s === 'grant' && x.kws.includes('S・トリガー')) || x.s === 'selfCost' || x.s === 'sympathy');
}
