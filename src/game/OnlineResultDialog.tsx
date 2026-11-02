// オンライン対戦の結果を画像にする (プレイヤー名・デッキ名・サムネイル・順位 (デュエマは勝敗)・勝因・敗因)
import { useCallback } from 'react';
import { ResultImageDialog } from '../components/ResultImageDialog';
import type { Room } from '../data/api';
import type { CardDB } from '../lib/cards';
import { isModoki } from '../lib/deck';
import { renderOnlineResultImage, type ImageShape, type OnlineEntry } from '../lib/resultImage';
import type { GameState } from '../engine/types';

/**
 * プレイヤー p が負けた理由をログから探す (「○○ の敗北 (理由)」)。
 * ダイレクトアタックで負けた時は、とどめを刺したクリーチャーの名前も付ける
 */
function lossReason(s: GameState, p: number): string | null {
  const head = `${s.players[p].name} の敗北 (`;
  let k = s.log.length - 1;
  while (k >= 0 && !(s.log[k].p === p && s.log[k].m.startsWith(head))) k--;
  // (古いログは消えているので、最後に負けたプレイヤーは決着の理由を使う)
  if (k < 0) return s.players[p].place === 2 || (s.players[p].lost && s.players.filter((x) => x.lost).length === 1) ? s.endReason || null : null;
  const reason = s.log[k].m.slice(head.length).replace(/\)$/, '');
  if (/ダイレクトアタック/.test(reason))
    for (let i = k - 1; i >= 0; i--) {
      const m = s.log[i].m.match(/^《(.+?)》 のダイレクトアタック！/);
      if (m) return `《${m[1]}》のダイレクトアタック`;
    }
  return reason;
}

export function OnlineResultDialog({ db, s, room, onClose }: { db: CardDB; s: GameState; room: Room; onClose: () => void }) {
  const make = useCallback(
    (shape: ImageShape, timeoutMs: number) => {
      // 勝ったプレイヤーの勝因は、最後に負けたプレイヤー (2位) の敗因
      const last = s.players.findIndex((pl) => pl.place === 2);
      const entries: OnlineEntry[] = s.players
        .map((pl, i) => {
          const place = pl.place ?? (s.winners.includes(i) ? 1 : null);
          return {
            name: pl.name,
            cpu: pl.cpu,
            // 対戦に使ったデッキ (CPU はルームに追加した時のデッキ)
            deck: (pl.cpu ? room.cpus[pl.uid.replace(/^cpu:/, '')]?.deck : room.members[pl.uid]?.deck) ?? null,
            place,
            reason: place === 1 ? (last >= 0 ? lossReason(s, last) : s.endReason || null) : pl.lost ? lossReason(s, i) : null,
          };
        })
        .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
      const mode = room.rules.mode === 'duema' ? 'デュエマ' : isModoki(room.rules) ? 'デュエパもどき' : 'デュエパ';
      return renderOnlineResultImage(db, entries, { mode, duema: s.mode === 'duema', reason: s.endReason, turns: s.turn }, shape, timeoutMs);
    },
    [db, s, room],
  );
  return <ResultImageDialog make={make} name="duema-result" shape={s.players.length > 3 ? 'portrait' : 'landscape'} onClose={onClose} />;
}
