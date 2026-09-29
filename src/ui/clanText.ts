import { t, tn, type MessageKey } from '../i18n';
import type { ClanMemberStatus } from '../online/Clans';
import { escapeHtml } from './html';

/**
 * A tag da turma antes do apelido, em todo lugar que mostra gente (placa em
 * cima do besouro, lobby, amigos, turma, convites): em HTML vira uma pílula;
 * em texto corrido (aviso, leitor de tela) vira "[KHE] Nick".
 */

/**
 * Pílula da tag (vazio sem tag). O leitor de tela lê "turma KHE": o "turma" vai
 * escondido da vista (`aria-label` num `<span>` sem papel é ignorado por leitor de tela).
 */
export function clanTagHtml(tag: string | null | undefined, extraClass = ''): string {
  if (!tag) return '';
  return `<span class="clan-tag${extraClass ? ` ${extraClass}` : ''}"><span class="sr-only">${escapeHtml(t('clan.tagPrefix'))} </span>${escapeHtml(tag)}</span>`;
}

/** Apelido com a tag na frente, em texto ("[KHE] Nick"). */
export function taggedName(nickname: string, tag: string | null | undefined): string {
  return tag ? `[${tag}] ${nickname}` : nickname;
}

/** Onde o colega está ("Numa sala", "Jogando sozinho", "No menu", "Offline"). */
export function memberWhere(status: ClanMemberStatus): string {
  return t(`clan.status.${status}` as MessageKey);
}

/** "12 bolas na semana" (ou "Nada ainda nesta semana"). */
export function weekText(balls: number): string {
  return balls > 0 ? tn('clan.weekBalls', balls) : t('clan.weekNone');
}
