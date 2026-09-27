import type { LookKey } from './looks';
import type { Rarity, SeasonId } from './unlocks';

/**
 * Passe da temporada: uma trilha de níveis com prêmios (moedas, orvalho, baús
 * e visuais exclusivos da temporada) que se sobe jogando e cumprindo os
 * desafios dela. Cada temporada tem começo e fim; depois do fim o XP para de
 * contar e os exclusivos saem de circulação (os níveis já alcançados ainda dá
 * pra pegar).
 *
 * Temporada nova = mais uma entrada em `SEASONS` (e os visuais dela com
 * `unlock: { pass: '<id>' }`).
 */

/** Contadores da temporada (só o que aconteceu DURANTE ela). */
export type PassCounter =
  | 'buried'
  | 'bigBall'
  | 'requests'
  | 'golden'
  | 'flowers'
  | 'critters'
  | 'feast'
  | 'webs'
  | 'rainBury'
  | 'roll'
  | 'days';

export const PASS_COUNTERS: readonly PassCounter[] = ['buried', 'bigBall', 'requests', 'golden', 'flowers', 'critters', 'feast', 'webs', 'rainBury', 'roll', 'days'];

export type PassReward = { readonly coins: number } | { readonly dew: number } | { readonly chest: Rarity } | { readonly look: LookKey };

export interface SeasonTier {
  readonly tier: number;
  readonly rewards: readonly PassReward[];
}

/** Desafio da temporada: bater a meta de um contador paga XP do passe (uma vez). */
export interface SeasonChallenge {
  readonly id: string;
  readonly counter: PassCounter;
  readonly goal: number;
  readonly xp: number;
}

export interface SeasonDef {
  readonly id: SeasonId;
  /** Começo e fim (ISO com fuso). */
  readonly starts: string;
  readonly ends: string;
  /** XP pra passar de um nível do passe pro próximo. */
  readonly xpPerTier: number;
  readonly tiers: readonly SeasonTier[];
  readonly challenges: readonly SeasonChallenge[];
}

// --- como se ganha XP do passe ------------------------------------------------------

/** Bola enterrada: base + por centímetro de diâmetro. */
export const PASS_XP_BURY_BASE = 30;
export const PASS_XP_PER_CM = 4;
/** Pedido cumprido (o dourado, do Sol, paga o extra por cima). */
export const PASS_XP_REQUEST = 25;
export const PASS_XP_GOLDEN_EXTRA = 60;
/** Primeiro enterro do dia. */
export const PASS_XP_DAILY = 100;
/** Conquista feita durante a temporada. */
export const PASS_XP_ACHIEVEMENT = 40;

/** XP do passe por uma bola enterrada de `cm` de diâmetro (sem os pedidos). */
export const passXpForBurial = (cm: number) => Math.round(PASS_XP_BURY_BASE + Math.max(0, cm) * PASS_XP_PER_CM);

// --- temporadas ------------------------------------------------------------------------

/**
 * Temporada 1 — Florada (primavera no jardim): de 27/09 até 27/10/2026, fim
 * do dia no horário de Brasília. Vinte níveis, meio difíceis de propósito: dá
 * pra fechar jogando com frequência o mês todo, não numa tarde.
 */
const FLORADA: SeasonDef = {
  id: 'florada',
  starts: '2026-09-27T00:00:00-03:00',
  ends: '2026-10-27T23:59:59-03:00',
  xpPerTier: 500,
  tiers: [
    { tier: 1, rewards: [{ look: 'acc:sprout' }] },
    { tier: 2, rewards: [{ coins: 150 }] },
    { tier: 3, rewards: [{ chest: 'common' }] },
    { tier: 4, rewards: [{ dew: 15 }] },
    { tier: 5, rewards: [{ look: 'skin:honey' }] },
    { tier: 6, rewards: [{ coins: 250 }] },
    { tier: 7, rewards: [{ look: 'acc:mushroomCap' }] },
    { tier: 8, rewards: [{ chest: 'rare' }] },
    { tier: 9, rewards: [{ look: 'acc:daisyGlasses' }] },
    { tier: 10, rewards: [{ dew: 30 }] },
    { tier: 11, rewards: [{ coins: 350 }] },
    { tier: 12, rewards: [{ look: 'skin:sakura' }] },
    { tier: 13, rewards: [{ chest: 'rare' }] },
    { tier: 14, rewards: [{ look: 'acc:petalCollar' }] },
    { tier: 15, rewards: [{ dew: 50 }] },
    { tier: 16, rewards: [{ coins: 500 }] },
    { tier: 17, rewards: [{ look: 'acc:kite' }] },
    { tier: 18, rewards: [{ chest: 'epic' }] },
    { tier: 19, rewards: [{ dew: 80 }] },
    { tier: 20, rewards: [{ look: 'skin:sunflower' }, { chest: 'legendary' }] },
  ],
  challenges: [
    { id: 'bury10', counter: 'buried', goal: 10, xp: 400 },
    { id: 'bury40', counter: 'buried', goal: 40, xp: 900 },
    { id: 'big20', counter: 'bigBall', goal: 20, xp: 500 },
    { id: 'requests30', counter: 'requests', goal: 30, xp: 600 },
    { id: 'golden3', counter: 'golden', goal: 3, xp: 600 },
    { id: 'flowers60', counter: 'flowers', goal: 60, xp: 500 },
    { id: 'critters25', counter: 'critters', goal: 25, xp: 500 },
    { id: 'feast6', counter: 'feast', goal: 6, xp: 400 },
    { id: 'webs10', counter: 'webs', goal: 10, xp: 300 },
    { id: 'rain3', counter: 'rainBury', goal: 3, xp: 400 },
    // 15 mil unidades ≈ 300 m de bola rolando.
    { id: 'roll300', counter: 'roll', goal: 15000, xp: 400 },
    { id: 'days7', counter: 'days', goal: 7, xp: 800 },
  ],
};

export const SEASONS: readonly SeasonDef[] = [FLORADA];

const BY_ID = new Map<SeasonId, SeasonDef>(SEASONS.map((s) => [s.id, s]));

export function season(id: SeasonId): SeasonDef {
  return BY_ID.get(id)!;
}

export function isSeasonId(value: string): value is SeasonId {
  return BY_ID.has(value as SeasonId);
}

/** Começo e fim em ms (lidos uma vez: a temporada é consultada a cada passo da física). */
const bounds = new Map<SeasonId, { start: number; end: number }>(SEASONS.map((s) => [s.id, { start: Date.parse(s.starts), end: Date.parse(s.ends) }]));

export const seasonStart = (def: SeasonDef) => bounds.get(def.id)!.start;
export const seasonEnd = (def: SeasonDef) => bounds.get(def.id)!.end;

export function isSeasonActive(def: SeasonDef, now: number): boolean {
  return now >= seasonStart(def) && now <= seasonEnd(def);
}

/**
 * Temporada que o painel mostra: a que está valendo agora ou, entre uma e
 * outra, a última que já começou (encerrada). Null antes da primeira.
 */
export function shownSeason(now: number): SeasonDef | null {
  let latest: SeasonDef | null = null;
  for (const def of SEASONS) {
    if (seasonStart(def) > now) continue;
    if (!latest || seasonStart(def) > seasonStart(latest)) latest = def;
  }
  return latest;
}

export const maxTier = (def: SeasonDef) => def.tiers.length;

/** Nível do passe pra um total de XP (0 = nenhum ainda), com o que falta pro próximo. */
export function tierFor(def: SeasonDef, totalXp: number): { tier: number; into: number; needed: number } {
  const top = maxTier(def);
  const tier = Math.min(top, Math.floor(Math.max(0, totalXp) / def.xpPerTier));
  const into = tier >= top ? def.xpPerTier : Math.max(0, totalXp) - tier * def.xpPerTier;
  return { tier, into, needed: def.xpPerTier };
}

export function tierRewards(def: SeasonDef, tier: number): readonly PassReward[] {
  return def.tiers.find((t) => t.tier === tier)?.rewards ?? [];
}

/** Em que temporada e nível do passe um visual é prêmio (null = não é do passe). */
export function passTierOf(look: LookKey): { season: SeasonDef; tier: number } | null {
  for (const def of SEASONS) {
    for (const t of def.tiers) if (t.rewards.some((r) => 'look' in r && r.look === look)) return { season: def, tier: t.tier };
  }
  return null;
}

/** Dia local (AAAA-MM-DD) de um instante: é o que conta pro "primeiro enterro do dia". */
export function localDay(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
