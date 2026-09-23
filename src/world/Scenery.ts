import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { StaticBatch, type RemovableParts } from '../render/StaticBatch';
import { createRng, type Rng } from '../utils/math';
import { dirtAmount, BURROW, PLAY_RADIUS, PUDDLES, type ContactShade } from './Terrain';
import type { CoverArea, PickableSpec, SceneryContext } from './scenery/context';
import { buildRock, buildPebble } from './scenery/rocks';
import { buildMushroomCluster } from './scenery/mushrooms';
import { buildFlower, pickFlowerKind } from './scenery/flowers';
import { buildLog } from './scenery/logs';
import { buildGiantTree } from './scenery/trees';
import { buildBush, buildFlowerPot } from './scenery/backdrop';
import { Clouds } from './scenery/Clouds';
import { ZONES } from './zones';
import { buildPicnicCorner } from './objects/picnic';
import { buildToyCorner, tennisBallSpots } from './objects/toys';
import { buildGardenerCorner } from './objects/gardener';
import { buildApple, buildPinecone } from './objects/fruits';

/**
 * Cenário "jardim visto por um besouro": pedras viram rochedos, cogumelos e
 * flores são árvores, gravetos são troncos. Cada tipo tem seu construtor em
 * `scenery/`; aqui só se decide ONDE as coisas vão e se junta tudo num lote
 * estático (poucos draw calls, mesmo com milhares de peças).
 *
 * Flores, cogumelos, pedras e troncos são "arrancáveis": continuam no lote,
 * mas o lote sabe apagá-los (e devolvê-los numa rodada nova).
 *
 * Os três cantinhos temáticos (`ZONES`: piquenique, brinquedos, jardineiro)
 * ficam reservados — o sorteio da natureza não cai dentro deles — e cada um
 * monta a própria cena em `objects/`, com um sorteio só dele (mexer num
 * cantinho não embaralha o resto do jardim).
 */

const worldGroups = interactionGroups(Groups.WORLD, 0xffff);
/** Sementes dos sorteios próprios dos objetos novos (independentes do jardim natural). */
const ZONE_SEED = 5151;
const STRAY_SEED = 6262;
/** Pinhas e maçãs soltas pelo jardim, fora dos cantinhos. */
const STRAY_PINECONES = 8;
const STRAY_APPLES = 4;

/** Área coberta já com seno/cosseno do giro (o teste roda milhares de vezes na grama). */
interface Cover extends CoverArea {
  readonly cos: number;
  readonly sin: number;
  /** Raio do círculo que envolve o retângulo (descarte rápido). */
  readonly bound: number;
}

interface Placement {
  x: number;
  z: number;
  radius: number;
}

/** Um arrancável registrado, com o estado de jogo dele. */
export interface PickableRecord extends PickableSpec {
  readonly id: number;
  /** Meio da cápsula de contato (para descartar rápido o que está longe). */
  readonly center: THREE.Vector3;
  /** Metade do comprimento da cápsula + raio (alcance a partir do centro). */
  readonly reach: number;
  picked: boolean;
}

export class Scenery {
  readonly group = new THREE.Group();
  /** Pontos de pouso para borboletas e abelhas (miolos de flor, chapéus...). Array vivo: some o que foi arrancado. */
  readonly landingSpots: THREE.Vector3[] = [];
  /** Sombras de contato para o terreno pintar. */
  readonly shades: ContactShade[] = [];
  /** Tudo que a bola pode arrancar do chão. */
  readonly pickables: PickableRecord[] = [];

  private readonly placements: Placement[] = [];
  /** Áreas cavadas (toca e poças): nada de enfeite solto dentro delas. */
  private readonly dug: Placement[] = [];
  private readonly solids: Placement[] = [];
  private readonly covers: Cover[] = [];
  private readonly clouds: Clouds;
  private readonly rng: Rng;
  private readonly removables: RemovableParts;

  constructor(private readonly physics: Physics, decor = 1, seed = 7) {
    this.rng = createRng(seed);
    this.group.name = 'scenery';
    const batch = new StaticBatch();
    const ctx = this.createContext(batch, decor);

    // O ponto de nascimento, a toca e as poças ficam livres.
    this.placements.push({ x: 0, z: 0, radius: 7 });
    this.dug.push({ x: BURROW.x, z: BURROW.z, radius: BURROW.radius * 2.6 });
    for (const p of PUDDLES) this.dug.push({ x: p.x, z: p.z, radius: p.radius * 1.25 });
    this.placements.push(...this.dug);
    // Os cantinhos também: flor, pedra, cogumelo e tronco nascem fora deles.
    for (const zone of ZONES) this.placements.push({ x: zone.x, z: zone.z, radius: zone.radius });

    this.placeMany(36, 2.6, (x, z) => buildRock(ctx, x, z, this.rng.range(1.1, 3.9)));
    this.placeMany(14, 4, (x, z) => buildMushroomCluster(ctx, x, z, this.rng.range(2.6, 5.6)));
    this.placeMany(78, 1.4, (x, z) => buildFlower(ctx, x, z, this.rng.range(2.8, 6.8), pickFlowerKind(this.rng)));
    this.placeMany(10, 5, (x, z) => buildLog(ctx, x, z));
    this.buildZones(ctx);
    this.scatterStrays(ctx);
    // Pedrinhas soltas espalhadas (mais na trilha de terra).
    this.scatterPebbles(ctx, Math.round(260 * decor));

    this.addHorizon(ctx);
    this.group.add(batch.build());
    this.removables = batch.removables;

    this.clouds = new Clouds(this.rng, 16);
    this.group.add(this.clouds.group);
  }

  /** Nuvens passeando devagar. */
  update(dt: number): void {
    this.clouds.update(dt);
  }

  /** Céu fechando (0 = limpo, 1 = tempestade): nuvens ficam cinzentas. */
  setOvercast(amount: number): void {
    this.clouds.setOvercast(amount);
  }

  /** Posições livres (para outros sistemas espalharem coisas sem cair dentro de pedra). */
  isFree(x: number, z: number, radius: number): boolean {
    return this.placements.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + radius);
  }

  /** Dentro do "pé" de algo sólido (pedra, tronco, caule)? Grama e enfeites evitam. */
  isInsideSolid(x: number, z: number, margin = 0): boolean {
    for (const s of this.solids) {
      const dx = s.x - x;
      const dz = s.z - z;
      const r = s.radius + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * Em cima de algo chato que cobre o chão (a toalha do piquenique, chinelo, luva,
   * pá deitada, terra derramada)? Grama e cobertura do chão não devem nascer ali.
   * Não é "sólido": bicho anda por cima.
   */
  isCovered(x: number, z: number, margin = 0): boolean {
    for (const c of this.covers) if (this.insideCover(c, x, z, margin)) return true;
    return false;
  }

  /** Quanto a superfície fica acima do terreno num ponto (a toalha ondulada); 0 fora dela. */
  coverHeight(x: number, z: number): number {
    for (const c of this.covers) if (c.lift && this.insideCover(c, x, z, 0)) return c.lift(x, z);
    return 0;
  }

  private insideCover(c: Cover, x: number, z: number, margin: number): boolean {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.bound + margin;
    if (dx * dx + dz * dz > reach * reach) return false;
    // Coordenadas locais do retângulo (o comprimento é o Z local depois do giro).
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    return Math.abs(lx) <= c.halfWidth + margin && Math.abs(lz) <= c.halfLength + margin;
  }

  /** Dentro da toca ou de uma bacia de poça (bicho de chão não passeia ali). */
  isDug(x: number, z: number): boolean {
    return this.dug.some((d) => Math.hypot(d.x - x, d.z - z) < d.radius);
  }

  /** A bola arrancou: some do lote, os colisores desligam e os insetos perdem o pouso. */
  detach(record: PickableRecord): void {
    if (record.picked) return;
    record.picked = true;
    this.removables.hide(record.id);
    for (const collider of record.colliders) collider.setEnabled(false);
    for (const spot of record.landingSpots) {
      const i = this.landingSpots.indexOf(spot);
      if (i >= 0) this.landingSpots.splice(i, 1);
    }
  }

  /** Rodada nova: tudo que foi arrancado volta para o lugar. */
  restoreAll(): void {
    for (const record of this.pickables) {
      if (!record.picked) continue;
      record.picked = false;
      this.removables.show(record.id);
      for (const collider of record.colliders) collider.setEnabled(true);
      for (const spot of record.landingSpots) if (!this.landingSpots.includes(spot)) this.landingSpots.push(spot);
    }
  }

  private createContext(batch: StaticBatch, decor: number): SceneryContext {
    return {
      rng: this.rng,
      batch,
      decor,
      addCollider: (desc, position, rotation) => this.addFixedCollider(desc, position, rotation),
      addSolid: (x, z, radius) => this.solids.push({ x, z, radius }),
      addShade: (x, z, radius, strength) => this.shades.push({ x, z, radius, strength }),
      addLandingSpot: (p) => {
        const spot = p.clone();
        this.landingSpots.push(spot);
        return spot;
      },
      addPickable: (spec) => {
        const id = this.pickables.length;
        batch.addObject(spec.root, { ...spec.batch, removableId: id });
        const center = spec.probeA.clone().add(spec.probeB).multiplyScalar(0.5);
        const reach = spec.probeA.distanceTo(spec.probeB) / 2 + spec.probeRadius;
        this.pickables.push({ ...spec, id, center, reach, picked: false });
      },
      addCover: (area) => {
        this.covers.push({ ...area, cos: Math.cos(area.yaw), sin: Math.sin(area.yaw), bound: Math.hypot(area.halfWidth, area.halfLength) });
      },
    };
  }

  /** Cada cantinho monta a sua cena, com um sorteio próprio. */
  private buildZones(ctx: SceneryContext): void {
    const zoneCtx: SceneryContext = { ...ctx, rng: createRng(ZONE_SEED) };
    for (const zone of ZONES) {
      if (zone.kind === 'picnic') buildPicnicCorner(zoneCtx, zone);
      else if (zone.kind === 'toys') {
        buildToyCorner(zoneCtx, zone);
        // Lugar das bolas de tênis (são soltas, com física): nada de enfeite em cima.
        for (const spot of tennisBallSpots(zone)) this.placements.push({ x: spot.x, z: spot.y, radius: 1.9 });
      } else buildGardenerCorner(zoneCtx, zone);
    }
  }

  /** Pinhas e maçãs caídas pelo jardim, fora dos cantinhos (sorteio próprio). */
  private scatterStrays(ctx: SceneryContext): void {
    const rng = createRng(STRAY_SEED);
    const strayCtx: SceneryContext = { ...ctx, rng };
    this.placeMany(STRAY_PINECONES, 2.2, (x, z) => buildPinecone(strayCtx, x, z, rng.next() * Math.PI * 2), rng);
    this.placeMany(STRAY_APPLES, 2.4, (x, z) => buildApple(strayCtx, x, z, rng.next() * Math.PI * 2), rng);
  }

  private placeMany(count: number, footprint: number, build: (x: number, z: number) => void, rng: Rng = this.rng): void {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const radius = 8 + Math.sqrt(rng.next()) * (PLAY_RADIUS - 10);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (dirtAmount(x, z) > 0.6 && footprint > 2) continue; // deixa a trilha desimpedida
      if (!this.isFree(x, z, footprint)) continue;
      this.placements.push({ x, z, radius: footprint });
      build(x, z);
      placed++;
    }
  }

  private scatterPebbles(ctx: SceneryContext, count: number): void {
    let placed = 0;
    for (let i = 0; i < count * 6 && placed < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = 3 + Math.sqrt(this.rng.next()) * (PLAY_RADIUS + 4);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // Na terra batida elas aparecem mais; no gramado, de vez em quando.
      if (this.rng.next() > 0.12 + dirtAmount(x, z) * 0.88) continue;
      if (this.isInsideSolid(x, z, 0.3) || this.isDug(x, z) || this.isCovered(x, z, 0.2)) continue;
      buildPebble(ctx, x, z, this.rng.range(0.07, 0.24));
      placed++;
    }
  }

  /** Árvores gigantes, moitas e o vaso: o horizonte do jardim. */
  private addHorizon(ctx: SceneryContext): void {
    const rng = this.rng;
    const trees = 11;
    for (let i = 0; i < trees; i++) {
      const angle = (i / trees) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const dist = rng.range(80, 98);
      buildGiantTree(ctx, Math.cos(angle) * dist, Math.sin(angle) * dist, rng.range(5, 8.5), rng.range(70, 98));
    }
    for (let i = 0; i < 22; i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.range(70, 92);
      buildBush(ctx, Math.cos(angle) * dist, Math.sin(angle) * dist, rng.range(5, 10));
    }
    buildFlowerPot(ctx, 58, -64);
  }

  private addFixedCollider(desc: RAPIER.ColliderDesc, position: THREE.Vector3, rotation?: THREE.Quaternion): RAPIER.Collider {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (rotation) bodyDesc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const body = this.physics.world.createRigidBody(bodyDesc);
    return this.physics.world.createCollider(desc.setCollisionGroups(worldGroups).setFriction(0.9), body);
  }
}
