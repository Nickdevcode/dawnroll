import * as THREE from 'three';
import { clamp, damp } from '../utils/math';
import { terrainHeight } from '../world/Terrain';

const MIN_PITCH = -0.15;
const MAX_PITCH = 1.2;
const MOUSE_SENSITIVITY = 0.0028;
/** Raio da "lente" nas consultas de colisão: maior que o plano de corte perto (nada raspa na tela). */
export const CAMERA_PROBE_RADIUS = 0.3;
/** Folga entre a lente e o obstáculo. */
const OBSTACLE_MARGIN = 0.12;
/**
 * Nunca mais perto do foco que isso. Encurralada de verdade (besouro espremido
 * entre coisas, sem espaço nem subindo), é melhor ficar colada nas costas do
 * besouro do que com a lente dentro de um cogumelo.
 */
const MIN_DISTANCE = 0.45;
/** Espremida mais que isso, a câmera tenta subir por cima do obstáculo. */
const COMFORT_DISTANCE = 1.8;
/** Degraus de "subir por cima" (rad somados ao ângulo vertical) e o teto disso. */
const LIFT_STEPS = [0.25, 0.5, 0.75, 1];
const MAX_LIFTED_PITCH = 1.45;

/**
 * O que a câmera consulta no mundo. Tudo com uma esfera do tamanho da lente
 * (`CAMERA_PROBE_RADIUS`) varrida a partir do foco.
 */
export interface CameraCollision {
  /** Distância até o primeiro sólido (pedra, tronco, objeto, chão) na direção `dir`, ou null se livre. */
  cast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): number | null;
  /** O mesmo, só contra volumes macios (pétala, folha, caule): a lente não para dentro deles. */
  castSoft(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): number | null;
  /** A lente em `point` estaria dentro de um volume macio? */
  insideSoft(point: THREE.Vector3): boolean;
}

/** A bola de bosta como obstáculo da câmera (esfera). */
export interface CameraBall {
  readonly center: THREE.Vector3;
  radius: number;
}

/**
 * Câmera em órbita atrás do jogador, com mouse livre (pointer lock).
 * Quando o besouro está empurrando, afasta e mira entre ele e a bola
 * para os dois caberem na tela — e afasta mais conforme a bola cresce.
 */
export class ThirdPersonCamera {
  /** Ângulo horizontal: 0 = câmera no +Z do alvo olhando para -Z. */
  yaw = Math.PI;
  pitch = 0.42;

  private zoom = 1;
  private distance = 5;
  private readonly focus = new THREE.Vector3();
  private initialized = false;
  private pushLift = 0;
  private shakeAmount = 0;
  private shakeTime = 0;
  /** Distância livre até o primeiro obstáculo atrás do foco (suavizada). */
  private clearance = 100;
  /** Quanto a câmera subiu (rad) para passar por cima de um obstáculo colado nas costas do besouro. */
  private occlusionLift = 0;
  private readonly offset = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();

  /** Consultas de obstáculo no mundo (sem isso a câmera atravessa tudo). */
  collision: CameraCollision | null = null;
  /** A bola de bosta (null enquanto ela está sendo enterrada: não é obstáculo). */
  ball: CameraBall | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Multiplicador da velocidade do mouse/dedo (configurações). */
  sensitivity = 1;
  /** Inverte o olhar vertical (configurações). */
  invertY = false;
  /** Desligar a tremida ajuda quem enjoa com câmera mexendo (configurações). */
  shakeEnabled = true;

  /** Tremidinha de impacto (soma com a que já estiver rolando, com teto). */
  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmount = Math.min(this.shakeAmount + amount, 0.35);
  }

  applyLook(dx: number, dy: number, zoomSteps: number): void {
    const k = MOUSE_SENSITIVITY * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch + dy * k * (this.invertY ? -1 : 1), MIN_PITCH, MAX_PITCH);
    this.zoom = clamp(this.zoom + zoomSteps * 0.12, 0.55, 2.2);
  }

  /**
   * Gira devagar pra ficar atrás da direção em que o besouro anda/empurra.
   * `direction` nulo = parado, não mexe.
   */
  autoFollow(dt: number, direction: THREE.Vector3 | null): void {
    if (!direction) return;
    const target = Math.atan2(-direction.x, -direction.z);
    let delta = (target - this.yaw) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    // Mais lento quando é quase meia-volta (o jogador pode só estar dando ré).
    const rate = Math.abs(delta) > 2.4 ? 0 : 1.6;
    this.yaw += delta * (1 - Math.exp(-rate * dt));
  }

  /**
   * @param player posição dos pés do besouro
   * @param ball centro da bola
   * @param ballRadius raio atual
   * @param pushing se está empurrando
   */
  update(dt: number, player: THREE.Vector3, ball: THREE.Vector3, ballRadius: number, pushing: boolean): void {
    // Foco: no besouro; empurrando, puxa em direção à bola.
    const target = new THREE.Vector3().copy(player).add(new THREE.Vector3(0, 0.6, 0));
    if (pushing) target.lerp(ball, 0.55);

    const baseDistance = 4.2 + (pushing ? ballRadius * 2.2 : ballRadius * 0.6);
    const desiredDistance = baseDistance * this.zoom;

    if (!this.initialized) {
      this.focus.copy(target);
      this.distance = desiredDistance;
      this.initialized = true;
    }

    this.focus.x = damp(this.focus.x, target.x, 10, dt);
    this.focus.y = damp(this.focus.y, target.y, 6, dt);
    this.focus.z = damp(this.focus.z, target.z, 10, dt);
    this.distance = damp(this.distance, desiredDistance, 3, dt);

    // Empurrando, a câmera sobe um pouco sozinha para enxergar a bola por cima do besouro.
    this.pushLift = damp(this.pushLift, pushing ? 1 : 0, 3, dt);
    const basePitch = Math.max(this.pitch, 0.55 * this.pushLift + this.pitch * (1 - this.pushLift));

    // Obstáculo colado nas costas (pedra, vaso, a própria bola): em vez de enfiar a lente
    // no besouro, a câmera sobe por cima (sobe rápido, desce devagar).
    const comfort = Math.min(COMFORT_DISTANCE, this.distance);
    let targetLift = 0;
    if (this.collision && this.allowedDistance(basePitch) < comfort) {
      for (const lift of LIFT_STEPS) {
        if (basePitch + lift > MAX_LIFTED_PITCH) break;
        targetLift = lift;
        if (this.allowedDistance(basePitch + lift) >= comfort) break;
      }
    }
    this.occlusionLift = damp(this.occlusionLift, targetLift, targetLift > this.occlusionLift ? 6 : 1.2, dt);
    const offset = this.direction(basePitch + this.occlusionLift).clone();

    // Sólido entre o foco e a câmera: encurta a distância (entra rápido, sai devagar)
    // para a lente nunca parar dentro de uma pedra, de um brinquedo ou da bola.
    const free = this.allowedDistance(basePitch + this.occlusionLift);
    this.clearance = free < this.clearance ? free : damp(Math.min(this.clearance, this.distance + 2), free, 2.5, dt);
    let distance = Math.min(this.distance, this.clearance);

    // Folhagem (pétala, folha, caule) não empurra a câmera só por passar na frente,
    // mas a lente nunca termina DENTRO dela: aí encosta antes.
    if (this.collision) {
      const soft = this.collision.castSoft(this.focus, offset, distance);
      if (soft !== null && this.collision.insideSoft(this.probe.copy(this.focus).addScaledVector(offset, distance))) {
        distance = Math.max(soft - OBSTACLE_MARGIN, MIN_DISTANCE);
        this.clearance = Math.min(this.clearance, distance);
      }
    }
    const position = new THREE.Vector3().copy(this.focus).addScaledVector(offset, distance);

    // Não deixa a câmera entrar no chão.
    const ground = terrainHeight(position.x, position.z) + 0.45;
    if (position.y < ground) position.y = ground;

    this.camera.position.copy(position);
    this.camera.lookAt(this.focus);

    // Tremida amortecida: rápida no começo, some em ~0,4 s.
    if (this.shakeAmount > 1e-3) {
      this.shakeTime += dt;
      const s = this.shakeAmount;
      this.camera.position.x += Math.sin(this.shakeTime * 61) * s * 0.35;
      this.camera.position.y += Math.sin(this.shakeTime * 47 + 1.3) * s * 0.5;
      this.camera.rotation.z += Math.sin(this.shakeTime * 53 + 2.1) * s * 0.06;
      this.shakeAmount = damp(this.shakeAmount, 0, 9, dt);
    }
  }

  /** Direção do foco para a câmera num ângulo vertical. */
  private direction(pitch: number): THREE.Vector3 {
    const cosPitch = Math.cos(pitch);
    return this.offset.set(Math.sin(this.yaw) * cosPitch, Math.sin(pitch), Math.cos(this.yaw) * cosPitch);
  }

  /** Até onde a câmera pode recuar do foco nesse ângulo vertical sem entrar em sólido nem na bola. */
  private allowedDistance(pitch: number): number {
    const dir = this.direction(pitch);
    let allowed = this.distance + 2;
    const hit = this.collision?.cast(this.focus, dir, this.distance + 0.5) ?? null;
    if (hit !== null) allowed = Math.min(allowed, hit - OBSTACLE_MARGIN);
    const ball = this.ballEntry(dir);
    if (ball !== null) allowed = Math.min(allowed, ball - OBSTACLE_MARGIN);
    return Math.max(allowed, MIN_DISTANCE);
  }

  /**
   * Distância em que a lente, saindo do foco na direção `dir`, encosta na bola
   * (esfera com os itens grudados por fora), ou null. Foco dentro da bola (a
   * gigante sendo empurrada): a câmera sai por trás, a bola não barra.
   */
  private ballEntry(dir: THREE.Vector3): number | null {
    const ball = this.ball;
    if (!ball) return null;
    const r = ball.radius * 1.08 + CAMERA_PROBE_RADIUS;
    const mx = this.focus.x - ball.center.x;
    const my = this.focus.y - ball.center.y;
    const mz = this.focus.z - ball.center.z;
    const b = mx * dir.x + my * dir.y + mz * dir.z;
    const c = mx * mx + my * my + mz * mz - r * r;
    if (c <= 0 || b > 0) return null;
    const disc = b * b - c;
    if (disc < 0) return null;
    return -b - Math.sqrt(disc);
  }
}
