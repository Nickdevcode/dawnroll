import type { AchievementId } from './achievements';
import { unlockedByAchievement, unlockedByLevels, type Rarity, type Unlock } from './unlocks';

/**
 * Acessórios do besouro: chapéus, óculos, coisas no pescoço e nas costas. Um
 * por lugar (`slot`), todos só de enfeite. Cada um é liberado por uma conquista
 * ou por nível — de preferência uma que combine (o chapéu de cowboy vem do
 * rodeio em cima da bola, o monóculo do museu completo...).
 *
 * Os modelos 3D moram em `entities/outfit/`; aqui é só o que o progresso e a
 * interface precisam saber.
 */

export type AccessorySlot = 'head' | 'face' | 'neck' | 'back';

export const ACCESSORY_SLOTS: readonly AccessorySlot[] = ['head', 'face', 'neck', 'back'];

export type AccessoryId =
  // Cabeça
  | 'partyHat'
  | 'cap'
  | 'beanie'
  | 'strawHat'
  | 'flowerCrown'
  | 'cowboy'
  | 'topHat'
  | 'chefHat'
  | 'gnomeHat'
  | 'miner'
  | 'viking'
  | 'propeller'
  | 'wizardHat'
  | 'halo'
  | 'cangaceiro'
  | 'crown'
  // Rosto
  | 'sunglasses'
  | 'roundGlasses'
  | 'heartGlasses'
  | 'starGlasses'
  | 'mustache'
  | 'monocle'
  // Pescoço
  | 'bowTie'
  | 'bandana'
  | 'scarf'
  | 'cowbell'
  | 'lei'
  | 'medal'
  // Costas
  | 'flag'
  | 'backpack'
  | 'cape'
  | 'butterflyWings'
  | 'bottleRocket';

export interface AccessoryDef {
  readonly id: AccessoryId;
  readonly slot: AccessorySlot;
  readonly rarity: Rarity;
  readonly unlock: Unlock;
  /** Mexe sozinho (hélice, asas, capa...): ganha o selo "animado" no guarda-roupa. */
  readonly animated?: boolean;
}

export const ACCESSORIES: readonly AccessoryDef[] = [
  // --- cabeça -----------------------------------------------------------------
  { id: 'partyHat', slot: 'head', rarity: 'common', unlock: { achievement: 'firstBury' } },
  { id: 'cap', slot: 'head', rarity: 'common', unlock: { level: 2 } },
  { id: 'beanie', slot: 'head', rarity: 'common', unlock: { achievement: 'rainBury' } },
  { id: 'strawHat', slot: 'head', rarity: 'common', unlock: { level: 4 } },
  { id: 'flowerCrown', slot: 'head', rarity: 'rare', unlock: { level: 6 } },
  { id: 'cowboy', slot: 'head', rarity: 'rare', unlock: { achievement: 'rodeo' } },
  { id: 'topHat', slot: 'head', rarity: 'rare', unlock: { achievement: 'level10' } },
  { id: 'chefHat', slot: 'head', rarity: 'rare', unlock: { achievement: 'feast' } },
  { id: 'gnomeHat', slot: 'head', rarity: 'rare', unlock: { achievement: 'gnome' } },
  { id: 'miner', slot: 'head', rarity: 'rare', unlock: { achievement: 'underRock' }, animated: true },
  { id: 'viking', slot: 'head', rarity: 'rare', unlock: { achievement: 'size16' } },
  { id: 'propeller', slot: 'head', rarity: 'epic', unlock: { achievement: 'hummingbird' }, animated: true },
  { id: 'wizardHat', slot: 'head', rarity: 'epic', unlock: { achievement: 'allPerks' }, animated: true },
  { id: 'halo', slot: 'head', rarity: 'epic', unlock: { achievement: 'purist' }, animated: true },
  { id: 'cangaceiro', slot: 'head', rarity: 'epic', unlock: { achievement: 'level15' } },
  { id: 'crown', slot: 'head', rarity: 'legendary', unlock: { achievement: 'size30' }, animated: true },
  // --- rosto ------------------------------------------------------------------
  { id: 'sunglasses', slot: 'face', rarity: 'common', unlock: { achievement: 'size12' } },
  { id: 'roundGlasses', slot: 'face', rarity: 'common', unlock: { achievement: 'catalog10' } },
  { id: 'heartGlasses', slot: 'face', rarity: 'rare', unlock: { level: 7 } },
  { id: 'starGlasses', slot: 'face', rarity: 'rare', unlock: { achievement: 'doubleStar' } },
  { id: 'mustache', slot: 'face', rarity: 'rare', unlock: { level: 12 } },
  { id: 'monocle', slot: 'face', rarity: 'legendary', unlock: { achievement: 'catalogAll' } },
  // --- pescoço ----------------------------------------------------------------
  { id: 'bowTie', slot: 'neck', rarity: 'common', unlock: { achievement: 'size8' } },
  { id: 'bandana', slot: 'neck', rarity: 'common', unlock: { achievement: 'onTop' } },
  { id: 'scarf', slot: 'neck', rarity: 'rare', unlock: { level: 11 }, animated: true },
  { id: 'cowbell', slot: 'neck', rarity: 'rare', unlock: { achievement: 'fresh10' }, animated: true },
  { id: 'lei', slot: 'neck', rarity: 'rare', unlock: { achievement: 'flipflop' } },
  { id: 'medal', slot: 'neck', rarity: 'epic', unlock: { achievement: 'bury50' } },
  // --- costas -----------------------------------------------------------------
  { id: 'flag', slot: 'back', rarity: 'common', unlock: { achievement: 'allRequests' }, animated: true },
  { id: 'backpack', slot: 'back', rarity: 'rare', unlock: { achievement: 'requests50' } },
  { id: 'cape', slot: 'back', rarity: 'rare', unlock: { achievement: 'toys' }, animated: true },
  { id: 'butterflyWings', slot: 'back', rarity: 'epic', unlock: { achievement: 'swarm' }, animated: true },
  { id: 'bottleRocket', slot: 'back', rarity: 'epic', unlock: { achievement: 'riderBury' }, animated: true },
];

/** O que o besouro está vestindo: um acessório (ou nada) por lugar. */
export type Outfit = Record<AccessorySlot, AccessoryId | null>;

export function emptyOutfit(): Outfit {
  return { head: null, face: null, neck: null, back: null };
}

const BY_ID = new Map<AccessoryId, AccessoryDef>(ACCESSORIES.map((a) => [a.id, a]));

export function isAccessoryId(value: string): value is AccessoryId {
  return BY_ID.has(value as AccessoryId);
}

export function isAccessorySlot(value: string): value is AccessorySlot {
  return (ACCESSORY_SLOTS as readonly string[]).includes(value);
}

export function accessory(id: AccessoryId): AccessoryDef {
  return BY_ID.get(id)!;
}

export function accessoriesIn(slot: AccessorySlot): AccessoryDef[] {
  return ACCESSORIES.filter((a) => a.slot === slot);
}

/** Acessórios que a conquista `id` libera. */
export function accessoriesUnlockedBy(id: AchievementId): AccessoryId[] {
  return unlockedByAchievement(ACCESSORIES, id).map((a) => a.id);
}

/** Acessórios liberados ao subir do nível `from` para o `to`. */
export function accessoriesUnlockedByLevels(from: number, to: number): AccessoryId[] {
  return unlockedByLevels(ACCESSORIES, from, to).map((a) => a.id);
}
