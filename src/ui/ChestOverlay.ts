import { formatInteger, onLocaleChange, t, tn, type MessageKey } from '../i18n';
import type { MenuAction } from '../core/GamepadInput';
import { accessory } from '../progression/accessories';
import type { ChestResult, ChestReward } from '../progression/economy';
import { lookFromKey, lookRarity, type Look } from '../progression/looks';
import type { Rarity } from '../progression/unlocks';
import { ChestIcons, CurrencyIcons } from './economyIcons';
import { GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { lookIcon } from './lookIcons';
import { amountText, chestName, lookName, rarityName } from './lookText';

type Mode = 'hidden' | 'waiting' | 'opening' | 'reveal' | 'summary';

/**
 * O palco da cerimônia do baú (o baú e os prêmios em 3D ficam no jardim, no
 * meio da tela). Em cima: o nome do baú e "Depois"/"Pular". Logo abaixo, a
 * legenda do prêmio da vez (quanto de moeda, de orvalho, qual visual). Embaixo:
 * a dica e o botão (Abrir / Continuar, com quantos prêmios faltam) e, no fim, o
 * resumo com tudo que saiu, "Vestir" e "Próximo baú" / "Fechar".
 *
 * Tocar em qualquer lugar fora dos botões faz o natural da hora: abre o baú,
 * ou passa pro próximo prêmio. O meio da tela fica livre (`stageRect`) pra
 * câmera enquadrar o baú.
 */
export class ChestOverlay {
  readonly element: HTMLElement;
  /** Tocou pra abrir. */
  onOpen: (() => void) | null = null;
  /** Próximo prêmio (tocou no palco ou em Continuar). */
  onAdvance: (() => void) | null = null;
  /** Pular direto pro resumo. */
  onSkip: (() => void) | null = null;
  /** Próximo baú da pilha. */
  onNext: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** Vestir o visual que saiu. */
  onWear: ((look: Look) => void) | null = null;

  private readonly title: HTMLElement;
  private readonly label: HTMLElement;
  private readonly space: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly ghost: HTMLButtonElement;
  private mode: Mode = 'hidden';
  private rarity: Rarity = 'common';
  /** Baús esperando depois deste. */
  private remaining = 0;
  private reward: ChestReward | null = null;
  /** Prêmios que ainda estão no baú depois do da vez. */
  private left = 0;
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
    this.element.innerHTML = /* html */ `
      <div class="chest-stage__vignette" aria-hidden="true"></div>
      <header class="chest-stage__top">
        <div class="chest-stage__badge" data-title></div>
        <button class="chest-stage__ghost" type="button" data-ghost></button>
      </header>
      <div class="chest-stage__label" data-label aria-live="polite"></div>
      <div class="chest-stage__space" data-space aria-hidden="true"></div>
      <div class="chest-stage__bottom" data-bottom></div>`;
    this.title = this.element.querySelector('[data-title]') as HTMLElement;
    this.label = this.element.querySelector('[data-label]') as HTMLElement;
    this.space = this.element.querySelector('[data-space]') as HTMLElement;
    this.bottom = this.element.querySelector('[data-bottom]') as HTMLElement;
    this.ghost = this.element.querySelector('[data-ghost]') as HTMLButtonElement;
    parent.append(this.element);

    // Botão faz o dele; tocar no resto do palco abre (esperando) ou passa pro próximo (mostrando).
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-ghost]')) {
        if (this.mode === 'waiting') this.onClose?.();
        else if (this.mode === 'reveal' || this.mode === 'opening') this.onSkip?.();
        return;
      }
      const button = target.closest<HTMLButtonElement>('[data-chest-action]');
      if (button) {
        this.act(button.dataset.chestAction!);
        return;
      }
      if (target.closest('.chest-summary')) return;
      if (this.mode === 'waiting') this.onOpen?.();
      else if (this.mode === 'reveal') this.onAdvance?.();
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.back();
    });
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    onLocaleChange(() => this.render());
  }

  get isOpen(): boolean {
    return this.mode !== 'hidden';
  }

  /** Pedaço do meio da tela (px) livre pro baú: entre a legenda e o rodapé. */
  stageRect(): DOMRect {
    return this.space.getBoundingClientRect();
  }

  /** Baú caiu e espera o toque. `remaining` = quantos ficam depois deste. */
  showWaiting(rarity: Rarity, remaining: number): void {
    this.mode = 'waiting';
    this.rarity = rarity;
    this.remaining = remaining;
    this.result = null;
    this.reward = null;
    this.element.hidden = false;
    this.render();
    this.focusPrimary();
  }

  /** Abrindo: a tampa estourou e o primeiro prêmio está saindo. */
  showOpening(): void {
    this.mode = 'opening';
    this.reward = null;
    this.render();
  }

  /** O próximo prêmio está saindo do baú: a legenda do anterior sai de cena até ele aparecer. */
  clearReward(): void {
    this.label.classList.remove('is-shown');
  }

  /** O prêmio da vez parou no ar: legenda dele e quantos faltam. */
  showReward(reward: ChestReward, left: number): void {
    this.mode = 'reveal';
    this.reward = reward;
    this.left = left;
    this.render();
    this.countUp();
    this.focusPrimary();
  }

  /** Tudo que saiu, com Vestir e o próximo passo. */
  showSummary(result: ChestResult, remaining: number): void {
    this.mode = 'summary';
    this.result = result;
    this.remaining = remaining;
    this.reward = null;
    this.worn = false;
    this.render();
    this.countUp();
    const focus = this.bottom.querySelector<HTMLElement>('[data-chest-action="wear"]') ?? this.actionButton();
    focus?.focus({ preventScroll: true });
  }

  hide(): void {
    this.mode = 'hidden';
    this.element.hidden = true;
    cancelAnimationFrame(this.counting);
  }

  /** Controle: A abre/avança (ou aperta o botão com foco), B fecha/pula. Devolve se usou a ação. */
  handleGamepad(action: MenuAction): boolean {
    if (!this.isOpen) return false;
    if (action === 'confirm') {
      const active = document.activeElement as HTMLElement | null;
      if (active && this.element.contains(active) && active.matches('button')) active.click();
      else if (this.mode === 'waiting') this.onOpen?.();
      else if (this.mode === 'reveal') this.onAdvance?.();
      return true;
    }
    if (action === 'back') {
      this.back();
      return true;
    }
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button:not([hidden]):not(:disabled)')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[(i + (action === 'left' || action === 'up' ? -1 : 1) + buttons.length) % buttons.length];
      next?.focus({ preventScroll: true });
      return true;
    }
    return true;
  }

  /** Voltar (Esc, B): esperando fecha, mostrando pula pro resumo, no resumo fecha. */
  private back(): void {
    if (this.mode === 'waiting' || this.mode === 'summary') this.onClose?.();
    else if (this.mode === 'reveal' || this.mode === 'opening') this.onSkip?.();
  }

  private act(action: string): void {
    if (action === 'open') this.onOpen?.();
    else if (action === 'advance') this.onAdvance?.();
    else if (action === 'next') this.onNext?.();
    else if (action === 'close') this.onClose?.();
    else if (action === 'wear' && this.result?.look) {
      this.worn = true;
      this.onWear?.(lookFromKey(this.result.look));
      this.render();
      this.actionButton()?.focus({ preventScroll: true });
    }
  }

  private focusPrimary(): void {
    this.bottom.querySelector<HTMLElement>('.chest-stage__primary')?.focus({ preventScroll: true });
  }

  /** O próximo passo natural no resumo: abrir o próximo baú (se tem) ou fechar. */
  private actionButton(): HTMLElement | null {
    return this.bottom.querySelector<HTMLElement>('[data-chest-action="next"]') ?? this.bottom.querySelector<HTMLElement>('[data-chest-action="close"]');
  }

  private render(): void {
    if (this.mode === 'hidden') return;
    this.element.dataset.rarity = this.rarity;
    this.element.dataset.mode = this.mode;
    this.title.innerHTML = /* html */ `
      <span class="chest-stage__icon" aria-hidden="true">${ChestIcons[this.rarity]}</span>
      <span class="chest-stage__name">
        <strong id="chest-overlay-title">${escapeHtml(chestName(this.rarity))}</strong>
        <span class="rarity-chip is-${this.rarity}">${escapeHtml(rarityName(this.rarity))}</span>
      </span>`;
    this.ghost.hidden = this.mode === 'summary';
    this.ghost.textContent = t(this.mode === 'waiting' ? 'chest.later' : 'chest.skip');
    this.label.innerHTML = this.mode === 'reveal' && this.reward ? this.rewardLabel(this.reward) : '';
    this.label.classList.toggle('is-shown', this.mode === 'reveal');

    if (this.mode === 'waiting') {
      const more = this.remaining > 0 ? `<p class="chest-stage__more">${escapeHtml(t('chest.moreWaiting', { n: this.remaining }))}</p>` : '';
      this.bottom.innerHTML = /* html */ `
        <p class="chest-stage__hint">${escapeHtml(t('chest.tapToOpen'))}</p>
        <button class="chest-stage__primary" type="button" data-chest-action="open">${escapeHtml(t('chest.open'))}</button>
        ${more}`;
      return;
    }
    if (this.mode === 'opening') {
      this.bottom.innerHTML = `<p class="chest-stage__hint">${escapeHtml(t('chest.opening'))}</p>`;
      return;
    }
    if (this.mode === 'reveal') {
      const hint = this.left > 0 ? t('chest.tapToContinue') : t('chest.tapToFinish');
      const count = this.left > 0 ? `<span class="chest-stage__count">${escapeHtml(tn('chest.left', this.left))}</span>` : '';
      this.bottom.innerHTML = /* html */ `
        <p class="chest-stage__hint">${escapeHtml(hint)}</p>
        <button class="chest-stage__primary" type="button" data-chest-action="advance">${escapeHtml(t('chest.continue'))}</button>
        ${count}`;
      return;
    }
    this.bottom.innerHTML = this.summaryCard(this.result!);
  }

  /** Legenda do prêmio da vez: o valor grande contando, ou o nome do visual com a raridade. */
  private rewardLabel(reward: ChestReward): string {
    if (reward.kind === 'coins' || reward.kind === 'dew') {
      const icon = reward.kind === 'coins' ? CurrencyIcons.coins : CurrencyIcons.dew;
      const unit = t(reward.kind === 'coins' ? 'money.coinsLabel' : 'money.dewLabel');
      return /* html */ `
        <div class="reward-label is-${reward.kind}">
          <span class="reward-label__amount"><span class="reward-label__icon" aria-hidden="true">${icon}</span><strong data-count="${reward.amount}" aria-hidden="true">+0</strong></span>
          <span class="reward-label__unit" aria-hidden="true">${escapeHtml(unit)}</span>
          <span class="sr-only">${escapeHtml(amountText(reward.kind, reward.amount))}</span>
        </div>`;
    }
    const look = lookFromKey(reward.look);
    const rarity = lookRarity(look);
    const slot = look.kind === 'skin' ? 'skins' : accessory(look.id).slot;
    return /* html */ `
      <div class="reward-label is-look is-${rarity}">
        <span class="reward-label__eyebrow">${GameIcons.sparkle}${escapeHtml(t('chest.newLook'))}</span>
        <strong class="reward-label__name">${escapeHtml(lookName(look))}</strong>
        <span class="reward-label__meta">
          <span class="rarity-chip is-${rarity}">${escapeHtml(rarityName(rarity))}</span>
          <span class="reward-label__slot">${escapeHtml(t(`wardrobe.tab.${slot}` as MessageKey))}</span>
        </span>
      </div>`;
  }

  private summaryCard(result: ChestResult): string {
    const rows: string[] = [
      `<li class="chest-reward is-coins"><span aria-hidden="true">${CurrencyIcons.coins}</span><strong data-count="${result.coins}" aria-hidden="true">+0</strong><span class="sr-only">${escapeHtml(amountText('coins', result.coins))}</span><span aria-hidden="true">${escapeHtml(t('money.coinsLabel'))}</span></li>`,
    ];
    if (result.dew > 0) {
      rows.push(`<li class="chest-reward is-dew"><span aria-hidden="true">${CurrencyIcons.dew}</span><strong data-count="${result.dew}" aria-hidden="true">+0</strong><span class="sr-only">${escapeHtml(amountText('dew', result.dew))}</span><span aria-hidden="true">${escapeHtml(t('money.dewLabel'))}</span></li>`);
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
          ${this.worn ? `<span class="chest-item__worn">${escapeHtml(t('wardrobe.wearing'))}</span>` : `<button class="chest-stage__primary is-small" type="button" data-chest-action="wear">${escapeHtml(t('shop.wear'))}</button>`}
        </div>`;
    }
    const next =
      this.remaining > 0
        ? `<button class="chest-stage__primary" type="button" data-chest-action="next">${escapeHtml(t('chest.next', { n: this.remaining }))}</button>`
        : '';
    return /* html */ `
      <section class="chest-summary" aria-labelledby="chest-summary-title">
        <h2 class="chest-summary__title" id="chest-summary-title">${escapeHtml(t('chest.summary'))}</h2>
        <ul class="chest-rewards">${rows.join('')}</ul>
        ${item}
        <div class="chest-summary__actions">
          <button class="chest-stage__secondary" type="button" data-chest-action="close">${escapeHtml(t('chest.close'))}</button>
          ${next}
        </div>
      </section>`;
  }

  /** Os números sobem de 0 até o prêmio (meio segundo e pouco). */
  private countUp(): void {
    cancelAnimationFrame(this.counting);
    const targets = [...this.element.querySelectorAll<HTMLElement>('[data-count]')];
    if (targets.length === 0) return;
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
