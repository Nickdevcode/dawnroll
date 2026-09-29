import type { TeamSize } from './teams';

/**
 * A Disputa, sem rede e sem Three.js (testada em `shots/lead/mplogic.mjs`):
 * as fases, o relógio, a pontuação e quem ganhou.
 *
 *   idle ─▶ countdown (3, 2, 1, Já!) ─▶ playing (3, 5 ou 8 min) ─▶ ended (pódio) ─▶ idle
 *
 * O dono da sala conduz (muda a fase e soma os pontos) e manda o estado pra
 * todo mundo a cada mudança (evento `match`); cada um lê o relógio da sala pra
 * mostrar a contagem e o tempo. Se o dono cair, quem assume continua do último
 * estado que recebeu.
 *
 * Pontos: cada bola enterrada vale os cm dela mais o Sol excedente, em dobro no
 * último minuto ("Pôr do sol"), divididos pela parte de cada um na bola (quem
 * doou bola pra ela leva a parte dele). O time soma os pontos de quem é dele.
 */

export type MatchPhase = 'idle' | 'countdown' | 'playing' | 'ended';

/** 3, 2, 1 e o "Já!" (o meio segundo a mais é o "Já!" na tela antes de soltar). */
export const COUNTDOWN_SECONDS = 3.5;
/** Pôr do sol: os pontos valem em dobro no último minuto. */
export const SUNSET_SECONDS = 60;
export const SUNSET_MULTIPLIER = 2;
/** Bola que já estava afundando na toca quando o tempo acabou ainda conta (o enterro leva ~2,4 s). */
export const END_GRACE_SECONDS = 4;
/** Pódio: quanto tempo os besouros ficam lá em cima antes de o jardim voltar a ser livre. */
export const PODIUM_SECONDS = 10;
/** Sala pública: começa sozinha depois desse aquecimento (com pelo menos 2 besouros). */
export const AUTO_START_SECONDS = 20;
/** Dá pra entrar numa Disputa rolando só nesse começo (o banco confere o mesmo). */
export const LATE_JOIN_SECONDS = 120;
/** Durações que o dono escolhe. */
export const MATCH_MINUTES = [3, 5, 8] as const;
export type MatchMinutes = (typeof MATCH_MINUTES)[number];
/** Quem ganha leva XP de passe a mais. */
export const MATCH_WIN_PASS_XP = 150;
/** Placar: no máximo isso de gente (quem saiu no meio continua no placar). */
export const MAX_BOARD = 12;

export const isMatchMinutes = (v: unknown): v is MatchMinutes => v === 3 || v === 5 || v === 8;

/** Uma linha do placar: um jogador e o que ele fez na partida. */
export interface MatchEntry {
  uid: string;
  nick: string;
  /** Vaga na sala (a cor de quem joga cada um por si). */
  slot: number;
  /** Time (−1 = cada um por si). */
  team: number;
  points: number;
  /** Maior bola que ele enterrou (cm). */
  best: number;
  /** Roubos: bola de rival que ele pegou ou engoliu. */
  steals: number;
  /** Fusões: bola que ele juntou com a de outro. */
  gifts: number;
}

export interface NetMatch {
  phase: MatchPhase;
  /** Número da partida (sobe a cada uma): o que é de outra partida não conta nesta. */
  round: number;
  /** Semente do jardim da partida (o mesmo pra todos). */
  seed: number;
  /** Relógio da sala: fim da contagem (começa a valer). */
  startsAt: number;
  /** Relógio da sala: fim do tempo. */
  endsAt: number;
  /** Relógio da sala: fim do pódio (ended) ou começo automático (idle, sala pública); 0 = nenhum. */
  until: number;
  teamSize: TeamSize;
  board: MatchEntry[];
}

export function idleMatch(round = 0): NetMatch {
  return { phase: 'idle', round, seed: 0, startsAt: 0, endsAt: 0, until: 0, teamSize: 1, board: [] };
}

/** Fase vista por quem joga agora: entre o fim do tempo e o anúncio do resultado é 'overtime' (parado, esperando). */
export type MatchView = MatchPhase | 'overtime';

export function matchView(m: NetMatch, now: number): MatchView {
  if (m.phase === 'countdown') return now >= m.startsAt ? 'playing' : 'countdown';
  if (m.phase === 'playing') return now >= m.endsAt ? 'overtime' : 'playing';
  return m.phase;
}

/** Segundos de jogo que faltam (0 fora da partida). */
export function timeLeft(m: NetMatch, now: number): number {
  if (m.phase === 'countdown') return m.endsAt - m.startsAt;
  if (m.phase !== 'playing') return 0;
  return Math.max(0, m.endsAt - now);
}

/** Último minuto: os pontos valem em dobro. Enterro que termina na folga depois do fim também. */
export function isSunset(m: NetMatch, now: number): boolean {
  return m.phase === 'playing' && now >= m.endsAt - SUNSET_SECONDS;
}

/** Enterro no meio da partida vale? (Na folga depois do fim também: a bola já afundava.) */
export function scoringOpen(m: NetMatch, now: number): boolean {
  return m.phase === 'playing' && now >= m.startsAt && now <= m.endsAt + END_GRACE_SECONDS;
}

/** Pontos de um enterro: cm + Sol excedente, ×2 no pôr do sol (uma casa decimal). */
export function burialPoints(cm: number, sunCm: number, sunset: boolean): number {
  const base = Math.max(0, cm) + Math.max(0, sunCm);
  return Math.round(base * (sunset ? SUNSET_MULTIPLIER : 1) * 10) / 10;
}

/**
 * Soma um enterro no placar: `points` dividido pelas partes (`shares`, frações
 * que somam 1). Parte de quem não está no placar (nunca deveria) vai pra quem
 * enterrou. A maior bola é de quem enterrou.
 */
export function creditBurial(board: MatchEntry[], burier: string, cm: number, points: number, shares: ReadonlyArray<readonly [string, number]>): void {
  const byUid = new Map(board.map((e) => [e.uid, e]));
  const holder = byUid.get(burier);
  const parts = shares.length > 0 ? shares : [[burier, 1] as const];
  for (const [uid, fraction] of parts) {
    const entry = byUid.get(uid) ?? holder;
    if (!entry) continue;
    entry.points = Math.round((entry.points + points * Math.max(0, Math.min(1, fraction))) * 10) / 10;
  }
  if (holder) holder.best = Math.max(holder.best, Math.round(cm * 10) / 10);
}

/** Um lado da disputa: um time (duplas/trios) ou um jogador (cada um por si). */
export interface Side {
  /** Time (0..2), ou a vaga do jogador quando é cada um por si. */
  key: number;
  isTeam: boolean;
  uids: string[];
  points: number;
  /** 1 = primeiro (empate divide a colocação). */
  place: number;
}

/** Placar por lado, do primeiro pro último. */
export function standings(m: NetMatch): Side[] {
  const sides = new Map<number, Side>();
  for (const e of m.board) {
    const isTeam = m.teamSize > 1 && e.team >= 0;
    // Chave única: time 0..2, ou 100 + vaga (quem joga sozinho).
    const id = isTeam ? e.team : 100 + e.slot;
    let side = sides.get(id);
    if (!side) {
      side = { key: isTeam ? e.team : e.slot, isTeam, uids: [], points: 0, place: 0 };
      sides.set(id, side);
    }
    side.uids.push(e.uid);
    side.points = Math.round((side.points + e.points) * 10) / 10;
  }
  const list = [...sides.values()].sort((a, b) => b.points - a.points || a.key - b.key);
  for (let i = 0; i < list.length; i++) list[i].place = i > 0 && list[i].points === list[i - 1].points ? list[i - 1].place : i + 1;
  return list;
}

/** Quem ganhou (todo mundo do lado em primeiro, empate inclusive). Ninguém pontuou = ninguém ganhou. */
export function winners(m: NetMatch): Set<string> {
  const out = new Set<string>();
  for (const side of standings(m)) if (side.place === 1 && side.points > 0) for (const uid of side.uids) out.add(uid);
  return out;
}

export type HighlightKind = 'biggest' | 'steals' | 'gifts';

export interface Highlight {
  kind: HighlightKind;
  uid: string;
  nick: string;
  value: number;
}

/** Destaques da partida (maior bola, mais roubos, mais fusões): o melhor em cada um, se alguém fez. */
export function highlights(m: NetMatch): Highlight[] {
  const out: Highlight[] = [];
  const fields: Array<[HighlightKind, (e: MatchEntry) => number]> = [
    ['biggest', (e) => e.best],
    ['steals', (e) => e.steals],
    ['gifts', (e) => e.gifts],
  ];
  for (const [kind, value] of fields) {
    let best: MatchEntry | null = null;
    for (const e of m.board) if (value(e) > 0 && (!best || value(e) > value(best))) best = e;
    if (best) out.push({ kind, uid: best.uid, nick: best.nick, value: value(best) });
  }
  return out;
}

/**
 * Lugar de largada (o círculo em volta do nascimento, que o jardim sempre deixa
 * livre): parceiros lado a lado, cada um olhando pra fora. Devolve x, z e pra
 * onde olhar (yaw).
 */
export function startSpot(index: number, count: number, radius = 3.2): { x: number; z: number; yaw: number } {
  const n = Math.max(1, count);
  // Começa de frente pra toca (que fica em +z) e reparte o círculo.
  const angle = (index / n) * Math.PI * 2;
  const x = Math.sin(angle) * radius;
  const z = Math.cos(angle) * radius;
  return { x, z, yaw: angle };
}

/** Ordem de largada: por time (parceiros juntos) e, dentro do time, pela vaga. */
export function startOrder(board: readonly MatchEntry[]): string[] {
  return [...board].sort((a, b) => (a.team - b.team) || (a.slot - b.slot)).map((e) => e.uid);
}
