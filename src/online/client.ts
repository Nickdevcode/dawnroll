import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente do Supabase, carregado sob demanda: a biblioteca vem num pedaço
 * separado do bundle e só baixa depois que o jardim já abriu (o jogo não espera
 * a nuvem pra começar). Sem as variáveis de ambiente, o jogo roda só local.
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

/** O build tem o endereço e a chave do Supabase? */
export const onlineConfigured = url.startsWith('https://') && key.length > 0;

let pending: Promise<SupabaseClient> | null = null;

export function getClient(): Promise<SupabaseClient> {
  if (!onlineConfigured) return Promise.reject(new Error('Supabase não configurado'));
  pending ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, {
      auth: {
        // Volta do Google com ?code= na URL (PKCE): a biblioteca troca pela sessão sozinha.
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }),
  );
  // Falhou o download do pedaço (sem internet): a próxima chamada tenta de novo.
  pending.catch(() => (pending = null));
  return pending;
}

/**
 * Chama uma função do banco de um jeito que sobrevive ao fechamento da aba
 * (`keepalive`): sair da sala ao fechar o jogo. Não espera resposta.
 */
export function rpcOnUnload(fn: string, accessToken: string, body: Record<string, unknown> = {}): void {
  if (!onlineConfigured) return;
  void fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    keepalive: true,
    headers: { apikey: key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Quais jeitos de entrar estão ligados no projeto (o botão do Google só aparece se estiver). */
export interface AuthProviders {
  email: boolean;
  google: boolean;
}

/** Lê do próprio servidor de login (rota pública) quais provedores estão ligados. */
export async function fetchProviders(signal?: AbortSignal): Promise<AuthProviders> {
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal });
  if (!response.ok) throw new Error(`auth settings ${response.status}`);
  const data = (await response.json()) as { external?: Record<string, unknown> };
  return { email: data.external?.email === true, google: data.external?.google === true };
}
