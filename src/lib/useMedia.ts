import { useEffect, useState } from 'react';

/** CSS メディアクエリに一致するか (画面幅の変化・端末の回転に追従) */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** スマホ・タブレット縦向きなど、2カラムが窮屈な幅 (スマホ横向きは2カラムのまま) */
export const NARROW = '(max-width: 900px) and (orientation: portrait), (max-width: 600px)';
