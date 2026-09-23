import * as THREE from 'three';
import { dampAngle } from '../../utils/math';
import { terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { centipedeCurled, centipedeHead, centipedeSegment, CENTIPEDE_SPACING, earwigBody } from './soilModels';
import { UP, attraction, ballTakes, collectedMesh, shoveFromBall, threatAt } from './common';
import { GroundTrail } from './trail';
import { GroundWalker } from './walker';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Os moradores de debaixo da pedra: quando a bola arranca uma pedra ou um
 * tronco, tesourinhas e lacraias que estavam no escuro úmido saem correndo
 * para longe, rápido, e depois de uns segundos se enfiam na terra de novo.
 * Não existem fora disso: só aparecem pelo `spawn`.
 */

const mRoot = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Onde um bicho aparece na borda do que foi arrancado: anda do centro para fora,
 * na direção `angle`, até sair do "pé" sólido (o lugar da pedra continua
 * contando como sólido para os bichos). Devolve false se não achou chão livre.
 */
function rimPoint(ctx: CritterContext, ground: THREE.Vector3, angle: number, spread: number, target: THREE.Vector3): boolean {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  for (let d = spread * 0.3; d < spread + 1.6; d += 0.12) {
    const x = ground.x + dx * d;
    const z = ground.z + dz * d;
    if (Math.hypot(x, z) > PLAY_RADIUS - 2) return false;
    if (ctx.isGroundFree(x, z)) {
      target.set(x, terrainHeight(x, z), z);
      return true;
    }
  }
  return false;
}

/**
 * Para onde correr agora: até a bola (Fedor irresistível), para longe do
 * perigo, ou para longe de onde saiu. Devolve o multiplicador de velocidade.
 */
function runDirection(ctx: CritterContext, position: THREE.Vector3, origin: THREE.Vector3, wiggle: number, out: THREE.Vector3): number {
  const hurry = attraction(ctx, position.x, position.z, out);
  if (hurry > 0) return hurry;
  if (threatAt(ctx, position.x, position.y, position.z, vAway) < 2.5) {
    out.copy(vAway);
    return 1.25;
  }
  out.set(position.x - origin.x, 0, position.z - origin.z);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize();
  // Nunca em linha reta: um zigue-zague de bicho assustado.
  const a = Math.sin(wiggle) * 0.55;
  const c = Math.cos(a);
  const s = Math.sin(a);
  out.set(out.x * c - out.z * s, 0, out.x * s + out.z * c);
  return 1;
}

// ---------------------------------------------------------------------------
// Tesourinhas

interface Earwig {
  slot: number;
  state: 'hidden' | 'run' | 'burrow';
  walker: GroundWalker;
  readonly origin: THREE.Vector3;
  scale: number;
  gait: number;
  /** Segundos até se enfiar na terra. */
  timer: number;
  /** 0..1: afundando na terra. */
  sink: number;
  steer: number;
  seed: number;
}

/** Tamanho efetivo da tesourinha grudada. */
const EARWIG_SIZE = 0.35;

export class Earwigs implements Species {
  private readonly poseA: InstancedPart;
  private readonly poseB: InstancedPart;
  private readonly bugs: Earwig[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.poseA = new InstancedPart(earwigBody(0), mats.glossy, count, { name: 'earwig-a' });
    this.poseB = new InstancedPart(earwigBody(1), mats.glossy, count, { name: 'earwig-b' });
    parent.add(this.poseA.mesh, this.poseB.mesh);
    for (let i = 0; i < count; i++) {
      const slot = this.poseA.allocate();
      this.poseB.allocate();
      this.bugs.push({
        slot,
        state: 'hidden',
        walker: new GroundWalker(1.5),
        origin: new THREE.Vector3(),
        scale: ctx.rng.range(0.9, 1.15),
        gait: 0,
        timer: 0,
        sink: 0,
        steer: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  /** Solta até `max` tesourinhas da borda do que foi arrancado em `ground`. Devolve quantas saíram. */
  spawn(ground: THREE.Vector3, spread: number, max: number, ctx: CritterContext): number {
    let spawned = 0;
    for (const bug of this.bugs) {
      if (spawned >= max) break;
      if (bug.state !== 'hidden') continue;
      const angle = ctx.rng.next() * Math.PI * 2;
      if (!rimPoint(ctx, ground, angle, spread, vA)) continue;
      bug.walker.placeAt(vA, angle, ctx.rng.range(0, 0.25));
      bug.origin.copy(ground);
      bug.state = 'run';
      bug.timer = ctx.rng.range(4, 7);
      bug.sink = 0;
      bug.steer = 0;
      spawned++;
    }
    return spawned;
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const bug of this.bugs) {
      if (bug.state === 'hidden') {
        this.hide(bug);
        continue;
      }
      const walker = bug.walker;
      const p = walker.position;
      if (Math.hypot(p.x - w.player.x, p.z - w.player.z) > 45) {
        bug.state = 'hidden';
        this.hide(bug);
        continue;
      }
      let sinkDepth = 0;
      let pitch = 0;
      if (bug.state === 'run') {
        bug.timer -= dt;
        bug.steer -= dt;
        const hurry = runDirection(ctx, p, bug.origin, ctx.time * 3 + bug.seed, vDir);
        if (bug.steer <= 0) {
          bug.steer = 0.25;
          walker.flee(vDir, 1.4);
        }
        walker.step(dt, ctx, 1.7 * hurry * bug.scale, 9);
        bug.gait += walker.moved * 38;
        shoveFromBall(ctx, p, 0.12, 0.08);
        // Atraída pelo fedor ela não vai embora: fica rondando a bola.
        if (bug.timer <= 0 && attraction(ctx, p.x, p.z, vTmp) === 0) bug.state = 'burrow';
      } else {
        // Enfia a cabeça na terra e vai sumindo, remexendo o rabo.
        bug.sink = Math.min(1, bug.sink + dt / 0.8);
        walker.step(dt, ctx, 0.25, 4);
        bug.gait += dt * 14;
        walker.yaw += Math.sin(ctx.time * 22 + bug.seed) * dt * 1.5;
        sinkDepth = bug.sink * 0.14 * bug.scale;
        pitch = 0.35 * Math.min(1, bug.sink * 3);
        if (bug.sink >= 1) {
          bug.state = 'hidden';
          this.hide(bug);
          continue;
        }
      }
      walker.matrix(mRoot, bug.scale, -sinkDepth, pitch);
      const pose = Math.floor(bug.gait) % 2 === 0;
      (pose ? this.poseA : this.poseB).set(bug.slot, mRoot);
      (pose ? this.poseB : this.poseA).hide(bug.slot);
    }
    this.poseA.flush();
    this.poseB.flush();
  }

  private hide(bug: Earwig): void {
    this.poseA.hide(bug.slot);
    this.poseB.hide(bug.slot);
  }

  startle(position: THREE.Vector3, radius: number): void {
    // Susto novo perto: corre mais um pouco antes de se enterrar.
    for (const bug of this.bugs) {
      if (bug.state === 'run' && bug.walker.position.distanceTo(position) < radius + 2) bug.timer = Math.max(bug.timer, 2);
    }
  }

  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    for (const bug of this.bugs) {
      if (bug.state !== 'run') continue;
      const p = bug.walker.position;
      if (!ballTakes(center, radius, EARWIG_SIZE, p.x, p.y + 0.05, p.z, 0.12 * bug.scale)) continue;
      bug.walker.matrix(mRoot, bug.scale);
      bug.state = 'hidden';
      this.hide(bug);
      return { id: 'earwig', object: collectedMesh(this.poseA.mesh.geometry, critterMaterials().glossy, mRoot), size: EARWIG_SIZE, color: new THREE.Color('#7a3a22') };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lacraias

const SEGMENTS = 14;
const CENTIPEDE_SIZE = 0.5;

interface Centipede {
  headSlot: number;
  segmentSlots: number[];
  state: 'hidden' | 'run' | 'dive';
  trail: GroundTrail;
  readonly origin: THREE.Vector3;
  scale: number;
  speed: number;
  timer: number;
  plunge: number;
  /** Fase da onda de patas. */
  phase: number;
  seed: number;
}

export class Centipedes implements Species {
  private readonly head: InstancedPart;
  private readonly segA: InstancedPart;
  private readonly segB: InstancedPart;
  private readonly bugs: Centipede[] = [];
  private curled: THREE.BufferGeometry | null = null;

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.head = new InstancedPart(centipedeHead(), mats.glossy, count, { name: 'centipede-head' });
    this.segA = new InstancedPart(centipedeSegment(0), mats.glossy, count * SEGMENTS, { name: 'centipede-a', skipAO: true });
    this.segB = new InstancedPart(centipedeSegment(1), mats.glossy, count * SEGMENTS, { name: 'centipede-b', skipAO: true });
    parent.add(this.head.mesh, this.segA.mesh, this.segB.mesh);
    for (let i = 0; i < count; i++) {
      const scale = ctx.rng.range(0.9, 1.15);
      this.bugs.push({
        headSlot: this.head.allocate(),
        segmentSlots: Array.from({ length: SEGMENTS }, () => {
          this.segB.allocate();
          return this.segA.allocate();
        }),
        state: 'hidden',
        trail: new GroundTrail(SEGMENTS * CENTIPEDE_SPACING * scale + 0.6),
        origin: new THREE.Vector3(),
        scale,
        speed: ctx.rng.range(1.9, 2.4),
        timer: 0,
        plunge: 0,
        phase: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  private length(bug: Centipede): number {
    return SEGMENTS * CENTIPEDE_SPACING * bug.scale;
  }

  /** Solta até `max` lacraias saindo da terra na borda do que foi arrancado. Devolve quantas saíram. */
  spawn(ground: THREE.Vector3, spread: number, max: number, ctx: CritterContext): number {
    let spawned = 0;
    for (const bug of this.bugs) {
      if (spawned >= max) break;
      if (bug.state !== 'hidden') continue;
      const angle = ctx.rng.next() * Math.PI * 2;
      if (!rimPoint(ctx, ground, angle, spread, vA)) continue;
      // Sai da terra fofa que estava debaixo da pedra (o corpo vem subindo pelo buraco).
      bug.trail.start(vA, angle);
      bug.origin.copy(ground);
      bug.state = 'run';
      bug.timer = ctx.rng.range(4, 7);
      bug.plunge = 0;
      spawned++;
    }
    return spawned;
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const bug of this.bugs) {
      if (bug.state === 'hidden') {
        this.hide(bug);
        continue;
      }
      const trail = bug.trail;
      trail.pointAt(trail.headS, vA);
      if (Math.hypot(vA.x - w.player.x, vA.z - w.player.z) > 45) {
        bug.state = 'hidden';
        this.hide(bug);
        continue;
      }
      if (bug.state === 'run') {
        bug.timer -= dt;
        const hurry = runDirection(ctx, vA, bug.origin, ctx.time * 2.2 + bug.seed, vDir);
        trail.heading = dampAngle(trail.heading, Math.atan2(vDir.x, vDir.z), 5, dt);
        const step = bug.speed * hurry * dt;
        trail.advance(step, ctx, false);
        bug.phase += step * 26;
        if (bug.timer <= 0 && attraction(ctx, vA.x, vA.z, vTmp) === 0) bug.state = 'dive';
      } else {
        // Cava de cabeça, como a minhoca: o corpo segue o mesmo túnel e some.
        const step = bug.speed * 0.45 * dt;
        trail.advance(step, ctx, true, 1.1);
        bug.phase += step * 26;
        bug.plunge += step;
        if (bug.plunge > this.length(bug) + 0.4) {
          bug.state = 'hidden';
          this.hide(bug);
          continue;
        }
      }
      this.draw(bug);
    }
    this.head.flush();
    this.segA.flush();
    this.segB.flush();
  }

  /** Matriz de um ponto do corpo (no comprimento `s` do rastro), alinhada com o rastro. Devolve false se está enterrado. */
  private bodyMatrix(bug: Centipede, s: number, scale: number, target: THREE.Matrix4): boolean {
    const trail = bug.trail;
    const depth = trail.pointAt(s, vA);
    if (depth > 0.05 * scale) return false;
    trail.pointAt(s + 0.04, vB);
    vTmp.copy(vB);
    trail.pointAt(s - 0.04, vB);
    vTmp.sub(vB);
    if (vTmp.lengthSq() < 1e-8) vTmp.set(Math.sin(trail.heading), 0, Math.cos(trail.heading));
    qTmp.setFromUnitVectors(Z_AXIS, vTmp.normalize());
    target.compose(vA, qTmp, vScale.setScalar(scale));
    return true;
  }

  private draw(bug: Centipede): void {
    const trail = bug.trail;
    if (this.bodyMatrix(bug, trail.headS, bug.scale, mRoot)) this.head.set(bug.headSlot, mRoot);
    else this.head.hide(bug.headSlot);
    const spacing = CENTIPEDE_SPACING * bug.scale;
    for (let i = 0; i < SEGMENTS; i++) {
      const slot = bug.segmentSlots[i];
      // Afina no fim do corpo.
      const k = i / (SEGMENTS - 1);
      const scale = bug.scale * (k > 0.75 ? 1 - (k - 0.75) * 1.3 : 1);
      if (!this.bodyMatrix(bug, trail.headS - (i + 0.85) * spacing, scale, mRoot)) {
        this.segA.hide(slot);
        this.segB.hide(slot);
        continue;
      }
      // Onda de patas: cada segmento meio passo atrás do da frente.
      const pose = (Math.floor(bug.phase - i * 0.5) & 1) === 0;
      (pose ? this.segA : this.segB).set(slot, mRoot);
      (pose ? this.segB : this.segA).hide(slot);
    }
  }

  private hide(bug: Centipede): void {
    this.head.hide(bug.headSlot);
    for (const slot of bug.segmentSlots) {
      this.segA.hide(slot);
      this.segB.hide(slot);
    }
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const bug of this.bugs) {
      if (bug.state !== 'run') continue;
      bug.trail.pointAt(bug.trail.headS, vA);
      if (vA.distanceTo(position) < radius + 2) bug.timer = Math.max(bug.timer, 2);
    }
  }

  collect(center: THREE.Vector3, radius: number, ctx: CritterContext): CollectedCritter | null {
    for (const bug of this.bugs) {
      if (bug.state !== 'run') continue;
      const trail = bug.trail;
      // Encostou na cabeça ou no meio do corpo.
      let touching = false;
      for (let k = 0; k < 2 && !touching; k++) {
        const depth = trail.pointAt(trail.headS - this.length(bug) * 0.5 * k, vA);
        touching = depth < 0.02 && ballTakes(center, radius, CENTIPEDE_SIZE, vA.x, vA.y + 0.04, vA.z, 0.1 * bug.scale);
      }
      if (!touching) continue;
      trail.pointAt(trail.headS - this.length(bug) * 0.3, vA);
      qTmp.setFromAxisAngle(UP, ctx.rng.next() * Math.PI * 2);
      mRoot.compose(vA, qTmp, vScale.setScalar(bug.scale));
      this.curled ??= centipedeCurled(SEGMENTS);
      bug.state = 'hidden';
      this.hide(bug);
      return { id: 'centipede', object: collectedMesh(this.curled, critterMaterials().glossy, mRoot), size: CENTIPEDE_SIZE, color: new THREE.Color('#c2622d') };
    }
    return null;
  }
}
