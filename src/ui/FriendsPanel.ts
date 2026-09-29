import { onLocaleChange, t, tn, type MessageKey } from '../i18n';
import type { OnlineOutcome } from '../net/OnlinePlay';
import { FRIEND_NICK_MAX, canInvite, friendRoomBlock, type Friend, type FriendProfile, type FriendRequest } from '../online/Friends';
import type { Social } from '../online/Social';
import { clanTagHtml } from './clanText';
import { escapeHtml } from './html';
import { friendAvatar, friendWhere } from './friendText';
import { Icons } from './icons';

/** Recado embaixo de um amigo (resultado de "Chamar" ou de "Entrar"). */
interface RowNote {
  id: string;
  text: string;
  tone: 'ok' | 'error';
}

/**
 * A tela "Amigos" (dentro da placa "Jogar online"): adicionar pelo apelido,
 * pedidos recebidos (aceitar/recusar), os amigos com onde cada um está
 * ("Entrar" na sala dele, "Chamar" pra sua), pedidos enviados (cancelar) e os
 * bloqueados (desbloquear). Tirar e bloquear ficam no "⋯" de cada amigo, com
 * confirmação.
 *
 * O formulário é montado uma vez (digitar não é interrompido); só as listas se
 * redesenham, e o foco volta pro mesmo botão (`data-key`) depois de redesenhar.
 */
export class FriendsPanel {
  readonly element: HTMLElement;
  /** "← Jogar online". */
  onBack: (() => void) | null = null;
  /** "Entrar" na sala de um amigo (a placa online entra e mostra a sala). */
  onJoin: ((code: string) => Promise<OnlineOutcome>) | null = null;

  private readonly lists: HTMLElement;
  private readonly message: HTMLElement;
  private input!: HTMLInputElement;
  private addButton!: HTMLButtonElement;
  private draft = '';
  private adding = false;
  /** Ações em andamento (por amigo): os botões dele ficam desligados. */
  private readonly busy = new Set<string>();
  /** Amigo com o "⋯" aberto, e a confirmação pedida nele. */
  private expanded: string | null = null;
  private confirm: 'remove' | 'block' | null = null;
  private showBlocked = false;
  private note: RowNote | null = null;
  private lastHtml = '';
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly social: Social,
    /** Código da sala em que você está agora (null = fora de sala). */
    private readonly myRoom: () => string | null,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'friends';
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <div class="friends__top"></div>
      <form class="friends__add" novalidate></form>
      <div class="friends__lists" data-lists></div>`;
    this.lists = this.element.querySelector('[data-lists]') as HTMLElement;
    this.buildStatic();
    this.message = this.element.querySelector('[data-msg]') as HTMLElement;
    this.element.addEventListener('click', (e) => this.onClick(e));
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.add();
    });
    social.subscribe(() => {
      if (!this.element.hidden) this.render();
    });
    onLocaleChange(() => {
      this.buildStatic();
      this.render(true);
    });
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Mostra a tela (a lista busca na hora e se atualiza enquanto estiver aberta). */
  show(): void {
    this.element.hidden = false;
    this.unwatch ??= this.social.watch();
    this.render(true);
    this.input.focus({ preventScroll: true });
  }

  hide(): void {
    this.element.hidden = true;
    this.unwatch?.();
    this.unwatch = null;
    this.expanded = null;
    this.confirm = null;
    this.note = null;
  }

  /** Voltar e o formulário de adicionar (texto do idioma atual; o que já estava digitado continua). */
  private buildStatic(): void {
    const top = this.element.querySelector('.friends__top') as HTMLElement;
    top.innerHTML = /* html */ `
      <button class="friends__back" type="button" data-back data-key="back">${Icons.back}<span>${escapeHtml(t('friends.back'))}</span></button>`;
    const form = this.element.querySelector('.friends__add') as HTMLFormElement;
    const message = this.element.querySelector('[data-msg]');
    form.innerHTML = /* html */ `
      <label class="online__label" for="friends-nick">${escapeHtml(t('friends.addLabel'))}</label>
      <div class="online__join-row">
        <input class="field__input friends__nick" id="friends-nick" data-nick type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          maxlength="${FRIEND_NICK_MAX}" placeholder="${escapeHtml(t('friends.addPlaceholder'))}" aria-describedby="friends-msg" />
        <button class="account-submit friends__add-btn" type="submit" data-add>${Icons.userPlus}<span>${escapeHtml(t(this.adding ? 'friends.adding' : 'friends.add'))}</span></button>
      </div>
      <p class="friends__msg" id="friends-msg" data-msg role="status"></p>`;
    if (message) form.querySelector('[data-msg]')?.replaceWith(message);
    this.input = form.querySelector('[data-nick]') as HTMLInputElement;
    this.addButton = form.querySelector('[data-add]') as HTMLButtonElement;
    this.input.value = this.draft;
    this.input.addEventListener('input', () => {
      this.draft = this.input.value;
      this.syncAddButton();
    });
    this.syncAddButton();
  }

  private syncAddButton(): void {
    this.addButton.disabled = this.adding || this.draft.trim().length < 2;
  }

  private setMessage(text: string, tone: 'ok' | 'error' | 'info'): void {
    this.message.textContent = text;
    this.message.dataset.tone = tone;
  }

  private async add(): Promise<void> {
    const nick = this.draft.trim();
    if (this.adding || nick.length < 2) return;
    this.adding = true;
    this.syncAddButton();
    (this.addButton.querySelector('span') as HTMLElement).textContent = t('friends.adding');
    this.setMessage('', 'info');
    const { status, friend } = await this.social.addFriend(nick);
    this.adding = false;
    (this.addButton.querySelector('span') as HTMLElement).textContent = t('friends.add');
    const name = friend?.nickname ?? nick;
    const good = status === 'sent' || status === 'accepted';
    this.setMessage(t(`friends.add.${status}` as MessageKey, { name }), good ? 'ok' : status === 'already' || status === 'pending' ? 'info' : 'error');
    if (good) {
      this.draft = '';
      this.input.value = '';
    }
    this.syncAddButton();
    this.input.focus({ preventScroll: true });
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || target.hasAttribute('disabled')) return;
    const id = target.dataset.id ?? '';
    if (target.matches('[data-back]')) this.onBack?.();
    else if (target.matches('[data-retry]')) void this.social.refresh();
    else if (target.matches('[data-accept]')) void this.run(id, () => this.social.respond(id, true));
    else if (target.matches('[data-decline]')) void this.run(id, () => this.social.respond(id, false));
    else if (target.matches('[data-cancel-request]')) void this.run(id, () => this.social.remove(id));
    else if (target.matches('[data-unblock]')) void this.run(id, () => this.social.unblock(id));
    else if (target.matches('[data-toggle-blocked]')) {
      this.showBlocked = !this.showBlocked;
      this.render();
    } else if (target.matches('[data-more]')) {
      this.expanded = this.expanded === id ? null : id;
      this.confirm = null;
      this.render();
    } else if (target.matches('[data-ask]')) {
      this.confirm = target.dataset.ask === 'block' ? 'block' : 'remove';
      this.render();
    } else if (target.matches('[data-confirm-no]')) {
      this.confirm = null;
      this.render();
      this.focusKey(`more:${id}`);
    } else if (target.matches('[data-confirm-yes]')) {
      const action = this.confirm;
      this.expanded = null;
      this.confirm = null;
      void this.run(id, () => (action === 'block' ? this.social.block(id) : this.social.remove(id)));
    } else if (target.matches('[data-invite]')) void this.invite(id);
    else if (target.matches('[data-join]')) void this.join(id, target.dataset.join ?? '');
  }

  /** Uma ação num amigo: os botões dele travam até a lista voltar. */
  private async run(id: string, action: () => Promise<boolean>): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    this.note = null;
    this.render();
    const ok = await action();
    this.busy.delete(id);
    if (!ok) this.note = { id, text: t('friends.actionFailed'), tone: 'error' };
    this.render();
  }

  private async invite(id: string): Promise<void> {
    if (this.busy.has(id)) return;
    const friend = this.social.state.list?.friends.find((f) => f.id === id);
    this.busy.add(id);
    this.note = null;
    this.render();
    const status = await this.social.invite(id);
    this.busy.delete(id);
    this.note = status === 'sent' ? null : { id, text: t(`friends.invite.${status}` as MessageKey, { name: friend?.nickname ?? '' }), tone: 'error' };
    this.render();
    if (status === 'sent') this.focusKey(`more:${id}`);
  }

  private async join(id: string, code: string): Promise<void> {
    if (this.busy.has(id) || !this.onJoin) return;
    this.busy.add(id);
    this.note = null;
    this.render();
    const outcome = await this.onJoin(code);
    this.busy.delete(id);
    if (!outcome.ok) this.note = { id, text: t(`online.error.${outcome.error}` as MessageKey), tone: 'error' };
    this.render();
  }

  // --- Desenho --------------------------------------------------------------------------

  private render(force = false): void {
    const html = this.listsHtml();
    if (!force && html === this.lastHtml) return;
    this.lastHtml = html;
    const focused = document.activeElement instanceof HTMLElement && this.lists.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    this.lists.innerHTML = html;
    if (focused) this.focusKey(focused);
  }

  /** Foca o botão com essa chave (se ainda existir). */
  private focusKey(key: string): void {
    this.lists.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  private listsHtml(): string {
    const { list, failed } = this.social.state;
    if (!list) {
      return failed
        ? /* html */ `<p class="friends__note">${escapeHtml(t('friends.failed'))}</p>
          <button class="account-secondary" type="button" data-retry data-key="retry">${escapeHtml(t('friends.retry'))}</button>`
        : `<p class="friends__note friends__note--loading">${escapeHtml(t('friends.loading'))}</p>`;
    }
    const sections: string[] = [];
    if (list.incoming.length > 0) {
      sections.push(this.section('friends-incoming', t('friends.requests'), String(list.incoming.length), list.incoming.map((r) => this.requestRow(r)).join('')));
    }
    const online = list.friends.filter((f) => f.status !== 'offline').length;
    const friendsBody =
      list.friends.length > 0
        ? list.friends.map((f) => this.friendRow(f)).join('')
        : `<li class="friends__empty">${Icons.group}<p>${escapeHtml(t('friends.empty'))}</p></li>`;
    sections.push(this.section('friends-list', t('friends.list'), list.friends.length > 0 ? t('friends.onlineCount', { n: online }) : '', friendsBody));
    if (list.outgoing.length > 0) {
      sections.push(this.section('friends-outgoing', t('friends.outgoing'), String(list.outgoing.length), list.outgoing.map((r) => this.outgoingRow(r)).join('')));
    }
    if (list.blocked.length > 0) {
      const rows = this.showBlocked ? `<ul class="friends__list">${list.blocked.map((p) => this.blockedRow(p)).join('')}</ul>` : '';
      sections.push(/* html */ `
        <section class="friends__section friends__section--blocked">
          <button class="friends__toggle" type="button" data-toggle-blocked data-key="toggle-blocked" aria-expanded="${this.showBlocked}">
            ${Icons.block}<span>${escapeHtml(tn('friends.blockedCount', list.blocked.length))}</span>
          </button>
          ${rows}
        </section>`);
    }
    return sections.join('');
  }

  private section(id: string, title: string, meta: string, rows: string): string {
    return /* html */ `
      <section class="friends__section" aria-labelledby="${id}">
        <h3 class="online__label friends__title" id="${id}">${escapeHtml(title)}${meta ? ` <span class="friends__meta">${escapeHtml(meta)}</span>` : ''}</h3>
        <ul class="friends__list">${rows}</ul>
      </section>`;
  }

  private noteHtml(id: string): string {
    const note = this.note;
    return note && note.id === id ? `<p class="friend__note" data-tone="${note.tone}" role="alert">${escapeHtml(note.text)}</p>` : '';
  }

  private identity(profile: FriendProfile, where: string, status = 'offline'): string {
    return /* html */ `
      <span class="friend__avatar" data-status="${status}" aria-hidden="true">${friendAvatar(profile)}<span class="friend__dot"></span></span>
      <span class="friend__text">
        <strong class="friend__nick">${clanTagHtml(profile.tag)}${escapeHtml(profile.nickname)}</strong>
        ${where ? `<span class="friend__where">${escapeHtml(where)}</span>` : ''}
      </span>`;
  }

  private friendRow(friend: Friend): string {
    const id = friend.id;
    const busy = this.busy.has(id);
    const myRoom = this.myRoom();
    const disabled = busy ? 'disabled' : '';
    let action = '';
    if (friend.room && friendRoomBlock(friend, myRoom) === null) {
      action = `<button class="friend__btn friend__btn--primary" type="button" data-join="${escapeHtml(friend.room.code)}" data-id="${id}" data-key="join:${id}" ${disabled}>${Icons.enter}<span>${escapeHtml(t('friends.join'))}</span></button>`;
    } else if (canInvite(friend, myRoom)) {
      action = this.social.invitedRecently(id)
        ? `<span class="friend__done">${Icons.check}<span>${escapeHtml(t('friends.invited'))}</span></span>`
        : `<button class="friend__btn" type="button" data-invite data-id="${id}" data-key="invite:${id}" ${disabled}>${Icons.send}<span>${escapeHtml(t('friends.invite'))}</span></button>`;
    }
    const open = this.expanded === id;
    const more = `<button class="friend__more" type="button" data-more data-id="${id}" data-key="more:${id}" aria-expanded="${open}" aria-label="${escapeHtml(t('friends.more', { name: friend.nickname }))}" ${disabled}>${Icons.more}</button>`;
    let menu = '';
    if (open && this.confirm) {
      const question = t(this.confirm === 'block' ? 'friends.confirmBlock' : 'friends.confirmRemove', { name: friend.nickname });
      menu = /* html */ `
        <div class="friend__menu friend__menu--confirm" role="group" aria-label="${escapeHtml(question)}">
          <p class="friend__question">${escapeHtml(question)}</p>
          <div class="friend__menu-actions">
            <button class="friend__btn friend__btn--destroy" type="button" data-confirm-yes data-id="${id}" data-key="yes:${id}">${this.confirm === 'block' ? Icons.block : Icons.userMinus}<span>${escapeHtml(t(this.confirm === 'block' ? 'friends.block' : 'friends.remove'))}</span></button>
            <button class="friend__btn" type="button" data-confirm-no data-id="${id}" data-key="no:${id}">${escapeHtml(t('friends.confirmNo'))}</button>
          </div>
        </div>`;
    } else if (open) {
      menu = /* html */ `
        <div class="friend__menu">
          <button class="friend__btn" type="button" data-ask="remove" data-id="${id}" data-key="ask-remove:${id}">${Icons.userMinus}<span>${escapeHtml(t('friends.remove'))}</span></button>
          <button class="friend__btn friend__btn--danger" type="button" data-ask="block" data-id="${id}" data-key="ask-block:${id}">${Icons.block}<span>${escapeHtml(t('friends.block'))}</span></button>
        </div>`;
    }
    return /* html */ `
      <li class="friend${open ? ' is-open' : ''}" data-friend="${id}">
        <div class="friend__row">
          ${this.identity(friend, friendWhere(friend, myRoom), friend.status)}
          <span class="friend__actions"><span class="friend__cta">${action}</span>${more}</span>
        </div>
        ${menu}${this.noteHtml(id)}
      </li>`;
  }

  private requestRow(request: FriendRequest): string {
    const id = request.id;
    const disabled = this.busy.has(id) ? 'disabled' : '';
    return /* html */ `
      <li class="friend friend--request" data-request="${id}">
        <div class="friend__row">
          ${this.identity(request, t('friends.wantsYou'), 'request')}
          <span class="friend__actions"><span class="friend__cta">
            <button class="friend__btn friend__btn--primary" type="button" data-accept data-id="${id}" data-key="accept:${id}" ${disabled}>${Icons.check}<span>${escapeHtml(t('friends.accept'))}</span></button>
            <button class="friend__btn" type="button" data-decline data-id="${id}" data-key="decline:${id}" ${disabled}>${escapeHtml(t('friends.decline'))}</button>
          </span></span>
        </div>
        ${this.noteHtml(id)}
      </li>`;
  }

  private outgoingRow(request: FriendRequest): string {
    const id = request.id;
    const disabled = this.busy.has(id) ? 'disabled' : '';
    return /* html */ `
      <li class="friend" data-outgoing="${id}">
        <div class="friend__row">
          ${this.identity(request, t('friends.waiting'), 'pending')}
          <span class="friend__actions"><span class="friend__cta">
            <button class="friend__btn" type="button" data-cancel-request data-id="${id}" data-key="cancel:${id}" ${disabled}>${escapeHtml(t('friends.cancel'))}</button>
          </span></span>
        </div>
        ${this.noteHtml(id)}
      </li>`;
  }

  private blockedRow(profile: FriendProfile): string {
    const id = profile.id;
    const disabled = this.busy.has(id) ? 'disabled' : '';
    return /* html */ `
      <li class="friend" data-blocked="${id}">
        <div class="friend__row">
          ${this.identity(profile, '', 'blocked')}
          <span class="friend__actions"><span class="friend__cta">
            <button class="friend__btn" type="button" data-unblock data-id="${id}" data-key="unblock:${id}" ${disabled}>${escapeHtml(t('friends.unblock'))}</button>
          </span></span>
        </div>
        ${this.noteHtml(id)}
      </li>`;
  }
}
