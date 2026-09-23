import * as THREE from 'three';
import { createRng, mixSeed, type Rng } from '../utils/math';
import { dirtAmount, BURROW, PLAY_RADIUS, PUDDLES } from './Terrain';
import type { SceneryContext } from './scenery/context';
import type { SceneryLayer } from './scenery/SceneryLayer';
import { buildRock, buildPebble } from './scenery/rocks';
import { buildMushroomCluster } from './scenery/mushrooms';
import { buildFlower, pickFlowerKind } from './scenery/flowers';
import { buildLog } from './scenery/logs';
import { pickZoneSites, type ZoneSite } from './zones';
import { buildCookie, buildPicnicCorner } from './objects/picnic';
import { buildSoldier, buildToyCar, buildToyCorner } from './objects/toys';
import { buildFlipflop, buildGardenerCorner, buildGlove, buildPot } from './objects/gardener';
import { buildGnome } from './objects/gnome';
import { buildApple, buildPinecone, buildStrawberry } from './objects/fruits';
import type { LostItem } from './objects/compose';

/**
 * O jardim de uma rodada, sorteado a partir de uma semente: onde ficam os
 * cantinhos, cada pedra, flor, cogumelo e tronco, as frutas caídas, o anão, os
 * chinelos (um pé em cada canto) e o que fugiu dos cantinhos. O relevo, a toca,
 * as poças e a trilha são do mapa (não mudam); todo o resto muda a cada rodada.
 *
 * É um gerador: cada `yield` é um pedacinho do trabalho (um objeto), para o
 * jardim da próxima rodada se montar aos poucos entre os quadros, sem engasgo.
 */

/** O que o sorteio decidiu e o resto do jogo precisa saber. */
export interface GardenPlan {
  readonly seed: number;
  readonly zones: readonly ZoneSite[];
  /** Onde as bolas de tênis (soltas, com física) começam. */
  readonly tennisBalls: readonly THREE.Vector2[];
}

/** Um sorteio independente por assunto (mexer num não embaralha os outros). */
const Salt = { zones: 1, nature: 2, corners: 3, strays: 4, pebbles: 5 } as const;

/**
 * Quantos de cada coisa da natureza: as mesmas contas do jardim fixo de antes
 * (o volume total que dá para engolir não muda). Tronco é o maior e só cabiam
 * dois no jardim antigo: agora são dois de propósito, e nascem antes das flores
 * (senão às vezes não sobraria chão para eles).
 */
const ROCKS = 36;
const MUSHROOMS = 14;
const FLOWERS = 78;
const LOGS = 2;
const STRAY_PINECONES = 8;
const STRAY_APPLES = 4;
const PEBBLES = 260;

/** Chão reservado de cada coisa solta pelo jardim (raio). */
const Footprint = {
  gnome: 3.2,
  /** O chinelo é comprido (10 u): o círculo cobre o pé inteiro deitado. */
  flipflop: 5.4,
  strawberry: 1.4,
  cookie: 1.6,
  soldier: 1.4,
  toyCar: 2.4,
  glove: 4.6,
  pot: 2.6,
  pinecone: 2.2,
  apple: 2.4,
} as const;

/** Os dois pés do chinelo ficam longe um do outro: um em cada canto do jardim. */
const FLIPFLOP_APART = 30;

export function* buildGarden(layer: SceneryLayer, seed: number, decor: number): Generator<void, GardenPlan> {
  // O ponto de nascimento, a toca e as poças ficam livres.
  layer.placements.push({ x: 0, z: 0, radius: 7 });
  layer.dug.push({ x: BURROW.x, z: BURROW.z, radius: BURROW.radius * 2.6 });
  for (const p of PUDDLES) layer.dug.push({ x: p.x, z: p.z, radius: p.radius * 1.25 });
  layer.placements.push(...layer.dug);

  // Os cantinhos primeiro: a natureza nasce em volta deles (e do patinho da poça).
  const zones = pickZoneSites(mixSeed(seed, Salt.zones));
  for (const zone of zones) layer.placements.push({ x: zone.x, z: zone.z, radius: zone.radius });
  const cornerCtx = layer.context(createRng(mixSeed(seed, Salt.corners)), decor);
  const lost: LostItem[] = [];
  let tennisBalls: THREE.Vector2[] = [];
  for (const zone of zones) {
    if (zone.kind === 'picnic') yield* buildPicnicCorner(cornerCtx, zone, lost);
    else if (zone.kind === 'toys') tennisBalls = yield* buildToyCorner(cornerCtx, zone, lost);
    else yield* buildGardenerCorner(cornerCtx, zone, lost);
  }

  // As coisas grandes soltas vêm antes da natureza (depois não sobraria chão para um chinelo).
  const strayRng = createRng(mixSeed(seed, Salt.strays));
  const strays = layer.context(strayRng, decor);
  yield* scatterBigStrays(layer, strays, lost);

  const natureRng = createRng(mixSeed(seed, Salt.nature));
  const nature = layer.context(natureRng, decor);
  yield* placeMany(layer, natureRng, LOGS, 5, (x, z) => buildLog(nature, x, z));
  yield* placeMany(layer, natureRng, ROCKS, 2.6, (x, z) => buildRock(nature, x, z, natureRng.range(1.1, 3.9)));
  yield* placeMany(layer, natureRng, MUSHROOMS, 4, (x, z) => buildMushroomCluster(nature, x, z, natureRng.range(2.6, 5.6)));
  yield* placeMany(layer, natureRng, FLOWERS, 1.4, (x, z) => buildFlower(nature, x, z, natureRng.range(2.8, 6.8), pickFlowerKind(natureRng)));

  // Pinhas e maçãs caídas no que sobrou de chão.
  yield* placeMany(layer, strayRng, STRAY_PINECONES, Footprint.pinecone, (x, z) => buildPinecone(strays, x, z, strayRng.next() * Math.PI * 2));
  yield* placeMany(layer, strayRng, STRAY_APPLES, Footprint.apple, (x, z) => buildApple(strays, x, z, strayRng.next() * Math.PI * 2));
  yield* scatterPebbles(layer, createRng(mixSeed(seed, Salt.pebbles)), decor);

  yield* layer.finish();
  return { seed, zones, tennisBalls };
}

/**
 * O que fica solto pelo jardim, fora dos cantinhos: o anão de jardim (longe do
 * nascimento — é o chefão), cada pé do chinelo num canto e o que fugiu dos
 * cantinhos.
 */
function* scatterBigStrays(layer: SceneryLayer, ctx: SceneryContext, lost: readonly LostItem[]): Generator<void> {
  const { rng } = ctx;
  const yawTowardSpawn = (x: number, z: number) => Math.atan2(-x, -z) + rng.range(-0.8, 0.8);

  yield* placeMany(layer, rng, 1, Footprint.gnome, (x, z) => buildGnome(ctx, x, z, yawTowardSpawn(x, z)), { minDistance: 30 });

  let firstFoot: THREE.Vector2 | null = null;
  for (const right of [false, true]) {
    const apart: THREE.Vector2 | null = firstFoot;
    yield* placeMany(
      layer,
      rng,
      1,
      Footprint.flipflop,
      (x, z) => {
        buildFlipflop(ctx, x, z, rng.range(0, Math.PI * 2), right);
        firstFoot = new THREE.Vector2(x, z);
      },
      { minDistance: 18, avoid: apart, avoidDistance: FLIPFLOP_APART },
    );
  }

  for (const item of lost) {
    yield* placeMany(layer, rng, 1, Footprint[item], (x, z) => buildLost(ctx, item, x, z), { minDistance: 12 });
  }
}

function buildLost(ctx: SceneryContext, item: LostItem, x: number, z: number): void {
  const yaw = ctx.rng.next() * Math.PI * 2;
  if (item === 'strawberry') buildStrawberry(ctx, x, z, yaw);
  else if (item === 'cookie') buildCookie(ctx, x, z, yaw);
  else if (item === 'soldier') buildSoldier(ctx, x, z, yaw, 0, ctx.rng.next() < 0.5);
  else if (item === 'glove') buildGlove(ctx, x, z, yaw, ctx.rng.next() < 0.5);
  else if (item === 'pot') buildPot(ctx, x, z, yaw, 'label');
  else buildToyCar(ctx, x, z, yaw, ctx.rng.next() < 0.5 ? 'upright' : 'upsideDown');
}

interface PlaceOptions {
  /** Distância mínima do nascimento (coisa grande fica mais pro fim da exploração). */
  minDistance?: number;
  /** Ponto do qual manter distância (o outro pé do chinelo). */
  avoid?: THREE.Vector2 | null;
  avoidDistance?: number;
}

/**
 * Espalha `count` coisas pelo jardim em lugares livres (fora dos cantinhos, da
 * toca, das poças e do que já nasceu). Coisa grande não nasce no meio da trilha.
 * Um `yield` por coisa posta (ou mais, se o construtor também for um gerador).
 */
function* placeMany(
  layer: SceneryLayer,
  rng: Rng,
  count: number,
  footprint: number,
  build: (x: number, z: number) => void | Generator<void>,
  options: PlaceOptions = {},
): Generator<void> {
  const { minDistance = 8, avoid = null, avoidDistance = 0 } = options;
  // Coisa grande fica inteira dentro da área jogável (nada de chinelo na subida da borda).
  const span = PLAY_RADIUS - 2 - Math.max(0, footprint - 2) - minDistance;
  let placed = 0;
  let attempts = 0;
  // Coisa única e grande (anão, chinelo) tenta bem mais antes de desistir.
  const maxAttempts = Math.max(count * 60, 400);
  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const angle = rng.next() * Math.PI * 2;
    const radius = minDistance + Math.sqrt(rng.next()) * span;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (dirtAmount(x, z) > 0.6 && footprint > 2) continue; // deixa a trilha desimpedida
    if (!layer.isFree(x, z, footprint)) continue;
    if (avoid && Math.hypot(avoid.x - x, avoid.y - z) < avoidDistance) continue;
    layer.placements.push({ x, z, radius: footprint });
    // Construtor que também é gerador (touceira de cogumelos) se monta em vários passos.
    const steps = build(x, z);
    if (steps) yield* steps;
    placed++;
    yield;
  }
}

/** Pedrinhas soltas espalhadas (mais na trilha de terra): baratas, saem em lotes. */
function* scatterPebbles(layer: SceneryLayer, rng: Rng, decor: number): Generator<void> {
  const ctx = layer.context(rng, decor);
  const count = Math.round(PEBBLES * decor);
  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 3 + Math.sqrt(rng.next()) * (PLAY_RADIUS + 4);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    // Na terra batida elas aparecem mais; no gramado, de vez em quando.
    if (rng.next() > 0.12 + dirtAmount(x, z) * 0.88) continue;
    if (layer.isInsideSolid(x, z, 0.3) || layer.isDug(x, z) || layer.isCovered(x, z, 0.2)) continue;
    buildPebble(ctx, x, z, rng.range(0.07, 0.24));
    placed++;
    if (placed % 40 === 0) yield;
  }
}
