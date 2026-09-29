// Credencial temporária do TURN (Cloudflare Realtime) pro online do Dawnroll.
//
// O TURN é o "plano de fuga" da conexão entre jogadores: quando o caminho
// direto não passa (4G, CGNAT, rede de empresa), o tráfego vai pelo servidor
// do Cloudflare (1 TB/mês grátis). A chave do Cloudflare fica SÓ aqui (segredos
// da função); o navegador recebe uma credencial que vence sozinha.
//
// Só conta de verdade pede (o JWT é conferido aqui dentro: com o verify_jwt da
// plataforma o preflight de CORS, que não tem Authorization, seria barrado).
// Sem os segredos configurados, devolve só STUN: o jogo funciona igual pra
// quem conecta direto.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
/** Validade da credencial (o jogo renova na metade). */
const TTL_SECONDS = 4 * 3600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'login_required' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) return json({ iceServers: STUN, ttl: 600 });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return json({ error: 'login_required' }, 401);

  const keyId = Deno.env.get('CF_TURN_KEY_ID');
  const apiToken = Deno.env.get('CF_TURN_API_TOKEN');
  if (!keyId || !apiToken) return json({ iceServers: STUN, ttl: 3600 });

  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!response.ok) return json({ iceServers: STUN, ttl: 600 });
    const body = (await response.json()) as { iceServers?: unknown };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    // Porta 53 (DNS) é barrada por alguns navegadores e redes: fica de fora.
    const servers = list
      .map((server) => {
        const s = server as { urls?: string | string[]; username?: string; credential?: string };
        const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u): u is string => typeof u === 'string' && !/:53(\?|$)/.test(u));
        return urls.length > 0 ? { urls, username: s.username, credential: s.credential } : null;
      })
      .filter(Boolean);
    return json({ iceServers: servers.length > 0 ? servers : STUN, ttl: TTL_SECONDS });
  } catch {
    return json({ iceServers: STUN, ttl: 600 });
  }
});
