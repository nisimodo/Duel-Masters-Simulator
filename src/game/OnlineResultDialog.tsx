// オンライン対戦の結果を画像にする (プレイヤー名・デッキ名・サムネイル・順位)
import { useCallback } from 'react';
import { ResultImageDialog } from '../components/ResultImageDialog';
import type { Room } from '../data/api';
import type { CardDB } from '../lib/cards';
import { isModoki } from '../lib/deck';
import { renderOnlineResultImage, type ImageShape, type OnlineEntry } from '../lib/resultImage';
import type { GameState } from '../engine/types';

export function OnlineResultDialog({ db, s, room, onClose }: { db: CardDB; s: GameState; room: Room; onClose: () => void }) {
  const make = useCallback(
    (shape: ImageShape, timeoutMs: number) => {
      const entries: OnlineEntry[] = s.players
        .map((pl) => ({
          name: pl.name,
          cpu: pl.cpu,
          // 対戦に使ったデッキ (CPU はルームに追加した時のデッキ)
          deck: (pl.cpu ? room.cpus[pl.uid.replace(/^cpu:/, '')]?.deck : room.members[pl.uid]?.deck) ?? null,
          place: pl.place ?? (s.winners.includes(s.players.indexOf(pl)) ? 1 : null),
        }))
        .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
      const mode = room.rules.mode === 'duema' ? 'デュエマ' : isModoki(room.rules) ? 'デュエパもどき' : 'デュエパ';
      return renderOnlineResultImage(db, entries, { mode, reason: s.endReason, turns: s.turn }, shape, timeoutMs);
    },
    [db, s, room],
  );
  return <ResultImageDialog make={make} name="duema-result" shape={s.players.length > 3 ? 'portrait' : 'landscape'} onClose={onClose} />;
}
