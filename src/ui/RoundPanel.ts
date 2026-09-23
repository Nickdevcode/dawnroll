import { formatCm, onLocaleChange, t, tn, type MessageKey, type PluralKey } from '../i18n';
import type { RoundPerk } from '../progression/Progression';
import type { RoundRequest } from '../progression/requests';
import { GameIcons, GiverIcons, PerkIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';

const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

/** O que o HUD mostra da progressão (o `Game` monta a partir do `Progression`). */
export interface RoundView {
  level: number;
  /** 0..1 até o próximo nível. */
  levelProgress: number;
  requests: readonly RoundRequest[];
  perks: readonly RoundPerk[];
}

/** Texto de um pedido (com o número/tamanho dentro). */
export function requestText(request: RoundRequest): string {
  if (request.kind === 'size') return t('req.size', { cm: formatCm(request.amount) });
  if (request.kind === 'challenge') return t(request.label as MessageKey);
  return tn(request.label as PluralKey, request.amount);
}

/** Nome de quem fez o pedido ("Formiga-rainha", "O Sol"...). */
export function giverName(request: RoundRequest): string {
  return t(`giver.${request.giver}` as MessageKey);
}

/** Nome do poder com as estrelinhas do ★★. */
export function perkLabel(perk: RoundPerk): string {
  const name = t(`perk.${perk.id}.name` as MessageKey);
  return perk.rank === 2 ? `${name} ★★` : name;
}

/**
 * Pedaço do HUD embaixo do cartão da bola: nível (com a barrinha de XP), os
 * pedidos da rodada (cada um com o bichinho que pediu) e os poderes escolhidos.
 * Só DOM; recebe o estado pronto.
 */
export class RoundPanel {
  readonly element: HTMLElement;
  private readonly levelValue: HTMLElement;
  private readonly levelFill: HTMLElement;
  private readonly requests: HTMLElement;
  private readonly requestsToggle: HTMLButtonElement;
  private readonly requestsTitle: HTMLElement;
  private readonly requestsTally: HTMLElement;
  private readonly requestList: HTMLElement;
  private readonly perkRow: HTMLElement;
  private view: RoundView | null = null;
  private lastRequests = '';
  private lastPerks = '';
  private heat = 0;

  /** `collapsed`: começa só com o título (no celular o topo da tela é apertado). */
  constructor(parent: HTMLElement, collapsed: boolean) {
    this.element = document.createElement('div');
    this.element.className = 'round-panel';
    this.element.innerHTML = /* html */ `
      <div class="level-chip" data-level-chip aria-hidden="true">
        <span class="level-chip__star">${GameIcons.star}</span>
        <span class="level-chip__value" data-level-value></span>
        <span class="level-chip__bar"><span class="level-chip__fill" data-level-fill></span></span>
      </div>
      <section class="requests" data-requests>
        <button class="requests__toggle" type="button" aria-expanded="true" aria-controls="hud-request-list" data-requests-toggle>
          <span class="requests__title" data-requests-title></span>
          <span class="requests__tally" data-requests-tally></span>
          <span class="requests__chevron" aria-hidden="true">${CHEVRON}</span>
        </button>
        <ul class="requests__list" id="hud-request-list" data-request-list></ul>
      </section>
      <ul class="round-perks" data-round-perks hidden></ul>`;
    parent.append(this.element);
    const $ = (sel: string) => this.element.querySelector(sel) as HTMLElement;
    this.levelValue = $('[data-level-value]');
    this.levelFill = $('[data-level-fill]');
    this.requests = $('[data-requests]');
    this.requestsToggle = $('[data-requests-toggle]') as HTMLButtonElement;
    this.requestsTitle = $('[data-requests-title]');
    this.requestsTally = $('[data-requests-tally]');
    this.setCollapsed(collapsed);
    this.requestsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCollapsed(!this.requests.classList.contains('is-collapsed'));
    });
    // Tocar no cartão não vira arrastar de câmera.
    this.requests.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.requestList = $('[data-request-list]');
    this.perkRow = $('[data-round-perks]');
    onLocaleChange(() => {
      this.lastRequests = '';
      this.lastPerks = '';
      if (this.view) this.set(this.view);
    });
  }

  set(view: RoundView): void {
    this.view = view;
    this.levelValue.textContent = t('hud.level', { n: view.level });
    this.levelFill.style.transform = `scaleX(${Math.min(Math.max(view.levelProgress, 0), 1).toFixed(3)})`;
    this.requestsTitle.textContent = t('hud.requests');
    this.requestsTally.textContent = `${view.requests.filter((r) => r.done).length}/${view.requests.length}`;
    this.requests.classList.toggle('has-golden', view.requests.some((r) => r.golden && !r.done));

    // Só refaz a lista quando algo mudou (o HUD atualiza todo quadro).
    const requestsKey = view.requests.map((r) => `${r.label}|${r.giver}|${r.amount}|${r.progress}|${r.done}|${r.failed}`).join(';');
    if (requestsKey !== this.lastRequests) {
      this.lastRequests = requestsKey;
      this.requestList.innerHTML = view.requests.map((request) => this.requestItem(request)).join('');
    }

    const perksKey = view.perks.map((p) => `${p.id}${p.rank}`).join(',');
    if (perksKey !== this.lastPerks) {
      this.lastPerks = perksKey;
      this.perkRow.hidden = view.perks.length === 0;
      this.perkRow.setAttribute('aria-label', t('hud.perks'));
      this.perkRow.innerHTML = view.perks
        .map((perk) => {
          const name = escapeHtml(perkLabel(perk));
          const stars = perk.rank === 2 ? `<span class="round-perk__stars" aria-hidden="true">★★</span>` : '';
          return `<li class="round-perk perk-icon--${perk.id}${perk.rank === 2 ? ' is-upgraded' : ''}" title="${name}"><span class="sr-only">${name}</span>${PerkIcons[perk.id]}${stars}</li>`;
        })
        .join('');
      this.applyHeat();
    }
  }

  /** Um pedido: o bichinho que pediu, o texto e a contagem (ou o estado do desafio). */
  private requestItem(request: RoundRequest): string {
    const text = requestText(request);
    const who = giverName(request);
    let status = '';
    if (request.kind === 'challenge') {
      status = request.failed
        ? `<span class="request__count is-failed">${escapeHtml(t('hud.request.failed'))}</span>`
        : request.done
          ? ''
          : `<span class="request__count">${escapeHtml(t('hud.request.atBurial'))}</span>`;
    } else if (!request.done && request.kind !== 'size') {
      status = `<span class="request__count">${request.progress}/${request.amount}</span>`;
    }
    const classes = ['request', request.done ? 'is-done' : '', request.failed ? 'is-failed' : '', request.golden ? 'is-golden' : ''].filter(Boolean).join(' ');
    return /* html */ `
      <li class="${classes}" title="${escapeHtml(t('hud.request.from', { name: who, text }))}">
        <span class="request__giver giver--${request.giver}" aria-hidden="true">${GiverIcons[request.giver]}</span>
        <span class="request__check" aria-hidden="true">${request.done ? Icons.check : ''}</span>
        <span class="request__text"><span class="sr-only">${escapeHtml(who)}: </span>${escapeHtml(text)}</span>
        ${status}
      </li>`;
  }

  /** Calor do Sangue quente (0..1): a figurinha dele acende. */
  setHeat(heat: number): void {
    const rounded = Math.round(heat * 20) / 20;
    if (rounded === this.heat) return;
    this.heat = rounded;
    this.applyHeat();
  }

  /** Pedido cumprido: o cartão dá um pulinho. */
  flashRequests(): void {
    this.element.classList.remove('is-flash');
    // Reinicia a animação mesmo se o flash anterior ainda estiver rodando.
    void this.element.offsetWidth;
    this.element.classList.add('is-flash');
  }

  private setCollapsed(collapsed: boolean): void {
    this.requests.classList.toggle('is-collapsed', collapsed);
    this.requestsToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  private applyHeat(): void {
    const chip = this.perkRow.querySelector<HTMLElement>('.perk-icon--hotBlood');
    chip?.style.setProperty('--heat', this.heat.toFixed(2));
  }
}
