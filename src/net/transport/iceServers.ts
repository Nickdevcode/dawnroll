import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Servidores que ajudam dois navegadores a se acharem:
 *   - STUN (grátis, sem conta): descobre o endereço público de cada um. Resolve
 *     a maioria das conexões (Wi-Fi de casa).
 *   - TURN (Cloudflare, 1 TB/mês grátis): quando o direto não passa (4G, CGNAT,
 *     rede de empresa), o tráfego vai por ele. Pede credencial temporária, que
 *     sai da função `turn-credentials` do Supabase (a chave do Cloudflare fica
 *     só lá, nunca no navegador).
 *
 * Sem a função (ou sem chave configurada), o jogo segue só com STUN: a maioria
 * conecta igual; quem estiver numa rede difícil vê "não deu pra conectar".
 */

const STUN_ONLY: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

export interface IceConfig {
  servers: RTCIceServer[];
  /** Tem TURN (dá pra forçar tudo pelo servidor, escondendo o IP). */
  turn: boolean;
}

let cached: { config: IceConfig; until: number } | null = null;

/** Servidores atuais (credencial do TURN guardada até perto de vencer). */
export async function iceConfig(client: SupabaseClient): Promise<IceConfig> {
  if (cached && performance.now() < cached.until) return cached.config;
  try {
    const { data, error } = await client.functions.invoke<{ iceServers?: unknown; ttl?: number }>('turn-credentials', { method: 'POST' });
    const servers = error ? null : sanitize(data?.iceServers);
    if (servers && servers.length > 0) {
      const ttl = typeof data?.ttl === 'number' ? data.ttl : 3600;
      const turn = servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn')));
      // Renova com folga (metade da validade): a sessão de jogo pode durar horas.
      cached = { config: { servers, turn }, until: performance.now() + (ttl * 1000) / 2 };
      return cached.config;
    }
  } catch {
    // Sem função/sem rede: segue só com STUN.
  }
  const config = { servers: STUN_ONLY, turn: false };
  cached = { config, until: performance.now() + 60_000 };
  return config;
}

/** Só aceita o formato esperado (urls stun:/turn:/turns: e credenciais em texto). */
function sanitize(raw: unknown): RTCIceServer[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RTCIceServer[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u): u is string => typeof u === 'string' && /^(stun|turns?):/.test(u));
    if (urls.length === 0) continue;
    const server: RTCIceServer = { urls };
    if (typeof s.username === 'string') server.username = s.username;
    if (typeof s.credential === 'string') server.credential = s.credential;
    out.push(server);
  }
  return out;
}
