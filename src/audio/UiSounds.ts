import type { AudioEngine } from './AudioEngine';
import type { Recipe } from './voices/kit';
import { kalimba } from './voices/instruments';
import { drip } from './voices/nature';
import { uiClick, uiFocus, uiHover, uiReset, uiSelect, uiSheet, uiSlider, uiTab, uiToggle } from './voices/ui';

/** Prévia do slider da trilha: pentatônica de Fá subindo com o valor. */
const PREVIEW_NOTES: readonly number[] = [72, 74, 77, 79, 81];

/**
 * Sons da interface por delegação de eventos: escuta cliques, foco, hover e
 * sliders na raiz da UI e decide o som pelo papel do elemento (switch, radio,
 * aba, abrir/fechar placa…). O menu e o HUD não precisam saber que existe áudio.
 *
 * Os sliders de volume tocam o próprio canal: mexer na "Música" toca uma nota
 * da trilha, no "Ambiente" uma gota — dá para ouvir o nível enquanto ajusta.
 */
export class UiSounds {
  private lastHover: Element | null = null;
  private lastPointerDown = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly root: HTMLElement,
  ) {
    root.addEventListener('pointerdown', () => (this.lastPointerDown = performance.now()), { capture: true, passive: true });
    root.addEventListener('pointerover', this.onHover, { passive: true });
    root.addEventListener('focusin', this.onFocus);
    root.addEventListener('click', this.onClick);
    root.addEventListener('input', this.onInput);
    // Esc fecha a placa aberta: o menu cuida disso, aqui só o som (na captura, antes de ela sumir).
    root.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  private play(recipe: Recipe, key: string, minInterval = 0.03): void {
    this.engine.play(recipe, { bus: 'ui', key, minInterval, essential: true });
  }

  private readonly onHover = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element).closest('button:not(:disabled), input[type="range"]');
    if (el === this.lastHover) return;
    this.lastHover = el;
    // O HUD em jogo (e os botões de toque) não fazem barulho ao passar o mouse.
    if (el && el.closest('.menu')) this.play(uiHover, 'hover', 0.04);
  };

  private readonly onFocus = (e: FocusEvent): void => {
    // Foco que veio de clique já tem o som do clique.
    if (performance.now() - this.lastPointerDown < 400) return;
    const el = e.target as HTMLElement;
    if (el.matches('button, input') && el.closest('.menu')) this.play(uiFocus, 'focus');
  };

  private readonly onClick = (e: MouseEvent): void => {
    const el = (e.target as Element).closest('button');
    if (!el || el.disabled) return;
    // Jogar/Continuar e o menu do HUD têm o amanhecer/anoitecer; os botões de toque são o jogo.
    if (el.matches('[data-play], [data-menu-open], .touch-btn')) return;
    const role = el.getAttribute('role');
    if (role === 'switch') this.play(uiToggle(el.getAttribute('aria-checked') === 'true'), 'toggle');
    else if (role === 'radio') this.play(uiSelect, 'select');
    else if (role === 'tab') this.play(uiTab, 'tab');
    else if (el.hasAttribute('data-open')) this.play(uiSheet(el.getAttribute('aria-expanded') === 'true'), 'sheet');
    else if (el.hasAttribute('data-close')) this.play(uiSheet(false), 'sheet');
    else if (el.hasAttribute('data-reset')) this.play(uiReset, 'reset');
    // Guarda-roupa: vestir (ou provar) tem o "tic" de escolher, não o clique comum.
    else if (el.hasAttribute('data-pick')) this.play(uiSelect, 'select');
    else this.play(uiClick, 'click');
  };

  private readonly onInput = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'range') return;
    const min = Number(input.min);
    const value = (Number(input.value) - min) / (Number(input.max) - min || 1);
    const channel = input.getAttribute('aria-labelledby');
    if (channel === 'set-music') {
      const note = PREVIEW_NOTES[Math.round(value * (PREVIEW_NOTES.length - 1))];
      this.engine.play(kalimba(note, 0.6), { bus: 'music', key: 'preview-music', minInterval: 0.12, essential: true });
    } else if (channel === 'set-ambience') {
      // Canal "night": mesmo volume do ambiente, mas sem o abafador da pausa (o menu está aberto).
      this.engine.play(drip, { bus: 'night', key: 'preview-ambience', minInterval: 0.1, essential: true });
    } else {
      this.play(uiSlider(value), 'slider', 0.035);
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.root.querySelector('.menu.has-sheet')) this.play(uiSheet(false), 'sheet');
  };
}
