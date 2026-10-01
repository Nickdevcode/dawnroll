import { QUALITY_TIERS, stepTier, type QualityTier } from './device';

/** Abaixo disso (média de quadros por segundo) o jogo já parece travado. */
const TARGET_FPS = 50;
/** Tempo de medição por janela (segundos de jogo de verdade). */
const WINDOW_SECONDS = 4;
/** Quadros ignorados depois de trocar de degrau ou de voltar do menu (compila, aloca, engasga). */
const WARMUP_SECONDS = 2.5;
/** Um quadro sozinho não pesa mais que isso na média (um engasgo não derruba a qualidade). */
const FRAME_CAP = 0.1;
/** Uma descida precisa render pelo menos isso de FPS; senão o limite é outro (tela de 48 Hz, CPU) e ela volta. */
const MIN_GAIN = 1.08;
/** Depois de uma descida que não adiantou, não tenta de novo por um tempo. */
const SETTLE_SECONDS = 90;
/** Na Mínima, o que ainda dá pra cortar é resolução: passos de 15%, até 60% da dela. */
const RESOLUTION_STEP = 0.85;
const RESOLUTION_FLOOR = 0.6;
/** Folga pra subir: GPU abaixo dessa fração do tempo de um quadro, CPU abaixo dessa outra. */
const CLIMB_GPU_SHARE = 0.35;
const CLIMB_CPU_SHARE = 0.45;
const CLIMB_WINDOWS = 3;

export interface AdaptiveChange {
  tier: QualityTier;
  /** Corte extra de resolução (1 = o do degrau). Só a Mínima usa. */
  resolutionScale: number;
}

/**
 * Qualidade "Auto" durante o jogo: mede janelas de ~4 s de jogo de verdade e
 * desce um degrau quando a média fica abaixo de ~50 fps (duas janelas seguidas,
 * ou uma bem ruim). Cada descida precisa pagar: se o FPS não melhorar, o
 * limite é outro (tela de 48 Hz, processador) e ela volta atrás. Só sobe com o
 * relógio da GPU confirmando folga de sobra, e nunca acima de onde já caiu.
 */
export class AdaptiveQuality {
  private tier: QualityTier;
  private resolutionScale = 1;
  private warmup = WARMUP_SECONDS;
  private windowTime = 0;
  private readonly frames: number[] = [];
  private readonly cpu: number[] = [];
  private readonly gpu: number[] = [];
  private slowWindows = 0;
  private fastWindows = 0;
  /** A última descida: de onde veio e com quanto FPS (pra ver se adiantou). */
  private pending: { tier: QualityTier; scale: number; fps: number; ceiling: QualityTier } | null = null;
  /** Segundos até poder descer de novo depois de uma descida inútil. */
  private settle = 0;
  /** Teto desta sessão: depois de cair de um degrau, não sobe mais até ele. */
  private ceiling: QualityTier = 'ultra';

  constructor(start: QualityTier) {
    this.tier = start;
  }

  get current(): AdaptiveChange {
    return { tier: this.tier, resolutionScale: this.resolutionScale };
  }

  /** Recomeça num degrau (o jogador escolheu o Auto de novo). */
  restart(tier: QualityTier): void {
    this.tier = tier;
    this.resolutionScale = 1;
    this.ceiling = 'ultra';
    this.pending = null;
    this.settle = 0;
    this.resetWindow(WARMUP_SECONDS);
  }

  /**
   * Um quadro. `measuring` = jogando de verdade (sem menu, sem cartas, aba à
   * vista). `cpuMs` = quanto o quadro levou no JavaScript; `gpuMs` = tempo da
   * placa de vídeo, quando o navegador deixa medir. Devolve a mudança, se houve.
   */
  update(frameTime: number, measuring: boolean, cpuMs: number, gpuMs: number | null): AdaptiveChange | null {
    if (this.settle > 0) this.settle -= frameTime;
    if (!measuring) {
      // Voltou do menu: os primeiros quadros ainda carregam o que acabou de abrir/fechar.
      this.warmup = Math.max(this.warmup, 1.5);
      return null;
    }
    if (this.warmup > 0) {
      this.warmup -= frameTime;
      return null;
    }
    this.frames.push(frameTime);
    this.cpu.push(cpuMs);
    if (gpuMs !== null) this.gpu.push(gpuMs);
    this.windowTime += frameTime;
    if (this.windowTime < WINDOW_SECONDS) return null;
    return this.evaluate();
  }

  private evaluate(): AdaptiveChange | null {
    const frames = this.frames;
    let total = 0;
    for (const f of frames) total += Math.min(f, FRAME_CAP);
    const fps = frames.length / total;
    // Os quadros mais rápidos mostram o ritmo da tela (com vsync, nunca passam dela).
    const refreshInterval = percentile(frames, 0.1);
    const gpuMs = this.gpu.length > frames.length * 0.5 ? percentile(this.gpu, 0.75) : null;
    const cpuMs = percentile(this.cpu, 0.75);
    this.resetWindow(0);

    // A descida anterior adiantou? Se não, o gargalo é outro: volta e sossega um tempo.
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      if (fps < pending.fps * MIN_GAIN && fps < TARGET_FPS) {
        this.settle = SETTLE_SECONDS;
        this.ceiling = pending.ceiling;
        return this.apply(pending.tier, pending.scale);
      }
    }

    const slow = fps < TARGET_FPS;
    if (slow) {
      this.fastWindows = 0;
      this.slowWindows++;
      const verySlow = fps < TARGET_FPS * 0.7;
      if (this.settle > 0 || (!verySlow && this.slowWindows < 2)) return null;
      return this.stepDown(fps);
    }
    this.slowWindows = 0;

    // Subir só com o relógio da GPU dizendo que sobra muito (e o processador também).
    const budgetMs = refreshInterval * 1000;
    const roomy = gpuMs !== null && gpuMs < budgetMs * CLIMB_GPU_SHARE && cpuMs < budgetMs * CLIMB_CPU_SHARE && fps > 0.95 / refreshInterval;
    if (!roomy || QUALITY_TIERS.indexOf(this.tier) >= QUALITY_TIERS.indexOf(this.ceiling) || this.resolutionScale < 1) {
      this.fastWindows = 0;
      return null;
    }
    if (++this.fastWindows < CLIMB_WINDOWS) return null;
    this.fastWindows = 0;
    return this.apply(stepTier(this.tier, 1), 1);
  }

  private stepDown(fps: number): AdaptiveChange | null {
    this.slowWindows = 0;
    const from = { tier: this.tier, scale: this.resolutionScale, fps, ceiling: this.ceiling };
    if (this.tier !== 'minimum') {
      // Caiu daqui: nesta sessão não sobe mais até este degrau.
      this.ceiling = stepTier(this.tier, -1);
      this.pending = from;
      return this.apply(stepTier(this.tier, -1), 1);
    }
    if (this.resolutionScale <= RESOLUTION_FLOOR) return null;
    this.pending = from;
    return this.apply('minimum', Math.max(RESOLUTION_FLOOR, this.resolutionScale * RESOLUTION_STEP));
  }

  private apply(tier: QualityTier, scale: number): AdaptiveChange {
    this.tier = tier;
    this.resolutionScale = scale;
    this.resetWindow(WARMUP_SECONDS);
    return this.current;
  }

  private resetWindow(warmup: number): void {
    this.frames.length = 0;
    this.cpu.length = 0;
    this.gpu.length = 0;
    this.windowTime = 0;
    this.warmup = warmup;
  }
}

/** Percentil `p` (0..1) de uma lista (ordena uma cópia). */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
