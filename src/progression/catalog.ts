import type { DebrisMaterial } from '../world/Collectibles';
import type { PickableKind } from '../world/scenery/context';

/**
 * Catálogo da toca: tudo que pode acabar dentro de uma bola enterrada. Cada
 * entrada é uma "figurinha" — a primeira vez que ela desce pra toca, entra no
 * catálogo; depois só conta quantas já foram. É a meta de colecionar (como na
 * série Katamari), e não dá poder nenhum.
 *
 * Cada figurinha também traz uma curiosidade real (texto em `i18n`, chave
 * `fact.<id>`), mostrada quando ela é selecionada no catálogo.
 */

export type CatalogGroup = 'dung' | 'garden' | 'debris' | 'objects' | 'picnic' | 'critters';

export type CatalogId =
  // Bosta
  | 'dung'
  | 'freshDung'
  // Jardim (arrancáveis da natureza)
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
  | 'pinecone'
  | 'apple'
  // Tralha do chão (detritos naturais)
  | 'pebble'
  | 'twig'
  | 'leaf'
  | 'berry'
  | 'seed'
  | 'acorn'
  | 'clover'
  | 'fourLeaf'
  | 'petal'
  | 'shell'
  | 'cicadaShell'
  | 'web'
  // Achados e perdidos (objetos de gente)
  | 'cap'
  | 'button'
  | 'marble'
  | 'coin'
  | 'clip'
  | 'brick'
  | 'die'
  | 'soldier'
  | 'toyCar'
  | 'duck'
  | 'tennisBall'
  | 'pot'
  | 'trowel'
  | 'glove'
  | 'flipflop'
  | 'gnome'
  // Piquenique
  | 'jellybean'
  | 'sugarCube'
  | 'popcorn'
  | 'grape'
  | 'strawberry'
  | 'cookie'
  // Bichos
  | 'pillbug'
  | 'earwig'
  | 'centipede'
  | 'stickInsect'
  | 'caterpillar'
  | 'slug'
  | 'flyingAnt'
  | 'leafBeetle';

/**
 * Forma do ícone (desenhado em `ui/gameIcons.ts`); a cor vem da entrada. As
 * formas antigas continuam com o nome delas; as novas usam o próprio id.
 */
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
  | 'pinecone'
  | 'apple'
  | 'pebble'
  | 'twig'
  | 'leaf'
  | 'berry'
  | 'seed'
  | 'acorn'
  | 'clover'
  | 'fourLeaf'
  | 'petal'
  | 'shell'
  | 'cicadaShell'
  | 'web'
  | 'cap'
  | 'button'
  | 'marble'
  | 'coin'
  | 'clip'
  | 'brick'
  | 'die'
  | 'soldier'
  | 'toyCar'
  | 'duck'
  | 'tennisBall'
  | 'pot'
  | 'trowel'
  | 'glove'
  | 'flipflop'
  | 'gnome'
  | 'jellybean'
  | 'sugarCube'
  | 'popcorn'
  | 'grape'
  | 'strawberry'
  | 'cookie'
  | 'pillbug'
  | 'earwig'
  | 'centipede'
  | 'stickInsect'
  | 'caterpillar'
  | 'slug'
  | 'flyingAnt'
  | 'leafBeetle';

/** Cantinho temático do jardim de onde a coisa vem (pedidos e conquistas por cantinho). */
export type CatalogZone = 'picnic' | 'toys' | 'gardener';

export interface CatalogEntry {
  readonly id: CatalogId;
  readonly group: CatalogGroup;
  readonly shape: CatalogShape;
  /** Cor principal da figurinha. */
  readonly color: string;
  /** Cantinho temático onde ela mora (se tiver). */
  readonly zone?: CatalogZone;
  /** Rara: aparece pouco (o catálogo marca com uma estrelinha quando descoberta). */
  readonly rare?: boolean;
}

export const CATALOG: readonly CatalogEntry[] = [
  { id: 'dung', group: 'dung', shape: 'dung', color: '#7b4c2a' },
  { id: 'freshDung', group: 'dung', shape: 'dung', color: '#c98a3c', rare: true },

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
  { id: 'pinecone', group: 'garden', shape: 'pinecone', color: '#9a6a3f' },
  { id: 'apple', group: 'garden', shape: 'apple', color: '#d9463d' },

  { id: 'pebble', group: 'debris', shape: 'pebble', color: '#b8b0a4' },
  { id: 'twig', group: 'debris', shape: 'twig', color: '#8f6444' },
  { id: 'leaf', group: 'debris', shape: 'leaf', color: '#7fbf55' },
  { id: 'berry', group: 'debris', shape: 'berry', color: '#e8434f' },
  { id: 'seed', group: 'debris', shape: 'seed', color: '#5a4a44' },
  { id: 'acorn', group: 'debris', shape: 'acorn', color: '#b77a3e' },
  { id: 'clover', group: 'debris', shape: 'clover', color: '#76b94f' },
  { id: 'fourLeaf', group: 'debris', shape: 'fourLeaf', color: '#4fae45', rare: true },
  { id: 'petal', group: 'debris', shape: 'petal', color: '#ff9fc4' },
  { id: 'shell', group: 'debris', shape: 'shell', color: '#d9a878' },
  { id: 'cicadaShell', group: 'debris', shape: 'cicadaShell', color: '#c9924a', rare: true },
  { id: 'web', group: 'debris', shape: 'web', color: '#dfe7f2' },

  { id: 'cap', group: 'objects', shape: 'cap', color: '#2f7fd6' },
  { id: 'button', group: 'objects', shape: 'button', color: '#e0765a' },
  { id: 'marble', group: 'objects', shape: 'marble', color: '#56a8e0', zone: 'toys' },
  { id: 'coin', group: 'objects', shape: 'coin', color: '#d9b44a' },
  { id: 'clip', group: 'objects', shape: 'clip', color: '#9fb2c4' },
  { id: 'brick', group: 'objects', shape: 'brick', color: '#e84a3c', zone: 'toys' },
  { id: 'die', group: 'objects', shape: 'die', color: '#f4efe6', zone: 'toys' },
  { id: 'soldier', group: 'objects', shape: 'soldier', color: '#5f8f3a', zone: 'toys' },
  { id: 'toyCar', group: 'objects', shape: 'toyCar', color: '#e5483f', zone: 'toys' },
  { id: 'duck', group: 'objects', shape: 'duck', color: '#f6c93b', zone: 'toys' },
  { id: 'tennisBall', group: 'objects', shape: 'tennisBall', color: '#cfe04a', zone: 'toys' },
  { id: 'pot', group: 'objects', shape: 'pot', color: '#c8704a', zone: 'gardener' },
  { id: 'trowel', group: 'objects', shape: 'trowel', color: '#8fa0ad', zone: 'gardener' },
  { id: 'glove', group: 'objects', shape: 'glove', color: '#e39a3a', zone: 'gardener' },
  { id: 'flipflop', group: 'objects', shape: 'flipflop', color: '#2f8f5a', zone: 'gardener' },
  { id: 'gnome', group: 'objects', shape: 'gnome', color: '#d8433b', zone: 'gardener', rare: true },

  { id: 'jellybean', group: 'picnic', shape: 'jellybean', color: '#f0508a', zone: 'picnic' },
  { id: 'sugarCube', group: 'picnic', shape: 'sugarCube', color: '#f7f3ea', zone: 'picnic' },
  { id: 'popcorn', group: 'picnic', shape: 'popcorn', color: '#f6e3a6', zone: 'picnic' },
  { id: 'grape', group: 'picnic', shape: 'grape', color: '#7b4fb8', zone: 'picnic' },
  { id: 'strawberry', group: 'picnic', shape: 'strawberry', color: '#e5383f', zone: 'picnic' },
  { id: 'cookie', group: 'picnic', shape: 'cookie', color: '#b9773f', zone: 'picnic' },

  { id: 'pillbug', group: 'critters', shape: 'pillbug', color: '#7d7a8c' },
  { id: 'earwig', group: 'critters', shape: 'earwig', color: '#8a4a2c' },
  { id: 'centipede', group: 'critters', shape: 'centipede', color: '#c2622d' },
  { id: 'stickInsect', group: 'critters', shape: 'stickInsect', color: '#8f7a4a', rare: true },
  { id: 'caterpillar', group: 'critters', shape: 'caterpillar', color: '#8cc63f' },
  { id: 'slug', group: 'critters', shape: 'slug', color: '#b08a5a' },
  { id: 'flyingAnt', group: 'critters', shape: 'flyingAnt', color: '#8a3b22', rare: true },
  { id: 'leafBeetle', group: 'critters', shape: 'leafBeetle', color: '#6dbb3c' },
];

export const CATALOG_GROUPS: readonly CatalogGroup[] = ['dung', 'garden', 'debris', 'objects', 'picnic', 'critters'];

const IDS = new Set<string>(CATALOG.map((entry) => entry.id));
const BY_ID = new Map<CatalogId, CatalogEntry>(CATALOG.map((entry) => [entry.id, entry]));

export function isCatalogId(value: string): value is CatalogId {
  return IDS.has(value);
}

export function catalogEntry(id: CatalogId): CatalogEntry {
  return BY_ID.get(id)!;
}

/** Detrito grudado → figurinha (o nome do material É o id da figurinha). */
export function catalogIdForDebris(material: DebrisMaterial): CatalogId {
  return material;
}

/**
 * Arrancável do cenário → figurinha. Flor, cogumelo e objeto têm espécie
 * (`variant`); sem espécie conhecida, cai na mais comum do tipo.
 */
export function catalogIdForPickable(kind: PickableKind, variant: string | undefined): CatalogId {
  if (kind === 'rock' || kind === 'log') return kind;
  if (variant && isCatalogId(variant)) return variant;
  return kind === 'flower' ? 'daisy' : kind === 'mushroom' ? 'amanita' : 'pot';
}

/** Figurinhas de um grupo (para pedidos do tipo "arranque 3 flores"). */
export const FLOWER_IDS: readonly CatalogId[] = ['daisy', 'tulip', 'bell', 'dandelion', 'cloverFlower'];
export const MUSHROOM_IDS: readonly CatalogId[] = ['amanita', 'orangeCap', 'pinkCap', 'porcini', 'violetCap'];

const idsWhere = (test: (entry: CatalogEntry) => boolean): readonly CatalogId[] => CATALOG.filter(test).map((entry) => entry.id);

/** Todos os bichos que grudam. */
export const CRITTER_IDS = idsWhere((entry) => entry.group === 'critters');
/** Objetos de gente (achados e perdidos). */
export const OBJECT_IDS = idsWhere((entry) => entry.group === 'objects');
/** Comida do piquenique. */
export const PICNIC_IDS = idsWhere((entry) => entry.group === 'picnic');
/** Brinquedos (o cantinho das crianças). */
export const TOY_IDS = idsWhere((entry) => entry.zone === 'toys');
/** Coisas do cantinho do jardineiro. */
export const GARDENER_IDS = idsWhere((entry) => entry.zone === 'gardener');

/** Figurinhas de um cantinho. */
export function zoneIds(zone: CatalogZone): readonly CatalogId[] {
  return zone === 'picnic' ? PICNIC_IDS : zone === 'toys' ? TOY_IDS : GARDENER_IDS;
}
