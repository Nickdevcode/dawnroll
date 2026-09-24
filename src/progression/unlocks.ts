import type { AchievementId } from './achievements';

/**
 * O que os visuais (cascos e acessórios) têm em comum: a raridade (só muda o
 * selo e o brilho do cartão no guarda-roupa) e o jeito de liberar — uma
 * conquista ou chegar num nível. Nada disso dá vantagem no jogo.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Como um visual é liberado. Sem `Unlock` = livre desde o começo. */
export type Unlock = { readonly achievement: AchievementId } | { readonly level: number };

/** O que a regra de liberação precisa saber do progresso. */
export interface UnlockProgress {
  readonly level: number;
  hasAchievement(id: AchievementId): boolean;
}

export function isUnlockMet(unlock: Unlock | undefined, progress: UnlockProgress): boolean {
  if (!unlock) return true;
  return 'level' in unlock ? progress.level >= unlock.level : progress.hasAchievement(unlock.achievement);
}

/** Visuais liberados por uma conquista, entre os `defs` dados. */
export function unlockedByAchievement<T extends { readonly unlock?: Unlock }>(defs: readonly T[], id: AchievementId): T[] {
  return defs.filter((def) => def.unlock !== undefined && 'achievement' in def.unlock && def.unlock.achievement === id);
}

/** Visuais liberados ao passar do nível `from` (exclusivo) até `to` (inclusivo). */
export function unlockedByLevels<T extends { readonly unlock?: Unlock }>(defs: readonly T[], from: number, to: number): T[] {
  return defs.filter((def) => def.unlock !== undefined && 'level' in def.unlock && def.unlock.level > from && def.unlock.level <= to);
}
