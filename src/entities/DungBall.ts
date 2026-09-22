import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { claySphere, displace, paintVertices, solidColor, taperedTube } from '../render/geometry';
import { clamp, damp, createRng, smoothstep } from '../utils/math';
import { noise3 } from '../utils/noise';
import { quality } from '../core/device';

export const START_RADIUS = 0.5;
export const MAX_RADIUS = 6;
const DENSITY = 1.6;
/** Tempo do "voo" de um item do chão até assentar na bola. */
const ATTACH_SECONDS = 0.28;
/** Tempo da bola nova "brotando" numa rodada nova. */
const SPAWN_POP_SECONDS = 0.45;

const DUNG_COLORS = ['#6e4426', '#83542f', '#5b3820', '#9a6a3c', '#6f6a33'].map((c) => new THREE.Color(c));

/** Como um item gruda na bola. */
export interface StickOptions {
  /** Quanto a origem do item afunda na bosta (negativo = fica acima da superfície). */
  depth?: number;
  /** Inclinação (rad) do "para cima" do item em relação à normal da bola: 0 = espetado, ~1,2 = deitado. */
  lean?: number;
  /** Deita o eixo Y local do item tangente à bola (graveto, tronco). */
  lieTangent?: boolean;
  /** Escala final do item (multiplica a escala atual). */
  scale?: number;
  /** Tamanho considerado para soterrar: quanto a bola precisa crescer para cobrir o item. */
  burySize?: number;
}

interface StuckItem {
  object: THREE.Object3D;
  /** Raio da bola no momento em que grudou — quando a bola cresce além, o item é soterrado. */
  radiusAtStick: number;
  size: number;
  /** Progresso do "voo" até a bola (0..1); 1 = assentado. */
  attach: number;
  readonly fromPosition: THREE.Vector3;
  readonly fromQuaternion: THREE.Quaternion;
  readonly fromScale: THREE.Vector3;
  readonly toPosition: THREE.Vector3;
  readonly toQuaternion: THREE.Quaternion;
  readonly toScale: THREE.Vector3;
}

const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

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
  /** 0..1: bola nova brotando (rodada nova). */
  private spawnPop = 1;
  /** A toca assumiu a bola (física congelada, sem colisão). */
  private burying = false;

  /** Freio extra do terreno (água, lama) — o jogo atualiza a cada passo fixo. */
  extraDrag = 0;
  /** Quantos montinhos de bosta já foram incorporados. */
  dungCount = 0;
  /** Quantas coisas grudaram nesta bola (detritos, flores, pedras...). */
  itemCount = 0;
  /** Chamado quando a bola bate forte no chão/obstáculo (intensidade 0..1). */
  onImpact: ((strength: number) => void) | null = null;
  /** Um item se soltou (a bola encolheu na água): posição de mundo, para o respingo. */
  onShed: ((position: THREE.Vector3) => void) | null = null;

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

    this.core = new THREE.Mesh(
      buildDungGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.82, sheen: 0.35, bump: 0.6, repeat: 2, wet: 0.55, mottle: 0.06, mottleScale: 3.5 }),
    );
    this.core.castShadow = true;
    this.core.receiveShadow = true;
    this.core.add(buildInclusions());

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

  /** Participa da física (falso enquanto a toca está engolindo a bola). */
  get isSolid(): boolean {
    return !this.burying;
  }

  position(target = new THREE.Vector3()): THREE.Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  velocity(target = new THREE.Vector3()): THREE.Vector3 {
    const v = this.body.linvel();
    return target.set(v.x, v.y, v.z);
  }

  /** Rotação atual do corpo (a toca continua girando a bola de onde ela estava). */
  rotation(target = new THREE.Quaternion()): THREE.Quaternion {
    const r = this.body.rotation();
    return target.set(r.x, r.y, r.z, r.w);
  }

  /** Adiciona volume (a bola cresce suavemente até o novo raio). */
  addVolume(volume: number): void {
    this.targetVolume = Math.min(this.targetVolume + volume, volumeOf(MAX_RADIUS));
  }

  /** Tira volume (bosta derretendo na poça). Nunca fica menor que a bola inicial. */
  removeVolume(volume: number): void {
    this.targetVolume = Math.max(this.targetVolume - volume, volumeOf(START_RADIUS));
  }

  /**
   * Gruda um objeto na superfície (estilo Katamari). O objeto sai de onde está
   * no mundo e "voa" até a bola em ~0,3 s, já girando junto com ela.
   */
  stick(object: THREE.Object3D, options: StickOptions = {}): void {
    const { depth = 0, lean = 0, lieTangent = false, scale = 1 } = options;
    const dir = object.getWorldPosition(new THREE.Vector3()).sub(this.position(tmpVec));
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();

    // Tudo no espaço da bola (desfaz a rotação atual): o item gira junto com ela.
    this.spin.updateWorldMatrix(true, false);
    this.spin.getWorldQuaternion(tmpQuat).invert();
    dir.applyQuaternion(tmpQuat);

    object.updateWorldMatrix(true, false);
    const fromPosition = new THREE.Vector3();
    const fromQuaternion = new THREE.Quaternion();
    const fromScale = new THREE.Vector3();
    tmpMatrix.copy(this.spin.matrixWorld).invert().multiply(object.matrixWorld).decompose(fromPosition, fromQuaternion, fromScale);

    const toPosition = dir.clone().multiplyScalar(this._radius - depth);
    // "Deitado" sobre a superfície com um giro aleatório (e inclinado, se pedido).
    const toQuaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    toQuaternion.multiply(tmpQuat.setFromAxisAngle(UP, Math.random() * Math.PI * 2));
    if (lean) toQuaternion.multiply(tmpQuat.setFromAxisAngle(AXIS_X, lean));
    if (lieTangent) toQuaternion.multiply(tmpQuat.setFromAxisAngle(AXIS_X, Math.PI / 2));
    const toScale = object.scale.clone().multiplyScalar(scale);

    object.removeFromParent();
    object.position.copy(fromPosition);
    object.quaternion.copy(fromQuaternion);
    object.scale.copy(fromScale);
    this.stuckGroup.add(object);
    this.stuck.push({
      object,
      radiusAtStick: this._radius,
      size: options.burySize ?? 0.3,
      attach: 0,
      fromPosition,
      fromQuaternion,
      fromScale,
      toPosition,
      toQuaternion,
      toScale,
    });
    this.trimStuck();
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
      this.updateStuckForRadius();
    }

    if (!this.burying) {
      // Resistência ao rolamento: o Rapier não tem, então a bola rolaria para sempre.
      // Devagar ela "gruda" no chão (bosta não é bola de gude); rápido, quase não freia.
      // Água e lama somam um freio extra.
      const lv = this.body.linvel();
      const w = this.body.angvel();
      const speed = Math.hypot(lv.x, lv.z);
      const drag = (speed < 1.2 ? 3.2 : 0.5) + this.extraDrag;
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
    }

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
    this.lastVelY = 0;
  }

  /** Bola nova (rodada nova): pequena, limpa, brotando no lugar indicado. */
  reset(position: THREE.Vector3): void {
    for (const item of this.stuck) item.object.removeFromParent();
    this.stuck.length = 0;
    this.targetVolume = volumeOf(START_RADIUS);
    this._radius = START_RADIUS;
    this.collider.setRadius(START_RADIUS);
    this.colliderRadius = START_RADIUS;
    this.applyVisualRadius();
    this.dungCount = 0;
    this.itemCount = 0;
    this.squash = 0;
    this.squashVelocity = 0;
    this.spawnPop = 0;
    this.teleport(position);
  }

  /** A toca assume a bola: física congelada e sem colisão; a pose passa a vir de `setBurialPose`. */
  beginBurial(): void {
    this.burying = true;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.collider.setEnabled(false);
  }

  /** Pose da bola durante o enterro (chamar ANTES do passo de física). */
  setBurialPose(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.body.setNextKinematicTranslation(position);
    this.body.setNextKinematicRotation(rotation);
  }

  endBurial(): void {
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.collider.setEnabled(true);
    this.burying = false;
  }

  /** Visual interpolado + mola de squash & stretch + itens voando até a bola. */
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
    let pop = 1;
    if (this.spawnPop < 1) {
      this.spawnPop = Math.min(1, this.spawnPop + dt / SPAWN_POP_SECONDS);
      pop = Math.max(easeOutBack(this.spawnPop), 0.001);
    }
    this.root.scale.set(sxz * pop, sy * pop, sxz * pop);
    // O centro desce junto para a base continuar encostada no chão.
    this.root.position.y += this.squash * this._radius - (1 - pop) * this._radius;

    for (const item of this.stuck) {
      if (item.attach >= 1) continue;
      item.attach = Math.min(1, item.attach + dt / ATTACH_SECONDS);
      const e = easeOutCubic(item.attach);
      const o = item.object;
      o.position.lerpVectors(item.fromPosition, item.toPosition, e);
      // Arquinho para fora no meio do voo (parece "sugado" pela bola).
      const out = (Math.sin(Math.PI * e) * 0.18) / Math.max(item.toPosition.length(), 1e-3);
      o.position.addScaledVector(item.toPosition, out);
      o.quaternion.slerpQuaternions(item.fromQuaternion, item.toQuaternion, e);
      o.scale.lerpVectors(item.fromScale, item.toScale, e);
    }
  }

  private applyVisualRadius(): void {
    this.core.scale.setScalar(this._radius);
  }

  /**
   * A bola mudou de tamanho: o que ficou fundo demais é soterrado (some dentro da
   * bosta); o que ficou para fora demais (bola encolhendo na água) se solta.
   */
  private updateStuckForRadius(): void {
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const item = this.stuck[i];
      if (this._radius - item.radiusAtStick > item.size * 0.9) {
        item.object.removeFromParent();
        this.stuck.splice(i, 1);
      } else if (item.radiusAtStick - this._radius > item.size * 0.5 + 0.08) {
        const at = item.object.getWorldPosition(new THREE.Vector3());
        item.object.removeFromParent();
        this.stuck.splice(i, 1);
        this.onShed?.(at);
      }
    }
  }

  /** Teto de segurança para não acumular draw calls (some o mais antigo). */
  private trimStuck(): void {
    while (this.stuck.length > quality.stuckItems) {
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

/**
 * Esfera unitária bem irregular: calombos grandes (bola moldada à mão), médios
 * (bolotas de bosta coladas) e finos (fibra), com manchas de cor em vertex color —
 * marrons, esverdeado de capim digerido e pintinhas claras.
 */
function buildDungGeometry(): THREE.BufferGeometry {
  const geometry = displace(new THREE.IcosahedronGeometry(1, 28), (x, y, z) =>
    noise3(x * 2.4 + 3.7, y * 2.4, z * 2.4 - 3.7) * 0.075 +
    Math.max(0, noise3(x * 6 - 2, y * 6 + 5, z * 6)) * 0.05 +
    noise3(x * 15, y * 15 + 9, z * 15) * 0.012,
  );
  paintVertices(geometry, (p, _n, c) => {
    const n = noise3(p.x * 3.1, p.y * 3.1, p.z * 3.1) * 0.5 + 0.5;
    const speck = noise3(p.x * 11 + 5, p.y * 11, p.z * 11 - 3);
    const grassy = noise3(p.x * 1.7 - 9, p.y * 1.7, p.z * 1.7 + 4);
    c.copy(DUNG_COLORS[0]).lerp(DUNG_COLORS[1], n);
    if (n < 0.35) c.lerp(DUNG_COLORS[2], 0.7);
    c.lerp(DUNG_COLORS[4], smoothstep(0.2, 0.5, grassy) * 0.45);
    if (speck > 0.45) c.lerp(DUNG_COLORS[3], 0.8);
    // Fundinho dos calombos mais escuro (sujeira acumulada).
    const cavity = Math.max(0, -noise3(p.x * 6 - 2, p.y * 6 + 5, p.z * 6));
    return c.multiplyScalar(1 - cavity * 0.35);
  });
  return geometry;
}

/**
 * Tudo que vem "misturado" na bosta, numa malha só (escala junto com a bola):
 * fiapos de palha curvos deitados na superfície, pedaços de capim, sementinhas.
 */
function buildInclusions(): THREE.Mesh {
  const rng = createRng(99);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const StrawColors = ['#e6c46a', '#d8b25a', '#c9a24f', '#9fae5a', '#b88f4a'];

  for (let i = 0; i < 46; i++) {
    const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    // Tangente aleatória: o fiapo segue a curvatura da bola, meio enterrado.
    const tangent = new THREE.Vector3().crossVectors(dir, up);
    if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
    tangent.normalize().applyAxisAngle(dir, rng.range(0, Math.PI * 2));
    const length = rng.range(0.14, 0.4);
    const points: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = (k / 4 - 0.5) * length;
      // Em cima da esfera (raio ~1) com um leve "levantar" nas pontas.
      const p = dir.clone().addScaledVector(tangent, t).normalize().multiplyScalar(0.985 + Math.abs(t) * 0.12);
      points.push(p);
    }
    const width = rng.range(0.011, 0.02);
    const straw = taperedTube(new THREE.CatmullRomCurve3(points), 8, (t) => width * (1 - Math.abs(t - 0.5) * 0.8), 5);
    parts.push(solidColor(straw, rng.pick(StrawColors)));
  }
  for (let i = 0; i < 26; i++) {
    const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    const seed = claySphere(1, 2, 0.08, 2, i);
    seed.scale(0.022, 0.014, 0.036);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    seed.applyQuaternion(q);
    seed.translate(dir.x * 0.99, dir.y * 0.99, dir.z * 0.99);
    parts.push(solidColor(seed, rng.pick(['#efe0b8', '#d9c48f', '#b8a06a'])));
  }
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, clay(0xffffff, { vertexColors: true, roughness: 0.7, sheen: 0.4, bump: 0, mottle: 0.1, mottleScale: 20 }));
  mesh.castShadow = true;
  return mesh;
}
