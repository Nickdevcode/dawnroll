import type { AccessoryId } from '../progression/accessories';
import { INK, dots, filled, line, mirrored, r2, shine, starPath } from './iconKit';

/**
 * Figurinhas dos acessórios que vêm da economia: os da Feirinha, os do passe
 * Florada e os exclusivos de baú. Mesmo estilo das outras (`lookIcons.ts`).
 */

const GOLD = '#f2c14e';
const GOLD_DEEP = '#d9a232';

export const EconomyAccessoryIcons = {
  // --- Feirinha: cabeça --------------------------------------------------------------
  beret: filled(
    `<path d="M3.2 13.6c-.4-3.8 3.6-6.8 9-6.8 5.2 0 9 2.4 8.6 5.6-.3 2.4-3.6 3.6-8.6 3.6-5 0-8.8-.4-9-2.4z" fill="#d23a45"/>` +
      `<path d="M5 14.4c2 .8 4.6 1.2 7.2 1.2s5-.4 6.8-1.2l-.2 1.4c-1.8.8-4.2 1.2-6.6 1.2s-5.2-.4-7-1.2z" fill="#a82a35"/>` +
      `<path d="M12 7l.6-2.2" stroke="#a82a35" stroke-width="1.4"/>` +
      shine(8.6, 10, 1.6, 0.7, -15, 0.35),
  ),
  bucketHat: filled(
    `<path d="M2.6 17.4c1.6-2.2 4.8-3.2 9.4-3.2s7.8 1 9.4 3.2c-2.8 1-6 1.4-9.4 1.4s-6.6-.4-9.4-1.4z" fill="#b89f66"/>` +
      `<path d="M6.4 15c0-4.6 2.4-8 5.6-8s5.6 3.4 5.6 8c-1.6.6-3.6.8-5.6.8s-4-.2-5.6-.8z" fill="#c9b27a"/>` +
      line('M4.6 16.8c2.2.8 4.8 1.2 7.4 1.2s5.2-.4 7.4-1.2', 'rgba(90,70,30,0.45)', 0.7) +
      `<path d="M6.5 13.4c1.7.5 3.5.7 5.5.7s3.8-.2 5.5-.7v1.4c-1.7.5-3.5.7-5.5.7s-3.8-.2-5.5-.7z" fill="#7a6a44"/>`,
  ),
  pirateHat: filled(
    `<path d="M1.6 12.4c2.6 1 3.8 3.6 5 5.8 1.8-.8 3.4-1.2 5.4-1.2s3.6.4 5.4 1.2c1.2-2.2 2.4-4.8 5-5.8-2.6-.8-4.4-3.8-5.4-5.6-1.6.6-3.2 1-5 1s-3.4-.4-5-1c-1 1.8-2.8 4.8-5.4 5.6z" fill="#1f1c24"/>` +
      `<path d="M3 12.6c2 .9 3 2.8 4 4.6M21 12.6c-2 .9-3 2.8-4 4.6" fill="none" stroke="#e0b44a" stroke-width="1.1"/>` +
      `<circle cx="12" cy="11.6" r="2.2" fill="#f6f1e6"/><rect x="10.8" y="13" width="2.4" height="1.4" rx=".4" fill="#f6f1e6"/>` +
      dots([[11.2, 11.4], [12.8, 11.4]], 0.5, '#1f1c24') +
      `<path d="M9 15.6l6-2M9 13.6l6 2" stroke="#f6f1e6" stroke-width=".9"/>`,
  ),
  headphones: filled(
    `<path d="M4.4 14.6V12a7.6 7.6 0 0 1 15.2 0v2.6" fill="none" stroke="#2c2a33" stroke-width="2"/>` +
      `<rect x="2.4" y="12.4" width="4.6" height="7.4" rx="2.2" fill="#ff5f7e"/><rect x="17" y="12.4" width="4.6" height="7.4" rx="2.2" fill="#ff5f7e"/>` +
      `<rect x="5.6" y="13.4" width="2" height="5.4" rx="1" fill="#3a3642"/><rect x="16.4" y="13.4" width="2" height="5.4" rx="1" fill="#3a3642"/>` +
      `<circle cx="4.6" cy="14.4" r=".7" fill="#7dfcff" stroke="none" class="look-anim-pulse"/>` +
      shine(3.8, 16.4, 0.5, 1.6, 0, 0.45),
  ),
  unicornHorn: filled(
    `<defs><linearGradient id="uni-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb3d9"/><stop offset=".45" stop-color="#d6b8ff"/><stop offset=".8" stop-color="#a8e6ff"/><stop offset="1" stop-color="#f2c14e"/></linearGradient></defs>` +
      `<path d="M8.8 20.4 15.4 3.2 15.2 20.8c-2.2.8-4.4.6-6.4-.4z" fill="url(#uni-g)"/>` +
      line('M9.6 18.2c1.6.6 3.4.6 5.6.2M10.6 15.2c1.4.4 3 .4 4.6.2M11.6 12.2c1.2.4 2.4.4 3.6.1M12.6 9.2c.8.2 1.8.2 2.6.1', 'rgba(255,255,255,0.8)', 0.9) +
      `<ellipse cx="12" cy="20.6" rx="4.2" ry="1.4" fill="${GOLD}"/>` +
      `<path class="look-anim-twinkle" d="${starPath(4, 2, 0.5, 18.6, 8)}" fill="#fff1b0" stroke="none"/>` +
      `<path class="look-anim-twinkle look-anim-late" d="${starPath(4, 1.5, 0.4, 6, 11)}" fill="#fff1b0" stroke="none"/>`,
  ),
  // --- Feirinha: rosto ------------------------------------------------------------------
  clownNose: filled(`<circle cx="12" cy="12.6" r="7" fill="#e8252f"/>` + shine(9.4, 9.8, 2.2, 1.3, -30, 0.7) + `<circle cx="15.4" cy="16" r="1" fill="rgba(0,0,0,0.12)" stroke="none"/>`),
  eyepatch: filled(
    `<path d="M2.4 7.6 21.6 4.6M3 11.6l5 .4" fill="none" stroke="#1f1c24" stroke-width="1.4"/>` +
      `<path d="M8.4 9.6c0-2 2-2.8 4.6-2.8s4.6.8 4.6 2.8c0 3.6-2.2 7.2-4.6 7.2s-4.6-3.6-4.6-7.2z" fill="#1f1c24"/>` +
      `<circle cx="13" cy="9.2" r=".8" fill="#c9a24a"/>` +
      shine(11, 10.6, 0.6, 1.8, 10, 0.2),
  ),
  aviators: filled(
    `<defs><linearGradient id="avi-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3a1a"/><stop offset="1" stop-color="#e3a24a"/></linearGradient></defs>` +
      mirrored(`<path d="M2.6 9.4c0-1.2 1-1.8 2.2-1.8h5c1.2 0 1.8.8 1.6 2-.4 3.2-2 6.6-4.6 6.6S2.6 13.6 2.6 9.4z" fill="url(#avi-g)" stroke="#d9b44a" stroke-width="1"/>`) +
      `<path d="M9.6 8.6c1.6-.8 3.2-.8 4.8 0M7.6 7.4h8.8" fill="none" stroke="#d9b44a" stroke-width=".9"/>` +
      line('M4.4 10.8l2.6-2.2M15.4 10.8 18 8.6', 'rgba(255,255,255,0.7)', 0.8),
  ),
  pixelShades: filled(
    `<g stroke="none">` +
      `<rect x="2" y="8" width="20" height="2.2" fill="#141218"/>` +
      `<rect x="3" y="10.2" width="7.6" height="2.2" fill="#141218"/><rect x="13.4" y="10.2" width="7.6" height="2.2" fill="#141218"/>` +
      `<rect x="4.2" y="12.4" width="5.4" height="2.2" fill="#141218"/><rect x="14.6" y="12.4" width="5.4" height="2.2" fill="#141218"/>` +
      `<rect x="5.4" y="14.6" width="3" height="2.2" fill="#141218"/><rect x="15.8" y="14.6" width="3" height="2.2" fill="#141218"/>` +
      `<rect x="4.2" y="10.2" width="2.2" height="1.1" fill="#fbf6ee"/><rect x="14.6" y="10.2" width="2.2" height="1.1" fill="#fbf6ee"/>` +
      `</g>`,
  ),
  // --- Feirinha: pescoço -----------------------------------------------------------------
  tie: filled(
    `<path d="M4 4.6c2.6 1.4 5.2 2 8 2s5.4-.6 8-2" fill="none" stroke="#23305c" stroke-width="1.6"/>` +
      `<path d="M10.4 8.6h3.2l1.6 9.6-3.2 3.2-3.2-3.2z" fill="#23305c"/>` +
      `<path d="M9.8 11.8l4.6-1.6M9.4 15l5.6-2M10.2 18.2l4.8-1.8" stroke="#e8b640" stroke-width="1"/>` +
      `<path d="M10.2 6.4h3.6l-.6 2.6h-2.4z" fill="#2c3a6c"/>`,
  ),
  whistle: filled(
    `<path d="M4 4.4c2.4 1.6 5 2.4 8 2.4s5.6-.8 8-2.4" fill="none" stroke="#d8343a" stroke-width="1.4"/>` +
      `<circle cx="12" cy="9" r="1.2" fill="none" stroke="#9aa4ad" stroke-width="1"/>` +
      `<path d="M7 13.6a4.4 4.4 0 0 1 8.8 0v.4H22v3.2h-6.8a4.4 4.4 0 0 1-8.2-3.6z" fill="#c9ced6"/>` +
      `<circle cx="11.4" cy="14.4" r="1.4" fill="#2c2a33"/>` +
      shine(9.4, 12.6, 0.6, 1.2, 30, 0.6),
  ),
  pearls: filled(
    Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI * (0.05 + (i / 12) * 0.9);
      return `<circle cx="${r2(12 - Math.cos(a) * 8.4)}" cy="${r2(6 + Math.sin(a) * 9)}" r="1.4" fill="#f4ede4"/>`;
    }).join('') +
      `<circle cx="12" cy="18.8" r="2.4" fill="#f4ede4"/>` +
      shine(11.2, 18, 0.7, 0.9, -30, 0.8),
  ),
  goldChain: filled(
    `<path d="M3.6 4.2c2.4 3.8 5 5.6 8.4 5.6s6-1.8 8.4-5.6" fill="none" stroke="${GOLD_DEEP}" stroke-width="2.6" stroke-dasharray="1.6 .8"/>` +
      `<circle cx="12" cy="15.6" r="5.4" fill="${GOLD}"/>` +
      `<ellipse cx="12" cy="16.2" rx="2" ry="2.6" fill="${GOLD_DEEP}" stroke="none"/><circle cx="12" cy="13" r="1.1" fill="${GOLD_DEEP}" stroke="none"/>` +
      line('M9.6 15l-1.4-.8M9.6 17l-1.4.6M14.4 15l1.4-.8M14.4 17l1.4.6', GOLD_DEEP, 0.8) +
      shine(9.6, 13.4, 0.8, 1.6, 30, 0.5),
  ),
  // --- Feirinha: costas --------------------------------------------------------------------
  balloon: filled(
    `<path d="M12 16.4c.4 1.6-.8 2.4-.2 3.8s-.6 2-.4 2.8" fill="none" stroke="${INK}" stroke-width=".9"/>` +
      `<path d="M12 16c-3.6 0-6.2-3.4-6.2-7.2C5.8 5 8.6 2.4 12 2.4s6.2 2.6 6.2 6.4c0 3.8-2.6 7.2-6.2 7.2z" fill="#e8313b"/>` +
      `<path d="M11 16h2l-.4 1.2h-1.2z" fill="#c4222c"/>` +
      shine(9.4, 6.6, 1.1, 2.2, 25, 0.6),
  ),
  snailShell: filled(
    `<circle cx="12.4" cy="12.4" r="8.4" fill="#f1dcb0"/>` +
      line('M12.4 12.4c1.2 0 1.8-.9 1.8-1.9 0-1.4-1.3-2.4-2.8-2.4-2 0-3.4 1.7-3.4 3.8 0 2.7 2.2 4.6 4.8 4.6 3.3 0 5.8-2.6 5.8-5.9 0-3.8-3.2-6.8-7-6.8', '#b0692e', 1.9) +
      shine(8.4, 8.2, 1.2, 0.6, -40, 0.5),
  ),
  leafUmbrella: filled(
    `<path d="M12.4 22 12 11" fill="none" stroke="#4f8a34" stroke-width="1.6"/>` +
      `<path d="M1.8 11.4C3 5.6 7.2 2.6 12 2.6s9 3 10.2 8.8c-1.8-1-3.6-1.2-5.2-.4-1.4-1.2-3.2-1.6-5-1.6s-3.6.4-5 1.6c-1.6-.8-3.4-.6-5.2.4z" fill="#5fae3f"/>` +
      line('M12 2.8V10M12 5l-4.6 3.2M12 5l4.6 3.2M12 7.6l-7.2 2.8M12 7.6l7.2 2.8', '#a6d86a', 0.8),
  ),
  guitar: filled(
    `<path d="M16.2 2.6l2.2 2.2-5.6 5.6-2.2-2.2z" fill="#5a3a22"/>` +
      `<path d="M17.6 1.6l3.2 3.2-1.4 1.4-3.2-3.2z" fill="#3a2418"/>` +
      `<path d="M10.6 8.2c1.2 1.2 1 2.6.2 3.4 1.8.4 3 2.2 2.4 4.4-.8 3-4.2 5-7 4.2-2.8-.8-3.6-3.8-2.2-6.4.9-1.6 2.4-2.4 3.8-2.2-.2-1.2.6-2.6 1.8-3 .5-.2 .9-.4 1-.4z" fill="#8a4318" stroke="#f3e6c9" stroke-width=".5"/>` +
      `<ellipse cx="8.4" cy="14.6" rx="3.4" ry="3.9" transform="rotate(45 8.4 14.6)" fill="#e39a45"/>` +
      `<ellipse cx="8.4" cy="14.4" rx="2" ry="2.4" transform="rotate(45 8.4 14.4)" fill="#f4c46a"/>` +
      `<circle cx="9.6" cy="13.2" r="1.5" fill="#2f7a5c"/><circle cx="9.6" cy="13.2" r="1.05" fill="#1c110b"/>` +
      `<path d="M5.4 17.4l1.4 1.4" stroke="#2a160c" stroke-width="1.1" stroke-linecap="round"/>` +
      line('M5.8 18.2 17 6.4', '#ece7dc', 0.45),
  ),
  dragonflyWings: filled(
    mirrored(
      `<path d="M11 10.4C8.2 8.6 4.4 6.8 2 7.4c-.8 1.2 1.4 2.8 4 3.4 2 .4 3.6.2 5 0z" fill="#9fe8f2"/>` +
        `<path d="M11 12.4c-2.8.6-6.6 2.2-8.2 4 .2 1.4 2.8.8 4.8-.4 1.4-.8 2.6-2 3.4-3.6z" fill="#c3a6ff"/>` +
        line('M11 10.4C8 9.4 5 8.4 2.6 8M11 12.6c-2.6 1-5.4 2.4-7.6 3.6', 'rgba(43,58,82,0.45)', 0.6) +
        dots([[2.8, 7.6]], 0.6, '#2b3a52'),
    ) + `<path d="M12 7.6v9" stroke="#2b3a52" stroke-width="1.6"/>`,
  ),
  // --- Temporada Florada ---------------------------------------------------------------------
  sprout: filled(
    `<ellipse cx="12" cy="20.4" rx="5.2" ry="1.8" fill="#7b4c2a"/>` +
      `<path d="M12 20V11" fill="none" stroke="#5aa33c" stroke-width="1.6"/>` +
      `<path d="M12 11.4C10.6 7.4 6.4 5.6 3.4 7c1 3.6 4.8 5.6 8.6 4.4z" fill="#7cc84e"/>` +
      `<path d="M12 11c1.2-4 5.4-6 8.6-4.6-1 3.6-4.8 5.8-8.6 4.6z" fill="#7cc84e"/>` +
      line('M11.6 11C9.6 9 7.4 8 5.2 7.6M12.4 10.8c2-2 4.2-3 6.4-3.4', '#4f8f30', 0.7),
  ),
  mushroomCap: filled(
    `<path d="M2.4 15.4C2.4 8.8 6.8 4.4 12 4.4s9.6 4.4 9.6 11c-2.8 1.4-6 2-9.6 2s-6.8-.6-9.6-2z" fill="#e0362f"/>` +
      `<path d="M4.6 16.2c2.2.8 4.6 1.2 7.4 1.2s5.2-.4 7.4-1.2v1.4c-2.2.9-4.6 1.4-7.4 1.4s-5.2-.5-7.4-1.4z" fill="#f1e3c4"/>` +
      dots([[7.2, 11], [12, 7.4], [16.8, 11], [9.8, 14], [14.4, 13.6], [5, 14.2], [19, 14.2]], 1.1, '#fbf6ee') +
      shine(8, 8, 1.4, 0.6, -35, 0.35),
  ),
  daisyGlasses: filled(
    mirrored(
      Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return `<ellipse cx="${r2(6.6 + Math.cos(a) * 3.6)}" cy="${r2(12 + Math.sin(a) * 3.6)}" rx="1.5" ry=".8" fill="#fdfaf3" transform="rotate(${r2((a * 180) / Math.PI)} ${r2(6.6 + Math.cos(a) * 3.6)} ${r2(12 + Math.sin(a) * 3.6)})"/>`;
      }).join('') + `<circle cx="6.6" cy="12" r="2.6" fill="#ffd84a"/>`,
    ) + `<path d="M9.8 11c1.4-.8 3-.8 4.4 0" fill="none" stroke="#5aa33c" stroke-width="1.1"/>`,
  ),
  petalCollar: filled(
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const x = 12 + Math.cos(a) * 6.6;
      const y = 12.6 + Math.sin(a) * 5.4;
      return `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="3" ry="1.6" fill="${i % 2 ? '#ff9fc4' : '#ffc2d8'}" transform="rotate(${r2((a * 180) / Math.PI)} ${r2(x)} ${r2(y)})"/>`;
    }).join('') + `<ellipse cx="12" cy="12.6" rx="4.4" ry="3.4" fill="#f2b62e"/>` + dots([[10.6, 11.8], [12.6, 11.4], [13.6, 13], [11.4, 13.6]], 0.5, '#c98a1e'),
  ),
  kite: filled(
    `<path d="M4 22c2-3 4.6-5.4 7.4-7" fill="none" stroke="${INK}" stroke-width=".8"/>` +
      `<path d="M14.4 2.4 11.2 9.6l3.2 1.6z" fill="#ff5f7e"/><path d="M14.4 2.4l6.4 5.2-6.4 3.6z" fill="#ffd54a"/>` +
      `<path d="M11.2 9.6l3.2 1.6-2.8 4.6z" fill="#4fb6ff"/><path d="M14.4 11.2l6.4-3.6-9.2 8.2z" fill="#7ee07b"/>` +
      `<path d="M11.6 15.8c-.6 1.4.4 2.4-.4 3.6" fill="none" stroke="${INK}" stroke-width=".7"/>` +
      `<path d="M10.2 17.2l1.2.6-1.2.6zM12.6 17.2l-1.2.6 1.2.6z" fill="#ff5f7e" stroke="none"/>`,
  ),
  // --- Só em baú ------------------------------------------------------------------------------------
  frogHat: filled(
    `<path d="M2.4 18c1.6-1.8 5-2.8 9.6-2.8s8 1 9.6 2.8c-2.8 1-6 1.4-9.6 1.4s-6.8-.4-9.6-1.4z" fill="#5aad3a"/>` +
      `<path d="M5.6 16.4c0-4.4 2.6-7.4 6.4-7.4s6.4 3 6.4 7.4c-1.8.6-4 .9-6.4.9s-4.6-.3-6.4-.9z" fill="#6cc24a"/>` +
      `<circle cx="8.6" cy="8.8" r="3" fill="#6cc24a"/><circle cx="15.4" cy="8.8" r="3" fill="#6cc24a"/>` +
      `<circle cx="8.6" cy="8.4" r="1.9" fill="#fbf6ee" stroke="none"/><circle cx="15.4" cy="8.4" r="1.9" fill="#fbf6ee" stroke="none"/>` +
      dots([[8.8, 8.6], [15.6, 8.6]], 0.9, '#1f1c24') +
      `<path d="M10 13.6c1.2 1 2.8 1 4 0" fill="none" stroke="#2f5a1c" stroke-width=".9"/>` +
      dots([[7.4, 13.2], [16.6, 13.2]], 0.9, '#ff9fb3'),
  ),
  ufo: filled(
    `<path d="M9.8 20.6 12 14.4l2.2 6.2" fill="rgba(125,252,255,0.25)" stroke="none"/>` +
      `<path d="M8 10.6a4 4 0 0 1 8 0" fill="rgba(191,239,255,0.6)"/>` +
      `<circle cx="12" cy="9.6" r="1.6" fill="#8fe36b" stroke="none"/>` +
      `<ellipse cx="12" cy="12" rx="9.6" ry="2.8" fill="#b9c3d1"/>` +
      `<ellipse cx="12" cy="11.4" rx="5.4" ry="1.2" fill="#7e8a9c" stroke="none"/>` +
      `<g stroke="none" class="look-anim-pulse">${dots([[5, 12.4], [9, 13.6], [15, 13.6], [19, 12.4]], 0.8, '#ffe36b')}</g>`,
  ),
  cyberVisor: filled(
    `<path d="M2.2 10.4c3-1.6 6.2-2.4 9.8-2.4s6.8.8 9.8 2.4v3.6c-3-1.4-6.2-2.2-9.8-2.2s-6.8.8-9.8 2.2z" fill="#1a1830"/>` +
      `<path d="M4 11.6c2.6-1 5.2-1.4 8-1.4" fill="none" stroke="#35f2ff" stroke-width="1.2" class="look-anim-sweep"/>` +
      line('M2.4 10.4c3-1.6 6.2-2.4 9.6-2.4s6.6.8 9.6 2.4', '#c9d2e0', 0.8),
  ),
  scarabAmulet: filled(
    `<path d="M3 3.6c2.4 3.4 5.4 5 9 5s6.6-1.6 9-5" fill="none" stroke="#2a4fb8" stroke-width="2.6"/>` +
      `<path d="M3 3.6c2.4 3.4 5.4 5 9 5s6.6-1.6 9-5" fill="none" stroke="${GOLD}" stroke-width="1" stroke-dasharray="1.4 1.4"/>` +
      mirrored(`<path d="M11 15.4c-2.4-1-5-1-7.2.4 1.6 1.6 4.4 2.2 7.2 1.2z" fill="#2a4fb8"/><path d="M11 17.4c-2-.2-3.8.6-5 1.8 1.6.8 3.4.4 5-.6z" fill="${GOLD}"/>`) +
      `<ellipse cx="12" cy="16.2" rx="2.4" ry="3.4" fill="${GOLD}"/><circle cx="12" cy="11.8" r="1.4" fill="${GOLD}"/>` +
      `<circle cx="12" cy="9.4" r="1.6" fill="#ff8a4a" stroke="${GOLD}" stroke-width=".6" class="look-anim-pulse"/>`,
  ),
  angelWings: filled(
    mirrored(
      `<path d="M11 13C9.6 8.4 6.6 4.8 2.6 3.6 2 7.4 3.4 12 7 14.6c1.4 1 2.8 1.2 4 .6z" fill="#fbf8f2"/>` +
        `<path d="M4 6.4c.8 3 2.4 5.6 4.6 7.2M3.2 9.6c1 2 2.4 3.6 4 4.6" fill="none" stroke="#efe4cf" stroke-width=".9"/>` +
        `<path d="M2.6 3.6c-.4 1 .2 2 .6 2.6" fill="none" stroke="#f6cf5a" stroke-width="1.2"/>`,
    ) + `<path class="look-anim-twinkle" d="${starPath(4, 1.6, 0.4, 12, 6)}" fill="#fff4c2" stroke="none"/>`,
  ),
} satisfies Partial<Record<AccessoryId, string>>;
