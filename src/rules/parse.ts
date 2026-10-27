// 効果テキスト → 効果プログラム (Op[]) への変換。
// 文ごとに規則を当てはめ、「その」等の指示語は直前に選んだカードを指す。
// 解釈できない文があれば complete=false になり、その能力は手動処理になる。
import type { Cond, Count, Dest, Op, Program, Purpose, Sel, SelZone, Target } from './ops';
import { parseSel } from './selector';
import { normText, stripReminder } from './text';

const N = '(\\d+)';
const COUNT_UNIT = '(?:体|枚|つ|人)';

// ---------- 小道具 ----------

/** 「〜てもよい」を辞書形に戻す。オプションでなければ null */
function unOptional(s: string): string | null {
  const rules: [RegExp, string][] = [
    [/引いてもよい$/, '引く'],
    [/置いてもよい$/, '置く'],
    [/戻してもよい$/, '戻す'],
    [/出してもよい$/, '出す'],
    [/加えてもよい$/, '加える'],
    [/唱えてもよい$/, '唱える'],
    [/捨ててもよい$/, '捨てる'],
    [/選んでもよい$/, '選ぶ'],
    [/使ってもよい$/, '使う'],
    [/見せてもよい$/, '見せる'],
    [/見てもよい$/, '見る'],
    [/付けてもよい$/, '付ける'],
    [/させてもよい$/, 'させる'],
    [/行ってもよい$/, '行う'],
    [/とばしてもよい$/, 'とばす'],
    // 五段の「裏返す」「外す」「移す」等 (サ変の「〜する」と区別する)
    [/(返|外|渡|移|回|残|探)してもよい$/, '$1す'],
    [/([一-鿿゠-ヿー]+)してもよい$/, '$1する'],
    [/してもよい$/, 'する'],
    // 下一段の動詞 「入れ替えてもよい」「与えてもよい」「止めてもよい」
    [/([えけげせぜてねべめれ])てもよい$/, '$1る'],
    [/(し|て)もよい$/, ''],
  ];
  for (const [re, rep] of rules) if (re.test(s)) return s.replace(re, rep);
  return null;
}

function count(numStr: string | undefined, upTo: string | undefined, all?: boolean): Count {
  if (all) return { all: true };
  return { n: numStr ? +numStr : 1, upTo: !!upTo };
}

const ZONE: Record<string, SelZone> = {
  山札の上: 'deckTop',
  墓地: 'grave',
  マナゾーン: 'mana',
  手札: 'hand',
  シールドゾーン: 'shield',
  山札: 'deck',
  超次元ゾーン: 'hyper',
  超GRゾーン: 'gr',
  超GR: 'gr',
};

/** 動詞句 → 対象に対する操作 */
function verbOps(verb: string, target: Target): Op[] | null {
  const v = verb
    .replace(/^(選び、|選んで、?)/, '')
    .replace(/^(それを|それらを|そのクリーチャーを|そのカードを)/, '')
    .replace(/^好きな順(序)?で、?/, '')
    .replace(/^シャッフルし、/, '');
  const m = (re: RegExp) => re.test(v);
  if (m(/^選ぶ$/)) return [];
  if (m(/^(?:相手に)?見せ(?:る|てもよい)$/)) return [];
  // 新しいシールドとして加える
  if (/^(?:相手に見せてから|すべてのプレイヤーに見せ、)?(?:裏向きにし(?:て)?|裏向きのまま)?、?(?:それぞれ別の)?新しいシールドとして、?(?:持ち主の|自分の)?シールド(?:ゾーン)?に(?:裏向きにして|裏向きのまま)?(?:加える|置く)$/.test(v))
    return [{ op: 'move', target, to: 'shield' }];
  if (m(/^破壊する$/)) return [{ op: 'destroy', target }];
  if (m(/^(持ち主の|自分の)?手札に(戻す|加える)$/)) return [{ op: 'move', target, to: 'hand' }];
  if (m(/^相手に見せ(てから|て)?、?(持ち主の|自分の)?手札に(加える|戻す)$/)) return [{ op: 'move', target, to: 'hand', reveal: true }];
  if (m(/^(バトルゾーンから|自分の(墓地|マナゾーン)から)、?(持ち主の|自分の)?手札に(戻す|加える)$/)) return [{ op: 'move', target, to: 'hand' }];
  if (m(/^(持ち主の|自分の)?マナゾーンに(置く|加える)$/)) return [{ op: 'move', target, to: 'mana' }];
  if (m(/^タップして(持ち主の|自分の)?マナゾーンに置く$/)) return [{ op: 'move', target, to: 'manaTapped' }];
  if (m(/^裏向きのまま(持ち主の|自分の)?マナゾーンに置く$/)) return [{ op: 'move', target, to: 'manaDown' }];
  if (m(/^(裏向きにして|裏向きのまま)、?(自分の)?シールド(ゾーン)?に(加える|置く)$/)) return [{ op: 'move', target, to: 'shield' }];
  if (m(/^(自分の)?手札から捨てる$/)) return [{ op: 'move', target, to: 'grave' }];
  if (m(/^相手の手札に戻す$/)) return [{ op: 'move', target, to: 'hand' }];
  if (m(/^(自分の墓地から)?表向きでシールド化する$/)) return [{ op: 'move', target, to: 'shieldUp' }];
  if (m(/^(持ち主の|自分の)?超次元ゾーンに(置く|戻す)$/)) return [{ op: 'move', target, to: 'hyper' }];
  if (m(/^(好きな順序で)?(自身の|持ち主の|自分の)?山札の上か下(のどちらか)?に(置く|戻す)$/)) return [{ op: 'topOrBottom', target, chooser: 'self' }];
  if (m(/^(自身の|持ち主の)山札に加えてシャッフルする$/)) return [{ op: 'move', target, to: 'deckTop' }, { op: 'shuffle', who: 'opp' }];
  if (m(/^(自分の)?山札に加えてシャッフルする$/)) return [{ op: 'move', target, to: 'deckTop' }, { op: 'shuffle' }];
  if (m(/^新しいシールドとして(自分の|持ち主の)?シールドゾーンに表向きのまま(加える|置く)$/)) return [{ op: 'move', target, to: 'shieldUp' }];
  if (m(/^(持ち主の|自分の)?墓地に(置く|送る)$/)) return [{ op: 'move', target, to: 'grave' }];
  if (m(/^(持ち主の|自分の)?山札の(一番)?下に(置く|戻す)$/)) return [{ op: 'move', target, to: 'deckBottom' }];
  if (m(/^(持ち主の|自分の)?山札の(一番)?上に(置く|戻す)$/)) return [{ op: 'move', target, to: 'deckTop' }];
  if (m(/^(持ち主の|自分の)?(シールドゾーンに|シールドとして)?(裏向きにして|裏向きのまま)?(シールドゾーンに)?(加える|置く)$/) && /シールド/.test(v))
    return [{ op: 'move', target, to: 'shield' }];
  if (m(/^(持ち主の)?シールド化する$/)) return [{ op: 'move', target, to: 'shield' }];
  if (m(/^タップする$/)) return [{ op: 'tap', target }];
  if (m(/^タップまたはアンタップする$/)) return [{ op: 'toggleTap', target }];
  if (m(/^このクリーチャーとバトルさせる$/)) return [{ op: 'battle', a: { ref: 'self' }, b: target }];
  if (m(/^(《[^》]+》のほう|フォートレス側|ウエポン側)に裏返す$/)) return [{ op: 'flip', target }];
  if (m(/^アンタップする$/)) return [{ op: 'untap', target }];
  if (m(/^(自分の)?(バトルゾーンに)?出す$/)) return [{ op: 'play', target, mode: 'put' }];
  // ドラグハート・ウエポン 「出し、このクリーチャーに装備する」「その選んだクリーチャーに装備して出す」(出す時に装備する)
  if (m(/^(バトルゾーンに)?出し、(この|その選んだ|その)クリーチャーに装備する$/) || m(/^、?(この|その選んだ|その)クリーチャーに装備して(バトルゾーンに)?出す$/)) return [{ op: 'play', target, mode: 'put' }];
  if (m(/^タップして(自分の)?バトルゾーンに出す$/)) return [{ op: 'play', target, mode: 'put' }, { op: 'tap', target: { ref: 'it' } }];
  if (m(/^(コストを支払わずに|コストを支払ったものとして)召喚する$/)) return [{ op: 'play', target, mode: 'summon' }];
  if (m(/^コストを支払わずに唱える$/)) return [{ op: 'play', target, mode: 'cast' }];
  if (m(/^コストを支払わずに(使う|実行する|プレイする|ジェネレートする)$/)) return [{ op: 'play', target, mode: 'use' }];
  if (m(/^捨てる$/)) return [{ op: 'move', target, to: 'grave' }];
  if (m(/^コストの大きいほうに裏返す$/)) return [{ op: 'flip', target, to: 'big' }];
  if (m(/^コストの小さいほうに裏返す$/)) return [{ op: 'flip', target, to: 'small' }];
  if (m(/^クリーチャー側に裏返(す|し、アンタップする)$/)) return [{ op: 'flip', target, to: 'creature' }];
  if (m(/^(もう一方の面に|フォートレス側に|ドラグハート側に)?裏返す$/)) return [{ op: 'flip', target }];
  if (m(/^(自分の)?(手札|墓地|マナゾーン|超次元ゾーン)から(バトルゾーンに)?出す$/)) return [{ op: 'play', target, mode: 'put' }];
  if (m(/^(自分の)?(手札|墓地|マナゾーン)からコストを支払わずに召喚する$/)) return [{ op: 'play', target, mode: 'summon' }];
  if (m(/^(自分の)?(手札|墓地|マナゾーン)からコストを支払わずに唱える$/)) return [{ op: 'play', target, mode: 'cast' }];
  if (m(/^ブレイクする$/)) return [{ op: 'move', target, to: 'hand' }];
  return null;
}

/** 選ぶ目的の推定 (CPU の選び方) */
function purposeOf(sel: Sel, verb: string): Purpose {
  const harmful = /破壊|墓地|手札に戻|山札の|マナゾーンに置|シールド|タップ|捨て/.test(verb);
  if (sel.owner === 'opp') return harmful ? 'hostile' : 'neutral';
  if (sel.owner === 'self') {
    if (sel.zones.includes('battle') && /破壊|墓地|手札に戻|山札|シールド/.test(verb)) return 'sacrifice';
    if (sel.zones.includes('hand') && /捨て|墓地/.test(verb)) return 'sacrifice';
    return 'benefit';
  }
  return harmful ? 'hostile' : 'benefit';
}

// ---------- 条件 ----------

export function parseCond(c: string): Cond | null {
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^自分のマナゾーンに裏向きのカードが(\d+)枚以上あ$/))) return { c: 'count', sel: { owner: 'self', zones: ['mana'], kind: 'card', faceDown: true }, cmp: '>=', n: +m[1] };
  if (/^(?:バトルゾーンにある)?自分のクリーチャーの数が相手(?:のクリーチャーの数)?より多(?:けれ|け|い)?$/.test(c)) return { c: 'oppMore', zone: 'battle', self: true };
  if (!/^自分の(墓地|マナゾーン|手札)に/.test(c)) {
    if ((m = c.match(new RegExp(`^(?:バトルゾーンに)?自分の(.+?)が${N}${COUNT_UNIT}以上あ$`)))) {
      const sel = parseSel('自分の' + m[1]);
      if (sel) return { c: 'count', sel, cmp: '>=', n: +m[2] };
    }
    if ((m = c.match(/^(?:バトルゾーンに)?自分の、?(.+?)がな(?:けれ|け|い)?$/))) {
      const sel = parseSel('自分の' + m[1]);
      if (sel) return { c: 'count', sel, cmp: '<=', n: 0 };
    }
    if ((m = c.match(/^(?:バトルゾーンに)?自分の(.+?)があ$/))) {
      const sel = parseSel('自分の' + m[1]);
      if (sel) return { c: 'count', sel, cmp: '>=', n: 1 };
    }
    if ((m = c.match(/^(?:バトルゾーンに)?相手の(.+?)があ$/))) {
      const sel = parseSel('相手の' + m[1]);
      if (sel) return { c: 'count', sel, cmp: '>=', n: 1 };
    }
  }
  // マナドライブ 「自分のマナゾーンのカードが5枚以上で闇文明があれば」
  if ((m = c.match(new RegExp(`^自分のマナゾーンのカードが${N}枚以上で(.+?)があ$`)))) {
    const word = m[2].replace(/文明$/, '');
    const sel = parseSel(word === '光' || word === '水' || word === '闇' || word === '火' || word === '自然' ? `${word}のカード` : word, { zones: ['mana'] });
    if (sel) {
      sel.owner = 'self';
      sel.zones = ['mana'];
      if (sel.kind === 'creature' && !/クリーチャー$/.test(word)) sel.kind = 'card';
      return { c: 'and', a: { c: 'count', sel: { owner: 'self', zones: ['mana'], kind: 'card' }, cmp: '>=', n: +m[1] }, b: { c: 'count', sel, cmp: '>=', n: 1 } };
    }
  }
  if ((m = c.match(/^自分の(墓地|マナゾーン|手札)に(.+?)があ$/))) {
    const sel = parseSel(m[2], { owner: 'self', zones: [ZONE[m[1]]] });
    if (sel) {
      sel.owner = 'self';
      sel.zones = [ZONE[m[1]]];
      if (sel.kind === 'creature' && /カード$/.test(m[2])) sel.kind = 'card';
      return { c: 'count', sel, cmp: '>=', n: 1 };
    }
  }
  if ((m = c.match(new RegExp(`^自分の(墓地|マナゾーン|手札)に(.+?)が${N}${COUNT_UNIT}以上あ$`)))) {
    const sel = parseSel(m[2], { owner: 'self', zones: [ZONE[m[1]]] });
    if (!sel) return null;
    sel.owner = 'self';
    sel.zones = [ZONE[m[1]]];
    if (sel.kind === 'creature' && /カード$/.test(m[2])) sel.kind = 'card';
    return { c: 'count', sel, cmp: '>=', n: +m[3] };
  }
  if ((m = c.match(new RegExp(`^自分のシールドが${N}つ以下$`)))) return { c: 'shields', who: 'self', cmp: '<=', n: +m[1] };
  if ((m = c.match(new RegExp(`^自分のシールドが${N}つ以上$`)))) return { c: 'shields', who: 'self', cmp: '>=', n: +m[1] };
  if (/^自分のシールドが(1つも|ひとつも|0つ)な(け|い)$/.test(c) || /^自分のシールドがな(け|い)$/.test(c)) return { c: 'shields', who: 'self', cmp: '==', n: 0 };
  if ((m = c.match(new RegExp(`^相手のシールドが${N}つ以下$`)))) return { c: 'shields', who: 'opp', cmp: '<=', n: +m[1] };
  if (/^相手のシールドが自分のシールドより多け$/.test(c)) return { c: 'shieldsCmp', cmp: 'oppMore' };
  if (/^自分のシールドの数が相手のより多け$/.test(c)) return { c: 'shieldsCmp', cmp: 'selfMore' };
  if (/^相手のシールドの数が自分のより多け$/.test(c)) return { c: 'shieldsCmp', cmp: 'oppMore' };
  if ((m = c.match(new RegExp(`^自分のシールドが${N}(?:つ|枚)もな(?:け|い)$`)))) return { c: 'shieldsLess', who: 'self', n: +m[1] };
  if ((m = c.match(new RegExp(`^相手のシールドが${N}(?:つ|枚)もな(?:け|い)$`)))) return { c: 'shieldsLess', who: 'opp', n: +m[1] };
  if (/^自分のシールドが相手のシールドより多け$/.test(c)) return { c: 'shieldsCmp', cmp: 'selfMore' };
  if ((m = c.match(new RegExp(`^自分の手札が${N}枚以下$`)))) return { c: 'handCount', who: 'self', cmp: '<=', n: +m[1] };
  if ((m = c.match(new RegExp(`^相手の手札が${N}枚以下$`)))) return { c: 'handCount', who: 'opp', cmp: '<=', n: +m[1] };
  if (/^(それら|表向きにしたカード)がすべて異なるコスト$/.test(c)) return { c: 'distinctCosts' };
  if (/^このクリーチャーがタップ(され|し)てい$/.test(c)) return { c: 'selfTapped' };
  if ((m = c.match(/^(それ|そのカード|そのクリーチャー)が、?(.+?)でな(?:けれ|け|い)?$/))) {
    const sel = parseSel(m[2], { zones: ['battle', 'hand', 'mana', 'grave', 'deck', 'shield'] });
    if (sel) return { c: 'not', a: { c: 'itMatches', sel } };
  }
  if ((m = c.match(/^(自分|相手)のシールドが(\d+)(?:つ|枚)以下(?:であ|で)?$/))) return { c: 'shields', who: m[1] === '自分' ? 'self' : 'opp', cmp: '<=', n: +m[2] };
  if (/^(?:バトルゾーンにある)?自分のクリーチャーがこのクリーチャーだけ(?:であ|で|なら)?$/.test(c)) return { c: 'count', sel: { owner: 'self', zones: ['battle'], kind: 'creature', other: true }, cmp: '<=', n: 0 };
  if (/^このクリーチャーが(?:自分の)?墓地にあ$/.test(c)) return { c: 'count', sel: { owner: 'self', zones: ['grave'], kind: 'card', self: true }, cmp: '>=', n: 1 };
  if (/^このクリーチャーがバトルゾーンにあ$/.test(c)) return { c: 'count', sel: { owner: 'self', zones: ['battle'], kind: 'card', self: true }, cmp: '>=', n: 1 };
  if ((m = c.match(/^自分と相手のシールドの数が合計(\d+)つ以下$/))) return { c: 'totalShieldsLE', n: +m[1] };
  if (/^それが(この|その)ターン(最初|はじめて)の攻撃(であ|で)?$/.test(c)) return { c: 'firstAttack' };
  if ((m = c.match(/^このターンに(\d+)つ以上自分のシールドがブレイクされてい(な(?:け)?)?$/))) return { c: 'brokenGE', n: +m[1], neg: !!m[2] };
  if ((m = c.match(/^自分のマナゾーンにカードが(\d+)枚以上な(?:けれ|け|い)?$/))) return { c: 'count', sel: { owner: 'self', zones: ['mana'], kind: 'card' }, cmp: '<=', n: +m[1] - 1 };
  if ((m = c.match(/^(自分|相手)のシールドが(\d+)(?:つ|枚)以上あ$/))) return { c: 'shields', who: m[1] === '自分' ? 'self' : 'opp', cmp: '>=', n: +m[2] };
  c = c
    .replace(/^相手のマナゾーンにあるカードの(?:数|枚数)が、?自分のより多(い場合)?/, '相手のマナゾーンのカードが自分のより多')
    .replace(/^相手のマナゾーンのカードが自分(?:のマナゾーンのカード)?より多/, '相手のマナゾーンのカードが自分のより多')
    .replace(/^相手の手札(?:の枚数)?が自分(?:の手札)?より多/, '相手の手札が自分のより多');
  if ((m = c.match(/^バトルゾーンまたはマナゾーンに自分の(.+?)が合計(\d+)(?:枚|体|つ)以上あ$/))) {
    const sel = parseSel('自分の' + m[1]);
    if (sel) return { c: 'count', sel: { ...sel, zones: ['battle', 'mana'] }, cmp: '>=', n: +m[2] };
  }
  if (/^そのターン(?:中)?に他の「ファイナル革命」を(?:まだ)?使っていな(?:けれ|け)?$/.test(c)) return { c: 'finalRev' };
  if (/^手札が1枚もないプレイヤーがい$/.test(c)) return { c: 'anyHandEmpty' };
  if ((m = c.match(/^バトルゾーンに(「[^」]+」を持つクリーチャー|[^自相][^、]*?クリーチャー)があ$/))) {
    const sel = parseSel(m[1]);
    if (sel) return { c: 'count', sel: { ...sel, owner: 'any' }, cmp: '>=', n: 1 };
  }
  if (/^この(?:最終)?禁断(?:フィールド|クリーチャー)?に封印が1つもな(?:けれ|け)?$/.test(c)) return { c: 'noSeals' };
  if ((m = c.match(/^このターン(?:中)?、他に(\d+)体以上破壊されてい$/))) return { c: 'destroyedThisTurn', n: +m[1] };
  if (/^進化クリーチャーの下から墓地に置かれてい$/.test(c)) return { c: 'wasUnderEvo' };
  if (/^(?:この(?:クリーチャー|タマシード)が)?タマシードから進化してい$/.test(c)) return { c: 'underHas', kind: 'tamaseed' };
  if ((m = c.match(/^自分の(光|水|闇|火|自然)のクリーチャーまたは(?:光|水|闇|火|自然)のタマシードが合計(\d+)つ以上あ$/)))
    return { c: 'count', sel: { owner: 'self', zones: ['battle'], kind: 'creatureOrTama', civs: [({ 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' } as const)[m[1] as '光']] }, cmp: '>=', n: +m[2] };
  if ((m = c.match(/^相手の手札が(\d+)枚もな(?:けれ|け)?$/))) return { c: 'handCount', who: 'opp', cmp: '<=', n: +m[1] - 1 };
  if (/^バトルゾーンにある自分のクリーチャーの数が相手(?:のクリーチャーの数)?より多(?:けれ|け|い)?$/.test(c)) return { c: 'oppMore', zone: 'battle', self: true };
  if ((m = c.match(/^これが(NEO)?進化クリーチャー(?:であ|で)?$/))) return { c: 'count', sel: { owner: 'self', zones: ['battle'], kind: 'creature', self: true, evolution: true }, cmp: '>=', n: 1 };
  if ((m = c.match(/^自分のシールドが(\d+)(?:枚|つ)(?:であ|で)?$/))) return { c: 'shields', who: 'self', cmp: '==', n: +m[1] };
  if ((m = c.match(/^このクリーチャーにカードが(\d+)枚以上含まれてい$/))) return { c: 'selfCardsGE', n: +m[1] };
  if ((m = c.match(/^自分のマナゾーン(?:にある|の)カードがすべて(光|水|闇|火|自然)のカード(?:であ|で)?$/))) return { c: 'manaAllCiv', civ: ({ 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' } as const)[m[1] as '光'] };
  if ((m = c.match(/^自分の(手札|シールド)(?:の数|の枚数)?が相手(?:の(?:手札|シールド))?より多(け|い)?$/))) return { c: 'oppMore', zone: m[1] === '手札' ? 'hand' : 'shield', self: true };
  if ((m = c.match(/^相手の(シールド|手札)(?:の数|の枚数)?が自分(?:の(?:手札|シールド)|のより|より)多(け|い)?$/))) return { c: 'oppMore', zone: m[1] === '手札' ? 'hand' : 'shield' };
  if ((m = c.match(/^相手の(手札|マナゾーンのカード|シールド)が自分のより多(け|い)?$/))) return { c: 'oppMore', zone: m[1] === '手札' ? 'hand' : m[1] === 'シールド' ? 'shield' : 'mana' };
  if (/^これを(装備|クロス)したクリーチャーがタップ(され|し)てい$/.test(c)) return { c: 'equippedTapped' };
  if (/^このクリーチャーがリンクしてい(る)?$/.test(c)) return { c: 'linked' };
  if (/^このクリーチャーがリンクしていな(い|け)?$/.test(c)) return { c: 'linked', neg: true };
  if (/^このクリーチャーが表向きで(自分の)?シールドゾーンにあ$/.test(c)) return { c: 'selfFaceUpShield' };
  if ((m = c.match(/^(それ|そのカード|そのクリーチャー|見せたカード|そのようにして見せたカード|このようにして見せたカード)が、?(.+?)(である|であ|で|だった)?$/))) {
    const Z = { zones: ['battle', 'hand', 'mana', 'grave', 'deck', 'shield'] as SelZone[] };
    const sel = parseSel(m[2], Z);
    if (sel) return { c: 'itMatches', sel };
    // 「それが呪文か、ブロッカーを持つクリーチャー」「進化ではないドラゴンか進化ではないヒューマノイド」
    const or = m[2].match(/^(.+?)(?:か、?|または)(.+)$/);
    const b = or && parseSel(or[2], Z);
    // 「レクスターズまたは火のクリーチャー」: 前半に名詞がなければ後半の名詞を補う
    const noun = or?.[2].match(/(クリーチャー|タマシード|カード|呪文)$/)?.[1];
    const a = or && (parseSel(or[1], Z) ?? (noun && !/(クリーチャー|タマシード|カード|呪文)$/.test(or[1]) ? parseSel(`${or[1]}の${noun}`, Z) ?? parseSel(or[1] + noun, Z) : null));
    return a && b ? { c: 'or', a: { c: 'itMatches', sel: a }, b: { c: 'itMatches', sel: b } } : null;
  }
  return null;
}

// ---------- 文の解釈 ----------

interface Ctx {
  /** 直前に山札を見た/表向きにした */
  looked: boolean;
  /** これまでにカードを選んだ (「それ」が指すものがある) */
  chosen?: boolean;
}

function selTarget(phrase: string, num: string | undefined, upTo: string | undefined, all: boolean, chooser: 'self' | 'opp', defaults?: Partial<Sel>): Target | null {
  const sel = parseSel(phrase, defaults);
  if (!sel) return null;
  return { ref: 'sel', sel, count: count(num, upTo, all), chooser };
}

const IT = /^(それらのクリーチャー|それらのカード|そのGRクリーチャー|選ばれたクリーチャー|それら|それ|その選んだクリーチャー|選んだクリーチャー|そのクリーチャー|その選んだカード|選んだカード|そのカード|その呪文|そのシールド|そのタマシード|その\d+体|その\d+枚|そのうちの\d+(?:体|枚))/;

function sentence(s0: string, ctx: Ctx): Op[] | null {
  let s = s0
    .replace(/\s+/g, '')
    .replace(/^(その後|次に|さらに)、?/, '')
    .replace(/^自分は/, '')
    .replace(/ひとつ/g, '1つ')
    .replace(/ふたつ/g, '2つ')
    .replace(/パワーを[?_](\d)/, 'パワーを-$1')
    .replace(/選びタップする$/, '選び、タップする')
    .replace(/^そのターン、/, 'このターン、')
    .replace(/^(山札の)?上から(\d+)枚/, '自分の山札の上から$2枚')
    .replace(/を、?好きな(数|枚数)、?/g, 'を99枚まで')
    .replace(/(\d+)枚ずつ/g, '$1枚')
    .replace(/(\d+)体ずつ/g, '$1体')
    .replace(/^自分が勝った(ら|場合)、/, 'そうしたら、')
    .replace(/^自分が負けた(ら|場合)、/, 'そうしなかった場合、')
    .replace(/^そうしない場合、/, 'そうしなかった場合、')
    .replace(/^自分の([^、]+?)がバトルゾーンにあれば、/, 'バトルゾーンに自分の$1があれば、')
    .replace(/はすべてブロックされない$/, 'すべてはブロックされない')
    .replace(/パワーを-∞ ?する/, 'パワーを-999999する')
    .replace(/^そのプレイヤーは、?(自分自身|自身)の/, '相手は自身の')
    .replace(/^そのプレイヤーは、?/, '相手は')
    .replace(/^(.+?)はこのターン中、攻撃することができない$/, 'このターン、$1は攻撃できない')
    .replace(/^(龍?マナ武装|レインボーナス|水晶武装|ファイナル革命)\d*[:：]/, '')
    .replace(/^鬼タイム\s*[:：]\s*(?=自分と相手のシールド)/, '')
    .replace(/^自分の次のターンが始まるまで、/, '次の自分のターンのはじめまで、')
    .replace(/(クリーチャー)はすべて、「/, '$1すべてに「')
    .replace(/^相手の手札を見て(?!、)/, '相手の手札を見て、')
    .replace(/^パワーの合計が(\d+)以下になるように(.+?)を(\d+)体まで選び、/, '$2を、パワーの合計が$1以下になるように好きな数選び、')
    .replace(/^(.+?)をパワーの合計が(\d+)以下になるよう(?:に)?好きな数選び、/, '$1を、パワーの合計が$2以下になるように好きな数選び、')
    .replace(/^(クリーチャー|呪文|カード)(なら|であれば)、/, 'それが$1なら、')
    .replace(/^(クリーチャー|呪文)でなければ、/, 'それが$1でなければ、')
    .replace(/^そうしたら(?=[^、])/, 'そうしたら、')
    .replace(/^数字を(?:ひとつ|1つ)言う$/, '数字を1つ選ぶ')
    .replace(/自分の山札の上からさらに(?:もう)?(\d+)枚、?(タップして)?(?:自分の)?マナゾーンに置く$/, '自分の山札の上から$1枚を$2マナゾーンに置く')
    .replace(/全て/g, 'すべて')
    .replace(/^このターン(?=(?:その|この|自分の|相手の)[^、]+?は)/, 'このターン、')
    .replace(/^(このターン|そのターン)、自分はゲームに負けず、相手は勝てない$/, '$1、自分はゲームに負けず、相手はゲームに勝てない')
    .replace(/パワーは[ーｰ](\d)/, 'パワーは-$1')
    .replace(/^このターン、(その|この)クリーチャーは無限にパワーを失う$/, 'このターン、$1クリーチャーのパワーを-999999する')
    .replace(/^それ以外であれば、/, 'それ以外なら、')
    .replace(/^(?:自分の)?山札を下から(\d+)枚を残して/, '自分の山札を一番下の$1枚を残して')
    .replace(/^(相手は)?カードを(\d+)枚、?(?:自分の|自身の)(マナゾーン|手札)から選び、(?:残り|それ以外)(?:のカード)?を/, '$1自身の$3からカードを$2枚選び、それ以外を')
    .replace(/^次の相手のターン、相手は呪文を唱える(?:ことが)?できない$/, '次の自分のターンのはじめまで、相手は呪文を唱えられない')
    .replace(/^相手は、?自身の手札から(\d+)枚選んで捨てる$/, '相手は自身の手札を$1枚選び、捨てる')
    .replace(/^自分の(手札|シールド)が相手より少ない場合、/, '相手の$1が自分のより多ければ、')
    .replace(/^自分のマナゾーンのカードが相手より少ない場合、/, '相手のマナゾーンのカードが自分のより多ければ、')
    .replace(/^(その後、)?自分の山札の一番下のカードを、/, '自分の山札の一番下のカードを')
    .replace(/(クリーチャー)はすべて「/, '$1すべてに「')
    .replace(/^このターン(?:中)?、(他に\d+体以上破壊されてい)たら、/, 'このターン中、$1れば、')
    .replace(/^自分の山札の上から、((?:その数|それ)と同じ枚数のカードを)、?/, '$1、自分の山札の上から')
    .replace(/^それが墓地に置かれる直前に進化クリーチャーの下にあった場合、/, '進化クリーチャーの下から墓地に置かれていれば、')
    .replace(/攻撃またはブロックできない$/, '攻撃もブロックもできない')
    .replace(/^(このターン、[^、]+?)は、/, '$1は')
    .replace(/^なければ、/, 'それ以外なら、')
    .replace(/^このターンが終わるまで、/, 'このターン、')
    .replace(/^(自分の墓地にある)すべての(.+?)と(.+?)を(?:自分の)?手札に戻す$/, '$1$2または$3をすべて、自分の手札に戻す')
    .replace(/^相手の手札が(\d+)枚(?:でも|以上)あれば、その中から(\d+)枚見ないで選び、相手はそれを持ち主の墓地に置く$/, '相手の手札を見ないで$2枚選び、捨てさせる')
    .replace(/^相手の手札が(\d+)枚(?:でも|以上)あれば、相手はその中から(\d+)枚選んで持ち主の墓地に置く$/, '相手は自身の手札を$2枚選び、捨てる')
    .replace(/^バトルゾーンにある([^、自相]+?)の数と同じ枚数のカードを引(く|いてもよい)$/, 'バトルゾーンにある$1のクリーチャー1体につき、カードを1枚引$2')
    .replace(/^(?:その後、)?そのクリーチャー(\d)体につき(\d+)枚カードを引(く|いてもよい)$/, 'こうして選んだクリーチャー$1体につき、カードを$2枚引$3')
    .replace(/^そのバトルの終わりまで、(その|この)クリーチャーのパワーは/, 'このターン、$1クリーチャーのパワーは')
    .replace(/、それ以外のカードを好きな順(?:序|番)?で/, '、残りを好きな順序で')
    .replace(/^その中から好きな枚数を自分の山札の一番下に好きな順序で置く$/, 'その中からカードを99枚まで選び、自分の山札の一番下に置く')
    .replace(/^(?:そのカード|見たシールド)を手札に加えなかった(?:場合|ら)、/, 'そうしなかった場合、')
    .replace(/^相手は、?次の自身のターンに(クリーチャーを召喚できず|クリーチャーを召喚できない|呪文を唱えられない)/, '次の相手のターン、相手は$1')
    .replace(/^次の相手のターン、相手は呪文を唱えられない$/, '次の自分のターンのはじめまで、相手は呪文を唱えられない')
    .replace(/^(.+?)のコスト(?:の数)?と同じ枚数のカードを引く$/, '$1のコストと同じ枚数のカードを引く')
    .replace(/^カードを(\d+)枚引き、そのカードを(?:相手に|すべてのプレイヤーに)?見せる$/, 'カードを$1枚引く')
    .replace(/^その中に(.+?)があれば(\d+)(体|枚)手札に加え、/, 'その中から$1を$2$3手札に加え、')
    .replace(/をコストが大きいほうに裏返す$/, 'をコストの大きいほうに裏返す')
    .replace(/^(この|その)ターン、そのドラゴンのパワーは/, '$1ターン、そのクリーチャーのパワーは')
    .replace(/^(自分の[^、]+?)と同じ枚数のカードを、?自分の山札の上から(?:マナゾーンにタップして|タップしてマナゾーンに)置(く|いてもよい)$/, '$1 1枚につき、自分の山札の上から1枚目をタップしてマナゾーンに置$2')
    .replace(/^(.+?(?:であれば|なら))、自分の墓地に置く$/, '$1、このクリーチャーを自分の墓地に置く')
    .replace(/^相手がそうしなければ、/, 'そうしなかった場合、')
    .replace(/^(?:その後、)?(?:破壊した|捨てた)(クリーチャー|カード)(\d)(体|枚)につき、?(\d+)枚カードを引(く|いてもよい)$/, 'こうして破壊した$1$2$3につき、カードを$4枚引$5')
    .replace(/^(?:その後、)?それら(\d)(体|枚)につき、/, 'こうして選んだカード$1$2につき、')
    .replace(/^次の自分のターンが始まるまで、/, '次の自分のターンのはじめまで、')
    .replace(/^(このターン、その(?:クリーチャー)?が)バトルに勝った時、バトルの後で?アンタップする$/, '$1バトルに勝った時、アンタップする')
    .replace(/^自分の次のターンのはじめまで、相手のクリーチャーは「このクリーチャーは、?可能(?:であれば|なら)攻撃する」を得る$/, '次の自分のターンのはじめまで、相手のクリーチャーはすべて、可能であれば攻撃する')
    .replace(/^そのクリーチャーは、?自分の次のターンのはじめまで「このクリーチャーは、?可能(?:であれば|なら)攻撃する」を得る$/, '次の自分のターンのはじめまで、そのクリーチャーは可能であれば攻撃する')
    .replace(/^自分のクリーチャー(\d+)体のパワーは、?このターンの終わりまで\+(\d+)される$/, '自分のクリーチャーを$1体選び、このターン、そのパワーを+$2する')
    .replace(/^バトルゾーンにある、/, 'バトルゾーンにある')
    .replace(/持主の/g, '持ち主の')
    .replace(/^(その後、)?バトルゾーンにあるその他のクリーチャーを/, '$1バトルゾーンにある他のクリーチャーを')
    .replace(/^その中から好きな(?:枚数|数)の(カード|クリーチャー)を選び、/, 'その中から$1を99枚まで選び、')
    .replace(/^自分のシールドから好きな(?:枚数|数)を(?:裏向きのまま)?選び、(?:表向きにして)?/, '自分のシールドを99枚まで選び、')
    .replace(/^このターン、選んだクリーチャーがタップされていなくても攻撃できる$/, 'このターン、そのクリーチャーはタップされていないクリーチャーを攻撃できる')
    .replace(/^相手の次のターンに、相手の攻撃できるクリーチャーはすべて、攻撃しなければならない$/, '次の相手のターン、相手のクリーチャーはすべて、可能であれば攻撃する')
    .replace(/^自分の山札のカードを上から(\d+)枚/, '自分の山札の上から$1枚')
    .replace(/^(自分の山札の上から\d+枚)までを?、?(?=(?:自分の)?(?:新しい)?シールド|裏向きのまま)/, '$1を')
    .replace(/^(このターン、(?:バトルゾーンにある)?自分の.*?クリーチャー)のパワーはそれぞれ\+/, '$1すべてのパワーは+')
    .replace(/^その中の(.+?)を(\d+)(枚|体)(手札に加え|選び)/, 'その中から$1を$2$3$4')
    .replace(/^ターンの終わりに、/, 'このターンの終わりに、')
    .replace(/^(それ|そのカード)が(.+?)なら(出す|手札に加える|墓地に置く)$/, '$1が$2なら、それを$3')
    .replace(/^それ以外なら(墓地に置く|手札に加える|マナゾーンに置く)$/, 'それ以外なら、それを$1')
    .replace(/^((?:光|水|闇|火|自然)の(?:カード|クリーチャー|呪文))であれば、/, 'それが$1であれば、')
    .replace(/^(?:好きな数字|数)を(?:ひとつ|1つ)選(?:んで言う|んでもよい|ぶ)$/, '数字を1つ選ぶ')
    .replace(/^そのカードのコストが、?選んだ数(?:字)?と同じ(であれば|なら)、/, 'それが〈数字コスト〉のカード$1、')
    .replace(/につき(\d+)枚、カードを引(く|いてもよい)$/, 'につき、カードを$1枚引$2')
    .replace(/^自分はゲームに勝利する$/, '自分はゲームに勝つ')
    .replace(/^相手の攻撃クリーチャーを破壊する$/, '攻撃しているクリーチャーを破壊する')
    .replace(/^このクリーチャーを(?:自分の)?墓地から(?:自分の)?手札に加える$/, 'このクリーチャーを手札に戻す')
    .replace(/^このクリーチャーを(?:自分の)?墓地から(?:自分の)?手札に加えてもよい$/, 'このクリーチャーを手札に戻してもよい')
    .replace(/^相手は、?カードを(\d+)枚、?自身の(手札|マナゾーン|墓地)から選(?:び|んで)、?/, '相手は自身の$2からカードを$1枚選び、')
    .replace(/^相手は、?自身の(手札|マナゾーン|墓地)から(\d+)枚カードを選(?:び|んで)、?/, '相手は自身の$1からカードを$2枚選び、')
    .replace(/^相手は、?([^、]+?)を(\d+)(体|枚)、?自身の(手札|マナゾーン|墓地)から(?:選び、)?(?=(?:バトルゾーンに|手札に|墓地に))/, '相手は自身の$4から$1を$2$3選び、')
    .replace(/^相手は、?自身の(手札|マナゾーン|墓地)から(.+?)を(\d+)(体|枚)(まで)?選んで、?/, '相手は自身の$1から$2を$3$4$5選び、')
    .replace(/自分の山札の上からさらに(\d+)枚、?(?:自分の)?マナゾーンに置く$/, '自分の山札の上から$1枚をマナゾーンに置く')
    .replace(/^自分のクリーチャーと相手のクリーチャーを1体(?:ずつ)?選(ぶ|んでもよい)$/, '自分と相手のクリーチャーを1体選$1')
    .replace(/^(?:その選んだクリーチャー2体|その2体)を?バトルさせる$|^そうした場合、その2体はバトルする$|^その2体はバトルする$/, 'その2体をバトルさせる')
    .replace(/、(?:そのカード|それら)を(?:相手に)?見せる$/, '')
    .replace(/^自分の山札の一番上のカードを、?(?:表にして、?)?(?:自分の)?マナゾーンに置/, '自分の山札の上から1枚目をマナゾーンに置')
    .replace(/^カード名を(?:ひとつ|1つ)選んで言う$/, 'カード名を1つ選ぶ')
    .replace(/(?:選んだ|選ばれた)(?:カード名と同じカード|カードと同じ名前の(?:カード)?|名前を持つカード|カード)/g, '〈名前〉のカード')
    .replace(/^この攻撃中に自分が「ニンジャ」能力を使っていなければ、/, '')
    .replace(/^このターンが終わる時、/, 'このターンの終わりに、')
    .replace(/その(?:ドラゴン|[゠-ヿー・]{3,})を(?=(?:自分の|持ち主の)?(?:墓地|手札|マナゾーン|山札))/, 'そのクリーチャーを')
    .replace(/(光|水|闇|火|自然)クリーチャー/g, '$1のクリーチャー')
    .replace(/クリーチャー(\d+)体またはタマシードを\d+枚、?/, 'クリーチャーまたはタマシードを$1枚、')
    .replace(/クリーチャー(\d+)体またはタマシード(\d+)枚/, 'クリーチャーまたはタマシード$1体')
    .replace(/^(?:バトルゾーンにある)?((?:自分|相手)の[^、]+?)(?:の数)?と同じ枚数のカードを引(く|いてもよい)$/, '$1 1枚につき、カードを1枚引$2')
    .replace(/^(?:バトルゾーンにある)?((?:自分|相手)の[^、]+?)(?:の数)?と同じ枚数のカードを、?自分の山札の上から(?:自分の)?マナゾーンに置く$/, '$1 1枚につき、自分の山札の上から1枚目をマナゾーンに置く')
    .replace(/^(?:バトルゾーンにある)?((?:自分|相手)の[^、]+?)(?:の数)?と同じ枚数のカードを、?自分の山札の上から、?(?:裏向きのまま、?)?新しいシールドとして(?:自分の)?シールドゾーンに(?:加える|置く)$/, '$1 1枚につき、自分の山札の上から1枚をシールド化する')
    .replace(/マナゾーンでタップされているカード/, 'マナゾーンにあるタップされているカード')
    .replace(/呪文カード/g, '呪文')
    .replace(/シールドを(\d+)(枚|つ)裏向きのまま選び/, 'シールドを$1$2選び')
    .replace(/シールドを裏向きのまま(\d+)(枚|つ)(まで)?選び、表にして/, 'シールドを$1$2$3選び、')
    .replace(/^そうした場合、/, 'そうしたら、')
    .replace(/^(自分の山札の上から\d+枚(?:目)?)を、?(?:裏向きにし(?:て)?|裏向きのまま)?、?(?:それぞれ別の)?新しいシールドとして(?:自分の)?シールド(?:ゾーン)?に(?:加える|置く)$/, '$1をシールド化する')
    .replace(/選んで(?=裏向きにし)/, '選び、')
    .replace(/^このターン(?=(?:その|この|自分の|相手の)(?:クリーチャー|[^、]*クリーチャー)は)/, 'このターン、')
    .replace(/^(?:このターンが終わるまで|このターンの終わりまで|そのターンの終わりまで|このターン中|そのターン中|その攻撃の終わりまで)、?/, 'このターン、')
    .replace(/^(このターン、)?その(?:ドラゴン|[゠-ヿー・]{2,})は(、?「)/, '$1そのクリーチャーは$2')
    .replace(/(クリーチャーは)さらに「/, '$1「')
    .replace(/^自分の手札を、?好きな枚数捨てる$/, '自分の手札を99枚まで捨てる')
    .replace(/^それ以外のカード(?:であれば|なら)、/, 'それ以外なら、')
    .replace(/^自分の山札のカードを上から(\d+)枚(?:を)?見る$/, '自分の山札の上から$1枚を見る')
    .replace(/^([゠-ヿー・]+)以外をすべて/, '$1以外のクリーチャーをすべて')
    .replace(/^好きな(?:枚)?数の(.+?)を(?=自分の(?:墓地|手札|マナゾーン)から)/, '$1を99枚まで、')
    .replace(/^自分の山札の一番上のカードを表にして、?(?:自分の)?マナゾーンに置(く|いてもよい)$/, '自分の山札の上から1枚目をマナゾーンに置$1')
    .replace(/^自分の山札を上から(\d+)枚、?表向きにする$/, '自分の山札の上から$1枚を表向きにする')
    .replace(/^(?:バトルゾーンにある)?相手のクリーチャーを(\d+)体、選(ぶ|んでもよい)$/, '相手のクリーチャーを$1体選$2')
    .replace(/^相手はバトルゾーンから自身の/, '相手は自身の')
    .replace(/^相手は、?(?:バトルゾーンにある)?自身の(クリーチャー)すべてを、?持ち主の(墓地|手札|マナゾーン)に/, '相手の$1をすべて持ち主の$2に')
    .replace(/^(?:それが)?([゠-ヿー・]+|進化クリーチャー)以外(?:のカード)?であれば、/, 'それが$1以外のカードであれば、')
    .replace(/この進化したクリーチャー/g, 'このクリーチャー')
    .replace(/^(それが呪文(?:であれば|なら)、)自分がコストを支払わずに唱え/, '$1その呪文をコストを支払わずに唱え')
    .replace(/^バトルゾーンから(?=[^、]+を\d+体)/, '')
    .replace(/(クリーチャー|カード|呪文)(\d+)(体|枚)(まで)?選び、/, '$1を$2$3$4選び、')
    .replace(/^(自分|相手)の(マナゾーン|墓地|手札)から(\d+)枚(まで)?選び、/, '$1の$2からカードを$3枚$4選び、')
    .replace(/好きな数の(.+?)を選び、/, '$1を99枚まで選び、')
    .replace(/を(99枚まで|好きな数)選んで(?=バトルゾーン|手札|墓地|マナ)/, 'を99枚まで選び、')
    .replace(/、?コストを支払わずに(?=自分の(?:手札|墓地|マナゾーン)からバトルゾーンに)/, '、')
    .replace(/「([^」]+)」付きであれば/, '「$1」を持つカードであれば')
    .replace(/「([^」]+)」付きの?/g, '「$1」を持つ')
    .replace(/^(パワー|コスト)の合計が(\d+)以下になるように(.+?)を99枚まで選び、/, '$3を、$1の合計が$2以下になるように好きな数選び、')
    .replace(/^このようにして山札を見ていた場合、(?:その後)?シャッフルする$/, '自分の山札をシャッフルする')
    .replace(/^このようにして(.+?)をバトルゾーンに出した場合、/, 'それが$1であれば、')
    .replace(/^(?:こうして|このようにして)(?:見せた|捨てた|墓地に置いた|戻した|タップした|マナゾーンに置いた)(?:カード|クリーチャー|の)?が、?(.+?)(ならば|なら|であれば)、/, 'それが$1$2、')
    .replace(/^このようにして、?([^、]+?)を(?:墓地に置いた|手札に加えた|マナゾーンに置いた|破壊した)場合(?:は)?、/, 'それが$1であれば、')
    .replace(/クリ[―‐-]チャー/g, 'クリーチャー')
    .replace(/^自分のターンの終わりに、/, 'このターンの終わりに、')
    .replace(/^([^、]+?)より(多|少な)い場合、/, '$1より$2ければ、')
    .replace(/、?(自分の)?マナゾーンに加える$/, '$1マナゾーンに置く')
    .replace(/、?(自分の)?マナゾーンに加えてもよい$/, '$1マナゾーンに置いてもよい')
    .replace(/^その中から(\d+)枚、/, 'その中からカードを$1枚選び、')
    .replace(/選び(?=(?:破壊|タップ|持ち主|手札に|墓地に|マナゾーンに))/g, '選び、')
    .replace(/を(\d+)(体|枚)、バトルゾーンから選び、/, 'を$1$2選び、')
    .replace(/(この|その)クリーチャーはパワーを([+-]\d+)される$/, '$1クリーチャーのパワーを$2する')
    .replace(/(クリーチャー)はすべて、(攻撃|ブロック)/, '$1すべては$2')
    .replace(/^自分のマナゾーンにあるカードの(?:数|枚数)と同じ枚数のカードを引く$/, '自分のマナゾーンにあるカード1枚につき、カードを1枚引く')
    .replace(/^このクリーチャーがリンクしている場合、/, 'このクリーチャーがリンクしていれば、')
    .replace(/^このクリーチャーがリンクしていない場合、/, 'このクリーチャーがリンクしていなければ、')
    .replace(/^このクリーチャーがタップされていた場合、/, 'このクリーチャーがタップされていれば、')
    .replace(/^そのクリーチャーのパワーが(\d+)(以下|以上)であれば、?(破壊する|持ち主の.+|タップする)$/, 'それがパワー$1$2のクリーチャーであれば、そのクリーチャーを$3')
    .replace(/^そのクリーチャーのパワーが(\d+)(以下|以上)であれば、?/, 'それがパワー$1$2のクリーチャーであれば、')
    .replace(/^(光|水|闇|火|自然)[:：]/, '')
    .replace(/(すべてのプレイヤーに|相手に)見せてから、?/g, '')
    .replace(/^その中から好きなカードを(\d+)枚、/, 'その中からカードを$1枚選び、')
    .replace(/^その中から(.+?)を(\d+)(体|枚)(?:見せ|表向きにし)、/, 'その中から$1を$2$3選び、')
    .replace(/^各相手は/, '相手は')
    .replace(/^相手は手札を(\d+)枚捨てる$/, '相手は自身の手札を$1枚選び、捨てる')
    .replace(/^すべての(クリーチャー|自分のクリーチャー|相手のクリーチャー)を/, '$1をすべて')
    .replace(/^バトルゾーンにある(?=[^、]+をすべて)/, '')
    .replace(/^→/, '')
    .replace(/^相手の手札を(\d+)枚、?見ないで選び/, '相手の手札から$1枚見ないで選び')
    .replace(/、コストを支払わずに自分の(手札|墓地|マナゾーン)から(唱え|召喚し|出し)/, '、自分の$1からコストを支払わずに$2')
    .replace(/^このターンの終わりまで、/, 'このターン、')
    .replace(/バトルゾーンにある、?(自分|相手)の/g, '$1の')
    .replace(/(自分|相手)の、/g, '$1の')
    .replace(/^相手は、/, '相手は')
    .replace(/(クリーチャー|カード)(\d+)(体|枚)を選び、/, '$1を$2$3選び、')
    .replace(/裏向きのまま(自分の)?シールドに加える$/, '裏向きのまま$1シールドゾーンに加える')
    .replace(/クリーチャーはすべて「/, 'クリーチャーすべてに「')
    .replace(/のパワーは([+-]\d+)される$/, 'のパワーを$1する')
    .replace(/(\d+枚目?)を、/g, '$1を')
    .replace(/^その下にあるカードを/, 'このクリーチャーの下にあるカードを')
    .replace(/^このターンが終わるまで、/, 'このターン、')
    .replace(/^そのターンの終わりまで、/, 'このターン、')
    .replace(/^このターンの攻撃中、/, 'このターン、')
    .replace(/(\d+)(体|枚|つ)でもあれば、/, '$1$2以上あれば、')
    .replace(/^(この|その)クリーチャーは、次の(自分|相手)のターンのはじめまで、?(.+)$/, '次の$2のターンのはじめまで、$1クリーチャーは$3')
    .replace(/、それぞれ新しいシールドとして/, '、新しいシールドとして')
    .replace(/^(自分の)?山札の上から(\d+)枚まで、/, '自分の山札の上から$2枚を')
    .replace(/^自分の山札のカードを、?上から(\d+)枚表向きにする$/, '自分の山札の上から$1枚を表向きにする')
    .replace(/ジョーカーズ・クリーチャー/g, 'ジョーカーズ')
    .replace(/(その|選んだ|選ばれた)種族の/g, '〈種族〉の')
    .replace(/(その|選んだ|選ばれた)文明の/g, '〈文明〉の')
    .replace(/(その|選んだ)数字と同じコスト(を持つ|の)/g, '〈数字コスト〉の')
    .replace(/(その|選んだ)数字と同じパワーを持つ/g, '〈数字パワー〉の')
    .replace(/(自分|相手)の、?〈(種族|文明)〉の/g, '$1の〈$2〉の')
    .replace(/〈(種族|文明)〉の(自分|相手)の/g, '$2の〈$1〉の')
    .replace(/》(\d+)(つ|体|枚)を/, '》を$1$2')
    .replace(/^バトルゾーンにある、/, '')
    .replace(/クリーチャーすべてを/, 'クリーチャーをすべて')
    .replace(/を表向きにして手札に/, 'を手札に')
    .replace(/^自分の山札からカードを/, 'カードを')
    .replace(/^(自分の)?山札の一番上のカードを(\d+)枚、?表にして/, '自分の山札の上から$2枚を')
    .replace(/^相手の手札からカードを(\d+)枚見ないで選び、相手は、/, '相手の手札からカードを$1枚見ないで選び、相手は')
    .replace(/好きな順番で/g, '好きな順序で')
    .replace(/マナゾーンにタップして置く$/, 'タップしてマナゾーンに置く')
    .replace(/^(.+?)は、?このターンの終わりまで((?:「[^」]+」(?:と|、)?)+)を得る$/, 'このターン、$1は$2を得る')
    .replace(/^(?!そうし|その後|このターン、クリーチャーを)(.+?)を(\d+)(枚|体)、自分の(墓地|手札|マナゾーン)から(.+)$/, '自分の$4から$1を$2$3$5')
    .replace(/^(?!そうし|その後)(.+?(?:クリーチャー|カード))(\d+)(体|枚)を(?!選)(.+)$/, '$1を$2$3、$4')
    .replace(/^自分の手札にある(?=.+を\d+(枚|体)、)/, '自分の手札から');
  if (!s) return [];

  // 覚醒リンク 「バトルゾーンに自分の《A》と《B》があれば、それらとこのクリーチャーを裏返しリンクさせる」
  {
    const sl = s.match(/^バトルゾーンに自分の((?:《[^》]+》(?:と|、)?)+)があれば、(?:それら|その(?:\d+体の)?クリーチャー)とこのクリーチャーを裏返し(?:て)?リンクさせる$/);
    if (sl) return [{ op: 'superLink', names: [...sl[1].matchAll(/《([^》]+)》/g)].map((x) => x[1]) }];
  }
  // マナゾーンのカードを裏向き/表向きにする
  {
    const fd = s.match(/^自分のマナゾーン(?:の|にある)(裏向きの|表向きの)?カードを(\d+)枚(まで)?、?(裏向き|表向き)にする$/);
    if (fd) {
      const down = fd[4] === '裏向き';
      const sel: Sel = { owner: 'self', zones: ['mana'], kind: 'card', faceDown: !down };
      return [
        { op: 'choose', target: { ref: 'sel', sel, count: { n: +fd[2], upTo: !!fd[3] }, chooser: 'self' }, purpose: down ? 'sacrifice' : 'benefit', prompt: s0 },
        { op: down ? 'faceDown' : 'faceUp', target: { ref: 'it' } },
      ];
    }
  }
  // 封印
  {
    const N1 = '(\\d+|ひとつ|1つ)';
    if (/^この(鼓動|フィールド)の/.test(s)) s = s.replace(/^この(鼓動|フィールド)の/, 'このカードの');
    const num = (x: string) => (/\d/.test(x) ? +x.replace(/つ$/, '') : 1);
    let sm = s.match(new RegExp(`^(?:相手は)?(?:それ|そのクリーチャー|それら|その\\d+体)に封印を${N1}つ?付ける$`));
    if (sm) return [{ op: 'seal', target: { ref: 'it' }, n: num(sm[1]) }];
    sm = s.match(new RegExp(`^(?:これ|このクリーチャー|このタマシード|このカード)?に?封印を${N1}つ?付ける$`));
    if (sm) return [{ op: 'seal', target: { ref: 'self' }, n: num(sm[1]) }];
    sm = s.match(new RegExp(`^相手は(?:自身|自分)のクリーチャーすべてに封印を${N1}つ?付ける$`));
    if (sm) return [{ op: 'seal', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature' }, count: { all: true }, chooser: 'opp' }, n: num(sm[1]) }];
    sm = s.match(new RegExp(`^クリーチャーすべてに封印を${N1}つ?付ける$`));
    if (sm) return [{ op: 'seal', target: { ref: 'sel', sel: { owner: 'any', zones: ['battle'], kind: 'creature' }, count: { all: true }, chooser: 'self' }, n: num(sm[1]) }];
    sm = s.match(new RegExp(`^(自分の|この(?:タマシード|クリーチャー|カード|フィールド|鼓動)の)封印を${N1}(?:つ|枚)(?:まで)?、?(?:自分の)?墓地に置く$`));
    if (sm) return [{ op: 'unseal', from: sm[1] === '自分の' ? 'any' : 'self', n: num(sm[2]) }];
  }
  // 種族・文明・数字を選ぶ
  {
    const cv = s.match(/^(?:(.+?)以外の)?(種族|文明)を(?:ひとつ|1つ)選ぶ$/);
    if (cv) return [{ op: 'chooseValue', kind: cv[2] === '種族' ? 'race' : 'civ', exclude: cv[1], hostile: false }];
    if (/^カード名を1つ選ぶ$/.test(s)) return [{ op: 'chooseValue', kind: 'name', hostile: false }];
    const ov = s.match(/^相手に(種族|文明)を(?:ひとつ|1つ)選ばせる$/);
    if (ov) return [{ op: 'chooseValue', kind: ov[1] === '種族' ? 'race' : 'civ', hostile: false, byOpp: true }];
    const nv = s.match(/^(?:(\d+)以下の)?数字を(?:ひとつ|1つ)選ぶ$/);
    if (nv) return [{ op: 'chooseValue', kind: 'number', max: nv[1] ? +nv[1] : undefined, hostile: false }];
  }
  // 「(そのクリーチャーは)可能ならこのクリーチャーを攻撃する」(相手のクリーチャーが攻撃する時)
  if (/^(そのクリーチャーは、?)?可能(であれば|なら(ば)?)、?このクリーチャーを攻撃する$/.test(s)) return [{ op: 'redirectAttack', to: 'self' }];
  if (/^(そのクリーチャーは、?)?可能(であれば|なら(ば)?)、?クリーチャーを攻撃する$/.test(s)) return [{ op: 'redirectAttack', to: 'creature' }];
  if (/^(その|この)ターンの終わりに、このクリーチャーを(自分の)?山札の(一番)?下に置く$/.test(s)) return [{ op: 'endOfTurnBottom' }];
  // 「自分の超次元ゾーンから(好きな数の)サイキック・クリーチャーをコストの合計がN以下になるように選び、バトルゾーンに出す」
  {
    const cs =
      s.match(/^自分の超次元ゾーン(?:から|にある)(?:好きな数の)?(.+?)を、?(?:(\d+)体まで、?)?コストの合計が(\d+)以下になるように(?:(\d+)体まで)?選び、(?:バトルゾーンに)?出す$/) ??
      s.match(/^自分の超次元ゾーンから(.+?)をコストの合計が(\d+)以下になるように(\d+)体まで選び、(?:バトルゾーンに)?出す$/);
    if (cs) {
      const sel = parseSel(cs[1], { zones: ['hyper'] });
      if (sel) {
        sel.owner = 'self';
        sel.zones = ['hyper'];
        const max = cs.length === 5 ? +(cs[2] ?? cs[4] ?? 99) : +cs[3];
        const sum = cs.length === 5 ? +cs[3] : +cs[2];
        return [
          { op: 'choose', target: { ref: 'sel', sel, count: { n: max, upTo: true, sumCostMax: sum }, chooser: 'self' }, purpose: 'benefit', prompt: `コストの合計が${sum}以下になるように選ぶ` },
          { op: 'play', target: { ref: 'it' }, mode: 'put' },
        ];
      }
    }
  }
  // Jビッグ: 自分の他のジョーカーズの、Jビッグ以外の出た時の能力を使う
  {
    const sn = s.match(/^バトルゾーンに同じ名前のクリーチャーが(\d+)体以上あれば、それらをすべて破壊する$/);
    if (sn) return [{ op: 'pickSameName', n: +sn[1] }, { op: 'destroy', target: { ref: 'it' } }];
    const sm = s.match(/^そのクリーチャーと、?同じ名前を持つ他のクリーチャーをすべて、?(.+)$/);
    const smOps = sm && verbOps(sm[1].replace(/^バトルゾーンから/, ''), { ref: 'it' });
    if (smOps) return [{ op: 'pickSameName', n: 0, ofIt: true }, ...smOps];
    if (/^この(カード|クリーチャー)を(自分の)?墓地から(自分の)?手札に戻す$/.test(s)) return [{ op: 'move', target: { ref: 'self' }, to: 'hand' }];
    if (/^この(カード|クリーチャー)を(自分の)?墓地から(自分の)?山札の(一番)?上に置く$/.test(s)) return [{ op: 'move', target: { ref: 'self' }, to: 'deckTop' }];
    {
      // 「相手は、バトルゾーンかマナゾーンから自身のカードをN枚選び、持ち主の墓地に置く」
      const oz = s.match(/^相手は、?(バトルゾーン(?:か|または)マナゾーン|マナゾーン(?:か|または)バトルゾーン)から自身のカードを(\d+)枚選び、(.+)$/);
      const rest = oz && verbOps(oz[3], { ref: 'it' });
      if (oz && rest) return [{ op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle', 'mana'], kind: 'card' }, count: { n: +oz[2], upTo: false }, chooser: 'opp' }, purpose: 'sacrifice', prompt: `カードを${oz[2]}枚選ぶ` }, ...rest];
    }
  }
  if (/^これを(?:自分の)?手札からそのクリーチャーに付け(る|てもよい)$/.test(s)) return [{ op: 'attachTo' }];
  if (/^(?:このようにして山札を見ていた場合、その後|こうして山札を見たら、)シャッフルする$/.test(s)) return [{ op: 'shuffle' }];
  if (/^このクリーチャーのフレーバーテキストを読む$/.test(s)) return [];
  if (/^(?:自分は)?ゲームに勝つ$/.test(s)) return [{ op: 'winGame' }];
  if (/^その攻撃の後(?:で|、)このクリーチャーを破壊する$/.test(s)) return [{ op: 'grant', target: { ref: 'self' }, kws: ['攻撃後破壊'], until: 'turn' }];
  if (/^そのGRクリーチャーはタップしてバトルゾーンに出る$/.test(s)) return [{ op: 'tap', target: { ref: 'it' } }];
  if (/^相手はそれらを好きな順序で(?:自身の)?山札の(?:一番)?下に置く$/.test(s)) return [{ op: 'move', target: { ref: 'it' }, to: 'deckBottom' }];
  if (/^それ以外のカードを好きな順序で(?:自分の)?山札の(?:一番)?下に(?:置く|戻す)$/.test(s)) return [{ op: 'move', target: { ref: 'rest' }, to: 'deckBottom' }];
  if (/^このクリーチャーのフレーバーテキストを読(?:む|んでもよい)$/.test(s)) return [];
  {
    const tt = s.match(/^クリーチャーを(\d+)体(まで)?選び、それぞれタップまたはアンタップする$/);
    if (tt)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'any', zones: ['battle'], kind: 'creature' }, count: { n: +tt[1], upTo: !!tt[2] }, chooser: 'self' }, purpose: 'neutral', prompt: s0 },
        { op: 'toggleTap', target: { ref: 'it' } },
      ];
  }
  if (/^自分のツインパクト・?クリーチャー1体の呪文側を、?バトルゾーンに置いたままコストを支払わずに唱え(る|てもよい)$/.test(s))
    return [
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature', twinpact: true }, count: { n: 1, upTo: /てもよい$/.test(s) }, chooser: 'self' }, purpose: 'benefit', prompt: '呪文側を唱えるツインパクト・クリーチャーを選ぶ' },
      { op: 'castSelfSpell', it: true },
    ];
  {
    const fl = s.match(/^このクリーチャーを《[^》]+》(?:の?ほう|側)に裏返(す|してもよい)$/);
    const f: Op[] = [{ op: 'flip', target: { ref: 'self' } }];
    if (fl) return fl[1] === 'す' ? f : [{ op: 'optional', body: f, prompt: s0 }];
  }
  if (/^(?:その|それと同じ)枚数と同じ数のカードを引く$|^その枚数と同じ枚数のカードを引く$|^それと同じ枚数のカードを引く$/.test(s)) return [{ op: 'drawItPlus', plus: 0 }];
  if (/^(この|その)クリーチャーは、?可能(であれば|なら)ブロックする$/.test(s)) return [{ op: 'grant', target: { ref: /^この/.test(s) ? 'self' : 'it' }, kws: ['強制ブロック'], until: 'nextOwnTurn' }];
  if (/^\d+枚しかない場合は、相手はその\d+枚を(?:持ち主の墓地に置く|捨てる)$/.test(s)) return [];
  if (/^(?:その)?攻撃を中止する$/.test(s)) return [{ op: 'cancelAttack' }];
  if (/^攻撃しているクリーチャーを破壊する$/.test(s)) return [{ op: 'destroyAttacker' }];
  if (/^裏返し、1体のクリーチャーとして合体させる$/.test(s)) return [{ op: 'flip', target: { ref: 'self' }, to: 'creature' }];
  if (/^この零龍星雲を自分の《[^》]+》にリンク(?:する|してもよい)$/.test(s)) return /てもよい$/.test(s) ? [{ op: 'optional', body: [{ op: 'zeroLink' }], prompt: s0 }] : [{ op: 'zeroLink' }];
  // 「〜を数える」「その数だけ〜」
  {
    const lc = s.match(/^その数以下の(.+?)を(?:バトルゾーンから)?選び、(.+)$/);
    const lsel = lc && parseSel(lc[1]);
    const lops = lc && verbOps(lc[2], { ref: 'it' });
    if (lc && lsel && lops) return [{ op: 'choose', target: { ref: 'sel', sel: lsel, count: { n: 99, upTo: true, fromCount: true }, chooser: 'self' }, purpose: purposeOf(lsel, lc[2]), prompt: `${lc[1]}を選ぶ` }, ...lops];
    const ct = s.match(/^(?:バトルゾーンにある)?(.+?)(?:の枚数)?を数える$/);
    if (ct) {
      if (/^自分のマナゾーンにある文明$/.test(ct[1])) return [{ op: 'countSet', civsOf: 'mana' }];
      if (/^自分のクリーチャーが持つ文明$/.test(ct[1])) return [{ op: 'countSet', civsOf: 'battle' }];
      const z = ct[1].match(/^(自分|相手)の(マナゾーン|墓地|手札|シールド)(?:にある(.+))?$/);
      if (z) {
        const zone = ({ マナゾーン: 'mana', 墓地: 'grave', 手札: 'hand', シールド: 'shield' } as const)[z[2] as 'マナゾーン'];
        const sel = z[3] ? parseSel(z[3], { zones: [zone] }) : ({ owner: 'any', zones: [zone], kind: 'card' } as Sel);
        if (sel) return [{ op: 'countSet', sel: { ...sel, owner: z[1] === '自分' ? 'self' : 'opp', zones: [zone], kind: z[3] && !/カード$/.test(z[3]) ? sel.kind : 'card' } }];
      }
      const sel = parseSel(ct[1]);
      if (sel) return [{ op: 'countSet', sel }];
    }
    const cr = s.match(/^(?:その数だけ|(?:その(?:文明の)?数|〈文明〉の数|それ)と同じ(?:枚数|数)(?:の(?:カード)?)?を?)、?(.+)$/);
    if (cr) {
      let rest = cr[1];
      if (/^(?:カードを)?引(?:く|いてもよい)$/.test(rest)) rest = rest.replace(/^(?:カードを)?引/, 'カードを1枚引');
      else if (/を選び、/.test(rest) && !/\d+(体|枚)/.test(rest)) rest = rest.replace(/を選び、/, 'を1体選び、');
      else if (/^自分の山札の上から/.test(rest)) rest = rest.replace(/^自分の山札の上から、?/, '自分の山札の上から1枚目を').replace(/を(?:自分の)?(マナゾーン|墓地)に(タップして)?置/, (_, z, t) => `を${t ?? ''}${z}に置`).replace(/^(自分の山札の上から1枚目)をを/, '$1を');
      const body = sentence(rest, ctx);
      if (body) return [{ op: 'repeatCount', body }];
    }
  }
  if (/^かわりにこのクリーチャー(?:にバトルさせる|がバトルする)$/.test(s)) return [{ op: 'battleInstead' }];
  if (/^(?:その|選んだ)(?:カード|クリーチャー)のコスト(?:の数)?と同じ枚数のカードを引(?:く|いてもよい)$/.test(s)) return [{ op: 'drawItCost' }];
  {
    const bb = s.match(/^自分の山札の一番下から(\d+)枚を(墓地|マナゾーン)に置く$/);
    if (bb) return Array.from({ length: +bb[1] }, (): Op => ({ op: 'deckBottomTo', to: bb[2] === '墓地' ? 'grave' : 'mana' }));
  }
  if (/^かわりに自分の他の.+?を\d+体破壊してもよい$/.test(s)) return []; // 置換効果は常在型能力で処理する
  if (/^このクリーチャーを(?:自分の)?(?:手札または)?墓地からバトルゾーンにタップして出す$/.test(s)) return [{ op: 'play', target: { ref: 'self' }, mode: 'put' }, { op: 'tap', target: { ref: 'self' } }];
  if (/^このターン、(?:自分の)?マナゾーンからクリーチャーを召喚してもよい$/.test(s)) return [{ op: 'manaSummon', n: 99 }];
  // ブレイクの置換 (常在型能力で処理する)
  if (/^相手は(?:その(?:シールド)?|それ)を(?:自身の)?手札に加えるかわりに、?(?:持ち主の)?墓地に置く$/.test(s)) return [];
  // 「このクリーチャーの下にある(〇〇)カードをN枚選び、〜」
  {
    const us = s.match(/^(?:かわりに、?)?このクリーチャーの下に(?:ある|重ねた)、?(.*?)(?:カード)?を(\d+)枚(まで)?(?:選び|、)、?(.+)$/);
    const sel = us && (us[1] ? parseSel(us[1].replace(/、$/, '').replace(/^(.+?)$/, '$1カード').replace(/クリーチャーではないカードカード$/, 'クリーチャーではないカード')) : ({ owner: 'any', zones: ['battle'], kind: 'card' } as Sel));
    const ops = us && verbOps(us[4].replace(/置いてもよい$/, '置く').replace(/出してもよい$/, '出す').replace(/戻してもよい$/, '戻す').replace(/加えてもよい$/, '加える'), { ref: 'it' });
    if (us && sel && ops) {
      const t: Target = { ref: 'sel', sel: { ...sel, owner: 'self', zones: ['underSelf'] }, count: { n: +us[2], upTo: !!us[3] }, chooser: 'self' };
      const body: Op[] = [{ op: 'choose', target: t, purpose: 'benefit', prompt: s0 }, ...ops];
      return /てもよい$/.test(us[4]) ? [{ op: 'optional', body, prompt: s0 }] : body;
    }
  }
  if (/^このクリーチャーの下にあるカードをすべて(?:相手に)?見せ(?:る|てもよい)$/.test(s)) return [];
  if (/^相手は、?その中から、?〈名前〉のカードをすべて捨てる$/.test(s))
    return [{ op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['hand'], kind: 'card', nameRef: true }, count: { all: true }, chooser: 'self' }, purpose: 'hostile', prompt: 'all' }, { op: 'move', target: { ref: 'it' }, to: 'grave' }];
  {
    const nc = s.match(/^手札にあるこのクリーチャーと、自分の(.+?)を?(\d+)体、?を?入れ替え(る|てもよい)$/);
    const sel = nc && parseSel('自分の' + nc[1].replace(/でメカまたはシノビの/, 'のメカまたはシノビの'));
    if (nc && sel) {
      const ops: Op[] = [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +nc[2], upTo: false }, chooser: 'self' }, purpose: 'sacrifice', prompt: s0 }, { op: 'handSwap' }];
      return nc[3] === 'る' ? ops : [{ op: 'optional', body: ops, prompt: s0 }];
    }
  }
  if (/^残り(?:のカード)?をシャッフルして(?:自分の)?山札の(?:一番)?下に置く$/.test(s)) return [{ op: 'move', target: { ref: 'rest' }, to: 'deckBottom' }];
  if (/^その持ち主は選ばれたカードを好きな順序で山札の(?:一番)?下に置く$/.test(s)) return [{ op: 'move', target: { ref: 'it' }, to: 'deckBottom' }];
  if (/^(?:そのあと|その後、?)?(?:それ|これ|シールド)を(?:好きな順番で)?元(?:の場所)?に戻す$/.test(s)) return [];
  if (/^\d+(?:体|枚)しかない場合は、.+$/.test(s)) return [];
  if (/^そのカードを手札に加えるか、タップしてマナゾーンに置く$/.test(s))
    return [{ op: 'modal', pick: 1, options: [{ label: '手札に加える', body: [{ op: 'move', target: { ref: 'it' }, to: 'hand' }] }, { label: 'タップしてマナゾーンに置く', body: [{ op: 'move', target: { ref: 'it' }, to: 'manaTapped' }] }] }];
  {
    const mo = s.match(/^(相手は)?(?:自分の|自身の)?(マナゾーン|手札)から(?:カードを)?(\d+)枚選び、それ以外を(?:自分の|持ち主の)?(墓地|手札)に(?:置く|戻す)$/) ?? s.match(/^(相手は)?カードを(\d+)枚、自身の(マナゾーン)から選び、それ以外を(?:自分の|持ち主の)?(墓地)に置く$/);
    if (mo) {
      const opp = !!mo[1];
      const zoneW = mo[2] === 'マナゾーン' || mo[3] === 'マナゾーン' ? 'mana' : 'hand';
      const n = +(/^\d+$/.test(mo[3] ?? '') ? mo[3] : mo[2]);
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: opp ? 'opp' : 'self', zones: [zoneW], kind: 'card' }, count: { n, upTo: false }, chooser: opp ? 'opp' : 'self' }, purpose: 'benefit', prompt: `残すカードを${n}枚選ぶ` },
        { op: 'moveOthers', zone: zoneW, who: opp ? 'opp' : 'self', to: mo[4] === '手札' ? 'hand' : 'grave' },
      ];
    }
  }
  // ランチャーE: 唱える時に自分のその種族をタップする / 「この呪文を唱えた時にタップした〇〇1体につき〜」
  {
    const le = s.match(/^ランチャーE[:：](.+)$/);
    const lsel = le && parseSel(le[1].replace(/^種族に(.+?)とある$/, '$1'));
    if (le && lsel)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { ...lsel, owner: 'self', zones: ['battle'], tapped: false, nonEvolution: true }, count: { n: 99, upTo: true }, chooser: 'self' }, purpose: 'benefit', prompt: `ランチャーE: タップする${le[1]}を選ぶ` },
        { op: 'tap', target: { ref: 'it' } },
        { op: 'save' },
      ];
    const lt = s.match(/^(?:その中から、)?この呪文を唱えた時に?タップした(.+?)1体につき(?:1枚)?、(.+)$/);
    const body = lt && sentence(lt[2], ctx);
    if (lt && body) return [{ op: 'repeatIt', saved: true, body }];
  }
  if (/^このターン、(?:すべての)?クリーチャーは攻撃(?:することが)?できない$/.test(s))
    return [{ op: 'restrict', target: { ref: 'sel', sel: { owner: 'any', zones: ['battle'], kind: 'creature' }, count: { all: true }, chooser: 'self' }, what: 'attack' }];
  if (/^相手は、?自身のシールドをすべて(?:自身の)?手札に加える$/.test(s))
    return [{ op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['shield'], kind: 'card' }, count: { all: true }, chooser: 'self' }, purpose: 'hostile', prompt: 'all' }, { op: 'move', target: { ref: 'it' }, to: 'hand' }];
  {
    const ab = s.match(/^(?:その)?バトルの後(?:で|、)(.+)$/) ?? s.match(/^このクリーチャーのバトルの後、(.+)$/);
    const body = ab && sentence(ab[1], ctx);
    if (body) return [{ op: 'afterBattle', body }];
  }
  if (/^これをアンタップする$/.test(s)) return [{ op: 'untap', target: { ref: 'self' } }];
  if (/^(?:その|見た)(?:カード|クリーチャー)を(?:自分の)?手札に加えるか、タップして(?:自分の)?マナゾーンに置く$/.test(s))
    return [{ op: 'modal', pick: 1, options: [{ label: '手札に加える', body: [{ op: 'move', target: { ref: 'it' }, to: 'hand' }] }, { label: 'タップしてマナゾーンに置く', body: [{ op: 'move', target: { ref: 'it' }, to: 'manaTapped' }] }] }];
  if (/^(?:その|この)ターン、相手がバトルゾーンにあるクリーチャーを選ぶ時、自分のクリーチャーは選ばれない$/.test(s))
    return [{ op: 'grant', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' }, count: { all: true }, chooser: 'self' }, kws: ['選ばれない'], until: 'turn' }];
  {
    const gr = s.match(/^そのクリーチャーは「([^」]+)」を得、(?:この)?ターンの終わりにバトルゾーンから(?:自分の|持ち主の)手札に戻す$/);
    if (gr) return [{ op: 'grant', target: { ref: 'it' }, kws: [gr[1]], until: 'turn' }, { op: 'atTurnEnd', body: [{ op: 'move', target: { ref: 'it' }, to: 'hand' }] }];
  }
  // 「AをN体またはBをN枚、〜」: どちらかを選ぶ
  {
    const ab = s.match(/^((?:その後、)?)([^、]*?(?:クリーチャー|オーラ|呪文|タマシード|カード|フィールド))を?(\d+)(体|枚)(?:まで)?または([^、]*?(?:クリーチャー|オーラ|呪文|タマシード|カード|フィールド))を?(\d+)(体|枚)(まで)?(、?.+)$/);
    if (ab && !/^その中から/.test(ab[2])) {
      const pre = ab[2].match(/^(相手の|自分の)/)?.[1] ?? '';
      const oa = sentence(`${ab[2]}を${ab[3]}${ab[4]}${ab[8] ?? ''}${ab[9]}`, ctx);
      const ob = sentence(`${pre && !ab[5].startsWith(pre) ? pre : ''}${ab[5]}を${ab[6]}${ab[7]}${ab[8] ?? ''}${ab[9]}`, ctx);
      if (oa?.length && ob?.length) return [{ op: 'modal', pick: 1, options: [{ label: `${ab[2]}を${ab[3]}${ab[4]}`, body: oa }, { label: `${ab[5]}を${ab[6]}${ab[7]}`, body: ob }] }];
    }
  }
  // 「AをN体破壊するか、BをN体破壊する」「A N体か、B N体を破壊する」: どちらかを選ぶ
  {
    const or2 = s.match(/^(.+?)(破壊する|持ち主の手札に戻す|持ち主の墓地に置く)か、(.+)$/);
    const oa = or2 && sentence(or2[1] + or2[2], ctx);
    const ob = or2 && sentence(or2[3], ctx);
    if (or2 && oa?.length && ob?.length) return [{ op: 'modal', pick: 1, options: [{ label: or2[1] + or2[2], body: oa }, { label: or2[3], body: ob }] }];
    const or3 = s.replace(/を(\d+(?:体|枚))、(?=(?:破壊する|持ち主の)[^、]*$)/, '$1を').match(/^(相手の.+?\d+(?:体|枚))(?:か、|、または、)(相手の.+?\d+(?:体|枚))を(破壊する|持ち主の手札に戻す|持ち主の墓地に置く)$/);
    const pa = or3 && sentence(`${or3[1].replace(/を?(\d+(?:体|枚))$/, 'を$1')}${or3[3]}`, ctx);
    const pb = or3 && sentence(`${or3[2].replace(/(\d+(?:体|枚))$/, 'を$1')}${or3[3]}`, ctx);
    if (or3 && pa?.length && pb?.length) return [{ op: 'modal', pick: 1, options: [{ label: or3[1], body: pa }, { label: or3[2], body: pb }] }];
  }
  if (/^(?:その)?バトルは行われない$/.test(s)) return [{ op: 'noBattle' }];
  {
    const ui = s.match(/^そのクリーチャーの下にある(?:カード)?をすべて、?(.+)$/);
    const uiOps = ui && verbOps(ui[1], { ref: 'underIt' });
    if (uiOps) return uiOps;
    // 「バトルゾーン、またはいずれかのマナゾーンからカードをN枚選び、〜」
    const zc = s.match(/^((?:バトルゾーン|(?:いずれかの)?マナゾーン)(?:、?(?:または|か)、?(?:いずれかの)?(?:バトルゾーン|マナゾーン))?)からカードを(\d+)枚選び、(.+)$/);
    if (zc) {
      const zones: SelZone[] = [...(/バトルゾーン/.test(zc[1]) ? ['battle' as const] : []), ...(/マナゾーン/.test(zc[1]) ? ['mana' as const] : [])];
      const rest = verbOps(zc[3], { ref: 'it' });
      if (rest) return [{ op: 'choose', target: { ref: 'sel', sel: { owner: 'any', zones, kind: 'card' }, count: { n: +zc[2], upTo: false }, chooser: 'self' }, purpose: 'hostile', prompt: `カードを${zc[2]}枚選ぶ` }, ...rest];
    }
    const bk = s.match(/^(?:その|この)?(?:攻撃を)?ブロックしたクリーチャーを(.+)$/);
    const ops = bk && verbOps(bk[1], { ref: 'blocker' });
    if (ops) return ops;
  }
  {
    // 「その中からN枚を手札に加え、N枚を山札の一番下に戻し、残りを山札の一番上に置く」
    const hb = s.match(/^その中から(\d+)枚を手札に加え、(\d+)枚を山札の一番下に(?:戻し|置き)、残り(?:の\d+枚)?を山札の一番上に(?:戻す|置く)$/);
    if (hb) {
      const inDeck: Sel = { owner: 'self', zones: ['deck'], kind: 'card' };
      return [
        { op: 'choose', target: { ref: 'looked', count: { n: +hb[1], upTo: false } }, purpose: 'benefit', prompt: `手札に加えるカードを${hb[1]}枚選ぶ` },
        { op: 'move', target: { ref: 'it' }, to: 'hand' },
        { op: 'choose', target: { ref: 'looked', sel: inDeck, count: { n: +hb[2], upTo: false } }, purpose: 'neutral', prompt: `山札の一番下に置くカードを${hb[2]}枚選ぶ` },
        { op: 'move', target: { ref: 'it' }, to: 'deckBottom' },
        { op: 'choose', target: { ref: 'looked', sel: inDeck, count: { all: true } }, purpose: 'neutral', prompt: 'all' },
        { op: 'move', target: { ref: 'it' }, to: 'deckTop' },
      ];
    }
  }
  {
    // 「次の相手のターンのはじめに、相手は自身のマナゾーンのカードをN枚までしかアンタップできない」
    const ul = s.match(/^(次の相手のターンのはじめに、)?相手は自身のマナゾーン(?:にある|の)カードを(\d+)枚までしかアンタップできない$/);
    if (ul) return ul[1] ? [{ op: 'manaUntapLimit', n: +ul[2] }] : [];
  }
  {
    const hv = s.match(/^これを(?:装備|クロス)したクリーチャーを(.+)$/);
    const ops = hv && verbOps(hv[1], { ref: 'host' });
    if (ops) return ops;
    const lb = s.match(/^(?:その)?下にあったクリーチャーを(.+)$/);
    const ops2 = lb && verbOps(lb[1], { ref: 'leftBehind' });
    if (ops2) return ops2;
  }
  {
    const nl = s.match(/^(このターン|そのターン中|このターン中|次の自分のターンのはじめまで)、自分はゲームに負けず、相手はゲームに勝てない$/);
    if (nl) return [{ op: 'noLose', until: /次の/.test(nl[1]) ? 'nextOwnTurn' : 'turn' }];
    if (/^(?:そのカード|それ)を自分の手札またはマナゾーンに(?:加える|置く)$/.test(s))
      return [{ op: 'modal', pick: 1, options: [{ label: '手札に加える', body: [{ op: 'move', target: { ref: 'it' }, to: 'hand' }] }, { label: 'マナゾーンに置く', body: [{ op: 'move', target: { ref: 'it' }, to: 'mana' }] }] }];
    const ds = s.match(/^([^、]+?)をすべて、自分の(墓地|手札|マナゾーン)から(.+)$/);
    const dsel = ds && parseSel(ds[1], { zones: [ZONE[ds[2]]] });
    const dops = ds && verbOps(ds[3], { ref: 'it' });
    if (ds && dsel && dops) return [{ op: 'choose', target: { ref: 'sel', sel: { ...dsel, owner: 'self', zones: [ZONE[ds[2]]] }, count: { all: true }, chooser: 'self' }, purpose: 'benefit', prompt: 'all' }, ...dops];
  }
  {
    const db = s.match(/^自分の山札の一番下のカードを(墓地|マナゾーン|手札)に(?:置く|加える)$/);
    if (db) return [{ op: 'deckBottomTo', to: db[1] === '墓地' ? 'grave' : db[1] === '手札' ? 'hand' : 'mana' }];
    if (/^次の相手のターンの終わりまで、相手は呪文を唱えられない$/.test(s)) return [{ op: 'lockSpells', until: 'nextOwnTurn' }];
    if (/^(?:自分の)?マナゾーンに置く$/.test(s)) return [{ op: 'move', target: { ref: 'it' }, to: 'mana' }];
    const jt = s.match(/^Jトルネードを最大(\d+)回する$/);
    if (jt)
      return [
        {
          op: 'repeat',
          n: +jt[1],
          body: [
            { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature', races: ['ジョーカーズ'], other: true }, count: { n: 1, upTo: true }, chooser: 'self' }, purpose: 'sacrifice', prompt: 'Jトルネード: 手札に戻すジョーカーズを選ぶ (しないなら選ばない)' },
            { op: 'move', target: { ref: 'it' }, to: 'hand' },
          ],
        },
      ];
    const mp2 = s.match(/^このターン、自分のクリーチャー(\d+)体のパワーを(\d+)倍(?:に)?する$/);
    if (mp2)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' }, count: { n: +mp2[1], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `パワーを${mp2[2]}倍にするクリーチャーを選ぶ` },
        { op: 'multPower', target: { ref: 'it' }, times: +mp2[2] },
      ];
  }
  if (/^この(?:クリーチャー|カード)を(?:自分の)?手札から表向きにする$/.test(s)) return [{ op: 'note', text: '手札から表向きにした' }];
  if (/^(?:出し、)?このクリーチャーをその上に置く$/.test(s)) return [...(/^出し/.test(s) ? [{ op: 'play', target: { ref: 'it' }, mode: 'put' } as Op] : []), { op: 'putOnTop' }];
  // 無月の門
  {
    const mg = s.match(/^自分の魔導具をバトルゾーンと墓地から(\d+)つずつ選び、このクリーチャーを自分の手札または墓地からそれら\d+枚の上にコストを支払わずに召喚(?:する|してもよい)$/);
    if (mg) return [{ op: 'mugetsu', each: +mg[1] }];
    const mt = s.match(/^自分の魔導具をバトルゾーン(?:また|と)は?墓地から合計(\d+)(?:つ|枚)選び、このクリーチャーを自分の手札または墓地からそれら\d+枚の上にコストを支払わずに召喚(?:する|してもよい)$/);
    if (mt) return [{ op: 'mugetsu', total: +mt[1] }];
  }
  // 「相手の光のクリーチャー、水のクリーチャー、…を1体ずつ破壊する」
  {
    const ec = s.match(/^相手の((?:(?:光|水|闇|火|自然)のクリーチャー、?)+)を(\d+)体(?:ずつ)?(破壊する|持ち主の手札に戻す|持ち主のマナゾーンに置く)$/);
    if (ec) {
      const CIV: Record<string, string> = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };
      return [...ec[1].matchAll(/(光|水|闇|火|自然)のクリーチャー/g)].flatMap((x): Op[] => [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature', civs: [CIV[x[1]] as never] }, count: { n: +ec[2], upTo: false }, chooser: 'self' }, purpose: 'hostile', prompt: `相手の${x[1]}のクリーチャーを選ぶ` },
        ec[3] === '破壊する' ? { op: 'destroy', target: { ref: 'it' } } : { op: 'move', target: { ref: 'it' }, to: ec[3] === '持ち主の手札に戻す' ? 'hand' : 'mana' },
      ]);
    }
  }
  const al = s.match(/^次の自分のターンのはじめまで、相手は各ターン(\d+)度しか、?クリーチャーで攻撃もブロックもできない$/);
  if (al) return [{ op: 'actLimit', n: +al[1] }];
  if (/^(相手の手札とシールドを見る|自分の手札を\d+枚見せる)$/.test(s)) return [];
  {
    const ep = s.match(/^(各プレイヤーは|相手は)、?(?:バトルゾーンにある)?(?:自身の)?パワー(\d+)以下のクリーチャー(?:すべてを|をすべて)、?(?:それぞれの|持ち主の)墓地に置く$/);
    if (ep)
      return [{ op: 'move', target: { ref: 'sel', sel: { owner: ep[1] === '相手は' ? 'opp' : 'any', zones: ['battle'], kind: 'creature', powerMax: +ep[2] }, count: { all: true }, chooser: 'self' }, to: 'grave' }];
    const dp = s.match(/^(?:バトルゾーンにある)?(相手|自分)のクリーチャーと同じ枚数のカードを引く$/);
    if (dp) return [{ op: 'drawPer', sel: { owner: dp[1] === '相手' ? 'opp' : 'self', zones: ['battle'], kind: 'creature' } }];
  }
  const jb = s.match(/^Jビッグ(\d+)する$/);
  if (jb)
    return [
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature', races: ['ジョーカーズ'], other: true }, count: { n: +jb[1], upTo: true }, chooser: 'self' }, purpose: 'benefit', prompt: 'Jビッグ: 出た時の能力を使うジョーカーズを選ぶ' },
      { op: 'useEnterOf', exclude: 'Jビッグ' },
    ];
  // Jトルネード: 自分の他のジョーカーズを1体、手札に戻す
  if (/^Jトルネードする$/.test(s))
    return [
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature', races: ['ジョーカーズ'], other: true }, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'sacrifice', prompt: 'Jトルネード: 手札に戻すジョーカーズを選ぶ' },
      { op: 'move', target: { ref: 'it' }, to: 'hand' },
    ];
  // Dスイッチ 「このD2フィールドをゲーム中で一度上下逆さまにする」
  if (/^この(D2|DN|D)?フィールドをゲーム中で一度上下逆さまにする$/.test(s)) return [{ op: 'oncePerGame' }];
  // 超魂レイド 「その中からこのクリーチャーの進化元になれるカードを1枚、この下に置く」
  {
    const su = s.match(/^その中から(?:このクリーチャーの)?進化元になれるカードを(\d+)枚、?この(?:クリーチャーの)?下に置く$/);
    if (su)
      return [
        { op: 'choose', target: { ref: 'looked', sel: { owner: 'any', zones: ['deck'], kind: 'creature' }, count: { n: +su[1], upTo: false } }, purpose: 'benefit', prompt: '下に置くカードを選ぶ' },
        { op: 'stackUnder', what: 'it' },
      ];
    const sv = s.match(/^この(?:タマシード|カード|クリーチャー)を(自分の.+?)(\d+)体の下に置く$/);
    const sel = sv && parseSel(sv[1]);
    if (sv && sel)
      return [
        { op: 'choose', target: { ref: 'sel', sel, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: '下に置くクリーチャーを選ぶ' },
        { op: 'stackUnder', what: 'self' },
      ];
  }
  // 逆転撃: 次の自分のターンのはじめに支払う。支払えなければ負ける
  {
    const pl = s.match(/^次の自分のターンのはじめに\[[a-z]*(\d+)\]を支払う$/);
    if (pl) return [{ op: 'payLater', cost: +pl[1] }];
    if (/^支払えなければ、自分はゲームに負ける$/.test(s)) return [];
  }
  // 手札を裏向きのまま新しいシールドに
  {
    const hs = s.match(/^自分の手札を(\d+)枚(まで)?、?裏向きのまま、?新しいシールドとして(?:自分の)?シールドゾーンに(?:置く|加える)$/);
    if (hs)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['hand'], kind: 'card' }, count: { n: +hs[1], upTo: !!hs[2] }, chooser: 'self' }, purpose: 'sacrifice', prompt: 'シールドにする手札を選ぶ' },
        { op: 'move', target: { ref: 'it' }, to: 'shield' },
      ];
  }
  if (/^表向きにしたカードを(すべて)?(自分の)?マナゾーンに置く$/.test(s)) return [{ op: 'move', target: { ref: 'it' }, to: 'mana' }];
  {
    const dp = s.match(/^バトルゾーンにある(相手|自分)のクリーチャーと同じ枚数のカードを引く$/);
    if (dp) return [{ op: 'drawPer', sel: { owner: dp[1] === '相手' ? 'opp' : 'self', zones: ['battle'], kind: 'creature' } }];
  }
  {
    const ap = s.match(/^(?:このターン、)?(.+?)は相手プレイヤーを攻撃できない$/);
    const t = ap && refTarget(ap[1]);
    if (ap && t) return [{ op: 'restrict', target: t, what: 'attackOpp' }];
  }
  // パワーをNにする / すべてのバトルに勝つ / N体につきN枚引く
  {
    const sp = s.match(/^このターン、(.+?)のパワーを(\d+)にする$/);
    const t = sp && refTarget(sp[1]);
    if (sp && t) return [{ op: 'setPower', target: t, value: +sp[2] }];
    const wb = s.match(/^このターン、(.+?)はすべてのバトルに勝つ$/);
    const t2 = wb && refTarget(wb[1]);
    if (wb && t2) return [{ op: 'grant', target: t2, kws: ['すべてのバトルに勝つ'], until: 'turn' }];
    const dp = s.match(/^バトルゾーンにある(自分|相手)の(.+?)(\d+)体につき(\d+)枚、カードを引く$/);
    const sel = dp && parseSel(`${dp[1]}の${dp[2]}`);
    if (dp && sel) return [{ op: 'drawPer', sel, each: +dp[3], mult: +dp[4] }];
  }
  // 一時的な能力 「次の自分のターンのはじめまで、このクリーチャーは離れない/破壊されない/すべてのバトルに勝つ/相手に選ばれず、攻撃されない」
  {
    const nl = s.match(/^(次の(?:自分|相手)のターンのはじめまで|このターン)、(この|その|自分の|バトルゾーンにある自分の)クリーチャーは、?(?:すべて、?)?(.+)$/);
    const map: [RegExp, string[]][] = [
      [/^(バトルゾーンを)?離れない$/, ['離れない']],
      [/^破壊されない$/, ['破壊されない']],
      [/^すべてのバトルに勝つ$/, ['すべてのバトルに勝つ']],
      [/^相手に選ばれず、攻撃されない$/, ['選ばれない', '攻撃されない']],
      [/^相手に選ばれない$/, ['選ばれない']],
      [/^攻撃されない$/, ['攻撃されない']],
    ];
    const hit = nl && map.find(([re]) => re.test(nl[3]));
    const tgt: Target | null = nl ? (nl[2] === 'この' ? { ref: 'self' } : nl[2] === 'その' ? { ref: 'it' } : { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' }, count: { all: true }, chooser: 'self' }) : null;
    if (nl && hit && tgt) return [{ op: 'grant', target: tgt, kws: hit[1], until: nl[1] === 'このターン' ? 'turn' : 'nextOwnTurn' }];
    // 「次の相手のターン中、自分の〇〇は攻撃されない」など (種族つき)
    const nr = s.match(/^(次の(?:自分|相手)のターン(?:のはじめまで|中)|このターン)、(自分の[^、]+?)は、?(?:すべて、?)?(.+)$/);
    const hr = nr && map.find(([re]) => re.test(nr[3]));
    const sel = nr && parseSel(nr[2]);
    if (nr && hr && sel) return [{ op: 'grant', target: { ref: 'sel', sel, count: { all: true }, chooser: 'self' }, kws: hr[1], until: nr[1] === 'このターン' ? 'turn' : 'nextOwnTurn' }];
  }
  if (/^このターンの後に(自分の)?ターンを(追加する|もう一度行う)$/.test(s) || /^このターンの後にもう一度自分のターンを行う$/.test(s)) return [{ op: 'extraTurn' }];
  // 「その中から〇〇をすべて手札に加え、それ以外のカードを好きな順序で山札の一番下に戻す」
  {
    const lh = s.match(/^その中から(.+?)を(すべて|(\d+)(?:枚|体)(まで)?)、?(?:自分の)?手札に加え、(?:それ以外のカード|残り(?:のカード)?)を(?:好きな順序で)?(?:自分の)?山札の(?:一番)?下に(?:戻す|置く)$/);
    const sel = lh && parseSel(lh[1], { zones: ['deck'] });
    if (lh && sel) {
      const count: Count = lh[2] === 'すべて' ? { all: true } : { n: +lh[3], upTo: !!lh[4] };
      return [
        { op: 'choose', target: { ref: 'looked', sel, count }, purpose: 'benefit', prompt: s0 },
        { op: 'move', target: { ref: 'it' }, to: 'hand' },
        { op: 'move', target: { ref: 'rest' }, to: 'deckBottom' },
      ];
    }
  }
  // 相手が選ぶ・各プレイヤーなど
  {
    const ua = s.match(/^このターン、(?:バトルゾーンにある)?自分の(.*?)クリーチャー(?:(\d+)体は|はすべて|すべては)、?(?:タップされていない|アンタップしている)クリーチャーを攻撃できる$/);
    const uaSel = ua && parseSel(`自分の${ua[1]}クリーチャー`);
    if (ua && uaSel)
      return ua[2]
        ? [
            { op: 'choose', target: { ref: 'sel', sel: uaSel, count: { n: +ua[2], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `タップされていないクリーチャーを攻撃できるクリーチャーを${ua[2]}体選ぶ` },
            { op: 'grant', target: { ref: 'it' }, kws: ['アンタップ攻撃'], until: 'turn' },
          ]
        : [{ op: 'grant', target: { ref: 'sel', sel: uaSel, count: { all: true }, chooser: 'self' }, kws: ['アンタップ攻撃'], until: 'turn' }];
    if (/^(このターン|そのターン)、(この|その)クリーチャーは(タップされていない|アンタップしている)クリーチャーを攻撃できる$/.test(s))
      return [{ op: 'grant', target: { ref: /この/.test(s.slice(6, 10)) ? 'self' : 'it' }, kws: ['アンタップ攻撃'], until: 'turn' }];
    const dc = s.match(/^相手は(?:自身|自分)の手札から(\d+)枚選び、捨てる$/);
    if (dc) return [{ op: 'discard', who: 'opp', count: { n: +dc[1], upTo: false }, how: 'ownerChooses' }];
    const dm = s.match(/^相手は(?:自身|自分)のパワーが一番(小さい|大きい)クリーチャーを(?:(\d+)体)?選(?:んで|び)、?破壊する$/);
    if (dm) return [{ op: 'destroyExtreme', owner: 'opp', max: dm[1] === '大きい', n: dm[2] ? +dm[2] : 1 }];
    const rt = s.match(/^相手は(?:自身|自分)の山札の上から(\d+)枚を表向きにする$/);
    if (rt) {
      ctx.looked = true;
      return [{ op: 'top', n: +rt[1], to: 'reveal', who: 'opp' }];
    }
    if (/^自分の手札を(\d+枚(まで)?|好きな枚数)、?相手に見せる$/.test(s)) return [{ op: 'note', text: '手札を見せた' }];
    const hs = s.match(/^自分の手札を(\d+)枚(?:選び)?、?(?:表向き(?:または裏向き)?で|裏向きにして、?)(?:シールド化する|新しいシールドとして(?:自分の)?シールドゾーンに置く|自分のシールドに加える)$/);
    if (hs)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['hand'], kind: 'card' }, count: { n: +hs[1], upTo: false }, chooser: 'self' }, purpose: 'sacrifice', prompt: 'シールドにする手札を選ぶ' },
        { op: 'move', target: { ref: 'it' }, to: 'shield' },
      ];
    if (/^各プレイヤーは(?:自身|自分)の手札をすべて、?それぞれの墓地に置く$/.test(s))
      return [
        { op: 'discard', who: 'self', count: { all: true }, how: 'choose' },
        { op: 'discard', who: 'opp', count: { all: true }, how: 'random' },
      ];
    if (/^各プレイヤーは(?:自身|自分)のマナゾーンにあるカードをすべて、?それぞれの手札に戻す$/.test(s))
      return [{ op: 'move', target: { ref: 'sel', sel: { owner: 'any', zones: ['mana'], kind: 'card' }, count: { all: true }, chooser: 'self' }, to: 'hand' }];
  }
  // シールドを選んで墓地・手札へ
  {
    const sh = s.match(/^(?:その中から)?(\d+|好きな)枚(?:数)?を?裏向きのまま選び、(?:自分の)?(墓地に置く|手札に加える)$/) ?? s.match(/^自分のシールドから(好きな)枚数を裏向きのまま選び、(?:自分の)?(手札に加える|墓地に置く)$/);
    if (sh)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['shield'], kind: 'card' }, count: { n: sh[1] === '好きな' ? 99 : +sh[1], upTo: sh[1] === '好きな' }, chooser: 'self' }, purpose: 'benefit', prompt: '自分のシールドを選ぶ' },
        { op: 'move', target: { ref: 'it' }, to: /墓地/.test(sh[2]) ? 'grave' : 'hand' },
      ];
  }
  // シールドの下に重ねる
  {
    const ss = s.match(/^自分の山札の上から(\d+)枚(?:目)?を、?裏向きのまま、?自分のシールド(?:いずれか|(?:\d+)枚)の下に置く$/);
    if (ss) return [{ op: 'shieldStack', n: +ss[1] }];
  }
  // 山札の上を見て/表向きにして、そのうちのN枚を〜 / このクリーチャーの下に置く
  {
    const lk = s.match(/^自分の山札の上から(\d+)枚を見て、(?:そのうちの|その中から)(\d+)枚を(.+)$/);
    const rest = lk && verbOps(lk[3], { ref: 'it' });
    if (lk && rest) {
      ctx.looked = true;
      return [{ op: 'top', n: +lk[1], to: 'look', who: 'self' }, { op: 'choose', target: { ref: 'looked', count: { n: +lk[2], upTo: false } }, purpose: 'benefit', prompt: s0 }, ...rest];
    }
    if (/^自分の山札の上から(\d+)枚を見て、好きな順序で(元に|山札の上に)?戻す$/.test(s)) return [{ op: 'top', n: +s.match(/(\d+)枚/)![1], to: 'look', who: 'self' }, { op: 'note', text: '好きな順序で戻した' }];
    const sv = s.match(/^自分の山札の上から(\d+)枚(?:目)?を(?:見せる|表向きにする)$/);
    if (sv) {
      ctx.looked = true;
      return [{ op: 'top', n: +sv[1], to: 'reveal', who: 'self' }];
    }
    const su = s.match(/^自分の山札の上から(\d+)枚(?:目)?を表向きに(?:して|し、)このクリーチャーの下に置く$/);
    if (su) return [{ op: 'top', n: +su[1], to: 'reveal', who: 'self' }, { op: 'stackUnder', what: 'it' }];
  }
  if (/^相手はそれを(?:自身の)?山札の上か下に置く$/.test(s)) return [{ op: 'topOrBottom', target: { ref: 'it' }, chooser: 'opp' }];
  if (/^(残り|見せたカードはすべて、|残りのカード)を?、?好きな順序で山札の上か下(のどちらか)?に(置く|戻す)$/.test(s)) return [{ op: 'topOrBottom', target: { ref: 'rest' }, chooser: 'self' }];
  // 効果で唱えた呪文を、唱えた後に山札の下へ
  if (/^(?:こうして呪文を唱えたなら、)?(?:それ|その呪文)を唱えた後、墓地(?:に置く)?の?かわりに(?:持ち主の|自分の)?山札の(?:一番)?下に置く$/.test(s)) return [{ op: 'move', target: { ref: 'it' }, to: 'deckBottom' }];
  if (/^相手は(?:自身|自分)の山札をシャッフルする$/.test(s)) return [{ op: 'shuffle', who: 'opp' }];
  // 唱えた後、墓地に置くかわりに山札の下 (呪文を出す処理で行う)
  if (/^(この呪文を(自分の手札から)?)?唱えた後、(この呪文を)?墓地に置くかわりに(自分の)?山札の(一番)?下に置く$/.test(s)) return [];
  if (/^(この呪文を)?唱えた後、(自分の)?墓地に置くかわりに(自分の)?山札に加えてシャッフルする$/.test(s)) return [];
  if (/^この呪文を唱えた後、墓地のかわりに自分の《[^》]+》1つの下に置く$/.test(s)) return [];
  {
    const us = s.match(/^(.+?)をすべてアンタップし、このターン、?それらに「([^」]+)」を与える$/);
    const a = us && sentence(`${us[1]}をすべてアンタップする`, ctx);
    if (a?.length) return [...a, { op: 'grant', target: { ref: 'it' }, kws: [us![2]], until: 'turn' }];
  }
  // コストを支払うかわりにタップして唱える (常在型能力で処理)
  if (/^コストを支払うかわりに、/.test(s)) return [];
  // シールドをさらにN枚ブレイクする
  {
    const xn = s.match(/^(このターン|次の自分のターンのはじめまで)、(.+?)(\d+)体は、?(?:相手の)?シールドをさらに(\d+)(?:枚|つ)ブレイクする$/);
    const xsel = xn && parseSel(xn[2]);
    if (xn && xsel)
      return [
        { op: 'choose', target: { ref: 'sel', sel: xsel, count: { n: +xn[3], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `${xn[2]}を${xn[3]}体選ぶ` },
        { op: 'grant', target: { ref: 'it' }, kws: [`ブレイク+${xn[4]}`], until: xn[1] === 'このターン' ? 'turn' : 'nextOwnTurn' },
      ];
    const xb = s.match(/^(このターン|次の自分のターンのはじめまで)、(.+?)は、?(?:相手の)?シールドをさらに(\d+)(?:枚|つ)ブレイクする$/);
    const t = xb && refTarget(xb[2]);
    if (xb && t) return [{ op: 'grant', target: t, kws: [`ブレイク+${xb[3]}`], until: xb[1] === 'このターン' ? 'turn' : 'nextOwnTurn' }];
  }
  // 山札の上から表向きでシールド化
  {
    const su = s.match(/^(?:自分の)?山札の上から(\d+)枚を表向きで(?:シールド化する|新しいシールドとしてシールドゾーンに(?:置く|加える))$/);
    if (su) return [{ op: 'top', n: +su[1], to: 'shieldUp', who: 'self' }];
  }
  // 相手の手札をすべて捨てさせる
  if (/^相手は(?:自身|自分)の手札をすべて(?:、?持ち主の墓地に置く|捨てる)$/.test(s)) return [{ op: 'discard', who: 'opp', count: { all: true }, how: 'ownerChooses' }];
  // 山札から探して手札に (古い書き方)
  {
    const sr = s.match(/^自分の山札から(.+?)を(\d+)枚(?:まで)?さがして(?:相手に見せ、)?(?:自分の)?手札に加える$/);
    if (sr) {
      const sel = parseSel(sr[1], { zones: ['deck'] });
      if (sel) {
        ctx.looked = true;
        return [{ op: 'lookDeck' }, { op: 'choose', target: { ref: 'looked', sel, count: { n: +sr[2], upTo: true } }, purpose: 'benefit', prompt: s0 }, { op: 'move', target: { ref: 'it' }, to: 'hand' }, { op: 'shuffle' }];
      }
    }
  }
  // 手札のカードを相手に見せる (コストとして)
  {
    const rv = s.match(/^自分の手札にある(.+?)を(\d+)枚、?相手に見せる$/) ?? s.match(/^自分の手札から(.+?)を(\d+)枚、?相手に見せる$/);
    if (rv) {
      const sel = parseSel(rv[1], { zones: ['hand'] });
      if (sel) {
        sel.owner = 'self';
        sel.zones = ['hand'];
        if (sel.kind === 'creature' && /カード$/.test(rv[1])) sel.kind = 'card';
        return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +rv[2], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: s0 }, { op: 'note', text: '手札のカードを見せた' }];
      }
    }
  }
  if (/^自分の山札の上から(\d+)枚を見て、好きな順序で(山札の上に)?戻す$/.test(s)) return [{ op: 'top', n: +s.match(/(\d+)枚/)![1], to: 'look', who: 'self' }, { op: 'note', text: '好きな順序で山札の上に戻した' }];
  if (/^この呪文を唱えられなくする効果を無視する$/.test(s)) return [];
  // 置換効果・注記は常在型能力として処理する
  if (/^このクリーチャーが表向きで、?シールドゾーンを離れる時、かわりに(自分の)?墓地に置く$/.test(s)) return [];
  if (/^[(（].*$/.test(s) && /(破壊される|ブレイクする|召喚酔いしない)$/.test(s)) return [];
  // 山札の上から裏向きのままマナへ
  {
    const tm = s.match(/^(?:自分の)?山札の上から(\d+)枚を裏向きのまま(?:自分の)?マナゾーンに置く$/);
    if (tm) return [{ op: 'top', n: +tm[1], to: 'manaDown', who: 'self' }];
  }
  // 見ないで選んで捨てさせる
  {
    const rd = s.match(/^相手の手札から(?:カードを)?(\d+)枚見ないで選び、(?:相手は)?(?:それを)?(?:持ち主の)?(?:墓地に置く|捨てさせる|捨てる)$/);
    if (rd) return [{ op: 'discard', who: 'opp', count: { n: +rd[1], upTo: false }, how: 'random' }];
  }
  // 「(期間)、〇〇は可能であれば攻撃する」「相手のクリーチャーが攻撃する時、可能ならクリーチャーを攻撃する」(一時的)
  {
    const P = '(このターン|そのターン|次のターン|次の相手のターン中?|次の自分のターンのはじめまで|自分の次のターンのはじめまで)';
    const fa =
      s.match(new RegExp(`^(?:${P}、)?(.+?)は、?(?:すべて、?)?(?:${P}、?)?可能(?:であれば|なら(?:ば)?)、?攻撃する$`)) ?? null;
    if (fa) {
      const per = fa[1] ?? fa[3] ?? '';
      const t = refTarget(fa[2].replace(/は?すべて$/, ''));
      if (t) return [{ op: 'grant', target: t, kws: ['強制攻撃'], until: /^(この|その)ターン$/.test(per) ? 'turn' : 'nextOwnTurn' }];
    }
    const fc =
      s.match(new RegExp(`^(?:${P}、)?(.+?)(?:は|が攻撃する時)、?(?:${P}、?)?可能(?:であれば|なら(?:ば)?)、?(?:自分の|相手の)?(?:その)?クリーチャーを攻撃する$`)) ?? null;
    if (fc) {
      const per = fc[1] ?? fc[3] ?? '';
      const t = refTarget(fc[2].replace(/は?すべて$/, ''));
      if (t) return [{ op: 'grant', target: t, kws: ['強制攻撃', '攻撃先クリーチャー'], until: /^(この|その)ターン$/.test(per) ? 'turn' : 'nextOwnTurn' }];
    }
    if (/^可能なら(?:自分の|その)?クリーチャーを攻撃する$/.test(s)) return [{ op: 'grant', target: { ref: 'it' }, kws: ['強制攻撃', '攻撃先クリーチャー'], until: 'nextOwnTurn' }];
  }
  // 「相手のクリーチャーは可能ならこのクリーチャーを攻撃する」(一時的)
  {
    const lu = s.match(/^(このターン|次の(?:自分|相手)のターンのはじめまで|次の相手のターンの終わりまで)?、?相手のクリーチャーは、?可能(?:であれば|なら(?:ば)?)、?このクリーチャーを攻撃する$/);
    if (lu) return [{ op: 'grant', target: { ref: 'self' }, kws: ['挑発'], until: lu[1] === 'このターン' ? 'turn' : 'nextOwnTurn' }];
  }
  // 自分と相手のクリーチャーを1体ずつ選び、バトルさせる
  {
    const pb = s.match(/^自分と相手のクリーチャーを1体(?:まで)?(選び、(?:その2体を)?バトルさせる|選ぶ)$/);
    if (pb) {
      const own: Op = { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' }, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: '自分のクリーチャーを1体選ぶ' };
      const opp: Op = { op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature' }, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'hostile', prompt: '相手のクリーチャーを1体選ぶ' };
      ctx.chosen = true;
      return pb[1].startsWith('選び') ? [own, { op: 'save' }, opp, { op: 'battle', a: { ref: 'saved' }, b: { ref: 'it' } }] : [own, { op: 'save' }, opp];
    }
  }
  if (/^(その|それら)2体をバトルさせる$/.test(s)) return [{ op: 'battle', a: { ref: 'saved' }, b: { ref: 'it' } }];
  // 表向きにしたカードをすべて〜 / その中の〇〇をすべて手札に加え、それ以外を〜
  {
    const rv = s.match(/^表向きにしたカードを(?:すべて)?(?:自分の)?(マナゾーン|墓地|手札)に(?:置く|加える)$/);
    if (rv) return [{ op: 'move', target: { ref: 'it' }, to: rv[1] === '墓地' ? 'grave' : rv[1] === '手札' ? 'hand' : 'mana' }];
    const lh = s.match(/^その中(?:から|の)(.+?)を(?:すべて)、?(?:自分の)?手札に加え、(?:それ以外のカード|残り(?:のカード)?)を(?:好きな順序で)?(?:自分の)?(墓地に置く|山札の(?:一番)?下に(?:戻す|置く))$/);
    const sel = lh && parseSel(lh[1], { zones: ['deck'] });
    if (lh && sel)
      return [
        { op: 'choose', target: { ref: 'looked', sel, count: { all: true } }, purpose: 'benefit', prompt: s0 },
        { op: 'move', target: { ref: 'it' }, to: 'hand' },
        { op: 'move', target: { ref: 'rest' }, to: /墓地/.test(lh[2]) ? 'grave' : 'deckBottom' },
      ];
    // 「その中の〇〇をすべて、タップしてマナゾーンに置き、それ以外のカードを墓地に置く」
    const lm = s.match(/^その中(?:から|の)(.+?)をすべて、?(タップして)?(?:自分の)?(マナゾーン|墓地|手札)に(?:置き|加え)、(?:それ以外のカード|残り(?:のカード)?)を(?:すべて)?(?:好きな順序で)?(?:自分の)?(墓地に置く|山札の(?:一番)?下に(?:戻す|置く)|手札に加える)$/);
    const msel = lm && parseSel(lm[1], { zones: ['deck'] });
    if (lm && msel)
      return [
        { op: 'choose', target: { ref: 'looked', sel: msel, count: { all: true } }, purpose: 'benefit', prompt: s0 },
        { op: 'move', target: { ref: 'it' }, to: lm[3] === '手札' ? 'hand' : lm[3] === '墓地' ? 'grave' : lm[2] ? 'manaTapped' : 'mana' },
        { op: 'move', target: { ref: 'rest' }, to: /墓地/.test(lm[4]) ? 'grave' : /手札/.test(lm[4]) ? 'hand' : 'deckBottom' },
      ];
    if (/^(?:その後、)?同じ枚数のカードを引く$/.test(s)) return [{ op: 'drawItPlus', plus: 0 }];
    const kd = s.match(/^こうして(?:破壊した|捨てた|墓地に置いた)(?:クリーチャー|カード)(\d+)(?:体|枚)につき、?(?:カードを)?(\d+)枚(?:、カードを)?引く$/);
    if (kd) return [{ op: 'drawItPlus', plus: 0, mult: +kd[2] / +kd[1] }];
    const bs = s.match(/^そのうちの(\d+)(?:枚|つ)をブレイクする$/);
    if (bs) return [{ op: 'breakShield', n: +bs[1] }];
  }
  // 「プレイヤーを一人選ぶ」(相手を選ぶものとして扱う)
  if (/^プレイヤーを(一人|ひとり|1人)選ぶ$/.test(s)) return [{ op: 'note', text: '相手を選んだ' }];
  // 「それが〇〇なら手札に加え、それ以外なら山札の一番下に置く」(1文の中の else)
  {
    const ie = s.match(/^(.+?)(?:なら|であれば)、?(.+?)、それ以外なら、?(.+)$/);
    if (ie) {
      const cond = parseCond(ie[1]);
      const term = (v: string) => v.replace(/加え$/, '加える').replace(/置き$/, '置く').replace(/戻し$/, '戻す').replace(/出し$/, '出す').replace(/唱え$/, '唱える');
      const body = cond && (sentence(term(ie[2]), ctx) ?? verbOps(term(ie[2]), { ref: 'it' }));
      const els = cond && (sentence(ie[3], ctx) ?? verbOps(ie[3], { ref: 'it' }));
      if (cond && body && els) return [{ op: 'if', cond, body, else: els }];
    }
  }
  if (/^(その後、)?(それ|そのシールド|それら)を(好きな順序で)?(元の場所に|元に)戻す$/.test(s)) return [];
  if (/^ただし、?その(シールドの)?「S・トリガー」(能力)?は使えない$/.test(s)) return [];
  // 「そのうちのN枚を〇〇に置き、もうN枚を〇〇に」
  {
    const two = s.match(/^(?:その中から|そのうちの)(\d+)枚を(.+?)(?:に置き|に加え|化し|に)、もう(\d+)枚を(.+)$/);
    if (two) {
      const d1 = two[2].replace(/^(自分の)?/, '');
      const v1 = /シールド/.test(d1) ? 'シールド化する' : /手札/.test(d1) ? '手札に加える' : /墓地/.test(d1) ? '墓地に置く' : /マナ/.test(d1) ? 'マナゾーンに置く' : '';
      const ops1 = v1 ? verbOps(v1, { ref: 'it' }) : null;
      const ops2 = verbOps(two[4].replace(/^(自分の)?/, ''), { ref: 'it' }) ?? verbOps(two[4] + 'に置く', { ref: 'it' });
      if (ops1 && ops2) {
        const rest: Sel = { owner: 'any', zones: ['deck'], kind: 'card' };
        return [
          { op: 'choose', target: { ref: 'looked', sel: rest, count: { n: +two[1], upTo: false } }, purpose: 'benefit', prompt: s0 },
          ...ops1,
          { op: 'choose', target: { ref: 'looked', sel: rest, count: { n: +two[3], upTo: false } }, purpose: 'benefit', prompt: s0 },
          ...ops2,
        ];
      }
    }
  }
  {
    const nb = s.match(/^このターン、(.+?)(\d+)体はブロックされない$/);
    const sel = nb && parseSel(nb[1]);
    if (nb && sel)
      return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +nb[2], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: s0 }, { op: 'grant', target: { ref: 'it' }, kws: ['ブロックされない'], until: 'turn' }];
    if (/^相手は(?:自身|自分)の手札を見せ、その中の呪文をすべて捨てる$/.test(s))
      return [{ op: 'move', target: { ref: 'sel', sel: { owner: 'opp', zones: ['hand'], kind: 'spell' }, count: { all: true }, chooser: 'self' }, to: 'grave' }];
    const ot = s.match(/^相手の山札の上から(\d+)枚(?:目)?を見る$/);
    if (ot) {
      ctx.looked = true;
      return [{ op: 'top', n: +ot[1], to: 'look', who: 'opp' }];
    }
  }
  {
    const sg = s.match(/^裏向きのまま(\d+)枚選び、(?:自分の)?(墓地に置く|手札に加える)$/);
    if (sg)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['shield'], kind: 'card' }, count: { n: +sg[1], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: '自分のシールドを選ぶ' },
        { op: 'move', target: { ref: 'it' }, to: /墓地/.test(sg[2]) ? 'grave' : 'hand' },
      ];
  }
  // 自分のマナゾーン/手札/墓地から選んで〜
  {
    const zc = s.match(/^自分の(マナゾーン|手札|墓地)から(?:(.+?)を)?(\d+)枚(まで)?選び、(.+)$/) ?? s.match(/^自分の(マナゾーン|手札|墓地)から(?:(.+?)を)?(好きな)(?:枚)?数(?:の(?:カード|クリーチャー))?を?選び、(.+)$/);
    if (zc) {
      const zone = zc[1] === 'マナゾーン' ? 'mana' : zc[1] === '手札' ? 'hand' : 'grave';
      const sel: Sel | null = zc[2] ? parseSel(zc[2], { zones: [zone] }) : { owner: 'self', zones: [zone], kind: 'card' };
      const rest = zc[zc.length - 1];
      const ops = verbOps(rest, { ref: 'it' });
      if (sel && ops) {
        sel.owner = 'self';
        sel.zones = [zone];
        if (sel.kind === 'creature' && zc[2] && /カード$/.test(zc[2])) sel.kind = 'card';
        const count: Count = zc[3] === '好きな' ? { n: 99, upTo: true } : { n: +zc[3], upTo: !!zc[4] };
        return [{ op: 'choose', target: { ref: 'sel', sel, count, chooser: 'self' }, purpose: purposeOf(sel, rest), prompt: s0 }, ...ops];
      }
    }
    // 「相手は自身の〇〇すべてを〜」「各プレイヤーは〜すべてを、それぞれの墓地に置く」
    const ae = s.match(/^(相手|各プレイヤー)は、?(?:バトルゾーンにある)?(?:自身の)?(.+?)すべてを、?(?:それぞれの|持ち主の)?(墓地|手札|マナゾーン)に(置く|戻す|加える)$/);
    if (ae) {
      const sel = parseSel(ae[1] === '相手' ? `相手の${ae[2]}` : ae[2]);
      if (sel) return [{ op: 'move', target: { ref: 'sel', sel, count: { all: true }, chooser: 'self' }, to: ae[3] === '墓地' ? 'grave' : ae[3] === '手札' ? 'hand' : 'mana' }];
    }
    if (/^この呪文を、?自分の墓地ではなく(自分の)?マナゾーンに置く$/.test(s)) return [];
  }
  // 手札を捨てて、その枚数よりN枚多く引く
  {
    const dd = s.match(/^自分の手札を(\d+)枚まで捨て、その枚数より(\d+)枚多くカードを引く$/);
    if (dd)
      return [
        { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['hand'], kind: 'card' }, count: { n: +dd[1], upTo: true }, chooser: 'self' }, purpose: 'sacrifice', prompt: '捨てる手札を選ぶ' },
        { op: 'move', target: { ref: 'it' }, to: 'grave' },
        { op: 'drawItPlus', plus: +dd[2] },
      ];
    if (/^(その後、)?それらを好きな順序で(山札の上に)?戻す$/.test(s)) return [{ op: 'note', text: '好きな順序で戻した' }];
    // 「このターン、そのクリーチャーの最初の(次の)攻撃の終わりに、そのクリーチャーをアンタップする」
    const au = s.match(/^このターン、(この|その)クリーチャーの(?:最初|次)の攻撃の終わりに、(?:この|その)クリーチャーをアンタップする$/);
    if (au) return [{ op: 'grant', target: { ref: au[1] === 'この' ? 'self' : 'it' }, kws: ['攻撃後アンタップ'], until: 'turn' }];
  }
  // 「このターン、自分のクリーチャーが攻撃する時、〜」: このターンだけの誘発型能力
  {
    const tt = s.match(/^このターン、(自分のクリーチャーが攻撃する|相手のクリーチャーが破壊された|自分がクリーチャーを召喚した|自分のクリーチャーを召喚した|自分が呪文を唱えた|自分のシールドがブレイクされた|自分のクリーチャーが(?:相手の)?シールドをブレイクする)(?:時|たび|たびに)、(.+)$/);
    if (tt) {
      const EV = { 自分のクリーチャーが攻撃する: 'ownAttack', 相手のクリーチャーが破壊された: 'oppDestroyed', 自分がクリーチャーを召喚した: 'otherOwnEnter', 自分のクリーチャーを召喚した: 'otherOwnEnter', 自分が呪文を唱えた: 'spellOwn', 自分のシールドがブレイクされた: 'ownShieldBroken' } as Record<string, 'ownAttack' | 'oppDestroyed' | 'otherOwnEnter' | 'spellOwn' | 'ownShieldBroken' | 'oppShieldBroken'>;
      if (/^自分のクリーチャーが/.test(tt[1]) && /ブレイクする$/.test(tt[1])) EV[tt[1]] = 'oppShieldBroken';
      // 「〜てもよい」は効果の中で聞く
      if (parseEffect(tt[2]).complete) return [{ op: 'tempTrigger', event: EV[tt[1] as keyof typeof EV], effect: tt[2], optional: false }];
    }
  }
  // 「〇〇を合計N体まで、自分の手札、マナゾーン、または墓地から出す」
  {
    const mz = s.match(/^(.+?)を(?:合計)?(\d+)(体|枚)(まで)?、自分の((?:(?:手札|マナゾーン|墓地|山札)(?:、|または|、または)?){2,})から(.+)$/);
    if (mz) {
      const zones = [...mz[5].matchAll(/手札|マナゾーン|墓地|山札/g)].map((x) => ZONE[x[0]]);
      const sel = parseSel(mz[1], { zones });
      const ops = sel && verbOps(mz[6], { ref: 'it' });
      if (sel && ops) {
        sel.zones = zones;
        sel.owner = 'self';
        return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +mz[2], upTo: !!mz[4] }, chooser: 'self' }, purpose: 'benefit', prompt: s0 }, ...ops];
      }
    }
  }
  // ハイパーモードを解放する
  {
    const hm = s.match(/^次の自分のターンのはじめまで、(このクリーチャー|自分の(.+?)(\d+)体)のハイパーモードを解放する$/);
    if (hm && !hm[2]) return [{ op: 'hyperMode', target: { ref: 'self' } }];
    const sel = hm?.[2] ? parseSel('自分の' + hm[2]) : null;
    if (hm && sel)
      return [
        { op: 'choose', target: { ref: 'sel', sel, count: { n: +hm[3], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: 'ハイパーモードを解放するクリーチャーを選ぶ' },
        { op: 'hyperMode', target: { ref: 'it' } },
      ];
  }
  // 次の自分のターンのはじめに
  {
    const ts = s.match(/^次の自分のターンのはじめに、(.+)$/);
    const body = ts && sentence(ts[1], ctx);
    if (body) return [{ op: 'atNextTurnStart', body }];
  }
  // ターンの終わりに
  {
    const te = s.match(/^(?:この|その)ターンの終わりに、?(.+)$/);
    if (te) {
      const body = sentence(te[1], ctx);
      if (body) return [{ op: 'atTurnEnd', body }];
    }
  }
  // N体につきN枚引く
  {
    const dp = s.match(/^(?:バトルゾーンにある)?(自分|相手)の(.+?)(\d+)体につき、?(?:カードを)?(\d+)枚(?:、カードを)?引く$/);
    const sel = dp && parseSel(`${dp[1]}の${dp[2]}`);
    if (dp && sel) return [{ op: 'drawPer', sel, each: +dp[3], mult: +dp[4] }];
  }
  // コストの下限 (直前の軽減の注記)
  if (/^ただし、?コストは\d+(以下に(は)?ならない|より少なくならない)$/.test(s)) return [];
  // D・D・D など 「このカードを [ll02] 支払って自分の手札から実行してもよい」
  {
    const pp = s.match(/^このカードを\[[a-z]*(\d+)\]支払って(?:自分の手札から)?(?:実行|召喚|使用)する$/);
    if (pp) return [{ op: 'payPlay', cost: +pp[1] }];
  }
  // Jチェンジ 「このクリーチャーと自分のマナゾーンにあるコスト5以下のジョーカーズ1体を入れ替える」
  {
    const sw = s.match(/^(?:このクリーチャー|これ)と自分の(マナゾーン|墓地)にある(.+?)(\d+)体を入れ替える$/);
    if (sw) {
      const sel = parseSel(sw[2], { zones: [sw[1] === '墓地' ? 'grave' : 'mana'] });
      if (sel) {
        sel.owner = 'self';
        sel.zones = [sw[1] === '墓地' ? 'grave' : 'mana'];
        return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +sw[3], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: s0 }, { op: 'swap' }];
      }
    }
  }
  // 表向きにした/残りのカードを山札の下へ
  if (/^(表向きにした|残りの|見た)カードをすべて、?(好きな順序で)?(自分の)?山札の(一番)?下に(戻す|置く)$/.test(s)) return [{ op: 'move', target: { ref: 'rest' }, to: 'deckBottom' }];

  // スリリング・スリー 「表向きにしたXまたはY1体につき、次の能力を1回行う」
  {
    const tt = s.match(/^表向きにした(.+?)(\d+)体につき、次の能力を(\d+)回行う$/);
    const sel = tt && parseSel(tt[1], { zones: ['deck'] });
    if (tt && sel) return [{ op: 'useMarked', key: '能力', perLooked: sel }];
  }
  if (/^(?:この)?ターンの残りをとばす$/.test(s)) return [{ op: 'skipTurn' }];
  if (/^相手は自身の手札を見せる$/.test(s)) return [];
  // このターン、次に召喚する〇〇のコストを最大N少なくする / マナゾーンから召喚できる / 相手プレイヤーを攻撃できる / バトルに勝った時アンタップ
  {
    const ns = s.match(/^このターン、次に(?:自分が)?召喚する(自分の)?(.+?)の(?:召喚)?コストを(?:最大)?(\d+)少なくする(?:、出た時「(.+)」を与える)?$/);
    const sel = ns && parseSel(ns[2], { zones: ['hand'] });
    if (ns && sel) return [{ op: 'nextSummonDiscount', sel: { ...sel, kind: 'creature', zones: ['hand', 'mana', 'grave'] }, n: +ns[3], ...(ns[4] ? { grants: ns[4].split('」と「') } : {}) }];
    const ms = s.match(/^このターン、クリーチャーを(\d+)体、自分のマナゾーンから召喚(?:する|してもよい)$/);
    if (ms) return [{ op: 'manaSummon', n: +ms[1] }];
    const ap = s.match(/^このターン、(この|その)クリーチャーは相手プレイヤーを攻撃できる$/);
    if (ap) return [{ op: 'grant', target: { ref: ap[1] === 'この' ? 'self' : 'it' }, kws: ['プレイヤー攻撃可'], until: 'turn' }];
    const wu = s.match(/^このターン、(この|その)クリーチャーがバトルに勝った時、アンタップする$/);
    if (wu) return [{ op: 'grant', target: { ref: wu[1] === 'この' ? 'self' : 'it' }, kws: ['バトル勝利後アンタップ'], until: 'turn' }];
  }
  if (/^\*+$/.test(s)) return [];
  if (/^この能力は、?各ターン(1|一)度しか使えない$/.test(s)) return [];
  // シールド・山札を見る
  {
    const ps = s.match(/^(自分|相手)のシールドを(\d+|すべて)(?:つ|枚)?(?:選んで)?見る$/) ?? s.match(/^(自分|相手)のシールドを(ひとつ|1つ)選んで見る$/);
    if (ps) {
      ctx.looked = true;
      return [{ op: 'peek', who: ps[1] === '自分' ? 'self' : 'opp', zone: 'shield', n: /\d/.test(ps[2]) ? +ps[2] : ps[2] === 'すべて' ? undefined : 1 }];
    }
    if (/^相手の山札を見る$/.test(s)) {
      ctx.looked = true;
      return [{ op: 'peek', who: 'opp', zone: 'deck' }];
    }
  }
  // パワーをN倍 / N枚につきパワー±N
  {
    const mp = s.match(/^このターン、(.+?)のパワーを(\d+)倍に(?:し、((?:「[^」]+」)+)を与える|する)$/);
    const t = mp && refTarget(mp[1]);
    if (mp && t) {
      const ops: Op[] = [{ op: 'multPower', target: t, times: +mp[2] }];
      if (mp[3]) ops.push({ op: 'grant', target: t, kws: [...mp[3].matchAll(/「([^」]+)」/g)].map((x) => x[1]), until: 'turn' });
      return ops;
    }
    const pp = s.match(/^このターン、(.+?)のパワーを、?(.+?)(\d+)(?:枚|体)につき([+-]\d+)する$/) ?? s.match(/^このターン、(.+?)(\d+)(?:枚|体)につき、(.+?)のパワーを([+-]\d+)する$/);
    if (pp) {
      const isFirst = /のパワーを/.test(s.split('につき')[0]);
      const tgt = refTarget(isFirst ? pp[1] : pp[3]);
      const perPhrase = isFirst ? pp[2] : pp[1];
      const each = +(isFirst ? pp[3] : pp[2]);
      const pz = perPhrase.match(/^(自分|相手)の(墓地|マナゾーン|手札)にある(.+)$/);
      const per = pz ? parseSel(pz[3], { zones: [ZONE[pz[2]]] }) : parseSel(perPhrase);
      if (per && pz) {
        per.owner = pz[1] === '自分' ? 'self' : 'opp';
        per.zones = [ZONE[pz[2]]];
        if (per.kind === 'creature' && /カード$/.test(pz[3])) per.kind = 'card';
      }
      if (tgt && per) return [{ op: 'powerPer', target: tgt, per, each, delta: +pp[4] }];
    }
  }
  // ガチャ 「ドギラゴン・ガチャを3度回す」「もう1度ドキンダム・ガチャを回して、その能力を使う」
  {
    const ga = s.match(/^(?:もう)?(\d+)?度?(ドギラゴン|ドキンダム)・ガチャを(?:(\d+)度)?回(?:す|して、その能力を使う)$/);
    if (ga) return [{ op: 'gacha', kind: ga[2] === 'ドギラゴン' ? 'dogiragon' : 'dokindam', times: +(ga[3] ?? ga[1] ?? 1) }];
    if (/^回すたびに、その能力を使う$/.test(s)) return [];
  }
  {
    const me = s.match(/^(相手|自分)は?(?:自身|自分)?の山札を一番下の(\d+)枚を残してすべて墓地に置く$/) ?? s.match(/^(相手)は(?:自身|自分)の山札を一番下の(\d+)枚を残してすべて墓地に置く$/);
    if (me) return [{ op: 'millExcept', who: me[1] === '相手' ? 'opp' : 'self', keep: +me[2] }];
    const gs = s.match(/^(相手|自分)は?、?(?:自身|自分)?の墓地をシャッフルし、(?:自身の)?山札の(?:一番)?下に置く$/);
    if (gs) return [{ op: 'move', target: { ref: 'sel', sel: { owner: gs[1] === '相手' ? 'opp' : 'self', zones: ['grave'], kind: 'card' }, count: { all: true }, chooser: 'self' }, to: 'deckBottom' }];
    const dp = s.match(/^(?:その後、)?その枚数より(\d+)枚多くカードを引く$/);
    if (dp) return [{ op: 'drawItPlus', plus: +dp[1] }];
  }
  // マーシャル・タッチ / 返霊 「そうした場合、このクリーチャーの能力を使う」
  if (/^このクリーチャーの能力を使う$/.test(s)) return [{ op: 'useMarked', key: '能力' }];
  // 跳次元召喚N
  {
    const jd = s.match(/^跳次元召喚(\d+)$/);
    if (jd) {
      const sel: Sel = { owner: 'self', zones: ['hyper'], kind: 'creature', costMax: +jd[1], civInMana: true };
      return [
        {
          op: 'optional',
          body: [
            { op: 'choose', target: { ref: 'sel', sel, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `コスト${jd[1]}以下のクリーチャーを超次元ゾーンから選ぶ` },
            { op: 'play', target: { ref: 'it' }, mode: 'summon' },
          ],
          prompt: `跳次元召喚${jd[1]}`,
        },
      ];
    }
  }
  // 記号つきの能力を使う 「このクリーチャーの q 能力を使ってもよい」「このクリーチャーと自分の他のクリーチャー1体の oP 能力を使う」
  {
    if (/^そのカードの文明に合うq能力を使(う|ってもよい)$/.test(s)) return [{ op: 'useMarked', key: 'q', byCiv: true }];
    const kc = s.match(/^(好きな数|(\d+)体)の自分のクリーチャーの(P|oP)能力を使う$/) ?? s.match(/^自分のクリーチャー(\d+)体の(P|oP)能力を使う$/);
    if (kc) return [{ op: 'useMarked', key: kc[3] ?? kc[2], others: kc[1] === '好きな数' ? 99 : +(kc[2] ?? kc[1]) }];
    const um = s.match(/^このクリーチャー(?:と自分の他のクリーチャー(\d+)体)?の(q|oP|oB|xB|P|◇)能力を(?:1回)?使(う|ってもよい)$/);
    if (um) {
      const op: Op = { op: 'useMarked', key: um[2], others: um[1] ? +um[1] : undefined };
      return um[3] === 'う' ? [op] : [{ op: 'optional', body: [op], prompt: s0 }];
    }
  }

  // 呪文を唱えられない
  {
    const lk = s.match(/^(このターン|次の自分のターンのはじめまで)、相手は(?:コスト(\d+)以下の|(〈数字コスト〉の))?呪文を唱えられない$/);
    const ls = s.match(/^(?:次の相手のターン|次の自分のターンのはじめまで)、相手はクリーチャーを召喚できず、呪文を唱えることも(?:でき|し)ない$/);
    if (ls) return [{ op: 'lockSummon' }, { op: 'lockSpells', until: 'nextOwnTurn' }];
    if (/^(?:次の相手のターン|次の自分のターンのはじめまで)、相手はクリーチャーを召喚できない$/.test(s)) return [{ op: 'lockSummon' }];
    if (lk) return [{ op: 'lockSpells', until: lk[1] === 'このターン' ? 'turn' : 'nextOwnTurn', costMax: lk[2] ? +lk[2] : undefined, costRef: lk[3] ? true : undefined }];
    // 「相手は〈数字コスト〉の呪文を唱えられず、〈数字コスト〉の相手のクリーチャーは攻撃もブロックもできない」
    const lk2 = s.match(/^次の自分のターンのはじめまで、相手は〈数字コスト〉の呪文を唱えられず、(?:同じコストを持つ|〈数字コスト〉の)相手のクリーチャーは(?:すべて、?)?攻撃もブロックもできない$/);
    if (lk2)
      return [
        { op: 'lockSpells', until: 'nextOwnTurn', costRef: true },
        { op: 'restrict', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature', costRef: true }, count: { all: true }, chooser: 'self' }, what: 'attackBlock' },
      ];
    const rs = s.match(/^次の自分のターンのはじめまで、〈数字コスト〉の相手のクリーチャーは(?:すべて、?)?攻撃もブロックもできない$/);
    if (rs) return [{ op: 'restrict', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature', costRef: true }, count: { all: true }, chooser: 'self' }, what: 'attackBlock' }];
  }

  // 「このターン、そのクリーチャーのパワーを+2000し、「ブロッカー」を与える」: パワーと残りの効果に分ける
  {
    const pc = s.match(/^(このターン|次の自分のターンのはじめまで)、(.+?)のパワー(?:を|は)([+-]\d+)(?:し|され)、(.+)$/);
    if (pc) {
      const head = sentence(`${pc[1]}、${pc[2]}のパワーを${pc[3]}する`, ctx);
      const who = head?.some((o) => o.op === 'choose') ? 'そのクリーチャー' : pc[2];
      const rest = pc[4];
      const tail = sentence(`${pc[1]}、${who}${/^「.+を与える$/.test(rest) ? 'に' : 'は'}${rest}`, ctx);
      if (head && tail) return [...head, ...tail];
    }
  }
  // 次の自分のターンのはじめまでのパワー修正 (一時的な能力として持たせる)
  {
    const np = s.match(/^次の自分のターンのはじめまで、(.+?)のパワーを([+-]\d+)する$/);
    const t = np && refTarget(np[1]);
    if (np && t) return [{ op: 'grant', target: t, kws: [`パワー${np[2]}`], until: 'nextOwnTurn' }];
  }

  // 効果ではない注記・別の仕組みで処理するもの
  if (/^(ただし、)?その「S・トリガー」は使えない$/.test(s)) return [];
  if (/^(この呪文を(自分の手札から)?唱えた後、)?墓地(に置く)?のかわりに/.test(s) || /^(この呪文を(自分の手札から)?唱えた後、)?墓地に置くかわりに/.test(s)) return [];

  // ガチンコ・ジャッジ
  if (/^相手とガチンコ・ジャッジする$/.test(s)) return [{ op: 'gachinko' }];
  if (/^相手とパワー・ガチンコ・ジャッジする$/.test(s)) return [{ op: 'gachinko', power: true }];
  if (/^相手(プレイヤー)?とジャンケン(して|で|をして)勝敗を決める$/.test(s)) return [{ op: 'janken' }];
  {
    const gl = s.match(/^(?:自分が負けるか中止するまで、)?相手と(?:(\d+)回)?(パワー・)?ガチンコ・ジャッジする$/);
    if (gl && (gl[1] || /負けるか/.test(s))) return [{ op: 'gachinkoLoop', power: !!gl[2], times: gl[1] ? +gl[1] : undefined }];
    const each = s.match(/^こうして自分が(?:ガチンコ・ジャッジに)?勝つたび、(.+)$/) ?? s.match(/^こうして(?:自分が)?(?:ガチンコ・ジャッジに)?勝った(?:数|回数)、(.+)$/);
    if (each) {
      const body = sentence(each[1].replace(/^そのターン、/, 'このターン、'), ctx);
      if (body) return [{ op: 'repeatWins', body }];
    }
  }
  if (/^相手の手札を見る$/.test(s)) {
    ctx.looked = true;
    return [{ op: 'lookHand', who: 'opp' }];
  }

  // キーワードを与える 「このターン、そのクリーチャーに「スピードアタッカー」を与える」
  {
    const g = s.match(/^(このターン|次の自分のターンのはじめまで)、(.+?)(?:に|は)((?:「[^」]+」(?:と|、)?)+)を(与える|得る)$/);
    if (g) {
      const kws = [...g[3].matchAll(/「([^」]+)」/g)].map((x) => x[1]);
      const until = g[1] === 'このターン' ? 'turn' : 'nextOwnTurn';
      const t = refTarget(g[2]);
      if (t) return [{ op: 'grant', target: t, kws, until }];
      const cm = g[2].match(new RegExp(`^(.+?)${N}体$`));
      if (cm) {
        const sel = parseSel(cm[1]);
        if (sel)
          return [
            { op: 'choose', target: { ref: 'sel', sel, count: { n: +cm[2], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `${cm[1]}を${cm[2]}体選ぶ` },
            { op: 'grant', target: { ref: 'it' }, kws, until },
          ];
      }
    }
    const b = s.match(/^このターン、(.+?)はブロックされない$/);
    if (b) {
      const t = refTarget(b[1]);
      if (t) return [{ op: 'grant', target: t, kws: ['ブロックされない'], until: 'turn' }];
    }
  }

  // そうしたら / そうした場合 / そうしなければ
  let m = s.match(/^(そうしたら|そうした場合|そうすれば)、(.+)$/);
  if (m) {
    const body = sentence(m[2], ctx);
    return body ? [{ op: 'if', cond: { c: 'did' }, body }] : null;
  }
  m = s.match(/^(そうしなかった場合|そうしなければ)、(.+)$/);
  if (m) {
    const body = sentence(m[2], ctx);
    return body ? [{ op: 'if', cond: { c: 'did' }, body: [], else: body }] : null;
  }

  // 条件 「〜あれば、」「〜なら、」
  m = s.match(/^(?:もし)?(.+?)(?:れば|ならば|なら|であれば)、(.+)$/) ?? s.match(/^(?:もし)?(それが.+?)(?:ならば|なら|であれば)(.+)$/);
  if (m) {
    const cond = parseCond(m[1]);
    if (cond) {
      const body = sentence(m[2], ctx);
      return body ? [{ op: 'if', cond, body }] : null;
    }
  }

  // 任意 「〜てもよい」 (「選んでもよい」は「まで」扱い)
  if (/選んでもよい$/.test(s)) {
    const r = sentence(s.replace(/選んでもよい$/, 'まで選ぶ').replace(/(\d+)(体|枚|つ)まで/, '$1$2まで'), ctx);
    if (r) return r;
  }
  const opt = unOptional(s);
  if (opt != null && opt !== s) {
    const body = sentence(opt, ctx);
    // 「相手は〜してもよい」は相手が決める
    return body ? [{ op: 'optional', body, prompt: s0, byOpp: /^(?:その後、)?相手は/.test(s0) || undefined }] : null;
  }

  // 連用形で続く複文 「カードを1枚引き、自分の手札を1枚捨てる」
  const comp = s.match(/^(.+?(?:引き|置き|戻し|加え|出し|破壊し|捨て|唱え|タップし|アンタップし|シャッフルし|見せ|表向きにし))、(.+)$/);
  if (comp && !/選び$/.test(comp[1]) && !/^相手に見せ/.test(comp[2])) {
    const first = comp[1]
      .replace(/引き$/, '引く')
      .replace(/置き$/, '置く')
      .replace(/戻し$/, '戻す')
      .replace(/加え$/, '加える')
      .replace(/出し$/, '出す')
      .replace(/捨て$/, '捨てる')
      .replace(/唱え$/, '唱える')
      .replace(/見せ$/, '見せる')
      .replace(/(破壊|タップ|アンタップ|シャッフル|表向きに)し$/, '$1する');
    const a = sentence(first, ctx);
    const b = a && sentence(comp[2], ctx);
    if (a && b) return [...a, ...b];
  }

  // ---- メクレイド 「アビス・メクレイド5する」 ----
  if ((m = s.match(/^(?:(.+?)・)?メクレイド(\d+)する$/))) {
    const sel: Sel = { owner: 'self', zones: ['deck'], kind: 'element', costMax: +m[2], ...(m[1] ? { races: [m[1]] } : {}) };
    return [
      { op: 'top', n: 3, to: 'look', who: 'self' },
      { op: 'choose', target: { ref: 'looked', sel, count: { n: 1, upTo: true } }, purpose: 'benefit', prompt: `コスト${m[2]}以下の${m[1] ?? ''}を1枚まで選んでコストを支払わずに使う` },
      { op: 'play', target: { ref: 'it' }, mode: 'use' },
      { op: 'move', target: { ref: 'rest' }, to: 'deckBottom' },
    ];
  }

  // ---- 手札を山札に戻してシャッフル ----
  if (/^自分の手札をすべて山札に加えてシャッフルする$/.test(s)) return [{ op: 'handToDeck' }, { op: 'shuffle' }];
  if ((m = s.match(new RegExp(`^自分の手札をすべて山札に加えてシャッフルし、カードを${N}枚引く$`)))) return [{ op: 'handToDeck' }, { op: 'shuffle' }, { op: 'draw', n: +m[1], who: 'self' }];
  if ((m = s.match(new RegExp(`^自分の手札を${N}枚、?相手に見ないで選ばせ、捨てる$`)))) return [{ op: 'discard', who: 'self', count: { n: +m[1], upTo: false }, how: 'random' }];

  // ---- 永続的にキーワードを与える 「そのクリーチャーに「SA」を与える」「そのクリーチャーは「SA」を得る」 ----
  {
    const g = s.match(/^(.+?)(?:に|は)((?:「[^」]+」(?:と|、)?)+)を(与える|得る)$/);
    if (g) {
      const t = refTarget(g[1]);
      if (t) return [{ op: 'grant', target: t, kws: [...g[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]), until: 'perm' }];
    }
  }
  if (/^そのクリーチャー同士をバトルさせる$/.test(s)) return [{ op: 'battle', a: { ref: 'it' }, b: { ref: 'it' } }];

  // ---- 各プレイヤー (続き) ----
  if ((m = s.match(new RegExp(`^各プレイヤーは(?:自身の)?手札を${N}枚選んで捨てる$`))))
    return [
      { op: 'discard', who: 'self', count: { n: +m[1], upTo: false }, how: 'choose' },
      { op: 'discard', who: 'opp', count: { n: +m[1], upTo: false }, how: 'ownerChooses' },
    ];
  if ((m = s.match(new RegExp(`^各プレイヤーは(?:自身の)?(.+?)を${N}${COUNT_UNIT}選び、(.+)$`)))) {
    const selA = parseSel('自分の' + m[1]);
    const selB = parseSel('相手の' + m[1]);
    const opsA = verbOps(m[3], { ref: 'it' });
    if (selA && selB && opsA)
      return [
        { op: 'choose', target: { ref: 'sel', sel: selA, count: { n: +m[2], upTo: false }, chooser: 'self' }, purpose: 'sacrifice', prompt: `自分の${m[1]}を${m[2]}選ぶ` },
        ...opsA,
        { op: 'choose', target: { ref: 'sel', sel: selB, count: { n: +m[2], upTo: false }, chooser: 'opp' }, purpose: 'sacrifice', prompt: `${m[1]}を${m[2]}選ぶ` },
        ...opsA,
      ];
  }
  if ((m = s.match(new RegExp(`^各プレイヤーは、?(?:自身の)?山札の上から${N}枚を(墓地|マナゾーン)に置く$`)))) {
    const to: Dest = m[2] === '墓地' ? 'grave' : 'mana';
    return [
      { op: 'top', n: +m[1], to, who: 'self' },
      { op: 'top', n: +m[1], to, who: 'opp' },
    ];
  }
  if ((m = s.match(new RegExp(`^各プレイヤーは(?:それぞれ)?(?:カードを${N}枚|${N}枚カードを)引く$`)))) {
    const n = +(m[1] ?? m[2]);
    return [
      { op: 'draw', n, who: 'self' },
      { op: 'draw', n, who: 'opp' },
    ];
  }

  // ---- このカードの呪文側を唱える ----
  if (/^この(カード|クリーチャー)の呪文側を、?(バトルゾーンに置いたまま)?、?コストを支払わずに唱える$/.test(s)) return [{ op: 'castSelfSpell' }];

  // ---- 〜が出るまで山札を表向きにする ----
  if ((m = s.match(/^(?:自分の)?山札の上から、?(.+?)が出るまで(?:カードを)?表向きにする$/))) {
    const sel = parseSel(m[1], { zones: ['deck'] });
    if (sel) {
      ctx.looked = true;
      return [{ op: 'revealUntil', sel }];
    }
  }
  if (/^(その後、)?(その)?(相手)?クリーチャーとバトルする$/.test(s) || /^(その後、)?(その選んだ|選んだ)クリーチャーとバトルする$/.test(s))
    return [{ op: 'battle', a: { ref: 'self' }, b: { ref: 'it' } }];

  // ---- 攻撃・バトルの後 ----
  if ((m = s.match(/^(?:その)?(?:攻撃|バトル)の後、(.+)$/))) {
    const body = sentence(m[1], ctx);
    if (body) return [{ op: 'afterAttack', body }];
  }

  // ---- このクリーチャーの下にあるカード ----
  if ((m = s.match(new RegExp(`^このクリーチャーの下にあるカードを(?:${N}枚(まで)?|すべて)、?(?:選び、?)?(.+)$`)))) {
    const cnt: Count = m[1] ? { n: +m[1], upTo: !!m[2] } : { all: true };
    const ops = verbOps(m[3], { ref: 'it' });
    if (ops) return [{ op: 'choose', target: { ref: 'under', count: cnt }, purpose: 'neutral', prompt: '下にあるカードを選ぶ' }, ...ops];
  }

  // ---- 自分と相手のクリーチャーを1体ずつ選び、バトルさせる ----
  if (/^自分と相手のクリーチャーを1体ずつ選び、(その2体を)?バトルさせる$/.test(s)) {
    return [
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle'], kind: 'creature' }, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: '自分のクリーチャーを1体選ぶ' },
      { op: 'save' },
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'opp', zones: ['battle'], kind: 'creature' }, count: { n: 1, upTo: false }, chooser: 'self' }, purpose: 'hostile', prompt: '相手のクリーチャーを1体選ぶ' },
      { op: 'battle', a: { ref: 'saved' }, b: { ref: 'it' } },
    ];
  }

  // ---- 相手が行う 「相手は自身のクリーチャーを1体破壊する」「相手はそれを〜に置く」 ----
  if ((m = s.match(/^相手は(?:その|それ)(?:シールド|クリーチャー)?を、?(.+)$/))) {
    const ops = verbOps(m[1].replace(/^(自身|自分)の/, '持ち主の'), { ref: 'it' });
    if (ops) return ops;
  }
  if ((m = s.match(new RegExp(`^相手は(?:バトルゾーンにある)?(?:自身|自分)の(.+?)を${N}${COUNT_UNIT}(?:選び、)?(.+)$`)))) {
    // 「相手は自身の手札を1枚捨てる」は相手が選んで捨てる
    if (m[1] === '手札' && /^捨てる$/.test(m[3])) return [{ op: 'discard', who: 'opp', count: { n: +m[2], upTo: false }, how: 'ownerChooses' }];
    const t = selTarget('相手の' + m[1], m[2], undefined, false, 'opp');
    const ops = t && verbOps(m[3], { ref: 'it' });
    if (t && ops) return [{ op: 'choose', target: t, purpose: 'sacrifice', prompt: s0 }, ...ops];
  }
  if ((m = s.match(new RegExp(`^相手は(?:自身|自分)の(墓地|マナゾーン|手札)から(.+?)を${N}${COUNT_UNIT}選び、(.+)$`)))) {
    const sel = parseSel(m[2], { zones: [ZONE[m[1]]] });
    if (sel) {
      sel.owner = 'opp';
      sel.zones = [ZONE[m[1]]];
      if (sel.kind === 'creature' && /カード$/.test(m[2])) sel.kind = 'card';
      const ops = verbOps(m[4], { ref: 'it' });
      if (ops) return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: +m[3], upTo: false }, chooser: 'opp' }, purpose: 'sacrifice', prompt: s0 }, ...ops];
    }
  }

  // ---- 各プレイヤー ----
  if (/^各プレイヤーは(自身の)?手札をすべて捨てる$/.test(s))
    return [
      { op: 'discard', who: 'self', count: { all: true }, how: 'choose' },
      { op: 'discard', who: 'opp', count: { all: true }, how: 'random' },
    ];
  if ((m = s.match(new RegExp(`^各プレイヤーは(?:自身の)?手札を${N}枚選び、捨てる$`))))
    return [
      { op: 'discard', who: 'self', count: { n: +m[1], upTo: false }, how: 'choose' },
      { op: 'discard', who: 'opp', count: { n: +m[1], upTo: false }, how: 'ownerChooses' },
    ];

  // ---- 相手の手札を見て選ぶ ----
  if ((m = s.match(new RegExp(`^相手の手札を見て、?(?:その中から、?)?(?:(.+?)を)?${N}枚選(び|ぶ)、?(.*)$`)))) {
    ctx.looked = true;
    const sel = m[1] ? parseSel(m[1], { zones: ['hand'] }) : undefined;
    const rest = m[4] ? verbOps(m[4].replace(/^捨てさせる$/, '捨てる'), { ref: 'it' }) : [];
    if (rest && (!m[1] || sel))
      return [
        { op: 'lookHand', who: 'opp' },
        { op: 'choose', target: { ref: 'looked', sel: sel ?? undefined, count: { n: +m[2], upTo: false } }, purpose: 'hostile', prompt: '相手の手札から選ぶ' },
        ...rest,
      ];
  }

  // 「相手の手札を見て、その中から〇〇をすべて捨てさせる」
  if ((m = s.match(/^相手の手札を見て、?その中から(.+?)をすべて(?:選び出し、持ち主の墓地に置く|捨てさせる)$/))) {
    const sel = parseSel(m[1], { zones: ['hand'] });
    if (sel)
      return [
        { op: 'lookHand', who: 'opp' },
        { op: 'choose', target: { ref: 'looked', sel, count: { all: true } }, purpose: 'hostile', prompt: 'all' },
        { op: 'move', target: { ref: 'it' }, to: 'grave' },
      ];
  }
  // ---- 自分と相手を破壊 ----
  if (/^そのクリーチャーとこのクリーチャーを破壊する$/.test(s)) return [{ op: 'destroy', target: { ref: 'it' } }, { op: 'destroy', target: { ref: 'self' } }];

  // ---- シールドをブレイク (このクリーチャーは相手のシールドをNつブレイクする) ----
  if ((m = s.match(new RegExp(`^(?:この|その)クリーチャーは、?(?:相手の)?シールドを${N}(?:つ|枚)ブレイクする$`)))) return [{ op: 'breakShield', n: +m[1] }];
  if ((m = s.match(new RegExp(`^このクリーチャーは、?自分のシールドを${N}(?:つ|枚)ブレイクする$`)))) return [{ op: 'breakShield', n: +m[1], own: true }];

  // ---- カードを引く ----
  if ((m = s.match(new RegExp(`^カードを${N}枚(まで)?引く$`)))) return [{ op: 'draw', n: +m[1], upTo: !!m[2], who: 'self' }];
  if ((m = s.match(new RegExp(`^相手はカードを${N}枚引く$`)))) return [{ op: 'draw', n: +m[1], who: 'opp' }];
  if ((m = s.match(new RegExp(`^各プレイヤーはカードを${N}枚引く$`))))
    return [
      { op: 'draw', n: +m[1], who: 'self' },
      { op: 'draw', n: +m[1], who: 'opp' },
    ];

  // ---- 山札の上 ----
  s = s.replace(/^(自分の|相手の|自身の)?山札の上から(\d+)枚(目)?を、/, '$1山札の上から$2枚$3を');
  if ((m = s.match(/^相手は自身の山札の上から(\d+)枚(目)?を墓地に置く$/))) return [{ op: 'top', n: +m[1], to: 'grave', who: 'opp' }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚までを?(墓地|マナゾーン)に置く$`))))
    return [{ op: 'optional', prompt: s0, body: [{ op: 'top', n: +m[2], to: m[3] === '墓地' ? 'grave' : 'mana', who: 'self' }] }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を(見る|すべてのプレイヤーに見せる|表向きにする)$`)))) {
    ctx.looked = true;
    return [{ op: 'top', n: +m[2], to: m[4] === '見る' ? 'look' : 'reveal', who: 'self' }];
  }
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を裏向きのまま、?(新しい)?シールドとして(自分の)?シールドゾーンに(置く|加える)$`))))
    return [{ op: 'top', n: +m[2], to: 'shield', who: 'self' }];
  if ((m = s.match(new RegExp(`^(自分|相手)?の?山札の上から${N}枚(目)?を(タップして)?(自分の|持ち主の)?(マナゾーン|墓地)に置く$`)))) {
    // グループ: 1=誰の 2=枚数 3=目 4=タップして 5=自分の/持ち主の 6=置き場所
    const to: Dest = m[6] === '墓地' ? 'grave' : m[4] ? 'manaTapped' : 'mana';
    return [{ op: 'top', n: +m[2], to, who: m[1] === '相手' ? 'opp' : 'self', nth: !!m[3] }];
  }
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を、?(?:自分の)?(新しい)?(シールド|シールドゾーン)(に裏向きにして|に|として)?(加える|化する|置く)$`))))
    return [{ op: 'top', n: +m[2], to: 'shield', who: 'self' }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?をシールド化する$`)))) return [{ op: 'top', n: +m[2], to: 'shield', who: 'self' }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を(裏向きのまま|裏向きにして)、?(新しい)?(シールドとして)?(自分の)?(シールドゾーン|シールド)に(置く|加える)$`))))
    return [{ op: 'top', n: +m[2], to: 'shield', who: 'self' }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を(相手に見せてから|表向きにして)?手札に加える$`)))) return [{ op: 'top', n: +m[2], to: 'hand', who: 'self' }];
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚を見る$`)))) {
    ctx.looked = true;
    return [{ op: 'top', n: +m[2], to: 'look', who: 'self' }];
  }
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を(すべて)?表向きにする$`)))) {
    ctx.looked = true;
    return [{ op: 'top', n: +m[2], to: 'reveal', who: 'self' }];
  }
  if (/^自分の山札を見る$/.test(s)) {
    ctx.looked = true;
    return [{ op: 'lookDeck' }];
  }
  if (/^(その後、)?(自分の)?山札をシャッフルする$/.test(s)) return [{ op: 'shuffle' }];

  // ---- 見たカードから ----
  if ((m = s.match(new RegExp(`^(?:その中から|そのうち|その中の)、?(.+?)を${N}(?:体|枚)(まで)?選び、(.+)$`)))) {
    const sel = parseSel(m[1], { zones: ['deck', 'hand', 'grave', 'mana'] });
    const ops = sel && verbOps(m[4], { ref: 'it' });
    if (sel && ops)
      return [{ op: 'choose', target: { ref: 'looked', sel, count: count(m[2], m[3]) }, purpose: 'benefit', prompt: `${m[1]}を${m[2]}${/呪文|カード/.test(m[1]) ? '枚' : '体'}${m[3] ? 'まで' : ''}選ぶ` }, ...ops];
  }
  if ((m = s.match(new RegExp(`^(?:その中から|そのうち)、?(.+?)を${N}(?:体|枚)(まで)?、?(?:選び、?|選んで)?(.+)$`)))) {
    const sel = parseSel(m[1], { zones: ['deck', 'hand', 'grave', 'mana', 'shield'] });
    const ops = sel && verbOps(m[4], { ref: 'it' });
    if (sel && ops)
      return [{ op: 'choose', target: { ref: 'looked', sel, count: count(m[2], m[3]) }, purpose: 'benefit', prompt: `${m[1]}を${m[2]}${/呪文|カード/.test(m[1]) ? '枚' : '体'}${m[3] ? 'まで' : ''}選ぶ` }, ...ops];
  }
  if ((m = s.match(new RegExp(`^(?:その中から|そのうち)、?${N}(?:体|枚)(まで)?(?:選び、?|選んで)(.+)$`)))) {
    const ops = verbOps(m[3], { ref: 'it' });
    if (ops) return [{ op: 'choose', target: { ref: 'looked', count: count(m[1], m[2]) }, purpose: 'benefit', prompt: `${m[1]}枚選ぶ` }, ...ops];
  }
  if ((m = s.match(new RegExp(`^(?:その中から|そのうちの)${N}(?:体|枚)(まで)?を(.+)$`)))) {
    const ops = verbOps(m[3], { ref: 'it' });
    if (ops) return [{ op: 'choose', target: { ref: 'looked', count: count(m[1], m[2]) }, purpose: 'benefit', prompt: `${m[1]}枚選ぶ` }, ...ops];
  }
  if ((m = s.match(/^(?:その中から|その中の)、?(.+?)をすべて、?(.+)$/))) {
    const sel = parseSel(m[1], { zones: ['deck', 'hand', 'grave', 'mana'] });
    const ops = sel && verbOps(m[2], { ref: 'it' });
    if (sel && ops) return [{ op: 'choose', target: { ref: 'looked', sel, count: { all: true } }, purpose: 'benefit', prompt: 'all' }, ...ops];
  }
  if ((m = s.match(/^(?:残り(?:のカード)?|他の\d+枚|他のカード)を(?:すべて)?、?(?:好きな順(?:序)?で)?、?(.+)$/))) {
    const ops = verbOps(m[1].replace(/^(自分の)?山札の一番下/, '山札の下'), { ref: 'rest' });
    if (ops) return ops;
  }

  // ---- 手札を捨てる ----
  if ((m = s.match(new RegExp(`^相手は(?:自身の|自分の)?手札を${N}枚選(?:び|んで)、?捨てる$`))))
    return [{ op: 'discard', who: 'opp', count: count(m[1], undefined), how: 'ownerChooses' }];
  if ((m = s.match(new RegExp(`^相手の手札を(?:${N}枚)?見ないで(?:${N}枚)?選び、捨てさせる$`))))
    return [{ op: 'discard', who: 'opp', count: count(m[1] ?? m[2], undefined), how: 'random' }];
  if ((m = s.match(new RegExp(`^相手の手札を見て${N}枚選び、捨てさせる$`)))) return [{ op: 'discard', who: 'opp', count: count(m[1], undefined), how: 'choose' }];
  if (/^相手の手札をすべて捨てさせる$/.test(s) || /^相手は(自身の)?手札をすべて捨てる$/.test(s)) return [{ op: 'discard', who: 'opp', count: { all: true }, how: 'random' }];
  if ((m = s.match(new RegExp(`^自分の手札を${N}枚(まで)?捨てる$`)))) return [{ op: 'discard', who: 'self', count: count(m[1], m[2]), how: 'choose' }];
  if (/^自分の手札をすべて捨てる$/.test(s)) return [{ op: 'discard', who: 'self', count: { all: true }, how: 'choose' }];

  // ---- GR召喚・シールドブレイク ----
  if (/^GR召喚する$/.test(s)) return [{ op: 'grSummon', n: 1 }];
  if ((m = s.match(new RegExp(`^${N}回GR召喚する$`)))) return [{ op: 'grSummon', n: +m[1] }];
  if ((m = s.match(new RegExp(`^GR召喚を${N}回(する|行う)$`)))) return [{ op: 'grSummon', n: +m[1] }];
  if ((m = s.match(new RegExp(`^相手のシールドを${N}(?:つ|枚)(まで)?選び、ブレイクする$`)))) return [{ op: 'breakShield', n: +m[1] }];
  if ((m = s.match(new RegExp(`^相手のシールドを${N}(?:つ|枚)ブレイクする$`)))) return [{ op: 'breakShield', n: +m[1] }];

  // ---- パワー・制限 (このターン) ----
  s = s.replace(/、そのパワー(を|は)/, '、そのクリーチャーのパワー$1');
  if ((m = s.match(new RegExp(`^このターン、(.+?)${N}体のパワーを([+-])${N}する$`)))) {
    const sel = parseSel(m[1]);
    if (sel)
      return [
        { op: 'choose', target: { ref: 'sel', sel, count: { n: +m[2], upTo: false }, chooser: 'self' }, purpose: 'benefit', prompt: `${m[1]}を${m[2]}体選ぶ` },
        { op: 'power', target: { ref: 'it' }, delta: (m[3] === '-' ? -1 : 1) * +m[4], until: 'turn' },
      ];
  }
  if ((m = s.match(/^(?:この|その)ターン、(.+?)のパワーを([+-])(\d+)する$/)) || (m = s.match(/^(?:この|その)ターン、(.+?)のパワーは([+-])(\d+)される$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'power', target: t, delta: (m[2] === '-' ? -1 : 1) * +m[3], until: 'turn' }];
  }
  if ((m = s.match(/^(.+?)を([+-])(\d+)する$/)) && /パワー/.test(m[1])) {
    const t = refTarget(m[1].replace(/のパワー$/, ''));
    if (t) return [{ op: 'power', target: t, delta: (m[2] === '-' ? -1 : 1) * +m[3], until: 'turn' }];
  }
  if ((m = s.match(/^(?:次の(?:自分|相手)の)?ターンのはじめまで、(.+?)は攻撃もブロックもできない$/)) || (m = s.match(/^このターン、(.+?)は攻撃もブロックもできない$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'restrict', target: t, what: 'attackBlock' }];
  }
  if ((m = s.match(/^(?:次の(?:自分|相手)のターンのはじめまで|このターン)、(.+?)は(?:自分|プレイヤー)を攻撃(?:することが)?できない$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'restrict', target: t, what: 'attackMe' }];
  }
  if ((m = s.match(/^(?:この|その)ターン、(.+?)は攻撃できない$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'restrict', target: t, what: 'attack' }];
  }
  if ((m = s.match(/^(.+?)は、?次の(?:相手|自分)のターンのはじめに(?:アンタップしない|アンタップされない)$/)) || (m = s.match(/^(.+?)はアンタップしない$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'restrict', target: t, what: 'untap' }];
  }
  if ((m = s.match(/^次の(?:相手|自分)のターンのはじめ(?:に|まで)、(.+?)はアンタップ(?:しない|されない)$/))) {
    const t = refTarget(m[1]);
    if (t) return [{ op: 'restrict', target: t, what: 'untap' }];
  }

  // ---- バトル ----
  if (/^(その選んだクリーチャー|そのクリーチャー|選んだクリーチャー)とこのクリーチャーをバトルさせる$/.test(s) || /^このクリーチャーと(その選んだクリーチャー|そのクリーチャー|選んだクリーチャー)をバトルさせる$/.test(s))
    return [{ op: 'battle', a: { ref: 'self' }, b: { ref: 'it' } }];
  if (/^その(2|２)体をバトルさせる$/.test(s)) return [{ op: 'battle', a: { ref: 'it' }, b: { ref: 'it' } }];

  // ---- このクリーチャー ----
  if ((m = s.match(/^この(?:クリーチャー|カード|呪文|タマシード|クロスギア|ドラグハート|フォートレス|フィールド)を(.+)$/))) {
    const ops = verbOps(m[1], { ref: 'self' });
    if (ops) return ops;
  }

  // ---- 「その」で前の選択を指す ----
  if ((m = s.match(new RegExp(IT.source + 'を、?(.+)$')))) {
    const ops = verbOps(m[2], { ref: 'it' });
    if (ops) return ops;
  }
  if ((m = s.match(new RegExp(IT.source + '(?:を|は)?、?(.+)$')))) {
    const ops = verbOps(m[2], { ref: 'it' });
    if (ops) return ops;
  }

  // ---- 相手が自分のカードを選ぶ ----
  if ((m = s.match(new RegExp(`^相手は(?:自身の|自分の)(.+?)を${N}${COUNT_UNIT}(まで)?選び、(.+)$`)))) {
    const t = selTarget('相手の' + m[1], m[2], m[3], false, 'opp');
    const ops = t && verbOps(m[4], { ref: 'it' });
    if (t && ops) return [{ op: 'choose', target: t, purpose: 'sacrifice', prompt: s0 }, ...ops];
  }

  // ---- パワーの合計で選ぶ ----
  if ((m = s.match(new RegExp(`^(.+?)を、?(パワー|コスト)の合計が${N}以下になるよう(?:に)?好きな数選び、(.+)$`)))) {
    const sel = parseSel(m[1]);
    const ops = sel && verbOps(m[4], { ref: 'it' });
    const count: Count = m[2] === 'パワー' ? { n: 99, upTo: true, sumPowerMax: +m[3] } : { n: 99, upTo: true, sumCostMax: +m[3] };
    if (sel && ops)
      return [{ op: 'choose', target: { ref: 'sel', sel, count, chooser: 'self' }, purpose: purposeOf(sel, m[4]), prompt: `${m[2]}の合計が${m[3]}以下になるように選ぶ` }, ...ops];
  }

  // ---- 「その〇〇を〜」 (直前に表向きにした/選んだカード) ----
  if ((ctx.chosen || ctx.looked) && (m = s.match(/^その([^、をのに]{1,15})を、?(.+)$/))) {
    const ops = verbOps(m[2], { ref: 'it' });
    if (ops) return ops;
  }

  // ---- 単独の動詞 「破壊する」「アンタップする」: 直前に選んだカード、何も選んでいなければこのクリーチャー ----
  {
    const ops = verbOps(s, ctx.chosen || ctx.looked ? { ref: 'it' } : { ref: 'self' });
    if (ops && (ctx.chosen || ctx.looked || !/^(手札|マナ|墓地|山札|シールド)/.test(s))) return ops;
  }

  // ---- 選択して操作 ----
  // 「SELをN体選び、VERB」
  if ((m = s.match(new RegExp(`^(.+?)を${N}${COUNT_UNIT}(まで)?選び、(.+)$`)))) {
    const t = selTarget(m[1], m[2], m[3], false, 'self');
    if (t && t.ref === 'sel') {
      const ops = verbOps(m[4], { ref: 'it' }) ?? sentence(m[4], ctx);
      if (ops) return [{ op: 'choose', target: t, purpose: purposeOf(t.sel, m[4]), prompt: `${m[1]}を${m[2]}${/呪文|カード/.test(m[1]) ? '枚' : '体'}${m[3] ? 'まで' : ''}選ぶ` }, ...ops];
    }
  }
  // 「SELをN体選ぶ」
  if ((m = s.match(new RegExp(`^(.+?)を${N}${COUNT_UNIT}(まで)?選ぶ$`)))) {
    const t = selTarget(m[1], m[2], m[3], false, 'self');
    if (t && t.ref === 'sel') return [{ op: 'choose', target: t, purpose: purposeOf(t.sel, '破壊'), prompt: s0 }];
  }
  // 「SELをN体、自分のZONEからVERB」「自分のZONEからSELをN体VERB」
  const ZW = '(墓地|マナゾーン|手札|超次元ゾーン|超GRゾーン|山札の上|山札|シールドゾーン)((?:または|か|と)(?:墓地|マナゾーン|手札|超次元ゾーン|超GRゾーン|山札の上|山札|シールドゾーン))?';
  if ((m = s.match(new RegExp(`^(.+?)を${N}${COUNT_UNIT}(まで)?、?(自分|相手)の${ZW}から(.+)$`))) ||
    (m = s.match(new RegExp(`^(自分|相手)の${ZW}から、?(.+?)を${N}${COUNT_UNIT}(まで)?(.+)$`)))) {
    const first = /^(自分|相手)$/.test(m[1]);
    const [who, zone, zone2, phrase, nstr, upto, verb] = first ? [m[1], m[2], m[3], m[4], m[5], m[6], m[7]] : [m[4], m[5], m[6], m[1], m[2], m[3], m[7]];
    const zones = [ZONE[zone], ...(zone2 ? [ZONE[zone2.replace(/^(または|か|と)/, '')]] : [])];
    const sel = parseSel(phrase.replace(/、$/, ''), { zones });
    if (sel) {
      sel.zones = zones;
      sel.owner = who === '自分' ? 'self' : 'opp';
      if (sel.kind === 'creature' && /カード$/.test(phrase)) sel.kind = 'card';
      const t: Target = { ref: 'sel', sel, count: count(nstr, upto), chooser: 'self' };
      const v = verb.replace(/^、/, '');
      const ops = verbOps(v, { ref: 'it' });
      if (ops) return [{ op: 'choose', target: t, purpose: purposeOf(sel, v), prompt: `${phrase}を${nstr}${upto ? 'まで' : ''}選ぶ` }, ...ops];
    }
  }
  // 「SELをすべてVERB」「SELすべてをVERB」
  if ((m = s.match(/^(.+?)を?すべて、?(.+)$/)) || (m = s.match(/^(.+?)すべてを(.+)$/))) {
    const t = selTarget(m[1].replace(/を$/, ''), undefined, undefined, true, 'self');
    const ops = t && verbOps(m[2], { ref: 'it' });
    if (t && ops && t.ref === 'sel') return [{ op: 'choose', target: t, purpose: purposeOf(t.sel, m[2]), prompt: 'all' }, ...ops];
  }
  // 「SELをN体VERB」 (選ぶのは自分)
  if ((m = s.match(new RegExp(`^(.+?)を${N}${COUNT_UNIT}(まで)?、?(.+)$`)))) {
    const t = selTarget(m[1], m[2], m[3], false, 'self');
    const ops = t && verbOps(m[4], { ref: 'it' });
    if (t && ops && t.ref === 'sel') return [{ op: 'choose', target: t, purpose: purposeOf(t.sel, m[4]), prompt: `${m[1]}を${m[2]}${/呪文|カード/.test(m[1]) ? '枚' : '体'}${m[3] ? 'まで' : ''}選ぶ` }, ...ops];
  }
  // 「こうして捨てたカード1枚につき、〜」: 直前のカードの数だけくり返す
  if ((m = s.match(/^(?:こうして|このようにして)(?:相手が)?(?:捨てた|墓地に置いた|破壊した|手札に戻した|手札に加えた|マナゾーンに置いた|見せた|アンタップした|タップした|選んだ)(.+?)1(?:体|枚|つ)につき、?(.+)$/))) {
    const noun = m[1].replace(/^(カード|手札|シールド)$/, '');
    const sel = noun ? parseSel(noun) : undefined;
    const body = sentence(m[2], ctx);
    if (sel !== null && body?.length) return [{ op: 'repeatIt', sel: sel ? { ...sel, owner: 'any' } : undefined, body }];
  }
  // 「山札の上から1枚目を見て、手札に加えるかマナゾーンに置く」
  if ((m = s.match(/^自分の山札の上から1枚目を見て、手札に加えるか(タップして)?マナゾーンに置く$/))) {
    ctx.looked = true;
    return [
      { op: 'top', n: 1, to: 'look', who: 'self' },
      {
        op: 'modal',
        pick: 1,
        options: [
          { label: '手札に加える', body: [{ op: 'move', target: { ref: 'looked' }, to: 'hand' }] },
          { label: 'マナゾーンに置く', body: [{ op: 'move', target: { ref: 'looked' }, to: m[1] ? 'manaTapped' : 'mana' } as Op] },
        ],
      },
    ];
  }
  // 龍覇「コストN以下のドラグハート1枚、または、コストM以下の光のドラグハートを1枚、自分の超次元ゾーンからバトルゾーンに出す」
  if ((m = s.match(/^(コスト\d+以下の(?:[^、]+の)?ドラグハート(?:・フォートレス|・ウエポン)?)を?(\d+)枚(まで)?、?または、?((?:コスト\d+以下の)?[^、]*?ドラグハート(?:・フォートレス|・ウエポン)?)を?(\d+)枚(まで)?、?を?自分の超次元ゾーンからバトルゾーンに出す$/))) {
    const a = sentence(`${m[1]}を${m[2]}枚${m[3] ?? ''}、自分の超次元ゾーンからバトルゾーンに出す`, ctx);
    const b = sentence(`${m[4]}を${m[5]}枚${m[6] ?? ''}、自分の超次元ゾーンからバトルゾーンに出す`, ctx);
    if (a && b) return [{ op: 'modal', pick: 1, options: [{ label: `${m[1]}を${m[2]}枚`, body: a }, { label: `${m[4]}を${m[5]}枚`, body: b }] }];
  }
  if (/^(?:相手は)?山札をシャッフルする$/.test(s) && /^相手は/.test(s0.replace(/^その後、/, ''))) return [{ op: 'shuffle', who: 'opp' }];
  // 「プレイヤーを1人選ぶ。そのプレイヤーは(自身の)〜」 (parseEffect で1文にまとめる)
  if ((m = s.match(/^プレイヤーを1人選(んでもよい|び)、そのプレイヤーは、?(.+)$/))) {
    const rest = m[2].replace(/^バトルゾーンにある自身の/, '自分の').replace(/自身の/g, '自分の');
    const body = sentence(rest, ctx);
    if (body?.length)
      return [
        {
          op: 'modal',
          pick: 1,
          optional: m[1] === 'んでもよい',
          options: [
            { label: '自分を選ぶ', body: [{ op: 'asPlayer', who: 'self', body }] },
            { label: '相手を選ぶ', body: [{ op: 'asPlayer', who: 'opp', body }] },
          ],
        },
      ];
  }
  // 「そのクリーチャーに付いているオーラ1枚につき、〜」
  if ((m = s.match(/^(そのクリーチャー|それ|これを付けたクリーチャー)に付いて(?:いる|いた)オーラ1枚につき、(.+)$/))) {
    const body = sentence(m[2], ctx);
    if (body?.length) return [{ op: 'countSet', aurasOf: m[1] === 'これを付けたクリーチャー' ? 'host' : 'it' }, { op: 'repeatCount', body }];
  }
  // 「そのクリーチャーに含まれるカード1枚につき、〜」
  if ((m = s.match(/^そのクリーチャーに含まれるカード1枚につき、(.+)$/))) {
    const body = sentence(m[1], ctx);
    if (body?.length) return [{ op: 'countSet', cardsOfIt: true }, { op: 'repeatCount', body }];
  }
  // 「各プレイヤーはバトルゾーン、手札、墓地にあるこのクリーチャー以外の自身のカードすべてを山札に加えてシャッフルする」
  if (/^各プレイヤーは、?バトルゾーン、手札、墓地にあるこのクリーチャー以外の自身のカードすべてを山札に加えてシャッフルする$/.test(s))
    return [
      {
        op: 'forEachPlayer',
        body: [
          { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['battle', 'hand', 'grave'], kind: 'card', other: true }, count: { all: true }, chooser: 'self' }, purpose: 'neutral', prompt: 'all' },
          { op: 'move', target: { ref: 'it' }, to: 'deckTop' },
          { op: 'shuffle' },
        ],
      },
    ];
  // 「各プレイヤーは自身の手札を山札に戻してシャッフルし、その枚数と同じ枚数のカードを引く」
  if (/^自分の手札を(?:すべて)?(?:自分の)?山札に(?:戻して|加えて)シャッフルし、その枚数と同じ枚数のカードを引く$/.test(s))
    return [
      { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['hand'], kind: 'card' }, count: { all: true }, chooser: 'self' }, purpose: 'neutral', prompt: 'all' },
      { op: 'move', target: { ref: 'it' }, to: 'deckTop' },
      { op: 'shuffle' },
      { op: 'drawItPlus', plus: 0 },
    ];
  if (/^各プレイヤーは、?自身の手札を(?:すべて)?(?:それぞれの|自身の)?山札に(?:戻して|加えて)シャッフルし、その枚数と同じ枚数のカードを引く$/.test(s))
    return [
      {
        op: 'forEachPlayer',
        body: [
          { op: 'choose', target: { ref: 'sel', sel: { owner: 'self', zones: ['hand'], kind: 'card' }, count: { all: true }, chooser: 'self' }, purpose: 'neutral', prompt: 'all' },
          { op: 'move', target: { ref: 'it' }, to: 'deckTop' },
          { op: 'shuffle' },
          { op: 'drawItPlus', plus: 0 },
        ],
      },
    ];
  // 「各プレイヤーは(自身の)〜」: プレイヤーごとに行う
  if ((m = s.match(/^各プレイヤーは、?(.+)$/))) {
    const rest = m[1].replace(/^バトルゾーンにある自身の/, '自分の').replace(/自身の/g, '自分の').replace(/それぞれの/g, '自分の').replace(/(\d+)(体|枚)ずつ/g, '$1$2');
    const body = sentence(rest, ctx);
    if (body?.length) return [{ op: 'forEachPlayer', body }];
  }
  // 「自分の〇〇1体につき、〜」: その数だけくり返す
  if ((m = s.match(/^(?:バトルゾーンにある|バトルゾーンで)?((?:自分|相手)の.+?|タップされている.+?|[^、]*?(?:クリーチャー|カード|呪文))1(?:体|枚|つ)につき、?(.+)$/))) {
    const sel = parseSel(m[1]);
    const body = sentence(m[2], ctx);
    if (sel && body?.length) return [{ op: 'repeatPer', sel, body }];
  }
  // 「このターン、AをNし、Bする」: 期間をそろえて2つの文に分ける
  if ((m = s.match(/^((?:このターン|次の自分のターンのはじめまで)、)(.+?)(し|され|を得|を与え)、(.+)$/))) {
    const END: Record<string, string> = { し: 'する', され: 'される', を得: 'を得る', を与え: 'を与える' };
    const ra = sentence(m[1] + m[2] + END[m[3]], ctx);
    const subj = m[2].match(/^((?:この|その)クリーチャー)(?:は|の)/)?.[1];
    const rb = ra && (sentence(m[1] + m[4], ctx) ?? (subj ? sentence(`${m[1]}${subj}は${m[4]}`, ctx) : null));
    if (ra && rb) return [...ra, ...rb];
  }
  return null;
}

/** 「このクリーチャー」「そのクリーチャー」「自分のクリーチャーすべて」等 */
function refTarget(phrase: string): Target | null {
  const p = phrase.replace(/\s+/g, '');
  if (/^この(クリーチャー|カード|タマシード|ドラグハート|クロスギア|フォートレス)$/.test(p)) return { ref: 'self' };
  if (/^これを(装備|クロス)したクリーチャー$/.test(p)) return { ref: 'host' };
  // 「自分のクリーチャー」「相手のドラゴン」(数を書かない) はすべて
  if (/^(自分|相手)の[^\d]*(クリーチャー|ドラゴン|コマンド|ハンター|エイリアン|ジョーカーズ)$/.test(p) && !/\d/.test(p)) {
    const sel = parseSel(p);
    if (sel) return { ref: 'sel', sel, count: { all: true }, chooser: 'self' };
  }
  // 「その種族のクリーチャー」(選んだ値で絞った名詞) はすべて
  if (/〈/.test(p)) {
    const sel = parseSel(p.replace(/(すべて|全体)$/, ''));
    if (sel) return { ref: 'sel', sel, count: { all: true }, chooser: 'self' };
  }
  if (IT.test(p) && p.replace(IT, '') === '') return { ref: 'it' };
  // 「自分のアウトレイジ」など、種族だけの指定 (バトルゾーンのものすべて)
  if (/^(自分|相手)の[^\d、]+$/.test(p)) {
    const sel = parseSel(p);
    if (sel && sel.zones.length === 1 && sel.zones[0] === 'battle' && (sel.races?.length || sel.civs?.length)) return { ref: 'sel', sel, count: { all: true }, chooser: 'self' };
  }
  const m = p.match(/^(.+?)(すべて|全体)$/);
  if (m) {
    const sel = parseSel(m[1]);
    if (sel) return { ref: 'sel', sel, count: { all: true }, chooser: 'self' };
  }
  return null;
}

// ---------- 入口 ----------

/** 単独の「〜を選ぶ。」の目的 (CPU の選び方) を、その次の操作から決め直す */
function fixPurposes(ops: Op[]) {
  for (let i = 0; i + 1 < ops.length; i++) {
    const a = ops[i];
    const b = ops[i + 1];
    if (a.op !== 'choose' || a.target.ref !== 'sel' || a.target.sel.owner !== 'self' || a.purpose !== 'sacrifice') continue;
    if ((b.op === 'power' && b.delta > 0) || b.op === 'grant' || b.op === 'untap') a.purpose = 'benefit';
  }
}

/** 効果テキスト (複数の文) を解釈する */
export function parseEffect(text: string): Program {
  // 爆進ダブル / 「バトルゾーンに自分の〇〇があれば、両方を選んでもよい」
  let bonus: Cond | undefined;
  let body = text;
  if (/爆進ダブル/.test(body)) {
    bonus = { c: 'count', sel: { owner: 'self', zones: ['battle'], kind: 'creature', evolution: true }, cmp: '>=', n: 1 };
    body = body.replace(/爆進ダブル(\s*[(（][^)）]*[)）])?。?/g, '');
  }
  const both = normText(body).match(/(?:^|。)\s*(?:バトルゾーンに)?自分の(.+?)が(?:あれば|ある場合は)、(?:この効果を)?両方(?:とも)?を?選んでもよい。?/);
  if (both) {
    const sel = parseSel('自分の' + both[1]);
    if (sel) {
      bonus = { c: 'count', sel, cmp: '>=', n: 1 };
      body = normText(body).replace(both[0], both[0].startsWith('。') ? '。' : '');
    }
  }
  body = normText(body).replace(/(次に(?:自分が)?召喚する[^。]+?少なくする)。(ただし、コストは0以下にはならない。)?そのクリーチャーが出た時、このターン、そのクリーチャーに「([^」]+)」を与える/g, '$1、出た時「$3」を与える。$2');
  body = body.replace(/プレイヤーを1人選(んでもよい|ぶ)。そのプレイヤーは/g, (_, x) => `プレイヤーを1人選${x === 'ぶ' ? 'び' : x}、そのプレイヤーは`);
  const prog = parseEffectRaw(body);
  fixPurposes(prog.ops);
  for (const o of prog.ops)
    if (o.op === 'chooseValue') {
      const after = body.slice(Math.max(0, body.search(/(種族|文明|数字)を(ひとつ|1つ)選/)));
      // 「自分を攻撃できない」は相手のクリーチャーに対する効果
      const me = (after.match(/自分を/g)?.length ?? 0);
      o.hostile = (after.match(/相手/g)?.length ?? 0) + me > (after.match(/自分/g)?.length ?? 0) - me;
    }
  if (bonus) {
    const mod = prog.ops.find((o) => o.op === 'modal');
    if (mod && mod.op === 'modal') mod.bonus = bonus;
  }
  return prog;
}

function parseEffectRaw(text: string): Program {
  const t = stripReminder(normText(text)).replace(/\s+/g, ' ');
  const ctx: Ctx = { looked: false };
  const ops: Op[] = [];
  const unparsed: string[] = [];

  // 「次の能力をN回行う。〜」 (鬼タイムなら M 回)
  const rep = t.match(/^(.*?)次の能力を(\d+)回(?:\[鬼(\d+):(\d+)\])?行う。(.+)$/);
  if (rep) {
    const pre: Program = rep[1].trim() ? parseEffect(rep[1]) : { ops: [], complete: true, unparsed: [] };
    const body = parseEffect(rep[5]);
    const r = (n: number): Op => ({ op: 'repeat', n, body: body.ops });
    return {
      ops: [...pre.ops, rep[3] ? { op: 'if', cond: { c: 'totalShieldsLE', n: +rep[3] }, body: [r(+rep[4])], else: [r(+rep[2])] } : r(+rep[2])],
      complete: pre.complete && body.complete,
      unparsed: [...pre.unparsed, ...body.unparsed],
    };
  }
  // 選択肢 「次のうちいずれかひとつを選ぶ。▼A ▼B」
  const modal = t.match(/^(.*?)次の(?:うちいずれか|中から)(ひとつ|1つ|\d+つ|\d+回)(?:を|まで)?選(?:ぶ|んでもよい)。?(.*)$/);
  if (modal) {
    const pre: Program = modal[1].trim() ? parseEffect(modal[1]) : { ops: [], complete: true, unparsed: [] };
    const pick = modal[2] === 'ひとつ' ? 1 : +modal[2].replace(/つ|回/, '');
    // 「(同じものを選んでもよい)」: 1つずつ選ぶのを pick 回くり返す
    const same = /同じものを(?:\d+回|２回)?選んでもよい/.test(text);
    const rest = modal[3].replace(/[(（]?同じものを(?:\d+回)?選んでもよい。?[)）]?。?/, '');
    const raw = rest.includes('▼') ? rest.split('▼') : rest.split('。');
    const options = raw.map((x) => x.trim()).filter(Boolean);
    const parsed = options.map((o) => ({ label: o, prog: parseEffect(o) }));
    const ok = pre.complete && parsed.length >= 2 && parsed.every((p) => p.prog.complete);
    return {
      ops: [
        ...pre.ops,
        ...(same
          ? Array.from({ length: pick }, (): Op => ({ op: 'modal', pick: 1, options: parsed.map((p) => ({ label: p.label, body: p.prog.ops })) }))
          : [{ op: 'modal' as const, pick, options: parsed.map((p) => ({ label: p.label, body: p.prog.ops })), optional: /選んでもよい/.test(t) || undefined }]),
      ],
      complete: ok,
      unparsed: [...pre.unparsed, ...parsed.flatMap((p) => p.prog.unparsed)],
    };
  }

  // 名前のある能力の注釈 (「アビス・メクレイド5(自分の山札の上から3枚を見る。…)」) を、本文が解釈できない時に使う
  const reminders = new Map<string, string>();
  for (const r of normText(text).matchAll(/([^。()（）]+?)[(（]([^()（）]{6,})[)）]/g)) reminders.set(r[1].replace(/\s+/g, '').replace(/^.*、/, ''), r[2]);

  for (const s of t.split('。').map((x) => x.trim()).filter(Boolean)) {
    // 「それ以外なら〜」 は直前の「〜なら」の else
    const el = s.replace(/\s+/g, '').match(/^(?:それ以外(?:なら|の場合)|そうでなければ)、?(.+)$/);
    let last = ops[ops.length - 1];
    if (last?.op === 'optional' && last.body[last.body.length - 1]?.op === 'if') last = last.body[last.body.length - 1];
    if (el && last?.op === 'if' && !last.else) {
      const body = sentence(el[1], ctx) ?? verbOps(el[1], { ref: 'it' });
      if (body) {
        last.else = body;
        continue;
      }
    }
    const r = sentence(s, ctx);
    if (r) {
      ops.push(...r);
      if (JSON.stringify(r).includes('"choose"') || ctx.looked) ctx.chosen = true;
      continue;
    }
    const key = s.replace(/\s+/g, '').replace(/^(そうしたら|その後)、/, '').replace(/^.*、/, '');
    const rem = reminders.get(key) ?? reminders.get(key.replace(/する$/, ''));
    const rp = rem ? parseEffect(rem) : null;
    if (rp?.complete) ops.push(...(/^そうしたら、/.test(s) ? [{ op: 'if', cond: { c: 'did' }, body: rp.ops } as Op] : rp.ops));
    else unparsed.push(s);
  }
  return { ops, complete: unparsed.length === 0 && ops.length > 0, unparsed };
}
