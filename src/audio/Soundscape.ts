import { clamp, damp } from '../utils/math';
import { noise3 } from '../utils/noise';
import type { AudioEngine, Vec3Like } from './AudioEngine';
import type { AudioFrame } from './frame';
import { pick, rand } from './dsp';
import { ease, loopNoise } from './loops';
import { birdSong, cricket, drip, owl, puddlePlop, rainTick, thunder, type BirdSong } from './voices/nature';

/**
 * Paisagem sonora: o jardim de dia (vento, folhas, passarinhos), a madrugada
 * do menu (grilos e coruja) e o clima (chuva em camadas, gotas nas folhas e
 * nas poças, pingos depois da chuva, trovão).
 *
 * Os passarinhos e os grilos têm posição no mundo; vento e chuva envolvem o
 * jogador (estéreo largo, sem posição).
 */

interface WindMix {
  lows: Array<{ filter: BiquadFilterNode; gain: GainNode }>;
  leaves: GainNode;
}

interface RainMix {
  hiss: GainNode;
  body: GainNode;
  patter: GainNode;
  patterSources: AudioBufferSourceNode[];
  rumble: GainNode;
}

interface Cricket {
  position: Vec3Like;
  freq: number;
  pulses: number;
  period: number;
  timer: number;
}

interface PendingCall {
  at: number;
  song: BirdSong;
}

const BIRDS: readonly BirdSong[] = ['warbler', 'warbler', 'whistle', 'trill', 'trill', 'dove'];

/**
 * Ganho de cada canto: passarinho está longe (a distância come ~15 dB), mas
 * canta alto. Os níveis foram medidos para ficarem claros sem gritar.
 */
const BIRD_GAIN: Record<BirdSong, number> = { warbler: 6, whistle: 5, trill: 10, dove: 4 };

export class Soundscape {
  private wind: WindMix | null = null;
  private rain: RainMix | null = null;
  private night = true;
  /** 0 = dia, 1 = madrugada (suavizado: grilos e passarinhos trocam de turno devagar). */
  private nightLevel = 1;
  private time = 0;
  private birdTimer = rand(2, 5);
  private owlTimer = rand(8, 16);
  private tickTimer = 0;
  private plopTimer = 0;
  private dripTimer = 0;
  private readonly pending: PendingCall[] = [];
  private crickets: Cricket[] = [];

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    const ctx = this.engine.context!;
    const bank = this.engine.noise!;
    const out = this.engine.emitter('ambience', false).input;
    /** Ganho que controla uma camada inteira (já ligado na saída). */
    const fader = (): GainNode => {
      const gain = new GainNode(ctx, { gain: 0 });
      gain.connect(out);
      return gain;
    };
    /** Uma fonte por lado, cada uma no seu canto do estéreo, somadas no `into`. */
    const wide = (into: GainNode, pans: readonly number[], make: () => AudioNode): void => {
      for (const pan of pans) make().connect(new StereoPannerNode(ctx, { pan })).connect(into);
    };

    // Vento: dois roncos independentes (um por lado) com rajadas desencontradas.
    const lows = [-0.7, 0.7].map((pan) => {
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400, Q: 0.5 });
      const gain = new GainNode(ctx, { gain: 0 });
      loopNoise(ctx, bank.brown).connect(filter).connect(gain).connect(new StereoPannerNode(ctx, { pan })).connect(out);
      return { filter, gain };
    });
    const leaves = fader();
    wide(leaves, [-0.8, 0.8], () => loopNoise(ctx, bank.white).connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 5200, Q: 0.5 })));
    this.wind = { lows, leaves };

    // Chuva: chiado largo (L/R), corpo, "tamborilar" de gotas e ronco distante.
    const hiss = fader();
    wide(hiss, [-0.9, 0.9], () =>
      loopNoise(ctx, bank.pink)
        .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1800, Q: 0.5 }))
        .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 10000, Q: 0.5 })),
    );
    const body = fader();
    loopNoise(ctx, bank.pink).connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.6 })).connect(body);
    const patter = fader();
    const patterSources: AudioBufferSourceNode[] = [];
    wide(patter, [-0.7, 0.7], () => {
      const src = loopNoise(ctx, bank.crackle);
      patterSources.push(src);
      return src.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2800, Q: 0.7 }));
    });
    const rumble = fader();
    loopNoise(ctx, bank.brown).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220, Q: 0.5 })).connect(rumble);
    this.rain = { hiss, body, patter, patterSources, rumble };
  }

  /** Menu aberto (madrugada) ou jogo rolando (dia). Amanhecer chama o coro dos passarinhos. */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    // Grilos novos em volta de onde a noite caiu (os antigos podem ter ficado lá longe).
    if (night) this.crickets = [];
    else {
      const now = this.time;
      this.pending.push({ at: now + 0.7, song: 'dove' }, { at: now + 1.9, song: 'warbler' }, { at: now + 3.1, song: 'trill' }, { at: now + 4.6, song: 'whistle' });
      this.birdTimer = rand(6, 9);
    }
  }

  /** Trovão (a luz vem antes: o som chega depois, mais atrasado quanto mais longe). */
  thunder(distance: number): void {
    this.engine.play(thunder(distance), { bus: 'ambience', essential: true, delay: 0.3 + distance * 1.4 });
  }

  update(dt: number, f: AudioFrame, listener: Vec3Like): void {
    this.time += dt;
    this.nightLevel = damp(this.nightLevel, this.night ? 1 : 0, 0.9, dt);
    const s = f.scene;
    // No menu a chuva continua, mais distante (atrás da "janela" da madrugada).
    const rain = f.paused ? s.rain * 0.6 : s.rain;
    this.updateWind(f, rain);
    this.updateRain(rain);
    this.updateRainBits(dt, f, rain, listener);
    this.updateBirds(dt, f, rain, listener);
    this.updateNight(dt, rain, listener);
  }

  // --- camadas contínuas ------------------------------------------------------

  private updateWind(f: AudioFrame, rain: number): void {
    const wind = this.wind;
    const ctx = this.engine.context;
    if (!wind || !ctx) return;
    const calm = this.night ? 0.7 : 1;
    wind.lows.forEach((low, i) => {
      const gust = clamp(0.5 + 0.5 * noise3(this.time * 0.11, i * 5.3, 0.5) + 0.25 * noise3(this.time * 0.37, i * 5.3 + 3.1, 1.7), 0, 1);
      const level = (0.35 + 0.65 * gust) * (1 + f.overcast * 0.6 + rain * 0.3) * calm;
      ease(ctx, low.gain.gain, level * 0.32, 0.3);
      ease(ctx, low.filter.frequency, 220 + gust * 520 + f.overcast * 200, 0.3);
    });
    const gust = clamp(0.5 + 0.5 * noise3(this.time * 0.11, 2.6, 0.5) + 0.25 * noise3(this.time * 0.37, 5.7, 1.7), 0, 1);
    ease(ctx, wind.leaves.gain, Math.max(0, gust - 0.5) * 2 * (1 - rain * 0.6) * calm * 0.5, 0.3);
  }

  private updateRain(rain: number): void {
    const mix = this.rain;
    const ctx = this.engine.context;
    if (!mix || !ctx) return;
    ease(ctx, mix.hiss.gain, rain * 0.8, 0.4);
    ease(ctx, mix.body.gain, rain * 0.6, 0.4);
    ease(ctx, mix.patter.gain, Math.pow(rain, 1.3) * 2, 0.4);
    for (const src of mix.patterSources) ease(ctx, src.playbackRate, 0.9 + rain * 0.8, 0.5);
    ease(ctx, mix.rumble.gain, rain * 0.6, 0.5);
  }

  // --- pontuais do clima --------------------------------------------------------

  private updateRainBits(dt: number, f: AudioFrame, rain: number, listener: Vec3Like): void {
    const s = f.scene;
    if (rain > 0.05) {
      // Gotas batendo nas folhas em volta.
      this.tickTimer -= dt;
      while (this.tickTimer <= 0) {
        this.tickTimer += 1 / (3 + 12 * rain);
        const a = Math.random() * Math.PI * 2;
        const d = rand(1.5, 6);
        this.engine.play(rainTick, { bus: 'ambience', at: { x: listener.x + Math.cos(a) * d, y: listener.y + rand(-1, 1.5), z: listener.z + Math.sin(a) * d }, gain: 4 });
      }
      // Gotas na poça mais perto.
      let nearest = null as (typeof s.puddles)[number] | null;
      let best = 14;
      for (const p of s.puddles) {
        if (p.fill < 0.25) continue;
        const d = Math.hypot(p.x - listener.x, p.z - listener.z) - p.radius;
        if (d < best) {
          best = d;
          nearest = p;
        }
      }
      if (nearest) {
        this.plopTimer -= dt;
        const rate = rain * 10 * nearest.fill * (1 - Math.max(best, 0) / 14);
        while (this.plopTimer <= 0 && rate > 0.1) {
          this.plopTimer += 1 / rate;
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * nearest.radius * 0.7;
          this.engine.play(puddlePlop, { bus: 'ambience', at: { x: nearest.x + Math.cos(a) * d, y: nearest.level, z: nearest.z + Math.sin(a) * d }, gain: 5 });
        }
      }
    } else if (s.wetness > 0.2 && !f.paused) {
      // Depois da chuva: pingos caindo das folhas, cada vez mais raros.
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = rand(0.3, 1.6) / s.wetness;
        const a = Math.random() * Math.PI * 2;
        const d = rand(2, 9);
        this.engine.play(drip, { bus: 'ambience', at: { x: listener.x + Math.cos(a) * d, y: listener.y + rand(0.5, 3), z: listener.z + Math.sin(a) * d }, gain: 5 });
      }
    }
  }

  // --- bichos do dia e da noite --------------------------------------------------

  private updateBirds(dt: number, f: AudioFrame, rain: number, listener: Vec3Like): void {
    const quiet = rain > 0.2 || f.overcast > 0.75;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.time < this.pending[i].at) continue;
      const call = this.pending.splice(i, 1)[0];
      if (!quiet && !this.night) this.sing(call.song, listener);
    }
    if (this.night || quiet) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    this.birdTimer = rand(3, 8) * (1 + f.overcast * 2);
    const song = pick(BIRDS);
    this.sing(song, listener);
    // Às vezes outro da mesma espécie responde de outro galho.
    if (Math.random() < 0.35) this.pending.push({ at: this.time + rand(0.8, 2), song });
  }

  private sing(song: BirdSong, listener: Vec3Like): void {
    const a = Math.random() * Math.PI * 2;
    const d = rand(10, 26);
    const at = { x: listener.x + Math.cos(a) * d, y: listener.y + rand(5, 10), z: listener.z + Math.sin(a) * d };
    this.engine.play(birdSong(song), { bus: 'ambience', at, gain: BIRD_GAIN[song], reverb: 0.25 });
  }

  private updateNight(dt: number, rain: number, listener: Vec3Like): void {
    const level = this.nightLevel * (1 - rain * 0.85);
    if (level < 0.03) return;
    if (this.crickets.length === 0) this.placeCrickets(listener);
    for (const c of this.crickets) {
      c.timer -= dt;
      if (c.timer > 0) continue;
      c.timer = c.period * rand(0.85, 1.15);
      this.engine.play(cricket(c.freq, c.pulses), { bus: 'night', at: c.position, gain: level * 7 });
    }
    if (!this.night) return;
    this.owlTimer -= dt;
    if (this.owlTimer <= 0) {
      this.owlTimer = rand(20, 38);
      const a = Math.random() * Math.PI * 2;
      this.engine.play(owl, { bus: 'night', at: { x: listener.x + Math.cos(a) * 36, y: listener.y + 10, z: listener.z + Math.sin(a) * 36 }, gain: level * 6, reverb: 0.4 });
    }
  }

  /** Grilos fixos no mundo, espalhados em volta de onde o jogador está (a câmera do menu gira no meio deles). */
  private placeCrickets(listener: Vec3Like): void {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.4, 0.4);
      const d = rand(7, 18);
      this.crickets.push({
        position: { x: listener.x + Math.cos(a) * d, y: listener.y - 1, z: listener.z + Math.sin(a) * d },
        freq: rand(4200, 4900),
        pulses: 2 + Math.floor(Math.random() * 3),
        period: rand(0.55, 1.1),
        timer: rand(0, 1),
      });
    }
  }
}
