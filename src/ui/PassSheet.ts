import { formatInteger, onLocaleChange, t, tn, type MessageKey } from '../i18n';
import { accessory } from '../progression/accessories';
import { lookFromKey, lookKey, lookRarity, type Look } from '../progression/looks';
import type { ChallengeView, PassView, Progression } from '../progression/Progression';
import {
  PASS_XP_ACHIEVEMENT,
  PASS_XP_BURY_BASE,
  PASS_XP_DAILY,
  PASS_XP_PER_CM,
  PASS_XP_REQUEST,
  seasonEnd,
  shownSeason,
  tierRewards,
  type PassCounter,
  type PassReward,
} from '../progression/seasons';
import { ChestIcons, CurrencyIcons, FloradaArt, PassIcon } from './economyIcons';
import { CatalogIcons, GameIcons, GiverIcons, PerkIcons } from './gameIcons';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { lookIcon } from './lookIcons';
import { amountText, chestName, lookName, rarityName, seasonName } from './lookText';
import { bindTabs, tabsMarkup } from './tabs';

export type PassTab = 'rewards' | 'challenges';

const TAB_ORDER: readonly PassTab[] = ['rewards', 'challenges'];

const TABS: ReadonlyArray<{ name: PassTab; icon: string; label: MessageKey }> = [
  { name: 'rewards', icon: GameIcons.star, label: 'pass.tab.rewards' },
  { name: 'challenges', icon: PassIcon, label: 'pass.tab.challenges' },
];

/** Ícone de cada desafio pelo contador. */
const CHALLENGE_ICONS: Record<PassCounter, string> = {
  buried: GameIcons.burrow,
  bigBall: CatalogIcons.dung,
  requests: Icons.check,
  golden: GameIcons.star,
  flowers: CatalogIcons.daisy,
  critters: GiverIcons.ladybug,
  feast: GameIcons.food,
  webs: CatalogIcons.web,
  rainBury: PerkIcons.rainCall,
  roll: Icons.mountain,
  days: Icons.calendar,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Passe da temporada (placa do menu): a trilha de níveis com os prêmios (pega
 * um por um, ou tudo de uma vez) e os desafios da temporada. Visual do passe
 * dá pra provar no besouro clicando no prêmio.
 */
export class PassSheet {
  readonly element: HTMLElement;
  /** Provando um visual do passe (null = volta pro vestido). */
  onPreview: ((look: Look | null) => void) | null = null;
  /** Pegou prêmios (o jogo toca o som). */
  onClaim: ((rewards: readonly PassReward[]) => void) | null = null;

  private readonly panels = new Map<PassTab, HTMLElement>();
  private readonly buttons = new Map<PassTab, HTMLButtonElement>();
  private readonly hero: HTMLElement;
  private readonly select: (name: PassTab) => void;
  private tab: PassTab = 'rewards';
  private preview: Look | null = null;

  constructor(
    private readonly progression: Progression,
    private readonly now: () => number = Date.now,
  ) {
    const markup = tabsMarkup('pass-', 'sheet-pass-title', TABS);
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--showcase sheet--pass';
    this.element.id = 'sheet-pass';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-pass-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-pass-title" data-t="menu.pass"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="pass-hero" data-hero></div>
      ${markup.tabs}
      <div class="sheet__body">${markup.panels}</div>`;
    this.hero = this.element.querySelector('[data-hero]') as HTMLElement;
    for (const name of TAB_ORDER) {
      this.buttons.set(name, this.element.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement);
      this.panels.set(name, this.element.querySelector(`[data-panel="${name}"]`) as HTMLElement);
    }
    this.select = bindTabs(TAB_ORDER, this.buttons, this.panels, (name) => {
      this.tab = name;
      this.render();
    });
    this.element.addEventListener('click', (e) => this.onClick(e));
    // O prêmio que dá pra provar é um "botão" de linha: Enter e espaço também provam.
    this.element.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && target.matches('[data-preview]')) {
        e.preventDefault();
        target.click();
      }
    });
    progression.subscribe(() => this.refresh());
    onLocaleChange(() => this.refresh());
  }

  get previewing(): Look | null {
    return this.preview;
  }

  prepare(): void {
    this.setPreview(null);
    this.tab = 'rewards';
    this.select('rewards');
    this.render();
    // A trilha já abre no nível atual (quem está no 12 não precisa rolar do 1).
    const current = this.panels.get('rewards')?.querySelector<HTMLElement>('.pass-tier.is-next, .pass-tier.is-ready');
    current?.scrollIntoView({ block: 'center' });
  }

  close(): void {
    this.setPreview(null);
  }

  refresh(): void {
    if (!this.element.hidden) this.render();
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const view = this.view();
    if (!view) return;
    const claim = target.closest<HTMLButtonElement>('[data-claim]');
    if (claim) {
      const tier = Number(claim.dataset.claim);
      const rewards = this.progression.claimPassTier(view.season.id, tier);
      if (rewards) this.onClaim?.(rewards);
      this.panels.get('rewards')?.querySelector<HTMLElement>(`[data-tier="${tier}"] [data-wear], [data-tier="${tier}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (target.closest('[data-claim-all]')) {
      const all: PassReward[] = [];
      for (const tier of view.claimable) all.push(...(this.progression.claimPassTier(view.season.id, tier) ?? []));
      if (all.length > 0) this.onClaim?.(all);
      return;
    }
    const wear = target.closest<HTMLButtonElement>('[data-wear]');
    if (wear) {
      const look = lookFromKey(wear.dataset.wear as ReturnType<typeof lookKey>);
      this.setPreview(null);
      if (look.kind === 'skin') this.progression.setSkin(look.id);
      else this.progression.setAccessory(accessory(look.id).slot, look.id);
      return;
    }
    const row = target.closest<HTMLElement>('[data-preview]');
    if (row) {
      const look = lookFromKey(row.dataset.preview as ReturnType<typeof lookKey>);
      const same = this.preview && lookKey(this.preview) === lookKey(look);
      this.setPreview(same ? null : look);
      this.render();
    }
  }

  private setPreview(look: Look | null): void {
    const same = look === null ? this.preview === null : this.preview !== null && lookKey(this.preview) === lookKey(look);
    if (same) return;
    this.preview = look;
    this.onPreview?.(look);
  }

  private view(): PassView | null {
    const season = shownSeason(this.now());
    return season ? this.progression.passView(season) : null;
  }

  // --- desenho ------------------------------------------------------------------------

  private render(): void {
    const view = this.view();
    if (!view) {
      this.hero.innerHTML = `<p class="pass-empty">${escapeHtml(t('pass.none'))}</p>`;
      for (const panel of this.panels.values()) panel.innerHTML = '';
      return;
    }
    this.hero.innerHTML = this.heroMarkup(view);
    this.buttons.get('rewards')!.classList.toggle('has-new', view.claimable.length > 0);
    const panel = this.panels.get(this.tab)!;
    panel.innerHTML = this.tab === 'rewards' ? this.rewardsMarkup(view) : this.challengesMarkup(view);
  }

  private heroMarkup(view: PassView): string {
    const top = view.season.tiers.length;
    const maxed = view.tier >= top;
    const left = seasonEnd(view.season) - this.now();
    const time = !view.active
      ? t('pass.ended')
      : left > 2 * DAY
        ? tn('pass.endsDays', Math.ceil(left / DAY))
        : tn('pass.endsHours', Math.max(1, Math.ceil(left / HOUR)));
    const progress = maxed ? 1 : view.into / view.needed;
    const barLabel = maxed ? t('pass.maxed') : t('pass.toNext', { xp: formatInteger(view.needed - view.into), n: view.tier + 1 });
    const claimAll =
      view.claimable.length > 1 ? `<button class="pass-claim-all" type="button" data-claim-all>${escapeHtml(t('pass.claimAll', { n: view.claimable.length }))}</button>` : '';
    return /* html */ `
      <div class="pass-hero__top">
        <span class="pass-hero__art" aria-hidden="true">${FloradaArt}</span>
        <span class="pass-hero__text">
          <strong>${escapeHtml(t('pass.seasonTitle', { name: seasonName(view.season.id) }))}</strong>
          <span class="pass-hero__time${view.active ? '' : ' is-ended'}">${Icons.calendar}${escapeHtml(time)}</span>
        </span>
        <span class="pass-level" aria-label="${escapeHtml(t('pass.levelAria', { n: view.tier, total: top }))}">
          <span class="pass-level__badge">${view.tier}</span><span class="pass-level__total">/${top}</span>
        </span>
      </div>
      <div class="pass-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${view.needed}" aria-valuenow="${maxed ? view.needed : view.into}" aria-label="${escapeHtml(barLabel)}">
        <span style="transform:scaleX(${progress.toFixed(3)})"></span>
      </div>
      <div class="pass-hero__row"><span class="pass-hero__xp">${escapeHtml(barLabel)}</span>${claimAll}</div>`;
  }

  private rewardsMarkup(view: PassView): string {
    const rows = view.season.tiers.map(({ tier }) => {
      const rewards = tierRewards(view.season, tier);
      const claimed = view.claimed.has(tier);
      const reached = tier <= view.tier;
      const next = tier === view.tier + 1;
      const state = claimed ? 'is-claimed' : reached ? 'is-ready' : next ? 'is-next' : 'is-locked';
      const look = rewards.find((r): r is { look: ReturnType<typeof lookKey> } => 'look' in r);
      const lookObj = look ? lookFromKey(look.look) : null;
      const trying = lookObj !== null && this.preview !== null && lookKey(this.preview) === lookKey(lookObj);
      const art = rewards.map((r) => `<span class="pass-tier__art${'look' in r ? ` is-${lookRarity(lookFromKey(r.look))}` : ''}" aria-hidden="true">${this.rewardIcon(r)}</span>`).join('');
      const names = rewards.map((r) => this.rewardName(r)).join(' + ');
      const sub = lookObj ? `${rarityName(lookRarity(lookObj))} · ${t(lookObj.kind === 'skin' ? 'pass.kind.skin' : 'pass.kind.acc')}` : t('pass.kind.bonus');
      let action: string;
      if (claimed && lookObj && this.progression.isLookUnlocked(lookObj) && !this.isWorn(lookObj)) {
        action = `<button class="pass-tier__wear" type="button" data-wear="${lookKey(lookObj)}">${escapeHtml(t('shop.wear'))}</button>`;
      } else if (claimed) {
        action = `<span class="pass-tier__done" aria-label="${escapeHtml(t('pass.claimed'))}">${Icons.check}</span>`;
      } else if (reached) {
        action = `<button class="pass-tier__claim" type="button" data-claim="${tier}">${escapeHtml(t('pass.claim'))}</button>`;
      } else {
        action = `<span class="pass-tier__lock" aria-label="${escapeHtml(t('wardrobe.locked'))}">${GameIcons.lock}</span>`;
      }
      const preview = lookObj ? ` data-preview="${lookKey(lookObj)}" data-focusable tabindex="0" role="button" aria-pressed="${trying}"` : '';
      return /* html */ `
        <li class="pass-tier ${state}${trying ? ' is-trying' : ''}" data-tier="${tier}">
          <span class="pass-tier__num" aria-label="${escapeHtml(t('pass.tier', { n: tier }))}">${tier}</span>
          <span class="pass-tier__body"${preview}>
            ${art}
            <span class="pass-tier__text"><strong>${escapeHtml(names)}</strong><span>${escapeHtml(sub)}${trying ? ` · ${escapeHtml(t('wardrobe.trying'))}` : ''}</span></span>
          </span>
          ${action}
        </li>`;
    });
    return `<ol class="pass-track">${rows.join('')}</ol>`;
  }

  private challengesMarkup(view: PassView): string {
    const done = view.challenges.filter((c) => c.done).length;
    const rows = view.challenges.map((c) => this.challengeRow(c)).join('');
    const how = [
      t('pass.how.bury', { base: PASS_XP_BURY_BASE, cm: PASS_XP_PER_CM }),
      t('pass.how.request', { xp: PASS_XP_REQUEST }),
      t('pass.how.daily', { xp: PASS_XP_DAILY }),
      t('pass.how.achievement', { xp: PASS_XP_ACHIEVEMENT }),
    ];
    return /* html */ `
      <p class="pass-challenges__count">${escapeHtml(t('pass.challengesDone', { n: done, total: view.challenges.length }))}</p>
      <ul class="pass-challenges">${rows}</ul>
      <div class="pass-how">
        <h3 class="sheet__heading">${escapeHtml(t('pass.how.title'))}</h3>
        <ul>${how.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </div>`;
  }

  private challengeRow(c: ChallengeView): string {
    const text = t(`pass.ch.${c.id}` as MessageKey, { n: formatInteger(c.counter === 'roll' ? Math.round(c.goal / 50) : c.goal) });
    const shown = c.counter === 'roll' ? `${formatInteger(Math.floor(c.progress / 50))} / ${formatInteger(Math.round(c.goal / 50))} m` : `${formatInteger(Math.floor(c.progress))} / ${formatInteger(c.goal)}`;
    return /* html */ `
      <li class="pass-challenge${c.done ? ' is-done' : ''}" data-focusable tabindex="-1">
        <span class="pass-challenge__icon" aria-hidden="true">${c.done ? Icons.check : CHALLENGE_ICONS[c.counter]}</span>
        <span class="pass-challenge__text">
          <strong>${escapeHtml(text)}</strong>
          <span class="pass-challenge__bar" aria-hidden="true"><span style="transform:scaleX(${(c.progress / c.goal).toFixed(3)})"></span></span>
          <span class="pass-challenge__progress">${escapeHtml(shown)}</span>
        </span>
        <span class="pass-challenge__xp">+${formatInteger(c.xp)} XP</span>
      </li>`;
  }

  private rewardIcon(reward: PassReward): string {
    if ('coins' in reward) return CurrencyIcons.coins;
    if ('dew' in reward) return CurrencyIcons.dew;
    if ('chest' in reward) return ChestIcons[reward.chest];
    return lookIcon(lookFromKey(reward.look));
  }

  private rewardName(reward: PassReward): string {
    if ('coins' in reward) return amountText('coins', reward.coins);
    if ('dew' in reward) return amountText('dew', reward.dew);
    if ('chest' in reward) return chestName(reward.chest);
    return lookName(lookFromKey(reward.look));
  }

  private isWorn(look: Look): boolean {
    return look.kind === 'skin' ? this.progression.skin === look.id : this.progression.outfit[accessory(look.id).slot] === look.id;
  }
}
