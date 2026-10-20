// よくある効果テキストを検出して「効果アシスト」として提示する。
// プレイヤーはボタンで処理でき、CPUは自動で処理する。検出できない効果は手動操作で処理する。
import type { Card, Face } from '../lib/cards';

export type HintKind =
  | 'draw'
  | 'manaTop'
  | 'shieldTop'
  | 'destroy'
  | 'bounce'
  | 'tapOpp'
  | 'discardRandom'
  | 'manaSend'
  | 'grSummon'
  | 'powerMinus'
  | 'breakOpp'
  | 'mill';

export interface EffectHint {
  kind: HintKind;
  label: string;
  n: number;
  maxPower?: number;
  delta?: number;
  /** 対象を選ぶ必要がある */
  target?: 'oppCreature' | 'anyCreature' | 'oppShield';
}

const z = (s: string) => s.normalize('NFKC');

/** 能力が誘発するテキスト行を取り出す */
function effectLines(face: Face, when: 'play' | 'trigger'): string[] {
  const lines = face.text.map(z);
  if (face.isSpell) return lines.filter((l) => !/^(S・トリガー|シールド・トリガー|チャージャー)/.test(l));
  // クリーチャー等は「出た時」能力
  void when;
  return lines.filter((l) => /(出た時|バトルゾーンに出した時|召喚した時)/.test(l) && !/攻撃する時/.test(l.split('出た時')[0]));
}

export const SIMPLE_KINDS: HintKind[] = ['draw', 'manaTop', 'shieldTop', 'grSummon', 'mill'];

/** テキストから効果アシストを作る */
export function hintsFromText(lines: string[]): EffectHint[] {
  const hints: EffectHint[] = [];
  for (const raw of lines) {
    const l = z(raw);
    let m: RegExpMatchArray | null;
    if ((m = l.match(/カードを(\d+)枚(まで)?引/)) && !/相手(は|が)[^、。]{0,8}カードを\d+枚(まで)?引/.test(l)) hints.push({ kind: 'draw', n: +m[1], label: `カードを${m[1]}枚引く` });
    if ((m = l.match(/山札の上から(\d+)枚(目)?を(自分の)?マナゾーンに置/)))
      hints.push({ kind: 'manaTop', n: +m[1], label: `山札の上から${m[1]}枚をマナへ` });
    if ((m = l.match(/山札の上から(\d+)枚(目)?を(新しい)?シールド/)) || /シールドを1つ追加/.test(l))
      hints.push({ kind: 'shieldTop', n: m ? +m[1] : 1, label: `山札の上から${m ? m[1] : 1}枚をシールド化` });
    if ((m = l.match(/相手のパワー(\d+)以下のクリーチャーを(\d+)体(まで)?(選び、)?破壊/)))
      hints.push({ kind: 'destroy', n: +m[2], maxPower: +m[1], target: 'oppCreature', label: `相手のパワー${m[1]}以下を${m[2]}体破壊` });
    else if ((m = l.match(/相手のクリーチャーを(\d+)体(まで)?(選び、)?破壊/)))
      hints.push({ kind: 'destroy', n: +m[1], target: 'oppCreature', label: `相手のクリーチャーを${m[1]}体破壊` });
    else if (/相手のクリーチャーをすべて破壊/.test(l)) hints.push({ kind: 'destroy', n: 99, target: 'oppCreature', label: '相手のクリーチャーをすべて破壊' });
    if ((m = l.match(/(相手の)?クリーチャーを(\d+)体(まで)?選び、(持ち主の)?手札に戻/)))
      hints.push({ kind: 'bounce', n: +m[2], target: m[1] ? 'oppCreature' : 'anyCreature', label: `クリーチャーを${m[2]}体手札に戻す` });
    if ((m = l.match(/相手のクリーチャーを(\d+)体(まで)?選び、タップ/)))
      hints.push({ kind: 'tapOpp', n: +m[1], target: 'oppCreature', label: `相手のクリーチャーを${m[1]}体タップ` });
    if ((m = l.match(/相手の手札を見ないで(\d+)枚選び、捨てさせる/)))
      hints.push({ kind: 'discardRandom', n: +m[1], label: `相手の手札をランダムに${m[1]}枚捨てさせる` });
    if ((m = l.match(/相手の(パワー(\d+)以下の)?クリーチャーを(\d+)体(まで)?選び、(持ち主の)?マナゾーンに置/)))
      hints.push({
        kind: 'manaSend',
        n: +m[3],
        maxPower: m[2] ? +m[2] : undefined,
        target: 'oppCreature',
        label: `相手のクリーチャーを${m[3]}体マナ送り`,
      });
    if ((m = l.match(/(\d+)回GR召喚/))) hints.push({ kind: 'grSummon', n: +m[1], label: `${m[1]}回GR召喚` });
    else if (/GR召喚する/.test(l)) hints.push({ kind: 'grSummon', n: 1, label: 'GR召喚' });
    if ((m = l.match(/相手のクリーチャーを(\d+)体(まで)?選び、.*パワーを-(\d+)/)))
      hints.push({ kind: 'powerMinus', n: +m[1], delta: -m[3], target: 'oppCreature', label: `相手のクリーチャー${m[1]}体のパワー-${m[3]}` });
    if ((m = l.match(/相手のシールドを(\d+)つ(まで)?(選び、)?.*(ブレイク|手札に加え)/)))
      hints.push({ kind: 'breakOpp', n: +m[1], target: 'oppShield', label: `相手のシールドを${m[1]}つブレイク` });
    if ((m = l.match(/自分の山札の上から(\d+)枚を墓地に置/))) hints.push({ kind: 'mill', n: +m[1], label: `山札の上から${m[1]}枚を墓地へ` });
  }
  return hints;
}

export function effectHints(card: Card, faceIndex: number, when: 'play' | 'trigger' = 'play'): EffectHint[] {
  const face = card.faces[faceIndex] ?? card.faces[0];
  return hintsFromText(effectLines(face, when));
}
