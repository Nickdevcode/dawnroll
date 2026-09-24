import type { SaveData } from '../core/save';

/**
 * Junta dois saves da mesma pessoa (o do aparelho e o da nuvem, ou os de dois
 * aparelhos que gravaram ao mesmo tempo) sem perder progresso: contadores e
 * recordes ficam com o maior, listas (conquistas, figurinhas, achados...) viram a
 * união. O que não soma — despensa, casco e acessórios vestidos — vem do save
 * "mais adiantado" (mais experiência; empate fica com `a`).
 *
 * Por que o maior e não a soma: não dá pra saber quanto dos dois lados é
 * história em comum. O maior nunca inventa progresso; no pior caso (jogou nos
 * dois aparelhos sem internet) perde a diferença de um contador.
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
  };
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
