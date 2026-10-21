// 開発用: ガチャのルーレット表示の確認ページ (#/dev/gacha)
import { useState } from 'react';
import { GachaRoulette, type GachaSpin } from './GachaRoulette';

export default function GachaPreview() {
  const [spin, setSpin] = useState<GachaSpin | null>(null);
  const go = (kind: GachaSpin['kind']) => setSpin({ kind, roll: Math.floor(Math.random() * 6), playerName: 'テスト' });
  return (
    <div style={{ padding: 16 }}>
      <button onClick={() => go('dogiragon')}>ドギラゴン・ガチャを回す</button> <button onClick={() => go('dokindam')}>ドキンダム・ガチャを回す</button>
      {spin && <GachaRoulette spin={spin} onDone={() => setSpin(null)} />}
    </div>
  );
}
