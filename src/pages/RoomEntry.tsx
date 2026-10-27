import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context';
import { createRoom, joinRoom, MAX_PLAYERS, playerCount, subscribeRooms, type Room } from '../data/api';
import { FormatBadge } from '../components/DeckGrid';
import type { DeckType, RoomRules } from '../lib/deck';

function ago(t: number) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'たった今' : m < 60 ? `${m}分前` : `${Math.floor(m / 60)}時間前`;
}

/** 開いているルームの一覧。押すとそのルームに入る */
function RoomList({ mode, uid }: { mode: DeckType; uid: string }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const nav = useNavigate();
  useEffect(() => subscribeRooms(setRooms), []);
  const list = (rooms ?? []).filter((r) => r.rules.mode === mode);
  return (
    <div className="panel col">
      <h3>ルーム一覧</h3>
      {rooms == null && <div className="muted small">読み込み中…</div>}
      {rooms != null && !list.length && <div className="muted small">開いているルームはありません</div>}
      <div className="room-list">
        {list.map((r) => {
          const host = r.members[r.hostUid]?.name ?? '?';
          const n = playerCount(r);
          const max = MAX_PLAYERS[r.rules.mode];
          const spectators = Object.values(r.members).filter((m) => m.role === 'spectator').length;
          const inRoom = !!r.members[uid];
          const label = inRoom ? '戻る' : r.status === 'playing' || n >= max ? '観戦で入る' : '入る';
          return (
            <div key={r.key} className="room-row">
              <span className={`badge${r.status === 'playing' ? ' hof' : ''}`}>{r.status === 'playing' ? '対戦中' : '待機中'}</span>
              <b>{host} のルーム</b>
              {r.rules.mode === 'duema' && (
                <>
                  <FormatBadge format={r.rules.format} />
                  <span className="badge">{r.rules.hof === 'zero' ? '殿堂ゼロ' : '通常ルール'}</span>
                </>
              )}
              <span className="small muted grow">
                対戦 {n}/{max}
                {Object.keys(r.cpus).length ? ` (CPU${Object.keys(r.cpus).length})` : ''} ・ 観戦 {spectators} ・ {ago(r.createdAt)}
              </span>
              <button className={inRoom ? '' : 'primary'} onClick={() => nav(`/room/${r.key}`)}>
                {label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RoomEntry() {
  const { mode: modeParam } = useParams();
  const mode: DeckType = modeParam === 'duepa' ? 'duepa' : 'duema';
  const { user } = useApp();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [hof, setHof] = useState<RoomRules['hof']>('normal');
  const [format, setFormat] = useState<RoomRules['format']>('advance');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setErr('');
    try {
      const key = await fn();
      nav(`/room/${key}`);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page col" style={{ maxWidth: 640 }}>
      <h2>{mode === 'duema' ? 'オンラインデュエマ' : 'オンラインデュエパ'}</h2>
      <RoomList mode={mode} uid={user.uid} />
      <div className="panel col">
        <h3>ルームを作る</h3>
        <input placeholder="パスワード (友達に伝えてください)" value={pw} onChange={(e) => setPw(e.target.value)} />
        {mode === 'duema' && (
          <>
            <div className="row">
              <b style={{ width: 90 }}>殿堂</b>
              <label>
                <input type="radio" checked={hof === 'normal'} onChange={() => setHof('normal')} /> 通常ルール
              </label>
              <label>
                <input type="radio" checked={hof === 'zero'} onChange={() => setHof('zero')} /> 殿堂ゼロ
              </label>
            </div>
            <div className="row">
              <b style={{ width: 90 }}>フォーマット</b>
              <label>
                <input type="radio" checked={format === 'advance'} onChange={() => setFormat('advance')} /> アドバンス
              </label>
              <label>
                <input type="radio" checked={format === 'original'} onChange={() => setFormat('original')} /> オリジナル
              </label>
            </div>
            <p className="small muted">
              殿堂ゼロ: 殿堂入り・プレミアム殿堂の制限なし (同名4枚まで)。オリジナル: 超次元・超GRゾーンとゲーム開始時に置かれるカードを使用しない。
            </p>
          </>
        )}
        {mode === 'duepa' && <p className="small muted">デュエパーティー公式ルール (60枚ハイランダー・パートナー・初期手札/シールド6枚) で遊びます。</p>}
        <button className="primary" disabled={busy || !pw.trim()} onClick={() => run(() => createRoom(user.uid, user.name, pw, { mode, hof, format }))}>
          作成して入室
        </button>
      </div>
      <div className="panel col">
        <h3>ルームに入る</h3>
        <p className="small muted">友達から聞いたパスワードを入力するか、上のルーム一覧から選んでください。対戦中のルームに入った場合は観戦になります。</p>
        <div className="row">
          <input className="grow" placeholder="パスワード" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="primary" disabled={busy || !pw.trim()} onClick={() => run(() => joinRoom(user.uid, user.name, pw))}>
            入室
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
