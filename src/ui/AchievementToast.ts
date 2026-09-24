import { t } from '../i18n';
import type { Look } from '../progression/looks';
import type { AchievementUnlock } from '../progression/Progression';
import { GameIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';
import { achievementName } from './achievementText';
import { lookIcon } from './lookIcons';
import { lookName, looksNotice } from './lookText';

/** Quanto cada aviso fica na tela. */
const SHOW_MS = 3600;
/** Tempo da saída (tem que bater com a transição do CSS). */
const LEAVE_MS = 320;

/** Um aviso da fila: conquista feita ou achado raro pego no jardim. */
type Notice = { kind: 'achievement'; unlock: AchievementUnlock } | { kind: 'find'; look: Look };

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
    this.element.classList.toggle('is-find', notice.kind === 'find');
    this.element.innerHTML = notice.kind === 'achievement' ? this.achievementMarkup(notice.unlock) : this.findMarkup(notice.look);
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
    return /* html */ `
      <span class="achievement-toast__icon" aria-hidden="true">${Icons.trophy}</span>
      <span class="achievement-toast__text">
        <span class="achievement-toast__label">${escapeHtml(t('ach.unlocked'))}</span>
        <strong>${escapeHtml(achievementName(unlock.id))}</strong>
        <span class="achievement-toast__reward">${GameIcons.star}${escapeHtml(t('ach.reward', { xp: unlock.reward }))}${extra}</span>
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
