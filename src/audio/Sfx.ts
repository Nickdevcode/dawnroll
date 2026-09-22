/**
 * Efeitos sonoros 100% sintetizados com Web Audio — nada de arquivo de áudio.
 * Tudo curto, macio e "molhado", combinando com o visual de massinha.
 *
 * O AudioContext só nasce no primeiro gesto do usuário (regra dos navegadores).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  /** Camadas da chuva (chiado agudo + ronco grave), com volume seguindo a intensidade. */
  private rainHiss: GainNode | null = null;
  private rainRumble: GainNode | null = null;
  private rainLevel = 0;
  private dropTimer = 0;

  /** Chamar dentro de um handler de clique/tecla. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbience();
    this.startRain();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** "Splotch" úmido: ruído filtrado com varredura descendente. `size` 0..1 deixa mais grave. */
  squish(size = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3;
    const startFreq = 1400 - size * 700;
    filter.frequency.setValueAtTime(startFreq, t);
    filter.frequency.exponentialRampToValueAtTime(startFreq * 0.25, t + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.3);

    // Corpo grave do "ploft".
    this.tone(180 - size * 80, 60, 0.16, 0.35, 'sine');
  }

  /** Estalinho de coisa grudando. */
  pop(): void {
    this.tone(620 + Math.random() * 200, 240, 0.08, 0.25, 'triangle');
  }

  jump(): void {
    this.tone(260, 520, 0.14, 0.22, 'sine');
  }

  land(): void {
    this.tone(140, 70, 0.1, 0.3, 'sine');
  }

  grab(): void {
    this.tone(330, 440, 0.06, 0.15, 'triangle');
  }

  thud(strength: number): void {
    this.tone(110, 50, 0.18, 0.2 + strength * 0.5, 'sine');
  }

  /** Arrancou algo do chão: estalo de raiz soltando + "tum" grave proporcional ao tamanho. */
  pluck(size: number): void {
    const s = Math.min(size / 3, 1);
    this.noiseBurst(2600 - s * 1400, 0.09, 0.35, 6);
    this.tone(520 - s * 260, 180 - s * 80, 0.14, 0.3, 'triangle');
    this.tone(150 - s * 70, 50, 0.22 + s * 0.1, 0.25 + s * 0.3, 'sine');
  }

  /** Terra sendo cavada (enterro): chiado curto e abafado. */
  dig(strength: number): void {
    this.noiseBurst(500 + Math.random() * 400, 0.12, 0.18 + strength * 0.2, 1.4);
  }

  /** Bola enterrada: arpejo alegre (com uma nota a mais quando é recorde). */
  fanfare(record: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const notes = record ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, f * 1.005, 0.32, 0.22, 'triangle', i * 0.09));
    this.tone(130.8, 98, 0.5, 0.35, 'sine');
  }

  /** "Tchibum" na água: ruído com varredura + bolhinha. `size` 0..1. */
  splash(size = 0.5): void {
    const s = Math.min(Math.max(size, 0), 1);
    this.noiseBurst(1800 - s * 900, 0.25 + s * 0.15, 0.3 + s * 0.35, 2.2, 0.35);
    this.tone(900 - s * 300, 1500, 0.07, 0.12, 'sine', 0.05);
  }

  /** Volume da chuva (0..1), chamado todo frame; também pinga gotinhas perto. */
  setRain(level: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.rainHiss || !this.rainRumble) return;
    if (Math.abs(level - this.rainLevel) > 0.01) {
      this.rainLevel = level;
      this.rainHiss.gain.setTargetAtTime(level * 0.2, ctx.currentTime, 0.3);
      this.rainRumble.gain.setTargetAtTime(level * 0.12, ctx.currentTime, 0.3);
    }
    if (level < 0.05) return;
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = 0.05 + Math.random() * (0.5 - level * 0.4);
      const f = 1400 + Math.random() * 2200;
      this.tone(f, f * 0.7, 0.04, 0.03 + Math.random() * 0.04 * level, 'sine');
    }
  }

  /** Trovão: estalo (perto) e um ronco longo e grave que rola e some. */
  thunder(distance: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime + 0.3 + distance * 1.4;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 - distance * 500, t);
    filter.frequency.exponentialRampToValueAtTime(90, t + 2.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9 - distance * 0.4, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 3.3);
  }

  /** Ruído filtrado curto (base de estalos, terra e água). */
  private noiseBurst(frequency: number, duration: number, volume: number, q: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.35), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  private tone(from: number, to: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Brisa de fundo: ruído bem filtrado com volume oscilando devagar. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Chuva em loop, começando muda: chiado (gotas no capim) + ronco (chuva longe). */
  private startRain(): void {
    const ctx = this.ctx!;
    const make = (type: BiquadFilterType, frequency: number, q: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master!);
      // Começa em pontos diferentes do mesmo ruído: as duas camadas não "batem".
      src.start(0, Math.random() * 0.9);
      return gain;
    };
    this.rainHiss = make('bandpass', 3200, 0.5);
    this.rainRumble = make('lowpass', 380, 0.7);
  }
}
