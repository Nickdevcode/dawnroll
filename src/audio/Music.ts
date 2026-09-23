import { clamp, smoothstep } from '../utils/math';
import type { AudioEngine } from './AudioEngine';
import { pick, rand } from './dsp';
import type { Recipe } from './voices/kit';
import { bass, celesta, glock, kalimba, marimba, pad, shaker, shimmer, softKick, timpani, woodblock } from './voices/instruments';

/**
 * Trilha generativa em Fá maior, tocada ao vivo (nada gravado, nunca repete
 * igual). Três humores, que trocam na virada do compasso:
 *
 *   madrugada (menu)  pad flutuando em Fmaj9 ↔ B♭maj9, celesta de caixinha de música
 *   dia (jogando)     marimba desenhando o acorde, baixo sincopado e, conforme a
 *                     bola cresce, chocalho, bloco de madeira, bumbo e melodia de kalimba
 *   chuva             Ré menor, marimba esparsa e "gotas" de kalimba lá no agudo
 *
 * As vinhetas (amanhecer, marcos, fanfarra do enterro, notinha de pegar coisa)
 * usam o mesmo tom, então sempre casam com o que está tocando.
 */

export type Mood = 'night' | 'day' | 'rain';
type Layer = 'pad' | 'bass' | 'keys' | 'melody' | 'perc';

interface Chord {
  /** Nota do baixo (MIDI, de Dó2 a Si2). */
  readonly bass: number;
  /** Classes de altura do acorde (0 = Dó … 11 = Si). */
  readonly pcs: readonly number[];
}

interface Phrase {
  /** Semicolcheias (0..31, dois compassos) em que a melodia toca. */
  readonly steps: readonly number[];
  /** Passo na escala a cada nota (−2..2). */
  readonly moves: number[];
}

const BPM = 88;
/** Uma semicolcheia, em segundos. */
const STEP = 60 / BPM / 4;
/** Balanço: as semicolcheias "de trás" atrasam um pouco (só de dia). */
const SWING = 0.12;

const C = 0, D = 2, F = 5, G = 7, A = 9, Bb = 10;
const PENTATONIC: readonly number[] = [F, G, A, C, D];

const chord = (root: number, ...intervals: number[]): Chord => ({ bass: 36 + root, pcs: intervals.map((i) => (root + i) % 12) });

const PROGRESSIONS: Record<Mood, readonly Chord[]> = {
  // Fmaj7 · Dm7 · B♭maj7 · C7sus4 | B♭maj7 · Am7 · Gm7 · C7
  day: [chord(F, 0, 4, 7, 11), chord(D, 0, 3, 7, 10), chord(Bb, 0, 4, 7, 11), chord(C, 0, 5, 7, 10), chord(Bb, 0, 4, 7, 11), chord(A, 0, 3, 7, 10), chord(G, 0, 3, 7, 10), chord(C, 0, 4, 7, 10)],
  // Dm9 · B♭maj7 · Fmaj7 · C6
  rain: [chord(D, 0, 3, 7, 10, 14), chord(Bb, 0, 4, 7, 11), chord(F, 0, 4, 7, 11), chord(C, 0, 4, 7, 9)],
  // Fmaj9 · B♭maj9, dois compassos cada.
  night: [chord(F, 0, 4, 7, 11, 14), chord(Bb, 0, 4, 7, 11, 14)],
};

/** Ritmos de frase (duas barras de semicolcheias). */
const RHYTHMS: readonly (readonly number[])[] = [
  [0, 4, 6, 8, 12, 16, 20, 22, 24],
  [0, 3, 6, 10, 12, 18, 24, 27],
  [2, 4, 8, 10, 14, 16, 22, 24, 28],
  [0, 6, 8, 12, 14, 16, 24],
];

/** Notinha de pegar coisa: pentatônica subindo a cada item seguido (combo estilo Katamari). */
const COMBO_NOTES: readonly number[] = [72, 74, 77, 79, 81, 84, 86, 89, 91, 93, 96];

const chance = (p: number): boolean => Math.random() < p;

/** Todas as notas MIDI das classes `pcs` entre `lo` e `hi`, em ordem. */
function notesIn(pcs: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

/** Notas boas para melodia neste acorde: pentatônica + acorde, sem a que fica meio tom acima de uma nota do acorde. */
function safePcs(c: Chord): number[] {
  const all = new Set([...PENTATONIC, ...c.pcs]);
  return [...all].filter((pc) => c.pcs.includes(pc) || !c.pcs.includes((pc + 11) % 12));
}

/** Voicing aberto do pad: acorde fechado perto do Dó central, com a segunda voz de cima uma oitava abaixo ("drop 2"). */
function voicing(c: Chord): number[] {
  const close = c.pcs.map((pc) => 55 + ((((pc - 55) % 12) + 12) % 12)).sort((a, b) => a - b);
  if (close.length >= 4) close[close.length - 2] -= 12;
  return close.sort((a, b) => a - b);
}

export class Music {
  private mood: Mood = 'night';
  private pendingMood: Mood | null = null;
  private chord: Chord = PROGRESSIONS.night[0];
  private step = 0;
  private barCount = -1;
  private nextTime = 0;
  private intensity = 0.3;
  private targetIntensity = 0.3;
  private enabled = true;
  private out: GainNode | null = null;
  private layers: Record<Layer, GainNode> | null = null;
  private readonly levels: Record<Layer, number> = { pad: 1, bass: 1, keys: 1, melody: 0, perc: 0 };
  private arpShape = 0;
  private arpOffset = 0;
  private phrase: Phrase | null = null;
  private phraseActive = false;
  private melodyIndex = 4;

  constructor(private readonly engine: AudioEngine) {}

  start(mood: Mood): void {
    const ctx = this.engine.context!;
    this.out = this.engine.emitter('music', false).input;
    const layer = () => {
      const gain = new GainNode(ctx, { gain: 0 });
      gain.connect(this.out!);
      return gain;
    };
    this.layers = { pad: layer(), bass: layer(), keys: layer(), melody: layer(), perc: layer() };
    this.restart(mood);
    this.engine.addScheduler((now, horizon) => this.schedule(now, horizon));
  }

  /** 0..1: quanto está acontecendo (bola grande, empurrando…). A trilha engrossa aos poucos. */
  setIntensity(value: number): void {
    this.targetIntensity = clamp(value, 0, 1);
  }

  /** Troca de humor na próxima virada de compasso (ex.: começou a chover). */
  setMood(mood: Mood): void {
    this.pendingMood = mood === this.mood ? null : mood;
  }

  /** Troca de humor agora, recomeçando a progressão (amanhecer/anoitecer). */
  restart(mood: Mood): void {
    this.mood = mood;
    this.pendingMood = null;
    this.step = 0;
    this.barCount = -1;
    this.nextTime = this.engine.now + 0.12;
    this.phraseActive = false;
    this.releasePads();
  }

  /** Volume da trilha em zero: nem agenda notas. Voltou: recomeça limpo. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled && this.layers) this.restart(this.mood);
  }

  // --- vinhetas ----------------------------------------------------------------

  /** Amanhecer (Jogar/Continuar): arpejo de glockenspiel subindo, brilho e um acorde abrindo. */
  dawn(): void {
    const t = this.engine.now + 0.02;
    [72, 77, 81, 84, 88, 89].forEach((m, i) => this.stinger(glock(m, 0.35 + i * 0.07), t + i * 0.085, 'music'));
    this.stinger(shimmer(true), t, 'music');
    this.stinger(pad([53, 60, 65, 67, 69, 72], 1.3, 2.2, 1900), t, 'music');
  }

  /** Anoitecer (pausa): caixinha de música descendo e um acorde escuro. */
  dusk(): void {
    const t = this.engine.now + 0.02;
    [84, 81, 77, 72].forEach((m, i) => this.stinger(celesta(m, 0.55 - i * 0.05), t + i * 0.16, 'music'));
    this.stinger(shimmer(false), t, 'music');
    this.stinger(pad([58, 62, 65, 69, 72], 1.1, 2.4, 800), t, 'music');
  }

  /** Marco de tamanho: arpejo do acorde atual subindo (mais notas quanto maior o marco). */
  milestone(index: number): void {
    const tones = notesIn(this.chord.pcs, 72, 96);
    const count = Math.min(4 + index, 8, tones.length);
    const t = this.engine.now + 0.01;
    this.engine.duckMusic(0.35, 0.9);
    for (let i = 0; i < count; i++) {
      const m = tones[i];
      this.stinger((v) => {
        kalimba(m, 0.6)(v);
        return glock(m, 0.25 + 0.05 * i)(v);
      }, t + i * 0.065);
    }
    this.stinger(celesta(tones[count - 1], 0.6), t + count * 0.065, 'fx', 0.3);
  }

  /**
   * Bola enterrada: corrida de marimba, acorde com tímpano e pad, e um rulo.
   * Recorde ganha chuva de brilho descendo e um "ta-dá" final lá em cima.
   */
  fanfare(record: boolean): void {
    const t = this.engine.now + 0.02;
    this.engine.duckMusic(0.75, record ? 4 : 3);
    [65, 69, 72, 77].forEach((m, i) => {
      this.stinger(marimba(m, 0.9), t + i * 0.1);
      this.stinger(glock(m + 12, 0.45), t + i * 0.1);
    });
    const hit = t + 0.45;
    for (const m of [65, 69, 72, 77]) this.stinger(marimba(m, 0.8), hit);
    this.stinger(timpani(41, 1), hit);
    this.stinger(pad([53, 60, 65, 69, 72, 76], 1.6, 2.4, 2200), hit, 'fx', 0.3);
    for (let i = 0; i < 10; i++) this.stinger(marimba(i % 2 ? 81 : 77, 0.55 - i * 0.04), hit + 0.06 + i * 0.055);
    if (!record) return;
    const sparkle = notesIn(PENTATONIC, 77, 96).reverse();
    sparkle.forEach((m, i) => this.stinger(glock(m, 0.35), hit + 0.8 + i * 0.07));
    const tada = hit + 0.9 + sparkle.length * 0.07;
    this.stinger(kalimba(89, 0.8), tada);
    this.stinger(glock(89, 0.6), tada);
    this.stinger(timpani(41, 0.8), tada);
  }

  /** Pegou uma coisa: nota da pentatônica, mais aguda a cada item seguido. */
  pickup(combo: number): void {
    const m = COMBO_NOTES[Math.min(combo, COMBO_NOTES.length - 1)];
    this.engine.play(
      (v) => {
        kalimba(m, 0.5)(v);
        return glock(m, 0.16)(v);
      },
      { bus: 'fx', key: 'pickup', minInterval: 0.03 },
    );
  }

  /** Bola nova brotando: dois sininhos. */
  sprout(): void {
    const t = this.engine.now + 0.02;
    this.stinger(glock(84, 0.35), t);
    this.stinger(glock(89, 0.35), t + 0.09);
  }

  private stinger(recipe: Recipe, when: number, bus: 'fx' | 'music' = 'fx', reverb = 0.12): void {
    this.engine.play(recipe, { bus, when, reverb, essential: true });
  }

  // --- sequenciador ------------------------------------------------------------

  private schedule(now: number, horizon: number): void {
    if (!this.layers) return;
    // Voltou de uma pausa longa (aba escondida, contexto dormindo): retoma do agora.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < horizon) {
      const s = this.step % 16;
      const swing = this.mood === 'day' && s % 2 === 1 ? SWING * STEP : 0;
      if (this.enabled) this.playStep(s, this.nextTime + swing);
      this.step++;
      this.nextTime += STEP;
    }
  }

  private playStep(s: number, time: number): void {
    if (s === 0) this.beginBar(time);
    if (this.mood === 'day') this.dayStep(s, time);
    else if (this.mood === 'rain') this.rainStep(s, time);
    else this.nightStep(s, time);
  }

  private beginBar(time: number): void {
    if (this.pendingMood) {
      this.mood = this.pendingMood;
      this.pendingMood = null;
      this.barCount = 0;
      this.phraseActive = false;
    } else {
      this.barCount++;
    }
    this.intensity += (this.targetIntensity - this.intensity) * 0.5;
    this.applyLevels(time);

    const barsPerChord = this.mood === 'night' ? 2 : 1;
    if (this.barCount % barsPerChord === 0) {
      const progression = PROGRESSIONS[this.mood];
      this.chord = progression[Math.floor(this.barCount / barsPerChord) % progression.length];
      const brightness = this.mood === 'day' ? 1100 + 700 * this.intensity : this.mood === 'rain' ? 650 : 760;
      this.note(pad(voicing(this.chord), this.mood === 'night' ? 1.1 : 1, STEP * 16 * barsPerChord, brightness), time, 'pad');
    }
    this.arpShape = Math.floor(Math.random() * 4);
    this.arpOffset = Math.floor(Math.random() * 3);

    if (this.mood === 'day') {
      if (this.barCount % 4 === 0) {
        this.phraseActive = chance(0.75);
        if (this.phraseActive) this.phrase = newPhrase();
      } else if (this.barCount % 4 === 2 && this.phrase && this.phraseActive) {
        // Resposta: mesmo ritmo, final diferente (é o que faz soar como música, não sorteio).
        const moves = this.phrase.moves;
        for (let i = Math.max(0, moves.length - 2); i < moves.length; i++) moves[i] = pick([-2, -1, 1, 2]);
      }
    }
  }

  /** Volume de cada camada conforme humor e intensidade (muda devagar, no compasso). */
  private applyLevels(time: number): void {
    const layers = this.layers!;
    const I = this.intensity;
    const target: Record<Layer, number> =
      this.mood === 'day'
        ? { pad: 1 - 0.3 * I, bass: 0.85, keys: smoothstep(0.05, 0.3, I), melody: smoothstep(0.42, 0.62, I), perc: smoothstep(0.3, 0.55, I) }
        : this.mood === 'rain'
          ? { pad: 1, bass: 0.75, keys: 0.7, melody: 0, perc: 0 }
          : { pad: 1, bass: 0.55, keys: 1, melody: 0, perc: 0 };
    for (const name of Object.keys(target) as Layer[]) {
      this.levels[name] = target[name];
      layers[name].gain.setTargetAtTime(target[name], time, 0.8);
    }
  }

  private dayStep(s: number, time: number): void {
    const c = this.chord;
    const I = this.intensity;
    const fifth = c.bass + 7 > 47 ? c.bass - 5 : c.bass + 7;
    // Baixo: no 1, às vezes a quinta sincopada, de novo no 3, e um salto de oitava no fim.
    if (s === 0) this.note(bass(c.bass, 0.9, STEP * 3.5), time, 'bass');
    else if (s === 6 && chance(0.3 + 0.4 * I)) this.note(bass(fifth, 0.6, STEP * 1.5), time, 'bass');
    else if (s === 10 && chance(0.6)) this.note(bass(c.bass, 0.7, STEP * 2), time, 'bass');
    else if (s === 14 && chance(0.3 * I)) this.note(bass(c.bass + 12, 0.45, STEP), time, 'bass');

    // Marimba em colcheias desenhando o acorde.
    if (s % 2 === 0 && chance(0.45 + 0.45 * I)) this.note(marimba(this.arpNote(s / 2), (s % 4 === 0 ? 0.85 : 0.6) * rand(0.85, 1)), time, 'keys');
    // Kalimba respondendo no contratempo.
    if ((s === 3 || s === 11) && chance(0.1 + 0.12 * I)) this.note(kalimba(pick(notesIn(safePcs(c), 77, 89)), 0.45), time, 'keys');

    this.melodyStep(s, time);

    if (this.levels.perc > 0.05) {
      this.note(shaker([0.8, 0.3, 0.55, 0.3][s % 4] * rand(0.8, 1.1)), time, 'perc');
      if (I > 0.62 && (s === 0 || s === 8 || (s === 11 && chance(0.25)))) this.note(softKick(s === 11 ? 0.6 : 0.9), time, 'perc');
      if ((s === 4 || s === 12) && chance(0.85)) this.note(woodblock(0.7, s === 4 ? 1 : 1.12), time, 'perc');
    }
    if (s === 14 && chance(0.3 * I)) this.note(glock(pick(notesIn(c.pcs, 84, 96)), 0.35), time, 'melody');
  }

  private rainStep(s: number, time: number): void {
    const c = this.chord;
    if (s === 0) this.note(bass(c.bass, 0.5, STEP * 12), time, 'bass');
    if (s === 8 && chance(0.4)) this.note(bass(c.bass + 7 > 47 ? c.bass - 5 : c.bass + 7, 0.45, STEP * 6), time, 'bass');
    if (s % 2 === 0 && chance(0.22)) this.note(marimba(pick(notesIn(c.pcs, 60, 77)), 0.5 * rand(0.8, 1)), time, 'keys');
    // Gotas: notas soltas lá no agudo.
    if (chance(0.085)) this.note(kalimba(pick(notesIn(PENTATONIC, 84, 96)), rand(0.25, 0.45)), time, 'keys');
  }

  private nightStep(s: number, time: number): void {
    const c = this.chord;
    if (s === 0 && this.barCount % 2 === 0) this.note(bass(c.bass, 0.5, STEP * 28), time, 'bass');
    if (s % 2 === 0 && chance(0.1)) this.note(celesta(pick(notesIn(safePcs(c), 72, 88)), rand(0.35, 0.6)), time, 'keys');
    // De vez em quando a caixinha de música desce o acorde.
    if (s === 0 && this.barCount % 4 === 0 && chance(0.55)) {
      notesIn(c.pcs, 72, 88)
        .slice(-4)
        .reverse()
        .forEach((m, i) => this.note(celesta(m, 0.5 - i * 0.06), time + i * STEP * 2, 'keys'));
    }
  }

  /** Nota do arpejo da marimba (a forma muda a cada compasso: sobe, desce, vai e volta ou solta). */
  private arpNote(i: number): number {
    const tones = notesIn(this.chord.pcs, 65, 84);
    const n = tones.length;
    const k = i + this.arpOffset;
    switch (this.arpShape) {
      case 0:
        return tones[k % n];
      case 1:
        return tones[n - 1 - (k % n)];
      case 2: {
        const cycle = 2 * n - 2;
        const j = k % cycle;
        return tones[j < n ? j : cycle - j];
      }
      default:
        return pick(tones);
    }
  }

  private melodyStep(s: number, time: number): void {
    const phrase = this.phrase;
    if (!this.phraseActive || !phrase || this.levels.melody < 0.05) return;
    const k = phrase.steps.indexOf((this.barCount % 2) * 16 + s);
    if (k < 0) return;
    const notes = notesIn(safePcs(this.chord), 72, 89);
    this.melodyIndex = clamp(this.melodyIndex + phrase.moves[k], 0, notes.length - 1);
    let note = notes[this.melodyIndex];
    // Última nota da frase pousa numa nota do acorde (a frase "fecha").
    if (k === phrase.steps.length - 1) {
      const chordTones = notesIn(this.chord.pcs, 72, 89);
      note = chordTones.reduce((best, m) => (Math.abs(m - note) < Math.abs(best - note) ? m : best), chordTones[0]);
    }
    this.note(kalimba(note, (k === 0 ? 0.75 : 0.6) * rand(0.9, 1.05)), time, 'melody');
  }

  private note(recipe: Recipe, time: number, layer: Layer): void {
    const via = this.layers?.[layer];
    if (via) this.engine.play(recipe, { bus: 'music', via, when: time, essential: true });
  }

  /** Recomeço: os pads que ainda soam somem em ~1 s (uma camada nova assume). */
  private releasePads(): void {
    const layers = this.layers;
    const ctx = this.engine.context;
    if (!layers || !ctx || !this.out) return;
    const old = layers.pad;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
    window.setTimeout(() => old.disconnect(), 2500);
    const fresh = new GainNode(ctx, { gain: this.levels.pad });
    fresh.connect(this.out);
    layers.pad = fresh;
  }
}

function newPhrase(): Phrase {
  const steps = pick(RHYTHMS);
  let sum = 0;
  const moves = steps.map(() => {
    // Passos pequenos, puxando de volta pro meio quando a frase se afasta demais.
    let move = pick([-2, -1, -1, 0, 1, 1, 2]);
    if (Math.abs(sum + move) > 3) move = -move;
    sum += move;
    return move;
  });
  return { steps, moves };
}
