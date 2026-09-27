import { ACCESSORIES, type AccessoryDef, type AccessoryId } from './accessories';
import type { Rarity } from './unlocks';

/**
 * Achado raro: de vez em quando um acessório que o jogador ainda não tem
 * aparece brilhando em algum canto do jardim; passar por cima pega e libera
 * (além do jeito normal, por conquista ou nível). Cascos não aparecem: eles
 * continuam só pelo caminho de sempre.
 *
 * Um sorteio por jardim. Se o jardim trocar (a bola foi enterrada) antes de
 * alguém pegar, o achado some junto: é raro de verdade.
 */

/** Chance de um jardim ter um achado (uma vez por jardim). */
export const RARE_FIND_CHANCE = 0.2;

/** Peso de cada raridade no sorteio: comum aparece bem mais que lendário. */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 6, rare: 3, epic: 1.4, legendary: 0.5 };

/**
 * Pode aparecer no jardim? Os de conquista/nível e os da Feirinha em moedas.
 * Exclusivos (do passe, de baú) e os de orvalho nunca: perderiam a graça.
 */
export function isFindable(def: AccessoryDef): boolean {
  const unlock = def.unlock;
  return 'achievement' in unlock || 'level' in unlock || ('shop' in unlock && 'coins' in unlock.shop);
}

/**
 * Sorteia o achado de um jardim entre os acessórios ainda trancados (null =
 * esse jardim não tem, ou não sobrou nada pra achar). `random` devolve 0..1.
 */
export function rollRareFind(isOwned: (id: AccessoryId) => boolean, random: () => number): AccessoryId | null {
  if (random() >= RARE_FIND_CHANCE) return null;
  const pool: AccessoryDef[] = ACCESSORIES.filter((a) => isFindable(a) && !isOwned(a.id));
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, a) => sum + RARITY_WEIGHT[a.rarity], 0);
  let pick = random() * total;
  for (const a of pool) {
    pick -= RARITY_WEIGHT[a.rarity];
    if (pick <= 0) return a.id;
  }
  return pool[pool.length - 1].id;
}
