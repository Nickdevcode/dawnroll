import type { PluralKey } from '../i18n';
import { FLOWER_IDS, MUSHROOM_IDS, type CatalogId } from './catalog';
import type { RoundLedger } from './food';

/**
 * Pedidos da rodada: três metas opcionais ("arranque 3 flores", "chegue a
 * 10 cm"...). Ninguém é obrigado a cumprir; quem cumpre ganha comida extra na
 * bola enterrada. É a "lista de tarefas" do Untitled Goose Game: só aponta
 * coisas divertidas que o jogador já podia fazer.
 *
 * Todo pedido trava como cumprido na hora em que a meta é alcançada (a bola
 * derretendo na poça depois não desfaz nada) e paga no próximo enterro.
 */

export const REQUESTS_PER_ROUND = 3;

type Family = 'flower' | 'mushroom' | 'rock' | 'log' | 'fresh' | 'pillbug' | 'debris' | 'rareDebris' | 'size' | 'variety';

export type RequestKind = 'collect' | 'size' | 'variety';

export interface RoundRequest {
  readonly family: Family;
  readonly kind: RequestKind;
  /** Texto: plural com `{n}` (coleta e variedade) ou `req.size` com `{cm}`. */
  readonly label: PluralKey | 'req.size';
  /** Figurinhas que contam (só para coleta). */
  readonly targets: readonly CatalogId[];
  /** Quantidade pedida (ou o diâmetro em cm, no pedido de tamanho). */
  readonly amount: number;
  /** Comida extra ao cumprir. */
  readonly reward: number;
  progress: number;
  done: boolean;
}

const COMMON_DEBRIS: readonly CatalogId[] = ['leaf', 'pebble', 'twig', 'berry', 'acorn', 'petal', 'clover', 'seed'];
const RARE_DEBRIS: readonly CatalogId[] = ['shell', 'cap'];
const SIZES_CM: readonly number[] = [6, 8, 10, 12, 14, 16];

interface Template {
  family: Family;
  minLevel: number;
  weight: number;
  make(level: number, random: () => number): Omit<RoundRequest, 'family' | 'progress' | 'done'>;
}

const collect = (label: PluralKey, targets: readonly CatalogId[], amount: number, reward: number) =>
  ({ kind: 'collect', label, targets, amount, reward }) as const;

/** Pedidos um pouco maiores conforme o nível (+1 a cada 3 níveis, até +2). */
const bumpFor = (level: number) => Math.min(2, Math.floor((level - 1) / 3));
const coin = (random: () => number, chance = 0.5) => (random() < chance ? 1 : 0);

const TEMPLATES: readonly Template[] = [
  {
    family: 'flower',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.flower', FLOWER_IDS, n, 6 + 4 * n);
    },
  },
  {
    family: 'mushroom',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const n = 2 + coin(random) + bumpFor(level);
      return collect('req.mushroom', MUSHROOM_IDS, n, 6 + 4 * n);
    },
  },
  {
    family: 'rock',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = 1 + (level >= 3 ? coin(random) : 0);
      return collect('req.rock', ['rock'], n, 12 + 10 * n);
    },
  },
  { family: 'log', minLevel: 3, weight: 1, make: () => collect('req.log', ['log'], 1, 30) },
  {
    family: 'fresh',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = Math.min(3, 1 + coin(random, 0.4) + (level >= 4 ? 1 : 0));
      return collect('req.fresh', ['freshDung'], n, 8 + 6 * n);
    },
  },
  { family: 'pillbug', minLevel: 2, weight: 1, make: () => collect('req.pillbug', ['pillbug'], 1, 18) },
  {
    family: 'debris',
    minLevel: 1,
    weight: 3,
    make: (level, random) => {
      const target = COMMON_DEBRIS[Math.floor(random() * COMMON_DEBRIS.length)];
      const n = 2 + Math.floor(random() * 3) + bumpFor(level);
      return collect(`req.debris.${target}` as PluralKey, [target], n, 4 + 3 * n);
    },
  },
  {
    family: 'rareDebris',
    minLevel: 2,
    weight: 1,
    make: (_level, random) => {
      const target = RARE_DEBRIS[Math.floor(random() * RARE_DEBRIS.length)];
      return collect(`req.debris.${target}` as PluralKey, [target], 1, 16);
    },
  },
  {
    family: 'size',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const cm = SIZES_CM[Math.min(SIZES_CM.length - 1, coin(random) + Math.floor((level - 1) / 2))];
      return { kind: 'size', label: 'req.size', targets: [], amount: cm, reward: Math.round(cm * 2.5) };
    },
  },
  {
    family: 'variety',
    minLevel: 1,
    weight: 2,
    make: (level, random) => {
      const n = 4 + coin(random) + bumpFor(level);
      return { kind: 'variety', label: 'req.variety', targets: [], amount: n, reward: 4 * n };
    },
  },
];

/**
 * Famílias que dá pra cumprir com bola pequena. Uma delas sempre entra: sem
 * isso, um jogador novo podia tirar três pedidos que só uma bola de 10 cm cumpre.
 */
const EASY_FAMILIES: ReadonlySet<Family> = new Set(['debris', 'size', 'variety', 'fresh']);

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
    picked.push({ family: template.family, ...template.make(level, random), progress: 0, done: false });
  };
  const easy = pool.filter((template) => EASY_FAMILIES.has(template.family));
  if (easy.length > 0 && count > 0) take(easy);
  while (picked.length < count && pool.length > 0) take(pool);
  // O fácil não fica sempre em primeiro na lista (Fisher-Yates).
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

/** Atualiza o progresso; devolve true se o pedido acabou de ser cumprido. */
export function updateRequest(request: RoundRequest, ledger: RoundLedger, ballCm: number): boolean {
  if (request.done) return false;
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
  }
  if (request.progress < request.amount) return false;
  request.done = true;
  return true;
}
