import type { PantryBall, SaveData } from '../core/save';
import { Ability } from './ability';
import {
  BURY_GOALS,
  CATALOG_GOALS,
  EDGE_CM,
  FEAST_GOAL,
  FRESH_GOAL,
  LEVEL_GOALS,
  MARATHON_UNITS,
  PURIST_CM,
  RAINBOW_GOAL,
  REQUESTS_GOAL,
  RODEO_SECONDS,
  SIZE_MILESTONES,
  TOYS_GOAL,
  WEB_GOAL,
  ZOO_GOAL,
  achievement,
  type AchievementId,
} from './achievements';
import { CATALOG, CRITTER_IDS, FLOWER_IDS, PICNIC_IDS, TOY_IDS, type CatalogId } from './catalog';
import { RAINBOW_HUES, type Hue } from './colors';
import { PANTRY_CAPACITY, RoundLedger, banquetMultiplier, foodFor, type FoodBreakdown } from './food';
import { levelBonuses, levelInfo, perksUnlockedAt, unlockedPerks, type LevelInfo } from './leveling';
import {
  HEAT_DECAY_PER_SECOND,
  MAX_PERK_RANK,
  PERK_MILESTONES_CM,
  PERKS,
  computeModifiers,
  drawPerkOffer,
  heatRiseSeconds,
  neutralModifiers,
  riderCooldown,
  riderDuration,
  type Modifiers,
  type PerkId,
  type PerkOffer,
  type PerkRank,
} from './perks';
import { drawRequests, failDryChallenge, resolveChallenges, updateRequest, type RoundRequest } from './requests';
import { SKINS, skin, type SkinId } from './skins';
import { ACCESSORIES, ACCESSORY_SLOTS, accessory, type AccessoryId, type AccessorySlot, type Outfit } from './accessories';
import { ALL_LOOKS, lookKey, lookUnlock, looksUnlockedBy, looksUnlockedByLevels, type Look } from './looks';
import { isUnlockMet, type UnlockProgress } from './unlocks';

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
  /** Visuais (cascos e acessórios) liberados pelos níveis ganhos. */
  looks: Look[];
}

/** Conquista feita agora (o XP da recompensa já entrou). */
export interface AchievementUnlock {
  id: AchievementId;
  reward: number;
  levelBefore: number;
  levelAfter: number;
  /** Poderes liberados pelos níveis que a recompensa deu. */
  unlocked: PerkId[];
  /** Visuais que essa conquista liberou (e os dos níveis que ela deu). */
  looks: Look[];
}

/** Subida de nível causada por um ganho de XP. */
interface XpGain {
  levelBefore: number;
  levelAfter: number;
  unlocked: PerkId[];
  /** Visuais liberados pelos níveis ganhos. */
  looks: Look[];
}

/** O que aconteceu ao enterrar uma bola. */
export interface BurialOutcome {
  food: FoodBreakdown;
  requestsDone: number;
  /** Algum pedido dourado (do Sol) foi cumprido nesta bola. */
  goldenDone: boolean;
  /** Figurinhas que entraram no catálogo agora. */
  discovered: CatalogId[];
  /** Guardada na despensa? (se ela estava cheia, o besouro comeu na hora) */
  stored: boolean;
  /** Refeição feita na hora (despensa cheia). */
  meal: MealResult | null;
  /** Primeira vez que a toca vai ser apresentada (abrir o painel sozinha). */
  introduceBurrow: boolean;
}

/** O que o enterro precisa saber além do tamanho. */
export interface BurialContext {
  /** Estava chovendo. */
  raining: boolean;
  /** O besouro estava em cima da bola (Equilibrista) quando ela caiu na toca. */
  riding: boolean;
}

/** Poder escolhido na rodada, com o nível atual dele (★★ = 2). */
export interface RoundPerk {
  id: PerkId;
  rank: PerkRank;
}

/** O que a bola pegou agora rendeu. */
export interface CollectResult {
  /** Pedidos que acabaram de ser cumpridos. */
  done: RoundRequest[];
  /** Primeira coisa desse tipo na bola desta rodada (poder Curioso). */
  newKind: boolean;
}

/**
 * Progressão entre rodadas e dentro delas: nível e experiência, despensa,
 * catálogo, poderes da rodada (1 de 3 nos marcos de tamanho, ★★ se repetir),
 * o poder de apertar (Equilibrista), pedidos, conquistas e o visual (casco e
 * acessórios, com o selo de "Novo" do guarda-roupa).
 *
 * Não sabe de Three.js nem de DOM: o `Game` avisa o que a bola pegou e pergunta
 * os multiplicadores do passo; a interface lê o estado e chama `eat`/`setSkin`/`setAccessory`.
 */
export class Progression implements UnlockProgress {
  readonly ledger = new RoundLedger();
  /** Poderes escolhidos nesta rodada, na ordem em que vieram (o ★★ atualiza o nível no lugar). */
  readonly roundPerks: RoundPerk[] = [];
  /** Equilibrista: relógio do uso e da recarga. */
  readonly rider = new Ability();
  requests: RoundRequest[] = [];
  /** Calor do Sangue quente (0..1). */
  heat = 0;
  /** Conquista feita durante o jogo (o HUD mostra o aviso e toca o som). */
  onAchievement: ((unlock: AchievementUnlock) => void) | null = null;

  private readonly ranks = new Map<PerkId, PerkRank>();
  private readonly mods: Modifiers = neutralModifiers();
  private nextMilestone = 0;
  /** Escolhas de poder feitas na rodada (o ★★ conta como uma escolha). */
  private picks = 0;
  /** A bola encostou em água de poça nesta rodada (desafio "sem molhar"). */
  private roundWet = false;
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
    return this.ranks.has(id);
  }

  /** Nível do poder na rodada (0 = não tem). */
  perkRank(id: PerkId): PerkRank | 0 {
    return this.ranks.get(id) ?? 0;
  }

  hasAchievement(id: AchievementId): boolean {
    return this.save.achievements.includes(id);
  }

  get achievementCount(): number {
    return this.save.achievements.length;
  }

  get skin(): SkinId {
    return this.save.skin;
  }

  isSkinUnlocked(id: SkinId): boolean {
    return isUnlockMet(skin(id).unlock, this);
  }

  get unlockedSkinCount(): number {
    return SKINS.filter((s) => this.isSkinUnlocked(s.id)).length;
  }

  /** O que o besouro está vestindo (um acessório ou nada por lugar). */
  get outfit(): Readonly<Outfit> {
    return this.save.outfit;
  }

  /** Liberado pela conquista/nível dele ou achado no jardim. */
  isAccessoryUnlocked(id: AccessoryId): boolean {
    return this.save.found.includes(id) || isUnlockMet(accessory(id).unlock, this);
  }

  /** Foi achado no jardim (e não liberado pelo caminho normal)? */
  wasFound(id: AccessoryId): boolean {
    return this.save.found.includes(id) && !isUnlockMet(accessory(id).unlock, this);
  }

  get unlockedAccessoryCount(): number {
    return ACCESSORIES.filter((a) => this.isAccessoryUnlocked(a.id)).length;
  }

  isLookUnlocked(look: Look): boolean {
    return look.kind === 'acc' ? this.isAccessoryUnlocked(look.id) : this.isSkinUnlocked(look.id);
  }

  /** Liberado e ainda não visto no guarda-roupa (os livres desde o começo não contam). */
  isLookNew(look: Look): boolean {
    return lookUnlock(look) !== undefined && this.isLookUnlocked(look) && !this.save.seenLooks.includes(lookKey(look));
  }

  /** Quantos visuais novos esperam no guarda-roupa (a bolinha do menu). */
  get newLookCount(): number {
    return ALL_LOOKS.filter((look) => this.isLookNew(look)).length;
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
    this.ranks.clear();
    this.rider.reset();
    this.heat = 0;
    this.picks = 0;
    this.roundWet = false;
    this.nextMilestone = 0;
    this.requests = drawRequests(this.info.level, this.random);
    this.emit();
  }

  /**
   * A bola engoliu algo (montinho, detrito, flor, bicho...). `hue` é a família
   * de cor da coisa (pedidos de cor). Devolve os pedidos que acabaram de ser
   * cumpridos e se é o primeiro desse tipo na bola.
   */
  noteCollected(id: CatalogId, ballCm: number, hue: Hue | null = null, amount = 1): CollectResult {
    const newKind = id !== 'dung' && this.ledger.count(id) === 0;
    this.ledger.add(id, amount);
    if (hue) this.ledger.addHue(hue, amount);
    return { done: this.refreshRequests(ballCm), newKind };
  }

  /** Tamanho da bola mudou (pedidos de tamanho e marcos que viram conquista). */
  noteBallSize(ballCm: number): RoundRequest[] {
    for (const milestone of SIZE_MILESTONES) if (ballCm >= milestone.cm) this.unlock(milestone.id);
    return this.refreshRequests(ballCm);
  }

  /** A bola encostou na água da poça (o desafio "sem molhar" falha). */
  noteBallWet(): void {
    if (this.roundWet) return;
    this.roundWet = true;
    if (failDryChallenge(this.requests)) this.emit();
  }

  /** Teia rasgada (contador da conquista). */
  noteWebTorn(): void {
    this.save.stats.websTorn = Math.min(1e7, this.save.stats.websTorn + 1);
    this.persist();
    if (this.save.stats.websTorn >= WEB_GOAL) this.unlock('web10');
  }

  /** Feito que acontece no mundo (viu o beija-flor, subiu na bola pulando...). */
  achieve(id: AchievementId): void {
    this.unlock(id);
  }

  /**
   * Passou de um marco de poder? Devolve as cartas (vazio = marco passou mas
   * não sobrou poder pra oferecer), ou null se nenhum marco novo.
   */
  checkPerkMilestone(ballCm: number): PerkOffer[] | null {
    if (this.nextMilestone >= PERK_MILESTONES_CM.length || ballCm < PERK_MILESTONES_CM[this.nextMilestone]) return null;
    // Crescimento enorme de uma vez (tronco engolido) pode pular marcos: um de cada vez.
    this.nextMilestone++;
    return drawPerkOffer(this.availablePerks, this.ranks, this.random);
  }

  /** Pega o poder (ou sobe pra ★★ se já tinha). Devolve o nível que ele ficou. */
  takePerk(id: PerkId): PerkRank {
    const current = this.ranks.get(id) ?? 0;
    if (current >= MAX_PERK_RANK) return MAX_PERK_RANK;
    const rank = (current + 1) as PerkRank;
    this.ranks.set(id, rank);
    this.picks++;
    const entry = this.roundPerks.find((p) => p.id === id);
    if (entry) entry.rank = rank;
    else this.roundPerks.push({ id, rank });
    if (id === 'rider') this.rider.configure(riderDuration(rank), riderCooldown(rank));
    if (rank === 2) this.unlock('doubleStar');
    if (!this.save.perksUsed.includes(id)) {
      this.save.perksUsed.push(id);
      this.persist();
    }
    if (this.save.perksUsed.length >= PERKS.length) this.unlock('allPerks');
    this.emit();
    return rank;
  }

  /** Sangue quente: esquenta empurrando com vontade, esfria parado. No máximo, conquista "Febre". */
  updateHeat(dt: number, pushingHard: boolean): void {
    const rank = this.ranks.get('hotBlood');
    if (!rank) {
      this.heat = 0;
      return;
    }
    this.heat = pushingHard ? Math.min(1, this.heat + dt / heatRiseSeconds(rank)) : Math.max(0, this.heat - dt * HEAT_DECAY_PER_SECOND);
    if (this.heat >= 1) this.unlock('fever');
  }

  /**
   * Contadores contínuos do passo: tempo em cima da bola e quanto ela rolou.
   * Só na memória (gravar a cada passo pesaria); vão pro disco junto do próximo
   * salvamento (enterro, refeição, conquista).
   */
  noteMotion(rideSeconds: number, rollUnits: number): void {
    const stats = this.save.stats;
    if (rideSeconds > 0) {
      stats.rideSeconds = Math.min(1e7, stats.rideSeconds + rideSeconds);
      if (stats.rideSeconds >= RODEO_SECONDS) this.unlock('rodeo');
    }
    if (rollUnits > 0) {
      stats.rollUnits = Math.min(1e9, stats.rollUnits + rollUnits);
      if (stats.rollUnits >= MARATHON_UNITS) this.unlock('marathon');
    }
  }

  /** Multiplicadores do passo (o objeto é reaproveitado: não guarde a referência entre passos). */
  modifiers(ballRadius: number, ballSpeed = 0): Modifiers {
    return computeModifiers(this.bonuses, this.ranks, this.heat, ballRadius, ballSpeed, this.mods);
  }

  // --- enterro e toca ------------------------------------------------------------

  /**
   * Bola enterrada: resolve os desafios, vira comida na despensa, figurinhas no
   * catálogo, pedidos pagam e as conquistas de enterro são conferidas. Quem
   * chama já contou a bola em `save.buried`.
   */
  bury(diameterCm: number, context: BurialContext): BurialOutcome {
    resolveChallenges(this.requests, { wet: this.roundWet, raining: context.raining });
    const done = this.requests.filter((r) => r.done);
    const reward = done.reduce((sum, request) => sum + request.reward, 0);
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
    this.save.stats.requestsDone = Math.min(1e7, this.save.stats.requestsDone + done.length);
    const goldenDone = done.some((r) => r.golden);

    if (done.length > 0 && done.length === this.requests.length) this.unlock('allRequests');
    if (goldenDone) this.unlock('golden');
    if (context.raining) this.unlock('rainBury');
    if (context.riding) this.unlock('riderBury');
    if (this.picks >= PERK_MILESTONES_CM.length) this.unlock('fullPower');
    this.checkBallContents(diameterCm);
    this.checkProgressGoals(false);
    this.persist();
    this.emit();
    return { food, requestsDone: done.length, goldenDone, discovered, stored, meal, introduceBurrow };
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

  /** Troca o casco (só os liberados). */
  setSkin(id: SkinId): boolean {
    if (!this.isSkinUnlocked(id) || this.save.skin === id) return false;
    this.save.skin = id;
    this.persist();
    this.emit();
    return true;
  }

  /**
   * Veste um acessório no lugar dele (`null` = tira o que estiver lá). Só os
   * liberados. Com os quatro lugares ocupados, conquista "Fashionista".
   */
  setAccessory(slot: AccessorySlot, id: AccessoryId | null): boolean {
    if (id !== null && (accessory(id).slot !== slot || !this.isAccessoryUnlocked(id))) return false;
    if (this.save.outfit[slot] === id) return false;
    this.save.outfit[slot] = id;
    this.persist();
    if (ACCESSORY_SLOTS.every((s) => this.save.outfit[s] !== null)) this.unlock('fashion');
    this.emit();
    return true;
  }

  /**
   * Achado raro: o besouro passou por cima de um acessório brilhando no jardim.
   * Libera na hora (e aparece como "Novo" no guarda-roupa). Devolve se era novo.
   */
  findAccessory(id: AccessoryId): boolean {
    if (this.isAccessoryUnlocked(id)) return false;
    this.save.found.push(id);
    this.persist();
    this.emit();
    return true;
  }

  /** O jogador viu esses visuais no guarda-roupa: saem do "Novo". */
  markLooksSeen(looks: readonly Look[]): void {
    let changed = false;
    for (const look of looks) {
      if (!this.isLookNew(look)) continue;
      this.save.seenLooks.push(lookKey(look));
      changed = true;
    }
    if (!changed) return;
    this.persist();
    this.emit();
  }

  /**
   * Troca o progresso inteiro (save da nuvem juntado com o do aparelho, ou o
   * começo de novo ao sair da conta). O objeto do save continua o mesmo — quem
   * guardou a referência (o jogo, o HUD) vê o conteúdo novo. A rodada em curso
   * segue; o nível e as conquistas são recalculados.
   */
  replaceSave(next: SaveData): void {
    Object.assign(this.save, structuredClone(next));
    this.info = levelInfo(this.save.xp);
    this.catchUpAchievements();
    this.emit();
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
    return { levelBefore, levelAfter, unlocked, looks: looksUnlockedByLevels(levelBefore, levelAfter) };
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
    // O que já tinha sido achado no jardim não é "visual novo" de novo.
    const looks = [...looksUnlockedBy(id), ...gain.looks].filter((look) => look.kind !== 'acc' || !this.save.found.includes(look.id));
    if (!silent) this.onAchievement?.({ id, reward, ...gain, looks });
  }

  /** Conquistas do que foi dentro DESTA bola (buquê, zoológico, arco-íris...). */
  private checkBallContents(diameterCm: number): void {
    const ledger = this.ledger;
    if (ledger.distinct(FLOWER_IDS) >= FLOWER_IDS.length) this.unlock('bouquet');
    if (ledger.distinct(CRITTER_IDS) >= ZOO_GOAL) this.unlock('zoo');
    if (ledger.huesAmong(RAINBOW_HUES) >= RAINBOW_GOAL) this.unlock('rainbow');
    if (ledger.distinct(PICNIC_IDS) >= PICNIC_IDS.length) this.unlock('picnic');
    if (ledger.distinct(TOY_IDS) >= TOYS_GOAL) this.unlock('toys');
    if (diameterCm >= PURIST_CM && ledger.items === 0) this.unlock('purist');
    if (diameterCm < EDGE_CM) this.unlock('edge');
  }

  /** Conquistas que dependem só do que está no save (enterros, catálogo, contadores). */
  private checkProgressGoals(silent: boolean): void {
    const save = this.save;
    const has = (id: CatalogId) => (save.catalog[id] ?? 0) > 0;
    for (const [id, goal] of BURY_GOALS) if (save.buried >= goal) this.unlock(id, silent);
    const found = this.discoveredCount;
    for (const [id, goal] of CATALOG_GOALS) if (found >= goal) this.unlock(id, silent);
    if (found >= CATALOG.length) this.unlock('catalogAll', silent);
    if (has('log')) this.unlock('log', silent);
    if ((save.catalog.freshDung ?? 0) >= FRESH_GOAL) this.unlock('fresh10', silent);
    if (has('gnome')) this.unlock('gnome', silent);
    if (has('flipflop')) this.unlock('flipflop', silent);
    if (has('fourLeaf')) this.unlock('fourLeaf', silent);
    if (has('stickInsect')) this.unlock('stickInsect', silent);
    if (has('flyingAnt')) this.unlock('swarm', silent);
    if (has('earwig') || has('centipede')) this.unlock('underRock', silent);
    if (save.stats.websTorn >= WEB_GOAL) this.unlock('web10', silent);
    if (save.stats.requestsDone >= REQUESTS_GOAL) this.unlock('requests50', silent);
    if (save.stats.rideSeconds >= RODEO_SECONDS) this.unlock('rodeo', silent);
    if (save.stats.rollUnits >= MARATHON_UNITS) this.unlock('marathon', silent);
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
