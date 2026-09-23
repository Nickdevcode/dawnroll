import * as THREE from 'three';
import { clamp } from '../utils/math';
import { noise3 } from '../utils/noise';
import type { CritterCall, CritterHum, CritterSounds } from '../fx/critters/types';
import type { AudioEngine, Emitter } from './AudioEngine';
import type { AudioFrame } from './frame';
import { rand } from './dsp';
import { ease } from './loops';
import { frogCroak, grasshopperHop, stridulate } from './voices/nature';

/**
 * Som dos bichos: escuta o que as espécies avisam (coaxou, pulou, está
 * zumbindo) e toca no lugar certo do mundo. Zumbidos são contínuos, então só
 * o bicho mais perto de cada tipo soa — uma abelha nítida vale mais que dez
 * embolando. As moscas vêm dos montinhos de bosta (o fedor que se vê).
 */

/** Até onde um zumbido é ouvido (unidades de mundo). */
const BEE_RANGE = 14;
const FLY_RANGE = 8;
const STRIDULATE_RANGE = 12;
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

export class Wildlife implements CritterSounds {
  private readonly calls: PendingCall[] = [];
  private readonly hums: Record<CritterHum, HumSlot> = {
    bee: { distance: Infinity, position: new THREE.Vector3() },
    stridulate: { distance: Infinity, position: new THREE.Vector3() },
  };
  /** Referência de "perto" para escolher o bicho que soa (o besouro). */
  private readonly near = new THREE.Vector3();
  private bee: Buzz | null = null;
  private flies: Buzz | null = null;
  private time = 0;
  private stridulateTimer = 0;
  private readonly flyAt = new THREE.Vector3();

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    // Abelha: dois serrotes quase iguais (asas) com vibrato, passa-baixa.
    this.bee = this.buzz([226, 229.5], 6.3, 6, 1600, 1.2);
    // Moscas: mais agudas e nervosas, com um tremolo de "voando em círculo".
    this.flies = this.buzz([188, 207], 12, 10, 1300, 0.8, 0.7);
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
    for (const c of this.calls) {
      if (c.kind === 'croak') this.engine.play(frogCroak(c.size), { bus: 'ambience', at: c.position, reverb: 0.15 });
      else this.engine.play(grasshopperHop, { bus: 'ambience', at: c.position, gain: 2 });
    }
    this.calls.length = 0;

    this.updateBee();
    this.updateStridulation(dt);
    this.updateFlies(f);

    // Os bichos do próximo quadro medem distância até o besouro de agora.
    this.near.copy(f.scene.player);
    this.hums.bee.distance = Infinity;
    this.hums.stridulate.distance = Infinity;
  }

  private updateBee(): void {
    const bee = this.bee;
    const ctx = this.engine.context;
    if (!bee || !ctx) return;
    const slot = this.hums.bee;
    const level = slot.distance < BEE_RANGE ? 1 - slot.distance / BEE_RANGE : 0;
    ease(ctx, bee.gain.gain, 0.09 * Math.sqrt(level), 0.15);
    if (level > 0) {
      bee.emitter.moveTo(slot.position);
      // Altura mudando devagar (a abelha acelera e freia em volta da flor).
      const drift = 1 + noise3(this.time * 0.8, 1.3, 0) * 0.04;
      bee.voices.forEach((o, i) => ease(ctx, o.frequency, bee.base[i] * drift, 0.1));
    }
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
