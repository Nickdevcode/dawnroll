import * as THREE from 'three';
import { RAPIER, GRAVITY, Groups, interactionGroups, type Physics } from '../core/Physics';
import type { InputState } from '../core/Input';
import { BeetleModel } from './BeetleModel';
import type { DungBall } from './DungBall';
import { clamp, damp, dampAngle, angleDelta } from '../utils/math';

const COLLIDER_RADIUS = 0.3;
const WALK_SPEED = 3.6;
const RUN_SPEED = 6.4;
const GROUND_ACCEL = 28;
const AIR_ACCEL = 9;
const JUMP_SPEED = 8.2;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;

/** Distância máxima (da superfície da bola) para conseguir agarrar. */
const GRAB_REACH = 0.8;
/** Folga entre o traseiro do besouro e a bola na pose de empurrar. */
const PUSH_GAP = 0.36;
/** Altura (acima do chão) em que o traseiro erguido toca a bola. */
const PUSH_CONTACT_HEIGHT = 0.75;
/** Se o besouro ficar mais longe que isso do ponto ideal, ele solta a bola. */
const LOSE_GRIP_DISTANCE = 1.4;

export type BeetleEvent = 'jump' | 'land' | 'grab' | 'release';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/**
 * Controlador do besouro: personagem cinemático (KinematicCharacterController
 * do Rapier) com dois modos — andar livre e empurrar a bola.
 *
 * Empurrar é a mecânica central: o jogador aponta a direção, o besouro aplica
 * força limitada na bola (quanto maior a bola, mais pesada e lenta) e se
 * reposiciona sozinho atrás dela, de ré, com as patas traseiras na bosta —
 * como o rola-bosta de verdade faz.
 */
export class Beetle {
  readonly model = new BeetleModel();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  /** Posição do centro do colisor (passo fixo). */
  private readonly position = new THREE.Vector3();
  private readonly prevPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();

  private yaw = 0;
  private prevYaw = 0;
  private readonly groundUp = new THREE.Vector3(0, 1, 0);

  private grounded = false;
  private airTime = 0;
  private jumpBuffer = 0;

  pushing = false;
  private pushBlend = 0;
  private readonly pushDir = new THREE.Vector3(0, 0, 1);
  private pushStrain = 0;

  onEvent: ((event: BeetleEvent) => void) | null = null;

  constructor(
    private readonly physics: Physics,
    spawn: THREE.Vector3,
    private readonly ball: DungBall,
  ) {
    this.position.copy(spawn).add(new THREE.Vector3(0, COLLIDER_RADIUS, 0));
    this.prevPosition.copy(this.position);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y, this.position.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(COLLIDER_RADIUS)
        .setCollisionGroups(interactionGroups(Groups.PLAYER, Groups.WORLD | Groups.BALL))
        // O solver não gera força entre besouro e bola: corpo cinemático empurraria com massa infinita.
        // Toda força na bola passa pela lógica de empurrar (limitada pelo tamanho dela).
        .setSolverGroups(interactionGroups(Groups.PLAYER, Groups.WORLD)),
      this.body,
    );

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.25, 0.15, false);
    this.controller.enableSnapToGround(0.3);
    // A força na bola é aplicada à mão (com limite); o empurrão automático do controlador fica desligado.
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  /** Posição interpolada dos pés — para câmera e visual. */
  renderPosition(alpha: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.lerpVectors(this.prevPosition, this.position, alpha).sub(tmpA.set(0, COLLIDER_RADIUS, 0));
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get pushStrength(): number {
    return this.pushStrain;
  }

  /** Posição do centro do colisor no passo atual (sem interpolação). */
  get center(): THREE.Vector3 {
    return this.position;
  }

  /** Direção "frente" da cabeça do besouro no plano. */
  get facing(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /**
   * Direção em que o besouro está indo no plano (empurrando = direção da bola),
   * ou null se estiver parado. Usada pela câmera automática do toque.
   */
  travelDirection(): THREE.Vector3 | null {
    if (this.pushing) {
      const v = this.ball.velocity(tmpB);
      return Math.hypot(v.x, v.z) > 0.4 ? this.pushDir.clone() : null;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    return speed > 1 ? new THREE.Vector3(this.velocity.x / speed, 0, this.velocity.z / speed) : null;
  }

  teleport(feet: THREE.Vector3): void {
    this.position.copy(feet).add(tmpA.set(0, COLLIDER_RADIUS + 0.05, 0));
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.body.setNextKinematicTranslation(this.position);
    this.body.setTranslation(this.position, true);
    this.releaseBall();
  }

  fixedUpdate(dt: number, input: InputState, cameraYaw: number): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;

    // Direção desejada relativa à câmera.
    const forward = tmpA.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = tmpB.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const wish = new THREE.Vector3().addScaledVector(forward, input.moveY).addScaledVector(right, input.moveX);
    const wishAmount = Math.min(wish.length(), 1);
    if (wishAmount > 1e-3) wish.divideScalar(wish.length());

    // --- pulo com coyote time e buffer ---
    this.jumpBuffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // --- agarrar / soltar ---
    if (input.grab && !this.pushing && this.canGrab()) this.startPush();
    if (!input.grab && this.pushing) this.releaseBall();

    let desired: THREE.Vector3;
    if (this.pushing) {
      desired = this.updatePush(dt, wish, wishAmount, input.run);
    } else {
      desired = this.updateWalk(dt, wish, wishAmount, input.run);
    }

    // Pulo (vale nos dois modos; pular solta a bola).
    if (this.jumpBuffer > 0 && this.airTime < COYOTE_TIME) {
      if (this.pushing) this.releaseBall();
      this.velocity.y = JUMP_SPEED;
      desired.y = JUMP_SPEED * dt;
      this.jumpBuffer = 0;
      this.airTime = COYOTE_TIME;
      this.grounded = false;
      this.onEvent?.('jump');
    }

    this.pushBlend = damp(this.pushBlend, this.pushing ? 1 : 0, 9, dt);

    // --- bola crescendo por cima do besouro ---
    // O solver não separa os dois (grupos de solver), e o controlador cinemático não sai de
    // dentro de um colisor sozinho. Então empurramos o besouro para fora na mão.
    const ballPos = this.ball.position(tmpC);
    const away = new THREE.Vector3(this.position.x - ballPos.x, 0, this.position.z - ballPos.z);
    const minDist = this.ball.radius + COLLIDER_RADIUS;
    const overlap = minDist - Math.hypot(away.x, away.z, this.position.y - ballPos.y);
    if (overlap > 0) {
      if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
      away.normalize();
      desired.addScaledVector(away, Math.min(overlap, 0.5));
    }
    // Empurrando ou sobrepostos, a bola sai da consulta: quem mantém a distância é a lógica de empurrar.
    const ignoreBall = this.pushing || overlap > -0.02;
    const ballHandle = this.ball.collider.handle;

    // --- resolve colisão com o controlador cinemático ---
    const wasGrounded = this.grounded;
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      interactionGroups(Groups.PLAYER, Groups.WORLD | Groups.BALL),
      ignoreBall ? (collider) => collider.handle !== ballHandle : undefined,
    );
    const moved = this.controller.computedMovement();
    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
    this.body.setNextKinematicTranslation(this.position);
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      if (!wasGrounded && this.velocity.y < -6) this.onEvent?.('land');
      this.velocity.y = 0;
    }
    // Bateu a cabeça em algo: zera a subida.
    if (desired.y > 0 && moved.y < desired.y * 0.5) this.velocity.y = Math.min(this.velocity.y, 0);

    this.updateGroundAlignment(dt);
  }

  /** Visual (a cada frame de render). */
  render(alpha: number, dt: number): void {
    const feet = this.renderPosition(alpha, tmpC);
    const root = this.model.root;
    root.position.copy(feet);

    const yaw = this.prevYaw + angleDelta(this.prevYaw, this.yaw) * alpha;
    // Alinha ao chão (normal suavizada) e depois aplica o yaw em torno dela.
    const align = new THREE.Quaternion().setFromUnitVectors(UP, this.groundUp);
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    root.quaternion.copy(align).multiply(turn);

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const ballVel = this.ball.velocity(tmpA);
    this.model.update(dt, {
      speed: horizontalSpeed,
      grounded: this.grounded,
      pushBlend: this.pushBlend,
      pushSpeed: Math.hypot(ballVel.x, ballVel.z) / Math.max(this.ball.radius, 0.3),
      verticalSpeed: this.velocity.y,
      strain: this.pushStrain,
    });
  }

  private canGrab(): boolean {
    const ballPos = this.ball.position(tmpC);
    const r = this.ball.radius;
    const dx = ballPos.x - this.position.x;
    const dz = ballPos.z - this.position.z;
    const horizontal = Math.hypot(dx, dz);
    const surfaceDistance = Math.hypot(horizontal, ballPos.y - this.position.y) - r - COLLIDER_RADIUS;
    // Precisa estar do lado da bola, não embaixo nem em cima dela.
    return surfaceDistance < GRAB_REACH && ballPos.y - r < this.position.y + 0.6 && ballPos.y + r > this.position.y - 0.3;
  }

  private startPush(): void {
    const ballPos = this.ball.position(tmpC);
    this.pushDir.set(ballPos.x - this.position.x, 0, ballPos.z - this.position.z);
    if (this.pushDir.lengthSq() < 1e-6) this.pushDir.copy(this.facing);
    this.pushDir.normalize();
    this.pushing = true;
    this.onEvent?.('grab');
  }

  releaseBall(): void {
    if (!this.pushing) return;
    this.pushing = false;
    this.pushStrain = 0;
    this.onEvent?.('release');
  }

  private updateWalk(dt: number, wish: THREE.Vector3, amount: number, run: boolean): THREE.Vector3 {
    const speed = run ? RUN_SPEED : WALK_SPEED;
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const targetX = wish.x * speed * amount;
    const targetZ = wish.z * speed * amount;
    const k = 1 - Math.exp((-accel / speed) * dt);
    this.velocity.x += (targetX - this.velocity.x) * k;
    this.velocity.z += (targetZ - this.velocity.z) * k;
    this.velocity.y -= GRAVITY * dt;
    this.velocity.y = Math.max(this.velocity.y, -40);

    if (amount > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 12, dt);

    // Encostou andando na bola: dá um empurrãozinho (sem agarrar).
    this.nudgeBall(dt, wish, amount);

    return new THREE.Vector3(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
  }

  private nudgeBall(dt: number, wish: THREE.Vector3, amount: number): void {
    if (amount < 0.1) return;
    const ballPos = this.ball.position(tmpC);
    const toBall = new THREE.Vector3(ballPos.x - this.position.x, 0, ballPos.z - this.position.z);
    const dist = toBall.length();
    if (dist > this.ball.radius + COLLIDER_RADIUS + 0.08) return;
    toBall.divideScalar(dist || 1);
    const along = wish.dot(toBall);
    if (along <= 0) return;
    // Força pequena: só uma bola pequena anda com cabeçada.
    const impulse = along * amount * 6 * dt * Math.min(this.ball.mass, 0.6);
    this.ball.body.applyImpulse({ x: toBall.x * impulse, y: 0, z: toBall.z * impulse }, true);
  }

  private updatePush(dt: number, wish: THREE.Vector3, amount: number, run: boolean): THREE.Vector3 {
    const ball = this.ball;
    const r = ball.radius;
    const ballPos = ball.position(tmpC);
    const ballVel = ball.velocity(new THREE.Vector3());

    // Direção de empurrar gira em direção ao input; bola grande = volante pesado.
    const pulling = amount > 0.1 && wish.dot(this.pushDir) < -0.55;
    if (amount > 0.1 && !pulling) {
      const current = Math.atan2(this.pushDir.x, this.pushDir.z);
      const target = Math.atan2(wish.x, wish.z);
      const turnRate = 3.4 / (1 + 0.3 * r);
      const delta = clamp(angleDelta(current, target), -turnRate * dt, turnRate * dt);
      const next = current + delta;
      this.pushDir.set(Math.sin(next), 0, Math.cos(next));
    }

    // Velocidade alvo da bola: menor e mais "pesada" quanto maior ela é.
    const sizeFactor = 1 / (1 + 0.24 * (r - 0.5));
    const maxSpeed = (run ? 4.4 : 3.1) * sizeFactor;
    const desiredVel = new THREE.Vector3();
    if (amount > 0.1) {
      if (pulling) desiredVel.copy(wish).multiplyScalar(maxSpeed * 0.45 * amount);
      else desiredVel.copy(this.pushDir).multiplyScalar(maxSpeed * amount * clamp(wish.dot(this.pushDir) + 0.4, 0.3, 1));
    }

    // Aceleração limitada (força do besouro / massa). Segurar sem input = freio.
    const accelLimit = 15 / (1 + 0.35 * r);
    const needed = new THREE.Vector3(desiredVel.x - ballVel.x, 0, desiredVel.z - ballVel.z).divideScalar(0.18);
    const neededLen = needed.length();
    const applied = Math.min(neededLen, accelLimit);
    if (neededLen > 1e-4) needed.multiplyScalar(applied / neededLen);
    const mass = ball.mass;
    ball.body.applyImpulse({ x: needed.x * mass * dt, y: 0, z: needed.z * mass * dt }, true);
    this.pushStrain = damp(this.pushStrain, clamp(neededLen / accelLimit, 0, 1) * (amount > 0.1 ? 1 : 0.3), 5, dt);

    // Besouro se posiciona atrás da bola (de ré) seguindo a direção de empurrar.
    // O traseiro encosta na bola perto do chão, onde a esfera é mais "estreita" que no equador:
    // raio horizontal da seção na altura do contato (bola grande = besouro bem mais perto do centro).
    const contactHeight = PUSH_CONTACT_HEIGHT;
    const sectionRadius = r > contactHeight ? Math.sqrt(2 * r * contactHeight - contactHeight * contactHeight) : r;
    const target = new THREE.Vector3().copy(ballPos).addScaledVector(this.pushDir, -(sectionRadius + COLLIDER_RADIUS + PUSH_GAP));
    const toTarget = new THREE.Vector3(target.x - this.position.x, 0, target.z - this.position.z);
    const dist = toTarget.length();
    if (dist > LOSE_GRIP_DISTANCE + r * 0.3 || ballPos.y - this.position.y > r + 1.5) {
      // A bola escapou (desceu ladeira, bateu e voltou...).
      this.releaseBall();
      return this.updateWalk(dt, wish, amount, run);
    }
    const followSpeed = Math.min(dist / dt, 11);
    if (dist > 1e-4) toTarget.multiplyScalar(followSpeed / dist);
    this.velocity.x = toTarget.x;
    this.velocity.z = toTarget.z;
    this.velocity.y -= GRAVITY * dt;
    this.velocity.y = Math.max(this.velocity.y, -40);

    // Cabeça para o lado oposto da bola.
    this.yaw = dampAngle(this.yaw, Math.atan2(-this.pushDir.x, -this.pushDir.z), 14, dt);

    return new THREE.Vector3(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
  }

  private updateGroundAlignment(dt: number): void {
    const ray = new RAPIER.Ray({ x: this.position.x, y: this.position.y, z: this.position.z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      COLLIDER_RADIUS + 0.6,
      true,
      undefined,
      interactionGroups(Groups.PLAYER, Groups.WORLD),
      this.collider,
    );
    const target = hit && this.grounded ? tmpA.set(hit.normal.x, hit.normal.y, hit.normal.z) : tmpA.copy(UP);
    // Limita a inclinação visual para ele não "deitar" em paredes.
    if (target.y < 0.6) target.lerp(UP, 0.5).normalize();
    this.groundUp.lerp(target, 1 - Math.exp(-10 * dt)).normalize();
  }
}
