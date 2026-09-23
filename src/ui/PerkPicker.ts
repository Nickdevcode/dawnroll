import type { InputDevice } from '../core/Input';
import { PAD_LABELS, type MenuAction, type PadStyle } from '../core/GamepadInput';
import { formatCm, onLocaleChange, t, type MessageKey } from '../i18n';
import type { PerkId } from '../progression/perks';
import { PerkIcons } from './gameIcons';
import { escapeHtml } from './html';

/**
 * Escolha de poder no marco de tamanho: três cartas por cima do jogo congelado.
 * Teclado (1/2/3, setas + Enter), mouse, toque e controle (direcional + A).
 * O jogo congela a simulação enquanto ela está aberta; quem decide isso é o `Game`.
 */
export class PerkPicker {
  readonly element: HTMLElement;
  /** O jogador escolheu um poder. */
  onChoose: ((perk: PerkId) => void) | null = null;

  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly hint: HTMLElement;
  private options: PerkId[] = [];
  private cm = 0;
  private device: InputDevice = 'keyboard';
  private padStyle: PadStyle = 'xbox';
  /** Momento em que abriu: ignora cliques/teclas "atrasados" do que o jogador fazia antes. */
  private openedAt = 0;
  /**
   * Jogo pausado com a escolha aberta: as cartas ficam atrás do menu e o teclado
   * não pode escolher às cegas (1/2/3/E continuariam valendo sem isso).
   */
  private suspended = false;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'perk-picker';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'perk-picker-title');
    this.element.innerHTML = /* html */ `
      <div class="perk-picker__panel">
        <p class="perk-picker__eyebrow" data-eyebrow></p>
        <h2 class="perk-picker__title" id="perk-picker-title" data-title></h2>
        <p class="perk-picker__subtitle" data-subtitle></p>
        <div class="perk-picker__cards" data-cards></div>
        <p class="perk-picker__hint" data-hint></p>
      </div>`;
    parent.append(this.element);
    const $ = (sel: string) => this.element.querySelector(sel) as HTMLElement;
    this.eyebrow = $('[data-eyebrow]');
    this.title = $('[data-title]');
    this.subtitle = $('[data-subtitle]');
    this.cards = $('[data-cards]');
    this.hint = $('[data-hint]');

    this.cards.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-perk]');
      if (card) this.choose(Number(card.dataset.index));
    });
    // Nada daqui vaza pra área de arrastar a câmera do toque.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    onLocaleChange(() => this.visible && this.render());
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(options: readonly PerkId[], cm: number, device: InputDevice, padStyle: PadStyle): void {
    this.options = [...options];
    this.cm = cm;
    this.device = device;
    this.padStyle = padStyle;
    this.openedAt = performance.now();
    this.render();
    this.element.hidden = false;
    this.cardButtons()[0]?.focus({ preventScroll: true });
  }

  hide(): void {
    this.element.hidden = true;
    this.options = [];
    this.suspended = false;
  }

  /** Pausa (menu por cima) suspende; voltar do menu reativa com o foco na primeira carta. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!suspended && this.visible) this.cardButtons()[0]?.focus({ preventScroll: true });
  }

  /** Controle: direções andam entre as cartas, A escolhe. Devolve se usou a ação. */
  handleGamepad(action: MenuAction): boolean {
    if (!this.visible || this.suspended) return false;
    const buttons = this.cardButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (action === 'left' || action === 'up' || action === 'right' || action === 'down') {
      const step = action === 'left' || action === 'up' ? -1 : 1;
      const next = index < 0 ? 0 : Math.min(Math.max(index + step, 0), buttons.length - 1);
      buttons[next]?.focus({ preventScroll: true });
      return true;
    }
    if (action === 'confirm') {
      this.choose(index < 0 ? 0 : index);
      return true;
    }
    return false;
  }

  private render(): void {
    this.eyebrow.textContent = formatCm(this.cm);
    this.title.textContent = t('perk.pick.title');
    this.subtitle.textContent = t('perk.pick.subtitle');
    this.cards.innerHTML = this.options
      .map((id, i) => {
        const name = t(`perk.${id}.name` as MessageKey);
        const desc = t(`perk.${id}.desc` as MessageKey);
        return /* html */ `
          <button class="perk-card" type="button" data-perk="${id}" data-index="${i}" aria-label="${escapeHtml(`${name}. ${desc}`)}">
            <span class="perk-card__key" aria-hidden="true">${i + 1}</span>
            <span class="perk-card__icon perk-icon--${id}" aria-hidden="true">${PerkIcons[id]}</span>
            <span class="perk-card__name">${escapeHtml(name)}</span>
            <span class="perk-card__desc">${escapeHtml(desc)}</span>
          </button>`;
      })
      .join('');
    this.element.style.setProperty('--cards', String(this.options.length));
    if (this.device === 'gamepad') this.hint.textContent = t('perk.pick.gamepad', { button: PAD_LABELS[this.padStyle].a });
    else if (this.device === 'touch') this.hint.textContent = t('perk.pick.touch');
    else this.hint.textContent = t('perk.pick.keys', { keys: this.options.map((_, i) => i + 1).join(', ') });
    this.element.classList.toggle('is-touch-hint', this.device === 'touch');
  }

  private cardButtons(): HTMLButtonElement[] {
    return Array.from(this.cards.querySelectorAll<HTMLButtonElement>('.perk-card'));
  }

  private choose(index: number): void {
    // Um clique/tecla que já vinha acontecendo quando a escolha abriu não vale.
    if (!this.visible || this.suspended || performance.now() - this.openedAt < 250) return;
    const perk = this.options[index];
    if (!perk) return;
    this.hide();
    this.onChoose?.(perk);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.visible || this.suspended) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      e.stopPropagation();
      this.choose(Number(digit[1]) - 1);
      return;
    }
    const buttons = this.cardButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') next = Math.max(0, (index < 0 ? 0 : index) - 1);
    else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') next = Math.min(buttons.length - 1, index + 1);
    else if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopPropagation();
      this.choose(index < 0 ? 0 : index);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      buttons[next]?.focus({ preventScroll: true });
    }
  };
}
