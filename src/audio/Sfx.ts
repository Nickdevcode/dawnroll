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

  private tone(from: number, to: number, duration: number, volume: number, type: OscillatorType): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
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
}
