import type { PlayerSnapshot } from './protocol';

/**
 * Fila de retratos de um jogador remoto, pra desenhar ele suave mesmo com a
 * rede tremendo: o jogo mostra os outros um pouquinho no passado (`delay`) e
 * interpola entre os dois retratos em volta desse instante. Faltou retrato
 * (pacote perdido), continua a trajetória por até `MAX_EXTRAPOLATION`; depois
 * disso o besouro para onde estava (melhor parado que voando pro nada).
 *
 * A folga se ajusta sozinha ao tremor da rede (rede lisa, 100 ms; rede ruim,
 * até 300 ms), e muda devagar: se ela pulasse, o instante desenhado voltaria
 * no tempo e o besouro dos outros engasgaria.
 */

/** Dois retratos (a 20 Hz): um perdido não deixa o desenho sem ter pra onde ir. */
const MIN_DELAY = 0.1;
const MAX_DELAY = 0.3;
/** Quanto a folga anda por chamada (60 por segundo): ~2 s pra chegar no alvo, sem o tempo voltar. */
const DELAY_EASE = 0.01;
/** Quanto tempo continua o movimento sem retrato novo. */
const MAX_EXTRAPOLATION = 0.25;
const CAPACITY = 32;

/** Pose interpolada pronta pra usar (reaproveitada entre quadros). */
export interface SampledPose {
  beetle: PlayerSnapshot['beetle'];
  ball: PlayerSnapshot['ball'];
  /** Sem retrato há tempo demais (o jogador congelou: aba escondida, internet caindo). */
  stale: boolean;
}

export class SnapshotBuffer {
  private readonly items: PlayerSnapshot[] = [];
  /** Tremor medido: média do desvio entre o intervalo esperado e o que chegou. */
  private jitter = 0.02;
  private lastArrival = 0;
  /** Folga atual (suavizada; ver `delay`). */
  private smoothedDelay = MIN_DELAY;
  private readonly out: SampledPose = {
    beetle: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0, pushBlend: 0, strain: 0, grounded: true, riding: false },
    ball: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, radius: 0.5, burying: false },
    stale: true,
  };

  /** Chegou um retrato (fora de ordem ou repetido é descartado). `arrival` = relógio da sala na chegada. */
  push(snapshot: PlayerSnapshot, arrival: number, interval: number): void {
    const last = this.items[this.items.length - 1];
    if (last && snapshot.time <= last.time) return;
    if (this.lastArrival > 0) {
      const gap = arrival - this.lastArrival;
      this.jitter += (Math.abs(gap - interval) - this.jitter) * 0.1;
    }
    this.lastArrival = arrival;
    this.items.push(snapshot);
    if (this.items.length > CAPACITY) this.items.shift();
  }

  /** Folga atual (s): dois intervalos + o tremor, dentro dos limites, andando devagar até o alvo. Chamar uma vez por passo. */
  delay(interval: number): number {
    const target = Math.max(MIN_DELAY, Math.min(MAX_DELAY, interval * 2 + this.jitter * 3));
    this.smoothedDelay += (target - this.smoothedDelay) * DELAY_EASE;
    return this.smoothedDelay;
  }

  get latest(): PlayerSnapshot | null {
    return this.items[this.items.length - 1] ?? null;
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items.length = 0;
    this.lastArrival = 0;
  }

  /** Pose no instante `time` (relógio da sala). Null se ainda não chegou nada. */
  sample(time: number): SampledPose | null {
    const items = this.items;
    if (items.length === 0) return null;
    const out = this.out;
    // Descarta o que já ficou pra trás (mantém um antes do instante pra interpolar).
    while (items.length > 2 && items[1].time <= time) items.shift();
    const a = items[0];
    const b = items[1];
    if (!b || time <= a.time) {
      // Só um retrato (ou o instante é anterior a todos): segura nele. A bola continua
      // rolando por um pouco se já passou dele (ela tem inércia; o besouro fica onde estava).
      const ahead = Math.max(0, Math.min(time - a.time, MAX_EXTRAPOLATION));
      copyPose(out, a);
      out.ball.x += a.ball.vx * ahead;
      out.ball.y += a.ball.vy * ahead * 0.5;
      out.ball.z += a.ball.vz * ahead;
      out.stale = time - a.time > MAX_EXTRAPOLATION;
      return out;
    }
    const span = b.time - a.time;
    const t = span > 1e-6 ? Math.min(1, (time - a.time) / span) : 1;
    lerpPose(out, a, b, t);
    out.stale = false;
    return out;
  }
}

function copyPose(out: SampledPose, s: PlayerSnapshot): void {
  Object.assign(out.beetle, s.beetle);
  Object.assign(out.ball, s.ball);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerpPose(out: SampledPose, a: PlayerSnapshot, b: PlayerSnapshot, t: number): void {
  const ob = out.beetle;
  ob.x = lerp(a.beetle.x, b.beetle.x, t);
  ob.y = lerp(a.beetle.y, b.beetle.y, t);
  ob.z = lerp(a.beetle.z, b.beetle.z, t);
  ob.yaw = lerpAngle(a.beetle.yaw, b.beetle.yaw, t);
  ob.speed = lerp(a.beetle.speed, b.beetle.speed, t);
  ob.vy = lerp(a.beetle.vy, b.beetle.vy, t);
  ob.pushBlend = lerp(a.beetle.pushBlend, b.beetle.pushBlend, t);
  ob.strain = lerp(a.beetle.strain, b.beetle.strain, t);
  ob.grounded = t < 0.5 ? a.beetle.grounded : b.beetle.grounded;
  ob.riding = t < 0.5 ? a.beetle.riding : b.beetle.riding;

  const oa = out.ball;
  oa.x = lerp(a.ball.x, b.ball.x, t);
  oa.y = lerp(a.ball.y, b.ball.y, t);
  oa.z = lerp(a.ball.z, b.ball.z, t);
  // Quatérnio: slerp barato (nlerp) pelo caminho curto.
  const dot = a.ball.qx * b.ball.qx + a.ball.qy * b.ball.qy + a.ball.qz * b.ball.qz + a.ball.qw * b.ball.qw;
  const sign = dot < 0 ? -1 : 1;
  let qx = lerp(a.ball.qx, b.ball.qx * sign, t);
  let qy = lerp(a.ball.qy, b.ball.qy * sign, t);
  let qz = lerp(a.ball.qz, b.ball.qz * sign, t);
  let qw = lerp(a.ball.qw, b.ball.qw * sign, t);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= len;
  qy /= len;
  qz /= len;
  qw /= len;
  oa.qx = qx;
  oa.qy = qy;
  oa.qz = qz;
  oa.qw = qw;
  oa.vx = lerp(a.ball.vx, b.ball.vx, t);
  oa.vy = lerp(a.ball.vy, b.ball.vy, t);
  oa.vz = lerp(a.ball.vz, b.ball.vz, t);
  oa.radius = lerp(a.ball.radius, b.ball.radius, t);
  oa.burying = t < 0.5 ? a.ball.burying : b.ball.burying;
}
