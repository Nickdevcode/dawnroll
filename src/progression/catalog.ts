import type { DebrisMaterial } from '../world/Collectibles';
import type { PickableKind } from '../world/scenery/context';

/**
 * Catálogo da toca: tudo que pode acabar dentro de uma bola enterrada. Cada
 * entrada é uma "figurinha" — a primeira vez que ela desce pra toca, entra no
 * catálogo; depois só conta quantas já foram. É a meta de colecionar (como na
 * série Katamari), e não dá poder nenhum.
 */

export type CatalogGroup = 'dung' | 'garden' | 'debris' | 'critters';

export type CatalogId =
  | 'dung'
  | 'freshDung'
  | 'daisy'
  | 'tulip'
  | 'bell'
  | 'dandelion'
  | 'cloverFlower'
  | 'amanita'
  | 'orangeCap'
  | 'pinkCap'
  | 'porcini'
  | 'violetCap'
  | 'rock'
  | 'log'
  | 'pebble'
  | 'twig'
  | 'leaf'
  | 'berry'
  | 'seed'
  | 'acorn'
  | 'clover'
  | 'petal'
  | 'shell'
  | 'cap'
  | 'pillbug';

/** Forma do ícone (desenhado em `ui/gameIcons.ts`); a cor vem da entrada. */
export type CatalogShape =
  | 'dung'
  | 'daisy'
  | 'tulip'
  | 'bell'
  | 'dandelion'
  | 'cloverFlower'
  | 'mushroomDots'
  | 'mushroom'
  | 'rock'
  | 'log'
  | 'pebble'
  | 'twig'
  | 'leaf'
  | 'berry'
  | 'seed'
  | 'acorn'
  | 'clover'
  | 'petal'
  | 'shell'
  | 'cap'
  | 'pillbug';

export interface CatalogEntry {
  readonly id: CatalogId;
  readonly group: CatalogGroup;
  readonly shape: CatalogShape;
  /** Cor principal da figurinha. */
  readonly color: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  { id: 'dung', group: 'dung', shape: 'dung', color: '#7b4c2a' },
  { id: 'freshDung', group: 'dung', shape: 'dung', color: '#c98a3c' },

  { id: 'daisy', group: 'garden', shape: 'daisy', color: '#f5f0e6' },
  { id: 'tulip', group: 'garden', shape: 'tulip', color: '#e8566a' },
  { id: 'bell', group: 'garden', shape: 'bell', color: '#8f7be0' },
  { id: 'dandelion', group: 'garden', shape: 'dandelion', color: '#f2c230' },
  { id: 'cloverFlower', group: 'garden', shape: 'cloverFlower', color: '#e58fb8' },
  { id: 'amanita', group: 'garden', shape: 'mushroomDots', color: '#d9443c' },
  { id: 'orangeCap', group: 'garden', shape: 'mushroomDots', color: '#e8793a' },
  { id: 'pinkCap', group: 'garden', shape: 'mushroomDots', color: '#d24a73' },
  { id: 'porcini', group: 'garden', shape: 'mushroom', color: '#9a5f38' },
  { id: 'violetCap', group: 'garden', shape: 'mushroom', color: '#8a6fd1' },
  { id: 'rock', group: 'garden', shape: 'rock', color: '#a9a3b6' },
  { id: 'log', group: 'garden', shape: 'log', color: '#8f6444' },

  { id: 'pebble', group: 'debris', shape: 'pebble', color: '#b8b0a4' },
  { id: 'twig', group: 'debris', shape: 'twig', color: '#8f6444' },
  { id: 'leaf', group: 'debris', shape: 'leaf', color: '#7fbf55' },
  { id: 'berry', group: 'debris', shape: 'berry', color: '#e8434f' },
  { id: 'seed', group: 'debris', shape: 'seed', color: '#5a4a44' },
  { id: 'acorn', group: 'debris', shape: 'acorn', color: '#b77a3e' },
  { id: 'clover', group: 'debris', shape: 'clover', color: '#76b94f' },
  { id: 'petal', group: 'debris', shape: 'petal', color: '#ff9fc4' },
  { id: 'shell', group: 'debris', shape: 'shell', color: '#d9a878' },
  { id: 'cap', group: 'debris', shape: 'cap', color: '#2f7fd6' },

  { id: 'pillbug', group: 'critters', shape: 'pillbug', color: '#7d7a8c' },
];

export const CATALOG_GROUPS: readonly CatalogGroup[] = ['dung', 'garden', 'debris', 'critters'];

const IDS = new Set<string>(CATALOG.map((entry) => entry.id));
const BY_ID = new Map<CatalogId, CatalogEntry>(CATALOG.map((entry) => [entry.id, entry]));

export function isCatalogId(value: string): value is CatalogId {
  return IDS.has(value);
}

export function catalogEntry(id: CatalogId): CatalogEntry {
  return BY_ID.get(id)!;
}

/** Detrito grudado → figurinha (o tatuzinho do chão também é detrito). */
export function catalogIdForDebris(material: DebrisMaterial): CatalogId {
  return material;
}

/**
 * Arrancável do cenário → figurinha. Flor e cogumelo têm espécie (`variant`);
 * sem espécie conhecida, cai na mais comum do tipo.
 */
export function catalogIdForPickable(kind: PickableKind, variant: string | undefined): CatalogId {
  if (kind === 'rock' || kind === 'log') return kind;
  if (variant && isCatalogId(variant)) return variant;
  return kind === 'flower' ? 'daisy' : 'amanita';
}

/** Figurinhas de um grupo (para requests do tipo "arranque 3 flores"). */
export const FLOWER_IDS: readonly CatalogId[] = ['daisy', 'tulip', 'bell', 'dandelion', 'cloverFlower'];
export const MUSHROOM_IDS: readonly CatalogId[] = ['amanita', 'orangeCap', 'pinkCap', 'porcini', 'violetCap'];
