import { onLocaleChange, t, tn, type MessageKey } from '../i18n';
import { MAX_PLAYERS, effectiveRules, type NetRules, type RoomModeId } from '../net/protocol';
import type { OnlineOutcome, OnlinePlay, OnlinePlayer } from '../net/OnlinePlay';
import { MATCH_MINUTES, timeLeft } from '../net/match';
import { TEAM_SIZES, teamCount, type TeamSize } from '../net/teams';
import type { CallClanStatus } from '../online/Clans';
import type { ClanStore } from '../online/ClanStore';
import { canInvite, type RoomInvite } from '../online/Friends';
import type { Online } from '../online/Online';
import { ROOM_CODE, normalizeRoomCode } from '../online/Rooms';
import type { Social } from '../online/Social';
import { DEFAULT_SKIN, isSkinId, skin } from '../progression/skins';
import { ClanPanel } from './ClanPanel';
import { clanTagHtml, taggedName } from './clanText';
import { FriendsPanel } from './FriendsPanel';
import { friendAvatar, friendWhere, modeName } from './friendText';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { skinIcon } from './lookIcons';
import { MatchIcons, TEAM_ICONS } from './matchIcons';
import { formatClock, teamName } from './MatchHud';

/** Quantos amigos o lobby mostra em "Chamar amigos" (o resto fica em "Todos os amigos"). */
const CALL_LIST_MAX = 4;

/** Como achar o mesmo controle depois de redesenhar: o id, ou o primeiro `data-*` dele (com o valor). */
function focusSelector(el: HTMLElement): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attr = [...el.attributes].find((a) => a.name.startsWith('data-'));
  return attr ? `${el.tagName.toLowerCase()}[${attr.name}="${CSS.escape(attr.value)}"]` : null;
}

/**
 * Placa "Jogar online" (dentro do menu). Três caras:
 *   - sem conta: explica por que precisa e leva pra conta;
 *   - com conta, fora de sala: convites que chegaram, procurar partida
 *     (Jardim livre ou Disputa), amigos, criar sala ou entrar com o código;
 *   - numa sala (o lobby): o código grande (copiar / mandar convite), o modo,
 *     o tempo e os times (o dono escolhe; os outros veem), quem está em cada
 *     time, chamar amigos, "Começar disputa" (dono) e ir pro jardim / sair.
 * E as telas "Amigos" (`FriendsPanel`) e "Turma" (`ClanPanel`), que abrem por
 * cima dessas com o voltar.
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
  private readonly title: HTMLElement;
  private readonly friends: FriendsPanel;
  private readonly clan: ClanPanel;
  private net: OnlinePlay | null = null;
  private busy: 'create' | 'join' | 'leave' | 'quick-garden' | 'quick-match' | null = null;
  /** Amigos com "Chamar" em andamento (lobby) e o recado do último que falhou. */
  private readonly calling = new Set<string>();
  private callNote: { id: string; text: string } | null = null;
  /** Resultado do último "Chamar a turma" (no lobby). */
  private clanNote: { text: string; tone: 'ok' | 'error' } | null = null;
  private callingClan = false;
  private unwatch: (() => void) | null = null;
  private error: MessageKey | null = null;
  private codeDraft = '';
  private copiedTimer = 0;
  private copied = false;
  /** Pediram pra entrar numa sala pelo link antes de a conta/o jogo estarem prontos. */
  private pendingCode: string | null = null;
  /** Último HTML desenhado: redesenhar igual não mexe no DOM (nem no foco, nem nas animações). */
  private lastHtml = '';

  constructor(
    private readonly online: Online,
    private readonly social: Social,
    private readonly clans: ClanStore,
  ) {
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--online';
    this.element.id = 'sheet-online';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-online-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-online-title"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="sheet__body" data-scroll>
        <div class="online" data-body aria-live="polite"></div>
      </div>`;
    this.title = this.element.querySelector('#sheet-online-title') as HTMLElement;
    this.body = this.element.querySelector('[data-body]') as HTMLElement;
    this.friends = new FriendsPanel(social, () => (this.net?.active ? this.net.code : null));
    this.friends.onBack = () => this.showMain(true);
    this.friends.onJoin = (code) => this.joinCode(code);
    this.clan = new ClanPanel(clans, social, () => (this.net?.active ? this.net.code : null));
    this.clan.onBack = () => this.showMain(true, '[data-clan]');
    this.clan.onJoin = (code) => this.joinCode(code);
    this.clan.onPlay = () => this.playWithClan();
    this.element.querySelector('[data-scroll]')?.append(this.friends.element, this.clan.element);
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.body.addEventListener('input', (e) => this.onInput(e));
    this.body.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.join();
    });
    online.subscribe(() => {
      if (!this.element.hidden) this.render();
      if (this.pendingCode && online.player) void this.joinFromLink(this.pendingCode);
      // Saiu da conta com os amigos (ou a turma) abertos: volta pra central (que explica a conta).
      if (!online.player && (this.friends.visible || this.clan.visible)) this.showMain(false);
    });
    social.subscribe(() => {
      if (!this.element.hidden && !this.subPanelOpen) this.render();
    });
    clans.subscribe(() => {
      if (!this.element.hidden && !this.subPanelOpen) this.render();
    });
    onLocaleChange(() => {
      this.syncTitle();
      this.render(true);
    });
    this.syncTitle();
    // O relógio da Disputa anda sem a sala avisar: só o texto dele muda.
    window.setInterval(() => this.tickClock(), 1000);
  }

  /** O jogo terminou de montar o online: a placa passa a acompanhar a sala. */
  attach(net: OnlinePlay): void {
    this.net = net;
    net.subscribe(() => {
      if (!this.element.hidden) this.render();
    });
    if (this.pendingCode && this.online.player) void this.joinFromLink(this.pendingCode);
  }

  /** Abriu a placa (sempre na central/lobby; a lista de amigos passa a se atualizar sozinha). */
  prepare(): void {
    this.error = null;
    this.callNote = null;
    this.clanNote = null;
    this.unwatch ??= this.social.watch();
    this.showMain(false);
    this.render(true);
    // Fora de sala, o foco vai direto no campo do código (quem abre pra entrar já digita).
    if (!this.net?.active) this.body.querySelector<HTMLInputElement>('[data-code]')?.focus({ preventScroll: true });
  }

  /** Fechou a placa. */
  close(): void {
    this.unwatch?.();
    this.unwatch = null;
    this.friends.hide();
    this.clan.hide();
  }

  /** A tela Amigos ou Turma está por cima da central/lobby. */
  private get subPanelOpen(): boolean {
    return this.friends.visible || this.clan.visible;
  }

  /** A tela dos amigos (pelo botão da central, do lobby ou pelo "Ver" do aviso de pedido). */
  showFriends(): void {
    if (!this.online.player) return;
    this.body.hidden = true;
    this.clan.hide();
    this.friends.show();
    this.syncTitle();
  }

  /** A tela da turma (pelo botão da central ou pelo "Ver" do aviso de convite pra turma). */
  showClan(): void {
    if (!this.online.player) return;
    this.body.hidden = true;
    this.friends.hide();
    this.clan.show();
    this.syncTitle();
  }

  /** Mostra a central/lobby (sai da tela Amigos, se estiver nela) e põe o foco no "Ir pro jardim" da sala. */
  showLobby(): void {
    this.showMain(false);
    this.body.querySelector<HTMLButtonElement>('[data-play-room]')?.focus({ preventScroll: true });
  }

  /** Volta da tela dos amigos (ou da turma) pra central/lobby; `focus` = o botão que abriu a tela. */
  private showMain(focusBack: boolean, focus = '[data-friends]'): void {
    if (!this.subPanelOpen && !this.body.hidden) return;
    this.friends.hide();
    this.clan.hide();
    this.body.hidden = false;
    this.syncTitle();
    this.render(true);
    if (focusBack) this.body.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private syncTitle(): void {
    this.title.textContent = t(this.friends.visible ? 'friends.title' : this.clan.visible ? 'clan.title' : 'online.title');
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
    if (!target || target.hasAttribute('disabled')) return;
    const net = this.net;
    if (target.matches('[data-sign-in]')) this.onOpenAccount?.();
    else if (target.matches('[data-friends]')) this.showFriends();
    else if (target.matches('[data-clan]')) this.showClan();
    else if (target.matches('[data-call-clan]')) void this.callClan();
    else if (target.matches('[data-invite-join]')) void this.acceptInvite(Number(target.dataset.inviteJoin));
    else if (target.matches('[data-invite-dismiss]')) this.dismissInvite(Number(target.dataset.inviteDismiss));
    else if (target.matches('[data-call]')) void this.call(target.dataset.call ?? '');
    else if (target.matches('[data-create]')) void this.create();
    else if (target.matches('[data-quick]')) void this.quick(target.dataset.quick === 'match' ? 'match' : 'garden');
    else if (target.matches('[data-copy]')) void this.copyCode();
    else if (target.matches('[data-share]')) void this.share();
    else if (target.matches('[data-play-room]')) this.onPlay?.();
    else if (target.matches('[data-leave]')) void this.leave();
    else if (!net) return;
    else if (target.matches('[data-rule-steal]') && net.isHost) this.setRule({ steal: !net.rules.steal }, '[data-rule-steal]');
    else if (target.matches('[data-mode]') && net.isHost) this.setRule({ mode: target.dataset.mode === 'match' ? 'match' : 'garden' }, `[data-mode="${target.dataset.mode}"]`);
    else if (target.matches('[data-minutes]') && net.isHost) {
      const minutes = Number(target.dataset.minutes);
      if (minutes === 3 || minutes === 5 || minutes === 8) this.setRule({ minutes }, `[data-minutes="${minutes}"]`);
    } else if (target.matches('[data-team-size]') && net.isHost) {
      const size = Number(target.dataset.teamSize);
      if (size === 1 || size === 2 || size === 3) this.setRule({ teamSize: size }, `[data-team-size="${size}"]`);
    } else if (target.matches('[data-team-join]')) {
      net.chooseTeam(Number(target.dataset.teamJoin));
    } else if (target.matches('[data-shuffle]')) net.shuffleTeams();
    else if (target.matches('[data-start]')) {
      if (net.startMatch()) this.onPlay?.();
    }
  }

  /** Setas dentro de um grupo segmentado (padrão WAI-ARIA do rádio): anda e já escolhe. */
  private onKeyDown(e: KeyboardEvent): void {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    const group = option?.closest('[role="radiogroup"]');
    if (!option || !group) return;
    const options = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])')];
    const index = options.indexOf(option);
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    options[next]?.click();
  }

  /** Dono mudou uma regra: a sala fica sabendo e o foco volta pro controle (a placa foi redesenhada). */
  private setRule(change: Partial<NetRules>, focus: string): void {
    const net = this.net;
    if (!net?.isHost) return;
    net.setRules(change);
    this.render();
    this.body.querySelector<HTMLButtonElement>(focus)?.focus({ preventScroll: true });
  }

  private async create(): Promise<void> {
    if (!this.net || this.busy) return;
    this.busy = 'create';
    this.error = null;
    this.render();
    this.finish(await this.net.create());
  }

  private async quick(mode: RoomModeId): Promise<void> {
    if (!this.net || this.busy) return;
    this.busy = mode === 'match' ? 'quick-match' : 'quick-garden';
    this.error = null;
    this.render();
    const outcome = await this.net.quickMatch(mode);
    this.finish(outcome);
    // Procurar partida é "já quero jogar": entrou, vai direto pro jardim.
    if (outcome.ok) this.onPlay?.();
  }

  private async join(): Promise<void> {
    if (ROOM_CODE.test(this.codeDraft)) await this.joinCode(this.codeDraft);
  }

  /** Entra numa sala pelo código (digitado, do link, do convite ou a do amigo) e mostra o lobby. */
  private async joinCode(code: string): Promise<OnlineOutcome> {
    if (!this.net) return { ok: false, error: 'connect' };
    // Outra ação da placa em andamento (procurando partida, saindo): não empilha.
    if (this.busy) return { ok: false, error: 'unknown' };
    this.busy = 'join';
    this.error = null;
    this.render();
    const outcome = await this.net.join(code);
    if (outcome.ok && this.subPanelOpen) this.showMain(false);
    this.finish(outcome);
    return outcome;
  }

  /** "Entrar" num convite da central. */
  private async acceptInvite(id: number): Promise<void> {
    const invite = this.social.state.invites.find((i) => i.id === id);
    if (!invite) return;
    const outcome = await this.joinCode(invite.code);
    // Sala que não existe mais / cheia / Disputa travada: o convite não serve mais.
    if (outcome.ok || (outcome.error !== 'offline' && outcome.error !== 'rate_limited')) this.social.dismiss(invite);
  }

  private dismissInvite(id: number): void {
    const invite = this.social.state.invites.find((i) => i.id === id);
    if (invite) this.social.dismiss(invite);
  }

  /** "Chamar" um amigo no lobby. */
  private async call(id: string): Promise<void> {
    if (!id || this.calling.has(id)) return;
    const friend = this.social.state.list?.friends.find((f) => f.id === id);
    this.calling.add(id);
    this.callNote = null;
    this.render();
    const status = await this.social.invite(id);
    this.calling.delete(id);
    if (status !== 'sent') this.callNote = { id, text: t(`friends.invite.${status}` as MessageKey, { name: friend?.nickname ?? '' }) };
    this.render();
  }

  /**
   * "Jogar com a turma" (tela Turma): fora de sala, cria uma (Jardim livre,
   * privada); aí chama quem da turma está online e mostra o lobby com o
   * resultado. Devolve o erro pra tela Turma mostrar (null = foi pro lobby).
   */
  private async playWithClan(): Promise<string | null> {
    const net = this.net;
    if (!net) return t('online.error.connect');
    if (!net.active) {
      if (this.busy) return t('online.error.unknown');
      this.busy = 'create';
      this.error = null;
      const outcome = await net.create();
      this.busy = null;
      if (!outcome.ok) return t(`online.error.${outcome.error}` as MessageKey);
    }
    const { status, count } = await this.clans.call();
    this.clanNote = this.clanCallNote(status, count);
    this.showMain(false);
    this.body.querySelector<HTMLButtonElement>('[data-play-room]')?.focus({ preventScroll: true });
    return null;
  }

  /** "Chamar a turma" no lobby. */
  private async callClan(): Promise<void> {
    if (this.callingClan) return;
    this.callingClan = true;
    this.clanNote = null;
    this.render();
    const { status, count } = await this.clans.call();
    this.callingClan = false;
    this.clanNote = this.clanCallNote(status, count);
    this.render();
  }

  private clanCallNote(status: CallClanStatus, count: number): { text: string; tone: 'ok' | 'error' } {
    if (status === 'sent') return { text: tn('clan.call.sent', count), tone: 'ok' };
    return { text: t(`clan.call.${status}` as MessageKey), tone: 'error' };
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

  /** Só o texto do relógio da Disputa (sem redesenhar a placa). */
  private tickClock(): void {
    if (this.element.hidden || !this.net?.active) return;
    const el = this.body.querySelector<HTMLElement>('[data-match-clock]');
    if (el) el.textContent = this.matchStatusText(this.net);
  }

  /**
   * Redesenha (só se mudou). A lista de amigos se atualiza sozinha: o foco (e o
   * cursor do campo do código) volta pro mesmo controle depois de redesenhar.
   */
  private render(force = false): void {
    const html = this.html();
    if (!force && html === this.lastHtml) return;
    this.lastHtml = html;
    const active = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement : null;
    const selector = active ? focusSelector(active) : null;
    const input = active instanceof HTMLInputElement ? active : null;
    const selection = input ? [input.selectionStart, input.selectionEnd] : null;
    this.body.innerHTML = html;
    if (!selector) return;
    const again = this.body.querySelector<HTMLElement>(selector);
    if (!again || (again as HTMLButtonElement).disabled) return;
    again.focus({ preventScroll: true });
    if (again instanceof HTMLInputElement && selection) again.setSelectionRange(selection[0], selection[1]);
  }

  private html(): string {
    const player = this.online.player;
    const net = this.net;
    if (!player) {
      return /* html */ `
        <p class="online__blurb">${escapeHtml(t('online.blurb'))}</p>
        <div class="online__notice">
          <span class="online__notice-icon" aria-hidden="true">${Icons.user}</span>
          <p>${escapeHtml(t('online.needAccount'))}</p>
        </div>
        <button class="account-submit online__wide" type="button" data-sign-in>${Icons.enter}<span>${escapeHtml(t('online.signIn'))}</span></button>`;
    }
    if (!net?.active) return this.hubHtml();
    return this.roomHtml(net);
  }

  private hubHtml(): string {
    const busy = this.busy;
    const valid = ROOM_CODE.test(this.codeDraft);
    const quick = (mode: RoomModeId, icon: string, title: MessageKey, desc: MessageKey) => {
      const mine = busy === `quick-${mode}`;
      return /* html */ `
        <button class="online__quick-btn" type="button" data-quick="${mode}" ${busy ? 'disabled' : ''} aria-describedby="online-quick-${mode}">
          <span class="online__quick-icon" aria-hidden="true">${icon}</span>
          <span class="online__quick-title">${escapeHtml(t(mine ? 'online.searching' : title))}</span>
          <span class="online__quick-desc" id="online-quick-${mode}">${escapeHtml(t(desc))}</span>
        </button>`;
    };
    return /* html */ `
      ${this.invitesHtml()}
      <p class="online__blurb">${escapeHtml(t('online.blurb'))}</p>
      <section class="online__section" aria-labelledby="online-quick-title">
        <h3 class="online__label" id="online-quick-title">${escapeHtml(t('online.quick'))}</h3>
        <div class="online__quick">
          ${quick('garden', MatchIcons.garden, 'online.quickGarden', 'online.mode.gardenDesc')}
          ${quick('match', MatchIcons.match, 'online.quickMatch', 'online.mode.matchDesc')}
        </div>
        <p class="online__hint">${escapeHtml(t('online.quickHint'))}</p>
      </section>
      <section class="online__section" aria-labelledby="online-friends-title">
        <h3 class="online__label" id="online-friends-title">${escapeHtml(t('online.friendsTitle'))}</h3>
        <div class="online__social-btns">
          ${this.friendsButtonHtml()}
          ${this.clanButtonHtml()}
        </div>
        <button class="account-submit online__wide" type="button" data-create ${busy ? 'disabled' : ''}>
          ${Icons.group}<span>${escapeHtml(t(busy === 'create' ? 'online.creating' : 'online.create'))}</span>
        </button>
        <form class="online__join" novalidate>
          <label class="online__label online__label--soft" for="online-code">${escapeHtml(t('online.joinLabel'))}</label>
          <div class="online__join-row">
            <input class="field__input online__code-input" id="online-code" data-code type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
              maxlength="12" placeholder="${escapeHtml(t('online.codePlaceholder'))}" value="${escapeHtml(this.codeDraft)}" ${busy ? 'disabled' : ''} />
            <button class="account-secondary" type="submit" data-join ${!valid || busy ? 'disabled' : ''}>
              <span>${escapeHtml(t(busy === 'join' ? 'online.joining' : 'online.join'))}</span>
            </button>
          </div>
        </form>
      </section>
      <p class="online__error" data-error role="alert">${this.error ? escapeHtml(t(this.error)) : ''}</p>`;
  }

  /**
   * Convites que chegaram (valem 2 min): "Fulano te chamou · Jardim livre" com
   * Entrar e Agora não. Na central e no lobby (entrar troca de sala); o da
   * sala em que você já está não aparece.
   */
  private invitesHtml(currentCode: string | null = null): string {
    const invites = this.social.state.invites.filter((i) => i.expiresAt > Date.now() && i.code !== currentCode);
    if (invites.length === 0) return '';
    const busy = this.busy !== null;
    const rows = invites
      .map(
        (invite: RoomInvite) => /* html */ `
        <li class="online__invite">
          <span class="friend__avatar" aria-hidden="true">${friendAvatar(invite.from)}</span>
          <span class="friend__text">
            <strong class="friend__nick">${escapeHtml(t('invite.body', { name: taggedName(invite.from.nickname, invite.from.tag) }))}</strong>
            <span class="friend__where">${escapeHtml(modeName(invite.mode))}</span>
          </span>
          <span class="friend__actions">
            <button class="friend__btn friend__btn--primary" type="button" data-invite-join="${invite.id}" ${busy ? 'disabled' : ''}>${Icons.enter}<span>${escapeHtml(t('invite.join'))}</span></button>
            <button class="friend__more" type="button" data-invite-dismiss="${invite.id}" aria-label="${escapeHtml(t('invite.dismiss'))}">${Icons.close}</button>
          </span>
        </li>`,
      )
      .join('');
    return /* html */ `
      <section class="online__section online__invites" aria-labelledby="online-invites-title">
        <h3 class="online__label" id="online-invites-title">${escapeHtml(t('invite.title'))}</h3>
        <ul class="friends__list">${rows}</ul>
      </section>`;
  }

  /** "Amigos" com o que espera lá dentro (pedidos) e quantos estão online. */
  private friendsButtonHtml(): string {
    const { requests, online, list } = this.social.state;
    const meta =
      requests > 0
        ? tn('friends.requestCount', requests)
        : list && list.friends.length === 0
          ? t('friends.hubEmpty')
          : t('friends.onlineCount', { n: online });
    return /* html */ `
      <button class="online__friends-btn" type="button" data-friends>
        <span class="online__quick-icon" aria-hidden="true">${Icons.userPlus}</span>
        <span class="online__friends-text">
          <strong>${escapeHtml(t('friends.title'))}</strong>
          <span>${escapeHtml(meta)}</span>
        </span>
        ${requests > 0 ? `<span class="online__friends-badge" aria-hidden="true">${requests}</span>` : ''}
        <span class="online__friends-chevron" aria-hidden="true">${Icons.back}</span>
      </button>`;
  }

  /** "Turma" na central: a sua (Nome · N online) ou o convite pra criar/entrar; bolinha = convites pra turma. */
  private clanButtonHtml(): string {
    const clan = this.clans.clan;
    const invites = this.clans.invites.length;
    const members = this.clans.state.mine?.members ?? [];
    const meta = clan
      ? t('clan.hubMeta', { name: clan.name, n: members.filter((m) => m.status !== 'offline' && m.id !== this.clans.selfId).length })
      : invites > 0
        ? tn('clan.inviteCount', invites)
        : t('clan.hubEmpty');
    return /* html */ `
      <button class="online__friends-btn online__clan-btn" type="button" data-clan>
        <span class="online__quick-icon" aria-hidden="true">${clan ? clanTagHtml(clan.tag, 'clan-tag--icon') : Icons.flag}</span>
        <span class="online__friends-text">
          <strong>${escapeHtml(t('clan.title'))}</strong>
          <span>${escapeHtml(meta)}</span>
        </span>
        ${invites > 0 ? `<span class="online__friends-badge" aria-hidden="true">${invites}</span>` : ''}
        <span class="online__friends-chevron" aria-hidden="true">${Icons.back}</span>
      </button>`;
  }

  /** Lobby, com turma: "Nome da turma · N online" + "Chamar a turma" (convite de sala pra quem está online). */
  private clanCallHtml(): string {
    const clan = this.clans.clan;
    if (!clan) return '';
    const members = this.clans.state.mine?.members ?? [];
    const online = members.filter((m) => m.status !== 'offline' && m.id !== this.clans.selfId).length;
    const note = this.clanNote ? `<p class="friend__note" data-tone="${this.clanNote.tone}" role="status">${escapeHtml(this.clanNote.text)}</p>` : '';
    return /* html */ `
      <div class="online__clan-call">
        <div class="friend__row">
          <span class="friend__avatar online__clan-avatar" aria-hidden="true">${clanTagHtml(clan.tag, 'clan-tag--icon')}</span>
          <span class="friend__text">
            <strong class="friend__nick">${escapeHtml(clan.name)}</strong>
            <span class="friend__where">${escapeHtml(t('friends.onlineCount', { n: online }))} · <button class="online__link-btn online__link-btn--inline" type="button" data-clan>${escapeHtml(t('clan.see'))}</button></span>
          </span>
          <span class="friend__actions"><span class="friend__cta">
            <button class="friend__btn friend__btn--primary" type="button" data-call-clan ${this.callingClan ? 'disabled' : ''}>${Icons.group}<span>${escapeHtml(t(this.callingClan ? 'clan.calling' : 'clan.callShort'))}</span></button>
          </span></span>
        </div>
        ${note}
      </div>`;
  }

  /**
   * Lobby: "Chamar amigos" com os que estão online e fora da sala (até 4; o
   * resto em "Todos os amigos"). Sem amigo online, diz isso e leva pros amigos.
   */
  private callHtml(net: OnlinePlay): string {
    const code = net.code;
    const list = this.social.state.list;
    const callable = list ? list.friends.filter((f) => canInvite(f, code)) : [];
    const shown = callable.slice(0, CALL_LIST_MAX);
    const rows = shown
      .map((friend) => {
        const busy = this.calling.has(friend.id);
        const action = this.social.invitedRecently(friend.id)
          ? `<span class="friend__done">${Icons.check}<span>${escapeHtml(t('friends.invited'))}</span></span>`
          : `<button class="friend__btn" type="button" data-call="${friend.id}" ${busy ? 'disabled' : ''}>${Icons.send}<span>${escapeHtml(t('friends.invite'))}</span></button>`;
        const note = this.callNote?.id === friend.id ? `<p class="friend__note" data-tone="error" role="alert">${escapeHtml(this.callNote.text)}</p>` : '';
        return /* html */ `
          <li class="friend">
            <div class="friend__row">
              <span class="friend__avatar" data-status="${friend.status}" aria-hidden="true">${friendAvatar(friend)}<span class="friend__dot"></span></span>
              <span class="friend__text">
                <strong class="friend__nick">${clanTagHtml(friend.tag)}${escapeHtml(friend.nickname)}</strong>
                <span class="friend__where">${escapeHtml(friendWhere(friend, code))}</span>
              </span>
              <span class="friend__actions"><span class="friend__cta">${action}</span></span>
            </div>
            ${note}
          </li>`;
      })
      .join('');
    const empty = !list
      ? t('friends.loading')
      : list.friends.length === 0
        ? t('friends.callEmpty')
        : callable.length === 0
          ? t('friends.callNone')
          : '';
    return /* html */ `
      <section class="online__section online__call" aria-labelledby="online-call-title">
        <div class="online__players-head">
          <h3 class="online__label" id="online-call-title">${escapeHtml(t('friends.callTitle'))}</h3>
          <button class="online__link-btn" type="button" data-friends>${escapeHtml(t(list && list.friends.length === 0 ? 'friends.addShort' : 'friends.all'))}</button>
        </div>
        ${this.clanCallHtml()}
        ${rows ? `<ul class="friends__list">${rows}</ul>` : ''}
        ${empty ? `<p class="online__note">${escapeHtml(empty)}</p>` : ''}
      </section>`;
  }

  /** Um grupo segmentado (rádio) no HTML da placa; desligado pra quem não é o dono. */
  private segmented<V extends string | number>(labelId: string, attr: string, options: ReadonlyArray<{ value: V; label: string }>, current: V, enabled: boolean): string {
    const buttons = options
      .map((o) => {
        const checked = o.value === current;
        return `<button type="button" class="segmented__option" role="radio" aria-checked="${checked}" tabindex="${checked ? 0 : -1}" data-${attr}="${o.value}" ${enabled ? '' : 'disabled'}>${escapeHtml(o.label)}</button>`;
      })
      .join('');
    return `<div class="segmented online__segmented" role="radiogroup" aria-labelledby="${labelId}">${buttons}</div>`;
  }

  /** Modo, tempo, times e roubo. O dono mexe; os outros veem (sala aberta: tudo automático). */
  private settingsHtml(net: OnlinePlay): string {
    const rules = net.rules;
    const running = net.director.running;
    const editable = net.isHost && !net.isPublic;
    const locked = !editable || running;
    const mode = this.segmented(
      'online-mode',
      'mode',
      [
        { value: 'garden', label: t('online.mode.garden') },
        { value: 'match', label: t('online.mode.match') },
      ],
      rules.mode,
      !locked,
    );
    const minutes =
      rules.mode === 'match'
        ? /* html */ `
        <div class="online__setting">
          <span class="online__setting-name" id="online-minutes">${escapeHtml(t('online.minutes'))}</span>
          ${this.segmented(
            'online-minutes',
            'minutes',
            MATCH_MINUTES.map((n) => ({ value: n, label: t('online.minutesValue', { n }) })),
            rules.minutes,
            !locked,
          )}
        </div>`
        : '';
    // Sala aberta de Disputa: o tamanho do time sai de quantos estão (4 ou 6 = duplas).
    const teams =
      net.isPublic && rules.mode === 'match'
        ? ''
        : /* html */ `
        <div class="online__setting">
          <span class="online__setting-name" id="online-teams">${escapeHtml(t('online.teams'))}</span>
          ${this.segmented(
            'online-teams',
            'team-size',
            TEAM_SIZES.map((n) => ({ value: n, label: t(`online.teams.${n}` as MessageKey) })),
            rules.teamSize,
            !locked,
          )}
        </div>`;
    const steal = effectiveRules(rules).steal;
    const stealBlock =
      rules.mode === 'garden'
        ? /* html */ `
        <div class="online__rule">
          <div class="online__rule-text">
            <span class="online__rule-title" id="online-rule-steal">${escapeHtml(t('online.rules.steal'))}</span>
            <span class="online__rule-desc" id="online-rule-steal-desc">${escapeHtml(t(steal ? 'online.rules.stealOn' : 'online.rules.stealOff'))}${editable ? '' : ` · ${escapeHtml(t('online.rules.hostOnly'))}`}</span>
          </div>
          <button class="switch" type="button" role="switch" aria-checked="${steal}" aria-labelledby="online-rule-steal" aria-describedby="online-rule-steal-desc" data-rule-steal ${editable ? '' : 'disabled'}><span class="switch__knob" aria-hidden="true"></span></button>
        </div>`
        : `<p class="online__note">${escapeHtml(t('online.rules.stealMatch'))}</p>`;
    const who = net.isPublic ? t(rules.mode === 'match' ? 'online.publicAuto' : 'online.publicHint') : editable ? '' : t('online.rules.hostOnly');
    return /* html */ `
      <section class="online__settings" aria-labelledby="online-mode">
        <div class="online__setting">
          <span class="online__setting-name" id="online-mode">${escapeHtml(t('online.mode'))}</span>
          ${mode}
        </div>
        <p class="online__mode-desc">${escapeHtml(t(rules.mode === 'match' ? 'online.mode.matchDesc' : 'online.mode.gardenDesc'))}</p>
        ${minutes}
        ${teams}
        ${stealBlock}
        ${who ? `<p class="online__note">${escapeHtml(who)}</p>` : ''}
      </section>`;
  }

  private playerRow(p: OnlinePlayer, selfId: string): string {
    const look = skin(isSkinId(p.look.skin) ? p.look.skin : DEFAULT_SKIN);
    const wants = p.swapTo !== null ? t('online.swapWants', { team: teamName(p.swapTo) }) : '';
    const badges = [
      p.isHost ? `<span class="online__badge online__badge--host" title="${escapeHtml(t('online.host'))}">${Icons.crown}<span class="sr-only">${escapeHtml(t('online.host'))}</span></span>` : '',
      p.uid === selfId ? `<span class="online__badge">${escapeHtml(t('online.you'))}</span>` : '',
      // Pediu pra trocar pra um time cheio: quem está lá vê e pode topar.
      wants ? `<span class="online__badge online__badge--swap" title="${escapeHtml(wants)}">${MatchIcons.swap}<span aria-hidden="true">${escapeHtml(t('online.swapBadge'))}</span><span class="sr-only">${escapeHtml(wants)}</span></span>` : '',
    ].join('');
    return /* html */ `
      <li class="online__player" data-slot="${p.slot}" tabindex="0" data-focusable>
        <span class="online__avatar" aria-hidden="true">${skinIcon(look)}</span>
        <span class="online__nick" title="${escapeHtml(taggedName(p.nick, p.tag))}">${clanTagHtml(p.tag)}${escapeHtml(p.nick)}</span>${badges}
      </li>`;
  }

  /**
   * Cada um por si: as 6 vagas. Com times: um cartão por time, um embaixo do
   * outro (largura cheia: apelido longo com coroa e "Você" cabe), com as vagas
   * que faltam tracejadas e "Entrar".
   */
  private playersHtml(net: OnlinePlay, selfId: string): string {
    const players = net.players;
    const size = net.rules.teamSize as TeamSize;
    if (size === 1) {
      const rows: string[] = [];
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        const p = players[slot];
        rows.push(p ? this.playerRow(p, selfId) : `<li class="online__player is-empty"><span class="online__avatar" aria-hidden="true"></span><span class="online__nick">${escapeHtml(t('online.waiting'))}</span></li>`);
      }
      return `<ul class="online__players">${rows.join('')}</ul>`;
    }
    const running = net.director.running;
    const me = players.find((p) => p.isSelf);
    const columns: string[] = [];
    for (let team = 0; team < teamCount(size); team++) {
      const members = players.filter((p) => p.team === team);
      const mine = me?.team === team;
      const full = members.length >= size;
      const join = mine ? '' : this.teamJoinButton(team, full, running, me, members);
      const rows = members.map((p) => this.playerRow(p, selfId)).join('');
      const slots = `<li class="online__team-slot">${escapeHtml(t('online.teamSlot'))}</li>`.repeat(Math.max(0, size - members.length));
      columns.push(/* html */ `
        <section class="online__team${mine ? ' is-mine' : ''}" data-team="${team}" aria-labelledby="online-team-${team}">
          <header class="online__team-head">
            <span class="online__team-icon" aria-hidden="true">${TEAM_ICONS[team]}</span>
            <h4 class="online__team-name" id="online-team-${team}">${escapeHtml(teamName(team))}</h4>
            <span class="online__team-count">${members.length}/${size}</span>
            ${join}
          </header>
          <ul class="online__players">${rows}${slots}</ul>
        </section>`);
    }
    const shuffle = net.isHost && !net.isPublic && !running ? `<button class="account-secondary online__shuffle" type="button" data-shuffle>${MatchIcons.shuffle}<span>${escapeHtml(t('online.shuffle'))}</span></button>` : '';
    const pending = !running && me?.swapTo != null ? `<p class="online__note" role="status">${escapeHtml(t('online.swapPending', { team: teamName(me.swapTo) }))}</p>` : '';
    return /* html */ `
      <div class="online__teams" data-size="${size}">${columns.join('')}</div>
      ${running ? `<p class="online__note">${escapeHtml(t('online.teamLocked'))}</p>` : pending + shuffle}`;
  }

  /**
   * O botão de um time que não é o seu. "Trocar" se alguém de lá já pediu o seu
   * time (a troca sai na hora, com vaga ou não). Senão, com vaga: "Entrar"; cheio:
   * "Pedir troca", ou "Cancelar pedido" se o pedido é seu. Sem time (ou partida
   * rolando), só avisa.
   */
  private teamJoinButton(team: number, full: boolean, running: boolean, me: OnlinePlayer | undefined, members: readonly OnlinePlayer[]): string {
    const button = (label: string, variant = '', extra = '') =>
      `<button class="online__team-join${variant ? ` online__team-join--${variant}` : ''}" type="button" data-team-join="${team}" ${extra}>${variant ? MatchIcons.swap : ''}<span>${escapeHtml(label)}</span></button>`;
    if (running) return button(t(full ? 'online.teamFull' : 'online.teamJoin'), '', 'disabled');
    const mine = me && me.team >= 0 ? me.team : null;
    if (mine !== null && members.some((p) => p.swapTo === mine)) return button(t('online.teamSwapAccept'), 'ready');
    if (!full) return button(t('online.teamJoin'));
    if (mine === null) return button(t('online.teamFull'), '', 'disabled');
    return me?.swapTo === team ? button(t('online.teamSwapCancel'), 'pending') : button(t('online.teamSwapAsk'), 'ask');
  }

  /** "Disputa rolando · 3:12" (ou "começando…"); vazio fora da Disputa. */
  private matchStatusText(net: OnlinePlay): string {
    const director = net.director;
    if (!director.running) return '';
    const view = director.view;
    if (view === 'countdown') return t('online.matchStarting');
    return t('online.matchRunning', { time: formatClock(timeLeft(director.match, net.time)) });
  }

  private roomHtml(net: OnlinePlay): string {
    const selfId = net.selfId;
    const code = net.code ?? '';
    const status = net.status;
    const players = net.players;
    const connecting = status === 'connecting' || status === 'reconnecting';
    const ping = net.isHost ? '' : `<span class="online__ping" data-quality="${net.ping < 90 ? 'good' : net.ping < 180 ? 'ok' : 'bad'}">${Icons.signal}${escapeHtml(t('online.ping', { ms: net.ping || '–' }))}</span>`;
    const match = net.rules.mode === 'match';
    const running = net.director.running;
    const enough = players.length >= 2;
    const start =
      match && net.isHost && !net.isPublic && !running
        ? /* html */ `
        <button class="account-submit online__wide online__start" type="button" data-start ${enough && !connecting ? '' : 'disabled'} aria-describedby="online-start-note">${MatchIcons.match}<span>${escapeHtml(t('online.start'))}</span></button>
        ${enough ? '' : `<p class="online__note" id="online-start-note">${escapeHtml(t('online.startNeeds'))}</p>`}`
        : '';
    return /* html */ `
      ${this.invitesHtml(code)}
      <div class="online__room${net.isPublic ? ' is-public' : ''}">
        ${net.isPublic ? `<span class="online__public">${Icons.globe}<span>${escapeHtml(t('online.publicRoom'))}</span></span>` : ''}
        <p class="online__label">${escapeHtml(t('online.code'))}</p>
        <p class="online__code" aria-label="${escapeHtml(code.split('').join(' '))}">${escapeHtml(code)}</p>
        <div class="online__code-actions">
          <button class="account-secondary" type="button" data-copy>${this.copied ? Icons.check : Icons.copy}<span>${escapeHtml(t(this.copied ? 'online.copied' : 'online.copy'))}</span></button>
          <button class="account-secondary" type="button" data-share>${Icons.share}<span>${escapeHtml(t('online.share'))}</span></button>
        </div>
        <p class="online__hint">${escapeHtml(t('online.inviteHint'))}</p>
      </div>
      ${running ? `<p class="online__match-live" role="status"><span class="online__match-dot" aria-hidden="true"></span><span data-match-clock>${escapeHtml(this.matchStatusText(net))}</span></p>` : ''}
      ${this.settingsHtml(net)}
      <div class="online__players-head">
        <h3 class="online__label">${escapeHtml(t('online.players'))} <span class="online__count">${escapeHtml(t('online.playerCount', { n: players.length, max: MAX_PLAYERS }))}</span></h3>
        ${ping}
      </div>
      ${connecting ? `<p class="online__status">${escapeHtml(t(status === 'connecting' ? 'online.connecting' : 'online.reconnecting'))}</p>` : ''}
      ${this.playersHtml(net, selfId)}
      ${this.callHtml(net)}
      <div class="online__room-actions">
        ${start}
        <button class="${start ? 'account-secondary' : 'account-submit'} online__wide" type="button" data-play-room ${connecting ? 'disabled' : ''}>${Icons.play}<span>${escapeHtml(t('online.play'))}</span></button>
        <button class="account-danger" type="button" data-leave ${this.busy ? 'disabled' : ''}>${Icons.logout}<span>${escapeHtml(t(this.busy === 'leave' ? 'online.leaving' : 'online.leave'))}</span></button>
      </div>`;
  }
}
