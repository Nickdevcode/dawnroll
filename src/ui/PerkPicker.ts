import type { InputDevice } from '../core/Input';
import { PAD_LABELS, type MenuAction, type PadStyle } from '../core/GamepadInput';
import { formatCm, onLocaleChange, t, type MessageKey } from '../i18n';
import type { PerkId, PerkOffer } from '../progression/perks';
import { PerkIcons } from './gameIcons';
import { escapeHtml } from './html';

/**
 * Escolha de poder no marco de tamanho: três cartas por cima do jogo congelado.
 * Teclado (1/2/3, setas + Enter), mouse, toque e controle (direcional + A).
 * O jogo congela a simulação enquanto ela está aberta; quem decide isso é o `Game`.
 *
 * Existe UMA carta selecionada (classe `is-selected`, que também leva o foco): setas,
 * controle e o mouse passando por cima movem a mesma seleção. Antes o destaque vinha do
 * `:hover` + `:focus-visible`, e com o cursor parado em cima de uma carta o controle
 * mostrava duas cartas "levantadas" — não dava pra saber qual o A ia pegar.
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
  private options: PerkOffer[] = [];
  /** Carta selecionada (a que A / Enter / E escolhem). */
  private selected = 0;
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

    const cardIndex = (e: Event) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-perk]');
      return card ? Number(card.dataset.index) : -1;
    };
    this.cards.addEventListener('click', (e) => {
      const index = cardIndex(e);
      if (index >= 0) this.choose(index);
    });
    // Mouse passando por cima seleciona (só movimento de verdade: o cursor parado onde a
    // carta nasceu não rouba a seleção de quem está no controle).
    this.cards.addEventListener('pointermove', (e) => {
      const index = e.pointerType === 'mouse' ? cardIndex(e) : -1;
      if (index >= 0 && index !== this.selected) this.select(index);
    });
    // Tab (ou leitor de tela) levando o foco pra outra carta: a seleção vai junto.
    this.cards.addEventListener('focusin', (e) => {
      const index = cardIndex(e);
      if (index >= 0) this.mark(index);
    });
    // Nada daqui vaza pra área de arrastar a câmera do toque.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    onLocaleChange(() => {
      if (!this.visible) return;
      this.render();
      // As cartas foram refeitas: o foco volta pra selecionada (menos com a pausa por cima,
      // que é justamente onde se troca o idioma).
      if (!this.suspended) this.select(this.selected);
    });
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(options: readonly PerkOffer[], cm: number, device: InputDevice, padStyle: PadStyle): void {
    this.options = [...options];
    this.cm = cm;
    this.device = device;
    this.padStyle = padStyle;
    this.openedAt = performance.now();
    this.selected = 0;
    this.render();
    this.element.hidden = false;
    this.select(0);
  }

  hide(): void {
    this.element.hidden = true;
    this.options = [];
    this.suspended = false;
  }

  /** Pausa (menu por cima) suspende; voltar do menu reativa com o foco na carta que estava selecionada. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!suspended && this.visible) this.select(this.selected);
  }

  /** Dispositivo em uso mudou com as cartas abertas: a dica passa a citar os botões dele. */
  setDevice(device: InputDevice, padStyle: PadStyle): void {
    if (device === this.device && padStyle === this.padStyle) return;
    this.device = device;
    this.padStyle = padStyle;
    if (this.visible) this.renderHint();
  }

  /** Controle: direções andam entre as cartas, A escolhe a selecionada. Devolve se usou a ação. */
  handleGamepad(action: MenuAction): boolean {
    if (!this.visible || this.suspended) return false;
    if (action === 'left' || action === 'up' || action === 'right' || action === 'down') {
      this.select(this.selected + (action === 'left' || action === 'up' ? -1 : 1));
      return true;
    }
    if (action === 'confirm') {
      this.choose(this.selected);
      return true;
    }
    return false;
  }

  private render(): void {
    this.eyebrow.textContent = formatCm(this.cm);
    this.title.textContent = t('perk.pick.title');
    this.subtitle.textContent = t('perk.pick.subtitle');
    this.cards.innerHTML = this.options
      .map(({ id, rank }, i) => {
        // ★★: o mesmo poder de novo, na versão mais forte (a carta explica o que muda).
        const upgrade = rank === 2;
        const name = t(`perk.${id}.name` as MessageKey);
        const desc = t(`perk.${id}.${upgrade ? 'up' : 'desc'}` as MessageKey);
        const label = upgrade ? `${name} ★★. ${desc}` : `${name}. ${desc}`;
        const classes = ['perk-card', upgrade ? 'is-upgrade' : '', i === this.selected ? 'is-selected' : ''].filter(Boolean).join(' ');
        return /* html */ `
          <button class="${classes}" type="button" data-perk="${id}" data-index="${i}" aria-label="${escapeHtml(label)}">
            <span class="perk-card__key" aria-hidden="true">${i + 1}</span>
            ${upgrade ? `<span class="perk-card__badge" aria-hidden="true">${escapeHtml(t('perk.pick.upgrade'))}</span>` : ''}
            <span class="perk-card__icon perk-icon--${id}" aria-hidden="true">${PerkIcons[id]}</span>
            <span class="perk-card__name">${escapeHtml(name)}${upgrade ? ' <span class="perk-card__stars">★★</span>' : ''}</span>
            <span class="perk-card__desc">${escapeHtml(desc)}</span>
          </button>`;
      })
      .join('');
    this.element.style.setProperty('--cards', String(this.options.length));
    this.renderHint();
  }

  private renderHint(): void {
    if (this.device === 'gamepad') this.hint.textContent = t('perk.pick.gamepad', { button: PAD_LABELS[this.padStyle].a });
    else if (this.device === 'touch') this.hint.textContent = t('perk.pick.touch');
    else this.hint.textContent = t('perk.pick.keys', { keys: this.options.map((_, i) => i + 1).join(', ') });
    // No toque não há seleção (é tocar e pronto): o destaque some.
    this.element.classList.toggle('is-touch-hint', this.device === 'touch');
  }

  private cardButtons(): HTMLButtonElement[] {
    return Array.from(this.cards.querySelectorAll<HTMLButtonElement>('.perk-card'));
  }

  /** Seleciona uma carta (presa nas pontas) e leva o foco pra ela. */
  private select(index: number): void {
    const buttons = this.cardButtons();
    if (buttons.length === 0) return;
    const next = Math.min(Math.max(index, 0), buttons.length - 1);
    this.mark(next);
    buttons[next].focus({ preventScroll: true });
  }

  /** Só o destaque (o foco já está lá, ou vai chegar). */
  private mark(index: number): void {
    this.selected = index;
    this.cardButtons().forEach((button, i) => button.classList.toggle('is-selected', i === index));
  }

  private choose(index: number): void {
    // Um clique/tecla que já vinha acontecendo quando a escolha abriu não vale.
    if (!this.visible || this.suspended || performance.now() - this.openedAt < 250) return;
    const offer = this.options[index];
    if (!offer) return;
    this.hide();
    this.onChoose?.(offer.id);
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
    let step = 0;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') step = -1;
    else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') step = 1;
    else if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopPropagation();
      this.choose(this.selected);
      return;
    }
    if (step !== 0) {
      e.preventDefault();
      e.stopPropagation();
      this.select(this.selected + step);
    }
  };
}
