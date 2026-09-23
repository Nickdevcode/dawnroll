import * as THREE from 'three';
import { Physics, FIXED_DT, RAPIER, Groups, interactionGroups } from './core/Physics';
import { Input } from './core/Input';
import { ThirdPersonCamera } from './core/ThirdPersonCamera';
import { loadSave, writeSave, type SaveData } from './core/save';
import { settings, nativePixelRatio, type GameSettings } from './core/settings';
import { Graphics, type RenderOptions } from './render/Graphics';
import { globalUniforms } from './render/shaderChunks';
import { Terrain, terrainHeight, terrainNormal, dirtAmount, BURROW } from './world/Terrain';
import { Scenery } from './world/Scenery';
import { Grass } from './world/Grass';
import { GroundCover } from './world/GroundCover';
import { Collectibles, type StinkSource } from './world/Collectibles';
import { Pickables } from './world/Pickables';
import { Burrow, MIN_BURY_RADIUS } from './world/Burrow';
import { Weather } from './world/Weather';
import { Puddles } from './world/Puddles';
import { sphereVolume } from './world/scenery/context';
import { DungBall, START_RADIUS } from './entities/DungBall';
import { Beetle } from './entities/Beetle';
import { Effects, type EffectsFrame } from './fx/Effects';
import type { SurfaceProbe } from './fx/Rain';
import { GameAudio } from './audio/GameAudio';
import type { AudioFrame } from './audio/frame';
import { Hud, type HintKind } from './ui/Hud';
import { Menu } from './ui/Menu';
import { t } from './i18n';
import { quality } from './core/device';
import { clamp } from './utils/math';

/** Evita "espiral da morte" quando a aba volta do segundo plano. */
const MAX_FRAME_TIME = 0.1;
const FALL_LIMIT = -30;
/** Distância (do jogador) até onde os montinhos soltam fedor visível. */
const STINK_RANGE = 24;
/** Quanto uma dica "de evento" (bola pequena demais...) continua na tela depois de acontecer. */
const EVENT_HINT_SECONDS = 1.6;
/** Perto assim da toca, o anel no chão já faz o papel do marcador. */
const MARKER_HIDE_DISTANCE = 7;

/** Deixa o navegador pintar um frame (o loader continua animando entre as etapas pesadas). */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Orquestra tudo: laço de jogo com física em passo fixo + render interpolado,
 * rodadas (crescer → enterrar na toca → jardim refeito), clima, dicas, efeitos
 * e qualidade adaptativa.
 */
export class Game {
  private readonly graphics: Graphics;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly audio: GameAudio;
  private readonly cameraRig: ThirdPersonCamera;
  private readonly weather = new Weather();
  private readonly save: SaveData = loadSave();

  private physics!: Physics;
  private grass!: Grass;
  private groundCover!: GroundCover;
  private scenery!: Scenery;
  private collectibles!: Collectibles;
  private pickables!: Pickables;
  private burrow!: Burrow;
  private puddles!: Puddles;
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

  // Estado de água/lama (passo fixo → efeitos e dicas).
  private ballWater = 0;
  private playerWater = 0;
  private ballWasWet = false;
  private playerWasWet = false;
  private dissolving = false;
  private tooSmallTimer = 0;
  private tooSmallCm = 0;
  private burrowHintTimer = 0;
  private digSoundToggle = false;

  // Qualidade adaptativa (só no "Auto", em até dois degraus)
  private perfSamples = 0;
  private perfTime = 0;
  private perfStage = 0;
  /** Degrau que a qualidade adaptativa já desceu (0 = nada). */
  private adaptiveLevel = 0;
  // Contador de FPS do HUD (média de meio segundo).
  private fpsFrames = 0;
  private fpsTime = 0;

  private readonly tmpPlayer = new THREE.Vector3();
  private readonly tmpBall = new THREE.Vector3();
  private readonly tmpFocus = new THREE.Vector3();
  private readonly tmpMarker = new THREE.Vector3();
  private readonly stink: StinkSource[] = [];
  private readonly frameInfo: EffectsFrame;
  private readonly audioFrame: AudioFrame;
  private readonly surfaceHit = { y: 0, water: false, normal: new THREE.Vector3(0, 1, 0) };

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.graphics = new Graphics(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(uiRoot, this.input);
    this.menu = new Menu(uiRoot, this.hud.isTouch);
    this.cameraRig = new ThirdPersonCamera(this.graphics.camera);
    this.audio = new GameAudio(uiRoot);

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
      rain: 0,
      wetness: 0,
      puddles: [],
      playerWater: 0,
      ballWater: 0,
    };
    this.audioFrame = {
      scene: this.frameInfo,
      paused: true,
      footfalls: 0,
      feetClearance: 0,
      playerDirt: 0,
      ballDirt: 0,
      ballSolid: true,
      ballClearance: 0,
      ballDissolving: false,
      ballItems: 0,
      ballDiameterCm: START_RADIUS * 4,
      burying: false,
      overcast: 0,
    };

    this.menu.onPlay = () => this.start();
    this.hud.onOpenMenu = () => this.pause();
    this.hud.onToggleSound = () => {
      const muted = !settings.get().muted;
      settings.update({ muted });
      return muted;
    };
    this.hud.onMilestone = (index) => {
      this.effects.celebrate(this.ball.root.position, this.ball.radius);
      this.audio.milestone(index);
    };
    this.weather.onThunder = (distance) => this.audio.thunder(distance);
    this.input.gamepad.onConnectionChange = (connected, style) => {
      this.menu.setGamepad(connected ? style : null);
      if (connected) {
        this.hud.notify(t('gamepad.connected'));
        this.audio.notify();
      }
    };
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.lastTime = 0;
      // No celular não existe Esc: sair do app (ou trocar de aba) pausa o jogo.
      if (this.started) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      // Enter na tela inicial também começa (acessível pelo teclado).
      if (this.menu.isVisible && !this.startDisabled && document.activeElement === document.body && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.start();
      // Atalho de desenvolvimento: F8 adianta o tempo para a próxima fase (sol → nublando → chuva...).
      if (import.meta.env.DEV && e.code === 'F8') this.weather.skipAhead();
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
    this.pickables = new Pickables(this.physics, this.scenery);
    this.burrow = new Burrow();
    scene.add(this.burrow.group);
    this.puddles = new Puddles();
    scene.add(this.puddles.group);
    this.frameInfo.puddles = this.puddles.states;

    this.spawn.set(0, terrainHeight(0, 0), 0);
    const ballSpawn = new THREE.Vector3(0, terrainHeight(0, 1.6) + START_RADIUS + 0.05, 1.6);
    this.ball = new DungBall(this.physics, ballSpawn);
    scene.add(this.ball.root);

    this.beetle = new Beetle(this.physics, this.spawn, this.ball);
    scene.add(this.beetle.model.root);

    const surface: SurfaceProbe = (x, z) => {
      const water = this.puddles.surfaceAt(x, z);
      const hit = this.surfaceHit;
      hit.water = water !== null;
      hit.y = water ?? terrainHeight(x, z);
      if (hit.water) hit.normal.set(0, 1, 0);
      else terrainNormal(x, z, hit.normal);
      return hit;
    };
    this.effects = new Effects({
      critters: quality.critters,
      motes: quality.motes,
      rainDrops: quality.rainDrops,
      rainSplashes: quality.rainSplashes,
      landingSpots: this.scenery.landingSpots,
      isGroundFree: (x, z) => !this.scenery.isInsideSolid(x, z, 0.5) && !this.scenery.isDug(x, z),
      surface,
      sounds: this.audio.critterSounds,
    });
    scene.add(this.effects.group);

    this.wireEvents();
    this.wireCameraCollision();
    await nextFrame();

    // Aquece shaders antes de mostrar (evita engasgo no primeiro frame).
    this.graphics.renderer.compile(scene, this.graphics.camera);

    this.startDisabled = false;
    this.applySettings(settings.get());
    settings.subscribe((s, changed) => this.applySettings(s, changed));
    this.hud.setLoaded();
    this.menu.setReady();
    this.hud.setBall(this.ball.diameterCm, 0, 0);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) {
      // Handle de depuração para testes automatizados no navegador.
      (window as unknown as { __game: unknown; __terrainHeight: unknown }).__game = this;
      (window as unknown as { __terrainHeight: unknown }).__terrainHeight = terrainHeight;
      (window as unknown as { __audio: unknown }).__audio = this.audio;
    }
  }

  private wireEvents(): void {
    this.beetle.onEvent = (event) => {
      const feet = this.beetle.renderPosition(1, this.tmpPlayer);
      if (event === 'jump') {
        this.audio.jump(feet);
        this.effects.jump(feet);
      } else if (event === 'land') {
        const strength = THREE.MathUtils.clamp((this.beetle.landingSpeed - 6) / 10, 0, 1);
        this.audio.land(feet, strength);
        this.effects.land(feet, strength);
        this.cameraRig.shake(0.04 + strength * 0.08);
      } else if (event === 'grab') {
        this.audio.grab(feet);
      } else if (event === 'release') {
        this.audio.release(feet);
      }
    };
    this.collectibles.onCollect = (event) => {
      this.audio.collect(event, this.ball.radius);
      if (event.kind === 'dung') this.effects.splat(event.position, event.size);
      else this.effects.sparkle(event.position, event.color);
    };
    this.pickables.onPick = (event) => {
      this.audio.pluck(event);
      this.effects.pluck(event.ground, event.position, event.tint, event.size, event.kind === 'flower');
      this.effects.startle(event.ground, 4 + event.size * 2);
      this.cameraRig.shake(0.03 + Math.min(event.size, 3) * 0.03);
      this.rumble(0.25 + Math.min(event.size, 3) * 0.15, 0.5, 140);
    };
    this.ball.onImpact = (strength) => {
      if (strength > 0.25) {
        const at = this.ball.position(this.tmpBall);
        this.audio.impact(at, strength, this.ball.radius);
        this.effects.impact(at, this.ball.radius, strength);
        this.effects.startle(at, 2 + this.ball.radius);
        this.cameraRig.shake(strength * 0.12 * Math.min(1, this.ball.radius / 1.5));
        this.rumble(strength * 0.7, strength * 0.4, 110);
      }
    };
    this.ball.onShed = (at) => {
      this.effects.shed(at);
      this.audio.shed(at);
    };

    this.burrow.onBurialStart = (at, radius) => {
      this.audio.burialStart(at, radius);
      this.effects.startle(at, 6 + radius);
      this.cameraRig.shake(0.05);
      this.rumble(0.2, 0.45, 1800);
    };
    this.burrow.onDig = (at, strength) => {
      this.effects.dig(at, strength);
      // Som de terra a cada dois torrões (senão vira chiado contínuo).
      this.digSoundToggle = !this.digSoundToggle;
      if (this.digSoundToggle) this.audio.dig(at, strength);
      this.cameraRig.shake(0.012 + strength * 0.012);
    };
    this.burrow.onBuried = (result, at) => this.finishRound(result, at);
    this.burrow.onFinished = () => this.startNewRound();
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
    // Jogar/Continuar é um gesto: garante o áudio de pé e faz amanhecer.
    this.audio.unlock();
    this.audio.setPaused(false);
    this.menu.hide();
    this.hud.setVisible(true);
    this.started = true;
    if (!this.hud.isTouch) this.input.requestPointerLock();
    this.canvas.focus();
  }

  private onPointerLockChange = (): void => {
    // Perdeu o mouse (Esc): pausa e mostra a tela de controles.
    if (!this.input.pointerLocked && this.started && !this.hud.isTouch) this.pause();
  };

  /**
   * Controle: Start pausa/continua; com o menu aberto, direções/A/B navegam nele.
   * Nada do que se aperta no menu vaza pro jogo (o A que escolhe "Jogar" não vira pulo).
   */
  private handleGamepadMenu(): void {
    if (!this.paused) {
      if (this.input.pausePressed) this.pause();
      return;
    }
    const state = this.input.state;
    state.jumpPressed = false;
    state.resetPressed = false;
    if (this.startDisabled) return;
    for (const action of this.input.menuActions) {
      if (action === 'start') {
        this.start();
        return;
      }
      const used = this.menu.handleGamepad(action);
      // B sem placa aberta = continuar o jogo (se já tinha começado).
      if (!used && action === 'back' && this.started) {
        this.start();
        return;
      }
    }
  }

  /** Vibração do controle, se o jogador está nele e não desligou nas configurações. */
  private rumble(strong: number, weak: number, durationMs: number): void {
    if (this.input.device !== 'gamepad' || !settings.get().gamepadVibration) return;
    this.input.gamepad.rumble(strong, weak, durationMs);
  }

  /** Pausa: a noite cai sobre o jardim e o menu volta (com "Continuar"). */
  private pause(): void {
    if (this.menu.isVisible) return;
    if (this.input.pointerLocked) document.exitPointerLock();
    this.menu.show(true);
    this.audio.setPaused(true);
    this.hud.setVisible(false);
  }

  private get paused(): boolean {
    return this.menu.isVisible;
  }

  /**
   * Aplica as configurações (na hora, sem recarregar). `changed` diz o que mudou;
   * sem ele, aplica tudo (primeira vez).
   */
  private applySettings(s: Readonly<GameSettings>, changed?: ReadonlySet<keyof GameSettings>): void {
    const has = (...keys: Array<keyof GameSettings>) => !changed || keys.some((k) => changed.has(k));
    if (has('quality', 'resolution', 'shadows', 'ambientOcclusion', 'depthOfField', 'bloom', 'grassDensity')) {
      // Qualidade manual desliga a adaptativa (e desfaz o que ela tinha baixado).
      if (s.quality !== 'auto') {
        this.adaptiveLevel = 0;
        this.perfStage = 2;
      } else if (changed?.has('quality')) {
        this.adaptiveLevel = 0;
        this.perfStage = 0;
        this.perfTime = 0;
        this.perfSamples = 0;
      }
      this.applyRender(s);
    }
    if (has('masterVolume', 'musicVolume', 'effectsVolume', 'ambienceVolume')) {
      this.audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, effects: s.effectsVolume, ambience: s.ambienceVolume });
    }
    if (has('muted')) {
      this.audio.setMuted(s.muted);
      this.hud.setMuted(s.muted);
    }
    this.cameraRig.sensitivity = s.mouseSensitivity;
    this.cameraRig.invertY = s.invertY;
    this.cameraRig.shakeEnabled = s.cameraShake;
    if (has('showFps') && !s.showFps) this.hud.setFps(null);
  }

  /** Configurações gráficas + o degrau da qualidade adaptativa → renderizador e vegetação. */
  private applyRender(s: Readonly<GameSettings>): void {
    const options: RenderOptions = {
      pixelRatio: nativePixelRatio() * s.resolution,
      shadows: s.shadows,
      ambientOcclusion: s.ambientOcclusion,
      depthOfField: s.depthOfField,
      bloom: s.bloom,
    };
    let grass = s.grassDensity;
    if (this.adaptiveLevel >= 1) {
      options.ambientOcclusion = false;
      options.depthOfField = false;
      options.bloom = false;
      options.pixelRatio = Math.min(options.pixelRatio, 1);
      if (options.shadows === 'high') options.shadows = 'low';
      grass *= 0.6;
    }
    if (this.adaptiveLevel >= 2) {
      options.pixelRatio = Math.min(options.pixelRatio, 0.8);
      grass *= 0.6;
    }
    this.graphics.configure(options);
    this.grass.setDensity(grass);
    this.groundCover.setDensity(Math.min(1, grass * 0.9));
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const time = now / 1000;
    const frameTime = this.lastTime === 0 ? FIXED_DT : Math.min(time - this.lastTime, MAX_FRAME_TIME);
    this.lastTime = time;
    this.elapsed += frameTime;

    this.input.update();
    const look = this.input.consumeLook();
    this.hud.setInputDevice(this.input.device, this.input.gamepad.style);
    this.handleGamepadMenu();

    if (!this.paused) {
      this.cameraRig.applyLook(look.x, look.y, look.zoom);
      // No toque, mirar com o dedão é trabalhoso: a câmera volta sozinha pra trás do besouro.
      if (this.hud.isTouch || this.input.device === 'gamepad') {
        if (look.x !== 0 || look.y !== 0) this.lastLookTime = this.elapsed;
        if (this.elapsed - this.lastLookTime > 0.9) this.cameraRig.autoFollow(frameTime, this.beetle.travelDirection());
      }
      this.weather.update(frameTime);
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

    this.applyWeather();
    const alpha = this.paused ? 1 : this.accumulator / FIXED_DT;
    this.renderFrame(alpha, frameTime);
    this.trackPerformance(frameTime);
    this.countFps(frameTime);
  };

  private fixedStep(): void {
    const state = this.input.state;

    if (state.resetPressed && !this.burrow.isBusy) this.recoverBall();

    // A toca vem antes da física: durante o enterro é ela quem conduz a bola.
    this.burrow.fixedUpdate(FIXED_DT, this.ball);
    this.applyWaterAndMud(FIXED_DT);
    this.beetle.fixedUpdate(FIXED_DT, state, this.cameraRig.yaw);
    this.physics.step();
    this.ball.fixedUpdate(FIXED_DT);
    this.collectibles.fixedUpdate(FIXED_DT, this.ball, this.beetle.center);
    this.pickables.fixedUpdate(this.ball);

    // Caiu para fora do mundo (não deveria, mas nunca confie em física).
    if (this.ball.isSolid && this.ball.position(this.tmpBall).y < FALL_LIMIT) this.recoverBall();
    if (this.beetle.center.y < FALL_LIMIT) this.beetle.teleport(this.spawn);

    if (this.beetle.pushing) this.pushTutorialTime += FIXED_DT;
    this.tooSmallTimer = Math.max(0, this.tooSmallTimer - FIXED_DT);
    if (this.pickables.blockedBySize > 0) {
      this.tooSmallTimer = EVENT_HINT_SECONDS;
      this.tooSmallCm = this.pickables.blockedBySize * 4;
    }
    this.burrowHintTimer = this.burrow.tooSmall ? EVENT_HINT_SECONDS : Math.max(0, this.burrowHintTimer - FIXED_DT);
  }

  /**
   * Poças e lama: a água derrete a bola (mais rápido quanto mais dela afunda) e
   * freia; o besouro anda mais devagar com água na canela; terra molhada gruda
   * na bola (engorda um pouco, mas pesa).
   */
  private applyWaterAndMud(dt: number): void {
    const ball = this.ball;
    const p = ball.position(this.tmpBall);
    const r = ball.radius;
    const surface = this.puddles.surfaceAt(p.x, p.z);
    this.ballWater = surface !== null && ball.isSolid ? Math.max(0, surface - (p.y - r)) : 0;
    const submersion = clamp(this.ballWater / (2 * r), 0, 1);
    const speed = Math.hypot(ball.body.linvel().x, ball.body.linvel().z);

    let drag = submersion * 3.2;
    this.dissolving = false;
    if (submersion > 0.02) {
      // Perde volume pela área molhada (bola pequena derrete rápido; gigante quase nada).
      ball.removeVolume(1.35 * submersion * r * r * dt);
      this.dissolving = r > START_RADIUS * 1.08;
    } else if (ball.isSolid && this.weather.wetness > 0.2 && speed > 0.3) {
      const onGround = p.y - r - terrainHeight(p.x, p.z) < 0.2;
      const dirt = dirtAmount(p.x, p.z);
      if (onGround && dirt > 0.3) {
        ball.addVolume(0.018 * speed * this.weather.wetness * dirt * r * dt);
        drag += 0.5 * this.weather.wetness * dirt;
      }
    }
    ball.extraDrag = drag;

    const wet = this.ballWater > 0.03;
    if (wet && !this.ballWasWet && speed > 0.8) {
      this.audio.splash(this.tmpFocus.set(p.x, surface ?? p.y, p.z), Math.min(r / 3, 1));
      this.effects.waterSplash(this.tmpFocus.set(p.x, surface ?? p.y, p.z), Math.min(0.4 + r * 0.25, 1.4));
    }
    this.ballWasWet = wet;

    const c = this.beetle.center;
    this.playerWater = this.puddles.depthAt(c.x, c.z);
    this.beetle.speedScale = 1 - 0.45 * clamp(this.playerWater / 0.5, 0, 1);
    const playerWet = this.playerWater > 0.04;
    if (playerWet && !this.playerWasWet) this.audio.splash(c, 0.15);
    this.playerWasWet = playerWet;
  }

  /** Clima → luz, céu, superfícies molhadas e poças (o som do clima lê o retrato do quadro). Roda também na pausa (o mundo segue vivo). */
  private applyWeather(): void {
    const w = this.weather;
    this.graphics.setWeather(w.overcast, w.flash);
    this.scenery.setOvercast(w.overcast);
    globalUniforms.uWetness.value = w.wetness;
    globalUniforms.uRain.value = w.rain;
    this.puddles.setFill(w.puddleFill);
  }

  /** Traz a bola para a frente do besouro. */
  private recoverBall(): void {
    this.beetle.releaseBall();
    const facing = this.beetle.facing;
    const r = this.ball.radius;
    const x = this.beetle.center.x + facing.x * (r + 1);
    const z = this.beetle.center.z + facing.z * (r + 1);
    const to = new THREE.Vector3(x, terrainHeight(x, z) + r + 0.4, z);
    this.ball.teleport(to);
    this.audio.recall(to);
  }

  /** Bola enterrada: placar, recorde salvo e festa. */
  private finishRound(result: { diameterCm: number; dungCount: number; itemCount: number }, at: THREE.Vector3): void {
    const record = result.diameterCm > this.save.bestCm + 0.05;
    this.save.buried += 1;
    this.save.totalCm += result.diameterCm;
    this.save.bestCm = Math.max(this.save.bestCm, result.diameterCm);
    writeSave(this.save);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.hud.showResult({ ...result, record });
    this.effects.buried(at, result.diameterCm / 4);
    this.audio.buried(at, result.diameterCm / 4, record);
    this.cameraRig.shake(0.1);
    this.rumble(0.8, 1, record ? 500 : 300);
  }

  /** Rodada nova: o jardim volta inteiro e uma bola pequena brota do lado do besouro. */
  private startNewRound(): void {
    this.scenery.restoreAll();
    this.collectibles.respawnAll(this.beetle.center);

    const facing = this.beetle.facing;
    let x = this.beetle.center.x + facing.x * 1.6;
    let z = this.beetle.center.z + facing.z * 1.6;
    // Não nasce dentro da boca da toca (seria "enterrada" de novo na hora).
    const dx = x - BURROW.x;
    const dz = z - BURROW.z;
    const d = Math.hypot(dx, dz);
    const minDistance = BURROW.radius * 1.6;
    if (d < minDistance) {
      const k = d > 1e-3 ? minDistance / d : 1;
      x = BURROW.x + (d > 1e-3 ? dx * k : minDistance);
      z = BURROW.z + (d > 1e-3 ? dz * k : 0);
    }
    const position = new THREE.Vector3(x, terrainHeight(x, z) + START_RADIUS + 0.05, z);
    this.ball.reset(position);
    this.ball.endBurial();
    this.hud.resetRound();
    this.effects.sparkle(position, new THREE.Color('#e6c46a'));
    this.audio.newBall(position);
  }

  private renderFrame(alpha: number, dt: number): void {
    this.ball.render(alpha, dt);
    this.beetle.render(alpha, dt);

    const player = this.beetle.renderPosition(alpha, this.tmpPlayer);
    const ballPos = this.ball.root.position;
    const burying = this.burrow.isBusy;
    // Enterrando: a câmera enquadra besouro + toca (a bola some no chão).
    const cameraBall = burying ? this.tmpFocus.set(BURROW.x, BURROW.ground + 0.8, BURROW.z) : ballPos;
    this.cameraRig.update(dt, player, cameraBall, this.ball.radius, this.beetle.pushing || burying);
    this.graphics.followFocus(player);

    const camera = this.graphics.camera;
    globalUniforms.uTime.value = this.elapsed;
    const pushers = globalUniforms.uPushers.value;
    // Raio generoso: com a grama densa, o besouro precisa de uma clareira para aparecer.
    pushers[0].set(player.x, player.y, player.z, 0.95);
    pushers[1].set(ballPos.x, ballPos.y - this.ball.radius, ballPos.z, this.ball.isSolid ? this.ball.radius * 1.05 : 0);
    this.grass.update(camera);
    this.groundCover.update(camera);
    this.graphics.setFocusDistance(camera.position.distanceTo(player));
    this.scenery.update(dt);
    this.collectibles.update(dt);
    this.burrow.update(dt, this.elapsed, this.ball.radius);
    this.updateEffects(dt, player);
    if (!this.paused) this.collectCritters();

    this.hud.setBall(this.ball.diameterCm, this.ball.dungCount, this.ball.itemCount);
    const hint = this.computeHint();
    this.hud.setHint(hint.kind, hint.value);
    this.updateBurrowMarker(player);
    this.hud.update(dt);
    this.updateAudio(dt, player);

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
    f.rain = this.weather.rain;
    f.wetness = this.weather.wetness;
    f.playerWater = this.playerWater;
    f.ballWater = this.ballWater;
    this.collectibles.stinkSources(player, STINK_RANGE, this.stink);
    // Pausado, o mundo continua vivo (bichos, pólen, chuva), mas nada de poeira de passo.
    if (this.paused) {
      f.playerVelocity.set(0, 0, 0);
      f.ballVelocity.set(0, 0, 0);
    }
    this.effects.update(dt, f);
  }

  /** Retrato do quadro para o áudio (roda também na pausa: a madrugada do menu tem som). */
  private updateAudio(dt: number, player: THREE.Vector3): void {
    const a = this.audioFrame;
    const ball = this.ball.root.position;
    const r = this.ball.radius;
    a.paused = this.paused;
    a.footfalls = this.beetle.model.footfalls;
    a.feetClearance = player.y - terrainHeight(player.x, player.z);
    a.playerDirt = dirtAmount(player.x, player.z);
    a.ballDirt = dirtAmount(ball.x, ball.z);
    a.ballSolid = this.ball.isSolid;
    a.ballClearance = ball.y - r - terrainHeight(ball.x, ball.z);
    a.ballDissolving = this.dissolving;
    a.ballItems = this.ball.itemCount;
    a.ballDiameterCm = this.ball.diameterCm;
    a.burying = this.burrow.isBusy;
    a.overcast = this.weather.overcast;
    this.audio.update(dt, a);
  }

  /** Tatuzinho enrolado que encosta na bola gruda nela (Katamari de bicho). */
  private collectCritters(): void {
    if (!this.ball.isSolid) return;
    const center = this.ball.position(this.tmpBall);
    const found = this.effects.collectCritter(center, this.ball.radius);
    if (!found) return;
    this.ball.stick(found.object, { depth: found.size * 0.12, burySize: found.size });
    this.ball.itemCount++;
    this.ball.addVolume(sphereVolume(found.size * 0.4));
    const at = found.object.getWorldPosition(new THREE.Vector3());
    this.audio.critterStuck(at);
    this.effects.sparkle(at, found.color);
  }

  private computeHint(): { kind: HintKind; value: number } {
    if (this.paused) return { kind: 'none', value: 0 };
    if (this.dissolving) return { kind: 'dissolving', value: 0 };
    if (this.burrowHintTimer > 0) return { kind: 'burrowTooSmall', value: MIN_BURY_RADIUS * 4 };
    if (this.tooSmallTimer > 0) return { kind: 'tooSmall', value: this.tooSmallCm };
    if (this.burrow.isBusy) return { kind: 'none', value: 0 };
    if (this.beetle.pushing) return { kind: this.pushTutorialTime < 5 ? 'pushing' : 'none', value: 0 };
    const ballPos = this.ball.position(this.tmpBall);
    const dist = ballPos.distanceTo(this.beetle.center) - this.ball.radius;
    return { kind: dist < 1.4 ? 'grab' : 'none', value: 0 };
  }

  /** Marcador da toca no HUD (some perto dela, durante o enterro e na pausa). */
  private updateBurrowMarker(player: THREE.Vector3): void {
    const distance = Math.hypot(player.x - BURROW.x, player.z - BURROW.z);
    if (this.paused || this.burrow.isBusy || distance < MARKER_HIDE_DISTANCE) {
      this.hud.setBurrowMarker(null);
      return;
    }
    const camera = this.graphics.camera;
    const view = this.tmpMarker.copy(this.burrow.marker).applyMatrix4(camera.matrixWorldInverse);
    const behind = view.z > 0;
    const ndc = this.tmpMarker.copy(this.burrow.marker).project(camera);
    this.hud.setBurrowMarker({
      ndcX: ndc.x,
      ndcY: ndc.y,
      behind,
      distanceCm: distance * 2,
      ready: this.ball.radius >= MIN_BURY_RADIUS,
    });
  }

  /** Média de FPS a cada meio segundo, se o jogador ligou o contador. */
  private countFps(frameTime: number): void {
    if (!settings.get().showFps) return;
    this.fpsFrames++;
    this.fpsTime += frameTime;
    if (this.fpsTime < 0.5) return;
    this.hud.setFps(this.fpsFrames / this.fpsTime);
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  /**
   * Qualidade "Auto": mede os primeiros segundos de jogo; se o aparelho não segurar
   * ~40 fps, desliga AO/DOF/bloom, limita a resolução e afina a vegetação. Se mesmo
   * assim ficar abaixo de ~30 fps, desce mais um degrau.
   */
  private trackPerformance(frameTime: number): void {
    if (this.perfStage >= 2 || this.paused || settings.get().quality !== 'auto') return;
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
      this.adaptiveLevel = 1;
      this.perfStage = 1;
    } else {
      if (fps < 30) this.adaptiveLevel = 2;
      this.perfStage = 2;
    }
    this.applyRender(settings.get());
  }
}
