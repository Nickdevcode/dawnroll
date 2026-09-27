import { onLocaleChange, t, tn } from '../i18n';
import type { Progression } from '../progression/Progression';
import { shownSeason } from '../progression/seasons';
import { ChestIcons, CurrencyIcons, FloradaArt } from './economyIcons';
import { escapeHtml } from './html';
import { amountText, seasonName } from './lookText';

/**
 * "Chegou a Feirinha!": aparece uma vez pra quem já jogava antes das moedas
 * existirem, contando o que as conquistas e os níveis antigos viraram (moedas,
 * orvalho e baús) e apresentando o passe da temporada. `<dialog>` modal de
 * verdade (prende o foco; o Esc é "Depois").
 */
export class WelcomeDialog {
  readonly element: HTMLDialogElement;
  /** Quer ver os baús agora (o menu abre a Feirinha). */
  onOpenChests: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly progression: Progression,
    private readonly canShow: () => boolean,
  ) {
    this.element = document.createElement('dialog');
    this.element.className = 'welcome-dialog';
    this.element.setAttribute('aria-labelledby', 'welcome-title');
    this.element.setAttribute('aria-describedby', 'welcome-text');
    parent.append(this.element);
    this.element.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-welcome]')?.dataset.welcome;
      if (!action) return;
      this.dismiss();
      if (action === 'chests') this.onOpenChests?.();
    });
    this.element.addEventListener('cancel', () => this.progression.markWelcomed());
    onLocaleChange(() => {
      if (this.element.open) this.render();
    });
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  /** Abre se tem presente pra mostrar (e o menu está na tela). */
  check(): void {
    if (this.element.open || !this.canShow()) return;
    const gift = this.progression.welcomeGift;
    if (!gift) return;
    this.render();
    this.element.showModal();
    this.element.querySelector<HTMLElement>('[data-welcome="chests"]')?.focus();
  }

  close(): void {
    this.dismiss();
  }

  /** Some sem contar como vista (o jogo começou por cima dela). */
  hide(): void {
    if (this.element.open) this.element.close();
  }

  private dismiss(): void {
    this.progression.markWelcomed();
    if (this.element.open) this.element.close();
  }

  private render(): void {
    const gift = this.progression.welcomeGift;
    if (!gift) return;
    const season = shownSeason(Date.now());
    const lines = [
      `<li><span aria-hidden="true">${CurrencyIcons.coins}</span><span>${escapeHtml(amountText('coins', gift.coins))}</span></li>`,
      `<li><span aria-hidden="true">${CurrencyIcons.dew}</span><span>${escapeHtml(amountText('dew', gift.dew))}</span></li>`,
      `<li><span aria-hidden="true">${ChestIcons.rare}</span><span>${escapeHtml(tn('welcome.chests', gift.chests))}</span></li>`,
    ];
    this.element.innerHTML = /* html */ `
      <div class="welcome-dialog__body">
        <span class="welcome-dialog__art" aria-hidden="true">${ChestIcons.legendary}</span>
        <h2 class="welcome-dialog__title" id="welcome-title">${escapeHtml(t('welcome.title'))}</h2>
        <p class="welcome-dialog__text" id="welcome-text">${escapeHtml(t('welcome.text'))}</p>
        <ul class="welcome-dialog__gifts">${lines.join('')}</ul>
        ${season ? `<p class="welcome-dialog__season"><span aria-hidden="true">${FloradaArt}</span><span>${escapeHtml(t('welcome.season', { name: seasonName(season.id) }))}</span></p>` : ''}
        <div class="account-actions">
          <button class="account-secondary" type="button" data-welcome="later">${escapeHtml(t('welcome.later'))}</button>
          <button class="account-submit" type="button" data-welcome="chests">${escapeHtml(t('welcome.openChests'))}</button>
        </div>
      </div>`;
  }
}
