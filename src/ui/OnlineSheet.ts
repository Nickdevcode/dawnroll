import { onLocaleChange, t, type MessageKey } from '../i18n';
import { MAX_PLAYERS } from '../net/protocol';
import type { OnlineOutcome, OnlinePlay } from '../net/OnlinePlay';
import type { Online } from '../online/Online';
import { ROOM_CODE, normalizeRoomCode } from '../online/Rooms';
import { DEFAULT_SKIN, isSkinId, skin } from '../progression/skins';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { skinIcon } from './lookIcons';

/**
 * Placa "Jogar online" (dentro do menu). Três caras:
 *   - sem conta: explica por que precisa e leva pra conta;
 *   - com conta, fora de sala: criar sala ou entrar com o código;
 *   - numa sala: o código grande (copiar / mandar convite), quem está nela
 *     (com o casco de cada um, o dono com coroa) e ir pro jardim / sair.
 *
 * O link `?sala=CÓDIGO` abre esta placa já entrando na sala (ver `joinFromLink`).
 */
export class OnlineSheet {
  readonly element: HTMLElement;
  /** "Entrar na conta" (o menu abre a placa da conta). */
  onOpenAccount: (() => void) | null = null;
  /** "Ir pro jardim" (o menu fecha e o jogo começa/continua). */
  onPlay: (() => void) | null = null;

  private readonly body: HTMLElement;
  private net: OnlinePlay | null = null;
  private busy: 'create' | 'join' | 'leave' | null = null;
  private error: MessageKey | null = null;
  private codeDraft = '';
  private copiedTimer = 0;
  private copied = false;
  /** Pediram pra entrar numa sala pelo link antes de a conta/o jogo estarem prontos. */
  private pendingCode: string | null = null;

  constructor(private readonly online: Online) {
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--online';
    this.element.id = 'sheet-online';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-online-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-online-title" data-t="online.title"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="sheet__body online" data-body aria-live="polite"></div>`;
    this.body = this.element.querySelector('[data-body]') as HTMLElement;
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('input', (e) => this.onInput(e));
    this.body.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.join();
    });
    online.subscribe(() => {
      if (!this.element.hidden) this.render();
      if (this.pendingCode && online.player) void this.joinFromLink(this.pendingCode);
    });
    onLocaleChange(() => this.render());
  }

  /** O jogo terminou de montar o online: a placa passa a acompanhar a sala. */
  attach(net: OnlinePlay): void {
    this.net = net;
    net.subscribe(() => {
      if (!this.element.hidden) this.render();
    });
    if (this.pendingCode && this.online.player) void this.joinFromLink(this.pendingCode);
  }

  /** Abriu a placa. */
  prepare(): void {
    this.error = null;
    this.render();
    // Fora de sala, o foco vai direto no campo do código (quem abre pra entrar já digita).
    if (!this.net?.active) this.body.querySelector<HTMLInputElement>('[data-code]')?.focus({ preventScroll: true });
  }

  /**
   * Entrou pelo link `?sala=CÓDIGO`: tenta entrar assim que der (conta aberta e
   * jogo pronto). Sem conta, a placa mostra o "precisa de conta" e entra depois.
   */
  async joinFromLink(code: string): Promise<void> {
    const normalized = normalizeRoomCode(code);
    if (!ROOM_CODE.test(normalized)) return;
    this.codeDraft = normalized;
    if (!this.net || !this.online.player) {
      this.pendingCode = normalized;
      this.render();
      return;
    }
    this.pendingCode = null;
    await this.join();
  }

  private onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input.matches('[data-code]')) return;
    const clean = normalizeRoomCode(input.value);
    if (clean !== input.value) input.value = clean;
    this.codeDraft = clean;
    this.error = null;
    const submit = this.body.querySelector<HTMLButtonElement>('[data-join]');
    if (submit) submit.disabled = !ROOM_CODE.test(clean) || this.busy !== null;
    this.body.querySelector('[data-error]')?.replaceChildren();
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!target) return;
    if (target.matches('[data-sign-in]')) this.onOpenAccount?.();
    else if (target.matches('[data-create]')) void this.create();
    else if (target.matches('[data-copy]')) void this.copyCode();
    else if (target.matches('[data-share]')) void this.share();
    else if (target.matches('[data-play-room]')) this.onPlay?.();
    else if (target.matches('[data-leave]')) void this.leave();
  }

  private async create(): Promise<void> {
    if (!this.net || this.busy) return;
    this.busy = 'create';
    this.error = null;
    this.render();
    this.finish(await this.net.create());
  }

  private async join(): Promise<void> {
    if (!this.net || this.busy || !ROOM_CODE.test(this.codeDraft)) return;
    this.busy = 'join';
    this.error = null;
    this.render();
    this.finish(await this.net.join(this.codeDraft));
  }

  private async leave(): Promise<void> {
    if (!this.net || this.busy) return;
    this.busy = 'leave';
    this.render();
    await this.net.leave();
    this.busy = null;
    this.render();
  }

  private finish(outcome: OnlineOutcome): void {
    this.busy = null;
    this.error = outcome.ok ? null : (`online.error.${outcome.error}` as MessageKey);
    if (outcome.ok) this.codeDraft = '';
    this.render();
    // Deu certo: foco no "Ir pro jardim" (Enter/A já leva pro jogo).
    if (outcome.ok) this.body.querySelector<HTMLButtonElement>('[data-play-room]')?.focus({ preventScroll: true });
  }

  private roomLink(code: string): string {
    return `${location.origin}${location.pathname}?sala=${code}`;
  }

  private async copyCode(): Promise<void> {
    const code = this.net?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(this.roomLink(code));
    } catch {
      // Sem permissão de área de transferência (http, navegador antigo): o código está na tela.
      return;
    }
    this.copied = true;
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => {
      this.copied = false;
      if (!this.element.hidden) this.render();
    }, 1800);
    this.render();
  }

  /** Celular: a folha de compartilhar do sistema (WhatsApp etc.). Sem ela, copia o link. */
  private async share(): Promise<void> {
    const code = this.net?.code;
    if (!code) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Dawnroll', text: t('online.shareText', { code }), url: this.roomLink(code) });
        return;
      } catch {
        // Cancelou a folha: nada a fazer.
        return;
      }
    }
    await this.copyCode();
  }

  private render(): void {
    const player = this.online.player;
    const net = this.net;
    if (!player) {
      this.body.innerHTML = /* html */ `
        <p class="online__blurb">${escapeHtml(t('online.blurb'))}</p>
        <div class="online__notice">
          <span class="online__notice-icon" aria-hidden="true">${Icons.user}</span>
          <p>${escapeHtml(t('online.needAccount'))}</p>
        </div>
        <button class="account-submit online__wide" type="button" data-sign-in>${Icons.enter}<span>${escapeHtml(t('online.signIn'))}</span></button>`;
      return;
    }
    if (!net?.active) {
      this.renderHub();
      return;
    }
    this.renderRoom(net, player.userId);
  }

  private renderHub(): void {
    const busy = this.busy;
    const valid = ROOM_CODE.test(this.codeDraft);
    this.body.innerHTML = /* html */ `
      <p class="online__blurb">${escapeHtml(t('online.blurb'))}</p>
      <button class="account-submit online__wide" type="button" data-create ${busy ? 'disabled' : ''}>
        ${Icons.group}<span>${escapeHtml(t(busy === 'create' ? 'online.creating' : 'online.create'))}</span>
      </button>
      <form class="online__join" novalidate>
        <label class="online__label" for="online-code">${escapeHtml(t('online.joinLabel'))}</label>
        <div class="online__join-row">
          <input class="field__input online__code-input" id="online-code" data-code type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
            maxlength="12" placeholder="${escapeHtml(t('online.codePlaceholder'))}" value="${escapeHtml(this.codeDraft)}" ${busy ? 'disabled' : ''} />
          <button class="account-secondary" type="submit" data-join ${!valid || busy ? 'disabled' : ''}>
            <span>${escapeHtml(t(busy === 'join' ? 'online.joining' : 'online.join'))}</span>
          </button>
        </div>
      </form>
      <p class="online__error" data-error role="alert">${this.error ? escapeHtml(t(this.error)) : ''}</p>`;
  }

  private renderRoom(net: OnlinePlay, selfId: string): void {
    const code = net.code ?? '';
    const status = net.status;
    const players = net.players;
    const connecting = status === 'connecting' || status === 'reconnecting';
    const rows: string[] = [];
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const p = players[slot];
      if (!p) {
        rows.push(/* html */ `<li class="online__player is-empty"><span class="online__avatar" aria-hidden="true"></span><span class="online__nick">${escapeHtml(t('online.waiting'))}</span></li>`);
        continue;
      }
      const look = skin(isSkinId(p.look.skin) ? p.look.skin : DEFAULT_SKIN);
      const badges = [
        p.isHost ? `<span class="online__badge online__badge--host" title="${escapeHtml(t('online.host'))}">${Icons.crown}<span class="sr-only">${escapeHtml(t('online.host'))}</span></span>` : '',
        p.uid === selfId ? `<span class="online__badge">${escapeHtml(t('online.you'))}</span>` : '',
      ].join('');
      rows.push(/* html */ `
        <li class="online__player" data-slot="${p.slot}" tabindex="0" data-focusable>
          <span class="online__avatar" aria-hidden="true">${skinIcon(look)}</span>
          <span class="online__nick">${escapeHtml(p.nick)}</span>${badges}
        </li>`);
    }
    const ping = net.isHost ? '' : `<span class="online__ping" data-quality="${net.ping < 90 ? 'good' : net.ping < 180 ? 'ok' : 'bad'}">${Icons.signal}${escapeHtml(t('online.ping', { ms: net.ping || '–' }))}</span>`;
    this.body.innerHTML = /* html */ `
      <div class="online__room">
        <p class="online__label">${escapeHtml(t('online.code'))}</p>
        <p class="online__code" aria-label="${escapeHtml(code.split('').join(' '))}">${escapeHtml(code)}</p>
        <div class="online__code-actions">
          <button class="account-secondary" type="button" data-copy>${this.copied ? Icons.check : Icons.copy}<span>${escapeHtml(t(this.copied ? 'online.copied' : 'online.copy'))}</span></button>
          <button class="account-secondary" type="button" data-share>${Icons.share}<span>${escapeHtml(t('online.share'))}</span></button>
        </div>
        <p class="online__hint">${escapeHtml(t('online.inviteHint'))}</p>
      </div>
      <div class="online__players-head">
        <h3 class="online__label">${escapeHtml(t('online.players'))} <span class="online__count">${escapeHtml(t('online.playerCount', { n: players.length, max: MAX_PLAYERS }))}</span></h3>
        ${ping}
      </div>
      ${connecting ? `<p class="online__status">${escapeHtml(t(status === 'connecting' ? 'online.connecting' : 'online.reconnecting'))}</p>` : ''}
      <ul class="online__players">${rows.join('')}</ul>
      <div class="online__room-actions">
        <button class="account-submit online__wide" type="button" data-play-room ${connecting ? 'disabled' : ''}>${Icons.play}<span>${escapeHtml(t('online.play'))}</span></button>
        <button class="account-danger" type="button" data-leave ${this.busy ? 'disabled' : ''}>${Icons.logout}<span>${escapeHtml(t(this.busy === 'leave' ? 'online.leaving' : 'online.leave'))}</span></button>
      </div>`;
  }
}
