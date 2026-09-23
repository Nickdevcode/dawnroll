import { clamp } from '../../utils/math';
import { rand, vary } from '../dsp';
import { bubble, burst, chain, filter, glide, noise, osc, perc, swell, tone, tremolo, type Recipe, type Voice } from './kit';

/**
 * Natureza: trovão, pássaros, grilos, coruja, sapo, gafanhoto, água pingando,
 * beija-flor, teia rasgando e o coro de cigarras.
 * Os bichos são sintetizados pelo jeito que o som deles nasce (bolha que sobe
 * de tom, seno com glissando para o canto, pulsos filtrados para o coaxar),
 * não por imitação de gravação.
 */

/**
 * Trovão: estalo (só quando cai perto) e um ronco longo que "rola" — vários
 * estouros com volumes aleatórios, com tempos diferentes em cada ouvido.
 * `distance` 0 (em cima) .. 1 (longe).
 */
export const thunder = (distance: number): Recipe => (v) => {
  const d = clamp(distance, 0, 1);
  const near = 1 - d;
  const length = 5 + d * 2;
  if (near > 0.35) {
    burst(v, { type: 'highpass', freq: 1400, gain: 0.7 * near, attack: 0.002, decay: 0.3 });
    burst(v, { noise: 'crackle', freq: 3000, q: 0.6, gain: 0.8 * near, attack: 0.01, decay: 0.5, rate: 1.8 });
  }
  const merger = new ChannelMergerNode(v.ctx, { numberOfInputs: 2 });
  merger.connect(v.out);
  for (let ch = 0; ch < 2; ch++) {
    const lp = filter(v, 'lowpass', 1100 - d * 600, 0.6);
    lp.frequency.setValueAtTime(1100 - d * 600, v.t);
    lp.frequency.exponentialRampToValueAtTime(90, v.t + length * 0.8);
    const env = new GainNode(v.ctx, { gain: 0 });
    const g = env.gain;
    const end = v.t + length;
    let t = v.t + d * 0.25;
    g.setValueAtTime(0, v.t);
    g.linearRampToValueAtTime(1.5 * (1 - d * 0.5), t + 0.05 + d * 0.2);
    const bumps = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < bumps; i++) {
      t = Math.min(t + rand(0.25, 0.7), end - 0.9);
      g.linearRampToValueAtTime(Math.max(0.05, (1.3 - i / bumps) * rand(0.4, 1.1) * (1 - d * 0.4)), t);
    }
    g.exponentialRampToValueAtTime(1e-4, end);
    chain(noise(v, 'brown', 0, length), lp, env);
    env.connect(merger, 0, ch);
  }
  return length;
};

export type BirdSong = 'warbler' | 'whistle' | 'trill' | 'dove';

/** Uma nota de passarinho: seno com glissando + 2º harmônico baixinho (bico, não apito). */
function chirp(v: Voice, from: number, to: number, duration: number, gain: number, delay: number): void {
  const attack = duration * 0.25;
  for (const [ratio, level] of [[1, 1], [2, 0.12]] as const) {
    const o = osc(v, 'sine', from * ratio, delay, duration);
    glide(o.frequency, v.t + delay, from * ratio, to * ratio, duration);
    chain(o, perc(v, gain * level, attack, duration - attack, delay), v.out);
  }
}

/** Canto de pássaro (de dia). Cada espécie tem um desenho de frase. */
export const birdSong = (song: BirdSong): Recipe => (v) => {
  switch (song) {
    case 'warbler': {
      // Gorjeio: 5 a 9 notas curtas que pulam de altura.
      const base = rand(2600, 3800);
      let t = 0;
      const notes = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < notes; i++) {
        const f0 = base * rand(0.8, 1.3);
        const duration = rand(0.05, 0.12);
        chirp(v, f0, f0 * rand(0.7, 1.35), duration, 0.1 * rand(0.6, 1), t);
        t += duration + rand(0.02, 0.06);
      }
      return t + 0.05;
    }
    case 'whistle': {
      // "Fii-bii": dois assobios puros, o segundo mais baixo.
      const k = vary(1, 0.04);
      chirp(v, 3950 * k, 3850 * k, 0.32, 0.09, 0);
      chirp(v, 3350 * k, 3270 * k, 0.28, 0.08, 0.4);
      return 0.72;
    }
    case 'trill': {
      // Trinado: pios rapidinhos descendo de altura, cresce e some.
      const count = 10 + Math.floor(Math.random() * 7);
      const period = rand(0.055, 0.07);
      const top = rand(4800, 5600);
      for (let i = 0; i < count; i++) {
        const drift = 1 - (i / count) * 0.1;
        chirp(v, top * drift, top * 0.77 * drift, 0.03, 0.07 * Math.sin(((i + 1) / (count + 1)) * Math.PI), i * period);
      }
      return count * period + 0.05;
    }
    case 'dove': {
      // Rolinha de madrugada: "ruu-RUU-ru-ru" grave e rouco.
      const out = new GainNode(v.ctx, { gain: 1 });
      chain(out, filter(v, 'lowpass', 1300, 0.5), tremolo(v, 17, 0.12, 0, 2), v.out);
      const notes: Array<[number, number, number, number]> = [
        [0, 0.22, 520, 560],
        [0.27, 0.5, 600, 540],
        [0.9, 0.3, 520, 500],
        [1.26, 0.32, 510, 488],
      ];
      for (const [at, duration, from, to] of notes) {
        const o = osc(v, 'sine', from, at, duration);
        glide(o.frequency, v.t + at, from, to, duration);
        chain(o, swell(v, 0.11, 0.06, duration * 0.6, duration * 0.4, at), out);
      }
      return 1.7;
    }
  }
};

/** Coruja ao longe (madrugada do menu): "huu … hu-hu … huuu". */
export const owl: Recipe = (v) => {
  const out = new GainNode(v.ctx, { gain: 1 });
  chain(out, filter(v, 'lowpass', 900, 0.5), v.out);
  const k = vary(1, 0.05);
  const notes: Array<[number, number, number, number]> = [
    [0, 0.36, 395, 372],
    [0.85, 0.2, 402, 390],
    [1.13, 0.2, 400, 386],
    [1.48, 0.58, 396, 360],
  ];
  for (const [at, duration, from, to] of notes) {
    const o = osc(v, 'sine', from * k, at, duration);
    glide(o.frequency, v.t + at, from * k, to * k, duration);
    chain(o, swell(v, 0.12, 0.05, duration * 0.55, duration * 0.45, at), out);
    const h = osc(v, 'triangle', from * k * 2, at, duration);
    chain(h, swell(v, 0.012, 0.05, duration * 0.5, duration * 0.4, at), out);
  }
  return 2.1;
};

/** Cri-cri: pulsos de um seno agudo (o grilo esfrega a asa ~30 vezes por segundo). */
export const cricket = (freq: number, pulses: number): Recipe => (v) => {
  const period = 0.042;
  const o = osc(v, 'sine', freq, 0, pulses * period + 0.03);
  const env = new GainNode(v.ctx, { gain: 0 });
  for (let i = 0; i < pulses; i++) {
    const t = v.t + i * period;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.055, t + 0.004);
    env.gain.linearRampToValueAtTime(0.04, t + 0.016);
    env.gain.linearRampToValueAtTime(0, t + 0.024);
  }
  // Aspereza das "batidas" dos dentinhos da asa.
  chain(o, tremolo(v, freq / 24, 0.18, 0, pulses * period + 0.03, 'square'), env, v.out);
  return pulses * period + 0.05;
};

/**
 * Coaxar: pulsos rápidos (serrote grave) passando por duas ressonâncias de
 * garganta. Duas coaxadas "rib-bit", no ritmo do papo inflando na animação.
 */
export const frogCroak = (scale: number): Recipe => (v) => {
  const low = 1 / clamp(scale, 0.8, 1.6);
  const syllable = (at: number, duration: number, formant: number, pulse: number) => {
    const src = osc(v, 'sawtooth', pulse * low, at, duration);
    glide(src.frequency, v.t + at, pulse * low * 0.9, pulse * low * 1.15, duration);
    const env = swell(v, 1.4, 0.012, duration * 0.6, duration * 0.4, at);
    src.connect(filter(v, 'bandpass', formant * low, 5)).connect(env);
    src.connect(filter(v, 'bandpass', formant * 2.3 * low, 6)).connect(new GainNode(v.ctx, { gain: 0.6 })).connect(env);
    env.connect(v.out);
  };
  for (const at of [0, 0.93]) {
    syllable(at, 0.11, 620, 42);
    syllable(at + 0.15, 0.08, 780, 48);
  }
  return 1.3;
};

/** Gafanhoto pulando: estalo e o "frrr" das asas. */
export const grasshopperHop: Recipe = (v) => {
  burst(v, { type: 'highpass', freq: 5000, gain: 0.22, decay: 0.006 });
  const wings = noise(v, 'white', 0.01, 0.18);
  chain(wings, filter(v, 'bandpass', 5600, 2.5), tremolo(v, 48, 0.5, 0.01, 0.18, 'square'), perc(v, 1.1, 0.01, 0.16, 0.01), v.out);
  return 0.22;
};

/** Gafanhoto "cantando" (estridulação): trem de raspadinhas agudas. */
export const stridulate: Recipe = (v) => {
  const pulses = 8 + Math.floor(Math.random() * 6);
  const period = 0.052;
  const src = noise(v, 'white', 0, pulses * period + 0.03);
  const env = new GainNode(v.ctx, { gain: 0 });
  for (let i = 0; i < pulses; i++) {
    const t = v.t + i * period;
    const level = 0.5 * (0.6 + 0.4 * Math.sin(((i + 1) / (pulses + 1)) * Math.PI));
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.003);
    env.gain.linearRampToValueAtTime(0, t + 0.014);
  }
  chain(src, filter(v, 'bandpass', rand(6000, 7200), 3), env, v.out);
  return pulses * period + 0.05;
};

/** Gota caindo de uma folha depois da chuva: "plic" (bolha aguda + tiquinho). */
export const drip: Recipe = (v) => {
  bubble(v, rand(1400, 2600), rand(0.035, 0.06));
  return tone(v, { freq: rand(3000, 4500), gain: 0.015, decay: 0.012 });
};

/** Gota de chuva batendo numa folha perto. */
export const rainTick: Recipe = (v) => {
  burst(v, { freq: rand(2500, 5000), q: 2, gain: rand(0.15, 0.3), decay: 0.015 });
  return tone(v, { freq: rand(1800, 3200), to: rand(1200, 1800), gain: rand(0.01, 0.025), decay: 0.02 });
};

/** Gota de chuva na poça: "plop". */
export const puddlePlop: Recipe = (v) => {
  bubble(v, rand(600, 1400), rand(0.03, 0.06));
  return burst(v, { freq: 3000, q: 1, gain: 0.15, decay: 0.02 });
};

// ---------------------------------------------------------------------------
// Fauna nova: beija-flor, teia, cigarras

/** Piadinha do beija-flor: dois ou três "tsip" agudíssimos, rápidos e descendo. */
export const hummingbirdChirp: Recipe = (v) => {
  const count = 2 + Math.floor(Math.random() * 2);
  const base = rand(6200, 7400);
  let t = 0;
  for (let i = 0; i < count; i++) {
    const duration = rand(0.035, 0.06);
    chirp(v, base * rand(0.95, 1.08), base * 0.72, duration, 0.07, t);
    t += duration + rand(0.05, 0.09);
  }
  return t + 0.05;
};

/**
 * Teia rasgando: estalinhos de seda arrebentando (grãos agudos bem juntos) e
 * um "fiu" macio de fio passando — curto e delicado, nada de papel rasgando.
 */
export const webTear = (size: number): Recipe => (v) => {
  const k = clamp(size, 0.5, 1.6);
  burst(v, { noise: 'crackle', type: 'highpass', freq: 6500, q: 0.7, gain: 0.5, attack: 0.002, decay: 0.09 + k * 0.03, rate: 2.2 });
  burst(v, { type: 'bandpass', freq: 5200, to: 2600, q: 2.5, gain: 0.12, attack: 0.01, decay: 0.16 + k * 0.05, delay: 0.015 });
  return tone(v, { freq: rand(3800, 4600), to: rand(2400, 3000), gain: 0.012, decay: 0.05, delay: 0.01 });
};

/** Um som contínuo pronto para ligar: `output` é a saída; os parâmetros mexem no timbre ao vivo. */
export interface LoopVoice {
  readonly output: GainNode;
  /** Frequências que "respiram" (o motor mexe nelas a cada quadro). */
  readonly pitch: AudioParam[];
}

/**
 * Zumbido do beija-flor pairando: as asas batem ~50 vezes por segundo, então o
 * som é um "hum" grave com harmônicos (serrote filtrado) mais o sopro do ar
 * pulsando no mesmo ritmo (ruído rosa modulado). Serve em qualquer contexto
 * (inclusive offline, para medir).
 */
export function hummingbirdHum(ctx: BaseAudioContext, pink: AudioBuffer): LoopVoice {
  const output = new GainNode(ctx, { gain: 1 });
  const beat = 48;
  const wing = new OscillatorNode(ctx, { type: 'sawtooth', frequency: beat });
  wing.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 460, Q: 0.9 })).connect(new GainNode(ctx, { gain: 0.55 })).connect(output);
  // Sopro: ruído passando por uma banda média, com o volume batendo junto com a asa.
  const air = new AudioBufferSourceNode(ctx, { buffer: pink, loop: true });
  const pulse = new GainNode(ctx, { gain: 0.35 });
  const lfo = new OscillatorNode(ctx, { frequency: beat });
  lfo.connect(new GainNode(ctx, { gain: 0.65 })).connect(pulse.gain);
  air.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 320, Q: 0.7 })).connect(pulse).connect(new GainNode(ctx, { gain: 1.3 })).connect(output);
  wing.start();
  lfo.start();
  air.start(0, Math.random() * pink.duration);
  return { output, pitch: [wing.frequency, lfo.frequency] };
}

/**
 * Uma cigarra: o chiado agudo e "rasgado" que o tímbalo faz (ruído numa banda
 * estreita + um apito na mesma altura), picotado ~110 vezes por segundo — é o
 * picotado que dá a aspereza de cigarra. A altura sobe um pouco quando ela
 * engrossa o canto (o motor mexe em `pitch`).
 */
export function cicadaVoice(ctx: BaseAudioContext, white: AudioBuffer, frequency: number): LoopVoice {
  const output = new GainNode(ctx, { gain: 1 });
  const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency, Q: 5 });
  const hiss = new AudioBufferSourceNode(ctx, { buffer: white, loop: true });
  hiss.connect(band);
  const whine = new OscillatorNode(ctx, { type: 'sine', frequency });
  const whineLevel = new GainNode(ctx, { gain: 0.05 });
  whine.connect(whineLevel);
  // Picotado do tímbalo.
  const chop = new GainNode(ctx, { gain: 0.45 });
  const pulses = new OscillatorNode(ctx, { type: 'square', frequency: rand(100, 124) });
  pulses.connect(new GainNode(ctx, { gain: 0.45 })).connect(chop.gain);
  band.connect(chop);
  whineLevel.connect(chop);
  // Longe, nas árvores do fundo: sem o brilho de cima.
  chop.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7500, Q: 0.5 })).connect(output);
  hiss.start(0, Math.random() * white.duration);
  whine.start();
  pulses.start();
  return { output, pitch: [band.frequency, whine.frequency] };
}
