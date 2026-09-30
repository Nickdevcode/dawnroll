/**
 * Ícones da roda de reações do online (na ordem da roda: `emote.0` .. `emote.7`).
 * Mesmo traço dos ícones da interface (arredondado, cor do `currentColor`).
 */

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const EMOTE_ICONS: readonly string[] = [
  // Bora! (raio)
  stroke('<path d="M13.5 2.8 5 13.2h6.2L10.3 21.2 19 10.6h-6.2z"/>'),
  // Me ajuda! (boia)
  stroke('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.4"/><path d="M6.2 6.2l3.4 3.4M14.4 14.4l3.4 3.4M17.8 6.2l-3.4 3.4M9.6 14.4l-3.4 3.4"/>'),
  // Rouba! (mão pegando a bola)
  stroke('<circle cx="17" cy="7" r="3.4"/><path d="M4 20.5v-5.2c0-1.4 1.1-2.5 2.5-2.5h4.8l3.2-2.3a1.5 1.5 0 0 1 1.9 2.3l-3.4 3.2H9.5"/><path d="M4 17.5h8.5l5.2-3.4a1.5 1.5 0 0 1 1.8 2.4L13 21H4"/>'),
  // Valeu! (coração)
  stroke('<path d="M12 20.2S3.8 15.4 3.8 9.4A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 8.2 2.2c0 6-8.2 10.8-8.2 10.8z"/>'),
  // Haha (rindo)
  stroke('<circle cx="12" cy="12" r="8.8"/><path d="M7.6 10.2l1.6-1.3 1.6 1.3M13.2 10.2l1.6-1.3 1.6 1.3"/><path d="M7.5 13.6h9a4.5 4.5 0 0 1-9 0z"/>'),
  // Ops (sem graça, com gotinha)
  stroke('<circle cx="11.5" cy="12.5" r="8.3"/><circle cx="8.6" cy="11" r="0.4" fill="currentColor"/><circle cx="14.4" cy="11" r="0.4" fill="currentColor"/><path d="M8.6 16.2c1-.8 1.9-.8 2.9 0s1.9.8 2.9 0"/><path d="M19.6 3.2s-1.6 2-1.6 3a1.6 1.6 0 0 0 3.2 0c0-1-1.6-3-1.6-3z"/>'),
  // GG (joinha)
  stroke('<path d="M7.5 10.5V20H4.8a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z"/><path d="M7.5 10.5l3.6-6.3a1.9 1.9 0 0 1 3.4 1.6l-1.1 3.6h5a2 2 0 0 1 2 2.4l-1.3 6.4a2.2 2.2 0 0 1-2.2 1.8H7.5"/>'),
  // Aqui! (alfinete de mapa)
  stroke('<path d="M12 21.2s-6.4-5.8-6.4-10.6a6.4 6.4 0 0 1 12.8 0c0 4.8-6.4 10.6-6.4 10.6z"/><circle cx="12" cy="10.4" r="2.3"/>'),
];

/**
 * Ícone do botão da roda (balão de fala), do botão de fundir (duas bolas virando
 * uma) e do botão de puxar (ímã puxando a bolinha do rival).
 */
export const EmoteButtonIcon = stroke('<path d="M4.5 5.5h15a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H11l-4.6 3.3v-3.3H4.5a1.8 1.8 0 0 1-1.8-1.8V7.3a1.8 1.8 0 0 1 1.8-1.8z"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/><circle cx="12" cy="11.5" r="0.5" fill="currentColor"/><circle cx="16" cy="11.5" r="0.5" fill="currentColor"/>');
export const MergeIcon = stroke('<circle cx="6.5" cy="12" r="3.3"/><circle cx="17" cy="12" r="5"/><path d="M10.2 12h1.6"/><path d="M9.3 9.3l1.6 1.2M9.3 14.7l1.6-1.2"/>');
export const PullIcon = stroke('<path d="M13 4.5H8.8a7.5 7.5 0 0 0 0 15H13V15H8.8a3 3 0 0 1 0-6H13z"/><path d="M10.6 4.5V9M10.6 15v4.5"/><circle cx="19" cy="12" r="2.4"/>');
