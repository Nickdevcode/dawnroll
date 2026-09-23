import * as THREE from 'three';
import { clamp, smoothstep } from '../utils/math';
import { noise3 } from '../utils/noise';
import type { CritterCall, CritterHum, CritterSounds } from '../fx/critters/types';
import type { AudioEngine, Emitter } from './AudioEngine';
import type { AudioFrame } from './frame';
import { rand } from './dsp';
import { ease } from './loops';
import { cicadaVoice, frogCroak, grasshopperHop, hummingbirdChirp, hummingbirdHum, stridulate, webTear, type LoopVoice } from './voices/nature';

/**
 * Som dos bichos: escuta o que as espécies avisam (coaxou, pulou, está
 * zumbindo, rasgou a teia) e toca no lugar certo do mundo. Zumbidos são
 * contínuos, então só o bicho mais perto de cada tipo soa — uma abelha nítida
 * vale mais que dez embolando. As moscas vêm dos montinhos de bosta (o fedor
 * que se vê). O coro de cigarras não é de nenhum bicho visível: vem das
 * árvores do fundo nos dias de sol.
 */

/** Até onde um zumbido é ouvido (unidades de mundo). */
const BEE_RANGE = 14;
const FLY_RANGE = 8;
const STRIDULATE_RANGE = 12;
const HUMMINGBIRD_RANGE = 22;
const SWARM_RANGE = 16;
const CALL_RANGE = 34;

interface HumSlot {
  distance: number;
  readonly position: THREE.Vector3;
}

interface Buzz {
  emitter: Emitter;
  gain: GainNode;
  voices: OscillatorNode[];
  base: number[];
}

interface PendingCall {
  kind: CritterCall;
  position: THREE.Vector3;
  size: number;
}

/** Uma cigarra do coro: canta em ciclos (cresce, segura, morre, silêncio). */
interface Cicada {
  voice: LoopVoice;
  gain: GainNode;
  base: number;
  state: 'rest' | 'swell' | 'sing' | 'fade';
  timer: number;
  /** 0..1 dentro do ciclo (para o volume e a altura). */
  level: number;
}

/** Volume do coro inteiro no sol pleno (medido contra a abelha: fica atrás, de fundo). */
const CICADA_GAIN = 0.022;

export class Wildlife implements CritterSounds {
  private readonly calls: PendingCall[] = [];
  private readonly hums: Record<CritterHum, HumSlot> = {
    bee: { distance: Infinity, position: new THREE.Vector3() },
    stridulate: { distance: Infinity, position: new THREE.Vector3() },
    hummingbird: { distance: Infinity, position: new THREE.Vector3() },
    swarm: { distance: Infinity, position: new THREE.Vector3() },
  };
  private readonly humSlots: readonly HumSlot[] = Object.values(this.hums);
  /** Referência de "perto" para escolher o bicho que soa (o besouro). */
  private readonly near = new THREE.Vector3();
  private bee: Buzz | null = null;
  private flies: Buzz | null = null;
  private swarm: Buzz | null = null;
  private hummer: { emitter: Emitter; gain: GainNode; voice: LoopVoice } | null = null;
  private readonly cicadas: Cicada[] = [];
  /** 0..1: dia de sol bom para cigarra (suavizado). */
  private sunny = 0;
  private time = 0;
  private stridulateTimer = 0;
  private readonly flyAt = new THREE.Vector3();

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    const ctx = this.engine.context!;
    const bank = this.engine.noise!;
    // Abelha: dois serrotes quase iguais (asas) com vibrato, passa-baixa.
    this.bee = this.buzz([226, 229.5], 6.3, 6, 1600, 1.2);
    // Moscas: mais agudas e nervosas, com um tremolo de "voando em círculo".
    this.flies = this.buzz([188, 207], 12, 10, 1300, 0.8, 0.7);
    // Revoada: zumbido mais grave e pesado (tanajura é grande), meio desencontrado.
    this.swarm = this.buzz([142, 147, 151], 4.2, 7, 900, 0.9, 2.3);
    // Beija-flor: o "hum" das asas batendo ~50 vezes por segundo.
    const emitter = this.engine.emitter('ambience', true);
    const gain = new GainNode(ctx, { gain: 0 });
    const voice = hummingbirdHum(ctx, bank.pink);
    voice.output.connect(gain).connect(emitter.input);
    this.hummer = { emitter, gain, voice };
    // Cigarras nas árvores do fundo: três vozes, cada uma num canto do estéreo.
    const chorus = this.engine.emitter('ambience', false);
    for (const [pan, freq] of [
      [-0.75, 4300],
      [0.7, 4750],
      [0.1, 3900],
    ] as const) {
      const g = new GainNode(ctx, { gain: 0 });
      const v = cicadaVoice(ctx, bank.white, freq);
      v.output.connect(g).connect(new StereoPannerNode(ctx, { pan })).connect(chorus.input);
      this.cicadas.push({ voice: v, gain: g, base: freq, state: 'rest', timer: rand(1, 12), level: 0 });
    }
  }

  // --- CritterSounds (chamado pelas espécies durante o quadro) --------------------

  call(kind: CritterCall, position: THREE.Vector3, size: number): void {
    if (this.calls.length >= 8 || position.distanceTo(this.near) > CALL_RANGE) return;
    this.calls.push({ kind, position: position.clone(), size });
  }

  hum(kind: CritterHum, position: THREE.Vector3): void {
    const slot = this.hums[kind];
    const d = position.distanceTo(this.near);
    if (d >= slot.distance) return;
    slot.distance = d;
    slot.position.copy(position);
  }

  // --- quadro ------------------------------------------------------------------

  update(dt: number, f: AudioFrame): void {
    this.time += dt;
    for (const c of this.calls) this.playCall(c);
    this.calls.length = 0;

    this.updateBuzz(this.bee, this.hums.bee, BEE_RANGE, 0.09, 0.8, 0.04);
    this.updateBuzz(this.swarm, this.hums.swarm, SWARM_RANGE, 0.05, 1.7, 0.08);
    this.updateHummingbird();
    this.updateStridulation(dt);
    this.updateFlies(f);
    this.updateCicadas(dt, f);

    // Os bichos do próximo quadro medem distância até o besouro de agora.
    this.near.copy(f.scene.player);
    for (const slot of this.humSlots) slot.distance = Infinity;
  }

  private playCall(c: PendingCall): void {
    switch (c.kind) {
      case 'croak':
        this.engine.play(frogCroak(c.size), { bus: 'ambience', at: c.position, reverb: 0.15 });
        break;
      case 'hop':
        this.engine.play(grasshopperHop, { bus: 'ambience', at: c.position, gain: 2 });
        break;
      case 'webTear':
        this.engine.play(webTear(c.size), { bus: 'fx', at: c.position, gain: 1.6, key: 'web-tear', minInterval: 0.2 });
        break;
      case 'hummingbirdChirp':
        this.engine.play(hummingbirdChirp, { bus: 'ambience', at: c.position, gain: 3, reverb: 0.2 });
        break;
    }
  }

  /**
   * Zumbido do bicho mais perto de um tipo (abelha, revoada): volume pela
   * distância e a altura mudando devagar (o bicho acelera e freia).
   */
  private updateBuzz(buzz: Buzz | null, slot: HumSlot, range: number, volume: number, driftRate: number, driftDepth: number): void {
    const ctx = this.engine.context;
    if (!buzz || !ctx) return;
    const level = slot.distance < range ? 1 - slot.distance / range : 0;
    ease(ctx, buzz.gain.gain, volume * Math.sqrt(level), 0.15);
    if (level <= 0) return;
    buzz.emitter.moveTo(slot.position);
    const drift = 1 + noise3(this.time * driftRate, buzz.base[0] * 0.01, 0) * driftDepth;
    buzz.voices.forEach((o, i) => ease(ctx, o.frequency, buzz.base[i] * drift, 0.1));
  }

  /** Beija-flor: o hum sobe e desce um tiquinho (ele acelera a batida ao arrancar). */
  private updateHummingbird(): void {
    const hummer = this.hummer;
    const ctx = this.engine.context;
    if (!hummer || !ctx) return;
    const slot = this.hums.hummingbird;
    const level = slot.distance < HUMMINGBIRD_RANGE ? 1 - slot.distance / HUMMINGBIRD_RANGE : 0;
    ease(ctx, hummer.gain.gain, 0.16 * Math.sqrt(level), 0.12);
    if (level <= 0) return;
    hummer.emitter.moveTo(slot.position);
    const beat = 48 * (1 + noise3(this.time * 1.3, 4.1, 0) * 0.06);
    for (const p of hummer.voice.pitch) ease(ctx, p, beat, 0.08);
  }

  private updateStridulation(dt: number): void {
    const slot = this.hums.stridulate;
    if (slot.distance > STRIDULATE_RANGE) return;
    this.stridulateTimer -= dt;
    if (this.stridulateTimer > 0) return;
    this.stridulateTimer = rand(0.7, 1.2);
    this.engine.play(stridulate, { bus: 'ambience', at: slot.position, gain: 3 * (1 - slot.distance / STRIDULATE_RANGE) });
  }

  /** Moscas no montinho de bosta mais perto (dentro do alcance). */
  private updateFlies(f: AudioFrame): void {
    const flies = this.flies;
    const ctx = this.engine.context;
    if (!flies || !ctx) return;
    const player = f.scene.player;
    let best = FLY_RANGE;
    let size = 0;
    for (const pile of f.scene.stink) {
      const d = Math.hypot(pile.x - player.x, pile.y - player.y, pile.z - player.z);
      if (d >= best) continue;
      best = d;
      size = pile.size;
      this.flyAt.set(pile.x, pile.y + 0.5, pile.z);
    }
    const level = size > 0 ? (1 - best / FLY_RANGE) * clamp(0.5 + size, 0.5, 1.2) : 0;
    ease(ctx, flies.gain.gain, 0.05 * Math.sqrt(level), 0.2);
    if (level <= 0) return;
    // Voando em volta do montinho: a posição gira devagar (o som passeia de um ouvido pro outro).
    const a = this.time * 2.1;
    flies.emitter.moveTo({ x: this.flyAt.x + Math.cos(a) * 0.6, y: this.flyAt.y + Math.sin(a * 1.7) * 0.2, z: this.flyAt.z + Math.sin(a) * 0.6 });
    flies.voices.forEach((o, i) => ease(ctx, o.frequency, flies.base[i] * (1 + noise3(this.time * 3 + i * 7, 0.5, 2) * 0.12), 0.05));
  }

  /**
   * Coro de cigarras: só de dia, com sol. Some na chuva (e no céu fechado) e na
   * madrugada do menu. Cada cigarra canta em ciclos desencontrados — cresce,
   * segura, morre, fica quieta —, como o coro de verdade que vem em ondas.
   */
  private updateCicadas(dt: number, f: AudioFrame): void {
    const ctx = this.engine.context;
    if (!ctx || this.cicadas.length === 0) return;
    const s = f.scene;
    const target = f.paused ? 0 : (1 - smoothstep(0.02, 0.2, s.rain)) * (1 - smoothstep(0.45, 0.85, f.overcast)) * (1 - s.wetness * 0.6);
    // Devagar: o coro vai calando conforme o tempo fecha, e volta aos poucos com o sol.
    this.sunny += (target - this.sunny) * (1 - Math.exp(-dt / (target < this.sunny ? 2.5 : 8)));
    for (const c of this.cicadas) {
      c.timer -= dt;
      switch (c.state) {
        case 'rest':
          c.level = 0;
          if (c.timer <= 0 && this.sunny > 0.2) {
            c.state = 'swell';
            c.timer = rand(4, 8);
          }
          break;
        case 'swell':
          c.level = Math.min(1, c.level + dt / 6);
          if (c.timer <= 0) {
            c.state = 'sing';
            c.timer = rand(6, 14);
          }
          break;
        case 'sing':
          c.level = Math.min(1, c.level + dt / 3);
          if (c.timer <= 0) {
            c.state = 'fade';
            c.timer = rand(2.5, 4.5);
          }
          break;
        case 'fade':
          c.level = Math.max(0, c.level - dt / 3);
          if (c.timer <= 0) {
            c.state = 'rest';
            c.timer = rand(6, 22);
          }
          break;
      }
      const loud = c.level * c.level;
      ease(ctx, c.gain.gain, CICADA_GAIN * loud * this.sunny, 0.25);
      // Engrossando o canto, a altura sobe um pouco.
      const pitch = c.base * (0.93 + 0.08 * c.level);
      for (const p of c.voice.pitch) ease(ctx, p, pitch, 0.4);
    }
  }

  /** Zumbido: osciladores serrote com vibrato → passa-baixa → (tremolo) → ganho → panner. */
  private buzz(freqs: number[], vibratoRate: number, vibratoDepth: number, cutoff: number, q: number, tremoloRate = 0): Buzz {
    const ctx = this.engine.context!;
    const emitter = this.engine.emitter('ambience', true);
    const gain = new GainNode(ctx, { gain: 0 });
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff, Q: q });
    let tail: AudioNode = filter;
    if (tremoloRate > 0) {
      const trem = new GainNode(ctx, { gain: 0.65 });
      const lfo = new OscillatorNode(ctx, { frequency: tremoloRate });
      lfo.connect(new GainNode(ctx, { gain: 0.35 })).connect(trem.gain);
      lfo.start();
      tail = filter.connect(trem);
    }
    tail.connect(gain).connect(emitter.input);
    const voices = freqs.map((frequency, i) => {
      const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency });
      const vibrato = new OscillatorNode(ctx, { frequency: vibratoRate * (1 + i * 0.13) });
      vibrato.connect(new GainNode(ctx, { gain: vibratoDepth })).connect(o.frequency);
      o.connect(new GainNode(ctx, { gain: i === 0 ? 1 : 0.6 })).connect(filter);
      o.start();
      vibrato.start();
      return o;
    });
    return { emitter, gain, voices, base: freqs };
  }
}
