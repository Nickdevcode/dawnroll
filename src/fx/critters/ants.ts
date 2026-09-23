import * as THREE from 'three';
import { clamp, damp } from '../../utils/math';
import { clay } from '../../render/clayMaterial';
import { BURROW, dirtAmount, terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import { zoneOf } from '../../world/zones';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { mergeParts } from './models';
import { antBody, anthill, leafBit } from './groundModels';
import { insideBasin } from './common';
import { rootMatrix, jointMatrix } from './flyers';
import type { CritterContext, Species } from './types';

/**
 * Formigas: cada colônia tem um formigueiro (montinho de terra, só visual) e
 * uma trilha até uma "fonte de comida". As formigas vão numa faixa e voltam na
 * outra, muitas carregando um pedacinho de folha; entram e saem do ninho,
 * desviam do besouro e da bola e se espalham no susto. Tudo instanciado: as
 * patinhas alternam entre duas poses (stop-motion, combina com a massinha).
 *
 * A primeira colônia faz a trilha até a ponta da toalha do piquenique (é lá
 * que caem as migalhas).
 */

const PATH_STEP = 0.15;
/** Distância lateral entre a faixa de ida e a de volta. */
const LANE = 0.13;

interface TrailPath {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Tangente (no plano) em cada amostra. */
  ux: Float32Array;
  uz: Float32Array;
  length: number;
}

interface Ant {
  slot: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  carry: boolean;
  /** Tempo restante dentro do ninho (escondida). */
  inNest: number;
  /** Desvio lateral atual (fugindo de perigo / espalhada no susto). */
  offset: number;
  scatter: number;
  hurry: number;
  phase: number;
  scale: number;
  /** Onde ela estava no último quadro (mundo); para largar a folha no lugar certo. */
  readonly at: THREE.Vector3;
  /** Apareceu no último quadro (fora do ninho e com o jogador por perto). */
  shown: boolean;
}

interface Colony {
  nest: THREE.Vector3;
  path: TrailPath;
  ants: Ant[];
  tint: THREE.Color;
}

const LeafTints = ['#7cc25a', '#a6cf4f', '#e2b441', '#e38a43', '#5fae4a'].map((c) => new THREE.Color(c));
/** Formigas pretas e formigas-lava-pés (avermelhadas): a cor neutra do modelo é tingida por colônia. */
const ColonyTints = [new THREE.Color(0.45, 0.4, 0.4), new THREE.Color(1.05, 0.55, 0.42), new THREE.Color(0.62, 0.48, 0.4)];

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vPos = new THREE.Vector3();
const LEAF_OFFSET = new THREE.Vector3(0, 0.2, 0.14);

export class AntColonies implements Species {
  private readonly poseA: InstancedPart;
  private readonly poseB: InstancedPart;
  private readonly leaves: InstancedPart;
  private readonly colonies: Colony[] = [];
  private built = false;

  constructor(
    private readonly colonyCount: number,
    private readonly antsPerColony: number,
    private readonly parent: THREE.Group,
  ) {
    const mats = critterMaterials();
    const total = colonyCount * antsPerColony;
    this.poseA = new InstancedPart(antBody(0), mats.glossy, total, { name: 'ant-a', tinted: true, skipAO: true });
    this.poseB = new InstancedPart(antBody(1), mats.glossy, total, { name: 'ant-b', tinted: true, skipAO: true });
    // Folhinha: massinha fosca dupla face; a cor vem da instância.
    const leafMat = clay(0xffffff, { vertexColors: true, roughness: 0.7, sheen: 0.6, bump: 0, mottle: 0.08, mottleScale: 20, side: THREE.DoubleSide });
    this.leaves = new InstancedPart(leafBit(), leafMat, total, { name: 'ant-leaf', tinted: true, castShadow: false, skipAO: true });
    parent.add(this.poseA.mesh, this.poseB.mesh, this.leaves.mesh);
  }

  /** As colônias precisam das poças (para não cavar dentro da bacia): monta no primeiro frame. */
  private build(ctx: CritterContext): void {
    this.built = true;
    const hills: THREE.BufferGeometry[] = [];
    const baseAngle = ctx.rng.next() * Math.PI * 2;
    for (let c = 0; c < this.colonyCount; c++) {
      const colony = (c === 0 ? this.placePicnicColony(ctx) : null) ?? this.placeColony(ctx, baseAngle + (c / this.colonyCount) * Math.PI * 2);
      if (!colony) continue;
      const hill = anthill(c + 1);
      hill.translate(colony.nest.x, colony.nest.y - 0.08, colony.nest.z);
      hills.push(hill);
      colony.tint = ColonyTints[c % ColonyTints.length];
      for (let i = 0; i < this.antsPerColony; i++) {
        const slot = this.poseA.allocate();
        this.poseB.allocate();
        this.leaves.allocate();
        this.poseA.setColor(slot, colony.tint);
        this.poseB.setColor(slot, colony.tint);
        this.leaves.setColor(slot, ctx.rng.pick(LeafTints));
        colony.ants.push({
          slot,
          s: ctx.rng.next() * colony.path.length,
          dir: ctx.rng.next() < 0.5 ? 1 : -1,
          speed: ctx.rng.range(0.85, 1.2),
          pause: 0,
          carry: false,
          inNest: 0,
          offset: 0,
          scatter: 0,
          hurry: 0,
          phase: ctx.rng.next() * 10,
          scale: ctx.rng.range(0.9, 1.12),
          at: new THREE.Vector3(),
          shown: false,
        });
        const ant = colony.ants[colony.ants.length - 1];
        ant.carry = ant.dir < 0 && ctx.rng.next() < 0.65;
      }
      this.colonies.push(colony);
    }
    if (hills.length > 0) {
      const mesh = new THREE.Mesh(mergeParts(hills), critterMaterials().body);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'anthills';
      mesh.matrixAutoUpdate = false;
      this.parent.add(mesh);
    }
  }

  /** Acha um lugar para o formigueiro e uma trilha livre (sem pedra, tronco nem poça) até a comida. */
  private placeColony(ctx: CritterContext, angle: number): Colony | null {
    for (let attempt = 0; attempt < 90; attempt++) {
      const a = angle + ctx.rng.range(-0.9, 0.9);
      const d = ctx.rng.range(13, Math.min(34, PLAY_RADIUS - 8));
      const nx = Math.cos(a) * d;
      const nz = Math.sin(a) * d;
      // Prefere terra batida: no gramado denso a trilha some no meio dos tufos.
      if (attempt < 45 && dirtAmount(nx, nz) < 0.35) continue;
      if (!this.clear(ctx, nx, nz, 1.6)) continue;
      for (let t = 0; t < 10; t++) {
        const fa = ctx.rng.next() * Math.PI * 2;
        const fd = ctx.rng.range(7, 12);
        const fx = nx + Math.cos(fa) * fd;
        const fz = nz + Math.sin(fa) * fd;
        if (Math.hypot(fx, fz) > PLAY_RADIUS - 3) continue;
        const path = this.buildPath(ctx, nx, nz, fx, fz);
        if (path) return { nest: new THREE.Vector3(nx, terrainHeight(nx, nz), nz), path, ants: [], tint: ColonyTints[0] };
      }
    }
    return null;
  }

  /**
   * Colônia do piquenique: a comida é a borda da toalha (no meio de um lado,
   * onde o pano não cobre o chão) e o formigueiro fica uns passos para fora.
   */
  private placePicnicColony(ctx: CritterContext): Colony | null {
    const zone = zoneOf('picnic');
    if (!zone) return null;
    for (const side of [1, -1, 3, -3]) {
      const a = zone.facing + (side * Math.PI) / 4;
      const fx = zone.x + Math.sin(a) * (zone.radius + 0.4);
      const fz = zone.z + Math.cos(a) * (zone.radius + 0.4);
      if (Math.hypot(fx, fz) > PLAY_RADIUS - 3) continue;
      for (let attempt = 0; attempt < 24; attempt++) {
        const spread = a + ctx.rng.range(-0.6, 0.6);
        const d = ctx.rng.range(7, 11);
        const nx = fx + Math.sin(spread) * d;
        const nz = fz + Math.cos(spread) * d;
        if (Math.hypot(nx, nz) > PLAY_RADIUS - 8 || !this.clear(ctx, nx, nz, 1.6)) continue;
        const path = this.buildPath(ctx, nx, nz, fx, fz);
        if (path) return { nest: new THREE.Vector3(nx, terrainHeight(nx, nz), nz), path, ants: [], tint: ColonyTints[0] };
      }
    }
    return null;
  }

  private clear(ctx: CritterContext, x: number, z: number, radius: number): boolean {
    if (Math.hypot(x, z) < 9 || insideBasin(ctx, x, z, radius + 1)) return false;
    // Longe da toca (o monte de terra escavada dela já parece um formigueiro).
    if (Math.hypot(x - BURROW.x, z - BURROW.z) < BURROW.radius * 3.5) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!ctx.isGroundFree(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false;
    }
    return ctx.isGroundFree(x, z);
  }

  private buildPath(ctx: CritterContext, nx: number, nz: number, fx: number, fz: number): TrailPath | null {
    const dx = fx - nx;
    const dz = fz - nz;
    const len = Math.hypot(dx, dz);
    const px = -dz / len;
    const pz = dx / len;
    const wiggle = () => ctx.rng.range(-1.8, 1.8);
    const w1 = wiggle();
    const w2 = wiggle();
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(nx, 0, nz),
      new THREE.Vector3(nx + dx * 0.33 + px * w1, 0, nz + dz * 0.33 + pz * w1),
      new THREE.Vector3(nx + dx * 0.66 + px * w2, 0, nz + dz * 0.66 + pz * w2),
      new THREE.Vector3(fx, 0, fz),
    ]);
    const length = curve.getLength();
    const count = Math.max(2, Math.ceil(length / PATH_STEP) + 1);
    const path: TrailPath = {
      x: new Float32Array(count),
      y: new Float32Array(count),
      z: new Float32Array(count),
      ux: new Float32Array(count),
      uz: new Float32Array(count),
      length: (count - 1) * PATH_STEP,
    };
    const p = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const u = Math.min(1, (i * PATH_STEP) / length);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tangent);
      // A saída do formigueiro pode ficar no montinho; o resto da trilha precisa estar livre.
      if (i * PATH_STEP > 1.4 && (!ctx.isGroundFree(p.x, p.z) || insideBasin(ctx, p.x, p.z, 0.8))) return null;
      if (Math.hypot(p.x - BURROW.x, p.z - BURROW.z) < BURROW.radius * 1.4) return null;
      path.x[i] = p.x;
      path.z[i] = p.z;
      path.y[i] = terrainHeight(p.x, p.z);
      const tl = Math.hypot(tangent.x, tangent.z) || 1;
      path.ux[i] = tangent.x / tl;
      path.uz[i] = tangent.z / tl;
    }
    return path;
  }

  update(dt: number, ctx: CritterContext): void {
    if (!this.built) this.build(ctx);
    const w = ctx.world;
    const t = ctx.time;
    for (const colony of this.colonies) {
      const path = colony.path;
      const near =
        Math.hypot(colony.nest.x - w.player.x, colony.nest.z - w.player.z) < 50 ||
        Math.hypot(path.x[path.x.length - 1] - w.player.x, path.z[path.z.length - 1] - w.player.z) < 50;
      for (const ant of colony.ants) {
        ant.shown = false;
        if (!near) {
          this.hide(ant);
          continue;
        }
        this.step(ant, colony, dt, ctx);
        if (ant.inNest > 0) {
          this.hide(ant);
          continue;
        }
        // Posição na trilha (interpolada) + faixa + desvio.
        const f = clamp(ant.s / PATH_STEP, 0, path.x.length - 1.001);
        const i = Math.floor(f);
        const k = f - i;
        const ux = path.ux[i] + (path.ux[i + 1] - path.ux[i]) * k;
        const uz = path.uz[i] + (path.uz[i + 1] - path.uz[i]) * k;
        const lateral = LANE * ant.dir + ant.offset;
        const x = path.x[i] + (path.x[i + 1] - path.x[i]) * k - uz * lateral;
        const z = path.z[i] + (path.z[i + 1] - path.z[i]) * k + ux * lateral;
        const y = path.y[i] + (path.y[i + 1] - path.y[i]) * k;
        vPos.set(x, y + 0.005, z);
        ant.at.copy(vPos);
        ant.shown = true;
        const yaw = Math.atan2(ux * ant.dir, uz * ant.dir) + Math.sin(t * 7 + ant.phase) * 0.12 - ant.offset * 0.15 * ant.dir;
        rootMatrix(mRoot, vPos, yaw, 0, 0, ant.scale);
        const moving = ant.pause <= 0;
        const pose = moving && Math.floor(t * (12 + ant.hurry * 8) + ant.phase) % 2 === 1;
        (pose ? this.poseB : this.poseA).set(ant.slot, mRoot);
        (pose ? this.poseA : this.poseB).hide(ant.slot);
        if (ant.carry) this.leaves.set(ant.slot, jointMatrix(mRoot, LEAF_OFFSET, -Math.PI / 2 + 0.25, Math.sin(t * 3 + ant.phase) * 0.2, 0, mOut));
        else this.leaves.hide(ant.slot);
      }
    }
    this.poseA.flush();
    this.poseB.flush();
    this.leaves.flush();
  }

  private step(ant: Ant, colony: Colony, dt: number, ctx: CritterContext): void {
    const path = colony.path;
    if (ant.inNest > 0) {
      ant.inNest -= dt;
      if (ant.inNest <= 0) {
        ant.s = 0;
        ant.dir = 1;
        ant.carry = false;
        ant.offset = 0;
      }
      return;
    }
    if (ant.pause > 0) {
      ant.pause -= dt;
    } else {
      // Paradinhas curtas (encontrar outra formiga, "conversar" de antena).
      if (ctx.rng.next() < dt * 0.12) ant.pause = ctx.rng.range(0.2, 0.8);
      ant.s += ant.dir * ant.speed * (1 + ant.hurry) * dt;
    }
    ant.hurry = Math.max(0, ant.hurry - dt * 0.5);
    if (ant.dir === 1 && ant.s >= path.length) {
      // Chegou na comida: pega um pedacinho (às vezes) e dá meia-volta.
      ant.s = path.length;
      ant.dir = -1;
      ant.carry = ctx.rng.next() < 0.65;
      ant.pause = ctx.rng.range(0.3, 1.2);
    } else if (ant.dir === -1 && ant.s <= 0) {
      ant.inNest = ctx.rng.range(1, 4);
      return;
    }

    // Desvio lateral do besouro e da bola (a trilha contorna o obstáculo e depois volta).
    const f = clamp(ant.s / PATH_STEP, 0, path.x.length - 1);
    const i = Math.round(f);
    const lateral = LANE * ant.dir + ant.offset;
    const x = path.x[i] - path.uz[i] * lateral;
    const z = path.z[i] + path.ux[i] * lateral;
    const y = path.y[i];
    let push = 0;
    const w = ctx.world;
    const threats: Array<[number, number, number]> = [[w.player.x, w.player.z, 0.65]];
    const r = w.ballRadius;
    const dy = y + 0.05 - w.ballPosition.y;
    const section = Math.sqrt(Math.max(0, r * r - dy * dy));
    threats.push([w.ballPosition.x, w.ballPosition.z, section + 0.3]);
    for (const [tx, tz, reach] of threats) {
      const d = Math.hypot(x - tx, z - tz);
      if (d > reach + 0.6) continue;
      // Lado do perigo em relação à trilha: foge para o outro.
      const side = (x - tx) * -path.uz[i] + (z - tz) * path.ux[i];
      push += (side >= 0 ? 1 : -1) * (reach + 0.6 - d) * 1.4;
    }
    ant.scatter = damp(ant.scatter, 0, 0.8, dt);
    const desired = clamp(ant.offset + push * 0.25, -2.6, 2.6) + ant.scatter;
    ant.offset = damp(ant.offset, push !== 0 ? desired : ant.scatter, push !== 0 ? 7 : 1.2, dt);
    if (push !== 0) ant.hurry = Math.min(1, ant.hurry + dt * 2);
  }

  private hide(ant: Ant): void {
    this.poseA.hide(ant.slot);
    this.poseB.hide(ant.slot);
    this.leaves.hide(ant.slot);
  }

  /** Bocas dos formigueiros (mundo). Vazio até o primeiro quadro (as colônias nascem nele). */
  get nests(): readonly THREE.Vector3[] {
    return this.colonies.map((colony) => colony.nest);
  }

  /**
   * Poder "Formigueiro amigo": formigas carregando folhinha dentro do raio
   * largam a folha (e voltam para buscar outra). Devolve onde cada folha caiu
   * (mundo), no máximo `max`.
   */
  takeLeaves(center: THREE.Vector3, radius: number, max: number): THREE.Vector3[] {
    const dropped: THREE.Vector3[] = [];
    for (const colony of this.colonies) {
      for (const ant of colony.ants) {
        if (dropped.length >= max) return dropped;
        if (!ant.carry || !ant.shown || ant.at.distanceTo(center) > radius) continue;
        ant.carry = false;
        ant.dir = 1;
        dropped.push(new THREE.Vector3(ant.at.x, ant.at.y + LEAF_OFFSET.y * ant.scale, ant.at.z));
      }
    }
    return dropped;
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const colony of this.colonies) {
      const path = colony.path;
      for (const ant of colony.ants) {
        const i = Math.round(clamp(ant.s / PATH_STEP, 0, path.x.length - 1));
        if (Math.hypot(path.x[i] - position.x, path.z[i] - position.z) > radius + 2.5) continue;
        ant.scatter = ctx.rng.range(-1.4, 1.4);
        ant.hurry = 1;
        ant.pause = 0;
        if (ctx.rng.next() < 0.4) ant.dir = ant.dir === 1 ? -1 : 1;
      }
    }
  }
}
