import { vary } from '../dsp';
import { burst, tone, type Recipe } from './kit';
import { celesta, glock, timpani, woodblock } from './instruments';

/**
 * Sons da economia: o baú (cai, chacoalha, estoura), as moedas tilintando, as
 * gotas de orvalho e a compra na Feirinha. Afinados com a trilha (Fá maior),
 * curtos e de brinquedo, como o resto da interface.
 */

/** Baú caindo no chão: pancada de madeira com um "tum" grave. */
export const chestLand: Recipe = (v) => {
  tone(v, { freq: 150, to: 70, glide: 0.1, gain: 0.34, attack: 0.002, decay: 0.28 });
  burst(v, { noise: 'brown', type: 'lowpass', freq: 700, gain: 0.5, attack: 0.002, decay: 0.12 });
  woodblock(0.8, 0.55)(v);
  return 0.35;
};

/** Chacoalhada: tem coisa lá dentro (madeira + moedinhas batendo). */
export const chestRattle: Recipe = (v) => {
  for (let i = 0; i < 3; i++) {
    woodblock(0.35, 0.7 + i * 0.05)({ ...v, t: v.t + i * 0.07 });
    tone(v, { freq: vary(3200, 0.08), gain: 0.02, decay: 0.05, delay: i * 0.07 + 0.02 });
  }
  return 0.3;
};

/** Estouro da tampa: sopro subindo + arpejo de sininhos (maior no baú mais raro). */
export const chestBurst = (rank: number): Recipe => (v) => {
  burst(v, { freq: 900, to: 6500, q: 0.8, gain: 0.34 + rank * 0.05, attack: 0.02, decay: 0.55 });
  const notes = [77, 81, 84, 89, 93, 96].slice(0, 3 + rank);
  notes.forEach((midi, i) => glock(midi, 0.55)({ ...v, t: v.t + 0.05 + i * 0.075 }));
  if (rank >= 2) timpani(41, 0.5 + rank * 0.1)(v);
  return 0.9 + rank * 0.1;
};

/** Moeda batendo no chão: tilim metálico (parciais inarmônicas). */
export const coinClink: Recipe = (v) => {
  const f = vary(2600, 0.1);
  tone(v, { freq: f, gain: 0.05, attack: 0.001, decay: 0.16 });
  tone(v, { freq: f * 2.76, gain: 0.02, attack: 0.001, decay: 0.09 });
  tone(v, { freq: f * 1.51, gain: 0.018, attack: 0.001, decay: 0.11 });
  return 0.2;
};

/** Gotas de orvalho saindo: duas notas altas de celesta. */
export const dewChime: Recipe = (v) => {
  celesta(96, 0.45)(v);
  return celesta(101, 0.35)({ ...v, t: v.t + 0.09 }) + 0.09;
};

/** Compra feita: cascata de moedas caindo no balcão. */
export const purchase: Recipe = (v) => {
  for (let i = 0; i < 4; i++) coinClink({ ...v, t: v.t + i * 0.06 });
  glock(84, 0.4)({ ...v, t: v.t + 0.2 });
  return glock(89, 0.4)({ ...v, t: v.t + 0.3 }) + 0.3;
};

/** Pegou um prêmio do passe: sininho subindo. */
export const passClaim: Recipe = (v) => {
  [81, 86, 89].forEach((midi, i) => glock(midi, 0.45)({ ...v, t: v.t + i * 0.07 }));
  return 0.5;
};
