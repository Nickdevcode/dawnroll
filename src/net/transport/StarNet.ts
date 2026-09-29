import { PeerLink, type Lane, type NetSim } from './PeerLink';
import type { RoomChannel, SignalMessage } from './signaling';
import type { IceConfig } from './iceServers';

/**
 * Rede em estrela: o dono da sala no meio, cada jogador com uma conexão só
 * (com o dono). O dono repassa o que cada um manda pros outros (ver
 * `NetSession`). Com 6 jogadores são 5 conexões no dono e 1 em cada um — bem
 * menos que todo mundo com todo mundo (15), e bem mais fácil de atravessar NAT.
 *
 * Aqui é só o encanamento: abrir, reabrir e fechar conexões pela sinalização,
 * e entregar mensagens. Quem é dono e o que as mensagens significam é da sessão.
 */

/** Esperando a resposta do dono antes de desistir da tentativa. */
const ANSWER_TIMEOUT_MS = 6000;
/** Da resposta até os canais abrirem (atravessar o NAT, ou o TURN). */
const OPEN_TIMEOUT_MS = 12000;

export type StarRole = 'none' | 'host' | 'client';

export class StarNet {
  private role: StarRole = 'none';
  private readonly links = new Map<string, PeerLink>();
  /** Tentativa de conexão em andamento (nonce da oferta que eu mandei, por jogador). */
  private readonly offers = new Map<string, string>();
  private closed = false;

  onLinkOpen: ((peerId: string, link: PeerLink) => void) | null = null;
  onLinkClose: ((peerId: string) => void) | null = null;
  onMessage: ((peerId: string, lane: Lane, data: ArrayBuffer | string) => void) | null = null;

  constructor(
    private readonly channel: RoomChannel,
    private readonly selfId: string,
    private readonly ice: () => Promise<IceConfig>,
    /** Força tudo pelo TURN (sala pública: ninguém vê o IP de ninguém). */
    private readonly relayOnly: boolean,
    private readonly sim: NetSim | null,
  ) {
    channel.onSignal = (message) => void this.handleSignal(message);
  }

  get currentRole(): StarRole {
    return this.role;
  }

  /** Vira o centro da estrela: aceita ofertas de quem chegar. Fecha a conexão que tinha com o dono antigo. */
  becomeHost(): void {
    this.role = 'host';
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.offers.clear();
  }

  /**
   * Conecta no dono (fecha qualquer conexão anterior). Resolve com o link
   * aberto, ou rejeita se não abrir a tempo.
   */
  async connectTo(hostId: string): Promise<PeerLink> {
    this.role = 'client';
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.offers.clear();
    const config = await this.ice();
    if (this.closed) throw new Error('closed');
    const link = this.createLink(hostId, config);
    const nonce = randomNonce();
    link.nonce = nonce;
    this.offers.set(hostId, nonce);
    const sdp = await link.createOffer();
    await this.channel.send({ kind: 'offer', from: this.selfId, to: hostId, nonce, sdp });
    return new Promise<PeerLink>((resolve, reject) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(answerTimer);
        window.clearTimeout(openTimer);
        if (ok) resolve(link);
        else {
          link.close();
          reject(new Error('connect_timeout'));
        }
      };
      // Sem resposta (o dono sumiu ou não viu a oferta) ou sem abrir (NAT não deixou): desiste.
      const answerTimer = window.setTimeout(() => {
        if (link.pc.signalingState === 'have-local-offer') finish(false);
      }, ANSWER_TIMEOUT_MS);
      const openTimer = window.setTimeout(() => finish(false), OPEN_TIMEOUT_MS);
      const previousOpen = link.onOpen;
      link.onOpen = () => {
        previousOpen?.();
        finish(true);
      };
      const previousClose = link.onClose;
      link.onClose = () => {
        previousClose?.();
        finish(false);
      };
    });
  }

  send(peerId: string, lane: Lane, data: ArrayBuffer | string): boolean {
    return this.links.get(peerId)?.send(lane, data) ?? false;
  }

  /** Manda pra todos os conectados (menos `except`). */
  broadcast(lane: Lane, data: ArrayBuffer | string, except?: string): void {
    for (const [peerId, link] of this.links) if (peerId !== except) link.send(lane, data);
  }

  link(peerId: string): PeerLink | undefined {
    return this.links.get(peerId);
  }

  /** Fecha a conexão com um jogador (saiu, ficou mudo demais, mandou coisa proibida). */
  drop(peerId: string): void {
    this.links.get(peerId)?.close();
  }

  get openPeers(): string[] {
    return [...this.links.entries()].filter(([, link]) => link.isOpen).map(([id]) => id);
  }

  close(): void {
    this.closed = true;
    this.role = 'none';
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.offers.clear();
    this.channel.onSignal = null;
  }

  private createLink(peerId: string, config: IceConfig): PeerLink {
    const link = new PeerLink(peerId, config.servers, this.relayOnly && config.turn, this.sim);
    this.links.set(peerId, link);
    // Caminhos achados depois da oferta/resposta: vão em lote pro outro lado.
    link.onLateCandidates = (candidates) => {
      if (this.links.get(peerId) !== link) return;
      void this.channel.send({ kind: 'candidates', from: this.selfId, to: peerId, nonce: link.nonce, sdp: '', candidates }).catch(() => undefined);
    };
    link.onOpen = () => this.onLinkOpen?.(peerId, link);
    link.onClose = () => {
      // Só avisa se ainda é a conexão atual (reconectar troca o link e fecha o velho).
      if (this.links.get(peerId) === link) {
        this.links.delete(peerId);
        this.onLinkClose?.(peerId);
      }
    };
    link.onMessage = (lane, data) => this.onMessage?.(peerId, lane, data);
    return link;
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    if (this.closed) return;
    if (message.kind === 'offer') {
      // Só o dono aceita ofertas. Oferta de quem já estava conectado = reconexão: troca o link.
      if (this.role !== 'host') return;
      const config = await this.ice();
      if (this.closed || this.role !== 'host') return;
      const old = this.links.get(message.from);
      const link = this.createLink(message.from, config);
      link.nonce = message.nonce;
      old?.close();
      try {
        const sdp = await link.acceptOffer(message.sdp);
        await this.channel.send({ kind: 'answer', from: this.selfId, to: message.from, nonce: message.nonce, sdp });
      } catch {
        link.close();
      }
      return;
    }
    if (message.kind === 'candidates') {
      // Caminhos atrasados: só da tentativa atual com aquele jogador.
      const link = this.links.get(message.from);
      if (link && link.nonce === message.nonce && message.candidates) await link.addRemoteCandidates(message.candidates);
      return;
    }
    // Resposta: só vale a da tentativa atual.
    if (this.offers.get(message.from) !== message.nonce) return;
    this.offers.delete(message.from);
    try {
      await this.links.get(message.from)?.acceptAnswer(message.sdp);
    } catch {
      this.links.get(message.from)?.close();
    }
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Testes: `?relay=1` (só em desenvolvimento) força tudo pelo TURN, como quem está no 4G. */
export function forceRelayFromUrl(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).get('relay') === '1';
}

/**
 * Rede de mentirinha pros testes: `?netsim=150,40,0.05` na URL (só em
 * desenvolvimento) = 150 ms de ida e volta, ±40 ms de tremor, 5% dos retratos perdidos.
 */
export function netSimFromUrl(): NetSim | null {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(location.search).get('netsim');
  if (!raw) return null;
  const [delay = 0, jitter = 0, loss = 0] = raw.split(',').map(Number);
  if (![delay, jitter, loss].every(Number.isFinite)) return null;
  return { delay: Math.max(0, delay), jitter: Math.max(0, jitter), loss: Math.max(0, Math.min(0.9, loss)) };
}
