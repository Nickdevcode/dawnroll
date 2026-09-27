import type { AchievementId } from './achievements';
import { unlockedByAchievement, unlockedByLevels, type Rarity, type Unlock } from './unlocks';

/**
 * Acessórios do besouro: chapéus, óculos, coisas no pescoço e nas costas. Um
 * por lugar (`slot`), todos só de enfeite. Os primeiros são liberados por uma
 * conquista ou por nível — de preferência uma que combine (o chapéu de cowboy
 * vem do rodeio em cima da bola, o monóculo do museu completo...); os da
 * Feirinha se compram, os do passe são prêmio da temporada e alguns só saem de
 * baú.
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
  | 'beret'
  | 'bucketHat'
  | 'pirateHat'
  | 'headphones'
  | 'unicornHorn'
  | 'sprout'
  | 'mushroomCap'
  | 'frogHat'
  | 'ufo'
  // Rosto
  | 'sunglasses'
  | 'roundGlasses'
  | 'heartGlasses'
  | 'starGlasses'
  | 'mustache'
  | 'monocle'
  | 'clownNose'
  | 'eyepatch'
  | 'aviators'
  | 'pixelShades'
  | 'daisyGlasses'
  | 'cyberVisor'
  // Pescoço
  | 'bowTie'
  | 'bandana'
  | 'scarf'
  | 'cowbell'
  | 'lei'
  | 'medal'
  | 'tie'
  | 'whistle'
  | 'pearls'
  | 'goldChain'
  | 'petalCollar'
  | 'scarabAmulet'
  // Costas
  | 'flag'
  | 'backpack'
  | 'cape'
  | 'butterflyWings'
  | 'bottleRocket'
  | 'balloon'
  | 'snailShell'
  | 'leafUmbrella'
  | 'guitar'
  | 'dragonflyWings'
  | 'kite'
  | 'angelWings';

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
  { id: 'beret', slot: 'head', rarity: 'common', unlock: { shop: { coins: 450 } } },
  { id: 'bucketHat', slot: 'head', rarity: 'common', unlock: { shop: { coins: 700 } } },
  { id: 'pirateHat', slot: 'head', rarity: 'rare', unlock: { shop: { coins: 1200 } } },
  { id: 'headphones', slot: 'head', rarity: 'rare', unlock: { shop: { coins: 1400 } }, animated: true },
  { id: 'unicornHorn', slot: 'head', rarity: 'epic', unlock: { shop: { dew: 150 } }, animated: true },
  { id: 'sprout', slot: 'head', rarity: 'common', unlock: { pass: 'florada' }, animated: true },
  { id: 'mushroomCap', slot: 'head', rarity: 'rare', unlock: { pass: 'florada' } },
  { id: 'frogHat', slot: 'head', rarity: 'rare', unlock: { chest: true } },
  { id: 'ufo', slot: 'head', rarity: 'legendary', unlock: { chest: true }, animated: true },
  // --- rosto ------------------------------------------------------------------
  { id: 'sunglasses', slot: 'face', rarity: 'common', unlock: { achievement: 'size12' } },
  { id: 'roundGlasses', slot: 'face', rarity: 'common', unlock: { achievement: 'catalog10' } },
  { id: 'heartGlasses', slot: 'face', rarity: 'rare', unlock: { level: 7 } },
  { id: 'starGlasses', slot: 'face', rarity: 'rare', unlock: { achievement: 'doubleStar' } },
  { id: 'mustache', slot: 'face', rarity: 'rare', unlock: { level: 12 } },
  { id: 'monocle', slot: 'face', rarity: 'legendary', unlock: { achievement: 'catalogAll' } },
  { id: 'clownNose', slot: 'face', rarity: 'common', unlock: { shop: { coins: 350 } } },
  { id: 'eyepatch', slot: 'face', rarity: 'common', unlock: { shop: { coins: 500 } } },
  { id: 'aviators', slot: 'face', rarity: 'rare', unlock: { shop: { coins: 1000 } } },
  { id: 'pixelShades', slot: 'face', rarity: 'epic', unlock: { shop: { dew: 110 } } },
  { id: 'daisyGlasses', slot: 'face', rarity: 'rare', unlock: { pass: 'florada' } },
  { id: 'cyberVisor', slot: 'face', rarity: 'epic', unlock: { chest: true }, animated: true },
  // --- pescoço ----------------------------------------------------------------
  { id: 'bowTie', slot: 'neck', rarity: 'common', unlock: { achievement: 'size8' } },
  { id: 'bandana', slot: 'neck', rarity: 'common', unlock: { achievement: 'onTop' } },
  { id: 'scarf', slot: 'neck', rarity: 'rare', unlock: { level: 11 }, animated: true },
  { id: 'cowbell', slot: 'neck', rarity: 'rare', unlock: { achievement: 'fresh10' }, animated: true },
  { id: 'lei', slot: 'neck', rarity: 'rare', unlock: { achievement: 'flipflop' } },
  { id: 'medal', slot: 'neck', rarity: 'epic', unlock: { achievement: 'bury50' } },
  { id: 'tie', slot: 'neck', rarity: 'common', unlock: { shop: { coins: 500 } }, animated: true },
  { id: 'whistle', slot: 'neck', rarity: 'common', unlock: { shop: { coins: 400 } }, animated: true },
  { id: 'pearls', slot: 'neck', rarity: 'rare', unlock: { shop: { coins: 1300 } } },
  { id: 'goldChain', slot: 'neck', rarity: 'epic', unlock: { shop: { dew: 130 } }, animated: true },
  { id: 'petalCollar', slot: 'neck', rarity: 'epic', unlock: { pass: 'florada' } },
  { id: 'scarabAmulet', slot: 'neck', rarity: 'legendary', unlock: { chest: true }, animated: true },
  // --- costas -----------------------------------------------------------------
  { id: 'flag', slot: 'back', rarity: 'common', unlock: { achievement: 'allRequests' }, animated: true },
  { id: 'backpack', slot: 'back', rarity: 'rare', unlock: { achievement: 'requests50' } },
  { id: 'cape', slot: 'back', rarity: 'rare', unlock: { achievement: 'toys' }, animated: true },
  { id: 'butterflyWings', slot: 'back', rarity: 'epic', unlock: { achievement: 'swarm' }, animated: true },
  { id: 'bottleRocket', slot: 'back', rarity: 'epic', unlock: { achievement: 'riderBury' }, animated: true },
  { id: 'balloon', slot: 'back', rarity: 'common', unlock: { shop: { coins: 600 } }, animated: true },
  { id: 'snailShell', slot: 'back', rarity: 'rare', unlock: { shop: { coins: 1100 } } },
  { id: 'leafUmbrella', slot: 'back', rarity: 'rare', unlock: { shop: { coins: 1300 } }, animated: true },
  { id: 'guitar', slot: 'back', rarity: 'rare', unlock: { shop: { coins: 1500 } } },
  { id: 'dragonflyWings', slot: 'back', rarity: 'legendary', unlock: { shop: { dew: 240 } }, animated: true },
  { id: 'kite', slot: 'back', rarity: 'epic', unlock: { pass: 'florada' }, animated: true },
  { id: 'angelWings', slot: 'back', rarity: 'legendary', unlock: { chest: true }, animated: true },
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
