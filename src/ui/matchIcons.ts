/**
 * Ícones da Disputa e dos times. Cada time tem cor E ícone (a cor nunca é a
 * única pista: daltônico reconhece pelo desenho). Mesmo traço dos ícones da
 * interface (arredondado, `currentColor`); os dos times são cheios, pra
 * ler bem pequenininhos em cima do besouro.
 */

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const solid = (paths: string) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths}</svg>`;

function sunRays(): string {
  let d = '';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = 12 + Math.cos(a) * 7.2;
    const y1 = 12 + Math.sin(a) * 7.2;
    const x2 = 12 + Math.cos(a) * 10;
    const y2 = 12 + Math.sin(a) * 10;
    d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}

function petals(): string {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    out += `<circle cx="${(12 + Math.cos(a) * 5.4).toFixed(2)}" cy="${(12 + Math.sin(a) * 5.4).toFixed(2)}" r="4"/>`;
  }
  return out;
}

/** Sol (time 0), Orvalho (time 1), Flor (time 2). */
export const TEAM_ICONS: readonly string[] = [
  `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.2" fill="currentColor"/><path d="${sunRays()}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  solid('<path d="M12 2.6c-.4.6-7 8-7 12.4a7 7 0 0 0 14 0c0-4.4-6.6-11.8-7-12.4z"/>'),
  `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">${petals()}</g><circle cx="12" cy="12" r="2.8" fill="#fff6e4"/></svg>`,
];

export const MatchIcons = {
  /** Relógio da Disputa. */
  timer: stroke('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4.2l2.6 1.6M9.5 2.8h5M12 2.8V6"/>'),
  /** Pôr do sol (último minuto, pontos em dobro). */
  sunset: stroke('<path d="M3 17h18M5.5 20.5h13"/><path d="M7 17a5 5 0 0 1 10 0"/><path d="M12 5.5v3M5.2 9.2l2 2M18.8 9.2l-2 2"/>'),
  /** Jardim livre (folha). */
  garden: stroke('<path d="M5 19c0-8 5.5-13.5 14-14 .5 8.5-5 14-13 14z"/><path d="M5 19l7-7"/>'),
  /** Disputa (bandeirinha). */
  match: stroke('<path d="M5.5 21V3.5"/><path d="M5.5 4.5h11.8l-2.6 4 2.6 4H5.5"/>'),
  /** Embaralhar os times. */
  shuffle: stroke('<path d="M3.5 7h3.2c3.5 0 4.6 10 8.1 10h5.7M17.5 14l3 3-3 3"/><path d="M3.5 17h3.2c1.4 0 2.4-1.6 3.2-3.4M13.2 10.4C14 8.6 15 7 16.5 7h4M17.5 4l3 3-3 3"/>'),
  /** Maior bola (destaque). */
  biggest: stroke('<circle cx="12" cy="13" r="7.5"/><path d="M8.2 10.6a4.6 4.6 0 0 1 3.2-2.4"/><path d="M12 2.5v2"/>'),
};
