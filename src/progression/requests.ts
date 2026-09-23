import type { MessageKey, PluralKey } from '../i18n';
import { CRITTER_IDS, FLOWER_IDS, MUSHROOM_IDS, OBJECT_IDS, zoneIds, type CatalogId } from './catalog';
import { REQUEST_HUES, type Hue } from './colors';
import type { RoundLedger } from './food';

/**
 * Pedidos da rodada: três metas opcionais ("arranque 3 flores", "chegue a
 * 10 cm"...). Ninguém é obrigado a cumprir; quem cumpre ganha comida extra na
 * bola enterrada. É a "lista de tarefas" do Untitled Goose Game com a cara dos
 * pedidos de fã do We Love Katamari: cada pedido vem de um bicho do jardim
 * (a abelha quer flores, o caracol quer cogumelos, a formiga-rainha quer folhas).
 *
 * Todo pedido de coleta trava como cumprido na hora em que a meta é alcançada
 * (a bola derretendo na poça depois não desfaz nada) e paga no próximo enterro.
 * Os DESAFIOS ("enterre sem molhar a bola") só se resolvem no enterro.
 *
 * De vez em quando (nível 3+) um dos pedidos vem do próprio Sol: o pedido
 * dourado, mais difícil e que paga o triplo.
 */

export const REQUESTS_PER_ROUND = 3;

/**
 * Quem faz o pedido: um bicho do jardim (ou o próprio Sol, no pedido dourado).
 * É só personalidade — o formato dos pedidos de fã do We Love Katamari.
 */
export type GiverId = 'bee' | 'snail' | 'frog' | 'antQueen' | 'fly' | 'butterfly' | 'ladybug' | 'grasshopper' | 'worm' | 'elder' | 'sun';

type Family =
  | 'flower'
  | 'mushroom'
  | 'rock'
  | 'log'
  | 'fresh'
  | 'critter'
  | 'debris'
  | 'rareDebris'
  | 'size'
  | 'variety'
  | 'hue'
  | 'object'
  | 'picnic'
  | 'toys'
  | 'gardener'
  | 'dry'
  | 'rain';

export type RequestKind = 'collect' | 'size' | 'variety' | 'hue' | 'challenge';

/** Desafio resolvido no enterro. */
export type Challenge = 'dry' | 'rain';

export interface RoundRequest {
  readonly family: Family;
  readonly kind: RequestKind;
  giver: GiverId;
  /** Texto: plural com `{n}` (coleta, cor e variedade), `req.size` com `{cm}` ou o texto fixo do desafio. */
  readonly label: PluralKey | MessageKey;
  /** Figurinhas que contam (só para coleta). */
  readonly targets: readonly CatalogId[];
  /** Família de cor (só no pedido de cor). */
  readonly hue?: Hue;
  /** Qual desafio (só `kind: 'challenge'`). */
  readonly challenge?: Challenge;
  /** Quantidade pedida (ou o diâmetro em cm, no pedido de tamanho; 1 nos desafios). */
  amount: number;
  /** Comida extra ao cumprir. */
  reward: number;
  /** Pedido dourado (vem do Sol, paga o triplo). */
  golden: boolean;
  progress: number;
  done: boolean;
  /** Desafio que já falhou nesta rodada (ex.: a bola caiu na poça). */
  failed: boolean;
}

type Draft = Pick<RoundRequest, 'kind' | 'label' | 'targets' | 'hue' | 'challenge' | 'amount' | 'reward'> & { giver?: GiverId };

const COMMON_DEBRIS: readonly CatalogId[] = ['leaf', 'pebble', 'twig', 'berry', 'acorn', 'petal', 'clover', 'seed'];
const RARE_DEBRIS: readonly CatalogId[] = ['shell', 'cap'];
const SIZES_CM: readonly number[] = [6, 8, 10, 12, 14, 16, 20];

/** Quem pede cada tralha do chão (a formiga-rainha quer folha, o sapo quer pedrinha...). */
const DEBRIS_GIVERS: Partial<Record<CatalogId, GiverId>> = {
  leaf: 'antQueen',
  twig: 'antQueen',
  seed: 'antQueen',
  pebble: 'frog',
  berry: 'ladybug',
  petal: 'ladybug',
  clover: 'ladybug',
  acorn: 'grasshopper',
  shell: 'snail',
  cap: 'grasshopper',
};

interface Template {
  family: Family;
  giver: GiverId;
  minLevel: number;
  weight: number;
  make(level: number, random: () => number): Draft;
}

const collect = (label: PluralKey, targets: readonly CatalogId[], amount: number, reward: number): Draft => ({ kind: 'collect', label, targets, amount, reward });

/** Pedidos um pouco maiores conforme o nível (+1 a cada 3 níveis, até +2). */
const bumpFor = (level: number) => Math.min(2, Math.floor((level - 1) / 3));
const coin = (random: () => number, chance = 0.5) => (random() < chance ? 1 : 0);
const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)];

const TEMPLATES: readonly Template[] = [
  {
    family: 'flower',
    giver: 'bee',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.flower', FLOWER_IDS, n, 6 + 4 * n);
    },
  },
  {
    family: 'mushroom',
    giver: 'snail',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.mushroom', MUSHROOM_IDS, n, 6 + 4 * n);
    },
  },
  {
    family: 'rock',
    giver: 'frog',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = 1 + (level >= 3 ? coin(random) : 0);
      return collect('req.rock', ['rock'], n, 12 + 10 * n);
    },
  },
  { family: 'log', giver: 'antQueen', minLevel: 3, weight: 1, make: () => collect('req.log', ['log'], 1, 30) },
  {
    family: 'fresh',
    giver: 'fly',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = Math.min(3, 1 + coin(random, 0.4) + (level >= 4 ? 1 : 0));
      return collect('req.fresh', ['freshDung'], n, 8 + 6 * n);
    },
  },
  {
    family: 'critter',
    giver: 'frog',
    minLevel: 2,
    weight: 2,
    make: (level, random) => {
      const n = 1 + coin(random) + (level >= 5 ? 1 : 0);
      return collect('req.critter', CRITTER_IDS, n, 8 + 8 * n);
    },
  },
  {
    family: 'debris',
    giver: 'antQueen',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const target = pick(COMMON_DEBRIS, random);
      const n = 2 + Math.floor(random() * 3) + bumpFor(level);
      return { ...collect(`req.debris.${target}` as PluralKey, [target], n, 4 + 3 * n), giver: DEBRIS_GIVERS[target] };
    },
  },
  {
    family: 'rareDebris',
    giver: 'snail',
    minLevel: 2,
    weight: 1,
    make: (_level, random) => {
      const target = pick(RARE_DEBRIS, random);
      return { ...collect(`req.debris.${target}` as PluralKey, [target], 1, 16), giver: DEBRIS_GIVERS[target] };
    },
  },
  {
    family: 'size',
    giver: 'elder',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const cm = SIZES_CM[Math.min(SIZES_CM.length - 1, coin(random) + Math.floor((level - 1) / 2))];
      return { kind: 'size', label: 'req.size', targets: [], amount: cm, reward: Math.round(cm * 2.5) };
    },
  },
  {
    family: 'variety',
    giver: 'elder',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = 4 + coin(random) + bumpFor(level);
      return { kind: 'variety', label: 'req.variety', targets: [], amount: n, reward: 4 * n };
    },
  },
  {
    family: 'hue',
    giver: 'ladybug',
    minLevel: 2,
    weight: 3,
    make: (level, random) => {
      const hue = pick(REQUEST_HUES, random);
      const n = 3 + coin(random) + bumpFor(level);
      return { kind: 'hue', label: `req.hue.${hue}` as PluralKey, targets: [], hue, amount: n, reward: 5 + 4 * n };
    },
  },
  {
    family: 'object',
    giver: 'grasshopper',
    minLevel: 2,
    weight: 2,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.object', OBJECT_IDS, n, 8 + 6 * n);
    },
  },
  {
    family: 'picnic',
    giver: 'antQueen',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = 3 + coin(random) + bumpFor(level);
      return collect('req.zone.picnic', zoneIds('picnic'), n, 4 + 3 * n);
    },
  },
  {
    family: 'toys',
    giver: 'butterfly',
    minLevel: 3,
    weight: 2,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.zone.toys', zoneIds('toys'), n, 8 + 7 * n);
    },
  },
  {
    family: 'gardener',
    giver: 'worm',
    minLevel: 5,
    weight: 1,
    make: (level) => {
      const n = level >= 8 ? 2 : 1;
      return collect('req.zone.gardener', zoneIds('gardener'), n, 20 + 18 * n);
    },
  },
  { family: 'dry', giver: 'bee', minLevel: 2, weight: 1, make: () => ({ kind: 'challenge', label: 'req.dry', targets: [], challenge: 'dry', amount: 1, reward: 25 }) },
  { family: 'rain', giver: 'worm', minLevel: 4, weight: 1, make: () => ({ kind: 'challenge', label: 'req.rain', targets: [], challenge: 'rain', amount: 1, reward: 30 }) },
];

/**
 * Famílias que dá pra cumprir com bola pequena. Uma delas sempre entra: sem
 * isso, um jogador novo podia tirar três pedidos que só uma bola de 10 cm cumpre.
 */
const EASY_FAMILIES: ReadonlySet<Family> = new Set(['debris', 'size', 'variety', 'fresh', 'picnic']);

/** A partir de que nível o Sol pode aparecer, e com que chance por rodada. */
const GOLDEN_MIN_LEVEL = 3;
const GOLDEN_CHANCE = 0.2;

/** Sorteia os pedidos da rodada (famílias diferentes, só o que o nível já alcança, um deles fácil). */
export function drawRequests(level: number, random: () => number, count = REQUESTS_PER_ROUND): RoundRequest[] {
  const pool = TEMPLATES.filter((template) => template.minLevel <= level);
  const picked: RoundRequest[] = [];
  const take = (candidates: readonly Template[]) => {
    const total = candidates.reduce((sum, template) => sum + template.weight, 0);
    let roll = random() * total;
    let index = 0;
    while (index < candidates.length - 1 && roll >= candidates[index].weight) {
      roll -= candidates[index].weight;
      index++;
    }
    const template = candidates[index];
    pool.splice(pool.indexOf(template), 1);
    const { giver, ...draft } = template.make(level, random);
    picked.push({ family: template.family, giver: giver ?? template.giver, ...draft, golden: false, progress: 0, done: false, failed: false });
  };
  const easy = pool.filter((template) => EASY_FAMILIES.has(template.family));
  if (easy.length > 0 && count > 0) take(easy);
  while (picked.length < count && pool.length > 0) take(pool);

  if (level >= GOLDEN_MIN_LEVEL && random() < GOLDEN_CHANCE) {
    // O dourado nunca é o fácil nem um desafio (desafio não tem "mais difícil").
    const candidates = picked.filter((r) => r.kind !== 'challenge' && !EASY_FAMILIES.has(r.family));
    if (candidates.length > 0) makeGolden(pick(candidates, random));
  }

  // O fácil não fica sempre em primeiro na lista (Fisher-Yates).
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

/** Pedido do Sol: bem mais difícil, paga o triplo (e mais um tanto). */
function makeGolden(request: RoundRequest): void {
  request.giver = 'sun';
  request.golden = true;
  request.amount = request.kind === 'size' ? Math.min(30, request.amount + 6) : Math.ceil(request.amount * 1.6);
  request.reward = request.reward * 3 + 20;
}

/** Atualiza o progresso; devolve true se o pedido acabou de ser cumprido. */
export function updateRequest(request: RoundRequest, ledger: RoundLedger, ballCm: number): boolean {
  if (request.done || request.kind === 'challenge') return false;
  switch (request.kind) {
    case 'collect':
      request.progress = Math.min(request.amount, ledger.sum(request.targets));
      break;
    case 'size':
      request.progress = Math.min(request.amount, Math.floor(ballCm));
      break;
    case 'variety':
      request.progress = Math.min(request.amount, ledger.kinds);
      break;
    case 'hue':
      request.progress = Math.min(request.amount, request.hue ? ledger.hueCount(request.hue) : 0);
      break;
  }
  if (request.progress < request.amount) return false;
  request.done = true;
  return true;
}

/** O que o enterro sabe pra resolver os desafios. */
export interface BurialConditions {
  /** A bola encostou em água de poça nesta rodada. */
  wet: boolean;
  /** Estava chovendo no enterro. */
  raining: boolean;
}

/** Resolve os desafios no enterro; devolve os que acabaram de ser cumpridos. */
export function resolveChallenges(requests: readonly RoundRequest[], conditions: BurialConditions): RoundRequest[] {
  const done: RoundRequest[] = [];
  for (const request of requests) {
    if (request.kind !== 'challenge' || request.done) continue;
    const ok = request.challenge === 'dry' ? !conditions.wet : conditions.raining;
    if (!ok) {
      request.failed = true;
      continue;
    }
    request.progress = 1;
    request.done = true;
    done.push(request);
  }
  return done;
}

/** A bola molhou: o desafio "sem molhar" falha na hora (o HUD risca). Devolve true se algum falhou agora. */
export function failDryChallenge(requests: readonly RoundRequest[]): boolean {
  let changed = false;
  for (const request of requests) {
    if (request.challenge !== 'dry' || request.done || request.failed) continue;
    request.failed = true;
    changed = true;
  }
  return changed;
}
