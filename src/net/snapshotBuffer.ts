import type { AssistPose, BallPose, BeetlePose } from './protocol';

/**
 * Fila de poses de uma coisa remota (o besouro de um jogador, ou uma bola),
 * pra desenhar ela suave mesmo com a rede tremendo: o jogo mostra os outros um
 * pouquinho no passado (`delay`) e interpola entre as duas poses em volta desse
 * instante. Faltou pose (pacote perdido), continua a trajetória por até
 * `MAX_EXTRAPOLATION`; depois disso a coisa para onde estava (melhor parada que
 * voando pro nada).
 *
 * A folga se ajusta sozinha ao tremor da rede (rede lisa, 100 ms; rede ruim,
 * até 300 ms), e muda devagar: se ela pulasse, o instante desenhado voltaria
 * no tempo e o besouro dos outros engasgaria.
 */

/** Duas poses (a 20 Hz): uma perdida não deixa o desenho sem ter pra onde ir. */
const MIN_DELAY = 0.1;
const MAX_DELAY = 0.3;
/** Quanto a folga anda por chamada (60 por segundo): ~2 s pra chegar no alvo, sem o tempo voltar. */
const DELAY_EASE = 0.01;
/** Quanto tempo continua o movimento sem pose nova. */
const MAX_EXTRAPOLATION = 0.25;
const CAPACITY = 32;

/** Como interpolar um tipo de pose. */
export interface PoseOps<T> {
  create(): T;
  copy(out: T, from: T): void;
  lerp(out: T, a: T, b: T, t: number): void;
  /** Continua o movimento `ahead` segundos além da última pose (opcional: o besouro fica parado). */
  extrapolate?(out: T, ahead: number): void;
}

interface Timed<T> {
  time: number;
  pose: T;
}

export class PoseBuffer<T> {
  private readonly items: Array<Timed<T>> = [];
  /** Tremor medido: média do desvio entre o intervalo esperado e o que chegou. */
  private jitter = 0.02;
  private lastArrival = 0;
  /** Folga atual (suavizada; ver `delay`). */
  private smoothedDelay = MIN_DELAY;
  private readonly out: T;
  /** Sem pose há tempo demais (congelou: aba escondida, internet caindo). */
  stale = true;

  constructor(private readonly ops: PoseOps<T>) {
    this.out = ops.create();
  }

  /**
   * Chegou uma pose (fora de ordem ou repetida é descartada). `time` = relógio
   * da sala no retrato; `arrival` = relógio da sala na chegada. A pose é
   * copiada (o retrato que veio pode ser reaproveitado).
   */
  push(time: number, pose: T, arrival: number, interval: number): void {
    const last = this.items[this.items.length - 1];
    if (last && time <= last.time) return;
    if (this.lastArrival > 0) {
      const gap = arrival - this.lastArrival;
      this.jitter += (Math.abs(gap - interval) - this.jitter) * 0.1;
    }
    this.lastArrival = arrival;
    const recycled = this.items.length >= CAPACITY ? this.items.shift()! : { time, pose: this.ops.create() };
    recycled.time = time;
    this.ops.copy(recycled.pose, pose);
    this.items.push(recycled);
  }

  /** Folga atual (s): dois intervalos + o tremor, dentro dos limites, andando devagar até o alvo. Chamar uma vez por passo. */
  delay(interval: number): number {
    const target = Math.max(MIN_DELAY, Math.min(MAX_DELAY, interval * 2 + this.jitter * 3));
    this.smoothedDelay += (target - this.smoothedDelay) * DELAY_EASE;
    return this.smoothedDelay;
  }

  /** A pose mais nova que chegou (e o instante dela), sem atraso nenhum. */
  get latest(): Timed<T> | null {
    return this.items[this.items.length - 1] ?? null;
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items.length = 0;
    this.lastArrival = 0;
    this.stale = true;
  }

  /** Pose no instante `time` (relógio da sala). Null se ainda não chegou nada. */
  sample(time: number): T | null {
    const items = this.items;
    if (items.length === 0) return null;
    const out = this.out;
    // Descarta o que já ficou pra trás (mantém uma antes do instante pra interpolar).
    while (items.length > 2 && items[1].time <= time) items.shift();
    const a = items[0];
    const b = items[1];
    if (!b || time <= a.time) {
      // Só uma pose (ou o instante é anterior a todas): segura nela, continuando o movimento um pouco.
      const ahead = Math.max(0, Math.min(time - a.time, MAX_EXTRAPOLATION));
      this.ops.copy(out, a.pose);
      if (ahead > 0) this.ops.extrapolate?.(out, ahead);
      this.stale = time - a.time > MAX_EXTRAPOLATION;
      return out;
    }
    const span = b.time - a.time;
    const t = span > 1e-6 ? Math.min(1, (time - a.time) / span) : 1;
    this.ops.lerp(out, a.pose, b.pose, t);
    this.stale = false;
    return out;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Pose do besouro de um jogador remoto + a ajuda dele no empurrão de alguém. */
export interface RemoteBeetlePose {
  beetle: BeetlePose;
  assist: AssistPose;
}

export const beetleOps: PoseOps<RemoteBeetlePose> = {
  create: () => ({
    beetle: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0, pushBlend: 0, strain: 0, grounded: true, riding: false, dizzy: false },
    assist: { ball: 0, ax: 0, az: 0 },
  }),
  copy(out, from) {
    Object.assign(out.beetle, from.beetle);
    Object.assign(out.assist, from.assist);
  },
  lerp(out, a, b, t) {
    const ob = out.beetle;
    ob.x = lerp(a.beetle.x, b.beetle.x, t);
    ob.y = lerp(a.beetle.y, b.beetle.y, t);
    ob.z = lerp(a.beetle.z, b.beetle.z, t);
    ob.yaw = lerpAngle(a.beetle.yaw, b.beetle.yaw, t);
    ob.speed = lerp(a.beetle.speed, b.beetle.speed, t);
    ob.vy = lerp(a.beetle.vy, b.beetle.vy, t);
    ob.pushBlend = lerp(a.beetle.pushBlend, b.beetle.pushBlend, t);
    ob.strain = lerp(a.beetle.strain, b.beetle.strain, t);
    const late = t >= 0.5 ? b : a;
    ob.grounded = late.beetle.grounded;
    ob.riding = late.beetle.riding;
    ob.dizzy = late.beetle.dizzy;
    Object.assign(out.assist, late.assist);
  },
};

export const ballOps: PoseOps<BallPose> = {
  create: () => ({ id: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, radius: 0.5, burying: false, pushed: false, immune: false, gift: false, glow: 0 }),
  copy(out, from) {
    Object.assign(out, from);
  },
  lerp(out, a, b, t) {
    out.id = a.id;
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
    // Quatérnio: slerp barato (nlerp) pelo caminho curto.
    const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
    const sign = dot < 0 ? -1 : 1;
    let qx = lerp(a.qx, b.qx * sign, t);
    let qy = lerp(a.qy, b.qy * sign, t);
    let qz = lerp(a.qz, b.qz * sign, t);
    let qw = lerp(a.qw, b.qw * sign, t);
    const len = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= len;
    qy /= len;
    qz /= len;
    qw /= len;
    out.qx = qx;
    out.qy = qy;
    out.qz = qz;
    out.qw = qw;
    out.vx = lerp(a.vx, b.vx, t);
    out.vy = lerp(a.vy, b.vy, t);
    out.vz = lerp(a.vz, b.vz, t);
    out.radius = lerp(a.radius, b.radius, t);
    out.glow = lerp(a.glow, b.glow, t);
    const late = t >= 0.5 ? b : a;
    out.burying = late.burying;
    out.pushed = late.pushed;
    out.immune = late.immune;
    out.gift = late.gift;
  },
  // A bola tem inércia: continua rolando um pouco (o besouro, não: fica onde estava).
  extrapolate(out, ahead) {
    out.x += out.vx * ahead;
    out.y += out.vy * ahead * 0.5;
    out.z += out.vz * ahead;
  },
};
