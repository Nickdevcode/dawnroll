import { onLocaleChange, t, type MessageKey } from '../i18n';
import { ACCESSORIES, ACCESSORY_SLOTS, accessory } from '../progression/accessories';
import { CHESTS, CHEST_PRICES, SHOP_CHESTS, rarityRank, type ChestGrant, type ShopChest } from '../progression/economy';
import { isLookKey, lookFromKey, lookKey, lookRarity, lookUnlock, type Look, type LookKey } from '../progression/looks';
import type { Progression } from '../progression/Progression';
import { SKINS, isAnimatedSkin, skin } from '../progression/skins';
import { RARITIES, priceParts, type Price, type Rarity } from '../progression/unlocks';
import { ChestIcons, ChestTabIcon } from './economyIcons';
import { GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { WardrobeTabIcons, lookIcon } from './lookIcons';
import { chestName, lookDesc, lookName, rarityName } from './lookText';
import { PurchaseConfirm, amountChip, buyButton, walletMarkup } from './purchase';
import { bindTabs, tabsMarkup } from './tabs';

/** Abas da Feirinha: os baús, os cascos e os acessórios à venda. */
export type ShopTab = 'chests' | 'skins' | 'accessories';

const TAB_ORDER: readonly ShopTab[] = ['chests', 'skins', 'accessories'];

const TABS: ReadonlyArray<{ name: ShopTab; icon: string; label: MessageKey }> = [
  { name: 'chests', icon: ChestTabIcon, label: 'shop.tab.chests' },
  { name: 'skins', icon: WardrobeTabIcons.skins, label: 'shop.tab.skins' },
  { name: 'accessories', icon: WardrobeTabIcons.head, label: 'shop.tab.accessories' },
];

const priceOf = (look: Look): Price | null => {
  const unlock = lookUnlock(look);
  return unlock && 'shop' in unlock ? unlock.shop : null;
};

/** Moedas antes do orvalho; dentro de cada uma, do mais barato pro mais caro. */
function byPrice(a: Look, b: Look): number {
  const pa = priceParts(priceOf(a)!);
  const pb = priceParts(priceOf(b)!);
  if (pa.currency !== pb.currency) return pa.currency === 'coins' ? -1 : 1;
  return pa.amount - pb.amount;
}

const SHOP_SKINS: readonly Look[] = SKINS.map((s): Look => ({ kind: 'skin', id: s.id })).filter((look) => priceOf(look) !== null).sort(byPrice);
const SHOP_ACCESSORIES: readonly Look[] = ACCESSORIES.map((a): Look => ({ kind: 'acc', id: a.id })).filter((look) => priceOf(look) !== null);
/** Os que só saem de baú (mostrados na aba dos baús: é o motivo de abrir). */
const CHEST_ONLY: readonly Look[] = [...SKINS.map((s): Look => ({ kind: 'skin', id: s.id })), ...ACCESSORIES.map((a): Look => ({ kind: 'acc', id: a.id }))]
  .filter((look) => {
    const unlock = lookUnlock(look);
    return unlock !== undefined && 'chest' in unlock;
  })
  .sort((a, b) => rarityRank(lookRarity(a)) - rarityRank(lookRarity(b)));

function isAnimated(look: Look): boolean {
  return look.kind === 'skin' ? isAnimatedSkin(skin(look.id)) : accessory(look.id).animated === true;
}

/**
 * Feirinha (placa do menu): gasta as moedas e o orvalho. Os baús do jogador
 * (pra abrir) e os à venda; os cascos e acessórios da Feirinha, que dá pra
 * provar no besouro antes de comprar (a câmera do provador liga igual ao
 * guarda-roupa). Comprar pede dois toques; comprado, veste na hora.
 */
export class ShopSheet {
  readonly element: HTMLElement;
  /** Visual sendo provado (null = volta pro que está vestido). */
  onPreview: ((look: Look | null) => void) | null = null;
  /** Pediu pra abrir um baú (o jogo faz a cerimônia). */
  onOpenChest: ((key: string) => void) | null = null;
  /** Comprou algo (o jogo toca o som das moedas). */
  onPurchase: (() => void) | null = null;

  private readonly panels = new Map<ShopTab, HTMLElement>();
  private readonly buttons = new Map<ShopTab, HTMLButtonElement>();
  private readonly summary: HTMLElement;
  private readonly select: (name: ShopTab) => void;
  private tab: ShopTab = 'chests';
  /** O visual do cartão de cima em cada aba de visuais. */
  private readonly picks = new Map<ShopTab, Look>();
  private preview: Look | null = null;
  private readonly confirm = new PurchaseConfirm(() => this.refresh());
  /** Acabou de comprar (o cartão comemora). */
  private justBought: LookKey | null = null;

  constructor(private readonly progression: Progression) {
    const markup = tabsMarkup('shop-', 'sheet-shop-title', TABS);
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--showcase sheet--shop';
    this.element.id = 'sheet-shop';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-shop-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-shop-title" data-t="menu.shop"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="shop-summary" data-summary aria-live="polite"></div>
      ${markup.tabs}
      <div class="sheet__body">${markup.panels}</div>`;
    this.summary = this.element.querySelector('[data-summary]') as HTMLElement;
    for (const name of TAB_ORDER) {
      this.buttons.set(name, this.element.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement);
      this.panels.set(name, this.element.querySelector(`[data-panel="${name}"]`) as HTMLElement);
    }
    this.select = bindTabs(TAB_ORDER, this.buttons, this.panels, (name) => this.onSelectTab(name));
    for (const [name, panel] of this.panels) panel.addEventListener('click', (e) => this.onClick(name, e));
    progression.subscribe(() => this.refresh());
    onLocaleChange(() => this.refresh());
  }

  get currentTab(): ShopTab {
    return this.tab;
  }

  /** O visual sendo provado agora (a câmera enquadra o lugar dele). */
  get previewing(): Look | null {
    return this.preview;
  }

  /** Abrindo: vai pros baús se tem algum esperando; senão, pros cascos. */
  prepare(tab?: ShopTab): void {
    this.confirm.reset();
    this.justBought = null;
    this.setPreview(null);
    const first = tab ?? (this.progression.chests.length > 0 ? 'chests' : 'skins');
    this.tab = first;
    this.select(first);
    this.render();
  }

  close(): void {
    this.confirm.reset();
    this.setPreview(null);
  }

  refresh(): void {
    if (!this.element.hidden) this.render();
  }

  private onSelectTab(name: ShopTab): void {
    if (name === this.tab && !this.element.hidden) return;
    this.tab = name;
    this.confirm.reset();
    this.justBought = null;
    // Nas abas de visuais o cartão de cima já prova o primeiro (o besouro mostra na hora).
    const pick = this.pickFor(name);
    this.setPreview(pick && !this.progression.isLookUnlocked(pick) ? pick : null);
    this.render();
  }

  private pickFor(tab: ShopTab): Look | null {
    if (tab === 'chests') return null;
    const existing = this.picks.get(tab);
    if (existing) return existing;
    const list = tab === 'skins' ? SHOP_SKINS : SHOP_ACCESSORIES;
    const first = list.find((look) => !this.progression.isLookUnlocked(look)) ?? list[0];
    this.picks.set(tab, first);
    return first;
  }

  private onClick(tab: ShopTab, e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const opener = target.closest<HTMLButtonElement>('[data-open-chest]');
    if (opener) {
      this.onOpenChest?.(opener.dataset.openChest!);
      return;
    }
    const buyChest = target.closest<HTMLButtonElement>('[data-action="buy-chest"]');
    if (buyChest) {
      this.buyChest(buyChest.dataset.rarity as ShopChest);
      return;
    }
    const action = target.closest<HTMLButtonElement>('[data-action]');
    if (action) {
      this.act(tab, action.dataset.action!);
      return;
    }
    const tile = target.closest<HTMLButtonElement>('[data-pick]');
    if (tile && isLookKey(tile.dataset.pick!)) this.pick(tab, lookFromKey(tile.dataset.pick as LookKey));
  }

  /** Clique num visual: vai pro cartão de cima e o besouro prova (os já comprados também). */
  private pick(tab: ShopTab, look: Look): void {
    if (tab !== 'chests') this.picks.set(tab, look);
    this.confirm.reset();
    this.justBought = null;
    this.setPreview(this.isWorn(look) ? null : look);
    this.render();
    this.focus(`[data-pick="${lookKey(look)}"]`);
  }

  private act(tab: ShopTab, action: string): void {
    const look = this.picks.get(tab);
    if (!look) return;
    const key = lookKey(look);
    if (action === 'buy') {
      if (!this.confirm.press(key)) {
        this.render();
        this.focus('[data-action="buy"]');
        return;
      }
      if (this.progression.buyLook(look) === 'ok') {
        this.justBought = key;
        this.wear(look);
        this.onPurchase?.();
      }
      this.render();
      this.focus(`[data-pick="${key}"]`);
      return;
    }
    if (action === 'wear') {
      this.wear(look);
      this.render();
      this.focus(`[data-pick="${key}"]`);
    }
  }

  private buyChest(rarity: ShopChest): void {
    if (!this.confirm.press(`chest:${rarity}`)) {
      this.render();
      this.focus(`[data-rarity="${rarity}"]`);
      return;
    }
    if (this.progression.buyChest(rarity)) this.onPurchase?.();
    this.render();
    this.focus('[data-open-chest]');
  }

  private wear(look: Look): void {
    this.setPreview(null);
    if (look.kind === 'skin') this.progression.setSkin(look.id);
    else this.progression.setAccessory(accessory(look.id).slot, look.id);
  }

  private isWorn(look: Look): boolean {
    return look.kind === 'skin' ? this.progression.skin === look.id : this.progression.outfit[accessory(look.id).slot] === look.id;
  }

  private setPreview(look: Look | null): void {
    const same = look === null ? this.preview === null : this.preview !== null && lookKey(this.preview) === lookKey(look);
    if (same) return;
    this.preview = look;
    this.onPreview?.(look);
  }

  private focus(selector: string): void {
    this.panels.get(this.tab)?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  // --- desenho ------------------------------------------------------------------------

  private render(): void {
    const wallet = this.progression.wallet;
    this.summary.innerHTML = /* html */ `${walletMarkup(wallet)}<p class="shop-summary__hint">${escapeHtml(t('shop.hint'))}</p>`;
    this.buttons.get('chests')!.classList.toggle('has-new', this.progression.chests.length > 0);
    const panel = this.panels.get(this.tab)!;
    if (this.tab === 'chests') panel.innerHTML = this.chestsPanel();
    else panel.innerHTML = this.looksPanel(this.tab);
  }

  private chestsPanel(): string {
    const chests = this.progression.chests;
    const wallet = this.progression.wallet;
    // Um cartão por raridade, com quantos tem.
    const groups = new Map<Rarity, ChestGrant[]>();
    for (const chest of chests) groups.set(chest.rarity, [...(groups.get(chest.rarity) ?? []), chest]);
    const owned = [...RARITIES]
      .reverse()
      .filter((rarity) => groups.has(rarity))
      .map((rarity) => {
        const list = groups.get(rarity)!;
        return /* html */ `
          <li class="chest-card is-${rarity}">
            <span class="chest-card__art" aria-hidden="true">${ChestIcons[rarity]}</span>
            <span class="chest-card__text"><strong>${escapeHtml(chestName(rarity))}</strong><span>${escapeHtml(t('shop.chestCount', { n: list.length }))}</span></span>
            <button class="chest-card__open" type="button" data-open-chest="${escapeHtml(list[0].key)}">${escapeHtml(t('shop.open'))}</button>
          </li>`;
      })
      .join('');
    const offers = SHOP_CHESTS.map((rarity) => {
      const armed = this.confirm.isArmed(`chest:${rarity}`);
      const chance = Math.round(CHESTS[rarity].itemChance * 100);
      return /* html */ `
        <li class="chest-offer is-${rarity}">
          <span class="chest-card__art" aria-hidden="true">${ChestIcons[rarity]}</span>
          <span class="chest-card__text"><strong>${escapeHtml(chestName(rarity))}</strong><span>${escapeHtml(t('shop.chestOffer', { n: chance }))}</span></span>
          <span class="chest-offer__buy">${buyButton({ dew: CHEST_PRICES[rarity] }, wallet, armed, 'buy-chest', `data-rarity="${rarity}"`)}</span>
        </li>`;
    }).join('');
    const exclusives = CHEST_ONLY.map((look) => this.tile(look, false, false)).join('');
    const odds = RARITIES.map((rarity) => t('shop.odd', { chest: chestName(rarity), n: Math.round(CHESTS[rarity].itemChance * 100) })).join(' · ');
    return /* html */ `
      <h3 class="sheet__heading">${escapeHtml(t('shop.yourChests'))}</h3>
      ${
        owned
          ? `<ul class="chest-list">${owned}</ul>`
          : `<div class="shop-empty"><span aria-hidden="true">${ChestIcons.common}</span><p>${escapeHtml(t('shop.noChests'))}</p></div>`
      }
      <h3 class="sheet__heading">${escapeHtml(t('shop.buyChests'))}</h3>
      <ul class="chest-list">${offers}</ul>
      <h3 class="sheet__heading">${escapeHtml(t('shop.chestOnly'))}</h3>
      <ul class="look-grid">${exclusives}</ul>
      <p class="shop-odds">${escapeHtml(t('shop.odds', { odds }))}</p>`;
  }

  private looksPanel(tab: ShopTab): string {
    const pick = this.pickFor(tab)!;
    const cards = this.detail(pick);
    if (tab === 'skins') return `${cards}<ul class="look-grid">${SHOP_SKINS.map((look) => this.tile(look, true, lookKey(look) === lookKey(pick))).join('')}</ul>`;
    // Acessórios: separados pelo lugar do corpo.
    const sections = ACCESSORY_SLOTS.map((slot) => {
      const looks = SHOP_ACCESSORIES.filter((look) => look.kind === 'acc' && accessory(look.id).slot === slot).sort(byPrice);
      if (looks.length === 0) return '';
      return /* html */ `
        <h3 class="shop-slot">${WardrobeTabIcons[slot]}<span>${escapeHtml(t(`wardrobe.tab.${slot}` as MessageKey))}</span></h3>
        <ul class="look-grid">${looks.map((look) => this.tile(look, true, lookKey(look) === lookKey(pick))).join('')}</ul>`;
    }).join('');
    return `${cards}${sections}`;
  }

  private tile(look: Look, withPrice: boolean, selected: boolean): string {
    const owned = this.progression.isLookUnlocked(look);
    const worn = owned && this.isWorn(look);
    const trying = this.preview !== null && lookKey(this.preview) === lookKey(look);
    const rarity = lookRarity(look);
    const name = lookName(look);
    const price = priceOf(look);
    const status = worn ? t('wardrobe.wearing') : owned ? t('shop.owned') : '';
    const label = [name, rarityName(rarity), status].filter(Boolean).join(', ');
    const classes = ['look-tile', `is-${rarity}`, owned ? '' : 'is-locked is-for-sale', worn ? 'is-worn' : '', selected ? 'is-selected' : '', trying ? 'is-trying' : '']
      .filter(Boolean)
      .join(' ');
    const priceTag = withPrice && price && !owned ? (() => {
      const { currency, amount } = priceParts(price);
      return `<span class="look-tile__price" aria-hidden="true">${amountChip(currency, amount)}</span>`;
    })() : '';
    const state = worn || owned ? `<span class="look-tile__state" aria-hidden="true">${Icons.check}</span>` : '';
    return /* html */ `
      <li class="look-grid__cell">
        <button class="${classes}" type="button" data-pick="${lookKey(look)}" aria-pressed="${selected}" aria-label="${escapeHtml(label)}">
          <span class="look-tile__art" aria-hidden="true">${lookIcon(look)}</span>
          <span class="look-tile__name" aria-hidden="true">${escapeHtml(name)}</span>
          ${priceTag}${state}
        </button>
      </li>`;
  }

  /** Cartão de cima: o visual escolhido, com preço e o botão de comprar (ou vestir). */
  private detail(look: Look): string {
    const owned = this.progression.isLookUnlocked(look);
    const worn = owned && this.isWorn(look);
    const rarity = lookRarity(look);
    const price = priceOf(look)!;
    const key = lookKey(look);
    const chips =
      `<span class="rarity-chip is-${rarity}">${escapeHtml(rarityName(rarity))}</span>` +
      (isAnimated(look) ? `<span class="anim-chip">${GameIcons.sparkle}${escapeHtml(t('wardrobe.animated'))}</span>` : '') +
      ('dew' in price ? `<span class="dew-chip">${escapeHtml(t('shop.rare'))}</span>` : '');
    let footer: string;
    if (this.justBought === key) {
      footer = `<span class="look-detail__status is-bought">${Icons.check}${escapeHtml(t('shop.bought'))}</span>`;
    } else if (worn) {
      footer = `<span class="look-detail__status is-worn">${Icons.check}${escapeHtml(t('wardrobe.wearing'))}</span>`;
    } else if (owned) {
      footer = `<span class="look-detail__status is-owned">${Icons.check}${escapeHtml(t('shop.owned'))}</span><button class="look-detail__action" type="button" data-action="wear">${escapeHtml(t('shop.wear'))}</button>`;
    } else {
      footer = buyButton(price, this.progression.wallet, this.confirm.isArmed(key));
    }
    return /* html */ `
      <div class="look-detail is-${rarity}${owned ? '' : ' is-locked'}${this.justBought === key ? ' is-celebrating' : ''}" aria-live="polite">
        <span class="look-detail__art" aria-hidden="true">${lookIcon(look)}</span>
        <div class="look-detail__text">
          <div class="look-detail__row"><strong>${escapeHtml(lookName(look))}</strong>${chips}</div>
          <p>${escapeHtml(lookDesc(look))}</p>
          <div class="look-detail__footer">${footer}</div>
        </div>
      </div>`;
  }
}
