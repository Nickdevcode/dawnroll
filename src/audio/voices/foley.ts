import type { PickableKind } from '../../world/scenery/context';
import type { DebrisMaterial } from '../../world/Collectibles';
import type { CatalogId } from '../../progression/catalog';
import { clamp } from '../../utils/math';
import { rand, vary } from '../dsp';
import { bubble, burst, chain, filter, glide, louder, noise, osc, perc, swell, tone, tremolo, type Recipe, type Voice } from './kit';

/**
 * Foley do jogo: tudo que o besouro e a bola fazem no mundo. O tom geral é
 * "massinha molhada": contatos macios, graves arredondados, pouco estalo seco.
 * Cada receita varia um pouco a cada vez (altura, filtro, trecho do ruído).
 */

/** Chão sob os pés/bola, do jeito que o som enxerga. */
export type Surface = 'grass' | 'dirt' | 'mud' | 'water' | 'hard';

/** Montinho de bosta virando bola: tapa molhado, "splorch" que assenta e uma bolhinha. `size` 0..1. */
export const squish = (size: number): Recipe => (v) => {
  const s = clamp(size, 0, 1);
  const p = vary(1, 0.08);
  burst(v, { freq: 2600 * p, q: 0.8, gain: 0.9, decay: 0.03 });
  const end = burst(v, { noise: 'pink', freq: (1300 - s * 550) * p, to: (330 - s * 120) * p, q: 2.2, gain: 2.4, attack: 0.006, decay: 0.2 + s * 0.08 });
  tone(v, { freq: (165 - s * 70) * p, to: 55, gain: 0.32 + s * 0.14, decay: 0.16 + s * 0.06 });
  bubble(v, rand(260, 420) * (1.2 - s * 0.4), 0.09, 0.05);
  return end;
};

/**
 * Item grudando na bola (Katamari): cada material tem o seu contato — pedrinha
 * faz "toc", graveto estala, folha farfalha, tampinha tilinta. Por baixo de
 * todos, o "tuc" macio do item afundando na bosta.
 */
export const stick = (material: DebrisMaterial, size: number): Recipe => (voice) => {
  const v = louder(voice, 1.8);
  const k = clamp(size, 0.2, 1);
  const p = vary(1, 0.06) * (1.25 - k * 0.45);
  tone(v, { freq: 230 * p, to: 120 * p, gain: 0.14, decay: 0.05 });
  switch (material) {
    case 'pebble':
      tone(v, { freq: 2300 * p, gain: 0.1, decay: 0.045 });
      tone(v, { freq: 3650 * p, gain: 0.06, decay: 0.03 });
      burst(v, { freq: 3200 * p, q: 3, gain: 0.8, decay: 0.012 });
      tone(v, { freq: 175 * p, to: 115 * p, gain: 0.18, decay: 0.06 });
      return 0.1;
    case 'twig':
      burst(v, { type: 'highpass', freq: 1800, gain: 0.7, decay: 0.012 });
      burst(v, { type: 'highpass', freq: 2400, gain: 0.35, decay: 0.01, delay: 0.02 });
      burst(v, { noise: 'pink', freq: 900 * p, q: 7, gain: 2.6, decay: 0.07 });
      return 0.12;
    case 'leaf':
    case 'petal':
    case 'clover':
    case 'fourLeaf': {
      const soft = material === 'petal' ? 0.6 : material === 'leaf' ? 1 : 0.8;
      burst(v, { noise: 'crackle', freq: 4200, q: 0.8, gain: 0.5 * soft, attack: 0.01, decay: 0.12, rate: 1.6 });
      return burst(v, { freq: 6000, q: 1.5, gain: 0.35 * soft, attack: 0.008, decay: 0.08 });
    }
    case 'berry':
      tone(v, { freq: 680 * p, to: 210 * p, gain: 0.2, decay: 0.05 });
      burst(v, { noise: 'pink', freq: 1300, q: 2, gain: 1.4, decay: 0.05 });
      bubble(v, 500 * p, 0.07, 0.015);
      return 0.12;
    case 'seed':
      tone(v, { freq: 1450 * p, gain: 0.1, decay: 0.03 });
      tone(v, { type: 'triangle', freq: 900 * p, gain: 0.07, decay: 0.04, lowpass: 3000 });
      burst(v, { freq: 2600, q: 2, gain: 0.5, decay: 0.008 });
      return 0.08;
    case 'acorn':
      tone(v, { freq: 620 * p, gain: 0.18, decay: 0.08 });
      tone(v, { freq: 1310 * p, gain: 0.07, decay: 0.05 });
      burst(v, { freq: 2000, q: 2, gain: 0.6, decay: 0.01 });
      return 0.12;
    case 'shell':
      // Cerâmica: parciais inarmônicos que tilintam um pouco.
      [2750, 4180, 6320].forEach((f, i) => tone(v, { freq: f * p, gain: [0.07, 0.045, 0.028][i], attack: 0.001, decay: [0.25, 0.16, 0.1][i] }));
      burst(v, { freq: 3400, q: 2, gain: 0.4, decay: 0.008 });
      return 0.3;
    case 'cap':
    case 'coin':
    case 'clip': {
      // Metal: "tiiing" brilhante, com batimento entre dois parciais quase iguais. A moeda
      // (disco grosso) soa mais grave e demora mais; o clipe (arame fino), agudo e curtinho.
      const pitch = material === 'coin' ? 0.7 : material === 'clip' ? 1.3 : 1;
      const ring = material === 'coin' ? 1.25 : material === 'clip' ? 0.45 : 1;
      const level = material === 'clip' ? 0.75 : 1;
      [2960, 2972, 5110, 7870, 10950].forEach((f, i) =>
        tone(v, { freq: f * p * pitch, gain: [0.05, 0.04, 0.045, 0.03, 0.018][i] * level, attack: 0.001, decay: [0.55, 0.5, 0.35, 0.22, 0.15][i] * ring }),
      );
      burst(v, { type: 'highpass', freq: 4000 * pitch, gain: 0.35 * level, decay: 0.006 });
      return 0.6 * ring;
    }
    case 'marble':
      // Vidro: "clink" puro e curto, com um quiquezinho logo depois.
      [0, 0.065].forEach((d, k) =>
        [3900, 6150, 9800].forEach((f, i) => tone(v, { freq: f * p, gain: [0.07, 0.04, 0.02][i] * (k ? 0.45 : 1), attack: 0.001, decay: [0.12, 0.08, 0.05][i], delay: d })),
      );
      burst(v, { type: 'highpass', freq: 5000, gain: 0.25, decay: 0.004 });
      return 0.25;
    case 'brick':
    case 'die':
      // Plástico duro: "clack" seco; o dado ainda dá uma quicadinha.
      burst(v, { freq: 2100 * p, q: 2.5, gain: 1.1, decay: 0.018 });
      tone(v, { freq: 950 * p, gain: 0.08, decay: 0.03 });
      if (material === 'die') {
        burst(v, { freq: 2500 * p, q: 2.5, gain: 0.5, decay: 0.014, delay: 0.05 });
        tone(v, { freq: 1100 * p, gain: 0.035, decay: 0.02, delay: 0.05 });
      }
      return 0.1;
    case 'button':
      // Botão: "tic" de plástico pequeno, mais agudo que a pecinha de montar.
      burst(v, { freq: 3100 * p, q: 3, gain: 0.8, decay: 0.012 });
      tone(v, { freq: 1500 * p, gain: 0.06, decay: 0.02 });
      return 0.08;
    case 'jellybean':
    case 'grape':
      // Macio e úmido: a uva ainda "estoura" uma bolhinha de suco.
      tone(v, { freq: 520 * p, to: 180 * p, gain: 0.16, decay: 0.06 });
      burst(v, { noise: 'pink', freq: 1100, q: 1.8, gain: 1.2, decay: 0.06 });
      if (material === 'grape') bubble(v, 420 * p, 0.06, 0.012);
      return 0.12;
    case 'sugarCube':
      // Crocante: grãos de açúcar esfarelando.
      burst(v, { noise: 'crackle', freq: 2600, q: 0.9, gain: 0.75, attack: 0.003, decay: 0.09, rate: 1.8 });
      burst(v, { freq: 4200, q: 1.5, gain: 0.35, decay: 0.03 });
      return 0.12;
    case 'popcorn':
      // Crocante leve e oco.
      burst(v, { noise: 'crackle', freq: 3400, q: 1, gain: 0.45, attack: 0.003, decay: 0.06, rate: 2.2 });
      tone(v, { freq: 700 * p, to: 500 * p, gain: 0.05, decay: 0.03 });
      return 0.09;
    case 'cicadaShell':
      // Casquinha seca: estalinho de papel.
      burst(v, { noise: 'crackle', type: 'highpass', freq: 3000, gain: 0.45, attack: 0.004, decay: 0.07, rate: 2 });
      burst(v, { freq: 5200, q: 2, gain: 0.25, decay: 0.02, delay: 0.015 });
      [0, 0.025].forEach((d) => tone(v, { freq: vary(2400, 0.1), gain: 0.03, decay: 0.01, delay: d }));
      return 0.1;
    case 'pillbug':
      // Tatuzinho enrolado: tique-tique de casquinha rolando.
      [0, 0.032, 0.058].forEach((d, i) => tone(v, { freq: vary(3000, 0.1), gain: 0.05 - i * 0.012, decay: 0.012, delay: d }));
      tone(v, { freq: 900, to: 1400, gain: 0.03, decay: 0.05, delay: 0.02 });
      return 0.12;
  }
};

/** Coisa arrancada do chão: raízes arrebentando, terra soltando, e o som de cada tipo. */
export const pluck = (kind: PickableKind, size: number): Recipe => (v) => {
  const s = clamp(size / 3, 0, 1);
  const p = vary(1, 0.07);
  burst(v, { noise: 'crackle', freq: (2000 - s * 900) * p, q: 1.1, gain: 0.8 + s * 0.4, attack: 0.008, decay: 0.22 + s * 0.12, rate: 1.3 });
  burst(v, { noise: 'brown', type: 'lowpass', freq: 520 - s * 200, gain: 0.55 + s * 0.4, attack: 0.01, decay: 0.25 + s * 0.15 });
  // Voando até a bola: sopro subindo.
  burst(v, { freq: 500, to: 2200, q: 1.4, gain: 0.3, attack: 0.08, decay: 0.2, delay: 0.04 });
  switch (kind) {
    case 'flower':
      burst(v, { type: 'highpass', freq: 3200, gain: 0.5, decay: 0.012, delay: 0.01 });
      burst(v, { freq: 5200, q: 0.9, gain: 0.35, attack: 0.02, decay: 0.18, delay: 0.02 });
      tone(v, { freq: 700 * p, to: 380 * p, gain: 0.1, decay: 0.07 });
      return 0.5;
    case 'mushroom':
      // Borrachudo: "fuóm" com um guinchinho.
      tone(v, { type: 'triangle', freq: 420 * p, to: 820 * p, glide: 0.06, gain: 0.16, decay: 0.12, lowpass: 2200 });
      tone(v, { freq: 260 * p, to: 140 * p, gain: 0.28, decay: 0.14 });
      bubble(v, 380 * p, 0.1, 0.06);
      return 0.5;
    case 'rock': {
      // Pedra raspando (ruído com "trepidação") e caindo pesada.
      const scrape = noise(v, 'pink', 0, 0.4);
      chain(scrape, filter(v, 'bandpass', 650 * p, 3), tremolo(v, 22, 0.4, 0, 0.4, 'sawtooth'), perc(v, 1.8, 0.03, 0.35), v.out);
      tone(v, { freq: (110 - s * 40) * p, to: 42, gain: 0.45, decay: 0.35 + s * 0.2, delay: 0.05 });
      burst(v, { noise: 'crackle', freq: 1400, q: 0.8, gain: 0.6, decay: 0.2, delay: 0.06, rate: 0.8 });
      return 0.7;
    }
    case 'log': {
      // Madeira rangendo, o estalo, a madeira ressoando e o baque surdo.
      const creak = osc(v, 'sawtooth', 58 * p, 0, 0.36);
      glide(creak.frequency, v.t, 52 * p, 74 * p, 0.34);
      chain(creak, filter(v, 'bandpass', 480 * p, 9), perc(v, 1.1, 0.06, 0.3), v.out);
      burst(v, { type: 'highpass', freq: 2400, gain: 0.8, decay: 0.02, delay: 0.12 });
      burst(v, { noise: 'pink', freq: 900 * p, q: 6, gain: 2, decay: 0.12, delay: 0.12 });
      tone(v, { freq: 85 * p, to: 38, gain: 0.5, decay: 0.45, delay: 0.14 });
      return 0.8;
    }
    case 'object':
      // Coisa de gente (brinquedo, vaso, ferramenta): "toc" oco de plástico/cerâmica
      // que engrossa com o tamanho, e o baque no chão logo depois.
      tone(v, { freq: (900 - s * 520) * p, to: (620 - s * 360) * p, gain: 0.22, decay: 0.07 + s * 0.08 });
      tone(v, { freq: (1830 - s * 900) * p, gain: 0.07, decay: 0.05 + s * 0.04 });
      burst(v, { freq: (2400 - s * 900) * p, q: 3, gain: 0.8, decay: 0.02 });
      tone(v, { freq: (140 - s * 70) * p, to: 45, gain: 0.3 + s * 0.2, decay: 0.2 + s * 0.2, delay: 0.03 });
      return 0.5 + s * 0.2;
  }
};

/**
 * Bicho grudando na bola: por baixo, o mesmo "tuc" do item afundando; por cima,
 * o corpo de cada um — quitina faz tiquezinhos (a lacraia, muitos), lagarta e
 * lesma fazem "squelch", o bicho-pau estala como graveto. O tatuzinho (e quem
 * não tiver som próprio) é o tique-tique de casquinha rolando.
 */
export const critterStick = (id: CatalogId): Recipe => (voice) => {
  const v = louder(voice, 1.8);
  const p = vary(1, 0.06);
  switch (id) {
    case 'caterpillar':
    case 'slug':
      tone(v, { freq: 230 * p, to: 120 * p, gain: 0.12, decay: 0.05 });
      burst(v, { noise: 'pink', freq: 900 * p, to: 420 * p, q: 2.2, gain: 1.3, attack: 0.008, decay: 0.12 });
      bubble(v, 380 * p, 0.06, 0.03);
      if (id === 'slug') bubble(v, 290 * p, 0.05, 0.07);
      return 0.16;
    case 'stickInsect':
      tone(v, { freq: 230 * p, to: 120 * p, gain: 0.12, decay: 0.05 });
      burst(v, { type: 'highpass', freq: 2200, gain: 0.6, decay: 0.01 });
      tone(v, { freq: 1250 * p, gain: 0.09, decay: 0.035 });
      tone(v, { type: 'triangle', freq: 780 * p, gain: 0.05, decay: 0.05, lowpass: 2500 });
      return 0.1;
    case 'earwig':
    case 'centipede':
    case 'leafBeetle':
    case 'flyingAnt': {
      tone(v, { freq: 230 * p, to: 120 * p, gain: 0.12, decay: 0.05 });
      const pitch = id === 'centipede' ? 3000 : id === 'earwig' ? 3400 : id === 'leafBeetle' ? 3800 : 4200;
      const ticks = id === 'centipede' ? 5 : 2;
      for (let i = 0; i < ticks; i++) tone(v, { freq: vary(pitch, 0.1), gain: 0.045 - i * 0.006, decay: 0.012, delay: i * 0.022 });
      burst(v, { freq: pitch * 1.4, q: 2, gain: 0.3, decay: 0.01 });
      return 0.06 + ticks * 0.022;
    }
    default:
      return stick('pillbug', 0.4)(voice);
  }
};

/** Bola batendo no chão: "tum" de massa macia (bola grande = mais grave) com terra espirrando. */
export const thud = (strength: number, radius: number): Recipe => (v) => {
  const k = clamp(radius / 3, 0, 1);
  const s = clamp(strength, 0, 1);
  const base = vary(125 - k * 70, 0.05);
  tone(v, { freq: base, to: base * 0.45, gain: 0.25 + s * 0.4, attack: 0.003, decay: 0.18 + k * 0.2 });
  burst(v, { noise: 'brown', type: 'lowpass', freq: 520 - k * 200, gain: 0.6 + s * 0.7, decay: 0.12 + k * 0.1 });
  burst(v, { noise: 'pink', freq: 950 - k * 300, q: 1, gain: 0.5 + s * 1.1, decay: 0.07 });
  burst(v, { noise: 'crackle', freq: 2400, q: 0.9, gain: 0.25 + s * 0.45, decay: 0.18, rate: 1.2, delay: 0.01 });
  return 0.45;
};

/** Pulo: "hop" elástico e o "brrr" dos élitros abrindo. */
export const jump: Recipe = (voice) => {
  const v = louder(voice, 1.6);
  const p = vary(1, 0.05);
  tone(v, { type: 'triangle', freq: 290 * p, to: 640 * p, glide: 0.09, gain: 0.12, decay: 0.12, lowpass: 2400 });
  const wings = noise(v, 'white', 0, 0.15);
  chain(wings, filter(v, 'bandpass', 1900, 1.8), tremolo(v, 42, 0.45, 0, 0.15, 'square'), perc(v, 0.9, 0.01, 0.13), v.out);
  burst(v, { type: 'highpass', freq: 2600, gain: 0.2, attack: 0.02, decay: 0.08 });
  return 0.2;
};

/** Textura do chão (passos, pouso). `level` ~1 = passo andando. */
function surfaceHit(voice: Voice, surface: Surface, level: number): number {
  const v = louder(voice, 2.5);
  switch (surface) {
    case 'grass':
      return Math.max(
        burst(v, { freq: vary(3600, 0.15), q: 0.9, gain: 0.22 * level, attack: 0.004, decay: 0.045 }),
        burst(v, { type: 'highpass', freq: 6500, gain: 0.07 * level, decay: 0.008 }),
      );
    case 'dirt':
      return Math.max(
        burst(v, { noise: 'crackle', freq: vary(2100, 0.15), q: 1, gain: 0.4 * level, decay: 0.05, rate: 1.4 }),
        tone(v, { freq: vary(320, 0.1), gain: 0.035 * level, decay: 0.02 }),
      );
    case 'mud':
      return Math.max(
        burst(v, { noise: 'pink', freq: vary(760, 0.12), to: 420, q: 2.5, gain: 0.6 * level, decay: 0.07 }),
        bubble(v, rand(500, 800), 0.03 * level, 0.02),
      );
    case 'water':
      return Math.max(
        burst(v, { freq: vary(2400, 0.2), q: 1, gain: 0.35 * level, decay: 0.06 }),
        bubble(v, rand(700, 1300), 0.05 * level, 0.01),
      );
    case 'hard':
      return Math.max(
        burst(v, { type: 'highpass', freq: 3800, gain: 0.12 * level, decay: 0.006 }),
        tone(v, { freq: vary(1700, 0.12), gain: 0.03 * level, decay: 0.018 }),
      );
  }
}

/** Passinho de pata de massinha. */
export const footstep = (surface: Surface, level: number): Recipe => (v) => surfaceHit(v, surface, level);

/** Pouso depois do pulo: "tup" com o chão respondendo. */
export const land = (strength: number, surface: Surface): Recipe => (v) => {
  const s = clamp(strength, 0, 1);
  tone(v, { freq: 170, to: 80, gain: 0.16 + s * 0.22, decay: 0.09 + s * 0.05 });
  surfaceHit(v, surface, 1.6 + s * 1.2);
  return 0.25;
};

/** Agarrou a bola: "tchk" grudento. */
export const grab: Recipe = (voice) => {
  const v = louder(voice, 1.6);
  burst(v, { noise: 'pink', freq: 1500, q: 2.5, gain: 1.3, decay: 0.03 });
  tone(v, { freq: 340, to: 250, gain: 0.1, decay: 0.06 });
  bubble(v, 520, 0.045, 0.02);
  return 0.12;
};

/** Soltou a bola: descolando. */
export const release: Recipe = (voice) => {
  const v = louder(voice, 1.5);
  tone(v, { freq: 210, to: 480, gain: 0.07, decay: 0.05 });
  burst(v, { noise: 'pink', freq: 1100, q: 2, gain: 0.6, decay: 0.03 });
  return 0.1;
};

/** Patinhas escorregando no esforço de empurrar. */
export const scrape: Recipe = (v) => burst(louder(v, 5), { noise: 'crackle', freq: vary(1800, 0.2), q: 1, gain: 0.3, attack: 0.01, decay: 0.08, rate: 1.6 });

/** "Tchibum": respingo, corpo d'água, bolhas e gotas caindo de volta. `size` 0..1. */
export const splash = (size: number): Recipe => (v) => {
  const s = clamp(size, 0, 1);
  const end = burst(v, { freq: 2100 - s * 900, to: 900 - s * 400, q: 0.7, gain: 1.1 + s * 1.1, attack: 0.004, decay: 0.28 + s * 0.25 });
  burst(v, { noise: 'pink', type: 'lowpass', freq: 900 - s * 300, gain: 0.45 + s * 0.55, attack: 0.006, decay: 0.3 + s * 0.2 });
  const bubbles = 3 + Math.round(s * 4);
  for (let i = 0; i < bubbles; i++) bubble(v, rand(380, 1300) * (1.15 - s * 0.5), rand(0.04, 0.09), rand(0.03, 0.3));
  for (let i = 0; i < 4; i++) tone(v, { freq: rand(2200, 4200), gain: rand(0.012, 0.03), decay: 0.025, delay: rand(0.12, 0.45) });
  return Math.max(end, 0.5);
};

/** Bolinha de ar escapando (bola derretendo, item afundando). */
export const fizz: Recipe = (v) => bubble(louder(v, 2.5), rand(900, 2300), rand(0.02, 0.045));

/** Coisa que soltou da bola e caiu na água. */
export const shed: Recipe = (voice) => {
  const v = louder(voice, 2);
  bubble(v, vary(620, 0.2), 0.07);
  return burst(v, { freq: 2600, q: 1, gain: 0.3, decay: 0.05 });
};

/** Torrão de terra sendo cavado (enterro). */
export const dig = (strength: number): Recipe => (voice) => {
  const v = louder(voice, 1.4);
  const s = clamp(strength, 0, 1);
  burst(v, { noise: 'crackle', type: 'lowpass', freq: 1600, gain: 0.35 + s * 0.3, attack: 0.01, decay: rand(0.12, 0.2), rate: vary(0.9, 0.2) });
  return burst(v, { noise: 'brown', type: 'lowpass', freq: 380, gain: 0.3 + s * 0.3, decay: 0.09 });
};

/** A toca engolindo a bola: "shlooop" de sucção, ronco de terra e bolhas de ar. */
export const burialStart = (radius: number): Recipe => (v) => {
  const k = clamp(radius / 3, 0, 1);
  const src = noise(v, 'pink', 0, 0.8);
  const f = filter(v, 'bandpass', 280, 2.4);
  f.frequency.setValueAtTime(280, v.t);
  f.frequency.exponentialRampToValueAtTime(1500 - k * 500, v.t + 0.3);
  f.frequency.exponentialRampToValueAtTime(180, v.t + 0.72);
  chain(src, f, swell(v, 1.8, 0.12, 0.35, 0.35), v.out);
  tone(v, { freq: 95 - k * 30, to: 48, gain: 0.32, attack: 0.05, decay: 0.7 });
  bubble(v, 170, 0.16, 0.28);
  bubble(v, 240, 0.1, 0.4);
  return 0.85;
};

/** A terra fechando sobre a bola: baque fundo e terra escorrendo. */
export const earthClose = (radius: number): Recipe => (v) => {
  const k = clamp(radius / 3, 0, 1);
  tone(v, { freq: 78 - k * 20, to: 36, gain: 0.5, attack: 0.005, decay: 0.55 });
  burst(v, { noise: 'brown', type: 'lowpass', freq: 260, gain: 0.9, decay: 0.5 });
  burst(v, { noise: 'crackle', type: 'lowpass', freq: 2200, gain: 0.35, attack: 0.05, decay: 0.9, rate: 0.7, delay: 0.08 });
  return 1;
};

/** Bola chamada de volta (R): some com um sopro e reaparece com um "plop". */
export const recall: Recipe = (voice) => {
  const v = louder(voice, 1.8);
  burst(v, { freq: 3200, to: 500, q: 1.2, gain: 0.55, attack: 0.06, decay: 0.2 });
  tone(v, { freq: 300, to: 760, gain: 0.12, decay: 0.07, delay: 0.2 });
  bubble(v, 600, 0.05, 0.22);
  return 0.32;
};

/** Bola nova brotando do chão (rodada nova). */
export const sprout: Recipe = (v) => {
  tone(v, { freq: 240, to: 720, glide: 0.16, gain: 0.18, attack: 0.01, decay: 0.2 });
  tone(v, { type: 'triangle', freq: 480, to: 1440, glide: 0.16, gain: 0.05, attack: 0.01, decay: 0.18, lowpass: 3000 });
  burst(v, { noise: 'pink', freq: 900, q: 2, gain: 0.7, decay: 0.08 });
  return 0.25;
};
