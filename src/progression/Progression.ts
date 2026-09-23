import type { PantryBall, SaveData } from '../core/save';
import {
  BURY_GOALS,
  CATALOG_GOAL,
  FEAST_GOAL,
  FRESH_GOAL,
  LEVEL_GOALS,
  SIZE_MILESTONES,
  achievement,
  type AchievementId,
} from './achievements';
import { CATALOG, type CatalogId } from './catalog';
import { PANTRY_CAPACITY, RoundLedger, banquetMultiplier, foodFor, type FoodBreakdown } from './food';
import { levelBonuses, levelInfo, perksUnlockedAt, unlockedPerks, type LevelInfo } from './leveling';
import {
  HEAT_DECAY_PER_SECOND,
  HEAT_RISE_SECONDS,
  PERK_MILESTONES_CM,
  PERKS,
  computeModifiers,
  drawPerkOffer,
  neutralModifiers,
  type Modifiers,
  type PerkId,
} from './perks';
import { drawRequests, updateRequest, type RoundRequest } from './requests';

/** O que aconteceu ao comer da despensa. */
export interface MealResult {
  /** Bolas comidas. */
  count: number;
  xp: number;
  /** Bônus de banquete aplicado (1 = nenhum). */
  multiplier: number;
  levelBefore: number;
  levelAfter: number;
  /** Poderes que entraram no sorteio por causa dos níveis ganhos. */
  unlocked: PerkId[];
}

/** Conquista feita agora (o XP da recompensa já entrou). */
export interface AchievementUnlock {
  id: AchievementId;
  reward: number;
  levelBefore: number;
  levelAfter: number;
  /** Poderes liberados pelos níveis que a recompensa deu. */
  unlocked: PerkId[];
}

/** Subida de nível causada por um ganho de XP. */
interface XpGain {
  levelBefore: number;
  levelAfter: number;
  unlocked: PerkId[];
}

/** O que aconteceu ao enterrar uma bola. */
export interface BurialOutcome {
  food: FoodBreakdown;
  requestsDone: number;
  /** Figurinhas que entraram no catálogo agora. */
  discovered: CatalogId[];
  /** Guardada na despensa? (se ela estava cheia, o besouro comeu na hora) */
  stored: boolean;
  /** Refeição feita na hora (despensa cheia). */
  meal: MealResult | null;
  /** Primeira vez que a toca vai ser apresentada (abrir o painel sozinha). */
  introduceBurrow: boolean;
}

/**
 * Progressão entre rodadas e dentro delas: nível e experiência, despensa,
 * catálogo, poderes da rodada (1 de 3 nos marcos de tamanho) e pedidos.
 *
 * Não sabe de Three.js nem de DOM: o `Game` avisa o que a bola pegou e pergunta
 * os multiplicadores do passo; a interface lê o estado e chama `eat`.
 */
export class Progression {
  readonly ledger = new RoundLedger();
  /** Poderes escolhidos nesta rodada, na ordem em que vieram. */
  readonly roundPerks: PerkId[] = [];
  requests: RoundRequest[] = [];
  /** Calor do Sangue quente (0..1). */
  heat = 0;
  /** Conquista feita durante o jogo (o HUD mostra o aviso e toca o som). */
  onAchievement: ((unlock: AchievementUnlock) => void) | null = null;

  private readonly perkSet = new Set<PerkId>();
  private readonly mods: Modifiers = neutralModifiers();
  private nextMilestone = 0;
  private info: LevelInfo;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly save: SaveData,
    private readonly persist: () => void,
    private readonly random: () => number = Math.random,
  ) {
    this.info = levelInfo(save.xp);
    this.catchUpAchievements();
    this.startRound();
  }

  // --- leitura -----------------------------------------------------------------

  get level(): number {
    return this.info.level;
  }

  get levelProgress(): Readonly<LevelInfo> {
    return this.info;
  }

  get bonuses(): { push: number; speed: number } {
    return levelBonuses(this.info.level);
  }

  get pantry(): readonly PantryBall[] {
    return this.save.pantry;
  }

  get catalog(): Readonly<SaveData['catalog']> {
    return this.save.catalog;
  }

  get discoveredCount(): number {
    return CATALOG.filter((entry) => (this.save.catalog[entry.id] ?? 0) > 0).length;
  }

  get availablePerks(): PerkId[] {
    return unlockedPerks(this.info.level);
  }

  hasPerk(id: PerkId): boolean {
    return this.perkSet.has(id);
  }

  hasAchievement(id: AchievementId): boolean {
    return this.save.achievements.includes(id);
  }

  get achievementCount(): number {
    return this.save.achievements.length;
  }

  /** Avisa quem mostra o estado (HUD, painel da toca) quando algo mudou. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- rodada ------------------------------------------------------------------

  /** Bola nova: zera o que a bola pegou, os poderes, o calor e sorteia os pedidos. */
  startRound(): void {
    this.ledger.reset();
    this.roundPerks.length = 0;
    this.perkSet.clear();
    this.heat = 0;
    this.nextMilestone = 0;
    this.requests = drawRequests(this.info.level, this.random);
    this.emit();
  }

  /**
   * A bola engoliu algo (montinho, detrito, flor, tatuzinho...). Devolve os
   * pedidos que acabaram de ser cumpridos.
   */
  noteCollected(id: CatalogId, ballCm: number, amount = 1): RoundRequest[] {
    this.ledger.add(id, amount);
    return this.refreshRequests(ballCm);
  }

  /** Tamanho da bola mudou (pedidos de tamanho e marcos que viram conquista). */
  noteBallSize(ballCm: number): RoundRequest[] {
    for (const milestone of SIZE_MILESTONES) if (ballCm >= milestone.cm) this.unlock(milestone.id);
    return this.refreshRequests(ballCm);
  }

  /**
   * Passou de um marco de poder? Devolve as opções (vazio = marco passou mas
   * não sobrou poder pra oferecer), ou null se nenhum marco novo.
   */
  checkPerkMilestone(ballCm: number): PerkId[] | null {
    if (this.nextMilestone >= PERK_MILESTONES_CM.length || ballCm < PERK_MILESTONES_CM[this.nextMilestone]) return null;
    // Crescimento enorme de uma vez (tronco engolido) pode pular marcos: um de cada vez.
    this.nextMilestone++;
    const pool = this.availablePerks.filter((id) => !this.perkSet.has(id));
    return drawPerkOffer(pool, this.random);
  }

  takePerk(id: PerkId): void {
    if (this.perkSet.has(id)) return;
    this.perkSet.add(id);
    this.roundPerks.push(id);
    if (!this.save.perksUsed.includes(id)) {
      this.save.perksUsed.push(id);
      this.persist();
    }
    if (this.save.perksUsed.length >= PERKS.length) this.unlock('allPerks');
    this.emit();
  }

  /** Sangue quente: esquenta empurrando com vontade, esfria parado. */
  updateHeat(dt: number, pushingHard: boolean): void {
    if (!this.perkSet.has('hotBlood')) {
      this.heat = 0;
      return;
    }
    this.heat = pushingHard ? Math.min(1, this.heat + dt / HEAT_RISE_SECONDS) : Math.max(0, this.heat - dt * HEAT_DECAY_PER_SECOND);
  }

  /** Multiplicadores do passo (o objeto é reaproveitado: não guarde a referência entre passos). */
  modifiers(ballRadius: number): Modifiers {
    return computeModifiers(this.bonuses, this.perkSet, this.heat, ballRadius, this.mods);
  }

  // --- enterro e toca ------------------------------------------------------------

  /**
   * Bola enterrada: vira comida na despensa, figurinhas no catálogo, pedidos
   * pagam e as conquistas de enterro são conferidas. `raining`: estava chovendo.
   * Quem chama já contou a bola em `save.buried`.
   */
  bury(diameterCm: number, raining = false): BurialOutcome {
    const reward = this.requests.reduce((sum, request) => sum + (request.done ? request.reward : 0), 0);
    const food = foodFor(diameterCm, this.ledger, reward);
    const discovered: CatalogId[] = [];
    for (const [id, n] of this.ledger.entries()) {
      if (n <= 0) continue;
      const before = this.save.catalog[id] ?? 0;
      if (before === 0) discovered.push(id);
      this.save.catalog[id] = Math.min(1e7, before + n);
    }
    const introduceBurrow = !this.save.seenBurrow;

    let stored = true;
    let meal: MealResult | null = null;
    if (this.save.pantry.length < PANTRY_CAPACITY) {
      this.save.pantry.push({ cm: Math.round(diameterCm * 10) / 10, food: food.total });
    } else {
      stored = false;
      meal = this.feed([food.total]);
    }
    const requestsDone = this.requests.filter((r) => r.done).length;
    if (requestsDone > 0 && requestsDone === this.requests.length) this.unlock('allRequests');
    if (raining) this.unlock('rainBury');
    if (this.roundPerks.length >= PERK_MILESTONES_CM.length) this.unlock('fullPower');
    this.checkProgressGoals(false);
    this.persist();
    this.emit();
    return { food, requestsDone, discovered, stored, meal, introduceBurrow };
  }

  /**
   * Come bolas da despensa (índices; vazio = todas). Várias de uma vez viram
   * banquete (+10% por bola a mais, até +50%).
   */
  eat(indices?: readonly number[]): MealResult | null {
    const pantry = this.save.pantry;
    const chosen = (indices ?? pantry.map((_, i) => i)).filter((i, k, all) => i >= 0 && i < pantry.length && all.indexOf(i) === k);
    if (chosen.length === 0) return null;
    const foods = chosen.map((i) => pantry[i].food);
    // Remove de trás pra frente para os índices continuarem valendo.
    for (const i of [...chosen].sort((a, b) => b - a)) pantry.splice(i, 1);
    const meal = this.feed(foods);
    if (foods.length >= FEAST_GOAL) this.unlock('feast');
    this.persist();
    this.emit();
    return meal;
  }

  /** O painel da toca já foi apresentado. */
  markBurrowSeen(): void {
    if (this.save.seenBurrow) return;
    this.save.seenBurrow = true;
    this.persist();
  }

  // ---------------------------------------------------------------------------

  private feed(foods: readonly number[]): MealResult {
    const multiplier = banquetMultiplier(foods.length);
    const xp = Math.round(foods.reduce((sum, food) => sum + food, 0) * multiplier);
    return { count: foods.length, xp, multiplier, ...this.grantXp(xp) };
  }

  /** Soma experiência e confere as conquistas de nível (que também pagam XP). */
  private grantXp(xp: number, silent = false): XpGain {
    const levelBefore = this.info.level;
    this.save.xp = Math.min(1e9, this.save.xp + xp);
    this.info = levelInfo(this.save.xp);
    const levelAfter = this.info.level;
    const unlocked: PerkId[] = [];
    for (let level = levelBefore + 1; level <= levelAfter; level++) unlocked.push(...perksUnlockedAt(level));
    for (const [id, goal] of LEVEL_GOALS) if (levelAfter >= goal) this.unlock(id, silent);
    return { levelBefore, levelAfter, unlocked };
  }

  /**
   * Faz uma conquista (uma vez só): guarda, paga o XP e avisa. `silent` é pra
   * dar ao jogador antigo o que ele já tinha feito antes delas existirem.
   */
  private unlock(id: AchievementId, silent = false): void {
    if (this.save.achievements.includes(id)) return;
    this.save.achievements.push(id);
    const { reward } = achievement(id);
    const gain = this.grantXp(reward, silent);
    this.persist();
    this.emit();
    if (!silent) this.onAchievement?.({ id, reward, ...gain });
  }

  /** Conquistas que dependem só do que está no save (enterros, catálogo). */
  private checkProgressGoals(silent: boolean): void {
    for (const [id, goal] of BURY_GOALS) if (this.save.buried >= goal) this.unlock(id, silent);
    const found = this.discoveredCount;
    if (found >= CATALOG_GOAL) this.unlock('catalog10', silent);
    if (found >= CATALOG.length) this.unlock('catalogAll', silent);
    if ((this.save.catalog.log ?? 0) > 0) this.unlock('log', silent);
    if ((this.save.catalog.freshDung ?? 0) >= FRESH_GOAL) this.unlock('fresh10', silent);
  }

  /** Save de antes das conquistas: o que já foi feito conta (sem aviso na tela). */
  private catchUpAchievements(): void {
    for (const milestone of SIZE_MILESTONES) if (this.save.bestCm >= milestone.cm) this.unlock(milestone.id, true);
    this.checkProgressGoals(true);
  }

  private refreshRequests(ballCm: number): RoundRequest[] {
    const done: RoundRequest[] = [];
    let changed = false;
    for (const request of this.requests) {
      const before = request.progress;
      if (updateRequest(request, this.ledger, ballCm)) done.push(request);
      changed ||= request.progress !== before;
    }
    if (changed) this.emit();
    return done;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
