import { Link } from 'react-router-dom';
import { backend } from '../backend';
import { useApp } from '../context';

export default function Home() {
  const { user, db } = useApp();
  return (
    <div className="page col">
      <h2>ようこそ、{user?.name} さん</h2>
      <div className="menu-grid">
        <Link className="menu-card" to="/play/duema">
          <h3>オンラインデュエマ</h3>
          <div className="muted">パスワードでルームを作って1対1で対戦・観戦。CPU戦もできます。</div>
        </Link>
        <Link className="menu-card" to="/play/duepa">
          <h3>オンラインデュエパ</h3>
          <div className="muted">2～5人で遊ぶデュエパーティー。CPUの追加もできます。</div>
        </Link>
        <Link className="menu-card" to="/decks">
          <h3>デッキ編成</h3>
          <div className="muted">デュエマ(40枚)・デュエパ(60枚)のデッキを作成・保存します。</div>
        </Link>
        <Link className="menu-card" to="/settings">
          <h3>設定</h3>
          <div className="muted">プレイヤー名・スリーブ・プレイマットを設定します。</div>
        </Link>
      </div>
      <p className="muted small">
        収録カード {db?.cards.length.toLocaleString()} 種類 (データ作成日 {db?.builtAt ? new Date(db.builtAt).toLocaleDateString() : "-"}) /{' '}
        {backend.kind === 'local' ? 'ローカルモード' : 'オンライン'}
      </p>
      <p className="muted small">カード画像・テキストの著作権はタカラトミー等の権利者に帰属します。個人的な遊び用の非公開サイトです。</p>
    </div>
  );
}
