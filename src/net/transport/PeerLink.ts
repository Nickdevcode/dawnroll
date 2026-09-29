/**
 * Uma conexão WebRTC com outro jogador, com dois canais já combinados (sem
 * negociação extra): `state` (sem garantia, tipo UDP) e `event` (confiável,
 * em ordem). Ver `protocol.ts`.
 *
 * "Meio-trickle": a oferta e a resposta saem com os caminhos que já
 * apareceram em ~1 s (quase sempre todos), e os que chegam depois vão em lotes
 * (`onLateCandidates`). Mandar tudo numa mensagem só economizava a cota do
 * Realtime, mas quando juntar os caminhos demora (TURN lento, rede estranha) a
 * oferta saía sem o caminho do TURN — e quem está no 4G não conectava.
 */

export type Lane = 'state' | 'event';

/** Por onde a conexão acabou passando: direto entre os dois, ou pelo servidor TURN. */
export type Route = 'direct' | 'relay' | 'unknown';

/** Rede de mentirinha pra testar (atraso, tremor e perda), ver `netsim.ts`. */
export interface NetSim {
  delay: number;
  jitter: number;
  loss: number;
}

/** Espera pelos caminhos antes de mandar a oferta/resposta (o resto vai depois, em lotes). */
const GATHER_TIMEOUT_MS = 1200;
/** Caminhos que aparecem depois são juntados por este tempo antes de ir (menos mensagens). */
const CANDIDATE_BATCH_MS = 250;
/** "Desconectado" às vezes volta sozinho (troca de Wi-Fi); depois disso, desiste. */
const DISCONNECTED_GRACE_MS = 5000;
/** Fila do canal sem garantia acima disso = rede engasgada: descarta retrato em vez de acumular. */
const STATE_BUFFER_LIMIT = 64 * 1024;

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private readonly state: RTCDataChannel;
  private readonly event: RTCDataChannel;
  private opened = false;
  private closed = false;
  private disconnectTimer = 0;
  /** Último instante de entrega na lane confiável (a simulação de atraso não pode embaralhar a ordem). */
  private lastEventDelivery = 0;

  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onMessage: ((lane: Lane, data: ArrayBuffer | string) => void) | null = null;
  /** Caminhos achados depois que a oferta/resposta já saiu (a sessão manda pro outro lado). */
  onLateCandidates: ((candidates: RTCIceCandidateInit[]) => void) | null = null;
  /** Identifica a tentativa de conexão (a sinalização descarta mensagem de tentativa velha). */
  nonce = '';
  /** A oferta/resposta já saiu: caminho novo agora é "atrasado" e vai em lote. */
  private described = false;
  private readonly lateBatch: RTCIceCandidateInit[] = [];
  private batchTimer = 0;
  /** Caminhos do outro lado que chegaram antes da descrição dele (aplicados quando ela chegar). */
  private readonly pendingRemote: RTCIceCandidateInit[] = [];

  constructor(
    readonly peerId: string,
    iceServers: RTCIceServer[],
    relayOnly: boolean,
    private readonly sim: NetSim | null = null,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    this.state = this.pc.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.event = this.pc.createDataChannel('event', { negotiated: true, id: 1, ordered: true });
    for (const [lane, channel] of [['state', this.state], ['event', this.event]] as const) {
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => this.checkOpen();
      channel.onclose = () => this.close();
      channel.onmessage = (e: MessageEvent<ArrayBuffer | string>) => this.receive(lane, e.data);
    }
    this.pc.onicecandidate = (e) => {
      if (!e.candidate || !this.described || this.closed) return;
      this.lateBatch.push(e.candidate.toJSON());
      if (this.batchTimer) return;
      this.batchTimer = window.setTimeout(() => {
        this.batchTimer = 0;
        const batch = this.lateBatch.splice(0);
        if (batch.length > 0) this.onLateCandidates?.(batch);
      }, CANDIDATE_BATCH_MS);
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close();
      else if (s === 'disconnected') {
        window.clearTimeout(this.disconnectTimer);
        this.disconnectTimer = window.setTimeout(() => {
          if (this.pc.connectionState === 'disconnected') this.close();
        }, DISCONNECTED_GRACE_MS);
      } else if (s === 'connected') window.clearTimeout(this.disconnectTimer);
    };
  }

  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Quem chama: cria a oferta (já com os caminhos). */
  async createOffer(): Promise<string> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    return this.gathered();
  }

  /** Caminhos do outro lado que chegaram depois (ou antes da descrição dele: ficam na fila). */
  async addRemoteCandidates(candidates: readonly RTCIceCandidateInit[]): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.pendingRemote.push(...candidates);
      return;
    }
    for (const candidate of candidates) await this.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  /** Quem recebe: aceita a oferta e devolve a resposta (já com os caminhos). */
  async acceptOffer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushPending();
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return this.gathered();
  }

  async acceptAnswer(sdp: string): Promise<void> {
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushPending();
  }

  private async flushPending(): Promise<void> {
    const pending = this.pendingRemote.splice(0);
    for (const candidate of pending) await this.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  /**
   * Manda por uma das lanes. No `state`, se a fila estiver cheia (rede
   * engasgada), descarta: o próximo retrato chega em 50 ms de qualquer jeito.
   */
  send(lane: Lane, data: ArrayBuffer | string): boolean {
    if (!this.isOpen) return false;
    const channel = lane === 'state' ? this.state : this.event;
    if (channel.readyState !== 'open') return false;
    if (lane === 'state' && channel.bufferedAmount > STATE_BUFFER_LIMIT) return false;
    try {
      if (typeof data === 'string') channel.send(data);
      else channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Por onde a conexão está passando agora (pro relatório e pro ícone de rede). */
  async route(): Promise<Route> {
    try {
      const stats = await this.pc.getStats();
      let pairId: string | null = null;
      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) pairId = report.selectedCandidatePairId as string;
      });
      let local: string | null = null;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report.id === pairId || (!pairId && report.nominated && report.state === 'succeeded'))) {
          local = report.localCandidateId as string;
        }
      });
      let type: string | null = null;
      stats.forEach((report) => {
        if (report.type === 'local-candidate' && report.id === local) type = report.candidateType as string;
      });
      if (!type) return 'unknown';
      return type === 'relay' ? 'relay' : 'direct';
    } catch {
      return 'unknown';
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.disconnectTimer);
    window.clearTimeout(this.batchTimer);
    try {
      this.state.close();
      this.event.close();
      this.pc.close();
    } catch {
      // Já estava fechando.
    }
    this.onClose?.();
  }

  private checkOpen(): void {
    if (this.opened || this.closed) return;
    if (this.state.readyState === 'open' && this.event.readyState === 'open') {
      this.opened = true;
      this.onOpen?.();
    }
  }

  private receive(lane: Lane, data: ArrayBuffer | string): void {
    if (this.closed) return;
    const sim = this.sim;
    if (!sim) {
      this.onMessage?.(lane, data);
      return;
    }
    // Rede de mentirinha: perde retrato (nunca evento) e atrasa tudo; a lane confiável não troca de ordem.
    if (lane === 'state' && Math.random() < sim.loss) return;
    let at = performance.now() + sim.delay / 2 + (Math.random() * 2 - 1) * (sim.jitter / 2);
    if (lane === 'event') {
      at = Math.max(at, this.lastEventDelivery);
      this.lastEventDelivery = at;
    }
    window.setTimeout(() => {
      if (!this.closed) this.onMessage?.(lane, data);
    }, Math.max(0, at - performance.now()));
  }

  /**
   * Espera juntar os caminhos (ou o tempo acabar) e devolve a descrição com os
   * que já apareceram. Daqui pra frente, caminho novo vai em lote (`onLateCandidates`).
   */
  private gathered(): Promise<string> {
    const pc = this.pc;
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        window.clearTimeout(timer);
        this.described = true;
        resolve(pc.localDescription?.sdp ?? '');
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const timer = window.setTimeout(done, GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', check);
      check();
    });
  }
}
