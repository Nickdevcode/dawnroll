import { t, type MessageKey } from '../i18n';
import type { AchievementId } from '../progression/achievements';
import type { Look } from '../progression/looks';
import type { Rarity, Unlock } from '../progression/unlocks';
import { achievementName, isHiddenAchievement } from './achievementText';

/** Nome do visual (casco ou acessório). */
export function lookName(look: Look): string {
  return t(`${look.kind === 'skin' ? 'skin' : 'acc'}.${look.id}.name` as MessageKey);
}

/** Descrição curta do visual. */
export function lookDesc(look: Look): string {
  return t(`${look.kind === 'skin' ? 'skin' : 'acc'}.${look.id}.desc` as MessageKey);
}

export function rarityName(rarity: Rarity): string {
  return t(`rarity.${rarity}` as MessageKey);
}

/**
 * Como liberar: "Libera com: <conquista>" ou "Libera no nível N". Conquista
 * secreta ainda não feita continua secreta aqui também.
 */
export function unlockText(unlock: Unlock, hasAchievement: (id: AchievementId) => boolean): string {
  if ('level' in unlock) return t('wardrobe.unlockLevel', { n: unlock.level });
  const hidden = isHiddenAchievement(unlock.achievement, hasAchievement(unlock.achievement));
  return t('wardrobe.unlockAchievement', { name: achievementName(unlock.achievement, hidden) });
}

/** "Novo visual: X, Y" pros avisos (conquista, refeição que subiu de nível). */
export function looksNotice(looks: readonly Look[]): string {
  return t('wardrobe.notice', { names: looks.map(lookName).join(', ') });
}
