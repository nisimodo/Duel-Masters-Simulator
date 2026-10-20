// カードテキストから誘発型能力 (「～時、」「～はじめに、」「～終わりに、」) を抽出する
import { hintsFromText, SIMPLE_KINDS } from '../engine/effects';

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
  | 'turnEndOpp';

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
  spell: '呪文の効果',
};

export interface TriggerSpec {
  events: TrigEvent[];
  /** 元のテキスト (表示用) */
  text: string;
  /** 効果部分 */
  effect: string;
  optional: boolean;
  /** 選択や条件がなく、自動で実行できる */
  auto: boolean;
}

const SKIP = /^(ブロッカー|革命チェンジ|S級侵略|侵略|ニンジャ・ストライク|S・トリガー|シールド・トリガー|スーパー・S・トリガー|G・ストライク|スピードアタッカー|マッハファイター|ジャストダイバー|スレイヤー|[WTQ]・ブレイカー|ワールド・ブレイカー|EXライフ|チャージャー|G・ゼロ|シンパシー|パワーアタッカー)/;

const SKIP_TRIG = /^(革命チェンジ|S級侵略|侵略|ニンジャ・ストライク)/;

/** 括弧内の注釈 (リマインダーテキスト) を除く */
export const stripReminder = (s: string) => s.replace(/[（(][^（()）]*[)）]/g, '').replace(/[（(][^（()）]*[)）]/g, '');

const CONDITIONAL = /もし|場合|かわりに|選|それ|その後|かつ|あれば|なければ|以外|好きな|または|ごとに|につき|見て|公開/;

export function isAutoEffect(effect: string, optional: boolean): boolean {
  if (optional || CONDITIONAL.test(effect) || effect.length > 45) return false;
  const hints = hintsFromText([effect]);
  return hints.length > 0 && hints.every((h) => SIMPLE_KINDS.includes(h.kind));
}

export function parseTriggers(rawLines: string[]): TriggerSpec[] {
  const out: TriggerSpec[] = [];
  for (const raw of rawLines) {
    const line = stripReminder(raw.normalize('NFKC')).trim();
    if (!line || SKIP_TRIG.test(line)) continue;
    const m = line.match(/^(.{1,90}?)(時|はじめに|終わりに)、(.+)$/s);
    if (!m) continue;
    const clause = m[1] + m[2];
    const effect = m[3];
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
    const cross = /クロスしたクリーチャー/.test(clause);
    if (/(出た|出した|召喚した)時/.test(clause)) {
      if (self) ev.add('enter');
      else if (/他のクリーチャーが/.test(clause) && !own && !opp) (ev.add('otherOwnEnter'), ev.add('oppEnter'));
      else if (opp) ev.add('oppEnter');
      else if (own) ev.add('otherOwnEnter');
    }
    if (/ブロックされなかった時/.test(clause)) {
      if (self) ev.add('unblocked');
      else if (opp) ev.add('oppUnblocked');
    } else if (/攻撃する時/.test(clause)) {
      if (cross) ev.add('crossAttack');
      else if (self) ev.add('attack');
      else if (opp) ev.add('oppAttack');
      else if (own) ev.add('ownAttack');
    }
    if (/攻撃された時/.test(clause) && self) ev.add('attacked');
    if (/ブロックされた時/.test(clause) && self) ev.add('blocked');
    if (/ブロック(した|する)時/.test(clause) && self) ev.add('block');
    if (/バトルに勝った時/.test(clause) && self) ev.add('winBattle');
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
    if (/呪文を唱えた時/.test(clause)) {
      if (/相手が/.test(clause)) ev.add('spellOpp');
      else if (/自分が/.test(clause)) ev.add('spellOwn');
      else ev.add('spellAny');
    }
    if (!ev.size) continue;
    const optional = /てもよい|ことができる/.test(effect);
    out.push({ events: [...ev], text: raw, effect, optional, auto: isAutoEffect(effect, optional) });
  }
  return out;
}

/** 呪文の効果として解決するテキスト (キーワード行を除く) */
export function spellEffectLines(lines: string[]): string[] {
  return lines
    .map((l) => stripReminder(l.normalize('NFKC')).trim())
    .filter((l) => l && !SKIP.test(l) && !/^(このカードを)?マナゾーンに置く時/.test(l) && !/^この(呪文|カード)は/.test(l));
}
