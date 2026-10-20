// 対戦の同期: games/{id}/init (初期状態) と games/{id}/actions/{n} (アクション列) を全員で共有し、
// 各クライアントが同じ順番でエンジンに適用する (ロックステップ)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from '../backend';
import type { CardDB } from '../lib/cards';
import { applyAction, createGame, type Lookup } from '../engine/engine';
import type { Action, ActionEnvelope, GameInit, GameState } from '../engine/types';

/** Firebase は配列を {0:..,1:..} のオブジェクトで返すことがあるので配列に直す */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (v && typeof v === 'object')
    return Object.keys(v)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, T>)[k]);
  return [];
}

/** DB経由で消える空配列などを補う */
function normalizeAction(a: Action): Action {
  const x = { ...a } as Record<string, unknown>;
  for (const k of ['pay', 'evo', 'shields']) if (k in x || (k === 'pay' && a.t === 'play') || (k === 'shields' && a.t === 'breakSel')) x[k] = asArray(x[k]);
  return x as unknown as Action;
}

export function useGameSync(gameId: string | null, db: CardDB) {
  const [init, setInit] = useState<GameInit | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<{ state: GameState | null; count: number; buffer: Map<number, ActionEnvelope> }>({
    state: null,
    count: 0,
    buffer: new Map(),
  });
  const L: Lookup = useCallback((cid: string) => db.byId.get(cid), [db]);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    ref.current = { state: null, count: 0, buffer: new Map() };
    setState(null);
    setInit(null);
    (async () => {
      const raw = await backend.get<GameInit>(`games/${gameId}/init`);
      if (cancelled) return;
      if (!raw) {
        setError('対戦データが見つかりません');
        return;
      }
      const gi: GameInit = {
        ...raw,
        players: asArray<GameInit['players'][number]>(raw.players).map((p) => ({
          ...p,
          main: asArray<string>(p.main),
          hyper: asArray<string>(p.hyper),
          gr: asArray<string>(p.gr),
          partner: p.partner ?? null,
        })),
      };
      setInit(gi);
      ref.current.state = createGame(gi, L);
      setState(ref.current.state);
      unsub = backend.onChildAdded<ActionEnvelope>(`games/${gameId}/actions`, (key, env) => {
        const r = ref.current;
        const n = Number(key);
        if (!Number.isFinite(n) || n < r.count) return;
        r.buffer.set(n, env);
        let changed = false;
        while (r.buffer.has(r.count)) {
          const e = r.buffer.get(r.count)!;
          r.buffer.delete(r.count);
          r.count++;
          if (r.state && e && e.a) {
            const res = applyAction(r.state, Number(e.p), normalizeAction(e.a), L);
            if (!res.error) {
              r.state = res.state;
              changed = true;
            }
          }
        }
        if (changed) setState(r.state);
      });
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [gameId, L]);

  /** アクションを送信する。エラーがあれば文字列を返す */
  const submit = useCallback(
    async (p: number, a: Action): Promise<string | null> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = ref.current;
        if (!r.state || !gameId) return '対戦が始まっていません';
        const check = applyAction(r.state, p, a, L);
        if (check.error) return check.error;
        const key = r.count;
        const res = await backend.transaction<ActionEnvelope>(`games/${gameId}/actions/${key}`, (cur) => (cur ? undefined : { p, a }));
        if (res.committed) return null;
        // 他の人が先に書き込んだ: 最新状態が届くのを待って再試行
        await new Promise((res2) => setTimeout(res2, 150 + attempt * 100));
      }
      return '送信に失敗しました。もう一度試してください';
    },
    [gameId, L],
  );

  return { init, state, submit, L, error };
}
