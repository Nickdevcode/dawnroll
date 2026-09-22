import * as THREE from 'three';
import { Physics, FIXED_DT, RAPIER, Groups, interactionGroups } from './core/Physics';
import { Input } from './core/Input';
import { ThirdPersonCamera } from './core/ThirdPersonCamera';
import { Graphics } from './render/Graphics';
import { globalUniforms } from './render/shaderChunks';
import { Terrain, terrainHeight } from './world/Terrain';
import { Scenery } from './world/Scenery';
import { Grass } from './world/Grass';
import { GroundCover } from './world/GroundCover';
import { Collectibles, type StinkSource } from './world/Collectibles';
import { DungBall, START_RADIUS } from './entities/DungBall';
import { Beetle } from './entities/Beetle';
import { Effects, type EffectsFrame } from './fx/Effects';
import { Sfx } from './audio/Sfx';
import { Hud, type HintKind } from './ui/Hud';
import { quality } from './core/device';

/** Evita "espiral da morte" quando a aba volta do segundo plano. */
const MAX_FRAME_TIME = 0.1;
const FALL_LIMIT = -30;
/** Distância (do jogador) até onde os montinhos soltam fedor visível. */
const STINK_RANGE = 24;

/** Deixa o navegador pintar um frame (o loader continua animando entre as etapas pesadas). */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Orquestra tudo: laço de jogo com física em passo fixo + render interpolado,
 * estado de pausa, dicas de tutorial, efeitos e qualidade adaptativa.
 */
export class Game {
  private readonly graphics: Graphics;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private readonly cameraRig: ThirdPersonCamera;

  private physics!: Physics;
  private grass!: Grass;
  private groundCover!: GroundCover;
  private scenery!: Scenery;
  private collectibles!: Collectibles;
  private ball!: DungBall;
  private beetle!: Beetle;
  private effects!: Effects;

  private readonly spawn = new THREE.Vector3();
  private started = false;
  private startDisabled = true;
  private accumulator = 0;
  private lastTime = 0;
  private elapsed = 0;
  private pushTutorialTime = 0;
  private lastLookTime = 0;

  // Qualidade adaptativa (em até dois degraus)
  private perfSamples = 0;
  private perfTime = 0;
  private perfStage = 0;

  private readonly tmpPlayer = new THREE.Vector3();
  private readonly tmpBall = new THREE.Vector3();
  private readonly stink: StinkSource[] = [];
  private readonly frameInfo: EffectsFrame;

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.graphics = new Graphics(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(uiRoot, this.input);
    this.cameraRig = new ThirdPersonCamera(this.graphics.camera);

    this.frameInfo = {
      time: 0,
      camera: this.graphics.camera,
      pixelScale: 500,
      player: new THREE.Vector3(),
      playerVelocity: new THREE.Vector3(),
      playerGrounded: true,
      pushing: false,
      strain: 0,
      head: new THREE.Vector3(),
      ballPosition: new THREE.Vector3(),
      ballVelocity: new THREE.Vector3(),
      ballRadius: START_RADIUS,
      stink: this.stink,
    };

    this.hud.onStart = () => this.start();
    this.hud.onToggleSound = () => this.sfx.toggleMute();
    this.hud.onMilestone = () => {
      this.effects.celebrate(this.ball.root.position, this.ball.radius);
      this.sfx.pop();
    };
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.lastTime = 0;
      // No celular não existe Esc: sair do app (ou trocar de aba) pausa o jogo.
      if (this.started) this.hud.showStart(true);
    });
    window.addEventListener('keydown', (e) => {
      // Enter na tela inicial também começa (acessível pelo teclado).
      if (this.hud.isStartVisible && !this.startDisabled && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.start();
    });
  }

  async init(): Promise<void> {
    this.physics = await Physics.create();
    const scene = this.graphics.scene;
    await nextFrame();

    const terrain = new Terrain(this.physics, quality.terrainSegments);
    scene.add(terrain.mesh);
    await nextFrame();

    this.scenery = new Scenery(this.physics, quality.decorDensity);
    scene.add(this.scenery.group);
    terrain.paintContactShade(this.scenery.shades);
    await nextFrame();

    const solidAt = (margin: number) => (x: number, z: number) => this.scenery.isInsideSolid(x, z, margin);
    this.grass = new Grass(quality.grassCount, solidAt(0.1));
    scene.add(this.grass.group);
    this.groundCover = new GroundCover(quality.decorDensity, solidAt(0.25));
    scene.add(this.groundCover.group);
    await nextFrame();

    this.collectibles = new Collectibles(this.scenery);
    scene.add(this.collectibles.group);

    this.spawn.set(0, terrainHeight(0, 0), 0);
    const ballSpawn = new THREE.Vector3(0, terrainHeight(0, 1.6) + START_RADIUS + 0.05, 1.6);
    this.ball = new DungBall(this.physics, ballSpawn);
    scene.add(this.ball.root);

    this.beetle = new Beetle(this.physics, this.spawn, this.ball);
    scene.add(this.beetle.model.root);

    this.effects = new Effects({
      critters: quality.critters,
      motes: quality.motes,
      landingSpots: this.scenery.landingSpots,
      isGroundFree: (x, z) => !this.scenery.isInsideSolid(x, z, 0.5),
    });
    scene.add(this.effects.group);

    this.wireEvents();
    this.wireCameraCollision();
    await nextFrame();

    // Aquece shaders antes de mostrar (evita engasgo no primeiro frame).
    this.graphics.renderer.compile(scene, this.graphics.camera);

    this.startDisabled = false;
    this.hud.setLoaded();
    this.hud.setBall(this.ball.diameterCm, 0);
    requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) {
      // Handle de depuração para testes automatizados no navegador.
      (window as unknown as { __game: unknown; __terrainHeight: unknown }).__game = this;
      (window as unknown as { __terrainHeight: unknown }).__terrainHeight = terrainHeight;
    }
  }

  private wireEvents(): void {
    this.beetle.onEvent = (event) => {
      const feet = this.beetle.renderPosition(1, this.tmpPlayer);
      if (event === 'jump') {
        this.sfx.jump();
        this.effects.jump(feet);
      } else if (event === 'land') {
        this.sfx.land();
        const strength = THREE.MathUtils.clamp((this.beetle.landingSpeed - 6) / 10, 0, 1);
        this.effects.land(feet, strength);
        this.cameraRig.shake(0.04 + strength * 0.08);
      } else if (event === 'grab') {
        this.sfx.grab();
      }
    };
    this.collectibles.onCollect = (event) => {
      if (event.kind === 'dung') {
        this.sfx.squish(Math.min(this.ball.radius / 3, 1));
        this.effects.splat(event.position, event.size);
      } else {
        this.sfx.pop();
        this.effects.sparkle(event.position, event.color);
      }
    };
    this.ball.onImpact = (strength) => {
      if (strength > 0.25) {
        this.sfx.thud(strength);
        this.effects.impact(this.ball.position(this.tmpBall), this.ball.radius, strength);
        this.cameraRig.shake(strength * 0.12 * Math.min(1, this.ball.radius / 1.5));
      }
    };
  }

  /** A câmera consulta a física para não atravessar o cenário (só sólidos do mundo). */
  private wireCameraCollision(): void {
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const groups = interactionGroups(Groups.PLAYER, Groups.WORLD);
    this.cameraRig.obstruction = (origin, dir, maxDistance) => {
      ray.origin = { x: origin.x, y: origin.y, z: origin.z };
      ray.dir = { x: dir.x, y: dir.y, z: dir.z };
      const hit = this.physics.world.castRay(ray, maxDistance, true, undefined, groups);
      return hit ? hit.timeOfImpact : null;
    };
  }

  private start(): void {
    if (this.startDisabled) return;
    this.sfx.unlock();
    this.hud.hideStart();
    this.started = true;
    if (!this.hud.isTouch) this.input.requestPointerLock();
    this.canvas.focus();
  }

  private onPointerLockChange = (): void => {
    // Perdeu o mouse (Esc): pausa e mostra a tela de controles.
    if (!this.input.pointerLocked && this.started && !this.hud.isTouch) this.hud.showStart(true);
  };

  private get paused(): boolean {
    return this.hud.isStartVisible;
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const time = now / 1000;
    const frameTime = this.lastTime === 0 ? FIXED_DT : Math.min(time - this.lastTime, MAX_FRAME_TIME);
    this.lastTime = time;
    this.elapsed += frameTime;

    this.input.update();
    const look = this.input.consumeLook();

    if (!this.paused) {
      this.cameraRig.applyLook(look.x, look.y, look.zoom);
      // No toque, mirar com o dedão é trabalhoso: a câmera volta sozinha pra trás do besouro.
      if (this.hud.isTouch) {
        if (look.x !== 0 || look.y !== 0) this.lastLookTime = this.elapsed;
        if (this.elapsed - this.lastLookTime > 0.9) this.cameraRig.autoFollow(frameTime, this.beetle.travelDirection());
      }
      this.accumulator += frameTime;
      while (this.accumulator >= FIXED_DT) {
        this.fixedStep();
        this.accumulator -= FIXED_DT;
        // Eventos de "apertou" valem só para o primeiro passo do frame.
        this.input.state.jumpPressed = false;
        this.input.state.resetPressed = false;
      }
    } else {
      // Na tela inicial a câmera gira devagar em volta do besouro: vitrine do cenário.
      this.cameraRig.applyLook(-frameTime * 60 * 0.35, 0, 0);
    }

    const alpha = this.paused ? 1 : this.accumulator / FIXED_DT;
    this.renderFrame(alpha, frameTime);
    this.trackPerformance(frameTime);
  };

  private fixedStep(): void {
    const state = this.input.state;

    if (state.resetPressed) this.recoverBall();

    this.beetle.fixedUpdate(FIXED_DT, state, this.cameraRig.yaw);
    this.physics.step();
    this.ball.fixedUpdate(FIXED_DT);
    this.collectibles.fixedUpdate(FIXED_DT, this.ball, this.beetle.center);

    // Caiu para fora do mundo (não deveria, mas nunca confie em física).
    if (this.ball.position(this.tmpBall).y < FALL_LIMIT) this.recoverBall();
    if (this.beetle.center.y < FALL_LIMIT) this.beetle.teleport(this.spawn);

    if (this.beetle.pushing) this.pushTutorialTime += FIXED_DT;
  }

  /** Traz a bola para a frente do besouro. */
  private recoverBall(): void {
    this.beetle.releaseBall();
    const facing = this.beetle.facing;
    const r = this.ball.radius;
    const x = this.beetle.center.x + facing.x * (r + 1);
    const z = this.beetle.center.z + facing.z * (r + 1);
    this.ball.teleport(new THREE.Vector3(x, terrainHeight(x, z) + r + 0.4, z));
  }

  private renderFrame(alpha: number, dt: number): void {
    this.ball.render(alpha, dt);
    this.beetle.render(alpha, dt);

    const player = this.beetle.renderPosition(alpha, this.tmpPlayer);
    const ballPos = this.ball.root.position;
    this.cameraRig.update(dt, player, ballPos, this.ball.radius, this.beetle.pushing);
    this.graphics.followFocus(player);

    const camera = this.graphics.camera;
    globalUniforms.uTime.value = this.elapsed;
    const pushers = globalUniforms.uPushers.value;
    // Raio generoso: com a grama densa, o besouro precisa de uma clareira para aparecer.
    pushers[0].set(player.x, player.y, player.z, 0.95);
    pushers[1].set(ballPos.x, ballPos.y - this.ball.radius, ballPos.z, this.ball.radius * 1.05);
    this.grass.update(camera);
    this.groundCover.update(camera);
    this.graphics.setFocusDistance(camera.position.distanceTo(player));
    this.scenery.update(dt);
    this.collectibles.update(dt);
    this.updateEffects(dt, player);

    this.hud.setBall(this.ball.diameterCm, this.ball.dungCount);
    this.hud.setHint(this.computeHint());
    this.hud.update(dt);

    this.graphics.render(this.elapsed);
  }

  private updateEffects(dt: number, player: THREE.Vector3): void {
    const f = this.frameInfo;
    f.time = this.elapsed;
    f.pixelScale = this.graphics.pixelScale;
    f.player.copy(player);
    f.playerVelocity.copy(this.beetle.currentVelocity);
    f.playerGrounded = this.beetle.isGrounded;
    f.pushing = this.beetle.pushing && !this.paused;
    f.strain = this.beetle.pushStrength;
    this.beetle.model.getHeadPosition(f.head);
    f.ballPosition.copy(this.ball.root.position);
    this.ball.velocity(f.ballVelocity);
    f.ballRadius = this.ball.radius;
    this.collectibles.stinkSources(player, STINK_RANGE, this.stink);
    // Pausado, o mundo continua vivo (bichos, pólen), mas nada de poeira de passo.
    if (this.paused) f.playerVelocity.set(0, 0, 0);
    this.effects.update(dt, f);
  }

  private computeHint(): HintKind {
    if (this.paused) return 'none';
    if (this.beetle.pushing) return this.pushTutorialTime < 5 ? 'pushing' : 'none';
    const ballPos = this.ball.position(this.tmpBall);
    const dist = ballPos.distanceTo(this.beetle.center) - this.ball.radius;
    return dist < 1.4 ? 'grab' : 'none';
  }

  /**
   * Mede os primeiros segundos de jogo; se o aparelho não segurar ~40 fps,
   * desliga AO/DOF/bloom, reduz a resolução e afina a vegetação. Se mesmo assim
   * ficar abaixo de ~30 fps, desce mais um degrau (sombra menor, menos pixels).
   */
  private trackPerformance(frameTime: number): void {
    if (this.perfStage >= 2 || this.paused) return;
    this.perfTime += frameTime;
    this.perfSamples++;
    if (this.perfTime < 4) return;
    const fps = this.perfSamples / this.perfTime;
    this.perfTime = 0;
    this.perfSamples = 0;
    if (this.perfStage === 0) {
      if (fps >= 40) {
        this.perfStage = 2; // aguentou: não mede mais
        return;
      }
      this.graphics.setLowQuality(true);
      this.grass.setDensity(0.6);
      this.groundCover.setDensity(0.5);
      this.perfStage = 1;
    } else {
      if (fps < 30) {
        this.graphics.setMinimumQuality();
        this.grass.setDensity(0.35);
        this.groundCover.setDensity(0.3);
      }
      this.perfStage = 2;
    }
  }
}
