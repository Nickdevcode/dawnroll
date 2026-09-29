import { t } from '../i18n';
import type { FriendProfile, RoomInvite } from '../online/Friends';
import { escapeHtml } from './html';
import { friendAvatar, modeName } from './friendText';
import { Icons } from './icons';

/** Um aviso da fila: convite pra sala, pedido de amizade ou pedido aceito. */
type Notice = { kind: 'invite'; invite: RoomInvite } | { kind: 'request'; from: FriendProfile } | { kind: 'accepted'; from: FriendProfile };

/** Quanto cada aviso fica (o convite fica mais: dá tempo de terminar a jogada). */
const SHOW_MS: Record<Notice['kind'], number> = { invite: 20_000, request: 8000, accepted: 5000 };
/** No toque, a faixa (que cobre o topo do HUD) fica no máximo isso. */
const TOUCH_MAX_MS = 12_000;
/** Mouse ou foco em cima pausou; saiu: ainda fica mais esse tanto. */
const RESUME_MS = 5000;
/** Tempo da saída (tem que bater com a transição do CSS). */
const LEAVE_MS = 280;

/** De onde vem o atalho que a dica mostra. */
export type ToastDevice = 'keyboard' | 'gamepad' | 'touch';

/**
 * Aviso dos amigos no canto da tela, sem pausar nada (jogando ou no menu):
 *  - convite: "Fulano te chamou pra sala" com Entrar (tecla J, direcional →
 *    ou toque) e Agora não; some em 20 s (o convite continua na central
 *    online até vencer);
 *  - pedido de amizade (com "Ver", que abre os amigos) e pedido aceito.
 *
 * Um por vez, em fila; convite passa na frente dos outros avisos. Mouse ou foco
 * em cima segura o aviso na tela (ninguém perde o botão no meio do clique). O
 * texto também vai pra uma região "status" escondida (leitor de tela).
 */
export class InviteToast {
  readonly element: HTMLElement;
  /** Entrar na sala do convite. */
  onAccept: ((invite: RoomInvite) => void) | null = null;
  /** "Agora não". */
  onDismiss: ((invite: RoomInvite) => void) | null = null;
  /** "Ver" (pedido de amizade): abre os amigos. */
  onOpenFriends: (() => void) | null = null;

  private readonly card: HTMLElement;
  private readonly live: HTMLElement;
  private readonly queue: Notice[] = [];
  private current: Notice | null = null;
  private hideTimer = 0;
  private leaveTimer = 0;
  private held = false;

  constructor(
    parent: HTMLElement,
    private readonly device: () => ToastDevice,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'social-toast';
    this.element.innerHTML = /* html */ `
      <div class="social-toast__card" data-card hidden></div>
      <p class="sr-only" role="status" aria-live="polite" data-live></p>`;
    this.card = this.element.querySelector('[data-card]') as HTMLElement;
    this.live = this.element.querySelector('[data-live]') as HTMLElement;
    this.card.addEventListener('click', (e) => this.onClick(e));
    // Nada daqui vaza pro arrastar da câmera no toque (nem pro menu embaixo).
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
    const hold = () => this.hold(true);
    const release = () => this.hold(false);
    this.card.addEventListener('pointerenter', hold);
    this.card.addEventListener('pointerleave', release);
    this.card.addEventListener('focusin', hold);
    this.card.addEventListener('focusout', (e) => {
      if (!this.card.contains(e.relatedTarget as Node | null)) release();
    });
    parent.append(this.element);
  }

  /** Convite novo. O de um amigo que já estava na fila (ou na tela) é trocado pelo novo. */
  showInvite(invite: RoomInvite): void {
    const same = (n: Notice) => n.kind === 'invite' && n.invite.from.id === invite.from.id;
    const index = this.queue.findIndex(same);
    if (index >= 0) this.queue.splice(index, 1);
    if (this.current && same(this.current)) {
      this.current = { kind: 'invite', invite };
      this.draw();
      this.startTimer();
      return;
    }
    // Convite passa na frente dos outros avisos (pedido, aceito): ele vence.
    const firstInfo = this.queue.findIndex((n) => n.kind !== 'invite');
    this.queue.splice(firstInfo < 0 ? this.queue.length : firstInfo, 0, { kind: 'invite', invite });
    if (!this.current) this.next();
  }

  showRequest(from: FriendProfile): void {
    this.enqueue({ kind: 'request', from });
  }

  showAccepted(from: FriendProfile): void {
    this.enqueue({ kind: 'accepted', from });
  }

  /** O convite não vale mais (entrou pela central, venceu): sai da tela e da fila. */
  withdraw(inviteId: number): void {
    const index = this.queue.findIndex((n) => n.kind === 'invite' && n.invite.id === inviteId);
    if (index >= 0) this.queue.splice(index, 1);
    if (this.current?.kind === 'invite' && this.current.invite.id === inviteId) this.leave();
  }

  /** Atalho (J / direcional →): entra no convite da tela. Devolve se tinha um. */
  acceptShortcut(): boolean {
    if (this.current?.kind !== 'invite') return false;
    this.accept(this.current.invite);
    return true;
  }

  private enqueue(notice: Notice): void {
    this.queue.push(notice);
    if (!this.current) this.next();
  }

  private next(): void {
    window.clearTimeout(this.hideTimer);
    window.clearTimeout(this.leaveTimer);
    let notice = this.queue.shift() ?? null;
    // Convite que venceu esperando na fila não aparece.
    while (notice?.kind === 'invite' && notice.invite.expiresAt <= Date.now()) notice = this.queue.shift() ?? null;
    this.current = notice;
    if (!notice) {
      this.card.hidden = true;
      this.card.classList.remove('is-visible', 'is-leaving');
      return;
    }
    this.draw();
    this.card.hidden = false;
    this.card.classList.remove('is-leaving');
    // Próximo quadro: a transição de entrada roda.
    requestAnimationFrame(() => this.card.classList.add('is-visible'));
    this.live.textContent = this.spoken(notice);
    this.startTimer();
  }

  private startTimer(): void {
    window.clearTimeout(this.hideTimer);
    const notice = this.current;
    if (!notice || this.held) return;
    // No toque a faixa cobre o topo do HUD: fica menos (o convite continua na central até vencer).
    let ms = this.device() === 'touch' ? Math.min(SHOW_MS[notice.kind], TOUCH_MAX_MS) : SHOW_MS[notice.kind];
    if (notice.kind === 'invite') ms = Math.min(ms, notice.invite.expiresAt - Date.now());
    this.card.style.setProperty('--toast-ms', `${Math.max(0, ms)}ms`);
    this.card.classList.remove('is-timing');
    // Reinicia a barrinha do tempo.
    void this.card.offsetWidth;
    this.card.classList.add('is-timing');
    this.hideTimer = window.setTimeout(() => this.leave(), Math.max(0, ms));
  }

  private hold(on: boolean): void {
    if (this.held === on) return;
    this.held = on;
    this.card.classList.toggle('is-held', on);
    if (on) {
      window.clearTimeout(this.hideTimer);
      return;
    }
    const notice = this.current;
    if (!notice) return;
    const ms = notice.kind === 'invite' ? Math.min(RESUME_MS, notice.invite.expiresAt - Date.now()) : RESUME_MS;
    this.card.style.setProperty('--toast-ms', `${Math.max(0, ms)}ms`);
    this.card.classList.remove('is-timing');
    void this.card.offsetWidth;
    this.card.classList.add('is-timing');
    this.hideTimer = window.setTimeout(() => this.leave(), Math.max(0, ms));
  }

  private leave(): void {
    window.clearTimeout(this.hideTimer);
    if (!this.current) return;
    this.held = false;
    this.card.classList.remove('is-held');
    this.card.classList.add('is-leaving');
    this.card.classList.remove('is-visible');
    window.clearTimeout(this.leaveTimer);
    this.leaveTimer = window.setTimeout(() => this.next(), LEAVE_MS);
  }

  private accept(invite: RoomInvite): void {
    this.leave();
    this.onAccept?.(invite);
  }

  private onClick(e: Event): void {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const notice = this.current;
    if (!button || !notice) return;
    if (button.matches('[data-go]') && notice.kind === 'invite') this.accept(notice.invite);
    else if (button.matches('[data-see]')) {
      this.leave();
      this.onOpenFriends?.();
    } else if (button.matches('[data-dismiss]')) {
      if (notice.kind === 'invite') this.onDismiss?.(notice.invite);
      this.leave();
    }
  }

  private spoken(notice: Notice): string {
    if (notice.kind === 'invite') {
      const device = this.device();
      const key = device === 'keyboard' ? ` ${t('invite.spokenKey')}` : device === 'gamepad' ? ` ${t('invite.spokenPad')}` : '';
      return `${t('invite.label')}: ${t('invite.body', { name: notice.invite.from.nickname })} (${modeName(notice.invite.mode)}).${key}`;
    }
    if (notice.kind === 'request') return t('invite.requestBody', { name: notice.from.nickname });
    return t('invite.acceptedBody', { name: notice.from.nickname });
  }

  private draw(): void {
    const notice = this.current;
    if (!notice) return;
    this.card.dataset.kind = notice.kind;
    const who = notice.kind === 'invite' ? notice.invite.from : notice.from;
    const close = (label: string) =>
      `<button class="social-toast__close" type="button" data-dismiss aria-label="${escapeHtml(label)}">${Icons.close}</button>`;
    let label: string;
    let body: string;
    let actions: string;
    if (notice.kind === 'invite') {
      const device = this.device();
      const key = device === 'keyboard' ? `<kbd class="keycap social-toast__key">J</kbd>` : device === 'gamepad' ? `<kbd class="keycap social-toast__key">→</kbd>` : '';
      label = `${t('invite.label')} · ${modeName(notice.invite.mode)}`;
      body = t('invite.body', { name: who.nickname });
      actions = /* html */ `
        <button class="social-toast__go" type="button" data-go>${Icons.enter}<span>${escapeHtml(t('invite.join'))}</span>${key}</button>
        ${close(t('invite.dismiss'))}`;
    } else if (notice.kind === 'request') {
      label = t('invite.requestLabel');
      body = t('invite.requestBody', { name: who.nickname });
      actions = /* html */ `
        <button class="social-toast__go social-toast__go--soft" type="button" data-see>${Icons.userPlus}<span>${escapeHtml(t('invite.see'))}</span></button>
        ${close(t('invite.close'))}`;
    } else {
      label = t('invite.acceptedLabel');
      body = t('invite.acceptedBody', { name: who.nickname });
      actions = close(t('invite.close'));
    }
    this.card.innerHTML = /* html */ `
      <span class="social-toast__avatar" aria-hidden="true">${friendAvatar(who)}</span>
      <span class="social-toast__text">
        <span class="social-toast__label">${escapeHtml(label)}</span>
        <strong class="social-toast__body">${escapeHtml(body)}</strong>
      </span>
      <span class="social-toast__actions">${actions}</span>
      <span class="social-toast__timer" aria-hidden="true"></span>`;
  }
}
