import { EMOTE_COUNT } from '../net/protocol';
import { onLocaleChange, t, type MessageKey } from '../i18n';
import { escapeHtml } from './html';
import { EMOTE_ICONS } from './emoteIcons';

/**
 * Roda de reações do online: 8 frases com ícone (sem chat livre, que tem
 * criança jogando). Abre com G (ou ↓ no controle, ou o botão no toque) e o
 * jogo segue rodando por baixo.
 *
 * Escolher: tecla 1–8; mouse (com o ponteiro preso) ou analógico direito
 * apontando pra fatia, e clique/A pra mandar; toque direto na frase. Sem
 * escolher nada, fecha sozinha.
 */

/** Quanto precisa "apontar" (px de mouse acumulados) pra uma fatia acender. */
const AIM_DEADZONE = 26;
const AIM_MAX = 140;
/** Fecha sozinha se ficar aberta sem uso. */
const IDLE_SECONDS = 6;

export class EmoteWheel {
  readonly element: HTMLElement;
  /** Mandou a reação `index`. */
  onSend: ((index: number) => void) | null = null;
  private readonly items: HTMLButtonElement[] = [];
  private readonly center: HTMLElement;
  private selected = -1;
  private aimX = 0;
  private aimY = 0;
  private idle = 0;

  constructor(
    parent: HTMLElement,
    /** No toque não tem tecla: a legenda do meio pede pra tocar. */
    private readonly isTouch = false,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'emote-wheel';
    this.element.hidden = true;
    this.element.setAttribute('role', 'menu');
    const ring = document.createElement('div');
    ring.className = 'emote-wheel__ring';
    for (let i = 0; i < EMOTE_COUNT; i++) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'emote-wheel__item';
      item.dataset.emote = String(i);
      item.style.setProperty('--angle', `${-90 + i * (360 / EMOTE_COUNT)}deg`);
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.send(i);
      });
      item.addEventListener('pointerenter', () => this.mark(i));
      this.items.push(item);
      ring.append(item);
    }
    this.center = document.createElement('div');
    this.center.className = 'emote-wheel__center';
    this.center.setAttribute('aria-hidden', 'true');
    ring.append(this.center);
    this.element.append(ring);
    // Toque fora das frases fecha (e nada vaza pra área de mirar a câmera).
    this.element.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.element || e.target === ring) this.hide();
    });
    parent.append(this.element);
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    onLocaleChange(() => this.render());
    this.render();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    this.selected = -1;
    this.aimX = this.aimY = 0;
    this.idle = 0;
    this.render();
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
    this.selected = -1;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  /** Quadro: fecha sozinha depois de um tempo sem uso. */
  update(dt: number): void {
    if (!this.isOpen) return;
    this.idle += dt;
    if (this.idle > IDLE_SECONDS) this.hide();
  }

  /**
   * Mouse preso ou analógico: vai acumulando o "apontar" e acende a fatia da
   * direção (0 = em cima, girando no sentido do relógio).
   */
  aim(dx: number, dy: number): void {
    if (!this.isOpen || (dx === 0 && dy === 0)) return;
    this.idle = 0;
    this.aimX += dx;
    this.aimY += dy;
    const length = Math.hypot(this.aimX, this.aimY);
    if (length > AIM_MAX) {
      this.aimX *= AIM_MAX / length;
      this.aimY *= AIM_MAX / length;
    }
    if (length < AIM_DEADZONE) return;
    const angle = (Math.atan2(this.aimY, this.aimX) * 180) / Math.PI + 90;
    this.mark(((Math.round(angle / (360 / EMOTE_COUNT)) % EMOTE_COUNT) + EMOTE_COUNT) % EMOTE_COUNT);
  }

  /** Direcional ←/→: gira a seleção. */
  step(delta: number): void {
    if (!this.isOpen) return;
    this.idle = 0;
    const from = this.selected < 0 ? 0 : this.selected + delta;
    this.mark(((from % EMOTE_COUNT) + EMOTE_COUNT) % EMOTE_COUNT);
  }

  /** Clique / A / ↓ de novo: manda a acesa (sem nenhuma acesa, só fecha). */
  confirm(): void {
    if (!this.isOpen) return;
    if (this.selected >= 0) this.send(this.selected);
    else this.hide();
  }

  private send(index: number): void {
    this.hide();
    this.onSend?.(index);
  }

  private mark(index: number): void {
    this.selected = index;
    this.items.forEach((item, i) => item.classList.toggle('is-selected', i === index));
    this.center.textContent = index >= 0 ? t(`emote.${index}` as MessageKey) : t(this.isTouch ? 'emote.hintTouch' : 'emote.hint');
  }

  private render(): void {
    this.element.setAttribute('aria-label', t('emote.title'));
    this.items.forEach((item, i) => {
      const label = t(`emote.${i}` as MessageKey);
      item.innerHTML = `<span class="emote-wheel__icon">${EMOTE_ICONS[i]}</span><span class="emote-wheel__label">${escapeHtml(label)}</span><span class="emote-wheel__key" aria-hidden="true">${i + 1}</span>`;
      item.setAttribute('aria-label', label);
    });
    this.mark(this.selected);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const digit = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      e.stopPropagation();
      this.send(Number(digit[1]) - 1);
      return;
    }
    if (e.code === 'Escape') this.hide();
  };
}
