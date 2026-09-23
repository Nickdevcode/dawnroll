import { smoothstep } from '../utils/math';

/**
 * Poderes da rodada. A cada marco de tamanho o jogador escolhe 1 entre 3 do que
 * o nível dele já liberou; tudo volta ao zero na rodada seguinte.
 *
 * Regra de design: poder bom muda o JEITO de jogar (grudar de longe, arrancar
 * coisa maior, achar os montinhos raros...), não só um número. Velocidade pura
 * encurta a fase de bola pequena, que é o contraste que dá graça ao jogo — por
 * isso o que mexe em velocidade aqui é condicional (esquenta empurrando, ou só
 * vale com bola pequena) e o bônus fixo de nível tem teto baixo.
 */

export type PerkId = 'sticky' | 'hotBlood' | 'mudShell' | 'nose' | 'sneaky' | 'horned';

export interface PerkDef {
  readonly id: PerkId;
  /** Nível em que o poder entra no sorteio. */
  readonly unlockLevel: number;
}

export const PERKS: readonly PerkDef[] = [
  { id: 'sticky', unlockLevel: 1 },
  { id: 'hotBlood', unlockLevel: 1 },
  { id: 'mudShell', unlockLevel: 1 },
  { id: 'nose', unlockLevel: 2 },
  { id: 'sneaky', unlockLevel: 3 },
  { id: 'horned', unlockLevel: 4 },
];

/** Diâmetros (cm) em que a rodada oferece um poder. */
export const PERK_MILESTONES_CM: readonly number[] = [5, 10, 16];

/** Quantas opções aparecem de uma vez. */
export const PERK_CHOICES = 3;

/** Segundos empurrando sem parar até o Sangue quente chegar no máximo. */
export const HEAT_RISE_SECONDS = 5;
/** Quão rápido esfria quando para de empurrar (por segundo). */
export const HEAT_DECAY_PER_SECOND = 1.5;

/** Chance de um montinho renascer fresquinho com o Faro ativo (sem ele, ver `Collectibles`). */
export const NOSE_FRESH_CHANCE = 0.25;
/** Montinhos comuns que viram fresquinhos na hora em que o Faro é escolhido. */
export const NOSE_PROMOTE_COUNT = 3;

/**
 * Multiplicadores que o jogo aplica a cada passo fixo. 1 (ou 0, nos aditivos)
 * = sem efeito. Nível, poderes da rodada e o calor do Sangue quente somam aqui.
 */
export interface Modifiers {
  /** Força ao empurrar (aceleração máxima da bola). */
  push: number;
  /** Velocidade máxima da bola empurrada. */
  pushSpeed: number;
  /** Rapidez de virar a bola. */
  turn: number;
  /** Velocidade andando/correndo sem a bola. */
  walk: number;
  /** Arranca objetos até `raio da bola × pluckReach`. */
  pluckReach: number;
  /** Alcance extra (unidades do mundo) para montinho e detrito grudarem. */
  magnet: number;
  /** Derretimento na poça. */
  melt: number;
  /** Freio da água na bola. */
  waterDrag: number;
  /** Lama que gruda na terra molhada. */
  mud: number;
  /** Quanto a água na canela atrasa o besouro. */
  wade: number;
}

export function neutralModifiers(): Modifiers {
  return { push: 1, pushSpeed: 1, turn: 1, walk: 1, pluckReach: 1, magnet: 0, melt: 1, waterDrag: 1, mud: 1, wade: 1 };
}

/**
 * Soma tudo num retrato só. `bonus` é o do nível (frações: 0,12 = +12%),
 * `heat` é o calor do Sangue quente (0..1) e `ballRadius` decide o quanto o
 * Sorrateiro ainda ajuda (ele é bom com bola pequena).
 */
export function computeModifiers(
  bonus: { push: number; speed: number },
  perks: ReadonlySet<PerkId>,
  heat: number,
  ballRadius: number,
  out: Modifiers = neutralModifiers(),
): Modifiers {
  out.push = 1 + bonus.push;
  out.pushSpeed = 1 + bonus.speed;
  out.walk = 1 + bonus.speed;
  out.turn = 1;
  out.pluckReach = 1;
  out.magnet = 0;
  out.melt = 1;
  out.waterDrag = 1;
  out.mud = 1;
  out.wade = 1;

  if (perks.has('sticky')) out.magnet = 0.4 + ballRadius * 0.3;
  if (perks.has('hotBlood')) {
    out.push *= 1 + 0.35 * heat;
    out.pushSpeed *= 1 + 0.3 * heat;
  }
  if (perks.has('mudShell')) {
    out.melt = 0.3;
    out.waterDrag = 0.5;
    out.mud = 2.5;
    out.wade = 0.4;
  }
  if (perks.has('sneaky')) {
    // Ágil com bola pequena (até ~5 cm), perdendo o efeito até ~12 cm.
    const agility = 1 - smoothstep(1.2, 3, ballRadius);
    out.turn *= 1.15 + 0.55 * agility;
    out.push *= 1 + 0.35 * agility;
    out.walk *= 1.12;
  }
  if (perks.has('horned')) {
    out.pluckReach = 1.25;
    out.turn *= 0.78;
  }
  return out;
}

/** Sorteia até `count` poderes diferentes entre os disponíveis. */
export function drawPerkOffer(available: readonly PerkId[], random: () => number, count = PERK_CHOICES): PerkId[] {
  const pool = [...available];
  const offer: PerkId[] = [];
  while (offer.length < count && pool.length > 0) {
    const i = Math.floor(random() * pool.length);
    offer.push(pool.splice(i, 1)[0]);
  }
  return offer;
}
