import * as THREE from 'three';
import { clay } from '../../render/clayMaterial';
import { createRng, damp, dampAngle, type Rng } from '../../utils/math';
import { terrainHeight, terrainNormal, PLAY_RADIUS } from '../../world/Terrain';
import {
  beeBody,
  butterflyBody,
  butterflyWings,
  ButterflyPalettes,
  dragonflyBody,
  ladybugBody,
  snailBody,
  snailShell,
  thinWings,
} from './models';

/** Onde o bicho pode andar no chão (fora de pedras, troncos...). */
export type GroundFilter = (x: number, z: number) => boolean;

interface CritterContext {
  rng: Rng;
  /** Pontos de pouso (flores, chapéus de cogumelo). */
  spots: THREE.Vector3[];
  player: THREE.Vector3;
  camera: THREE.Vector3;
  isGroundFree: GroundFilter;
}

interface Critter {
  root: THREE.Object3D;
  update(dt: number, time: number, ctx: CritterContext): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** Asa esquerda = direita espelhada em X (material dupla face, então não precisa desvirar). */
function wingPair(geometry: THREE.BufferGeometry, material: THREE.Material): [THREE.Group, THREE.Group] {
  const right = new THREE.Group();
  const left = new THREE.Group();
  const r = new THREE.Mesh(geometry, material);
  const l = new THREE.Mesh(geometry, material);
  l.scale.x = -1;
  right.add(r);
  left.add(l);
  return [right, left];
}

function shadowed(root: THREE.Object3D, cast = true): THREE.Object3D {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = true;
    }
  });
  return root;
}

/**
 * Voador colado na lente vira um borrão gigante na tela: empurra para longe da câmera.
 * Devolve true se precisou empurrar (o bicho deve escolher outro destino).
 */
function repelFromCamera(position: THREE.Vector3, camera: THREE.Vector3, dt: number): boolean {
  const away = tmpB.copy(position).sub(camera);
  const dist = away.length();
  if (dist > 3.2) return false;
  position.addScaledVector(away.divideScalar(Math.max(dist, 1e-3)), (3.2 - dist) * 6 * dt);
  return true;
}

/** Sorteia um ponto de pouso perto do jogador (ou qualquer um, se nenhum estiver perto). */
function pickSpotNear(ctx: CritterContext, maxDistance: number): THREE.Vector3 | null {
  if (ctx.spots.length === 0) return null;
  for (let i = 0; i < 12; i++) {
    const s = ctx.rng.pick(ctx.spots);
    if (s.distanceTo(ctx.player) < maxDistance) return s;
  }
  return ctx.rng.pick(ctx.spots);
}

/** Ponto no ar perto do jogador. */
function airPointNear(ctx: CritterContext, radius: number, minH: number, maxH: number, target: THREE.Vector3): THREE.Vector3 {
  const a = ctx.rng.next() * Math.PI * 2;
  const d = ctx.rng.range(radius * 0.3, radius);
  const x = THREE.MathUtils.clamp(ctx.player.x + Math.cos(a) * d, -PLAY_RADIUS, PLAY_RADIUS);
  const z = THREE.MathUtils.clamp(ctx.player.z + Math.sin(a) * d, -PLAY_RADIUS, PLAY_RADIUS);
  return target.set(x, terrainHeight(x, z) + ctx.rng.range(minH, maxH), z);
}

// ---------------------------------------------------------------------------

/**
 * Borboleta: voo em zigue-zague de ponto de pouso em ponto de pouso, pousa nas
 * flores abrindo e fechando as asas devagar.
 */
class Butterfly implements Critter {
  readonly root = new THREE.Group();
  private readonly wings: [THREE.Group, THREE.Group];
  private readonly target = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private perched = 0;
  private phase: number;
  private yaw = 0;

  constructor(ctx: CritterContext, bodyMat: THREE.Material, wingMat: THREE.Material, bodyGeo: THREE.BufferGeometry, wingGeo: THREE.BufferGeometry) {
    this.phase = ctx.rng.next() * 100;
    this.root.add(new THREE.Mesh(bodyGeo, bodyMat));
    this.wings = wingPair(wingGeo, wingMat);
    this.root.add(...this.wings);
    shadowed(this.root);
    airPointNear(ctx, 25, 1.5, 5, this.root.position);
    this.chooseTarget(ctx);
  }

  private chooseTarget(ctx: CritterContext): void {
    const spot = ctx.rng.next() < 0.7 ? pickSpotNear(ctx, 28) : null;
    if (spot) this.target.copy(spot).add(tmpA.set(0, 0.12, 0));
    else airPointNear(ctx, 22, 1.2, 5, this.target);
  }

  update(dt: number, time: number, ctx: CritterContext): void {
    const t = time + this.phase;
    let flap: number;
    if (this.perched > 0) {
      this.perched -= dt;
      // Pousada: abre e fecha devagar, de vez em quando.
      flap = 0.15 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 1.1;
      if (this.perched <= 0) {
        this.chooseTarget(ctx);
        this.velocity.set(0, 2.5, 0);
      }
    } else {
      const to = tmpA.copy(this.target).sub(this.root.position);
      const dist = to.length();
      if (this.root.position.distanceTo(ctx.player) > 45) this.chooseTarget(ctx);
      if (dist < 0.25) {
        this.perched = ctx.rng.range(2.5, 6);
        this.velocity.set(0, 0, 0);
        this.root.position.copy(this.target);
      } else {
        // Direção + "tremida" de borboleta (nunca voa reto).
        to.divideScalar(dist).multiplyScalar(Math.min(2.6, dist * 2 + 0.6));
        to.x += Math.sin(t * 3.1) * 1.4;
        to.y += Math.sin(t * 5.3) * 1.1;
        to.z += Math.cos(t * 2.7) * 1.4;
        this.velocity.lerp(to, 1 - Math.exp(-3 * dt));
        this.root.position.addScaledVector(this.velocity, dt);
        const ground = terrainHeight(this.root.position.x, this.root.position.z) + 0.4;
        if (this.root.position.y < ground) this.root.position.y = ground;
        if (Math.hypot(this.velocity.x, this.velocity.z) > 0.2) this.yaw = dampAngle(this.yaw, Math.atan2(this.velocity.x, this.velocity.z), 5, dt);
      }
      flap = (Math.sin(t * 22) * 0.5 + 0.5) * 1.35 - 0.2;
    }
    if (repelFromCamera(this.root.position, ctx.camera, dt) && this.perched <= 0 && this.target.distanceTo(ctx.camera) < 3.5) this.chooseTarget(ctx);
    this.root.rotation.set(this.perched > 0 ? 0 : -0.25, this.yaw, 0, 'YXZ');
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
  }
}

/**
 * Abelha: rodeia uma flor em oito, vai para outra. Asa em borrão (bate rápido
 * demais para ver) e zumbido visual: o corpo treme um pouquinho.
 */
class Bee implements Critter {
  readonly root = new THREE.Group();
  private readonly wings: [THREE.Group, THREE.Group];
  private readonly flower = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private timer = 0;
  private phase: number;
  private yaw = 0;

  constructor(ctx: CritterContext, bodyMat: THREE.Material, wingMat: THREE.Material, bodyGeo: THREE.BufferGeometry, wingGeo: THREE.BufferGeometry) {
    this.phase = ctx.rng.next() * 100;
    this.root.add(new THREE.Mesh(bodyGeo, bodyMat));
    this.wings = wingPair(wingGeo, wingMat);
    for (const w of this.wings) w.position.set(0, 0.12, 0.02);
    this.root.add(...this.wings);
    shadowed(this.root);
    this.root.scale.setScalar(0.9);
    airPointNear(ctx, 20, 1, 3, this.root.position);
    this.pickFlower(ctx);
  }

  private pickFlower(ctx: CritterContext): void {
    const spot = pickSpotNear(ctx, 26);
    if (spot) this.flower.copy(spot);
    else airPointNear(ctx, 20, 1, 3, this.flower);
    this.timer = ctx.rng.range(4, 9);
  }

  update(dt: number, time: number, ctx: CritterContext): void {
    const t = time + this.phase;
    this.timer -= dt;
    if (this.timer <= 0 || this.root.position.distanceTo(ctx.player) > 45) this.pickFlower(ctx);
    // Oito deitado em volta da flor.
    const orbit = tmpA.set(Math.sin(t * 1.7) * 0.9, 0.45 + Math.sin(t * 3.4) * 0.25, Math.sin(t * 3.4) * 0.45).add(this.flower);
    const to = orbit.sub(this.root.position);
    const dist = to.length();
    to.multiplyScalar(Math.min(6, dist * 3) / Math.max(dist, 1e-3));
    this.velocity.lerp(to, 1 - Math.exp(-4 * dt));
    this.root.position.addScaledVector(this.velocity, dt);
    const ground = terrainHeight(this.root.position.x, this.root.position.z) + 0.3;
    if (this.root.position.y < ground) this.root.position.y = ground;
    if (Math.hypot(this.velocity.x, this.velocity.z) > 0.15) this.yaw = dampAngle(this.yaw, Math.atan2(this.velocity.x, this.velocity.z), 8, dt);
    if (repelFromCamera(this.root.position, ctx.camera, dt) && this.flower.distanceTo(ctx.camera) < 3.5) this.pickFlower(ctx);
    this.root.rotation.set(Math.sin(t * 40) * 0.04, this.yaw, Math.sin(t * 37) * 0.05, 'YXZ');
    const flap = 0.4 + Math.sin(t * 90) * 0.5;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
  }
}

/**
 * Libélula: paira no ar, dá um "tiro" rápido para outro ponto e para de novo.
 */
class Dragonfly implements Critter {
  readonly root = new THREE.Group();
  private readonly wings: [THREE.Group, THREE.Group];
  private readonly target = new THREE.Vector3();
  private hover = 0;
  private phase: number;
  private yaw = 0;

  constructor(ctx: CritterContext, bodyMat: THREE.Material, wingMat: THREE.Material, bodyGeo: THREE.BufferGeometry, wingGeo: THREE.BufferGeometry) {
    this.phase = ctx.rng.next() * 100;
    this.root.add(new THREE.Mesh(bodyGeo, bodyMat));
    this.wings = wingPair(wingGeo, wingMat);
    for (const w of this.wings) w.position.set(0, 0.08, 0);
    this.root.add(...this.wings);
    shadowed(this.root);
    airPointNear(ctx, 25, 3, 6, this.root.position);
    this.target.copy(this.root.position);
  }

  update(dt: number, time: number, ctx: CritterContext): void {
    const t = time + this.phase;
    const pos = this.root.position;
    if (this.hover > 0) {
      this.hover -= dt;
      pos.y += Math.sin(t * 2.3) * 0.15 * dt;
      if (this.hover <= 0) {
        airPointNear(ctx, 20, 2.5, 6, this.target);
        this.yaw = Math.atan2(this.target.x - pos.x, this.target.z - pos.z);
      }
    } else {
      pos.x = damp(pos.x, this.target.x, 3.2, dt);
      pos.y = damp(pos.y, this.target.y, 3.2, dt);
      pos.z = damp(pos.z, this.target.z, 3.2, dt);
      if (pos.distanceTo(this.target) < 0.15) this.hover = ctx.rng.range(1.2, 3.5);
    }
    if (repelFromCamera(pos, ctx.camera, dt) && this.target.distanceTo(ctx.camera) < 3.5) airPointNear(ctx, 20, 2.5, 6, this.target);
    this.root.rotation.set(0, this.yaw, Math.sin(t * 1.3) * 0.05, 'YXZ');
    const flap = Math.sin(t * 70) * 0.35;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
  }
}

/**
 * Bichinho de chão (joaninha, caracol): passeia devagar em volta de um "canto",
 * colado no relevo. Se o jogador se afasta muito, o canto se muda para perto dele
 * (sempre fora da vista, longe da câmera).
 */
class Crawler implements Critter {
  readonly root = new THREE.Group();
  private readonly home = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly groundUp = new THREE.Vector3(0, 1, 0);
  private yaw = 0;
  private pause = 0;
  private phase: number;

  constructor(
    ctx: CritterContext,
    parts: THREE.Object3D[],
    private readonly speed: number,
    private readonly wander: number,
  ) {
    this.phase = ctx.rng.next() * 100;
    this.root.add(...parts);
    shadowed(this.root);
    this.relocate(ctx, 6, 22);
  }

  private relocate(ctx: CritterContext, min: number, max: number): void {
    for (let i = 0; i < 30; i++) {
      const a = ctx.rng.next() * Math.PI * 2;
      const d = ctx.rng.range(min, max);
      const x = ctx.player.x + Math.cos(a) * d;
      const z = ctx.player.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > PLAY_RADIUS - 2 || !ctx.isGroundFree(x, z)) continue;
      this.home.set(x, 0, z);
      this.root.position.set(x, terrainHeight(x, z), z);
      this.target.copy(this.home);
      return;
    }
  }

  update(dt: number, time: number, ctx: CritterContext): void {
    const pos = this.root.position;
    if (Math.hypot(pos.x - ctx.player.x, pos.z - ctx.player.z) > 40) this.relocate(ctx, 20, 30);
    if (this.pause > 0) {
      this.pause -= dt;
    } else {
      const dx = this.target.x - pos.x;
      const dz = this.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.1) {
        this.pause = ctx.rng.range(0.5, 3);
        for (let i = 0; i < 8; i++) {
          const a = ctx.rng.next() * Math.PI * 2;
          const d = ctx.rng.range(0.5, this.wander);
          const x = this.home.x + Math.cos(a) * d;
          const z = this.home.z + Math.sin(a) * d;
          if (ctx.isGroundFree(x, z)) {
            this.target.set(x, 0, z);
            break;
          }
        }
      } else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 3, dt);
        const step = Math.min(dist, this.speed * dt);
        pos.x += Math.sin(this.yaw) * step;
        pos.z += Math.cos(this.yaw) * step;
      }
    }
    pos.y = terrainHeight(pos.x, pos.z);
    this.groundUp.lerp(terrainNormal(pos.x, pos.z, tmpB), 1 - Math.exp(-6 * dt)).normalize();
    this.root.quaternion.setFromUnitVectors(UP, this.groundUp).multiply(tmpQ.setFromAxisAngle(UP, this.yaw));
    // Rebolado de quem anda com seis patinhas (ou com uma, no caso do caracol).
    this.root.children[0].rotation.z = this.pause > 0 ? 0 : Math.sin((time + this.phase) * 14) * 0.04;
  }
}

// ---------------------------------------------------------------------------

/**
 * Vida no jardim: borboletas, abelhas, libélulas, joaninhas e um caracol.
 * Só visual (sem física) e sempre por perto do jogador.
 */
export class Critters {
  readonly group = new THREE.Group();
  private readonly critters: Critter[] = [];
  private readonly ctx: CritterContext;
  private time = 0;

  constructor(count: number, spots: THREE.Vector3[], isGroundFree: GroundFilter, seed = 31) {
    this.group.name = 'critters';
    const rng = createRng(seed);
    this.ctx = { rng, spots, player: new THREE.Vector3(), camera: new THREE.Vector3(), isGroundFree };

    const bodyMat = clay(0xffffff, { vertexColors: true, roughness: 0.55, sheen: 0.6, bump: 0.12, mottle: 0.05, mottleScale: 20 });
    const wingMat = clay(0xffffff, { vertexColors: true, roughness: 0.6, sheen: 0.8, bump: 0, mottle: 0.04, mottleScale: 12, side: THREE.DoubleSide });
    const glassWing = new THREE.MeshPhysicalMaterial({
      color: '#eef7ff',
      vertexColors: true,
      roughness: 0.15,
      metalness: 0,
      iridescence: 1,
      iridescenceIOR: 1.4,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const butterflyBodyGeo = butterflyBody();
    const butterflyWingGeos = ButterflyPalettes.map((p) => butterflyWings(p, 1.7));
    const beeBodyGeo = beeBody();
    const beeWingGeo = thinWings(0.34, 0.14, 2, 0.35);
    const dragonBodyGeo = dragonflyBody();
    const dragonWingGeo = thinWings(1.05, 0.2, 2, 0.12);
    const ladybugGeo = ladybugBody();
    const snailGeo = snailBody();
    const shellGeo = snailShell();

    // Receita por quantidade total (o celular recebe menos de cada).
    const plan: Array<[string, number]> = [
      ['butterfly', Math.round(count * 0.3)],
      ['bee', Math.round(count * 0.18)],
      ['ladybug', Math.round(count * 0.22)],
      ['dragonfly', Math.max(1, Math.round(count * 0.1))],
      ['snail', Math.max(1, Math.round(count * 0.07))],
    ];
    for (const [kind, n] of plan) {
      for (let i = 0; i < n; i++) {
        let critter: Critter;
        if (kind === 'butterfly') critter = new Butterfly(this.ctx, bodyMat, wingMat, butterflyBodyGeo, rng.pick(butterflyWingGeos));
        else if (kind === 'bee') critter = new Bee(this.ctx, bodyMat, glassWing, beeBodyGeo, beeWingGeo);
        else if (kind === 'dragonfly') critter = new Dragonfly(this.ctx, bodyMat, glassWing, dragonBodyGeo, dragonWingGeo);
        else if (kind === 'ladybug') critter = new Crawler(this.ctx, [new THREE.Mesh(ladybugGeo, bodyMat)], 0.55, 3);
        else {
          const snail = new THREE.Group();
          snail.add(new THREE.Mesh(snailGeo, bodyMat), new THREE.Mesh(shellGeo, clay(0xffffff, { vertexColors: true, roughness: 0.4, sheen: 0.5, clearcoat: 0.5, bump: 0.15, mottleScale: 10 })));
          critter = new Crawler(this.ctx, [snail], 0.14, 2);
        }
        // Asas transparentes fora do AO (o AO não sabe lidar com transparência).
        critter.root.traverse((o) => {
          if ((o as THREE.Mesh).material === glassWing) o.userData.skipAO = true;
        });
        this.critters.push(critter);
        this.group.add(critter.root);
      }
    }
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Vector3): void {
    this.time += dt;
    this.ctx.player.copy(player);
    this.ctx.camera.copy(camera);
    for (const c of this.critters) c.update(dt, this.time, this.ctx);
  }
}
