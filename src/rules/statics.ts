// 常在型能力 (パワー修正・キーワード付与・コスト増減・選ばれない 等) の解析
import type { Sel } from './ops';
import { parseSel } from './selector';
import { normText, stripReminder } from './text';

/** 誰に効くか (発生源のカードから見て) */
export type StaticTarget = { t: 'self' } | { t: 'cross' } | { t: 'sel'; sel: Sel };

/** 効いている条件 */
export type StaticWhen = 'battle' | 'attack' | 'block' | 'oppTurn' | 'ownTurn' | 'always';

export type StaticCond =
  | { c: 'powerAtLeast'; n: number }
  | { c: 'totalShieldsLE'; n: number } // 鬼タイム: 自分と相手のシールドの合計
  | { c: 'countAtLeast'; sel: Sel; n: number }
  | { c: 'linked' };

export type StaticSpec =
  | { s: 'power'; target: StaticTarget; delta: number; when: StaticWhen; per?: { sel: Sel; each: number }; cond?: StaticCond }
  | { s: 'grant'; target: StaticTarget; kws: string[]; when: StaticWhen; cond?: StaticCond }
  | { s: 'cost'; side: 'self' | 'opp' | 'any'; sel: Sel; action: 'summon' | 'cast' | 'use'; delta: number; floor: number }
  | { s: 'untargetable'; bySpellOnly: boolean }
  | { s: 'noAttacked' }
  | { s: 'attackUntapped' }
  | { s: 'cantAttackCreatures' }
  | { s: 'unblockableBy'; maxPower?: number; smallerThanSelf?: boolean }
  | { s: 'tapMana' }
  | { s: 'rainbowMana' }
  | { s: 'summonFrom'; zone: 'mana' | 'grave' | 'hyper' }
  | { s: 'sympathy'; sel: Sel; floor: number }
  | { s: 'sasageru'; n: number }
  | { s: 'gzero'; cond: StaticCond }
  | { s: 'hyperEnergy' }
  | { s: 'poweredBreaker' }
  /** 離れる時、かわりに手札へ (エターナル・Ω) */
  | { s: 'leaveToHand' }
  /** 破壊される時、墓地に置くかわりに別の場所へ */
  | { s: 'destroyTo'; zone: 'hand' | 'mana' | 'deckBottom' | 'shield' }
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
  | { s: 'oppSpellLock' }
  /** リンク解除: 離れる時、サイキック・セル1枚を超次元ゾーンへ戻し、残りを裏返す */
  | { s: 'linkRelease' }
  /** エターナル・Κ: 離れる時、かわりに裏向きのマナをN枚表向きにする */
  | { s: 'eternalK'; n: number }
  /** 水晶ソウルN: 召喚する時、裏向きのマナはN枚分になる */
  | { s: 'crystalSoul'; n: number }
  /** このクリーチャーが破壊される/離れる時、かわりに〜 (effect を実行してとどまる) */
  | { s: 'replaceLeave'; on: 'destroy' | 'leave'; effect: string }
  /** コストを支払うかわりに、自分の〇〇をN体タップして使う */
  | { s: 'tapCast'; sel: Sel; n: number }
  /** タップしてバトルゾーンに出る */
  | { s: 'entersTapped' }
  /** 出たターンでも相手プレイヤーを攻撃できる */
  | { s: 'hastePlayer' }
  /** 破壊されない (inBattle: バトル中だけ) */
  | { s: 'indestructible'; inBattle?: boolean }
  /** 自分のターンのはじめにアンタップしない */
  | { s: 'noUntapStart' }
  /** 封印が付いていれば離れない */
  | { s: 'sealStay' }
  /** 可能であればブロックする */
  | { s: 'mustBlock' }
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
  | { s: 'neoDiscount'; n: number }
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
  const p = phrase.replace(/\s+/g, '').replace(/^バトルゾーンにある/, '');
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
  if ((m = t.match(/^(?:バトルゾーンに)?自分の(.+?)が(\d+)(?:体|枚|つ)以上(?:バトルゾーンに)?あれば、(.+)$/))) {
    const sel = parseSel('自分の' + m[1]);
    return sel ? { cond: { c: 'countAtLeast', sel, n: +m[2] }, rest: m[3] } : null;
  }
  return { rest: t };
}

/** 1行の常在型能力を解析 */
export function parseStaticLine(raw: string): StaticSpec[] | null {
  const full = normText(raw);
  const t0 = stripReminder(full).replace(/\s+/g, '').replace(/。$/, '');
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
  if ((m = t0.match(/^ハイパー化[:：]自分の他のクリーチャーを(\d+)体タップする/))) return [{ s: 'hyperize', n: +m[1] }];
  if (/^Zラッシュ/.test(t0)) return [{ s: 'zrush' }];
  if (/^シンカライズ/.test(t0)) return [{ s: 'sinkalize' }];
  if ((m = full.replace(/\s+/g, '').match(/^ギャラクシールド\[[a-z]*(\d+)\]/))) return [{ s: 'galaxy', cost: +m[1] }];
  if ((m = full.replace(/\s+/g, '').match(/^フシギバース\[[a-z]*(\d+)\]/))) return [{ s: 'fushigi', n: +m[1] }];
  if (/^アビスラッシュ/.test(t0)) return [{ s: 'abyss' }];
  if (/^リンク解除/.test(t0)) return [{ s: 'linkRelease' }];
  if (/^ソウルシフト/.test(t0)) return [{ s: 'soulShift' }];
  if ((m = t0.match(/^(自分のクリーチャー|このクリーチャー)は(?:すべて)?、?すべてのバトルに勝つ$/)))
    return [{ s: 'grant', target: m[1] === 'このクリーチャー' ? { t: 'self' } : { t: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' } }, kws: ['すべてのバトルに勝つ'], when: 'always' }];
  if ((m = t0.match(/^城[-ー―:：?]?自分のシールドを(ひとつ|1つ|\d+つ)選び、このカードを付けて要塞化する/))) return [{ s: 'castle', n: /\d/.test(m[1]) ? +m[1].replace('つ', '') : 1 }];
  if (/^このクリーチャーをアンタップして、相手クリーチャーの攻撃先をこのクリーチャー(または自分のタップしているクリーチャー)?に変更してもよい$/.test(t0)) return [{ s: 'untapBlocker' }];
  if (/^(相手のターン中に|相手の呪文の効果またはクリーチャーの能力によって、)このクリーチャーが(自分の)?手札から捨てられる時、墓地に置くかわりに(自分の)?バトルゾーンに出(してもよい|す)$/.test(t0)) return [{ s: 'discardToBattle' }];
  if ((m = t0.match(/^このクリーチャーが?、?リンクしている(?:間|時)、このクリーチャーはシールドをさらに(\d+)枚ブレイクする$/)))
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
  if ((m = t0.match(/^自分の他の、?名前に《(.+?)》とある(?:エグザイル・)?クリーチャーをバトルゾーンに出すことはできない$/))) return [{ s: 'exileLimit', name: m[1] }];
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
  if ((m = t0.match(/^このクリーチャーが破壊される時、墓地に置くかわりに(?:自分の|持ち主の)?(手札に(?:戻す|加える)|マナゾーンに置く|山札の(?:一番)?下に置く|シールド(?:ゾーンに|として)(?:裏向きにして)?(?:加える|置く))$/))) {
    const z = /手札/.test(m[1]) ? 'hand' : /マナ/.test(m[1]) ? 'mana' : /山札/.test(m[1]) ? 'deckBottom' : 'shield';
    return [{ s: 'destroyTo', zone: z }];
  }
  if ((m = t0.match(/^シンパシー[:：](.+)$/))) {
    const sel = parseSel(m[1]);
    return sel ? [{ s: 'sympathy', sel: { ...sel, owner: 'self' }, floor: floorOf(full) }] : null;
  }
  if ((m = t0.match(/^ササゲール(\d+)/))) return [{ s: 'sasageru', n: +m[1] }];
  if (/^ハイパーエナジー/.test(t0)) return [{ s: 'hyperEnergy' }];
  if ((m = t0.match(/^G・ゼロ[:：](?:バトルゾーンに)?自分の(.+?)が(?:(\d+)(?:体|枚|つ)以上)?あれば/))) {
    const sel = parseSel('自分の' + m[1]);
    return sel ? [{ s: 'gzero', cond: { c: 'countAtLeast', sel, n: m[2] ? +m[2] : 1 } }] : null;
  }
  if (/^(マナゾーンに置く時、)?このカードはタップして(マナゾーンに)?置く$/.test(t0) || /^この(カード|クロスギア|クリーチャー|呪文)は、?マナゾーンにタップして置かれる$/.test(t0)) return [{ s: 'tapMana' }];
  if (/^このクリーチャーは、?タップしてバトルゾーンに出る$/.test(t0) || /^バトルゾーンに出す時、このクリーチャーはタップして置く$/.test(t0)) return [{ s: 'entersTapped' }];
  if (/^このクリーチャーは、?(バトルゾーンに)?出たターン、?相手プレイヤーを攻撃できる$/.test(t0)) return [{ s: 'hastePlayer' }];
  if (/^このクリーチャーは、?破壊されない$/.test(t0)) return [{ s: 'indestructible' }];
  if (/^バトル中、このクリーチャーは、?破壊されない$/.test(t0)) return [{ s: 'indestructible', inBattle: true }];
  if (/^このクリーチャーは、?自分のターンのはじめにアンタップしない$/.test(t0)) return [{ s: 'noUntapStart' }];
  if (/^このクリーチャーは、?攻撃もブロックもされない$/.test(t0)) return [{ s: 'noAttacked' }, { s: 'grant', target: { t: 'self' }, kws: ['ブロックされない'], when: 'always' }];
  if (/^自分のマナゾーンにあるカード(を|は)、?すべての文明(のカードとして扱う|を持つ)$/.test(t0)) return [{ s: 'rainbowMana' }];
  if ((m = t0.match(/^このクリーチャーを自分の(マナゾーン|墓地|超次元ゾーン)から召喚してもよい$/))) return [{ s: 'summonFrom', zone: m[1] === '墓地' ? 'grave' : m[1] === '超次元ゾーン' ? 'hyper' : 'mana' }];

  // ---- 攻撃・ブロック・選択 ----
  if (/^このクリーチャーは攻撃されない$/.test(t0)) return [{ s: 'noAttacked' }];
  if (/^このクリーチャーは、?(タップされていない|アンタップしている)クリーチャーを攻撃できる$/.test(t0)) return [{ s: 'attackUntapped' }];
  if (/^このクリーチャーは、?クリーチャーを攻撃できない$/.test(t0)) return [{ s: 'cantAttackCreatures' }];
  if ((m = t0.match(/^このクリーチャーは、?パワー(\d+)以下のクリーチャーにブロックされない$/))) return [{ s: 'unblockableBy', maxPower: +m[1] }];
  if (/^このクリーチャーは、?(このクリーチャー|これ)よりパワーが小さいクリーチャーにブロックされない$/.test(t0)) return [{ s: 'unblockableBy', smallerThanSelf: true }];
  if (/^このクリーチャーは、?(呪文によって)?相手に選ばれない$/.test(t0) || /^(呪文の効果(によって|で))?(バトルゾーンにある自分のクリーチャーを相手が|相手がバトルゾーンにあるクリーチャーを|相手がクリーチャーを)選ぶ時、このクリーチャーを?は?選(ぶことはできない|ばれない|べない)$/.test(t0))
    return [{ s: 'untargetable', bySpellOnly: /呪文/.test(t0) }];
  if (/^このクリーチャーはブロックされず、相手に選ばれない$/.test(t0)) return [{ s: 'untargetable', bySpellOnly: false }];

  // ---- 条件付き 「鬼タイム:〜なら、」「自分の〇〇がN体以上あれば、」 ----
  const cp = parseCondPrefix(t0);
  if (!cp) return null;
  const t = cp.rest;
  const cond = cp.cond;

  // ---- パワー ----
  let when: StaticWhen = 'always';
  let body = t;
  if ((m = t.match(/^(バトル|攻撃|ブロック)中、(.+)$/))) {
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
      const out: StaticSpec[] = [{ s: 'power', target: tg, delta: (m[2] === '-' ? -1 : 1) * +m[3], when, cond }];
      if (m[4]) out.push({ s: 'grant', target: tg, kws: [...m[4].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond });
      return out;
    }
  }
  // ---- キーワード付与 ----
  if ((m = body.match(/^このクリーチャーは、?パワーが(\d+)以上の時、((?:「[^」]+」(?:と|、)?)+)を得る$/)))
    return [{ s: 'grant', target: { t: 'self' }, kws: [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond: { c: 'powerAtLeast', n: +m[1] } }];
  if ((m = body.match(/^(.+?)(?:は|に)(?:すべて)?((?:「[^」]+」(?:と|、)?)+)を(?:得る|与える)$/))) {
    const tg = target(m[1]);
    if (tg) return [{ s: 'grant', target: tg, kws: [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), when, cond }];
  }

  // ---- コスト ----
  if ((m = t.replace(/^(自分|相手)の、/, '$1の').match(/^(自分|相手)?の?(.+?)を(召喚|唱える|使う)(?:する)?コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる|してもよい)(?:[、。]?ただし.*)?$/)) ||
    (m = t.replace(/^(自分|相手)の、/, '$1の').match(/^(自分|相手)?の?(.+?)の(召喚)コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる|してもよい)(?:[、。]?ただし.*)?$/))) {
    const sel = parseSel(m[2], { zones: ['hand', 'mana', 'grave', 'shield', 'deck'] });
    if (sel) {
      const action = m[3] === '召喚' ? 'summon' : m[3] === '唱える' ? 'cast' : 'use';
      if (action === 'summon' && sel.kind === 'card') sel.kind = 'creature';
      if (action === 'cast') sel.kind = 'spell';
      return [{ s: 'cost', side: m[1] === '相手' ? 'opp' : m[1] === '自分' ? 'self' : 'any', sel, action, delta: (m[5] === '少なく' ? -1 : 1) * +m[4], floor: floorOf(full) }];
    }
  }
  return null;
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
