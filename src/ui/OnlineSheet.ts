import { onLocaleChange, t, type MessageKey } from '../i18n';
import { MAX_PLAYERS, effectiveRules, type NetRules, type RoomModeId } from '../net/protocol';
import type { OnlineOutcome, OnlinePlay, OnlinePlayer } from '../net/OnlinePlay';
import { MATCH_MINUTES, timeLeft } from '../net/match';
import { TEAM_SIZES, teamCount, type TeamSize } from '../net/teams';
import type { Online } from '../online/Online';
import { ROOM_CODE, normalizeRoomCode } from '../online/Rooms';
import { DEFAULT_SKIN, isSkinId, skin } from '../progression/skins';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { skinIcon } from './lookIcons';
import { MatchIcons, TEAM_ICONS } from './matchIcons';
import { formatClock, teamName } from './MatchHud';

/**
 * Placa "Jogar online" (dentro do menu). Três caras:
 *   - sem conta: explica por que precisa e leva pra conta;
 *   - com conta, fora de sala: procurar partida (Jardim livre ou Disputa),
 *     criar sala ou entrar com o código;
 *   - numa sala (o lobby): o código grande (copiar / mandar convite), o modo,
 *     o tempo e os times (o dono escolhe; os outros veem), quem está em cada
 *     time, "Começar disputa" (dono) e ir pro jardim / sair.
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
  private busy: 'create' | 'join' | 'leave' | 'quick-garden' | 'quick-match' | null = null;
  private error: MessageKey | null = null;
  private codeDraft = '';
  private copiedTimer = 0;
  private copied = false;
  /** Pediram pra entrar numa sala pelo link antes de a conta/o jogo estarem prontos. */
  private pendingCode: string | null = null;
  /** Último HTML desenhado: redesenhar igual não mexe no DOM (nem no foco, nem nas animações). */
  private lastHtml = '';

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
    this.body.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.body.addEventListener('input', (e) => this.onInput(e));
    this.body.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.join();
    });
    online.subscribe(() => {
      if (!this.element.hidden) this.render();
      if (this.pendingCode && online.player) void this.joinFromLink(this.pendingCode);
    });
    onLocaleChange(() => this.render(true));
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

  /** Abriu a placa. */
  prepare(): void {
    this.error = null;
    this.render(true);
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
    if (!target || target.hasAttribute('disabled')) return;
    const net = this.net;
    if (target.matches('[data-sign-in]')) this.onOpenAccount?.();
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

  /** Só o texto do relógio da Disputa (sem redesenhar a placa). */
  private tickClock(): void {
    if (this.element.hidden || !this.net?.active) return;
    const el = this.body.querySelector<HTMLElement>('[data-match-clock]');
    if (el) el.textContent = this.matchStatusText(this.net);
  }

  private render(force = false): void {
    const html = this.html();
    if (!force && html === this.lastHtml) return;
    this.lastHtml = html;
    this.body.innerHTML = html;
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
    const badges = [
      p.isHost ? `<span class="online__badge online__badge--host" title="${escapeHtml(t('online.host'))}">${Icons.crown}<span class="sr-only">${escapeHtml(t('online.host'))}</span></span>` : '',
      p.uid === selfId ? `<span class="online__badge">${escapeHtml(t('online.you'))}</span>` : '',
    ].join('');
    return /* html */ `
      <li class="online__player" data-slot="${p.slot}" tabindex="0" data-focusable>
        <span class="online__avatar" aria-hidden="true">${skinIcon(look)}</span>
        <span class="online__nick">${escapeHtml(p.nick)}</span>${badges}
      </li>`;
  }

  /** Cada um por si: as 6 vagas. Com times: uma coluna por time, com "Entrar". */
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
      const join = mine
        ? ''
        : `<button class="online__team-join" type="button" data-team-join="${team}" ${full || running ? 'disabled' : ''}>${escapeHtml(t(full ? 'online.teamFull' : 'online.teamJoin'))}</button>`;
      const rows = members.map((p) => this.playerRow(p, selfId)).join('') || `<li class="online__team-empty">${escapeHtml(t('online.teamEmpty'))}</li>`;
      columns.push(/* html */ `
        <section class="online__team${mine ? ' is-mine' : ''}" data-team="${team}" aria-labelledby="online-team-${team}">
          <header class="online__team-head">
            <span class="online__team-icon" aria-hidden="true">${TEAM_ICONS[team]}</span>
            <h4 class="online__team-name" id="online-team-${team}">${escapeHtml(teamName(team))}</h4>
            <span class="online__team-count">${members.length}/${size}</span>
            ${join}
          </header>
          <ul class="online__players">${rows}</ul>
        </section>`);
    }
    const shuffle = net.isHost && !net.isPublic && !running ? `<button class="account-secondary online__shuffle" type="button" data-shuffle>${MatchIcons.shuffle}<span>${escapeHtml(t('online.shuffle'))}</span></button>` : '';
    return /* html */ `
      <div class="online__teams" data-size="${size}">${columns.join('')}</div>
      ${running ? `<p class="online__note">${escapeHtml(t('online.teamLocked'))}</p>` : shuffle}`;
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
      <div class="online__room-actions">
        ${start}
        <button class="${start ? 'account-secondary' : 'account-submit'} online__wide" type="button" data-play-room ${connecting ? 'disabled' : ''}>${Icons.play}<span>${escapeHtml(t('online.play'))}</span></button>
        <button class="account-danger" type="button" data-leave ${this.busy ? 'disabled' : ''}>${Icons.logout}<span>${escapeHtml(t(this.busy === 'leave' ? 'online.leaving' : 'online.leave'))}</span></button>
      </div>`;
  }
}
