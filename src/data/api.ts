// プロフィール・デッキ・ルームの読み書き
import { backend } from '../backend';
import type { Deck, DeckType, RoomRules } from '../lib/deck';

// Firebase のキーに使えない文字をエスケープ
const encKey = (k: string) => k.replace(/[.#$[\]/%]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const decKey = (k: string) => k.replace(/%([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const encMap = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [encKey(k), v]));
const decMap = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [decKey(k), v]));

export function encodeDeck(d: Deck) {
  return { ...d, main: encMap(d.main), hyper: encMap(d.hyper), gr: encMap(d.gr), partner: d.partner ?? null, thumb: d.thumb ?? null, shared: d.shared ? true : null };
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
    thumb: d?.thumb ?? null,
    updatedAt: d?.updatedAt ?? 0,
    shared: !!d?.shared,
  };
}

// ---------- プロフィール ----------
export interface Profile {
  name: string;
  sleeve?: string | null;
  playmat?: string | null;
  /** お気に入りのデッキ (自分のデッキ・プリセットの id、キーはエスケープ済み) */
  favDecks?: Record<string, boolean> | null;
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

/** ownerName: 「投稿する」デッキの投稿者として出す名前 */
export async function saveDeck(uid: string, deck: Deck, ownerName?: string): Promise<string> {
  const id = deck.id || backend.newKey(`decks/${uid}`);
  const { id: _omit, ...rest } = { ...deck, updatedAt: Date.now() };
  void _omit;
  await backend.set(`decks/${uid}/${id}`, encodeDeck(rest as Deck));
  // みんなのデッキ: 投稿するなら最新の内容を載せ、しないなら取り下げる
  // (デッキの保存はできている。投稿だけ書けなかった時は SharedWriteError)
  try {
    if (rest.shared) await backend.set(sharedPath(uid, id), { uid, owner: ownerName ?? '', deck: encodeDeck({ ...(rest as Deck), shared: false }), updatedAt: rest.updatedAt });
    else await backend.remove(sharedPath(uid, id));
  } catch (e) {
    console.error('みんなのデッキに書き込めませんでした', e);
    if (rest.shared) throw new SharedWriteError(id);
  }
  return id;
}

/** デッキは保存できたが、みんなのデッキへの投稿を書き込めなかった (Firebase のルールが古い等) */
export class SharedWriteError extends Error {
  readonly deckId: string;
  constructor(deckId: string) {
    super('みんなのデッキに投稿できませんでした');
    this.deckId = deckId;
  }
}

export async function deleteDeck(uid: string, id: string) {
  await backend.remove(`decks/${uid}/${id}`);
  // (投稿していなければ消すものはない。書けなくてもデッキの削除は済んでいる)
  await backend.remove(sharedPath(uid, id)).catch((e) => console.error('みんなのデッキから取り下げられませんでした', e));
}

// ---------- みんなのデッキ (投稿されたデッキ) ----------
export interface SharedDeck {
  key: string;
  uid: string;
  owner: string;
  deck: Deck;
  updatedAt: number;
}

/** (キーの先頭が投稿者の uid なので、本人だけが書き換えられる) */
const sharedPath = (uid: string, id: string) => `shared/${uid}_${encKey(id)}`;

/** onError: 読めなかった時 (Firebase のルールに shared がない等) */
export function subscribeShared(cb: (list: SharedDeck[]) => void, onError?: (e: Error) => void) {
  return backend.subscribe<Record<string, { uid: string; owner?: string; deck: Partial<Deck>; updatedAt?: number }>>(
    'shared',
    (v) => {
      const list = Object.entries(v || {})
        .filter(([, x]) => x && x.deck)
        .map(([key, x]) => ({ key, uid: x.uid, owner: x.owner || '名無し', deck: decodeDeck(key, x.deck), updatedAt: x.updatedAt ?? 0 }));
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      cb(list);
    },
    onError,
  );
}

/** 投稿されたデッキを自分のデッキにコピーする */
export async function importSharedDeck(uid: string, s: SharedDeck): Promise<string> {
  return saveDeck(uid, { ...s.deck, id: '', shared: false });
}

// ---------- お気に入り ----------
export function favIds(p: Profile | null): Set<string> {
  return new Set(Object.entries(p?.favDecks || {}).flatMap(([k, v]) => (v ? [decKey(k)] : [])));
}

export async function setFavorite(uid: string, id: string, on: boolean) {
  if (on) await backend.set(`${profilePath(uid)}/favDecks/${encKey(id)}`, true);
  else await backend.remove(`${profilePath(uid)}/favDecks/${encKey(id)}`);
}

/** お気に入りを先に (それ以外の順番はそのまま) */
export function favFirst<T>(list: T[], favs: Set<string>, idOf: (x: T) => string): T[] {
  return [...list.filter((x) => favs.has(idOf(x))), ...list.filter((x) => !favs.has(idOf(x)))];
}

// ---------- ルーム ----------
export type Role = 'player' | 'spectator';

export interface Member {
  name: string;
  role: Role;
  ready: boolean;
  online: boolean;
  /** 開いている画面 (タブ) ごとの接続。1つでもあればオンライン (presence: 2 のメンバー) */
  conns?: Record<string, number>;
  presence?: number;
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
    // 接続ごとの記録があるメンバーは、開いているタブが1つでもあればオンライン (別のタブを閉じても退出にならない)
    const online = m.presence === 2 ? Object.keys(m.conns || {}).length > 0 : !!m.online;
    members[uid] = { ...m, online, deck: m.deck ? decodeDeck(m.deck.id || 'x', m.deck) : null };
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
    await backend.update(`rooms/${key}/members/${uid}`, { online: true, name, presence: 2 });
  } else {
    // 対戦中・満員のルームには観戦で入る (観戦ならデッキは要らない)
    const full = playerCount(room) >= MAX_PLAYERS[room.rules.mode];
    const role: Role = room.status === 'playing' || full ? 'spectator' : 'player';
    if (role === 'player' && !(await hasDeckOfType(uid, room.rules.mode)))
      throw new Error(room.rules.mode === 'duema' ? 'デュエマ用のデッキを作成してから入室してください' : 'デュエパ用のデッキを作成してから入室してください');
    await backend.set(`rooms/${key}/members/${uid}`, { name, role, ready: false, online: true, presence: 2, joinedAt: Date.now() });
  }
}

/**
 * このタブがルームを開いている間の接続を記録する (タブを閉じる・回線が切れると消える)。
 * 同じ人が別のタブ・ウィンドウでも開いていれば、そちらの接続が残るので退出にはならない。
 */
export function watchPresence(key: string, uid: string): () => void {
  const path = `rooms/${key}/members/${uid}/conns/${backend.newKey(`rooms/${key}/members/${uid}/conns`)}`;
  let stopped = false;
  // 回線が切れて戻った時も、もう一度接続を記録し直す
  const unsub = backend.subscribe<boolean>('.info/connected', (v) => {
    if (stopped || v === false) return;
    void backend.set(path, Date.now());
    void backend.onDisconnectSet(path, null);
  });
  const onHide = () => void backend.remove(path);
  window.addEventListener('pagehide', onHide);
  return () => {
    stopped = true;
    unsub();
    window.removeEventListener('pagehide', onHide);
    void backend.cancelOnDisconnect(path);
    void backend.remove(path);
  };
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

/** 開いているルームの一覧 (オンラインのメンバーがいて、古すぎないもの) */
export function subscribeRooms(cb: (rooms: Room[]) => void, onError?: (e: Error) => void) {
  return backend.subscribe<Record<string, Partial<Room>>>('rooms', (v) => {
    const now = Date.now();
    const list = Object.entries(v || {})
      .map(([k, r]) => decodeRoom(k, r))
      .filter((r): r is Room => !!r && Object.values(r.members).some((m) => m.online) && now - r.createdAt < STALE_MS * 4);
    list.sort((a, b) => b.createdAt - a.createdAt);
    cb(list);
  }, onError);
}

export function subscribeRoom(key: string, cb: (r: Room | null) => void) {
  return backend.subscribe<Partial<Room>>(`rooms/${key}`, (v) => cb(decodeRoom(key, v)));
}
