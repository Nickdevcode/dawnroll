import * as THREE from 'three';
import { Physics, FIXED_DT, RAPIER, Groups, interactionGroups } from './core/Physics';
import { Input, isTextField } from './core/Input';
import { ThirdPersonCamera, CAMERA_PROBE_RADIUS, type CameraBall } from './core/ThirdPersonCamera';
import { ShowcaseCamera } from './core/ShowcaseCamera';
import { loadSave, writeSave, type SaveData } from './core/save';
import { Online } from './online/Online';
import { settings, nativePixelRatio, type GameSettings } from './core/settings';
import { Graphics, type RenderOptions } from './render/Graphics';
import { globalUniforms } from './render/shaderChunks';
import { clearFrameView, updateFrameView } from './render/frameView';
import { Terrain, terrainHeight, terrainNormal, dirtAmount, BURROW, PLAY_RADIUS } from './world/Terrain';
import { Scenery } from './world/Scenery';
import { Grass } from './world/Grass';
import { GroundCover } from './world/GroundCover';
import { Collectibles, FRESH_CHANCE, type DebrisMaterial, type StinkSource } from './world/Collectibles';
import { Pickables, type PickEvent } from './world/Pickables';
import { LooseObjects } from './world/LooseObjects';
import { AnthillColliders } from './world/AnthillColliders';
import type { PickableKind } from './world/scenery/context';
import { Burrow, MIN_BURY_RADIUS } from './world/Burrow';
import { Weather } from './world/Weather';
import { Puddles } from './world/Puddles';
import { sphereVolume } from './world/scenery/context';
import { DungBall, START_RADIUS } from './entities/DungBall';
import { Beetle } from './entities/Beetle';
import { Effects, type CritterEvent, type EffectsFrame } from './fx/Effects';
import { BeetleAura } from './fx/BeetleAura';
import { RareFind } from './world/RareFind';
import { rollRareFind } from './progression/rareFinds';
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
import { InviteToast } from './ui/InviteToast';
import { ClanStore } from './online/ClanStore';
import { Social } from './online/Social';
import type { RoomInvite } from './online/Friends';
import { ChestOverlay } from './ui/ChestOverlay';
import { SHOWCASE_SHEETS } from './ui/Menu';
import { ChestStage, CHEST_CHARGE_TIME, CHEST_FIRST_REWARD_DELAY, type ChestStageEvent } from './fx/ChestStage';
import { chestRewards, rarityRank, type ChestResult, type ChestReward } from './progression/economy';
import type { Rarity } from './progression/unlocks';
import type { ShowcaseFrameName } from './core/ShowcaseCamera';
import type { BootScreen } from './ui/BootScreen';
import type { ProjectedPoint } from './ui/screenMarker';
import { formatCm, t, type MessageKey } from './i18n';
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
import { accessory, isAccessoryId, type Outfit } from './progression/accessories';
import type { Look } from './progression/looks';
import { quality } from './core/device';
import { GRAVITY } from './core/Physics';
import { clamp, createRng, mixSeed, randomSeed } from './utils/math';
import { OnlinePlay, type NameplateSource, type OnlineBridge } from './net/OnlinePlay';
import { MAX_PLAYERS, type NetLook } from './net/protocol';
import type { CloseReason } from './net/NetSession';
import type { BallRecord, Happening, MergeMode } from './net/BallSync';
import type { RoundLedger } from './progression/food';
import type { InputState } from './core/Input';
import { DizzyStars } from './fx/DizzyStars';
import type { DebugBots } from './net/debugBots';
import { Podium } from './world/Podium';
import { MATCH_WIN_PASS_XP, standings, startSpot, type MatchView, type NetMatch } from './net/match';
import { TutorialGuide, type TutorialScene } from './tutorial/TutorialGuide';
import { hasPlayed, tutorialStartStep, writeTutorial } from './tutorial/storage';
import type { TutorialStepId } from './tutorial/steps';
import type { TutorialWorld } from './tutorial/Tutorial';

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
/** Tutorial: a bola mais longe que isso do besouro (sem ninguém empurrando) ganha a dica de trazer ela. */
const TUTORIAL_FAR_BALL = 7;
/** Retrato do mundo quando não há tutorial (reaproveitado: nada de objeto novo por quadro). */
const IDLE_TUTORIAL_WORLD: TutorialWorld = { suspended: true, running: false, pushing: false, ballCm: 0, buryCm: 0, ballFar: false };
const FRESH_GLINT_COLOR = new THREE.Color('#ffd479');
/** Online: brilho do broto nascendo e da bola que você pegou; o "ainda imune" é mais clarinho. */
const SPROUT_GOLD = new THREE.Color('#e6c46a');
const SPROUT_SHIMMER = new THREE.Color('#fff4c8');
/** Online: as cartas de poder ficam por cima do jogo; sem escolher, pega a selecionada depois disso. */
const ONLINE_PERK_SECONDS = 12;
/** Online, puxando (ou sendo puxado): um punhado de fiapos de bosta a cada tanto. */
const PULL_FX_SECONDS = 0.12;
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
const GardenSalt = { grass: 11, cover: 12, critters: 13, find: 14, collectibles: 15 } as const;
/** Achado raro: longe assim do besouro quando nasce (tem que explorar pra achar). */
const RARE_FIND_MIN_DISTANCE = 25;
/**
 * Pistas de perto: um brilhinho e um "plim" de vez em quando, só pra quem já
 * está explorando ali (de longe não há sinal nenhum além do item no capim).
 */
const RARE_FIND_GLINT_RANGE = 12;
const RARE_FIND_GLINT_SECONDS = 2.6;
const RARE_FIND_CHIME_RANGE = 15;
const RARE_FIND_CHIME_SECONDS = 3.4;
const RARE_FIND_GOLD = new THREE.Color('#ffc94a');
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
  /** Conta, save na nuvem e ranking (antes do Progression: ele já grava no construtor). */
  private readonly online = new Online({ save: this.save, replaceSave: (next) => this.replaceSave(next) });
  /** Amigos, convites e presença (anda sozinho com a conta aberta). */
  private readonly social = new Social(this.online);
  /** A turma (tag antes do apelido, convites, "Jogar com a turma"). */
  private readonly clans = new ClanStore(this.online, this.social);
  private readonly progression = new Progression(this.save, () => {
    writeSave(this.save);
    this.online.saveChanged();
  });

  private physics!: Physics;
  private terrain!: Terrain;
  private grass!: Grass;
  private groundCover!: GroundCover;
  private scenery!: Scenery;
  private collectibles!: Collectibles;
  private pickables!: Pickables;
  private looseObjects!: LooseObjects;
  private anthillColliders!: AnthillColliders;
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
  /** Online: sala, jogadores remotos e mundo compartilhado (nada acontece sem sala). */
  private net!: OnlinePlay;
  /** Online: cartas de poder abertas por cima do jogo (segundos até escolher sozinho; 0 = nenhuma). */
  private onlinePerkTimer = 0;
  private readonly nameplateSources: NameplateSource[] = [];
  /** Jardim cujo arranjo do online (montinhos e tralha sem desviar do besouro) já está aplicado. */
  private onlineLayoutSeed: number | null = null;
  /** Estrelinhas de tonto do seu besouro (trombada no online). */
  private readonly dizzyStars = new DizzyStars();
  /**
   * Online: a bola encostada na sua (pra dica e pros botões do toque). `give` =
   * dá pra fundir (apelido do dono; '' = uma sua largada), `pull` = dá pra puxar
   * a de quem; `holding`/`progress` = segurando qual e quanto (0..1).
   */
  private mergeHint: { give: string | null; pull: string | null; holding: MergeMode | null; progress: number } | null = null;
  /** Online: rival puxando a sua bola agora (apelido, pro aviso), e a bola dele (pro efeito). */
  private pulledBy: { nick: string; ball: DungBall } | null = null;
  /** Segundos até o próximo fiapo do efeito de puxar. */
  private pullFxTimer = 0;
  private readonly tmpPullFrom = new THREE.Vector3();
  private readonly tmpPullTo = new THREE.Vector3();
  private readonly tmpPullDir = new THREE.Vector3();
  /** Roda de reações aberta: o clique que já estava apertado ao abrir não manda nada. */
  private wheelGrabHeld = false;
  /** Desenvolvimento (`?bots=5`): besouros de mentira pra medir o custo de uma sala cheia. */
  private debugBots: DebugBots | null = null;
  /** Disputa: o pódio (só existe no fim da partida) e se a câmera está nele. */
  private podium: Podium | null = null;
  private podiumView = false;
  /** Disputa: último número da contagem que fez "tic" (um por número). */
  private countdownTick = -1;
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
  /** Tutorial da primeira vez: passos, cartão e marcadores. */
  private readonly tutorialGuide: TutorialGuide;
  /** Onde o tutorial começa no primeiro "Jogar" deste aparelho (null = já fez, ou já jogava antes dele existir). */
  private tutorialStart: TutorialStepId | null = null;
  /** O tutorial em curso começou sozinho (primeira vez), não pelo "Jogar o tutorial" da ajuda. */
  private tutorialAuto = false;
  private tutorialScene: TutorialScene | null = null;

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
  /** Visual vestido agora no besouro (casco + acessórios), pra só mexer quando muda. */
  private currentSkin: SkinId | null = null;
  private currentOutfit: Outfit | null = null;
  /** Partículas dos cascos vivos (magma, galáxia...). */
  private readonly aura = new BeetleAura();
  /** Câmera do provador (guarda-roupa aberto) e o visual que está sendo provado. */
  private readonly showcase = new ShowcaseCamera();
  private lookPreview: Look | null = null;
  private readonly freeArea = { x: 0, y: 0, width: 1, height: 1 };
  private readonly viewport = { width: 1, height: 1 };
  /** Achado raro do jardim atual (um acessório brilhando em algum canto). */
  private readonly rareFind = new RareFind();
  private rareGlintTimer = 0;
  private rareChimeTimer = 0;
  private readonly achievementToast: AchievementToast;
  /** Convites e pedidos de amizade no canto da tela. */
  private readonly inviteToast: InviteToast;
  /** O aviso de pedido dourado já saiu nesta rodada. */
  private goldenAnnounced = false;
  /** Baú abrindo no jardim (a cerimônia) e o cartão dela. */
  private readonly chestStage = new ChestStage();
  private readonly chestOverlay: ChestOverlay;
  /**
   * Baú da cerimônia em curso (null = nenhuma): o que saiu, a fila de prêmios,
   * qual está à mostra (-1 = nenhum ainda; >= total = resumo) e se pediu pra pular.
   */
  private chest: { key: string; rarity: Rarity; result: ChestResult | null; rewards: ChestReward[]; index: number; skip: boolean } | null = null;
  /** Ponto que a câmera do provador rodeia durante a cerimônia (no lugar do besouro). */
  private readonly chestAnchor = new THREE.Object3D();
  /** Contagens da cerimônia: até o primeiro prêmio sair, até a legenda do prêmio entrar, até o próximo baú cair. */
  private chestFirstTimer = 0;
  private chestLabelTimer = 0;
  private chestNextTimer = 0;
  private readonly chestSpot = new THREE.Vector3();
  private chestYaw = 0;
  /** O besouro como obstáculo da lente na cerimônia (a câmera não fica atrás dele). */
  private readonly beetleSphere: CameraBall = { center: new THREE.Vector3(), radius: 0.7 };

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
    this.tutorialGuide = new TutorialGuide(this.hud);
    this.menu = new Menu(uiRoot, this.hud.isTouch, this.progression, this.online, this.social, this.clans);
    // Depois do menu: o aviso de conquista fica por cima dele (dá pra conquistar comendo na toca).
    const achievementToast = (this.achievementToast = new AchievementToast(uiRoot));
    this.progression.onAchievement = (unlock) => {
      achievementToast.show(unlock);
      this.audio.achievement();
    };
    // Aviso dos amigos (convite, pedido): também por cima do menu, sem pausar nada.
    this.inviteToast = new InviteToast(uiRoot, () => (this.hud.isTouch && this.input.device !== 'gamepad' ? 'touch' : this.input.device));
    this.wireSocial();
    // Cartão da cerimônia do baú: por cima de tudo (menu e avisos).
    this.chestOverlay = new ChestOverlay(uiRoot);
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
    // Guarda-roupa, Feirinha e passe: provador (câmera de frente), provar os trancados, girar arrastando.
    this.menu.onSheetChange = (sheet) => {
      const showcase = sheet !== null && SHOWCASE_SHEETS.has(sheet);
      if (showcase && !this.showcase.active) this.showcase.resetSpin();
      this.showcase.active = showcase || this.podiumView;
      if (sheet === 'wardrobe') this.showcase.setFrame(this.menu.wardrobe.currentTab);
      else if (showcase) this.showcase.setFrame('skins');
      // Fechou a placa no meio do pódio: a câmera volta pro pódio.
      else if (this.podiumView) this.showcase.setFrame('podium');
      if (!showcase) this.setLookPreview(null);
      // Abrindo a Feirinha: os baús que o jogador tem já compilam (o primeiro não engasga).
      if (sheet === 'shop') this.warmChests();
      if (sheet === null && this.chest) this.endChest();
    };
    this.menu.wardrobe.onPreview = (look) => this.setLookPreview(look);
    this.menu.wardrobe.onTabChange = (tab) => this.showcase.setFrame(tab);
    this.menu.shop.onPreview = (look) => this.previewFromSheet(look);
    this.menu.pass.onPreview = (look) => this.previewFromSheet(look);
    this.menu.shop.onPurchase = () => this.audio.purchase();
    this.menu.wardrobe.onPurchase = () => this.audio.purchase();
    this.menu.pass.onClaim = () => this.audio.passClaim();
    this.menu.onOpenChest = (key) => this.beginChest(key);
    this.chestOverlay.onOpen = () => this.openChest();
    this.chestOverlay.onAdvance = () => this.advanceChest();
    this.chestOverlay.onSkip = () => this.skipChest();
    this.chestOverlay.onNext = () => this.nextChest();
    this.chestOverlay.onClose = () => this.endChest();
    this.chestOverlay.onWear = (look) => {
      this.setLookPreview(null);
      if (look.kind === 'skin') this.progression.setSkin(look.id);
      else this.progression.setAccessory(accessory(look.id).slot, look.id);
    };
    this.chestStage.onEvent = (event, at, rarity) => this.onChestEvent(event, at, rarity);
    this.menu.onShowcaseDrag = (dx) => this.showcase.drag(dx);
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
    this.weather.onThunder = (distance) => {
      this.audio.thunder(distance);
      this.net?.thunder(distance);
    };
    this.input.gamepad.onConnectionChange = (connected, style) => {
      this.menu.setGamepad(connected ? style : null);
      if (connected) {
        this.hud.notify(t('gamepad.connected'));
        this.audio.notify();
      }
    };
    // Quem mostra tecla/botão acompanha o dispositivo em uso (o que a pessoa mexeu por último, de propósito).
    this.input.onDeviceChange((device, style) => {
      this.hud.setInputDevice(device, style);
      this.menu.setInputDevice(device, style);
    });
    this.menu.setInputDevice(this.input.device, this.input.padStyle);
    this.menu.onReplayTutorial = () => this.replayTutorial();
    this.menu.onSkipTutorial = () => this.skipTutorial();
    this.hud.tutorial.onSkip = () => this.skipTutorial();
    const tutorial = this.tutorialGuide.tutorial;
    tutorial.onStepDone = (step) => {
      if (step === 'eat') this.audio.achievement();
      else this.audio.notify();
      this.rumble(0.12, 0.3, 90);
    };
    tutorial.onEnd = () => this.menu.setTutorialState(false, !this.net?.active);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    // Perdeu o mouse sem pausar (ex.: escolheu poder pelo controle): um clique na cena prende de novo.
    // Com o cartão do resultado aberto não: o mouse solto é pra clicar nele.
    canvas.addEventListener('click', () => {
      if (this.started && !this.paused && !this.choosing && !this.cardModal && !this.hud.isTouch && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    this.hud.onMatchCardChange = (open) => this.onMatchCard(open);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.lastTime = 0;
      // No celular não existe Esc: sair do app (ou trocar de aba) pausa o jogo. No online a
      // sala não pausa: o besouro só fica parado onde estava.
      if (this.started && !this.net?.active) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      // Digitando (e-mail, senha, apelido): nenhuma tecla é atalho.
      if (isTextField(e.target)) return;
      // Enter na tela inicial também começa (acessível pelo teclado).
      if (this.menu.isVisible && !this.startDisabled && document.activeElement === document.body && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.start();
      // J entra no convite que está no canto da tela (jogando com o mouse preso, não dá pra clicar).
      if (e.code === 'KeyJ' && !e.repeat && !this.chestOverlay.isOpen && this.inviteToast.acceptShortcut()) e.preventDefault();
      // Escolhendo poder o mouse já está solto: Esc pausa como no resto do jogo.
      if (e.code === 'Escape' && this.choosing && !this.paused) this.pause();
      // Cartão do resultado aberto (mouse solto): Esc fecha ele, como toda janela.
      else if (e.code === 'Escape' && this.cardModal && !this.paused) this.hud.closeMatchCard();
      // Atalho de desenvolvimento: F8 adianta o tempo para a próxima fase (sol → nublando → chuva...).
      if (import.meta.env.DEV && e.code === 'F8') this.weather.skipAhead();
    });
  }

  /**
   * Amigos: o que chega (convite, pedido, pedido aceito) vira aviso no canto,
   * sem pausar; "Entrar" leva direto pra sala (jogando ou no menu).
   */
  private wireSocial(): void {
    const social = this.social;
    const toast = this.inviteToast;
    social.onInvite = (invite) => {
      // Já está nessa sala (entrou pelo código, por exemplo): nada a avisar.
      if (this.net?.active && this.net.code === invite.code) return;
      toast.showInvite(invite);
      this.audio.notify();
    };
    social.onRequest = (from) => {
      toast.showRequest(from);
      this.audio.notify();
    };
    social.onAccepted = (from) => toast.showAccepted(from);
    social.onWithdraw = (id) => toast.withdraw(id);
    toast.onAccept = (invite) => void this.acceptInvite(invite);
    toast.onDismiss = (invite) => social.dismiss(invite);
    toast.onOpenFriends = () => {
      if (!this.menu.isVisible) this.pause();
      this.menu.openFriends();
    };
    this.clans.onInvite = (invite) => {
      toast.showClanInvite(invite);
      this.audio.notify();
    };
    toast.onOpenClan = () => {
      if (!this.menu.isVisible) this.pause();
      this.menu.openClan();
    };
    // Entrou numa turma (ou saiu) com a sala aberta: a tag nova vai pros outros (o `look` só sai se mudou).
    this.clans.subscribe(() => {
      if (this.net?.active) this.net.lookChanged();
    });
  }

  /** "Entrar" no convite (aviso ou atalho): entra na sala sem parar o jogo; com o menu aberto, mostra o lobby. */
  private async acceptInvite(invite: RoomInvite): Promise<void> {
    this.social.dismiss(invite);
    // Baú abrindo (só existe fora de sala): a cerimônia fecha antes de ir pro jardim da sala.
    if (this.chest) this.endChest();
    this.hud.notify(t('invite.joining', { name: invite.from.nickname }));
    const outcome = await this.net.join(invite.code);
    if (!outcome.ok) {
      this.hud.notify(t(`online.error.${outcome.error}` as MessageKey));
      return;
    }
    if (this.menu.isVisible) this.menu.showOnline();
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

    this.collectibles = new Collectibles(this.scenery, mixSeed(seed, GardenSalt.collectibles));
    scene.add(this.collectibles.group);
    this.pickables = new Pickables(this.physics, this.scenery);
    this.looseObjects = new LooseObjects(this.physics, this.scenery);
    this.anthillColliders = new AnthillColliders(this.physics);
    scene.add(this.looseObjects.group);
    this.burrow = new Burrow();
    scene.add(this.burrow.group);
    scene.add(this.rareFind.group);
    this.rareFind.compile = (object) => this.graphics.renderer.compileAsync(object, this.graphics.camera, scene).then(() => undefined);
    scene.add(this.chestStage.group);
    this.chestStage.compile = (object) => this.graphics.renderer.compileAsync(object, this.graphics.camera, scene).then(() => undefined);
    this.puddles = new Puddles();
    scene.add(this.puddles.group);
    this.frameInfo.puddles = this.puddles.states;

    this.spawn.set(0, terrainHeight(0, 0), 0);
    const ballSpawn = new THREE.Vector3(0, terrainHeight(0, 1.6) + START_RADIUS + 0.05, 1.6);
    this.ball = new DungBall(this.physics, ballSpawn);
    scene.add(this.ball.root);
    this.wireBall(this.ball);

    this.beetle = new Beetle(this.physics, this.spawn, this.ball);
    scene.add(this.beetle.model.root);
    this.placeRareFind();
    scene.add(this.aura.points);
    scene.add(this.dizzyStars.group);
    // Acessório com material novo compila em segundo plano antes de aparecer (sem engasgo).
    this.beetle.model.outfit.compile = (object) => this.graphics.renderer.compileAsync(object, this.graphics.camera, scene).then(() => undefined);
    this.applyLook();

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

    this.net = new OnlinePlay(this.onlineBridge(), () => this.online.player);
    this.menu.attachOnlinePlay(this.net);
    this.hud.attachOnlinePlay(this.net);
    this.wireEvents();
    this.wireCameraCollision();
    boot.step(0.88, 'loader.shaders');
    await nextFrame();

    // Aquece shaders antes de mostrar (evita engasgo no primeiro frame).
    this.graphics.renderer.compile(scene, this.graphics.camera);
    boot.step(1, 'loader.ready');

    this.startDisabled = false;
    // Primeira vez neste aparelho (sem conta: o que vale é o navegador)? O tutorial começa no "Jogar".
    this.tutorialStart = tutorialStartStep(this.save);
    const game = this;
    this.tutorialScene = {
      camera: this.graphics.camera,
      get beetle() {
        return game.beetle.center;
      },
      get ball() {
        return game.ball.root.position;
      },
      get ballRadius() {
        return game.ball.radius;
      },
      nearestPiles: (near, count, out, minDistance) => this.collectibles.nearestPiles(near, count, out, minDistance),
    };
    this.applySettings(settings.get());
    settings.subscribe((s, changed) => this.applySettings(s, changed));
    this.menu.setReady();
    // Janelinhas (boas-vindas, apelido) só com a tela de carregamento fora da frente: o
    // <dialog> modal sobe pro top layer e ficaria por cima dela (o primeiro quadro, que
    // ainda compila shader, pode segurar o loader por segundos depois do "pronto").
    void boot.finish().then(() => this.menu.setRevealed());
    // A parte online só liga com o jardim de pé (a biblioteca baixa em segundo plano).
    void this.online.start();
    // Link de convite (?sala=CÓDIGO): abre o "Jogar online" e entra na sala assim que a conta estiver pronta.
    const invite = new URLSearchParams(location.search).get('sala');
    if (invite) this.menu.openOnline(invite);
    // O jardim da segunda rodada já vai nascendo (no menu sobra tempo).
    this.prepareNextGarden();
    this.hud.setBall(this.ball.diameterCm, 0, 0);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.syncRound();
    requestAnimationFrame(this.frame);

    if (import.meta.env.DEV) {
      // `?bots=5`: sala cheia de mentira (medir desempenho sem 6 navegadores).
      const bots = Number(new URLSearchParams(location.search).get('bots'));
      if (bots > 0) void import('./net/debugBots').then(({ DebugBots }) => (this.debugBots = new DebugBots(scene, this.physics, Math.min(5, bots))));
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
        this.tutorialGuide.tutorial.noteJump();
      } else if (event === 'land') {
        const strength = THREE.MathUtils.clamp((this.beetle.landingSpeed - 6) / 10, 0, 1);
        this.audio.land(feet, strength);
        this.effects.land(feet, strength);
        this.cameraRig.shake(0.04 + strength * 0.08);
      } else if (event === 'grab') {
        this.audio.grab(feet);
      } else if (event === 'release') {
        this.audio.release(feet);
        // Agarrar no modo "alternar": a bola foi embora (pulo, enterro), a próxima pega é outra apertada.
        this.input.releaseGrabLatch();
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
    // Online: o que a sua bola pega vira evento da sala; o que renasce aqui (sendo o dono) também.
    this.pickables.onAbsorb = (id) => this.net.active && this.net.localAbsorb(id);
    this.looseObjects.onSwallow = (id) => this.net.active && this.net.localLoose(id);
    this.collectibles.onPileTaken = (i) => this.net.active && this.net.localPile(i);
    this.collectibles.onDebrisTaken = (i) => this.net.active && this.net.localDebris(i);
    this.collectibles.onPileSpawn = (i, seed, fresh) => this.net.active && this.net.pileSpawned(i, seed, fresh);
    this.collectibles.onDebrisSpawn = (i, seed) => this.net.active && this.net.debrisSpawned(i, seed);

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
    // No online o jardim é da sala (não recomeça a cada enterro): só brota uma bola nova.
    this.burrow.onFinished = () => (this.net.active ? this.newBall(false) : this.startNewRound());
  }

  /**
   * Sons e efeitos de uma bola sua: a do começo e, no online, as que você
   * ganha (broto, roubada). Tranco na câmera e poder Trombada só com a principal.
   */
  private wireBall(ball: DungBall): void {
    ball.onImpact = (strength) => {
      const main = ball === this.ball;
      if (strength > 0.25) {
        const at = ball.position(this.tmpBall);
        this.audio.impact(at, strength, ball.radius);
        this.effects.impact(at, ball.radius, strength);
        this.effects.startle(at, 2 + ball.radius);
        if (main) {
          this.cameraRig.shake(strength * 0.12 * Math.min(1, ball.radius / 1.5));
          this.rumble(strength * 0.7, strength * 0.4, 110);
        }
      }
      if (main) this.tryBump(strength);
    };
    ball.onShed = (at) => {
      this.effects.shed(at);
      this.audio.shed(at);
    };
  }

  /**
   * Online: a sua bola principal agora é outra (roubou, ganhou broto, pegou a
   * sua largada). Câmera, HUD, toca e pedidos passam a seguir ela; a rodada
   * (poderes, pedidos cumpridos) continua.
   */
  private setMainBall(ball: DungBall, ledger: RoundLedger): void {
    this.wireBall(ball);
    if (ball !== this.ball) {
      this.ball = ball;
      this.prevBallSpeed = 0;
      this.ballWasWet = false;
      this.roundPeakRadius = Math.max(START_RADIUS, ball.radius);
    }
    // Agarrado em outra (ajudando alguém, por exemplo): continua nela até soltar.
    if (!this.beetle.pushing) this.beetle.attachBall(ball);
    this.progression.useLedger(ledger);
  }

  /** Online: bola sua nova, fora de jogo até nascer (broto de quem perdeu a bola). */
  private createBall(): DungBall {
    const ball = new DungBall(this.physics, this.spawn);
    ball.park();
    this.graphics.scene.add(ball.root);
    this.wireBall(ball);
    return ball;
  }

  /** Onde brota uma bola nova: do lado do besouro, fora da boca da toca (senão seria "enterrada" de novo na hora). */
  private sproutSpot(out: THREE.Vector3): THREE.Vector3 {
    const facing = this.beetle.facing;
    let x = this.beetle.center.x + facing.x * 1.6;
    let z = this.beetle.center.z + facing.z * 1.6;
    const dx = x - BURROW.x;
    const dz = z - BURROW.z;
    const d = Math.hypot(dx, dz);
    const minDistance = BURROW.radius * 1.6;
    if (d < minDistance) {
      const k = d > 1e-3 ? minDistance / d : 1;
      x = BURROW.x + (d > 1e-3 ? dx * k : minDistance);
      z = BURROW.z + (d > 1e-3 ? dz * k : 0);
    }
    return out.set(x, terrainHeight(x, z) + START_RADIUS + 0.05, z);
  }

  /**
   * Online: agarrar escolhe a bola mais perto do lado do besouro (a sua, uma
   * sua largada ou a de outro jogador: empurrar junto, ou pegar se estiver
   * solta). Soltando, o besouro volta pra sua bola principal. Enterrando, nada
   * muda (a toca está conduzindo a principal).
   */
  private onlineGrab(state: InputState): void {
    const beetle = this.beetle;
    if (beetle.pushing || beetle.riding || beetle.dizzy || this.burrow.isBusy) return;
    if (state.grab) {
      const target = this.net.balls.pickGrabTarget();
      if (!target || target === beetle.currentBall) return;
      beetle.attachBall(target);
      if (!target.proxy) this.net.balls.promote(target);
    } else if (beetle.currentBall !== this.ball) beetle.attachBall(this.ball);
  }

  /**
   * Online: segurar fundir (F / ← / botão das duas bolas) ou puxar (C / ↑ /
   * botão do ímã) com a sua bola encostada noutra. Também confere se um rival
   * está puxando a SUA (aviso + tranco no controle: dá tempo de fugir) e solta
   * os fiapos do efeito de puxar (quem puxa e quem é puxado veem).
   */
  private updateMergeAndPull(state: InputState): void {
    const balls = this.net.balls;
    const free = !this.beetle.dizzy && !this.burrow.isBusy && !this.hud.perkPicker.visible;
    const view = balls.updateMerge(free && state.merge, free && state.pull, FIXED_DT);
    const nick = (rec: BallRecord): string => (rec.local ? '' : this.net.nickOf(rec.owner));
    this.mergeHint =
      view.give || view.pull ? { give: view.give ? nick(view.give) : null, pull: view.pull ? nick(view.pull) : null, holding: view.holding, progress: view.progress } : null;
    const puller = balls.pulledBy();
    const wasPulled = this.pulledBy !== null;
    this.pulledBy = puller ? { nick: this.net.nickOf(puller.owner), ball: puller.ball } : null;
    if (this.pulledBy && !wasPulled) this.rumble(0.5, 0.4, 260);
    const prey = view.holding === 'pull' ? (view.pull?.ball ?? null) : this.pulledBy ? this.ball : null;
    this.pullFxTimer -= FIXED_DT;
    if (!prey || this.pullFxTimer > 0) return;
    this.pullFxTimer = PULL_FX_SECONDS;
    const pullerBall = prey === this.ball ? this.pulledBy!.ball : this.ball;
    const to = pullerBall.position(this.tmpPullTo);
    const from = prey.position(this.tmpPullFrom);
    // Sai do ponto em que a bola puxada encosta na outra.
    from.add(this.tmpPullDir.subVectors(to, from).setLength(prey.radius));
    this.effects.pullStreak(from, to);
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

  /** Provando um visual trancado no guarda-roupa (null = volta pro que está salvo). */
  private setLookPreview(look: Look | null): void {
    this.lookPreview = look;
    if (this.beetle) this.applyLook();
  }

  /** Visual escolhido no guarda-roupa (ou sendo provado) → besouro (só o que mudou). */
  private applyLook(): void {
    const preview = this.lookPreview;
    const id = preview?.kind === 'skin' ? preview.id : this.progression.skin;
    if (id !== this.currentSkin) {
      this.currentSkin = id;
      const def = skin(id);
      this.beetle.model.setSkin(def);
      this.aura.setKind(def.aura ?? null, def.auraColors);
    }
    const outfit: Outfit = preview?.kind === 'acc' ? { ...this.progression.outfit, [accessory(preview.id).slot]: preview.id } : this.progression.outfit;
    const current = this.currentOutfit;
    if (!current || current.head !== outfit.head || current.face !== outfit.face || current.neck !== outfit.neck || current.back !== outfit.back) {
      this.currentOutfit = { ...outfit };
      this.beetle.model.setOutfit(outfit);
    }
    // Online: a sala vê a roupa nova (só o que está salvo; provar no guarda-roupa não conta).
    if (!preview && this.net?.active) this.net.lookChanged();
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
    // Contadores do rodeio (tempo em cima da bola) e da maratona (quanto a bola rolou).
    const v = this.ball.body.linvel();
    const rolled = this.ball.isSolid ? Math.hypot(v.x, v.z) * dt : 0;
    this.progression.noteMotion(this.beetle.riding ? dt : 0, rolled);
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
    this.cameraRig.collision = this.showcase.collision = {
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
  private prepareNextGarden(seed = randomSeed()): void {
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
    this.collectibles.relayout(mixSeed(this.scenery.seed, GardenSalt.collectibles), this.beetle.center);
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
    if (this.chest) this.endChest();
    this.menu.hide();
    this.hud.setVisible(true);
    this.hud.perkPicker.setSuspended(false);
    this.started = true;
    this.beginPendingTutorial();
    // Pros amigos: "jogando" (numa sala, o banco já sabe pelo ponto dela).
    this.social.setActivity('solo');
    this.announceGolden();
    // Voltando pra uma escolha de poder (ou pro cartão do resultado), o mouse continua solto (pra clicar).
    if (!this.hud.isTouch && !this.choosing && !this.cardModal) this.input.requestPointerLock();
    this.canvas.focus();
    if (this.cardModal && this.input.device === 'gamepad') this.hud.focusMatchCard();
  }

  private onPointerLockChange = (): void => {
    // Perdeu o mouse (Esc): pausa e mostra a tela de controles. Soltar pra escolher poder
    // (ou pro cartão do resultado da Disputa) não conta.
    if (!this.input.pointerLocked && this.started && !this.hud.isTouch && !this.choosing && !this.cardModal) this.pause();
  };

  /**
   * Cartão do resultado da Disputa: é uma janela. Abrindo, o mouse solta (dá pra
   * clicar nele, e soltar assim não pausa) e o controle ganha foco nele; fechando
   * (X, B, Esc, partida nova), o mouse volta a ficar preso no jogo.
   */
  private onMatchCard(open: boolean): void {
    if (open) {
      if (this.input.pointerLocked) document.exitPointerLock();
      this.input.gamepad.suppressHeldDirection();
      if (this.input.device === 'gamepad' && !this.paused) this.hud.focusMatchCard();
      return;
    }
    if (!this.started || this.paused) return;
    // Soltamos o mouse por código: o navegador deixa prender de novo sem clique (sem isso, um clique na cena prende).
    if (!this.hud.isTouch && !this.choosing && !this.input.pointerLocked) this.input.requestPointerLock();
    this.canvas.focus();
  }

  /** O cartão do resultado da Disputa está aberto: o besouro espera e o controle é dele. */
  private get cardModal(): boolean {
    return this.net?.active === true && this.hud.matchCardOpen;
  }

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
      // Cartão do resultado aberto: o controle anda nele (e nada vaza pro besouro).
      if (this.cardModal) {
        const state = this.input.state;
        state.jumpPressed = false;
        state.resetPressed = false;
        state.abilityPressed = false;
        for (const action of this.input.menuActions) this.hud.handleMatchCardGamepad(action);
        return;
      }
      // Direcional → entra no convite do canto (as cartas de poder usam o direcional: elas têm a vez).
      if (!this.choosing && this.input.gamepad.dpadPressed.right) this.inviteToast.acceptShortcut();
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
    // Cerimônia do baú: o controle é dela (A abre/avança, B fecha).
    if (this.chestOverlay.isOpen) {
      for (const action of this.input.menuActions) this.chestOverlay.handleGamepad(action);
      return;
    }
    // Start (controle) ou P (teclado) com o menu aberto: continua, como um "pausa" de ida e volta.
    if (this.input.pausePressed) {
      this.start();
      return;
    }
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

  /**
   * Pausa: a noite cai sobre o jardim e o menu volta (com "Continuar"). No online
   * o menu abre por cima do jogo rodando (a sala não para): sem noite e sem abafar o som.
   */
  private pause(): void {
    if (this.menu.isVisible) return;
    if (this.input.pointerLocked) document.exitPointerLock();
    this.input.gamepad.suppressHeldDirection();
    // Só com um passo na tela (no cartão final não há mais o que pular).
    this.menu.setTutorialState(this.tutorialGuide.tutorial.step !== null, !this.net.active);
    this.menu.show(true);
    this.social.setActivity('menu');
    const online = this.net.active;
    this.audio.setPaused(!online);
    this.effects.setMenuNight(!online);
    this.hud.setVisible(false);
    // Escolhendo poder: as cartas ficam atrás do menu e não podem ser escolhidas às cegas pelo teclado.
    this.hud.perkPicker.setSuspended(true);
  }

  /** Pausa e abre a placa da toca (T, View/Create no controle, botão do HUD ou a apresentação da primeira vez). */
  private openBurrow(intro = false): void {
    if (!this.started || this.choosing) return;
    this.burrowIntroTimer = 0;
    const tutorial = this.tutorialGuide.tutorial;
    // O tutorial pediu "abra a toca": ela abre com o recado de apresentação.
    if (tutorial.step === 'eat') intro = true;
    tutorial.noteBurrowOpened();
    this.pause();
    this.menu.openBurrow(intro);
  }

  /**
   * Atalhos que valem com ou sem menu: a toca abre e FECHA na mesma tecla/botão (T,
   * View/Create — como inventário nos jogos), e R3 / botão do meio põe a câmera de
   * volta atrás do besouro.
   */
  private handleShortcuts(): void {
    const input = this.input;
    if (input.burrowPressed && !this.startDisabled && !this.chestOverlay.isOpen) {
      if (!this.paused) {
        if (!this.cardModal) this.openBurrow();
      } else if (this.started && this.menu.currentSheet === 'burrow') {
        this.start();
      }
    }
    if (input.recenterPressed && this.started && !this.paused && !this.choosing) this.cameraRig.recenter(this.beetle.facing);
  }

  /**
   * Primeira vez neste aparelho: o tutorial começa (no "Jogar", ou — pra quem foi
   * direto pro online, onde não tem tutorial — quando volta pro próprio jardim).
   */
  private beginPendingTutorial(): void {
    if (!this.tutorialStart || this.net.active) return;
    this.tutorialGuide.tutorial.begin(this.tutorialStart);
    this.tutorialAuto = true;
    this.tutorialStart = null;
    // "Chegou a Feirinha! O que você já tinha virou presente" é o aviso de quem jogava antes
    // das moedas: pra quem está chegando agora (o primeiro enterro já dá conquista) não faz sentido.
    this.progression.markWelcomed();
  }

  /** "Jogar o tutorial" (Como jogar): recomeça do primeiro passo e volta pro jardim. */
  private replayTutorial(): void {
    if (this.net.active || this.startDisabled) return;
    this.tutorialGuide.tutorial.begin();
    this.tutorialAuto = false;
    this.tutorialStart = null;
    this.start();
  }

  /** "Pular tutorial" (pausa ou o botão do cartão no toque). */
  private skipTutorial(): void {
    this.tutorialGuide.tutorial.skip();
    this.tutorialStart = null;
    this.menu.setTutorialState(false, !this.net.active);
  }

  /** Um quadro do tutorial: o que o jogador está fazendo → passos, cartão e marcadores. */
  private updateTutorial(dt: number): void {
    const tutorial = this.tutorialGuide.tutorial;
    if (!tutorial.active) {
      this.tutorialGuide.update(dt, IDLE_TUTORIAL_WORLD, null, false);
      return;
    }
    const state = this.input.state;
    const moving = Math.hypot(state.moveX, state.moveY) > 0.2;
    const ballPos = this.ball.position(this.tmpBall);
    const far = !this.beetle.pushing && !this.burrow.isBusy && this.ball.isSolid && ballPos.distanceTo(this.beetle.center) - this.ball.radius > TUTORIAL_FAR_BALL;
    const online = this.net.active;
    this.tutorialGuide.update(
      dt,
      {
        suspended: !this.started || this.paused || this.choosing || online,
        running: state.run && moving,
        pushing: this.beetle.pushing,
        ballCm: this.ball.diameterCm,
        buryCm: MIN_BURY_RADIUS * 4,
        ballFar: far,
      },
      this.tutorialScene,
      this.started && !online && !this.podiumView,
    );
  }

  private get paused(): boolean {
    return this.menu.isVisible;
  }

  /**
   * A simulação anda? No solo, não com menu ou cartas abertas. No online sempre
   * (a sala não para por ninguém); com o menu aberto o besouro só não recebe comando.
   */
  private get simulating(): boolean {
    return this.net.active ? this.started : !this.paused && !this.choosing;
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
    // Sensibilidade por dispositivo: o mouse/dedo e o analógico têm escalas bem diferentes.
    this.input.pointerLookScale = s.mouseSensitivity;
    this.input.gamepad.lookScale = s.stickSensitivity;
    this.input.grabMode = s.grabMode;
    this.input.runMode = s.runMode;
    this.hud.setHoldModes({ grab: s.grabMode, run: s.runMode });
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

    // Online, o direcional ↑ do controle é "puxar" (o poder de apertar fica no X).
    this.input.gamepad.upIsPull = this.net.active;
    this.input.update();
    const look = this.input.consumeLook();
    this.handleGamepadMenu();
    this.handleShortcuts();
    this.updateEmoteWheel(look, frameTime);

    if (this.simulating) {
      if (this.paused) {
        // Online com o menu aberto: o jogo roda, mas o besouro e a câmera não recebem comando.
        this.clearInput();
      } else {
        // Disputa: na contagem, no "Tempo!", no pódio e com o cartão do resultado aberto o
        // besouro espera (a câmera continua solta).
        if (this.net.inputLocked || this.cardModal) this.clearInput();
        this.cameraRig.applyLook(look.x, look.y, look.zoom);
        this.tutorialGuide.tutorial.noteLook(Math.abs(look.x) + Math.abs(look.y));
      }
      // No toque e no controle, mirar é trabalhoso: a câmera volta sozinha pra trás do besouro (dá pra desligar).
      if ((this.hud.isTouch || this.input.device === 'gamepad') && settings.get().autoCamera) {
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
      this.updateOnlinePerks(frameTime);
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
    const alpha = this.simulating ? this.accumulator / FIXED_DT : 1;
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
    // Na Disputa o nível não dá força nem velocidade (todo mundo igual).
    this.progression.equalStats = this.net.equalStats;
    const ballVel = this.ball.body.linvel();
    const mods = this.progression.modifiers(this.ball.radius, Math.hypot(ballVel.x, ballVel.z));
    // Online: empurrar junto acelera a bola (quem ajuda mira na mesma velocidade do dono).
    if (this.net.active) mods.pushSpeed *= this.net.balls.pushSpeedBoost();
    this.beetle.modifiers = mods;
    this.collectibles.magnet = mods.magnet;
    this.pickables.pluckReach = mods.pluckReach;
    this.bumpCooldown = Math.max(0, this.bumpCooldown - FIXED_DT);

    // A toca vem antes da física: durante o enterro é ela quem conduz a bola.
    this.burrow.fixedUpdate(FIXED_DT, this.ball);
    this.applyWaterAndMud(FIXED_DT);
    this.applyWorldPerks(FIXED_DT);
    if (this.net.active) {
      this.onlineGrab(state);
      this.updateMergeAndPull(state);
    } else {
      this.mergeHint = null;
      this.pulledBy = null;
    }
    const beforeX = this.beetle.center.x;
    const beforeZ = this.beetle.center.z;
    this.beetle.fixedUpdate(FIXED_DT, state, this.cameraRig.yaw);
    // Tutorial: só conta o que o jogador andou (não o empurrão de uma bola crescendo).
    if (Math.hypot(state.moveX, state.moveY) > 0.2) this.tutorialGuide.tutorial.noteMove(Math.hypot(this.beetle.center.x - beforeX, this.beetle.center.z - beforeZ));
    this.updateRider(FIXED_DT);
    // Sangue quente: esquenta empurrando com o analógico/teclas apontando pra frente.
    this.progression.updateHeat(FIXED_DT, this.beetle.pushing && Math.hypot(state.moveX, state.moveY) > 0.3);
    this.net.beforePhysics();
    this.debugBots?.fixedUpdate(this.beetle.center);
    this.physics.step();
    this.ball.fixedUpdate(FIXED_DT);
    this.collectibles.fixedUpdate(FIXED_DT, this.ball, this.beetle.center);
    this.pickables.fixedUpdate(this.ball);
    this.looseObjects.fixedUpdate(this.ball);
    this.net.afterPhysics();
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
    if (this.ball.isParked) return;
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
    // Online: bola com bola doada dentro divide a comida; o que passou dos 30 cm vira Sol excedente.
    const online = this.net.active;
    const sunCm = this.ball.excessCm;
    const share = online ? this.net.burialShare() : 1;
    const outcome = this.progression.bury(result.diameterCm, { raining: this.weather.rain > 0.3, riding: this.buriedWhileRiding, share, sunCm });
    this.online.recordBurial(result.diameterCm);
    const points = online ? this.net.director.burialPreview(result.diameterCm, sunCm) : null;
    if (online) this.net.localBury(result.diameterCm, outcome.food.total, sunCm);
    if (online && sunCm > 0) this.progression.achieve('mpSun');
    if (points) this.hud.notify(t(points.sunset ? 'match.pointsSunset' : 'match.points', { n: Math.round(points.points) }));
    this.buriedWhileRiding = false;
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.hud.showResult({ ...result, record, outcome });
    if (outcome.meal && outcome.meal.levelAfter > outcome.meal.levelBefore) this.audio.levelUp();
    if (outcome.meal && outcome.meal.chests.length > 0) this.achievementToast.showChests(outcome.meal.chests);
    if (outcome.pass && outcome.pass.tierAfter > outcome.pass.tierBefore) this.achievementToast.showPassTier(outcome.pass.tierAfter);
    // A toca se apresenta sozinha só no solo (no online ela abriria por cima da sala rodando).
    // Com o tutorial pedindo pra abrir, quem abre é o jogador (aprende a tecla/botão).
    if (!online) this.tutorialGuide.tutorial.noteBuried();
    if (outcome.introduceBurrow && !online && !this.tutorialGuide.tutorial.wantsBurrow) this.burrowIntroTimer = BURROW_INTRO_DELAY;
    this.effects.buried(at, result.diameterCm / 4);
    this.audio.buried(at, result.diameterCm / 4, record);
    this.cameraRig.shake(0.1);
    this.rumble(0.8, 1, record ? 500 : 300);
  }

  /**
   * O progresso inteiro mudou por fora do jogo (save da nuvem juntado com o do
   * aparelho, ou o começo de novo ao sair da conta): recalcula e redesenha.
   */
  private replaceSave(next: SaveData): void {
    // Entrou numa conta que já tem progresso: quem já joga não precisa do tutorial da primeira vez.
    if (this.tutorialStart && hasPlayed(next)) {
      this.tutorialStart = null;
      writeTutorial({ status: 'done' });
    }
    if (this.tutorialAuto && this.tutorialGuide.tutorial.active && next.buried > 1) this.skipTutorial();
    this.progression.replaceSave(next);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
  }

  /** Rodada nova: um jardim novo (outro sorteio) e uma bola pequena brota do lado do besouro. */
  private startNewRound(): void {
    this.swapGarden();
    // O achado do jardim antigo (se ninguém pegou) foi embora junto; o novo jardim sorteia o dele.
    this.placeRareFind();
    // Teias voltam, bichos param de ser atraídos (o Fedor irresistível era da rodada).
    this.effects.newRound();
    this.newBall(true);
  }

  /**
   * Uma bola pequena brota do lado do besouro e a rodada recomeça (poderes,
   * pedidos). `newGarden`: o jardim acabou de ser trocado (solo); no online o
   * jardim é o mesmo e a sala fica sabendo da bola nova.
   */
  private newBall(newGarden: boolean, why: 'buried' | 'crumble' = 'buried'): void {
    // Online as cartas não congelam o jogo, então podem estar abertas quando a rodada acaba
    // (enterrou, a Disputa começou): eram da rodada velha e somem sem dar o poder
    // (senão o poder passava pra bola nova, e a Chuva ou o Faro disparavam pra sala à toa).
    if (this.net.active && this.hud.perkPicker.visible) {
      this.hud.perkPicker.hide();
      this.onlinePerkTimer = 0;
    }
    this.effects.setAttract(0);
    this.roundPeakRadius = START_RADIUS;
    this.abilityHintTimer = 0;
    this.abilityFarTimer = 0;
    this.ridingHintTimer = 0;
    this.antFriendTimer = 0;

    const position = this.sproutSpot(new THREE.Vector3());
    // Online, a principal pode estar guardada (broto esperando, pódio): brota aqui.
    if (this.ball.isParked) this.ball.unpark(position);
    else this.ball.reset(position);
    this.ball.endBurial();
    // A bola nova nasceu limpa: as coisas do jardim antigo que estavam grudadas já saíram.
    if (newGarden) this.pickables.reset();
    // Online: pra sala é outra bola (número novo, conteúdo novo).
    else this.progression.useLedger(this.net.localNewBall(why));
    this.progression.startRound();
    this.collectibles.freshChance = FRESH_CHANCE;
    this.hud.resetRound();
    this.goldenAnnounced = false;
    this.announceGolden();
    this.effects.sparkle(position, new THREE.Color('#e6c46a'));
    this.audio.newBall(position);
  }

  private renderFrame(alpha: number, dt: number): void {
    this.updateChest(dt);
    this.ball.render(alpha, dt);
    this.beetle.render(alpha, dt);
    this.net.render(alpha, dt);
    this.debugBots?.render(alpha, dt, this.graphics.camera.position);
    this.looseObjects.render(alpha);
    this.beetle.model.root.updateMatrixWorld();
    this.aura.update(dt, this.beetle.model.root, this.graphics.pixelScale);
    this.dizzyStars.update(dt, this.beetle.model.getHeadPosition(this.tmpMarker), this.beetle.dizzy);
    this.updateRareFind(dt);

    const player = this.beetle.renderPosition(alpha, this.tmpPlayer);
    const ballPos = this.ball.root.position;
    const burying = this.burrow.isBusy;
    // Empurrando junto (online), a câmera acompanha a bola do outro jogador.
    const held = this.beetle.pushing ? this.beetle.currentBall : this.ball;
    // Enterrando: a câmera enquadra besouro + toca (a bola some no chão).
    const cameraBall = burying ? this.tmpFocus.set(BURROW.x, BURROW.ground + 0.8, BURROW.z) : held.root.position;
    // A bola também é obstáculo da lente (menos afundando na toca, ou o broto que ainda não nasceu).
    this.cameraBall.center.copy(ballPos);
    this.cameraBall.radius = this.ball.radius;
    this.cameraRig.ball = burying || !this.ball.isSolid ? null : this.cameraBall;
    this.showcase.ball = this.cameraRig.ball;
    this.cameraRig.update(dt, player, cameraBall, held.radius, this.beetle.pushing || burying);
    const showcaseFocus = this.updateShowcase(dt);
    this.graphics.followFocus(player);
    // Jogando, o que é instanciado pelo mapa todo (montinhos, detritos, bichos) só desenha o que
    // cabe nesta visão; no menu vai tudo (é lá que cada shader compila, antes de o jogo começar).
    if (this.paused) clearFrameView();
    else updateFrameView(this.graphics.camera);

    const camera = this.graphics.camera;
    globalUniforms.uTime.value = this.elapsed;
    const pushers = globalUniforms.uPushers.value;
    // Raio generoso: com a grama densa, o besouro precisa de uma clareira para aparecer.
    // No provador a clareira abre mais (a câmera chega perto e a grama não pode tapar a lente).
    pushers[0].set(player.x, player.y, player.z, 0.95 + this.showcase.blend * 1.6);
    if (this.chestStage.active) {
      // Cerimônia do baú: o palco é uma clareira. Deita o capim em volta do baú e no
      // meio do caminho até a lente (senão uma folha tapa a cena inteira de perto).
      pushers[1].set(this.chestSpot.x, this.chestSpot.y, this.chestSpot.z, 1.8);
      const mid = this.tmpFocus.copy(camera.position).add(this.chestSpot).multiplyScalar(0.5);
      pushers[2].set(mid.x, this.chestSpot.y, mid.z, 1.6);
    } else if (this.podiumView && this.podium) {
      // Pódio da Disputa: o capim deita em volta de cada rodela (os besouros estão em cima
      // delas; a lente fica alta e longe, o capim não chega nela).
      this.podium.flattenGrass(pushers);
    } else {
      pushers[1].set(ballPos.x, ballPos.y - this.ball.radius, ballPos.z, this.ball.isSolid ? this.ball.radius * 1.05 : 0);
      // Provador: o capim em volta da lente deita (senão uma folha tapa o close).
      pushers[2].set(camera.position.x, camera.position.y - 1, camera.position.z, this.showcase.blend > 0.01 ? 1.3 * this.showcase.blend : 0);
    }
    this.grass.update(camera);
    this.groundCover.update(camera);
    this.graphics.setFocusDistance(this.showcase.blend > 0.5 ? showcaseFocus : camera.position.distanceTo(player));
    this.scenery.update(dt);
    this.collectibles.update(dt);
    this.burrow.update(dt, this.elapsed, this.ball.radius);
    this.updateEffects(dt, player);
    if (this.simulating && !this.paused) this.collectCritters();
    this.updateFreshPiles(dt, player);

    this.hud.setBall(this.ball.diameterCm, this.ball.dungCount, this.ball.itemCount);
    this.updateAbilityHud();
    const hint = this.computeHint();
    this.hud.setHint(hint.kind, hint.value, hint.label);
    this.updateTutorial(dt);
    this.updateBurrowMarker(player);
    this.updateNameplates();
    this.hud.updateMatch();
    this.updateMatchTicks();
    this.hud.setMergeAvailable(this.mergeHint?.give != null && !this.paused, this.mergeHint?.pull != null && !this.paused);
    this.hud.update(dt);
    this.updateAudio(dt, player);

    this.graphics.render(this.elapsed);
  }

  /**
   * Sorteia o achado raro do jardim atual (um acessório ainda trancado, às vezes)
   * e põe num lugar livre, longe do besouro. Em desenvolvimento, `?find=<id>`
   * força um acessório (pra testar).
   */
  private placeRareFind(): void {
    this.rareFind.clear();
    const rng = createRng(mixSeed(this.scenery.seed, GardenSalt.find));
    let id = rollRareFind((acc) => this.progression.isAccessoryUnlocked(acc), rng.next);
    if (import.meta.env.DEV) {
      const forced = new URLSearchParams(location.search).get('find');
      if (forced && isAccessoryId(forced)) id = forced;
    }
    if (!id) return;
    const beetle = this.beetle.center;
    // Esconderijo: no capim (fora da trilha de terra) e encostado em alguma coisa (pedra, flor,
    // cogumelo, brinquedo). Sem lugar assim, qualquer canto livre longe do besouro.
    for (let i = 0; i < 240; i++) {
      const tucked = i < 160;
      const a = rng.next() * Math.PI * 2;
      const d = 12 + Math.sqrt(rng.next()) * (PLAY_RADIUS - 16);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.hypot(x - beetle.x, z - beetle.z) < RARE_FIND_MIN_DISTANCE) continue;
      if (!this.scenery.isFree(x, z, 0.9) || this.scenery.isInsideSolid(x, z, 0.9) || this.scenery.isDug(x, z) || this.scenery.isCovered(x, z, 0.8)) continue;
      if (tucked && (dirtAmount(x, z) > 0.2 || this.scenery.isFree(x, z, 2.4))) continue;
      this.rareFind.place(id, x, z);
      this.rareGlintTimer = this.rareChimeTimer = 0;
      return;
    }
  }

  /**
   * Achado raro: anima, dá as pistas de perto (brilhinho e "plim") e confere se
   * o besouro (ou a bola) passou por cima.
   */
  private updateRareFind(dt: number): void {
    if (!this.rareFind.active) return;
    const player = this.beetle.renderPosition(1, this.tmpFocus);
    const at = this.rareFind.position!;
    this.rareFind.update(dt, player);
    if (this.paused || this.choosing || this.burrow.isBusy) return;
    const distance = player.distanceTo(at);
    this.rareGlintTimer -= dt;
    if (this.rareGlintTimer <= 0 && distance < RARE_FIND_GLINT_RANGE) {
      this.rareGlintTimer = RARE_FIND_GLINT_SECONDS;
      this.effects.sparkle(at, RARE_FIND_GOLD);
    }
    this.rareChimeTimer -= dt;
    if (this.rareChimeTimer <= 0 && distance < RARE_FIND_CHIME_RANGE) {
      this.rareChimeTimer = RARE_FIND_CHIME_SECONDS;
      this.audio.treasureTwinkle(at);
    }
    const ball = this.ball.root.position;
    const id = this.rareFind.collect(player, ball, this.ball.isSolid ? this.ball.radius : 0);
    if (!id) return;
    const where = at.clone();
    if (!this.progression.findAccessory(id)) return;
    this.effects.celebrate(where.setY(where.y - 0.8), 0.6);
    this.effects.sparkle(where.setY(where.y + 0.8), RARE_FIND_GOLD);
    this.audio.achievement();
    this.achievementToast.showFind({ kind: 'acc', id });
    this.rumble(0.5, 0.8, 350);
  }

  /**
   * Provador: enquadra o besouro no pedaço da tela que a placa do guarda-roupa
   * não cobre (à esquerda no computador, em cima no celular). Devolve a
   * distância da câmera até o alvo (foco do desfoque).
   */
  private updateShowcase(dt: number): number {
    if (!this.showcase.active && this.showcase.blend === 0) return 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.viewport.width = w;
    this.viewport.height = h;
    const free = this.freeArea;
    free.x = 0;
    free.y = 0;
    free.width = w;
    free.height = h;
    if (this.chest) {
      // Cerimônia do baú: o palco é o meio da tela, entre a legenda em cima e o rodapé.
      const stage = this.chestOverlay.stageRect();
      if (stage.height > 40) {
        free.x = stage.left;
        free.y = stage.top;
        free.width = stage.width;
        free.height = stage.height;
      }
    } else {
      const sheet = this.menu.showcaseSheet;
      // Pódio da Disputa: o cartão do resultado ocupa um canto, como uma placa.
      const rect = sheet ? sheet.getBoundingClientRect() : this.podiumView ? this.hud.matchCardRect() : null;
      if (rect) {
        // Placa do lado (computador): livre à esquerda dela. Placa embaixo (celular): livre em cima.
        if (rect.left > w * 0.25) free.width = rect.left;
        else if (rect.top > h * 0.2) free.height = rect.top;
      }
    }
    const podium = this.podiumView && !this.menu.showcaseSheet ? this.podium : null;
    const root = this.chest ? this.chestAnchor : podium ? podium.anchor : this.beetle.model.root;
    return this.showcase.apply(this.graphics.camera, root, dt, this.viewport, free);
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
    // Os formigueiros nascem com os bichos (primeiro quadro de cada jardim): a colisão vem junto.
    this.anthillColliders.sync(this.effects.anthills);
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
      // Online o jogo não congela nas cartas: com elas abertas, o próximo marco espera a vez.
      // Senão a bola que pula vários marcos de uma vez (roubo, fusão, tronco) troca as cartas sem dar o poder.
      const offer = this.hud.perkPicker.visible ? null : this.progression.checkPerkMilestone(cm);
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
    if (this.net.active) {
      // Online: a sala não congela. As cartas ficam por cima do jogo e escolhem sozinhas se ninguém escolher.
      this.onlinePerkTimer = ONLINE_PERK_SECONDS;
      this.hud.showPerkPicker(options, cm, true);
      this.audio.perkOffer();
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
    const wasOnline = this.onlinePerkTimer > 0;
    this.choosing = false;
    this.onlinePerkTimer = 0;
    this.grantPerk(perk);
    if (wasOnline) return;
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
        // No online quem decide os montinhos é o dono da sala.
        if (this.net.active) this.net.requestNose(NOSE_PROMOTE_COUNT);
        else this.collectibles.promoteFresh(NOSE_PROMOTE_COUNT);
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
        // O clima é de todo mundo: no online o dono da sala chama a chuva pra sala inteira.
        if (this.net.active) this.net.requestRain(rank === 2);
        else this.weather.callRain(rank === 2);
        this.hud.notify(t('event.rainCall'));
        break;
      default:
        break;
    }
  }

  // --- online ------------------------------------------------------------------------------

  /** O que o online precisa do jogo (ver `OnlineBridge`). */
  private onlineBridge(): OnlineBridge {
    const game = this;
    return {
      scene: this.graphics.scene,
      camera: this.graphics.camera,
      physics: this.physics,
      get scenery() {
        return game.scenery;
      },
      collectibles: this.collectibles,
      pickables: this.pickables,
      looseObjects: this.looseObjects,
      weather: this.weather,
      beetle: this.beetle,
      get ball() {
        return game.ball;
      },
      mainLedger: () => this.progression.ledger,
      createBall: () => this.createBall(),
      setMainBall: (ball, ledger) => this.setMainBall(ball, ledger),
      sproutSpot: (out) => this.sproutSpot(out),
      sprouted: (ball) => {
        const at = ball.position(this.tmpBall);
        this.effects.sparkle(at, SPROUT_GOLD);
        this.audio.newBall(at);
      },
      shimmer: (at, radius) => this.effects.sparkle(this.tmpFocus.set(at.x, at.y + radius * 0.8, at.z), SPROUT_SHIMMER),
      happened: (kind, nick, at) => this.onHappening(kind, nick, at),
      crumbled: (at, radius) => {
        this.effects.splat(at, Math.max(0.4, radius * 0.8));
        this.effects.dig(at, Math.min(1, 0.4 + radius * 0.2));
        this.audio.shed(at);
      },
      achieve: (id) => this.progression.achieve(id),
      profile: () => ({ nick: this.online.state.profile?.nickname ?? '?', look: this.currentLook() }),
      useGarden: (seed, slot) => this.useOnlineGarden(seed, slot),
      compile: (object) => this.graphics.renderer.compileAsync(object, this.graphics.camera, this.graphics.scene).then(() => undefined),
      notify: (text, kind) => {
        this.hud.notify(kind === 'host' ? t('online.youHost') : t(kind === 'join' ? 'online.joined' : 'online.left', { name: text }));
        if (kind === 'join') this.audio.notify();
      },
      remoteBurial: (cm, nick, share, food) => {
        const at = this.tmpMarker.set(BURROW.x, BURROW.ground, BURROW.z);
        this.effects.buried(at, cm / 4);
        // Tinha bola sua dentro: a sua parte da comida vem pra despensa.
        const gift = share > 0 ? this.progression.receiveShare(cm, food) : null;
        if (!gift) {
          this.hud.notify(t('online.buried', { name: nick, cm: formatCm(cm) }));
          return;
        }
        this.hud.notify(t('mp.share', { name: nick, n: gift.food }));
        this.audio.requestDone();
        this.hud.setProgress(this.save);
        this.menu.setProgress(this.save);
        if (gift.meal && gift.meal.levelAfter > gift.meal.levelBefore) this.audio.levelUp();
        if (gift.meal && gift.meal.chests.length > 0) this.achievementToast.showChests(gift.meal.chests);
      },
      tackle: (by, target, at, mine) => this.onTackle(by, target, at, mine),
      emote: (uid, emote, at) => {
        if (uid !== this.net.selfId) this.audio.notify();
        if (at) this.effects.sparkle(this.tmpFocus.set(at.x, terrainHeight(at.x, at.z) + 0.4, at.z), SPROUT_GOLD);
        void emote;
      },
      ended: (reason) => this.onlineEnded(reason),
      matchSetup: (seed, spot) => this.matchSetup(seed, spot),
      matchView: (view, prev) => this.onMatchView(view, prev),
      matchResult: (match, won) => this.onMatchResult(match, won),
    };
  }

  /** O que aconteceu com as bolas no online → aviso, som e tranco. */
  private onHappening(kind: Happening, nick: string, at: THREE.Vector3 | null): void {
    const name = nick || '?';
    switch (kind) {
      case 'took':
        this.hud.notify(t('mp.took', { name }));
        this.audio.grab(this.beetle.center);
        if (at) this.effects.sparkle(at, SPROUT_GOLD);
        break;
      case 'taken':
        this.hud.notify(t('mp.taken', { name }));
        this.audio.release(this.beetle.center);
        this.rumble(0.4, 0.6, 220);
        break;
      case 'swallowed':
        this.hud.notify(t('mp.swallowed', { name }));
        if (at) this.effects.splat(at, 1.2);
        this.audio.impact(at ?? this.beetle.center, 0.7, this.ball.radius);
        this.cameraRig.shake(0.08);
        break;
      case 'eaten':
        this.hud.notify(t('mp.eaten', { name }));
        this.audio.impact(this.beetle.center, 0.6, 1);
        this.rumble(0.6, 0.8, 300);
        break;
      case 'gave':
        this.hud.notify(nick ? t('mp.gave', { name }) : t('mp.gaveSomeone'));
        this.audio.requestDone();
        if (at) this.effects.celebrate(at, 0.5);
        break;
      case 'got':
        this.hud.notify(t('mp.got', { name }));
        this.audio.requestDone();
        if (at) this.effects.celebrate(at, 0.5);
        break;
      case 'joined':
        this.hud.notify(t('mp.joinedOwn'));
        this.audio.requestDone();
        if (at) this.effects.sparkle(at, SPROUT_GOLD);
        break;
      case 'pulled':
        this.hud.notify(t('mp.pulled', { name }));
        if (at) this.effects.splat(at, 1);
        this.audio.impact(at ?? this.beetle.center, 0.6, this.ball.radius);
        this.cameraRig.shake(0.06);
        break;
      case 'pulledMine':
        this.hud.notify(t('mp.pulledMine', { name }));
        this.audio.release(this.beetle.center);
        this.rumble(0.6, 0.8, 300);
        break;
      case 'crumbled':
        this.hud.notify(t('mp.crumbled'));
        break;
    }
  }

  /** Trombada decidida pelo dono da sala: tranco, poeira e som (e o aviso se foi com você). */
  private onTackle(by: string, target: string, at: THREE.Vector3, mine: 'by' | 'target' | null): void {
    this.effects.impact(at, 0.5, 0.9);
    this.effects.startle(at, 4);
    this.audio.impact(at, 0.9, 0.6);
    if (mine === 'target') {
      this.hud.notify(t('mp.bumped', { name: by }));
      this.cameraRig.shake(0.14);
      this.rumble(0.9, 0.7, 350);
    } else if (mine === 'by') {
      this.hud.notify(t('mp.tackled', { name: target }));
      this.cameraRig.shake(0.08);
      this.rumble(0.6, 0.4, 180);
      this.progression.achieve('mpTackle');
    }
  }

  /** Visual salvo agora (o que a sala vê). */
  private currentLook(): NetLook {
    const outfit = this.progression.outfit;
    return { skin: this.progression.skin, head: outfit.head, face: outfit.face, neck: outfit.neck, back: outfit.back, tag: this.clans.tag };
  }

  /**
   * Deixa o jardim na semente da sala. Se for outro jardim, troca na hora (e o
   * besouro e a bola vão pro começo, a bola do mesmo tamanho). Montinhos e
   * tralha vão pro arranjo do online (sem desviar do besouro: todo mundo igual).
   * O começo de cada um é a sua vaga no círculo do nascimento (o da largada da
   * Disputa): no mesmo ponto, os besouros nasciam um dentro do outro.
   */
  private useOnlineGarden(seed: number, slot: number): void {
    if (this.scenery.seed !== seed) {
      this.prepareNextGarden(seed);
      this.swapGarden();
      this.pickables.reset();
      this.placeRareFind();
      const spot = startSpot(slot, MAX_PLAYERS);
      this.beetle.teleport(this.tmpMarker.set(spot.x, terrainHeight(spot.x, spot.z), spot.z), spot.yaw);
      this.cameraRig.yaw = spot.yaw + Math.PI;
      this.cameraRig.reset();
      // A bola na frente do besouro (olhando pra fora do círculo), a 1,6 da superfície como antes.
      const r = this.ball.radius;
      const bx = spot.x + Math.sin(spot.yaw) * (1.6 + r);
      const bz = spot.z + Math.cos(spot.yaw) * (1.6 + r);
      this.ball.teleport(new THREE.Vector3(bx, terrainHeight(bx, bz) + r + 0.05, bz));
    }
    // Reconectando no mesmo jardim, o arranjo já está certo (o mundo do dono ajusta só o que mudou).
    if (this.onlineLayoutSeed === seed) return;
    this.onlineLayoutSeed = seed;
    this.collectibles.relayout(mixSeed(seed, GardenSalt.collectibles), null);
  }

  /** A sala acabou (saiu, caiu a internet): volta pro solo, no jardim em que estava. */
  private onlineEnded(reason: CloseReason): void {
    this.onlinePerkTimer = 0;
    this.onlineLayoutSeed = null;
    this.progression.equalStats = false;
    this.countdownTick = -1;
    // Saiu no pódio: o besouro desce e a bola (guardada) volta.
    if (this.podiumView || this.podium?.visible) this.leavePodium(true);
    if (this.hud.perkPicker.visible) this.hud.perkPicker.pickSelected();
    if (reason !== 'left') this.hud.notify(t(reason === 'full' ? 'online.error.room_full' : 'online.lost'));
    // Novo aqui e foi direto pro online: de volta ao próprio jardim, o tutorial começa agora (e não
    // "do nada" depois de uma pausa). Com o menu aberto, começa no "Continuar".
    if (this.started && !this.paused) this.beginPendingTutorial();
  }

  // --- Disputa ------------------------------------------------------------------------------

  /**
   * Largada da Disputa (ou entrou no meio dela): o jardim da partida, as suas
   * bolas zeradas (um broto do lado) e o besouro no lugar dele no círculo do
   * nascimento, olhando pra fora.
   */
  private matchSetup(seed: number, spot: { x: number; z: number; yaw: number }): void {
    this.leavePodium(false);
    this.burrow.cancel();
    this.useOnlineGarden(seed, this.net.slot);
    this.net.balls.clearForMatch();
    this.beetle.teleport(this.tmpMarker.set(spot.x, terrainHeight(spot.x, spot.z), spot.z), spot.yaw);
    // A câmera atrás do besouro, olhando pra onde ele olha (nasce lá, sem deslizar pelo jardim).
    this.cameraRig.yaw = spot.yaw + Math.PI;
    this.cameraRig.reset();
    this.newBall(false, 'crumble');
    if (this.net.director.view === 'playing') this.hud.notify(t('match.lateJoin'));
  }

  /** A fase da Disputa mudou: som, pódio (a trava do besouro é `net.inputLocked`). */
  private onMatchView(view: MatchView, prev: MatchView): void {
    if (prev === 'ended' && view !== 'ended') this.leavePodium(view === 'idle');
    switch (view) {
      case 'countdown':
        this.countdownTick = -1;
        break;
      case 'playing':
        if (prev === 'countdown') {
          this.audio.abilityReady();
          this.rumble(0.4, 0.4, 160);
        }
        break;
      case 'overtime':
        this.audio.perkOffer();
        this.rumble(0.5, 0.5, 250);
        break;
      case 'ended':
        this.showPodium();
        break;
      default:
        break;
    }
  }

  /** Um "tic" por número da contagem (3, 2, 1). */
  private updateMatchTicks(): void {
    const director = this.net.director;
    if (!this.net.active || director.view !== 'countdown') {
      this.countdownTick = -1;
      return;
    }
    const n = Math.ceil(director.match.startsAt - this.net.time);
    if (n === this.countdownTick || n < 1 || n > 3) return;
    this.countdownTick = n;
    this.audio.notify();
  }

  /**
   * Fim da Disputa: cada um põe o próprio besouro no degrau do seu lado (os
   * outros veem pelos retratos de sempre) e a câmera enquadra o pódio. A bola
   * não sobe: a principal recomeça guardada e brota quando o jardim voltar a
   * ser livre.
   */
  private showPodium(): void {
    const match = this.net.director.match;
    const podium = (this.podium ??= new Podium(this.physics));
    podium.show(this.graphics.scene);
    this.burrow.cancel();
    this.net.balls.clearForMatch();
    this.progression.useLedger(this.net.localNewBall('crumble'));
    this.ball.endBurial();
    this.ball.park();
    const sides = standings(match);
    const self = this.net.selfId;
    let rank = sides.findIndex((s) => s.uids.includes(self));
    let index = 0;
    let count = 1;
    if (rank >= 0 && rank < 3) {
      index = sides[rank].uids.indexOf(self);
      count = sides[rank].uids.length;
    } else {
      // Do 4º lugar pra baixo (ou quem chegou no pódio): fila da frente.
      const row = sides.slice(3).flatMap((s) => s.uids);
      if (!row.includes(self)) row.push(self);
      rank = 3;
      index = row.indexOf(self);
      count = row.length;
    }
    const spot = podium.spot(rank, index, count, this.tmpMarker);
    this.beetle.teleport(spot.position, spot.yaw);
    this.podiumView = true;
    this.hud.setPodium(true);
    this.showcase.obstacles = [];
    this.showcase.steady = true;
    if (!this.menu.showcaseSheet) {
      this.showcase.active = true;
      this.showcase.resetSpin();
      this.showcase.setFrame('podium');
      // Corte seco: misturando, a lente varria de trás do besouro até o pódio atravessando os outros.
      this.showcase.snap();
    }
    this.effects.celebrate(podium.top(0, this.tmpFocus), 1);
    this.audio.achievement();
  }

  /**
   * O pódio acabou: some e a câmera volta pro besouro. `release` = o jardim
   * voltou a ser livre: o besouro desce pro círculo do nascimento e a bola brota.
   */
  private leavePodium(release: boolean): void {
    const was = this.podiumView || !!this.podium?.visible;
    this.podiumView = false;
    this.podium?.hide();
    this.hud.setPodium(false);
    if (!was) return;
    if (!this.chest && !this.menu.showcaseSheet) {
      this.showcase.active = false;
      this.showcase.steady = false;
      this.showcase.setFrame('skins');
      // Corte seco de volta pro besouro (a saída também varreria o pódio cheio de gente).
      this.showcase.snap();
    }
    if (!release) return;
    const spot = startSpot(this.net.active ? Math.max(0, this.net.players.findIndex((p) => p.isSelf)) : 0, Math.max(1, this.net.players.length));
    this.beetle.teleport(this.tmpMarker.set(spot.x, terrainHeight(spot.x, spot.z), spot.z), spot.yaw);
    this.cameraRig.yaw = spot.yaw + Math.PI;
    this.cameraRig.reset();
    if (this.net.active) this.newBall(false, 'crumble');
    else if (this.ball.isParked) this.ball.unpark(this.sproutSpot(this.tmpBall));
  }

  /** Resultado da Disputa: quem ganhou leva XP de passe e a conquista. */
  private onMatchResult(_match: NetMatch, won: boolean): void {
    if (!won) return;
    this.progression.matchWon(MATCH_WIN_PASS_XP);
    this.hud.setProgress(this.save);
    this.menu.setProgress(this.save);
    this.audio.levelUp();
  }

  /** Online: cartas de poder por cima do jogo (direcional do controle, e escolha sozinha no fim do tempo). */
  private updateOnlinePerks(dt: number): void {
    // Com o menu aberto as cartas ficam suspensas: o relógio da escolha espera junto.
    if (this.onlinePerkTimer <= 0 || this.paused) return;
    this.hud.perkPicker.handleDpad(this.input.gamepad.dpadPressed);
    this.onlinePerkTimer -= dt;
    if (this.onlinePerkTimer <= 0 && this.hud.perkPicker.visible) this.hud.perkPicker.pickSelected();
  }

  /** Placas com o apelido de cada jogador da sala (em cima do besouro dele). */
  private updateNameplates(): void {
    const sources = this.net.active && !this.paused ? this.net.nameplates(this.nameplateSources) : (this.nameplateSources.length = 0, this.nameplateSources);
    this.hud.setNameplates(sources, this.graphics.camera);
  }

  /** Menu aberto no online: nada do teclado/controle chega no besouro. */
  private clearInput(): void {
    const state = this.input.state;
    state.moveX = state.moveY = 0;
    state.grab = state.run = state.merge = state.pull = false;
    state.jumpPressed = state.resetPressed = state.abilityPressed = state.emotePressed = false;
  }

  /**
   * Online: roda de reações. G / ↓ / o botão do toque abre (e, aberta, manda a
   * acesa); aberta, o mouse (ou o analógico direito) aponta a frase em vez de
   * girar a câmera, e clique/A manda. Nada disso vaza pro besouro.
   */
  private updateEmoteWheel(look: { x: number; y: number }, dt: number): void {
    const state = this.input.state;
    const wheel = this.hud.emoteWheel;
    if (!wheel || !this.net?.active) {
      state.emotePressed = false;
      return;
    }
    const blocked = !this.started || this.paused || this.choosing || this.hud.perkPicker.visible || this.cardModal;
    if (state.emotePressed) {
      state.emotePressed = false;
      if (!blocked) {
        if (wheel.isOpen) wheel.confirm();
        else wheel.show();
      }
    }
    if (blocked) {
      if (wheel.isOpen) wheel.hide();
      return;
    }
    wheel.update(dt);
    if (!wheel.isOpen) {
      this.wheelGrabHeld = state.grab;
      return;
    }
    wheel.aim(look.x, look.y);
    look.x = look.y = 0;
    const pad = this.input.gamepad;
    if (pad.dpadPressed.left) wheel.step(-1);
    if (pad.dpadPressed.right) wheel.step(1);
    // B do controle fecha sem mandar nada.
    if (this.input.menuActions.includes('back')) {
      wheel.hide();
      return;
    }
    const grabEdge = state.grab && !this.wheelGrabHeld;
    this.wheelGrabHeld = state.grab;
    if (grabEdge || state.jumpPressed) wheel.confirm();
    state.grab = false;
    state.jumpPressed = false;
  }

  /** Comeu da despensa (na placa da toca): som e festa se subiu de nível. */
  private onMeal(meal: MealResult): void {
    this.audio.eat();
    if (meal.levelAfter > meal.levelBefore) this.audio.levelUp();
    if (meal.chests.length > 0) this.achievementToast.showChests(meal.chests);
  }

  // --- baús ------------------------------------------------------------------------------

  /** Visual provado da Feirinha ou do passe: veste por cima e a câmera enquadra o lugar dele. */
  private previewFromSheet(look: Look | null): void {
    this.setLookPreview(look);
    if (this.chest) return;
    this.showcase.setFrame(look === null || look.kind === 'skin' ? 'skins' : (accessory(look.id).slot as ShowcaseFrameName));
  }

  /** Compila os baús que o jogador tem (os dois mais raros), um de cada vez, fora da cerimônia. */
  private warmChests(): void {
    const rarities = [...new Set(this.progression.chests.map((c) => c.rarity))].slice(0, 2);
    void rarities.reduce((chain, rarity) => chain.then(() => this.chestStage.warm(rarity)), Promise.resolve());
  }

  /**
   * Começa a cerimônia: o baú cai do lado do besouro (num lugar livre, de
   * frente pra câmera) e a câmera vem enquadrar os dois.
   */
  private beginChest(key: string): void {
    const grant = this.progression.chests.find((c) => c.key === key);
    if (!grant || !this.beetle) return;
    // A cerimônia escurece o jardim e vira a câmera: no meio da sala, não (os baús esperam).
    if (this.net.active) {
      this.hud.notify(t('online.chestLater'));
      return;
    }
    this.chest = { key, rarity: grant.rarity, result: null, rewards: [], index: -1, skip: false };
    this.placeChestSpot();
    this.menu.setChestMode(true);
    this.chestStage.present(grant.rarity, this.chestSpot, this.chestYaw);
    this.chestOverlay.showWaiting(grant.rarity, this.progression.chests.length - 1);
    this.showcase.obstacles = [this.beetleSphere];
    this.showcase.steady = true;
    this.showcase.active = true;
    this.showcase.resetSpin();
    this.showcase.setFrame('chest');
    this.resetChestTimers();
  }

  /** Tocou pra abrir: sorteia (já grava no save) e o baú estoura. */
  private openChest(): void {
    const chest = this.chest;
    if (!chest || chest.result || !this.chestStage.active) return;
    const result = this.progression.openChest(chest.key);
    if (!result) {
      this.endChest();
      return;
    }
    chest.result = result;
    chest.rewards = chestRewards(result);
    chest.index = -1;
    chest.skip = false;
    this.chestStage.open(result, chest.rewards);
    this.chestOverlay.showOpening();
    this.chestFirstTimer = CHEST_CHARGE_TIME + CHEST_FIRST_REWARD_DELAY;
  }

  /**
   * Casco novo: o besouro prova do lado do baú. Só quando o prêmio aparece (ou
   * no resumo, se pulou): vestir antes entregava o suspense.
   */
  private previewChestSkin(): void {
    const look = this.chest?.result?.look;
    if (look?.startsWith('skin:')) this.setLookPreview({ kind: 'skin', id: look.slice(5) as SkinId });
  }

  /** Tira o prêmio `index` do baú; a legenda entra quando ele aparece (depois do suspense, nos raros). */
  private showChestReward(index: number): void {
    const chest = this.chest;
    if (!chest) return;
    chest.index = index;
    this.chestOverlay.clearReward();
    this.chestLabelTimer = Math.max(0.01, this.chestStage.showReward(index));
  }

  /** Tocou no palco (ou Continuar): próximo prêmio, ou o resumo depois do último. */
  private advanceChest(): void {
    const chest = this.chest;
    if (!chest?.result || chest.index < 0 || chest.index >= chest.rewards.length) return;
    // Sem atropelar: o prêmio da vez tem que ter aparecido (toque duplo não pula dois).
    if (!this.chestStage.rewardSettled) return;
    if (chest.index < chest.rewards.length - 1) this.showChestReward(chest.index + 1);
    else this.summarizeChest();
  }

  /** Pular: vai direto pro resumo (se a tampa ainda nem estourou, vai assim que estourar). */
  private skipChest(): void {
    const chest = this.chest;
    if (!chest?.result || chest.index >= chest.rewards.length) return;
    if (this.chestFirstTimer > 0) chest.skip = true;
    else this.summarizeChest();
  }

  /** Resumo: tudo que saiu no cartão, e o visual (ou a moedona) boiando em cima do baú. */
  private summarizeChest(): void {
    const chest = this.chest;
    if (!chest?.result) return;
    chest.index = chest.rewards.length;
    this.chestLabelTimer = 0;
    this.chestStage.showSummary();
    this.chestOverlay.showSummary(chest.result, this.progression.chests.length);
    this.previewChestSkin();
  }

  private resetChestTimers(): void {
    this.chestFirstTimer = 0;
    this.chestLabelTimer = 0;
    this.chestNextTimer = 0;
  }

  /** Próximo baú da pilha (o mais raro primeiro), no mesmo lugar. */
  private nextChest(): void {
    if (!this.chest) return;
    this.chestStage.dismiss();
    this.setLookPreview(null);
    this.chestFirstTimer = 0;
    this.chestLabelTimer = 0;
    this.chestNextTimer = 0.4;
    this.chest.result = null;
    this.chest.rewards = [];
    this.chest.index = -1;
    this.chest.skip = false;
  }

  /** Fim da cerimônia: o baú some e a Feirinha volta. */
  private endChest(): void {
    if (!this.chest) return;
    this.chest = null;
    this.chestStage.dismiss();
    this.chestOverlay.hide();
    this.setLookPreview(null);
    this.menu.setChestMode(false);
    this.showcase.obstacles = [];
    this.showcase.steady = false;
    this.showcase.setFrame('skins');
    this.showcase.resetSpin();
    this.resetChestTimers();
  }

  /** Relógios da cerimônia (mostrar o prêmio, derrubar o próximo baú). */
  private updateChest(dt: number): void {
    this.chestStage.update(dt, this.graphics.camera.position);
    const chest = this.chest;
    if (!chest) return;
    if (this.chestFirstTimer > 0) {
      this.chestFirstTimer -= dt;
      if (this.chestFirstTimer <= 0 && chest.result) {
        if (chest.skip) this.summarizeChest();
        else this.showChestReward(0);
      }
    }
    if (this.chestLabelTimer > 0) {
      this.chestLabelTimer -= dt;
      const reward = chest.rewards[chest.index];
      if (this.chestLabelTimer <= 0 && reward) this.chestOverlay.showReward(reward, chest.rewards.length - 1 - chest.index);
    }
    if (this.chestNextTimer > 0) {
      this.chestNextTimer -= dt;
      if (this.chestNextTimer <= 0) {
        const next = this.progression.chests[0];
        if (!next) {
          this.endChest();
          return;
        }
        chest.key = next.key;
        chest.rarity = next.rarity;
        chest.result = null;
        this.chestStage.present(next.rarity, this.chestSpot, this.chestYaw);
        this.chestOverlay.showWaiting(next.rarity, this.progression.chests.length - 1);
      }
    }
    this.showcase.setFrame('chest');
    this.beetleSphere.center.copy(this.beetle.model.root.position).y += 0.3;
    // A câmera rodeia o baú (o besouro fica atrás dele, aparecendo).
    this.chestAnchor.position.copy(this.chestSpot);
    this.chestAnchor.rotation.set(0, this.chestYaw, 0);
  }

  /**
   * Onde o baú cai: entre o besouro e a câmera (o lado que ela já enxerga
   * livre), um pouco de lado, de frente pra ela. Tenta umas posições e fica
   * com a primeira longe de pedra, tronco e da bola; sem nada livre, a primeira.
   */
  private placeChestSpot(): void {
    const beetle = this.beetle.model.root.position;
    const camera = this.graphics.camera.position;
    const toCam = this.tmpFocus.set(camera.x - beetle.x, 0, camera.z - beetle.z);
    if (toCam.lengthSq() < 1e-4) toCam.set(0, 0, 1);
    toCam.normalize();
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x);
    const ball = this.ball.root.position;
    const clearOfBall = this.ball.radius * 1.3 + 0.55;
    // [pra frente (rumo à câmera), pro lado]
    const tries: ReadonlyArray<readonly [number, number]> = [
      [0.95, 0.35],
      [0.95, -0.35],
      [1.2, 0.7],
      [1.2, -0.7],
      [0.7, 1.0],
      [0.7, -1.0],
      [1.5, 0],
    ];
    let chosen: THREE.Vector3 | null = null;
    for (const [ahead, lateral] of tries) {
      const x = beetle.x + toCam.x * ahead + side.x * lateral;
      const z = beetle.z + toCam.z * ahead + side.z * lateral;
      if (Math.hypot(x - ball.x, z - ball.z) < clearOfBall) continue;
      if (!this.scenery.isFree(x, z, 0.45)) continue;
      if (Math.hypot(x, z) > PLAY_RADIUS - 1) continue;
      chosen = new THREE.Vector3(x, 0, z);
      break;
    }
    if (!chosen) chosen = new THREE.Vector3(beetle.x + toCam.x * 0.95 + side.x * 0.35, 0, beetle.z + toCam.z * 0.95 + side.z * 0.35);
    chosen.y = terrainHeight(chosen.x, chosen.z);
    this.chestSpot.copy(chosen);
    // De frente pra câmera.
    this.chestYaw = Math.atan2(camera.x - chosen.x, camera.z - chosen.z);
  }

  /** Momentos do show do baú → som e partículas. */
  private onChestEvent(event: ChestStageEvent, at: THREE.Vector3, rarity: Rarity): void {
    switch (event) {
      case 'land':
        this.audio.chestLand();
        this.effects.land(at, 0.9);
        break;
      case 'rattle':
        this.audio.chestRattle();
        break;
      case 'burst':
        this.audio.chestBurst(rarityRank(rarity));
        this.effects.celebrate(at, 0.25 + rarityRank(rarity) * 0.08);
        this.rumble(0.5, 0.8, 250);
        break;
      case 'suspense':
        // O visual raro carregando: o baú chacoalha de novo.
        this.audio.chestRattle();
        this.rumble(0.25, 0.4, 300);
        break;
      case 'flash':
        // Clarão do épico/lendário: o estouro de novo, mais forte.
        this.audio.chestBurst(Math.max(2, rarityRank(rarity)));
        this.effects.celebrate(at, 0.5);
        this.rumble(0.7, 1, 320);
        break;
      case 'coin':
        this.audio.coinClink();
        break;
      case 'dew':
        this.audio.dewChime();
        break;
      case 'reveal':
        this.audio.itemReveal();
        this.effects.sparkle(at, new THREE.Color('#ffe7a3'));
        this.previewChestSkin();
        break;
    }
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
    // Trocou de visual no guarda-roupa: o besouro veste na hora (aparece por trás do menu).
    if (this.beetle) this.applyLook();
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

  private computeHint(): { kind: HintKind; value: number; label?: string } {
    // Roda de reações aberta: a dica não fica por trás dela.
    if (this.paused || this.choosing || this.hud.emoteWheel?.isOpen) return { kind: 'none', value: 0 };
    if (this.dissolving) return { kind: 'dissolving', value: 0 };
    if (this.net.active) {
      const online = this.onlineHint();
      if (online) return online;
    }
    if (this.beetle.riding) return { kind: this.ridingHintTimer > 0 ? 'riding' : 'none', value: 0 };
    if (this.abilityFarTimer > 0) return { kind: 'abilityFar', value: 0 };
    if (this.abilityHintTimer > 0 && this.progression.rider.ready) return { kind: 'ability', value: 0 };
    if (this.burrowHintTimer > 0) return { kind: 'burrowTooSmall', value: MIN_BURY_RADIUS * 4 };
    if (this.tooSmallTimer > 0) return { kind: 'tooSmall', value: this.tooSmallCm };
    if (this.burrow.isBusy) return { kind: 'none', value: 0 };
    if (this.beetle.pushing) return { kind: this.pushTutorialTime < 5 ? 'pushing' : 'none', value: 0 };
    const ballPos = this.ball.position(this.tmpBall);
    const dist = ballPos.distanceTo(this.beetle.center) - this.ball.radius;
    // O cartão do tutorial já está ensinando a agarrar: a dica de baixo não repete.
    return { kind: dist < 1.4 && !this.tutorialGuide.tutorial.teachingGrab ? 'grab' : 'none', value: 0 };
  }

  /** Dicas do online (na frente das de sempre): tonto, broto chegando, puxando a sua, fundir/puxar, empurrando junto, bola solta. */
  private onlineHint(): { kind: HintKind; value: number; label?: string } | null {
    const balls = this.net.balls;
    if (this.beetle.dizzy) return { kind: 'dizzy', value: 0 };
    const sprout = balls.sproutIn;
    if (sprout > 0) return { kind: 'sprout', value: Math.ceil(sprout) };
    if (this.burrow.isBusy) return null;
    const merge = this.mergeHint;
    // Segurando: a dica do que está fazendo, com a barrinha enchendo.
    if (merge?.holding === 'pull') return { kind: 'pull', value: merge.progress, label: merge.pull ?? '' };
    if (merge?.holding === 'give') return { kind: merge.give ? 'merge' : 'mergeOwn', value: merge.progress, label: merge.give ?? '' };
    // Um rival puxando a sua: o aviso passa na frente (é hora de fugir).
    if (this.pulledBy) return { kind: 'pulled', value: 0, label: this.pulledBy.nick };
    // A mesma bola dá pra doar e pra puxar (rival no Jardim livre): as duas escolhas na dica.
    if (merge?.give && merge.give === merge.pull) return { kind: 'mergeOrPull', value: 0, label: merge.pull };
    if (merge?.pull) return { kind: 'pull', value: 0, label: merge.pull };
    if (merge) return { kind: merge.give ? 'merge' : 'mergeOwn', value: 0, label: merge.give ?? '' };
    const helping = balls.assistingOwner();
    if (helping) return { kind: 'coPush', value: 0, label: this.net.nickOf(helping) };
    if (!this.beetle.pushing) {
      const loose = balls.looseNearby(1.4);
      if (loose) return { kind: 'steal', value: 0, label: this.net.nickOf(loose.owner) };
    }
    return null;
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
