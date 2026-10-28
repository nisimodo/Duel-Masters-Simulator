// パスベースのリアルタイムDBインターフェース (Firebase Realtime Database 互換の最小セット)

export interface AuthUser {
  uid: string;
  name: string;
}

export interface TxResult<T> {
  committed: boolean;
  value: T | null;
}

export interface Backend {
  kind: 'firebase' | 'local';
  // --- 認証 ---
  onAuth(cb: (u: AuthUser | null) => void): () => void;
  signIn(name?: string): Promise<void>;
  signOut(): Promise<void>;
  // --- DB ---
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** path を基準にした相対パス -> 値 のマルチパス更新 (null で削除) */
  update(path: string, values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  newKey(path: string): string;
  transaction<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TxResult<T>>;
  /** onError: 読めなかった時 (権限がない等) */
  subscribe<T = unknown>(path: string, cb: (v: T | null) => void, onError?: (e: Error) => void): () => void;
  /** 子要素が追加された時に通知 (数値キーは昇順) */
  onChildAdded<T = unknown>(path: string, cb: (key: string, v: T) => void): () => void;
  /** 切断時にこのパスへ値をセット */
  onDisconnectSet(path: string, value: unknown): Promise<void>;
  cancelOnDisconnect(path: string): Promise<void>;
}
