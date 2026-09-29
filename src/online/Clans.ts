import type { SupabaseClient } from '@supabase/supabase-js';
import { parseProfile, type FriendProfile } from './Friends';

/**
 * Turmas no banco (ver a migração `multiplayer_clans`): criar, achar pela tag,
 * entrar, sair, o que o líder faz, convidar amigo, a tela "minha turma", o
 * "Jogar com a turma" e o ranking da semana. As tabelas não são lidas direto:
 * tudo passa pelas funções. Aqui também moram as regras puras (formato da tag
 * e do nome, ordem dos membros) — a interface só desenha.
 */

/** Tag: 2 a 4 letras sem acento ou números, em maiúscula (vai antes do apelido: [KHE] Nick). */
export const CLAN_TAG = /^[A-Z0-9]{2,4}$/;
export const CLAN_TAG_MAX = 4;
export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 20;
/** Quantos cabem numa turma (o banco confere). */
export const CLAN_MAX = 20;

/** Onde o colega está. Sem código de sala: ele só chega por convite (ver o topo da migração). */
export type ClanMemberStatus = 'offline' | 'menu' | 'solo' | 'room';
export type ClanRole = 'leader' | 'member';

/** O retrato da turma (na busca, no convite, na minha turma). */
export interface ClanCard {
  id: string;
  tag: string;
  name: string;
  /** Aberta: qualquer um entra pela tag. Fechada: só com convite. */
  open: boolean;
  /** Escondida pela moderação (quem é da turma ainda vê; a tag não aparece pros outros). */
  hidden: boolean;
  members: number;
  max: number;
  /** Bolas enterradas pela turma nesta semana. */
  week: number;
  /** Posição no ranking da semana (null = ainda sem enterro nesta semana). */
  rank: number | null;
}

/** O que a busca pela tag traz além do retrato. */
export interface FoundClan extends ClanCard {
  /** É a sua turma. */
  mine: boolean;
  /** Você tem convite dela (entra mesmo fechada). */
  invited: boolean;
}

export interface ClanMember extends FriendProfile {
  role: ClanRole;
  status: ClanMemberStatus;
  /** A parte dele no placar desta semana. */
  week: number;
  /** Quando entrou (ms desde 1970). */
  joinedAt: number;
}

export interface ClanInvite {
  id: number;
  from: FriendProfile;
  clan: ClanCard;
  /** Até quando vale (relógio deste aparelho: o banco manda "quantos segundos faltam"). */
  expiresAt: number;
}

/** A tela Turma: a sua (com os membros) ou, sem turma, os convites que chegaram. */
export interface MyClan {
  clan: ClanCard | null;
  role: ClanRole | null;
  members: ClanMember[];
  invites: ClanInvite[];
}

export interface ClanBoardRow {
  rank: number;
  tag: string;
  name: string;
  members: number;
  value: number;
  isMine: boolean;
}

export type CreateClanStatus =
  | 'ok'
  | 'invalid_name'
  | 'invalid_tag'
  | 'blocked_name'
  | 'blocked_tag'
  | 'taken_name'
  | 'taken_tag'
  | 'in_clan'
  | 'rate_limited'
  | 'offline'
  | 'unknown';
export type JoinClanStatus = 'joined' | 'closed' | 'full' | 'in_clan' | 'not_found' | 'rate_limited' | 'offline' | 'unknown';
export type RespondClanStatus = JoinClanStatus | 'declined';
export type ClanInviteStatus = 'sent' | 'no_clan' | 'not_friend' | 'member' | 'in_clan' | 'full' | 'rate_limited' | 'offline' | 'unknown';
export type LeaderActionStatus = 'ok' | 'not_leader' | 'not_member' | 'self' | 'offline' | 'unknown';
export type CallClanStatus = 'sent' | 'none' | 'no_room' | 'no_clan' | 'rate_limited' | 'offline' | 'unknown';

// --- Regras puras ------------------------------------------------------------------------

/** O que a pessoa digitou na tag: sem colchete, sem espaço, sem acento, maiúscula e no máximo 4. */
export function normalizeClanTag(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CLAN_TAG_MAX);
}

/** O nome como vai pro banco (sem espaço sobrando nas pontas nem duplo no meio). */
export function cleanClanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Formato do nome (o palavrão e o "ocupado" só o banco sabe). */
export function clanNameOk(name: string): boolean {
  return name.length >= CLAN_NAME_MIN && name.length <= CLAN_NAME_MAX && /^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]+$/.test(name) && /[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(name);
}

const STATUS_ORDER: Record<ClanMemberStatus, number> = { room: 0, solo: 1, menu: 2, offline: 3 };

/** Líder primeiro; depois quem está jogando, no menu, offline; empate pelo apelido. */
export function sortMembers(members: readonly ClanMember[]): ClanMember[] {
  return [...members].sort(
    (a, b) =>
      Number(b.role === 'leader') - Number(a.role === 'leader') ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' }),
  );
}

/** Convites válidos agora (sem os vencidos), um por turma, o mais novo primeiro. */
export function liveClanInvites(invites: readonly ClanInvite[], now = Date.now()): ClanInvite[] {
  const byClan = new Map<string, ClanInvite>();
  for (const invite of invites) {
    if (invite.expiresAt <= now) continue;
    const current = byClan.get(invite.clan.id);
    if (!current || invite.id > current.id) byClan.set(invite.clan.id, invite);
  }
  return [...byClan.values()].sort((a, b) => b.id - a.id);
}

// --- Chamadas ----------------------------------------------------------------------------

export async function fetchMyClan(client: SupabaseClient, now = Date.now()): Promise<MyClan | null> {
  const { data, error } = await client.rpc('my_clan');
  return error ? null : parseMyClan(data, now);
}

export async function createClan(client: SupabaseClient, name: string, tag: string, open: boolean): Promise<{ status: CreateClanStatus; clan: ClanCard | null }> {
  const { data, error } = await client.rpc('create_clan', { p_name: cleanClanName(name), p_tag: normalizeClanTag(tag), p_open: open });
  if (error) return { status: errorStatus(error), clan: null };
  const d = (data ?? {}) as { status?: unknown; clan?: unknown };
  const known: readonly CreateClanStatus[] = ['ok', 'invalid_name', 'invalid_tag', 'blocked_name', 'blocked_tag', 'taken_name', 'taken_tag', 'in_clan'];
  return { status: known.includes(d.status as CreateClanStatus) ? (d.status as CreateClanStatus) : 'unknown', clan: parseCard(d.clan) };
}

/** Acha pela tag. `clan` null = não achou (ou a tag digitada nem tem formato). */
export async function findClan(client: SupabaseClient, tag: string): Promise<{ status: 'found' | 'not_found' | 'rate_limited' | 'offline' | 'unknown'; clan: FoundClan | null }> {
  const wanted = normalizeClanTag(tag);
  if (!CLAN_TAG.test(wanted)) return { status: 'not_found', clan: null };
  const { data, error } = await client.rpc('find_clan', { p_tag: wanted });
  if (error) return { status: errorStatus(error), clan: null };
  const d = (data ?? {}) as { status?: unknown; clan?: unknown };
  const card = parseCard(d.clan);
  if (d.status !== 'found' || !card) return { status: 'not_found', clan: null };
  const extra = d.clan as Record<string, unknown>;
  return { status: 'found', clan: { ...card, mine: extra.mine === true, invited: extra.invited === true } };
}

export async function joinClan(client: SupabaseClient, clanId: string): Promise<JoinClanStatus> {
  const { data, error } = await client.rpc('join_clan', { p_clan: clanId });
  if (error) return errorStatus(error);
  const known: readonly JoinClanStatus[] = ['joined', 'closed', 'full', 'in_clan', 'not_found'];
  return known.includes(data as JoinClanStatus) ? (data as JoinClanStatus) : 'unknown';
}

export async function respondClanInvite(client: SupabaseClient, inviteId: number, accept: boolean): Promise<RespondClanStatus> {
  const { data, error } = await client.rpc('respond_clan_invite', { p_invite: inviteId, p_accept: accept });
  if (error) return errorStatus(error);
  const known: readonly RespondClanStatus[] = ['joined', 'declined', 'closed', 'full', 'in_clan', 'not_found'];
  return known.includes(data as RespondClanStatus) ? (data as RespondClanStatus) : 'unknown';
}

export async function leaveClan(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.rpc('leave_clan');
  return !error;
}

export async function kickClanMember(client: SupabaseClient, userId: string): Promise<LeaderActionStatus> {
  return leaderAction(client, 'kick_clan_member', { p_user: userId });
}

export async function promoteClanMember(client: SupabaseClient, userId: string): Promise<LeaderActionStatus> {
  return leaderAction(client, 'promote_clan_member', { p_user: userId });
}

export async function setClanOpen(client: SupabaseClient, open: boolean): Promise<LeaderActionStatus> {
  return leaderAction(client, 'set_clan_open', { p_open: open });
}

export async function inviteToClan(client: SupabaseClient, userId: string): Promise<ClanInviteStatus> {
  const { data, error } = await client.rpc('invite_to_clan', { p_user: userId });
  if (error) return errorStatus(error);
  const known: readonly ClanInviteStatus[] = ['sent', 'no_clan', 'not_friend', 'member', 'in_clan', 'full'];
  return known.includes(data as ClanInviteStatus) ? (data as ClanInviteStatus) : 'unknown';
}

/** Chama pra sua sala todo mundo da turma que está online. */
export async function callClan(client: SupabaseClient): Promise<{ status: CallClanStatus; count: number }> {
  const { data, error } = await client.rpc('call_clan');
  if (error) return { status: errorStatus(error), count: 0 };
  const d = (data ?? {}) as { status?: unknown; count?: unknown };
  const known: readonly CallClanStatus[] = ['sent', 'none', 'no_room', 'no_clan'];
  const count = typeof d.count === 'number' && Number.isFinite(d.count) ? Math.max(0, Math.min(CLAN_MAX, Math.round(d.count))) : 0;
  return { status: known.includes(d.status as CallClanStatus) ? (d.status as CallClanStatus) : 'unknown', count };
}

/** Ranking das turmas na semana (funciona sem conta). */
export async function fetchClanBoard(client: SupabaseClient, limit = 50): Promise<ClanBoardRow[]> {
  const { data, error } = await client.rpc('clan_leaderboard', { p_limit: limit });
  if (error) throw error;
  return parseClanBoard(data);
}

async function leaderAction(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<LeaderActionStatus> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const status = errorStatus(error);
    return status === 'offline' ? 'offline' : 'unknown';
  }
  const known: readonly LeaderActionStatus[] = ['ok', 'not_leader', 'not_member', 'self'];
  return known.includes(data as LeaderActionStatus) ? (data as LeaderActionStatus) : 'unknown';
}

function errorStatus(error: { message?: string }): 'rate_limited' | 'offline' | 'unknown' {
  const message = error.message ?? '';
  if (message === 'rate_limited') return 'rate_limited';
  if (/fetch|network|Failed to/i.test(message)) return 'offline';
  return 'unknown';
}

// --- Leitura (o que vem do banco é conferido: tipo, tamanho) --------------------------------

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const count = (n: unknown, max: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);

export function parseCard(v: unknown): ClanCard | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (!isId(d.id) || typeof d.tag !== 'string' || !CLAN_TAG.test(d.tag) || typeof d.name !== 'string' || d.name.length === 0 || d.name.length > 40) return null;
  const rank = typeof d.rank === 'number' && Number.isSafeInteger(d.rank) && d.rank > 0 ? d.rank : null;
  return {
    id: d.id,
    tag: d.tag,
    name: d.name,
    open: d.open !== false,
    hidden: d.hidden === true,
    members: count(d.members, 999),
    max: count(d.max, 999) || CLAN_MAX,
    week: count(d.week, 1e7),
    rank,
  };
}

function parseMember(v: unknown): ClanMember | null {
  const profile = parseProfile(v);
  if (!profile) return null;
  const d = v as Record<string, unknown>;
  const status: ClanMemberStatus = d.status === 'room' || d.status === 'solo' || d.status === 'menu' ? d.status : 'offline';
  const joinedAt = Date.parse(String(d.joinedAt ?? ''));
  return { ...profile, role: d.role === 'leader' ? 'leader' : 'member', status, week: count(d.week, 1e7), joinedAt: Number.isFinite(joinedAt) ? joinedAt : 0 };
}

export function parseClanInvite(v: unknown, now = Date.now()): ClanInvite | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const from = parseProfile(d.from);
  const clan = parseCard(d.clan);
  // Vale 7 dias: o teto só barra lixo.
  const seconds = typeof d.expiresIn === 'number' && Number.isFinite(d.expiresIn) ? Math.max(0, Math.min(8 * 86_400, d.expiresIn)) : 0;
  if (typeof d.id !== 'number' || !Number.isSafeInteger(d.id) || !from || !clan || seconds <= 0) return null;
  return { id: d.id, from, clan, expiresAt: now + seconds * 1000 };
}

function list<T>(v: unknown, parse: (item: unknown) => T | null, limit: number): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v.slice(0, limit)) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseMyClan(data: unknown, now = Date.now()): MyClan | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const clan = parseCard(d.clan);
  return {
    clan,
    role: clan ? (d.role === 'leader' ? 'leader' : 'member') : null,
    members: clan ? sortMembers(list(d.members, parseMember, CLAN_MAX + 5)) : [],
    invites: clan ? [] : liveClanInvites(list(d.invites, (v) => parseClanInvite(v, now), 50), now),
  };
}

export function parseClanBoard(data: unknown): ClanBoardRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ClanBoardRow[] = [];
  for (const item of data.slice(0, 101)) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.tag !== 'string' || !CLAN_TAG.test(d.tag) || typeof d.name !== 'string' || d.name.length > 40) continue;
    const rank = Number(d.rank);
    if (!Number.isSafeInteger(rank) || rank < 1) continue;
    rows.push({ rank, tag: d.tag, name: d.name, members: count(d.members, 999), value: count(d.value, 1e7), isMine: d.is_mine === true });
  }
  return rows;
}
