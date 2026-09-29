import type { MenuAction } from '../core/GamepadInput';
import type { OnlinePlay } from '../net/OnlinePlay';
import { MATCH_WIN_PASS_XP, highlights, isSunset, standings, timeLeft, winners, type HighlightKind, type NetMatch, type Side } from '../net/match';
import { onLocaleChange, t } from '../i18n';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { MergeIcon, EMOTE_ICONS } from './emoteIcons';
import { MatchIcons, TEAM_ICONS } from './matchIcons';

/** Quantos jogadores aparecem no placar do topo quando é cada um por si (você entra sempre). */
const FFA_CHIPS = 4;
/** O "Já!" fica na tela esse tanto depois da contagem. */
const GO_SECONDS = 0.9;
/**
 * O A do controle só aperta botão do cartão depois disso (ms): quem ainda está
 * apertando pular no fim da partida não recomeça outra nem fecha o cartão sem ver.
 */
const CARD_ARM_MS = 900;

const HIGHLIGHT_ICONS: Record<HighlightKind, string> = {
  biggest: MatchIcons.biggest,
  steals: EMOTE_ICONS[2],
  gifts: MergeIcon,
};

/** "3:07" */
export function formatClock(seconds: number): string {
  // A folga tira o "3:01" de um relógio que começa em 180,000001 s.
  const s = Math.max(0, Math.ceil(seconds - 0.001));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Nome de um time ("Time Sol"). */
export const teamName = (team: number) => t('team.name', { name: t(`team.${team}` as 'team.0') });

/**
 * A Disputa no HUD:
 *   - a barra do topo: relógio, placar de cada lado (time = ícone + cor; cada
 *     um por si = os primeiros e você) e a faixa "Pôr do sol ×2"; fora da
 *     partida, o que falta pra começar;
 *   - a contagem no meio da tela (3, 2, 1, Já!) e o "Tempo!";
 *   - o cartão do resultado (pódio): quem ganhou, o placar, os destaques e
 *     "Jogar de novo" (dono) / sair. É uma janela: enquanto está aberto o jogo
 *     solta o mouse e o controle anda nele (ver `onCardChange`).
 */
export class MatchHud {
  private readonly bar: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly sides: HTMLElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;
  private readonly card: HTMLElement;
  private cardOpen = false;
  private cardRound = -1;
  /** Quando o cartão apareceu (performance.now), pro A do controle esperar um pouco. */
  private cardShownAt = 0;
  /** Os botões de baixo do cartão como estão agora (pra não refazer sem mudança). */
  private actionsHtml = '';
  /** O cartão apareceu ou sumiu (o jogo solta/prende o mouse e trava o besouro enquanto ele está aberto). */
  onCardChange?: (open: boolean) => void;
  private lastClock = '';
  private lastCount = '';
  private lastStatus = '';
  private lastSunset = false;
  private sidesKey = '';

  constructor(
    parent: HTMLElement,
    private readonly net: OnlinePlay,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'match-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = /* html */ `
      <span class="match-bar__clock" role="timer"><span class="match-bar__icon">${MatchIcons.timer}</span><span data-clock></span></span>
      <span class="match-bar__sides" data-sides></span>
      <span class="match-bar__sunset"><span class="match-bar__icon">${MatchIcons.sunset}</span><span data-sunset-label></span></span>
      <span class="match-bar__status" data-status></span>`;
    this.clock = this.bar.querySelector('[data-clock]') as HTMLElement;
    this.sides = this.bar.querySelector('[data-sides]') as HTMLElement;
    this.status = this.bar.querySelector('[data-status]') as HTMLElement;

    this.count = document.createElement('div');
    this.count.className = 'match-count';
    this.count.setAttribute('aria-live', 'assertive');
    this.count.hidden = true;

    this.card = document.createElement('section');
    this.card.className = 'match-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-labelledby', 'match-card-title');
    this.card.hidden = true;
    this.card.addEventListener('click', (e) => this.onCardClick(e));

    parent.append(this.bar, this.count, this.card);
    net.subscribe(() => this.render());
    onLocaleChange(() => {
      this.sidesKey = '';
      this.lastStatus = '';
      // Reescreve o cartão no idioma novo sem reabrir (fechado ele fica fechado: ele é janela, abrir solta o mouse).
      const result = this.net.director.lastResult;
      if (result && result.round === this.cardRound) this.fillCard(result);
      this.render();
    });
  }

  /** O cartão do resultado está na tela (a câmera do pódio centraliza no resto). */
  cardRect(): DOMRect | null {
    return this.card.hidden ? null : this.card.getBoundingClientRect();
  }

  /** O cartão do resultado está aberto. */
  get isCardOpen(): boolean {
    return !this.card.hidden;
  }

  /**
   * Põe o foco no botão principal do cartão (controle/teclado): "Jogar de novo"
   * pro dono, senão fechar. Nunca "Sair da sala" (um A sem querer tirava da sala).
   */
  focusCard(): void {
    if (this.card.hidden) return;
    const target = this.card.querySelector<HTMLButtonElement>('[data-card-again]:not(:disabled)') ?? this.card.querySelector<HTMLButtonElement>('[data-card-close]');
    target?.focus({ preventScroll: true });
  }

  /**
   * Controle com o cartão aberto: direções andam entre os botões, A aperta o
   * com foco, B fecha. Devolve se usou a ação ("start" fica pro jogo: pausa).
   */
  handleGamepad(action: MenuAction): boolean {
    if (this.card.hidden || action === 'start') return false;
    document.documentElement.classList.add('using-gamepad');
    const buttons = [...this.card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const active = document.activeElement as HTMLButtonElement | null;
    const index = active ? buttons.indexOf(active) : -1;
    switch (action) {
      case 'back':
        this.closeCard();
        return true;
      case 'confirm':
        if (index < 0) this.focusCard();
        else if (performance.now() - this.cardShownAt >= CARD_ARM_MS) active!.click();
        return true;
      case 'up':
      case 'left':
      case 'down':
      case 'right': {
        if (index < 0) {
          this.focusCard();
          return true;
        }
        const step = action === 'up' || action === 'left' ? -1 : 1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus({ preventScroll: true });
        return true;
      }
      default:
        return true;
    }
  }

  /** Fecha o cartão (X, B do controle, Esc). Ele volta no próximo resultado. */
  closeCard(): void {
    this.cardOpen = false;
    this.setCardShown(false);
  }

  /** Mostra/esconde o cartão e avisa o jogo só quando muda de verdade. */
  private setCardShown(shown: boolean): void {
    if (this.card.hidden === !shown) return;
    this.card.hidden = !shown;
    if (shown) this.cardShownAt = performance.now();
    this.onCardChange?.(shown);
  }

  /** A cada quadro: relógio, contagem e pôr do sol (só mexe no DOM quando o texto muda). */
  update(): void {
    const net = this.net;
    const shown = net.active && net.rules.mode === 'match';
    if (this.bar.hidden === shown) this.bar.hidden = !shown;
    if (!shown) {
      this.count.hidden = true;
      return;
    }
    const director = net.director;
    const m = director.match;
    const now = net.time;
    const view = director.view;
    const running = view === 'countdown' || view === 'playing' || view === 'overtime';
    this.bar.classList.toggle('is-running', running);

    const clock = running ? formatClock(timeLeft(m, now)) : '';
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
    }
    const sunset = running && view !== 'countdown' && isSunset(m, now);
    if (sunset !== this.lastSunset) {
      this.lastSunset = sunset;
      this.bar.classList.toggle('is-sunset', sunset);
    }

    let status = '';
    if (!running && view !== 'ended') {
      if (m.until > 0) status = t('match.startsIn', { s: formatClock(m.until - now) });
      else if (net.isPublic || net.players.length < 2) status = t('match.waitPlayers');
      else status = t('match.waitHost');
    }
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.status.textContent = status;
      this.bar.classList.toggle('has-status', status !== '');
    }

    let count = '';
    if (view === 'countdown') count = String(Math.max(1, Math.ceil(m.startsAt - now)));
    else if (view === 'playing' && now - m.startsAt < GO_SECONDS && m.phase !== 'idle') count = t('match.go');
    else if (view === 'overtime') count = t('match.timeUp');
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.count.hidden = count === '';
      this.count.textContent = count;
      // Reinicia o "pulo" do número a cada troca.
      this.count.classList.remove('is-pop');
      void this.count.offsetWidth;
      if (count) this.count.classList.add('is-pop');
      this.count.classList.toggle('is-final', view === 'overtime');
    }
  }

  /** A sala mudou (placar, times, fase): placar do topo e cartão. */
  private render(): void {
    const net = this.net;
    if (!net.active) {
      this.bar.hidden = true;
      this.count.hidden = true;
      this.cardOpen = false;
      this.cardRound = -1;
      this.setCardShown(false);
      return;
    }
    (this.bar.querySelector('[data-sunset-label]') as HTMLElement).textContent = t('match.sunset');
    this.renderSides();
    this.renderCard();
  }

  private renderSides(): void {
    const net = this.net;
    const m = net.director.match;
    const running = m.phase === 'countdown' || m.phase === 'playing';
    const list = running ? standings(m) : [];
    const self = net.selfId;
    let shown: Side[] = list;
    if (list.length > 0 && !list[0].isTeam) {
      shown = list.slice(0, FFA_CHIPS);
      const mine = list.find((s) => s.uids.includes(self));
      if (mine && !shown.includes(mine)) shown = [...shown.slice(0, FFA_CHIPS - 1), mine];
    }
    const key = shown.map((s) => `${s.key}:${s.points}:${s.uids.includes(self)}`).join('|');
    if (key === this.sidesKey) return;
    this.sidesKey = key;
    this.sides.innerHTML = shown
      .map((side) => {
        const mine = side.uids.includes(self);
        const points = Math.round(side.points);
        if (side.isTeam) {
          return /* html */ `<span class="match-side${mine ? ' is-mine' : ''}" data-team="${side.key}" title="${escapeHtml(teamName(side.key))}">
            <span class="match-side__icon">${TEAM_ICONS[side.key] ?? ''}</span><span class="sr-only">${escapeHtml(teamName(side.key))}</span><strong>${points}</strong></span>`;
        }
        const entry = m.board.find((e) => e.uid === side.uids[0]);
        const nick = mine ? t('match.you') : (entry?.nick ?? '?');
        return /* html */ `<span class="match-side match-side--player${mine ? ' is-mine' : ''}" data-slot="${side.key}">
          <span class="match-side__dot" aria-hidden="true"></span><span class="match-side__nick">${escapeHtml(nick)}</span><strong>${points}</strong></span>`;
      })
      .join('');
  }

  private renderCard(): void {
    const net = this.net;
    const director = net.director;
    const result = director.lastResult;
    const view = director.view;
    // Resultado novo: o cartão abre sozinho. A contagem da próxima fecha.
    if (result && result.round !== this.cardRound) {
      this.cardRound = result.round;
      this.cardOpen = true;
      this.fillCard(result);
    } else if (result && this.cardOpen) this.refreshCardActions();
    if (view === 'countdown' || view === 'playing') this.cardOpen = false;
    this.setCardShown(!!result && this.cardOpen);
  }

  private fillCard(m: NetMatch): void {
    const net = this.net;
    const self = net.selfId;
    const list = standings(m);
    const won = winners(m);
    const top = list.filter((s) => s.place === 1 && s.points > 0);
    let title: string;
    if (top.length === 0) title = t('match.result.none');
    else if (won.has(self)) title = t('match.result.win');
    else if (top.length > 1) title = t('match.result.draw');
    else if (top[0].isTeam) title = t('match.result.winTeam', { name: t(`team.${top[0].key}` as 'team.0') });
    else title = t('match.result.winPlayer', { name: m.board.find((e) => e.uid === top[0].uids[0])?.nick ?? '?' });
    const rows = list
      .map((side) => {
        const mine = side.uids.includes(self);
        const names = side.uids
          .map((uid) => {
            const entry = m.board.find((e) => e.uid === uid);
            return `<span class="match-row__nick${uid === self ? ' is-self' : ''}">${escapeHtml(entry?.nick ?? '?')}</span>`;
          })
          .join('');
        const badge = side.isTeam
          ? `<span class="match-row__team" data-team="${side.key}">${TEAM_ICONS[side.key] ?? ''}<span class="sr-only">${escapeHtml(teamName(side.key))}</span></span>`
          : `<span class="match-row__team match-row__team--player" data-slot="${side.key}" aria-hidden="true"></span>`;
        return /* html */ `<li class="match-row${mine ? ' is-mine' : ''}${side.place === 1 && side.points > 0 ? ' is-first' : ''}">
          <span class="match-row__place">${escapeHtml(t('match.place', { n: side.place }))}</span>
          ${badge}
          <span class="match-row__names">${names}</span>
          <span class="match-row__points">${escapeHtml(t('match.pts', { n: Math.round(side.points) }))}</span>
        </li>`;
      })
      .join('');
    const hl = highlights(m)
      .map(
        (h) => /* html */ `<li class="match-hl">
          <span class="match-hl__icon">${HIGHLIGHT_ICONS[h.kind]}</span>
          <span class="match-hl__text"><span class="match-hl__label">${escapeHtml(t(`match.hl.${h.kind}`))}</span><strong>${escapeHtml(h.nick)}</strong></span>
          <span class="match-hl__value">${escapeHtml(h.kind === 'biggest' ? `${h.value.toFixed(1).replace('.0', '')} cm` : String(h.value))}</span>
        </li>`,
      )
      .join('');
    this.card.innerHTML = /* html */ `
      <header class="match-card__head">
        <span class="match-card__icon" aria-hidden="true">${Icons.podium}</span>
        <div>
          <p class="match-card__kicker">${escapeHtml(t('match.title'))}</p>
          <h2 class="match-card__title" id="match-card-title">${escapeHtml(title)}</h2>
          ${won.has(self) ? `<p class="match-card__reward">${escapeHtml(t('match.result.reward', { xp: MATCH_WIN_PASS_XP }))}</p>` : ''}
        </div>
        <button class="sheet__close match-card__close" type="button" data-card-close aria-label="${escapeHtml(t('match.close'))}">${Icons.close}</button>
      </header>
      <ol class="match-card__rows">${rows}</ol>
      ${hl ? `<h3 class="match-card__sub">${escapeHtml(t('match.highlights'))}</h3><ul class="match-card__hls">${hl}</ul>` : ''}
      <div class="match-card__actions" data-card-actions></div>`;
    this.refreshCardActions();
  }

  /** "Jogar de novo" só pro dono de sala de amigos; na aberta ela recomeça sozinha. */
  private refreshCardActions(): void {
    const box = this.card.querySelector('[data-card-actions]');
    if (!box) return;
    const net = this.net;
    let main: string;
    if (net.isPublic) main = `<p class="match-card__note">${escapeHtml(t('match.againAuto'))}</p>`;
    else if (net.isHost) {
      const enough = net.players.length >= 2;
      main = `<button class="account-submit" type="button" data-card-again ${enough ? '' : 'disabled'}>${Icons.reset}<span>${escapeHtml(t('match.again'))}</span></button>${enough ? '' : `<p class="match-card__note">${escapeHtml(t('online.startNeeds'))}</p>`}`;
    } else main = `<p class="match-card__note">${escapeHtml(t('match.againWait'))}</p>`;
    const html = /* html */ `${main}<button class="account-danger" type="button" data-card-leave>${Icons.logout}<span>${escapeHtml(t('online.leave'))}</span></button>`;
    // A sala avisa mudança toda hora: só troca o que mudou, e o foco do controle não se perde.
    if (html === this.actionsHtml && box.childElementCount > 0) return;
    const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).hasAttribute('data-card-again') ? '[data-card-again]' : '[data-card-leave]' : null;
    this.actionsHtml = html;
    box.innerHTML = html;
    if (focused) box.querySelector<HTMLButtonElement>(`${focused}:not(:disabled)`)?.focus({ preventScroll: true });
  }

  private onCardClick(e: Event): void {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.matches('[data-card-close]')) this.closeCard();
    else if (button.matches('[data-card-again]')) this.net.startMatch();
    else if (button.matches('[data-card-leave]')) void this.net.leave();
  }
}
