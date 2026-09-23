import { createRng } from '../utils/math';
import { BURROW, PLAY_RADIUS, PUDDLES } from './Terrain';

/**
 * Cantinhos temáticos do jardim: lugares com história onde os objetos perdidos
 * se juntam — a ponta da toalha de piquenique (as formigas fazem trilha até lá),
 * o cantinho dos brinquedos e o cantinho do jardineiro.
 *
 * Sorteados a cada jardim novo (cada rodada tem os seus), sempre longe do
 * nascimento, da toca, das poças e da trilha de terra. O piquenique fica mais
 * perto (coisa pequena, pra bola pequena) e o jardineiro mais longe (coisa
 * grande, fim de jogo).
 */

export type ZoneKind = 'picnic' | 'toys' | 'gardener';

export interface ZoneSite {
  readonly kind: ZoneKind;
  readonly x: number;
  readonly z: number;
  /** Raio da área do cantinho (o cenário comum não nasce dentro dela). */
  readonly radius: number;
  /** Direção (ângulo no plano, radianos) para onde o cantinho "abre" — a ponta da toalha, a frente da bagunça. */
  readonly facing: number;
}

/**
 * Raio de cada cantinho: cabe a cena montada em `objects/` (a toalha girada 45°
 * no piquenique; os brinquedos espalhados com folga; vasos, pás e luvas no jardineiro).
 */
const RADII: Record<ZoneKind, number> = { picnic: 11.5, toys: 12, gardener: 14 };

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
/**
 * A borda do cantinho pode encostar na beira da trilha e das poças: com folga
 * maior, trilha + poças + toca sobravam só dois ou três lugares no mapa e os
 * cantinhos caíam quase sempre no mesmo canto.
 */
const STRICT: Clearance = { path: 2.5, burrow: 4, puddle: 1.5, puddleScale: 1.3, zones: 6 };
/** Se nenhum lugar passa na regra folgada, tenta de novo mais apertado (poça e trilha logo depois da borda). */
const RELAXED: Clearance = { path: 0.5, burrow: 2, puddle: 0.5, puddleScale: 1.1, zones: 3 };
/**
 * Último recurso (raríssimo): o cantinho pode invadir um pouco a trilha e sair
 * do anel dele. Todo jardim TEM os três cantinhos (há pedido que depende deles).
 */
const LAST_RESORT: Clearance = { path: -3, burrow: 1, puddle: 0, puddleScale: 1, zones: 1 };
/** Distância mínima do nascimento no último recurso. */
const LAST_RESORT_MIN_DISTANCE = 12;

/** Quanto a "frente" do cantinho pode fugir de olhar direto pro nascimento. */
const FACING_JITTER = 0.7;

/**
 * Sorteia os três cantinhos de um jardim, cada vez num canto diferente do mapa.
 * Determinístico pela semente (a mesma semente sempre dá o mesmo jardim — útil
 * pra reproduzir um bug).
 */
export function pickZoneSites(seed: number): ZoneSite[] {
  const rng = createRng(seed);
  const order: ZoneKind[] = ['picnic', 'toys', 'gardener'];
  // Anéis de distância do nascimento: perto, meio, longe (sempre inteiros dentro da área jogável).
  const rings: Record<ZoneKind, [number, number]> = {
    picnic: [16, 36],
    toys: [20, PLAY_RADIUS - RADII.toys - 1],
    gardener: [24, PLAY_RADIUS - RADII.gardener - 1],
  };
  const sites: ZoneSite[] = [];
  for (const kind of order) {
    const radius = RADII[kind];
    for (const clear of [STRICT, RELAXED, LAST_RESORT]) {
      const [minD, maxD] = clear === LAST_RESORT ? [LAST_RESORT_MIN_DISTANCE, PLAY_RADIUS - radius - 1] : rings[kind];
      let best: ZoneSite | null = null;
      let bestScore = -Infinity;
      // Nas outras tentativas o espaço que sobra é pequeno: sorteia bem mais pontos.
      const samples = clear === STRICT ? 800 : 3000;
      for (let i = 0; i < samples; i++) {
        const a = rng.next() * Math.PI * 2;
        const d = minD + rng.next() * (maxD - minD);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (pathDistance(x, z) < radius + clear.path) continue;
        if (Math.hypot(x - BURROW.x, z - BURROW.z) < radius + BURROW.radius * 2.8 + clear.burrow) continue;
        if (PUDDLES.some((p) => Math.hypot(x - p.x, z - p.z) < radius + p.radius * clear.puddleScale + clear.puddle)) continue;
        if (sites.some((s) => Math.hypot(x - s.x, z - s.z) < radius + s.radius + clear.zones)) continue;
        // Prefere lugar longe dos outros cantinhos (espalha pelo mapa), com bastante acaso.
        const spread = sites.reduce((min, s) => Math.min(min, Math.hypot(x - s.x, z - s.z)), 80);
        const score = Math.min(spread, 40) + rng.next() * 40;
        if (score > bestScore) {
          bestScore = score;
          // A "frente" olha mais ou menos para o nascimento (quem chega vê a cena), nunca igual.
          const facing = Math.atan2(-x, -z) + (rng.next() * 2 - 1) * FACING_JITTER;
          best = { kind, x, z, radius, facing };
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
