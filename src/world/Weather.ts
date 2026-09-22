import { clamp, createRng, damp } from '../utils/math';
import { noise3 } from '../utils/noise';

/**
 * Tempo do jardim: sol → nublando → chuva → abrindo → sol. Tudo aqui é número
 * suave (0..1) que os outros sistemas leem: céu e luz (`overcast`), riscos e som
 * de chuva (`rain`), brilho molhado das superfícies (`wetness`) e o nível das
 * poças (`puddleFill`). A água demora a encher e demora mais ainda a secar —
 * as poças continuam sendo perigo por um bom tempo depois da chuva.
 */

type Phase = 'clear' | 'gathering' | 'raining' | 'clearing';

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

const GATHER_SECONDS = 20;
const CLEARING_SECONDS = 26;

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
  private readonly rng = createRng(2718);

  constructor() {
    // A primeira chuva vem cedo (≈1,5 min): quem joga uma vez já vê o jardim molhar.
    this.timer = 0;
    this.duration = this.rng.range(80, 100);
  }

  /** Nome da fase (para depuração e testes). */
  get currentPhase(): Phase {
    return this.phase;
  }

  update(dt: number): void {
    this.time += dt;
    this.timer += dt;
    const t = clamp(this.timer / this.duration, 0, 1);

    let targetOvercast = 0;
    let targetRain = 0;
    switch (this.phase) {
      case 'clear':
        targetOvercast = 0;
        if (this.timer >= this.duration) this.enter('gathering', GATHER_SECONDS);
        break;
      case 'gathering':
        targetOvercast = t;
        targetRain = t > 0.7 ? (t - 0.7) * 1.2 : 0;
        if (this.timer >= this.duration) this.enter('raining', this.rng.range(70, 105));
        break;
      case 'raining': {
        // Chuva que respira: rajadas mais fortes e trechos de garoa.
        const gust = noise3(this.time * 0.05, 3.1, 7.7) * 0.5 + 0.5;
        targetOvercast = 1;
        targetRain = 0.5 + gust * 0.5;
        if (this.timer >= this.duration) this.enter('clearing', CLEARING_SECONDS);
        break;
      }
      case 'clearing':
        targetOvercast = 1 - t;
        targetRain = Math.max(0, 0.45 - t * 1.2);
        if (this.timer >= this.duration) this.enter('clear', this.rng.range(150, 230));
        break;
    }

    this.overcast = damp(this.overcast, targetOvercast, 1.2, dt);
    this.rain = damp(this.rain, targetRain, 0.9, dt);

    // Molhar é rápido; secar leva ~1,5 min. Encher a poça leva ~1 min de chuva forte; esvaziar, ~4 min.
    if (this.rain > 0.05) this.wetness = Math.min(1, this.wetness + this.rain * 0.09 * dt);
    else this.wetness = Math.max(0, this.wetness - 0.011 * dt);
    if (this.rain > 0.15) this.puddleFill = Math.min(1, this.puddleFill + this.rain * 0.018 * dt);
    else this.puddleFill = Math.max(0, this.puddleFill - 0.0042 * dt);

    this.updateLightning(dt);
  }

  /** Força a próxima fase (atalho de teste: pula direto para a chuva). */
  skipAhead(): void {
    this.timer = this.duration;
  }

  private updateLightning(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 3.2);
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
