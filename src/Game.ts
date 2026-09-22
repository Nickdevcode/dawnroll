import * as THREE from 'three';
import { Physics, FIXED_DT } from './core/Physics';
import { Input } from './core/Input';
import { ThirdPersonCamera } from './core/ThirdPersonCamera';
import { Graphics } from './render/Graphics';
import { Terrain, terrainHeight } from './world/Terrain';
import { Scenery } from './world/Scenery';
import { Grass } from './world/Grass';
import { Collectibles } from './world/Collectibles';
import { DungBall, START_RADIUS } from './entities/DungBall';
import { Beetle } from './entities/Beetle';
import { Sfx } from './audio/Sfx';
import { Hud, type HintKind } from './ui/Hud';
import { quality } from './core/device';

/** Evita "espiral da morte" quando a aba volta do segundo plano. */
const MAX_FRAME_TIME = 0.1;
const FALL_LIMIT = -30;

/**
 * Orquestra tudo: laço de jogo com física em passo fixo + render interpolado,
 * estado de pausa, dicas de tutorial e qualidade adaptativa.
 */
export class Game {
  private readonly graphics: Graphics;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private readonly cameraRig: ThirdPersonCamera;

  private physics!: Physics;
  private grass!: Grass;
  private scenery!: Scenery;
  private collectibles!: Collectibles;
  private ball!: DungBall;
  private beetle!: Beetle;

  private readonly spawn = new THREE.Vector3();
  private started = false;
  private accumulator = 0;
  private lastTime = 0;
  private elapsed = 0;
  private pushTutorialTime = 0;
  private lastLookTime = 0;

  // Qualidade adaptativa
  private perfSamples = 0;
  private perfTime = 0;
  private perfChecked = false;

  private readonly tmpPlayer = new THREE.Vector3();
  private readonly tmpBall = new THREE.Vector3();
  private readonly pushers = [new THREE.Vector4(), new THREE.Vector4()];

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.graphics = new Graphics(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(uiRoot, this.input);
    this.cameraRig = new ThirdPersonCamera(this.graphics.camera);

    this.hud.onStart = () => this.start();
    this.hud.onToggleSound = () => this.sfx.toggleMute();
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.lastTime = 0;
      // No celular não existe Esc: sair do app (ou trocar de aba) pausa o jogo.
      if (this.started) this.hud.showStart(true);
    });
    window.addEventListener('keydown', (e) => {
      // Enter/Espaço na tela inicial também começa (acessível pelo teclado).
      if (this.hud.isStartVisible && !this.startDisabled && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.start();
    });
  }

  private startDisabled = true;

  async init(): Promise<void> {
    this.physics = await Physics.create();
    const scene = this.graphics.scene;

    const terrain = new Terrain(this.physics);
    scene.add(terrain.mesh);

    this.scenery = new Scenery(this.physics);
    scene.add(this.scenery.group);

    this.grass = new Grass(quality.grassCount);
    scene.add(this.grass.mesh);

    this.collectibles = new Collectibles(this.scenery);
    scene.add(this.collectibles.group);

    this.spawn.set(0, terrainHeight(0, 0), 0);
    const ballSpawn = new THREE.Vector3(0, terrainHeight(0, 1.6) + START_RADIUS + 0.05, 1.6);
    this.ball = new DungBall(this.physics, ballSpawn);
    scene.add(this.ball.root);

    this.beetle = new Beetle(this.physics, this.spawn, this.ball);
    scene.add(this.beetle.model.root);

    this.wireEvents();

    // Aquece shaders antes de mostrar (evita engasgo no primeiro frame).
    this.graphics.renderer.compile(scene, this.graphics.camera);

    this.startDisabled = false;
    this.hud.setLoaded();
    this.hud.setBall(this.ball.diameterCm, 0);
    requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) {
      // Handle de depuração para testes automatizados no navegador.
      (window as unknown as { __game: unknown }).__game = this;
    }
  }

  private wireEvents(): void {
    this.beetle.onEvent = (event) => {
      if (event === 'jump') this.sfx.jump();
      else if (event === 'land') this.sfx.land();
      else if (event === 'grab') this.sfx.grab();
    };
    this.collectibles.onCollect = (event) => {
      if (event.kind === 'dung') this.sfx.squish(Math.min(this.ball.radius / 3, 1));
      else this.sfx.pop();
    };
    this.ball.onImpact = (strength) => {
      if (strength > 0.25) this.sfx.thud(strength);
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

    this.pushers[0].set(player.x, player.y, player.z, 0.55);
    this.pushers[1].set(ballPos.x, ballPos.y - this.ball.radius, ballPos.z, this.ball.radius * 1.05);
    this.grass.update(this.elapsed, this.pushers);
    this.scenery.update(dt);
    this.collectibles.update(dt);

    this.hud.setBall(this.ball.diameterCm, this.ball.dungCount);
    this.hud.setHint(this.computeHint());
    this.hud.update(dt);

    this.graphics.render(this.elapsed);
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
   * desliga o AO e reduz a resolução.
   */
  private trackPerformance(frameTime: number): void {
    if (this.perfChecked || this.paused) return;
    this.perfTime += frameTime;
    this.perfSamples++;
    if (this.perfTime > 4) {
      this.perfChecked = true;
      const fps = this.perfSamples / this.perfTime;
      if (fps < 40) this.graphics.setLowQuality(true);
    }
  }
}
