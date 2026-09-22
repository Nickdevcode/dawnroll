import * as THREE from 'three';
import { clamp, damp } from '../utils/math';
import { terrainHeight } from '../world/Terrain';

const MIN_PITCH = -0.15;
const MAX_PITCH = 1.2;
const MOUSE_SENSITIVITY = 0.0028;

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

  /**
   * Consulta de obstáculo (pedra, cogumelo, tronco): distância do `origin` até o
   * primeiro sólido na direção `dir`, ou null se o caminho estiver livre.
   */
  obstruction: ((origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number) => number | null) | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Tremidinha de impacto (soma com a que já estiver rolando, com teto). */
  shake(amount: number): void {
    this.shakeAmount = Math.min(this.shakeAmount + amount, 0.35);
  }

  applyLook(dx: number, dy: number, zoomSteps: number): void {
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch + dy * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
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
    const pitch = Math.max(this.pitch, 0.55 * this.pushLift + this.pitch * (1 - this.pushLift));
    const cosPitch = Math.cos(pitch);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cosPitch, Math.sin(pitch), Math.cos(this.yaw) * cosPitch);

    // Sólido entre o foco e a câmera: encurta a distância (entra rápido, sai devagar)
    // para a lente nunca parar dentro de uma pedra.
    const hit = this.obstruction?.(this.focus, offset, this.distance + 0.5) ?? null;
    const free = hit === null ? this.distance + 2 : Math.max(hit - 0.45, 1.6);
    this.clearance = free < this.clearance ? free : damp(Math.min(this.clearance, this.distance + 2), free, 2.5, dt);
    const position = new THREE.Vector3().copy(this.focus).addScaledVector(offset, Math.min(this.distance, this.clearance));

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
}
