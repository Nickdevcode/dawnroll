/**
 * Kit de desenho dos ícones de massinha (24×24): contorno fino de tinta,
 * realce claro, cores chapadas. Usado pelas figurinhas do guarda-roupa, da
 * Feirinha e do passe.
 */

export const INK = 'rgba(58,42,34,0.55)';
export const EYE = '#2b2230';
export const CREASE = 'rgba(58,42,34,0.32)';

export const filled = (paths: string, extraClass = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"${extraClass ? ` class="${extraClass}"` : ''} stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

export const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const r2 = (value: number) => Math.round(value * 100) / 100;

/** Claridade (0..1) de uma cor #rrggbb: a média do canal mais forte com o mais fraco. */
export const lightness = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...c) + Math.min(...c)) / 510;
};

export const line = (d: string, color = CREASE, width = 1.1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

export const dots = (points: ReadonlyArray<readonly [number, number]>, r: number, fill: string) =>
  points.map(([x, y]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}" stroke="none"/>`).join('');

export const shine = (cx: number, cy: number, rx: number, ry: number, angle = 0, alpha = 0.45) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="rgba(255,255,255,${alpha})" stroke="none"${angle ? ` transform="rotate(${angle} ${cx} ${cy})"` : ''}/>`;

export const mirrored = (paths: string, cx = 12) => `${paths}<g transform="matrix(-1 0 0 1 ${cx * 2} 0)">${paths}</g>`;

/** Estrela de `count` pontas como caminho. */
export const starPath = (count: number, outer: number, inner: number, cx: number, cy: number, turn = -Math.PI / 2) =>
  Array.from({ length: count * 2 }, (_, i) => {
    const angle = turn + (i / (count * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner;
    return `${i === 0 ? 'M' : 'L'}${r2(cx + Math.cos(angle) * radius)} ${r2(cy + Math.sin(angle) * radius)}`;
  }).join('') + 'z';

/** Coração (ponta pra baixo) centrado em (cx, cy), com `w` de largura. */
export const heartPath = (cx: number, cy: number, w: number) => {
  const s = w / 2;
  return `M${r2(cx)} ${r2(cy + s * 0.9)}C${r2(cx - s * 0.4)} ${r2(cy + s * 0.55)} ${r2(cx - s)} ${r2(cy + s * 0.15)} ${r2(cx - s)} ${r2(cy - s * 0.3)}C${r2(cx - s)} ${r2(cy - s * 0.85)} ${r2(cx - s * 0.3)} ${r2(cy - s)} ${r2(cx)} ${r2(cy - s * 0.5)}C${r2(cx + s * 0.3)} ${r2(cy - s)} ${r2(cx + s)} ${r2(cy - s * 0.85)} ${r2(cx + s)} ${r2(cy - s * 0.3)}C${r2(cx + s)} ${r2(cy + s * 0.15)} ${r2(cx + s * 0.4)} ${r2(cy + s * 0.55)} ${r2(cx)} ${r2(cy + s * 0.9)}z`;
};

/** Florzinha de 5 pétalas (colar, coroa, chapéu de palha). */
export const flower = (cx: number, cy: number, r: number, petal: string, center: string) =>
  Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${r2(cx + Math.cos(a) * r * 0.62)}" cy="${r2(cy + Math.sin(a) * r * 0.62)}" r="${r2(r * 0.5)}" fill="${petal}"/>`;
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="${r2(r * 0.38)}" fill="${center}"/>`;

