import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context';
import { createRoom, joinRoom } from '../data/api';
import type { DeckType, RoomRules } from '../lib/deck';

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
        <p className="small muted">友達から聞いたパスワードを入力してください。対戦中のルームに入った場合は観戦になります。</p>
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
