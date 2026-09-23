/**
 * Cor "de gente" de uma coisa que grudou na bola (pedidos do tipo "grude 3
 * coisas vermelhas" e a conquista da bola arco-íris). Recebe matiz,
 * saturação e luminosidade já em sRGB (0..1) e devolve uma família de cor.
 */

export type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'white' | 'brown' | 'gray';

/** Famílias que contam pra arco-íris e pros pedidos (marrom e cinza são "cor de chão"). */
export const RAINBOW_HUES: readonly Hue[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white'];

/** Famílias que os pedidos de cor sorteiam (as que o jardim tem bastante). */
export const REQUEST_HUES: readonly Hue[] = ['red', 'yellow', 'white', 'green', 'pink', 'blue', 'purple'];

export function classifyHue(h: number, s: number, l: number): Hue {
  if (l > 0.86 || (l > 0.74 && s < 0.3)) return 'white';
  if (s < 0.16) return l > 0.74 ? 'white' : 'gray';
  const deg = (((h % 1) + 1) % 1) * 360;
  // Laranja/amarelo escuro é marrom (tronco, bolota, bolacha).
  if (deg >= 10 && deg < 50 && l < 0.4) return 'brown';
  if (deg < 12 || deg >= 345) return l > 0.72 ? 'pink' : 'red';
  if (deg < 40) return 'orange';
  if (deg < 68) return 'yellow';
  if (deg < 168) return 'green';
  if (deg < 250) return 'blue';
  if (deg < 292) return 'purple';
  return 'pink';
}
