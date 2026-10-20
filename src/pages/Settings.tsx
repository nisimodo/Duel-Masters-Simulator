import { useEffect, useState } from 'react';
import { CardBack } from '../components/CardView';
import { useApp } from '../context';
import { saveProfile } from '../data/api';
import { resizeImage } from '../lib/image';

export default function Settings() {
  const { user, profile } = useApp();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(profile?.name ?? user?.name ?? ''), [profile, user]);
  if (!user) return null;

  const upload = async (kind: 'sleeve' | 'playmat', file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const data = kind === 'sleeve' ? await resizeImage(file, 250, 350, 0.82) : await resizeImage(file, 1600, 900, 0.72);
      await saveProfile(user.uid, { [kind]: data });
      setMsg(`${kind === 'sleeve' ? 'スリーブ' : 'プレイマット'}を設定しました (${Math.round(data.length / 1024)}KB)`);
    } catch (e) {
      setMsg(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page col">
      <div className="panel col">
        <h3>プレイヤー名</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          <button className="primary" disabled={!name.trim()} onClick={() => saveProfile(user.uid, { name: name.trim() }).then(() => setMsg('名前を保存しました'))}>
            保存
          </button>
        </div>
      </div>

      <div className="panel col">
        <h3>スリーブ</h3>
        <p className="small muted">カードの裏面に表示されます。対戦相手にも見えます。画像は縦横比 5:7 に切り抜かれます。</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <CardBack sleeve={profile?.sleeve} width={100} />
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => upload('sleeve', e.target.files?.[0])} />
          {profile?.sleeve && (
            <button className="small danger" onClick={() => saveProfile(user.uid, { sleeve: null })}>
              デフォルトに戻す
            </button>
          )}
        </div>
      </div>

      <div className="panel col">
        <h3>プレイマット</h3>
        <p className="small muted">対戦画面の自分のエリアの背景に表示されます。画像は 16:9 に切り抜かれます。</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div
            style={{
              width: 320,
              height: 180,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: profile?.playmat ? `center/cover url(${profile.playmat})` : 'var(--bg3)',
            }}
          />
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => upload('playmat', e.target.files?.[0])} />
          {profile?.playmat && (
            <button className="small danger" onClick={() => saveProfile(user.uid, { playmat: null })}>
              なしにする
            </button>
          )}
        </div>
      </div>
      {busy && <div className="muted">処理中…</div>}
      {msg && <div className="ok">{msg}</div>}
    </div>
  );
}
