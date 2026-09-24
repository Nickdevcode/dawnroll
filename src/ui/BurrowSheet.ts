import { formatCm, formatInteger, onLocaleChange, t, type MessageKey } from '../i18n';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS } from '../progression/achievements';
import { CATALOG, CATALOG_GROUPS, catalogEntry, isCatalogId, type CatalogEntry, type CatalogId } from '../progression/catalog';
import { PANTRY_CAPACITY, banquetMultiplier } from '../progression/food';
import { PERKS } from '../progression/perks';
import type { MealResult, Progression } from '../progression/Progression';
import { CatalogIcons, GameIcons, PerkIcons } from './gameIcons';
import { Icons } from './icons';
import { escapeHtml } from './html';
import { bindTabs, tabsMarkup } from './tabs';
import { achievementDesc, achievementName, isHiddenAchievement } from './achievementText';
import { looksNotice } from './lookText';

type TabName = 'pantry' | 'catalog' | 'perks' | 'achievements';

const TABS: ReadonlyArray<{ name: TabName; icon: string; label: MessageKey }> = [
  { name: 'pantry', icon: GameIcons.pantry, label: 'burrow.tab.pantry' },
  { name: 'catalog', icon: GameIcons.catalog, label: 'burrow.tab.catalog' },
  { name: 'perks', icon: GameIcons.sparkle, label: 'burrow.tab.perks' },
  { name: 'achievements', icon: Icons.trophy, label: 'burrow.tab.achievements' },
];

/** Tamanho da bolinha desenhada na despensa (px): cresce rápido nas pequenas, pra 3 e 6 cm não parecerem iguais. */
const ballPx = (cm: number) => Math.round(16 + 32 * Math.pow(Math.min(Math.max((cm - 3) / 17, 0), 1), 0.6));

/**
 * Placa da toca (dentro do menu): nível e experiência no topo, e quatro abas —
 * Despensa (comer o que foi enterrado), Catálogo (figurinhas, com uma
 * curiosidade real de cada uma), Poderes (o que cada nível libera) e Conquistas
 * (as secretas aparecem como "???"). O visual do besouro mora no guarda-roupa
 * (`WardrobeSheet`). Tudo lido do `Progression`; comer chama `progression.eat`.
 */
export class BurrowSheet {
  readonly element: HTMLElement;
  /** Comeu algo (o jogo toca o som e atualiza o HUD). */
  onMeal: ((meal: MealResult) => void) | null = null;

  private readonly levelBadge: HTMLElement;
  private readonly levelLabel: HTMLElement;
  private readonly levelXp: HTMLElement;
  private readonly levelBar: HTMLElement;
  private readonly levelFill: HTMLElement;
  private readonly levelBonus: HTMLElement;
  private readonly mealNote: HTMLElement;
  private readonly panels = new Map<TabName, HTMLElement>();
  private readonly select: (name: TabName) => void;
  private intro = false;
  /** Figurinha aberta no catálogo (mostra a curiosidade dela). */
  private selectedCatalog: CatalogId | null = null;

  constructor(private readonly progression: Progression) {
    const markup = tabsMarkup('burrow-', 'sheet-burrow-title', TABS);
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--burrow';
    this.element.id = 'sheet-burrow';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-burrow-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-burrow-title" data-t="menu.burrow"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="burrow-level">
        <div class="burrow-level__badge" aria-hidden="true">${GameIcons.star}<span data-level-badge></span></div>
        <div class="burrow-level__info">
          <div class="burrow-level__row"><strong data-level-label></strong><span data-level-xp></span></div>
          <div class="burrow-level__bar" role="progressbar" aria-valuemin="0" data-level-bar><span data-level-fill></span></div>
          <p class="burrow-level__bonus" data-level-bonus></p>
        </div>
      </div>
      <p class="burrow-meal" data-meal aria-live="polite"></p>
      ${markup.tabs}
      <div class="sheet__body">${markup.panels}</div>`;

    const $ = (sel: string) => this.element.querySelector(sel) as HTMLElement;
    this.levelBadge = $('[data-level-badge]');
    this.levelLabel = $('[data-level-label]');
    this.levelXp = $('[data-level-xp]');
    this.levelBar = $('[data-level-bar]');
    this.levelFill = $('[data-level-fill]');
    this.levelBonus = $('[data-level-bonus]');
    this.mealNote = $('[data-meal]');

    const buttons = new Map<TabName, HTMLButtonElement>();
    for (const tab of TABS) {
      buttons.set(tab.name, this.element.querySelector(`[data-tab="${tab.name}"]`) as HTMLButtonElement);
      this.panels.set(tab.name, this.element.querySelector(`[data-panel="${tab.name}"]`) as HTMLElement);
    }
    this.select = bindTabs(TABS.map((tab) => tab.name), buttons, this.panels);

    this.panels.get('pantry')!.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-eat]');
      if (!button) return;
      const value = button.dataset.eat!;
      this.eat(value === 'all' ? undefined : [Number(value)]);
    });
    this.panels.get('catalog')!.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-catalog]');
      const id = tile?.dataset.catalog;
      if (id && isCatalogId(id)) this.openCatalogEntry(id);
    });

    progression.subscribe(() => this.refresh());
    onLocaleChange(() => this.refresh());
  }

  /** Abre na despensa; `intro` mostra o recado de primeira vez. */
  prepare(intro: boolean): void {
    this.intro = intro;
    this.select('pantry');
    this.mealNote.classList.remove('is-visible');
    this.render();
  }

  /** Estado mudou: redesenha se a placa está aberta (fechada, `prepare` redesenha ao abrir). */
  refresh(): void {
    if (!this.element.hidden) this.render();
  }

  /** Redesenha tudo (barato: a placa tem poucas centenas de elementos). */
  private render(): void {
    this.renderLevel();
    this.renderPantry();
    this.renderCatalog();
    this.renderPerks();
    this.renderAchievements();
  }

  private eat(indices: number[] | undefined): void {
    const pantryButtons = this.pantryButtons();
    const focusIndex = pantryButtons.indexOf(document.activeElement as HTMLButtonElement);
    // Antes de comer: comer redesenha a placa, e o recado de primeira vez já cumpriu o papel.
    this.intro = false;
    const meal = this.progression.eat(indices);
    if (!meal) return;
    this.showMeal(meal);
    this.onMeal?.(meal);
    // O botão comido sumiu: o foco vai pro vizinho (ou pra aba), senão o teclado/controle se perde.
    const after = this.pantryButtons();
    const next = after[Math.min(Math.max(focusIndex, 0), after.length - 1)] ?? (this.element.querySelector('[data-tab="pantry"]') as HTMLElement);
    next?.focus({ preventScroll: true });
  }

  private pantryButtons(): HTMLButtonElement[] {
    return Array.from(this.panels.get('pantry')!.querySelectorAll<HTMLButtonElement>('[data-eat]'));
  }

  private showMeal(meal: MealResult): void {
    const pct = Math.round((meal.multiplier - 1) * 100);
    const parts = [pct > 0 ? t('burrow.mealBanquet', { xp: formatInteger(meal.xp), pct }) : t('burrow.meal', { xp: formatInteger(meal.xp) })];
    if (meal.levelAfter > meal.levelBefore) parts.push(t('burrow.levelUp', { n: meal.levelAfter }));
    if (meal.unlocked.length > 0) {
      parts.push(t('burrow.unlocked', { names: meal.unlocked.map((id) => t(`perk.${id}.name` as MessageKey)).join(', ') }));
    }
    // Nível novo que libera casco ou acessório: avisa (o guarda-roupa também ganha a bolinha).
    if (meal.looks.length > 0) parts.push(looksNotice(meal.looks));
    this.mealNote.textContent = parts.join(' · ');
    this.mealNote.classList.toggle('is-level', meal.levelAfter > meal.levelBefore);
    this.mealNote.classList.remove('is-visible');
    void this.mealNote.offsetWidth;
    // Fica até a próxima refeição ou até a placa fechar (a frase de subir de nível é longa).
    this.mealNote.classList.add('is-visible');
    this.element.classList.remove('is-leveling');
    if (meal.levelAfter > meal.levelBefore) {
      void this.element.offsetWidth;
      this.element.classList.add('is-leveling');
    }
  }

  private renderLevel(): void {
    const { level, into, needed } = this.progression.levelProgress;
    const bonus = this.progression.bonuses;
    this.levelBadge.textContent = formatInteger(level);
    this.levelLabel.textContent = t('burrow.level', { n: formatInteger(level) });
    this.levelXp.textContent = t('burrow.xp', { into: formatInteger(into), needed: formatInteger(needed) });
    this.levelFill.style.transform = `scaleX(${Math.min(1, into / needed).toFixed(3)})`;
    this.levelBar.setAttribute('aria-valuemax', String(needed));
    this.levelBar.setAttribute('aria-valuenow', String(into));
    this.levelBar.setAttribute('aria-label', t('burrow.xpAria', { into, needed, next: level + 1 }));
    this.levelBonus.textContent =
      bonus.push > 0 ? t('burrow.bonus', { push: Math.round(bonus.push * 100), speed: Math.round(bonus.speed * 100) }) : t('burrow.bonusNone');
  }

  private renderPantry(): void {
    const panel = this.panels.get('pantry')!;
    const pantry = this.progression.pantry;
    const intro = this.intro ? `<p class="burrow-callout">${GameIcons.burrow}<span>${escapeHtml(t('burrow.intro'))}</span></p>` : '';
    if (pantry.length === 0) {
      panel.innerHTML = /* html */ `${intro}
        <div class="burrow-empty">
          <span class="burrow-empty__icon" aria-hidden="true">${GameIcons.pantry}</span>
          <p>${escapeHtml(t('burrow.pantry.empty'))}</p>
        </div>`;
      return;
    }
    const pct = Math.round((banquetMultiplier(pantry.length) - 1) * 100);
    const feast = /* html */ `
      <div class="burrow-feast">
        <button class="burrow-feast__button" type="button" data-eat="all">${GameIcons.food}<span>${escapeHtml(t('burrow.eatAll'))}</span></button>
        <div class="burrow-feast__text">
          <strong>${escapeHtml(pct > 0 ? t('burrow.banquet', { pct }) : t('burrow.banquetHint'))}</strong>
          <span>${escapeHtml(t('burrow.pantry.capacity', { n: pantry.length, max: PANTRY_CAPACITY }))}</span>
        </div>
      </div>`;
    const balls = pantry
      .map((ball, i) => {
        const size = ballPx(ball.cm);
        const cm = formatCm(ball.cm);
        const food = t('burrow.food', { n: formatInteger(ball.food) });
        return /* html */ `
          <li class="pantry__ball">
            <span class="pantry__visual" aria-hidden="true"><span class="pantry__dung" style="--size:${size}px"></span></span>
            <span class="pantry__text"><strong>${escapeHtml(cm)}</strong><span>${escapeHtml(food)}</span></span>
            <button class="pantry__eat" type="button" data-eat="${i}" aria-label="${escapeHtml(t('burrow.eatAria', { cm, food: formatInteger(ball.food) }))}">${escapeHtml(t('burrow.eat'))}</button>
          </li>`;
      })
      .join('');
    panel.innerHTML = `${intro}${feast}<ul class="pantry">${balls}</ul>`;
  }

  /** Abre a curiosidade de uma figurinha (e mantém o foco nela depois de redesenhar). */
  private openCatalogEntry(id: CatalogId): void {
    this.selectedCatalog = id;
    this.renderCatalog();
    const tile = this.panels.get('catalog')!.querySelector<HTMLElement>(`[data-catalog="${id}"]`);
    tile?.focus({ preventScroll: true });
    // O cartão de detalhe cresceu (ou mudou de altura) lá em cima e empurrou a grade: a figurinha volta pra vista.
    tile?.scrollIntoView({ block: 'nearest' });
  }

  /** Cartão de detalhe no topo do catálogo: ícone, nome, quantas, rara e a curiosidade. */
  private catalogDetail(): string {
    const id = this.selectedCatalog;
    if (!id) return `<div class="catalog-detail is-empty" aria-live="polite"><span class="catalog-detail__hint">${GameIcons.fact}<span>${escapeHtml(t('burrow.catalog.pick'))}</span></span></div>`;
    const entry = catalogEntry(id);
    const count = this.progression.catalog[id] ?? 0;
    if (count === 0) {
      return /* html */ `
        <div class="catalog-detail is-unknown" aria-live="polite">
          <span class="catalog-detail__icon" aria-hidden="true">${CatalogIcons[entry.shape]}</span>
          <div class="catalog-detail__text"><strong>${escapeHtml(t('burrow.catalog.unknown'))}</strong><p>${escapeHtml(t('burrow.catalog.locked'))}</p></div>
        </div>`;
    }
    const rare = entry.rare ? `<span class="catalog-detail__rare">${GameIcons.star}${escapeHtml(t('burrow.catalog.rare'))}</span>` : '';
    return /* html */ `
      <div class="catalog-detail" aria-live="polite">
        <span class="catalog-detail__icon" style="color:${entry.color}" aria-hidden="true">${CatalogIcons[entry.shape]}</span>
        <div class="catalog-detail__text">
          <div class="catalog-detail__row"><strong>${escapeHtml(t(`catalog.${id}` as MessageKey))}</strong>${rare}<span class="catalog-detail__count">${escapeHtml(t('burrow.catalog.count', { n: formatInteger(count) }))}</span></div>
          <p><span class="catalog-detail__label">${GameIcons.fact}${escapeHtml(t('burrow.catalog.fact'))}</span> ${escapeHtml(t(`fact.${id}` as MessageKey))}</p>
        </div>
      </div>`;
  }

  private renderCatalog(): void {
    const panel = this.panels.get('catalog')!;
    const catalog = this.progression.catalog;
    const found = this.progression.discoveredCount;
    const tile = (entry: CatalogEntry) => {
      const count = catalog[entry.id] ?? 0;
      const known = count > 0;
      const name = known ? t(`catalog.${entry.id}` as MessageKey) : t('burrow.catalog.unknown');
      const label = known ? `${name}: ${t('burrow.catalog.count', { n: formatInteger(count) })}` : name;
      const selected = entry.id === this.selectedCatalog;
      const classes = ['catalog-tile', known ? '' : 'is-unknown', known && entry.rare ? 'is-rare' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
      return /* html */ `
        <li class="catalog-tile__cell">
          <button class="${classes}" type="button" data-catalog="${entry.id}" data-focusable aria-pressed="${selected}" aria-label="${escapeHtml(label)}">
            <span class="catalog-tile__icon" style="color:${entry.color}" aria-hidden="true">${CatalogIcons[entry.shape]}</span>
            <span class="catalog-tile__name" aria-hidden="true">${escapeHtml(name)}</span>
            ${known ? `<span class="catalog-tile__count" aria-hidden="true">${escapeHtml(t('burrow.catalog.count', { n: formatInteger(count) }))}</span>` : ''}
          </button>
        </li>`;
    };
    const groups = CATALOG_GROUPS.map(
      (group) => /* html */ `
        <h3 class="sheet__heading">${escapeHtml(t(`catalog.group.${group}` as MessageKey))}</h3>
        <ul class="catalog-grid">${CATALOG.filter((entry) => entry.group === group).map(tile).join('')}</ul>`,
    ).join('');
    panel.innerHTML = /* html */ `
      <div class="catalog-progress">
        <div class="catalog-progress__row"><strong>${escapeHtml(t('burrow.catalog.progress', { found, total: CATALOG.length }))}</strong></div>
        <div class="catalog-progress__bar" aria-hidden="true"><span style="transform:scaleX(${(found / CATALOG.length).toFixed(3)})"></span></div>
        <p class="catalog-progress__hint">${escapeHtml(t('burrow.catalog.hint'))}</p>
      </div>
      ${this.catalogDetail()}
      ${groups}`;
  }

  private renderAchievements(): void {
    const panel = this.panels.get('achievements')!;
    const done = this.progression.achievementCount;
    const rows = (group: (typeof ACHIEVEMENT_GROUPS)[number]) =>
      ACHIEVEMENTS.filter((a) => a.group === group)
        .map((a) => {
          const has = this.progression.hasAchievement(a.id);
          const hidden = isHiddenAchievement(a.id, has);
          const status = has ? t('burrow.ach.done') : t('burrow.ach.reward', { xp: a.reward });
          const icon = has ? Icons.trophy : hidden ? GameIcons.secret : GameIcons.lock;
          return /* html */ `
            <li class="ach-row${has ? ' is-done' : ''}${hidden ? ' is-secret' : ''}" tabindex="0" data-focusable>
              <span class="ach-row__icon" aria-hidden="true">${icon}</span>
              <span class="ach-row__text">
                <strong>${escapeHtml(achievementName(a.id, hidden))}</strong>
                <span>${escapeHtml(achievementDesc(a.id, hidden))}</span>
              </span>
              <span class="ach-row__status">${escapeHtml(status)}</span>
            </li>`;
        })
        .join('');
    const groups = ACHIEVEMENT_GROUPS.map(
      (group) => /* html */ `
        <h3 class="sheet__heading">${escapeHtml(t(`ach.group.${group}` as MessageKey))}</h3>
        <ul class="ach-list">${rows(group)}</ul>`,
    ).join('');
    panel.innerHTML = /* html */ `
      <div class="catalog-progress">
        <div class="catalog-progress__row"><strong>${escapeHtml(t('burrow.ach.progress', { done, total: ACHIEVEMENTS.length }))}</strong></div>
        <div class="catalog-progress__bar" aria-hidden="true"><span style="transform:scaleX(${(done / ACHIEVEMENTS.length).toFixed(3)})"></span></div>
        <p class="catalog-progress__hint">${escapeHtml(t('burrow.ach.hint'))}</p>
      </div>
      ${groups}`;
  }

  private renderPerks(): void {
    const panel = this.panels.get('perks')!;
    const level = this.progression.level;
    const rows = PERKS.map((perk) => {
      const unlocked = perk.unlockLevel <= level;
      let status = unlocked ? t('burrow.perks.unlocked') : t('burrow.perks.locked', { n: perk.unlockLevel });
      if (unlocked && perk.active) status = t('burrow.perks.active');
      return /* html */ `
        <li class="perk-row${unlocked ? '' : ' is-locked'}" tabindex="0" data-focusable>
          <span class="perk-row__icon perk-icon--${perk.id}" aria-hidden="true">${unlocked ? PerkIcons[perk.id] : GameIcons.lock}</span>
          <span class="perk-row__text">
            <strong>${escapeHtml(t(`perk.${perk.id}.name` as MessageKey))}</strong>
            <span>${escapeHtml(t(`perk.${perk.id}.desc` as MessageKey))}</span>
          </span>
          <span class="perk-row__status">${escapeHtml(status)}</span>
        </li>`;
    }).join('');
    panel.innerHTML = /* html */ `<p class="perk-hint">${escapeHtml(t('burrow.perks.hint'))}</p><ul class="perk-list">${rows}</ul>`;
  }
}
