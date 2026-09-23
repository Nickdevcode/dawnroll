/**
 * Onde desenhar um marcador de algo do mundo na tela: em cima da coisa quando
 * ela está visível, ou preso na borda (com a seta apontando pra ela) quando está
 * fora da tela ou atrás da câmera. Usado pelo marcador da toca e pelo Faro.
 */

/** Ponto do mundo já projetado (coordenadas normalizadas da câmera). */
export interface ProjectedPoint {
  /** -1..1 (esquerda → direita). */
  ndcX: number;
  /** -1..1 (baixo → cima). */
  ndcY: number;
  /** Atrás da câmera (a projeção vem espelhada). */
  behind: boolean;
}

/** Área útil da tela (px de cada borda que o marcador não invade). */
export interface ScreenMargins {
  top: number;
  bottom: number;
  side: number;
}

export interface MarkerPlacement {
  x: number;
  y: number;
  /** Rotação da seta em graus (180 = apontando pra baixo, em cima da coisa). */
  angle: number;
  onScreen: boolean;
}

export function placeMarker(point: ProjectedPoint, margins: ScreenMargins, width: number, height: number): MarkerPlacement {
  const { top, bottom, side } = margins;
  let x = (point.ndcX * 0.5 + 0.5) * width;
  let y = (-point.ndcY * 0.5 + 0.5) * height;
  const onScreen = !point.behind && x > side && x < width - side && y > top && y < height - bottom;
  if (onScreen) return { x, y, angle: 180, onScreen };

  // Direção a partir do centro da área útil; atrás da câmera, a projeção vem espelhada.
  const cx = width / 2;
  const cy = (top + height - bottom) / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (point.behind) {
    dx = -dx;
    dy = -dy;
  }
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const hx = width / 2 - side;
  const hy = (height - bottom - top) / 2;
  const k = Math.min(hx / Math.abs(dx || 1e-3), hy / Math.abs(dy || 1e-3));
  x = cx + dx * k;
  y = cy + dy * k;
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI + 90, onScreen };
}
