import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { StaticBatch } from '../render/StaticBatch';
import { createRng, type Rng } from '../utils/math';
import { dirtAmount, PLAY_RADIUS, type ContactShade } from './Terrain';
import type { SceneryContext } from './scenery/context';
import { buildRock, buildPebble } from './scenery/rocks';
import { buildMushroomCluster } from './scenery/mushrooms';
import { buildFlower, pickFlowerKind } from './scenery/flowers';
import { buildLog } from './scenery/logs';
import { buildGiantTree } from './scenery/trees';
import { buildBush, buildFlowerPot } from './scenery/backdrop';
import { Clouds } from './scenery/Clouds';

/**
 * Cenário "jardim visto por um besouro": pedras viram rochedos, cogumelos e
 * flores são árvores, gravetos são troncos. Cada tipo tem seu construtor em
 * `scenery/`; aqui só se decide ONDE as coisas vão e se junta tudo num lote
 * estático (poucos draw calls, mesmo com milhares de peças).
 */

const worldGroups = interactionGroups(Groups.WORLD, 0xffff);

interface Placement {
  x: number;
  z: number;
  radius: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  /** Pontos de pouso para borboletas e abelhas (miolos de flor, chapéus...). */
  readonly landingSpots: THREE.Vector3[] = [];
  /** Sombras de contato para o terreno pintar. */
  readonly shades: ContactShade[] = [];

  private readonly placements: Placement[] = [];
  private readonly solids: Placement[] = [];
  private readonly clouds: Clouds;
  private readonly rng: Rng;

  constructor(private readonly physics: Physics, decor = 1, seed = 7) {
    this.rng = createRng(seed);
    this.group.name = 'scenery';
    const batch = new StaticBatch();
    const ctx = this.createContext(batch, decor);

    // O ponto de nascimento fica livre.
    this.placements.push({ x: 0, z: 0, radius: 7 });

    this.placeMany(36, 2.6, (x, z) => buildRock(ctx, x, z, this.rng.range(1.1, 3.9)));
    this.placeMany(14, 4, (x, z) => buildMushroomCluster(ctx, x, z, this.rng.range(2.6, 5.6)));
    this.placeMany(78, 1.4, (x, z) => buildFlower(ctx, x, z, this.rng.range(2.8, 6.8), pickFlowerKind(this.rng)));
    this.placeMany(10, 5, (x, z) => buildLog(ctx, x, z));
    // Pedrinhas soltas espalhadas (mais na trilha de terra).
    this.scatterPebbles(ctx, Math.round(260 * decor));

    this.addHorizon(ctx);
    this.group.add(batch.build());

    this.clouds = new Clouds(this.rng, 16);
    this.group.add(this.clouds.group);
  }

  /** Nuvens passeando devagar. */
  update(dt: number): void {
    this.clouds.update(dt);
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

  private createContext(batch: StaticBatch, decor: number): SceneryContext {
    return {
      rng: this.rng,
      batch,
      decor,
      addCollider: (desc, position, rotation) => this.addFixedCollider(desc, position, rotation),
      addSolid: (x, z, radius) => this.solids.push({ x, z, radius }),
      addShade: (x, z, radius, strength) => this.shades.push({ x, z, radius, strength }),
      addLandingSpot: (p) => this.landingSpots.push(p.clone()),
    };
  }

  private placeMany(count: number, footprint: number, build: (x: number, z: number) => void): void {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const angle = this.rng.next() * Math.PI * 2;
      const radius = 8 + Math.sqrt(this.rng.next()) * (PLAY_RADIUS - 10);
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
      if (this.isInsideSolid(x, z, 0.3)) continue;
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

  private addFixedCollider(desc: RAPIER.ColliderDesc, position: THREE.Vector3, rotation?: THREE.Quaternion): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (rotation) bodyDesc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const body = this.physics.world.createRigidBody(bodyDesc);
    this.physics.world.createCollider(desc.setCollisionGroups(worldGroups).setFriction(0.9), body);
  }
}
