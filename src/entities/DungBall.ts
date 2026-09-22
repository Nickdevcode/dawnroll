import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { claySphere, clayCapsule } from '../render/geometry';
import { clamp, damp, createRng } from '../utils/math';
import { noise3 } from '../utils/noise';

export const START_RADIUS = 0.5;
export const MAX_RADIUS = 4.5;
const DENSITY = 1.6;

const DUNG_COLORS = ['#6e4426', '#83542f', '#5b3820', '#9a6a3c'].map((c) => new THREE.Color(c));

interface StuckItem {
  object: THREE.Object3D;
  /** Raio da bola no momento em que grudou — quando a bola cresce além, o item é soterrado. */
  radiusAtStick: number;
  size: number;
}

const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/**
 * A bola de bosta: corpo rígido dinâmico do Rapier + visual de massinha.
 *
 * Hierarquia visual:
 *   root (posição + squash alinhado ao mundo)
 *     └ spin (rotação física)
 *         ├ core (esfera de bosta, escala = raio)
 *         └ stuck (itens grudados, sem escala)
 */
export class DungBall {
  readonly root = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly spin = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly stuckGroup = new THREE.Group();
  private readonly stuck: StuckItem[] = [];

  private _radius = START_RADIUS;
  private targetVolume = volumeOf(START_RADIUS);
  private colliderRadius = START_RADIUS;

  // Interpolação entre passos fixos.
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();

  private squash = 0;
  private squashVelocity = 0;
  private lastVelY = 0;

  /** Quantos montinhos de bosta já foram incorporados. */
  dungCount = 0;
  /** Chamado quando a bola bate forte no chão/obstáculo (intensidade 0..1). */
  onImpact: ((strength: number) => void) | null = null;

  constructor(physics: Physics, spawn: THREE.Vector3) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.12)
      .setAngularDamping(0.35)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(START_RADIUS)
        .setDensity(DENSITY)
        .setFriction(1.4)
        .setRestitution(0.08)
        .setCollisionGroups(interactionGroups(Groups.BALL, 0xffff)),
      this.body,
    );

    this.core = new THREE.Mesh(buildDungGeometry(), clay(0xffffff, { vertexColors: true, roughness: 0.82, sheen: 0.35, bump: 0.6, repeat: 2 }));
    this.core.castShadow = true;
    this.core.receiveShadow = true;
    this.core.add(buildStraw());

    this.spin.add(this.core, this.stuckGroup);
    this.root.add(this.spin);
    this.root.name = 'dung-ball';

    this.currPos.copy(spawn);
    this.prevPos.copy(spawn);
    this.applyVisualRadius();
  }

  get radius(): number {
    return this._radius;
  }

  get mass(): number {
    return this.body.mass();
  }

  /** Diâmetro em centímetros na escala do mundo (1 unidade ≈ 2 cm). */
  get diameterCm(): number {
    return this._radius * 2 * 2;
  }

  position(target = new THREE.Vector3()): THREE.Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  velocity(target = new THREE.Vector3()): THREE.Vector3 {
    const v = this.body.linvel();
    return target.set(v.x, v.y, v.z);
  }

  /** Adiciona volume (a bola cresce suavemente até o novo raio). */
  addVolume(volume: number): void {
    this.targetVolume = Math.min(this.targetVolume + volume, volumeOf(MAX_RADIUS));
  }

  /**
   * Gruda um objeto na superfície (estilo Katamari). O objeto é reparentado
   * para dentro da bola preservando a direção do ponto de contato.
   */
  stick(object: THREE.Object3D, size: number): void {
    const center = this.position(tmpVec.set(0, 0, 0));
    const dir = object.getWorldPosition(new THREE.Vector3()).sub(center);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();

    // Direção em espaço local da bola (desfaz a rotação atual).
    this.spin.getWorldQuaternion(tmpQuat).invert();
    dir.applyQuaternion(tmpQuat);

    object.removeFromParent();
    // Afunda ~um terço do item na bosta; fica com cara de "grudou mesmo".
    object.position.copy(dir).multiplyScalar(this._radius + size * 0.18);
    // Orientação do item: "deitado" sobre a superfície com um giro aleatório.
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    object.rotateY(Math.random() * Math.PI * 2);
    if (object.userData.lieTangent) object.rotateX(Math.PI / 2);
    this.stuckGroup.add(object);
    this.stuck.push({ object, radiusAtStick: this._radius, size });
  }

  /** Passo fixo: crescimento, colisor e detecção de impacto. */
  fixedUpdate(dt: number): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);

    const targetRadius = radiusOf(this.targetVolume);
    if (Math.abs(targetRadius - this._radius) > 1e-4) {
      this._radius = damp(this._radius, targetRadius, 5, dt);
      if (Math.abs(this._radius - this.colliderRadius) > 0.004) {
        this.collider.setRadius(this._radius);
        this.colliderRadius = this._radius;
      }
      this.applyVisualRadius();
      this.buryOldItems();
    }

    // Resistência ao rolamento: o Rapier não tem, então a bola rolaria para sempre.
    // Devagar ela "gruda" no chão (bosta não é bola de gude); rápido, quase não freia.
    const lv = this.body.linvel();
    const w = this.body.angvel();
    const speed = Math.hypot(lv.x, lv.z);
    const drag = speed < 1.2 ? 3.2 : 0.5;
    const rolling = Math.exp(-drag * dt);
    this.body.setAngvel({ x: w.x * rolling, y: w.y * 0.9, z: w.z * rolling }, false);
    this.body.setLinvel({ x: lv.x * rolling, y: lv.y, z: lv.z * rolling }, false);

    // Impacto = mudança brusca de velocidade vertical (caiu / quicou).
    const v = this.body.linvel();
    const dv = v.y - this.lastVelY;
    if (dv > 4) {
      const strength = clamp(dv / 14, 0, 1);
      this.squashVelocity -= strength * 9;
      this.onImpact?.(strength);
    }
    this.lastVelY = v.y;

    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  /** Coloca a bola num ponto (reset). */
  teleport(position: THREE.Vector3): void {
    this.body.setTranslation(position, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.currPos.copy(position);
    this.prevPos.copy(position);
  }

  /** Visual interpolado + mola de squash & stretch. */
  render(alpha: number, dt: number): void {
    this.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.spin.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);

    // Mola amortecida: amassa no impacto e volta balançando, como massinha.
    const stiffness = 160;
    const damping = 11;
    this.squashVelocity += (-stiffness * this.squash - damping * this.squashVelocity) * dt;
    this.squash = clamp(this.squash + this.squashVelocity * dt, -0.25, 0.25);
    const sy = 1 + this.squash;
    const sxz = 1 / Math.sqrt(sy);
    this.root.scale.set(sxz, sy, sxz);
    // O centro desce junto para a base continuar encostada no chão.
    this.root.position.y += this.squash * this._radius;
  }

  private applyVisualRadius(): void {
    this.core.scale.setScalar(this._radius);
  }

  private buryOldItems(): void {
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const item = this.stuck[i];
      if (this._radius - item.radiusAtStick > item.size * 0.9) {
        item.object.removeFromParent();
        this.stuck.splice(i, 1);
      }
    }
    // Teto de segurança para não acumular draw calls.
    while (this.stuck.length > 90) {
      this.stuck.shift()!.object.removeFromParent();
    }
  }
}

function volumeOf(r: number): number {
  return (4 / 3) * Math.PI * r * r * r;
}

function radiusOf(volume: number): number {
  return Math.cbrt((3 * volume) / (4 * Math.PI));
}

/** Esfera unitária bem irregular, com manchas de cor em vertex color. */
function buildDungGeometry(): THREE.BufferGeometry {
  const geometry = claySphere(1, 5, 0.08, 2.4, 3.7);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 3.1, y * 3.1, z * 3.1) * 0.5 + 0.5;
    const speck = noise3(x * 11 + 5, y * 11, z * 11 - 3);
    c.copy(DUNG_COLORS[0]).lerp(DUNG_COLORS[1], n);
    if (n < 0.35) c.lerp(DUNG_COLORS[2], 0.7);
    if (speck > 0.45) c.lerp(DUNG_COLORS[3], 0.8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Fiapos de palha espetados na bola (escalam junto com ela). */
function buildStraw(): THREE.Group {
  const group = new THREE.Group();
  const rng = createRng(99);
  const material = clay('#e6c46a', { roughness: 0.7, sheen: 0.4, bump: 0.1 });
  const geometry = clayCapsule(0.018, 0.22, 0.05, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 16; i++) {
    const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    const straw = new THREE.Mesh(geometry, material);
    straw.position.copy(dir).multiplyScalar(0.97);
    // Quase tangente à superfície: palha deitada, não espeto.
    const tangent = new THREE.Vector3().crossVectors(dir, up).normalize();
    if (tangent.lengthSq() < 0.1) tangent.set(1, 0, 0);
    straw.quaternion.setFromUnitVectors(up, tangent.lerp(dir, 0.25).normalize());
    straw.castShadow = true;
    group.add(straw);
  }
  return group;
}
