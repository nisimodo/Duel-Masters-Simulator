// ドギラゴン・ガチャ / ドキンダム・ガチャ (2016年の製品付属のチェックカード)
// ルーレットで 1〜6 のどれかが出て、その能力を使う。

export type GachaKind = 'dogiragon' | 'dokindam';

export interface GachaFace {
  /** 目の名前 (①加速 など) */
  label: string;
  /** 能力の文 */
  effect: string;
}

export const GACHA: Record<GachaKind, { name: string; image: string; faces: GachaFace[] }> = {
  dogiragon: {
    name: 'ドギラゴン・ガチャ',
    image: 'gacha/dogiragon.jpg',
    faces: [
      { label: '①加速', effect: '自分の山札の上から1枚目をマナゾーンに置く。' },
      { label: '②補充', effect: 'カードを1枚引く。' },
      { label: '③打撃', effect: 'このターン、自分のクリーチャー1体はシールドをさらに1つブレイクする。' },
      { label: '④破壊', effect: '相手のコスト7以下のクリーチャーを1体、破壊する。' },
      { label: '⑤格闘', effect: '自分と相手のクリーチャーを1体ずつ選び、バトルさせる。' },
      { label: '⑥出撃', effect: '進化ではないクリーチャーを1体、自分のマナゾーンからバトルゾーンに出す。' },
    ],
  },
  dokindam: {
    name: 'ドキンダム・ガチャ',
    image: 'gacha/dokindam.jpg',
    faces: [
      { label: '①墓地', effect: '自分の山札の上から3枚を墓地に置く。' },
      { label: '②補充', effect: 'カードを1枚引く。' },
      { label: '③回収', effect: 'クリーチャーを1体、自分の墓地から手札に戻す。' },
      { label: '④忘却', effect: '相手は自身の手札を1枚選び、捨てる。' },
      { label: '⑤衰弱', effect: '相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを-9000する。' },
      { label: '⑥復活', effect: '進化ではないクリーチャーを1体、自分の墓地からバトルゾーンに出す。' },
    ],
  },
};

/** チェックカード画像の上での各行の位置 (縦の中心 %, 高さ %) */
export const GACHA_ROWS: { top: number; height: number }[] = [26.3, 39.0, 51.8, 64.5, 77.2, 89.9].map((c) => ({ top: c - 5.8, height: 11.6 }));
