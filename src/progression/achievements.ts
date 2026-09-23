/**
 * Conquistas: feitos permanentes que ficam na toca e pagam experiência uma vez
 * só (o XP da recompensa ajuda a subir de nível — é a "aplicação" delas).
 *
 * Os marcos de tamanho são os mesmos avisos da rodada ("Bola respeitável",
 * "Terror do jardim"...): na rodada eles voltam toda vez, mas a primeira vez
 * que a bola chega lá vira conquista.
 */

export type AchievementGroup = 'size' | 'burrow' | 'garden' | 'mastery';

export type AchievementId =
  | 'size3'
  | 'size5'
  | 'size8'
  | 'size12'
  | 'size16'
  | 'size20'
  | 'size24'
  | 'firstBury'
  | 'bury10'
  | 'bury50'
  | 'feast'
  | 'level5'
  | 'level10'
  | 'allRequests'
  | 'log'
  | 'fresh10'
  | 'rainBury'
  | 'catalog10'
  | 'catalogAll'
  | 'fullPower'
  | 'allPerks';

export interface AchievementDef {
  readonly id: AchievementId;
  readonly group: AchievementGroup;
  /** Experiência que paga ao ser conquistada. */
  readonly reward: number;
  /** Diâmetro (cm), só nos marcos de tamanho. */
  readonly cm?: number;
}

/** Marcos de tamanho (cm) e o nome de cada um (o mesmo do aviso da rodada). */
export const SIZE_MILESTONES: ReadonlyArray<{ id: AchievementId; cm: number; name: `milestone.${number}` }> = [
  { id: 'size3', cm: 3, name: 'milestone.1' },
  { id: 'size5', cm: 5, name: 'milestone.2' },
  { id: 'size8', cm: 8, name: 'milestone.3' },
  { id: 'size12', cm: 12, name: 'milestone.4' },
  { id: 'size16', cm: 16, name: 'milestone.5' },
  { id: 'size20', cm: 20, name: 'milestone.6' },
  { id: 'size24', cm: 24, name: 'milestone.7' },
];

const SIZE_REWARDS = [10, 15, 20, 30, 40, 60, 100];

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...SIZE_MILESTONES.map(({ id, cm }, i) => ({ id, group: 'size' as const, reward: SIZE_REWARDS[i], cm })),
  { id: 'firstBury', group: 'burrow', reward: 10 },
  { id: 'bury10', group: 'burrow', reward: 40 },
  { id: 'bury50', group: 'burrow', reward: 120 },
  { id: 'feast', group: 'burrow', reward: 40 },
  { id: 'level5', group: 'burrow', reward: 50 },
  { id: 'level10', group: 'burrow', reward: 100 },
  { id: 'allRequests', group: 'garden', reward: 30 },
  { id: 'log', group: 'garden', reward: 30 },
  { id: 'fresh10', group: 'garden', reward: 40 },
  { id: 'rainBury', group: 'garden', reward: 30 },
  { id: 'catalog10', group: 'garden', reward: 30 },
  { id: 'catalogAll', group: 'garden', reward: 150 },
  { id: 'fullPower', group: 'mastery', reward: 30 },
  { id: 'allPerks', group: 'mastery', reward: 60 },
];

export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = ['size', 'burrow', 'garden', 'mastery'];

const IDS = new Set<string>(ACHIEVEMENTS.map((a) => a.id));
const BY_ID = new Map<AchievementId, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function isAchievementId(value: string): value is AchievementId {
  return IDS.has(value);
}

export function achievement(id: AchievementId): AchievementDef {
  return BY_ID.get(id)!;
}

/** Bolas enterradas → conquista. */
export const BURY_GOALS: ReadonlyArray<[AchievementId, number]> = [
  ['firstBury', 1],
  ['bury10', 10],
  ['bury50', 50],
];

/** Nível → conquista. */
export const LEVEL_GOALS: ReadonlyArray<[AchievementId, number]> = [
  ['level5', 5],
  ['level10', 10],
];

/** Figurinhas descobertas → conquista (o total vem do catálogo). */
export const CATALOG_GOAL = 10;
/** Montinhos fresquinhos enterrados no total. */
export const FRESH_GOAL = 10;
/** Banquete que conta: bolas comidas de uma vez (o bônus máximo, +50%). */
export const FEAST_GOAL = 6;
