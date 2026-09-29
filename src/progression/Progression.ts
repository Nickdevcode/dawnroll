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
import { ALL_LOOKS, isLookKey, lookKey, lookUnlock, looksUnlockedBy, looksUnlockedByLevels, type Look, type LookKey } from './looks';
import { isUnlockMet, priceParts, type Rarity, type SeasonId, type UnlockProgress } from './unlocks';
import {
  CHEST_PRICES,
  achievementPay,
  emptyWallet,
  levelChestKey,
  levelChestRarity,
  lookPurchaseKey,
  newEconomySeed,
  newShopChestKey,
  passChestKey,
  rarityRank,
  rollChest,
  shopChestRarity,
  type ChestGrant,
  type ChestResult,
  type ShopChest,
  type Wallet,
} from './economy';
import {
  PASS_XP_ACHIEVEMENT,
  PASS_XP_DAILY,
  PASS_XP_GOLDEN_EXTRA,
  PASS_XP_REQUEST,
  SEASONS,
  isSeasonActive,
  localDay,
  passXpForBurial,
  season,
  tierFor,
  tierRewards,
  type PassCounter,
  type PassReward,
  type SeasonDef,
} from './seasons';
import { emptyPass, type PassState } from '../core/save';

/** Disputa online: sem bônus de nível (ver `equalStats`). */
const NO_BONUS = { push: 0, speed: 0 } as const;

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
  /** Baús ganhos pelos níveis (um por nível, na ordem). */
  chests: Rarity[];
}

/** Conquista feita agora (o XP da recompensa já entrou). */
export interface AchievementUnlock {
  id: AchievementId;
  reward: number;
  /** Moedas e orvalho que ela pagou. */
  pay: Wallet;
  levelBefore: number;
  levelAfter: number;
  /** Poderes liberados pelos níveis que a recompensa deu. */
  unlocked: PerkId[];
  /** Visuais que essa conquista liberou (e os dos níveis que ela deu). */
  looks: Look[];
  /** Baús dos níveis que a recompensa deu. */
  chests: Rarity[];
}

/** Subida de nível causada por um ganho de XP. */
interface XpGain {
  levelBefore: number;
  levelAfter: number;
  unlocked: PerkId[];
  /** Visuais liberados pelos níveis ganhos. */
  looks: Look[];
  /** Baús dos níveis ganhos. */
  chests: Rarity[];
}

/** O que o enterro rendeu no passe da temporada. */
export interface PassGain {
  season: SeasonId;
  xp: number;
  /** Primeiro enterro do dia (o bônus já está no `xp`). */
  daily: boolean;
  tierBefore: number;
  tierAfter: number;
}

/** Resultado de uma compra na Feirinha. */
export type BuyResult = 'ok' | 'owned' | 'poor' | 'unavailable';

/** Um desafio da temporada com o andamento do jogador. */
export interface ChallengeView {
  id: string;
  counter: PassCounter;
  goal: number;
  xp: number;
  progress: number;
  done: boolean;
}

/** Retrato do passe de uma temporada (o painel desenha a partir daqui). */
export interface PassView {
  season: SeasonDef;
  active: boolean;
  /** XP total (jogando + desafios cumpridos). */
  totalXp: number;
  tier: number;
  into: number;
  needed: number;
  claimed: ReadonlySet<number>;
  /** Níveis alcançados e ainda não pegos. */
  claimable: number[];
  challenges: ChallengeView[];
}

/** O presente de boas-vindas das moedas (conquistas e níveis de antes viram moedas e baús). */
export interface WelcomeGift {
  coins: number;
  dew: number;
  chests: number;
}

/** O que aconteceu ao enterrar uma bola. */
export interface BurialOutcome {
  food: FoodBreakdown;
  /** A comida que ficou com você (a bola toda, ou a sua parte dela no online). */
  keptFood: number;
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
  /** XP do passe da temporada (null = nenhuma temporada valendo). */
  pass: PassGain | null;
}

/** O que o enterro precisa saber além do tamanho. */
export interface BurialContext {
  /** Estava chovendo. */
  raining: boolean;
  /** O besouro estava em cima da bola (Equilibrista) quando ela caiu na toca. */
  riding: boolean;
  /**
   * Online: a parte da bola que é sua (0..1). Quem doou bola pra ela leva o
   * resto da comida (ver `receiveShare`). Sem isso, a bola é toda sua.
   */
  share?: number;
  /** Online: Sol excedente da bola, em cm além dos 30 (vira comida extra). */
  sunCm?: number;
}

/** A parte de uma bola que você ajudou a fazer e outro enterrou (online). */
export interface ShareOutcome {
  food: number;
  stored: boolean;
  meal: MealResult | null;
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
 * o poder de apertar (Equilibrista), pedidos, conquistas, o visual (casco e
 * acessórios, com o selo de "Novo" do guarda-roupa) e a economia: carteira
 * (calculada do save), compras da Feirinha, baús e o passe da temporada.
 *
 * Não sabe de Three.js nem de DOM: o `Game` avisa o que a bola pegou e pergunta
 * os multiplicadores do passo; a interface lê o estado e chama `eat`/`setSkin`/`setAccessory`/`buyLook`/`openChest`...
 */
export class Progression implements UnlockProgress {
  /** O que a bola da rodada engoliu (no online, a bola que você está fazendo agora: ver `useLedger`). */
  private _ledger = new RoundLedger();
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
  /** Derivados do save (refeitos a cada mudança): carteira, visuais ganhos e baús fechados. */
  private walletCache: Wallet | null = null;
  private ownedCache: Set<LookKey> | null = null;
  private chestCache: ChestGrant[] | null = null;

  constructor(
    private readonly save: SaveData,
    private readonly persist: () => void,
    private readonly random: () => number = Math.random,
    /** Relógio (ms desde 1970): decide a temporada valendo e o "primeiro enterro do dia". */
    private readonly now: () => number = Date.now,
  ) {
    this.info = levelInfo(save.xp);
    this.catchUpAchievements();
    this.startRound();
  }

  // --- leitura -----------------------------------------------------------------

  get ledger(): RoundLedger {
    return this._ledger;
  }

  /**
   * Online: a sua bola agora é outra (roubou, ganhou broto, trocou pela que
   * estava parada). Os pedidos passam a contar o que tem nela; o resto da
   * rodada (poderes, pedidos já cumpridos) continua.
   */
  /**
   * Online, Disputa valendo: todo mundo com a mesma força e velocidade (o
   * bônus de nível desliga; os poderes da rodada continuam, que esses todo
   * mundo ganha igual pelo tamanho da bola).
   */
  equalStats = false;

  /** Online: ganhou a Disputa. XP de passe a mais e a conquista. */
  matchWon(passXp: number): void {
    this.addPassXp(passXp);
    this.achieve('mpWin');
    this.persist();
    this.emit();
  }

  useLedger(ledger: RoundLedger): void {
    if (ledger === this._ledger) return;
    this._ledger = ledger;
    this.emit();
  }

  get level(): number {
    return this.info.level;
  }

  get levelProgress(): Readonly<LevelInfo> {
    return this.info;
  }

  get bonuses(): { push: number; speed: number } {
    return this.equalStats ? NO_BONUS : levelBonuses(this.info.level);
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

  /** Liberado pela regra (conquista/nível) ou ganho (comprado, saído de baú, prêmio do passe). */
  isSkinUnlocked(id: SkinId): boolean {
    return isUnlockMet(skin(id).unlock, this) || this.ownedLooks().has(`skin:${id}`);
  }

  get unlockedSkinCount(): number {
    return SKINS.filter((s) => this.isSkinUnlocked(s.id)).length;
  }

  /** O que o besouro está vestindo (um acessório ou nada por lugar). */
  get outfit(): Readonly<Outfit> {
    return this.save.outfit;
  }

  /** Liberado pela conquista/nível dele, achado no jardim ou ganho (compra, baú, passe). */
  isAccessoryUnlocked(id: AccessoryId): boolean {
    return this.save.found.includes(id) || isUnlockMet(accessory(id).unlock, this) || this.ownedLooks().has(`acc:${id}`);
  }

  /** Foi achado no jardim (e não liberado por outro caminho)? */
  wasFound(id: AccessoryId): boolean {
    return this.save.found.includes(id) && !isUnlockMet(accessory(id).unlock, this) && !this.ownedLooks().has(`acc:${id}`);
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

  // --- economia -------------------------------------------------------------------

  /**
   * Moedas e orvalho: o que as conquistas, os prêmios do passe e os baús abertos
   * pagaram, menos as compras. Pode ficar negativo só se dois aparelhos gastaram
   * o mesmo dinheiro sem internet (aí as compras novas esperam o saldo voltar).
   */
  get wallet(): Readonly<Wallet> {
    if (this.walletCache) return this.walletCache;
    const wallet = emptyWallet();
    for (const id of this.save.achievements) {
      const pay = achievementPay(id);
      wallet.coins += pay.coins;
      wallet.dew += pay.dew;
    }
    for (const reward of this.claimedPassRewards()) {
      if ('coins' in reward) wallet.coins += reward.coins;
      else if ('dew' in reward) wallet.dew += reward.dew;
    }
    for (const result of Object.values(this.save.economy.opened)) {
      wallet.coins += result.coins;
      wallet.dew += result.dew;
    }
    for (const paid of Object.values(this.save.economy.purchases)) {
      wallet.coins -= paid.coins;
      wallet.dew -= paid.dew;
    }
    return (this.walletCache = wallet);
  }

  /** Veio de compra, baú ou passe (não conta conquista, nível nem achado). */
  isLookOwned(look: Look): boolean {
    return this.ownedLooks().has(lookKey(look));
  }

  /** Baús fechados esperando o jogador (os mais raros primeiro). */
  get chests(): readonly ChestGrant[] {
    if (this.chestCache) return this.chestCache;
    const opened = this.save.economy.opened;
    const list: ChestGrant[] = [];
    for (let level = 2; level <= this.info.level; level++) {
      const key = levelChestKey(level);
      if (!(key in opened)) list.push({ key, rarity: levelChestRarity(level), source: 'level' });
    }
    for (const [id, pass] of Object.entries(this.save.passes) as Array<[SeasonId, PassState]>) {
      const def = season(id);
      for (const tier of pass.claimed) {
        const chest = tierRewards(def, tier).find((r): r is { chest: Rarity } => 'chest' in r);
        const key = passChestKey(id, tier);
        if (chest && !(key in opened)) list.push({ key, rarity: chest.chest, source: 'pass' });
      }
    }
    for (const key of Object.keys(this.save.economy.purchases)) {
      const rarity = shopChestRarity(key);
      if (rarity && !(key in opened)) list.push({ key, rarity, source: 'shop' });
    }
    list.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
    return (this.chestCache = list);
  }

  /**
   * Compra um visual da Feirinha. Veste? Não: quem chama decide (o guarda-roupa
   * e a Feirinha vestem na hora, que é o que o jogador espera).
   */
  buyLook(look: Look): BuyResult {
    const unlock = lookUnlock(look);
    if (!unlock || !('shop' in unlock)) return 'unavailable';
    if (this.isLookUnlocked(look)) return 'owned';
    const { currency, amount } = priceParts(unlock.shop);
    if (this.wallet[currency] < amount) return 'poor';
    this.save.economy.purchases[lookPurchaseKey(look)] = { coins: currency === 'coins' ? amount : 0, dew: currency === 'dew' ? amount : 0 };
    this.persist();
    this.emit();
    return 'ok';
  }

  /** Compra um baú com orvalho. Devolve a chave do baú novo (null = orvalho não dá). */
  buyChest(rarity: ShopChest): string | null {
    const price = CHEST_PRICES[rarity];
    if (this.wallet.dew < price) return null;
    const key = newShopChestKey(rarity, this.now(), this.random);
    this.save.economy.purchases[key] = { coins: 0, dew: price };
    this.persist();
    this.emit();
    return key;
  }

  /** Abre um baú fechado: o que sai entra na carteira (e o visual, no guarda-roupa). */
  openChest(key: string): ChestResult | null {
    const grant = this.chests.find((chest) => chest.key === key);
    if (!grant) return null;
    const economy = this.save.economy;
    if (!economy.seed) economy.seed = newEconomySeed(this.random);
    const result = rollChest(grant.rarity, key, economy.seed, (look) => this.isLookUnlocked(look));
    economy.opened[key] = result;
    this.persist();
    this.emit();
    return result;
  }

  /**
   * O presente de boas-vindas: quem já jogava antes das moedas existirem vê,
   * uma vez, quanto as conquistas e os níveis antigos viraram. Null = já viu
   * (ou ainda não fez nada).
   */
  get welcomeGift(): WelcomeGift | null {
    if (this.save.economy.welcomed || (this.save.achievements.length === 0 && this.info.level <= 1)) return null;
    return { coins: Math.max(0, this.wallet.coins), dew: Math.max(0, this.wallet.dew), chests: this.chests.length };
  }

  markWelcomed(): void {
    if (this.save.economy.welcomed) return;
    this.save.economy.welcomed = true;
    this.persist();
    this.emit();
  }

  // --- passe da temporada -------------------------------------------------------------

  /** Temporada valendo agora (null entre uma e outra). */
  get activeSeason(): SeasonDef | null {
    const now = this.now();
    return SEASONS.find((def) => isSeasonActive(def, now)) ?? null;
  }

  /** Retrato do passe de uma temporada. */
  passView(def: SeasonDef): PassView {
    const state = this.save.passes[def.id] ?? emptyPass();
    const challenges: ChallengeView[] = def.challenges.map((c) => {
      const progress = Math.min(c.goal, state.counters[c.counter]);
      return { id: c.id, counter: c.counter, goal: c.goal, xp: c.xp, progress, done: state.counters[c.counter] >= c.goal };
    });
    const totalXp = this.passTotalXp(def, state);
    const { tier, into, needed } = tierFor(def, totalXp);
    const claimed = new Set(state.claimed);
    const claimable: number[] = [];
    for (let t = 1; t <= tier; t++) if (!claimed.has(t)) claimable.push(t);
    return { season: def, active: isSeasonActive(def, this.now()), totalXp, tier, into, needed, claimed, claimable, challenges };
  }

  /** Pega o prêmio de um nível alcançado do passe. Devolve os prêmios (null = não dava). */
  claimPassTier(id: SeasonId, tier: number): readonly PassReward[] | null {
    const def = season(id);
    const view = this.passView(def);
    if (!view.claimable.includes(tier)) return null;
    const state = this.passState(id);
    state.claimed = [...state.claimed, tier].sort((a, b) => a - b);
    this.persist();
    this.emit();
    return tierRewards(def, tier);
  }

  /** Níveis do passe esperando pra ser pegos na temporada mostrada (a bolinha do menu). */
  claimableTierCount(def: SeasonDef | null): number {
    return def ? this.passView(def).claimable.length : 0;
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
    this.bumpPassCounter('webs', 1);
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
      this.bumpPassCounter('roll', rollUnits);
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
    const food = foodFor(diameterCm, this.ledger, reward, context.sunCm ?? 0);
    // Online: com bola doada dentro, a comida é dividida pela parte de cada um (a sua fica aqui).
    const keptFood = Math.round(food.total * Math.max(0, Math.min(1, context.share ?? 1)));
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
      this.save.pantry.push({ cm: Math.round(diameterCm * 10) / 10, food: keptFood });
    } else {
      stored = false;
      meal = this.feed([keptFood]);
    }
    this.save.stats.requestsDone = Math.min(1e7, this.save.stats.requestsDone + done.length);
    const goldenDone = done.some((r) => r.golden);

    // Passe: o nível de antes, o XP do enterro e (depois das conquistas, que também pagam XP) o nível de depois.
    const passDef = this.activeSeason;
    const tierBefore = passDef ? this.passView(passDef).tier : 0;
    const passEarned = passDef ? this.passForBurial(passDef, diameterCm, done, context.raining) : null;
    if (done.length > 0 && done.length === this.requests.length) this.unlock('allRequests');
    if (goldenDone) this.unlock('golden');
    if (context.raining) this.unlock('rainBury');
    if (context.riding) this.unlock('riderBury');
    if (this.picks >= PERK_MILESTONES_CM.length) this.unlock('fullPower');
    this.checkBallContents(diameterCm);
    this.checkProgressGoals(false);
    const pass: PassGain | null =
      passDef && passEarned ? { season: passDef.id, ...passEarned, tierBefore, tierAfter: this.passView(passDef).tier } : null;
    this.persist();
    this.emit();
    return { food, keptFood, requestsDone: done.length, goldenDone, discovered, stored, meal, introduceBurrow, pass };
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
    this.raisePassCounter('feast', foods.length);
    this.persist();
    this.emit();
    return meal;
  }

  /**
   * Online: outro jogador enterrou uma bola que tinha a sua bola doada dentro.
   * A sua parte da comida vem pra despensa (ou é comida na hora, se ela estiver
   * cheia). Não conta como enterro seu (nem recorde, nem ranking).
   */
  receiveShare(diameterCm: number, food: number): ShareOutcome | null {
    const amount = Math.round(Math.max(0, Math.min(food, 5000)));
    if (amount <= 0) return null;
    let stored = true;
    let meal: MealResult | null = null;
    if (this.save.pantry.length < PANTRY_CAPACITY) this.save.pantry.push({ cm: Math.round(Math.max(0, Math.min(diameterCm, 30)) * 10) / 10, food: amount });
    else {
      stored = false;
      meal = this.feed([amount]);
    }
    this.persist();
    this.emit();
    return { food: amount, stored, meal };
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

  /** Soma experiência e confere as conquistas de nível (que também pagam XP). Cada nível novo dá um baú. */
  private grantXp(xp: number, silent = false): XpGain {
    const levelBefore = this.info.level;
    this.save.xp = Math.min(1e9, this.save.xp + xp);
    this.info = levelInfo(this.save.xp);
    const levelAfter = this.info.level;
    const unlocked: PerkId[] = [];
    const chests: Rarity[] = [];
    for (let level = levelBefore + 1; level <= levelAfter; level++) {
      unlocked.push(...perksUnlockedAt(level));
      chests.push(levelChestRarity(level));
    }
    if (levelAfter > levelBefore) this.chestCache = null;
    for (const [id, goal] of LEVEL_GOALS) if (levelAfter >= goal) this.unlock(id, silent);
    return { levelBefore, levelAfter, unlocked, looks: looksUnlockedByLevels(levelBefore, levelAfter), chests };
  }

  /**
   * Faz uma conquista (uma vez só): guarda, paga o XP (e as moedas) e avisa.
   * `silent` é pra dar ao jogador antigo o que ele já tinha feito antes delas
   * existirem (sem aviso e sem XP de passe).
   */
  private unlock(id: AchievementId, silent = false): void {
    if (this.save.achievements.includes(id)) return;
    this.save.achievements.push(id);
    this.walletCache = null;
    const { reward } = achievement(id);
    if (!silent) this.addPassXp(PASS_XP_ACHIEVEMENT);
    const gain = this.grantXp(reward, silent);
    this.persist();
    this.emit();
    // O que já tinha sido achado no jardim não é "visual novo" de novo.
    const looks = [...looksUnlockedBy(id), ...gain.looks].filter((look) => look.kind !== 'acc' || !this.save.found.includes(look.id));
    if (!silent) this.onAchievement?.({ id, reward, pay: achievementPay(id), ...gain, looks });
  }

  // --- derivados da economia e do passe --------------------------------------------------

  /** Visuais ganhos por compra, baú ou prêmio do passe. */
  private ownedLooks(): Set<LookKey> {
    if (this.ownedCache) return this.ownedCache;
    const owned = new Set<LookKey>();
    for (const key of Object.keys(this.save.economy.purchases)) {
      const look = key.startsWith('look:') ? key.slice(5) : '';
      if (isLookKey(look)) owned.add(look);
    }
    for (const result of Object.values(this.save.economy.opened)) if (result.look) owned.add(result.look);
    for (const reward of this.claimedPassRewards()) if ('look' in reward) owned.add(reward.look);
    return (this.ownedCache = owned);
  }

  /** Todos os prêmios de passe já pegos, de todas as temporadas. */
  private claimedPassRewards(): PassReward[] {
    const rewards: PassReward[] = [];
    for (const [id, pass] of Object.entries(this.save.passes) as Array<[SeasonId, PassState]>) {
      const def = season(id);
      for (const tier of pass.claimed) rewards.push(...tierRewards(def, tier));
    }
    return rewards;
  }

  /** Passe da temporada no save (cria vazio na primeira vez). */
  private passState(id: SeasonId): PassState {
    let state = this.save.passes[id];
    if (!state) state = this.save.passes[id] = emptyPass();
    return state;
  }

  /** XP jogando + o dos desafios cumpridos. */
  private passTotalXp(def: SeasonDef, state: PassState): number {
    let total = state.xp;
    for (const c of def.challenges) if (state.counters[c.counter] >= c.goal) total += c.xp;
    return total;
  }

  /** Soma XP no passe da temporada valendo (se houver). */
  private addPassXp(xp: number): void {
    const def = this.activeSeason;
    if (!def || xp <= 0) return;
    const state = this.passState(def.id);
    state.xp = Math.min(1e7, state.xp + xp);
  }

  /** Soma num contador da temporada valendo (só na memória: vai pro disco no próximo salvamento). */
  private bumpPassCounter(counter: PassCounter, amount: number): void {
    const def = this.activeSeason;
    if (!def) return;
    const counters = this.passState(def.id).counters;
    counters[counter] = Math.min(1e9, counters[counter] + amount);
  }

  /** Recorde da temporada (maior bola, maior banquete). */
  private raisePassCounter(counter: PassCounter, value: number): void {
    const def = this.activeSeason;
    if (!def) return;
    const counters = this.passState(def.id).counters;
    counters[counter] = Math.max(counters[counter], value);
  }

  /** Enterro na temporada: XP (com o bônus do primeiro do dia) e os contadores dos desafios. */
  private passForBurial(def: SeasonDef, diameterCm: number, done: readonly RoundRequest[], raining: boolean): { xp: number; daily: boolean } {
    const state = this.passState(def.id);
    const counters = state.counters;
    const golden = done.filter((r) => r.golden).length;
    let xp = passXpForBurial(diameterCm) + done.length * PASS_XP_REQUEST + golden * PASS_XP_GOLDEN_EXTRA;
    const today = localDay(this.now());
    const daily = state.lastDay !== today;
    if (daily) {
      xp += PASS_XP_DAILY;
      state.lastDay = today;
      counters.days += 1;
    }
    state.xp = Math.min(1e7, state.xp + xp);
    counters.buried += 1;
    counters.bigBall = Math.max(counters.bigBall, Math.round(diameterCm * 10) / 10);
    counters.requests += done.length;
    counters.golden += golden;
    counters.flowers += this.ledger.sum(FLOWER_IDS);
    counters.critters += this.ledger.sum(CRITTER_IDS);
    if (raining) counters.rainBury += 1;
    return { xp, daily };
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
    // Qualquer mudança pode mexer no que é derivado do save.
    this.walletCache = null;
    this.ownedCache = null;
    this.chestCache = null;
    for (const listener of this.listeners) listener();
  }
}
