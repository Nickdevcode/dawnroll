import { isAchievementId, type AchievementId } from '../progression/achievements';
import { isCatalogId, type CatalogId } from '../progression/catalog';
import { PANTRY_CAPACITY } from '../progression/food';
import { isPerkId, type PerkId } from '../progression/perks';
import { DEFAULT_SKIN, isSkinId, type SkinId } from '../progression/skins';

/**
 * Progresso salvo no próprio navegador (localStorage): recorde, bolas
 * enterradas, experiência, a despensa da toca, o catálogo e as conquistas. Tudo validado na
 * leitura — dado corrompido ou editado à mão vira zero, nunca quebra o jogo.
 * Em aba anônima/bloqueada, só não salva.
 *
 * Os campos da toca entraram depois do recorde, e o casco e os contadores
 * depois deles: save antigo (sem esses campos) abre normal, com o que faltar zerado.
 */

/** Contadores que atravessam as rodadas (conquistas de "N vezes"). */
export interface SaveStats {
  /** Pedidos cumpridos no total. */
  requestsDone: number;
  /** Teias de aranha rasgadas no total. */
  websTorn: number;
}

/** Bola guardada na despensa, esperando ser comida. */
export interface PantryBall {
  /** Diâmetro em cm. */
  cm: number;
  /** Quanto ela rende de experiência (antes do bônus de banquete). */
  food: number;
}

export interface SaveData {
  /** Maior bola já enterrada (diâmetro em cm). */
  bestCm: number;
  /** Quantas bolas foram enterradas no total. */
  buried: number;
  /** Soma dos diâmetros enterrados (cm) — "quanta bosta" o besouro já guardou. */
  totalCm: number;
  /** Experiência total (o nível sai daqui). */
  xp: number;
  /** Bolas enterradas que ainda não foram comidas. */
  pantry: PantryBall[];
  /** Quantas de cada figurinha já desceram pra toca. */
  catalog: Partial<Record<CatalogId, number>>;
  /** Já viu a toca aberta (a primeira vez abre sozinha, pra ensinar). */
  seenBurrow: boolean;
  /** Conquistas já feitas (cada uma paga XP uma vez só). */
  achievements: AchievementId[];
  /** Poderes que já foram escolhidos alguma vez (conquista "todos os poderes"). */
  perksUsed: PerkId[];
  /** Casco do besouro em uso (só aparência). */
  skin: SkinId;
  stats: SaveStats;
}

const KEY = 'dawnroll:progresso:v1';
/** Chave de quando o jogo se chamava Rola Bosta: lida uma vez e migrada. */
const LEGACY_KEY = 'rola-bosta:progresso:v1';

export function emptySave(): SaveData {
  return {
    bestCm: 0,
    buried: 0,
    totalCm: 0,
    xp: 0,
    pantry: [],
    catalog: {},
    seenBurrow: false,
    achievements: [],
    perksUsed: [],
    skin: DEFAULT_SKIN,
    stats: { requestsDone: 0, websTorn: 0 },
  };
}

/** Número finito, não negativo e dentro de um teto sensato. */
function sane(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : 0;
}

function readPantry(value: unknown): PantryBall[] {
  if (!Array.isArray(value)) return [];
  const pantry: PantryBall[] = [];
  for (const item of value.slice(0, PANTRY_CAPACITY)) {
    if (!item || typeof item !== 'object') continue;
    const { cm, food } = item as Record<string, unknown>;
    const ball = { cm: sane(cm, 1000), food: Math.round(sane(food, 1e5)) };
    if (ball.cm > 0 && ball.food > 0) pantry.push(ball);
  }
  return pantry;
}

function readCatalog(value: unknown): Partial<Record<CatalogId, number>> {
  const catalog: Partial<Record<CatalogId, number>> = {};
  if (!value || typeof value !== 'object') return catalog;
  for (const [id, count] of Object.entries(value as Record<string, unknown>)) {
    const n = Math.floor(sane(count, 1e7));
    if (isCatalogId(id) && n > 0) catalog[id] = n;
  }
  return catalog;
}

/** Lista de ids conhecidos, sem repetição (o resto é descartado). */
function readIds<T extends string>(value: unknown, isValid: (id: string) => id is T): T[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<T>();
  for (const id of value) if (typeof id === 'string' && isValid(id)) ids.add(id);
  return [...ids];
}

function readStats(value: unknown): SaveStats {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    requestsDone: Math.floor(sane(data.requestsDone, 1e7)),
    websTorn: Math.floor(sane(data.websTorn, 1e7)),
  };
}

export function loadSave(): SaveData {
  try {
    let raw = window.localStorage.getItem(KEY);
    if (!raw) {
      // Recorde de antes da troca de nome: traz pra chave nova (ninguém perde progresso).
      raw = window.localStorage.getItem(LEGACY_KEY);
      if (raw) {
        window.localStorage.setItem(KEY, raw);
        window.localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) return emptySave();
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return emptySave();
    return {
      bestCm: sane(data.bestCm, 1000),
      buried: Math.floor(sane(data.buried, 1e7)),
      totalCm: sane(data.totalCm, 1e9),
      xp: Math.floor(sane(data.xp, 1e9)),
      pantry: readPantry(data.pantry),
      catalog: readCatalog(data.catalog),
      seenBurrow: data.seenBurrow === true,
      achievements: readIds(data.achievements, isAchievementId),
      perksUsed: readIds(data.perksUsed, isPerkId),
      skin: typeof data.skin === 'string' && isSkinId(data.skin) ? data.skin : DEFAULT_SKIN,
      stats: readStats(data.stats),
    };
  } catch {
    return emptySave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Armazenamento cheio ou bloqueado: o jogo segue sem salvar.
  }
}
