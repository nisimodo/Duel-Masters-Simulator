import { firebaseConfig } from '../firebaseConfig';
import { createFirebaseBackend } from './firebase';
import { localBackend } from './local';
import type { Backend } from './types';

// 開発サーバーで http://localhost:5173/?local を開くとローカルモードで動作確認できる (公開サイトには影響しない)
const forceLocal = import.meta.env.DEV && new URLSearchParams(location.search).has('local');
const configured = !!(firebaseConfig.apiKey && firebaseConfig.databaseURL);

export const backend: Backend = configured && !forceLocal ? createFirebaseBackend(firebaseConfig) : localBackend;

export type { AuthUser, Backend } from './types';
