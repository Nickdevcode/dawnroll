import type { CatalogId } from './catalog';

/**
 * O que foi pra dentro da bola nesta rodada e quanto ela "alimenta" quando o
 * besouro come ela na toca.
 *
 * Valor = tamanho + variedade + raros + pedidos cumpridos. Variedade pesa de
 * propósito: é o que empurra o jogador a explorar o jardim em vez de só rodar
 * em volta dos montinhos.
 */

/** Comida por centímetro de diâmetro. */
const FOOD_PER_CM = 3;
/** Comida por tipo diferente de coisa na bola (bosta comum não conta como tipo). */
const FOOD_PER_KIND = 4;
/** Comida extra por montinho fresquinho. */
const FOOD_PER_FRESH = 6;

/** Bolas guardadas de uma vez na despensa. Cheia, a bola nova é comida na hora. */
export const PANTRY_CAPACITY = 8;
/** Banquete: cada bola a mais na mesma refeição rende +10%, até +50%. */
const BANQUET_STEP = 0.1;
const BANQUET_CAP = 0.5;

/** Contagem do que a bola da rodada já engoliu (por figurinha do catálogo). */
export class RoundLedger {
  private readonly counts = new Map<CatalogId, number>();

  add(id: CatalogId, amount = 1): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + amount);
  }

  count(id: CatalogId): number {
    return this.counts.get(id) ?? 0;
  }

  /** Soma de várias figurinhas (ex.: todas as flores). */
  sum(ids: readonly CatalogId[]): number {
    let total = 0;
    for (const id of ids) total += this.count(id);
    return total;
  }

  /** Tipos diferentes de coisa na bola (a bosta comum é a "massa", não conta). */
  get kinds(): number {
    let kinds = 0;
    for (const [id, n] of this.counts) if (id !== 'dung' && n > 0) kinds++;
    return kinds;
  }

  entries(): IterableIterator<[CatalogId, number]> {
    return this.counts.entries();
  }

  reset(): void {
    this.counts.clear();
  }
}

export interface FoodBreakdown {
  size: number;
  variety: number;
  rare: number;
  requests: number;
  total: number;
}

export function foodFor(diameterCm: number, ledger: RoundLedger, requestReward: number): FoodBreakdown {
  const size = Math.round(diameterCm * FOOD_PER_CM);
  const variety = ledger.kinds * FOOD_PER_KIND;
  const rare = ledger.count('freshDung') * FOOD_PER_FRESH;
  const requests = Math.round(requestReward);
  return { size, variety, rare, requests, total: size + variety + rare + requests };
}

/** Multiplicador de comer `count` bolas juntas. */
export function banquetMultiplier(count: number): number {
  return 1 + Math.min(BANQUET_CAP, Math.max(0, count - 1) * BANQUET_STEP);
}
