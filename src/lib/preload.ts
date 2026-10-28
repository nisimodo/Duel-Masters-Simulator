// カード画像を先に読み込んでおく (引いた・出した時にすぐ表示できるように)
import { cardImage, type Card } from './cards';

const done = new Set<string>();

/** 画像のURLを順に読み込む (同時に読み込む数を絞って、表示中の画像の読み込みを邪魔しない) */
export function preloadCardImages(cards: Card[], concurrency = 6): () => void {
  const urls: string[] = [];
  for (const c of cards)
    c.faces.forEach((_, fi) => {
      // 裏面に別の画像があるカード (サイキック等) は両面とも
      const u = cardImage(c, fi);
      if (!done.has(u) && !urls.includes(u)) urls.push(u);
    });
  let stopped = false;
  let next = 0;
  const pump = () => {
    if (stopped || next >= urls.length) return;
    const u = urls[next++];
    const img = new Image();
    // (画面の <img> と同じく参照元を送らない。同じ画像としてキャッシュから使われる)
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const fin = () => {
      done.add(u);
      pump();
    };
    img.onload = fin;
    img.onerror = fin;
    img.src = u;
  };
  for (let i = 0; i < concurrency; i++) pump();
  return () => {
    stopped = true;
  };
}
