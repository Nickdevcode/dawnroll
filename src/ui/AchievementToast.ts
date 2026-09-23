import { t, type MessageKey } from '../i18n';
import type { AchievementUnlock } from '../progression/Progression';
import { GameIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';
import { achievementName } from './achievementText';

/** Quanto cada aviso fica na tela. */
const SHOW_MS = 3600;
/** Tempo da saída (tem que bater com a transição do CSS). */
const LEAVE_MS = 320;

/**
 * Aviso de conquista: um cartão que desliza no canto, em fila (várias de uma
 * vez aparecem uma depois da outra). Fica fora do HUD, por cima do menu: dá pra
 * fazer conquista comendo na toca, com o jogo pausado.
 */
export class AchievementToast {
  private readonly element: HTMLElement;
  private readonly queue: AchievementUnlock[] = [];
  private busy = false;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'achievement-toast';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    parent.append(this.element);
  }

  show(unlock: AchievementUnlock): void {
    this.queue.push(unlock);
    if (!this.busy) this.next();
  }

  private next(): void {
    const unlock = this.queue.shift();
    if (!unlock) {
      this.busy = false;
      return;
    }
    this.busy = true;
    let extra = unlock.levelAfter > unlock.levelBefore ? ` · ${escapeHtml(t('ach.levelUp', { n: unlock.levelAfter }))}` : '';
    // Conquista que libera casco: avisa junto (o casco novo é o prêmio de verdade).
    for (const id of unlock.skins) extra += ` · ${escapeHtml(t('ach.skin', { name: t(`skin.${id}.name` as MessageKey) }))}`;
    this.element.innerHTML = /* html */ `
      <span class="achievement-toast__icon" aria-hidden="true">${Icons.trophy}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('ach.unlocked'))}</span>
        <strong>${escapeHtml(achievementName(unlock.id))}</strong>
        <span class="achievement-toast__reward">${GameIcons.star}${escapeHtml(t('ach.reward', { xp: unlock.reward }))}${extra}</span>
      </span>`;
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
}
