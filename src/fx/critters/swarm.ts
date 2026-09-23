import * as THREE from 'three';
import { damp, dampAngle } from '../../utils/math';
import { terrainHeight } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { QUEEN_WING_HINGE, flyingAntBody, flyingAntWings } from './wingedModels';
import { airPointNear, attraction, ballTakes, collectedMesh, farPoint, groundSpotNear, repelFromCamera, shoveFromBall, threatAt } from './common';
import { jointMatrix, rootMatrix } from './flyers';
import { GroundWalker } from './walker';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Revoada de tanajuras: na primavera, logo depois de uma chuva boa, com o chão
 * encharcado, as içás (rainhas aladas da saúva) saem dos formigueiros de uma
 * vez para o voo nupcial. Aqui: quando a chuva forte passa e o chão ainda está
 * molhado, 10 a 20 tanajuras saem dos formigueiros, voam em volta (pesadas,
 * com o "bundão" pendurado) por um minuto e pouco, algumas pousam no chão uns
 * segundos (aí dá para pegar) e depois todas vão embora bem alto.
 */

type AntState = 'hidden' | 'emerge' | 'fly' | 'land' | 'ground' | 'leave';

interface FlyingAnt {
  slot: number;
  state: AntState;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly target: THREE.Vector3;
  walker: GroundWalker;
  yaw: number;
  /** 0 = asas abertas batendo, 1 = dobradas nas costas (no chão). */
  fold: number;
  scale: number;
  timer: number;
  /** Atraso até sair do formigueiro (a revoada sai aos poucos). */
  delay: number;
  seed: number;
}

/** Chuva acima disso "arma" a revoada; abaixo do mínimo (depois), ela começa. */
const RAIN_ARM = 0.35;
const RAIN_CALM = 0.1;
/** A chuva forte precisa ter sido nos últimos minutos. */
const ARM_MEMORY = 300;
const WET_ENOUGH = 0.3;
const QUEEN_SIZE = 0.45;

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vHinge = new THREE.Vector3();

export class FlyingAnts implements Species {
  private readonly body: InstancedPart;
  private readonly wings: InstancedPart;
  private readonly ants: FlyingAnt[] = [];
  /** Quando a chuva passou do "armar" pela última vez (relógio dos bichos). */
  private armedAt = -Infinity;
  /** Segundos até a revoada acabar (0 = sem revoada). */
  private swarm = 0;

  constructor(
    count: number,
    ctx: CritterContext,
    parent: THREE.Group,
    /** Bocas dos formigueiros (as colônias nascem no primeiro quadro). */
    private readonly nests: () => readonly THREE.Vector3[],
  ) {
    const mats = critterMaterials();
    this.body = new InstancedPart(flyingAntBody(), mats.glossy, count, { name: 'flying-ant-body' });
    // As duas asas de cada lado numa peça só; o lado esquerdo é a mesma instância espelhada (material dupla face).
    // Asa de içá é vítrea mas bem visível: cor de chá, mais opaca que a de abelha.
    const amber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    this.wings = new InstancedPart(flyingAntWings(), amber, count * 2, { name: 'flying-ant-wings', castShadow: false, skipAO: true });
    parent.add(this.body.mesh, this.wings.mesh);
    for (let i = 0; i < count; i++) {
      this.body.allocate();
      this.wings.allocate();
      this.wings.allocate();
      this.ants.push({
        slot: i,
        state: 'hidden',
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        target: new THREE.Vector3(),
        walker: new GroundWalker(1.5),
        yaw: 0,
        fold: 0,
        scale: ctx.rng.range(0.9, 1.1),
        timer: 0,
        delay: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  /** Revoada rolando agora? */
  get active(): boolean {
    return this.swarm > 0;
  }

  /**
   * Começa a revoada (a chuva já decidiu, ou o teste mandou). Devolve false se
   * não há formigueiro por perto de onde sair.
   */
  start(ctx: CritterContext): boolean {
    const player = ctx.world.player;
    const nests = this.nests().filter((n) => Math.hypot(n.x - player.x, n.z - player.z) < 40);
    if (nests.length === 0) return false;
    this.swarm = ctx.rng.range(60, 90);
    this.armedAt = -Infinity;
    for (const ant of this.ants) {
      const nest = ctx.rng.pick(nests);
      ant.position.set(nest.x + ctx.rng.range(-0.2, 0.2), nest.y + 0.35, nest.z + ctx.rng.range(-0.2, 0.2));
      ant.velocity.set(0, 0, 0);
      ant.state = 'emerge';
      ant.fold = 0;
      ant.delay = ctx.rng.range(0, 9);
      // Sobe do formigueiro num parafuso até uns metros de altura.
      ant.target.set(ant.position.x + ctx.rng.range(-2.5, 2.5), ant.position.y + ctx.rng.range(2.5, 5), ant.position.z + ctx.rng.range(-2.5, 2.5));
      ant.yaw = ctx.rng.next() * Math.PI * 2;
    }
    ctx.emit({ type: 'swarm' });
    return true;
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    if (w.rain > RAIN_ARM) this.armedAt = ctx.time;
    if (!this.active && !ctx.menu && w.rain < RAIN_CALM && w.wetness > WET_ENOUGH && ctx.time - this.armedAt < ARM_MEMORY) this.start(ctx);
    if (this.swarm > 0) this.swarm = Math.max(0, this.swarm - dt);
    let nearest = Infinity;
    let loudest: THREE.Vector3 | null = null;
    for (const ant of this.ants) {
      if (ant.state === 'hidden' || (ant.state === 'emerge' && (ant.delay -= dt) > 0)) {
        this.hide(ant);
        continue;
      }
      if (this.swarm <= 0 && ant.state !== 'leave' && ant.state !== 'ground') this.leave(ant, ctx);
      if (ant.state === 'ground') this.walk(ant, dt, ctx);
      else if (!this.fly(ant, dt, ctx)) {
        this.hide(ant);
        continue;
      }
      this.draw(ant, ctx.time);
      if (ant.state !== 'ground') {
        const d = ant.position.distanceTo(w.player);
        if (d < nearest) {
          nearest = d;
          loudest = ant.position;
        }
      }
    }
    if (loudest) ctx.sounds.hum('swarm', loudest);
    this.body.flush();
    this.wings.flush();
  }

  private leave(ant: FlyingAnt, ctx: CritterContext): void {
    ant.state = 'leave';
    farPoint(ctx, 55, 16, ant.target);
  }

  /** Próximo ponto no ar (ou, às vezes, um pouso no chão perto do jogador). */
  private nextTarget(ant: FlyingAnt, ctx: CritterContext): void {
    if (ctx.rng.next() < 0.22 && groundSpotNear(ctx, 2, 9, false, ant.target)) {
      ant.state = 'land';
      return;
    }
    ant.state = 'fly';
    airPointNear(ctx, 11, 1, 5.5, ant.target);
    ant.timer = ctx.rng.range(2, 4);
  }

  /** Um passo de voo. Devolve false se ela foi embora de vez (sumiu). */
  private fly(ant: FlyingAnt, dt: number, ctx: CritterContext): boolean {
    const w = ctx.world;
    const t = ctx.time + ant.seed;
    ant.fold = damp(ant.fold, 0, 8, dt);
    const to = vTmp.copy(ant.target).sub(ant.position);
    const dist = to.length();
    if (ant.state === 'leave') {
      if (Math.hypot(ant.position.x - w.player.x, ant.position.z - w.player.z) > 48) {
        ant.state = 'hidden';
        return false;
      }
    } else if (ant.state === 'land') {
      if (dist < 0.08) {
        ant.state = 'ground';
        ant.walker.placeAt(ant.target, ant.yaw);
        ant.timer = ctx.rng.range(3, 7);
        return true;
      }
    } else if (ant.state === 'emerge') {
      // Saindo do formigueiro: sobe até o ponto de partida antes de passear.
      if (dist < 0.6) this.nextTarget(ant, ctx);
    } else {
      ant.timer -= dt;
      if (dist < 0.6 || ant.timer <= 0 || Math.hypot(ant.target.x - w.player.x, ant.target.z - w.player.z) > 30) this.nextTarget(ant, ctx);
    }
    // Voo de tanajura: pesado e meio desengonçado, sempre corrigindo o rumo.
    const cruise = ant.state === 'leave' ? 4.5 : ant.state === 'land' ? Math.min(1.6, dist * 2.5 + 0.2) : Math.min(2.4, dist * 1.5 + 0.5);
    to.divideScalar(Math.max(dist, 1e-3)).multiplyScalar(cruise);
    if (ant.state !== 'land') {
      to.x += Math.sin(t * 2.3) * 0.9;
      to.y += Math.sin(t * 3.7) * 0.7;
      to.z += Math.cos(t * 1.9) * 0.9;
    }
    ant.velocity.lerp(to, 1 - Math.exp(-2.5 * dt));
    ant.position.addScaledVector(ant.velocity, dt);
    const ground = terrainHeight(ant.position.x, ant.position.z) + (ant.state === 'land' ? 0 : 0.5);
    if (ant.position.y < ground) ant.position.y = ground;
    if (Math.hypot(ant.velocity.x, ant.velocity.z) > 0.15) ant.yaw = dampAngle(ant.yaw, Math.atan2(ant.velocity.x, ant.velocity.z), 4, dt);
    if (repelFromCamera(ant.position, w.camera, dt, 2.6) && ant.state === 'fly') this.nextTarget(ant, ctx);
    return true;
  }

  /** Pousada: dobra as asas e anda um pouquinho (ou vai até a bola, com o Fedor irresistível). */
  private walk(ant: FlyingAnt, dt: number, ctx: CritterContext): void {
    const walker = ant.walker;
    ant.fold = damp(ant.fold, 1, 6, dt);
    ant.timer -= dt;
    const hurry = attraction(ctx, walker.position.x, walker.position.z, vAway);
    if (hurry > 0) {
      walker.flee(vAway, 1);
      walker.step(dt, ctx, 0.4 * hurry, 6);
    } else {
      walker.step(dt, ctx, 0.25, 3);
      // Susto ou fim da pausa: levanta voo de novo.
      if (ant.timer <= 0 || threatAt(ctx, walker.position.x, walker.position.y, walker.position.z, vAway) < 0.6) {
        ant.position.copy(walker.position);
        ant.yaw = walker.yaw;
        ant.velocity.set(vAway.x, 1.8, vAway.z);
        if (this.swarm > 0) this.nextTarget(ant, ctx);
        else this.leave(ant, ctx);
        if (ant.state === 'land') ant.state = 'fly';
        return;
      }
    }
    shoveFromBall(ctx, walker.position, 0.15, 0.15);
    ant.position.copy(walker.position);
    ant.yaw = walker.yaw;
  }

  private draw(ant: FlyingAnt, time: number): void {
    const t = time + ant.seed;
    const grounded = ant.state === 'ground';
    if (grounded) ant.walker.matrix(mRoot, ant.scale);
    // No ar, o corpo vai inclinado (o gáster pesado pendurado).
    else rootMatrix(mRoot, ant.position, ant.yaw, -0.45 + Math.sin(t * 3) * 0.06, Math.sin(t * 2.1) * 0.1, ant.scale);
    this.body.set(ant.slot, mRoot);
    const k = ant.fold;
    const flap = (1 - k) * (0.35 + Math.sin(t * 58) * 0.75);
    // Dobradas: as asas deitam para trás por cima do gáster (sobem um tiquinho para passar por cima dele).
    const sweep = k * 1.3;
    const rest = k * 0.24;
    this.wings.set(ant.slot * 2, jointMatrix(mRoot, QUEEN_WING_HINGE, 0, sweep, flap + rest, mOut));
    vHinge.set(-QUEEN_WING_HINGE.x, QUEEN_WING_HINGE.y + k * 0.01, QUEEN_WING_HINGE.z);
    this.wings.set(ant.slot * 2 + 1, jointMatrix(mRoot, vHinge, 0, -sweep, -flap - rest, mOut, -1, 1, 1));
  }

  private hide(ant: FlyingAnt): void {
    this.body.hide(ant.slot);
    this.wings.hide(ant.slot * 2);
    this.wings.hide(ant.slot * 2 + 1);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const ant of this.ants) {
      if (ant.state === 'ground' && ant.walker.position.distanceTo(position) < radius + 1.5) ant.timer = 0;
      else if (ant.state === 'fly' && ant.position.distanceTo(position) < radius + 2) this.nextTarget(ant, ctx);
    }
  }

  /** Só a tanajura pousada gruda (as asas ficam para trás, como na içá de verdade depois do voo). */
  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    for (const ant of this.ants) {
      if (ant.state !== 'ground') continue;
      const p = ant.walker.position;
      if (!ballTakes(center, radius, QUEEN_SIZE, p.x, p.y + 0.1, p.z, 0.14 * ant.scale)) continue;
      ant.walker.matrix(mRoot, ant.scale);
      ant.state = 'hidden';
      this.hide(ant);
      return { id: 'flyingAnt', object: collectedMesh(this.body.mesh.geometry, critterMaterials().glossy, mRoot), size: QUEEN_SIZE, color: new THREE.Color('#8a3b22') };
    }
    return null;
  }
}
