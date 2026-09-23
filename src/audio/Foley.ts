import { clamp, smoothstep } from '../utils/math';
import type { AudioEngine, Emitter } from './AudioEngine';
import type { AudioFrame } from './frame';
import { rand } from './dsp';
import { ease, loopNoise } from './loops';
import { fizz, footstep, scrape, type Surface } from './voices/foley';
import { bubble } from './voices/kit';

/**
 * Foley contínuo: o som da bola rolando (a mecânica principal), os passinhos
 * do besouro, a água e a bola derretendo na poça.
 *
 * A bola rolando é uma mesa de camadas em loop, todas presas a um panner na
 * posição da bola — só o volume e o filtro de cada uma mudam por quadro:
 *   corpo     ronco grave (bola grande = mais grave), com o "tum-tum" dos calombos
 *   grama     farfalhar agudo
 *   terra     estalos de grão (tocados mais rápido quanto mais rápida a bola)
 *   itens     tralha grudada batendo no chão (Katamari)
 *   lama      chão molhado: grave e pegajoso
 *   água      bola atravessando poça
 *   derreter  chiado efervescente quando a poça come a bola
 */

interface RollingMix {
  emitter: Emitter;
  body: GainNode;
  bodyFilter: BiquadFilterNode;
  bump: OscillatorNode;
  grass: GainNode;
  dirt: GainNode;
  dirtSource: AudioBufferSourceNode;
  items: GainNode;
  mud: GainNode;
  water: GainNode;
  fizz: GainNode;
}

export class Foley {
  private roll: RollingMix | null = null;
  private lastFootfalls = 0;
  private scrapeTimer = 0;
  private bubbleTimer = 0;
  private fizzTimer = 0;

  constructor(private readonly engine: AudioEngine) {}

  /** Monta as camadas (chamar quando o contexto nascer). */
  start(): void {
    const ctx = this.engine.context!;
    const bank = this.engine.noise!;
    const emitter = this.engine.emitter('fx', true);
    const out = emitter.input;
    const layer = (source: AudioBufferSourceNode, ...chain: AudioNode[]): GainNode => {
      const gain = new GainNode(ctx, { gain: 0 });
      let node: AudioNode = source;
      for (const next of chain) node = node.connect(next);
      node.connect(gain).connect(out);
      return gain;
    };

    const bodyFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 200, Q: 0.9 });
    // Tremolo dos calombos: o ganho oscila entre 0,3 e 1 na frequência de rotação.
    const bumpNode = new GainNode(ctx, { gain: 0.65 });
    const bump = new OscillatorNode(ctx, { type: 'sine', frequency: 1 });
    bump.connect(new GainNode(ctx, { gain: 0.35 })).connect(bumpNode.gain);
    bump.start();
    const body = layer(loopNoise(ctx, bank.brown), bodyFilter, bumpNode);

    const grass = layer(loopNoise(ctx, bank.pink), new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3200, Q: 0.7 }));
    const dirtSource = loopNoise(ctx, bank.crackle);
    const dirt = layer(dirtSource, new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1900, Q: 0.8 }));
    const items = layer(loopNoise(ctx, bank.crackle, 0.75), new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2400, Q: 0.6 }));
    const mud = layer(loopNoise(ctx, bank.pink), new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 2 }));

    // Água: ruído "ondulando" devagar (marola em volta da bola).
    const waterWave = new GainNode(ctx, { gain: 0.6 });
    const waterLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 1.3 });
    waterLfo.connect(new GainNode(ctx, { gain: 0.4 })).connect(waterWave.gain);
    waterLfo.start();
    const water = layer(loopNoise(ctx, bank.pink), new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700, Q: 1.4 }), waterWave);
    const fizzGain = layer(loopNoise(ctx, bank.crackle, 2.2), new BiquadFilterNode(ctx, { type: 'highpass', frequency: 3500, Q: 0.6 }));

    this.roll = { emitter, body, bodyFilter, bump, grass, dirt, dirtSource, items, mud, water, fizz: fizzGain };
  }

  update(dt: number, f: AudioFrame): void {
    this.updateRolling(f);
    this.updateSteps(dt, f);
    this.updateWaterBits(dt, f);
  }

  /** Chão debaixo do besouro, do jeito que o som enxerga. */
  surfaceUnderPlayer(f: AudioFrame): Surface {
    const s = f.scene;
    if (s.playerWater > 0.03) return 'water';
    if (f.feetClearance > 0.15) return 'hard';
    const dirt = f.playerDirt > 0.4;
    if (s.wetness > 0.55) return dirt ? 'mud' : 'grass';
    return dirt ? 'dirt' : 'grass';
  }

  private updateRolling(f: AudioFrame): void {
    const roll = this.roll;
    const ctx = this.engine.context;
    if (!roll || !ctx) return;
    const s = f.scene;
    const p = s.ballPosition;
    const r = s.ballRadius;
    const speed = Math.hypot(s.ballVelocity.x, s.ballVelocity.z);
    const k = clamp(r / 3, 0, 1);
    const sp = clamp(speed / 5, 0, 1);
    const inWater = f.ballSolid && s.ballWater > 0.02;
    const contact = f.ballSolid && !f.burying && !f.paused && f.ballClearance < 0.3 && !inWater;
    // Abaixo de ~0,2 u/s a bola está "parada" (a física nunca zera de vez).
    const g = contact ? Math.pow(sp, 0.8) * smoothstep(0.15, 0.6, speed) : 0;
    const wet = s.wetness;
    const dirt = f.ballDirt;

    ease(ctx, roll.body.gain, g * (0.9 + 0.8 * k));
    ease(ctx, roll.bodyFilter.frequency, (140 + 380 * sp) * (1.2 - 0.5 * k), 0.12);
    // Calombos por volta: ~5 (bola feita à mão), na velocidade angular de rolar sem escorregar.
    ease(ctx, roll.bump.frequency, clamp(((speed / Math.max(r, 0.2)) / (2 * Math.PI)) * 5, 0.5, 14), 0.1);
    ease(ctx, roll.grass.gain, g * (1 - dirt) * (1 - wet * 0.5) * 0.95);
    ease(ctx, roll.dirt.gain, g * dirt * (1 - wet * 0.6) * 3.2);
    ease(ctx, roll.dirtSource.playbackRate, 0.55 + sp * 1.1 - k * 0.2, 0.12);
    ease(ctx, roll.items.gain, g * clamp(f.ballItems / 25, 0, 1) * 2.2);
    ease(ctx, roll.mud.gain, g * wet * 1.2);
    ease(ctx, roll.water.gain, inWater && !f.paused ? 0.15 + clamp(speed / 3, 0, 1) * 0.6 : 0, 0.15);
    ease(ctx, roll.fizz.gain, f.ballDissolving && !f.paused ? 1.6 : 0, 0.2);
    roll.emitter.moveTo({ x: p.x, y: p.y - r * 0.7, z: p.z });
  }

  /** Um passinho a cada pata que encosta no chão (o contador vem da animação). */
  private updateSteps(dt: number, f: AudioFrame): void {
    const s = f.scene;
    const moved = f.footfalls - this.lastFootfalls;
    this.lastFootfalls = f.footfalls;
    const speed = Math.hypot(s.playerVelocity.x, s.playerVelocity.z);
    if (moved > 0 && moved < 4 && !f.paused && s.playerGrounded && speed > 0.5) {
      const level = 0.55 + 0.45 * clamp(speed / 6.4, 0, 1);
      this.engine.play(footstep(this.surfaceUnderPlayer(f), level), { at: s.player, key: 'step', minInterval: 0.045 });
    }
    // Empurrando com muita força, as patinhas escorregam de vez em quando.
    if (s.pushing && s.strain > 0.7 && !f.paused) {
      this.scrapeTimer -= dt;
      if (this.scrapeTimer <= 0) {
        this.scrapeTimer = rand(0.25, 0.6) / s.strain;
        this.engine.play(scrape, { at: s.player, gain: 0.6 + s.strain * 0.4 });
      }
    }
  }

  /** Bolhas: bola atravessando a poça e bola derretendo. */
  private updateWaterBits(dt: number, f: AudioFrame): void {
    if (f.paused) return;
    const s = f.scene;
    const p = s.ballPosition;
    const speed = Math.hypot(s.ballVelocity.x, s.ballVelocity.z);
    if (f.ballSolid && s.ballWater > 0.02 && speed > 0.3) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleTimer = rand(0.08, 0.3) / Math.min(speed, 3);
        const size = clamp(s.ballRadius / 3, 0, 1);
        this.engine.play((v) => bubble(v, rand(350, 1100) * (1.2 - size * 0.5), rand(0.04, 0.08)), { at: p });
      }
    }
    if (f.ballDissolving) {
      this.fizzTimer -= dt;
      if (this.fizzTimer <= 0) {
        this.fizzTimer = rand(0.04, 0.14);
        this.engine.play(fizz, { at: p });
      }
    }
  }
}
