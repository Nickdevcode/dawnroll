import { isAchievementId, type AchievementId } from '../progression/achievements';
import { isCatalogId, type CatalogId } from '../progression/catalog';
import { PANTRY_CAPACITY } from '../progression/food';
import { isPerkId, type PerkId } from '../progression/perks';
import { DEFAULT_SKIN, isSkinId, type SkinId } from '../progression/skins';
import { ACCESSORY_SLOTS, accessory, emptyOutfit, isAccessoryId, type AccessoryId, type Outfit } from '../progression/accessories';
import { isLookKey, type LookKey } from '../progression/looks';
import type { ChestResult, Paid } from '../progression/economy';
import { PASS_COUNTERS, isSeasonId, type PassCounter } from '../progression/seasons';
import { RARITIES, type Rarity, type SeasonId } from '../progression/unlocks';

/**
 * Progresso salvo no próprio navegador (localStorage): recorde, bolas
 * enterradas, experiência, a despensa da toca, o catálogo e as conquistas. Tudo validado na
 * leitura — dado corrompido ou editado à mão vira zero, nunca quebra o jogo.
 * Em aba anônima/bloqueada, só não salva.
 *
 * Os campos da toca entraram depois do recorde, o casco e os contadores depois
 * deles, e os acessórios por último: save antigo (sem esses campos) abre normal,
 * com o que faltar zerado.
 *
 * Com conta, este mesmo JSON vai pra nuvem (`online/CloudSave`); o navegador
 * continua sendo a cópia de trabalho.
 *
 * A economia (moedas, baús, compras) e o passe entraram por último. O saldo
 * não é guardado: sai do que está aqui (ver `progression/economy.ts`).
 */

/** Contadores que atravessam as rodadas (conquistas de "N vezes"). */
export interface SaveStats {
  /** Pedidos cumpridos no total. */
  requestsDone: number;
  /** Teias de aranha rasgadas no total. */
  websTorn: number;
  /** Segundos em cima da bola (Equilibrista) no total. */
  rideSeconds: number;
  /** Quanto a bola já rolou no total (unidades do mundo). */
  rollUnits: number;
}

/** Moedas, baús e compras. */
export interface EconomyState {
  /** Semente dos baús (sorteada uma vez; 0 = ainda não tem). O mesmo baú abre igual em qualquer aparelho. */
  seed: number;
  /** Compras na Feirinha: chave (`look:skin:neon`, `chest:epic:...`) → quanto custou. */
  purchases: Record<string, Paid>;
  /** Baús abertos: chave do baú → o que saiu. */
  opened: Record<string, ChestResult>;
  /** Já viu o aviso de boas-vindas das moedas (o presente das conquistas antigas). */
  welcomed: boolean;
}

/** Passe de uma temporada. */
export interface PassState {
  /** XP juntado jogando (enterros, pedidos, primeiro enterro do dia, conquistas). Os desafios somam por cima. */
  xp: number;
  /** Níveis do passe já pegos. */
  claimed: number[];
  /** O que aconteceu durante a temporada (metas dos desafios). */
  counters: Record<PassCounter, number>;
  /** Último dia (AAAA-MM-DD, horário do aparelho) com enterro na temporada. */
  lastDay: string;
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
  /** Acessórios vestidos (um por lugar). */
  outfit: Outfit;
  /** Visuais liberados que o jogador já viu no guarda-roupa (o resto ganha o selo "Novo"). */
  seenLooks: LookKey[];
  /** Acessórios achados no jardim (achado raro): liberados mesmo sem a conquista/nível. */
  found: AccessoryId[];
  stats: SaveStats;
  economy: EconomyState;
  /** Passe de cada temporada jogada. */
  passes: Partial<Record<SeasonId, PassState>>;
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
    outfit: emptyOutfit(),
    seenLooks: [],
    found: [],
    stats: { requestsDone: 0, websTorn: 0, rideSeconds: 0, rollUnits: 0 },
    economy: emptyEconomy(),
    passes: {},
  };
}

export function emptyEconomy(): EconomyState {
  return { seed: 0, purchases: {}, opened: {}, welcomed: false };
}

export function emptyPass(): PassState {
  const counters = {} as Record<PassCounter, number>;
  for (const counter of PASS_COUNTERS) counters[counter] = 0;
  return { xp: 0, claimed: [], counters, lastDay: '' };
}

/** Teto de entradas nas listas da economia (save editado à mão não vira um JSON gigante). */
const MAX_ECONOMY_ENTRIES = 4000;
/** Chaves válidas de compra e de baú. */
const PURCHASE_KEY = /^(look:(skin|acc):[a-zA-Z0-9]{1,32}|chest:(rare|epic|legendary):[a-z0-9]{1,24})$/;
const CHEST_KEY = /^(lvl:\d{1,3}|pass:[a-z]{1,24}:\d{1,3}|chest:(rare|epic|legendary):[a-z0-9]{1,24})$/;

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
    rideSeconds: sane(data.rideSeconds, 1e7),
    rollUnits: sane(data.rollUnits, 1e9),
  };
}

/** Um acessório válido por lugar (id desconhecido ou no lugar errado vira "nada"). */
function readOutfit(value: unknown): Outfit {
  const outfit = emptyOutfit();
  if (!value || typeof value !== 'object') return outfit;
  const data = value as Record<string, unknown>;
  for (const slot of ACCESSORY_SLOTS) {
    const id = data[slot];
    if (typeof id === 'string' && isAccessoryId(id) && accessory(id).slot === slot) outfit[slot] = id;
  }
  return outfit;
}

const isRarity = (value: unknown): value is Rarity => typeof value === 'string' && (RARITIES as readonly string[]).includes(value);

function readPaid(value: unknown): Paid | null {
  if (!value || typeof value !== 'object') return null;
  const { coins, dew } = value as Record<string, unknown>;
  return { coins: Math.floor(sane(coins, 1e7)), dew: Math.floor(sane(dew, 1e6)) };
}

function readChestResult(value: unknown): ChestResult | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!isRarity(data.rarity)) return null;
  const look = typeof data.look === 'string' && isLookKey(data.look) ? data.look : null;
  return { rarity: data.rarity, coins: Math.floor(sane(data.coins, 1e5)), dew: Math.floor(sane(data.dew, 1e4)), look };
}

/** Objeto chave → valor, só com as chaves no formato certo e os valores que passam na leitura. */
function readRecord<T>(value: unknown, keyOk: RegExp, read: (v: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  let n = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (n >= MAX_ECONOMY_ENTRIES) break;
    if (!keyOk.test(key)) continue;
    const item = read(raw);
    if (item === null) continue;
    out[key] = item;
    n++;
  }
  return out;
}

function readEconomy(value: unknown): EconomyState {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const seed = typeof data.seed === 'number' && Number.isInteger(data.seed) && data.seed > 0 && data.seed <= 0xffffffff ? data.seed : 0;
  return {
    seed,
    purchases: readRecord(data.purchases, PURCHASE_KEY, readPaid),
    opened: readRecord(data.opened, CHEST_KEY, readChestResult),
    welcomed: data.welcomed === true,
  };
}

function readPass(value: unknown): PassState {
  const pass = emptyPass();
  if (!value || typeof value !== 'object') return pass;
  const data = value as Record<string, unknown>;
  pass.xp = Math.floor(sane(data.xp, 1e7));
  if (Array.isArray(data.claimed)) {
    const tiers = new Set<number>();
    for (const tier of data.claimed) if (Number.isInteger(tier) && tier >= 1 && tier <= 200) tiers.add(tier);
    pass.claimed = [...tiers].sort((a, b) => a - b);
  }
  const counters = data.counters && typeof data.counters === 'object' ? (data.counters as Record<string, unknown>) : {};
  for (const counter of PASS_COUNTERS) pass.counters[counter] = sane(counters[counter], 1e9);
  pass.lastDay = typeof data.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.lastDay) ? data.lastDay : '';
  return pass;
}

function readPasses(value: unknown): SaveData['passes'] {
  const passes: SaveData['passes'] = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return passes;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isSeasonId(id)) passes[id] = readPass(raw);
  }
  return passes;
}

/**
 * Valida um save vindo de fora (localStorage ou nuvem): o que não for do formato
 * certo vira zero/padrão, nunca quebra o jogo.
 */
export function parseSave(value: unknown): SaveData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySave();
  const data = value as Record<string, unknown>;
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
    outfit: readOutfit(data.outfit),
    seenLooks: readIds(data.seenLooks, isLookKey),
    found: readIds(data.found, isAccessoryId),
    stats: readStats(data.stats),
    economy: readEconomy(data.economy),
    passes: readPasses(data.passes),
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
    return raw ? parseSave(JSON.parse(raw)) : emptySave();
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
