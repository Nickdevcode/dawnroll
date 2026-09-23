import { formatCm, t, type MessageKey } from '../i18n';
import { SIZE_MILESTONES, achievement, type AchievementId } from '../progression/achievements';

/** Nome da conquista (os marcos de tamanho reusam o nome do aviso da rodada). */
export function achievementName(id: AchievementId): string {
  const milestone = SIZE_MILESTONES.find((m) => m.id === id);
  return milestone ? t(milestone.name as MessageKey) : t(`ach.${id}.name` as MessageKey);
}

/** O que precisa fazer. */
export function achievementDesc(id: AchievementId): string {
  const cm = achievement(id).cm;
  return cm !== undefined ? t('ach.size.desc', { cm: formatCm(cm) }) : t(`ach.${id}.desc` as MessageKey);
}
