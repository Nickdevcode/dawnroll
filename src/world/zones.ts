import { createRng } from '../utils/math';
import { BURROW, PLAY_RADIUS, PUDDLES } from './Terrain';

/**
 * Cantinhos temáticos do jardim: lugares com história onde os objetos perdidos
 * se juntam — a ponta da toalha de piquenique (as formigas fazem trilha até lá),
 * o cantinho dos brinquedos e o cantinho do jardineiro (o do anão de jardim).
 *
 * Decididos uma vez, de forma determinística, longe do nascimento, da toca, das
 * poças e da trilha de terra. O piquenique fica mais perto (coisa pequena, pra
 * bola pequena) e o jardineiro mais longe (coisa grande, fim de jogo).
 */

export type ZoneKind = 'picnic' | 'toys' | 'gardener';

export interface ZoneSite {
  readonly kind: ZoneKind;
  readonly x: number;
  readonly z: number;
  /** Raio da área do cantinho (o cenário comum não nasce dentro dela). */
  readonly radius: number;
  /** Direção (ângulo no plano, radianos) para onde o cantinho "abre" — a toalha, a fileira de brinquedos. */
  readonly facing: number;
}

/**
 * Raio de cada cantinho: cabe a cena montada em `objects/` (a toalha girada 45°
 * no piquenique; anão, vasos, pás, luvas e o par de chinelos no jardineiro).
 */
const RADII: Record<ZoneKind, number> = { picnic: 11.5, toys: 10, gardener: 13 };

/** Distância até o eixo da trilha sinuosa (a mesma fórmula do `Terrain`). */
const pathDistance = (x: number, z: number) => Math.abs(z - Math.sin(x * 0.06) * 14 - 6);

/** Folgas em volta de trilha, toca, poças e outros cantinhos (a segunda é o "aperta um pouco"). */
interface Clearance {
  path: number;
  burrow: number;
  puddle: number;
  puddleScale: number;
  zones: number;
}
const STRICT: Clearance = { path: 4, burrow: 6, puddle: 3, puddleScale: 1.8, zones: 12 };
/**
 * Se nenhum lugar passa na regra folgada, tenta de novo mais apertado (poça e
 * trilha podem ficar logo depois da borda). Os cantinhos que já cabiam na regra
 * folgada não mudam de lugar.
 */
const RELAXED: Clearance = { path: 1.5, burrow: 3, puddle: 1, puddleScale: 1.3, zones: 8 };

function pickZoneSites(): ZoneSite[] {
  const rng = createRng(4242);
  const order: ZoneKind[] = ['picnic', 'toys', 'gardener'];
  // Anéis de distância do nascimento: perto, meio, longe.
  // O jardineiro fica inteiro dentro da área jogável (nada de chinelo na subida da borda).
  const rings: Record<ZoneKind, [number, number]> = { picnic: [20, 30], toys: [28, 38], gardener: [30, PLAY_RADIUS - RADII.gardener - 1] };
  const sites: ZoneSite[] = [];
  for (const kind of order) {
    const radius = RADII[kind];
    const [minD, maxD] = rings[kind];
    for (const clear of [STRICT, RELAXED]) {
      let best: ZoneSite | null = null;
      let bestScore = -Infinity;
      // Na segunda tentativa o espaço que sobra é pequeno: sorteia bem mais pontos.
      const samples = clear === STRICT ? 400 : 3000;
      for (let i = 0; i < samples; i++) {
        const a = rng.next() * Math.PI * 2;
        const d = minD + rng.next() * (maxD - minD);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (pathDistance(x, z) < radius + clear.path) continue;
        if (Math.hypot(x - BURROW.x, z - BURROW.z) < radius + BURROW.radius * 2.8 + clear.burrow) continue;
        if (PUDDLES.some((p) => Math.hypot(x - p.x, z - p.z) < radius + p.radius * clear.puddleScale + clear.puddle)) continue;
        if (sites.some((s) => Math.hypot(x - s.x, z - s.z) < radius + s.radius + clear.zones)) continue;
        // Prefere lugar longe dos outros cantinhos (espalha pelo mapa).
        const spread = sites.reduce((min, s) => Math.min(min, Math.hypot(x - s.x, z - s.z)), 80);
        const score = spread + rng.next() * 6;
        if (score > bestScore) {
          bestScore = score;
          // A "frente" do cantinho olha para o nascimento (quem chega vê a cena de frente).
          best = { kind, x, z, radius, facing: Math.atan2(-x, -z) };
        }
      }
      if (best) {
        sites.push(best);
        break;
      }
    }
  }
  return sites;
}

/** Os três cantinhos (sempre os mesmos). */
export const ZONES: readonly ZoneSite[] = pickZoneSites();

/** O cantinho de um tipo (pode faltar só se o mapa mudar de tamanho: quem usa confere). */
export function zoneOf(kind: ZoneKind): ZoneSite | undefined {
  return ZONES.find((zone) => zone.kind === kind);
}
