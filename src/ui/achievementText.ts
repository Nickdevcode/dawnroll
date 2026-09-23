import { formatCm, t, type MessageKey } from '../i18n';
import { SIZE_MILESTONES, achievement, type AchievementId } from '../progression/achievements';

/**
 * Nome da conquista (os marcos de tamanho reusam o nome do aviso da rodada).
 * Secreta e ainda não feita: `hidden` troca por "Conquista secreta".
 */
export function achievementName(id: AchievementId, hidden = false): string {
  if (hidden) return t('burrow.ach.secret');
  const milestone = SIZE_MILESTONES.find((m) => m.id === id);
  return milestone ? t(milestone.name as MessageKey) : t(`ach.${id}.name` as MessageKey);
}

/** O que precisa fazer (secreta e não feita: só um "continue jogando"). */
export function achievementDesc(id: AchievementId, hidden = false): string {
  if (hidden) return t('burrow.ach.secretDesc');
  const cm = achievement(id).cm;
  return cm !== undefined ? t('ach.size.desc', { cm: formatCm(cm) }) : t(`ach.${id}.desc` as MessageKey);
}

/** Secreta que ainda não foi feita (aparece como "???"). */
export function isHiddenAchievement(id: AchievementId, done: boolean): boolean {
  return !done && achievement(id).group === 'secret';
}
