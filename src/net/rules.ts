import type { NetRules } from './protocol';

/**
 * As regras das interações do online (a "bagunça boa"), sem rede e sem
 * Three.js: o dono da sala confere cada pedido com elas, e cada jogador usa as
 * mesmas pra saber o que pode tentar (e mostrar a dica certa). Testadas à
 * parte em `shots/lead/mplogic.mjs`.
 *
 *  - Bola solta: ninguém empurra há 1,5 s → é de quem pegar primeiro.
 *  - Trombada: correndo, bate em quem está empurrando → ele solta a bola e
 *    fica tonto 1 s; quem trombou espera 6 s pra trombar de novo.
 *  - Engolir: a sua bola rola por cima de uma bola rival de até 70% do tamanho.
 *  - Fundir (doar): encosta a sua bola na de outro e segura o botão → a sua
 *    entra na dele. No enterro, a comida é dividida pela parte de cada um.
 *  - Puxar (o contrário de doar): encosta a sua bola na de um rival e segura
 *    o outro botão → a dele entra na sua, inteira. Leva mais tempo que doar e
 *    o rival vê o aviso (dá pra fugir). Bola que o dono empurra só se for do
 *    seu tamanho pra baixo; bola solta, de qualquer tamanho.
 *  - Empurrar junto: agarrar a bola que outro está empurrando soma a força.
 *  - Proteções: broto novo fica 5 s imune; bola afundando na toca não se
 *    rouba; quem perde a bola ganha um broto em 3 s.
 *
 * Times (`teams.ts`): parceiro não rouba, não engole e não tromba o outro, e
 * fundir com parceiro põe a bola MENOR dentro da maior (quem apertar). Cada um
 * por si, todo mundo é rival. No Jardim livre qualquer um pode ajudar um rival
 * (empurrar junto, doar); na Disputa, ajudar é só com o parceiro.
 */

/** Sem ninguém empurrar por isso, a bola fica solta. */
export const LOOSE_SECONDS = 1.5;
/** Folga do dono da sala pra atraso de rede ao conferir "solta" (o retrato dele chega um pouco depois). */
export const LOOSE_TOLERANCE = 0.3;
/** Trombada: recarga de quem trombou, tempo tonto de quem levou, e a bola dele fica solta por isso. */
export const TACKLE_COOLDOWN = 6;
export const DIZZY_SECONDS = 1;
export const TACKLE_LOOSE_SECONDS = 2.5;
/** Velocidade mínima (u/s) pra contar como trombada: correndo (andando é 3,6). */
export const TACKLE_MIN_SPEED = 4.6;
/** Distância entre os dois besouros (centro a centro) pra encostar. */
export const TACKLE_REACH = 0.8;
/** Engolir: a bola rival pode ter até isso do raio da sua. */
export const SWALLOW_RATIO = 0.7;
/** Broto novo: segundos sem poder ser pego nem engolido. */
export const SPROUT_IMMUNE_SECONDS = 5;
/** Perdeu a bola (roubada, engolida): o broto novo nasce depois disso. Doou: quase na hora. */
export const RESPROUT_SECONDS = 3;
export const GIFT_RESPROUT_SECONDS = 0.8;
/** Fundir: segurar o botão por isso (doar a bola é sem volta: não pode ser sem querer). */
export const MERGE_HOLD_SECONDS = 0.7;
/** Fundir: a sua bola precisa estar encostando (folga entre as superfícies). */
export const MERGE_REACH = 0.9;
/**
 * Puxar: segurar o botão por isso encostado na bola do rival. Bem mais que
 * doar: o rival vê o aviso e tem tempo de fugir (é roubo, não pode ser de graça).
 */
export const PULL_HOLD_SECONDS = 1.5;
/** Puxar: já puxando, a bola do rival pode se afastar um pouco disso (a mais que o encostar) sem a puxada cair. */
export const PULL_KEEP_SLACK = 0.5;
/** Bola sua largada no jardim (depois de pegar outra) esfarela se ninguém mexer nela por isso. */
export const ABANDON_SECONDS = 60;
/** Bolas de um jogador ao mesmo tempo (a que ele faz + as largadas): passou, a largada mais velha esfarela. */
export const MAX_OWNED_BALLS = 3;
/** Empurrar junto: cada ajudante aumenta a velocidade máxima da bola nisso (bola gigante anda bem mais rápido em dupla). */
export const CO_PUSH_SPEED_BONUS = 0.35;
export const MAX_HELPERS = 3;
/** Ajuda no empurrão que não se renova por isso (pacote perdido, ajudante soltou) para de valer. */
export const ASSIST_STALE_SECONDS = 0.3;

/** Folgas do dono da sala ao conferir distâncias (o que ele vê está um pouco atrasado). */
export const HOST_REACH_SLACK = 2.2;

export type Relation = 'self' | 'team' | 'rival';

/** Como dois jogadores se relacionam. Sem times (cada um por si), todo outro é rival. */
export function relation(a: string, b: string, teams?: ReadonlyMap<string, number>): Relation {
  if (a === b) return 'self';
  const ta = teams?.get(a);
  return ta !== undefined && ta === teams?.get(b) ? 'team' : 'rival';
}

/** Dá pra tomar a bola de outro (bola solta ou depois de trombada)? */
export function canTakeFrom(rel: Relation, rules: NetRules): boolean {
  return rel === 'team' || (rel === 'rival' && rules.steal);
}

/** Dá pra ajudar a bola de outro (empurrar junto, doar a sua)? Rival só no Jardim livre. */
export function canHelp(rel: Relation, rules: Pick<NetRules, 'mode'>): boolean {
  return rel !== 'rival' || rules.mode === 'garden';
}

/** O que o dono da sala (ou você) sabe de uma bola pra decidir. */
export interface BallFacts {
  owner: string;
  radius: number;
  burying: boolean;
  /** Broto novo (imune). */
  immune: boolean;
  /** Relógio da sala da última vez que o dono empurrou (ou -Infinity). */
  lastPushAt: number;
  /** Solta à força até esse instante (trombada). */
  looseUntil: number;
  /** O dono está doando ela (segurando "fundir"): não pode ser engolida. */
  gift?: boolean;
}

/** A bola está solta agora (ninguém empurra há 1,5 s, ou o dono levou trombada)? */
export function isLoose(ball: Pick<BallFacts, 'lastPushAt' | 'looseUntil'>, now: number, tolerance = 0): boolean {
  return ball.looseUntil > now || now - ball.lastPushAt >= LOOSE_SECONDS - tolerance;
}

export type Verdict = 'ok' | 'gone' | 'mine' | 'burying' | 'immune' | 'pushed' | 'rules' | 'far' | 'size' | 'cooldown' | 'idle' | 'dizzy';

/** Pegar uma bola de outro jogador (ela precisa estar solta). */
export function judgeClaim(ball: BallFacts | undefined, taker: string, now: number, rules: NetRules, gap: number, teams?: ReadonlyMap<string, number>): Verdict {
  if (!ball) return 'gone';
  if (ball.owner === taker) return 'mine';
  if (ball.burying) return 'burying';
  if (ball.immune) return 'immune';
  if (!canTakeFrom(relation(taker, ball.owner, teams), rules)) return 'rules';
  if (!isLoose(ball, now, LOOSE_TOLERANCE)) return 'pushed';
  if (gap > HOST_REACH_SLACK) return 'far';
  return 'ok';
}

/** Engolir a bola `prey` com a bola `ball` (de quem pede). */
export function judgeSwallow(ball: BallFacts | undefined, prey: BallFacts | undefined, asker: string, rules: NetRules, centerDistance: number, teams?: ReadonlyMap<string, number>): Verdict {
  if (!ball || !prey) return 'gone';
  if (ball.owner !== asker || prey.owner === asker) return 'mine';
  if (ball.burying || prey.burying) return 'burying';
  if (prey.immune || prey.gift) return 'immune';
  if (relation(asker, prey.owner, teams) !== 'rival' || !rules.steal) return 'rules';
  // Um tiquinho de folga no tamanho (o raio que o dono da sala vê está atrasado).
  if (prey.radius > ball.radius * (SWALLOW_RATIO + 0.02)) return 'size';
  if (centerDistance > ball.radius + prey.radius + 1) return 'far';
  return 'ok';
}

/**
 * Fundir a bola `ball` (de quem pede) com a bola `target` de outro jogador.
 * Com rival é doar (a sua entra na dele), e na Disputa não vale.
 */
export function judgeMerge(
  ball: BallFacts | undefined,
  target: BallFacts | undefined,
  asker: string,
  centerDistance: number,
  teams?: ReadonlyMap<string, number>,
  rules: Pick<NetRules, 'mode'> = { mode: 'garden' },
): Verdict {
  if (!ball || !target) return 'gone';
  if (ball.owner !== asker || target.owner === asker) return 'mine';
  if (!canHelp(relation(asker, target.owner, teams), rules)) return 'rules';
  if (ball.burying || target.burying) return 'burying';
  if (centerDistance > ball.radius + target.radius + MERGE_REACH + HOST_REACH_SLACK) return 'far';
  return 'ok';
}

/**
 * Dá pra puxar a bola `target` (de um rival) pra dentro da sua bola `ball`?
 * Tudo menos a distância (quem está puxando confere o encostar; o dono da
 * sala, com folga, em `judgePull`). `loose` = o dono dela não empurra (ou
 * levou trombada): aí vale qualquer tamanho; empurrada, só até o seu.
 */
export function pullBlock(ball: BallFacts | undefined, target: BallFacts | undefined, asker: string, now: number, rules: NetRules, teams?: ReadonlyMap<string, number>, tolerance = 0): Verdict {
  if (!ball || !target) return 'gone';
  if (ball.owner !== asker || target.owner === asker) return 'mine';
  if (ball.burying || target.burying) return 'burying';
  if (target.immune || target.gift) return 'immune';
  // Parceiro não se rouba (com ele é fundir, e a menor entra na maior).
  if (relation(asker, target.owner, teams) !== 'rival' || !rules.steal) return 'rules';
  // Um tiquinho de folga no tamanho (o raio que chega pela rede está atrasado).
  if (!isLoose(target, now, tolerance) && target.radius > ball.radius * 1.02) return 'size';
  return 'ok';
}

/** Dono da sala: puxar a bola `target` pra dentro da bola `ball` (de quem pede). */
export function judgePull(ball: BallFacts | undefined, target: BallFacts | undefined, asker: string, now: number, rules: NetRules, centerDistance: number, teams?: ReadonlyMap<string, number>): Verdict {
  const block = pullBlock(ball, target, asker, now, rules, teams, LOOSE_TOLERANCE);
  if (block !== 'ok') return block;
  if (centerDistance > ball!.radius + target!.radius + MERGE_REACH + PULL_KEEP_SLACK + HOST_REACH_SLACK) return 'far';
  return 'ok';
}

/**
 * Pra onde vai a fusão: com parceiro, a MENOR entra na maior (tanto faz quem
 * apertou: quem está com a bola grande continua empurrando); com rival (Jardim
 * livre), a sua entra na dele (é doar). Devolve [a que some, a que recebe].
 */
export function mergeDirection<T extends { owner: string; radius: number }>(ball: T, target: T, asker: string, teams?: ReadonlyMap<string, number>): [T, T] {
  if (relation(asker, target.owner, teams) === 'team' && ball.radius > target.radius) return [target, ball];
  return [ball, target];
}

/** O que o dono da sala sabe de um besouro pra conferir uma trombada. */
export interface BeetleFacts {
  x: number;
  z: number;
  /** Empurrando uma bola (a dele ou ajudando alguém). */
  pushing: boolean;
  dizzy: boolean;
  /** Relógio da sala da última trombada que ele deu. */
  lastTackleAt: number;
}

export function judgeTackle(by: BeetleFacts | undefined, target: BeetleFacts | undefined, byId: string, targetId: string, now: number, rules: NetRules, teams?: ReadonlyMap<string, number>): Verdict {
  if (!by || !target || byId === targetId) return 'gone';
  if (relation(byId, targetId, teams) !== 'rival' || !rules.steal) return 'rules';
  if (now - by.lastTackleAt < TACKLE_COOLDOWN - LOOSE_TOLERANCE) return 'cooldown';
  if (target.dizzy) return 'dizzy';
  if (!target.pushing) return 'idle';
  if (Math.hypot(by.x - target.x, by.z - target.z) > TACKLE_REACH + HOST_REACH_SLACK) return 'far';
  return 'ok';
}

// --- Parte de cada um na bola ---------------------------------------------------------

/**
 * Parte de cada jogador numa bola, em volume (quem pegou o quê). Não se conta
 * cada coisa engolida: o volume que ninguém "assinou" é de quem está com a bola
 * agora (`settle`). Doar soma as partes; roubar (ou engolir) passa tudo pra quem levou.
 */
export type Shares = Map<string, number>;

/** O volume da bola que ainda não é de ninguém vira de quem está com ela; se ela encolheu (poça), todo mundo encolhe junto. */
export function settleShares(shares: Shares, owner: string, volume: number): void {
  let sum = 0;
  for (const v of shares.values()) sum += v;
  if (volume > sum + 1e-9) shares.set(owner, (shares.get(owner) ?? 0) + volume - sum);
  else if (sum > 0 && volume < sum - 1e-9) {
    const k = Math.max(0, volume) / sum;
    for (const [uid, v] of shares) shares.set(uid, v * k);
  }
}

/** Roubou (ou engoliu): o volume inteiro passa a ser de quem levou. */
export function takeShares(shares: Shares, taker: string, volume: number): void {
  shares.clear();
  shares.set(taker, Math.max(0, volume));
}

/** Doou: as partes da bola doada entram na bola que recebeu. */
export function addShares(into: Shares, from: Shares): void {
  for (const [uid, v] of from) into.set(uid, (into.get(uid) ?? 0) + v);
}

/** Frações (0..1) de cada um, somando 1; quem tem menos de 1% fica de fora (e a parte volta pros outros). */
export function shareFractions(shares: Shares): Array<[string, number]> {
  let sum = 0;
  for (const v of shares.values()) sum += Math.max(0, v);
  if (sum <= 0) return [];
  const kept = [...shares].filter(([, v]) => v / sum >= 0.01);
  const keptSum = kept.reduce((s, [, v]) => s + v, 0);
  return kept.map(([uid, v]) => [uid, Math.round((v / keptSum) * 1000) / 1000]);
}

/** Número novo pra uma bola (32 bits, nunca zero). Aleatório: dois jogadores não combinam, e a chance de repetir é desprezível. */
export function newBallId(): number {
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word);
  while (word[0] === 0);
  return word[0];
}
