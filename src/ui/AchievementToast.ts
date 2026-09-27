import { t } from '../i18n';
import type { Look } from '../progression/looks';
import type { AchievementUnlock } from '../progression/Progression';
import { GameIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';
import { achievementName } from './achievementText';
import { lookIcon } from './lookIcons';
import { chestName, lookName, looksNotice } from './lookText';
import type { Rarity } from '../progression/unlocks';
import { rarityRank } from '../progression/economy';
import { ChestIcons, CurrencyIcons, PassIcon } from './economyIcons';
import { formatInteger } from '../i18n';

/** Quanto cada aviso fica na tela. */
const SHOW_MS = 3600;
/** Tempo da saída (tem que bater com a transição do CSS). */
const LEAVE_MS = 320;

/** Um aviso da fila: conquista feita, achado raro pego no jardim, baú ganho ou nível do passe. */
type Notice =
  | { kind: 'achievement'; unlock: AchievementUnlock }
  | { kind: 'find'; look: Look }
  | { kind: 'chests'; rarities: readonly Rarity[] }
  | { kind: 'pass'; tier: number };

/**
 * Aviso de conquista: um cartão que desliza no canto, em fila (várias de uma
 * vez aparecem uma depois da outra). Fica fora do HUD, por cima do menu: dá pra
 * fazer conquista comendo na toca, com o jogo pausado. O achado raro do jardim
 * usa o mesmo cartão, com a figurinha do acessório no lugar do troféu.
 */
export class AchievementToast {
  private readonly element: HTMLElement;
  private readonly queue: Notice[] = [];
  private busy = false;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'achievement-toast';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    parent.append(this.element);
  }

  show(unlock: AchievementUnlock): void {
    this.enqueue({ kind: 'achievement', unlock });
  }

  /** Achado raro: o besouro pegou um acessório no jardim. */
  showFind(look: Look): void {
    this.enqueue({ kind: 'find', look });
  }

  /** Subiu de nível: um baú por nível (o aviso mostra o mais raro e quantos são). */
  showChests(rarities: readonly Rarity[]): void {
    if (rarities.length > 0) this.enqueue({ kind: 'chests', rarities });
  }

  /** Subiu de nível no passe da temporada. */
  showPassTier(tier: number): void {
    this.enqueue({ kind: 'pass', tier });
  }

  private enqueue(notice: Notice): void {
    this.queue.push(notice);
    if (!this.busy) this.next();
  }

  private next(): void {
    const notice = this.queue.shift();
    if (!notice) {
      this.busy = false;
      return;
    }
    this.busy = true;
    this.element.classList.toggle('is-find', notice.kind === 'find' || notice.kind === 'chests' || notice.kind === 'pass');
    this.element.innerHTML =
      notice.kind === 'achievement'
        ? this.achievementMarkup(notice.unlock)
        : notice.kind === 'find'
          ? this.findMarkup(notice.look)
          : notice.kind === 'chests'
            ? this.chestsMarkup(notice.rarities)
            : this.passMarkup(notice.tier);
    this.element.classList.remove('is-leaving');
    this.element.classList.add('is-visible');
    window.setTimeout(() => {
      this.element.classList.add('is-leaving');
      window.setTimeout(() => {
        this.element.classList.remove('is-visible', 'is-leaving');
        this.next();
      }, LEAVE_MS);
    }, SHOW_MS);
  }

  private achievementMarkup(unlock: AchievementUnlock): string {
    let extra = unlock.levelAfter > unlock.levelBefore ? ` · ${escapeHtml(t('ach.levelUp', { n: unlock.levelAfter }))}` : '';
    // Conquista que libera visual (casco, acessório): avisa junto (é o prêmio de verdade).
    if (unlock.looks.length > 0) extra += ` · ${escapeHtml(looksNotice(unlock.looks))}`;
    // O nível que ela deu trouxe baú.
    if (unlock.chests.length > 0) extra += ` · ${escapeHtml(t('toast.chest.label'))}`;
    // Moedas (e orvalho) que ela pagou.
    const pay =
      `<span class="toast-amount">${CurrencyIcons.coins}+${escapeHtml(formatInteger(unlock.pay.coins))}</span>` +
      (unlock.pay.dew > 0 ? `<span class="toast-amount">${CurrencyIcons.dew}+${escapeHtml(formatInteger(unlock.pay.dew))}</span>` : '');
    return /* html */ `
      <span class="achievement-toast__icon" aria-hidden="true">${Icons.trophy}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('ach.unlocked'))}</span>
        <strong>${escapeHtml(achievementName(unlock.id))}</strong>
        <span class="achievement-toast__reward">${GameIcons.star}${escapeHtml(t('ach.reward', { xp: unlock.reward }))}${pay}${extra}</span>
      </span>`;
  }

  private chestsMarkup(rarities: readonly Rarity[]): string {
    const best = [...rarities].sort((a, b) => rarityRank(b) - rarityRank(a))[0];
    const name = rarities.length > 1 ? `${chestName(best)} +${rarities.length - 1}` : chestName(best);
    return /* html */ `
      <span class="achievement-toast__icon achievement-toast__icon--find" aria-hidden="true">${ChestIcons[best]}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('toast.chest.label'))}</span>
        <strong>${escapeHtml(name)}</strong>
        <span class="achievement-toast__reward">${escapeHtml(t('toast.chest.body'))}</span>
      </span>`;
  }

  private passMarkup(tier: number): string {
    return /* html */ `
      <span class="achievement-toast__icon achievement-toast__icon--find" aria-hidden="true">${PassIcon}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('toast.pass.label'))}</span>
        <strong>${escapeHtml(t('toast.pass.body', { n: tier }))}</strong>
      </span>`;
  }

  private findMarkup(look: Look): string {
    return /* html */ `
      <span class="achievement-toast__icon achievement-toast__icon--find" aria-hidden="true">${lookIcon(look)}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('find.label'))}</span>
        <strong>${escapeHtml(lookName(look))}</strong>
        <span class="achievement-toast__reward">${GameIcons.sparkle}${escapeHtml(t('find.body'))}</span>
      </span>`;
  }
}
