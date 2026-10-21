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
  | { c: 'countAtLeast'; sel: Sel; n: number };

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
  | { s: 'summonFrom'; zone: 'mana' | 'grave' }
  | { s: 'sympathy'; sel: Sel; floor: number }
  | { s: 'sasageru'; n: number }
  | { s: 'gzero'; cond: StaticCond }
  | { s: 'hyperEnergy' }
  | { s: 'poweredBreaker' };

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
  if (/^これを(クロス|付け|装備)した(クリーチャー)?$/.test(p)) return { t: 'cross' };
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
  if (/^(マナゾーンに置く時、)?このカードはタップして(マナゾーンに)?置く$/.test(t0)) return [{ s: 'tapMana' }];
  if (/^自分のマナゾーンにあるカード(を|は)、?すべての文明(のカードとして扱う|を持つ)$/.test(t0)) return [{ s: 'rainbowMana' }];
  if ((m = t0.match(/^このクリーチャーを自分の(マナゾーン|墓地)から召喚してもよい$/))) return [{ s: 'summonFrom', zone: m[1] === '墓地' ? 'grave' : 'mana' }];

  // ---- 攻撃・ブロック・選択 ----
  if (/^このクリーチャーは攻撃されない$/.test(t0)) return [{ s: 'noAttacked' }];
  if (/^このクリーチャーは、?タップされていないクリーチャーを攻撃できる$/.test(t0)) return [{ s: 'attackUntapped' }];
  if (/^このクリーチャーは、?クリーチャーを攻撃できない$/.test(t0)) return [{ s: 'cantAttackCreatures' }];
  if ((m = t0.match(/^このクリーチャーは、?パワー(\d+)以下のクリーチャーにブロックされない$/))) return [{ s: 'unblockableBy', maxPower: +m[1] }];
  if (/^このクリーチャーは、?(このクリーチャー|これ)よりパワーが小さいクリーチャーにブロックされない$/.test(t0)) return [{ s: 'unblockableBy', smallerThanSelf: true }];
  if (/^このクリーチャーは、?(呪文によって)?相手に選ばれない$/.test(t0) || /^(呪文の効果(によって|で))?(バトルゾーンにある自分のクリーチャーを相手が|相手がバトルゾーンにあるクリーチャーを|相手がクリーチャーを)選ぶ時、このクリーチャーを?選(ぶことはできない|ばれない)$/.test(t0))
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
  if ((m = t.match(/^(自分|相手)?の?(.+?)を(召喚|唱える|使う)(?:する)?コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる)(?:てもよい)?(?:、?ただし.*)?$/)) ||
    (m = t.match(/^(自分|相手)?の?(.+?)の(召喚)コスト(?:を|は)(\d+)(少なく|多く)(?:する|なる)(?:てもよい)?(?:、?ただし.*)?$/))) {
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
