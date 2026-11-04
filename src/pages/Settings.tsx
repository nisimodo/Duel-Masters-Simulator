import { useEffect, useState } from 'react';
import { CardBack } from '../components/CardView';
import { useApp } from '../context';
import { saveProfile } from '../data/api';
import ImageCropper from '../components/ImageCropper';
import { loadImage } from '../lib/image';

type Kind = 'sleeve' | 'playmat';
const SPEC: Record<Kind, { label: string; w: number; h: number; q: number; viewW: number }> = {
  sleeve: { label: 'スリーブ', w: 250, h: 350, q: 0.82, viewW: 300 },
  playmat: { label: 'プレイマット', w: 1600, h: 900, q: 0.72, viewW: 640 },
};

export default function Settings() {
  const { user, profile } = useApp();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<{ kind: Kind; img: HTMLImageElement } | null>(null);
  useEffect(() => setName(profile?.name ?? user?.name ?? ''), [profile, user]);
  if (!user) return null;

  // ファイルを選ぶ → 切り抜きダイアログ → 保存
  const pick = async (kind: Kind, input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ''; // 同じファイルを選び直せるように
    if (!file) return;
    setMsg('');
    try {
      setCrop({ kind, img: await loadImage(file) });
    } catch (e) {
      setMsg(String((e as Error).message || e));
    }
  };
  const closeCrop = () => {
    if (crop) URL.revokeObjectURL(crop.img.src);
    setCrop(null);
  };
  const upload = async (kind: Kind, data: string) => {
    closeCrop();
    setBusy(true);
    setMsg('');
    try {
      await saveProfile(user.uid, { [kind]: data });
      setMsg(`${SPEC[kind].label}を設定しました (${Math.round(data.length / 1024)}KB)`);
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
        <p className="small muted">カードの裏面に表示されます。対戦相手にも見えます。画像を選ぶと縦横比 5:7 で切り抜く範囲を選べます。</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <CardBack sleeve={profile?.sleeve} width={100} />
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => pick('sleeve', e.target)} />
          {profile?.sleeve && (
            <button className="small danger" onClick={() => saveProfile(user.uid, { sleeve: null })}>
              デフォルトに戻す
            </button>
          )}
        </div>
      </div>

      <div className="panel col">
        <h3>プレイマット</h3>
        <p className="small muted">対戦画面の自分のエリアの背景に表示されます。画像を選ぶと 16:9 で切り抜く範囲を選べます。</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div
            style={{
              width: 320,
              maxWidth: '100%',
              aspectRatio: '16 / 9',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: profile?.playmat ? `center/cover url(${profile.playmat})` : 'var(--bg3)',
            }}
          />
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => pick('playmat', e.target)} />
          {profile?.playmat && (
            <button className="small danger" onClick={() => saveProfile(user.uid, { playmat: null })}>
              なしにする
            </button>
          )}
        </div>
      </div>
      {busy && <div className="muted">処理中…</div>}
      {msg && <div className="ok">{msg}</div>}
      {crop && (
        <ImageCropper
          img={crop.img}
          title={`${SPEC[crop.kind].label}の切り抜き`}
          outW={SPEC[crop.kind].w}
          outH={SPEC[crop.kind].h}
          quality={SPEC[crop.kind].q}
          maxViewW={SPEC[crop.kind].viewW}
          onCancel={closeCrop}
          onDone={(data) => upload(crop.kind, data)}
        />
      )}
    </div>
  );
}
