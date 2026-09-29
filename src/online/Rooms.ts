import type { SupabaseClient } from '@supabase/supabase-js';
import { NET_PROTOCOL } from '../net/protocol';
import { rpcOnUnload } from './client';

/**
 * As salas no banco (ver a migração `multiplayer_rooms`): criar, entrar pelo
 * código, sair, bater o ponto e assumir a sala quando o dono some. O jogo em
 * si não passa por aqui (é P2P); isto só diz quem está em qual sala.
 */

export type RoomMode = 'garden' | 'match';

export interface RoomInfo {
  id: string;
  code: string;
  hostId: string;
  mode: RoomMode;
  visibility: 'private' | 'public';
  maxPlayers: number;
}

/** O que pode dar errado ao criar/entrar (cada um vira uma frase na interface). */
export type RoomError = 'room_not_found' | 'room_full' | 'protocol_mismatch' | 'rate_limited' | 'offline' | 'unknown';

export type RoomResult = { ok: true; room: RoomInfo } | { ok: false; error: RoomError };

/** 5 letras sem as que confundem (0/O, 1/I/L): o mesmo alfabeto do banco. */
export const ROOM_CODE = /^[2-9A-HJKMNP-Z]{5}$/;

/** Normaliza o que a pessoa digitou (minúscula, espaço, traço, link colado inteiro). */
export function normalizeRoomCode(input: string): string {
  const fromLink = /[?&]sala=([^&#\s]+)/i.exec(input);
  return (fromLink ? fromLink[1] : input)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 5);
}

export async function createRoom(client: SupabaseClient, mode: RoomMode = 'garden'): Promise<RoomResult> {
  const { data, error } = await client.rpc('create_room', { p_mode: mode, p_visibility: 'private', p_protocol: NET_PROTOCOL });
  return error ? { ok: false, error: toRoomError(error) } : parseRoom(data);
}

export async function joinRoom(client: SupabaseClient, code: string): Promise<RoomResult> {
  const { data, error } = await client.rpc('join_room', { p_code: code, p_protocol: NET_PROTOCOL });
  return error ? { ok: false, error: toRoomError(error) } : parseRoom(data);
}

export async function leaveRoom(client: SupabaseClient): Promise<void> {
  await client.rpc('leave_room');
}

/** Sair ao fechar a aba (não dá pra esperar a resposta). */
export function leaveRoomOnUnload(accessToken: string): void {
  rpcOnUnload('leave_room', accessToken);
}

/** Bate o ponto: a vaga ainda existe? Quem é o dono agora? (null = sem rede) */
export async function heartbeat(client: SupabaseClient, roomId: string): Promise<{ member: boolean; hostId: string | null } | null> {
  const { data, error } = await client.rpc('room_heartbeat', { p_room: roomId });
  if (error || !data || typeof data !== 'object') return null;
  const d = data as { member?: unknown; hostId?: unknown };
  return { member: d.member === true, hostId: typeof d.hostId === 'string' ? d.hostId : null };
}

/** Tenta assumir a sala (o dono sumiu). Devolve o dono depois da tentativa (null = sem rede / não é membro). */
export async function claimHost(client: SupabaseClient, roomId: string): Promise<string | null> {
  const { data, error } = await client.rpc('claim_host', { p_room: roomId });
  if (error || !data || typeof data !== 'object') return null;
  const hostId = (data as { hostId?: unknown }).hostId;
  return typeof hostId === 'string' ? hostId : null;
}

/** Como a conexão fechou (direta, via TURN, falhou): o número que decide o plano B. */
export async function reportConnection(client: SupabaseClient, route: 'direct' | 'relay' | 'failed', rttMs: number | null, peers: number): Promise<void> {
  await client.rpc('report_connection', {
    p_route: route,
    p_rtt_ms: rttMs === null ? null : Math.max(0, Math.min(10000, Math.round(rttMs))),
    p_peers: Math.max(1, Math.min(6, peers)),
    p_user_agent: navigator.userAgent.slice(0, 200),
  });
}

function parseRoom(data: unknown): RoomResult {
  if (!data || typeof data !== 'object') return { ok: false, error: 'unknown' };
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string' || typeof d.code !== 'string' || typeof d.hostId !== 'string') return { ok: false, error: 'unknown' };
  return {
    ok: true,
    room: {
      id: d.id,
      code: d.code,
      hostId: d.hostId,
      mode: d.mode === 'match' ? 'match' : 'garden',
      visibility: d.visibility === 'public' ? 'public' : 'private',
      maxPlayers: typeof d.maxPlayers === 'number' ? d.maxPlayers : 6,
    },
  };
}

function toRoomError(error: { message?: string; code?: string }): RoomError {
  const message = error.message ?? '';
  if (message === 'room_not_found' || message === 'room_full' || message === 'protocol_mismatch' || message === 'rate_limited') return message;
  if (/fetch|network|Failed to/i.test(message)) return 'offline';
  return 'unknown';
}
