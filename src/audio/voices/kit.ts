import type { NoiseBank, NoiseKind } from '../dsp';

/**
 * Peças de montar das receitas de som. Uma receita recebe uma `Voice` (onde e
 * quando tocar), monta os nós dela ligados em `out` e devolve quanto tempo o
 * som dura — o motor usa isso para desligar e liberar os nós depois.
 *
 * As receitas funcionam em qualquer `BaseAudioContext` (inclusive offline, que
 * é como os níveis são medidos em desenvolvimento).
 */
export interface Voice {
  readonly ctx: BaseAudioContext;
  /** Entrada da cadeia da voz (panner, reverb e barramento já estão depois dela). */
  readonly out: AudioNode;
  /** Instante de início, no relógio do contexto. */
  readonly t: number;
  readonly noise: NoiseBank;
}

/** Receita de som: toca e devolve a duração total (segundos, a partir de `t`). */
export type Recipe = (v: Voice) => number;

/**
 * A mesma voz com um ganho extra no fim da cadeia: acerto de mixagem de uma
 * receita inteira (os níveis foram medidos renderizando offline).
 */
export function louder(v: Voice, gain: number): Voice {
  const node = new GainNode(v.ctx, { gain });
  node.connect(v.out);
  return { ...v, out: node };
}

/** Menor ganho usado em rampas exponenciais (−80 dB: inaudível, mas > 0). */
const FLOOR = 1e-4;

/**
 * Ganho com envelope percussivo: sobe (linear) até `peak` em `attack` e cai
 * (exponencial, como corpo vibrando) até sumir em `decay`.
 */
export function perc(v: Voice, peak: number, attack: number, decay: number, delay = 0): GainNode {
  const gain = new GainNode(v.ctx, { gain: 0 });
  const t = v.t + delay;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(Math.max(peak, FLOOR), t + attack);
  gain.gain.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
  gain.gain.setValueAtTime(0, t + attack + decay + 0.001);
  return gain;
}

/** Envelope com sustentação: ataque, segura em `peak` e solta em `release` a partir de `hold`. */
export function swell(v: Voice, peak: number, attack: number, hold: number, release: number, delay = 0): GainNode {
  const gain = new GainNode(v.ctx, { gain: 0 });
  const t = v.t + delay;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(Math.max(peak, FLOOR), t + attack);
  gain.gain.setValueAtTime(Math.max(peak, FLOOR), t + Math.max(attack, hold));
  gain.gain.exponentialRampToValueAtTime(FLOOR, t + Math.max(attack, hold) + release);
  gain.gain.setValueAtTime(0, t + Math.max(attack, hold) + release + 0.001);
  return gain;
}

export function osc(v: Voice, type: OscillatorType, frequency: number, delay: number, duration: number): OscillatorNode {
  const node = new OscillatorNode(v.ctx, { type, frequency });
  node.start(v.t + delay);
  node.stop(v.t + delay + duration + 0.02);
  return node;
}

/** Ruído do banco, começando de um ponto aleatório (dois sons seguidos nunca usam o mesmo trecho). */
export function noise(v: Voice, kind: NoiseKind, delay: number, duration: number, rate = 1): AudioBufferSourceNode {
  const buffer = v.noise[kind];
  const src = new AudioBufferSourceNode(v.ctx, { buffer, loop: true, playbackRate: rate });
  src.start(v.t + delay, Math.random() * buffer.duration * 0.9);
  src.stop(v.t + delay + duration + 0.02);
  return src;
}

export function filter(v: Voice, type: BiquadFilterType, frequency: number, Q = 0.7): BiquadFilterNode {
  return new BiquadFilterNode(v.ctx, { type, frequency, Q });
}

/** Liga os nós em série e devolve o último. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Rampa exponencial de frequência (é assim que o ouvido percebe "subir" e "descer"). */
export function glide(param: AudioParam, t: number, from: number, to: number, duration: number): void {
  param.setValueAtTime(Math.max(from, 1), t);
  param.exponentialRampToValueAtTime(Math.max(to, 1), t + Math.max(duration, 0.001));
}

export interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Frequência final (glissando exponencial ao longo de `glide`, ou do som todo). */
  to?: number;
  glide?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
  /** Passa-baixa opcional (arredonda ondas com muitos harmônicos). */
  lowpass?: number;
}

/** Oscilador com glissando e envelope percussivo. Devolve quando termina. */
export function tone(v: Voice, o: ToneOptions, dest: AudioNode = v.out): number {
  const delay = o.delay ?? 0;
  const attack = o.attack ?? 0.004;
  const duration = attack + o.decay;
  const node = osc(v, o.type ?? 'sine', o.freq, delay, duration);
  if (o.to !== undefined) glide(node.frequency, v.t + delay, o.freq, o.to, o.glide ?? duration);
  const env = perc(v, o.gain, attack, o.decay, delay);
  if (o.lowpass) chain(node, filter(v, 'lowpass', o.lowpass, 0.5), env, dest);
  else chain(node, env, dest);
  return delay + duration;
}

export interface BurstOptions {
  noise?: NoiseKind;
  type?: BiquadFilterType;
  freq: number;
  /** Frequência final do filtro (varredura ao longo do som). */
  to?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
  /** Velocidade de leitura do ruído (estalos: mais rápido = mais denso). */
  rate?: number;
}

/** Ruído filtrado com envelope percussivo (base de estalos, terra, água, vento). Devolve quando termina. */
export function burst(v: Voice, o: BurstOptions, dest: AudioNode = v.out): number {
  const delay = o.delay ?? 0;
  const attack = o.attack ?? 0.003;
  const duration = attack + o.decay;
  const src = noise(v, o.noise ?? 'white', delay, duration, o.rate);
  const f = filter(v, o.type ?? 'bandpass', o.freq, o.q ?? 1);
  if (o.to !== undefined) glide(f.frequency, v.t + delay, o.freq, o.to, duration);
  chain(src, f, perc(v, o.gain, attack, o.decay, delay), dest);
  return delay + duration;
}

/**
 * Bolha (ressonância de Minnaert): um seno que SOBE de tom enquanto some — é
 * isso que faz o "bloop". Bolha grande = grave e mais longa.
 */
export function bubble(v: Voice, freq: number, gain: number, delay = 0, dest: AudioNode = v.out): number {
  const decay = Math.min(0.1, Math.max(0.016, 28 / freq));
  return tone(v, { freq, to: freq * (1.45 + Math.random() * 0.5), gain, attack: 0.002, decay, delay }, dest);
}

/**
 * Nó de tremolo (modulação de amplitude) para pôr em série na cadeia: o "brrr"
 * de asa, o rolar do trovão. O ganho oscila entre 1 − 2·`depth` e 1 — num nó
 * próprio, para a modulação nunca "sobreviver" ao envelope da voz.
 */
export function tremolo(v: Voice, rate: number, depth: number, delay: number, duration: number, type: OscillatorType = 'sine'): GainNode {
  const node = new GainNode(v.ctx, { gain: 1 - depth });
  const lfo = osc(v, type, rate, delay, duration);
  lfo.connect(new GainNode(v.ctx, { gain: depth })).connect(node.gain);
  return node;
}
