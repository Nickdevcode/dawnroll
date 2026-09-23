import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep } from '../../utils/math';
import { terrainHeight, terrainNormal, PLAY_RADIUS } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { bakePose, mirrorX, snailShellPalette } from './models';
import {
  ladybugLeg,
  ladybugWing,
  pillBugBall,
  pillBugWalk,
  PILLBUG_BALL_RADIUS,
  snailBody,
  snailStalk,
  SnailPalettes,
  SNAIL_STALK_BASE,
  type BeetleRig,
  type LadybugPalette,
} from './groundModels';
import { UP, attraction, ballTakes, collectedMesh, inView, pickSpotNear, puddleAt, shoveFromBall, spotAlive, threatAt } from './common';
import { jointMatrix } from './flyers';
import { GroundWalker } from './walker';
import type { CatalogId } from '../../progression/catalog';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Bichos de chão que andam: joaninhas e vaquinhas (que também voam de flor em
 * flor), caracóis (que gostam de chuva) e tatuzinhos (que viram bolinha — e a
 * bola pode pegar).
 */

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vHip = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Besourinhos: joaninhas e vaquinhas

type BeetleState = 'walk' | 'takeoff' | 'fly' | 'land' | 'perch';

/** Uma espécie de besourinho que passeia no chão e voa de flor em flor. */
export interface BeetleSpec {
  count: number;
  rig: BeetleRig;
  body: THREE.BufferGeometry;
  /** Élitro direito (o esquerdo é o espelho). */
  elytron: THREE.BufferGeometry;
  /** Cores por indivíduo (élitro em pesos de paleta, A = fundo, B = pintas). Sem isso, as cores vêm assadas. */
  palettes?: readonly LadybugPalette[];
  /** Perigo mais perto que isso (unidades): levanta voo. */
  wary: number;
  /** Segundos entre uma vontade de voar e a próxima. */
  urge: readonly [number, number];
  walkSpeed: number;
  scale: readonly [number, number];
  /** Gruda na bola se for pega no chão (a joaninha não: ela sempre escapa voando). */
  collect?: { id: CatalogId; size: number; color: string };
}

interface BeetleKind {
  spec: BeetleSpec;
  body: InstancedPart;
  elytraR: InstancedPart;
  elytraL: InstancedPart;
  /** Pose parada com as cores assadas (para grudar na bola); nasce na primeira vez. */
  stuck: THREE.BufferGeometry | null;
}

interface Beetle {
  kind: BeetleKind;
  /** Vaga nas peças da espécie (corpo, élitros). */
  slot: number;
  /** Vaga nas peças compartilhadas (asas). */
  wingSlot: number;
  legSlots: number[];
  walker: GroundWalker;
  state: BeetleState;
  scale: number;
  gait: number;
  /** 0 = élitros fechados, 1 = abertos (voando). */
  open: number;
  /** Segundos até a próxima vontade de voar. */
  urge: number;
  spot: THREE.Vector3 | null;
  check: number;
  timer: number;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  flightT: number;
  flightTime: number;
  arc: number;
  placed: boolean;
  /** Pego pela bola: some por um tempo e reaparece longe, fora da vista. */
  gone: number;
}

/**
 * Besourinhos de jardim: passeiam no chão com as seis patinhas em tripé; de
 * vez em quando (ou quando algo chega perto) abrem os élitros, desdobram as
 * asas e voam num arco até uma flor ou outro canto do chão.
 *
 * - Joaninha: arisca, voa com qualquer coisa chegando — nunca gruda.
 * - Vaquinha (Diabrotica, verde de pintas amarelas): mais sossegada, só levanta
 *   voo com o perigo em cima; dá para pegar andando no chão.
 *
 * As asas de voo e as patas são as mesmas peças para as duas espécies (menos draw calls).
 */
export class SmallBeetles implements Species {
  private readonly kinds: BeetleKind[] = [];
  private readonly wingR: InstancedPart;
  private readonly wingL: InstancedPart;
  private readonly legs: InstancedPart;
  private readonly bugs: Beetle[] = [];

  constructor(specs: readonly BeetleSpec[], ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    const total = specs.reduce((sum, spec) => sum + spec.count, 0);
    const wing = ladybugWing();
    this.wingR = new InstancedPart(wing, mats.glass, total, { name: 'beetle-wing-r', castShadow: false, skipAO: true });
    this.wingL = new InstancedPart(mirrorX(wing), mats.glass, total, { name: 'beetle-wing-l', castShadow: false, skipAO: true });
    this.legs = new InstancedPart(ladybugLeg(), mats.body, total * 6, { name: 'beetle-legs', skipAO: true });
    parent.add(this.wingR.mesh, this.wingL.mesh, this.legs.mesh);
    for (const spec of specs) {
      const palette = !!spec.palettes;
      const elytraMaterial = palette ? mats.paletteGloss : mats.glossy;
      const name = spec.collect?.id ?? 'ladybug';
      const kind: BeetleKind = {
        spec,
        body: new InstancedPart(spec.body, mats.glossy, spec.count, { name: `${name}-body` }),
        elytraR: new InstancedPart(spec.elytron, elytraMaterial, spec.count, { name: `${name}-elytron-r`, palette }),
        elytraL: new InstancedPart(mirrorX(spec.elytron), elytraMaterial, spec.count, { name: `${name}-elytron-l`, palette }),
        stuck: null,
      };
      parent.add(kind.body.mesh, kind.elytraR.mesh, kind.elytraL.mesh);
      this.kinds.push(kind);
      for (let i = 0; i < spec.count; i++) {
        const slot = kind.body.allocate();
        kind.elytraR.allocate();
        kind.elytraL.allocate();
        if (spec.palettes) {
          const p = spec.palettes[i % spec.palettes.length];
          const a = new THREE.Color(p.a);
          const b = new THREE.Color(p.b);
          kind.elytraR.setPalette(slot, a, b, a);
          kind.elytraL.setPalette(slot, a, b, a);
        }
        this.bugs.push({
          kind,
          slot,
          wingSlot: this.wingR.allocate(),
          legSlots: Array.from({ length: 6 }, () => this.legs.allocate()),
          walker: new GroundWalker(3),
          state: 'walk',
          scale: ctx.rng.range(spec.scale[0], spec.scale[1]),
          gait: ctx.rng.next() * 10,
          open: 0,
          urge: ctx.rng.range(spec.urge[0] * 0.6, spec.urge[1] * 0.9),
          spot: null,
          check: 0,
          timer: 0,
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          flightT: 0,
          flightTime: 1,
          arc: 1,
          placed: false,
          gone: 0,
        });
        this.wingL.allocate();
      }
    }
  }

  /** Decide para onde voar: uma flor (ponto de pouso) ou outro canto do chão. */
  private takeOff(bug: Beetle, ctx: CritterContext): void {
    if (bug.state !== 'walk' && bug.state !== 'perch') return;
    const w = bug.walker;
    bug.state = 'takeoff';
    bug.from.copy(w.position);
    bug.spot = ctx.rng.next() < 0.5 ? pickSpotNear(ctx, 12) : null;
    if (bug.spot && bug.spot.distanceTo(w.position) < 14) {
      bug.to.copy(bug.spot).add(vTmp.set(0, 0.04, 0));
    } else {
      bug.spot = null;
      let found = false;
      for (let i = 0; i < 16 && !found; i++) {
        const a = ctx.rng.next() * Math.PI * 2;
        const d = ctx.rng.range(3, 8);
        const x = w.position.x + Math.cos(a) * d;
        const z = w.position.z + Math.sin(a) * d;
        if (Math.hypot(x, z) > PLAY_RADIUS - 2 || !ctx.isGroundFree(x, z) || puddleAt(ctx, x, z, 0.4)) continue;
        bug.to.set(x, terrainHeight(x, z), z);
        found = true;
      }
      if (!found) bug.to.copy(w.position).add(vTmp.set(0.5, 0, 0.5));
    }
  }

  update(dt: number, ctx: CritterContext): void {
    for (const bug of this.bugs) {
      const w = bug.walker;
      const spec = bug.kind.spec;
      if (bug.gone > 0) {
        bug.gone -= dt;
        this.hide(bug);
        if (bug.gone > 0) continue;
        bug.placed = false;
        bug.state = 'walk';
        bug.open = 0;
      }
      if (!bug.placed || (bug.state === 'walk' && Math.hypot(w.position.x - ctx.world.player.x, w.position.z - ctx.world.player.z) > 40)) {
        bug.placed = w.relocate(ctx, bug.placed ? 18 : 5, bug.placed ? 30 : 24, true);
        if (!bug.placed) {
          this.hide(bug);
          continue;
        }
      }
      const t = ctx.time;
      let pitch = 0;
      let flap = 0;
      let legsTucked = false;
      let up: THREE.Vector3 = w.groundUp;
      switch (bug.state) {
        case 'walk': {
          bug.urge -= dt;
          // Fedor irresistível: a vaquinha vai andando até a bola (e nem pensa em voar).
          const hurry = spec.collect ? attraction(ctx, w.position.x, w.position.z, vAway) : 0;
          if (hurry > 0) {
            w.flee(vAway, 1);
            w.step(dt, ctx, spec.walkSpeed * hurry * 1.4, 6);
            shoveFromBall(ctx, w.position, 0.15, 0.15);
            break;
          }
          const danger = threatAt(ctx, w.position.x, w.position.y, w.position.z, vAway);
          if (danger < spec.wary || bug.urge <= 0) {
            bug.urge = ctx.rng.range(spec.urge[0], spec.urge[1]);
            this.takeOff(bug, ctx);
            break;
          }
          w.step(dt, ctx, spec.walkSpeed * (1 - ctx.world.rain * 0.5));
          if (shoveFromBall(ctx, w.position, 0.2, 0.2)) this.takeOff(bug, ctx);
          break;
        }
        case 'takeoff':
          bug.open = Math.min(1, bug.open + dt / 0.3);
          legsTucked = bug.open > 0.7;
          if (bug.open >= 1) {
            bug.state = 'fly';
            bug.flightT = 0;
            const dist = bug.from.distanceTo(bug.to);
            bug.flightTime = 0.5 + dist * 0.28;
            bug.arc = 0.8 + dist * 0.25;
          }
          break;
        case 'fly': {
          bug.flightT = Math.min(1, bug.flightT + dt / bug.flightTime);
          const k = bug.flightT;
          const eased = k * k * (3 - 2 * k);
          w.position.lerpVectors(bug.from, bug.to, eased);
          w.position.y += Math.sin(Math.PI * k) * bug.arc;
          w.yaw = dampAngle(w.yaw, Math.atan2(bug.to.x - bug.from.x, bug.to.z - bug.from.z), 8, dt);
          pitch = -0.55;
          flap = Math.sin(t * 70 + bug.wingSlot) * 0.65;
          legsTucked = true;
          up = UP;
          if (k >= 1) {
            bug.state = 'land';
            w.home.copy(bug.to);
            w.target.copy(bug.to);
          }
          break;
        }
        case 'land':
          bug.open = Math.max(0, bug.open - dt / 0.35);
          legsTucked = bug.open > 0.5;
          if (bug.spot) up = UP;
          if (bug.open <= 0) {
            if (bug.spot) {
              bug.state = 'perch';
              bug.timer = ctx.rng.range(4, 12);
              bug.check = 0.3;
            } else {
              bug.state = 'walk';
              w.pickWanderTarget(ctx);
            }
          }
          break;
        case 'perch':
          up = UP;
          bug.timer -= dt;
          bug.check -= dt;
          w.yaw += Math.sin(t * 0.7 + bug.wingSlot) * dt * 0.6;
          if (bug.check <= 0) {
            bug.check = 0.3;
            if (bug.spot && !spotAlive(ctx, bug.spot)) bug.timer = 0;
          }
          if (bug.timer <= 0) this.takeOff(bug, ctx);
          break;
      }
      if (bug.state === 'walk') bug.gait += w.moved * 26;
      this.draw(bug, pitch, flap, legsTucked, up, t);
    }
    for (const kind of this.kinds) {
      kind.body.flush();
      kind.elytraR.flush();
      kind.elytraL.flush();
    }
    this.wingR.flush();
    this.wingL.flush();
    this.legs.flush();
  }

  private draw(bug: Beetle, pitch: number, flap: number, tucked: boolean, up: THREE.Vector3, t: number): void {
    const kind = bug.kind;
    const rig = kind.spec.rig;
    bug.walker.matrix(mRoot, bug.scale, 0, pitch, up);
    kind.body.set(bug.slot, mRoot);
    const o = bug.open;
    kind.elytraR.set(bug.slot, jointMatrix(mRoot, rig.elytraPivot, 0.35 * o, -0.3 * o, 0.95 * o, mOut));
    kind.elytraL.set(bug.slot, jointMatrix(mRoot, rig.elytraPivot, 0.35 * o, 0.3 * o, -0.95 * o, mOut));
    const unfold = smoothstep(0.55, 1, o);
    if (unfold > 0.01) {
      const fold = (1 - unfold) * 1.2;
      this.wingR.set(bug.wingSlot, jointMatrix(mRoot, rig.wingHinge, 0, fold, flap, mOut, unfold, 1, unfold));
      vHip.set(-rig.wingHinge.x, rig.wingHinge.y, rig.wingHinge.z);
      this.wingL.set(bug.wingSlot, jointMatrix(mRoot, vHip, 0, -fold, -flap, mOut, unfold, 1, unfold));
    } else {
      this.wingR.hide(bug.wingSlot);
      this.wingL.hide(bug.wingSlot);
    }
    const walking = bug.state === 'walk' && bug.walker.moved > 0;
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1;
      const hip = rig.hips[i % 3];
      vHip.set(hip[0] * side, hip[1], hip[2]);
      const group = (i % 3 + (side > 0 ? 0 : 1)) % 2;
      const phase = bug.gait + group * Math.PI;
      let swing = walking ? Math.sin(phase) * 0.38 : 0;
      let lift = walking ? Math.max(0, Math.cos(phase)) * 0.3 : 0;
      if (tucked) {
        swing = 0.25 * (i % 3 - 1);
        lift = 0.55 + Math.sin(t * 9 + i) * 0.05;
      }
      this.legs.set(bug.legSlots[i], jointMatrix(mRoot, vHip, 0, side > 0 ? swing : Math.PI - swing, lift, mOut));
    }
  }

  private hide(bug: Beetle): void {
    bug.kind.body.hide(bug.slot);
    bug.kind.elytraR.hide(bug.slot);
    bug.kind.elytraL.hide(bug.slot);
    this.wingR.hide(bug.wingSlot);
    this.wingL.hide(bug.wingSlot);
    for (const s of bug.legSlots) this.legs.hide(s);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const bug of this.bugs) {
      if (bug.gone > 0 || bug.walker.position.distanceTo(position) > radius + bug.kind.spec.wary + 0.3) continue;
      // Atraída pelo fedor, a vaquinha nem liga para o susto.
      if (bug.state === 'walk' && bug.kind.spec.collect && attraction(ctx, bug.walker.position.x, bug.walker.position.z, vAway) > 0) continue;
      this.takeOff(bug, ctx);
    }
  }

  /** Vaquinha no chão (andando, ou ainda abrindo as asas) encostando numa bola grande o bastante. */
  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    for (const bug of this.bugs) {
      const catchable = bug.kind.spec.collect;
      if (!catchable || bug.gone > 0 || !bug.placed) continue;
      const grounded = bug.state === 'walk' || (bug.state === 'takeoff' && bug.open < 0.8) || (bug.state === 'land' && !bug.spot);
      if (!grounded) continue;
      const p = bug.walker.position;
      if (!ballTakes(center, radius, catchable.size, p.x, p.y + 0.08, p.z, 0.14 * bug.scale)) continue;
      bug.walker.matrix(mRoot, bug.scale);
      bug.gone = 30;
      this.hide(bug);
      return { id: catchable.id, object: collectedMesh(this.stuckPose(bug.kind), critterMaterials().glossy, mRoot), size: catchable.size, color: new THREE.Color(catchable.color) };
    }
    return null;
  }

  /** O besourinho parado (élitros fechados, patinhas no lugar) numa geometria só, com as cores assadas. */
  private stuckPose(kind: BeetleKind): THREE.BufferGeometry {
    if (kind.stuck) return kind.stuck;
    const { rig, body, elytron } = kind.spec;
    const identity = new THREE.Matrix4();
    const at = (offset: THREE.Vector3, ry = 0) => jointMatrix(identity, offset, 0, ry, 0, new THREE.Matrix4());
    const leg = this.legs.mesh.geometry;
    const parts: Array<readonly [THREE.BufferGeometry, THREE.Matrix4]> = [
      [body, identity],
      [elytron, at(rig.elytraPivot)],
      [kind.elytraL.mesh.geometry, at(rig.elytraPivot)],
    ];
    for (const hip of rig.hips) {
      parts.push([leg, at(new THREE.Vector3(hip[0], hip[1], hip[2]))]);
      parts.push([leg, at(new THREE.Vector3(-hip[0], hip[1], hip[2]), Math.PI)]);
    }
    kind.stuck = bakePose(parts);
    return kind.stuck;
  }
}

// ---------------------------------------------------------------------------
// Caracóis

interface Snail {
  slot: number;
  stalkSlots: [number, number];
  walker: GroundWalker;
  scale: number;
  /** Pedúnculos: 1 = esticados, ~0,12 = recolhidos. */
  extend: number;
  /** 1 = enfiado na casca. */
  withdraw: number;
  safe: number;
  visible: boolean;
  seed: number;
}

/**
 * Caracóis: arrastam-se devagar (bem mais animados com o chão molhado — e
 * aparecem mais deles na chuva), encolhem os olhinhos quando o besouro chega
 * perto e se enfiam na casca se a bola passa por cima.
 */
export class Snails implements Species {
  private readonly body: InstancedPart;
  private readonly shell: InstancedPart;
  private readonly stalks: InstancedPart;
  private readonly snails: Snail[] = [];
  private readonly baseCount: number;

  constructor(count: number, ctx: CritterContext, parent: THREE.Group, rainExtra: number) {
    const mats = critterMaterials();
    const total = count + rainExtra;
    this.baseCount = count;
    this.body = new InstancedPart(snailBody(), mats.slimy, total, { name: 'snail-body' });
    this.shell = new InstancedPart(snailShellPalette(), mats.paletteGloss, total, { name: 'snail-shell', palette: true });
    this.stalks = new InstancedPart(snailStalk(), mats.slimy, total * 2, { name: 'snail-stalks', skipAO: true });
    parent.add(this.body.mesh, this.shell.mesh, this.stalks.mesh);
    for (let i = 0; i < total; i++) {
      const slot = this.body.allocate();
      this.shell.allocate();
      const palette = SnailPalettes[i % SnailPalettes.length];
      this.shell.setPalette(slot, new THREE.Color(palette.a), new THREE.Color(palette.b), new THREE.Color(palette.c));
      this.snails.push({
        slot,
        stalkSlots: [this.stalks.allocate(), this.stalks.allocate()],
        walker: new GroundWalker(2),
        scale: ctx.rng.range(0.8, 1.15),
        extend: 1,
        withdraw: 0,
        safe: 0,
        visible: false,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  update(dt: number, ctx: CritterContext): void {
    const wet = ctx.world.wetness;
    // Chuva traz mais caracóis para fora (os extras aparecem e somem fora da vista).
    const wanted = this.baseCount + Math.round((this.snails.length - this.baseCount) * smoothstep(0.15, 0.65, wet));
    this.snails.forEach((snail, index) => {
      const w = snail.walker;
      const want = index < wanted;
      if (!snail.visible) {
        if (want && w.relocate(ctx, 6, 26, true)) {
          snail.visible = true;
          snail.withdraw = 0;
          snail.extend = 1;
        } else {
          this.hide(snail);
          return;
        }
      } else if ((!want && !inView(ctx, w.position.x, w.position.z)) || Math.hypot(w.position.x - ctx.world.player.x, w.position.z - ctx.world.player.z) > 42) {
        snail.visible = false;
        this.hide(snail);
        return;
      }

      const danger = threatAt(ctx, w.position.x, w.position.y, w.position.z, vAway);
      if (danger < 1.8) snail.safe = 2;
      else snail.safe -= dt;
      const shoved = shoveFromBall(ctx, w.position, 0.35, 0.5);
      const hiding = shoved || danger < 0.5;
      snail.withdraw = damp(snail.withdraw, hiding ? 1 : snail.safe > 0 ? snail.withdraw : 0, hiding ? 10 : 1.2, dt);
      snail.extend = damp(snail.extend, snail.safe > 0 ? 0.12 : 1, snail.safe > 0 ? 9 : 1.5, dt);
      const speed = snail.safe > 0 || snail.withdraw > 0.2 ? 0 : 0.11 * (1 + wet * 1.6);
      w.step(dt, ctx, speed, 1.5);
      this.draw(snail, ctx.time);
    });
    this.body.flush();
    this.shell.flush();
    this.stalks.flush();
  }

  private draw(snail: Snail, time: number): void {
    const w = snail.walker;
    const k = snail.withdraw;
    const crawl = w.moved > 0 ? Math.sin((time + snail.seed) * 3) * 0.03 : 0;
    // Corpo encolhe para dentro da casca; a casca desce até o chão.
    w.matrix(mRoot, snail.scale, 0);
    vTmp.set(0, 0, -0.1 * k);
    this.body.set(snail.slot, jointMatrix(mRoot, vTmp, 0, 0, 0, mOut, 1 - 0.35 * k, 1 - 0.4 * k, (1 - 0.6 * k) * (1 + crawl)));
    vTmp.set(0, -0.13 * k, 0.02 * k);
    this.shell.set(snail.slot, jointMatrix(mRoot, vTmp, 0.05 * k, 0, 0, mOut));
    const ext = Math.max(0.05, snail.extend * (1 - k));
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      vTmp.set(SNAIL_STALK_BASE.x * side, SNAIL_STALK_BASE.y * (1 - 0.4 * k), SNAIL_STALK_BASE.z * (1 - 0.6 * k));
      const wobble = Math.sin((time + snail.seed) * 1.3 + s) * 0.15;
      this.stalks.set(snail.stalkSlots[s], jointMatrix(mRoot, vTmp, 0.3 + wobble, 0, -side * (0.3 + wobble * 0.5), mOut, 1, ext, 1));
    }
  }

  private hide(snail: Snail): void {
    this.body.hide(snail.slot);
    this.shell.hide(snail.slot);
    this.stalks.hide(snail.stalkSlots[0]);
    this.stalks.hide(snail.stalkSlots[1]);
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const snail of this.snails) {
      if (snail.visible && snail.walker.position.distanceTo(position) < radius + 2) snail.safe = 3;
    }
  }
}

// ---------------------------------------------------------------------------
// Tatuzinhos

type PillState = 'walk' | 'curl' | 'rolled' | 'uncurl' | 'gone';

interface PillBug {
  slot: number;
  walker: GroundWalker;
  state: PillState;
  scale: number;
  tint: THREE.Color;
  gait: number;
  /** 0 = andando esticado, 1 = bolinha. */
  curl: number;
  timer: number;
  readonly velocity: THREE.Vector3;
  spin: number;
  rollYaw: number;
  placed: boolean;
}

const PillTints = [new THREE.Color(1, 1, 1), new THREE.Color(1.12, 1.0, 0.88), new THREE.Color(0.86, 0.92, 1.08), new THREE.Color(0.78, 0.78, 0.82)];

/**
 * Tatuzinhos (tatu-bola): andam com as sete patinhas; se o besouro ou a bola
 * chegam perto, viram bolinha (e rolam ladeira abaixo, ou quando a bola
 * encosta). Enrolado e com a bola grande o bastante, gruda nela (Katamari!).
 */
export class PillBugs implements Species {
  private readonly walkA: InstancedPart;
  private readonly walkB: InstancedPart;
  private readonly ball: InstancedPart;
  private readonly ballGeometry: THREE.BufferGeometry;
  private readonly bugs: PillBug[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.ballGeometry = pillBugBall();
    this.walkA = new InstancedPart(pillBugWalk(0), mats.body, count, { name: 'pillbug-a', tinted: true });
    this.walkB = new InstancedPart(pillBugWalk(1), mats.body, count, { name: 'pillbug-b', tinted: true });
    this.ball = new InstancedPart(this.ballGeometry, mats.body, count, { name: 'pillbug-ball', tinted: true });
    parent.add(this.walkA.mesh, this.walkB.mesh, this.ball.mesh);
    for (let i = 0; i < count; i++) {
      const slot = this.walkA.allocate();
      this.walkB.allocate();
      this.ball.allocate();
      const tint = PillTints[i % PillTints.length];
      this.walkA.setColor(slot, tint);
      this.walkB.setColor(slot, tint);
      this.ball.setColor(slot, tint);
      this.bugs.push({
        slot,
        walker: new GroundWalker(2.5),
        state: 'walk',
        scale: ctx.rng.range(0.95, 1.25),
        tint,
        gait: 0,
        curl: 0,
        timer: 0,
        velocity: new THREE.Vector3(),
        spin: 0,
        rollYaw: 0,
        placed: false,
      });
    }
  }

  update(dt: number, ctx: CritterContext): void {
    for (const bug of this.bugs) {
      const w = bug.walker;
      if (bug.state === 'gone') {
        bug.timer -= dt;
        this.hide(bug);
        if (bug.timer <= 0) {
          bug.placed = false;
          bug.state = 'walk';
          bug.curl = 0;
        }
        continue;
      }
      const far = Math.hypot(w.position.x - ctx.world.player.x, w.position.z - ctx.world.player.z) > 40;
      if (!bug.placed || (far && bug.state === 'walk')) {
        bug.placed = w.relocate(ctx, bug.placed ? 18 : 5, bug.placed ? 30 : 22, true);
        if (!bug.placed) {
          this.hide(bug);
          continue;
        }
      }
      const danger = threatAt(ctx, w.position.x, w.position.y, w.position.z, vAway);
      // Fedor irresistível: em vez de enrolar de medo, vem andando até a bola (e enrola quando ela encosta).
      const hurry = attraction(ctx, w.position.x, w.position.z, vHip);
      switch (bug.state) {
        case 'walk':
          if (hurry > 0) {
            w.flee(vHip, 1);
            w.step(dt, ctx, 0.45 * hurry, 6);
          } else {
            if (danger < 1.4) this.curlUp(bug, ctx);
            w.step(dt, ctx, 0.32, 4);
          }
          bug.gait += w.moved * 45;
          if (shoveFromBall(ctx, w.position, 0.15, 0.2)) this.curlUp(bug, ctx);
          break;
        case 'curl':
          bug.curl = Math.min(1, bug.curl + dt / 0.22);
          if (bug.curl >= 1) bug.state = 'rolled';
          break;
        case 'rolled':
          this.roll(bug, dt, ctx);
          bug.timer -= dt;
          if (danger < 2 && hurry === 0) bug.timer = Math.max(bug.timer, 2.5);
          if (bug.timer <= 0) bug.state = 'uncurl';
          break;
        case 'uncurl':
          bug.curl = Math.max(0, bug.curl - dt / 0.35);
          if (bug.curl <= 0) {
            bug.state = 'walk';
            w.yaw = bug.rollYaw;
            w.home.copy(w.position);
            w.pickWanderTarget(ctx);
          }
          break;
      }
      this.draw(bug);
    }
    this.walkA.flush();
    this.walkB.flush();
    this.ball.flush();
  }

  private curlUp(bug: PillBug, ctx: CritterContext): void {
    if (bug.state !== 'walk' && bug.state !== 'uncurl') return;
    bug.state = 'curl';
    bug.timer = ctx.rng.range(4, 9);
    bug.velocity.set(0, 0, 0);
    bug.rollYaw = bug.walker.yaw;
  }

  /** Bolinha rolando: desce ladeira, leva empurrão da bola de bosta, freia no atrito. */
  private roll(bug: PillBug, dt: number, ctx: CritterContext): void {
    const pos = bug.walker.position;
    const r = PILLBUG_BALL_RADIUS * bug.scale;
    const n = terrainNormal(pos.x, pos.z, vTmp);
    bug.velocity.x += n.x * 7 * dt;
    bug.velocity.z += n.z * 7 * dt;
    const bx = pos.x;
    const bz = pos.z;
    if (shoveFromBall(ctx, pos, r, r * 2)) {
      const dx = pos.x - bx;
      const dz = pos.z - bz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        bug.velocity.x += (dx / d) * 2.2;
        bug.velocity.z += (dz / d) * 2.2;
      }
    }
    const friction = Math.exp(-1.8 * dt);
    bug.velocity.multiplyScalar(friction);
    const nx = pos.x + bug.velocity.x * dt;
    const nz = pos.z + bug.velocity.z * dt;
    if (ctx.isGroundFree(nx, nz) && Math.hypot(nx, nz) < PLAY_RADIUS - 1) {
      pos.x = nx;
      pos.z = nz;
    } else {
      bug.velocity.multiplyScalar(-0.4);
    }
    pos.y = terrainHeight(pos.x, pos.z);
    const speed = Math.hypot(bug.velocity.x, bug.velocity.z);
    if (speed > 0.05) bug.rollYaw = dampAngle(bug.rollYaw, Math.atan2(bug.velocity.x, bug.velocity.z), 10, dt);
    bug.spin += (speed / r) * dt;
  }

  private draw(bug: PillBug): void {
    const w = bug.walker;
    const k = bug.curl;
    if (k < 0.65) {
      w.matrix(mRoot, bug.scale, 0);
      vTmp.set(0, 0, 0);
      const m = jointMatrix(mRoot, vTmp, -k * 0.6, 0, 0, mOut, 1 - k * 0.3, 1 + k * 0.5, 1 - k * 0.7);
      const pose = Math.floor(bug.gait) % 2 === 0;
      (pose ? this.walkA : this.walkB).set(bug.slot, m);
      (pose ? this.walkB : this.walkA).hide(bug.slot);
    } else {
      this.walkA.hide(bug.slot);
      this.walkB.hide(bug.slot);
    }
    const ballScale = smoothstep(0.35, 1, k);
    if (ballScale > 0.01) {
      const r = PILLBUG_BALL_RADIUS * bug.scale * ballScale;
      const saved = w.yaw;
      w.yaw = bug.rollYaw;
      w.matrix(mRoot, bug.scale * ballScale, r, 0, UP);
      w.yaw = saved;
      vTmp.set(0, 0, 0);
      this.ball.set(bug.slot, jointMatrix(mRoot, vTmp, bug.spin, 0, 0, mOut));
    } else {
      this.ball.hide(bug.slot);
    }
  }

  private hide(bug: PillBug): void {
    this.walkA.hide(bug.slot);
    this.walkB.hide(bug.slot);
    this.ball.hide(bug.slot);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const bug of this.bugs) {
      if (bug.state !== 'gone' && bug.walker.position.distanceTo(position) < radius + 2) this.curlUp(bug, ctx);
    }
  }

  /** Tatuzinho enrolado encostando numa bola grande o bastante: sai do jogo dos bichos e vai grudar nela. */
  collect(ballCenter: THREE.Vector3, ballRadius: number): CollectedCritter | null {
    if (ballRadius < 0.6) return null;
    for (const bug of this.bugs) {
      if (bug.state !== 'rolled' && !(bug.state === 'curl' && bug.curl > 0.8)) continue;
      const r = PILLBUG_BALL_RADIUS * bug.scale;
      const pos = bug.walker.position;
      vTmp.set(pos.x, pos.y + r, pos.z);
      if (vTmp.distanceTo(ballCenter) > ballRadius + r * 0.9) continue;
      const mesh = new THREE.Mesh(this.ballGeometry, critterMaterials().body);
      mesh.position.copy(vTmp);
      mesh.quaternion.setFromAxisAngle(UP, bug.rollYaw).multiply(new THREE.Quaternion().setFromAxisAngle(vAway.set(1, 0, 0), bug.spin));
      mesh.scale.setScalar(bug.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      bug.state = 'gone';
      bug.timer = 25;
      this.hide(bug);
      return { id: 'pillbug', object: mesh, size: clamp(r * 2.6, 0.3, 0.45), color: new THREE.Color('#7d8594').multiply(bug.tint) };
    }
    return null;
  }
}
