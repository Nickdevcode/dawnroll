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

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

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
    const position = new THREE.Vector3().copy(this.focus).addScaledVector(offset, this.distance);

    // Não deixa a câmera entrar no chão.
    const ground = terrainHeight(position.x, position.z) + 0.45;
    if (position.y < ground) position.y = ground;

    this.camera.position.copy(position);
    this.camera.lookAt(this.focus);
  }
}
