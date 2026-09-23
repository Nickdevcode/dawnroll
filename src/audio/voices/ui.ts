import { vary } from '../dsp';
import { burst, tone, type Recipe } from './kit';
import { glock } from './instruments';

/**
 * Sons da interface: baixinhos, curtos e "de madeira", afinados com a trilha
 * (Fá maior). Servem de confirmação, não de enfeite — ninguém deve cansar deles.
 */

/** Mouse passando por cima de um botão. */
export const uiHover: Recipe = (v) => tone(v, { freq: vary(1850, 0.03), gain: 0.022, attack: 0.002, decay: 0.03 });

/** Foco andando pelo teclado ou pelo controle. */
export const uiFocus: Recipe = (v) => {
  tone(v, { freq: 1320, gain: 0.03, decay: 0.04 });
  return tone(v, { freq: 2640, gain: 0.007, decay: 0.02 });
};

/** Clique genérico: "toc" de madeirinha. */
export const uiClick: Recipe = (v) => {
  tone(v, { freq: 720, to: 610, gain: 0.1, attack: 0.001, decay: 0.05 });
  tone(v, { freq: 1454, gain: 0.025, decay: 0.03 });
  return burst(v, { freq: 2200, q: 1.5, gain: 0.22, decay: 0.006 });
};

/** Chave liga/desliga: duas notas subindo (ligou) ou descendo (desligou). */
export const uiToggle = (on: boolean): Recipe => (v) => {
  const [a, b] = on ? [659.25, 987.77] : [880, 587.33];
  tone(v, { freq: a, gain: 0.08, decay: 0.06 });
  tone(v, { type: 'triangle', freq: b, gain: 0.06, decay: 0.09, delay: 0.055, lowpass: 3000 });
  return 0.16;
};

/** Escolheu uma opção (qualidade, idioma...). */
export const uiSelect: Recipe = (v) => {
  tone(v, { freq: 1174.66, gain: 0.07, decay: 0.12 });
  return tone(v, { freq: 1174.66 * 5.4, gain: 0.008, attack: 0.001, decay: 0.04 });
};

/** Trocou de aba: folha virando + nota. */
export const uiTab: Recipe = (v) => {
  burst(v, { noise: 'pink', freq: 1800, q: 1, gain: 0.22, attack: 0.01, decay: 0.05 });
  return tone(v, { freq: 880, gain: 0.06, decay: 0.07 });
};

/** Arrastando um slider: tique que sobe de tom com o valor (0..1). */
export const uiSlider = (value: number): Recipe => (v) => tone(v, { freq: 420 + value * 900, gain: 0.07, attack: 0.001, decay: 0.03 });

/** Placa (configurações / como jogar) abrindo ou fechando: papel deslizando + duas notas. */
export const uiSheet = (open: boolean): Recipe => (v) => {
  burst(v, { noise: 'pink', freq: open ? 500 : 2400, to: open ? 2400 : 500, q: 0.8, gain: 0.3, attack: 0.05, decay: 0.16 });
  tone(v, { freq: open ? 587.33 : 880, gain: 0.045, decay: 0.08, delay: 0.02 });
  return tone(v, { freq: open ? 880 : 587.33, gain: 0.045, decay: 0.12, delay: 0.09 });
};

/** Voltar ao padrão: três notas descendo. */
export const uiReset: Recipe = (v) => {
  [1174.66, 880, 659.25].forEach((freq, i) => tone(v, { freq, gain: 0.055, decay: 0.07, delay: i * 0.06 }));
  return 0.3;
};

/** Aviso (controle conectado): sininho de duas notas. */
export const uiNotify: Recipe = (v) => {
  glock(81, 0.45)(v);
  return glock(88, 0.4)({ ...v, t: v.t + 0.11 }) + 0.11;
};
