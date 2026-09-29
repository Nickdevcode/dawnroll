import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcOnUnload } from './client';
import type { RoomMode } from './Rooms';

/**
 * Amigos, convites e presença no banco (ver a migração `multiplayer_friends`):
 * pedir amizade pelo apelido, aceitar/recusar, tirar, bloquear, a lista com
 * onde cada amigo está, chamar pra sala e o "estou aqui" periódico. As tabelas
 * não são lidas direto: tudo passa pelas funções, que só mostram o que é seu ou
 * de um amigo. Aqui também moram as regras puras da lista (ordem, quem dá pra
 * chamar, em qual sala dá pra entrar) — a interface só desenha.
 */

/** Onde o amigo está: fora do jogo, no menu, jogando sozinho ou numa sala. */
export type FriendStatus = 'offline' | 'menu' | 'solo' | 'room';
/** O que o jogo avisa (a sala o banco já sabe pelo ponto que ela bate). */
export type PresenceStatus = 'menu' | 'solo';

export interface FriendProfile {
  id: string;
  nickname: string;
  skin: string;
}

/** A sala em que o amigo está (pra "Entrar" nela). */
export interface FriendRoom {
  code: string;
  mode: RoomMode;
  players: number;
  max: number;
  /** Disputa rolando. */
  playing: boolean;
  /** Disputa passou dos 2 min: só entra quando acabar. */
  locked: boolean;
  public: boolean;
}

export interface Friend extends FriendProfile {
  status: FriendStatus;
  room: FriendRoom | null;
}

export interface FriendRequest extends FriendProfile {
  /** Quando o pedido foi feito (ms desde 1970). */
  at: number;
}

export interface FriendsList {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: FriendProfile[];
}

export interface RoomInvite {
  id: number;
  from: FriendProfile;
  code: string;
  mode: RoomMode;
  /** Até quando vale (relógio deste aparelho: o banco manda "quantos segundos faltam"). */
  expiresAt: number;
}

/** O que a presença devolve: o que espera por você. */
export interface PresenceInfo {
  /** Pedidos de amizade esperando resposta. */
  requests: number;
  /** Amigos + pedidos que você fez (tendo alguém, vale abrir o canal de avisos). */
  friends: number;
  /** Amigos com o jogo aberto agora. */
  online: number;
  invites: RoomInvite[];
}

export type FriendRequestStatus = 'sent' | 'accepted' | 'already' | 'pending' | 'not_found' | 'self' | 'blocked' | 'limit' | 'rate_limited' | 'offline' | 'unknown';
export type InviteStatus = 'sent' | 'no_room' | 'not_friend' | 'in_room' | 'offline' | 'rate_limited' | 'network' | 'unknown';

/** Aviso que o banco manda pro canal `user:<id>` (ver `parseSocialPush`). */
export type SocialPush =
  | { kind: 'request'; from: FriendProfile }
  | { kind: 'accepted'; from: FriendProfile }
  | { kind: 'invite'; invite: RoomInvite };

/** Apelido digitado cabe na busca (o banco confere o resto). */
export const FRIEND_NICK_MAX = 40;

// --- Chamadas ----------------------------------------------------------------------

export async function fetchFriends(client: SupabaseClient): Promise<FriendsList | null> {
  const { data, error } = await client.rpc('friends_list');
  return error ? null : parseFriendsList(data);
}

export async function sendFriendRequest(client: SupabaseClient, nickname: string): Promise<{ status: FriendRequestStatus; friend: FriendProfile | null }> {
  const { data, error } = await client.rpc('send_friend_request', { p_nickname: nickname.trim().slice(0, FRIEND_NICK_MAX) });
  if (error) return { status: errorStatus(error), friend: null };
  const d = (data ?? {}) as { status?: unknown; friend?: unknown };
  const known: readonly FriendRequestStatus[] = ['sent', 'accepted', 'already', 'pending', 'not_found', 'self', 'blocked', 'limit'];
  const status = known.includes(d.status as FriendRequestStatus) ? (d.status as FriendRequestStatus) : 'unknown';
  return { status, friend: parseProfile(d.friend) };
}

/** Aceita ou recusa o pedido de `userId`. false = não deu (sem rede, ou o pedido já não existe). */
export async function respondFriendRequest(client: SupabaseClient, userId: string, accept: boolean): Promise<boolean> {
  const { data, error } = await client.rpc('respond_friend_request', { p_user: userId, p_accept: accept });
  return !error && (data === 'accepted' || data === 'declined');
}

/** Tira dos amigos (também cancela o pedido que você fez). */
export async function removeFriend(client: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await client.rpc('remove_friend', { p_user: userId });
  return !error;
}

export async function blockUser(client: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await client.rpc('block_user', { p_user: userId });
  return !error;
}

export async function unblockUser(client: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await client.rpc('unblock_user', { p_user: userId });
  return !error;
}

export async function inviteFriend(client: SupabaseClient, userId: string): Promise<InviteStatus> {
  const { data, error } = await client.rpc('invite_friend', { p_user: userId });
  if (error) {
    const status = errorStatus(error);
    return status === 'rate_limited' ? 'rate_limited' : status === 'offline' ? 'network' : 'unknown';
  }
  const known: readonly InviteStatus[] = ['sent', 'no_room', 'not_friend', 'in_room', 'offline'];
  return known.includes(data as InviteStatus) ? (data as InviteStatus) : 'unknown';
}

/** "Estou aqui": avisa onde você está e traz pedidos e convites. null = sem rede. */
export async function touchPresence(client: SupabaseClient, status: PresenceStatus, now = Date.now()): Promise<PresenceInfo | null> {
  const { data, error } = await client.rpc('touch_presence', { p_status: status });
  return error ? null : parsePresence(data, now);
}

export async function dismissInvite(client: SupabaseClient, inviteId: number): Promise<void> {
  await client.rpc('dismiss_invite', { p_invite: inviteId });
}

/** Aparece offline na hora (sair da conta). */
export async function goOffline(client: SupabaseClient): Promise<void> {
  await client.rpc('go_offline');
}

/** Fechou a aba: offline sem esperar resposta. */
export function goOfflineOnUnload(accessToken: string): void {
  rpcOnUnload('go_offline', accessToken);
}

// --- Leitura (o que vem do banco é conferido: tipo, tamanho) --------------------------

/** Id de conta (uuid): vai pra atributo de HTML e pra chamada do banco, então o formato é conferido. */
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function parseProfile(v: unknown): FriendProfile | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (!isId(d.id) || typeof d.nickname !== 'string' || d.nickname.length === 0 || d.nickname.length > 40) return null;
  return { id: d.id, nickname: d.nickname, skin: typeof d.skin === 'string' ? d.skin : '' };
}

function parseRoom(v: unknown): FriendRoom | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (typeof d.code !== 'string' || !/^[2-9A-HJKMNP-Z]{5}$/.test(d.code)) return null;
  const count = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(99, Math.round(n))) : fallback);
  return {
    code: d.code,
    mode: d.mode === 'match' ? 'match' : 'garden',
    players: count(d.players, 1),
    max: count(d.max, 6),
    playing: d.playing === true,
    locked: d.locked === true,
    public: d.public === true,
  };
}

function parseFriend(v: unknown): Friend | null {
  const profile = parseProfile(v);
  if (!profile) return null;
  const d = v as Record<string, unknown>;
  const room = parseRoom(d.room);
  const status: FriendStatus = d.status === 'room' && room ? 'room' : d.status === 'menu' || d.status === 'solo' ? d.status : 'offline';
  return { ...profile, status, room: status === 'room' ? room : null };
}

function parseRequest(v: unknown): FriendRequest | null {
  const profile = parseProfile(v);
  if (!profile) return null;
  const at = Date.parse(String((v as Record<string, unknown>).at ?? ''));
  return { ...profile, at: Number.isFinite(at) ? at : 0 };
}

function list<T>(v: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v.slice(0, 200)) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseFriendsList(data: unknown): FriendsList | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return {
    friends: sortFriends(list(d.friends, parseFriend)),
    incoming: list(d.incoming, parseRequest),
    outgoing: list(d.outgoing, parseRequest),
    blocked: list(d.blocked, parseProfile),
  };
}

export function parseInvite(v: unknown, now = Date.now()): RoomInvite | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const from = parseProfile(d.from);
  const seconds = typeof d.expiresIn === 'number' && Number.isFinite(d.expiresIn) ? Math.max(0, Math.min(600, d.expiresIn)) : 0;
  if (typeof d.id !== 'number' || !Number.isSafeInteger(d.id) || !from || typeof d.code !== 'string' || !/^[2-9A-HJKMNP-Z]{5}$/.test(d.code) || seconds <= 0) return null;
  return { id: d.id, from, code: d.code, mode: d.mode === 'match' ? 'match' : 'garden', expiresAt: now + seconds * 1000 };
}

export function parsePresence(data: unknown, now = Date.now()): PresenceInfo | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  return { requests: count(d.requests), friends: count(d.friends), online: count(d.online), invites: list(d.invites, (v) => parseInvite(v, now)) };
}

/** O aviso do canal `user:<id>` (null = desconhecido ou torto: ignora). */
export function parseSocialPush(payload: unknown, now = Date.now()): SocialPush | null {
  if (!payload || typeof payload !== 'object') return null;
  const d = payload as Record<string, unknown>;
  if (d.kind === 'invite') {
    const invite = parseInvite(d.invite, now);
    return invite ? { kind: 'invite', invite } : null;
  }
  if (d.kind === 'request' || d.kind === 'accepted') {
    const from = parseProfile(d.from);
    return from ? { kind: d.kind, from } : null;
  }
  return null;
}

// --- Regras da lista (puras) ------------------------------------------------------------

/** Quem aparece primeiro: numa sala, jogando, no menu, offline; empate pelo apelido. */
const STATUS_ORDER: Record<FriendStatus, number> = { room: 0, solo: 1, menu: 2, offline: 3 };

export function sortFriends(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' }));
}

/** Por que não dá pra entrar na sala do amigo (null = dá). */
export function friendRoomBlock(friend: Friend, myRoomCode: string | null): 'same' | 'full' | 'locked' | null {
  const room = friend.room;
  if (!room) return null;
  if (room.code === myRoomCode) return 'same';
  if (room.players >= room.max) return 'full';
  if (room.locked) return 'locked';
  return null;
}

/** Dá pra chamar esse amigo pra sua sala? (online e fora dela) */
export function canInvite(friend: Friend, myRoomCode: string | null): boolean {
  return myRoomCode !== null && friend.status !== 'offline' && friend.room?.code !== myRoomCode;
}

/** Convites válidos agora: sem os vencidos e um por amigo (o mais novo ganha). */
export function liveInvites(invites: readonly RoomInvite[], now = Date.now()): RoomInvite[] {
  const byFriend = new Map<string, RoomInvite>();
  for (const invite of invites) {
    if (invite.expiresAt <= now) continue;
    const current = byFriend.get(invite.from.id);
    if (!current || invite.id > current.id) byFriend.set(invite.from.id, invite);
  }
  return [...byFriend.values()].sort((a, b) => b.id - a.id);
}

function errorStatus(error: { message?: string }): 'rate_limited' | 'offline' | 'unknown' {
  const message = error.message ?? '';
  if (message === 'rate_limited') return 'rate_limited';
  if (/fetch|network|Failed to/i.test(message)) return 'offline';
  return 'unknown';
}
