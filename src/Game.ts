import * as THREE from 'three';
import { Physics, FIXED_DT, RAPIER, Groups, interactionGroups } from './core/Physics';
import { Input } from './core/Input';
import { ThirdPersonCamera, CAMERA_PROBE_RADIUS, type CameraBall } from './core/ThirdPersonCamera';
import { loadSave, writeSave, type SaveData } from './core/save';
import { settings, nativePixelRatio, type GameSettings } from './core/settings';
import { Graphics, type RenderOptions } from './render/Graphics';
import { globalUniforms } from './render/shaderChunks';
import { clearFrameView, updateFrameView } from './render/frameView';
import { Terrain, terrainHeight, terrainNormal, dirtAmount, BURROW } from './world/Terrain';
import { Scenery } from './world/Scenery';
import { Grass } from './world/Grass';
import { GroundCover } from './world/GroundCover';
import { Collectibles, FRESH_CHANCE, type DebrisMaterial, type StinkSource } from './world/Collectibles';
import { Pickables, type PickEvent } from './world/Pickables';
import { LooseObjects } from './world/LooseObjects';
import type { PickableKind } from './world/scenery/context';
import { Burrow, MIN_BURY_RADIUS } from './world/Burrow';
import { Weather } from './world/Weather';
import { Puddles } from './world/Puddles';
import { sphereVolume } from './world/scenery/context';
import { DungBall, START_RADIUS } from './entities/DungBall';
import { Beetle } from './entities/Beetle';
import { Effects, type CritterEvent, type EffectsFrame } from './fx/Effects';
import type { Critters } from './fx/critters/Critters';
import type { ChunkedInstances } from './render/ChunkedInstances';
import { disposeReplaced } from './render/dispose';
import type { SurfaceProbe } from './fx/Rain';
import { GameAudio } from './audio/GameAudio';
import type { AudioFrame } from './audio/frame';
import { Hud, type HintKind } from './ui/Hud';
import { giverName } from './ui/RoundPanel';
import { Menu } from './ui/Menu';
import { AchievementToast } from './ui/AchievementToast';
import type { BootScreen } from './ui/BootScreen';
import type { ProjectedPoint } from './ui/screenMarker';
import { t, type MessageKey } from './i18n';
import { Progression, type MealResult } from './progression/Progression';
import { catalogIdForDebris, catalogIdForPickable, type CatalogId } from './progression/catalog';
import { classifyHue, type Hue } from './progression/colors';
import {
  NOSE_PROMOTE_COUNT,
  antFriendBatch,
  antFriendRadius,
  bumpShed,
  bumpThreshold,
  curiousGrowth,
  noseFreshChance,
  type PerkId,
  type PerkOffer,
} from './progression/perks';
import type { RoundRequest } from './progression/requests';
import { skin, type SkinId } from './progression/skins';
import { quality } from './core/device';
import { GRAVITY } from './core/Physics';
import { clamp, mixSeed, randomSeed } from './utils/math';

/** Evita "espiral da morte" quando a aba volta do segundo plano. */
const MAX_FRAME_TIME = 0.1;
const FALL_LIMIT = -30;
/** Distância (do jogador) até onde os montinhos soltam fedor visível. */
const STINK_RANGE = 24;
/** Quanto uma dica "de evento" (bola pequena demais...) continua na tela depois de acontecer. */
const EVENT_HINT_SECONDS = 1.6;
/** Perto assim da toca, o anel no chão já faz o papel do marcador. */
const MARKER_HIDE_DISTANCE = 7;
/** Faro: até que distância os montinhos fresquinhos ganham marcador na tela. */
const SCENT_RANGE = 60;
/** Brilho de montinho fresquinho: de quanto em quanto tempo, e até que distância (sem e com Faro). */
const FRESH_GLINT_SECONDS = 1.1;
const FRESH_GLINT_RANGE = 18;
const FRESH_GLINT_RANGE_NOSE = 45;
/** A primeira vez que a toca é apresentada, ela abre sozinha depois do placar. */
const BURROW_INTRO_DELAY = 5;
const FRESH_GLINT_COLOR = new THREE.Color('#ffd479');
/** Quanto tempo as dicas do Equilibrista (como usar / em cima da bola) ficam na tela. */
const ABILITY_HINT_SECONDS = 6;
const RIDING_HINT_SECONDS = 3;
/** Trombada: intervalo mínimo entre duas "chuvas de tralha" (a bola quica várias vezes no mesmo lugar). */
const BUMP_COOLDOWN = 0.6;
/** Formigueiro amigo: de quanto em quanto tempo as formigas trazem folha. */
const ANT_FRIEND_INTERVAL = 0.9;
/** O que cai de cada coisa grande demais quando a bola bate forte nela (poder Trombada). */
const BUMP_DEBRIS: Record<PickableKind, DebrisMaterial> = { flower: 'petal', mushroom: 'leaf', rock: 'pebble', log: 'twig', object: 'pebble' };
/**
 * Quanto tempo por quadro a montagem do jardim da próxima rodada pode usar (ms):
 * pouquinho jogando (ela começa logo que a rodada começa), mais no menu e no enterro.
 */
const GardenBudget = { playing: 2.5, burying: 8, paused: 10 } as const;
/** Quadros até descartar o que saiu de cena (o substituto já foi desenhado: nada recompila). */
const DISPOSE_AFTER_FRAMES = 3;
/** Sorteios derivados da semente do jardim (grama, cobertura e bichos de cada jardim). */
const GardenSalt = { grass: 11, cover: 12, critters: 13 } as const;
/** O que cada passo da montagem do jardim devolve: `idle` = nada a fazer até a bola cair na toca. */
type GardenStep = 'idle' | void;

/**
 * Semente do primeiro jardim: nova a cada vez que o jogo abre. Em desenvolvimento,
 * `?seed=123` na URL repete um jardim (para reproduzir um bug).
 */
function initialSeed(): number {
  if (import.meta.env.DEV) {
    const forced = Number(new URLSearchParams(location.search).get('seed'));
    if (Number.isFinite(forced) && forced > 0) return forced >>> 0;
  }
  return randomSeed();
}

/** Cor → família (pedidos de cor); reaproveitado a cada coleta. */
const tmpHsl = { h: 0, s: 0, l: 0 };

/** Família de cor de uma coisa pela cor predominante dela (em sRGB, como a gente vê). */
function hueOf(color: THREE.Color | null | undefined): Hue | null {
  if (!color) return null;
  color.getHSL(tmpHsl, THREE.SRGBColorSpace);
  return classifyHue(tmpHsl.h, tmpHsl.s, tmpHsl.l);
}

/** Deixa o navegador pintar um frame (o loader continua animando entre as etapas pesadas). */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Orquestra tudo: laço de jogo com física em passo fixo + render interpolado,
 * rodadas (crescer → enterrar na toca → jardim novo, sorteado de novo), clima, dicas, efeitos
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
  private readonly progression = new Progression(this.save, () => writeSave(this.save));

  private physics!: Physics;
  private terrain!: Terrain;
  private grass!: Grass;
  private groundCover!: GroundCover;
  private scenery!: Scenery;
  private collectibles!: Collectibles;
  private pickables!: Pickables;
  private looseObjects!: LooseObjects;
  private burrow!: Burrow;
  private puddles!: Puddles;
  private ball!: DungBall;
  private beetle!: Beetle;
  private effects!: Effects;

  private readonly spawn = new THREE.Vector3();
  private started = false;
  private startDisabled = true;
  /** Escolhendo um poder: a simulação congela e o mouse fica solto pra clicar nas cartas. */
  private choosing = false;
  /** Contagem até a toca abrir sozinha na primeira vez (0 = nada agendado). */
  private burrowIntroTimer = 0;
  private freshGlintTimer = 0;
  private readonly freshSpots: THREE.Vector3[] = [];
  private readonly scentPoints: ProjectedPoint[] = [];
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

  // Poderes novos e segredos da rodada.
  private abilityHintTimer = 0;
  private abilityFarTimer = 0;
  private ridingHintTimer = 0;
  private abilityWasReady = true;
  /** O besouro estava em cima da bola quando ela caiu na toca (conquista "Entrega de circo"). */
  private buriedWhileRiding = false;
  private bumpCooldown = 0;
  /** Velocidade (no plano) da bola no passo anterior: freada brusca = trombada. */
  private prevBallSpeed = 0;
  private antFriendTimer = 0;
  /** Maior raio da bola nesta rodada (segredo "Derreteu tudo"). */
  private roundPeakRadius = START_RADIUS;
  private currentSkin: SkinId | null = null;
  /** O aviso de pedido dourado já saiu nesta rodada. */
  private goldenAnnounced = false;

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
  private readonly cameraBall: CameraBall = { center: new THREE.Vector3(), radius: START_RADIUS };

  /** Montagem aos poucos do jardim da próxima rodada (começa quando a bola cai na toca). */
  private gardenJob: Generator<GardenStep, void> | null = null;
  /** A bola caiu na toca: a montagem acelera e os bichos do jardim novo podem nascer (é o passo mais pesado). */
  private gardenRush = false;
  /** Grama, cobertura e bichos já plantados para o jardim novo, esperando a troca. */
  private gardenParts: { grass: ChunkedInstances; cover: ChunkedInstances[]; critters: Critters } | null = null;
  /** O que saiu de cena e ainda vai ser descartado (depois de o substituto aparecer). */
  private readonly disposals: Array<{ frames: number; run: () => void }> = [];

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.graphics = new Graphics(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(uiRoot, this.input);
    this.menu = new Menu(uiRoot, this.hud.isTouch, this.progression);
    // Depois do menu: o aviso de conquista fica por cima dele (dá pra conquistar comendo na toca).
    const achievementToast = new AchievementToast(uiRoot);
    this.progression.onAchievement = (unlock) => {
      achievementToast.show(unlock);
      this.audio.achievement();
    };
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
    this.menu.burrow.onMeal = (meal) => this.onMeal(meal);
    this.hud.onOpenMenu = () => this.pause();
    this.hud.onOpenBurrow = () => this.openBurrow();
    this.hud.perkPicker.onChoose = (perk) => this.choosePerk(perk);
    this.progression.subscribe(() => this.syncRound());
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
    // Perdeu o mouse sem pausar (ex.: escolheu poder pelo controle): um clique na cena prende de novo.
    canvas.addEventListener('click', () => {
      if (this.started && !this.paused && !this.choosing && !this.hud.isTouch && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.lastTime = 0;
      // No celular não existe Esc: sair do app (ou trocar de aba) pausa o jogo.
      if (this.started) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      // Enter na tela inicial também começa (acessível pelo teclado).
      if (this.menu.isVisible && !this.startDisabled && document.activeElement === document.body && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.start();
      // T abre a toca (despensa, catálogo e poderes).
      if (e.code === 'KeyT' && !e.repeat && this.started && !this.paused && !this.choosing) this.openBurrow();
      // Escolhendo poder o mouse já está solto: Esc pausa como no resto do jogo.
      if (e.code === 'Escape' && this.choosing && !this.paused) this.pause();
      // Atalho de desenvolvimento: F8 adianta o tempo para a próxima fase (sol → nublando → chuva...).
      if (import.meta.env.DEV && e.code === 'F8') this.weather.skipAhead();
    });
  }

  /** Monta o mundo em etapas, avisando a tela de carregamento (e deixando ela pintar entre uma e outra). */
  async init(boot: BootScreen): Promise<void> {
    boot.step(0.12, 'loader.physics');
    await nextFrame();
    this.physics = await Physics.create();
    const scene = this.graphics.scene;
    boot.step(0.26, 'loader.terrain');
    await nextFrame();

    this.terrain = new Terrain(this.physics, quality.terrainSegments);
    scene.add(this.terrain.mesh);
    boot.step(0.4, 'loader.garden');
    await nextFrame();

    // Cada vez que o jogo abre o jardim é outro (e cada rodada sorteia um novo).
    const seed = initialSeed();
    this.scenery = new Scenery(this.physics, quality.decorDensity, seed);
    scene.add(this.scenery.group);
    this.terrain.paintContactShade(this.scenery.shades);
    boot.step(0.6, 'loader.grass');
    await nextFrame();

    // Grama e enfeites não nascem dentro de pedra/tronco nem em cima da toalha de piquenique.
    this.grass = new Grass(quality.grassCount, this.scenery.groundBlocker(0.1), mixSeed(seed, GardenSalt.grass));
    scene.add(this.grass.group);
    this.groundCover = new GroundCover(quality.decorDensity, this.scenery.groundBlocker(0.25), mixSeed(seed, GardenSalt.cover));
    scene.add(this.groundCover.group);
    boot.step(0.74, 'loader.critters');
    await nextFrame();

    this.collectibles = new Collectibles(this.scenery);
    scene.add(this.collectibles.group);
    this.pickables = new Pickables(this.physics, this.scenery);
    this.looseObjects = new LooseObjects(this.physics, this.scenery);
    scene.add(this.looseObjects.group);
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
    this.applySkin();

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
      isGroundFree: this.scenery.critterGround(),
      picnic: this.scenery.zoneOf('picnic'),
      critterSeed: mixSeed(seed, GardenSalt.critters),
      surface,
      sounds: this.audio.critterSounds,
    });
    scene.add(this.effects.group);
    this.effects.onCritterEvent = (event) => this.onCritterEvent(event);
    // O jogo abre no menu: madrugada.
    this.effects.setMenuNight(true);

    this.wireEvents();
    this.wireCameraCollision();
    boot.step(0.88, 'loader.shaders');
    await nextFrame();

    // Aquece shaders antes de mostrar (evita engasgo no primeiro frame).
    this.graphics.renderer.compile(scene, this.graphics.camera);
    boot.step(1, 'loader.ready');

    this.startDisabled = false;
    this.applySettings(settings.get());
    settings.subscribe((s, changed) => this.applySettings(s, changed));
    void boot.finish();
    this.menu.setReady();
    // O jardim da segunda rodada já vai nascendo (no menu sobra tempo).
    this.prepareNextGarden();
    this.hud.setBall(this.ball.diameterCm, 0, 0);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.syncRound();
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
      } else if (event === 'mount') {
        // Equilibrista: pulinho pra cima da bola.
        this.audio.jump(feet);
        this.effects.jump(feet);
      }
    };
    this.collectibles.onCollect = (event) => {
      this.audio.collect(event, this.ball.radius);
      if (event.kind === 'dung') this.effects.splat(event.position, event.size);
      else this.effects.sparkle(event.position, event.color);
      if (event.kind === 'dung') {
        this.noteCollected(event.fresh ? 'freshDung' : 'dung');
        if (event.fresh) this.effects.sparkle(event.position, FRESH_GLINT_COLOR);
      } else if (event.material) {
        this.noteCollected(catalogIdForDebris(event.material), event.color);
      }
    };
    this.pickables.onPick = (event) => this.onPick(event);
    this.looseObjects.onPick = (event) => this.onPick(event);
    this.ball.onImpact = (strength) => {
      if (strength > 0.25) {
        const at = this.ball.position(this.tmpBall);
        this.audio.impact(at, strength, this.ball.radius);
        this.effects.impact(at, this.ball.radius, strength);
        this.effects.startle(at, 2 + this.ball.radius);
        this.cameraRig.shake(strength * 0.12 * Math.min(1, this.ball.radius / 1.5));
        this.rumble(strength * 0.7, strength * 0.4, 110);
      }
      this.tryBump(strength);
    };
    this.ball.onShed = (at) => {
      this.effects.shed(at);
      this.audio.shed(at);
    };

    this.burrow.onBurialStart = (at, radius) => {
      // Enquanto a bola afunda, o jardim da próxima rodada termina de se montar.
      if (!this.scenery.hasNext) this.prepareNextGarden();
      this.gardenRush = true;
      // Antes do passo do besouro: ele ainda está em cima da bola se entregou montado.
      this.buriedWhileRiding = this.beetle.riding;
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

  /** Arrancou algo do chão (flor, pedra, brinquedo, bola de tênis...). */
  private onPick(event: PickEvent): void {
    this.audio.pluck(event);
    this.effects.pluck(event.ground, event.position, event.tint, event.size, event.kind === 'flower');
    this.effects.startle(event.ground, 4 + event.size * 2);
    // Debaixo de pedra e de tronco sempre tem bicho: tesourinha e lacraia saem correndo.
    if (event.kind === 'rock' || event.kind === 'log') this.effects.scatterFromUnder(event.ground, event.size);
    this.cameraRig.shake(0.03 + Math.min(event.size, 3) * 0.03);
    this.rumble(0.25 + Math.min(event.size, 3) * 0.15, 0.5, 140);
    this.noteCollected(catalogIdForPickable(event.kind, event.variant), event.tint);
  }

  /**
   * Poder Trombada: bateu forte em coisa grande demais pra arrancar? Cai tralha
   * dela (pétala da flor, lasca da pedra, graveto do tronco) pra bola pegar.
   */
  private tryBump(strength: number): void {
    const rank = this.progression.perkRank('bump');
    const blocked = this.pickables.blocked;
    if (!rank || !blocked || this.bumpCooldown > 0 || strength < bumpThreshold(rank)) return;
    this.bumpCooldown = BUMP_COOLDOWN;
    this.collectibles.spawnDebrisBurst(BUMP_DEBRIS[blocked.kind], blocked.point, bumpShed(rank), 1 + Math.min(blocked.size, 3) * 0.4);
    this.effects.sparkle(blocked.point, FRESH_GLINT_COLOR);
  }

  /** Algo aconteceu na fauna: revoada, beija-flor, teia rasgada. */
  private onCritterEvent(event: CritterEvent): void {
    switch (event.type) {
      case 'swarm':
        this.hud.notify(t('event.swarm'));
        break;
      case 'hummingbirdSeen':
        this.hud.notify(t('event.hummingbird'));
        this.progression.achieve('hummingbird');
        break;
      case 'webTorn': {
        // O fio de teia vem grudado na bola (vira figurinha).
        const item = event.item;
        if (!this.ball.isSolid) break;
        this.ball.stick(item.object, { depth: item.size * 0.1, burySize: item.size });
        this.ball.itemCount++;
        this.ball.addVolume(sphereVolume(item.size * 0.3));
        this.effects.sparkle(item.object.getWorldPosition(this.tmpFocus), item.color);
        this.noteCollected('web', item.color);
        this.progression.noteWebTorn();
        break;
      }
    }
  }

  /** Casco escolhido na toca → besouro (só quando mudou). */
  private applySkin(): void {
    const id = this.progression.skin;
    if (id === this.currentSkin) return;
    this.currentSkin = id;
    this.beetle.model.setSkin(skin(id));
  }

  /**
   * Equilibrista: sobe na bola (se estiver perto e o poder carregado) ou desce
   * dela se já estiver em cima (apertar de novo é o jeito de sair antes).
   */
  private tryRider(): void {
    if (!this.progression.hasPerk('rider') || this.burrow.isBusy) return;
    const ability = this.progression.rider;
    if (this.beetle.riding) {
      this.beetle.dismount();
      ability.stop();
      return;
    }
    if (!ability.ready) return;
    if (!this.beetle.canMount()) {
      this.abilityFarTimer = EVENT_HINT_SECONDS;
      return;
    }
    if (ability.start() && this.beetle.mount()) {
      this.abilityHintTimer = 0;
      this.ridingHintTimer = RIDING_HINT_SECONDS;
    }
  }

  /** Relógio do Equilibrista: acabou o tempo, desce; recarregou, avisa. */
  private updateRider(dt: number): void {
    const ability = this.progression.rider;
    if (ability.update(dt) && this.beetle.riding) this.beetle.dismount();
    // Desceu sozinho (pulou, bola caiu na toca): o poder começa a recarregar.
    if (ability.active && !this.beetle.riding) ability.stop();
    const ready = ability.ready;
    if (ready && !this.abilityWasReady && this.progression.hasPerk('rider')) this.audio.abilityReady();
    this.abilityWasReady = ready;
  }

  /**
   * Poderes que agem a cada passo: Ladeira abaixo (a gravidade ajuda no declive),
   * Formigueiro amigo (formiga traz folha) e a gosma da lesma (a bola desliza).
   */
  private applyWorldPerks(dt: number): void {
    const ball = this.ball;
    if (!ball.isSolid) return;
    const p = ball.position(this.tmpBall);
    const r = ball.radius;
    const onGround = p.y - r - terrainHeight(p.x, p.z) < 0.25;

    const assist = this.beetle.modifiers.slopeAssist;
    if (assist > 0 && onGround) {
      // Componente da gravidade ao longo do chão, um tanto a mais: morro abaixo a bola embala.
      const n = terrainNormal(p.x, p.z, this.tmpMarker);
      const k = GRAVITY * assist * ball.mass * dt;
      ball.body.applyImpulse({ x: n.x * k, y: 0, z: n.z * k }, true);
    }

    const slime = this.effects.slimeAt(p.x, p.z);
    if (slime > 0 && onGround) {
      // Rastro de lesma: a bola perde o freio do chão e escorrega um pouco pra frente.
      ball.extraDrag *= 1 - 0.6 * slime;
      const v = ball.body.linvel();
      const push = 0.8 * slime * ball.mass * dt;
      ball.body.applyImpulse({ x: v.x * push, y: 0, z: v.z * push }, true);
    }

    const ants = this.progression.perkRank('antFriend');
    if (ants) {
      this.antFriendTimer -= dt;
      if (this.antFriendTimer <= 0) {
        this.antFriendTimer = ANT_FRIEND_INTERVAL;
        for (const leaf of this.effects.takeAntLeaves(p, antFriendRadius(ants) + r, antFriendBatch(ants))) {
          // A folha cai do lado da bola, no caminho da formiga (e gruda no próximo passo).
          const dir = this.tmpFocus.set(leaf.x - p.x, 0, leaf.z - p.z);
          if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
          dir.normalize().multiplyScalar(r + 0.25).add(p);
          dir.y = terrainHeight(dir.x, dir.z);
          this.collectibles.spawnDebrisBurst('leaf', dir, 1, 0.1);
        }
      }
    }
  }

  /**
   * A câmera consulta a física com uma esfera do tamanho da lente: sólidos do
   * mundo (chão, pedras, objetos, bolas de tênis) barram; volumes macios
   * (pétalas, folhas, caules: grupo só da câmera) ela só não pode invadir.
   */
  private wireCameraCollision(): void {
    const world = this.physics.world;
    const shape = new RAPIER.Ball(CAMERA_PROBE_RADIUS);
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    // O besouro não entra (o PLAYER da consulta só serve para as bolas de tênis, que filtram por ele).
    const solid = interactionGroups(Groups.PLAYER | Groups.CAMERA, Groups.WORLD);
    const soft = interactionGroups(Groups.CAMERA, Groups.CAMERA);
    const cast = (groups: number) => (origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number) => {
      const hit = world.castShape(origin, rotation, dir, shape, 0, maxDistance, false, undefined, groups);
      return hit ? hit.time_of_impact : null;
    };
    this.cameraRig.collision = {
      cast: cast(solid),
      castSoft: cast(soft),
      insideSoft: (point) => {
        let inside = false;
        world.intersectionsWithShape(
          point,
          rotation,
          shape,
          () => {
            inside = true;
            return false;
          },
          undefined,
          soft,
        );
        return inside;
      },
    };
  }

  // --- Jardim novo a cada rodada ---------------------------------------------------

  /**
   * Sorteia o jardim da próxima rodada e começa a montá-lo aos poucos, sem
   * travar o jogo: logo que uma rodada começa, o jardim da seguinte já vai
   * nascendo nos intervalos entre os quadros.
   */
  private prepareNextGarden(): void {
    const seed = randomSeed();
    this.scenery.prepareNext(seed);
    this.gardenParts = null;
    this.gardenRush = false;
    this.gardenJob = this.gardenSteps(seed);
  }

  /**
   * O cenário (um objeto por passo), a grama e a cobertura (mil tufos por passo)
   * e, quando a bola cai na toca, os bichos do jardim novo (um passo só, pesado:
   * no meio do enterro ninguém sente).
   */
  private *gardenSteps(seed: number): Generator<GardenStep, void> {
    while (!this.scenery.stepNext(0)) yield;
    const plan = this.scenery.pendingPlan!;
    const grass = yield* this.grass.plantSteps(this.scenery.groundBlocker(0.1, true), mixSeed(seed, GardenSalt.grass));
    const cover = yield* this.groundCover.plantSteps(this.scenery.groundBlocker(0.25, true), mixSeed(seed, GardenSalt.cover));
    while (!this.gardenRush) yield 'idle';
    const picnic = plan.zones.find((zone) => zone.kind === 'picnic');
    const critters = this.effects.createCritters(this.scenery.pending!.landingSpots, this.scenery.critterGround(true), picnic, mixSeed(seed, GardenSalt.critters));
    this.gardenParts = { grass, cover, critters };
  }

  /** Avança a montagem do jardim novo por até `budgetMs` neste quadro. */
  private advanceGarden(budgetMs: number): void {
    const job = this.gardenJob;
    if (!job) return;
    const until = performance.now() + budgetMs;
    do {
      const step = job.next();
      if (step.done) {
        this.gardenJob = null;
        return;
      }
      // Pronto, só esperando a bola cair na toca: girar em falso queimaria o orçamento do quadro.
      if (step.value === 'idle') return;
    } while (performance.now() < until);
  }

  /**
   * Troca o jardim: cenário, sombras no chão, grama, cobertura, bichos, montinhos,
   * detritos e bolas de tênis passam para o sorteio novo. O que ficou pronto aos
   * poucos entra de uma vez; o que faltar é terminado aqui.
   */
  private swapGarden(): void {
    if (!this.scenery.hasNext) this.prepareNextGarden();
    this.gardenRush = true;
    while (this.gardenJob) this.advanceGarden(1000);
    const parts = this.gardenParts!;
    this.gardenParts = null;
    this.scenery.commitNext();
    this.terrain.paintContactShade(this.scenery.shades);
    const oldGrass = this.grass.replaceField(parts.grass);
    const oldCover = this.groundCover.replace(parts.cover);
    const oldCritters = this.effects.swapCritters(parts.critters);
    this.looseObjects.relayout();
    this.collectibles.relayout(this.beetle.center);
    this.disposeLater(() => {
      oldGrass.dispose();
      for (const layer of oldCover) layer.dispose();
      disposeReplaced(oldCritters.group, parts.critters.group);
    });
    // E o jardim da rodada seguinte já começa a nascer.
    this.prepareNextGarden();
  }

  private disposeLater(run: () => void): void {
    this.disposals.push({ frames: DISPOSE_AFTER_FRAMES, run });
  }

  private runDisposals(): void {
    for (let i = this.disposals.length - 1; i >= 0; i--) {
      const item = this.disposals[i];
      if (--item.frames > 0) continue;
      this.disposals.splice(i, 1);
      item.run();
    }
  }

  private start(): void {
    if (this.startDisabled) return;
    // Jogar/Continuar é um gesto: garante o áudio de pé e faz amanhecer.
    this.audio.unlock();
    this.audio.setPaused(false);
    this.effects.setMenuNight(false);
    this.menu.hide();
    this.hud.setVisible(true);
    this.hud.perkPicker.setSuspended(false);
    this.started = true;
    this.announceGolden();
    // Voltando pra uma escolha de poder, o mouse continua solto (pra clicar nas cartas).
    if (!this.hud.isTouch && !this.choosing) this.input.requestPointerLock();
    this.canvas.focus();
  }

  private onPointerLockChange = (): void => {
    // Perdeu o mouse (Esc): pausa e mostra a tela de controles. Soltar pra escolher poder não conta.
    if (!this.input.pointerLocked && this.started && !this.hud.isTouch && !this.choosing) this.pause();
  };

  /**
   * Controle: Start pausa/continua; com o menu aberto, direções/A/B navegam nele.
   * Nada do que se aperta no menu vaza pro jogo (o A que escolhe "Jogar" não vira pulo).
   */
  private handleGamepadMenu(): void {
    if (!this.paused) {
      if (this.input.pausePressed) {
        this.pause();
        return;
      }
      if (this.choosing) {
        // As cartas de poder usam o controle como menu; nada vaza pro besouro.
        const state = this.input.state;
        state.jumpPressed = false;
        state.resetPressed = false;
        state.abilityPressed = false;
        for (const action of this.input.menuActions) this.hud.perkPicker.handleGamepad(action);
      }
      return;
    }
    const state = this.input.state;
    state.jumpPressed = false;
    state.resetPressed = false;
    state.abilityPressed = false;
    if (this.startDisabled) return;
    // Analógico direito rola a placa aberta (Como jogar é só texto: sem isso, não dava pra ler tudo).
    this.menu.scrollSheet(this.input.gamepad.menuScroll);
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
    this.input.gamepad.suppressHeldDirection();
    this.menu.show(true);
    this.audio.setPaused(true);
    this.effects.setMenuNight(true);
    this.hud.setVisible(false);
    // Escolhendo poder: as cartas ficam atrás do menu e não podem ser escolhidas às cegas pelo teclado.
    this.hud.perkPicker.setSuspended(true);
  }

  /** Pausa e abre a placa da toca (tecla T, botão do HUD ou a apresentação da primeira vez). */
  private openBurrow(intro = false): void {
    if (!this.started || this.choosing) return;
    this.burrowIntroTimer = 0;
    this.pause();
    this.menu.openBurrow(intro);
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

    if (!this.paused && !this.choosing) {
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
        this.input.state.abilityPressed = false;
      }
      this.updateRound(frameTime);
    } else if (this.choosing) {
      // Congelado na escolha: nem o pulo nem o "trazer bola" apertados agora valem depois
      // (o direcional pra cima navega as cartas e também é o botão do poder no controle).
      this.input.state.jumpPressed = false;
      this.input.state.resetPressed = false;
      this.input.state.abilityPressed = false;
    } else {
      // Na tela inicial a câmera gira devagar em volta do besouro: vitrine do cenário.
      this.cameraRig.applyLook(-frameTime * 60 * 0.35, 0, 0);
    }

    this.applyWeather();
    this.advanceGarden(this.burrow.isBusy ? GardenBudget.burying : this.paused || this.choosing ? GardenBudget.paused : GardenBudget.playing);
    const alpha = this.paused || this.choosing ? 1 : this.accumulator / FIXED_DT;
    this.renderFrame(alpha, frameTime);
    this.runDisposals();
    this.trackPerformance(frameTime);
    this.countFps(frameTime);
  };

  private fixedStep(): void {
    const state = this.input.state;

    // Em cima da bola, "trazer a bola" não faz sentido (ela já está embaixo do besouro).
    if (state.resetPressed && !this.burrow.isBusy && !this.beetle.riding) this.recoverBall();
    if (state.abilityPressed) this.tryRider();

    // Nível + poderes da rodada → besouro, ímã dos montinhos e alcance do Chifrudo (e o embalo da Ladeira abaixo).
    const ballVel = this.ball.body.linvel();
    const mods = this.progression.modifiers(this.ball.radius, Math.hypot(ballVel.x, ballVel.z));
    this.beetle.modifiers = mods;
    this.collectibles.magnet = mods.magnet;
    this.pickables.pluckReach = mods.pluckReach;
    this.bumpCooldown = Math.max(0, this.bumpCooldown - FIXED_DT);

    // A toca vem antes da física: durante o enterro é ela quem conduz a bola.
    this.burrow.fixedUpdate(FIXED_DT, this.ball);
    this.applyWaterAndMud(FIXED_DT);
    this.applyWorldPerks(FIXED_DT);
    this.beetle.fixedUpdate(FIXED_DT, state, this.cameraRig.yaw);
    this.updateRider(FIXED_DT);
    // Sangue quente: esquenta empurrando com o analógico/teclas apontando pra frente.
    this.progression.updateHeat(FIXED_DT, this.beetle.pushing && Math.hypot(state.moveX, state.moveY) > 0.3);
    this.physics.step();
    this.ball.fixedUpdate(FIXED_DT);
    this.collectibles.fixedUpdate(FIXED_DT, this.ball, this.beetle.center);
    this.pickables.fixedUpdate(this.ball);
    this.looseObjects.fixedUpdate(this.ball);
    this.checkSecrets();
    // Trombada de frente: o "impacto" da bola só vê queda/quique (vertical); bater rolando
    // numa coisa grande demais aparece como freada brusca na horizontal.
    const after = this.ball.body.linvel();
    const speed = Math.hypot(after.x, after.z);
    const drop = this.prevBallSpeed - speed;
    if (drop > 1 && this.pickables.blocked) this.tryBump(clamp(drop / 5, 0, 1));
    this.prevBallSpeed = speed;

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
    this.abilityHintTimer = Math.max(0, this.abilityHintTimer - FIXED_DT);
    this.abilityFarTimer = Math.max(0, this.abilityFarTimer - FIXED_DT);
    this.ridingHintTimer = Math.max(0, this.ridingHintTimer - FIXED_DT);
  }

  /** Conquistas secretas que acontecem no mundo: a bola derretendo até o mínimo e subir na bola sem poder. */
  private checkSecrets(): void {
    const r = this.ball.radius;
    this.roundPeakRadius = Math.max(this.roundPeakRadius, r);
    if (this.ballWater > 0.03) this.progression.noteBallWet();
    // Derreteu tudo: a bola já foi de ~4 cm ou mais e a poça levou ela até o tamanho de nascer.
    if (this.dissolving && this.roundPeakRadius >= 1 && r <= START_RADIUS * 1.04) this.progression.achieve('melted');
    if (this.beetle.standingOnBall && !this.progression.hasPerk('rider')) this.progression.achieve('onTop');
  }

  /**
   * Poças e lama: a água derrete a bola (mais rápido quanto mais dela afunda) e
   * freia; o besouro anda mais devagar com água na canela; terra molhada gruda
   * na bola (engorda um pouco, mas pesa).
   */
  private applyWaterAndMud(dt: number): void {
    const ball = this.ball;
    const mods = this.beetle.modifiers;
    const p = ball.position(this.tmpBall);
    const r = ball.radius;
    const surface = this.puddles.surfaceAt(p.x, p.z);
    this.ballWater = surface !== null && ball.isSolid ? Math.max(0, surface - (p.y - r)) : 0;
    const submersion = clamp(this.ballWater / (2 * r), 0, 1);
    const speed = Math.hypot(ball.body.linvel().x, ball.body.linvel().z);

    let drag = submersion * 3.2 * mods.waterDrag;
    this.dissolving = false;
    if (submersion > 0.02) {
      // Perde volume pela área molhada (bola pequena derrete rápido; gigante quase nada).
      ball.removeVolume(1.35 * submersion * r * r * dt * mods.melt);
      // Derretendo "de verdade" (a dica aparece): a bola ainda tem o que perder e a Casca de lama não segura.
      this.dissolving = r > START_RADIUS * 1.02 && mods.melt > 0.5;
    } else if (ball.isSolid && this.weather.wetness > 0.2 && speed > 0.3) {
      const onGround = p.y - r - terrainHeight(p.x, p.z) < 0.2;
      const dirt = dirtAmount(p.x, p.z);
      if (onGround && dirt > 0.3) {
        ball.addVolume(0.018 * speed * this.weather.wetness * dirt * r * dt * mods.mud);
        drag += (0.5 * this.weather.wetness * dirt) / mods.mud;
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
    this.beetle.speedScale = 1 - 0.45 * mods.wade * clamp(this.playerWater / 0.5, 0, 1);
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

  /** Bola enterrada: placar, recorde, comida na despensa, figurinhas e festa. */
  private finishRound(result: { diameterCm: number; dungCount: number; itemCount: number }, at: THREE.Vector3): void {
    const record = result.diameterCm > this.save.bestCm + 0.05;
    this.save.buried += 1;
    this.save.totalCm += result.diameterCm;
    this.save.bestCm = Math.max(this.save.bestCm, result.diameterCm);
    // O enterro salva tudo junto (recorde + despensa + catálogo).
    const outcome = this.progression.bury(result.diameterCm, { raining: this.weather.rain > 0.3, riding: this.buriedWhileRiding });
    this.buriedWhileRiding = false;
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.hud.showResult({ ...result, record, outcome });
    if (outcome.meal && outcome.meal.levelAfter > outcome.meal.levelBefore) this.audio.levelUp();
    if (outcome.introduceBurrow) this.burrowIntroTimer = BURROW_INTRO_DELAY;
    this.effects.buried(at, result.diameterCm / 4);
    this.audio.buried(at, result.diameterCm / 4, record);
    this.cameraRig.shake(0.1);
    this.rumble(0.8, 1, record ? 500 : 300);
  }

  /** Rodada nova: um jardim novo (outro sorteio) e uma bola pequena brota do lado do besouro. */
  private startNewRound(): void {
    this.swapGarden();
    // Teias voltam, bichos param de ser atraídos (o Fedor irresistível era da rodada).
    this.effects.newRound();
    this.effects.setAttract(0);
    this.roundPeakRadius = START_RADIUS;
    this.abilityHintTimer = 0;
    this.abilityFarTimer = 0;
    this.ridingHintTimer = 0;
    this.antFriendTimer = 0;

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
    // A bola nova nasceu limpa: as coisas do jardim antigo que estavam grudadas já saíram.
    this.pickables.reset();
    this.progression.startRound();
    this.collectibles.freshChance = FRESH_CHANCE;
    this.hud.resetRound();
    this.goldenAnnounced = false;
    this.announceGolden();
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
    // A bola também é obstáculo da lente (menos afundando na toca).
    this.cameraBall.center.copy(ballPos);
    this.cameraBall.radius = this.ball.radius;
    this.cameraRig.ball = burying ? null : this.cameraBall;
    this.cameraRig.update(dt, player, cameraBall, this.ball.radius, this.beetle.pushing || burying);
    this.graphics.followFocus(player);
    // Jogando, o que é instanciado pelo mapa todo (montinhos, detritos, bichos) só desenha o que
    // cabe nesta visão; no menu vai tudo (é lá que cada shader compila, antes de o jogo começar).
    if (this.paused) clearFrameView();
    else updateFrameView(this.graphics.camera);

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
    if (!this.paused && !this.choosing) this.collectCritters();
    this.updateFreshPiles(dt, player);

    this.hud.setBall(this.ball.diameterCm, this.ball.dungCount, this.ball.itemCount);
    this.updateAbilityHud();
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
    // Pausado (ou escolhendo poder), o mundo continua vivo (bichos, pólen, chuva), mas nada de poeira de passo.
    if (this.paused || this.choosing) {
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
    a.paused = this.paused || this.choosing;
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

  /** Bicho que encosta na bola (tatuzinho enrolado, tesourinha, lagarta...) gruda nela (Katamari de bicho). */
  private collectCritters(): void {
    if (!this.ball.isSolid) return;
    const center = this.ball.position(this.tmpBall);
    const found = this.effects.collectCritter(center, this.ball.radius);
    if (!found) return;
    this.ball.stick(found.object, { depth: found.size * 0.12, burySize: found.size });
    this.ball.itemCount++;
    this.ball.addVolume(sphereVolume(found.size * 0.4));
    const at = found.object.getWorldPosition(new THREE.Vector3());
    this.audio.critterStuck(at, found.id);
    this.effects.sparkle(at, found.color);
    this.noteCollected(found.id, found.color);
  }

  /** Botão do Equilibrista no HUD (só aparece com o poder na rodada). */
  private updateAbilityHud(): void {
    if (!this.progression.hasPerk('rider')) {
      this.hud.setAbility(null);
      return;
    }
    const ability = this.progression.rider;
    this.hud.setAbility({
      charge: ability.charge,
      phase: ability.active ? 'active' : ability.ready ? 'ready' : 'cooldown',
      seconds: ability.secondsLeft,
    });
  }

  // --- progressão (toca, poderes, pedidos) ---------------------------------------

  /**
   * A bola engoliu algo: conta pra rodada (pedidos, inclusive os de cor) e pro
   * catálogo quando enterrar. Com o poder Curioso, cada tipo novo dá um estirão.
   */
  private noteCollected(id: CatalogId, color?: THREE.Color | null): void {
    const result = this.progression.noteCollected(id, this.ball.diameterCm, hueOf(color));
    const curious = this.progression.perkRank('curious');
    if (curious && result.newKind) {
      this.ball.addVolume(sphereVolume(this.ball.radius) * curiousGrowth(curious));
      this.effects.sparkle(this.ball.position(this.tmpBall).setY(this.tmpBall.y + this.ball.radius), FRESH_GLINT_COLOR);
    }
    this.announceRequests(result.done);
  }

  private announceRequests(done: readonly RoundRequest[]): void {
    if (done.length === 0) return;
    this.hud.requestDone(giverName(done[0]));
    this.audio.requestDone();
  }

  /** Rodada com pedido dourado: o Sol avisa (uma vez, quando o jogo está rodando). */
  private announceGolden(): void {
    if (this.goldenAnnounced || !this.started) return;
    if (!this.progression.requests.some((r) => r.golden)) return;
    this.goldenAnnounced = true;
    this.hud.notify(t('hud.goldenRequest'));
  }

  /** Depois dos passos de física: pedidos de tamanho, marcos de poder e a apresentação da toca. */
  private updateRound(frameTime: number): void {
    if (!this.burrow.isBusy) {
      const cm = this.ball.diameterCm;
      this.announceRequests(this.progression.noteBallSize(cm));
      const offer = this.progression.checkPerkMilestone(cm);
      if (offer) this.offerPerks(offer, cm);
    }
    if (this.burrowIntroTimer > 0 && !this.choosing) {
      this.burrowIntroTimer -= frameTime;
      if (this.burrowIntroTimer <= 0) this.openBurrow(true);
    }
    this.hud.setHeat(this.progression.heat);
  }

  /** Marco de poder: 2 ou 3 opções abrem as cartas; 1 só vem de presente; 0 não faz nada. */
  private offerPerks(options: readonly PerkOffer[], cm: number): void {
    if (options.length === 0) return;
    if (options.length === 1) {
      const [{ id, rank }] = options;
      this.grantPerk(id);
      this.hud.notify(t(rank === 2 ? 'perk.gained.up' : 'perk.gained', { name: t(`perk.${id}.name` as MessageKey) }));
      return;
    }
    this.choosing = true;
    // O analógico de andar costuma estar apertado quando as cartas chegam: não vira navegação.
    this.input.gamepad.suppressHeldDirection();
    if (this.beetle.pushing) this.beetle.releaseBall();
    // Solta o mouse pra dar pra clicar nas cartas (o `choosing` impede que isso vire pausa).
    if (this.input.pointerLocked) document.exitPointerLock();
    this.hud.showPerkPicker(options, cm);
    this.audio.perkOffer();
  }

  private choosePerk(perk: PerkId): void {
    this.choosing = false;
    this.grantPerk(perk);
    // A escolha é um gesto (clique/tecla): dá pra prender o mouse de novo na hora.
    if (!this.hud.isTouch && !this.paused) this.input.requestPointerLock();
    this.canvas.focus();
  }

  private grantPerk(perk: PerkId): void {
    const rank = this.progression.takePerk(perk);
    this.audio.perkPick();
    switch (perk) {
      case 'nose':
        // O Faro já chega farejando: alguns montinhos viram fresquinhos e mais deles vão nascer (★★: de novo).
        this.collectibles.promoteFresh(NOSE_PROMOTE_COUNT);
        this.collectibles.freshChance = noseFreshChance(rank);
        break;
      case 'rider':
        // Poder de apertar: ensina a tecla assim que chega.
        this.abilityHintTimer = ABILITY_HINT_SECONDS;
        break;
      case 'stench':
        this.effects.setAttract(rank);
        break;
      case 'rainCall':
        this.weather.callRain(rank === 2);
        this.hud.notify(t('event.rainCall'));
        break;
      default:
        break;
    }
  }

  /** Comeu da despensa (na placa da toca): som e festa se subiu de nível. */
  private onMeal(meal: MealResult): void {
    this.audio.eat();
    if (meal.levelAfter > meal.levelBefore) this.audio.levelUp();
  }

  /** Progressão mudou → HUD (nível, pedidos, poderes, contador da despensa). */
  private syncRound(): void {
    const info = this.progression.levelProgress;
    this.hud.setRound({
      level: info.level,
      levelProgress: info.into / info.needed,
      requests: this.progression.requests,
      perks: this.progression.roundPerks,
    });
    this.hud.setPantryCount(this.progression.pantry.length);
    // Trocou de casco na toca: o besouro veste na hora (aparece por trás do menu).
    if (this.beetle) this.applySkin();
  }

  /**
   * Montinhos fresquinhos: um brilho de vez em quando (pra serem achados) e, com
   * o Faro, marcadores na tela apontando pros mais perto.
   */
  private updateFreshPiles(dt: number, player: THREE.Vector3): void {
    const nose = this.progression.hasPerk('nose');
    const spots = this.collectibles.freshSpots(this.freshSpots);
    const points = this.scentPoints;
    points.length = 0;
    if (this.paused || spots.length === 0) {
      this.hud.setScentMarkers(points);
      return;
    }

    this.freshGlintTimer -= dt;
    if (this.freshGlintTimer <= 0) {
      this.freshGlintTimer = FRESH_GLINT_SECONDS * (nose ? 0.5 : 1);
      const range = nose ? FRESH_GLINT_RANGE_NOSE : FRESH_GLINT_RANGE;
      const near = spots.filter((p) => Math.hypot(p.x - player.x, p.z - player.z) < range);
      const pick = near[Math.floor(Math.random() * near.length)];
      if (pick) this.effects.sparkle(this.tmpFocus.set(pick.x, pick.y + 0.7, pick.z), FRESH_GLINT_COLOR);
    }

    if (nose && !this.choosing) {
      const camera = this.graphics.camera;
      const sorted = spots
        .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.z - player.z) }))
        .filter((entry) => entry.d < SCENT_RANGE && entry.d > 2.5)
        .sort((a, b) => a.d - b.d)
        .slice(0, 4);
      for (const { p } of sorted) {
        const point = this.tmpMarker.set(p.x, p.y + 1.2, p.z);
        const behind = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0;
        point.project(camera);
        points.push({ ndcX: point.x, ndcY: point.y, behind });
      }
    }
    this.hud.setScentMarkers(points);
  }

  private computeHint(): { kind: HintKind; value: number } {
    if (this.paused || this.choosing) return { kind: 'none', value: 0 };
    if (this.dissolving) return { kind: 'dissolving', value: 0 };
    if (this.beetle.riding) return { kind: this.ridingHintTimer > 0 ? 'riding' : 'none', value: 0 };
    if (this.abilityFarTimer > 0) return { kind: 'abilityFar', value: 0 };
    if (this.abilityHintTimer > 0 && this.progression.rider.ready) return { kind: 'ability', value: 0 };
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
    if (this.paused || this.choosing || this.burrow.isBusy || distance < MARKER_HIDE_DISTANCE) {
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
    if (this.perfStage >= 2 || this.paused || this.choosing || settings.get().quality !== 'auto') return;
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
