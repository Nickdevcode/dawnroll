import { createNoiseBank, createReverbImpulse, type NoiseBank } from './dsp';
import type { Recipe } from './voices/kit';

/**
 * Motor de áudio: o AudioContext, a mesa de mixagem, o som 3D e o ciclo de
 * vida (nasce no primeiro gesto, dorme com a aba escondida ou no mudo).
 *
 * Mesa de mixagem:
 *
 *   fx ────────┐                         (efeitos do mundo)
 *   ambience ──┴─ abafador de pausa ──┐  (natureza, chuva, bichos)
 *   night ────────────────────────────┤  (grilos e coruja do menu: não abafa)
 *   music ── duck ────────────────────┤
 *   ui ───────────────────────────────┤
 *   reverb (todos mandam um pouco) ───┴─ master → compressor → limitador → saída
 *
 * Cada canal manda uma parte fixa para o reverb, e cada som pode mandar mais.
 * Os envios passam pelo volume do canal: volume zero é silêncio de verdade,
 * sem cauda de reverb sobrando.
 */

export type BusName = 'fx' | 'ambience' | 'night' | 'music' | 'ui';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlayOptions {
  bus?: BusName;
  /** Posição no mundo. Sem ela, o som toca "na cabeça" (sem espacializar). */
  at?: Vec3Like | null;
  /** Envio extra para o reverb (0..1), além do fixo do canal. */
  reverb?: number;
  gain?: number;
  /** Instante absoluto no relógio do contexto (música). Sem ele, toca agora (+ `delay`). */
  when?: number;
  delay?: number;
  /** Anti-metralhadora: o mesmo `key` não toca de novo antes de `minInterval` segundos. */
  key?: string;
  minInterval?: number;
  /** Toca mesmo com o orçamento de vozes estourado (música, fanfarra). */
  essential?: boolean;
  /**
   * Nó próprio no lugar da entrada do canal (ex.: uma camada da trilha com
   * volume independente). Quem passa é responsável por ligá-lo no canal.
   */
  via?: AudioNode;
}

export interface AudioVolumes {
  master: number;
  music: number;
  effects: number;
  ambience: number;
}

interface Bus {
  /** Entrada do canal (com o volume dele). */
  readonly input: GainNode;
  /** Envio extra por som para o reverb (também com o volume do canal). */
  readonly send: GainNode;
}

/** Ganho final com volume geral em 100%. */
const MASTER_TRIM = 0.95;
/** Acerto fino da trilha contra os efeitos (medido: ~6 dB abaixo dos eventos grandes). */
const MUSIC_TRIM = 1;
/** Folga entre agendar e tocar: evita que o começo do envelope caia "no passado". */
const START_LATENCY = 0.012;
/** Quanto à frente os agendadores (música, grilos) preparam as notas. */
const LOOKAHEAD = 0.3;
const CLOCK_MS = 40;
/** Quanto de cada canal vai para o reverb sempre. */
const BUS_REVERB: Record<BusName, number> = { fx: 0.1, ambience: 0.16, night: 0.3, music: 0.28, ui: 0.05 };
const MUFFLED_HZ = 850;

/** Fonte contínua (loop) com posição opcional no mundo. */
export class Emitter {
  constructor(
    private readonly ctx: AudioContext,
    /** Ligue as fontes aqui. */
    readonly input: GainNode,
    private readonly panner: PannerNode | null,
  ) {}

  moveTo(p: Vec3Like): void {
    const panner = this.panner;
    if (!panner || !Number.isFinite(p.x + p.y + p.z)) return;
    const t = this.ctx.currentTime;
    panner.positionX.setTargetAtTime(p.x, t, 0.03);
    panner.positionY.setTargetAtTime(p.y, t, 0.03);
    panner.positionZ.setTargetAtTime(p.z, t, 0.03);
  }
}

export class AudioEngine {
  /** Chamado uma vez, quando o contexto nasce (hora de montar os loops). */
  onReady: (() => void) | null = null;

  private ctx: AudioContext | null = null;
  private bank: NoiseBank | null = null;
  private buses!: Record<BusName, Bus>;
  private master!: GainNode;
  private worldFilter!: BiquadFilterNode;
  private worldGain!: GainNode;
  private musicDuck!: GainNode;
  private reverbIn!: GainNode;
  private meter: AnalyserNode | null = null;

  private volumes: AudioVolumes = { master: 0.8, music: 0.7, effects: 1, ambience: 0.8 };
  private muted = false;
  private hidden = typeof document !== 'undefined' && document.hidden;
  private failed = false;
  private voices = 0;
  private suspendTimer = 0;
  private readonly lastPlayed = new Map<string, number>();
  private readonly schedulers = new Set<(now: number, horizon: number) => void>();

  constructor(
    private readonly maxVoices: number,
    private readonly reverbSeconds: number,
  ) {}

  get context(): AudioContext | null {
    return this.ctx;
  }

  get noise(): NoiseBank | null {
    return this.bank;
  }

  /** Contexto rodando e sem mudo: vale a pena montar sons novos. */
  get audible(): boolean {
    return this.ctx?.state === 'running' && !this.muted;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * Chamar dentro de um gesto do jogador (clique, toque, tecla): cria o
   * contexto na primeira vez e acorda ele depois (o iOS o interrompe em
   * ligações, alarmes e troca de app).
   */
  unlock(): void {
    if (this.failed) return;
    if (!this.ctx) this.create();
    this.syncRunState();
  }

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = { ...volumes };
    this.applyVolumes(0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes(0.05);
    this.syncRunState();
  }

  /** Aba escondida: o contexto dorme (bateria) e acorda na volta. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.syncRunState();
  }

  /** Abafa o mundo (pausa): 0 = normal, 1 = atrás de uma porta. */
  setMuffle(amount: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const frequency = 20000 * Math.pow(MUFFLED_HZ / 20000, amount);
    this.worldFilter.frequency.setTargetAtTime(frequency, ctx.currentTime, seconds / 3);
    this.worldGain.gain.setTargetAtTime(1 - 0.3 * amount, ctx.currentTime, seconds / 3);
  }

  /** Abaixa a trilha por `hold` segundos (fanfarra, marco) e devolve devagar. */
  duckMusic(depth: number, hold: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = this.musicDuck.gain;
    const t = ctx.currentTime;
    const current = gain.value;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(current, t);
    gain.setTargetAtTime(1 - depth, t, 0.06);
    gain.setTargetAtTime(1, t + hold, 0.7);
  }

  /** Ouvido do jogador: posição e orientação (frente e cima) no mundo. */
  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    const ctx = this.ctx;
    if (!ctx || !Number.isFinite(position.x + position.y + position.z + forward.x + forward.y + forward.z)) return;
    const listener = ctx.listener;
    // Firefox ainda não tem os AudioParams do ouvinte: cai na API antiga.
    if (listener.positionX) {
      const t = ctx.currentTime;
      const k = 0.02;
      listener.positionX.setTargetAtTime(position.x, t, k);
      listener.positionY.setTargetAtTime(position.y, t, k);
      listener.positionZ.setTargetAtTime(position.z, t, k);
      listener.forwardX.setTargetAtTime(forward.x, t, k);
      listener.forwardY.setTargetAtTime(forward.y, t, k);
      listener.forwardZ.setTargetAtTime(forward.z, t, k);
      listener.upX.setTargetAtTime(up.x, t, k);
      listener.upY.setTargetAtTime(up.y, t, k);
      listener.upZ.setTargetAtTime(up.z, t, k);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * Toca uma receita. Monta a cadeia (panner, envio de reverb), chama a
   * receita e desmonta tudo quando o som termina. Sem contexto, no mudo ou
   * com vozes demais (e não essencial), não faz nada.
   */
  play(recipe: Recipe, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank || !this.audible) return;
    const now = ctx.currentTime;
    if (o.key) {
      const last = this.lastPlayed.get(o.key) ?? -Infinity;
      if (now - last < (o.minInterval ?? 0.03)) return;
      this.lastPlayed.set(o.key, now);
    }
    if (!o.essential && this.voices >= this.maxVoices) return;

    const busName = o.bus ?? 'fx';
    const bus = this.buses[busName];
    const input = new GainNode(ctx, { gain: o.gain ?? 1 });
    const owned: AudioNode[] = [input];
    const target = o.via ?? (busName === 'music' ? this.musicDuck : bus.input);
    if (o.at) {
      const panner = this.createPanner(o.at);
      input.connect(panner).connect(target);
      owned.push(panner);
    } else {
      input.connect(target);
    }
    if (o.reverb) {
      const send = new GainNode(ctx, { gain: o.reverb });
      input.connect(send).connect(bus.send);
      owned.push(send);
    }

    const start = Math.max(o.when ?? 0, now + START_LATENCY + (o.delay ?? 0));
    let duration: number;
    try {
      duration = recipe({ ctx, out: input, t: start, noise: bank });
    } catch (error) {
      // Valor inválido vindo do jogo (NaN...) não pode derrubar o quadro.
      if (import.meta.env.DEV) console.warn('[audio] receita falhou', error);
      duration = 0;
    }
    this.voices++;
    window.setTimeout(
      () => {
        this.voices--;
        for (const node of owned) node.disconnect();
      },
      (start - now + duration + 0.25) * 1000,
    );
  }

  /** Saída para um som contínuo (loop), com ou sem posição no mundo. Só existe depois do `onReady`. */
  emitter(bus: BusName, spatial: boolean): Emitter {
    const ctx = this.ctx!;
    const input = new GainNode(ctx, { gain: 1 });
    const target = bus === 'music' ? this.musicDuck : this.buses[bus].input;
    let panner: PannerNode | null = null;
    if (spatial) {
      panner = this.createPanner({ x: 0, y: -1000, z: 0 });
      input.connect(panner).connect(target);
    } else {
      input.connect(target);
    }
    return new Emitter(ctx, input, panner);
  }

  /** Registra quem agenda notas com antecedência (chamado a cada ~40 ms com o horizonte). */
  addScheduler(fn: (now: number, horizon: number) => void): void {
    this.schedulers.add(fn);
  }

  /** Nível atual da saída em dBFS (só em desenvolvimento, para medir a mixagem). */
  readMeter(): { peak: number; rms: number } | null {
    const meter = this.meter;
    if (!meter) return null;
    const data = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data);
    let peak = 0;
    let sum = 0;
    for (const s of data) {
      peak = Math.max(peak, Math.abs(s));
      sum += s * s;
    }
    const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { peak: toDb(peak), rms: toDb(Math.sqrt(sum / data.length)) };
  }

  // --- montagem ---------------------------------------------------------------

  private create(): void {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      // Sem saída de áudio (ou navegador sem Web Audio): o jogo segue mudo.
      console.warn('[audio] sem Web Audio', error);
      this.failed = true;
      return;
    }
    this.ctx = ctx;
    this.bank = createNoiseBank(ctx);

    const limiter = new DynamicsCompressorNode(ctx, { threshold: -1.5, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });
    // "Cola" suave: segura os picos quando trilha, chuva e efeitos coincidem.
    const glue = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 10, ratio: 2, attack: 0.015, release: 0.3 });
    this.master = new GainNode(ctx, { gain: 0 });
    this.master.connect(glue).connect(limiter).connect(ctx.destination);
    if (import.meta.env.DEV) {
      this.meter = new AnalyserNode(ctx, { fftSize: 2048 });
      limiter.connect(this.meter);
    }

    this.reverbIn = new GainNode(ctx, { gain: 1 });
    const convolver = new ConvolverNode(ctx, { buffer: createReverbImpulse(ctx, this.reverbSeconds, 3.4) });
    this.reverbIn.connect(convolver).connect(new GainNode(ctx, { gain: 0.8 })).connect(this.master);

    this.worldFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.worldGain = new GainNode(ctx, { gain: 1 });
    this.worldFilter.connect(this.worldGain).connect(this.master);

    const makeBus = (name: BusName, destination: AudioNode): Bus => {
      const input = new GainNode(ctx, { gain: 0 });
      const send = new GainNode(ctx, { gain: 0 });
      input.connect(destination);
      input.connect(new GainNode(ctx, { gain: BUS_REVERB[name] })).connect(this.reverbIn);
      send.connect(this.reverbIn);
      return { input, send };
    };
    this.buses = {
      fx: makeBus('fx', this.worldFilter),
      ambience: makeBus('ambience', this.worldFilter),
      night: makeBus('night', this.master),
      music: makeBus('music', this.master),
      ui: makeBus('ui', this.master),
    };
    this.musicDuck = new GainNode(ctx, { gain: 1 });
    this.musicDuck.connect(this.buses.music.input);

    this.applyVolumes(0);
    window.setInterval(() => this.tick(), CLOCK_MS);
    this.onReady?.();
  }

  private createPanner(at: Vec3Like): PannerNode {
    return new PannerNode(this.ctx!, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 3.5,
      maxDistance: 200,
      rolloffFactor: 1.15,
      positionX: at.x,
      positionY: at.y,
      positionZ: at.z,
    });
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const fn of this.schedulers) fn(now, now + LOOKAHEAD);
  }

  private applyVolumes(smoothing: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (smoothing > 0) param.setTargetAtTime(value, t, smoothing);
      else param.setValueAtTime(value, t);
    };
    const v = this.volumes;
    // Curva quadrática: o slider "soa" linear para o ouvido.
    set(this.master.gain, this.muted ? 0 : MASTER_TRIM * v.master ** 2);
    const level: Record<BusName, number> = {
      fx: v.effects ** 2,
      ui: v.effects ** 2,
      ambience: v.ambience ** 2,
      night: v.ambience ** 2,
      music: MUSIC_TRIM * v.music ** 2,
    };
    for (const name of Object.keys(this.buses) as BusName[]) {
      set(this.buses[name].input.gain, level[name]);
      set(this.buses[name].send.gain, level[name]);
    }
  }

  /** Roda quando deve (sem mudo e com a aba visível); dorme quando não deve, depois do fade. */
  private syncRunState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    window.clearTimeout(this.suspendTimer);
    const shouldRun = !this.muted && !this.hidden;
    if (shouldRun) {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    } else if (ctx.state === 'running') {
      this.suspendTimer = window.setTimeout(() => ctx.suspend().catch(() => {}), this.hidden ? 0 : 300);
    }
  }
}
