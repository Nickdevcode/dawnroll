import { clamp, smoothstep } from '../utils/math';

/**
 * Poderes da rodada. A cada marco de tamanho o jogador escolhe 1 entre 3 do que
 * o nível dele já liberou; tudo volta ao zero na rodada seguinte. Um poder que
 * aparece de novo na mesma rodada pode ser pego outra vez e vira ★★ (a versão
 * mais forte dele) — assim a escolha não é só "pegar o que falta".
 *
 * Regra de design: poder bom muda o JEITO de jogar (grudar de longe, arrancar
 * coisa maior, usar o morro, andar em cima da bola...), não só um número.
 * Velocidade pura encurta a fase de bola pequena, que é o contraste que dá graça
 * ao jogo — por isso o que mexe em velocidade aqui é condicional (esquenta
 * empurrando, só vale com bola pequena, só ladeira abaixo) e o bônus fixo de
 * nível tem teto baixo.
 */

export type PerkId =
  | 'sticky'
  | 'hotBlood'
  | 'mudShell'
  | 'nose'
  | 'rider'
  | 'sneaky'
  | 'horned'
  | 'downhill'
  | 'bump'
  | 'curious'
  | 'antFriend'
  | 'stench'
  | 'rainCall';

/** 1 = normal, 2 = ★★ (pego duas vezes na mesma rodada). */
export type PerkRank = 1 | 2;

export const MAX_PERK_RANK: PerkRank = 2;

export interface PerkDef {
  readonly id: PerkId;
  /** Nível em que o poder entra no sorteio. */
  readonly unlockLevel: number;
  /** Poder de usar apertando um botão (com duração e recarga), não passivo. */
  readonly active?: boolean;
}

export const PERKS: readonly PerkDef[] = [
  { id: 'sticky', unlockLevel: 1 },
  { id: 'hotBlood', unlockLevel: 1 },
  { id: 'mudShell', unlockLevel: 1 },
  { id: 'nose', unlockLevel: 2 },
  { id: 'rider', unlockLevel: 2, active: true },
  { id: 'sneaky', unlockLevel: 3 },
  { id: 'horned', unlockLevel: 4 },
  { id: 'downhill', unlockLevel: 5 },
  { id: 'bump', unlockLevel: 5 },
  { id: 'curious', unlockLevel: 6 },
  { id: 'antFriend', unlockLevel: 6 },
  { id: 'stench', unlockLevel: 7 },
  { id: 'rainCall', unlockLevel: 8 },
];

const PERK_IDS = new Set<string>(PERKS.map((perk) => perk.id));

export function isPerkId(value: string): value is PerkId {
  return PERK_IDS.has(value);
}

/** Diâmetros (cm) em que a rodada oferece um poder. */
export const PERK_MILESTONES_CM: readonly number[] = [5, 10, 16];

/** Quantas opções aparecem de uma vez. */
export const PERK_CHOICES = 3;

/** Uma carta da escolha: o poder e o nível que ele vai ter se for pego. */
export interface PerkOffer {
  id: PerkId;
  rank: PerkRank;
}

/** Segundos empurrando sem parar até o Sangue quente chegar no máximo (★★ esquenta mais rápido). */
export const heatRiseSeconds = (rank: PerkRank): number => (rank === 2 ? 3 : 5);
/** Quão rápido esfria quando para de empurrar (por segundo). */
export const HEAT_DECAY_PER_SECOND = 1.5;

/** Chance de um montinho renascer fresquinho com o Faro ativo (sem ele, ver `Collectibles`). */
export const noseFreshChance = (rank: PerkRank): number => (rank === 2 ? 0.4 : 0.25);
/** Montinhos comuns que viram fresquinhos na hora em que o Faro é escolhido (e de novo no ★★). */
export const NOSE_PROMOTE_COUNT = 3;

/** Equilibrista: quanto tempo o besouro fica em cima da bola e quanto demora pra recarregar (segundos). */
export const riderDuration = (rank: PerkRank): number => (rank === 2 ? 11 : 7);
export const riderCooldown = (rank: PerkRank): number => (rank === 2 ? 10 : 16);

/** Trombada: força mínima da batida (0..1) e quantas coisas caem do objeto grande demais. */
export const bumpThreshold = (rank: PerkRank): number => (rank === 2 ? 0.3 : 0.45);
export const bumpShed = (rank: PerkRank): number => (rank === 2 ? 4 : 2);

/** Curioso: estirão (fração do volume atual da bola) a cada tipo novo de coisa na rodada. */
export const curiousGrowth = (rank: PerkRank): number => (rank === 2 ? 0.07 : 0.04);

/** Formigueiro amigo: raio (unidades) em que as formigas trazem folha e quantas por vez. */
export const antFriendRadius = (rank: PerkRank): number => (rank === 2 ? 10 : 6);
export const antFriendBatch = (rank: PerkRank): number => (rank === 2 ? 2 : 1);

/** Cheiro de chuva: a lama engorda mais (além da Casca de lama, se tiver). */
export const rainCallMud = (rank: PerkRank): number => (rank === 2 ? 2 : 1.4);

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
  /** Ladeira abaixo: fração extra da gravidade, ao longo do declive, que empurra a bola (0 = nada). */
  slopeAssist: number;
}

export function neutralModifiers(): Modifiers {
  return { push: 1, pushSpeed: 1, turn: 1, walk: 1, pluckReach: 1, magnet: 0, melt: 1, waterDrag: 1, mud: 1, wade: 1, slopeAssist: 0 };
}

/**
 * Soma tudo num retrato só. `bonus` é o do nível (frações: 0,12 = +12%),
 * `heat` é o calor do Sangue quente (0..1), `ballRadius` decide o quanto o
 * Sorrateiro ainda ajuda (ele é bom com bola pequena) e `ballSpeed` é o embalo
 * que a Ladeira abaixo transforma em alcance de arrancar.
 */
export function computeModifiers(
  bonus: { push: number; speed: number },
  perks: ReadonlyMap<PerkId, PerkRank>,
  heat: number,
  ballRadius: number,
  ballSpeed = 0,
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
  out.slopeAssist = 0;

  const sticky = perks.get('sticky');
  if (sticky) out.magnet = (0.4 + ballRadius * 0.3) * (sticky === 2 ? 1.8 : 1);

  const hotBlood = perks.get('hotBlood');
  if (hotBlood) {
    out.push *= 1 + (hotBlood === 2 ? 0.5 : 0.35) * heat;
    out.pushSpeed *= 1 + (hotBlood === 2 ? 0.45 : 0.3) * heat;
  }

  const mudShell = perks.get('mudShell');
  if (mudShell) {
    const strong = mudShell === 2;
    out.melt = strong ? 0.1 : 0.3;
    out.waterDrag = strong ? 0.35 : 0.5;
    out.mud = strong ? 3.5 : 2.5;
    out.wade = strong ? 0.25 : 0.4;
  }

  const sneaky = perks.get('sneaky');
  if (sneaky) {
    // Ágil com bola pequena, perdendo o efeito até ~12 cm (★★: até ~17 cm).
    const agility = sneaky === 2 ? 1 - smoothstep(1.8, 4.2, ballRadius) : 1 - smoothstep(1.2, 3, ballRadius);
    out.turn *= 1.15 + 0.55 * agility;
    out.push *= 1 + (sneaky === 2 ? 0.5 : 0.35) * agility;
    out.walk *= 1.12;
  }

  const horned = perks.get('horned');
  if (horned) {
    out.pluckReach = horned === 2 ? 1.45 : 1.25;
    out.turn *= horned === 2 ? 0.85 : 0.78;
  }

  const downhill = perks.get('downhill');
  if (downhill) {
    out.slopeAssist = downhill === 2 ? 1.5 : 0.9;
    // O embalo arranca coisa maior: a partir de ~2,5 u/s, até +20% (★★: +35%).
    const momentum = clamp((ballSpeed - 2.5) / 6, 0, 1);
    out.pluckReach *= 1 + momentum * (downhill === 2 ? 0.35 : 0.2);
  }

  const rainCall = perks.get('rainCall');
  if (rainCall) out.mud *= rainCallMud(rainCall);

  return out;
}

/**
 * Sorteia até `count` cartas diferentes entre os poderes disponíveis. `ranks`
 * diz o que já foi pego na rodada: pego uma vez, ele pode voltar como ★★;
 * pego duas, sai do sorteio.
 */
export function drawPerkOffer(
  available: readonly PerkId[],
  ranks: ReadonlyMap<PerkId, PerkRank>,
  random: () => number,
  count = PERK_CHOICES,
): PerkOffer[] {
  const pool = available.filter((id) => (ranks.get(id) ?? 0) < MAX_PERK_RANK);
  const offer: PerkOffer[] = [];
  while (offer.length < count && pool.length > 0) {
    const i = Math.floor(random() * pool.length);
    const id = pool.splice(i, 1)[0];
    offer.push({ id, rank: ranks.has(id) ? 2 : 1 });
  }
  return offer;
}
