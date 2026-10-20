// プロフィール・デッキ・ルームの読み書き
import { backend } from '../backend';
import type { Deck, DeckType, RoomRules } from '../lib/deck';

// Firebase のキーに使えない文字をエスケープ
const encKey = (k: string) => k.replace(/[.#$[\]/%]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const decKey = (k: string) => k.replace(/%([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const encMap = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [encKey(k), v]));
const decMap = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [decKey(k), v]));

export function encodeDeck(d: Deck) {
  return { ...d, main: encMap(d.main), hyper: encMap(d.hyper), gr: encMap(d.gr), partner: d.partner ?? null };
}
export function decodeDeck(id: string, d: Partial<Deck> | null): Deck {
  return {
    id,
    name: d?.name ?? '無題',
    type: (d?.type as DeckType) ?? 'duema',
    main: decMap(d?.main),
    hyper: decMap(d?.hyper),
    gr: decMap(d?.gr),
    partner: d?.partner ?? null,
    updatedAt: d?.updatedAt ?? 0,
  };
}

// ---------- プロフィール ----------
export interface Profile {
  name: string;
  sleeve?: string | null;
  playmat?: string | null;
}

export const profilePath = (uid: string) => `users/${uid}`;

export async function saveProfile(uid: string, p: Partial<Profile>) {
  await backend.update(profilePath(uid), p as Record<string, unknown>);
}

// ---------- デッキ ----------
export function subscribeDecks(uid: string, cb: (decks: Deck[]) => void) {
  return backend.subscribe<Record<string, Deck>>(`decks/${uid}`, (v) => {
    const list = Object.entries(v || {}).map(([id, d]) => decodeDeck(id, d));
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    cb(list);
  });
}

export async function getDecks(uid: string): Promise<Deck[]> {
  const v = await backend.get<Record<string, Deck>>(`decks/${uid}`);
  return Object.entries(v || {}).map(([id, d]) => decodeDeck(id, d));
}

export async function saveDeck(uid: string, deck: Deck): Promise<string> {
  const id = deck.id || backend.newKey(`decks/${uid}`);
  const { id: _omit, ...rest } = { ...deck, updatedAt: Date.now() };
  void _omit;
  await backend.set(`decks/${uid}/${id}`, encodeDeck(rest as Deck));
  return id;
}

export async function deleteDeck(uid: string, id: string) {
  await backend.remove(`decks/${uid}/${id}`);
}

// ---------- ルーム ----------
export type Role = 'player' | 'spectator';

export interface Member {
  name: string;
  role: Role;
  ready: boolean;
  online: boolean;
  joinedAt: number;
  deckId?: string | null;
  deck?: Deck | null;
}

export interface CpuMember {
  name: string;
  addedBy: string;
  deck: Deck;
  addedAt: number;
}

export interface RoomResult {
  winners: string[];
  names: Record<string, string>;
  reason: string;
  at: number;
}

export interface Room {
  key: string;
  rules: RoomRules;
  hostUid: string;
  status: 'lobby' | 'playing';
  createdAt: number;
  members: Record<string, Member>;
  cpus: Record<string, CpuMember>;
  gameId: string | null;
  lastResult: RoomResult | null;
}

export const MAX_PLAYERS: Record<DeckType, number> = { duema: 2, duepa: 5 };

export async function roomKeyFromPassword(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('duema:' + pw.trim()));
  return [...new Uint8Array(buf)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function decodeRoom(key: string, v: Partial<Room> | null): Room | null {
  if (!v || !v.rules) return null;
  const members: Record<string, Member> = {};
  for (const [uid, m] of Object.entries(v.members || {})) {
    members[uid] = { ...m, deck: m.deck ? decodeDeck(m.deck.id || 'x', m.deck) : null };
  }
  const cpus: Record<string, CpuMember> = {};
  for (const [id, c] of Object.entries(v.cpus || {})) cpus[id] = { ...c, deck: decodeDeck(c.deck?.id || 'cpu', c.deck) };
  return {
    key,
    rules: v.rules,
    hostUid: v.hostUid || '',
    status: v.status || 'lobby',
    createdAt: v.createdAt || 0,
    members,
    cpus,
    gameId: v.gameId ?? null,
    lastResult: v.lastResult ?? null,
  };
}

export function playerCount(room: Room) {
  return Object.values(room.members).filter((m) => m.role === 'player').length + Object.keys(room.cpus).length;
}

export async function hasDeckOfType(uid: string, type: DeckType) {
  return (await getDecks(uid)).some((d) => d.type === type);
}

const STALE_MS = 1000 * 60 * 60 * 6;

export async function createRoom(uid: string, name: string, password: string, rules: RoomRules): Promise<string> {
  if (!password.trim()) throw new Error('パスワードを入力してください');
  if (!(await hasDeckOfType(uid, rules.mode)))
    throw new Error(rules.mode === 'duema' ? 'デュエマ用のデッキを作成してください' : 'デュエパ用のデッキを作成してください');
  const key = await roomKeyFromPassword(password);
  const now = Date.now();
  const res = await backend.transaction<Record<string, unknown>>(`rooms/${key}`, (cur) => {
    const c = cur as Partial<Room> | null;
    if (c && c.members && Object.values(c.members).some((m) => m.online) && now - (c.createdAt || 0) < STALE_MS * 4) return undefined;
    return {
      rules,
      hostUid: uid,
      status: 'lobby',
      createdAt: now,
      members: { [uid]: { name, role: 'player', ready: false, online: true, joinedAt: now } },
    };
  });
  if (!res.committed) throw new Error('このパスワードのルームは既に使われています。別のパスワードにしてください');
  return key;
}

export async function joinRoom(uid: string, name: string, password: string): Promise<string> {
  const key = await roomKeyFromPassword(password);
  await enterRoom(uid, name, key);
  return key;
}

/** ルームに入る (既に居る場合はオンライン状態に戻す) */
export async function enterRoom(uid: string, name: string, key: string) {
  const room = decodeRoom(key, await backend.get(`rooms/${key}`));
  if (!room) throw new Error('ルームが見つかりません');
  const me = room.members[uid];
  if (me) {
    await backend.update(`rooms/${key}/members/${uid}`, { online: true, name });
  } else {
    if (!(await hasDeckOfType(uid, room.rules.mode)))
      throw new Error(room.rules.mode === 'duema' ? 'デュエマ用のデッキを作成してから入室してください' : 'デュエパ用のデッキを作成してから入室してください');
    const full = playerCount(room) >= MAX_PLAYERS[room.rules.mode];
    const role: Role = room.status === 'playing' || full ? 'spectator' : 'player';
    await backend.set(`rooms/${key}/members/${uid}`, { name, role, ready: false, online: true, joinedAt: Date.now() });
  }
  await backend.onDisconnectSet(`rooms/${key}/members/${uid}/online`, false);
}

export async function leaveRoom(uid: string, room: Room) {
  await backend.cancelOnDisconnect(`rooms/${room.key}/members/${uid}/online`);
  const others = Object.entries(room.members).filter(([id]) => id !== uid);
  if (!others.length) {
    await backend.remove(`rooms/${room.key}`);
    if (room.gameId) await backend.remove(`games/${room.gameId}`);
    return;
  }
  const updates: Record<string, unknown> = { [`members/${uid}`]: null };
  if (room.hostUid === uid) {
    const next = others.find(([, m]) => m.online) ?? others[0];
    updates.hostUid = next[0];
  }
  await backend.update(`rooms/${room.key}`, updates);
}

export async function updateMember(key: string, uid: string, values: Partial<Member>) {
  await backend.update(`rooms/${key}/members/${uid}`, values as Record<string, unknown>);
}

export async function addCpu(room: Room, by: string, deck: Deck) {
  const id = backend.newKey(`rooms/${room.key}/cpus`);
  const n = Object.keys(room.cpus).length + 1;
  await backend.set(`rooms/${room.key}/cpus/${id}`, { name: `CPU ${n}`, addedBy: by, deck: encodeDeck(deck), addedAt: Date.now() });
}

export async function removeCpu(room: Room, id: string) {
  await backend.remove(`rooms/${room.key}/cpus/${id}`);
}

export function subscribeRoom(key: string, cb: (r: Room | null) => void) {
  return backend.subscribe<Partial<Room>>(`rooms/${key}`, (v) => cb(decodeRoom(key, v)));
}
