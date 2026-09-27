import type { AchievementId } from './achievements';

/**
 * O que os visuais (cascos e acessórios) têm em comum: a raridade (só muda o
 * selo e o brilho do cartão no guarda-roupa) e o jeito de liberar. Nada disso
 * dá vantagem no jogo.
 *
 * Jeitos de liberar:
 * - `achievement` / `level`: fazer a conquista ou chegar no nível (liberam sozinhos);
 * - `shop`: comprar na Feirinha, com moedas ou gotas de orvalho;
 * - `pass`: prêmio de um nível do passe de uma temporada (exclusivo dela);
 * - `chest`: só sai de baú.
 *
 * Os três últimos não se cumprem sozinhos: o visual fica com o jogador quando
 * a compra, o prêmio ou o baú entram no save (ver `Progression.isLookOwned`).
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** As duas moedas do jogo: moedas (as de todo dia) e gotas de orvalho (as raras). */
export type Currency = 'coins' | 'dew';

/** Preço na Feirinha: sempre numa moeda só. */
export type Price = { readonly coins: number } | { readonly dew: number };

/** Identificador de temporada do passe (ver `seasons.ts`). */
export type SeasonId = 'florada';

/** Como um visual é liberado. Sem `Unlock` = livre desde o começo. */
export type Unlock =
  | { readonly achievement: AchievementId }
  | { readonly level: number }
  | { readonly shop: Price }
  | { readonly pass: SeasonId }
  | { readonly chest: true };

/** O que a regra de liberação precisa saber do progresso. */
export interface UnlockProgress {
  readonly level: number;
  hasAchievement(id: AchievementId): boolean;
}

/**
 * A regra "sozinha" está cumprida? Loja, passe e baú nunca estão: dependem de
 * a compra/o prêmio estar no save.
 */
export function isUnlockMet(unlock: Unlock | undefined, progress: UnlockProgress): boolean {
  if (!unlock) return true;
  if ('level' in unlock) return progress.level >= unlock.level;
  if ('achievement' in unlock) return progress.hasAchievement(unlock.achievement);
  return false;
}

/** Moeda e valor de um preço. */
export function priceParts(price: Price): { currency: Currency; amount: number } {
  return 'coins' in price ? { currency: 'coins', amount: price.coins } : { currency: 'dew', amount: price.dew };
}

/** Visuais liberados por uma conquista, entre os `defs` dados. */
export function unlockedByAchievement<T extends { readonly unlock?: Unlock }>(defs: readonly T[], id: AchievementId): T[] {
  return defs.filter((def) => def.unlock !== undefined && 'achievement' in def.unlock && def.unlock.achievement === id);
}

/** Visuais liberados ao passar do nível `from` (exclusivo) até `to` (inclusivo). */
export function unlockedByLevels<T extends { readonly unlock?: Unlock }>(defs: readonly T[], from: number, to: number): T[] {
  return defs.filter((def) => def.unlock !== undefined && 'level' in def.unlock && def.unlock.level > from && def.unlock.level <= to);
}
