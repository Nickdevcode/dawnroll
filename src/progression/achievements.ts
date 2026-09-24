/**
 * Conquistas: feitos permanentes que ficam na toca e pagam experiência uma vez
 * só (o XP da recompensa ajuda a subir de nível — é a "aplicação" delas). Várias
 * também liberam um visual novo pro besouro (casco em `skins.ts`, acessório em
 * `accessories.ts`).
 *
 * Os marcos de tamanho são os mesmos avisos da rodada ("Bola respeitável",
 * "Terror do jardim"...): na rodada eles voltam toda vez, mas a primeira vez
 * que a bola chega lá vira conquista.
 *
 * As do grupo `secret` aparecem como "???" até serem feitas (a graça é descobrir).
 */

export type AchievementGroup = 'size' | 'burrow' | 'garden' | 'collection' | 'mastery' | 'secret';

export type AchievementId =
  // Tamanho
  | 'size3'
  | 'size5'
  | 'size8'
  | 'size12'
  | 'size16'
  | 'size20'
  | 'size24'
  | 'size30'
  // Toca
  | 'firstBury'
  | 'bury10'
  | 'bury50'
  | 'bury100'
  | 'feast'
  | 'level5'
  | 'level10'
  | 'level15'
  | 'level20'
  // Jardim
  | 'allRequests'
  | 'log'
  | 'fresh10'
  | 'rainBury'
  | 'gnome'
  | 'flipflop'
  | 'fourLeaf'
  | 'hummingbird'
  | 'swarm'
  | 'stickInsect'
  | 'underRock'
  | 'web10'
  | 'marathon'
  // Coleção (o que vai dentro de UMA bola)
  | 'bouquet'
  | 'zoo'
  | 'rainbow'
  | 'picnic'
  | 'toys'
  | 'catalog10'
  | 'catalog30'
  | 'catalogAll'
  | 'fashion'
  // Poderes e pedidos
  | 'fullPower'
  | 'allPerks'
  | 'doubleStar'
  | 'riderBury'
  | 'golden'
  | 'requests50'
  | 'rodeo'
  | 'fever'
  // Secretas
  | 'melted'
  | 'purist'
  | 'onTop'
  | 'edge';

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
  { id: 'size30', cm: 30, name: 'milestone.8' },
];

const SIZE_REWARDS = [10, 15, 20, 30, 40, 60, 100, 180];

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...SIZE_MILESTONES.map(({ id, cm }, i) => ({ id, group: 'size' as const, reward: SIZE_REWARDS[i], cm })),
  { id: 'firstBury', group: 'burrow', reward: 10 },
  { id: 'bury10', group: 'burrow', reward: 40 },
  { id: 'bury50', group: 'burrow', reward: 120 },
  { id: 'bury100', group: 'burrow', reward: 200 },
  { id: 'feast', group: 'burrow', reward: 40 },
  { id: 'level5', group: 'burrow', reward: 50 },
  { id: 'level10', group: 'burrow', reward: 100 },
  { id: 'level15', group: 'burrow', reward: 150 },
  { id: 'level20', group: 'burrow', reward: 250 },
  { id: 'allRequests', group: 'garden', reward: 30 },
  { id: 'log', group: 'garden', reward: 30 },
  { id: 'fresh10', group: 'garden', reward: 40 },
  { id: 'rainBury', group: 'garden', reward: 30 },
  { id: 'gnome', group: 'garden', reward: 100 },
  { id: 'flipflop', group: 'garden', reward: 50 },
  { id: 'fourLeaf', group: 'garden', reward: 40 },
  { id: 'hummingbird', group: 'garden', reward: 40 },
  { id: 'swarm', group: 'garden', reward: 50 },
  { id: 'stickInsect', group: 'garden', reward: 50 },
  { id: 'underRock', group: 'garden', reward: 30 },
  { id: 'web10', group: 'garden', reward: 40 },
  { id: 'marathon', group: 'garden', reward: 80 },
  { id: 'bouquet', group: 'collection', reward: 40 },
  { id: 'zoo', group: 'collection', reward: 60 },
  { id: 'rainbow', group: 'collection', reward: 50 },
  { id: 'picnic', group: 'collection', reward: 60 },
  { id: 'toys', group: 'collection', reward: 50 },
  { id: 'catalog10', group: 'collection', reward: 30 },
  { id: 'catalog30', group: 'collection', reward: 60 },
  { id: 'catalogAll', group: 'collection', reward: 250 },
  { id: 'fashion', group: 'collection', reward: 40 },
  { id: 'fullPower', group: 'mastery', reward: 30 },
  { id: 'allPerks', group: 'mastery', reward: 80 },
  { id: 'doubleStar', group: 'mastery', reward: 30 },
  { id: 'riderBury', group: 'mastery', reward: 50 },
  { id: 'golden', group: 'mastery', reward: 60 },
  { id: 'requests50', group: 'mastery', reward: 80 },
  { id: 'rodeo', group: 'mastery', reward: 60 },
  { id: 'fever', group: 'mastery', reward: 40 },
  { id: 'melted', group: 'secret', reward: 30 },
  { id: 'purist', group: 'secret', reward: 40 },
  { id: 'onTop', group: 'secret', reward: 30 },
  { id: 'edge', group: 'secret', reward: 20 },
];

export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = ['size', 'burrow', 'garden', 'collection', 'mastery', 'secret'];

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
  ['bury100', 100],
];

/** Nível → conquista. */
export const LEVEL_GOALS: ReadonlyArray<[AchievementId, number]> = [
  ['level5', 5],
  ['level10', 10],
  ['level15', 15],
  ['level20', 20],
];

/** Figurinhas descobertas → conquista (o total vem do catálogo). */
export const CATALOG_GOALS: ReadonlyArray<[AchievementId, number]> = [
  ['catalog10', 10],
  ['catalog30', 30],
];
/** Montinhos fresquinhos enterrados no total. */
export const FRESH_GOAL = 10;
/** Banquete que conta: bolas comidas de uma vez (o bônus máximo, +50%). */
export const FEAST_GOAL = 6;
/** Teias rasgadas no total. */
export const WEB_GOAL = 10;
/** Pedidos cumpridos no total. */
export const REQUESTS_GOAL = 50;
/** Segundos em cima da bola (Equilibrista), somando todas as rodadas. */
export const RODEO_SECONDS = 60;
/** Distância que a bola rolou no total, em unidades do mundo (1 u ≈ 2 cm: 5000 u = 100 m). */
export const MARATHON_UNITS = 5000;
/** Tipos de bicho diferentes numa bola só. */
export const ZOO_GOAL = 5;
/** Cores diferentes numa bola só. */
export const RAINBOW_GOAL = 6;
/** Brinquedos diferentes numa bola só. */
export const TOYS_GOAL = 4;
/** Tamanho mínimo (cm) da bola "pura" (só bosta, nada grudado). */
export const PURIST_CM = 8;
/** Enterrar "no limite": abaixo deste diâmetro (cm). O mínimo pra enterrar é 3 cm. */
export const EDGE_CM = 3.2;
