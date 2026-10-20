import { useState, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { backend } from './backend';
import { AppProvider, useApp } from './context';
import DeckEditor from './pages/DeckEditor';
import DeckList from './pages/DeckList';
import Home from './pages/Home';
import RoomEntry from './pages/RoomEntry';
import RoomPage from './pages/RoomPage';
import Settings from './pages/Settings';

function Login() {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const local = backend.kind === 'local';
  return (
    <div className="page" style={{ maxWidth: 480, marginTop: '10vh' }}>
      <div className="panel col">
        <h1 style={{ color: 'var(--accent)' }}>デュエマ オンライン</h1>
        <p className="muted">友達同士でデュエル・マスターズ / デュエパーティーを遊ぶためのサイトです。</p>
        {local ? (
          <>
            <p className="warn small">
              ローカルモードで動作中です (Firebase 未設定)。同じブラウザのタブ同士でのみ遊べます。タブごとに別のプレイヤーになります。
            </p>
            <input placeholder="プレイヤー名" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" disabled={!name.trim()} onClick={() => backend.signIn(name.trim())}>
              はじめる
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => backend.signIn().catch((e) => setErr(String(e.message || e)))}>
            Google でログイン
          </button>
        )}
        {err && <p className="error small">{err}</p>}
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user } = useApp();
  return (
    <>
      <div className="topbar">
        <Link to="/" className="logo">
          デュエマ オンライン
        </Link>
        <Link to="/decks">デッキ</Link>
        <Link to="/play/duema">デュエマ対戦</Link>
        <Link to="/play/duepa">デュエパ対戦</Link>
        <Link to="/settings">設定</Link>
        <span className="grow" />
        <span className="muted">{user?.name}</span>
        <button className="small" onClick={() => backend.signOut()}>
          ログアウト
        </button>
      </div>
      {children}
    </>
  );
}

function Gate() {
  const { user, authReady, db, dbError } = useApp();
  if (!authReady) return <div className="page muted">読み込み中…</div>;
  if (!user) return <Login />;
  if (dbError) return <div className="page error">カードデータの読み込みに失敗しました: {dbError}</div>;
  if (!db) return <div className="page muted">カードデータを読み込み中…</div>;
  return (
    <Routes>
      <Route path="/room/:key" element={<RoomPage />} />
      <Route
        path="*"
        element={
          <Shell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/decks" element={<DeckList />} />
              <Route path="/decks/:id" element={<DeckEditor />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/play/:mode" element={<RoomEntry />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Shell>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppProvider>
  );
}
