import { settings, HOLD_MODES, QUALITY_PRESETS, type GameSettings, type QualityPreset, type ShadowQuality } from '../core/settings';
import type { HoldMode, InputDevice } from '../core/Input';
import type { SaveData } from '../core/save';
import {
  LOCALE_NAMES,
  LOCALES,
  detectedLocale,
  formatCm,
  getLanguagePreference,
  onLocaleChange,
  setLanguagePreference,
  t,
  tn,
  type LanguagePreference,
  type MessageKey,
} from '../i18n';
import { PAD_LABELS, type MenuAction, type PadButton, type PadStyle } from '../core/GamepadInput';
import type { Progression } from '../progression/Progression';
import { skin } from '../progression/skins';
import type { Online } from '../online/Online';
import type { ClanStore } from '../online/ClanStore';
import type { Social } from '../online/Social';
import { Icons } from './icons';
import { GameIcons } from './gameIcons';
import { segmented, slider, toggle, type Control } from './controls';
import { BurrowSheet } from './BurrowSheet';
import { WardrobeSheet } from './WardrobeSheet';
import { ShopSheet } from './ShopSheet';
import { PassSheet } from './PassSheet';
import { WelcomeDialog } from './WelcomeDialog';
import { PassIcon, ShopIcon } from './economyIcons';
import { amountChip } from './purchase';
import { shownSeason } from '../progression/seasons';
import { RankingSheet } from './RankingSheet';
import { OnlineSheet } from './OnlineSheet';
import type { OnlinePlay } from '../net/OnlinePlay';
import { AccountSheet } from './AccountSheet';
import { NicknameDialog } from './NicknameDialog';
import { HangerIcon, skinIcon } from './lookIcons';
import { escapeHtml } from './html';
import { bindTabs, tabsMarkup } from './tabs';
import { nearestInDirection } from './spatialNav';
import { padCapKind } from './prompts';

/**
 * Menu de início e de pausa: a "madrugada" por cima do jardim (que continua
 * girando ao vivo atrás). Jogar faz amanhecer; pausar faz a noite voltar.
 * Tem oito placas que deslizam por cima: Toca (despensa, catálogo, poderes e
 * conquistas), Guarda-roupa (casco e acessórios, com o besouro no provador),
 * Feirinha (baús e o que se compra com moedas e orvalho), Passe da temporada,
 * Ranking, Conta (a do chip no canto de cima), Configurações (com abas) e Como jogar.
 */

export type SheetName = 'online' | 'burrow' | 'wardrobe' | 'shop' | 'pass' | 'ranking' | 'account' | 'settings' | 'help';
const SHEETS: readonly SheetName[] = ['online', 'burrow', 'wardrobe', 'shop', 'pass', 'ranking', 'account', 'settings', 'help'];
/** Placas com o besouro no provador (a câmera vem pra frente dele e o menu principal sai de cena). */
export const SHOWCASE_SHEETS: ReadonlySet<SheetName> = new Set(['wardrobe', 'shop', 'pass']);
type TabName = 'graphics' | 'audio' | 'controls' | 'language';

const TABS: ReadonlyArray<{ name: TabName; icon: string; label: MessageKey }> = [
  { name: 'graphics', icon: Icons.graphics, label: 'settings.tab.graphics' },
  { name: 'audio', icon: Icons.audio, label: 'settings.tab.audio' },
  { name: 'controls', icon: Icons.controls, label: 'settings.tab.controls' },
  { name: 'language', icon: Icons.globe, label: 'settings.tab.language' },
];

/** O "o" do logo: a bola-sol de massinha (raios girando devagar, a bola rolando). */
const SUN = `
<svg class="sun" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="sun-clay" cx="0.36" cy="0.32" r="0.78">
      <stop offset="0" stop-color="#ffe7a3"/>
      <stop offset="0.42" stop-color="#ffb547"/>
      <stop offset="1" stop-color="#b8611d"/>
    </radialGradient>
  </defs>
  <g class="sun__rays">
    ${Array.from({ length: 10 }, (_, i) => `<rect x="55.5" y="1" width="9" height="19" rx="4.5" transform="rotate(${i * 36} 60 60)"/>`).join('')}
  </g>
  <circle cx="60" cy="60" r="35" fill="url(#sun-clay)"/>
  <g class="sun__ball">
    <circle cx="46" cy="66" r="5" fill="#c9701f" opacity="0.5"/>
    <circle cx="72" cy="74" r="6.5" fill="#a85a1a" opacity="0.45"/>
    <circle cx="74" cy="48" r="3.5" fill="#d98027" opacity="0.5"/>
    <path d="M40 52c5-3 10-3 14 0" stroke="#fff0bf" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>
    <path d="M60 82c5 1 9-1 11-4" stroke="#fff0bf" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.7"/>
  </g>
  <ellipse cx="48" cy="42" rx="12" ry="7" fill="#fff8e1" opacity="0.55" transform="rotate(-28 48 42)"/>
</svg>`;

export class Menu {
  readonly element: HTMLElement;
  /** Apertou Jogar / Continuar. */
  onPlay: (() => void) | null = null;
  /** Uma placa abriu (ou fechou, com null): o guarda-roupa liga o provador. */
  onSheetChange: ((sheet: SheetName | null) => void) | null = null;
  /** Arrastou no provador (fora da placa): gira o besouro (px na horizontal). */
  onShowcaseDrag: ((dx: number) => void) | null = null;
  /** Pediu pra abrir um baú (Feirinha ou boas-vindas): o jogo faz a cerimônia. */
  onOpenChest: ((key: string) => void) | null = null;
  /** "Jogar o tutorial de novo" (Como jogar). */
  onReplayTutorial: (() => void) | null = null;
  /** "Pular tutorial" (pausa, com o tutorial na tela). */
  onSkipTutorial: (() => void) | null = null;

  private readonly playButton: HTMLButtonElement;
  private readonly playLabel: HTMLElement;
  private readonly skipTutorialButton: HTMLButtonElement;
  private readonly replayTutorialButton: HTMLButtonElement;
  /** Controle ligado (a ajuda mostra os botões dele mesmo usando o teclado). */
  private padConnected = false;
  private inputDevice: InputDevice = 'keyboard';
  private padStyle: PadStyle = 'xbox';
  private readonly record: HTMLElement;
  private readonly burrowMeta: HTMLElement;
  private readonly burrowBadge: HTMLElement;
  private readonly wardrobeBadge: HTMLElement;
  private readonly shopBadge: HTMLElement;
  private readonly shopMeta: HTMLElement;
  private readonly passBadge: HTMLElement;
  private readonly passMeta: HTMLElement;
  private shownWallet = '';
  /** Placa da toca (o jogo liga o `onMeal` dela). */
  readonly burrow: BurrowSheet;
  /** Guarda-roupa (o jogo liga o provador e o "provar"). */
  readonly wardrobe: WardrobeSheet;
  /** Feirinha (baús e compras; também prova no besouro). */
  readonly shop: ShopSheet;
  /** Passe da temporada. */
  readonly pass: PassSheet;
  private readonly welcome: WelcomeDialog;
  private readonly ranking: RankingSheet;
  private readonly account: AccountSheet;
  /** Placa "Jogar online" (salas). */
  private readonly onlineSheet: OnlineSheet;
  private readonly onlineMeta: HTMLElement;
  /** Bolinha do "Jogar online": pedidos de amizade + convites esperando. */
  private readonly onlineBadge: HTMLElement;
  private net: OnlinePlay | null = null;
  private readonly nicknameDialog: NicknameDialog;
  /** Chip da conta no canto de cima (besouro + apelido, ou "Entrar"). */
  private readonly accountChip: HTMLButtonElement;
  private readonly sheets: Record<SheetName, HTMLElement>;
  private readonly openers: Record<SheetName, HTMLButtonElement>;
  private readonly tabButtons = new Map<TabName, HTMLButtonElement>();
  private readonly tabPanels = new Map<TabName, HTMLElement>();
  /** Textos fixos: elemento + chave (+ atributo, se não for o texto). */
  private readonly texts: Array<[HTMLElement, MessageKey, string?]> = [];
  private readonly controls: Control<never>[] = [];
  private readonly sync: Array<(s: Readonly<GameSettings>) => void> = [];

  private ready = false;
  /** A tela de carregamento já saiu da frente (as janelinhas modais esperam por isso). */
  private revealed = false;
  private paused = false;
  private openSheet: SheetName | null = null;
  private lastSave: SaveData | null = null;

  constructor(
    parent: HTMLElement,
    private readonly isTouch: boolean,
    private readonly progression: Progression,
    private readonly online: Online,
    private readonly social: Social,
    private readonly clans: ClanStore,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'menu';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'menu-title');
    this.element.innerHTML = /* html */ `
      <div class="menu__sky" aria-hidden="true"></div>
      <button class="menu__account" type="button" data-open="account" aria-expanded="false" aria-controls="sheet-account" hidden></button>
      <div class="menu__main">
        <h1 class="wordmark" id="menu-title">
          <span class="sr-only">Dawnroll</span>
          <span class="wordmark__text" aria-hidden="true">Dawnr<span class="wordmark__sun">${SUN}</span>ll</span>
        </h1>
        <p class="menu__tagline" data-t="menu.tagline"></p>
        <div class="menu__actions">
          <button class="menu__play" type="button" data-play disabled>
            <span class="menu__play-icon">${Icons.play}</span><span data-play-label></span>
          </button>
          <button class="menu__skip-tutorial" type="button" data-tutorial-skip hidden>
            <span data-t="tutorial.skipLong"></span>
          </button>
          <button class="menu__link menu__link--online" type="button" data-open="online" aria-expanded="false" aria-controls="sheet-online" hidden>
            <span class="menu__link-icon">${Icons.group}<span class="menu__link-badge" data-online-badge hidden></span></span>
            <span data-t="menu.online"></span><span class="menu__link-meta" data-online-meta></span>
          </button>
          <button class="menu__link" type="button" data-open="burrow" aria-expanded="false" aria-controls="sheet-burrow">
            <span class="menu__link-icon">${GameIcons.burrow}<span class="menu__link-badge" data-burrow-badge hidden></span></span>
            <span data-t="menu.burrow"></span><span class="menu__link-meta" data-burrow-meta></span>
          </button>
          <button class="menu__link" type="button" data-open="wardrobe" aria-expanded="false" aria-controls="sheet-wardrobe">
            <span class="menu__link-icon">${HangerIcon}<span class="menu__link-badge" data-wardrobe-badge hidden></span></span>
            <span data-t="menu.wardrobe"></span>
          </button>
          <button class="menu__link" type="button" data-open="shop" aria-expanded="false" aria-controls="sheet-shop">
            <span class="menu__link-icon">${ShopIcon}<span class="menu__link-badge" data-shop-badge hidden></span></span>
            <span data-t="menu.shop"></span><span class="menu__link-meta menu__link-meta--wallet" data-shop-meta></span>
          </button>
          <button class="menu__link" type="button" data-open="pass" aria-expanded="false" aria-controls="sheet-pass">
            <span class="menu__link-icon">${PassIcon}<span class="menu__link-badge" data-pass-badge hidden></span></span>
            <span data-t="menu.passLink"></span><span class="menu__link-meta" data-pass-meta></span>
          </button>
          <button class="menu__link" type="button" data-open="ranking" aria-expanded="false" aria-controls="sheet-ranking" hidden>
            <span class="menu__link-icon">${Icons.podium}</span><span data-t="menu.ranking"></span>
          </button>
          <button class="menu__link" type="button" data-open="settings" aria-expanded="false" aria-controls="sheet-settings">
            <span class="menu__link-icon">${Icons.gear}</span><span data-t="menu.settings"></span>
          </button>
          <button class="menu__link" type="button" data-open="help" aria-expanded="false" aria-controls="sheet-help">
            <span class="menu__link-icon">${Icons.book}</span><span data-t="menu.howToPlay"></span>
          </button>
        </div>
        <p class="menu__record" data-record></p>
        <p class="menu__pad-legend" data-pad-legend hidden>
          <kbd class="padcap padcap--face" data-pad="a" data-btn="a"></kbd><span data-t="pad.select"></span>
          <kbd class="padcap padcap--face" data-pad="b" data-btn="b"></kbd><span data-t="pad.back"></span>
          <span class="menu__pad-tabs"><kbd class="padcap padcap--shoulder" data-pad="lb" data-btn="lb"></kbd><kbd class="padcap padcap--shoulder" data-pad="rb" data-btn="rb"></kbd><span data-t="pad.tabs"></span></span>
        </p>
      </div>
      ${this.settingsSheet()}
      ${this.helpSheet()}
    `;
    // A placa da toca entra antes da coleta dos textos (ela também usa data-t).
    this.burrow = new BurrowSheet(progression);
    this.wardrobe = new WardrobeSheet(progression);
    this.shop = new ShopSheet(progression);
    this.pass = new PassSheet(progression);
    this.ranking = new RankingSheet(online);
    this.account = new AccountSheet(online, progression);
    this.onlineSheet = new OnlineSheet(online, social, clans);
    this.element.append(this.onlineSheet.element, this.burrow.element, this.wardrobe.element, this.shop.element, this.pass.element, this.ranking.element, this.account.element);
    parent.append(this.element);
    this.nicknameDialog = new NicknameDialog(parent, online, progression, () => this.isVisible && this.revealed);
    // Boas-vindas das moedas: não briga com a janelinha do apelido (espera ela fechar).
    this.welcome = new WelcomeDialog(parent, progression, () => this.isVisible && this.revealed && !this.nicknameDialog.isOpen);
    this.welcome.onOpenChests = () => {
      this.open('shop');
      this.shop.prepare('chests');
    };
    this.shop.onOpenChest = (key) => this.onOpenChest?.(key);
    // Do guarda-roupa: "Ver passe" / "Ver baús" nos visuais que vêm de lá.
    this.wardrobe.onNavigate = (target) => {
      this.open(target === 'chests' ? 'shop' : 'pass');
      if (target === 'chests') this.shop.prepare('chests');
    };
    this.ranking.onOpenAccount = () => this.open('account');
    this.onlineSheet.onOpenAccount = () => this.open('account');
    this.onlineSheet.onPlay = () => this.onPlay?.();
    this.account.onOpenRanking = () => this.open('ranking');

    const $ = <T extends HTMLElement>(sel: string) => this.element.querySelector(sel) as T;
    this.playButton = $('[data-play]');
    this.playLabel = $('[data-play-label]');
    this.skipTutorialButton = $('[data-tutorial-skip]');
    this.replayTutorialButton = $('[data-tutorial-replay]');
    this.record = $('[data-record]');
    this.burrowMeta = $('[data-burrow-meta]');
    this.burrowBadge = $('[data-burrow-badge]');
    this.wardrobeBadge = $('[data-wardrobe-badge]');
    this.shopBadge = $('[data-shop-badge]');
    this.shopMeta = $('[data-shop-meta]');
    this.passBadge = $('[data-pass-badge]');
    this.passMeta = $('[data-pass-meta]');
    this.onlineMeta = $('[data-online-meta]');
    this.onlineBadge = $('[data-online-badge]');
    this.accountChip = $('[data-open="account"]');
    this.sheets = {
      online: this.onlineSheet.element,
      burrow: this.burrow.element,
      wardrobe: this.wardrobe.element,
      shop: this.shop.element,
      pass: this.pass.element,
      ranking: this.ranking.element,
      account: this.account.element,
      settings: $('#sheet-settings'),
      help: $('#sheet-help'),
    };
    this.openers = {
      online: $('[data-open="online"]'),
      burrow: $('[data-open="burrow"]'),
      wardrobe: $('[data-open="wardrobe"]'),
      shop: $('[data-open="shop"]'),
      pass: $('[data-open="pass"]'),
      ranking: $('[data-open="ranking"]'),
      account: this.accountChip,
      settings: $('[data-open="settings"]'),
      help: $('[data-open="help"]'),
    };

    this.element.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => this.texts.push([el, el.dataset.t as MessageKey]));
    this.element.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((el) => this.texts.push([el, el.dataset.tAria as MessageKey, 'aria-label']));

    this.buildSettings();
    this.bindEvents();

    settings.subscribe((s) => this.syncControls(s));
    progression.subscribe(() => {
      this.updateBurrowLink();
      this.updateAccountChip();
    });
    online.subscribe(() => this.updateAccountChip());
    social.subscribe(() => this.updateOnlineBadge());
    clans.subscribe(() => this.updateOnlineBadge());
    onLocaleChange(() => this.refreshTexts());
    this.syncControls(settings.get());
    this.refreshTexts();
    this.show(false);
  }

  get isVisible(): boolean {
    return !this.element.hidden;
  }

  /** O mundo terminou de carregar: Jogar fica disponível. */
  setReady(): void {
    this.ready = true;
    this.playButton.disabled = false;
    this.updatePlayLabel();
    this.playButton.focus({ preventScroll: true });
  }

  /** A tela de carregamento sumiu: agora as janelinhas (apelido, boas-vindas) podem aparecer. */
  setRevealed(): void {
    this.revealed = true;
    this.nicknameDialog.check();
    this.welcome.check();
  }

  /** Mostra o menu (a noite cai). `paused` troca Jogar por Continuar. */
  show(paused: boolean): void {
    this.paused = paused;
    this.updatePlayLabel();
    this.element.hidden = false;
    this.element.removeAttribute('inert');
    if (this.ready) this.playButton.focus({ preventScroll: true });
    // Entrou pelo Google e foi jogar antes do apelido carregar: a janelinha aparece na pausa.
    this.nicknameDialog?.check();
    // Boas-vindas (no carregamento ela espera o loader sair: ver `setRevealed`).
    this.welcome?.check();
  }

  /** Placa aberta agora (null = só o menu principal). */
  get currentSheet(): SheetName | null {
    return this.openSheet;
  }

  /** Placa do provador aberta (o jogo centraliza o besouro no pedaço da tela livre dela). */
  get showcaseSheet(): HTMLElement | null {
    return this.openSheet && SHOWCASE_SHEETS.has(this.openSheet) ? this.sheets[this.openSheet] : null;
  }

  /**
   * Cerimônia do baú: a placa e o menu principal saem de cena (o baú em 3D é o
   * centro) e voltam como estavam no fim.
   */
  setChestMode(on: boolean): void {
    this.element.classList.toggle('is-chest', on);
    if (on) this.element.setAttribute('inert', '');
    else if (!this.element.hidden) this.element.removeAttribute('inert');
    if (!on && this.openSheet) {
      const sheet = this.sheets[this.openSheet];
      (sheet.querySelector<HTMLElement>('[data-open-chest]') ?? sheet.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
    }
  }

  /** Esconde o menu (amanhece) e fecha qualquer placa aberta. */
  hide(): void {
    this.closeSheet(false);
    // Começou a jogar com as boas-vindas abertas (atalho de teclado): ela volta na próxima pausa.
    this.welcome.hide();
    this.element.hidden = true;
    this.element.setAttribute('inert', '');
  }

  /** Abre a placa da toca (pela tecla T, pelo botão do HUD ou na primeira vez, com o recado de apresentação). */
  openBurrow(intro = false): void {
    this.open('burrow', intro);
  }

  /** Controle ligado/desligado: a ajuda passa a mostrar os botões dele (no estilo certo: Xbox, PlayStation, Switch). */
  setGamepad(style: PadStyle | null): void {
    this.padConnected = style !== null;
    if (style) this.padStyle = style;
    this.refreshPadHelp();
  }

  /**
   * Dispositivo em uso mudou: a legenda de botões do menu só aparece no controle, e a
   * ajuda põe na frente os controles de quem está jogando.
   */
  setInputDevice(device: InputDevice, style: PadStyle): void {
    this.inputDevice = device;
    this.padStyle = style;
    this.refreshPadHelp();
  }

  /** Tutorial na tela: a pausa ganha o "Pular tutorial". Numa sala online o "Jogar o tutorial" espera. */
  setTutorialState(active: boolean, canReplay: boolean): void {
    this.skipTutorialButton.hidden = !active;
    this.replayTutorialButton.disabled = !canReplay;
  }

  private refreshPadHelp(): void {
    const onPad = this.inputDevice === 'gamepad';
    (this.element.querySelector('[data-pad-legend]') as HTMLElement).hidden = !onPad;
    (this.element.querySelector('[data-pad-help]') as HTMLElement).hidden = !(onPad || this.padConnected);
    this.element.querySelectorAll<HTMLElement>('[data-pad]').forEach((el) => {
      el.textContent = PAD_LABELS[this.padStyle][el.dataset.pad as PadButton];
      el.dataset.style = this.padStyle;
    });
  }

  /**
   * Navegação por controle: as direções andam pro vizinho na tela (grade do catálogo por
   * linha e coluna), esquerda/direita mudam o valor de slider/opção/aba em foco, A aciona,
   * B volta, LB/RB trocam de aba. Sem vizinho pra cima/baixo, a placa rola (texto corrido).
   * Devolve false quando o menu não usou a ação (ex.: B sem placa aberta = continuar).
   */
  handleGamepad(action: MenuAction): boolean {
    document.documentElement.classList.add('using-gamepad');
    // Janelinha aberta (apelido, boas-vindas): o controle anda só dentro dela (B = "Depois").
    const dialog = this.nicknameDialog.isOpen ? this.nicknameDialog.element : this.welcome.isOpen ? this.welcome.element : null;
    const sheet = dialog ?? (this.openSheet ? this.sheets[this.openSheet] : null);
    const focusables = sheet
      ? this.gamepadFocusables(sheet)
      : [...this.gamepadFocusables(this.element, this.accountChip), ...this.gamepadFocusables(this.element.querySelector('.menu__main') as HTMLElement)];
    const active = document.activeElement as HTMLElement | null;
    const current = active && focusables.includes(active) ? active : null;
    const focus = (el: HTMLElement | undefined) => {
      if (!el) return;
      el.focus({ preventScroll: false, focusVisible: true } as FocusOptions);
      el.scrollIntoView({ block: 'nearest' });
    };
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        if (!current) {
          focus(focusables[0]);
          return true;
        }
        if ((action === 'left' || action === 'right') && this.adjust(current, action)) return true;
        const next = nearestInDirection(current, focusables, action);
        if (next) focus(next);
        else if (sheet && (action === 'up' || action === 'down')) this.pageSheet(action === 'down' ? 1 : -1);
        return true;
      }
      case 'prevTab':
      case 'nextTab': {
        const tab = sheet?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        if (!tab) return true;
        // Mesmo caminho das setas numa aba (seleciona e foca a vizinha); a placa volta pro topo.
        tab.dispatchEvent(new KeyboardEvent('keydown', { key: action === 'nextTab' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
        const body = sheet?.querySelector<HTMLElement>('.sheet__body');
        if (body) body.scrollTop = 0;
        return true;
      }
      case 'confirm': {
        if (!current) {
          focus(focusables[0]);
          return true;
        }
        // Cartão de leitura com um botão dentro (casco: "Usar"): A aciona o botão.
        const inner = current.matches('button, input') ? null : current.querySelector<HTMLElement>('button:not(:disabled)');
        (inner ?? current).click();
        return true;
      }
      case 'back':
        if (dialog) {
          if (this.nicknameDialog.isOpen) this.nicknameDialog.close();
          else this.welcome.close();
          return true;
        }
        if (!this.openSheet) return false;
        this.closeSheet();
        return true;
      case 'start':
        return false;
    }
  }

  /** Analógico direito: rola a placa aberta (pixels; positivo = pra baixo). */
  scrollSheet(dy: number): void {
    if (!this.openSheet || dy === 0) return;
    const body = this.sheets[this.openSheet].querySelector<HTMLElement>('.sheet__body');
    if (body) body.scrollTop += dy;
  }

  /**
   * O que o controle alcança: botões, campos e `data-focusable` (itens de leitura — catálogo,
   * poderes, conquistas — que precisam de foco pra placa rolar até eles). Quem está dentro de
   * outro alcançável fica de fora (o "Usar" do casco é acionado pelo A no cartão).
   */
  private gamepadFocusables(scope: HTMLElement, only?: HTMLElement): HTMLElement[] {
    const candidates = only ? [only] : Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [data-focusable]'));
    const all = candidates.filter(
      (el) => el.tabIndex >= 0 && el.offsetParent !== null,
    );
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  }

  /** Esquerda/direita num controle de valor (slider, opção, aba). Devolve se era um deles. */
  private adjust(el: HTMLElement, action: 'left' | 'right'): boolean {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      if (action === 'right') el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const role = el.getAttribute('role');
    if (role !== 'radio' && role !== 'tab') return false;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: action === 'right' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
    return true;
  }

  /** Sem mais nada pra focar naquela direção: a placa rola uma boa parte da altura. */
  private pageSheet(direction: 1 | -1): void {
    const body = this.openSheet ? this.sheets[this.openSheet].querySelector<HTMLElement>('.sheet__body') : null;
    body?.scrollBy({ top: direction * body.clientHeight * 0.6, behavior: 'smooth' });
  }

  /** O online ficou pronto (o jardim já existe): a placa passa a acompanhar a sala. */
  attachOnlinePlay(net: OnlinePlay): void {
    this.net = net;
    this.onlineSheet.attach(net);
    net.subscribe(() => this.updateOnlineMode());
    this.updateOnlineMode();
  }

  /** Link `?sala=CÓDIGO`: abre a placa do online e entra na sala (assim que der). */
  openOnline(code: string): void {
    this.open('online');
    void this.onlineSheet.joinFromLink(code);
  }

  /** Abre a placa do online no lobby (entrou numa sala pelo convite com o menu aberto, até vindo da tela Amigos). */
  showOnline(): void {
    if (this.openSheet !== 'online') this.open('online');
    else this.onlineSheet.showLobby();
  }

  /** Abre direto os amigos ("Ver" no aviso de pedido de amizade). */
  openFriends(): void {
    if (this.openSheet !== 'online') this.open('online');
    this.onlineSheet.showFriends();
  }

  /** Abre direto a turma ("Ver" no aviso de convite pra turma). */
  openClan(): void {
    if (this.openSheet !== 'online') this.open('online');
    this.onlineSheet.showClan();
  }

  /** Bolinha do "Jogar online": quantos pedidos de amizade e convites (de sala e de turma) esperam. */
  private updateOnlineBadge(): void {
    const { requests, invites } = this.social.state;
    const count = requests + invites.length + this.clans.invites.length;
    this.onlineBadge.hidden = count === 0;
    this.onlineBadge.textContent = String(count);
    // Sem novidade, o nome vem do próprio texto do botão (com o código da sala, se estiver numa).
    if (count > 0) this.openers.online.setAttribute('aria-label', `${t('menu.online')}: ${tn('friends.news', count)}`);
    else this.openers.online.removeAttribute('aria-label');
  }

  /**
   * Dentro de uma sala o jogo não para: o que vira a câmera pro provador ou abre
   * baú (guarda-roupa, Feirinha, passe) espera a pessoa sair da sala. O link do
   * online mostra o código da sala.
   */
  private updateOnlineMode(): void {
    const inRoom = this.net?.active ?? false;
    this.element.classList.toggle('is-online', inRoom);
    for (const name of ['wardrobe', 'shop', 'pass'] as const) {
      this.openers[name].hidden = inRoom;
      if (inRoom && this.openSheet === name) this.closeSheet(false);
    }
    this.onlineMeta.textContent = inRoom && this.net?.code ? this.net.code : '';
  }

  setProgress(save: SaveData): void {
    this.lastSave = save;
    if (save.buried > 0) {
      this.record.innerHTML = `${Icons.trophy}<span><strong></strong><span class="menu__record-count"></span></span>`;
      (this.record.querySelector('strong') as HTMLElement).textContent = t('menu.recordBest', { cm: formatCm(save.bestCm) });
      (this.record.querySelector('.menu__record-count') as HTMLElement).textContent = tn('menu.recordCount', save.buried);
    } else {
      this.record.innerHTML = `${Icons.trophy}<span></span>`;
      (this.record.querySelector('span') as HTMLElement).textContent = t('menu.recordEmpty');
    }
  }

  // --- montagem ---------------------------------------------------------------

  private settingsSheet(): string {
    const { tabs, panels } = tabsMarkup('', 'sheet-settings-title', TABS);
    return /* html */ `
      <section class="sheet" id="sheet-settings" role="region" aria-labelledby="sheet-settings-title" hidden>
        <header class="sheet__header">
          <h2 class="sheet__title" id="sheet-settings-title" data-t="menu.settings"></h2>
          <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
        </header>
        ${tabs}
        <div class="sheet__body">${panels}</div>
        <footer class="sheet__footer">
          <button class="sheet__reset" type="button" data-reset>${Icons.reset}<span data-t="settings.reset"></span></button>
        </footer>
      </section>`;
  }

  private helpSheet(): string {
    const keys = (...caps: string[]) => caps.map((c) => `<kbd class="keycap">${c}</kbd>`).join('');
    const keyT = (key: MessageKey) => `<kbd class="keycap" data-t="${key}"></kbd>`;
    // O rótulo (A, ✕, B...) entra em `refreshPadHelp`, conforme o controle ligado.
    const pad = (...buttons: PadButton[]) => buttons.map((b) => `<kbd class="keycap padcap padcap--${padCapKind(b)}" data-pad="${b}" data-btn="${b}"></kbd>`).join('');
    const row = (caps: string, action: MessageKey) => `<div class="keys__row"><dt>${caps}</dt><dd data-t="${action}"></dd></div>`;
    const controls = this.isTouch
      ? /* html */ `<ul class="touch-list">
          <li data-t="touch.move"></li><li data-t="touch.look"></li><li data-t="touch.grab"></li>
          <li data-t="touch.jump"></li><li data-t="touch.recall"></li><li data-t="touch.burrow"></li>
          <li data-t="touch.ability"></li><li data-t="touch.online"></li>
        </ul>`
      : /* html */ `<dl class="keys help__keyboard">
          ${row(keys('W', 'A', 'S', 'D'), 'controls.move')}
          ${row(keyT('key.mouse'), 'controls.look')}
          ${row(`${keys('E')}${keyT('key.click')}`, 'controls.grab')}
          ${row(keyT('key.space'), 'controls.jump')}
          ${row(keys('Shift'), 'controls.run')}
          ${row(keys('R'), 'controls.recall')}
          ${row(keys('T'), 'controls.burrow')}
          ${row(`${keys('Q')}${keyT('key.rightClick')}`, 'controls.ability')}
          ${row(keyT('key.middleClick'), 'controls.recenter')}
          ${row(keyT('key.wheel'), 'controls.zoom')}
          ${row(keys('G'), 'controls.emote')}
          ${row(keys('F'), 'controls.merge')}
          ${row(keys('J'), 'controls.invite')}
          ${row(keys('Esc', 'P'), 'controls.pause')}
        </dl>`;
    return /* html */ `
      <section class="sheet" id="sheet-help" role="region" aria-labelledby="sheet-help-title" hidden>
        <header class="sheet__header">
          <h2 class="sheet__title" id="sheet-help-title" data-t="menu.howToPlay"></h2>
          <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
        </header>
        <div class="sheet__body">
          <button class="help__tutorial" type="button" data-tutorial-replay>
            <span class="help__tutorial-icon" aria-hidden="true">${Icons.play}</span>
            <span class="help__tutorial-text"><strong data-t="tutorial.replay"></strong><span data-t="tutorial.replayHint"></span></span>
          </button>
          <h3 class="sheet__heading" data-t="help.round"></h3>
          <ol class="steps">
            <li data-t="help.step1"></li><li data-t="help.step2"></li><li data-t="help.step3"></li>
          </ol>
          <p class="help__weather" data-t="help.zones"></p>
          <p class="help__weather" data-t="help.weather"></p>
          <h3 class="sheet__heading" data-t="help.burrow"></h3>
          <ul class="help-list">
            <li data-t="help.burrow1"></li><li data-t="help.burrow2"></li><li data-t="help.burrow3"></li>
          </ul>
          <h3 class="sheet__heading" data-t="help.online"></h3>
          <ul class="help-list">
            <li data-t="help.online1"></li><li data-t="help.online2"></li><li data-t="help.online3"></li><li data-t="help.online4"></li><li data-t="help.online5"></li><li data-t="help.online6"></li>
          </ul>
          <div class="help__controls">
            <div class="help__device help__device--main">
              <h3 class="sheet__heading" data-t="help.controls"></h3>
              ${controls}
            </div>
            <div class="help__device help__device--pad" data-pad-help hidden>
              <h3 class="sheet__heading" data-t="help.gamepad"></h3>
              <dl class="keys">
                ${row(pad('ls'), 'controls.move')}
                ${row(pad('rs'), 'controls.look')}
                ${row(pad('rt'), 'controls.grab')}
                ${row(pad('a'), 'controls.jump')}
                ${row(pad('lt', 'b'), 'controls.run')}
                ${row(pad('l3'), 'controls.sprintToggle')}
                ${row(pad('y'), 'controls.recall')}
                ${row(pad('view'), 'controls.burrow')}
                ${row(pad('x', 'up'), 'controls.ability')}
                ${row(pad('r3'), 'controls.recenter')}
                ${row(pad('lb', 'rb'), 'controls.zoom')}
                ${row(pad('down'), 'controls.emote')}
                ${row(pad('left'), 'controls.merge')}
                ${row(pad('right'), 'controls.invite')}
                ${row(pad('start'), 'controls.pause')}
              </dl>
            </div>
          </div>
        </div>
      </section>`;
  }

  /** Linha de ajuste: rótulo (+ dica) à esquerda, controle à direita. */
  private row(panel: TabName, id: string, label: MessageKey, hint: MessageKey | null, control: HTMLElement, wide = false): HTMLElement {
    const row = document.createElement('div');
    row.className = wide ? 'setting setting--wide' : 'setting';
    const text = document.createElement('div');
    text.className = 'setting__text';
    const name = document.createElement('span');
    name.className = 'setting__label';
    name.id = `set-${id}`;
    this.texts.push([name, label]);
    text.append(name);
    if (hint) {
      const small = document.createElement('span');
      small.className = 'setting__hint';
      small.id = `set-${id}-hint`;
      this.texts.push([small, hint]);
      text.append(small);
    }
    row.append(text, control);
    this.tabPanels.get(panel)!.append(row);
    return row;
  }

  private buildSettings(): void {
    for (const tab of TABS) {
      this.tabButtons.set(tab.name, this.element.querySelector(`[data-tab="${tab.name}"]`) as HTMLButtonElement);
      this.tabPanels.set(tab.name, this.element.querySelector(`[data-panel="${tab.name}"]`) as HTMLElement);
    }
    const percent = (v: number) => `${Math.round(v)}%`;
    const add = <T>(control: Control<T>, apply: (s: Readonly<GameSettings>) => T) => {
      this.controls.push(control as unknown as Control<never>);
      this.sync.push((s) => control.set(apply(s)));
      return control;
    };

    // Gráficos
    const quality = add(
      segmented<QualityPreset>(
        'set-quality',
        QUALITY_PRESETS.map((p) => ({ value: p, label: () => t(`settings.quality.${p}` as MessageKey) })),
        (preset) => settings.applyPreset(preset),
      ),
      (s) => (s.quality === 'custom' ? null : s.quality),
    );
    const qualityRow = this.row('graphics', 'quality', 'settings.quality', 'settings.quality.hint', quality.element, true);
    // Selo "Personalizada" ao lado do rótulo quando nenhuma predefinição bate.
    const customBadge = document.createElement('span');
    customBadge.className = 'setting__badge';
    this.texts.push([customBadge, 'settings.quality.custom']);
    qualityRow.querySelector('.setting__label')!.after(customBadge);
    this.sync.push((s) => (customBadge.hidden = s.quality !== 'custom'));

    this.row('graphics', 'resolution', 'settings.resolution', 'settings.resolution.hint',
      add(slider('set-resolution', { min: 35, max: 100, step: 5, format: percent }, (v) => settings.update({ resolution: v / 100 })), (s) => Math.round(s.resolution * 100)).element);
    this.row('graphics', 'shadows', 'settings.shadows', null,
      add(segmented<ShadowQuality>('set-shadows', (['off', 'low', 'high'] as const).map((v) => ({ value: v, label: () => t(`settings.shadows.${v}` as MessageKey) })), (v) => settings.update({ shadows: v })), (s) => s.shadows).element);
    this.row('graphics', 'ao', 'settings.ao', 'settings.ao.hint',
      add(toggle('set-ao', 'set-ao-hint', (v) => settings.update({ ambientOcclusion: v })), (s) => s.ambientOcclusion).element);
    const dof = toggle('set-dof', 'set-dof-hint', (v) => settings.update({ depthOfField: v }));
    this.row('graphics', 'dof', 'settings.dof', 'settings.dof.hint', add(dof, (s) => s.depthOfField).element);
    this.sync.push((s) => dof.setDisabled(!s.ambientOcclusion));
    this.row('graphics', 'bloom', 'settings.bloom', 'settings.bloom.hint',
      add(toggle('set-bloom', 'set-bloom-hint', (v) => settings.update({ bloom: v })), (s) => s.bloom).element);
    this.row('graphics', 'grass', 'settings.grass', null,
      add(slider('set-grass', { min: 30, max: 100, step: 5, format: percent }, (v) => settings.update({ grassDensity: v / 100 })), (s) => Math.round(s.grassDensity * 100)).element);
    this.row('graphics', 'fps', 'settings.fps', null,
      add(toggle('set-fps', null, (v) => settings.update({ showFps: v })), (s) => s.showFps).element);

    // Áudio
    const volume = (id: string, label: MessageKey, key: 'masterVolume' | 'musicVolume' | 'effectsVolume' | 'ambienceVolume') =>
      this.row('audio', id, label, null,
        add(slider(`set-${id}`, { min: 0, max: 100, step: 5, format: percent }, (v) => settings.update({ [key]: v / 100 } as Partial<GameSettings>)), (s) => Math.round(s[key] * 100)).element);
    volume('master', 'settings.master', 'masterVolume');
    volume('music', 'settings.music', 'musicVolume');
    volume('effects', 'settings.effects', 'effectsVolume');
    volume('ambience', 'settings.ambience', 'ambienceVolume');

    // Controles
    const holdMode = (id: string, key: 'grabMode' | 'runMode') =>
      add(segmented<HoldMode>(`set-${id}`, HOLD_MODES.map((mode) => ({ value: mode, label: () => t(`settings.holdMode.${mode}` as MessageKey) })), (v) => settings.update({ [key]: v } as Partial<GameSettings>)), (s) => s[key]).element;
    this.row('controls', 'sensitivity', this.isTouch ? 'settings.sensitivityTouch' : 'settings.sensitivity', null,
      add(slider('set-sensitivity', { min: 40, max: 200, step: 10, format: percent }, (v) => settings.update({ mouseSensitivity: v / 100 })), (s) => Math.round(s.mouseSensitivity * 100)).element);
    this.row('controls', 'stick', 'settings.stickSensitivity', null,
      add(slider('set-stick', { min: 40, max: 200, step: 10, format: percent }, (v) => settings.update({ stickSensitivity: v / 100 })), (s) => Math.round(s.stickSensitivity * 100)).element);
    this.row('controls', 'invert', 'settings.invertY', null,
      add(toggle('set-invert', null, (v) => settings.update({ invertY: v })), (s) => s.invertY).element);
    this.row('controls', 'autocam', 'settings.autoCamera', 'settings.autoCamera.hint',
      add(toggle('set-autocam', 'set-autocam-hint', (v) => settings.update({ autoCamera: v })), (s) => s.autoCamera).element);
    this.row('controls', 'grabmode', 'settings.grabMode', this.isTouch ? 'settings.grabMode.touchHint' : 'settings.grabMode.hint', holdMode('grabmode', 'grabMode'));
    this.row('controls', 'runmode', 'settings.runMode', 'settings.runMode.hint', holdMode('runmode', 'runMode'));
    this.row('controls', 'shake', 'settings.shake', 'settings.shake.hint',
      add(toggle('set-shake', 'set-shake-hint', (v) => settings.update({ cameraShake: v })), (s) => s.cameraShake).element);
    this.row('controls', 'vibration', 'settings.vibration', null,
      add(toggle('set-vibration', null, (v) => settings.update({ gamepadVibration: v })), (s) => s.gamepadVibration).element);

    // Idioma: lista grande de opções (o automático mostra o que detectou).
    const languages = segmented<LanguagePreference>(
      'set-language',
      [
        { value: 'auto', label: () => t('settings.language.auto') },
        ...LOCALES.map((locale) => ({ value: locale as LanguagePreference, label: () => LOCALE_NAMES[locale] })),
      ],
      (pref) => settings.update({ language: pref }),
      'choices',
    );
    this.row('language', 'language', 'settings.tab.language', 'settings.language.hint', add(languages, (s) => s.language).element, true);
    const detected = document.createElement('p');
    detected.className = 'setting__detected';
    this.tabPanels.get('language')!.append(detected);
    this.controls.push({
      element: detected,
      set() {},
      refresh: () => (detected.textContent = t('settings.language.detected', { lang: LOCALE_NAMES[detectedLocale()] })),
    });
  }

  private bindEvents(): void {
    this.playButton.addEventListener('click', () => this.onPlay?.());
    this.skipTutorialButton.addEventListener('click', () => this.onSkipTutorial?.());
    this.replayTutorialButton.addEventListener('click', () => this.onReplayTutorial?.());
    for (const name of SHEETS) {
      this.openers[name].addEventListener('click', () => (this.openSheet === name ? this.closeSheet() : this.open(name)));
    }
    this.element.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeSheet()));
    this.element.querySelector('[data-reset]')!.addEventListener('click', () => settings.reset());

    // Abas (padrão WAI-ARIA): clique ou setas trocam e focam a aba.
    bindTabs(
      TABS.map((tab) => tab.name),
      this.tabButtons,
      this.tabPanels,
    );

    // Esc fecha a placa aberta (e não deixa o evento vazar para o jogo).
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openSheet) {
        e.stopPropagation();
        this.closeSheet();
      }
    });
    // Nada do menu chega na área de arrastar a câmera do toque.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bindShowcaseDrag();
    // Voltou pro mouse/toque: o contorno de foco "de controle" sai (senão todo clique ficava com anel).
    window.addEventListener('pointerdown', () => document.documentElement.classList.remove('using-gamepad'), { capture: true });
  }

  private open(name: SheetName, intro = false): void {
    if (this.openSheet && this.openSheet !== name) this.closeSheet(false);
    this.openSheet = name;
    const sheet = this.sheets[name];
    sheet.hidden = false;
    if (name === 'burrow') {
      this.burrow.prepare(intro);
      this.progression.markBurrowSeen();
    }
    if (name === 'ranking') this.ranking.prepare();
    if (name === 'online') this.onlineSheet.prepare();
    if (name === 'account') this.account.prepare();
    // Provador (guarda-roupa, Feirinha, passe): o menu principal sai de cena e o besouro vira o centro.
    this.element.classList.toggle('has-showcase', SHOWCASE_SHEETS.has(name));
    if (name === 'wardrobe') this.wardrobe.prepare();
    if (name === 'shop') this.shop.prepare();
    if (name === 'pass') this.pass.prepare();
    this.onSheetChange?.(name);
    this.openers[name].setAttribute('aria-expanded', 'true');
    this.element.classList.add('has-sheet');
    // Placa com abas: a legenda do controle mostra LB/RB.
    this.element.classList.toggle('has-tabs', sheet.querySelector('[role="tablist"]') !== null);
    // Foco no primeiro controle útil da placa (aba ativa ou o fechar).
    const first = sheet.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? sheet.querySelector<HTMLElement>('[data-close]');
    first?.focus({ preventScroll: true });
  }

  private closeSheet(returnFocus = true): void {
    const name = this.openSheet;
    if (!name) return;
    this.openSheet = null;
    if (name === 'wardrobe') this.wardrobe.close();
    if (name === 'shop') this.shop.close();
    if (name === 'pass') this.pass.close();
    if (name === 'account') this.account.close();
    if (name === 'online') this.onlineSheet.close();
    this.sheets[name].hidden = true;
    this.openers[name].setAttribute('aria-expanded', 'false');
    this.element.classList.remove('has-sheet', 'has-tabs', 'has-showcase');
    this.onSheetChange?.(null);
    if (returnFocus) this.openers[name].focus({ preventScroll: true });
  }

  /**
   * No provador, arrastar fora da placa gira o besouro (mouse ou dedo). A placa
   * e os botões continuam com o clique normal.
   */
  private bindShowcaseDrag(): void {
    let pointer: number | null = null;
    let lastX = 0;
    this.element.addEventListener('pointerdown', (e) => {
      if (!this.openSheet || !SHOWCASE_SHEETS.has(this.openSheet) || (e.target as HTMLElement).closest('.sheet, button')) return;
      pointer = e.pointerId;
      lastX = e.clientX;
      this.element.setPointerCapture(e.pointerId);
      this.element.classList.add('is-dragging');
    });
    this.element.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      this.onShowcaseDrag?.(e.clientX - lastX);
      lastX = e.clientX;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.element.classList.remove('is-dragging');
    };
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
  }

  private syncControls(s: Readonly<GameSettings>): void {
    for (const apply of this.sync) apply(s);
    if (s.language !== getLanguagePreference()) setLanguagePreference(s.language);
  }

  /** Link da toca: nível atual e bolinha com quantas bolas esperam pra ser comidas. */
  private updateBurrowLink(): void {
    this.burrowMeta.textContent = t('menu.level', { n: this.progression.level });
    const count = this.progression.pantry.length;
    this.burrowBadge.hidden = count === 0;
    this.burrowBadge.textContent = String(count);
    // Guarda-roupa: quantos visuais novos esperam.
    const fresh = this.progression.newLookCount;
    this.wardrobeBadge.hidden = fresh === 0;
    this.wardrobeBadge.textContent = String(fresh);
    this.wardrobeBadge.parentElement!.parentElement!.setAttribute('aria-label', fresh > 0 ? `${t('menu.wardrobe')}: ${tn('wardrobe.newCount', fresh)}` : t('menu.wardrobe'));
    // Feirinha: baús esperando na bolinha e a carteira do lado.
    const chests = this.progression.chests.length;
    this.shopBadge.hidden = chests === 0;
    this.shopBadge.textContent = String(chests);
    const wallet = this.progression.wallet;
    // O progresso avisa a cada coisa que a bola pega: só redesenha a carteira quando ela muda.
    const walletKey = `${wallet.coins}|${wallet.dew}`;
    if (walletKey !== this.shownWallet) {
      this.shownWallet = walletKey;
      this.shopMeta.innerHTML = `${amountChip('coins', Math.max(0, wallet.coins))}${amountChip('dew', Math.max(0, wallet.dew))}`;
    }
    this.shopBadge.parentElement!.parentElement!.setAttribute('aria-label', chests > 0 ? `${t('menu.shop')}: ${tn('shop.chestsWaiting', chests)}` : t('menu.shop'));
    // Passe: níveis pra pegar na bolinha e o nível do lado.
    const season = shownSeason(Date.now());
    const claimable = this.progression.claimableTierCount(season);
    this.passBadge.hidden = claimable === 0;
    this.passBadge.textContent = String(claimable);
    this.passMeta.textContent = season ? t('menu.passLevel', { n: this.progression.passView(season).tier, total: season.tiers.length }) : '';
  }

  /**
   * Chip da conta: com conta, o besouro (casco atual) + apelido e uma bolinha do
   * estado da nuvem; sem conta, "Entrar". Build sem Supabase: some junto com o
   * link do ranking.
   */
  private updateAccountChip(): void {
    const { status, profile, sync } = this.online.state;
    const chip = this.accountChip;
    chip.hidden = status === 'disabled';
    this.openers.ranking.hidden = status === 'disabled';
    this.openers.online.hidden = status === 'disabled';
    if (status === 'disabled') return;
    chip.dataset.state = status;
    if (status === 'signedIn') {
      const nick = profile?.nickname ?? '…';
      chip.innerHTML = /* html */ `
        <span class="menu__account-avatar" aria-hidden="true">${skinIcon(skin(this.progression.skin))}<span class="menu__account-dot" data-sync="${sync}"></span></span>
        <span class="menu__account-text"><strong>${escapeHtml(nick)}</strong></span>`;
      chip.setAttribute('aria-label', t('account.chip.aria', { nick }));
      return;
    }
    chip.innerHTML = /* html */ `
      <span class="menu__account-avatar is-guest" aria-hidden="true">${status === 'loading' ? '' : Icons.user}</span>
      <span class="menu__account-text"><strong>${escapeHtml(t('account.chip.signIn'))}</strong><span>${escapeHtml(t('account.chip.hint'))}</span></span>`;
    chip.removeAttribute('aria-label');
  }

  private updatePlayLabel(): void {
    this.playLabel.textContent = !this.ready ? t('menu.loading') : this.paused ? t('menu.resume') : t('menu.play');
  }

  private refreshTexts(): void {
    for (const [el, key, attr] of this.texts) {
      if (attr) el.setAttribute(attr, t(key));
      else el.textContent = t(key);
    }
    for (const control of this.controls) control.refresh();
    this.updatePlayLabel();
    // Idioma novo formata os números de outro jeito (1.075 x 1,075): a carteira redesenha.
    this.shownWallet = '';
    this.updateBurrowLink();
    this.updateAccountChip();
    this.updateOnlineBadge();
    if (this.lastSave) this.setProgress(this.lastSave);
  }
}
