import type { Currency, Rarity } from '../progression/unlocks';
import { dots, filled, line, shine, starPath, stroke } from './iconKit';

/**
 * Ícones da economia, no mesmo estilo de massinha das figurinhas: a moeda (de
 * barro dourado com o solzinho), a gota de orvalho, os quatro baús (madeira,
 * prata, cristal e o do Sol), a Feirinha e o passe da temporada.
 */

const COIN = filled(
  `<circle cx="12" cy="12" r="9.4" fill="#e9a83a"/>` +
    `<circle cx="12" cy="12" r="7.4" fill="#ffcf5a"/>` +
    `<circle cx="12" cy="12" r="3.2" fill="#f2a93b" stroke="none"/>` +
    line('M12 5.9v1.6M12 16.5v1.6M5.9 12h1.6M16.5 12h1.6M7.7 7.7l1.1 1.1M15.2 15.2l1.1 1.1M7.7 16.3l1.1-1.1M15.2 8.8l1.1-1.1', '#c9801f', 1.1) +
    shine(8.6, 8.2, 1.8, 0.9, -35, 0.6),
);

const DEW = filled(
  `<defs><linearGradient id="dew-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6fbff"/><stop offset=".55" stop-color="#7fd8ff"/><stop offset="1" stop-color="#5a8cff"/></linearGradient></defs>` +
    `<path d="M12 2.6c3.6 4.6 6.4 8.4 6.4 12a6.4 6.4 0 0 1-12.8 0c0-3.6 2.8-7.4 6.4-12z" fill="url(#dew-g)"/>` +
    `<path d="M9 13.8c-.4 1.8.4 3.6 2 4.4" fill="none" stroke="#fff" stroke-width="1.3" opacity=".85"/>` +
    `<path d="${starPath(4, 2.2, 0.5, 17.6, 5.6)}" fill="#fff4c2" stroke="none"/>`,
);

export const CurrencyIcons: Record<Currency, string> = { coins: COIN, dew: DEW };

/** Cores de cada baú: madeira, prata, cristal e o do Sol. */
const CHEST_STYLE: Record<Rarity, { body: string; lid: string; band: string; lock: string; gem?: string }> = {
  common: { body: '#b0703a', lid: '#c9844a', band: '#7a4a28', lock: '#e2b44a' },
  rare: { body: '#8fa1b8', lid: '#b7c6d8', band: '#5f6f86', lock: '#eef3f8' },
  epic: { body: '#7a4fd6', lid: '#9b72ee', band: '#4b2f96', lock: '#e8dbff', gem: '#6ff0ff' },
  legendary: { body: '#f2a93b', lid: '#ffcf5a', band: '#c9701f', lock: '#fff4c2', gem: '#ff7a3d' },
};

function chest(rarity: Rarity): string {
  const s = CHEST_STYLE[rarity];
  const gem = s.gem ? `<circle cx="12" cy="10.4" r="1.4" fill="${s.gem}"/>` : '';
  const sun =
    rarity === 'legendary'
      ? `<g class="look-anim-twinkle"><path d="${starPath(8, 2.6, 1.4, 19.4, 4.6)}" fill="#fff4c2" stroke="none"/></g>`
      : rarity === 'epic'
        ? `<path class="look-anim-twinkle" d="${starPath(4, 1.8, 0.45, 19, 5)}" fill="#e8dbff" stroke="none"/>`
        : '';
  return filled(
    `<path d="M3.4 11.6h17.2v7.6c0 1-.8 1.8-1.8 1.8H5.2c-1 0-1.8-.8-1.8-1.8z" fill="${s.body}"/>` +
      `<path d="M3.4 11.6c0-3.6 1.8-5.8 4.6-5.8h8c2.8 0 4.6 2.2 4.6 5.8z" fill="${s.lid}"/>` +
      `<path d="M3.4 11.6h17.2v1.6H3.4z" fill="${s.band}"/>` +
      `<path d="M6.4 5.9v15M17.6 5.9v15" stroke="${s.band}" stroke-width="1.6"/>` +
      `<rect x="10.2" y="11.2" width="3.6" height="4.4" rx="1" fill="${s.lock}"/>` +
      gem +
      dots([[12, 14.2]], 0.55, s.band) +
      shine(8.4, 8.2, 1.6, 0.7, -20, 0.45) +
      sun,
  );
}

export const ChestIcons: Record<Rarity, string> = {
  common: chest('common'),
  rare: chest('rare'),
  epic: chest('epic'),
  legendary: chest('legendary'),
};

/** Baú de traço (aba dos baús; segue a cor do texto). */
export const ChestTabIcon = stroke('<path d="M3.5 11h17v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 11c0-3.6 1.9-5.8 4.8-5.8h7.4c2.9 0 4.8 2.2 4.8 5.8"/><path d="M10.4 11h3.2v3.6h-3.2z"/>');

/** Barraquinha da Feirinha (o botão do menu). */
export const ShopIcon = stroke('<path d="M4 10.5V20h16v-9.5"/><path d="M2.8 10.5 4.5 4h15l1.7 6.5"/><path d="M2.8 10.5a2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0"/><path d="M9.5 20v-5h5v5"/>');

/** Florzinha do passe da temporada (o botão do menu e o selo). */
export const PassIcon = stroke('<circle cx="12" cy="10" r="2.4"/><path d="M12 7.6c-1-2.6.2-4.4 0-4.4s1 1.8 0 4.4M14.4 10c2.6-1 4.4.2 4.4 0s-1.8 1-4.4 0M12 12.4c1 2.6-.2 4.4 0 4.4s-1-1.8 0-4.4M9.6 10c-2.6 1-4.4-.2-4.4 0s1.8-1 4.4 0"/><path d="M12 12.6V21M12 17.2c1.6-1.8 3.6-2.2 5-1.6-.6 1.8-2.6 2.6-5 1.6z"/>');

/** A flor da temporada Florada, colorida (cabeçalho do painel do passe). */
export const FloradaArt = filled(
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360;
    return `<ellipse cx="12" cy="6" rx="2.6" ry="4.2" fill="${i % 2 ? '#ff9fc4' : '#ffc2d8'}" transform="rotate(${a} 12 11.4)"/>`;
  }).join('') +
    `<circle cx="12" cy="11.4" r="3.4" fill="#f2b62e"/>` +
    dots([[11, 10.6], [12.8, 10.4], [12.4, 12.4], [10.8, 12.2]], 0.5, '#c98a1e'),
);
