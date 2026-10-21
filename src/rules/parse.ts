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
  if (m(/^破壊する$/)) return [{ op: 'destroy', target }];
  if (m(/^(持ち主の|自分の)?手札に(戻す|加える)$/)) return [{ op: 'move', target, to: 'hand' }];
  if (m(/^相手に見せ(てから|て)?、?(持ち主の|自分の)?手札に(加える|戻す)$/)) return [{ op: 'move', target, to: 'hand', reveal: true }];
  if (m(/^(バトルゾーンから|自分の(墓地|マナゾーン)から)、?(持ち主の|自分の)?手札に(戻す|加える)$/)) return [{ op: 'move', target, to: 'hand' }];
  if (m(/^(持ち主の|自分の)?マナゾーンに(置く|加える)$/)) return [{ op: 'move', target, to: 'mana' }];
  if (m(/^タップして(持ち主の|自分の)?マナゾーンに置く$/)) return [{ op: 'move', target, to: 'manaTapped' }];
  if (m(/^裏向きのまま(持ち主の|自分の)?マナゾーンに置く$/)) return [{ op: 'move', target, to: 'manaDown' }];
  if (m(/^新しいシールドとして(自分の|持ち主の)?シールドゾーンに表向きのまま(加える|置く)$/)) return [{ op: 'move', target, to: 'shieldUp' }];
  if (m(/^(持ち主の|自分の)?墓地に(置く|送る)$/)) return [{ op: 'move', target, to: 'grave' }];
  if (m(/^(持ち主の|自分の)?山札の(一番)?下に(置く|戻す)$/)) return [{ op: 'move', target, to: 'deckBottom' }];
  if (m(/^(持ち主の|自分の)?山札の(一番)?上に(置く|戻す)$/)) return [{ op: 'move', target, to: 'deckTop' }];
  if (m(/^(持ち主の|自分の)?(シールドゾーンに|シールドとして)?(裏向きにして|裏向きのまま)?(シールドゾーンに)?(加える|置く)$/) && /シールド/.test(v))
    return [{ op: 'move', target, to: 'shield' }];
  if (m(/^(持ち主の)?シールド化する$/)) return [{ op: 'move', target, to: 'shield' }];
  if (m(/^タップする$/)) return [{ op: 'tap', target }];
  if (m(/^タップまたはアンタップする$/)) return [{ op: 'toggleTap', target }];
  if (m(/^アンタップする$/)) return [{ op: 'untap', target }];
  if (m(/^(自分の)?(バトルゾーンに)?出す$/)) return [{ op: 'play', target, mode: 'put' }];
  if (m(/^タップして(自分の)?バトルゾーンに出す$/)) return [{ op: 'play', target, mode: 'put' }, { op: 'tap', target: { ref: 'it' } }];
  if (m(/^(コストを支払わずに|コストを支払ったものとして)召喚する$/)) return [{ op: 'play', target, mode: 'summon' }];
  if (m(/^コストを支払わずに唱える$/)) return [{ op: 'play', target, mode: 'cast' }];
  if (m(/^コストを支払わずに(使う|実行する|プレイする|ジェネレートする)$/)) return [{ op: 'play', target, mode: 'use' }];
  if (m(/^捨てる$/)) return [{ op: 'move', target, to: 'grave' }];
  if (m(/^コストの大きいほうに裏返す$/)) return [{ op: 'flip', target, to: 'big' }];
  if (m(/^コストの小さいほうに裏返す$/)) return [{ op: 'flip', target, to: 'small' }];
  if (m(/^クリーチャー側に裏返(す|し、アンタップする)$/)) return [{ op: 'flip', target, to: 'creature' }];
  if (m(/^(もう一方の面に)?裏返す$/)) return [{ op: 'flip', target }];
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

function parseCond(c: string): Cond | null {
  let m: RegExpMatchArray | null;
  if (!/^自分の(墓地|マナゾーン|手札)に/.test(c)) {
    if ((m = c.match(new RegExp(`^(?:バトルゾーンに)?自分の(.+?)が${N}${COUNT_UNIT}以上あ$`)))) {
      const sel = parseSel('自分の' + m[1]);
      if (sel) return { c: 'count', sel, cmp: '>=', n: +m[2] };
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
  if (/^このクリーチャーがタップされてい$/.test(c)) return { c: 'selfTapped' };
  if (/^これを(装備|クロス)したクリーチャーがタップ(され|し)てい$/.test(c)) return { c: 'equippedTapped' };
  if (/^このクリーチャーがリンクしてい(る)?$/.test(c)) return { c: 'linked' };
  if (/^このクリーチャーがリンクしていない$/.test(c)) return { c: 'linked', neg: true };
  if (/^このクリーチャーが表向きで(自分の)?シールドゾーンにあ$/.test(c)) return { c: 'selfFaceUpShield' };
  if ((m = c.match(/^(それ|そのカード|そのクリーチャー|見せたカード|そのようにして見せたカード|このようにして見せたカード)が、?(.+?)(である|であ|で|だった)?$/))) {
    const sel = parseSel(m[2], { zones: ['battle', 'hand', 'mana', 'grave', 'deck', 'shield'] });
    return sel ? { c: 'itMatches', sel } : null;
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

const IT = /^(それらのクリーチャー|それらのカード|それら|それ|その選んだクリーチャー|選んだクリーチャー|そのクリーチャー|その選んだカード|選んだカード|そのカード|その呪文|そのシールド|そのタマシード|その\d+体|その\d+枚|そのうちの\d+(?:体|枚))/;

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
    .replace(/を好きな(数|枚数)、?/g, 'を99枚まで')
    .replace(/(\d+)枚ずつ/g, '$1枚')
    .replace(/(\d+)体ずつ/g, '$1体')
    .replace(/^自分が勝った(ら|場合)、/, 'そうしたら、')
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
    .replace(/^(.+?(?:クリーチャー|カード))(\d+)(体|枚)を(?!選)(.+)$/, '$1を$2$3、$4')
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
    const rd = s.match(/^相手の手札からカードを(\d+)枚見ないで選び、(?:相手は)?(?:それを)?(?:持ち主の)?(?:墓地に置く|捨てさせる|捨てる)$/);
    if (rd) return [{ op: 'discard', who: 'opp', count: { n: +rd[1], upTo: false }, how: 'random' }];
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
    const um = s.match(/^このクリーチャー(?:と自分の他のクリーチャー(\d+)体)?の(q|oP|oB|xB|◇)能力を(?:1回)?使(う|ってもよい)$/);
    if (um) {
      const op: Op = { op: 'useMarked', key: um[2], others: um[1] ? +um[1] : undefined };
      return um[3] === 'う' ? [op] : [{ op: 'optional', body: [op], prompt: s0 }];
    }
  }

  // 呪文を唱えられない
  {
    const lk = s.match(/^(このターン|次の自分のターンのはじめまで)、相手は呪文を唱えられない$/);
    if (lk) return [{ op: 'lockSpells', until: lk[1] === 'このターン' ? 'turn' : 'nextOwnTurn' }];
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
  m = s.match(/^(?:もし)?(.+?)(?:れば|ならば|なら|であれば)、(.+)$/);
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
    return body ? [{ op: 'optional', body, prompt: s0 }] : null;
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

  // ---- 自分と相手を破壊 ----
  if (/^そのクリーチャーとこのクリーチャーを破壊する$/.test(s)) return [{ op: 'destroy', target: { ref: 'it' } }, { op: 'destroy', target: { ref: 'self' } }];

  // ---- シールドをブレイク (このクリーチャーは相手のシールドをNつブレイクする) ----
  if ((m = s.match(new RegExp(`^このクリーチャーは(?:相手の)?シールドを${N}(?:つ|枚)ブレイクする$`)))) return [{ op: 'breakShield', n: +m[1] }];

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
  if ((m = s.match(new RegExp(`^(自分の)?山札の上から${N}枚(目)?を(新しい)?(シールド|シールドゾーン)(に裏向きにして|に|として)?(加える|化する|置く)$`))))
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
  if ((m = s.match(/^この(?:クリーチャー|カード|呪文|タマシード|クロスギア|ドラグハート|フォートレス)を(.+)$/))) {
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
  if ((m = s.match(new RegExp(`^(.+?)を、?パワーの合計が${N}以下になるように好きな数選び、(.+)$`)))) {
    const sel = parseSel(m[1]);
    const ops = sel && verbOps(m[3], { ref: 'it' });
    if (sel && ops)
      return [{ op: 'choose', target: { ref: 'sel', sel, count: { n: 99, upTo: true, sumPowerMax: +m[2] }, chooser: 'self' }, purpose: purposeOf(sel, m[3]), prompt: `パワーの合計が${m[2]}以下になるように選ぶ` }, ...ops];
  }

  // ---- 「その〇〇を〜」 (直前に表向きにした/選んだカード) ----
  if ((ctx.chosen || ctx.looked) && (m = s.match(/^その([^、をのに]{1,15})を、?(.+)$/))) {
    const ops = verbOps(m[2], { ref: 'it' });
    if (ops) return ops;
  }

  // ---- 単独の動詞 「破壊する」「アンタップする」: 直前に選んだカード、何も選んでいなければこのクリーチャー ----
  {
    const ops = verbOps(s, ctx.chosen ? { ref: 'it' } : { ref: 'self' });
    if (ops && (ctx.chosen || !/^(手札|マナ|墓地|山札|シールド)/.test(s))) return ops;
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
  return null;
}

/** 「このクリーチャー」「そのクリーチャー」「自分のクリーチャーすべて」等 */
function refTarget(phrase: string): Target | null {
  const p = phrase.replace(/\s+/g, '');
  if (/^この(クリーチャー|カード|タマシード|ドラグハート|クロスギア|フォートレス)$/.test(p)) return { ref: 'self' };
  if (IT.test(p) && p.replace(IT, '') === '') return { ref: 'it' };
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
  const prog = parseEffectRaw(body);
  fixPurposes(prog.ops);
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

  // 選択肢 「次のうちいずれかひとつを選ぶ。▼A ▼B」
  const modal = t.match(/^(.*?)次の(?:うちいずれか|中から)(ひとつ|1つ|\d+つ|\d+回)(?:を|まで)?選ぶ。?(.*)$/);
  if (modal) {
    const pre = parseEffect(modal[1]);
    const pick = modal[2] === 'ひとつ' ? 1 : +modal[2].replace(/つ|回/, '');
    const raw = modal[3].includes('▼') ? modal[3].split('▼') : modal[3].split('。');
    const options = raw.map((x) => x.trim()).filter(Boolean);
    const parsed = options.map((o) => ({ label: o, prog: parseEffect(o) }));
    const ok = pre.complete && parsed.length >= 2 && parsed.every((p) => p.prog.complete);
    return {
      ops: [...pre.ops, { op: 'modal', pick, options: parsed.map((p) => ({ label: p.label, body: p.prog.ops })) }],
      complete: ok,
      unparsed: [...pre.unparsed, ...parsed.flatMap((p) => p.prog.unparsed)],
    };
  }

  // 名前のある能力の注釈 (「アビス・メクレイド5(自分の山札の上から3枚を見る。…)」) を、本文が解釈できない時に使う
  const reminders = new Map<string, string>();
  for (const r of normText(text).matchAll(/([^。()（）]+?)[(（]([^()（）]{6,})[)）]/g)) reminders.set(r[1].replace(/\s+/g, '').replace(/^.*、/, ''), r[2]);

  for (const s of t.split('。').map((x) => x.trim()).filter(Boolean)) {
    // 「それ以外なら〜」 は直前の「〜なら」の else
    const el = s.replace(/\s+/g, '').match(/^それ以外(?:なら|の場合)、?(.+)$/);
    const last = ops[ops.length - 1];
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
