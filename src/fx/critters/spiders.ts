import * as THREE from 'three';
import { clamp, damp } from '../../utils/math';
import { BURROW, terrainHeight } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import {
  SPIDER_HIP_X,
  SPIDER_LEGS,
  SPIDER_RUN_HEIGHT,
  dewDrop,
  silkThread,
  spiderBody,
  spiderKnee,
  spiderLegSegment,
  webPattern,
  webQuad,
  webTuft,
  type WebPattern,
} from './webModels';
import { collectedMesh, insideBasin, spotAlive, threatAt } from './common';
import { GroundWalker } from './walker';
import type { CritterContext, Species } from './types';

/**
 * Teias orbiculares com a aranha-de-jardim (Argiope) no meio, de cabeça para
 * baixo e com as patas no "X". Cada teia fica em pé entre duas flores
 * vizinhas (os fios de ancoragem vão até as cabeças delas), com orvalho
 * brilhando nos fios. Quando o besouro chega perto, a aranha sacode a teia (a
 * Argiope faz isso de verdade). Se a bola atravessa, a teia rasga: um chumaço
 * de seda gruda na bola e a aranha desce pelo fio e foge. Arrancar uma das
 * flores derruba a teia (sem chumaço). Na rodada nova, tudo volta.
 */

/** Gotinhas de orvalho por teia. */
const DEW = 26;
/** Fios por teia: âncora A, âncora B, chão e o da descida da aranha. */
const THREADS = 4;
const TUFT_SIZE = 0.3;
const SEEN_RANGE = 45;
/** Patas (8) de cada aranha correndo. */
const LEG_COUNT = SPIDER_LEGS.length * 2;
/**
 * Passada: quanto o corpo anda num ciclo inteiro da marcha. No apoio (meio
 * ciclo) o pé recua um quarto disso de cada lado do ponto de descanso, na
 * mesma velocidade do corpo: fica fincado no chão, sem patinar.
 */
const STRIDE = 0.28;
/** Até onde o pé alcança, em fração do comprimento da pata; coxa e canela, idem. */
const FOOT_REACH = 0.84;
const FEMUR = 0.46;
const SHIN = 0.6;
/** Altura que o pé sobe no meio do passo. */
const STEP_LIFT = 0.07;

type SpiderState = 'web' | 'drop' | 'run' | 'hide' | 'gone';

interface Web {
  readonly spotA: THREE.Vector3;
  readonly spotB: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly normal: THREE.Vector3;
  radius: number;
  /** Matriz do disco (sem o tremor). */
  readonly matrix: THREE.Matrix4;
  /** Orvalho em coordenadas de mundo (x, y, z, raio) — posições fixas, só o tremor mexe. */
  readonly dew: Float32Array;
  readonly anchors: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  alive: boolean;
  drawn: boolean;
  /** 0..1: a aranha sacudindo a teia. */
  wobble: number;
  slot: number;
  spider: SpiderState;
  walker: GroundWalker;
  /** 0..1: o quanto as patas estão marchando (some quando ela para e o pé assenta). */
  stride: number;
  /** Primeira vaga das patas desta aranha (coxas, canelas e joelhos usam a mesma). */
  legSlot: number;
  /** Onde a aranha fica na teia (mundo) e a orientação dela lá (dorso para um lado, cabeça para baixo). */
  readonly rest: THREE.Matrix4;
  timer: number;
  gait: number;
  steer: number;
  readonly drop: THREE.Vector3;
}

const mOut = new THREE.Matrix4();
const mTmp = new THREE.Matrix4();
const qTmp = new THREE.Quaternion();
const vTmp = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vScale = new THREE.Vector3();
const vHip = new THREE.Vector3();
const vKnee = new THREE.Vector3();
const vFoot = new THREE.Vector3();
const vReach = new THREE.Vector3();
const vBend = new THREE.Vector3();
const mBody = new THREE.Matrix4();
const mLocal = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class Spiders implements Species {
  private readonly webPart: InstancedPart;
  private readonly dewPart: InstancedPart;
  private readonly threads: InstancedPart;
  private readonly spiderWeb: InstancedPart;
  private readonly spiderRun: InstancedPart;
  private readonly femurs: InstancedPart;
  private readonly shins: InstancedPart;
  private readonly knees: InstancedPart;
  private readonly parts: readonly InstancedPart[];
  private readonly pattern: WebPattern;
  private readonly webs: Web[] = [];
  private tuft: THREE.BufferGeometry | null = null;
  private built = false;

  constructor(
    private readonly count: number,
    parent: THREE.Group,
  ) {
    this.pattern = webPattern();
    const silk = new THREE.MeshBasicMaterial({
      map: this.pattern.texture,
      // Um tiquinho acima de 1: os fios pegam o bloom contra o sol.
      color: new THREE.Color(1.15, 1.15, 1.2),
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const thread = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 1.07, 1.12), transparent: true, opacity: 0.55, depthWrite: false });
    const water = new THREE.MeshPhysicalMaterial({ color: '#f4fbff', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#8aa0b0', emissiveIntensity: 0.35 });
    const mats = critterMaterials();
    this.webPart = new InstancedPart(webQuad(), silk, count, { name: 'spider-webs', castShadow: false, skipAO: true });
    this.dewPart = new InstancedPart(dewDrop(), water, count * DEW, { name: 'web-dew', castShadow: false, skipAO: true });
    this.threads = new InstancedPart(silkThread(), thread, count * THREADS, { name: 'web-threads', castShadow: false, skipAO: true });
    this.spiderWeb = new InstancedPart(spiderBody('web'), mats.body, count, { name: 'spider-web' });
    this.spiderRun = new InstancedPart(spiderBody('run'), mats.body, count, { name: 'spider-run' });
    this.femurs = new InstancedPart(spiderLegSegment('femur'), mats.body, count * LEG_COUNT, { name: 'spider-femurs', skipAO: true });
    this.shins = new InstancedPart(spiderLegSegment('shin'), mats.body, count * LEG_COUNT, { name: 'spider-shins', skipAO: true });
    this.knees = new InstancedPart(spiderKnee(), mats.body, count * LEG_COUNT, { name: 'spider-knees', castShadow: false, skipAO: true });
    this.parts = [this.webPart, this.dewPart, this.threads, this.spiderWeb, this.spiderRun, this.femurs, this.shins, this.knees];
    for (const part of this.parts) {
      part.mesh.receiveShadow = part !== this.webPart && part !== this.threads;
      parent.add(part.mesh);
    }
    this.webPart.mesh.renderOrder = 3;
  }

  /** Acha pares de flores vizinhas (2 a 4 unidades) e arma as teias entre elas. Roda no primeiro quadro (precisa das poças). */
  private build(ctx: CritterContext): void {
    this.built = true;
    const spots = ctx.spots.slice();
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng.next() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < spots.length && this.webs.length < this.count; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        if (this.tryWeb(ctx, spots[i], spots[j])) break;
      }
    }
  }

  private tryWeb(ctx: CritterContext, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.4 || d > 4.2 || Math.abs(a.y - b.y) > 2) return false;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    // Folga para a cabeça da flor (ou o chapéu do cogumelo) não entrar no disco.
    const radius = clamp(d / 2 - 0.75, 0.75, 1.4);
    if (Math.hypot(mx, mz) < 6 || Math.hypot(mx - BURROW.x, mz - BURROW.z) < BURROW.radius * 3 || insideBasin(ctx, mx, mz, radius + 0.5)) return false;
    const ax = dx / d;
    const az = dz / d;
    for (const k of [-0.7, 0, 0.7]) if (!ctx.isGroundFree(mx + ax * radius * k, mz + az * radius * k)) return false;
    const center = new THREE.Vector3(mx, terrainHeight(mx, mz) + radius + 0.15, mz);
    // As flores precisam segurar a teia de cima (ou do lado), não de baixo.
    if (Math.min(a.y, b.y) < center.y - radius * 0.2) return false;
    if (this.webs.some((w) => w.center.distanceTo(center) < 7)) return false;

    const across = new THREE.Vector3(ax, 0, az);
    const normal = new THREE.Vector3(-az, 0, ax);
    // Disco: base (através, cima, normal), girado no próprio plano e às vezes espelhado (cada teia é diferente).
    const spin = ctx.rng.next() * Math.PI * 2;
    const mirror = ctx.rng.next() < 0.5 ? -1 : 1;
    mTmp.makeBasis(across, Y_AXIS, normal);
    qTmp.setFromRotationMatrix(mTmp).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
    const matrix = new THREE.Matrix4().compose(center, qTmp, new THREE.Vector3(radius * mirror, radius, radius));

    const dew = new Float32Array(DEW * 4);
    const pattern = this.pattern.dew;
    for (let k = 0; k < DEW; k++) {
      const p = Math.floor(ctx.rng.next() * (pattern.length / 2)) * 2;
      vTmp.set(pattern[p], pattern[p + 1], 0).applyMatrix4(matrix).addScaledVector(normal, ctx.rng.range(-0.008, 0.008));
      dew.set([vTmp.x, vTmp.y, vTmp.z, ctx.rng.range(0.012, 0.024)], k * 4);
    }
    // Fios: da borda do disco até cada flor, e da borda de baixo até o chão.
    const edgeToward = (spot: THREE.Vector3) => {
      const toward = spot.clone().sub(center);
      toward.addScaledVector(normal, -toward.dot(normal)).normalize();
      return center.clone().addScaledVector(toward, radius * 0.92);
    };
    const bottom = center.clone().addScaledVector(Y_AXIS, -radius * 0.92);
    const anchors: Web['anchors'] = [edgeToward(a), a, edgeToward(b), b, bottom, new THREE.Vector3(bottom.x, terrainHeight(bottom.x, bottom.z), bottom.z)];

    // Aranha no meio, do lado de cá da teia: dorso para a normal, cabeça para baixo.
    const side = new THREE.Vector3().crossVectors(normal, DOWN);
    const rest = new THREE.Matrix4().makeBasis(side, normal, DOWN).setPosition(center.clone().addScaledVector(normal, 0.035));

    const slot = this.webPart.allocate();
    for (let k = 0; k < DEW; k++) this.dewPart.allocate();
    for (let k = 0; k < THREADS; k++) this.threads.allocate();
    this.spiderWeb.allocate();
    this.spiderRun.allocate();
    const legSlot = this.femurs.allocate();
    this.shins.allocate();
    this.knees.allocate();
    for (let k = 1; k < LEG_COUNT; k++) {
      this.femurs.allocate();
      this.shins.allocate();
      this.knees.allocate();
    }
    this.webs.push({
      spotA: a,
      spotB: b,
      center,
      normal,
      radius,
      matrix,
      dew,
      anchors,
      alive: true,
      drawn: false,
      wobble: 0,
      slot,
      spider: 'web',
      walker: new GroundWalker(1.5),
      stride: 0,
      legSlot,
      rest,
      timer: 0,
      gait: 0,
      steer: 0,
      drop: new THREE.Vector3(),
    });
    return true;
  }

  update(dt: number, ctx: CritterContext): void {
    if (!this.built) this.build(ctx);
    const w = ctx.world;
    const t = ctx.time;
    for (const web of this.webs) {
      const near = Math.hypot(web.center.x - w.player.x, web.center.z - w.player.z) < SEEN_RANGE;
      if (web.alive) {
        if (!spotAlive(ctx, web.spotA) || !spotAlive(ctx, web.spotB)) this.fall(web);
        else if (this.torn(web, w.ballPosition, w.ballRadius)) this.tear(web, ctx);
      }
      if (web.alive) {
        // A aranha sacode a teia quando o besouro (ou a bola) chega perto.
        const close = Math.min(web.center.distanceTo(w.player) - 0.4, web.center.distanceTo(w.ballPosition) - w.ballRadius);
        web.wobble = close < web.radius + 1.2 ? 1 : Math.max(0, web.wobble - dt * 0.8);
      }
      const show = web.alive && near;
      if (show) {
        if (!web.drawn || web.wobble > 0) this.writeWeb(web, t);
        else this.keepWeb();
      } else if (web.drawn) {
        this.hideWeb(web);
      }
      this.updateSpider(web, dt, ctx, near);
    }
    for (const part of this.parts) part.flush();
  }

  /** A bola cruzou o disco da teia? (esfera contra disco) */
  private torn(web: Web, ball: THREE.Vector3, r: number): boolean {
    vTmp.copy(ball).sub(web.center);
    const along = vTmp.dot(web.normal);
    if (Math.abs(along) >= r) return false;
    const section = Math.sqrt(r * r - along * along);
    vTmp.addScaledVector(web.normal, -along);
    return vTmp.length() < web.radius * 0.8 + section * 0.8;
  }

  /** Rasgou: chumaço de seda para a bola, estalinho e a aranha foge. */
  private tear(web: Web, ctx: CritterContext): void {
    const w = ctx.world;
    // Onde a bola bateu na teia (o ponto do disco mais perto do centro da bola).
    vTmp.copy(w.ballPosition).sub(web.center);
    vTmp.addScaledVector(web.normal, -vTmp.dot(web.normal));
    if (vTmp.length() > web.radius * 0.8) vTmp.setLength(web.radius * 0.8);
    vA.copy(web.center).add(vTmp);
    this.tuft ??= webTuft();
    qTmp.setFromAxisAngle(Y_AXIS, ctx.rng.next() * Math.PI * 2);
    const object = collectedMesh(this.tuft, critterMaterials().fuzzy, mOut.compose(vA, qTmp, vScale.setScalar(1)));
    ctx.sounds.call('webTear', vA, web.radius);
    ctx.emit({ type: 'webTorn', item: { id: 'web', object, size: TUFT_SIZE, color: new THREE.Color('#dfe7f2') } });
    this.fall(web);
  }

  /** A teia some (rasgada ou sem uma das flores); a aranha desce pelo fio. */
  private fall(web: Web): void {
    web.alive = false;
    if (web.spider === 'web') {
      web.spider = 'drop';
      web.timer = 0;
      web.drop.setFromMatrixPosition(web.rest);
    }
  }

  private writeWeb(web: Web, t: number): void {
    web.drawn = true;
    const shake = Math.sin(t * 17) * 0.035 * web.wobble;
    vTmp.copy(web.normal).multiplyScalar(shake);
    mOut.copy(web.matrix);
    mOut.elements[12] += vTmp.x;
    mOut.elements[13] += vTmp.y;
    mOut.elements[14] += vTmp.z;
    this.webPart.set(web.slot, mOut);
    for (let k = 0; k < DEW; k++) {
      const o = k * 4;
      vA.set(web.dew[o] + vTmp.x, web.dew[o + 1] + vTmp.y, web.dew[o + 2] + vTmp.z);
      this.dewPart.set(web.slot * DEW + k, mOut.compose(vA, qTmp.identity(), vScale.setScalar(web.dew[o + 3])));
    }
    for (let k = 0; k < 3; k++) this.threads.set(web.slot * THREADS + k, threadMatrix(web.anchors[k * 2], web.anchors[k * 2 + 1], mOut));
  }

  /** Teia parada: as matrizes escritas antes continuam valendo. */
  private keepWeb(): void {
    this.webPart.keep();
    for (let k = 0; k < DEW; k++) this.dewPart.keep();
    for (let k = 0; k < 3; k++) this.threads.keep();
  }

  private hideWeb(web: Web): void {
    web.drawn = false;
    this.webPart.hide(web.slot);
    for (let k = 0; k < DEW; k++) this.dewPart.hide(web.slot * DEW + k);
    for (let k = 0; k < 3; k++) this.threads.hide(web.slot * THREADS + k);
  }

  private updateSpider(web: Web, dt: number, ctx: CritterContext, near: boolean): void {
    const slot = web.slot;
    const dropSlot = slot * THREADS + 3;
    this.spiderRun.hide(slot);
    this.hideLegs(web);
    this.threads.hide(dropSlot);
    if (web.spider === 'web') {
      if (web.alive && near) {
        mOut.copy(web.rest);
        mOut.elements[12] += web.normal.x * Math.sin(ctx.time * 17) * 0.035 * web.wobble;
        mOut.elements[14] += web.normal.z * Math.sin(ctx.time * 17) * 0.035 * web.wobble;
        this.spiderWeb.set(slot, mOut);
      } else this.spiderWeb.hide(slot);
      return;
    }
    this.spiderWeb.hide(slot);
    if (web.spider === 'gone') return;
    if (web.spider === 'drop') {
      // Desce de cabeça pelo fio até o chão.
      web.timer = Math.min(1, web.timer + dt / 0.9);
      const k = web.timer * web.timer;
      const top = vA.setFromMatrixPosition(web.rest);
      const ground = terrainHeight(top.x, top.z) + 0.12;
      web.drop.set(top.x, top.y + (ground - top.y) * k, top.z);
      mOut.copy(web.rest).setPosition(web.drop);
      this.spiderWeb.set(slot, mOut);
      // O fio vai junto, um palmo acima dela.
      vB.copy(web.drop).setY(Math.min(top.y, web.drop.y + 0.7));
      this.threads.set(dropSlot, threadMatrix(web.drop, vB, mOut));
      if (web.timer >= 1) {
        threatAt(ctx, web.drop.x, web.drop.y, web.drop.z, vAway);
        web.walker.placeAt(web.drop, Math.atan2(vAway.x, vAway.z), 0);
        web.spider = 'run';
        web.timer = ctx.rng.range(2.5, 4);
        web.steer = 0;
        web.gait = 0;
        web.stride = 0;
      }
      return;
    }
    const walker = web.walker;
    let sink = 0;
    if (web.spider === 'run') {
      web.timer -= dt;
      web.steer -= dt;
      if (web.steer <= 0) {
        web.steer = 0.3;
        threatAt(ctx, walker.position.x, walker.position.y, walker.position.z, vAway);
        walker.flee(vAway, 1.5);
      }
      walker.step(dt, ctx, 1.1, 8);
      web.gait += walker.moved / STRIDE;
      web.stride = damp(web.stride, walker.moved > 0 ? 1 : 0, 10, dt);
      if (web.timer <= 0) {
        web.spider = 'hide';
        web.timer = 0;
      }
    } else {
      // Some no capim.
      web.timer = Math.min(1, web.timer + dt / 0.5);
      sink = web.timer * 0.16;
      web.stride = damp(web.stride, 0, 10, dt);
      if (web.timer >= 1) {
        web.spider = 'gone';
        return;
      }
    }
    this.drawRunner(web, sink);
  }

  /**
   * Aranha correndo: corpo e as 8 patas articuladas. Marcha alternada de
   * quatro em quatro (I e III de um lado com II e IV do outro); no apoio o pé
   * fica parado no chão enquanto o corpo passa, no balanço ele sobe e vai
   * para a frente. O joelho sai de uma IK de dois ossos, sempre para cima.
   */
  private drawRunner(web: Web, sink: number): void {
    const cycle = web.gait * Math.PI * 2;
    const k = web.stride;
    // O corpo desce um tiquinho a cada troca de apoio (duas por ciclo) e rebola de leve.
    const bob = -Math.abs(Math.sin(cycle)) * 0.012 * k;
    web.walker.matrix(mBody, 1, bob - sink);
    // O rebolado é só do corpo: as patas ficam no quadro do chão (os pés não afundam).
    this.spiderRun.set(web.slot, mOut.multiplyMatrices(mBody, mLocal.makeRotationZ(Math.sin(cycle) * 0.05 * k)));
    const height = SPIDER_RUN_HEIGHT;
    let slot = web.legSlot;
    SPIDER_LEGS.forEach((leg, pair) => {
      const angle = THREE.MathUtils.degToRad(leg.run);
      for (const side of [1, -1]) {
        const group = (pair + (side > 0 ? 0 : 1)) % 2;
        const t = (web.gait + group * 0.5) % 1;
        // Apoio (primeira metade): o pé recua de +1/4 a -1/4 da passada. Balanço: sobe e volta para a frente.
        let slide: number;
        let lift = 0;
        if (t < 0.5) slide = 1 - 4 * t;
        else {
          const u = (t - 0.5) * 2;
          slide = -1 + 2 * u * u * (3 - 2 * u);
          lift = Math.sin(Math.PI * u);
        }
        const reach = leg.length * FOOT_REACH;
        vHip.set(side * SPIDER_HIP_X, height, leg.z);
        // O pé fica no chão (o corpo balança por cima dele).
        vFoot.set(side * Math.sin(angle) * reach, lift * STEP_LIFT * k - bob, leg.z + Math.cos(angle) * reach + slide * (STRIDE / 4) * k);
        legBend(vHip, vFoot, leg.length * FEMUR, leg.length * SHIN, vKnee);
        this.femurs.set(slot, mOut.multiplyMatrices(mBody, threadMatrix(vHip, vKnee, mLocal)));
        this.shins.set(slot, mOut.multiplyMatrices(mBody, threadMatrix(vKnee, vFoot, mLocal)));
        this.knees.set(slot, mOut.multiplyMatrices(mBody, mLocal.makeTranslation(vKnee.x, vKnee.y, vKnee.z)));
        slot++;
      }
    });
  }

  private hideLegs(web: Web): void {
    for (let i = 0; i < LEG_COUNT; i++) {
      this.femurs.hide(web.legSlot + i);
      this.shins.hide(web.legSlot + i);
      this.knees.hide(web.legSlot + i);
    }
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const web of this.webs) if (web.alive && web.center.distanceTo(position) < radius + web.radius + 1) web.wobble = 1;
  }

  /** Rodada nova: teias refeitas e cada aranha de volta no meio da sua. */
  newRound(): void {
    for (const web of this.webs) {
      web.alive = true;
      web.drawn = false;
      web.wobble = 0;
      web.spider = 'web';
    }
  }
}

/**
 * IK de dois ossos no plano vertical da pata: o joelho fica a `femur` do
 * quadril e a `shin` do pé, dobrado para cima (pata de aranha). Pé longe
 * demais: estica a pata na direção dele.
 */
function legBend(hip: THREE.Vector3, foot: THREE.Vector3, femur: number, shin: number, knee: THREE.Vector3): THREE.Vector3 {
  vReach.copy(foot).sub(hip);
  const d = clamp(vReach.length(), 1e-4, (femur + shin) * 0.999);
  vReach.normalize();
  // "Para cima" perpendicular à linha quadril-pé.
  vBend.copy(Y_AXIS).addScaledVector(vReach, -vReach.y).normalize();
  const cos = clamp((femur * femur + d * d - shin * shin) / (2 * femur * d), -1, 1);
  return knee.copy(hip).addScaledVector(vReach, femur * cos).addScaledVector(vBend, femur * Math.sqrt(1 - cos * cos));
}

/** Matriz do fio de seda (cilindro de altura 1 em +Y) indo de `a` até `b` (também serve para os pedaços de pata). */
function threadMatrix(a: THREE.Vector3, b: THREE.Vector3, target: THREE.Matrix4): THREE.Matrix4 {
  vTmp.copy(b).sub(a);
  const length = vTmp.length();
  if (length < 1e-4) return target.makeScale(0, 0, 0);
  qTmp.setFromUnitVectors(Y_AXIS, vTmp.divideScalar(length));
  return target.compose(a, qTmp, vScale.set(1, length, 1));
}
