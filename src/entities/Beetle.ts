import * as THREE from 'three';
import { RAPIER, GRAVITY, Groups, interactionGroups, type Physics } from '../core/Physics';
import type { InputState } from '../core/Input';
import { BeetleModel } from './BeetleModel';
import type { DungBall } from './DungBall';
import { clamp, damp, dampAngle, angleDelta } from '../utils/math';
import { neutralModifiers, type Modifiers } from '../progression/perks';

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

/** Equilibrista: até onde (da superfície da bola) dá pra pular pra cima dela. */
const MOUNT_REACH = 3.2;
/** Duração do pulinho de subir e do de descer (segundos), mais um tanto por unidade de raio da bola. */
const MOUNT_SECONDS = 0.38;
const DISMOUNT_SECONDS = 0.42;
const HOP_SECONDS_PER_RADIUS = 0.035;

export type BeetleEvent = 'jump' | 'land' | 'grab' | 'release' | 'mount' | 'dismount';

/**
 * Pulinho animado (subir/descer da bola). `from` e `to` são relativos ao centro da bola:
 * o besouro gira em volta dela (contornando a superfície) em vez de ir em linha reta — a
 * reta entre o chão e o topo passa por dentro da bola, e numa bola grande isso é bem no meio.
 */
interface Hop {
  /** Centro da bola quando o pulo começou (a descida gira em volta dele e pousa num ponto fixo). */
  readonly pivot: THREE.Vector3;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  t: number;
  duration: number;
  height: number;
  /** Subindo na bola: gira em volta do centro ATUAL (a bola pode estar rolando) até o topo. */
  mounting: boolean;
}

/** Solver do besouro no chão (encosta no mundo) e desligado (em cima da bola / nos pulinhos). */
const SOLVER_GROUND = interactionGroups(Groups.PLAYER, Groups.WORLD);
const SOLVER_OFF = interactionGroups(Groups.PLAYER, 0);

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

/** Entre dois pontos em volta de um centro: gira a direção e interpola a distância. */
function orbitLerp(from: THREE.Vector3, to: THREE.Vector3, t: number, target: THREE.Vector3): THREE.Vector3 {
  const fromLength = from.length();
  const toLength = to.length();
  const length = fromLength + (toLength - fromLength) * t;
  if (fromLength < 1e-6 || toLength < 1e-6) return target.lerpVectors(from, to, t);
  const angle = from.angleTo(to);
  target.copy(from).divideScalar(fromLength);
  tmpAxis.crossVectors(from, to);
  if (angle > 1e-4 && tmpAxis.lengthSq() > 1e-10) target.applyAxisAngle(tmpAxis.normalize(), angle * t);
  return target.multiplyScalar(length);
}

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
  /** Equilibrista: em cima da bola, andando nela. */
  riding = false;
  /** Velocidade de queda no último pouso (força da poeira/tremida). */
  landingSpeed = 0;
  /** Multiplicador de velocidade do terreno (água até a canela = mais devagar). O jogo atualiza a cada passo. */
  speedScale = 1;
  /** Nível e poderes da rodada (força, velocidade, giro). O jogo atualiza a cada passo. */
  modifiers: Modifiers = neutralModifiers();
  private pushBlend = 0;
  private readonly pushDir = new THREE.Vector3(0, 0, 1);
  private pushStrain = 0;
  /** Pulinho em andamento (subir ou descer da bola); null = controle normal. */
  private hop: Hop | null = null;
  /** Inclinação de equilíbrio em cima da bola (visual). */
  private readonly balance = new THREE.Vector3();
  private ridePhase = 0;
  /** Solver desligado agora (Equilibrista)? */
  private solverOff = false;

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
        // Atenção: a regra do solver vale dos dois lados e o grupo padrão da bola é "tudo" (inclui
        // WORLD), então o contato besouro–bola GERA força, com a massa infinita do corpo cinemático
        // (andar contra a bola empurra ela). Em cima da bola e nos pulinhos isso é desligado: ver `syncSolver`.
        .setSolverGroups(SOLVER_GROUND),
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

  /** Velocidade atual (para poeira dos passos). */
  get currentVelocity(): THREE.Vector3 {
    return this.velocity;
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
    if (this.riding) {
      const v = this.ball.velocity(tmpB);
      const speed = Math.hypot(v.x, v.z);
      return speed > 0.4 ? new THREE.Vector3(v.x / speed, 0, v.z / speed) : null;
    }
    if (this.pushing) {
      const v = this.ball.velocity(tmpB);
      return Math.hypot(v.x, v.z) > 0.4 ? this.pushDir.clone() : null;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    return speed > 1 ? new THREE.Vector3(this.velocity.x / speed, 0, this.velocity.z / speed) : null;
  }

  teleport(feet: THREE.Vector3): void {
    this.riding = false;
    this.hop = null;
    this.position.copy(feet).add(tmpA.set(0, COLLIDER_RADIUS + 0.05, 0));
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.body.setNextKinematicTranslation(this.position);
    this.body.setTranslation(this.position, true);
    this.releaseBall();
    this.syncSolver();
  }

  /**
   * Subindo, em cima ou descendo da bola, o besouro não troca força com nada. O pulinho de
   * subir atravessa a bola a ~40 un/s, e o contato cinemático (massa infinita) arremessava a
   * bola — com o besouro em cima — pra fora do jardim quando ela era grande.
   */
  private syncSolver(): void {
    const off = this.riding || this.hop !== null;
    if (off === this.solverOff) return;
    this.solverOff = off;
    this.collider.setSolverGroups(off ? SOLVER_OFF : SOLVER_GROUND);
  }

  /** Perto o bastante da bola (e com ela inteira) pra pular em cima dela? */
  canMount(): boolean {
    if (this.riding || this.hop || !this.ball.isSolid) return false;
    const c = this.ball.position(tmpC);
    const surface = Math.hypot(c.x - this.position.x, c.y - this.position.y, c.z - this.position.z) - this.ball.radius - COLLIDER_RADIUS;
    return surface < MOUNT_REACH;
  }

  /** Equilibrista: pula pra cima da bola (solta a bola se estava empurrando). */
  mount(): boolean {
    if (!this.canMount()) return false;
    this.releaseBall();
    this.riding = true;
    const c = this.ball.position(new THREE.Vector3());
    this.hop = {
      pivot: c,
      from: this.position.clone().sub(c),
      to: this.rideTop(new THREE.Vector3()).sub(c),
      t: 0,
      duration: MOUNT_SECONDS + this.ball.radius * HOP_SECONDS_PER_RADIUS,
      height: 0.9,
      mounting: true,
    };
    this.syncSolver();
    this.velocity.set(0, 0, 0);
    this.onEvent?.('mount');
    return true;
  }

  /**
   * Desce da bola: pulinho pra trás dela (o lado oposto ao que o besouro olha),
   * pousando no que tiver embaixo (chão ou pedra) — conferido com um raio.
   */
  dismount(): void {
    if (!this.riding) return;
    this.riding = false;
    const c = this.ball.position(tmpC);
    const r = this.ball.radius;
    const back = tmpA.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const land = new THREE.Vector3(c.x + back.x * (r + 0.9), c.y + r + 2, c.z + back.z * (r + 0.9));
    const ray = new RAPIER.Ray({ x: land.x, y: land.y, z: land.z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, r * 2 + 40, true, undefined, interactionGroups(Groups.PLAYER, Groups.WORLD), this.collider);
    land.y = hit ? land.y - hit.timeOfImpact + COLLIDER_RADIUS + 0.05 : c.y - r + COLLIDER_RADIUS + 0.05;
    this.hop = {
      pivot: c.clone(),
      from: this.position.clone().sub(c),
      to: land.sub(c),
      t: 0,
      duration: DISMOUNT_SECONDS + r * HOP_SECONDS_PER_RADIUS,
      height: 0.7 + r * 0.15,
      mounting: false,
    };
    this.velocity.set(0, 0, 0);
    this.onEvent?.('dismount');
  }

  /** Ponto em cima da bola onde o besouro fica (centro do colisor). */
  private rideTop(target: THREE.Vector3): THREE.Vector3 {
    const c = this.ball.position(tmpC);
    return target.set(c.x, c.y + this.ball.radius + COLLIDER_RADIUS - 0.05, c.z);
  }

  /** De pé em cima da bola SEM o poder (subiu pulando)? Pra conquista secreta. */
  get standingOnBall(): boolean {
    if (this.riding || this.hop || !this.grounded || !this.ball.isSolid) return false;
    const c = this.ball.position(tmpC);
    const r = this.ball.radius;
    return this.position.y > c.y + r * 0.75 && Math.hypot(this.position.x - c.x, this.position.z - c.z) < r * 0.6;
  }

  fixedUpdate(dt: number, input: InputState, cameraYaw: number): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    this.syncSolver();

    // Direção desejada relativa à câmera.
    const forward = tmpA.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = tmpB.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const wish = new THREE.Vector3().addScaledVector(forward, input.moveY).addScaledVector(right, input.moveX);
    const wishAmount = Math.min(wish.length(), 1);
    if (wishAmount > 1e-3) wish.divideScalar(wish.length());

    // --- Equilibrista: pulinho de subir/descer e o andar em cima da bola ---
    if (this.hop) {
      this.updateHop(dt);
      return;
    }
    if (this.riding) {
      // Pular (ou a bola sumir na toca) desce da bola.
      if (input.jumpPressed || !this.ball.isSolid) this.dismount();
      else this.updateRide(dt, wish, wishAmount, input.run);
      return;
    }

    // --- pulo com coyote time e buffer ---
    this.jumpBuffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // --- agarrar / soltar ---
    if (input.grab && !this.pushing && this.canGrab()) this.startPush();
    if ((!input.grab || !this.ball.isSolid) && this.pushing) this.releaseBall();

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
    // Bola sendo enterrada não empurra ninguém (ela está afundando na toca).
    const overlap = this.ball.isSolid ? minDist - Math.hypot(away.x, away.z, this.position.y - ballPos.y) : -1;
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
      if (!wasGrounded && this.velocity.y < -6) {
        this.landingSpeed = -this.velocity.y;
        this.onEvent?.('land');
      }
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

    const ballVel = this.ball.velocity(tmpA);
    // Em cima da bola as patas andam na velocidade da superfície dela (esteira).
    const horizontalSpeed = this.riding ? Math.hypot(ballVel.x, ballVel.z) : Math.hypot(this.velocity.x, this.velocity.z);
    this.model.update(dt, {
      speed: horizontalSpeed,
      grounded: this.grounded || this.riding,
      pushBlend: this.pushBlend,
      pushSpeed: Math.hypot(ballVel.x, ballVel.z) / Math.max(this.ball.radius, 0.3),
      verticalSpeed: this.velocity.y,
      strain: this.pushStrain,
    });
  }

  /** Pulinho de subir/descer: arco animado, sem colisão (o destino da descida já foi conferido). */
  private updateHop(dt: number): void {
    const hop = this.hop!;
    hop.t = Math.min(1, hop.t + dt / hop.duration);
    const k = hop.t;
    const eased = k * k * (3 - 2 * k);
    // Subindo, a bola continua rolando: gira em volta do centro de agora, até o topo.
    const pivot = hop.mounting ? this.ball.position(tmpC) : hop.pivot;
    const offset = orbitLerp(hop.from, hop.to, eased, tmpB);
    // O "pulinho" sai pra fora da bola (no topo é pra cima; no meio da descida, pro lado).
    offset.setLength(offset.length() + Math.sin(Math.PI * k) * hop.height);
    this.position.copy(pivot).add(offset);
    // A bola pode ter rolado pra dentro do caminho da descida: o besouro não entra nela.
    if (this.ball.isSolid) {
      const c = this.ball.position(tmpC);
      const surface = this.ball.radius + COLLIDER_RADIUS - 0.05;
      const out = tmpA.subVectors(this.position, c);
      const distance = out.length();
      if (distance < surface && distance > 1e-4) this.position.copy(c).addScaledVector(out, surface / distance);
    }
    this.body.setNextKinematicTranslation(this.position);
    this.grounded = false;
    this.pushBlend = damp(this.pushBlend, 0, 9, dt);
    const dx = hop.to.x - hop.from.x;
    const dz = hop.to.z - hop.from.z;
    if (!hop.mounting && dx * dx + dz * dz > 1e-4) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    this.updateGroundAlignment(dt);
    if (k < 1) return;
    this.hop = null;
    if (!hop.mounting) {
      this.grounded = true;
      this.airTime = 0;
      this.velocity.set(0, 0, 0);
      this.landingSpeed = 7;
      this.onEvent?.('land');
    }
  }

  /**
   * Em cima da bola: o besouro anda e a bola rola embaixo dele, na direção que
   * o jogador aponta (como um equilibrista de circo). A força segue a mesma
   * regra do empurrar (limitada, mais fraca com bola grande), um pouco mais
   * solta pra ser divertido.
   */
  private updateRide(dt: number, wish: THREE.Vector3, amount: number, run: boolean): void {
    const ball = this.ball;
    const r = ball.radius;
    const ballVel = ball.velocity(tmpB);
    const sizeFactor = 1 / (1 + 0.24 * (Math.min(r, 3) - 0.5));
    const maxSpeed = (run ? 5 : 3.6) * sizeFactor * this.modifiers.pushSpeed;
    const desired = tmpA.copy(wish).multiplyScalar(amount > 0.1 ? maxSpeed * amount : 0);
    const accelLimit = (17 / (1 + 0.3 * r)) * this.modifiers.push;
    const needed = new THREE.Vector3(desired.x - ballVel.x, 0, desired.z - ballVel.z).divideScalar(0.2);
    const neededLen = needed.length();
    if (neededLen > 1e-4) needed.multiplyScalar(Math.min(neededLen, accelLimit) / neededLen);
    ball.body.applyImpulse({ x: needed.x * ball.mass * dt, y: 0, z: needed.z * ball.mass * dt }, true);
    this.pushStrain = damp(this.pushStrain, clamp(neededLen / accelLimit, 0, 1) * (amount > 0.1 ? 0.6 : 0.2), 5, dt);

    this.rideTop(this.position);
    this.body.setNextKinematicTranslation(this.position);
    this.velocity.set(ballVel.x, 0, ballVel.z);
    this.grounded = true;
    this.airTime = 0;
    this.pushBlend = damp(this.pushBlend, 0, 9, dt);
    if (amount > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 10, dt);

    // Equilíbrio: o corpo inclina contra a aceleração e balança de leve.
    this.ridePhase += dt;
    const wobble = Math.sin(this.ridePhase * 6) * 0.06;
    this.balance.set(-needed.x * 0.012 + Math.cos(this.yaw) * wobble, 1, -needed.z * 0.012 - Math.sin(this.yaw) * wobble).normalize();
    this.groundUp.lerp(this.balance, 1 - Math.exp(-8 * dt)).normalize();
  }

  private canGrab(): boolean {
    if (!this.ball.isSolid) return false;
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
    const speed = (run ? RUN_SPEED : WALK_SPEED) * this.speedScale * this.modifiers.walk;
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
      const turnRate = (3.4 / (1 + 0.3 * r)) * this.modifiers.turn;
      const delta = clamp(angleDelta(current, target), -turnRate * dt, turnRate * dt);
      const next = current + delta;
      this.pushDir.set(Math.sin(next), 0, Math.cos(next));
    }

    // Velocidade alvo da bola: menor e mais "pesada" quanto maior ela é — até ~12 cm;
    // daí em diante estabiliza (bola gigante cobre mais chão por volta, não pode virar lesma).
    const sizeFactor = 1 / (1 + 0.24 * (Math.min(r, 3) - 0.5));
    const maxSpeed = (run ? 4.4 : 3.1) * sizeFactor * this.speedScale * this.modifiers.pushSpeed;
    const desiredVel = new THREE.Vector3();
    if (amount > 0.1) {
      if (pulling) desiredVel.copy(wish).multiplyScalar(maxSpeed * 0.45 * amount);
      else desiredVel.copy(this.pushDir).multiplyScalar(maxSpeed * amount * clamp(wish.dot(this.pushDir) + 0.4, 0.3, 1));
    }

    // Aceleração limitada (força do besouro / massa). Segurar sem input = freio.
    const accelLimit = (15 / (1 + 0.35 * r)) * this.modifiers.push;
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
