import type { CatalogShape } from '../progression/catalog';
import type { PerkId } from '../progression/perks';

/**
 * Ícones do jogo em si: figurinhas do catálogo (preenchidas, com a cor de cada
 * uma via `currentColor`) e os poderes (traço, como os ícones da interface).
 * Os de interface pura (fechar, engrenagem...) moram em `icons.ts`.
 */

const INK = 'rgba(58,42,34,0.55)';
const CREAM = '#fff4de';

const filled = (paths: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const petals = (count: number, rx: number, ry: number, distance: number, fill: string) =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i * 360) / count;
    return `<ellipse cx="12" cy="${12 - distance}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${angle} 12 12)"/>`;
  }).join('');

const mushroomCap = (dots: boolean) =>
  `<path d="M10 13.5h4l.6 6.2a1.2 1.2 0 0 1-1.2 1.3h-2.8a1.2 1.2 0 0 1-1.2-1.3z" fill="${CREAM}"/>` +
  `<path d="M3.2 13.6C3.2 8.5 7.1 4.5 12 4.5s8.8 4 8.8 9.1c0 .6-.5 1-1.1 1H4.3c-.6 0-1.1-.4-1.1-1z" fill="currentColor"/>` +
  (dots ? `<g fill="${CREAM}" stroke="none"><circle cx="8.3" cy="9.6" r="1.3"/><circle cx="13.2" cy="7.6" r="1.1"/><circle cx="16.2" cy="11" r="1.2"/><circle cx="11.4" cy="11.6" r=".9"/></g>` : '');

export const CatalogIcons: Record<CatalogShape, string> = {
  dung: filled(
    `<path d="M3.5 18.2c0-1.7 1.7-2.9 3.8-3.1-.4-1.9 1.1-3.4 3.3-3.5-.3-1.9 1-3.6 3.4-4.3-.3 1.4.6 2.6 1.9 3 .2 1.7-.8 2.9-2 3.3 2.2.3 3.6 1.6 3.3 3.4 1.5.4 2.6 1.4 2.6 2.7 0 1.6-3.4 2.3-8.1 2.3s-8.2-.7-8.2-2.3z" fill="currentColor"/>` +
      `<path d="M8 15.3c2.1.8 5.1.8 7.4-.1M10.2 11.8c1.4.5 3.2.5 4.5-.2" fill="none" stroke="rgba(255,240,210,0.6)" stroke-width="1.2"/>`,
  ),
  daisy: filled(`${petals(10, 2, 4.2, 5.4, 'currentColor')}<circle cx="12" cy="12" r="3.1" fill="#f2c230"/>`),
  tulip: filled(
    `<path d="M12 14v8" stroke="#5f9a3e" stroke-width="1.8"/>` +
      `<path d="M6.2 6.5c0 5.2 2.2 8.5 5.8 8.5s5.8-3.3 5.8-8.5l-2.9 2.4L12 4.2 9.1 8.9z" fill="currentColor"/>`,
  ),
  bell: filled(
    `<path d="M12 2.5v3" stroke="#5f9a3e" stroke-width="1.8"/>` +
      `<path d="M7.6 10c0-2.6 2-4.6 4.4-4.6s4.4 2 4.4 4.6c0 3.4 1.1 5.8 3 7.6.4.4.1 1-.4 1H5c-.5 0-.8-.6-.4-1 1.9-1.8 3-4.2 3-7.6z" fill="currentColor"/>` +
      `<circle cx="12" cy="20.3" r="1.4" fill="#f2c230"/>`,
  ),
  dandelion: filled(`${petals(14, 1.3, 3.6, 5.6, 'currentColor')}${petals(8, 1.2, 2.4, 2.8, '#f7d765')}<circle cx="12" cy="12" r="1.8" fill="#e9a91c"/>`),
  cloverFlower: filled(
    `<circle cx="12" cy="11" r="6.8" fill="currentColor"/>` +
      `<g fill="rgba(255,255,255,0.45)" stroke="none"><circle cx="9.3" cy="8.8" r="1.2"/><circle cx="12.6" cy="7.4" r="1"/><circle cx="14.8" cy="10.2" r="1.1"/><circle cx="10.6" cy="12.4" r="1"/><circle cx="13.8" cy="13.6" r=".9"/></g>` +
      `<path d="M7.5 17.5c1.6 1.2 3 1.8 4.5 1.8s2.9-.6 4.5-1.8" fill="none" stroke="#5f9a3e" stroke-width="1.8"/>`,
  ),
  mushroomDots: filled(mushroomCap(true)),
  mushroom: filled(mushroomCap(false)),
  rock: filled(
    `<path d="M3.5 17.5 5.6 9.8 10.4 5.5l6.2 1.3 3.9 5.4-1 6.3-6.6 2.2-7.4-.4z" fill="currentColor"/>` +
      `<path d="M10.4 5.5 11.8 11l4.8 1M11.8 11l-5.4 2" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.1"/>`,
  ),
  log: filled(
    `<path d="M5 7.5h12.5a3.5 4.5 0 0 1 0 9H5z" fill="currentColor"/>` +
      `<ellipse cx="5" cy="12" rx="3.5" ry="4.5" fill="#e3b98a"/>` +
      `<ellipse cx="5" cy="12" rx="1.7" ry="2.3" fill="none" stroke="#b07a4c" stroke-width="1"/>` +
      `<path d="M10 9.5h5M12 14.5h4" fill="none" stroke="rgba(58,42,34,0.35)" stroke-width="1.1"/>`,
  ),
  pebble: filled(`<path d="M4 14.2c0-3.6 3.4-6.4 7.8-6.4 4.6 0 8.2 2.5 8.2 5.7 0 3.3-3.4 5.3-8 5.3S4 17.3 4 14.2z" fill="currentColor"/><ellipse cx="9.2" cy="11.6" rx="2.2" ry="1.1" fill="rgba(255,255,255,0.45)" stroke="none"/>`),
  twig: filled(
    `<path d="M4 19.5 18.8 5" fill="none" stroke="currentColor" stroke-width="2.6"/>` +
      `<path d="M10.5 13.2c.2-2.6 1.4-4.3 3.6-5.2" fill="none" stroke="currentColor" stroke-width="1.8"/>` +
      `<circle cx="14.3" cy="7.9" r="1.3" fill="#9fcf6a"/>`,
  ),
  leaf: filled(
    `<path d="M4.5 19.5C4.5 10.5 10 4.5 20 4.5c0 9.5-5.8 15-15.5 15z" fill="currentColor"/>` +
      `<path d="M5.5 18.5 15.5 8.5M9.2 14.9l-.6-3.6M12.4 11.7l3.1.3" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.1"/>`,
  ),
  berry: filled(
    `<circle cx="12" cy="13.5" r="6.5" fill="currentColor"/>` +
      `<path d="M12 7.2 9.4 5.4M12 7.2l2.8-1.6M12 7.2V4" fill="none" stroke="#3f6b2f" stroke-width="1.6"/>` +
      `<circle cx="9.6" cy="11.3" r="1.5" fill="rgba(255,255,255,0.5)" stroke="none"/>`,
  ),
  seed: filled(
    `<path d="M12 3.5c3.3 3 5 6.7 5 10.4 0 3.8-2.2 6.6-5 6.6s-5-2.8-5-6.6c0-3.7 1.7-7.4 5-10.4z" fill="currentColor"/>` +
      `<path d="M9.3 9.5c.3 3.5.3 6.7 0 9.2M12 5.5v14.8M14.7 9.5c-.3 3.5-.3 6.7 0 9.2" fill="none" stroke="#f1e6cf" stroke-width="1"/>`,
  ),
  acorn: filled(
    `<path d="M7 11.5h10c0 5.2-2.3 9-5 9s-5-3.8-5-9z" fill="currentColor"/>` +
      `<path d="M5.3 11.5c0-3.2 3-5.5 6.7-5.5s6.7 2.3 6.7 5.5z" fill="#7a5533"/>` +
      `<path d="M12 6V3.4" fill="none" stroke="#6a4a2e" stroke-width="1.6"/>`,
  ),
  clover: filled(
    `<path d="M12 12.5V21" fill="none" stroke="#5f9a3e" stroke-width="1.7"/>` +
      `<g fill="currentColor"><path d="M12 12c-3.2-.1-5.7-1.7-5.7-4.2a2.6 2.6 0 0 1 5.2-.4 2.6 2.6 0 0 1 .5 4.6z"/><path d="M12 12c3.2-.1 5.7-1.7 5.7-4.2a2.6 2.6 0 0 0-5.2-.4 2.6 2.6 0 0 0-.5 4.6z"/><path d="M12 12c-1.8 2.6-1.7 5.6.4 6.9a2.6 2.6 0 0 0 2.9-4.3A2.6 2.6 0 0 0 12 12z"/></g>`,
  ),
  petal: filled(
    `<path d="M12 21c-4.2-2.6-6.5-6.4-6.5-10.2C5.5 6.6 8.4 3.5 12 3.5s6.5 3.1 6.5 7.3C18.5 14.6 16.2 18.4 12 21z" fill="currentColor"/>` +
      `<path d="M12 19V8" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.1"/>`,
  ),
  shell: filled(
    `<circle cx="12" cy="12.5" r="8" fill="currentColor"/>` +
      `<path d="M12 12.5a1.6 1.6 0 1 1 1.6 1.6 3.2 3.2 0 1 1-3.2-3.2 4.8 4.8 0 1 1 4.8 4.8 6.4 6.4 0 0 1-6.4-6.4" fill="none" stroke="rgba(90,55,29,0.6)" stroke-width="1.2"/>`,
  ),
  cap: filled(
    `<path d="${Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 === 0 ? 8.6 : 7.6;
      return `${i === 0 ? 'M' : 'L'}${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`;
    }).join('')}z" fill="currentColor"/>` + `<circle cx="12" cy="12" r="4.6" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.3"/>`,
  ),
  pillbug: filled(
    `<path d="M3.5 14.5c0-4.2 3.8-7.5 8.5-7.5s8.5 3.3 8.5 7.5c0 1.2-.9 2-2 2H5.5c-1.1 0-2-.8-2-2z" fill="currentColor"/>` +
      `<path d="M8 7.9v8.6M12 7v9.5M16 7.9v8.6" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.1"/>` +
      `<path d="M4.5 12.5 2.4 10.4M5.3 11 4 8.3" fill="none" stroke="${INK}" stroke-width="1.2"/>`,
  ),
};

export const PerkIcons: Record<PerkId, string> = {
  sticky: stroke('<circle cx="12" cy="13" r="5"/><path d="M4.5 8.5a9 9 0 0 1 3-3.4M19.5 8.5a9 9 0 0 0-3-3.4M3 14a9 9 0 0 0 1.4 4.3M21 14a9 9 0 0 1-1.4 4.3"/>'),
  hotBlood: stroke('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.3 3.7-8.3.9 1.7 1.8 2.6 3 3.2.2-2.8 1.4-5 3.2-6.7.2 3.7 3.1 6 3.1 10.4 0 4.2-2.8 7.6-6.5 7.6z"/><path d="M12 21c-1.7 0-2.8-1.1-2.8-2.8 0-1.9 1.6-2.8 2.4-4.6 1.6 1.4 3.2 2.5 3.2 4.6 0 1.7-1.1 2.8-2.8 2.8z"/>'),
  mudShell: stroke('<path d="M12 3.2 19.5 6v5.7c0 4.6-3.2 8-7.5 9.3-4.3-1.3-7.5-4.7-7.5-9.3V6z"/><path d="M12 8.2c1.9 2.3 2.9 3.9 2.9 5.2a2.9 2.9 0 0 1-5.8 0c0-1.3 1-2.9 2.9-5.2z"/>'),
  nose: stroke('<path d="M4 20.5h16"/><path d="M7 20.5c0-2.6 2.2-4.2 5-4.2s5 1.6 5 4.2"/><path d="M8.5 12.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/><path d="M12 11.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/><path d="M15.5 12.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/>'),
  sneaky: stroke('<circle cx="16.5" cy="13.5" r="4.5"/><path d="M3 10h6M2 14h5M4 18h6"/>'),
  horned: stroke('<path d="M4 20c1.2-5.5 4.3-9 8.4-10.6C15.3 8.3 17.4 6.4 18.5 3c1.8 3.9 1.6 8.4-.8 11.5-2 2.6-5.3 3.8-8.7 3.3"/><path d="M8 20h12"/>'),
};

export const GameIcons = {
  burrow: stroke('<path d="M2.5 20h19"/><path d="M4 20c1.2-4.8 4.3-7.8 8-7.8s6.8 3 8 7.8"/><ellipse cx="12" cy="19.2" rx="3.2" ry="1.9" fill="currentColor"/><path d="M12 12.2V4l4.6 2.1L12 8.2"/>'),
  pantry: stroke('<circle cx="7.5" cy="15.5" r="4"/><circle cx="16.5" cy="15.5" r="4"/><circle cx="12" cy="8" r="4"/>'),
  catalog: stroke('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  sparkle: stroke('<path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z"/><path d="M19 16.5c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3z"/>'),
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>`,
  lock: stroke('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  food: stroke('<path d="M4 13h16a8 8 0 0 1-16 0z"/><path d="M8.5 9.5c0-1.5 1-2 1-3.5M12 9.5c0-1.5 1-2 1-3.5M15.5 9.5c0-1.5 1-2 1-3.5"/>'),
};
