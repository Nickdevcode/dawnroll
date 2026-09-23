import { PERKS, type PerkId } from './perks';

/**
 * Nível do besouro. A experiência vem de comer o que está guardado na toca.
 *
 * Curva: `20 × nível^1,3` (arredondado de 5 em 5). A primeira bola enterrada já
 * sobe pro nível 2 (o jogador precisa ver o sistema funcionar na primeira
 * rodada); depois uma rodada boa rende de meio a dois níveis.
 *
 * Cada nível deixa o besouro um pouco mais forte e mais rápido, com teto: o
 * teto chega no nível 11 e dali em diante subir de nível é só orgulho (e os
 * poderes já estão todos liberados desde o nível 4).
 */

export const PUSH_BONUS_PER_LEVEL = 0.04;
export const PUSH_BONUS_CAP = 0.4;
export const SPEED_BONUS_PER_LEVEL = 0.02;
export const SPEED_BONUS_CAP = 0.2;
/** Teto de segurança (save editado à mão não vira nível absurdo). */
export const MAX_LEVEL = 99;

export interface LevelInfo {
  level: number;
  /** Experiência já feita dentro do nível atual. */
  into: number;
  /** Experiência que o nível atual pede até o próximo. */
  needed: number;
}

/** Experiência para sair de `level` e chegar no seguinte. */
export function xpToNext(level: number): number {
  return Math.max(5, Math.round((20 * Math.pow(level, 1.3)) / 5) * 5);
}

export function levelInfo(totalXp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, needed: xpToNext(level) };
}

/** Bônus fixo do nível, em frações (0,12 = +12%). */
export function levelBonuses(level: number): { push: number; speed: number } {
  const steps = Math.max(0, level - 1);
  return {
    push: Math.min(PUSH_BONUS_CAP, steps * PUSH_BONUS_PER_LEVEL),
    speed: Math.min(SPEED_BONUS_CAP, steps * SPEED_BONUS_PER_LEVEL),
  };
}

export function unlockedPerks(level: number): PerkId[] {
  return PERKS.filter((perk) => perk.unlockLevel <= level).map((perk) => perk.id);
}

/** Poderes que entram no sorteio exatamente ao chegar em `level`. */
export function perksUnlockedAt(level: number): PerkId[] {
  return PERKS.filter((perk) => perk.unlockLevel === level).map((perk) => perk.id);
}
