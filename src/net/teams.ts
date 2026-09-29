import { MAX_PLAYERS } from './protocol';

/**
 * Times da sala, sem rede e sem Three.js (testados em `shots/lead/mplogic.mjs`).
 *
 *  - Tamanho 1 = cada um por si (sem time nenhum: todo mundo é rival).
 *  - Tamanho 2 = duplas (até 3 times, 2v2v2); tamanho 3 = trios (2 times, 3v3).
 *
 * Quem decide é o dono da sala: quem chega vai pro time com menos gente, cada
 * um pode pedir pra trocar pra um time com vaga, e o dono pode embaralhar.
 * Parceiro de time não rouba, não engole e não tromba o outro (ver `rules.ts`).
 */

export type TeamSize = 1 | 2 | 3;
export const TEAM_SIZES: readonly TeamSize[] = [1, 2, 3];

/** uid → índice do time (0, 1, 2). Vazio = cada um por si. */
export type TeamMap = Map<string, number>;

export const isTeamSize = (v: unknown): v is TeamSize => v === 1 || v === 2 || v === 3;

/** Quantos times cabem na sala cheia: duplas = 3, trios = 2; cada um por si = nenhum. */
export function teamCount(size: TeamSize): number {
  return size === 1 ? 0 : Math.floor(MAX_PLAYERS / size);
}

/** Quantos jogadores em cada time (índice = time), sem contar `except`. */
export function teamCounts(teams: ReadonlyMap<string, number>, size: TeamSize, except?: string): number[] {
  const counts = new Array<number>(teamCount(size)).fill(0);
  for (const [uid, team] of teams) if (uid !== except && team >= 0 && team < counts.length) counts[team]++;
  return counts;
}

/**
 * Quantos times abrir pra `players` besouros: só os que precisa (4 em duplas =
 * 2v2, não 2+1+1), e pelo menos 2 (senão não tem rival).
 */
export function teamsInUse(players: number, size: TeamSize): number {
  if (size === 1) return 0;
  return Math.min(teamCount(size), Math.max(2, Math.ceil(players / size)));
}

/**
 * Time pra quem chega (`players` = quantos vão estar na sala, com ele): o com
 * menos gente entre os times abertos (no empate, o primeiro); um time novo só
 * abre quando os abertos lotaram. -1 = cada um por si, ou tudo cheio.
 */
export function pickTeam(teams: ReadonlyMap<string, number>, size: TeamSize, players: number, except?: string): number {
  const counts = teamCounts(teams, size, except);
  const used = teamsInUse(players, size);
  let best = -1;
  for (let team = 0; team < used; team++) {
    if (counts[team] < size && (best < 0 || counts[team] < counts[best])) best = team;
  }
  if (best >= 0) return best;
  for (let team = used; team < counts.length; team++) if (counts[team] < size) return team;
  return -1;
}

/** `uid` pode ir pro time `team` (existe e tem vaga sem contar ele)? */
export function canJoinTeam(teams: ReadonlyMap<string, number>, uid: string, team: number, size: TeamSize): boolean {
  if (!Number.isInteger(team) || team < 0 || team >= teamCount(size)) return false;
  return teamCounts(teams, size, uid)[team] < size;
}

/**
 * Times de todo mundo (`order` = ordem de chegada): quem já tem um time
 * válido fica nele; os outros vão pro time com menos gente. Se ficar
 * desequilibrado demais (um time com 2 a mais que outro), os últimos que
 * chegaram no time maior mudam pro menor.
 */
export function arrangeTeams(order: readonly string[], size: TeamSize, current?: ReadonlyMap<string, number>): TeamMap {
  const teams: TeamMap = new Map();
  if (size === 1) return teams;
  const count = teamCount(size);
  for (const uid of order) {
    const team = current?.get(uid);
    if (team !== undefined && team >= 0 && team < count && teamCounts(teams, size)[team] < size) teams.set(uid, team);
  }
  for (const uid of order) {
    if (teams.has(uid)) continue;
    const team = pickTeam(teams, size, order.length);
    if (team >= 0) teams.set(uid, team);
  }
  // Equilíbrio: nunca 2 de diferença entre o maior e o menor time aberto.
  const used = teamsInUse(order.length, size);
  for (let guard = 0; guard < MAX_PLAYERS; guard++) {
    const counts = teamCounts(teams, size);
    // Os times abertos, mais os de fora que alguém escolheu.
    const open = counts.map((_, t) => t).filter((t) => t < used || counts[t] > 0);
    const big = open.reduce((a, t) => (counts[t] > counts[a] ? t : a), open[0]);
    const small = open.reduce((a, t) => (counts[t] < counts[a] ? t : a), open[0]);
    if (counts[big] - counts[small] < 2) break;
    const mover = [...order].reverse().find((uid) => teams.get(uid) === big);
    if (!mover) break;
    teams.set(mover, small);
  }
  return teams;
}

/** Embaralha os times (o dono apertou "Embaralhar"): sorteia a ordem e distribui equilibrado. */
export function shuffleTeams(order: readonly string[], size: TeamSize, random: () => number = Math.random): TeamMap {
  const shuffled = [...order];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return arrangeTeams(shuffled, size);
}

/** Sala pública de Disputa: 4 ou 6 besouros jogam em duplas; com 2, 3 ou 5, cada um por si. */
export function autoTeamSize(players: number): TeamSize {
  return players === 4 || players === 6 ? 2 : 1;
}
