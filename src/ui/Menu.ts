import { settings, QUALITY_PRESETS, type GameSettings, type QualityPreset, type ShadowQuality } from '../core/settings';
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
import { PAD_LABELS, type MenuAction, type PadStyle } from '../core/GamepadInput';
import { Icons } from './icons';
import { segmented, slider, toggle, type Control } from './controls';

/**
 * Menu de início e de pausa: a "madrugada" por cima do jardim (que continua
 * girando ao vivo atrás). Jogar faz amanhecer; pausar faz a noite voltar.
 * Tem duas placas que deslizam por cima: Configurações (com abas) e Como jogar.
 */

type SheetName = 'settings' | 'help';
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

  private readonly playButton: HTMLButtonElement;
  private readonly playLabel: HTMLElement;
  private readonly record: HTMLElement;
  private readonly sheets: Record<SheetName, HTMLElement>;
  private readonly openers: Record<SheetName, HTMLButtonElement>;
  private readonly tabButtons = new Map<TabName, HTMLButtonElement>();
  private readonly tabPanels = new Map<TabName, HTMLElement>();
  /** Textos fixos: elemento + chave (+ atributo, se não for o texto). */
  private readonly texts: Array<[HTMLElement, MessageKey, string?]> = [];
  private readonly controls: Control<never>[] = [];
  private readonly sync: Array<(s: Readonly<GameSettings>) => void> = [];

  private ready = false;
  private paused = false;
  private openSheet: SheetName | null = null;
  private lastSave: SaveData | null = null;

  constructor(parent: HTMLElement, private readonly isTouch: boolean) {
    this.element = document.createElement('div');
    this.element.className = 'menu';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'menu-title');
    this.element.innerHTML = /* html */ `
      <div class="menu__sky" aria-hidden="true"></div>
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
          <button class="menu__link" type="button" data-open="settings" aria-expanded="false" aria-controls="sheet-settings">
            <span class="menu__link-icon">${Icons.gear}</span><span data-t="menu.settings"></span>
          </button>
          <button class="menu__link" type="button" data-open="help" aria-expanded="false" aria-controls="sheet-help">
            <span class="menu__link-icon">${Icons.book}</span><span data-t="menu.howToPlay"></span>
          </button>
        </div>
        <p class="menu__record" data-record></p>
        <p class="menu__pad-legend" data-pad-legend hidden>
          <kbd class="padcap" data-pad="a"></kbd><span data-t="pad.select"></span>
          <kbd class="padcap" data-pad="b"></kbd><span data-t="pad.back"></span>
        </p>
      </div>
      ${this.settingsSheet()}
      ${this.helpSheet()}
    `;
    parent.append(this.element);

    const $ = <T extends HTMLElement>(sel: string) => this.element.querySelector(sel) as T;
    this.playButton = $('[data-play]');
    this.playLabel = $('[data-play-label]');
    this.record = $('[data-record]');
    this.sheets = { settings: $('#sheet-settings'), help: $('#sheet-help') };
    this.openers = { settings: $('[data-open="settings"]'), help: $('[data-open="help"]') };

    this.element.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => this.texts.push([el, el.dataset.t as MessageKey]));
    this.element.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((el) => this.texts.push([el, el.dataset.tAria as MessageKey, 'aria-label']));

    this.buildSettings();
    this.bindEvents();

    settings.subscribe((s) => this.syncControls(s));
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

  /** Mostra o menu (a noite cai). `paused` troca Jogar por Continuar. */
  show(paused: boolean): void {
    this.paused = paused;
    this.updatePlayLabel();
    this.element.hidden = false;
    this.element.removeAttribute('inert');
    if (this.ready) this.playButton.focus({ preventScroll: true });
  }

  /** Esconde o menu (amanhece) e fecha qualquer placa aberta. */
  hide(): void {
    this.closeSheet(false);
    this.element.hidden = true;
    this.element.setAttribute('inert', '');
  }

  /** Controle ligado/desligado: mostra a legenda de botões e a ajuda no estilo certo (Xbox ou PlayStation). */
  setGamepad(style: PadStyle | null): void {
    (this.element.querySelector('[data-pad-legend]') as HTMLElement).hidden = style === null;
    (this.element.querySelector('[data-pad-help]') as HTMLElement).hidden = style === null;
    if (!style) return;
    this.element.querySelectorAll<HTMLElement>('[data-pad]').forEach((el) => {
      el.textContent = PAD_LABELS[style][el.dataset.pad as keyof (typeof PAD_LABELS)['xbox']];
    });
  }

  /**
   * Navegação por controle: cima/baixo andam entre os controles da tela (ou da placa
   * aberta), esquerda/direita mudam o valor do que está em foco, A aciona, B volta.
   * Devolve false quando o menu não usou a ação (ex.: B sem placa aberta = continuar).
   */
  handleGamepad(action: MenuAction): boolean {
    document.documentElement.classList.add('using-gamepad');
    const scope = this.openSheet ? this.sheets[this.openSheet] : (this.element.querySelector('.menu__main') as HTMLElement);
    const focusables = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')).filter(
      (el) => el.tabIndex >= 0 && el.offsetParent !== null,
    );
    const active = document.activeElement as HTMLElement | null;
    const index = active ? focusables.indexOf(active) : -1;
    const focus = (el: HTMLElement | undefined) => {
      if (!el) return;
      el.focus({ preventScroll: false, focusVisible: true } as FocusOptions);
      el.scrollIntoView({ block: 'nearest' });
    };
    switch (action) {
      case 'up':
      case 'down': {
        const step = action === 'down' ? 1 : -1;
        focus(focusables[index < 0 ? 0 : Math.min(Math.max(index + step, 0), focusables.length - 1)]);
        return true;
      }
      case 'left':
      case 'right': {
        if (!active || index < 0) return true;
        if (active instanceof HTMLInputElement && active.type === 'range') {
          if (action === 'right') active.stepUp();
          else active.stepDown();
          active.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (active.getAttribute('role') === 'radio' || active.getAttribute('role') === 'tab') {
          active.dispatchEvent(new KeyboardEvent('keydown', { key: action === 'right' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
        }
        return true;
      }
      case 'confirm':
        if (active && index >= 0) active.click();
        else focus(focusables[0]);
        return true;
      case 'back':
        if (!this.openSheet) return false;
        this.closeSheet();
        return true;
      case 'start':
        return false;
    }
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
    const tabs = TABS.map(
      (tab, i) => /* html */ `
        <button class="tabs__tab" type="button" role="tab" id="tab-${tab.name}" data-tab="${tab.name}"
          aria-controls="panel-${tab.name}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
          ${tab.icon}<span data-t="${tab.label}"></span>
        </button>`,
    ).join('');
    const panels = TABS.map(
      (tab, i) => `<div class="sheet__panel" role="tabpanel" id="panel-${tab.name}" aria-labelledby="tab-${tab.name}" data-panel="${tab.name}" ${i === 0 ? '' : 'hidden'}></div>`,
    ).join('');
    return /* html */ `
      <section class="sheet" id="sheet-settings" role="region" aria-labelledby="sheet-settings-title" hidden>
        <header class="sheet__header">
          <h2 class="sheet__title" id="sheet-settings-title" data-t="menu.settings"></h2>
          <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
        </header>
        <div class="tabs" role="tablist" aria-labelledby="sheet-settings-title">${tabs}</div>
        <div class="sheet__body">${panels}</div>
        <footer class="sheet__footer">
          <button class="sheet__reset" type="button" data-reset>${Icons.reset}<span data-t="settings.reset"></span></button>
        </footer>
      </section>`;
  }

  private helpSheet(): string {
    const keys = (...caps: string[]) => caps.map((c) => `<kbd class="keycap">${c}</kbd>`).join('');
    const keyT = (key: MessageKey) => `<kbd class="keycap" data-t="${key}"></kbd>`;
    const pad = (button: keyof (typeof PAD_LABELS)['xbox']) => `<kbd class="keycap padcap" data-pad="${button}"></kbd>`;
    const row = (caps: string, action: MessageKey) => `<div class="keys__row"><dt>${caps}</dt><dd data-t="${action}"></dd></div>`;
    const controls = this.isTouch
      ? /* html */ `<ul class="touch-list">
          <li data-t="touch.move"></li><li data-t="touch.look"></li><li data-t="touch.grab"></li>
          <li data-t="touch.jump"></li><li data-t="touch.recall"></li>
        </ul>`
      : /* html */ `<dl class="keys">
          ${row(keys('W', 'A', 'S', 'D'), 'controls.move')}
          ${row(keyT('key.mouse'), 'controls.look')}
          ${row(`${keys('E')}${keyT('key.click')}`, 'controls.grab')}
          ${row(keyT('key.space'), 'controls.jump')}
          ${row(keys('Shift'), 'controls.run')}
          ${row(keys('R'), 'controls.recall')}
          ${row(keyT('key.wheel'), 'controls.zoom')}
          ${row(keys('Esc'), 'controls.pause')}
        </dl>`;
    return /* html */ `
      <section class="sheet" id="sheet-help" role="region" aria-labelledby="sheet-help-title" hidden>
        <header class="sheet__header">
          <h2 class="sheet__title" id="sheet-help-title" data-t="menu.howToPlay"></h2>
          <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
        </header>
        <div class="sheet__body">
          <h3 class="sheet__heading" data-t="help.round"></h3>
          <ol class="steps">
            <li data-t="help.step1"></li><li data-t="help.step2"></li><li data-t="help.step3"></li>
          </ol>
          <p class="help__weather" data-t="help.weather"></p>
          <h3 class="sheet__heading" data-t="help.controls"></h3>
          ${controls}
          <div data-pad-help hidden>
            <h3 class="sheet__heading" data-t="help.gamepad"></h3>
            <dl class="keys">
              ${row(keyT('key.leftStick'), 'controls.move')}
              ${row(keyT('key.rightStick'), 'controls.look')}
              ${row(`${pad('rt')}${pad('x')}`, 'controls.grab')}
              ${row(pad('a'), 'controls.jump')}
              ${row(`${pad('lt')}${pad('b')}`, 'controls.run')}
              ${row(pad('y'), 'controls.recall')}
              ${row(`${pad('lb')}${pad('rb')}`, 'controls.zoom')}
              ${row(pad('start'), 'controls.pause')}
            </dl>
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
    const volume = (id: string, label: MessageKey, key: 'masterVolume' | 'effectsVolume' | 'ambienceVolume') =>
      this.row('audio', id, label, null,
        add(slider(`set-${id}`, { min: 0, max: 100, step: 5, format: percent }, (v) => settings.update({ [key]: v / 100 } as Partial<GameSettings>)), (s) => Math.round(s[key] * 100)).element);
    volume('master', 'settings.master', 'masterVolume');
    volume('effects', 'settings.effects', 'effectsVolume');
    volume('ambience', 'settings.ambience', 'ambienceVolume');

    // Controles
    this.row('controls', 'sensitivity', 'settings.sensitivity', null,
      add(slider('set-sensitivity', { min: 40, max: 200, step: 10, format: percent }, (v) => settings.update({ mouseSensitivity: v / 100 })), (s) => Math.round(s.mouseSensitivity * 100)).element);
    this.row('controls', 'invert', 'settings.invertY', null,
      add(toggle('set-invert', null, (v) => settings.update({ invertY: v })), (s) => s.invertY).element);
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
    for (const name of ['settings', 'help'] as const) {
      this.openers[name].addEventListener('click', () => (this.openSheet === name ? this.closeSheet() : this.open(name)));
    }
    this.element.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeSheet()));
    this.element.querySelector('[data-reset]')!.addEventListener('click', () => settings.reset());

    // Abas (padrão WAI-ARIA): clique ou setas trocam e focam a aba.
    const order = TABS.map((tab) => tab.name);
    for (const [name, button] of this.tabButtons) {
      button.addEventListener('click', () => this.selectTab(name));
      button.addEventListener('keydown', (e) => {
        const i = order.indexOf(name);
        let next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % order.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + order.length) % order.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = order.length - 1;
        if (next < 0) return;
        e.preventDefault();
        this.selectTab(order[next]);
        this.tabButtons.get(order[next])!.focus();
      });
    }

    // Esc fecha a placa aberta (e não deixa o evento vazar para o jogo).
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openSheet) {
        e.stopPropagation();
        this.closeSheet();
      }
    });
    // Nada do menu chega na área de arrastar a câmera do toque.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private open(name: SheetName): void {
    if (this.openSheet && this.openSheet !== name) this.closeSheet(false);
    this.openSheet = name;
    const sheet = this.sheets[name];
    sheet.hidden = false;
    this.openers[name].setAttribute('aria-expanded', 'true');
    this.element.classList.add('has-sheet');
    // Foco no primeiro controle útil da placa (aba ativa ou o fechar).
    const first = sheet.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? sheet.querySelector<HTMLElement>('[data-close]');
    first?.focus({ preventScroll: true });
  }

  private closeSheet(returnFocus = true): void {
    const name = this.openSheet;
    if (!name) return;
    this.openSheet = null;
    this.sheets[name].hidden = true;
    this.openers[name].setAttribute('aria-expanded', 'false');
    this.element.classList.remove('has-sheet');
    if (returnFocus) this.openers[name].focus({ preventScroll: true });
  }

  private selectTab(name: TabName): void {
    for (const [tab, button] of this.tabButtons) {
      const selected = tab === name;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.tabPanels.get(tab)!.hidden = !selected;
    }
  }

  private syncControls(s: Readonly<GameSettings>): void {
    for (const apply of this.sync) apply(s);
    if (s.language !== getLanguagePreference()) setLanguagePreference(s.language);
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
    if (this.lastSave) this.setProgress(this.lastSave);
  }
}
