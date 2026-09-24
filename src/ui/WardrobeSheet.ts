import { onLocaleChange, t, type MessageKey } from '../i18n';
import { ACCESSORY_SLOTS, accessoriesIn, accessory, isAccessorySlot, type AccessorySlot } from '../progression/accessories';
import { ALL_LOOKS, lookFromKey, lookKey, lookRarity, lookUnlock, isLookKey, type Look, type LookKey } from '../progression/looks';
import type { Progression } from '../progression/Progression';
import { SKINS, isAnimatedSkin, skin } from '../progression/skins';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { GameIcons } from './gameIcons';
import { EmptySlotIcon, WardrobeTabIcons, lookIcon } from './lookIcons';
import { lookDesc, lookName, rarityName, unlockText } from './lookText';
import { bindTabs, tabsMarkup } from './tabs';

/** Abas do guarda-roupa: os cascos e um lugar do corpo por aba. */
export type WardrobeTab = 'skins' | AccessorySlot;

const TAB_ORDER: readonly WardrobeTab[] = ['skins', ...ACCESSORY_SLOTS];

const TABS: ReadonlyArray<{ name: WardrobeTab; icon: string; label: MessageKey }> = TAB_ORDER.map((name) => ({
  name,
  icon: WardrobeTabIcons[name],
  label: `wardrobe.tab.${name}` as MessageKey,
}));

/** O que está escolhido no cartão de cima de cada aba: um visual ou "nada" (lugar vazio). */
type Pick = Look | 'none';

function looksOf(tab: WardrobeTab): Look[] {
  return tab === 'skins' ? SKINS.map((s): Look => ({ kind: 'skin', id: s.id })) : accessoriesIn(tab).map((a): Look => ({ kind: 'acc', id: a.id }));
}

function isAnimated(look: Look): boolean {
  return look.kind === 'skin' ? isAnimatedSkin(skin(look.id)) : accessory(look.id).animated === true;
}

const samePick = (a: Pick | undefined, b: Pick) => a !== undefined && (a === 'none' || b === 'none' ? a === b : lookKey(a) === lookKey(b));

/**
 * Guarda-roupa (placa do menu): casco e acessórios do besouro, uma aba por
 * lugar do corpo. Clicar num liberado veste na hora (o besouro aparece de
 * frente no provador, à esquerda da placa); clicar num trancado PROVA — o
 * besouro veste enquanto a placa está aberta, e o cartão mostra como liberar.
 *
 * O selo "Novo" some quando o jogador sai da aba (ou fecha) depois de ver o
 * visual: dá tempo de achar o que chegou.
 */
export class WardrobeSheet {
  readonly element: HTMLElement;
  /** Visual sendo provado (trancado) ou null: o jogo veste por cima do que está salvo. */
  onPreview: ((look: Look | null) => void) | null = null;
  /** Aba mudou (a câmera do provador enquadra a parte do corpo dela). */
  onTabChange: ((tab: WardrobeTab) => void) | null = null;

  private readonly panels = new Map<WardrobeTab, HTMLElement>();
  private readonly buttons = new Map<WardrobeTab, HTMLButtonElement>();
  private readonly summary: HTMLElement;
  private readonly select: (name: WardrobeTab) => void;
  private tab: WardrobeTab = 'skins';
  private readonly picks = new Map<WardrobeTab, Pick>();
  private preview: Look | null = null;
  /** Visuais novos mostrados nesta visita à aba (viram "vistos" ao sair dela). */
  private readonly shownNew = new Set<LookKey>();

  constructor(private readonly progression: Progression) {
    const markup = tabsMarkup('wardrobe-', 'sheet-wardrobe-title', TABS);
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--wardrobe';
    this.element.id = 'sheet-wardrobe';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-wardrobe-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-wardrobe-title" data-t="menu.wardrobe"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="wardrobe-summary" data-summary></div>
      ${markup.tabs}
      <div class="sheet__body">${markup.panels}</div>`;
    this.summary = this.element.querySelector('[data-summary]') as HTMLElement;
    for (const name of TAB_ORDER) {
      this.buttons.set(name, this.element.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement);
      this.panels.set(name, this.element.querySelector(`[data-panel="${name}"]`) as HTMLElement);
    }
    this.select = bindTabs(TAB_ORDER, this.buttons, this.panels, (name) => this.onSelectTab(name));

    for (const [name, panel] of this.panels) {
      panel.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const action = target.closest<HTMLButtonElement>('[data-action]');
        if (action) {
          this.act(name, action.dataset.action!);
          return;
        }
        const tile = target.closest<HTMLButtonElement>('[data-pick]');
        if (tile) this.pick(name, tile.dataset.pick!);
      });
    }

    progression.subscribe(() => this.refresh());
    onLocaleChange(() => this.refresh());
  }

  /** Abrindo: aba dos cascos, cartões no que está vestido, nada sendo provado. */
  prepare(): void {
    this.setPreview(null);
    this.picks.clear();
    this.picks.set('skins', { kind: 'skin', id: this.progression.skin });
    for (const slot of ACCESSORY_SLOTS) {
      const worn = this.progression.outfit[slot];
      this.picks.set(slot, worn ? { kind: 'acc', id: worn } : 'none');
    }
    // A primeira aba com novidade abre direto (quem ganhou um chapéu quer ver o chapéu).
    const first = TAB_ORDER.find((tab) => looksOf(tab).some((look) => this.progression.isLookNew(look))) ?? 'skins';
    this.tab = first;
    this.select(first);
    this.render();
  }

  /** Fechando: tira o que estava sendo provado e dá como vistos os novos que apareceram. */
  close(): void {
    this.setPreview(null);
    this.flushSeen();
  }

  get currentTab(): WardrobeTab {
    return this.tab;
  }

  /** Estado mudou: redesenha se a placa está aberta. */
  refresh(): void {
    if (!this.element.hidden) this.render();
  }

  private onSelectTab(name: WardrobeTab): void {
    if (name === this.tab && !this.element.hidden) {
      this.onTabChange?.(name);
      return;
    }
    this.flushSeen();
    this.tab = name;
    this.setPreview(null);
    // Voltando pra aba, o cartão mostra o que está vestido.
    this.picks.set(name, this.wornPick(name));
    this.render();
    this.onTabChange?.(name);
  }

  private wornPick(tab: WardrobeTab): Pick {
    if (tab === 'skins') return { kind: 'skin', id: this.progression.skin };
    const worn = this.progression.outfit[tab];
    return worn ? { kind: 'acc', id: worn } : 'none';
  }

  private isWorn(look: Look): boolean {
    return look.kind === 'skin' ? this.progression.skin === look.id : this.progression.outfit[accessory(look.id).slot] === look.id;
  }

  /** Clique num quadradinho: veste (liberado), prova (trancado) ou tira (o "nada"). */
  private pick(tab: WardrobeTab, value: string): void {
    if (value === 'none') {
      if (isAccessorySlot(tab)) this.progression.setAccessory(tab, null);
      this.picks.set(tab, 'none');
      this.setPreview(null);
      this.render();
      this.focusPick('none');
      return;
    }
    if (!isLookKey(value)) return;
    const look = lookFromKey(value);
    this.picks.set(tab, look);
    if (this.progression.isLookUnlocked(look)) {
      this.setPreview(null);
      if (look.kind === 'skin') this.progression.setSkin(look.id);
      else this.progression.setAccessory(accessory(look.id).slot, look.id);
    } else {
      this.setPreview(look);
    }
    this.render();
    this.focusPick(value);
  }

  /** Botão do cartão de cima ("Tirar"). */
  private act(tab: WardrobeTab, action: string): void {
    if (action === 'remove' && isAccessorySlot(tab)) {
      this.progression.setAccessory(tab, null);
      this.picks.set(tab, 'none');
      this.render();
      this.focusPick('none');
    }
  }

  private setPreview(look: Look | null): void {
    const same = look === null ? this.preview === null : this.preview !== null && lookKey(this.preview) === lookKey(look);
    if (same) return;
    this.preview = look;
    this.onPreview?.(look);
  }

  private flushSeen(): void {
    if (this.shownNew.size === 0) return;
    const looks = [...this.shownNew].map(lookFromKey);
    this.shownNew.clear();
    this.progression.markLooksSeen(looks);
  }

  /** Depois de redesenhar, o foco volta pro mesmo quadradinho (teclado e controle não se perdem). */
  private focusPick(value: string): void {
    this.panels.get(this.tab)?.querySelector<HTMLElement>(`[data-pick="${value}"]`)?.focus({ preventScroll: true });
  }

  private render(): void {
    this.renderSummary();
    this.renderTabBadges();
    const panel = this.panels.get(this.tab)!;
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    const looks = looksOf(this.tab);
    const pick = this.picks.get(this.tab) ?? this.wornPick(this.tab);
    const tiles: string[] = [];
    if (this.tab !== 'skins') tiles.push(this.noneTile(pick === 'none'));
    for (const look of looks) {
      if (this.progression.isLookNew(look)) this.shownNew.add(lookKey(look));
      tiles.push(this.tile(look, samePick(pick, look)));
    }
    panel.innerHTML = /* html */ `${this.detail(pick)}<ul class="look-grid">${tiles.join('')}</ul>`;
    if (focused && panel.contains(document.activeElement) === false) this.focusPick(focused);
  }

  private renderSummary(): void {
    const total = ALL_LOOKS.length;
    const owned = ALL_LOOKS.filter((look) => this.progression.isLookUnlocked(look)).length;
    this.summary.innerHTML = /* html */ `
      <div class="catalog-progress__row"><strong>${escapeHtml(t('wardrobe.progress', { n: owned, total }))}</strong></div>
      <div class="catalog-progress__bar" aria-hidden="true"><span style="transform:scaleX(${(owned / total).toFixed(3)})"></span></div>
      <p class="catalog-progress__hint">${escapeHtml(t('wardrobe.hint'))}</p>`;
  }

  /** Bolinha na aba que tem visual novo esperando. */
  private renderTabBadges(): void {
    for (const tab of TAB_ORDER) {
      const button = this.buttons.get(tab)!;
      const fresh = looksOf(tab).some((look) => this.progression.isLookNew(look));
      button.classList.toggle('has-new', fresh);
    }
  }

  private noneTile(selected: boolean): string {
    const slot = this.tab as AccessorySlot;
    const worn = this.progression.outfit[slot] === null;
    const name = t(`wardrobe.none.${slot}` as MessageKey);
    const classes = ['look-tile', 'is-none', worn ? 'is-worn' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    return /* html */ `
      <li class="look-grid__cell">
        <button class="${classes}" type="button" data-pick="none" aria-pressed="${worn}" aria-label="${escapeHtml(name)}">
          <span class="look-tile__art" aria-hidden="true">${EmptySlotIcon}</span>
          <span class="look-tile__name" aria-hidden="true">${escapeHtml(name)}</span>
          ${worn ? `<span class="look-tile__state" aria-hidden="true">${Icons.check}</span>` : ''}
        </button>
      </li>`;
  }

  private tile(look: Look, selected: boolean): string {
    const unlocked = this.progression.isLookUnlocked(look);
    const worn = unlocked && this.isWorn(look);
    const fresh = this.progression.isLookNew(look);
    const trying = this.preview !== null && lookKey(this.preview) === lookKey(look);
    const rarity = lookRarity(look);
    const name = lookName(look);
    const status = worn ? t('wardrobe.wearing') : trying ? t('wardrobe.trying') : unlocked ? '' : t('wardrobe.locked');
    const label = [name, rarityName(rarity), status, fresh ? t('wardrobe.new') : ''].filter(Boolean).join(', ');
    const classes = [
      'look-tile',
      `is-${rarity}`,
      worn ? 'is-worn' : '',
      unlocked ? '' : 'is-locked',
      selected ? 'is-selected' : '',
      trying ? 'is-trying' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const state = worn ? Icons.check : unlocked ? '' : GameIcons.lock;
    return /* html */ `
      <li class="look-grid__cell">
        <button class="${classes}" type="button" data-pick="${lookKey(look)}" aria-pressed="${worn}" aria-label="${escapeHtml(label)}">
          <span class="look-tile__art" aria-hidden="true">${lookIcon(look)}</span>
          <span class="look-tile__name" aria-hidden="true">${escapeHtml(name)}</span>
          ${fresh ? `<span class="look-tile__new" aria-hidden="true">${escapeHtml(t('wardrobe.new'))}</span>` : ''}
          ${state ? `<span class="look-tile__state" aria-hidden="true">${state}</span>` : ''}
        </button>
      </li>`;
  }

  /** Cartão de cima: o visual escolhido (ou o "nada"), com raridade, descrição e o que fazer. */
  private detail(pick: Pick): string {
    if (pick === 'none') {
      const slot = this.tab as AccessorySlot;
      return /* html */ `
        <div class="look-detail is-none" aria-live="polite">
          <span class="look-detail__art" aria-hidden="true">${EmptySlotIcon}</span>
          <div class="look-detail__text">
            <div class="look-detail__row"><strong>${escapeHtml(t(`wardrobe.none.${slot}` as MessageKey))}</strong></div>
            <p>${escapeHtml(t('wardrobe.noneDesc'))}</p>
          </div>
        </div>`;
    }
    const unlocked = this.progression.isLookUnlocked(pick);
    const worn = unlocked && this.isWorn(pick);
    const rarity = lookRarity(pick);
    const chips =
      `<span class="rarity-chip is-${rarity}">${escapeHtml(rarityName(rarity))}</span>` +
      (isAnimated(pick) ? `<span class="anim-chip">${GameIcons.sparkle}${escapeHtml(t('wardrobe.animated'))}</span>` : '') +
      (pick.kind === 'acc' && this.progression.wasFound(pick.id) ? `<span class="found-chip">${escapeHtml(t('wardrobe.found'))}</span>` : '');
    let footer = '';
    if (!unlocked) {
      const unlock = lookUnlock(pick)!;
      // Acessório também pode ser achado no jardim (cascos não).
      const find = pick.kind === 'acc' ? `<p class="look-detail__find">${GameIcons.sparkle}<span>${escapeHtml(t('wardrobe.findHint'))}</span></p>` : '';
      footer = /* html */ `
        <p class="look-detail__unlock">${GameIcons.lock}<span>${escapeHtml(unlockText(unlock, (id) => this.progression.hasAchievement(id)))}</span></p>
        ${find}
        <span class="look-detail__status is-trying">${escapeHtml(t('wardrobe.trying'))}</span>`;
    } else if (worn && pick.kind === 'acc') {
      footer = /* html */ `
        <span class="look-detail__status is-worn">${Icons.check}${escapeHtml(t('wardrobe.wearing'))}</span>
        <button class="look-detail__action" type="button" data-action="remove">${escapeHtml(t('wardrobe.remove'))}</button>`;
    } else if (worn) {
      footer = `<span class="look-detail__status is-worn">${Icons.check}${escapeHtml(t('wardrobe.wearing'))}</span>`;
    }
    return /* html */ `
      <div class="look-detail is-${rarity}${unlocked ? '' : ' is-locked'}" aria-live="polite">
        <span class="look-detail__art" aria-hidden="true">${lookIcon(pick)}</span>
        <div class="look-detail__text">
          <div class="look-detail__row"><strong>${escapeHtml(lookName(pick))}</strong>${chips}</div>
          <p>${escapeHtml(lookDesc(pick))}</p>
          ${footer ? `<div class="look-detail__footer">${footer}</div>` : ''}
        </div>
      </div>`;
  }
}
