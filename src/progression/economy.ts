import { achievement, type AchievementId } from './achievements';
import { ALL_LOOKS, lookKey, lookRarity, lookUnlock, type Look, type LookKey } from './looks';
import { RARITIES, type Currency, type Rarity } from './unlocks';

/**
 * Economia do jogo: as duas moedas, o que cada conquista paga e os baús.
 *
 * - **Moedas**: as de todo dia. Compram a maior parte da Feirinha.
 * - **Gotas de orvalho**: as raras (o "diamante" do jardim ao amanhecer).
 *   Compram os visuais mais raros e baús melhores.
 *
 * Nada se ganha no mapa: as moedas vêm das conquistas, dos baús (cada nível
 * novo dá um) e do passe da temporada.
 *
 * O saldo nunca fica guardado como número solto: ele é CALCULADO a partir do
 * que está no save (conquistas feitas, baús abertos, prêmios do passe pegos,
 * compras). Por isso quem já jogava antes das moedas existirem ganha tudo de
 * uma vez (as conquistas antigas pagam), e juntar o save de dois aparelhos
 * nunca "devolve" dinheiro gasto: é só unir as listas.
 */

export interface Wallet {
  coins: number;
  dew: number;
}

export const emptyWallet = (): Wallet => ({ coins: 0, dew: 0 });

/** Quanto foi pago numa compra (guardado junto, pra mudança de preço não mexer no passado). */
export interface Paid {
  coins: number;
  dew: number;
}

/** Moedas por ponto de XP da conquista (a de 10 XP paga 15; a de 250, 375). */
const COINS_PER_XP = 1.5;
/** XP de conquista por gota de orvalho (as fáceis não pagam orvalho). */
const XP_PER_DEW = 20;
/** Conquista secreta paga um pouquinho de orvalho a mais (achar ela é a graça). */
const SECRET_DEW_BONUS = 3;

const round5 = (value: number) => Math.round(value / 5) * 5;

/** O que uma conquista paga em moedas e orvalho (além do XP de sempre). */
export function achievementPay(id: AchievementId): Wallet {
  const def = achievement(id);
  return {
    coins: round5(def.reward * COINS_PER_XP),
    dew: Math.floor(def.reward / XP_PER_DEW) + (def.group === 'secret' ? SECRET_DEW_BONUS : 0),
  };
}

// --- baús ------------------------------------------------------------------------

/** O que um baú da raridade pode dar. */
interface ChestSpec {
  /** Moedas (mínimo, máximo). */
  readonly coins: readonly [number, number];
  /** Chance de vir orvalho (0..1) e quanto. */
  readonly dewChance: number;
  readonly dew: readonly [number, number];
  /** Chance de vir um visual e de que raridades ele pode ser. */
  readonly itemChance: number;
  readonly itemRarities: readonly Rarity[];
  /** Sorteou visual mas o jogador já tem todos os possíveis: vira moedas. */
  readonly spareCoins: number;
}

export const CHESTS: Readonly<Record<Rarity, ChestSpec>> = {
  common: { coins: [40, 80], dewChance: 0.25, dew: [1, 3], itemChance: 0.03, itemRarities: ['common', 'rare'], spareCoins: 120 },
  rare: { coins: [120, 200], dewChance: 0.6, dew: [3, 8], itemChance: 0.08, itemRarities: ['common', 'rare', 'epic'], spareCoins: 300 },
  epic: { coins: [300, 450], dewChance: 1, dew: [10, 20], itemChance: 0.22, itemRarities: ['rare', 'epic', 'legendary'], spareCoins: 600 },
  legendary: { coins: [700, 1000], dewChance: 1, dew: [30, 50], itemChance: 0.6, itemRarities: ['epic', 'legendary'], spareCoins: 1200 },
};

/** Baús à venda na Feirinha (só com orvalho: é o "atalho" dos raros). */
export const CHEST_PRICES: Readonly<Record<Exclude<Rarity, 'common'>, number>> = { rare: 25, epic: 70, legendary: 180 };
export const SHOP_CHESTS = ['rare', 'epic', 'legendary'] as const;
export type ShopChest = (typeof SHOP_CHESTS)[number];

/** De onde veio um baú. */
export type ChestSource = 'level' | 'pass' | 'shop';

/** Baú esperando pra ser aberto. `key` é única e estável (a mesma em qualquer aparelho). */
export interface ChestGrant {
  key: string;
  rarity: Rarity;
  source: ChestSource;
}

/** O que saiu de um baú aberto (guardado no save). */
export interface ChestResult {
  rarity: Rarity;
  coins: number;
  dew: number;
  look: LookKey | null;
}

/** Um prêmio da cerimônia: o baú entrega um por vez. */
export type ChestReward = { kind: 'coins'; amount: number } | { kind: 'dew'; amount: number } | { kind: 'look'; look: LookKey };

/** A ordem em que o baú entrega: moedas, orvalho e, por último, o visual (o melhor fica pro fim). */
export function chestRewards(result: ChestResult): ChestReward[] {
  const rewards: ChestReward[] = [{ kind: 'coins', amount: result.coins }];
  if (result.dew > 0) rewards.push({ kind: 'dew', amount: result.dew });
  if (result.look) rewards.push({ kind: 'look', look: result.look });
  return rewards;
}

/** Raridade do baú de cada nível: a cada 5 um de prata, a cada 10 um de cristal, a cada 25 o do Sol. */
export function levelChestRarity(level: number): Rarity {
  if (level % 25 === 0) return 'legendary';
  if (level % 10 === 0) return 'epic';
  if (level % 5 === 0) return 'rare';
  return 'common';
}

export const levelChestKey = (level: number) => `lvl:${level}`;
export const passChestKey = (season: string, tier: number) => `pass:${season}:${tier}`;

/** Chave de um baú comprado agora (única: hora + sorteio). */
export function newShopChestKey(rarity: ShopChest, now: number, random: () => number): string {
  return `chest:${rarity}:${now.toString(36)}${Math.floor(random() * 0x10000).toString(36)}`;
}

/** Raridade de um baú comprado pela chave dele (`chest:<raridade>:...`), ou null se a chave não é de compra. */
export function shopChestRarity(key: string): ShopChest | null {
  const match = /^chest:(rare|epic|legendary):[a-z0-9]{1,24}$/.exec(key);
  return match ? (match[1] as ShopChest) : null;
}

export const lookPurchaseKey = (look: Look) => `look:${lookKey(look)}`;

// --- sorteio ------------------------------------------------------------------------

/** Hash FNV-1a de 32 bits (semente do baú a partir da chave dele). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Gerador pequeno e bom o bastante (mulberry32): 0..1. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random: () => number, [min, max]: readonly [number, number]) => min + Math.floor(random() * (max - min + 1));

/** Peso de cada raridade no sorteio do visual (dentro das que o baú permite). */
const ITEM_WEIGHT: Record<Rarity, number> = { common: 6, rare: 3, epic: 1.4, legendary: 0.6 };
/** Os exclusivos de baú saem mais que o resto (é o motivo de abrir baú). */
const CHEST_EXCLUSIVE_WEIGHT = 3;

/**
 * Visuais que podem sair de baú: os exclusivos de baú e os que se liberam de
 * outro jeito (conquista, nível, Feirinha). Os do passe NÃO saem: são da
 * temporada.
 */
function canDropFromChest(look: Look): boolean {
  const unlock = lookUnlock(look);
  return unlock !== undefined && !('pass' in unlock);
}

/**
 * Abre um baú: sempre moedas, às vezes orvalho e raramente um visual que o
 * jogador ainda não tem. O sorteio sai da semente do save + a chave do baú: o
 * mesmo baú dá a mesma coisa em qualquer aparelho (e recarregar a página não
 * sorteia de novo).
 */
export function rollChest(rarity: Rarity, key: string, seed: number, isOwned: (look: Look) => boolean): ChestResult {
  const spec = CHESTS[rarity];
  const random = mulberry32(hashString(`${seed}:${key}`));
  let coins = between(random, spec.coins);
  const dew = random() < spec.dewChance ? between(random, spec.dew) : 0;
  let look: LookKey | null = null;
  if (random() < spec.itemChance) {
    const pool = ALL_LOOKS.filter((l) => canDropFromChest(l) && spec.itemRarities.includes(lookRarity(l)) && !isOwned(l));
    if (pool.length === 0) {
      coins += spec.spareCoins;
    } else {
      const weight = (l: Look) => ITEM_WEIGHT[lookRarity(l)] * (lookUnlock(l) && 'chest' in lookUnlock(l)! ? CHEST_EXCLUSIVE_WEIGHT : 1);
      const total = pool.reduce((sum, l) => sum + weight(l), 0);
      let pick = random() * total;
      let chosen = pool[pool.length - 1];
      for (const l of pool) {
        pick -= weight(l);
        if (pick <= 0) {
          chosen = l;
          break;
        }
      }
      look = lookKey(chosen);
    }
  }
  return { rarity, coins, dew, look };
}

/** Semente nova pro save (uma vez só por jogador). Nunca 0 (0 = "ainda não tem"). */
export function newEconomySeed(random: () => number = Math.random): number {
  return (Math.floor(random() * 0xfffffffe) + 1) >>> 0;
}

/** Ordem das raridades (pra ordenar baús e visuais). */
export const rarityRank = (rarity: Rarity) => RARITIES.indexOf(rarity);

/** A carteira tem o bastante? */
export const canPay = (wallet: Wallet, currency: Currency, amount: number) => wallet[currency] >= amount;
