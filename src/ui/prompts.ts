import type { InputDevice } from '../core/Input';
import { PAD_LABELS, type PadButton, type PadStyle } from '../core/GamepadInput';
import { t, type MessageKey } from '../i18n';
import { escapeHtml } from './html';

/**
 * Dicas de botão ("aperte X"): um lugar só decide qual tecla/botão cada ação usa em
 * cada dispositivo. HUD, tutorial, resultado, cartas de poder, ajuda e avisos pedem
 * aqui — assim ninguém mostra "aperte T" pra quem está no controle.
 */

/** Dispositivo em uso + estilo do controle (Xbox, PlayStation, Switch). */
export interface PromptContext {
  device: InputDevice;
  style: PadStyle;
}

export type PromptAction =
  | 'move'
  | 'look'
  | 'grab'
  | 'jump'
  | 'run'
  | 'sprintToggle'
  | 'recall'
  | 'burrow'
  | 'ability'
  | 'emote'
  | 'merge'
  | 'pull'
  | 'invite'
  | 'zoom'
  | 'recenter'
  | 'pause';

/** Tecla escrita no teclado (texto fixo) ou nome traduzido (Espaço, Mouse...). */
type KeyCap = { text: string } | { key: MessageKey };

const KEYBOARD: Record<PromptAction, KeyCap[]> = {
  move: [{ text: 'W' }, { text: 'A' }, { text: 'S' }, { text: 'D' }],
  look: [{ key: 'key.mouse' }],
  grab: [{ text: 'E' }],
  jump: [{ key: 'key.space' }],
  run: [{ text: 'Shift' }],
  sprintToggle: [{ text: 'Shift' }],
  recall: [{ text: 'R' }],
  burrow: [{ text: 'T' }],
  ability: [{ text: 'Q' }],
  emote: [{ text: 'G' }],
  merge: [{ text: 'F' }],
  pull: [{ text: 'C' }],
  invite: [{ text: 'J' }],
  zoom: [{ key: 'key.wheel' }],
  recenter: [{ key: 'key.middleClick' }],
  pause: [{ text: 'Esc' }],
};

const GAMEPAD: Record<PromptAction, PadButton[]> = {
  move: ['ls'],
  look: ['rs'],
  grab: ['rt'],
  jump: ['a'],
  run: ['lt'],
  sprintToggle: ['l3'],
  recall: ['y'],
  burrow: ['view'],
  ability: ['x'],
  emote: ['down'],
  merge: ['left'],
  pull: ['up'],
  invite: ['right'],
  zoom: ['lb', 'rb'],
  recenter: ['r3'],
  pause: ['start'],
};

/** Botões de face ganham a cor/forma do controle (verde/vermelho no Xbox, símbolos no PlayStation). */
const FACE: ReadonlySet<PadButton> = new Set(['a', 'b', 'x', 'y']);
const STICK: ReadonlySet<PadButton> = new Set(['ls', 'rs', 'l3', 'r3']);
const DPAD: ReadonlySet<PadButton> = new Set(['up', 'down', 'left', 'right']);

/** Forma do botão na tecla desenhada (a cor sai do CSS por estilo de controle). */
export function padCapKind(button: PadButton): 'face' | 'stick' | 'dpad' | 'shoulder' {
  return FACE.has(button) ? 'face' : STICK.has(button) ? 'stick' : DPAD.has(button) ? 'dpad' : 'shoulder';
}

/** Um botão do controle como "tecla" (HTML). */
export function padCap(button: PadButton, style: PadStyle): string {
  const label = escapeHtml(PAD_LABELS[style][button]);
  return `<kbd class="keycap padcap padcap--${padCapKind(button)}" data-btn="${button}" data-style="${style}">${label}</kbd>`;
}

function keyCap(cap: KeyCap): string {
  const text = 'text' in cap ? cap.text : t(cap.key);
  return `<kbd class="keycap">${escapeHtml(text)}</kbd>`;
}

/** As teclas/botões de uma ação no dispositivo (HTML). No toque não há tecla: vazio. */
export function actionCaps(action: PromptAction, ctx: PromptContext): string {
  if (ctx.device === 'touch') return '';
  if (ctx.device === 'gamepad') return GAMEPAD[action].map((b) => padCap(b, ctx.style)).join('');
  return KEYBOARD[action].map(keyCap).join('');
}

/** Nome da tecla/botão em texto puro (leitor de tela, `aria-label`). */
export function actionLabel(action: PromptAction, ctx: PromptContext): string {
  if (ctx.device === 'touch') return '';
  if (ctx.device === 'gamepad') return GAMEPAD[action].map((b) => PAD_LABELS[ctx.style][b]).join(' / ');
  return KEYBOARD[action].map((cap) => ('text' in cap ? cap.text : t(cap.key))).join(' ');
}

/**
 * Frase com `{key}` trocado pela tecla/botão da ação (HTML seguro: o texto é escapado).
 * No toque a tecla some junto com o espaço antes dela ("Segure {key} pra..." → "Segure pra...").
 */
export function withCaps(text: string, action: PromptAction, ctx: PromptContext): string {
  if (ctx.device === 'touch') return escapeHtml(text.replace(' {key}', '').replace('{key}', ''));
  return escapeHtml(text).replace('{key}', actionCaps(action, ctx));
}
