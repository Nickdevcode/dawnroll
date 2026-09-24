import { formatCm, getLocale, onLocaleChange, t, tn, type MessageKey } from '../i18n';
import { CATALOG } from '../progression/catalog';
import { DEFAULT_SKIN, isSkinId, skin } from '../progression/skins';
import { BOARDS, type Board, type LeaderboardRow, type Online } from '../online/Online';
import { GameIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';
import { skinIcon } from './lookIcons';
import { bindTabs, tabsMarkup } from './tabs';

const TABS: ReadonlyArray<{ name: Board; icon: string; label: MessageKey }> = [
  { name: 'buried', icon: GameIcons.burrow, label: 'ranking.tab.buried' },
  { name: 'week', icon: Icons.calendar, label: 'ranking.tab.week' },
  { name: 'mountain', icon: Icons.mountain, label: 'ranking.tab.mountain' },
  { name: 'stickers', icon: GameIcons.catalog, label: 'ranking.tab.stickers' },
];

/** Brasil sem horário de verão desde 2019: a semana do ranking vira na segunda 0h, UTC−3. */
const BRASILIA_OFFSET_MS = -3 * 3_600_000;

/** Quanto falta pra semana do ranking zerar (segunda 0h em Brasília), já em texto. */
function weekResetText(now = Date.now()): string {
  const local = new Date(now + BRASILIA_OFFSET_MS);
  const daysUntilMonday = (8 - local.getUTCDay()) % 7 || 7;
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysUntilMonday) - BRASILIA_OFFSET_MS;
  const ms = Math.max(0, next - now);
  const days = Math.floor(ms / 86_400_000);
  return days >= 2 ? tn('ranking.days', days) : tn('ranking.hours', Math.max(1, Math.ceil(ms / 3_600_000)));
}

/** O número de cada aba do jeito que se lê ("12 bolas", "4,5 m", "31 de 58"). */
function formatValue(board: Board, value: number): string {
  switch (board) {
    case 'buried':
    case 'week':
      return tn('ranking.balls', value);
    case 'mountain':
      return value >= 100 ? `${(value / 100).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} m` : formatCm(value);
    case 'stickers':
      return t('ranking.stickers', { n: value, total: CATALOG.length });
  }
}

/** Besourinho com o casco que a pessoa usa (casco desconhecido — de uma versão mais nova — vira o padrão). */
const avatar = (id: string) => skinIcon(skin(isSkinId(id) ? id : DEFAULT_SKIN));

type PanelState = { kind: 'loading' } | { kind: 'error' } | { kind: 'rows'; rows: LeaderboardRow[] };

/**
 * Placa do ranking (dentro do menu): quatro abas — Enterradas, Semana (zera na
 * segunda), Montanha (soma dos cm) e Coleção (figurinhas). Pódio com os três
 * primeiros, lista até o 50º e, se a pessoa estiver fora, a linha dela no fim.
 * Sem conta, o rodapé convida a entrar.
 */
export class RankingSheet {
  readonly element: HTMLElement;
  /** "Entrar" no rodapé (o menu abre a placa da conta). */
  onOpenAccount: (() => void) | null = null;

  private readonly panels = new Map<Board, HTMLElement>();
  private readonly states = new Map<Board, PanelState>();
  private readonly footer: HTMLElement;
  private readonly select: (name: Board) => void;
  private current: Board = 'buried';
  /** Só a resposta da última busca de cada aba vale. */
  private readonly tickets = new Map<Board, number>();

  constructor(private readonly online: Online) {
    const markup = tabsMarkup('ranking-', 'sheet-ranking-title', TABS);
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--ranking';
    this.element.id = 'sheet-ranking';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-ranking-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-ranking-title" data-t="menu.ranking"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      ${markup.tabs}
      <div class="sheet__body">${markup.panels}</div>
      <footer class="rank-footer" data-footer aria-live="polite"></footer>`;

    const buttons = new Map<Board, HTMLButtonElement>();
    for (const tab of TABS) {
      buttons.set(tab.name, this.element.querySelector(`[data-tab="${tab.name}"]`) as HTMLButtonElement);
      this.panels.set(tab.name, this.element.querySelector(`[data-panel="${tab.name}"]`) as HTMLElement);
    }
    this.footer = this.element.querySelector('[data-footer]') as HTMLElement;
    this.select = bindTabs(BOARDS, buttons, this.panels, (board) => {
      this.current = board;
      this.renderFooter();
      if (!this.element.hidden) void this.load(board);
    });

    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-retry]')) void this.load(this.current, true);
      if (target.closest('[data-sign-in]')) this.onOpenAccount?.();
    });
    // Entrou ou saiu da conta com a placa aberta: o "Você" muda de lugar.
    let lastStatus = online.state.status;
    online.subscribe(() => {
      if (online.state.status === lastStatus) return;
      lastStatus = online.state.status;
      if (!this.element.hidden) void this.load(this.current, true);
      else this.renderFooter();
    });
    onLocaleChange(() => this.refresh());
  }

  /** Abriu a placa: começa em Enterradas e busca. */
  prepare(): void {
    this.select('buried');
  }

  private refresh(): void {
    if (this.element.hidden) return;
    for (const board of BOARDS) this.renderPanel(board);
    this.renderFooter();
  }

  private async load(board: Board, force = false): Promise<void> {
    if (this.online.state.status === 'disabled') {
      this.renderFooter();
      this.panels.get(board)!.innerHTML = `<p class="rank-blurb">${escapeHtml(t('ranking.unavailable'))}</p>`;
      return;
    }
    const ticket = (this.tickets.get(board) ?? 0) + 1;
    this.tickets.set(board, ticket);
    // Já tem lista na tela: troca sem piscar o "carregando".
    if (force || this.states.get(board)?.kind !== 'rows') this.setState(board, { kind: 'loading' });
    try {
      const rows = await this.online.leaderboard(board, force);
      if (this.tickets.get(board) === ticket) this.setState(board, { kind: 'rows', rows });
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[online] ranking não carregou', error);
      if (this.tickets.get(board) === ticket) this.setState(board, { kind: 'error' });
    }
  }

  private setState(board: Board, state: PanelState): void {
    this.states.set(board, state);
    this.renderPanel(board);
    if (board === this.current) this.renderFooter();
  }

  private renderPanel(board: Board): void {
    const panel = this.panels.get(board)!;
    const state = this.states.get(board) ?? { kind: 'loading' };
    const blurb = `<p class="rank-blurb">${escapeHtml(board === 'week' ? t('ranking.desc.week', { left: weekResetText() }) : t(`ranking.desc.${board}` as MessageKey))}</p>`;
    if (state.kind === 'loading') {
      const skeleton = Array.from({ length: 6 }, () => '<li class="rank-row is-skeleton" aria-hidden="true"><span></span><span></span><span></span></li>').join('');
      panel.innerHTML = `${blurb}<p class="sr-only" role="status">${escapeHtml(t('ranking.loading'))}</p><ol class="rank-list">${skeleton}</ol>`;
      return;
    }
    if (state.kind === 'error') {
      panel.innerHTML = /* html */ `${blurb}
        <div class="rank-empty" role="alert">
          <span class="rank-empty__icon" aria-hidden="true">${Icons.cloudOff}</span>
          <p>${escapeHtml(t('ranking.error'))}</p>
          <button class="rank-button" type="button" data-retry>${Icons.reset}<span>${escapeHtml(t('ranking.retry'))}</span></button>
        </div>`;
      return;
    }
    const top = state.rows.filter((row) => row.rank <= 50);
    if (top.length === 0) {
      panel.innerHTML = /* html */ `${blurb}
        <div class="rank-empty">
          <span class="rank-empty__icon" aria-hidden="true">${Icons.podium}</span>
          <p>${escapeHtml(t(board === 'week' ? 'ranking.emptyWeek' : 'ranking.empty'))}</p>
        </div>`;
      return;
    }
    const me = state.rows.find((row) => row.isMe && row.rank > 50);
    // Pódio sempre com os três degraus: quem falta vira "vaga livre" (convida a subir).
    const podium = [1, 2, 3]
      .map((place) => {
        const row = top.find((r) => r.rank === place);
        return row ? this.podiumSpot(board, row) : this.openSpot(place);
      })
      .join('');
    const rest = top.slice(3).map((row) => this.row(board, row)).join('');
    panel.innerHTML = /* html */ `${blurb}
      <ol class="rank-podium">${podium}</ol>
      ${rest ? `<ol class="rank-list">${rest}</ol>` : ''}
      ${me ? `<div class="rank-gap" aria-hidden="true"><span></span><span></span><span></span></div><ol class="rank-list">${this.row(board, me)}</ol>` : ''}`;
  }

  private rowLabel(board: Board, row: LeaderboardRow): string {
    const nick = row.isMe ? `${row.nickname} (${t('ranking.you')})` : row.nickname;
    return t('ranking.rowAria', { rank: row.rank, nick, value: formatValue(board, row.value) });
  }

  private podiumSpot(board: Board, row: LeaderboardRow): string {
    return /* html */ `
      <li class="rank-podium__spot is-place-${row.rank}${row.isMe ? ' is-me' : ''}" tabindex="0" data-focusable aria-label="${escapeHtml(this.rowLabel(board, row))}">
        <span class="rank-avatar" aria-hidden="true">${avatar(row.skin)}</span>
        <strong class="rank-name" aria-hidden="true">${escapeHtml(row.nickname)}</strong>
        <span class="rank-value" aria-hidden="true">${escapeHtml(formatValue(board, row.value))}</span>
        <span class="rank-podium__block" aria-hidden="true">${row.rank}</span>
      </li>`;
  }

  private openSpot(place: number): string {
    return /* html */ `
      <li class="rank-podium__spot is-place-${place} is-open" aria-hidden="true">
        <span class="rank-avatar is-open">?</span>
        <strong class="rank-name">${escapeHtml(t('ranking.open'))}</strong>
        <span class="rank-value">&nbsp;</span>
        <span class="rank-podium__block">${place}</span>
      </li>`;
  }

  private row(board: Board, row: LeaderboardRow): string {
    const you = row.isMe ? `<span class="rank-you">${escapeHtml(t('ranking.you'))}</span>` : '';
    return /* html */ `
      <li class="rank-row${row.isMe ? ' is-me' : ''}" tabindex="0" data-focusable aria-label="${escapeHtml(this.rowLabel(board, row))}">
        <span class="rank-row__place" aria-hidden="true">${escapeHtml(t('ranking.place', { rank: row.rank }))}</span>
        <span class="rank-avatar" aria-hidden="true">${avatar(row.skin)}</span>
        <span class="rank-row__name" aria-hidden="true"><span>${escapeHtml(row.nickname)}</span>${you}</span>
        <span class="rank-row__value" aria-hidden="true">${escapeHtml(formatValue(board, row.value))}</span>
      </li>`;
  }

  /** Rodapé: sem conta, o convite; com conta, a posição na aba aberta. */
  private renderFooter(): void {
    const status = this.online.state.status;
    if (status === 'disabled') {
      this.footer.hidden = true;
      return;
    }
    this.footer.hidden = false;
    if (status !== 'signedIn') {
      this.footer.innerHTML = /* html */ `
        <span class="rank-footer__icon" aria-hidden="true">${Icons.user}</span>
        <p>${escapeHtml(t('ranking.guest'))}</p>
        <button class="rank-button is-primary" type="button" data-sign-in>${escapeHtml(t('account.chip.signIn'))}</button>`;
      return;
    }
    const state = this.states.get(this.current);
    // Ainda carregando (ou deu erro): sem posição pra mostrar.
    if (state?.kind !== 'rows') {
      this.footer.hidden = true;
      return;
    }
    const me = state.rows.find((row) => row.isMe);
    const text = me ? t('ranking.yourPlace', { rank: me.rank }) : t('ranking.notRanked');
    this.footer.innerHTML = /* html */ `
      <span class="rank-footer__icon is-me" aria-hidden="true">${Icons.podium}</span>
      <p><strong>${escapeHtml(text)}</strong></p>`;
  }
}
