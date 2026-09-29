import { onLocaleChange, t, tn, type MessageKey } from '../i18n';
import type { OnlineOutcome } from '../net/OnlinePlay';
import { friendRoomBlock } from '../online/Friends';
import {
  CLAN_NAME_MAX,
  CLAN_TAG,
  CLAN_TAG_MAX,
  cleanClanName,
  clanNameOk,
  normalizeClanTag,
  type ClanCard,
  type ClanInvite,
  type ClanMember,
  type FoundClan,
} from '../online/Clans';
import type { ClanStore } from '../online/ClanStore';
import type { Social } from '../online/Social';
import { clanTagHtml, memberWhere, weekText } from './clanText';
import { friendAvatar } from './friendText';
import { escapeHtml } from './html';
import { Icons } from './icons';

type Tone = 'ok' | 'error' | 'info';

/** Recado embaixo de uma linha (resultado de uma ação nela). */
interface RowNote {
  key: string;
  text: string;
  tone: Tone;
}

/**
 * A tela "Turma" (dentro da placa "Jogar online"), com duas caras:
 *   - sem turma: convites que chegaram (Entrar/Recusar), procurar pela tag
 *     (Entrar, se aberta) e criar uma (nome, tag e aberta/fechada);
 *   - com turma: o cartão (tag, nome, lotação, posição na semana), "Jogar com
 *     a turma", os membros (onde cada um está e a parte na semana; o líder tira
 *     e passa a liderança pelo ⋯, com confirmação), chamar amigos pra turma,
 *     abrir/fechar (líder) e sair.
 *
 * Os formulários são montados uma vez (digitar não é interrompido quando a
 * turma se atualiza sozinha); o resto se redesenha e o foco volta pro mesmo
 * botão (`data-key`).
 */
export class ClanPanel {
  readonly element: HTMLElement;
  /** "← Jogar online". */
  onBack: (() => void) | null = null;
  /**
   * "Jogar com a turma": a placa online cria a sala se precisar, chama quem
   * está online e mostra o lobby. Devolve o recado de erro (null = deu certo).
   */
  onPlay: (() => Promise<string | null>) | null = null;
  /** "Entrar" na sala de um colega que também é seu amigo. */
  onJoin: ((code: string) => Promise<OnlineOutcome>) | null = null;

  private readonly invitesEl: HTMLElement;
  private readonly formsEl: HTMLElement;
  private readonly clanEl: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchButton!: HTMLButtonElement;
  private searchMsg!: HTMLElement;
  private foundEl!: HTMLElement;
  private nameInput!: HTMLInputElement;
  private tagInput!: HTMLInputElement;
  private openSwitch!: HTMLButtonElement;
  private createButton!: HTMLButtonElement;
  private createMsg!: HTMLElement;
  private readonly draft = { search: '', name: '', tag: '', open: true };
  private searching = false;
  private creating = false;
  private found: FoundClan | null = null;
  /** Ações em andamento (por chave): os botões dela ficam desligados. */
  private readonly busy = new Set<string>();
  /** Membro com o "⋯" aberto, e a confirmação pedida nele. */
  private expanded: string | null = null;
  private confirm: 'kick' | 'promote' | null = null;
  private confirmLeave = false;
  private playing = false;
  private note: RowNote | null = null;
  private lastInvites = '';
  private lastClan = '';
  private unwatch: (() => void) | null = null;
  private unwatchFriends: (() => void) | null = null;

  constructor(
    private readonly clans: ClanStore,
    private readonly social: Social,
    /** Código da sala em que você está agora (null = fora de sala). */
    private readonly myRoom: () => string | null,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'friends clan';
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <div class="friends__top"></div>
      <div class="clan__invites" data-invites></div>
      <div class="clan__forms" data-forms></div>
      <div class="clan__mine" data-clan></div>`;
    this.invitesEl = this.element.querySelector('[data-invites]') as HTMLElement;
    this.formsEl = this.element.querySelector('[data-forms]') as HTMLElement;
    this.clanEl = this.element.querySelector('[data-clan]') as HTMLElement;
    this.buildStatic();
    this.element.addEventListener('click', (e) => this.onClick(e));
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLElement;
      if (form.matches('[data-search-form]')) void this.search();
      else if (form.matches('[data-create-form]')) void this.create();
    });
    clans.subscribe(() => {
      if (!this.element.hidden) this.render();
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

  /** Mostra a tela (a turma busca na hora e se atualiza enquanto estiver aberta). */
  show(): void {
    this.element.hidden = false;
    this.unwatch ??= this.clans.watch();
    // A lista de amigos serve pro "Chamar amigos pra turma" e pro "Entrar" do colega que é amigo.
    this.unwatchFriends ??= this.social.watch();
    this.render(true);
    const first = this.element.querySelector<HTMLElement>(this.clans.clan ? '[data-play]' : '[data-search]');
    first?.focus({ preventScroll: true });
  }

  hide(): void {
    this.element.hidden = true;
    this.unwatch?.();
    this.unwatch = null;
    this.unwatchFriends?.();
    this.unwatchFriends = null;
    this.expanded = null;
    this.confirm = null;
    this.confirmLeave = false;
    this.note = null;
  }

  // --- Formulários (montados uma vez) ----------------------------------------------------

  private buildStatic(): void {
    const top = this.element.querySelector('.friends__top') as HTMLElement;
    top.innerHTML = /* html */ `
      <button class="friends__back" type="button" data-back data-key="back">${Icons.back}<span>${escapeHtml(t('friends.back'))}</span></button>`;
    this.formsEl.innerHTML = /* html */ `
      <p class="online__blurb clan__blurb">${escapeHtml(t('clan.blurb'))}</p>
      <form class="friends__add clan__search" data-search-form novalidate>
        <label class="online__label" for="clan-search">${escapeHtml(t('clan.searchLabel'))}</label>
        <div class="online__join-row">
          <input class="field__input clan__tag-input" id="clan-search" data-search type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
            maxlength="${CLAN_TAG_MAX + 2}" placeholder="${escapeHtml(t('clan.tagPlaceholder'))}" aria-describedby="clan-search-msg" />
          <button class="account-submit friends__add-btn" type="submit" data-search-btn>${Icons.search}<span>${escapeHtml(t('clan.search'))}</span></button>
        </div>
        <p class="friends__msg" id="clan-search-msg" data-search-msg role="status"></p>
        <div class="clan__found" data-found></div>
      </form>
      <form class="clan__create" data-create-form novalidate>
        <h3 class="online__label">${escapeHtml(t('clan.createTitle'))}</h3>
        <div class="clan__fields">
          <div class="clan__field clan__field--name">
            <label class="online__label online__label--soft" for="clan-name">${escapeHtml(t('clan.nameLabel'))}</label>
            <input class="field__input" id="clan-name" data-name type="text" autocomplete="off" spellcheck="false" maxlength="${CLAN_NAME_MAX}"
              placeholder="${escapeHtml(t('clan.namePlaceholder'))}" aria-describedby="clan-create-msg" />
          </div>
          <div class="clan__field clan__field--tag">
            <label class="online__label online__label--soft" for="clan-tag">${escapeHtml(t('clan.tagLabel'))}</label>
            <input class="field__input clan__tag-input" id="clan-tag" data-tag type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
              maxlength="${CLAN_TAG_MAX}" placeholder="KHE" aria-describedby="clan-create-msg clan-tag-hint" />
          </div>
        </div>
        <p class="online__hint" id="clan-tag-hint">${escapeHtml(t('clan.tagHint'))}</p>
        <div class="online__rule">
          <div class="online__rule-text">
            <span class="online__rule-title" id="clan-open-title">${escapeHtml(t('clan.open'))}</span>
            <span class="online__rule-desc" id="clan-open-desc" data-open-desc></span>
          </div>
          <button class="switch" type="button" role="switch" aria-labelledby="clan-open-title" aria-describedby="clan-open-desc" data-open-switch><span class="switch__knob" aria-hidden="true"></span></button>
        </div>
        <button class="account-submit online__wide" type="submit" data-create>${Icons.flag}<span>${escapeHtml(t('clan.create'))}</span></button>
        <p class="friends__msg" id="clan-create-msg" data-create-msg role="status"></p>
      </form>`;
    this.searchInput = this.formsEl.querySelector('[data-search]') as HTMLInputElement;
    this.searchButton = this.formsEl.querySelector('[data-search-btn]') as HTMLButtonElement;
    this.searchMsg = this.formsEl.querySelector('[data-search-msg]') as HTMLElement;
    this.foundEl = this.formsEl.querySelector('[data-found]') as HTMLElement;
    this.nameInput = this.formsEl.querySelector('[data-name]') as HTMLInputElement;
    this.tagInput = this.formsEl.querySelector('[data-tag]') as HTMLInputElement;
    this.openSwitch = this.formsEl.querySelector('[data-open-switch]') as HTMLButtonElement;
    this.createButton = this.formsEl.querySelector('[data-create]') as HTMLButtonElement;
    this.createMsg = this.formsEl.querySelector('[data-create-msg]') as HTMLElement;
    this.searchInput.value = this.draft.search;
    this.nameInput.value = this.draft.name;
    this.tagInput.value = this.draft.tag;
    this.searchInput.addEventListener('input', () => {
      // Colar "[KHE]" ou digitar em minúscula vira a tag como ela é.
      const clean = normalizeClanTag(this.searchInput.value);
      if (clean !== this.searchInput.value) this.searchInput.value = clean;
      this.draft.search = clean;
      this.syncForms();
    });
    this.nameInput.addEventListener('input', () => {
      this.draft.name = this.nameInput.value;
      this.syncForms();
    });
    this.tagInput.addEventListener('input', () => {
      // A tag já nasce no formato: maiúscula, sem acento, sem espaço.
      const clean = normalizeClanTag(this.tagInput.value);
      if (clean !== this.tagInput.value) this.tagInput.value = clean;
      this.draft.tag = clean;
      this.syncForms();
    });
    this.renderFound();
    this.syncForms();
  }

  private syncForms(): void {
    this.searchButton.disabled = this.searching || !CLAN_TAG.test(normalizeClanTag(this.draft.search));
    this.createButton.disabled = this.creating || !clanNameOk(cleanClanName(this.draft.name)) || !CLAN_TAG.test(this.draft.tag);
    (this.searchButton.querySelector('span') as HTMLElement).textContent = t(this.searching ? 'clan.searching' : 'clan.search');
    (this.createButton.querySelector('span') as HTMLElement).textContent = t(this.creating ? 'clan.creating' : 'clan.create');
    this.openSwitch.setAttribute('aria-checked', String(this.draft.open));
    (this.formsEl.querySelector('[data-open-desc]') as HTMLElement).textContent = t(this.draft.open ? 'clan.openOn' : 'clan.openOff');
  }

  private setMessage(el: HTMLElement, text: string, tone: Tone): void {
    el.textContent = text;
    el.dataset.tone = tone;
  }

  private async search(): Promise<void> {
    const tag = normalizeClanTag(this.draft.search);
    if (this.searching || !CLAN_TAG.test(tag)) return;
    this.searching = true;
    this.found = null;
    this.renderFound();
    this.setMessage(this.searchMsg, '', 'info');
    this.syncForms();
    const { status, clan } = await this.clans.find(tag);
    this.searching = false;
    this.found = clan;
    this.syncForms();
    this.renderFound();
    if (!clan) this.setMessage(this.searchMsg, t(`clan.find.${status === 'found' ? 'unknown' : status}` as MessageKey, { tag }), 'error');
    this.foundEl.querySelector<HTMLElement>('[data-join-clan]')?.focus({ preventScroll: true });
  }

  private async create(): Promise<void> {
    const name = cleanClanName(this.draft.name);
    const tag = this.draft.tag;
    if (this.creating || !clanNameOk(name) || !CLAN_TAG.test(tag)) return;
    this.creating = true;
    this.setMessage(this.createMsg, '', 'info');
    this.syncForms();
    const status = await this.clans.create(name, tag, this.draft.open);
    this.creating = false;
    this.syncForms();
    if (status === 'ok') {
      this.draft.name = '';
      this.draft.tag = '';
      this.nameInput.value = '';
      this.tagInput.value = '';
      this.setMessage(this.createMsg, '', 'info');
      this.render(true);
      this.element.querySelector<HTMLElement>('[data-play]')?.focus({ preventScroll: true });
      return;
    }
    this.setMessage(this.createMsg, t(`clan.create.${status}` as MessageKey, { tag }), 'error');
    (status === 'invalid_tag' || status === 'blocked_tag' || status === 'taken_tag' ? this.tagInput : this.nameInput).focus({ preventScroll: true });
  }

  /** O cartão da turma achada (dentro do formulário da busca). */
  private renderFound(): void {
    const clan = this.found;
    if (!clan) {
      this.foundEl.innerHTML = '';
      return;
    }
    const busy = this.busy.has(`join:${clan.id}`);
    let action: string;
    if (clan.mine) action = `<span class="friend__done">${Icons.check}<span>${escapeHtml(t('clan.yours'))}</span></span>`;
    else if (clan.members >= clan.max) action = `<span class="clan__closed">${escapeHtml(t('clan.full'))}</span>`;
    else if (!clan.open && !clan.invited) action = `<span class="clan__closed">${Icons.lock}<span>${escapeHtml(t('clan.closedHint'))}</span></span>`;
    else action = `<button class="friend__btn friend__btn--primary" type="button" data-join-clan="${clan.id}" data-key="join-clan" ${busy ? 'disabled' : ''}>${Icons.enter}<span>${escapeHtml(t('clan.join'))}</span></button>`;
    this.foundEl.innerHTML = /* html */ `
      <div class="clan-card clan-card--found">
        ${this.cardHead(clan)}
        <div class="clan-card__actions">${action}</div>
        ${this.noteHtml('found')}
      </div>`;
  }

  // --- Ações -----------------------------------------------------------------------------

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || target.hasAttribute('disabled')) return;
    const id = target.dataset.id ?? '';
    if (target.matches('[data-back]')) this.onBack?.();
    else if (target.matches('[data-retry]')) void this.clans.refresh();
    else if (target.matches('[data-open-switch]')) {
      this.draft.open = !this.draft.open;
      this.syncForms();
    } else if (target.matches('[data-join-clan]')) void this.join(target.dataset.joinClan ?? '');
    else if (target.matches('[data-invite-yes]')) void this.respond(Number(target.dataset.inviteYes), true);
    else if (target.matches('[data-invite-no]')) void this.respond(Number(target.dataset.inviteNo), false);
    else if (target.matches('[data-play]')) void this.play();
    else if (target.matches('[data-clan-open]')) void this.run('open', () => this.clans.setOpen(!(this.clans.clan?.open ?? true)).then((s) => s === 'ok'));
    else if (target.matches('[data-more]')) {
      this.expanded = this.expanded === id ? null : id;
      this.confirm = null;
      this.render();
    } else if (target.matches('[data-ask]')) {
      this.confirm = target.dataset.ask === 'kick' ? 'kick' : 'promote';
      this.render();
    } else if (target.matches('[data-confirm-no]')) {
      this.confirm = null;
      this.render();
      this.focusKey(`more:${id}`);
    } else if (target.matches('[data-confirm-yes]')) {
      const action = this.confirm;
      this.expanded = null;
      this.confirm = null;
      void this.run(id, () => (action === 'kick' ? this.clans.kick(id) : this.clans.promote(id)).then((s) => s === 'ok'));
    } else if (target.matches('[data-call-friend]')) void this.inviteFriend(id);
    else if (target.matches('[data-member-join]')) void this.joinRoom(id, target.dataset.memberJoin ?? '');
    else if (target.matches('[data-leave]')) {
      this.confirmLeave = true;
      this.render();
      this.focusKey('leave-no');
    } else if (target.matches('[data-leave-no]')) {
      this.confirmLeave = false;
      this.render();
      this.focusKey('leave');
    } else if (target.matches('[data-leave-yes]')) {
      this.confirmLeave = false;
      void this.run('leave', () => this.clans.leave());
    }
  }

  /** Uma ação: os botões dela travam até a turma voltar. */
  private async run(key: string, action: () => Promise<boolean>): Promise<void> {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.note = null;
    this.render();
    const ok = await action();
    this.busy.delete(key);
    if (!ok) this.note = { key, text: t('friends.actionFailed'), tone: 'error' };
    this.render();
  }

  private async join(clanId: string): Promise<void> {
    const key = `join:${clanId}`;
    if (!clanId || this.busy.has(key)) return;
    this.busy.add(key);
    this.note = null;
    this.renderFound();
    const status = await this.clans.join(clanId);
    this.busy.delete(key);
    if (status === 'joined') {
      this.found = null;
      this.draft.search = '';
      this.searchInput.value = '';
      this.setMessage(this.searchMsg, '', 'info');
      this.renderFound();
      this.render(true);
      this.element.querySelector<HTMLElement>('[data-play]')?.focus({ preventScroll: true });
      return;
    }
    this.note = { key: 'found', text: t(`clan.join.${status}` as MessageKey), tone: 'error' };
    this.renderFound();
  }

  private async respond(inviteId: number, accept: boolean): Promise<void> {
    const invite = this.clans.invites.find((i) => i.id === inviteId);
    const key = `invite:${inviteId}`;
    if (!invite || this.busy.has(key)) return;
    this.busy.add(key);
    this.note = null;
    this.render();
    const status = await this.clans.respond(invite, accept);
    this.busy.delete(key);
    if (status !== 'joined' && status !== 'declined') this.note = { key, text: t(`clan.join.${status}` as MessageKey), tone: 'error' };
    this.render(true);
    if (status === 'joined') this.element.querySelector<HTMLElement>('[data-play]')?.focus({ preventScroll: true });
  }

  private async play(): Promise<void> {
    if (this.playing || !this.onPlay) return;
    this.playing = true;
    this.note = null;
    this.render();
    const error = await this.onPlay();
    this.playing = false;
    if (error) this.note = { key: 'play', text: error, tone: 'error' };
    this.render();
  }

  private async inviteFriend(id: string): Promise<void> {
    const key = `call:${id}`;
    if (this.busy.has(key)) return;
    const friend = this.social.state.list?.friends.find((f) => f.id === id);
    this.busy.add(key);
    this.note = null;
    this.render();
    const status = await this.clans.invite(id);
    this.busy.delete(key);
    if (status !== 'sent') {
      this.note = { key, text: t(`clan.invite.${status}` as MessageKey, { name: friend?.nickname ?? '' }), tone: 'error' };
      if (status === 'in_clan' || status === 'member') void this.social.refresh();
    }
    this.render();
    if (status === 'sent') this.focusKey('play');
  }

  private async joinRoom(id: string, code: string): Promise<void> {
    const key = `room:${id}`;
    if (this.busy.has(key) || !this.onJoin || !code) return;
    this.busy.add(key);
    this.note = null;
    this.render();
    const outcome = await this.onJoin(code);
    this.busy.delete(key);
    if (!outcome.ok) this.note = { key, text: t(`online.error.${outcome.error}` as MessageKey), tone: 'error' };
    this.render();
  }

  // --- Desenho ---------------------------------------------------------------------------

  private render(force = false): void {
    const mine = this.clans.state.mine;
    const inClan = !!mine?.clan;
    this.formsEl.hidden = inClan || !mine;
    const invitesHtml = this.invitesHtml();
    const clanHtml = this.clanHtml();
    const focused = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
    let redrawn = false;
    if (force || invitesHtml !== this.lastInvites) {
      this.lastInvites = invitesHtml;
      this.invitesEl.innerHTML = invitesHtml;
      redrawn = true;
    }
    if (force || clanHtml !== this.lastClan) {
      this.lastClan = clanHtml;
      this.clanEl.innerHTML = clanHtml;
      redrawn = true;
    }
    if (redrawn && focused) this.focusKey(focused);
  }

  private focusKey(key: string): void {
    this.element.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  private noteHtml(key: string): string {
    const note = this.note;
    return note && note.key === key ? `<p class="friend__note" data-tone="${note.tone}" role="alert">${escapeHtml(note.text)}</p>` : '';
  }

  /** Tag grande + nome + lotação e se é aberta (no cartão da minha turma, da busca e do convite). */
  private cardHead(clan: ClanCard): string {
    // "3º lugar na semana · 34 bolas" (sem posição: "34 bolas na semana" ou "Nada ainda nesta semana").
    const week = clan.rank ? `${t('clan.rank', { rank: clan.rank })} · ${tn('ranking.balls', clan.week)}` : weekText(clan.week);
    return /* html */ `
      <div class="clan-card__head">
        ${clanTagHtml(clan.tag, 'clan-tag--big')}
        <div class="clan-card__text">
          <strong class="clan-card__name">${escapeHtml(clan.name)}</strong>
          <span class="clan-card__meta">
            <span>${escapeHtml(t('clan.members', { n: clan.members, max: clan.max }))}</span>
            <span class="clan-card__access">${clan.open ? '' : Icons.lock}${escapeHtml(t(clan.open ? 'clan.isOpen' : 'clan.isClosed'))}</span>
          </span>
        </div>
      </div>
      <p class="clan-card__week">${Icons.podium}<span>${escapeHtml(week)}</span></p>`;
  }

  /** Convites que chegaram (só sem turma). */
  private invitesHtml(): string {
    const mine = this.clans.state.mine;
    if (!mine || mine.clan) return '';
    const invites = mine.invites.filter((i) => i.expiresAt > Date.now());
    if (invites.length === 0) return '';
    const rows = invites.map((invite) => this.inviteRow(invite)).join('');
    return /* html */ `
      <section class="friends__section" aria-labelledby="clan-invites-title">
        <h3 class="online__label friends__title" id="clan-invites-title">${escapeHtml(t('clan.invitesTitle'))} <span class="friends__meta">${invites.length}</span></h3>
        <ul class="friends__list">${rows}</ul>
      </section>`;
  }

  private inviteRow(invite: ClanInvite): string {
    const key = `invite:${invite.id}`;
    const disabled = this.busy.has(key) ? 'disabled' : '';
    return /* html */ `
      <li class="friend friend--request clan-invite">
        <div class="friend__row">
          <span class="friend__avatar" aria-hidden="true">${friendAvatar(invite.from)}</span>
          <span class="friend__text">
            <strong class="friend__nick">${escapeHtml(t('clan.invitedBy', { name: invite.from.nickname }))}</strong>
            <span class="friend__where">${clanTagHtml(invite.clan.tag)} ${escapeHtml(invite.clan.name)} · ${escapeHtml(t('clan.members', { n: invite.clan.members, max: invite.clan.max }))}</span>
          </span>
          <span class="friend__actions"><span class="friend__cta">
            <button class="friend__btn friend__btn--primary" type="button" data-invite-yes="${invite.id}" data-key="invite-yes:${invite.id}" ${disabled}>${Icons.enter}<span>${escapeHtml(t('clan.join'))}</span></button>
            <button class="friend__btn" type="button" data-invite-no="${invite.id}" data-key="invite-no:${invite.id}" ${disabled}>${escapeHtml(t('friends.decline'))}</button>
          </span></span>
        </div>
        ${this.noteHtml(key)}
      </li>`;
  }

  private clanHtml(): string {
    const { mine, failed } = this.clans.state;
    if (!mine) {
      return failed
        ? /* html */ `<p class="friends__note">${escapeHtml(t('clan.failed'))}</p>
          <button class="account-secondary" type="button" data-retry data-key="retry">${escapeHtml(t('friends.retry'))}</button>`
        : `<p class="friends__note friends__note--loading">${escapeHtml(t('clan.loading'))}</p>`;
    }
    const clan = mine.clan;
    if (!clan) return '';
    const leader = mine.role === 'leader';
    const inRoom = this.myRoom() !== null;
    const online = mine.members.filter((m) => m.status !== 'offline').length;
    const members = mine.members.map((m) => this.memberRow(m, leader)).join('');
    return /* html */ `
      <div class="clan-card">
        ${this.cardHead(clan)}
        <button class="account-submit online__wide clan-card__play" type="button" data-play data-key="play" ${this.playing ? 'disabled' : ''} aria-describedby="clan-play-desc">
          ${Icons.group}<span>${escapeHtml(t(this.playing ? 'clan.calling' : inRoom ? 'clan.callRoom' : 'clan.play'))}</span>
        </button>
        <p class="online__hint" id="clan-play-desc">${escapeHtml(t(inRoom ? 'clan.callRoomDesc' : 'clan.playDesc'))}</p>
        ${this.noteHtml('play')}
      </div>
      <section class="friends__section" aria-labelledby="clan-members-title">
        <h3 class="online__label friends__title" id="clan-members-title">${escapeHtml(t('clan.membersTitle'))} <span class="friends__meta">${escapeHtml(t('friends.onlineCount', { n: online }))}</span></h3>
        <ul class="friends__list">${members}</ul>
      </section>
      ${this.callFriendsHtml(clan)}
      ${leader ? this.settingsHtml(clan) : ''}
      ${this.leaveHtml(leader, clan)}`;
  }

  private memberRow(member: ClanMember, leader: boolean): string {
    const id = member.id;
    const self = id === this.selfId();
    const busy = this.busy.has(id);
    const disabled = busy ? 'disabled' : '';
    // O colega que também é seu amigo e está numa sala dá pra entrar (a amizade mostra o código; a turma, não).
    const friend = this.social.state.list?.friends.find((f) => f.id === id);
    const myRoom = this.myRoom();
    const join =
      friend?.room && friendRoomBlock(friend, myRoom) === null
        ? `<button class="friend__btn friend__btn--primary" type="button" data-member-join="${escapeHtml(friend.room.code)}" data-id="${id}" data-key="room:${id}" ${this.busy.has(`room:${id}`) ? 'disabled' : ''}>${Icons.enter}<span>${escapeHtml(t('friends.join'))}</span></button>`
        : '';
    const open = this.expanded === id;
    const canManage = leader && !self;
    const more = canManage
      ? `<button class="friend__more" type="button" data-more data-id="${id}" data-key="more:${id}" aria-expanded="${open}" aria-label="${escapeHtml(t('friends.more', { name: member.nickname }))}" ${disabled}>${Icons.more}</button>`
      : '';
    let menu = '';
    if (canManage && open && this.confirm) {
      const kick = this.confirm === 'kick';
      const question = t(kick ? 'clan.confirmKick' : 'clan.confirmPromote', { name: member.nickname });
      menu = /* html */ `
        <div class="friend__menu friend__menu--confirm" role="group" aria-label="${escapeHtml(question)}">
          <p class="friend__question">${escapeHtml(question)}</p>
          <div class="friend__menu-actions">
            <button class="friend__btn ${kick ? 'friend__btn--destroy' : 'friend__btn--primary'}" type="button" data-confirm-yes data-id="${id}" data-key="yes:${id}">${kick ? Icons.userMinus : Icons.crown}<span>${escapeHtml(t(kick ? 'clan.kick' : 'clan.promote'))}</span></button>
            <button class="friend__btn" type="button" data-confirm-no data-id="${id}" data-key="no:${id}">${escapeHtml(t('friends.confirmNo'))}</button>
          </div>
        </div>`;
    } else if (canManage && open) {
      menu = /* html */ `
        <div class="friend__menu">
          <button class="friend__btn" type="button" data-ask="promote" data-id="${id}" data-key="ask-promote:${id}">${Icons.crown}<span>${escapeHtml(t('clan.promote'))}</span></button>
          <button class="friend__btn friend__btn--danger" type="button" data-ask="kick" data-id="${id}" data-key="ask-kick:${id}">${Icons.userMinus}<span>${escapeHtml(t('clan.kick'))}</span></button>
        </div>`;
    }
    const role = member.role === 'leader' ? `<span class="clan__leader" title="${escapeHtml(t('clan.leader'))}">${Icons.crown}<span class="sr-only">${escapeHtml(t('clan.leader'))}</span></span>` : '';
    const you = self ? `<span class="online__badge">${escapeHtml(t('online.you'))}</span>` : '';
    return /* html */ `
      <li class="friend${open ? ' is-open' : ''}" data-member="${id}">
        <div class="friend__row">
          <span class="friend__avatar" data-status="${member.status}" aria-hidden="true">${friendAvatar(member)}<span class="friend__dot"></span></span>
          <span class="friend__text">
            <strong class="friend__nick clan__nick"><span class="clan__nick-text">${escapeHtml(member.nickname)}</span>${role}${you}</strong>
            <span class="friend__where">${escapeHtml(memberWhere(member.status))} · ${escapeHtml(weekText(member.week))}</span>
          </span>
          <span class="friend__actions"><span class="friend__cta">${join}</span>${more}</span>
        </div>
        ${menu}${this.noteHtml(id)}${this.noteHtml(`room:${id}`)}
      </li>`;
  }

  /** Amigos sem turma: "Chamar" pra sua (o convite vale 7 dias). */
  private callFriendsHtml(clan: ClanCard): string {
    const list = this.social.state.list;
    if (!list || clan.members >= clan.max) return '';
    const inClan = new Set(this.clans.state.mine?.members.map((m) => m.id) ?? []);
    const candidates = list.friends.filter((f) => !f.tag && !inClan.has(f.id));
    if (candidates.length === 0) return '';
    const rows = candidates
      .slice(0, 8)
      .map((friend) => {
        const key = `call:${friend.id}`;
        const action = this.clans.invitedRecently(friend.id)
          ? `<span class="friend__done">${Icons.check}<span>${escapeHtml(t('friends.invited'))}</span></span>`
          : `<button class="friend__btn" type="button" data-call-friend data-id="${friend.id}" data-key="${key}" ${this.busy.has(key) ? 'disabled' : ''}>${Icons.send}<span>${escapeHtml(t('friends.invite'))}</span></button>`;
        return /* html */ `
          <li class="friend">
            <div class="friend__row">
              <span class="friend__avatar" data-status="${friend.status}" aria-hidden="true">${friendAvatar(friend)}<span class="friend__dot"></span></span>
              <span class="friend__text"><strong class="friend__nick">${escapeHtml(friend.nickname)}</strong></span>
              <span class="friend__actions"><span class="friend__cta">${action}</span></span>
            </div>
            ${this.noteHtml(key)}
          </li>`;
      })
      .join('');
    return /* html */ `
      <section class="friends__section" aria-labelledby="clan-call-title">
        <h3 class="online__label friends__title" id="clan-call-title">${escapeHtml(t('clan.callFriends'))}</h3>
        <ul class="friends__list">${rows}</ul>
      </section>`;
  }

  /** Líder: aberta/fechada. */
  private settingsHtml(clan: ClanCard): string {
    const busy = this.busy.has('open');
    return /* html */ `
      <div class="online__rule clan__setting">
        <div class="online__rule-text">
          <span class="online__rule-title" id="clan-open-setting">${escapeHtml(t('clan.open'))}</span>
          <span class="online__rule-desc" id="clan-open-setting-desc">${escapeHtml(t(clan.open ? 'clan.openOn' : 'clan.openOff'))}</span>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="${clan.open}" aria-labelledby="clan-open-setting" aria-describedby="clan-open-setting-desc" data-clan-open data-key="clan-open" ${busy ? 'disabled' : ''}><span class="switch__knob" aria-hidden="true"></span></button>
      </div>
      ${this.noteHtml('open')}`;
  }

  private leaveHtml(leader: boolean, clan: ClanCard): string {
    const busy = this.busy.has('leave');
    if (!this.confirmLeave) {
      return /* html */ `
        <button class="account-danger clan__leave" type="button" data-leave data-key="leave" ${busy ? 'disabled' : ''}>${Icons.logout}<span>${escapeHtml(t('clan.leave'))}</span></button>
        ${this.noteHtml('leave')}`;
    }
    const question = clan.members <= 1 ? t('clan.confirmLeaveLast', { tag: clan.tag }) : leader ? t('clan.confirmLeaveLeader', { tag: clan.tag }) : t('clan.confirmLeave', { tag: clan.tag });
    return /* html */ `
      <div class="friend__menu friend__menu--confirm clan__leave-confirm" role="group" aria-label="${escapeHtml(question)}">
        <p class="friend__question">${escapeHtml(question)}</p>
        <div class="friend__menu-actions">
          <button class="friend__btn friend__btn--destroy" type="button" data-leave-yes data-key="leave-yes">${Icons.logout}<span>${escapeHtml(t('clan.leave'))}</span></button>
          <button class="friend__btn" type="button" data-leave-no data-key="leave-no">${escapeHtml(t('friends.confirmNo'))}</button>
        </div>
      </div>`;
  }

  private selfId(): string | null {
    return this.clans.selfId;
  }
}
