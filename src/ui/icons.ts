/**
 * Ícones SVG inline (sem emoji na interface, sem biblioteca). Traço arredondado
 * e grosso, combinando com a massinha; a cor vem do `currentColor`.
 */

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const Icons = {
  ball: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="25" r="19" fill="#7b4c2a"/><circle cx="24" cy="25" r="19" fill="url(#hud-ball-shine)"/><defs><radialGradient id="hud-ball-shine" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#b17a47"/><stop offset="0.6" stop-color="#7b4c2a" stop-opacity="0"/></radialGradient></defs><circle cx="17" cy="19" r="3.2" fill="#9a6a3c"/><circle cx="30" cy="31" r="4" fill="#5b3820"/><path d="M12 30c4 2 6 1 9-1" stroke="#e6c46a" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  soundOn: stroke('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: stroke('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  menu: stroke('<path d="M9 6v12M15 6v12"/>', 2.8),
  grab: stroke('<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 17.2L4.3 13.8a1.5 1.5 0 0 1 2.6-1.5L8 14"/>'),
  jump: stroke('<path d="M12 19V6"/><path d="M6 11l6-6 6 6"/>', 2.4),
  recall: stroke('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><circle cx="12" cy="12" r="3"/>'),
  run: stroke('<path d="M5 12h10"/><path d="M11 6l6 6-6 6"/><path d="M19 6v12"/>', 2.4),
  trophy: stroke('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>'),
  /** Seta do marcador da toca (aponta para cima; o HUD gira). */
  pointer: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 11h-4.5v7h-5v-7H5z" fill="currentColor"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2c0-1 1.1-1.6 2-1.1l10.2 6.8c.8.5.8 1.7 0 2.2L10 19.9c-.9.5-2-.1-2-1.1z" fill="currentColor"/></svg>`,
  gear: stroke('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/><circle cx="12" cy="12" r="7.2"/>'),
  book: stroke('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/><path d="M9 8h7M9 12h5"/>'),
  close: stroke('<path d="M6 6l12 12M18 6L6 18"/>', 2.6),
  graphics: stroke('<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4"/><path d="M7 13l3-3 2.5 2.5L17 8"/>'),
  audio: stroke('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
  controls: stroke('<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11.5" r="0.6" fill="currentColor"/><circle cx="17.5" cy="13.5" r="0.6" fill="currentColor"/>'),
  globe: stroke('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>'),
  check: stroke('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.8),
  reset: stroke('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
};
