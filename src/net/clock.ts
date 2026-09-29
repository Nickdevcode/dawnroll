/**
 * Relógio da sala. Cada aparelho tem o seu `performance.now()`, que começa em
 * zero quando a aba abre: pra todo mundo concordar sobre "quando" foi um
 * retrato, os jogadores estimam a diferença pro relógio do dono da sala (tipo
 * NTP): mandam um ping com a hora local, o dono responde com a hora dele, e
 * metade da ida e volta é o atraso de um lado.
 *
 * Fica com a medida de menor ida e volta das últimas (a que menos sofreu com
 * fila na rede) e anda devagar até ela, pra o relógio nunca dar pulo.
 */
export class RoomClock {
  /** Relógio da sala − relógio local (segundos). */
  private offset = 0;
  private targetOffset = 0;
  private synced = false;
  /** Últimas medidas (ida e volta, diferença). */
  private readonly samples: Array<{ rtt: number; offset: number }> = [];
  /** Ida e volta da melhor medida recente (ms), pra mostrar o ping. */
  private bestRtt = 0;

  /** Agora, no relógio local (segundos). */
  static local(): number {
    return performance.now() / 1000;
  }

  /** Agora, no relógio da sala (segundos). */
  now(): number {
    return RoomClock.local() + this.offset;
  }

  /**
   * Virou o dono da sala: o relógio dele passa a ser o da sala. Continua de onde
   * estava (quem assume no meio não faz o tempo da sala pular).
   */
  becomeReference(): void {
    this.targetOffset = this.offset;
    this.synced = true;
    this.samples.length = 0;
    this.bestRtt = 0;
  }

  /**
   * Primeira ideia do relógio da sala (a hora do dono no "welcome", sem saber
   * o atraso). Não conta como medida: o primeiro "pong" corrige de uma vez.
   */
  seed(hostTime: number): void {
    if (this.samples.length > 0) return;
    this.offset = this.targetOffset = hostTime - RoomClock.local();
    this.synced = false;
  }

  /** Chegou o "pong": `sentLocal` = hora local do ping, `hostTime` = hora do dono ao responder. */
  addSample(sentLocal: number, hostTime: number): void {
    const now = RoomClock.local();
    const rtt = now - sentLocal;
    if (rtt < 0 || rtt > 5) return;
    const offset = hostTime + rtt / 2 - now;
    this.samples.push({ rtt, offset });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.bestRtt = best.rtt * 1000;
    this.targetOffset = best.offset;
    if (!this.synced) {
      this.offset = best.offset;
      this.synced = true;
    }
  }

  /** Um passo de ajuste: anda no máximo 5 ms por segundo até a melhor medida (sem pulo). */
  update(dt: number): void {
    const diff = this.targetOffset - this.offset;
    const step = 0.005 * dt;
    this.offset += Math.max(-step, Math.min(step, diff));
    // Diferença grande (aba dormiu, relógio pulou): encaixa de uma vez.
    if (Math.abs(diff) > 0.25) this.offset = this.targetOffset;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  /** Ping até o dono da sala (ms; 0 = sem medida, ou é o próprio dono). */
  get ping(): number {
    return Math.round(this.bestRtt);
  }
}
