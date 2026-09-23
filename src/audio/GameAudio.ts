import * as THREE from 'three';
import { isTouchDevice } from '../core/device';
import type { CritterSounds } from '../fx/critters/types';
import type { CollectEvent } from '../world/Collectibles';
import type { PickEvent } from '../world/Pickables';
import { clamp } from '../utils/math';
import { AudioEngine, type AudioVolumes, type Vec3Like } from './AudioEngine';
import type { AudioFrame } from './frame';
import { Foley } from './Foley';
import { Music } from './Music';
import { Soundscape } from './Soundscape';
import { UiSounds } from './UiSounds';
import { Wildlife } from './Wildlife';
import * as sfx from './voices/foley';
import { uiNotify } from './voices/ui';

/** Itens pegos dentro deste intervalo sobem a notinha do combo. */
const COMBO_WINDOW = 1.4;

/**
 * O áudio do jogo, do ponto de vista do `Game`: eventos ("pulou", "enterrou")
 * e um `update` por quadro com o retrato do mundo. Por dentro:
 *
 *   AudioEngine  contexto, mixagem, reverb, som 3D, ciclo de vida
 *   Foley        bola rolando, passos, água
 *   Soundscape   vento, chuva, trovão, passarinhos, grilos, coruja
 *   Wildlife     abelha, moscas, sapo, gafanhoto
 *   Music        trilha generativa e vinhetas
 *   UiSounds     cliques, foco e sliders do menu
 *
 * Tudo sintetizado na hora: não há nenhum arquivo de som no jogo.
 */
export class GameAudio {
  private readonly engine: AudioEngine;
  private readonly foley: Foley;
  private readonly soundscape: Soundscape;
  private readonly wildlife: Wildlife;
  private readonly music: Music;
  private frame: AudioFrame | null = null;
  /** O jogo abre no menu (madrugada). */
  private paused = true;
  private raining = false;
  private combo = 0;
  private comboTimer = 0;
  private readonly listener = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(uiRoot: HTMLElement) {
    // Celular: menos vozes simultâneas e reverb mais curto (CPU e bateria).
    this.engine = new AudioEngine(isTouchDevice ? 32 : 56, isTouchDevice ? 1.4 : 2.2);
    this.foley = new Foley(this.engine);
    this.soundscape = new Soundscape(this.engine);
    this.wildlife = new Wildlife(this.engine);
    this.music = new Music(this.engine);
    this.engine.onReady = () => {
      this.foley.start();
      this.soundscape.start();
      this.wildlife.start();
      this.music.start(this.paused ? 'night' : this.raining ? 'rain' : 'day');
    };
    new UiSounds(this.engine, uiRoot);

    // Navegadores só deixam tocar depois de um gesto: qualquer toque/tecla destrava
    // na primeira vez e acorda o áudio depois (o iOS interrompe em ligação, alarme…).
    const wake = () => this.engine.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend', 'click'] as const) {
      window.addEventListener(type, wake, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => this.engine.setHidden(document.hidden));
  }

  /** Quem os bichos avisam quando fazem barulho (vai para os efeitos visuais). */
  get critterSounds(): CritterSounds {
    return this.wildlife;
  }

  /** Chamar dentro de um gesto (o Jogar). */
  unlock(): void {
    this.engine.unlock();
  }

  setVolumes(volumes: AudioVolumes): void {
    this.engine.setVolumes(volumes);
    this.music.setEnabled(volumes.music > 0);
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
  }

  /** Menu aberto = madrugada (mundo abafado, grilos, trilha da noite); fechado = amanhecer. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.engine.setMuffle(paused ? 1 : 0, paused ? 0.8 : 1.6);
    this.soundscape.setNight(paused);
    if (paused) {
      this.music.restart('night');
      this.music.dusk();
    } else {
      this.music.restart(this.raining ? 'rain' : 'day');
      this.music.dawn();
    }
  }

  // --- eventos do jogo -----------------------------------------------------------

  jump(at: Vec3Like): void {
    this.engine.play(sfx.jump, { at });
  }

  land(at: Vec3Like, strength: number): void {
    const surface = this.frame ? this.foley.surfaceUnderPlayer(this.frame) : 'grass';
    this.engine.play(sfx.land(strength, surface), { at });
  }

  grab(at: Vec3Like): void {
    this.engine.play(sfx.grab, { at });
  }

  release(at: Vec3Like): void {
    this.engine.play(sfx.release, { at, key: 'release', minInterval: 0.2 });
  }

  /** Montinho virou bola, ou detrito grudou nela. */
  collect(event: CollectEvent, ballRadius: number): void {
    if (event.kind === 'dung') {
      this.engine.play(sfx.squish(clamp(ballRadius / 3, 0, 1)), { at: event.position, key: 'squish', minInterval: 0.04 });
      return;
    }
    this.engine.play(sfx.stick(event.material ?? 'pebble', event.size), { at: event.position, key: 'stick', minInterval: 0.025 });
    this.bumpCombo();
  }

  /** Tatuzinho enrolado grudou na bola. */
  critterStuck(at: Vec3Like): void {
    this.engine.play(sfx.stick('pillbug', 0.4), { at });
    this.bumpCombo();
  }

  /** Flor, cogumelo, pedra ou tronco arrancado do chão. */
  pluck(event: PickEvent): void {
    this.engine.play(sfx.pluck(event.kind, event.size), { at: event.ground, essential: true });
    this.bumpCombo();
  }

  impact(at: Vec3Like, strength: number, ballRadius: number): void {
    this.engine.play(sfx.thud(strength, ballRadius), { at, key: 'thud', minInterval: 0.08 });
  }

  /** Coisa que soltou da bola encolhendo na água. */
  shed(at: Vec3Like): void {
    this.engine.play(sfx.shed, { at, key: 'shed', minInterval: 0.05 });
  }

  /** Entrou na água (`size` 0..1: besouro ~0,15, bola grande ~1). */
  splash(at: Vec3Like, size: number): void {
    this.engine.play(sfx.splash(size), { at, key: size > 0.3 ? 'splash-big' : 'splash-small', minInterval: 0.2 });
  }

  burialStart(at: Vec3Like, radius: number): void {
    this.engine.play(sfx.burialStart(radius), { at, essential: true });
  }

  dig(at: Vec3Like, strength: number): void {
    this.engine.play(sfx.dig(strength), { at });
  }

  /** Bola enterrada: a terra fecha e a fanfarra toca (maior no recorde). */
  buried(at: Vec3Like, radius: number, record: boolean): void {
    this.engine.play(sfx.earthClose(radius), { at, essential: true });
    this.music.fanfare(record);
  }

  newBall(at: Vec3Like): void {
    this.engine.play(sfx.sprout, { at, essential: true });
    this.music.sprout();
  }

  recall(at: Vec3Like): void {
    this.engine.play(sfx.recall, { at, key: 'recall', minInterval: 0.3 });
  }

  /** Passou de um marco de tamanho (índice do marco). */
  milestone(index: number): void {
    this.music.milestone(index);
  }

  /** Subiu de nível. */
  levelUp(): void {
    this.music.levelUp();
  }

  /** Conquista feita. */
  achievement(): void {
    this.music.achievement();
  }

  /** Cartas de poder abriram. */
  perkOffer(): void {
    this.music.perkOffer();
  }

  /** Escolheu um poder. */
  perkPick(): void {
    this.music.perkPick();
  }

  /** Pedido da rodada cumprido. */
  requestDone(): void {
    this.music.requestDone();
  }

  /** O besouro comendo da despensa (menu aberto: vai no canal da interface). */
  eat(): void {
    const t = this.engine.now + 0.01;
    for (let i = 0; i < 3; i++) this.engine.play(sfx.squish(0.35 + i * 0.1), { bus: 'ui', when: t + i * 0.13, essential: true });
  }

  thunder(distance: number): void {
    this.soundscape.thunder(distance);
  }

  /** Aviso rápido (controle conectado). */
  notify(): void {
    this.engine.play(uiNotify, { bus: 'ui', essential: true });
  }

  // --- quadro --------------------------------------------------------------------

  update(dt: number, f: AudioFrame): void {
    this.frame = f;
    const s = f.scene;
    const camera = s.camera;
    // Ouvido entre a câmera e o besouro: em 3ª pessoa, ouvir "da câmera" deixa o herói longe demais.
    this.listener.copy(camera.position).lerp(s.player, 0.6);
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.engine.setListener(this.listener, this.forward, this.up);

    this.comboTimer = Math.max(0, this.comboTimer - dt);
    // Chuva muda a trilha (com folga, para não ficar trocando na garoa).
    if (!this.raining && s.rain > 0.4) this.raining = true;
    else if (this.raining && s.rain < 0.2) this.raining = false;
    if (!this.paused) this.music.setMood(this.raining ? 'rain' : 'day');
    // A trilha engrossa com o tamanho da bola e com o besouro trabalhando.
    const size = clamp((f.ballDiameterCm - 2) / 20, 0, 1);
    const busy = s.pushing ? 1 : Math.hypot(s.playerVelocity.x, s.playerVelocity.z) > 1 ? 0.5 : 0;
    this.music.setIntensity(0.22 + 0.5 * size + 0.2 * busy);

    this.foley.update(dt, f);
    this.soundscape.update(dt, f, this.listener);
    this.wildlife.update(dt, f);
  }

  /** Nível da saída em dBFS (só em desenvolvimento, para medir a mixagem). */
  readMeter(): { peak: number; rms: number } | null {
    return this.engine.readMeter();
  }

  private bumpCombo(): void {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 0;
    this.comboTimer = COMBO_WINDOW;
    this.music.pickup(this.combo);
  }
}
