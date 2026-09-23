import { clamp, createRng, damp, lerp, smoothstep } from '../utils/math';
import { noise3 } from '../utils/noise';

/**
 * Tempo do jardim. Tudo aqui é número suave (0..1) que os outros sistemas
 * leem: céu e luz (`overcast`), riscos e som de chuva (`rain`), brilho molhado
 * das superfícies (`wetness`) e o nível das poças (`puddleFill`).
 *
 * Cada chuva é um evento com personalidade — uma pancada curta e fraca ou uma
 * tempestade longa com raios — e nada muda de supetão:
 *
 *   sol        nuvenzinhas passando de vez em quando (a luz nunca fica parada)
 *   nublando   o céu fecha devagar; na tempestade, trovoada ao longe
 *   garoa      pingos esparsos que vão engrossando
 *   chuva      "respira": trechos mais fracos e rajadas mais fortes
 *   amainando  afina aos poucos até os últimos pingos
 *   abrindo    as nuvens vão embora
 *
 * A água demora a encher e demora mais ainda a secar — as poças continuam
 * sendo perigo por um bom tempo depois da chuva.
 */

type Phase = 'clear' | 'gathering' | 'drizzle' | 'raining' | 'easing' | 'clearing';

export interface WeatherState {
  /** 0 = céu limpo, 1 = tempestade fechada. */
  readonly overcast: number;
  /** 0..1: intensidade da chuva agora. */
  readonly rain: number;
  /** 0..1: quão molhado está tudo (sobe na chuva, seca devagar). */
  readonly wetness: number;
  /** 0..1: quão cheias estão as poças. */
  readonly puddleFill: number;
  /** 0..1: relâmpago (pisca e some em ~0,3 s). */
  readonly flash: number;
}

/** Como vai ser a próxima chuva (sorteado quando o céu começa a fechar). */
interface RainEvent {
  /** Intensidade no auge (a chuva "respira" em volta disso). */
  peak: number;
  /** Quanto o céu fecha (pancada deixa uma luz passando). */
  cover: number;
  /** Segundos de chuva cheia (sem contar garoa e amainando). */
  length: number;
  /** Tempestade tem raio e trovão; pancada não. */
  stormy: boolean;
}

const GATHER_SECONDS = 25;
const CLEARING_SECONDS = 28;
/** Na garoa e no amainando, a chuva fica em volta desta fração do auge. */
const SHOULDER = 0.5;

export class Weather implements WeatherState {
  overcast = 0;
  rain = 0;
  wetness = 0;
  puddleFill = 0;
  flash = 0;

  /** Trovão pendente: segundos até o som chegar (luz antes, som depois). */
  onThunder: ((distance: number) => void) | null = null;

  private phase: Phase = 'clear';
  private timer: number;
  private duration: number;
  private time = 0;
  private lightningTimer = 12;
  private rumbleTimer = 8;
  private readonly rng = createRng(2718);
  private event: RainEvent;

  constructor() {
    // A primeira chuva vem cedo (≈1,5 min): quem joga uma vez já vê o jardim molhar.
    this.timer = 0;
    this.duration = this.rng.range(80, 100);
    // E ela é uma tempestade de verdade (a primeira impressão conta).
    this.event = this.rollEvent(true);
  }

  /** Nome da fase (para depuração e testes). */
  get currentPhase(): Phase {
    return this.phase;
  }

  update(dt: number): void {
    this.time += dt;
    this.timer += dt;
    const t = clamp(this.timer / this.duration, 0, 1);
    const e = this.event;

    let targetOvercast = 0;
    let targetRain = 0;
    switch (this.phase) {
      case 'clear':
        // Nuvenzinhas passando: sombra leve, só de vez em quando.
        targetOvercast = 0.25 * smoothstep(0.1, 0.45, noise3(this.time * 0.03, 11.3, 2.9));
        if (this.timer >= this.duration) {
          this.event = this.rollEvent(false);
          this.enter('gathering', GATHER_SECONDS);
        }
        break;
      case 'gathering':
        targetOvercast = lerp(0.2, e.cover, smoothstep(0, 1, t));
        if (this.timer >= this.duration) this.enter('drizzle', this.rng.range(20, 30));
        break;
      case 'drizzle':
        // Primeiro uns pingos soltos, depois engrossa até o "ombro" da chuva.
        targetOvercast = e.cover;
        targetRain = e.peak * SHOULDER * smoothstep(0, 1, t) + 0.06 * (1 - t) * smoothstep(0, 0.1, t);
        if (this.timer >= this.duration) this.enter('raining', e.length);
        break;
      case 'raining': {
        // Respira: rajadas e trechos mais fracos. Entra e sai pelo ombro (sem degrau).
        const breath = clamp(0.5 + 0.35 * noise3(this.time * 0.045, 3.1, 7.7) + 0.2 * noise3(this.time * 0.13, 5.2, 1.4), 0, 1);
        const swell = smoothstep(0, 0.2, t) * (1 - smoothstep(0.8, 1, t));
        targetOvercast = e.cover;
        targetRain = e.peak * lerp(SHOULDER, 0.6 + 0.4 * breath, swell);
        if (this.timer >= this.duration) this.enter('easing', this.rng.range(25, 35));
        break;
      }
      case 'easing':
        // Afina até sobrar só um pingo aqui e outro ali.
        targetOvercast = e.cover;
        targetRain = e.peak * SHOULDER * (1 - smoothstep(0, 0.85, t)) + 0.05 * (1 - smoothstep(0.7, 1, t));
        if (this.timer >= this.duration) this.enter('clearing', CLEARING_SECONDS);
        break;
      case 'clearing':
        targetOvercast = e.cover * (1 - smoothstep(0, 1, t));
        if (this.timer >= this.duration) this.enter('clear', this.rng.range(150, 230));
        break;
    }

    // Os alvos já andam em curva suave; o amortecimento só tira o "tremido".
    this.overcast = damp(this.overcast, targetOvercast, 0.8, dt);
    this.rain = damp(this.rain, targetRain, 0.6, dt);

    // Molhar é rápido; secar leva ~1,5 min. Encher a poça leva ~1 min de chuva forte; esvaziar, ~4 min.
    if (this.rain > 0.05) this.wetness = Math.min(1, this.wetness + this.rain * 0.09 * dt);
    else this.wetness = Math.max(0, this.wetness - 0.011 * dt);
    if (this.rain > 0.15) this.puddleFill = Math.min(1, this.puddleFill + this.rain * 0.018 * dt);
    else this.puddleFill = Math.max(0, this.puddleFill - 0.0042 * dt);

    this.updateLightning(dt);
  }

  /** Força a próxima fase (atalho de teste: F8 anda o clima uma fase para frente). */
  skipAhead(): void {
    this.timer = this.duration;
  }

  /**
   * Poder "Cheiro de chuva": chama a chuva AGORA, sem quebrar a regra de nada
   * mudar de supetão — o céu fecha rápido, mas ainda passa por nublando e garoa.
   * Se já estiver chovendo, a chuva dura mais; se estiver indo embora, volta.
   * `long` (★★) sorteia tempestade e chuva mais comprida.
   */
  callRain(long = false): void {
    const extra = long ? 30 : 15;
    switch (this.phase) {
      case 'clear':
        this.event = long ? this.rollEvent(true) : { peak: this.rng.range(0.55, 0.75), cover: this.rng.range(0.8, 0.9), length: this.rng.range(40, 60), stormy: false };
        this.enter('gathering', 9);
        break;
      case 'gathering':
        this.duration = Math.min(this.duration, this.timer + 6);
        this.event.length += extra;
        break;
      case 'drizzle':
        this.event.length += extra;
        break;
      case 'raining':
        this.duration += extra;
        break;
      case 'easing':
      case 'clearing':
        // Voltando: garoa curta e a chuva de novo, com o mesmo evento esticado.
        this.event.length = Math.max(30, this.event.length * 0.5) + extra;
        this.enter('drizzle', 8);
        break;
    }
  }

  /** Pancada (35%): curta, fraca, sem raio. Tempestade: longa, forte, com trovão. */
  private rollEvent(forceStorm: boolean): RainEvent {
    const stormy = forceStorm || this.rng.next() > 0.35;
    return stormy
      ? { peak: this.rng.range(0.8, 1), cover: 1, length: this.rng.range(60, 100), stormy }
      : { peak: this.rng.range(0.35, 0.55), cover: this.rng.range(0.7, 0.85), length: this.rng.range(30, 50), stormy };
  }

  private updateLightning(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (!this.event.stormy) return;
    // Tempestade chegando (ou indo embora): trovoada abafada lá longe, clarão fraco.
    if (this.phase === 'gathering' || this.phase === 'drizzle' || this.phase === 'easing') {
      if (this.phase === 'gathering' && this.timer < this.duration * 0.4) return;
      this.rumbleTimer -= dt;
      if (this.rumbleTimer > 0) return;
      this.rumbleTimer = this.rng.range(9, 18);
      this.flash = Math.max(this.flash, 0.25);
      this.onThunder?.(this.rng.range(0.9, 1));
      return;
    }
    if (this.phase !== 'raining' || this.rain < 0.7) return;
    this.lightningTimer -= dt;
    if (this.lightningTimer > 0) return;
    this.lightningTimer = this.rng.range(18, 40);
    this.flash = 1;
    this.onThunder?.(this.rng.range(0.4, 1));
  }

  private enter(phase: Phase, duration: number): void {
    this.phase = phase;
    this.timer = 0;
    this.duration = duration;
  }
}
