// ローカルモード: Firebase を設定していなくても、同じブラウザの複数タブ間で動作確認できる。
// データは localStorage、タブ間通知は BroadcastChannel。ユーザーはタブごとに別人になる。
import type { AuthUser, Backend, TxResult } from './types';

const KEY = 'duema-local-db';
const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('duema-local') : null;

type Tree = Record<string, unknown>;

function load(): Tree {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function save(t: Tree) {
  localStorage.setItem(KEY, JSON.stringify(t));
}

const split = (p: string) => p.split('/').filter(Boolean);

function getAt(t: unknown, path: string): unknown {
  let cur = t;
  for (const k of split(path)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Tree)[k];
  }
  return cur ?? null;
}

function clean(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    const arr = v.map(clean);
    return arr.length ? arr : null;
  }
  if (v && typeof v === 'object') {
    const o: Tree = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c != null) o[k] = c;
    }
    return Object.keys(o).length ? o : null;
  }
  return v;
}

function setAt(t: Tree, path: string, value: unknown) {
  const ks = split(path);
  if (!ks.length) return;
  let cur: Tree = t;
  for (const k of ks.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Tree;
  }
  const v = clean(value);
  if (v == null) delete cur[ks[ks.length - 1]];
  else cur[ks[ks.length - 1]] = v;
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
chan?.addEventListener('message', notify);
window.addEventListener('storage', (e) => {
  if (e.key === KEY) notify();
});

function write(fn: (t: Tree) => void) {
  const t = load();
  fn(t);
  save(t);
  chan?.postMessage('changed');
  queueMicrotask(notify);
}

function uidForTab(): string {
  let id = sessionStorage.getItem('duema-local-uid');
  if (!id) {
    id = 'local-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('duema-local-uid', id);
  }
  return id;
}

const authListeners = new Set<(u: AuthUser | null) => void>();
function currentUser(): AuthUser | null {
  const name = sessionStorage.getItem('duema-local-name');
  return name ? { uid: uidForTab(), name } : null;
}

// 切断(タブを閉じた)時の処理
const disconnectOps = new Map<string, unknown>();
window.addEventListener('beforeunload', () => {
  if (!disconnectOps.size) return;
  const t = load();
  for (const [p, v] of disconnectOps) setAt(t, p, v);
  save(t);
  chan?.postMessage('changed');
});

let keyCounter = 0;

export const localBackend: Backend = {
  kind: 'local',
  onAuth(cb) {
    authListeners.add(cb);
    cb(currentUser());
    return () => authListeners.delete(cb);
  },
  async signIn(name) {
    sessionStorage.setItem('duema-local-name', name || 'プレイヤー');
    const u = currentUser();
    authListeners.forEach((l) => l(u));
  },
  async signOut() {
    sessionStorage.removeItem('duema-local-name');
    authListeners.forEach((l) => l(null));
  },
  async get<T>(path: string) {
    return getAt(load(), path) as T | null;
  },
  async set(path, value) {
    write((t) => setAt(t, path, value));
  },
  async update(path, values) {
    write((t) => {
      for (const [k, v] of Object.entries(values)) setAt(t, `${path}/${k}`, v);
    });
  },
  async remove(path) {
    write((t) => setAt(t, path, null));
  },
  newKey() {
    return Date.now().toString(36) + (keyCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
  },
  async transaction<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TxResult<T>> {
    const t = load();
    const cur = getAt(t, path) as T | null;
    const next = fn(cur == null ? null : structuredClone(cur));
    if (next === undefined) return { committed: false, value: cur };
    setAt(t, path, next);
    save(t);
    chan?.postMessage('changed');
    queueMicrotask(notify);
    return { committed: true, value: next };
  },
  subscribe<T>(path: string, cb: (v: T | null) => void) {
    let last = '';
    const fire = () => {
      const v = getAt(load(), path);
      const s = JSON.stringify(v);
      if (s === last) return;
      last = s;
      cb(v as T | null);
    };
    listeners.add(fire);
    fire();
    return () => {
      listeners.delete(fire);
    };
  },
  onChildAdded<T>(path: string, cb: (key: string, v: T) => void) {
    const seen = new Set<string>();
    const fire = () => {
      const v = (getAt(load(), path) || {}) as Record<string, T>;
      const keys = Object.keys(v).filter((k) => !seen.has(k));
      keys.sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : 1));
      for (const k of keys) {
        seen.add(k);
        cb(k, v[k]);
      }
    };
    listeners.add(fire);
    fire();
    return () => {
      listeners.delete(fire);
    };
  },
  async onDisconnectSet(path, value) {
    disconnectOps.set(path, value);
  },
  async cancelOnDisconnect(path) {
    disconnectOps.delete(path);
  },
};
