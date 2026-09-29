import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Sinalização da sala: o "aperto de mão" do WebRTC (oferta e resposta) e quem
 * está online agora, pelo canal PRIVADO `room:<id>` do Supabase Realtime. Só
 * membro da sala abre esse canal (RLS no banco, ver a migração das salas).
 *
 * Nada do jogo passa por aqui: depois de conectados, os jogadores falam direto.
 */

export interface SignalMessage {
  /** Oferta, resposta, ou caminhos achados depois delas (lote). */
  kind: 'offer' | 'answer' | 'candidates';
  from: string;
  to: string;
  /** Identifica a tentativa de conexão (resposta velha de outra tentativa é ignorada). */
  nonce: string;
  /** Oferta/resposta (vazio nos caminhos). */
  sdp: string;
  /** Caminhos atrasados (só no `candidates`). */
  candidates?: RTCIceCandidateInit[];
}

/** O que cada jogador anuncia na presença da sala. */
export interface PresenceInfo {
  uid: string;
  nick: string;
}

/** Maior SDP aceito (ofertas com todos os caminhos ficam em ~2–4 KB). */
const MAX_SDP = 24 * 1024;
/** Caminhos por lote e tamanho de cada um (uma linha "candidate:" tem ~100–200 caracteres). */
const MAX_CANDIDATES = 24;
const MAX_CANDIDATE_CHARS = 512;

export class RoomChannel {
  private channel: RealtimeChannel | null = null;

  onSignal: ((message: SignalMessage) => void) | null = null;
  /** Alguém anunciou que assumiu a sala (troca de dono): quem está reconectando vai direto nele. */
  onHostAnnounce: ((uid: string) => void) | null = null;
  /** Quem está no canal agora (muda quando alguém entra ou cai). */
  onPresence: ((present: ReadonlySet<string>) => void) | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly roomId: string,
    private readonly self: PresenceInfo,
  ) {}

  /** Abre o canal e anuncia a presença. Rejeita se o banco negar (não é membro) ou demorar demais. */
  async open(timeoutMs = 10000): Promise<void> {
    const session = await this.client.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) await this.client.realtime.setAuth(token);
    const channel = this.client.channel(`room:${this.roomId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: this.self.uid } },
    });
    this.channel = channel;
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const message = parseSignal(payload);
      if (message && message.to === this.self.uid && message.from !== this.self.uid) this.onSignal?.(message);
    });
    channel.on('broadcast', { event: 'host' }, ({ payload }) => {
      const uid = (payload as { uid?: unknown } | null)?.uid;
      if (typeof uid === 'string' && uid.length <= 64 && uid !== this.self.uid) this.onHostAnnounce?.(uid);
    });
    channel.on('presence', { event: 'sync' }, () => {
      const present = new Set(Object.keys(channel.presenceState()));
      this.onPresence?.(present);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('signal_timeout')), timeoutMs);
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timer);
          void channel.track({ uid: this.self.uid, nick: this.self.nick });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          window.clearTimeout(timer);
          reject(err ?? new Error(`signal_${status.toLowerCase()}`));
        }
      });
    });
  }

  async send(message: SignalMessage): Promise<void> {
    await this.channel?.send({ type: 'broadcast', event: 'signal', payload: message });
  }

  /** Avisa a sala que eu assumi (o banco já confirmou). */
  async announceHost(): Promise<void> {
    await this.channel?.send({ type: 'broadcast', event: 'host', payload: { uid: this.self.uid } });
  }

  /** Ids de quem está no canal agora. */
  present(): Set<string> {
    return new Set(this.channel ? Object.keys(this.channel.presenceState()) : []);
  }

  async close(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    if (channel) await this.client.removeChannel(channel);
  }
}

function parseSignal(raw: unknown): SignalMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.kind !== 'offer' && m.kind !== 'answer' && m.kind !== 'candidates') return null;
  if (typeof m.from !== 'string' || typeof m.to !== 'string' || typeof m.nonce !== 'string' || typeof m.sdp !== 'string') return null;
  if (m.sdp.length > MAX_SDP || m.nonce.length > 64 || m.from.length > 64 || m.to.length > 64) return null;
  if (m.kind !== 'candidates') return { kind: m.kind, from: m.from, to: m.to, nonce: m.nonce, sdp: m.sdp };
  if (!Array.isArray(m.candidates) || m.candidates.length === 0 || m.candidates.length > MAX_CANDIDATES) return null;
  const candidates: RTCIceCandidateInit[] = [];
  for (const item of m.candidates) {
    if (!item || typeof item !== 'object') return null;
    const c = item as Record<string, unknown>;
    if (typeof c.candidate !== 'string' || c.candidate.length > MAX_CANDIDATE_CHARS) return null;
    candidates.push({
      candidate: c.candidate,
      sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 16) : null,
      sdpMLineIndex: typeof c.sdpMLineIndex === 'number' && Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 8 ? c.sdpMLineIndex : null,
    });
  }
  return { kind: 'candidates', from: m.from, to: m.to, nonce: m.nonce, sdp: '', candidates };
}
