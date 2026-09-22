import { createRng, smoothstep } from '../utils/math';

/**
 * Lugares "cavados" no relevo: a toca onde o besouro enterra a bola e as bacias
 * rasas onde a chuva empoça. São decididos uma vez (determinístico) a partir do
 * relevo cru e depois esculpidos no `terrainHeight` — assim malha visual, colisor,
 * grama e todo o resto enxergam o mesmo buraco.
 */

/** Bacia rasa onde a chuva empoça. */
export interface PuddleSite {
  readonly x: number;
  readonly z: number;
  /** Raio da parte funda (a água nunca passa disso). */
  readonly radius: number;
  /** Profundidade no centro, abaixo da borda. */
  readonly depth: number;
  /** Altura (mundo) da borda aplainada; a água cheia fica um pouco abaixo dela. */
  readonly rim: number;
}

export interface BurrowSite {
  readonly x: number;
  readonly z: number;
  /** Raio da boca da toca (a bola "cai" dentro desse círculo). */
  readonly radius: number;
  readonly depth: number;
  /** Altura (mundo) do chão aplainado em volta. */
  readonly ground: number;
  /** Direção (normalizada, no plano) em que fica o monte de terra escavada. */
  readonly moundX: number;
  readonly moundZ: number;
}

/** Folga entre a água cheia e a borda da bacia. */
export const PUDDLE_FREEBOARD = 0.12;

/** Posição da toca: à frente da câmera inicial (que olha para +Z), logo depois da trilha. */
const BURROW_X = 6;
const BURROW_Z = 20;

export function createBurrowSite(baseHeight: (x: number, z: number) => number): BurrowSite {
  // Monte de terra do lado de lá (quem chega do nascimento vê a boca livre).
  const angle = 1.1;
  return {
    x: BURROW_X,
    z: BURROW_Z,
    radius: 3.2,
    depth: 1.25,
    ground: baseHeight(BURROW_X, BURROW_Z),
    moundX: Math.cos(angle),
    moundZ: Math.sin(angle),
  };
}

/**
 * Escolhe as bacias das poças: onde o relevo já afunda (depressões naturais),
 * longe do nascimento, da toca e umas das outras. Uma delas cai de propósito
 * na trilha de terra (poça de lama no caminho).
 */
export function pickPuddleSites(
  baseHeight: (x: number, z: number) => number,
  playRadius: number,
  burrow: { x: number; z: number },
  count = 6,
): PuddleSite[] {
  const rng = createRng(606);
  interface Candidate {
    x: number;
    z: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  const ring = 7;
  for (let x = -playRadius; x <= playRadius; x += 3) {
    for (let z = -playRadius; z <= playRadius; z += 3) {
      const d = Math.hypot(x, z);
      if (d < 14 || d > playRadius - 11) continue;
      if (Math.hypot(x - burrow.x, z - burrow.z) < 14) continue;
      const h = baseHeight(x, z);
      let around = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        around += baseHeight(x + Math.cos(a) * ring, z + Math.sin(a) * ring);
      }
      // Quanto mais abaixo da vizinhança, melhor (água corre para lá).
      candidates.push({ x, z, score: h - around / 8 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const sites: PuddleSite[] = [];
  const minSpacing = 17;
  const add = (x: number, z: number, radius: number) => {
    const depth = 0.42 + radius * 0.055;
    // A borda fica no ponto mais baixo em volta: a bacia sempre afunda no relevo
    // (se usasse a altura do centro, uma poça em terreno inclinado viraria um platô).
    let rim = baseHeight(x, z);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      rim = Math.min(rim, baseHeight(x + Math.cos(a) * radius * 1.3, z + Math.sin(a) * radius * 1.3));
    }
    sites.push({ x, z, radius, depth, rim: rim + 0.02 });
  };

  // Poça de lama na trilha (a trilha é z = sin(x·0,06)·14 + 6).
  const trailX = -27;
  add(trailX, Math.sin(trailX * 0.06) * 14 + 6, 4.2);

  for (const c of candidates) {
    if (sites.length >= count) break;
    if (sites.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < minSpacing)) continue;
    add(c.x + rng.range(-1, 1), c.z + rng.range(-1, 1), rng.range(3.8, 6.4));
  }
  return sites;
}

/** Perfil da bacia: fundo largo e raso, bordas suaves (a bola entra e sai rolando). */
export function puddleBowl(site: PuddleSite, distance: number): number {
  const t = distance / site.radius;
  if (t >= 1) return 0;
  const k = 1 - t * t;
  return site.depth * k * Math.sqrt(k);
}

/** Peso do aplainamento em volta da bacia (1 dentro, some até 1,8 raio). */
export function puddleFlatten(site: PuddleSite, distance: number): number {
  return 1 - smoothstep(site.radius, site.radius * 1.8, distance);
}

/** Altura do fundo da bacia (sem água) num ponto dentro dela. */
export function puddleBedHeight(site: PuddleSite, distance: number): number {
  return site.rim - puddleBowl(site, distance);
}
