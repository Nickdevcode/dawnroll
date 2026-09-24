import { ACCESSORIES, accessoriesUnlockedBy, accessoriesUnlockedByLevels, accessory, isAccessoryId, type AccessoryId } from './accessories';
import type { AchievementId } from './achievements';
import { SKINS, isSkinId, skin, skinsUnlockedBy, skinsUnlockedByLevels, type SkinId } from './skins';
import type { Rarity, Unlock } from './unlocks';

/**
 * "Visual" = casco ou acessório. O guarda-roupa, o selo de "Novo" e os avisos
 * de "liberou" tratam os dois do mesmo jeito; a chave junta o tipo e o id
 * (`skin:galaxy`, `acc:cowboy`) porque os dois nomes podem se repetir.
 */

export type LookKey = `skin:${SkinId}` | `acc:${AccessoryId}`;

export type Look = { readonly kind: 'skin'; readonly id: SkinId } | { readonly kind: 'acc'; readonly id: AccessoryId };

export const lookKey = (look: Look): LookKey => `${look.kind}:${look.id}` as LookKey;

export function isLookKey(value: string): value is LookKey {
  const [kind, id] = value.split(':');
  if (id === undefined) return false;
  return (kind === 'skin' && isSkinId(id)) || (kind === 'acc' && isAccessoryId(id));
}

export function lookFromKey(key: LookKey): Look {
  const [kind, id] = key.split(':');
  return kind === 'skin' ? { kind: 'skin', id: id as SkinId } : { kind: 'acc', id: id as AccessoryId };
}

/** Regra normal de liberação (conquista ou nível); acessório também pode ser achado no jardim. */
export function lookUnlock(look: Look): Unlock | undefined {
  return look.kind === 'skin' ? skin(look.id).unlock : accessory(look.id).unlock;
}

export function lookRarity(look: Look): Rarity {
  return look.kind === 'skin' ? skin(look.id).rarity : accessory(look.id).rarity;
}

/** Todos os visuais, cascos primeiro. */
export const ALL_LOOKS: readonly Look[] = [
  ...SKINS.map((s): Look => ({ kind: 'skin', id: s.id })),
  ...ACCESSORIES.map((a): Look => ({ kind: 'acc', id: a.id })),
];

/** Visuais que a conquista libera. */
export function looksUnlockedBy(id: AchievementId): Look[] {
  return [
    ...skinsUnlockedBy(id).map((s): Look => ({ kind: 'skin', id: s })),
    ...accessoriesUnlockedBy(id).map((a): Look => ({ kind: 'acc', id: a })),
  ];
}

/** Visuais liberados ao subir do nível `from` para o `to`. */
export function looksUnlockedByLevels(from: number, to: number): Look[] {
  if (to <= from) return [];
  return [
    ...skinsUnlockedByLevels(from, to).map((s): Look => ({ kind: 'skin', id: s })),
    ...accessoriesUnlockedByLevels(from, to).map((a): Look => ({ kind: 'acc', id: a })),
  ];
}
