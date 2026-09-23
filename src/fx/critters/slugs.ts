import * as THREE from 'three';
import { damp, smoothstep } from '../../utils/math';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { SLUG_STALK_BASE, slimeStrip, slugBody, slugStalk } from './soilModels';
import { attraction, ballTakes, collectedMesh, inView, shoveFromBall, threatAt } from './common';
import { jointMatrix } from './flyers';
import { GroundWalker } from './walker';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Lesmas: só saem com o chão molhado (como as minhocas e os caracóis extras),
 * arrastam-se devagar esticando os tentáculos dos olhos e deixam um rastro de
 * gosma brilhante que vai secando (~30 s). Com susto, recolhem os olhos e
 * encolhem o corpo num "calombo". O rastro fresco deixa o chão escorregadio:
 * o jogo pergunta por `slimeAt`.
 */

/** Segundos até o rastro secar e sumir. */
const SLIME_LIFE = 30;
/** Distância andada entre dois pedaços de rastro. */
const SLIME_STEP = 0.09;
const SLUG_SIZE = 0.45;

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vPos = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Rastro de gosma: faixas deitadas no chão (um anel de vagas; a mais velha é
 * reaproveitada). Afina conforme seca. As matrizes só são reescritas algumas
 * vezes por segundo — secar é devagar, ninguém nota o degrau.
 */
class SlimeTrail {
  private readonly part: InstancedPart;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly yaw: Float32Array;
  private readonly width: Float32Array;
  private readonly born: Float32Array;
  private next = 0;
  private refresh = 0;

  constructor(private readonly capacity: number, parent: THREE.Group) {
    const material = new THREE.MeshPhysicalMaterial({
      // Película molhada: quase transparente, o que aparece é o brilho (o rastro prateado de lesma).
      color: '#c9d8d3',
      vertexColors: true,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.part = new InstancedPart(slimeStrip(), material, capacity, { name: 'slug-slime', castShadow: false, skipAO: true });
    this.part.mesh.receiveShadow = false;
    this.part.mesh.renderOrder = 2;
    parent.add(this.part.mesh);
    for (let i = 0; i < capacity; i++) this.part.allocate();
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.born = new Float32Array(capacity).fill(-1e6);
  }

  drop(x: number, y: number, z: number, yaw: number, width: number, time: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.yaw[i] = yaw;
    this.width[i] = width;
    this.born[i] = time;
    this.write(i, time);
  }

  /** 0..1: quanto é fresco (1 = acabou de sair da lesma). */
  private freshness(i: number, time: number): number {
    return Math.max(0, 1 - (time - this.born[i]) / SLIME_LIFE);
  }

  private write(i: number, time: number): void {
    const fresh = this.freshness(i, time);
    if (fresh <= 0) {
      this.part.hide(i);
      return;
    }
    qTmp.setFromAxisAngle(UP_AXIS, this.yaw[i]);
    vPos.set(this.x[i], this.y[i], this.z[i]);
    // Secando: a faixa afina (a gosma encolhe para o meio).
    const w = this.width[i] * (0.35 + 0.65 * smoothstep(0, 0.6, fresh));
    // Duas vezes o passo: cada pedaço cruza pela metade com o vizinho (ver `slimeStrip`).
    this.part.set(i, mOut.compose(vPos, qTmp, vScale.set(w, 1, SLIME_STEP * 2)));
  }

  update(dt: number, time: number): void {
    this.refresh -= dt;
    const rewrite = this.refresh <= 0;
    if (rewrite) this.refresh = 0.3;
    for (let i = 0; i < this.capacity; i++) {
      if (time - this.born[i] > SLIME_LIFE + 1) continue;
      if (rewrite) this.write(i, time);
      else if (this.freshness(i, time) > 0) this.part.keep();
    }
    this.part.flush();
  }

  /** 0..1: quanto rastro fresco há perto de (x, z). */
  at(x: number, z: number, time: number): number {
    let best = 0;
    for (let i = 0; i < this.capacity; i++) {
      const fresh = this.freshness(i, time);
      if (fresh <= best) continue;
      const dx = this.x[i] - x;
      const dz = this.z[i] - z;
      const reach = this.width[i] * 0.5 + 0.18;
      if (dx * dx + dz * dz < reach * reach) best = fresh;
    }
    return best;
  }

  clear(): void {
    this.born.fill(-1e6);
    for (let i = 0; i < this.capacity; i++) this.part.hide(i);
    this.part.flush();
  }
}

interface Slug {
  slot: number;
  stalkSlots: [number, number];
  walker: GroundWalker;
  scale: number;
  visible: boolean;
  /** Tentáculos: 1 = esticados, ~0,1 = recolhidos. */
  extend: number;
  /** 0..1: corpo encolhido de susto. */
  hunch: number;
  safe: number;
  /** Chão mais seco que isso: vai embora (cada lesma tem o seu). */
  threshold: number;
  slimeAcc: number;
  gone: number;
  seed: number;
}

export class Slugs implements Species {
  private readonly body: InstancedPart;
  private readonly stalks: InstancedPart;
  private readonly slime: SlimeTrail;
  private readonly slugs: Slug[] = [];
  private time = 0;

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.body = new InstancedPart(slugBody(), mats.slimy, count, { name: 'slug-body' });
    this.stalks = new InstancedPart(slugStalk(), mats.slimy, count * 2, { name: 'slug-stalks', skipAO: true });
    parent.add(this.body.mesh, this.stalks.mesh);
    // ~30 s de rastro a ~0,13 unidade/s, com folga.
    this.slime = new SlimeTrail(count * 56, parent);
    for (let i = 0; i < count; i++) {
      this.slugs.push({
        slot: this.body.allocate(),
        stalkSlots: [this.stalks.allocate(), this.stalks.allocate()],
        walker: new GroundWalker(2.2),
        scale: ctx.rng.range(0.85, 1.15),
        visible: false,
        extend: 1,
        hunch: 0,
        safe: 0,
        threshold: ctx.rng.range(0.28, 0.45),
        slimeAcc: 0,
        gone: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  update(dt: number, ctx: CritterContext): void {
    this.time = ctx.time;
    const w = ctx.world;
    for (const slug of this.slugs) {
      const walker = slug.walker;
      if (slug.gone > 0) slug.gone -= dt;
      if (!slug.visible) {
        this.hide(slug);
        if (slug.gone > 0 || w.wetness < slug.threshold || !walker.relocate(ctx, 6, 22, true)) continue;
        slug.visible = true;
        slug.extend = 1;
        slug.hunch = 0;
        slug.safe = 0;
      }
      const p = walker.position;
      const dry = w.wetness < slug.threshold - 0.12;
      const far = Math.hypot(p.x - w.player.x, p.z - w.player.z) > 40;
      if ((dry || far) && !inView(ctx, p.x, p.z)) {
        slug.visible = false;
        this.hide(slug);
        continue;
      }
      const hurry = attraction(ctx, p.x, p.z, vTmp);
      const danger = threatAt(ctx, p.x, p.y, p.z, vAway);
      const shoved = shoveFromBall(ctx, p, 0.2, 0.2);
      if (hurry === 0 && (danger < 1.2 || shoved)) slug.safe = 2.5;
      else slug.safe -= dt;
      const scared = slug.safe > 0;
      slug.extend = damp(slug.extend, scared ? 0.1 : 1, scared ? 10 : 1.4, dt);
      slug.hunch = damp(slug.hunch, scared ? 1 : 0, scared ? 8 : 1.2, dt);
      let speed = 0;
      if (hurry > 0) {
        walker.flee(vTmp, 1);
        speed = 0.13 * hurry * 1.4;
      } else if (!scared && slug.hunch < 0.3) {
        speed = 0.12 * (0.7 + w.wetness * 0.6);
      }
      walker.step(dt, ctx, speed, 1.6);
      if (walker.moved > 0) {
        slug.slimeAcc += walker.moved;
        if (slug.slimeAcc >= SLIME_STEP) {
          slug.slimeAcc -= SLIME_STEP;
          // A gosma sai do pé inteiro: o pedaço novo fica no meio-de-trás do corpo.
          const back = 0.12 * slug.scale;
          this.slime.drop(p.x - Math.sin(walker.yaw) * back, p.y + 0.012, p.z - Math.cos(walker.yaw) * back, walker.yaw, 0.16 * slug.scale, ctx.time);
        }
      }
      this.draw(slug, ctx.time);
    }
    this.body.flush();
    this.stalks.flush();
    this.slime.update(dt, ctx.time);
  }

  private draw(slug: Slug, time: number): void {
    const w = slug.walker;
    const k = slug.hunch;
    // Rastejando, uma onda de contração percorre o pé.
    const crawl = w.moved > 0 ? Math.sin((time + slug.seed) * 4) * 0.035 : 0;
    w.matrix(mRoot, slug.scale);
    vTmp.set(0, 0, -0.06 * k);
    this.body.set(slug.slot, jointMatrix(mRoot, vTmp, 0, 0, 0, mOut, 1 + 0.12 * k, 1 + 0.45 * k, (1 - 0.35 * k) * (1 + crawl)));
    const ext = Math.max(0.06, slug.extend);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      vTmp.set(SLUG_STALK_BASE.x * side, SLUG_STALK_BASE.y * (1 + 0.3 * k), SLUG_STALK_BASE.z * (1 - 0.35 * k) - 0.06 * k);
      const wobble = Math.sin((time + slug.seed) * 1.1 + s * 1.7) * 0.18;
      this.stalks.set(slug.stalkSlots[s], jointMatrix(mRoot, vTmp, 0.35 + wobble, 0, -side * (0.25 + wobble * 0.5), mOut, 1, ext, 1));
    }
  }

  private hide(slug: Slug): void {
    this.body.hide(slug.slot);
    this.stalks.hide(slug.stalkSlots[0]);
    this.stalks.hide(slug.stalkSlots[1]);
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const slug of this.slugs) {
      if (slug.visible && slug.walker.position.distanceTo(position) < radius + 2) slug.safe = 3;
    }
  }

  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    for (const slug of this.slugs) {
      if (!slug.visible) continue;
      const w = slug.walker;
      w.matrix(mRoot, slug.scale);
      vTmp.set(0, 0.08, 0.1).applyMatrix4(mRoot);
      if (!ballTakes(center, radius, SLUG_SIZE, vTmp.x, vTmp.y, vTmp.z, 0.14 * slug.scale)) continue;
      slug.visible = false;
      slug.gone = 20;
      this.hide(slug);
      return { id: 'slug', object: collectedMesh(this.body.mesh.geometry, critterMaterials().slimy, mRoot), size: SLUG_SIZE, color: new THREE.Color('#b08a5a') };
    }
    return null;
  }

  /** 0..1: quanto rastro fresco de gosma há perto de (x, z) — o chão ali escorrega. */
  slimeAt(x: number, z: number): number {
    return this.slime.at(x, z, this.time);
  }

  /** Rodada nova: o jardim "renasce" limpo. */
  newRound(): void {
    this.slime.clear();
  }
}
