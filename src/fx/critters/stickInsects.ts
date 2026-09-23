import * as THREE from 'three';
import { clamp, smoothstep } from '../../utils/math';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { bakePose } from './models';
import { STICK_BODY_Y, STICK_FOOT_ANGLE, STICK_FOOT_REACH, STICK_LEGS, STICK_STAND_LIFT, stickInsectBody, stickInsectLeg } from './leafModels';
import { attraction, ballTakes, collectedMesh, shoveFromBall, threatAt } from './common';
import { jointMatrix } from './flyers';
import { GroundWalker } from './walker';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Bicho-pau: raro, e quase ninguém vê. Fica deitado no chão igualzinho a um
 * graveto (patas da frente esticadas junto das antenas, as outras coladas no
 * corpo). Quando o besouro chega perto, "acorda": fica de pé nas patas
 * compridas e sai andando devagar, balançando para a frente e para trás — o
 * balanço de folha ao vento que o bicho-pau de verdade faz para não parecer
 * bicho. Depois de um tempo sossegado, deita de novo.
 */

type StickState = 'rest' | 'rise' | 'walk' | 'settle';

interface StickInsect {
  slot: number;
  legSlots: number[];
  walker: GroundWalker;
  state: StickState;
  scale: number;
  /** 0 = deitado (graveto), 1 = de pé. */
  stand: number;
  gait: number;
  /** Segundos de sossego até deitar de novo. */
  calm: number;
  placed: boolean;
  /** Pego pela bola: some por um tempo. */
  gone: number;
  seed: number;
}

/** Tamanho efetivo do bicho-pau grudado (pede bola grande). */
const STICK_SIZE = 1.4;
/** Besouro mais perto que isso acorda o bicho-pau. */
const WAKE_DISTANCE = 2.5;

/** Ângulo de cada pata no plano (para a frente +, para trás −), deitado e de pé. */
const REST_YAW = [1.42, -1.38, -1.45];
const STAND_YAW = [0.62, -0.08, -0.72];

const mRoot = new THREE.Matrix4();
const mBody = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vHip = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vTmp = new THREE.Vector3();

export class StickInsects implements Species {
  private readonly body: InstancedPart;
  private readonly legs: InstancedPart;
  private readonly bugs: StickInsect[] = [];
  private stuck: THREE.BufferGeometry | null = null;

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.body = new InstancedPart(stickInsectBody(), mats.body, count, { name: 'stick-insect-body' });
    this.legs = new InstancedPart(stickInsectLeg(), mats.body, count * 6, { name: 'stick-insect-legs', skipAO: true });
    parent.add(this.body.mesh, this.legs.mesh);
    for (let i = 0; i < count; i++) {
      this.bugs.push({
        slot: this.body.allocate(),
        legSlots: Array.from({ length: 6 }, () => this.legs.allocate()),
        walker: new GroundWalker(2.5),
        state: 'rest',
        scale: ctx.rng.range(0.9, 1.1),
        stand: 0,
        gait: 0,
        calm: 0,
        placed: false,
        gone: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  update(dt: number, ctx: CritterContext): void {
    const player = ctx.world.player;
    for (const bug of this.bugs) {
      const w = bug.walker;
      if (bug.gone > 0) {
        bug.gone -= dt;
        this.hide(bug);
        if (bug.gone > 0) continue;
        bug.placed = false;
      }
      if (!bug.placed || (bug.state === 'rest' && Math.hypot(w.position.x - player.x, w.position.z - player.z) > 40)) {
        // Raro de propósito: aparece longe, fora da vista, e é fácil passar batido.
        bug.placed = w.relocate(ctx, bug.placed ? 16 : 8, bug.placed ? 30 : 26, true);
        bug.state = 'rest';
        bug.stand = 0;
        if (!bug.placed) {
          this.hide(bug);
          continue;
        }
      }
      const beetle = Math.hypot(w.position.x - player.x, w.position.z - player.z);
      const danger = threatAt(ctx, w.position.x, w.position.y, w.position.z, vAway);
      const hurry = attraction(ctx, w.position.x, w.position.z, vTmp);
      const alarmed = beetle < WAKE_DISTANCE || danger < 1.2 || hurry > 0;
      switch (bug.state) {
        case 'rest':
          if (alarmed) bug.state = 'rise';
          break;
        case 'rise':
          bug.stand = Math.min(1, bug.stand + dt / 0.9);
          if (bug.stand >= 1) {
            bug.state = 'walk';
            bug.calm = 10;
          }
          break;
        case 'walk':
          bug.calm = alarmed ? 10 : bug.calm - dt;
          if (hurry > 0) w.flee(vTmp, 1);
          else if (danger < 2.5) w.flee(vAway, 2);
          w.step(dt, ctx, 0.2 * (hurry > 0 ? hurry : 1) * bug.scale, 1.5);
          bug.gait += w.moved * 9;
          if (bug.calm <= 0) bug.state = 'settle';
          break;
        case 'settle':
          bug.stand = Math.max(0, bug.stand - dt / 1.4);
          if (alarmed) bug.state = 'rise';
          else if (bug.stand <= 0) bug.state = 'rest';
          break;
      }
      shoveFromBall(ctx, w.position, 0.3, 0.2);
      this.draw(bug, ctx.time);
    }
    this.body.flush();
    this.legs.flush();
  }

  private draw(bug: StickInsect, time: number): void {
    const w = bug.walker;
    const k = smoothstep(0, 1, bug.stand);
    const t = time + bug.seed;
    // O balanço de folha ao vento: para a frente e para trás, e de lado, sem sair do lugar.
    const walking = bug.state === 'walk';
    const rock = walking ? Math.sin(t * 2.3) : Math.sin(t * 0.9) * 0.15;
    w.matrix(mRoot, bug.scale, k * STICK_STAND_LIFT);
    jointMatrix(mRoot, vHip.set(Math.sin(t * 1.7) * 0.03 * k, 0, rock * 0.05 * (0.3 + k)), 0.02 * rock * k, 0, 0.06 * Math.sin(t * 1.7) * k, mBody);
    this.body.set(bug.slot, mBody);
    const lift = k * STICK_STAND_LIFT + STICK_BODY_Y;
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1;
      const pair = i % 3;
      const leg = STICK_LEGS[pair];
      const length = leg.length;
      vHip.set(leg.hip.x * side, leg.hip.y, leg.hip.z);
      // Marcha em tripé, lenta; a pata que avança sobe um pouco.
      const group = (pair + (side > 0 ? 0 : 1)) % 2;
      const phase = bug.gait + group * Math.PI;
      const swing = walking ? Math.sin(phase) * 0.22 : 0;
      const step = walking ? Math.max(0, Math.cos(phase)) * 0.18 : 0;
      const yaw = THREE.MathUtils.lerp(REST_YAW[pair], STAND_YAW[pair], k) + swing;
      // De pé: inclina a pata para baixo até o pé encostar no chão (o corpo subiu `lift`).
      const drop = Math.asin(clamp(lift / (length * STICK_FOOT_REACH), 0, 1)) + STICK_FOOT_ANGLE;
      const rz = THREE.MathUtils.lerp(0.08, -drop, k) + step;
      const ry = side > 0 ? -yaw : Math.PI + yaw;
      this.legs.set(bug.legSlots[i], jointMatrix(mBody, vHip, 0, ry, rz, mOut, length, length, length));
    }
  }

  private hide(bug: StickInsect): void {
    this.body.hide(bug.slot);
    for (const s of bug.legSlots) this.legs.hide(s);
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const bug of this.bugs) {
      if (bug.gone <= 0 && bug.placed && bug.state === 'rest' && bug.walker.position.distanceTo(position) < radius + 2) bug.state = 'rise';
    }
  }

  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    if (radius < STICK_SIZE * 1.6) return null;
    for (const bug of this.bugs) {
      if (bug.gone > 0 || !bug.placed) continue;
      const w = bug.walker;
      w.matrix(mRoot, bug.scale, bug.stand * STICK_STAND_LIFT);
      // Encostou na cabeça, no meio ou no rabo.
      let touching = false;
      for (let z = -0.8; z <= 0.8 && !touching; z += 0.8) {
        vTmp.set(0, STICK_BODY_Y, z).applyMatrix4(mRoot);
        touching = ballTakes(center, radius, STICK_SIZE, vTmp.x, vTmp.y, vTmp.z, 0.08 * bug.scale);
      }
      if (!touching) continue;
      bug.gone = 60;
      this.hide(bug);
      w.matrix(mRoot, bug.scale);
      return { id: 'stickInsect', object: collectedMesh(this.stuckPose(), critterMaterials().body, mRoot), size: STICK_SIZE, color: new THREE.Color('#8f7a4a') };
    }
    return null;
  }

  /** Bicho-pau deitado, patas coladas no corpo (o "graveto"), numa geometria só. */
  private stuckPose(): THREE.BufferGeometry {
    if (this.stuck) return this.stuck;
    const identity = new THREE.Matrix4();
    const leg = this.legs.mesh.geometry;
    const parts: Array<readonly [THREE.BufferGeometry, THREE.Matrix4]> = [[this.body.mesh.geometry, identity]];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1;
      const { hip, length } = STICK_LEGS[i % 3];
      const yaw = REST_YAW[i % 3];
      parts.push([leg, jointMatrix(identity, new THREE.Vector3(hip.x * side, hip.y, hip.z), 0, side > 0 ? -yaw : Math.PI + yaw, 0.08, new THREE.Matrix4(), length, length, length)]);
    }
    this.stuck = bakePose(parts);
    return this.stuck;
  }
}
