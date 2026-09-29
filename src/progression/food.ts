import { catalogEntry, type CatalogId } from './catalog';
import type { Hue } from './colors';

/**
 * O que foi pra dentro da bola nesta rodada e quanto ela "alimenta" quando o
 * besouro come ela na toca.
 *
 * Valor = tamanho + variedade + raros + pedidos cumpridos. Variedade pesa de
 * propósito: é o que empurra o jogador a explorar o jardim em vez de só rodar
 * em volta dos montinhos. Com ~60 figurinhas no jogo, os tipos além do 10º
 * rendem metade (senão uma bola "de tudo um pouco" daria XP demais).
 */

/** Comida por centímetro de diâmetro. */
const FOOD_PER_CM = 3;
/** Comida por tipo diferente de coisa na bola (bosta comum não conta como tipo). */
const FOOD_PER_KIND = 4;
/** Tipos que rendem cheio; daí em diante, metade. */
const FULL_KINDS = 10;
/** Comida extra por montinho fresquinho. */
const FOOD_PER_FRESH = 6;
/** Comida extra por coisa rara (trevo de quatro folhas, bicho-pau, anão...). */
const FOOD_PER_RARE = 5;

/** Bolas guardadas de uma vez na despensa. Cheia, a bola nova é comida na hora. */
export const PANTRY_CAPACITY = 8;
/** Banquete: cada bola a mais na mesma refeição rende +10%, até +50%. */
const BANQUET_STEP = 0.1;
const BANQUET_CAP = 0.5;

/** O conteúdo de uma bola no formato da rede (online): [figurinha, quantas] e [cor, quantas]. */
export interface LedgerWire {
  c: Array<[CatalogId, number]>;
  h: Array<[Hue, number]>;
}

/**
 * Contagem do que uma bola já engoliu (por figurinha do catálogo e por cor).
 * No online cada bola tem a dela e ela viaja junto: roubou a bola, levou o
 * que tinha dentro; juntou duas, soma as duas.
 */
export class RoundLedger {
  private readonly counts = new Map<CatalogId, number>();
  private readonly hueCounts = new Map<Hue, number>();
  private _version = 0;

  /** Muda a cada alteração (o online só reenvia o conteúdo quando ele mudou). */
  get version(): number {
    return this._version;
  }

  add(id: CatalogId, amount = 1): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + amount);
    this._version++;
  }

  addHue(hue: Hue, amount = 1): void {
    this.hueCounts.set(hue, (this.hueCounts.get(hue) ?? 0) + amount);
    this._version++;
  }

  /** Soma o conteúdo de outra bola (fusão, bola engolida). */
  mergeFrom(other: RoundLedger): void {
    for (const [id, n] of other.counts) this.counts.set(id, (this.counts.get(id) ?? 0) + n);
    for (const [hue, n] of other.hueCounts) this.hueCounts.set(hue, (this.hueCounts.get(hue) ?? 0) + n);
    this._version++;
  }

  toWire(): LedgerWire {
    return { c: [...this.counts.entries()].filter(([, n]) => n > 0), h: [...this.hueCounts.entries()].filter(([, n]) => n > 0) };
  }

  /** Troca o conteúdo pelo que veio da rede (espelho da bola de outro jogador). */
  loadWire(wire: LedgerWire): void {
    this.counts.clear();
    this.hueCounts.clear();
    for (const [id, n] of wire.c) this.counts.set(id, n);
    for (const [hue, n] of wire.h) this.hueCounts.set(hue, n);
    this._version++;
  }

  count(id: CatalogId): number {
    return this.counts.get(id) ?? 0;
  }

  hueCount(hue: Hue): number {
    return this.hueCounts.get(hue) ?? 0;
  }

  /** Quantas famílias de cor da lista já entraram na bola. */
  huesAmong(hues: readonly Hue[]): number {
    return hues.reduce((n, hue) => n + (this.hueCount(hue) > 0 ? 1 : 0), 0);
  }

  /** Soma de várias figurinhas (ex.: todas as flores). */
  sum(ids: readonly CatalogId[]): number {
    let total = 0;
    for (const id of ids) total += this.count(id);
    return total;
  }

  /** Quantas figurinhas DIFERENTES da lista já entraram (ex.: espécies de flor). */
  distinct(ids: readonly CatalogId[]): number {
    let n = 0;
    for (const id of ids) if (this.count(id) > 0) n++;
    return n;
  }

  /** Tipos diferentes de coisa na bola (a bosta comum é a "massa", não conta). */
  get kinds(): number {
    let kinds = 0;
    for (const [id, n] of this.counts) if (id !== 'dung' && n > 0) kinds++;
    return kinds;
  }

  /** Coisas grudadas (tudo menos bosta). */
  get items(): number {
    let items = 0;
    for (const [id, n] of this.counts) if (id !== 'dung' && id !== 'freshDung') items += n;
    return items;
  }

  entries(): IterableIterator<[CatalogId, number]> {
    return this.counts.entries();
  }

  reset(): void {
    this.counts.clear();
    this.hueCounts.clear();
    this._version++;
  }
}

export interface FoodBreakdown {
  size: number;
  variety: number;
  rare: number;
  requests: number;
  /** Sol excedente (online): o volume que passou dos 30 cm. */
  sun: number;
  total: number;
}

/**
 * Comida por centímetro de Sol excedente (o quanto a bola teria passado dos
 * 30 cm). Um pouco mais que o centímetro normal: juntar bola gigante é esforço
 * de time e tem que valer a pena.
 */
const FOOD_PER_SUN_CM = 4;

export function foodFor(diameterCm: number, ledger: RoundLedger, requestReward: number, sunCm = 0): FoodBreakdown {
  const size = Math.round(diameterCm * FOOD_PER_CM);
  const kinds = ledger.kinds;
  const variety = Math.min(kinds, FULL_KINDS) * FOOD_PER_KIND + Math.max(0, kinds - FULL_KINDS) * (FOOD_PER_KIND / 2);
  let rare = ledger.count('freshDung') * FOOD_PER_FRESH;
  for (const [id, n] of ledger.entries()) if (id !== 'freshDung' && catalogEntry(id).rare) rare += n * FOOD_PER_RARE;
  const requests = Math.round(requestReward);
  const sun = Math.round(Math.max(0, sunCm) * FOOD_PER_SUN_CM);
  return { size, variety, rare, requests, sun, total: size + variety + rare + requests + sun };
}

/** Multiplicador de comer `count` bolas juntas. */
export function banquetMultiplier(count: number): number {
  return 1 + Math.min(BANQUET_CAP, Math.max(0, count - 1) * BANQUET_STEP);
}
