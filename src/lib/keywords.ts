import { normText } from '../rules/text';

// カードテキストからキーワード能力を抽出する。
// ここで拾った能力はルールエンジンが自動処理する。それ以外の効果はプレイヤーが手動で処理する。

export interface CondSpec {
  /** 元の条件テキスト */
  text: string;
  civs: string[];
  minCost?: number;
  maxCost?: number;
  /** 種族/カードの種類キーワード ("ドラゴン", "コマンド" 等)。空なら任意のクリーチャー */
  words: string[];
  /** 名前に含む文字列 (例: 名前に《レッドゾーン》とある) */
  nameHas?: string;
}

export interface Keywords {
  blocker: boolean;
  speedAttacker: boolean;
  machFighter: boolean;
  breaker: number; // 1 = 通常
  slayer: boolean;
  shieldTrigger: boolean;
  gStrike: boolean;
  powerAttacker: number;
  cantAttack: boolean;
  cantAttackPlayer: boolean;
  unblockable: boolean;
  revChange: CondSpec | null;
  invasion: CondSpec | null;
  /** 進化元の条件 (進化－自分の◯◯1体の上に置く) */
  evoCond: CondSpec | null;
  ninjaStrike: number | null;
  exLife: boolean;
  charger: boolean;
  justDiver: boolean;
  /** デッキに入れられる枚数の上限 (null = 通常ルール) */
  maxCopies: number | null;
  /** デッキの枚数をこの枚数だけ増やせる */
  deckSizeBonus: number;
  /** ゲーム開始時にバトルゾーン等に置かれるカード */
  startsInPlay: boolean;
  untapAtEnd: boolean;
  shieldGo: boolean;
}

const CIV_WORDS: Record<string, string> = { 光: 'L', 水: 'W', 闇: 'D', 火: 'F', 自然: 'N' };

export function parseCond(text: string): CondSpec {
  const t = text.normalize('NFKC').replace(/[（(].*$/, '').trim();
  const civs: string[] = [];
  for (const [w, c] of Object.entries(CIV_WORDS)) if (t.includes(w)) civs.push(c);
  const minM = t.match(/コスト(\d+)以上/);
  const maxM = t.match(/コスト(\d+)以下/);
  const nameM = t.match(/名前に《(.+?)》/);
  // 文明語・コスト指定を除いた末尾を種族ワードとみなす
  let rest = t
    .replace(/名前に《.+?》とある/g, '')
    .replace(/コスト\d+以[上下]の?/g, '')
    .replace(/(光|水|闇|火|自然)(または|か|、|・)?/g, '')
    .replace(/^の/, '')
    .replace(/の/g, ' ')
    .trim();
  rest = rest.replace(/クリーチャー$/, '').trim();
  const words = rest
    .split(/\s+|または|か/)
    .map((w) => w.replace(/[<>＜＞]/g, '').trim())
    .filter((w) => w && w !== 'クリーチャー' && w !== '自分');
  return {
    text,
    civs,
    minCost: minM ? Number(minM[1]) : undefined,
    maxCost: maxM ? Number(maxM[1]) : undefined,
    words,
    nameHas: nameM?.[1],
  };
}

const has = (lines: string[], re: RegExp) => lines.some((l) => re.test(l));

export function parseKeywords(rawLines: string[], type: string): Keywords {
  const lines = rawLines.map((l) => normText(l));
  const all = lines.join('\n');
  let breaker = 1;
  if (has(lines, /^(ワールド・ブレイカー|∞ブレイカー)/)) breaker = 99;
  else if (has(lines, /^Q・ブレイカー/)) breaker = 4;
  else if (has(lines, /^T・ブレイカー/)) breaker = 3;
  else if (has(lines, /^W・ブレイカー/)) breaker = 2;
  const paM = all.match(/パワーアタッカー\+(\d+)/);

  let revChange: CondSpec | null = null;
  const rcLine = lines.find((l) => /^革命チェンジ/.test(l));
  if (rcLine) {
    const m = rcLine.match(/^革命チェンジ[:：]?(.+?)(\(|$)/);
    revChange = parseCond(m ? m[1] : '');
  }
  let invasion: CondSpec | null = null;
  const invLine = lines.find((l) => /^(S級)?侵略(\[.+?\])?[-ー－]/.test(l) || /^(S級)?侵略ZERO/.test(l));
  if (invLine) {
    const m = invLine.match(/侵略(?:\[.+?\])?[-ー－](.+?)(\(|$)/);
    invasion = parseCond(m ? m[1] : '');
  }
  const evoM = all.match(/進化[-ー－:：]\s*自分の(.+?)(1|2|3)体の上に置/);
  const evoCond = evoM ? parseCond(evoM[1]) : null;
  const nsM = all.match(/ニンジャ・ストライク\s*(\d+)/);

  // 枚数制限の例外 (「4枚より多くデッキに入れることができる」「デッキに1枚だけ」等)
  const flat = all.replace(/\s+/g, '');
  let maxCopies: number | null = null;
  if (/(デッキ|超GR)に(何枚でも|好きな枚数)|\d+枚(より多く|以上)(デッキ|超GR)に入れることができる/.test(flat)) maxCopies = 999;
  else {
    const m = flat.match(/デッキに(\d+)枚(まで|だけ)入れ/);
    if (m) maxCopies = Number(m[1]);
  }
  // デッキの枚数を増やしてゲームを開始する
  const dsM = flat.match(/デッキの枚数を(\d+)枚増やして/);
  const deckSizeBonus = dsM ? Number(dsM[1]) : 0;

  return {
    blocker: has(lines, /^(ブロッカー|ハイパー化.*ブロッカー)/) || has(lines, /^ブロッカー/),
    speedAttacker: has(lines, /^スピードアタッカー/) || /このクリーチャーは召喚酔いしない/.test(all),
    machFighter: has(lines, /^マッハファイター/),
    breaker,
    slayer: has(lines, /^スレイヤー/),
    shieldTrigger: has(lines, /^(S・トリガー|シールド・トリガー|スーパー・S・トリガー|S・トリガー・プラス)/),
    gStrike: has(lines, /^G・ストライク/),
    powerAttacker: paM ? Number(paM[1]) : 0,
    cantAttack: /このクリーチャーは、?攻撃(することが)?できない/.test(all),
    cantAttackPlayer: /このクリーチャーは、?(相手)?プレイヤーを攻撃できない/.test(all),
    unblockable: /このクリーチャーは、?(相手に)?ブロックされない/.test(all),
    revChange,
    invasion,
    evoCond,
    ninjaStrike: nsM ? Number(nsM[1]) : null,
    exLife: has(lines, /^EXライフ/),
    charger: has(lines, /チャージャー/) && type.includes('呪文'),
    justDiver: has(lines, /^ジャストダイバー/),
    maxCopies,
    deckSizeBonus,
    startsInPlay: /ゲーム開始時/.test(all) && /(バトルゾーン|超次元ゾーン|超GRゾーン)に(置|出)/.test(all),
    untapAtEnd: /ターンの終わりに、このクリーチャーをアンタップ/.test(all),
    shieldGo: has(lines, /^シールド・ゴー/),
  };
}

/** 能力の短い表示用ラベル */
export function keywordBadges(k: Keywords): string[] {
  const b: string[] = [];
  if (k.shieldTrigger) b.push('S・T');
  if (k.blocker) b.push('ブロッカー');
  if (k.speedAttacker) b.push('SA');
  if (k.machFighter) b.push('マッハ');
  if (k.breaker === 2) b.push('W');
  if (k.breaker === 3) b.push('T');
  if (k.breaker === 4) b.push('Q');
  if (k.breaker === 99) b.push('ワールド');
  if (k.slayer) b.push('スレイヤー');
  if (k.revChange) b.push('革命チェンジ');
  if (k.invasion) b.push('侵略');
  if (k.ninjaStrike != null) b.push(`NS${k.ninjaStrike}`);
  if (k.gStrike) b.push('G・ST');
  if (k.unblockable) b.push('ブロックされない');
  return b;
}
