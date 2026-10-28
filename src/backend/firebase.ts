// Firebase (Authentication + Realtime Database) 実装
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  get,
  getDatabase,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
  query,
  orderByKey,
} from 'firebase/database';
import type { AuthUser, Backend } from './types';

// Firebase は undefined を書き込めないので除去する
const strip = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function createFirebaseBackend(config: FirebaseOptions): Backend {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);
  const r = (p: string) => ref(db, p);

  return {
    kind: 'firebase',
    onAuth(cb) {
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return cb(null);
        const user: AuthUser = { uid: u.uid, name: u.displayName || 'プレイヤー' };
        // 表示名は users/{uid}/name を優先
        try {
          const snap = await get(r(`users/${u.uid}/name`));
          if (snap.exists()) user.name = snap.val();
        } catch {
          /* ignore */
        }
        cb(user);
      });
    },
    async signIn() {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async signOut() {
      await signOut(auth);
    },
    async get(path) {
      const s = await get(r(path));
      return s.exists() ? s.val() : null;
    },
    async set(path, value) {
      await set(r(path), strip(value));
    },
    async update(path, values) {
      await update(r(path), strip(values));
    },
    async remove(path) {
      await remove(r(path));
    },
    newKey(path) {
      return push(r(path)).key!;
    },
    async transaction(path, fn) {
      const res = await runTransaction(
        r(path),
        (cur) => {
          const v = fn(cur);
          return v === undefined ? undefined : strip(v);
        },
        { applyLocally: false },
      );
      return { committed: res.committed, value: res.snapshot.val() };
    },
    subscribe(path, cb, onError) {
      return onValue(
        r(path),
        (s) => cb(s.exists() ? s.val() : null),
        (e) => {
          console.error(`読み込めませんでした: ${path}`, e);
          onError?.(e);
        },
      );
    },
    onChildAdded(path, cb) {
      return onChildAdded(query(r(path), orderByKey()), (s) => cb(s.key!, s.val()));
    },
    async onDisconnectSet(path, value) {
      await onDisconnect(r(path)).set(strip(value));
    },
    async cancelOnDisconnect(path) {
      await onDisconnect(r(path)).cancel();
    },
  };
}
