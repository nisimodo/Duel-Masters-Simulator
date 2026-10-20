import { firebaseConfig } from '../firebaseConfig';
import { createFirebaseBackend } from './firebase';
import { localBackend } from './local';
import type { Backend } from './types';

export const backend: Backend = firebaseConfig.apiKey && firebaseConfig.databaseURL ? createFirebaseBackend(firebaseConfig) : localBackend;

export type { AuthUser, Backend } from './types';
