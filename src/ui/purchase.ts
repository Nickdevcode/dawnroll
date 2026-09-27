import { t } from '../i18n';
import type { Wallet } from '../progression/economy';
import { priceParts, type Currency, type Price } from '../progression/unlocks';
import { CurrencyIcons } from './economyIcons';
import { escapeHtml } from './html';
import { amountText, compactNumber } from './lookText';

/**
 * Comprar com dois toques: o primeiro "arma" o botão (vira "Confirmar"), o
 * segundo compra. Gasto não tem volta, e um clique sem querer no meio da
 * grade não pode sumir com 900 moedas. Armado, desarma sozinho depois de uns
 * segundos.
 */
export class PurchaseConfirm {
  private armedKey: string | null = null;
  private timer = 0;

  constructor(private readonly onChange: () => void) {}

  isArmed(key: string): boolean {
    return this.armedKey === key;
  }

  /** Primeiro toque arma (devolve false); o segundo, na mesma coisa, confirma (true). */
  press(key: string): boolean {
    if (this.armedKey === key) {
      this.reset();
      return true;
    }
    this.armedKey = key;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.armedKey = null;
      this.onChange();
    }, 4000);
    return false;
  }

  reset(): void {
    window.clearTimeout(this.timer);
    this.armedKey = null;
  }
}

/** Valor com o ícone da moeda (chip compacto). */
export function amountChip(currency: Currency, amount: number, extraClass = ''): string {
  return `<span class="amount amount--${currency}${extraClass ? ` ${extraClass}` : ''}"><span class="amount__icon" aria-hidden="true">${CurrencyIcons[currency]}</span><span class="amount__value">${escapeHtml(compactNumber(amount))}</span></span>`;
}

/**
 * Botão de comprar (ou o que falta pra poder). `armed` = já tocou uma vez.
 * O rótulo pro leitor de tela diz o preço por extenso.
 */
export function buyButton(price: Price, wallet: Readonly<Wallet>, armed: boolean, action = 'buy', attrs = ''): string {
  const { currency, amount } = priceParts(price);
  const missing = amount - wallet[currency];
  const label = armed ? t('shop.confirm', { price: amountText(currency, amount) }) : t('shop.buyFor', { price: amountText(currency, amount) });
  if (missing > 0) {
    return /* html */ `
      <button class="buy-button" type="button" disabled aria-label="${escapeHtml(label)}">${amountChip(currency, amount)}</button>
      <span class="buy-missing">${escapeHtml(t('shop.missing', { amount: amountText(currency, missing) }))}</span>`;
  }
  return /* html */ `
    <button class="buy-button${armed ? ' is-armed' : ''}" type="button" data-action="${action}" ${attrs} aria-label="${escapeHtml(label)}">
      <span class="buy-button__label">${escapeHtml(armed ? t('shop.confirmShort') : t('shop.buy'))}</span>${amountChip(currency, amount)}
    </button>`;
}

/** Carteira (moedas + orvalho) em chips, pro topo das placas. */
export function walletMarkup(wallet: Readonly<Wallet>): string {
  return /* html */ `
    <div class="wallet" role="group" aria-label="${escapeHtml(t('shop.wallet'))}">
      ${(['coins', 'dew'] as const)
        .map((currency) => {
          const text = escapeHtml(amountText(currency, Math.max(0, wallet[currency])));
          return `<span class="wallet__item" title="${text}"><span aria-hidden="true">${amountChip(currency, Math.max(0, wallet[currency]))}</span><span class="sr-only">${text}</span></span>`;
        })
        .join('')}
    </div>`;
}
