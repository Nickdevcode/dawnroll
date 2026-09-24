import * as THREE from 'three';
import { clamp, damp, lerp } from '../utils/math';
import type { CameraBall, CameraCollision } from './ThirdPersonCamera';
import { terrainHeight } from '../world/Terrain';

/**
 * Câmera do provador (guarda-roupa aberto): sai de trás do besouro e o
 * enquadra de frente, na parte do corpo da aba (cabeça pros chapéus, rosto pros
 * óculos, costas pra capa...), balançando devagar pra mostrar os lados. Dá pra
 * girar arrastando. Ela só "puxa" a câmera normal: com o peso em 0 não mexe em
 * nada, e entra e sai suave.
 *
 * O besouro fica no meio do pedaço da tela que a placa não cobre (a projeção é
 * deslocada com `setViewOffset`), e a distância cresce quando esse pedaço é
 * pequeno (celular: placa embaixo, besouro em cima).
 *
 * A bola costuma estar colada no besouro (e a pedra, o tronco...): de tempos em
 * tempos a câmera procura, perto do ângulo da aba, um lado livre pra olhar.
 */

export interface ShowcaseFrame {
  /** Graus em volta do besouro (0 = de frente, 180 = de trás). */
  yaw: number;
  /** Altura da câmera acima do alvo. */
  up: number;
  distance: number;
  /** Alvo no espaço do besouro (altura e frente/trás). */
  targetY: number;
  targetZ: number;
}

export const SHOWCASE_FRAMES = {
  skins: { yaw: 38, up: 0.5, distance: 2.1, targetY: 0.36, targetZ: 0.02 },
  head: { yaw: 28, up: 0.32, distance: 1.45, targetY: 0.55, targetZ: 0.38 },
  face: { yaw: 16, up: 0.3, distance: 1.2, targetY: 0.47, targetZ: 0.45 },
  neck: { yaw: 22, up: 0.22, distance: 1.3, targetY: 0.4, targetZ: 0.42 },
  back: { yaw: 150, up: 0.62, distance: 2.1, targetY: 0.45, targetZ: -0.12 },
} satisfies Record<string, ShowcaseFrame>;

export type ShowcaseFrameName = keyof typeof SHOWCASE_FRAMES;

/** Folga da lente até pedra/tronco no caminho. */
const MARGIN = 0.15;
/** Desvios (graus) tentados, em ordem, quando o ângulo da aba está tapado. */
const DODGES = [0, 25, -25, 50, -50, 75, -75, 105, -105, 140, -140, 180];
/** De quanto em quanto tempo procura de novo um lado livre (s). */
const DODGE_INTERVAL = 0.35;

export class ShowcaseCamera {
  /** Pedido de estar no provador (o peso vai até 1 ou volta pra 0 suave). */
  active = false;
  /** Consultas de obstáculo (as mesmas da câmera normal). */
  collision: CameraCollision | null = null;
  /** A bola de bosta (esfera com o que está grudado nela), ou null. */
  ball: CameraBall | null = null;

  private weight = 0;
  private readonly frame: ShowcaseFrame = { ...SHOWCASE_FRAMES.skins };
  private target: ShowcaseFrame = SHOWCASE_FRAMES.skins;
  /** Giro do jogador (arrastando), somado ao balanço automático. */
  private spin = 0;
  private spinTarget = 0;
  private time = 0;
  private readonly look = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly baseLook = new THREE.Vector3();
  private readonly probeDir = new THREE.Vector3();
  /** Desvio atual (graus) pra fugir do que tapa, e o próximo alvo dele. */
  private dodge = 0;
  private dodgeTarget = 0;
  private dodgeTimer = 0;

  /** 0..1: quanto o provador está valendo agora. */
  get blend(): number {
    return this.weight;
  }

  setFrame(name: ShowcaseFrameName): void {
    this.target = SHOWCASE_FRAMES[name];
  }

  /** Arrastou `dx` pixels: gira em volta do besouro. */
  drag(dx: number): void {
    this.spinTarget += dx * 0.45;
  }

  /** Volta pro ângulo da aba (ao abrir o guarda-roupa de novo). */
  resetSpin(): void {
    this.spin = this.spinTarget = 0;
    this.dodgeTimer = 0;
  }

  /**
   * Quanto dá pra recuar do alvo na direção `dir` sem encostar em sólido,
   * folhagem ou na bola (até `max`).
   */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    let free = max;
    const solid = this.collision?.cast(from, dir, max + MARGIN) ?? null;
    if (solid !== null) free = Math.min(free, solid - MARGIN);
    const soft = this.collision?.castSoft(from, dir, max + MARGIN) ?? null;
    if (soft !== null) free = Math.min(free, soft - MARGIN);
    const ball = this.ball;
    if (ball && ball.radius > 0) {
      // Esfera da bola com folga pro que está grudado (graveto, folha...).
      const r = ball.radius * 1.35 + 0.2;
      const mx = from.x - ball.center.x;
      const my = from.y - ball.center.y;
      const mz = from.z - ball.center.z;
      const b = mx * dir.x + my * dir.y + mz * dir.z;
      const c = mx * mx + my * my + mz * mz - r * r;
      const disc = b * b - c;
      if (c > 0 && b < 0 && disc > 0) free = Math.min(free, -b - Math.sqrt(disc) - MARGIN);
      else if (c <= 0) free = 0;
    }
    return Math.max(free, 0);
  }

  /** Direção (mundo) do alvo pra câmera num ângulo `yawDeg` do enquadramento atual. */
  private directionAt(root: THREE.Object3D, yawDeg: number, target: THREE.Vector3): THREE.Vector3 {
    const f = this.frame;
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    target.set(Math.sin(yaw) * f.distance, f.targetY + f.up, f.targetZ + Math.cos(yaw) * f.distance);
    root.localToWorld(target);
    return target.sub(this.aim).normalize();
  }

  /**
   * Depois da câmera normal: mistura a posição e a mira dela com as do
   * provador. `free` = pedaço da tela livre da placa (px), pra centralizar e
   * afastar. Devolve a distância até o alvo (pro foco do desfoque).
   */
  apply(camera: THREE.PerspectiveCamera, root: THREE.Object3D, dt: number, viewport: { width: number; height: number }, free: { x: number; y: number; width: number; height: number }): number {
    this.weight = damp(this.weight, this.active ? 1 : 0, this.active ? 3.2 : 4.5, dt);
    if (this.weight < 0.001) {
      this.weight = 0;
      if (camera.view?.enabled) camera.clearViewOffset();
      return 0;
    }
    this.time += dt;
    // Suaviza a troca de enquadramento entre as abas.
    const f = this.frame;
    const k = 1 - Math.exp(-3.5 * dt);
    f.yaw = lerp(f.yaw, this.target.yaw, k);
    f.up = lerp(f.up, this.target.up, k);
    f.distance = lerp(f.distance, this.target.distance, k);
    f.targetY = lerp(f.targetY, this.target.targetY, k);
    f.targetZ = lerp(f.targetZ, this.target.targetZ, k);
    this.spin = damp(this.spin, this.spinTarget, 8, dt);

    // Pedaço livre pequeno (celular: só a parte de cima) = besouro menor na tela = câmera mais longe.
    const squeeze = clamp(Math.max(viewport.height / Math.max(free.height, 1), (viewport.width / Math.max(free.width, 1)) * 0.75), 1, 2.3);
    root.updateMatrixWorld();
    this.aim.set(0, f.targetY, f.targetZ);
    root.localToWorld(this.aim);
    // De tempos em tempos: o ângulo da aba está livre? Se não, o desvio mais perto que estiver.
    this.dodgeTimer -= dt;
    if (this.dodgeTimer <= 0) {
      this.dodgeTimer = DODGE_INTERVAL;
      const want = f.distance * squeeze;
      const base = f.yaw + this.spin;
      let best = this.dodgeTarget;
      let bestFree = -1;
      for (const offset of DODGES) {
        const room = this.clearance(this.aim, this.directionAt(root, base + offset, this.probeDir), want);
        if (room >= want * 0.9) {
          best = offset;
          bestFree = room;
          break;
        }
        if (room > bestFree) {
          bestFree = room;
          best = offset;
        }
      }
      this.dodgeTarget = best;
    }
    this.dodge = damp(this.dodge, this.dodgeTarget, 2.5, dt);
    const yaw = THREE.MathUtils.degToRad(f.yaw + this.spin + this.dodge + Math.sin(this.time * 0.35) * 14);
    const offset = this.dir.set(Math.sin(yaw) * f.distance, f.up, f.targetZ + Math.cos(yaw) * f.distance);
    this.position.set(offset.x, f.targetY + offset.y, offset.z);
    root.localToWorld(this.position);
    // Distância certa pro tamanho da tela e sem atravessar pedra, tronco, folha, a bola nem o chão.
    this.dir.subVectors(this.position, this.aim);
    let distance = this.dir.length() * squeeze;
    this.dir.normalize();
    distance = Math.max(0.6, Math.min(distance, this.clearance(this.aim, this.dir, distance)));
    this.position.copy(this.aim).addScaledVector(this.dir, distance);
    this.position.y = Math.max(this.position.y, terrainHeight(this.position.x, this.position.z) + 0.25);

    // Mistura com a câmera normal (posição e para onde ela olha).
    const w = this.weight * this.weight * (3 - 2 * this.weight);
    camera.getWorldDirection(this.look);
    this.baseLook.copy(camera.position).addScaledVector(this.look, 5);
    camera.position.lerp(this.position, w);
    this.look.copy(this.baseLook).lerp(this.aim, w);
    camera.lookAt(this.look);

    // Centraliza o besouro no pedaço livre: desloca a projeção (não a câmera).
    const cx = free.x + free.width / 2;
    const cy = free.y + free.height / 2;
    const shiftX = (viewport.width / 2 - cx) * w;
    const shiftY = (viewport.height / 2 - cy) * w;
    camera.setViewOffset(viewport.width, viewport.height, shiftX, shiftY, viewport.width, viewport.height);
    return camera.position.distanceTo(this.aim);
  }
}
