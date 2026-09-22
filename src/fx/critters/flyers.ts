import * as THREE from 'three';
import { damp, dampAngle } from '../../utils/math';
import { terrainHeight } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import {
  beeBody,
  beeWings,
  butterflyBody,
  butterflyWing,
  ButterflyPalettes,
  dragonflyBody,
  dragonflyWing,
  DragonflyPalettes,
  mirrorX,
  type WingPattern,
} from './models';
import { airPointNear, farPoint, pickSpotNear, repelFromCamera, spotAlive } from './common';
import type { CritterContext, Species } from './types';

/**
 * Voadores: borboletas, abelhas e libélulas. Cada espécie desenha todos os
 * indivíduos com poucas malhas instanciadas (corpo + asa direita + asa
 * esquerda), com as matrizes calculadas aqui a cada frame.
 */

const mRoot = new THREE.Matrix4();
const mLocal = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const qTmp = new THREE.Quaternion();
const eTmp = new THREE.Euler();
const vTmp = new THREE.Vector3();
const vTmp2 = new THREE.Vector3();
const vScale = new THREE.Vector3();

/** Matriz raiz do bicho: posição, guinada/arfagem/rolagem (ordem YXZ) e escala uniforme. */
export function rootMatrix(target: THREE.Matrix4, position: THREE.Vector3, yaw: number, pitch: number, roll: number, scale: number): THREE.Matrix4 {
  eTmp.set(pitch, yaw, roll, 'YXZ');
  qTmp.setFromEuler(eTmp);
  return target.compose(position, qTmp, vScale.setScalar(scale));
}

/** Parte presa numa articulação: raiz × translação(`offset`) × rotação(x, y, z) × escala opcional. */
export function jointMatrix(root: THREE.Matrix4, offset: THREE.Vector3, rx: number, ry: number, rz: number, target: THREE.Matrix4, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  eTmp.set(rx, ry, rz, 'YXZ');
  qTmp.setFromEuler(eTmp);
  mLocal.compose(offset, qTmp, vScale.set(sx, sy, sz));
  return target.multiplyMatrices(root, mLocal);
}

// ---------------------------------------------------------------------------
// Borboletas

type FlyerState = 'fly' | 'perch' | 'leave' | 'away';

interface Butterfly {
  pattern: WingPattern;
  bodySlot: number;
  wingSlot: number;
  state: FlyerState;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  spot: THREE.Vector3 | null;
  yaw: number;
  roll: number;
  scale: number;
  flapPhase: number;
  flapRate: number;
  wing: number;
  glide: number;
  timer: number;
  check: number;
  seed: number;
}

const BUTTERFLY_HINGE_R = new THREE.Vector3(0.025, 0.025, 0.02);
const BUTTERFLY_HINGE_L = new THREE.Vector3(-0.025, 0.025, 0.02);

/**
 * Borboletas: voo em zigue-zague com batidas e planeios, pousam nas flores
 * abrindo e fechando as asas devagar. Na chuva vão embora voando alto e
 * voltam "de longe" quando ela passa.
 */
export class Butterflies implements Species {
  private readonly body: InstancedPart;
  private readonly wings = new Map<WingPattern, { right: InstancedPart; left: InstancedPart }>();
  private readonly flock: Butterfly[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.body = new InstancedPart(butterflyBody(), mats.fuzzy, count, { name: 'butterfly-body' });
    parent.add(this.body.mesh);
    for (const pattern of ['veined', 'eyespot'] as const) {
      const right = butterflyWing(pattern);
      const pair = {
        right: new InstancedPart(right, mats.paletteWing, count, { name: `butterfly-wing-${pattern}-r`, palette: true }),
        left: new InstancedPart(mirrorX(right), mats.paletteWing, count, { name: `butterfly-wing-${pattern}-l`, palette: true }),
      };
      parent.add(pair.right.mesh, pair.left.mesh);
      this.wings.set(pattern, pair);
    }
    for (let i = 0; i < count; i++) {
      const palette = ctx.rng.pick(ButterflyPalettes);
      const pair = this.wings.get(palette.pattern)!;
      const wingSlot = pair.right.allocate();
      pair.left.allocate();
      const a = new THREE.Color(palette.a);
      const b = new THREE.Color(palette.b);
      const c = new THREE.Color(palette.c);
      pair.right.setPalette(wingSlot, a, b, c);
      pair.left.setPalette(wingSlot, a, b, c);
      const bf: Butterfly = {
        pattern: palette.pattern,
        bodySlot: this.body.allocate(),
        wingSlot,
        state: 'fly',
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        target: new THREE.Vector3(),
        spot: null,
        yaw: 0,
        roll: 0,
        scale: ctx.rng.range(0.75, 1.15),
        flapPhase: ctx.rng.next() * 10,
        flapRate: ctx.rng.range(7, 10),
        wing: 0.5,
        glide: 0,
        timer: 0,
        check: 0,
        seed: ctx.rng.next() * 100,
      };
      airPointNear(ctx, 25, 1.5, 5, bf.position);
      this.chooseTarget(bf, ctx);
      this.flock.push(bf);
    }
  }

  private chooseTarget(bf: Butterfly, ctx: CritterContext): void {
    bf.spot = ctx.rng.next() < 0.7 ? pickSpotNear(ctx, 28, bf.spot) : null;
    if (bf.spot) bf.target.copy(bf.spot).add(vTmp.set(0, 0.1 * bf.scale, 0));
    else airPointNear(ctx, 22, 1.2, 5, bf.target);
  }

  private takeOff(bf: Butterfly, ctx: CritterContext): void {
    bf.state = 'fly';
    bf.velocity.set(ctx.rng.range(-1, 1), 2.6, ctx.rng.range(-1, 1));
    this.chooseTarget(bf, ctx);
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const bf of this.flock) {
      const t = ctx.time + bf.seed;
      // Chuva: vai embora; passou a chuva, volta de longe.
      if (w.rain > 0.25 && (bf.state === 'fly' || bf.state === 'perch')) {
        bf.state = 'leave';
        farPoint(ctx, 60, 14, bf.target);
      }
      if (bf.state === 'away') {
        this.hide(bf);
        if (w.rain < 0.12) {
          bf.timer -= dt;
          if (bf.timer <= 0) {
            farPoint(ctx, 38, 7, bf.position);
            bf.velocity.set(0, 0, 0);
            bf.state = 'fly';
            this.chooseTarget(bf, ctx);
          }
        }
        continue;
      }

      let wingTarget: number;
      let pitch = -0.25;
      let bob = 0;
      if (bf.state === 'perch') {
        bf.timer -= dt;
        bf.check -= dt;
        if (bf.check <= 0) {
          bf.check = 0.3;
          if (bf.spot && !spotAlive(ctx, bf.spot)) bf.timer = 0;
        }
        if (bf.timer <= 0) this.takeOff(bf, ctx);
        // Pousada: asas fechadas em cima, abrindo devagar de vez em quando (tomando sol).
        wingTarget = 1.45 - 1.25 * Math.pow(Math.max(0, Math.sin(t * 0.9)), 3);
        pitch = 0;
      } else {
        const to = vTmp.copy(bf.target).sub(bf.position);
        const dist = to.length();
        const leaving = bf.state === 'leave';
        if (leaving && Math.hypot(bf.position.x - w.player.x, bf.position.z - w.player.z) > 44) {
          bf.state = 'away';
          bf.timer = ctx.rng.range(2, 9);
          continue;
        }
        if (!leaving && Math.hypot(bf.position.x - w.player.x, bf.position.z - w.player.z) > 45) this.chooseTarget(bf, ctx);
        if (!leaving && bf.spot && dist < 0.25) {
          bf.state = 'perch';
          bf.timer = ctx.rng.range(3, 8);
          bf.check = 0.3;
          bf.velocity.set(0, 0, 0);
          bf.position.copy(bf.target);
        } else {
          if (!leaving && !bf.spot && dist < 0.5) this.chooseTarget(bf, ctx);
          const speed = leaving ? 4.2 : Math.min(2.6, dist * 2 + 0.6);
          to.divideScalar(Math.max(dist, 1e-3)).multiplyScalar(speed);
          // Nunca voa reto: tremida de borboleta.
          to.x += Math.sin(t * 3.1) * 1.4;
          to.y += Math.sin(t * 5.3) * 1.1;
          to.z += Math.cos(t * 2.7) * 1.4;
          bf.velocity.lerp(to, 1 - Math.exp(-3 * dt));
          bf.position.addScaledVector(bf.velocity, dt);
          const ground = terrainHeight(bf.position.x, bf.position.z) + 0.45;
          if (bf.position.y < ground) bf.position.y = ground;
          const horizontal = Math.hypot(bf.velocity.x, bf.velocity.z);
          if (horizontal > 0.2) {
            const before = bf.yaw;
            bf.yaw = dampAngle(bf.yaw, Math.atan2(bf.velocity.x, bf.velocity.z), 5, dt);
            bf.roll = damp(bf.roll, THREE.MathUtils.clamp(((bf.yaw - before) / Math.max(dt, 1e-3)) * -0.25, -0.5, 0.5), 6, dt);
          }
        }
        // Batida + planeio: de vez em quando segura as asas abertas e desliza.
        if (bf.glide > 0) bf.glide -= dt;
        else if (bf.velocity.y < 0.4 && ctx.rng.next() < dt * 0.35) bf.glide = ctx.rng.range(0.3, 0.8);
        if (bf.glide > 0) {
          wingTarget = 0.28;
        } else {
          bf.flapPhase += dt * bf.flapRate * Math.PI * 2;
          wingTarget = 0.55 + Math.sin(bf.flapPhase) * 0.78;
          // O corpo sobe na batida para baixo (e desce na volta).
          bob = -Math.sin(bf.flapPhase) * 0.04 * bf.scale;
        }
        if (repelFromCamera(bf.position, w.camera, dt) && !leaving && bf.target.distanceTo(w.camera) < 3.5) this.chooseTarget(bf, ctx);
      }
      bf.wing = damp(bf.wing, wingTarget, bf.state === 'perch' ? 6 : 40, dt);
      this.draw(bf, pitch, bob);
    }
    this.body.flush();
    for (const pair of this.wings.values()) {
      pair.right.flush();
      pair.left.flush();
    }
  }

  private draw(bf: Butterfly, pitch: number, bob: number): void {
    vTmp2.copy(bf.position);
    vTmp2.y += bob;
    rootMatrix(mRoot, vTmp2, bf.yaw, pitch, bf.state === 'perch' ? 0 : bf.roll, bf.scale);
    this.body.set(bf.bodySlot, mRoot);
    const pair = this.wings.get(bf.pattern)!;
    pair.right.set(bf.wingSlot, jointMatrix(mRoot, BUTTERFLY_HINGE_R, 0, 0, bf.wing, mOut));
    pair.left.set(bf.wingSlot, jointMatrix(mRoot, BUTTERFLY_HINGE_L, 0, 0, -bf.wing, mOut));
  }

  private hide(bf: Butterfly): void {
    this.body.hide(bf.bodySlot);
    const pair = this.wings.get(bf.pattern)!;
    pair.right.hide(bf.wingSlot);
    pair.left.hide(bf.wingSlot);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const bf of this.flock) {
      if (bf.state === 'perch' && bf.position.distanceTo(position) < radius + 1.5) this.takeOff(bf, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Abelhas

interface Bee {
  bodySlot: number;
  state: 'hover' | 'sip' | 'leave' | 'away';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  flower: THREE.Vector3;
  spot: THREE.Vector3 | null;
  yaw: number;
  scale: number;
  timer: number;
  check: number;
  seed: number;
}

const BEE_HINGE_R = new THREE.Vector3(0.03, 0.12, 0.02);
const BEE_HINGE_L = new THREE.Vector3(-0.03, 0.12, 0.02);

/**
 * Abelhas: rondam uma flor em "oito", pousam um pouquinho para "coletar"
 * (asas dobradas para trás, corpo tremendo) e vão para a próxima. Fogem da chuva.
 */
export class Bees implements Species {
  private readonly body: InstancedPart;
  private readonly wingR: InstancedPart;
  private readonly wingL: InstancedPart;
  private readonly swarm: Bee[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    const wings = beeWings();
    this.body = new InstancedPart(beeBody(), mats.fuzzy, count, { name: 'bee-body' });
    this.wingR = new InstancedPart(wings, mats.glass, count, { name: 'bee-wing-r', castShadow: false, skipAO: true });
    this.wingL = new InstancedPart(mirrorX(wings), mats.glass, count, { name: 'bee-wing-l', castShadow: false, skipAO: true });
    parent.add(this.body.mesh, this.wingR.mesh, this.wingL.mesh);
    for (let i = 0; i < count; i++) {
      const bee: Bee = {
        bodySlot: this.body.allocate(),
        state: 'hover',
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        flower: new THREE.Vector3(),
        spot: null,
        yaw: 0,
        scale: ctx.rng.range(0.8, 1),
        timer: 0,
        check: 0,
        seed: ctx.rng.next() * 100,
      };
      this.wingR.allocate();
      this.wingL.allocate();
      airPointNear(ctx, 20, 1, 3, bee.position);
      this.pickFlower(bee, ctx);
      this.swarm.push(bee);
    }
  }

  private pickFlower(bee: Bee, ctx: CritterContext): void {
    bee.spot = pickSpotNear(ctx, 26, bee.spot);
    if (bee.spot) bee.flower.copy(bee.spot);
    else airPointNear(ctx, 20, 1, 3, bee.flower);
    bee.timer = ctx.rng.range(3, 7);
    bee.state = 'hover';
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const bee of this.swarm) {
      const t = ctx.time + bee.seed;
      if (w.rain > 0.25 && (bee.state === 'hover' || bee.state === 'sip')) {
        bee.state = 'leave';
        farPoint(ctx, 60, 12, bee.flower);
      }
      if (bee.state === 'away') {
        this.hide(bee);
        if (w.rain < 0.12) {
          bee.timer -= dt;
          if (bee.timer <= 0) {
            farPoint(ctx, 36, 5, bee.position);
            this.pickFlower(bee, ctx);
          }
        }
        continue;
      }

      let wingAngle: number;
      let wingSweep = 0;
      let pitch = 0;
      let jitter = 0.04;
      if (bee.state === 'sip') {
        bee.timer -= dt;
        bee.check -= dt;
        if (bee.check <= 0) {
          bee.check = 0.3;
          if (bee.spot && !spotAlive(ctx, bee.spot)) bee.timer = 0;
        }
        if (bee.timer <= 0) {
          this.pickFlower(bee, ctx);
          bee.velocity.set(0, 2, 0);
        }
        // Coletando: asas dobradas para trás, corpo balançando de lado.
        wingAngle = 0.05;
        wingSweep = 1.05;
        pitch = 0.25;
        bee.yaw += Math.sin(t * 2.3) * dt * 0.8;
        jitter = 0.08;
      } else {
        bee.timer -= dt;
        const far = Math.hypot(bee.position.x - w.player.x, bee.position.z - w.player.z) > 45;
        if (bee.state === 'leave') {
          if (far) {
            bee.state = 'away';
            bee.timer = ctx.rng.range(3, 10);
            continue;
          }
        } else {
          if (bee.spot && bee.timer <= 0 && spotAlive(ctx, bee.spot) && ctx.rng.next() < 0.6) {
            bee.state = 'sip';
            bee.timer = ctx.rng.range(1.5, 3.5);
            bee.check = 0.3;
            bee.position.copy(bee.spot).add(vTmp.set(ctx.rng.range(-0.08, 0.08), 0.1, ctx.rng.range(-0.08, 0.08)));
            bee.velocity.set(0, 0, 0);
            this.draw(bee, 0.05, 1.05, 0.25, 0.08, t);
            continue;
          }
          if (bee.timer <= 0 || far || (bee.spot && !spotAlive(ctx, bee.spot))) this.pickFlower(bee, ctx);
        }
        // Oito deitado em volta da flor (ou reta embora, na chuva).
        const goal =
          bee.state === 'leave'
            ? vTmp.copy(bee.flower)
            : vTmp.set(Math.sin(t * 1.7) * 0.9, 0.45 + Math.sin(t * 3.4) * 0.25, Math.sin(t * 3.4) * 0.45).add(bee.flower);
        const to = goal.sub(bee.position);
        const dist = to.length();
        to.multiplyScalar(Math.min(bee.state === 'leave' ? 5 : 6, dist * 3) / Math.max(dist, 1e-3));
        bee.velocity.lerp(to, 1 - Math.exp(-4 * dt));
        bee.position.addScaledVector(bee.velocity, dt);
        const ground = terrainHeight(bee.position.x, bee.position.z) + 0.3;
        if (bee.position.y < ground) bee.position.y = ground;
        if (Math.hypot(bee.velocity.x, bee.velocity.z) > 0.15) bee.yaw = dampAngle(bee.yaw, Math.atan2(bee.velocity.x, bee.velocity.z), 8, dt);
        if (repelFromCamera(bee.position, w.camera, dt) && bee.state !== 'leave' && bee.flower.distanceTo(w.camera) < 3.5) this.pickFlower(bee, ctx);
        // Asa em borrão: bate rápido demais para ver.
        wingAngle = 0.4 + Math.sin(t * 90) * 0.5;
      }
      this.draw(bee, wingAngle, wingSweep, pitch, jitter, t);
    }
    this.body.flush();
    this.wingR.flush();
    this.wingL.flush();
  }

  private draw(bee: Bee, wingAngle: number, sweep: number, pitch: number, jitter: number, t: number): void {
    rootMatrix(mRoot, bee.position, bee.yaw, pitch + Math.sin(t * 40) * jitter, Math.sin(t * 37) * jitter * 1.2, bee.scale);
    this.body.set(bee.bodySlot, mRoot);
    this.wingR.set(bee.bodySlot, jointMatrix(mRoot, BEE_HINGE_R, 0, sweep, wingAngle, mOut));
    this.wingL.set(bee.bodySlot, jointMatrix(mRoot, BEE_HINGE_L, 0, -sweep, -wingAngle, mOut));
  }

  private hide(bee: Bee): void {
    this.body.hide(bee.bodySlot);
    this.wingR.hide(bee.bodySlot);
    this.wingL.hide(bee.bodySlot);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const bee of this.swarm) {
      if (bee.state !== 'leave' && bee.state !== 'away' && bee.position.distanceTo(position) < radius + 2) {
        this.pickFlower(bee, ctx);
        bee.velocity.set(0, 3, 0);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Libélulas

interface Dragonfly {
  bodySlot: number;
  wingSlots: [number, number];
  state: 'hover' | 'dart' | 'perch' | 'leave' | 'away';
  position: THREE.Vector3;
  target: THREE.Vector3;
  spot: THREE.Vector3 | null;
  yaw: number;
  scale: number;
  timer: number;
  check: number;
  seed: number;
}

const DRAGON_FORE_R = new THREE.Vector3(0.03, 0.08, 0.06);
const DRAGON_FORE_L = new THREE.Vector3(-0.03, 0.08, 0.06);
const DRAGON_HIND_R = new THREE.Vector3(0.03, 0.08, -0.05);
const DRAGON_HIND_L = new THREE.Vector3(-0.03, 0.08, -0.05);

/**
 * Libélulas: pairam, dão um "tiro" para outro ponto e param de novo. Com poça
 * cheia por perto, patrulham a água e encostam a cauda nela. Às vezes pousam
 * na ponta de uma flor com as quatro asas abertas. Só a chuva forte as espanta.
 */
export class Dragonflies implements Species {
  private readonly body: InstancedPart;
  private readonly wingR: InstancedPart;
  private readonly wingL: InstancedPart;
  private readonly flight: Dragonfly[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    const wing = dragonflyWing();
    this.body = new InstancedPart(dragonflyBody(), mats.paletteGloss, count, { name: 'dragonfly-body', palette: true });
    this.wingR = new InstancedPart(wing, mats.glass, count * 2, { name: 'dragonfly-wing-r', castShadow: false, skipAO: true });
    this.wingL = new InstancedPart(mirrorX(wing), mats.glass, count * 2, { name: 'dragonfly-wing-l', castShadow: false, skipAO: true });
    parent.add(this.body.mesh, this.wingR.mesh, this.wingL.mesh);
    for (let i = 0; i < count; i++) {
      const palette = DragonflyPalettes[i % DragonflyPalettes.length];
      const df: Dragonfly = {
        bodySlot: this.body.allocate(),
        wingSlots: [this.wingR.allocate(), this.wingR.allocate()],
        state: 'hover',
        position: new THREE.Vector3(),
        target: new THREE.Vector3(),
        spot: null,
        yaw: ctx.rng.next() * Math.PI * 2,
        scale: ctx.rng.range(0.85, 1.1),
        timer: ctx.rng.range(1, 3),
        check: 0,
        seed: ctx.rng.next() * 100,
      };
      this.wingL.allocate();
      this.wingL.allocate();
      this.body.setPalette(df.bodySlot, new THREE.Color(palette.a), new THREE.Color(palette.b), new THREE.Color(palette.c));
      airPointNear(ctx, 25, 3, 6, df.position);
      df.target.copy(df.position);
      this.flight.push(df);
    }
  }

  /** Próximo ponto: sobre uma poça cheia (às vezes rente à água) ou no ar perto do jogador. */
  private nextTarget(df: Dragonfly, ctx: CritterContext): void {
    const w = ctx.world;
    df.spot = null;
    let pond = null;
    for (const p of w.puddles) {
      if (p.fill > 0.2 && Math.hypot(p.x - w.player.x, p.z - w.player.z) < 35 && (!pond || p.fill > pond.fill)) pond = p;
    }
    if (pond && ctx.rng.next() < 0.6) {
      const a = ctx.rng.next() * Math.PI * 2;
      const d = Math.sqrt(ctx.rng.next()) * pond.radius * 0.7;
      const dip = ctx.rng.next() < 0.18;
      df.target.set(pond.x + Math.cos(a) * d, pond.level + (dip ? 0.14 : ctx.rng.range(0.6, 2.2)), pond.z + Math.sin(a) * d);
    } else if (ctx.rng.next() < 0.22 && (df.spot = pickSpotNear(ctx, 24))) {
      df.target.copy(df.spot).add(vTmp.set(0, 0.12, 0));
    } else {
      airPointNear(ctx, 20, 2.5, 6, df.target);
    }
    df.yaw = Math.atan2(df.target.x - df.position.x, df.target.z - df.position.z);
    df.state = 'dart';
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const df of this.flight) {
      const t = ctx.time + df.seed;
      if (w.rain > 0.55 && df.state !== 'leave' && df.state !== 'away') {
        df.state = 'leave';
        farPoint(ctx, 60, 10, df.target);
        df.yaw = Math.atan2(df.target.x - df.position.x, df.target.z - df.position.z);
      }
      if (df.state === 'away') {
        this.hide(df);
        if (w.rain < 0.2) {
          df.timer -= dt;
          if (df.timer <= 0) {
            farPoint(ctx, 34, 6, df.position);
            this.nextTarget(df, ctx);
          }
        }
        continue;
      }
      const pos = df.position;
      let flat = false;
      if (df.state === 'perch') {
        df.timer -= dt;
        df.check -= dt;
        if (df.check <= 0) {
          df.check = 0.3;
          if (df.spot && !spotAlive(ctx, df.spot)) df.timer = 0;
        }
        if (df.timer <= 0) this.nextTarget(df, ctx);
        flat = true;
      } else if (df.state === 'hover') {
        df.timer -= dt;
        pos.y += Math.sin(t * 2.3) * 0.15 * dt;
        if (df.timer <= 0) this.nextTarget(df, ctx);
      } else {
        const rate = df.state === 'leave' ? 1.2 : 3.2;
        pos.x = damp(pos.x, df.target.x, rate, dt);
        pos.y = damp(pos.y, df.target.y, rate, dt);
        pos.z = damp(pos.z, df.target.z, rate, dt);
        const far = Math.hypot(pos.x - w.player.x, pos.z - w.player.z);
        if (df.state === 'leave' && far > 44) {
          df.state = 'away';
          df.timer = ctx.rng.range(4, 12);
          continue;
        }
        if (df.state === 'dart' && pos.distanceTo(df.target) < 0.12) {
          if (df.spot) {
            df.state = 'perch';
            df.timer = ctx.rng.range(3, 8);
          } else {
            df.state = 'hover';
            df.timer = ctx.rng.range(1.2, 3.5);
          }
        }
        if (df.state === 'dart' && far > 45) this.nextTarget(df, ctx);
      }
      const ground = terrainHeight(pos.x, pos.z) + 0.25;
      if (pos.y < ground) pos.y = ground;
      if (df.state !== 'perch' && repelFromCamera(pos, w.camera, dt) && df.target.distanceTo(w.camera) < 3.5) airPointNear(ctx, 20, 2.5, 6, df.target);

      rootMatrix(mRoot, pos, df.yaw, 0, flat ? 0 : Math.sin(t * 1.3) * 0.05, df.scale);
      this.body.set(df.bodySlot, mRoot);
      // Quatro asas: anterior e posterior batem defasadas (o "zumbido" de libélula).
      const fore = flat ? -0.05 : Math.sin(t * 55) * 0.4;
      const hind = flat ? -0.05 : Math.sin(t * 55 + 1.6) * 0.4;
      const [foreSlot, hindSlot] = df.wingSlots;
      this.wingR.set(foreSlot, jointMatrix(mRoot, DRAGON_FORE_R, 0, flat ? -0.15 : -0.05, fore, mOut));
      this.wingR.set(hindSlot, jointMatrix(mRoot, DRAGON_HIND_R, 0, flat ? 0.2 : 0.1, hind, mOut, 1, 1, 1.18));
      this.wingL.set(foreSlot, jointMatrix(mRoot, DRAGON_FORE_L, 0, flat ? 0.15 : 0.05, -fore, mOut));
      this.wingL.set(hindSlot, jointMatrix(mRoot, DRAGON_HIND_L, 0, flat ? -0.2 : -0.1, -hind, mOut, 1, 1, 1.18));
    }
    this.body.flush();
    this.wingR.flush();
    this.wingL.flush();
  }

  private hide(df: Dragonfly): void {
    this.body.hide(df.bodySlot);
    for (const s of df.wingSlots) {
      this.wingR.hide(s);
      this.wingL.hide(s);
    }
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const df of this.flight) {
      if ((df.state === 'perch' || df.state === 'hover') && df.position.distanceTo(position) < radius + 2.5) this.nextTarget(df, ctx);
    }
  }
}
