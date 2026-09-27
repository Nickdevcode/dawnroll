import { PASS_COUNTERS } from '../progression/seasons';
import { emptyPass, type EconomyState, type PassState, type SaveData } from '../core/save';

/** Economia: compras e baús abertos viram a união (a mesma chave é a mesma coisa nos dois lados). */
function mergeEconomy(a: EconomyState, b: EconomyState): EconomyState {
  // Semente: a menor das duas que existem (os dois aparelhos chegam na mesma escolha).
  const seed = a.seed && b.seed ? Math.min(a.seed, b.seed) : a.seed || b.seed;
  return {
    seed,
    purchases: { ...b.purchases, ...a.purchases },
    opened: { ...b.opened, ...a.opened },
    welcomed: a.welcomed || b.welcomed,
  };
}

function mergePass(a: PassState | undefined, b: PassState | undefined): PassState {
  const x = a ?? emptyPass();
  const y = b ?? emptyPass();
  const counters = { ...x.counters };
  for (const counter of PASS_COUNTERS) counters[counter] = Math.max(x.counters[counter], y.counters[counter]);
  return {
    xp: Math.max(x.xp, y.xp),
    claimed: [...new Set([...x.claimed, ...y.claimed])].sort((m, n) => m - n),
    counters,
    lastDay: x.lastDay > y.lastDay ? x.lastDay : y.lastDay,
  };
}

/**
 * Junta dois saves da mesma pessoa (o do aparelho e o da nuvem, ou os de dois
 * aparelhos que gravaram ao mesmo tempo) sem perder progresso: contadores e
 * recordes ficam com o maior, listas (conquistas, figurinhas, achados, compras,
 * baús abertos...) viram a união. O que não soma — despensa, casco e acessórios
 * vestidos — vem do save "mais adiantado" (mais experiência; empate fica com `a`).
 *
 * Por que o maior e não a soma: não dá pra saber quanto dos dois lados é
 * história em comum. O maior nunca inventa progresso; no pior caso (jogou nos
 * dois aparelhos sem internet) perde a diferença de um contador. O saldo de
 * moedas não entra aqui: ele é calculado das listas, então gasto num aparelho
 * continua gasto depois de juntar.
 */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const primary = b.xp > a.xp ? b : a;
  const catalog: SaveData['catalog'] = { ...a.catalog };
  for (const [id, n] of Object.entries(b.catalog) as Array<[keyof SaveData['catalog'], number]>) {
    catalog[id] = Math.max(catalog[id] ?? 0, n);
  }
  const union = <T>(x: readonly T[], y: readonly T[]): T[] => [...new Set([...x, ...y])];
  return {
    bestCm: Math.max(a.bestCm, b.bestCm),
    buried: Math.max(a.buried, b.buried),
    totalCm: Math.max(a.totalCm, b.totalCm),
    xp: Math.max(a.xp, b.xp),
    pantry: primary.pantry.map((ball) => ({ ...ball })),
    catalog,
    seenBurrow: a.seenBurrow || b.seenBurrow,
    achievements: union(a.achievements, b.achievements),
    perksUsed: union(a.perksUsed, b.perksUsed),
    skin: primary.skin,
    outfit: { ...primary.outfit },
    seenLooks: union(a.seenLooks, b.seenLooks),
    found: union(a.found, b.found),
    stats: {
      requestsDone: Math.max(a.stats.requestsDone, b.stats.requestsDone),
      websTorn: Math.max(a.stats.websTorn, b.stats.websTorn),
      rideSeconds: Math.max(a.stats.rideSeconds, b.stats.rideSeconds),
      rollUnits: Math.max(a.stats.rollUnits, b.stats.rollUnits),
    },
    economy: mergeEconomy(a.economy, b.economy),
    passes: mergePasses(a.passes, b.passes),
  };
}

function mergePasses(a: SaveData['passes'], b: SaveData['passes']): SaveData['passes'] {
  const passes: SaveData['passes'] = {};
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SaveData['passes']>;
  for (const id of ids) passes[id] = mergePass(a[id], b[id]);
  return passes;
}

/** Os dois saves dizem a mesma coisa? (evita gravar na nuvem o que já está lá) */
export function sameSave(a: SaveData, b: SaveData): boolean {
  return stableJson(a) === stableJson(b);
}

/** JSON com as chaves em ordem (o banco devolve objetos com outra ordem). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

/** O save tem algum progresso? (save zerado de quem nunca jogou não vale a pena juntar) */
export function hasProgress(save: SaveData): boolean {
  return save.xp > 0 || save.buried > 0 || save.achievements.length > 0 || Object.keys(save.catalog).length > 0;
}
