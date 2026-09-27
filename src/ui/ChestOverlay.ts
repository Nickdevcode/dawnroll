import { formatInteger, onLocaleChange, t } from '../i18n';
import type { MenuAction } from '../core/GamepadInput';
import type { ChestResult } from '../progression/economy';
import { lookFromKey, lookRarity, type Look } from '../progression/looks';
import type { Rarity } from '../progression/unlocks';
import { ChestIcons, CurrencyIcons } from './economyIcons';
import { GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { lookIcon } from './lookIcons';
import { amountText, chestName, lookName, rarityName } from './lookText';

type Mode = 'hidden' | 'waiting' | 'opening' | 'result';

/**
 * O cartão da cerimônia do baú, embaixo da tela (o baú em 3D fica no jardim,
 * em cima). Esperando: nome do baú e "Abrir" (tocar em qualquer lugar da cena
 * também abre). Aberto: as moedas e o orvalho contando, o visual que saiu (com
 * "Vestir") e "Próximo baú" / "Fechar".
 */
export class ChestOverlay {
  readonly element: HTMLElement;
  /** Tocou pra abrir. */
  onOpen: (() => void) | null = null;
  /** Próximo baú da pilha. */
  onNext: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** Vestir o visual que saiu. */
  onWear: ((look: Look) => void) | null = null;

  private readonly card: HTMLElement;
  private mode: Mode = 'hidden';
  private rarity: Rarity = 'common';
  private remaining = 0;
  private result: ChestResult | null = null;
  private worn = false;
  private counting = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'chest-overlay';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'chest-overlay-title');
    this.element.innerHTML = `<div class="chest-overlay__card" data-card aria-live="polite"></div>`;
    this.card = this.element.querySelector('[data-card]') as HTMLElement;
    parent.append(this.element);

    // Tocar fora do cartão (no baú, na cena) abre, esperando; o cartão tem os botões.
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('[data-chest-action]');
      if (button) {
        this.act(button.dataset.chestAction!);
        return;
      }
      if (!target.closest('[data-card]') && this.mode === 'waiting') this.onOpen?.();
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (this.mode === 'waiting' || this.mode === 'result') this.onClose?.();
    });
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    onLocaleChange(() => this.render());
  }

  get isOpen(): boolean {
    return this.mode !== 'hidden';
  }

  /** Baú caiu e espera o toque. `remaining` = quantos ficam depois deste. */
  showWaiting(rarity: Rarity, remaining: number): void {
    this.mode = 'waiting';
    this.rarity = rarity;
    this.remaining = remaining;
    this.result = null;
    this.element.hidden = false;
    this.render();
    this.card.querySelector<HTMLElement>('[data-chest-action="open"]')?.focus({ preventScroll: true });
  }

  /** Abrindo (a tampa estourou; o cartão espera o prêmio assentar). */
  showOpening(): void {
    this.mode = 'opening';
    this.render();
  }

  showResult(result: ChestResult, remaining: number): void {
    this.mode = 'result';
    this.result = result;
    this.remaining = remaining;
    this.worn = false;
    this.render();
    this.countUp();
    const focus = this.card.querySelector<HTMLElement>('[data-chest-action="wear"]') ?? this.actionButton();
    focus?.focus({ preventScroll: true });
  }

  hide(): void {
    this.mode = 'hidden';
    this.element.hidden = true;
    cancelAnimationFrame(this.counting);
  }

  /** Controle: A abre/avança, B fecha. Devolve se usou a ação. */
  handleGamepad(action: MenuAction): boolean {
    if (!this.isOpen) return false;
    if (action === 'confirm') {
      const active = document.activeElement as HTMLElement | null;
      if (active && this.card.contains(active) && active.matches('button')) active.click();
      else if (this.mode === 'waiting') this.onOpen?.();
      return true;
    }
    if (action === 'back') {
      if (this.mode !== 'opening') this.onClose?.();
      return true;
    }
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      const buttons = [...this.card.querySelectorAll<HTMLElement>('button')];
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const next = buttons[(i + (action === 'left' || action === 'up' ? -1 : 1) + buttons.length) % buttons.length];
      next?.focus({ preventScroll: true });
      return true;
    }
    return true;
  }

  private act(action: string): void {
    if (action === 'open') this.onOpen?.();
    else if (action === 'next') this.onNext?.();
    else if (action === 'close') this.onClose?.();
    else if (action === 'wear' && this.result?.look) {
      this.worn = true;
      this.onWear?.(lookFromKey(this.result.look));
      this.render();
      this.actionButton()?.focus({ preventScroll: true });
    }
  }

  /** O próximo passo natural: abrir o próximo baú (se tem) ou fechar. */
  private actionButton(): HTMLElement | null {
    return this.card.querySelector<HTMLElement>('[data-chest-action="next"]') ?? this.card.querySelector<HTMLElement>('[data-chest-action="close"]');
  }

  private render(): void {
    if (this.mode === 'hidden') return;
    this.element.dataset.rarity = this.rarity;
    this.element.dataset.mode = this.mode;
    const head = /* html */ `
      <div class="chest-overlay__head">
        <span class="chest-overlay__icon" aria-hidden="true">${ChestIcons[this.rarity]}</span>
        <span class="chest-overlay__title">
          <strong id="chest-overlay-title">${escapeHtml(chestName(this.rarity))}</strong>
          <span class="rarity-chip is-${this.rarity}">${escapeHtml(rarityName(this.rarity))}</span>
        </span>
      </div>`;
    if (this.mode === 'waiting' || this.mode === 'opening') {
      const more = this.remaining > 0 ? `<p class="chest-overlay__more">${escapeHtml(t('chest.moreWaiting', { n: this.remaining }))}</p>` : '';
      this.card.innerHTML = /* html */ `
        ${head}
        <p class="chest-overlay__hint">${escapeHtml(t(this.mode === 'waiting' ? 'chest.tapToOpen' : 'chest.opening'))}</p>
        ${more}
        <div class="chest-overlay__actions">
          <button class="chest-overlay__secondary" type="button" data-chest-action="close" ${this.mode === 'opening' ? 'disabled' : ''}>${escapeHtml(t('chest.later'))}</button>
          <button class="chest-overlay__primary" type="button" data-chest-action="open" ${this.mode === 'opening' ? 'disabled' : ''}>${escapeHtml(t('chest.open'))}</button>
        </div>`;
      return;
    }
    const result = this.result!;
    const rows: string[] = [
      `<li class="chest-reward is-coins"><span aria-hidden="true">${CurrencyIcons.coins}</span><strong data-count="${result.coins}">+0</strong><span class="sr-only">${escapeHtml(amountText('coins', result.coins))}</span><span aria-hidden="true">${escapeHtml(t('money.coinsLabel'))}</span></li>`,
    ];
    if (result.dew > 0) {
      rows.push(`<li class="chest-reward is-dew"><span aria-hidden="true">${CurrencyIcons.dew}</span><strong data-count="${result.dew}">+0</strong><span class="sr-only">${escapeHtml(amountText('dew', result.dew))}</span><span aria-hidden="true">${escapeHtml(t('money.dewLabel'))}</span></li>`);
    }
    let item = '';
    if (result.look) {
      const look = lookFromKey(result.look);
      const rarity = lookRarity(look);
      item = /* html */ `
        <div class="chest-item is-${rarity}">
          <span class="chest-item__art" aria-hidden="true">${lookIcon(look)}</span>
          <span class="chest-item__text">
            <span class="chest-item__label">${GameIcons.sparkle}${escapeHtml(t('chest.newLook'))}</span>
            <strong>${escapeHtml(lookName(look))}</strong>
            <span class="rarity-chip is-${rarity}">${escapeHtml(rarityName(rarity))}</span>
          </span>
          ${this.worn ? `<span class="chest-item__worn">${escapeHtml(t('wardrobe.wearing'))}</span>` : `<button class="chest-overlay__primary is-small" type="button" data-chest-action="wear">${escapeHtml(t('shop.wear'))}</button>`}
        </div>`;
    }
    const next =
      this.remaining > 0
        ? `<button class="chest-overlay__primary" type="button" data-chest-action="next">${escapeHtml(t('chest.next', { n: this.remaining }))}</button>`
        : '';
    this.card.innerHTML = /* html */ `
      ${head}
      <ul class="chest-rewards">${rows.join('')}</ul>
      ${item}
      <div class="chest-overlay__actions">
        <button class="chest-overlay__secondary" type="button" data-chest-action="close">${escapeHtml(t('chest.close'))}</button>
        ${next}
      </div>`;
  }

  /** Os números sobem de 0 até o prêmio (meio segundo). */
  private countUp(): void {
    cancelAnimationFrame(this.counting);
    const targets = [...this.card.querySelectorAll<HTMLElement>('[data-count]')];
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 650);
      const e = 1 - (1 - k) ** 3;
      for (const el of targets) el.textContent = `+${formatInteger(Math.round(Number(el.dataset.count) * e))}`;
      if (k < 1) this.counting = requestAnimationFrame(step);
    };
    this.counting = requestAnimationFrame(step);
  }
}
