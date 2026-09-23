import { clamp } from '../../utils/math';
import { midiToHz, rand, softSaw } from '../dsp';
import { burst, chain, filter, osc, swell, tone, type Recipe } from './kit';

/**
 * Instrumentos da trilha, todos de brinquedo/madeira (combinam com massinha):
 * marimba, kalimba, celesta de caixinha de música, glockenspiel, baixo macio,
 * pad quentinho e percussão leve. Síntese aditiva por parciais: cada
 * instrumento é a soma dos modos de vibração dele, cada um com seu decaimento.
 *
 * `velocity` 0..1 é a força da nota.
 */

/** Marimba: fundamental + parciais de barra afinada (≈4× e ≈10×) que somem rápido, e o toque da baqueta. */
export const marimba = (midi: number, velocity: number): Recipe => (v) => {
  const f = midiToHz(midi);
  const decay = clamp(1.3 - (midi - 60) * 0.025, 0.35, 1.4);
  const g = 0.2 * velocity;
  tone(v, { freq: f, gain: g, attack: 0.002, decay });
  tone(v, { freq: f * 3.93, gain: g * 0.2, attack: 0.001, decay: decay * 0.22 });
  if (f * 9.4 < 12000) tone(v, { freq: f * 9.4, gain: g * 0.05, attack: 0.001, decay: decay * 0.08 });
  burst(v, { freq: f * 2.2, q: 1.2, gain: 0.22 * velocity, decay: 0.008 });
  return decay + 0.05;
};

/** Kalimba: lâmina de metal — corpo redondo e um "plim" inarmônico bem curto no ataque. */
export const kalimba = (midi: number, velocity: number): Recipe => (v) => {
  const f = midiToHz(midi);
  const decay = clamp(1.6 - (midi - 60) * 0.03, 0.4, 1.6);
  tone(v, { freq: f, gain: 0.25 * velocity, attack: 0.002, decay });
  tone(v, { freq: f * 2, gain: 0.035 * velocity, decay: decay * 0.3 });
  tone(v, { freq: f * 5.4, gain: 0.06 * velocity, attack: 0.001, decay: 0.07 });
  burst(v, { type: 'highpass', freq: 3000, gain: 0.1 * velocity, decay: 0.005 });
  return decay + 0.05;
};

/** Celesta / caixinha de música: sininho doce com harmônicos que apagam antes do fundamental. */
export const celesta = (midi: number, velocity: number): Recipe => (v) => {
  const f = midiToHz(midi);
  const decay = clamp(2.2 - (midi - 60) * 0.04, 0.6, 2.2);
  tone(v, { freq: f, gain: 0.15 * velocity, attack: 0.003, decay });
  tone(v, { freq: f * 2, gain: 0.045 * velocity, attack: 0.002, decay: decay * 0.5 });
  tone(v, { freq: f * 3, gain: 0.016 * velocity, attack: 0.002, decay: decay * 0.3 });
  tone(v, { freq: f * 4.16, gain: 0.018 * velocity, attack: 0.001, decay: 0.12 });
  return decay + 0.05;
};

/** Glockenspiel: modos de barra livre (1 : 2,76 : 5,40 : 8,93) — brilho de sino. */
export const glock = (midi: number, velocity: number): Recipe => (v) => {
  const f = midiToHz(midi);
  const partials: ReadonlyArray<[number, number, number]> = [
    [1, 1, 1.4],
    [2.76, 0.35, 0.5],
    [5.4, 0.16, 0.25],
    [8.93, 0.08, 0.12],
  ];
  for (const [ratio, amp, decay] of partials) {
    if (f * ratio < 14000) tone(v, { freq: f * ratio, gain: 0.12 * velocity * amp, attack: 0.001, decay });
  }
  return 1.45;
};

/** Baixo macio: seno + um pouco de triângulo (para aparecer em alto-falante pequeno), passa-baixa. */
export const bass = (midi: number, velocity: number, length: number): Recipe => (v) => {
  const f = midiToHz(midi);
  const lp = filter(v, 'lowpass', 520, 0.6);
  osc(v, 'sine', f, 0, length + 0.3).connect(lp);
  osc(v, 'triangle', f, 0, length + 0.3).connect(new GainNode(v.ctx, { gain: 0.35 })).connect(lp);
  chain(lp, swell(v, 0.22 * velocity, 0.012, length, 0.28), v.out);
  return length + 0.3;
};

/**
 * Pad: cada nota com duas vozes levemente desafinadas (coro), passa-baixa com
 * o corte "respirando" devagar. `brightness` é o corte em Hz.
 */
export const pad = (midis: readonly number[], velocity: number, length: number, brightness: number): Recipe => (v) => {
  const wave = softSaw(v.ctx);
  const release = 1.6;
  const end = length + release + 0.05;
  const lp = filter(v, 'lowpass', brightness, 0.4);
  const breathe = osc(v, 'sine', rand(0.08, 0.16), 0, end);
  breathe.connect(new GainNode(v.ctx, { gain: brightness * 0.18 })).connect(lp.frequency);
  chain(lp, swell(v, 0.028 * velocity, Math.min(1.2, length * 0.35), length, release), v.out);
  for (const midi of midis) {
    const f = midiToHz(midi);
    for (const detune of [-7, 6]) {
      const o = new OscillatorNode(v.ctx, { frequency: f, detune: detune + rand(-2, 2) });
      o.setPeriodicWave(wave);
      o.start(v.t);
      o.stop(v.t + end);
      o.connect(lp);
    }
  }
  return end;
};

/** Chocalho: ruído agudo curtinho. */
export const shaker = (velocity: number): Recipe => (v) => burst(v, { type: 'highpass', freq: 6500, gain: 0.16 * velocity, attack: 0.006, decay: 0.045 });

/** Bumbo "lo-fi" bem macio. */
export const softKick = (velocity: number): Recipe => (v) => {
  tone(v, { freq: 118, to: 44, glide: 0.12, gain: 0.22 * velocity, attack: 0.002, decay: 0.26 });
  burst(v, { type: 'lowpass', freq: 2500, gain: 0.12 * velocity, decay: 0.006 });
  return 0.3;
};

/** Bloco de madeira (tipo "toc" de brinquedo). */
export const woodblock = (velocity: number, pitch = 1): Recipe => (v) => {
  tone(v, { freq: 830 * pitch, gain: 0.12 * velocity, decay: 0.055 });
  tone(v, { freq: 1693 * pitch, gain: 0.035 * velocity, decay: 0.03 });
  burst(v, { freq: 1700 * pitch, q: 2, gain: 0.28 * velocity, decay: 0.006 });
  return 0.08;
};

/** Tímpano (a "batida" do fim da fanfarra). */
export const timpani = (midi: number, velocity: number): Recipe => (v) => {
  const f = midiToHz(midi);
  tone(v, { freq: f * 1.05, to: f, glide: 0.05, gain: 0.42 * velocity, attack: 0.004, decay: 1.1 });
  tone(v, { freq: f * 1.5, gain: 0.1 * velocity, decay: 0.5 });
  burst(v, { noise: 'brown', type: 'lowpass', freq: 300, gain: 0.55 * velocity, decay: 0.25 });
  return 1.2;
};

/** Brilho de ar (sobe no amanhecer, desce no anoitecer). */
export const shimmer = (rising: boolean): Recipe => (v) =>
  burst(v, { freq: rising ? 1200 : 6000, to: rising ? 7000 : 1000, q: 0.8, gain: 0.3, attack: 0.5, decay: 0.9 });
