/**
 * DSP compartilhado do áudio: ruídos pré-gerados (a matéria-prima de quase todo
 * efeito), a resposta de impulso do reverb, uma onda "serrote macio" para os
 * pads e conversões musicais.
 *
 * Tudo nasce por código quando o contexto de áudio é criado — o jogo não tem
 * nenhum arquivo de som.
 */

/** Ruídos em loop, prontos para tocar a partir de qualquer ponto. */
export interface NoiseBank {
  /** Branco: chiado, estalos secos, respingos. */
  readonly white: AudioBuffer;
  /** Rosa (−3 dB/oitava): chuva, vento, terra. Soa mais "natural" que o branco. */
  readonly pink: AudioBuffer;
  /** Marrom (−6 dB/oitava): ronco, trovão, bola pesada rolando. */
  readonly brown: AudioBuffer;
  /** Estalos esparsos (grão de terra, gota, cascalho). Tocar mais rápido = mais denso e mais agudo. */
  readonly crackle: AudioBuffer;
}

export type NoiseKind = keyof NoiseBank;

/** Nível RMS comum dos ruídos contínuos: as receitas não precisam compensar um contra o outro. */
const NOISE_RMS = 0.25;

export function createNoiseBank(ctx: BaseAudioContext): NoiseBank {
  const rate = ctx.sampleRate;
  return {
    white: makeBuffer(ctx, 2 * rate, fillWhite, 'rms'),
    pink: makeBuffer(ctx, 3 * rate, fillPink, 'rms'),
    brown: makeBuffer(ctx, 3 * rate, fillBrown, 'rms'),
    crackle: makeBuffer(ctx, 2 * rate, (data) => fillCrackle(data, rate), 'peak'),
  };
}

function makeBuffer(ctx: BaseAudioContext, length: number, fill: (data: Float32Array) => void, normalizeBy: 'rms' | 'peak'): AudioBuffer {
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  fill(data);
  if (normalizeBy === 'rms') {
    seamless(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const k = NOISE_RMS / Math.sqrt(sum / data.length || 1);
    for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i] * k));
  } else {
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const k = 0.95 / (peak || 1);
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  return buffer;
}

/**
 * Tira o degrau do ponto de loop (e o DC): ruído grave "anda" e terminaria longe
 * de onde começou — sem isso, o loop dá um clique a cada volta.
 */
function seamless(data: Float32Array): void {
  const n = data.length;
  const drift = data[n - 1] - data[0];
  let mean = 0;
  for (let i = 0; i < n; i++) {
    data[i] -= (drift * i) / (n - 1);
    mean += data[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) data[i] -= mean;
}

function fillWhite(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

/** Ruído rosa pelo filtro de Paul Kellet (preciso até ~9 Hz, barato). */
function fillPink(data: Float32Array): void {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
}

/** Ruído marrom: integrador com vazamento (não deriva para fora da faixa). */
function fillBrown(data: Float32Array): void {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last;
  }
}

/**
 * Estalos: grãos curtíssimos de ruído em instantes aleatórios (processo de
 * Poisson). A maioria é fraquinha e poucos são fortes — igual terra esfarelando.
 */
function fillCrackle(data: Float32Array, rate: number): void {
  const density = 260; // grãos por segundo na velocidade 1
  let i = 0;
  while (i < data.length) {
    i += Math.max(1, Math.floor((-Math.log(1 - Math.random()) * rate) / density));
    const amp = Math.pow(Math.random(), 2.4) * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(rate * (0.0005 + Math.random() * 0.0025));
    for (let k = 0; k < len && i + k < data.length; k++) {
      data[i + k] += amp * Math.exp(-k / (len * 0.3)) * (Math.random() * 2 - 1);
    }
  }
}

/**
 * Resposta de impulso do reverb: um "jardim de maquete" — reflexões iniciais
 * esparsas e uma cauda que escurece com o tempo (folhas e ar comem os agudos
 * primeiro). Estéreo com canais independentes, para abrir a imagem.
 */
export function createReverbImpulse(ctx: BaseAudioContext, seconds: number, curve: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lowpassed = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.pow(1 - t, curve) * Math.min(1, i / (rate * 0.006));
      // Coeficiente do passa-baixa de um polo: claro no começo, abafado no fim.
      const k = 0.85 - 0.72 * Math.sqrt(t);
      lowpassed += (Math.random() * 2 - 1 - lowpassed) * k;
      data[i] = lowpassed * envelope;
    }
    for (let r = 0; r < 6; r++) {
      const at = Math.floor(rate * (0.007 + Math.random() * 0.055));
      data[at] += (Math.random() < 0.5 ? -1 : 1) * (0.45 - r * 0.05);
    }
  }
  return buffer;
}

const softSawCache = new WeakMap<BaseAudioContext, PeriodicWave>();

/**
 * Onda entre o triângulo e o serrote (harmônicos caindo com 1/n^1.6): cheia o
 * bastante para um pad, sem o zumbido "sintetizador barato" do serrote puro.
 */
export function softSaw(ctx: BaseAudioContext): PeriodicWave {
  let wave = softSawCache.get(ctx);
  if (!wave) {
    const harmonics = 32;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let k = 1; k < harmonics; k++) imag[k] = 1 / Math.pow(k, 1.6);
    wave = ctx.createPeriodicWave(real, imag);
    softSawCache.set(ctx, wave);
  }
  return wave;
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** `value` com variação aleatória de ±`amount` (fração): dois sons iguais nunca soam idênticos. */
export const vary = (value: number, amount: number): number => value * (1 + (Math.random() * 2 - 1) * amount);

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** Decibéis → ganho linear. */
export const db = (decibels: number): number => Math.pow(10, decibels / 20);
