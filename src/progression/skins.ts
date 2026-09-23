import type { AchievementId } from './achievements';

/**
 * Cascos do besouro: só aparência, nenhum dá vantagem. Cada um vem de uma
 * espécie (ou do mito) de verdade e é liberado por uma conquista.
 *
 * As cores descrevem o casco inteiro: élitros (as "asas" duras), pronoto (o
 * escudo do tórax, que também pinta a cabeça), barriga, patas e o quanto ele
 * brilha furta-cor. O degradê (borda mais escura) é sombra assada no modelo.
 */

export type SkinId = 'indigo' | 'sacred' | 'bronze' | 'rainbow' | 'amazon' | 'moon' | 'khepri';

export interface SkinDef {
  readonly id: SkinId;
  /** Conquista que libera (sem = livre desde o começo). */
  readonly unlock?: AchievementId;
  /** Élitros (a cor do topo; a borda escurece sozinha). */
  readonly elytra: string;
  /** Pronoto e cabeça (alguns rola-bostas têm o tórax de outra cor). */
  readonly pronotum: string;
  readonly belly: string;
  readonly leg: string;
  /** Brilho furta-cor (0..1). */
  readonly iridescence: number;
  /** Aspereza do verniz (menor = mais espelhado, cara de metal). */
  readonly roughness: number;
}

export const SKINS: readonly SkinDef[] = [
  {
    // O de sempre: índigo, a cor do menu.
    id: 'indigo',
    elytra: '#3d3689',
    pronotum: '#3d3689',
    belly: '#211d45',
    leg: '#352a4d',
    iridescence: 0.85,
    roughness: 0.4,
  },
  {
    // Scarabaeus sacer, o escaravelho sagrado do Egito: preto acetinado.
    id: 'sacred',
    unlock: 'bury10',
    elytra: '#3a3638',
    pronotum: '#3a3638',
    belly: '#1a1718',
    leg: '#2a2527',
    iridescence: 0.25,
    roughness: 0.5,
  },
  {
    // Kheper: bronze esverdeado metálico.
    id: 'bronze',
    unlock: 'level5',
    elytra: '#8a6b34',
    pronotum: '#7d7a3a',
    belly: '#2e2413',
    leg: '#4a3a22',
    iridescence: 0.7,
    roughness: 0.32,
  },
  {
    // Phanaeus, o "besouro-arco-íris": élitros verdes e pronoto cobre.
    id: 'rainbow',
    unlock: 'catalog30',
    elytra: '#3fa65a',
    pronotum: '#d9793a',
    belly: '#1d3324',
    leg: '#2b4a33',
    iridescence: 1,
    roughness: 0.28,
  },
  {
    // Coprophanaeus, o rola-bosta grandão da Amazônia: azul-violeta metálico.
    id: 'amazon',
    unlock: 'size24',
    elytra: '#3f6fd8',
    pronotum: '#5a54d6',
    belly: '#171c42',
    leg: '#27306a',
    iridescence: 1,
    roughness: 0.26,
  },
  {
    // Prateado da madrugada, pra quem cumpre o pedido do Sol.
    id: 'moon',
    unlock: 'golden',
    elytra: '#c9d0e6',
    pronotum: '#dfe3f2',
    belly: '#3b3f57',
    leg: '#565b78',
    iridescence: 0.9,
    roughness: 0.3,
  },
  {
    // Khepri, o deus-escaravelho que rola o sol: dourado.
    id: 'khepri',
    unlock: 'size30',
    elytra: '#f2c14e',
    pronotum: '#ffd66b',
    belly: '#5a3a0e',
    leg: '#7a5418',
    iridescence: 0.8,
    roughness: 0.25,
  },
];

const IDS = new Set<string>(SKINS.map((skin) => skin.id));
const BY_ID = new Map<SkinId, SkinDef>(SKINS.map((skin) => [skin.id, skin]));

export const DEFAULT_SKIN: SkinId = 'indigo';

export function isSkinId(value: string): value is SkinId {
  return IDS.has(value);
}

export function skin(id: SkinId): SkinDef {
  return BY_ID.get(id)!;
}

/** Cascos que a conquista `id` libera (pra avisar na hora). */
export function skinsUnlockedBy(id: AchievementId): SkinId[] {
  return SKINS.filter((s) => s.unlock === id).map((s) => s.id);
}
