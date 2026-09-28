import * as THREE from 'three';
import { buildAccessory } from '../entities/outfit/registry';
import type { AccessoryModel, OutfitPose } from '../entities/outfit/types';
import { lathe, starShape, extrude } from '../entities/outfit/parts';
import type { ChestResult, ChestReward } from '../progression/economy';
import { lookFromKey, lookRarity } from '../progression/looks';
import { skin } from '../progression/skins';
import { BeetleModel, type BeetlePose } from '../entities/BeetleModel';
import type { Rarity } from '../progression/unlocks';
import { clay } from '../render/clayMaterial';
import { clamp, damp } from '../utils/math';
import { buildChestModel, CHEST_D, CHEST_H, CHEST_STYLES, CHEST_W, type ChestModel } from './chestModels';
import { glowTexture, markAsLight, pulseRingMaterial, raysTexture } from './glow';

/**
 * O baú abrindo no jardim, em 3D, no jeito do Clash Royale: ele cai do céu do
 * lado do besouro, quica e fica chacoalhando esperando o toque; ao abrir a
 * tampa estoura, sobe um facho de luz da cor do baú e as moedas espirram. Aí
 * os prêmios saem UM POR VEZ da boca do baú e param no ar em cima dele, com
 * raios de luz atrás: a moedona, a gota de orvalho e, por último, o visual. O
 * visual épico ou lendário faz suspense antes (uma bola de luz que pulsa e
 * cresce) e estoura num clarão. No fim, o resumo: o visual (ou a moedona) fica
 * boiando em cima do baú aberto.
 *
 * Mora na cena do jogo (pega a luz, o contorno e o bloom de tudo), num grupo
 * que fica escondido fora da cerimônia. Quem manda é o `Game`: `present` (cai),
 * `open` (abre com o resultado já sorteado), `showReward` (o próximo prêmio),
 * `showSummary` e `dismiss` (some).
 */

/**
 * Momentos do show: `burst` = a tampa estourou; `coin`/`dew` = moedona/gota
 * saindo; `suspense` = o visual raro começou a carregar; `flash` = estourou o
 * clarão do visual épico/lendário; `reveal` = o visual apareceu.
 */
export type ChestStageEvent = 'land' | 'rattle' | 'burst' | 'coin' | 'dew' | 'suspense' | 'flash' | 'reveal';

type Phase = 'hidden' | 'drop' | 'idle' | 'charge' | 'open' | 'leave';

const W = CHEST_W;
const D = CHEST_D;
const H = CHEST_H;
/** Altura de onde ele cai. */
const DROP_HEIGHT = 1.8;
const DROP_TIME = 0.55;
const CHARGE_TIME = 0.42;
/** Do toque até a tampa estourar (a carga). */
export const CHEST_CHARGE_TIME = CHARGE_TIME;
/** Do estouro até o primeiro prêmio começar a sair. */
export const CHEST_FIRST_REWARD_DELAY = 0.3;
const MAX_COINS = 16;
/** Tamanho (maior medida) do visual que sai do baú. */
const ITEM_SIZE = 0.72;
const GRAVITY = 7;
/** Onde o prêmio para no ar (em cima do baú, um tiquinho pra frente). */
const PRESENT = new THREE.Vector3(0, H + 0.66, 0.16);
/** Subindo da boca do baú até o lugar / saindo pra dar vez ao próximo (s). */
const ENTER_TIME = 0.5;
const EXIT_TIME = 0.24;
/** Suspense do visual (bola de luz carregando) por raridade (s). */
const SUSPENSE: Record<Rarity, number> = { common: 0, rare: 0, epic: 0.9, legendary: 1.4 };
/** Cor dos raios atrás do prêmio. */
const RAY_COLORS: Record<Rarity, string> = { common: '#fff1d0', rare: '#9fd0ff', epic: '#c89bff', legendary: '#ffd45a' };
const COIN_RAYS = '#ffcf5a';
const DEW_RAYS = '#8fdcff';

interface Coin {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  bounced: boolean;
}

/** Um prêmio em cena: entrando, parado no ar ou saindo. */
interface Presented {
  object: THREE.Object3D;
  kind: ChestReward['kind'];
  /** Relógio desde que começou a entrar (ou a sair). */
  t: number;
  leaving: boolean;
  /** Segundos de suspense antes de aparecer (0 = aparece direto). */
  suspense: number;
  revealed: boolean;
  rays: string;
  /** Visual animado (hélice, asas...) que roda enquanto está em cena. */
  model: AccessoryModel | null;
}

/** Facho de luz subindo do baú: cone aberto que some pra cima. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        // max(): pow de base negativa é NaN, e um NaN no alvo da cena se espalha pelo
        // bloom e pelo desfoque até apagar a tela inteira.
        float up = pow(max(1.0 - vUv.y, 0.0), 1.6);
        float rays = 0.65 + 0.35 * sin(vUv.x * 62.83 + uTime * 3.0);
        gl_FragColor = vec4(uColor, clamp(up * rays * uFade * 0.55, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Moedona do prêmio de moedas: disco com a borda levantada e o solzinho em relevo dos dois lados. */
function bigCoin(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const disc = lathe(
    [
      [0.001, 0.011],
      [0.1, 0.011],
      [0.112, 0.02],
      [0.128, 0.017],
      [0.132, 0],
      [0.128, -0.017],
      [0.112, -0.02],
      [0.1, -0.011],
      [0.001, -0.011],
    ],
    40,
    0,
  ).rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(disc, material));
  const sun = extrude(starShape(10, 0.066, 0.046), 0.008, 0.003);
  for (const side of [1, -1]) {
    const face = new THREE.Mesh(sun, material);
    face.position.z = side * 0.013;
    group.add(face);
  }
  // Do tamanho de um prêmio de verdade no palco (a moeda solta do chão é bem menor).
  group.scale.setScalar(1.75);
  return group;
}

/** Gotona do prêmio de orvalho, com três gotinhas girando em volta. */
function bigDrop(geometry: THREE.BufferGeometry, material: THREE.Material): { group: THREE.Group; orbit: THREE.Group } {
  const group = new THREE.Group();
  const drop = new THREE.Mesh(geometry, material);
  drop.scale.setScalar(6);
  drop.position.y = -0.02;
  group.add(drop);
  const orbit = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const small = new THREE.Mesh(geometry, material);
    small.position.set(Math.cos(a) * 0.27, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.27);
    small.scale.setScalar(1.7);
    orbit.add(small);
  }
  group.add(orbit);
  return { group, orbit };
}

type LookKeyOf = Extract<ChestReward, { kind: 'look' }>['look'];

export class ChestStage {
  readonly group = new THREE.Group();
  /** Compila os shaders antes de aparecer (o jogo liga no renderizador). */
  compile: ((object: THREE.Object3D) => Promise<void>) | null = null;
  /** Momentos do show (o jogo toca o som e solta as partículas). A posição é no mundo. */
  onEvent: ((event: ChestStageEvent, at: THREE.Vector3, rarity: Rarity) => void) | null = null;

  private readonly models = new Map<Rarity, ChestModel>();
  private model: ChestModel | null = null;
  private rarity: Rarity = 'common';
  private phase: Phase = 'hidden';
  private phaseTime = 0;
  private time = 0;
  private squash = 0;
  private squashVelocity = 0;
  private rattleTimer = 0;
  private readonly holder = new THREE.Group();
  private readonly coins: Coin[] = [];
  private readonly coinGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.016, 24);
  private readonly coinMat = clay('#ffc94a', { roughness: 0.28, sheen: 0.3, bump: 0.04, clearcoat: 1, mottle: 0.03, mottleScale: 20 });
  private readonly dropGeo = lathe(
    [
      [0.001, -0.035],
      [0.026, -0.024],
      [0.032, 0],
      [0.022, 0.024],
      [0.008, 0.042],
      [0.001, 0.05],
    ],
    20,
    0,
  );
  private readonly dropMat = clay('#8fdcff', { roughness: 0.06, sheen: 0.1, bump: 0, clearcoat: 1, mottle: 0, iridescence: 0.8 });
  private readonly beam: THREE.Mesh;
  private readonly beamMat = beamMaterial();
  private readonly ring: THREE.Mesh;
  private readonly ringMat = pulseRingMaterial(new THREE.Color(1, 1, 1));
  /** Brilho mole: atrás do prêmio (ou a própria bola de luz, no suspense). */
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  /** Raios girando atrás do prêmio. */
  private readonly rays: THREE.Sprite;
  private readonly raysMat: THREE.SpriteMaterial;
  private readonly coinPresenter: THREE.Group;
  private readonly dewPresenter: THREE.Group;
  private readonly dewOrbit: THREE.Group;
  /** Onde o visual do prêmio entra (centrado no giro). */
  private readonly itemSpinner = new THREE.Group();
  private item: THREE.Object3D | null = null;
  private itemModel: AccessoryModel | null = null;
  /**
   * Prêmio de casco: um besourinho de verdade vestindo o casco que saiu (o
   * desenho do casco vem do shader dele). Montado na primeira vez e reaproveitado.
   */
  private mannequin: BeetleModel | null = null;
  private readonly mannequinPose: BeetlePose = { speed: 0, grounded: true, pushBlend: 0, pushSpeed: 0, verticalSpeed: 0, strain: 0 };
  private rewards: readonly ChestReward[] = [];
  private current: Presented | null = null;
  private outgoing: Presented | null = null;
  private readonly pose: OutfitPose = { time: 0, dt: 0, speed: 0, pushBlend: 0, airborne: 0, verticalSpeed: 0, headPitch: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly cameraAt = new THREE.Vector3();
  private readonly rayColor = new THREE.Color();
  private pendingResult: ChestResult | null = null;
  private warming = false;
  /** Tilintar da moedona (três "plins" em sequência): segundos até cada um. */
  private coinChimes: number[] = [];

  constructor() {
    this.group.name = 'chest-stage';
    this.group.visible = false;
    this.group.add(this.holder);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.14, 1.7, 32, 1, true).translate(0, 0.85 + H * 0.6, 0), this.beamMat);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2).translate(0, 0.015, 0), this.ringMat);
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halo = new THREE.Sprite(this.haloMat);
    this.raysMat = new THREE.SpriteMaterial({ map: raysTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.rays = new THREE.Sprite(this.raysMat);
    for (const light of [this.beam, this.ring, this.rays, this.halo]) {
      markAsLight(light);
      this.group.add(light);
    }
    // No suspense o brilho é a própria bola de luz, na frente do resto.
    this.halo.renderOrder = 12;
    this.coinPresenter = bigCoin(this.coinMat);
    const dew = bigDrop(this.dropGeo, this.dropMat);
    this.dewPresenter = dew.group;
    this.dewOrbit = dew.orbit;
    for (const presenter of [this.coinPresenter, this.dewPresenter, this.itemSpinner]) {
      presenter.visible = false;
      presenter.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.group.add(presenter);
    }
    for (let i = 0; i < MAX_COINS; i++) {
      const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.coins.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), resting: false, bounced: false });
    }
  }

  /** Está no meio de uma cerimônia (de cair até sumir)? */
  get active(): boolean {
    return this.phase !== 'hidden';
  }

  /** Esperando o toque pra abrir (já caiu e parou). */
  get waiting(): boolean {
    return this.phase === 'idle';
  }

  /** O prêmio da vez já apareceu e quase parou (dá pra passar pro próximo sem atropelar). */
  get rewardSettled(): boolean {
    const c = this.current;
    return c !== null && !c.leaving && c.revealed && c.t >= c.suspense + ENTER_TIME * 0.55;
  }

  /**
   * Prepara os shaders de um baú antes de ele aparecer (sem engasgo no
   * primeiro): monta lá embaixo do chão, compila e desmonta. Só fora da cerimônia.
   */
  async warm(rarity: Rarity): Promise<void> {
    if (this.phase !== 'hidden' || this.warming) return;
    this.warming = true;
    const model = this.modelFor(rarity);
    this.holder.add(model.root);
    this.group.position.set(0, -60, 0);
    this.group.visible = true;
    const presenters = [this.coinPresenter, this.dewPresenter];
    for (const coin of this.coins) coin.mesh.visible = true;
    for (const p of presenters) p.visible = true;
    try {
      await this.compile?.(this.group);
    } catch {
      // Sem compilar antes: só engasga um pouquinho na primeira vez.
    }
    this.warming = false;
    // Começou uma cerimônia enquanto compilava: ela já arrumou tudo.
    if (this.phase !== 'hidden') return;
    for (const coin of this.coins) coin.mesh.visible = false;
    for (const p of presenters) p.visible = false;
    this.holder.remove(model.root);
    this.group.visible = false;
  }

  /** O baú cai do céu em `position` (chão), de frente pro ângulo `yaw`. */
  present(rarity: Rarity, position: THREE.Vector3, yaw: number): void {
    this.clearRewards();
    for (const child of [...this.holder.children]) this.holder.remove(child);
    this.rarity = rarity;
    this.model = this.modelFor(rarity);
    this.model.lid.rotation.x = 0;
    this.holder.add(this.model.root);
    this.group.position.copy(position);
    this.group.rotation.set(0, yaw, 0);
    this.group.scale.setScalar(1);
    this.group.visible = true;
    const glow = new THREE.Color(CHEST_STYLES[rarity].glow);
    this.beamMat.uniforms.uColor.value.copy(glow).multiplyScalar(1.6);
    this.ringMat.uniforms.uColor.value.copy(glow).multiplyScalar(2);
    this.beamMat.uniforms.uFade.value = 0;
    this.ringMat.uniforms.uFade.value = 0;
    this.squash = 0;
    this.squashVelocity = 0;
    this.setPhase('drop');
  }

  /** Toque: chacoalha e estoura a tampa (resultado já sorteado; os prêmios saem com `showReward`). */
  open(result: ChestResult, rewards: readonly ChestReward[]): void {
    if (this.phase !== 'idle' && this.phase !== 'drop') return;
    this.pendingResult = result;
    this.rewards = rewards;
    this.setPhase('charge');
  }

  /**
   * Tira o prêmio `index` do baú (o anterior sai de cena). Devolve em quantos
   * segundos ele fica à mostra (depois do suspense, nos raros), pra legenda
   * entrar junto.
   */
  showReward(index: number): number {
    const reward = this.rewards[index];
    if (!reward) return 0;
    this.retireCurrent();
    let object: THREE.Object3D;
    let suspense = 0;
    let rays = COIN_RAYS;
    let model: AccessoryModel | null = null;
    if (reward.kind === 'coins') {
      object = this.coinPresenter;
      this.coinChimes = [0.05, 0.17, 0.3];
    } else if (reward.kind === 'dew') {
      object = this.dewPresenter;
      rays = DEW_RAYS;
      this.emit('dew', PRESENT.y, PRESENT.z);
    } else {
      const rarity = lookRarity(lookFromKey(reward.look));
      model = this.mountItem(reward.look);
      object = this.itemSpinner;
      suspense = SUSPENSE[rarity];
      rays = RAY_COLORS[rarity];
      if (suspense > 0) this.emit('suspense', PRESENT.y, PRESENT.z);
    }
    object.visible = true;
    object.position.set(0, H, 0);
    object.scale.setScalar(0.001);
    this.current = { object, kind: reward.kind, t: 0, leaving: false, suspense, revealed: suspense === 0, rays, model };
    if (reward.kind === 'look' && suspense === 0) this.emit('reveal', PRESENT.y, PRESENT.z);
    return suspense + ENTER_TIME * 0.6;
  }

  /**
   * Fim da fila (ou pulou): o visual fica boiando em cima do baú aberto; sem
   * visual, a moedona. Quem pulou quer ver na hora: o suspense acaba ali.
   */
  showSummary(): void {
    const look = this.rewards.find((r): r is Extract<ChestReward, { kind: 'look' }> => r.kind === 'look');
    const wanted: ChestReward['kind'] = look ? 'look' : 'coins';
    const c = this.current;
    if (c && c.kind === wanted && !c.leaving) {
      if (!c.revealed) c.suspense = Math.min(c.suspense, c.t);
      return;
    }
    this.retireCurrent();
    let object: THREE.Object3D = this.coinPresenter;
    let rays = COIN_RAYS;
    let model: AccessoryModel | null = null;
    if (look) {
      // O visual pode estar saindo ainda (voltou pro resumo): tira da saída antes de montar de novo.
      if (this.outgoing?.object === this.itemSpinner) this.finishOutgoing();
      model = this.mountItem(look.look);
      object = this.itemSpinner;
      rays = RAY_COLORS[lookRarity(lookFromKey(look.look))];
    } else if (this.outgoing?.object === this.coinPresenter) this.finishOutgoing();
    object.visible = true;
    object.position.set(0, H, 0);
    object.scale.setScalar(0.001);
    this.current = { object, kind: wanted, t: 0, leaving: false, suspense: 0, revealed: true, rays, model };
  }

  /** Some (fim da cerimônia ou próximo baú). */
  dismiss(): void {
    if (this.phase === 'hidden') return;
    this.setPhase('leave');
  }

  /** Esconde na hora (saiu do menu no meio). */
  hide(): void {
    this.clearRewards();
    this.group.visible = false;
    this.phase = 'hidden';
  }

  /** `camera` = posição da câmera no mundo (o brilho e os raios ficam atrás do prêmio, vistos de lá). */
  update(dt: number, camera: THREE.Vector3): void {
    if (this.phase === 'hidden' || !this.model) return;
    this.cameraAt.copy(camera);
    this.time += dt;
    this.phaseTime += dt;
    const model = this.model;
    const root = model.root;
    // Mola do amasso (pouso, estouro).
    this.squashVelocity += (-this.squash * 160 - this.squashVelocity * 11) * dt;
    this.squash += this.squashVelocity * dt;
    root.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);

    switch (this.phase) {
      case 'drop': {
        const t = clamp(this.phaseTime / DROP_TIME, 0, 1);
        root.position.y = DROP_HEIGHT * (1 - t * t);
        root.rotation.y = (1 - t) * 0.9;
        if (t >= 1) {
          this.squashVelocity = -4.2;
          this.emit('land', 0.1);
          this.setPhase('idle');
        }
        break;
      }
      case 'idle': {
        // De tempos em tempos o baú dá um pulinho e chacoalha: tem coisa aí dentro.
        this.rattleTimer -= dt;
        if (this.rattleTimer <= 0) {
          this.rattleTimer = 1.5;
          this.squashVelocity = -1.6;
          this.emit('rattle', 0.2);
        }
        const hop = Math.max(0, Math.sin(Math.min(1, (1.5 - this.rattleTimer) / 0.35) * Math.PI)) * 0.05;
        root.position.y = hop;
        root.rotation.z = Math.sin(this.time * 38) * hop * 0.8;
        model.lid.rotation.x = -hop * 0.9;
        this.ringMat.uniforms.uFade.value = damp(this.ringMat.uniforms.uFade.value, 0.6, 3, dt);
        break;
      }
      case 'charge': {
        const k = clamp(this.phaseTime / CHARGE_TIME, 0, 1);
        root.rotation.z = Math.sin(this.time * 60) * 0.06 * k;
        root.rotation.x = Math.sin(this.time * 47) * 0.03 * k;
        model.lid.rotation.x = -Math.abs(Math.sin(this.time * 30)) * 0.12 * k;
        this.ringMat.uniforms.uFade.value = 0.6 + k * 0.6;
        if (k >= 1) this.burst();
        break;
      }
      case 'open': {
        const t = this.phaseTime;
        // Tampa: abre de uma vez com um repique, depois assenta aberta.
        model.lid.rotation.x = -2.05 + Math.exp(-t * 7) * Math.cos(t * 18) * 0.5;
        // O facho some antes do primeiro prêmio assentar (senão lava o que está saindo).
        this.beamMat.uniforms.uFade.value = Math.max(0, 1 - Math.max(0, t - 0.25) / 0.9) * Math.min(1, t * 6);
        this.ringMat.uniforms.uFade.value = damp(this.ringMat.uniforms.uFade.value, 0.45, 1.5, dt);
        break;
      }
      case 'leave': {
        const k = clamp(this.phaseTime / 0.32, 0, 1);
        this.group.scale.setScalar(Math.max(0.001, 1 - k * k));
        if (k >= 1) this.hide();
        break;
      }
    }
    this.beamMat.uniforms.uTime.value = this.time;
    this.ringMat.uniforms.uTime.value = this.time;
    // Facho apagado não desenha (é só no estouro).
    this.beam.visible = this.beamMat.uniforms.uFade.value > 0.002;
    const pulse = 0.85 + 0.25 * Math.sin(this.time * 3.2);
    if (model.gem) model.gem.scale.set(pulse, pulse, pulse * 0.55);
    for (const glow of model.glows) glow.scale.set(pulse, pulse, pulse * 0.45);
    this.updateCoins(dt);
    this.updatePresented(dt);
  }

  // ---------------------------------------------------------------------------

  private burst(): void {
    const result = this.pendingResult;
    this.setPhase('open');
    this.squashVelocity = 5;
    this.emit('burst', H + 0.1);
    if (!result) return;
    const coinCount = Math.min(MAX_COINS, 4 + Math.round(result.coins / 45));
    this.coins.forEach((coin, i) => {
      coin.mesh.visible = i < coinCount;
      if (i >= coinCount) return;
      const a = (i / coinCount) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 0.7 + Math.random() * 0.8;
      coin.mesh.position.set(Math.cos(a) * 0.08, H + 0.05, Math.sin(a) * 0.06);
      coin.velocity.set(Math.cos(a) * speed, 2.2 + Math.random() * 1.4, Math.sin(a) * speed * 0.8 + 0.25);
      coin.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 18);
      coin.resting = false;
      coin.bounced = false;
    });
  }

  /** Monta o visual do prêmio no giro (do mesmo tamanho que todo prêmio, centrado). */
  private mountItem(key: LookKeyOf): AccessoryModel | null {
    this.unmountItem();
    const look = lookFromKey(key);
    let object: THREE.Object3D;
    if (look.kind === 'acc') {
      this.itemModel = buildAccessory(look.id);
      object = this.itemModel.object;
    } else {
      this.itemModel = null;
      this.mannequin ??= new BeetleModel(skin(look.id));
      this.mannequin.setSkin(skin(look.id));
      this.mannequin.setOutfit({ head: null, face: null, neck: null, back: null });
      object = this.mannequin.root;
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(1);
    }
    // Todo prêmio do mesmo tamanho na vitrine (uma capa é bem maior que um óculos)
    // e centrado no giro (cada acessório tem a origem no ponto de encaixe).
    // Vitrine inclinada pra câmera (giro de toca-discos torto): asa deitada, óculos e
    // colar não aparecem de quina.
    this.itemSpinner.rotation.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(this.tmp);
    object.scale.multiplyScalar(ITEM_SIZE / Math.max(size.x, size.y, size.z, 0.01));
    object.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(object).getCenter(this.tmp);
    object.position.sub(center);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh.material instanceof THREE.MeshBasicMaterial)) mesh.castShadow = true;
    });
    // tilt (inclina) → turn (gira no próprio eixo) → o visual centrado.
    const turn = new THREE.Group();
    turn.add(object);
    const tilt = new THREE.Group();
    tilt.rotation.x = 0.42;
    tilt.add(turn);
    this.itemSpinner.add(tilt);
    this.item = tilt;
    void this.compile?.(object).catch(() => undefined);
    return this.itemModel;
  }

  private unmountItem(): void {
    if (!this.item) return;
    this.itemSpinner.remove(this.item);
    // O manequim é reaproveitado: sai antes de a geometria do resto ser descartada.
    this.mannequin?.root.removeFromParent();
    // Geometria é só dele (os materiais da massinha são compartilhados e ficam).
    this.item.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.item = null;
    this.itemModel = null;
  }

  /** O prêmio em cena sobe e some (dá vez ao próximo). */
  private retireCurrent(): void {
    if (!this.current) return;
    if (this.outgoing) this.finishOutgoing();
    this.current.leaving = true;
    this.current.t = 0;
    this.outgoing = this.current;
    this.current = null;
  }

  private finishOutgoing(): void {
    const out = this.outgoing;
    if (!out) return;
    out.object.visible = false;
    if (out.object === this.itemSpinner) this.unmountItem();
    this.outgoing = null;
  }

  private updatePresented(dt: number): void {
    const out = this.outgoing;
    if (out) {
      out.t += dt;
      const k = clamp(out.t / EXIT_TIME, 0, 1);
      const e = k * k;
      out.object.position.set(PRESENT.x, PRESENT.y + e * 0.35, PRESENT.z);
      out.object.scale.setScalar(Math.max(0.001, 1 - e));
      out.object.rotation.y += dt * 8;
      if (k >= 1) this.finishOutgoing();
    }
    // Tilintar da moedona.
    for (let i = this.coinChimes.length - 1; i >= 0; i--) {
      this.coinChimes[i] -= dt;
      if (this.coinChimes[i] <= 0) {
        this.coinChimes.splice(i, 1);
        this.emit('coin', PRESENT.y, PRESENT.z);
      }
    }
    const c = this.current;
    const leaving = this.phase === 'leave';
    let raysTarget = 0;
    if (c) {
      c.t += dt;
      const inSuspense = c.t < c.suspense;
      if (!c.revealed && !inSuspense) {
        c.revealed = true;
        this.squashVelocity = 2.5;
        this.emit('flash', PRESENT.y, PRESENT.z);
        this.emit('reveal', PRESENT.y, PRESENT.z);
      }
      this.rayColor.set(c.rays);
      if (inSuspense) {
        // Bola de luz subindo da boca do baú, pulsando cada vez mais rápido e crescendo.
        const k = c.t / c.suspense;
        c.object.scale.setScalar(0.001);
        c.object.position.set(PRESENT.x, H + (PRESENT.y - H) * Math.min(1, k * 1.6), PRESENT.z);
        const beat = 0.5 + 0.5 * Math.sin(c.t * (8 + k * 22));
        this.halo.position.copy(c.object.position);
        this.haloMat.opacity = 0.65 + beat * 0.35;
        this.halo.scale.setScalar(0.2 + k * 0.45 + beat * 0.12 * (0.5 + k));
        this.haloMat.color.copy(this.rayColor).multiplyScalar(1.8);
        raysTarget = k * 0.55;
        c.object.getWorldPosition(this.tmp);
        this.tmp2.copy(this.tmp).sub(this.cameraAt).normalize();
        this.rays.position.copy(this.group.worldToLocal(this.tmp.addScaledVector(this.tmp2, 0.55)));
      } else {
        // Sobe da boca do baú até o lugar com um passinho a mais (volta de mola) e fica boiando, girando.
        const k = clamp((c.t - c.suspense) / ENTER_TIME, 0, 1);
        const back = 1.70158;
        const e = 1 + (back + 1) * (k - 1) ** 3 + back * (k - 1) ** 2;
        const flashPop = c.suspense > 0 ? Math.max(0, 1 - (c.t - c.suspense) / 0.25) : 0;
        const bob = Math.sin(this.time * 1.7) * 0.025 * k;
        c.object.position.set(PRESENT.x, H + (PRESENT.y - H) * Math.min(1, e) + bob, PRESENT.z);
        c.object.scale.setScalar(Math.max(0.001, e * (1 + flashPop * 0.25)));
        if (c.object === this.itemSpinner && this.item) this.item.children[0].rotation.y += dt * 1.3;
        else c.object.rotation.y += dt * (c.kind === 'coins' ? 2.2 : 1.3);
        if (c.kind === 'dew') this.dewOrbit.rotation.y += dt * 1.6;
        raysTarget = leaving ? 0 : 0.85;
        // Brilho e raios atrás do prêmio (do lado oposto da câmera): aditivo na frente lavaria.
        c.object.getWorldPosition(this.tmp);
        this.tmp2.copy(this.tmp).sub(this.cameraAt).normalize();
        this.halo.position.copy(this.group.worldToLocal(this.tmp2.clone().multiplyScalar(0.4).add(this.tmp)));
        this.rays.position.copy(this.group.worldToLocal(this.tmp.addScaledVector(this.tmp2, 0.55)));
        this.haloMat.opacity = damp(this.haloMat.opacity, leaving ? 0 : 0.6 + flashPop * 0.4, 6, dt);
        this.halo.scale.setScalar(ITEM_SIZE * (1.5 + flashPop * 2.2));
        this.haloMat.color.copy(this.rayColor).multiplyScalar(1.4);
      }
      this.raysMat.color.copy(this.rayColor).multiplyScalar(1.3);
      if (c.model?.update) {
        this.pose.time = this.time;
        this.pose.dt = dt;
        c.model.update(this.pose);
      }
      // Manequim de casco: respira e pisca parado.
      if (this.mannequin?.root.parent) this.mannequin.update(dt, this.mannequinPose);
    } else {
      this.haloMat.opacity = damp(this.haloMat.opacity, 0, 6, dt);
    }
    this.raysMat.opacity = damp(this.raysMat.opacity, raysTarget, 4, dt);
    this.raysMat.rotation += dt * 0.35;
    this.rays.scale.setScalar(1.25 + 0.06 * Math.sin(this.time * 1.9));
  }

  private updateCoins(dt: number): void {
    for (const coin of this.coins) {
      if (!coin.mesh.visible || coin.resting) continue;
      const p = coin.mesh.position;
      coin.velocity.y -= GRAVITY * dt;
      p.addScaledVector(coin.velocity, dt);
      coin.mesh.rotation.x += coin.spin.x * dt;
      coin.mesh.rotation.y += coin.spin.y * dt;
      coin.mesh.rotation.z += coin.spin.z * dt;
      // Não atravessa o baú: quem cai em cima dele escorrega pra fora.
      const insideX = Math.abs(p.x) < W / 2 + 0.03;
      const insideZ = Math.abs(p.z) < D / 2 + 0.03;
      if (insideX && insideZ && p.y < H + 0.01 && coin.velocity.y < 0) {
        p.x += Math.sign(p.x || 1) * 0.02;
        p.z += Math.sign(p.z || 1) * 0.02;
      }
      if (p.y <= 0.008 && coin.velocity.y < 0) {
        p.y = 0.008;
        if (!coin.bounced) {
          coin.bounced = true;
          coin.velocity.y *= -0.32;
          coin.velocity.x *= 0.5;
          coin.velocity.z *= 0.5;
          coin.spin.multiplyScalar(0.4);
          this.emit('coin', 0, 0, p);
        } else {
          coin.resting = true;
          // Deita a moeda no chão.
          coin.mesh.rotation.set(0, coin.mesh.rotation.y, 0);
        }
      }
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'idle') this.rattleTimer = 0.9;
  }

  private emit(event: ChestStageEvent, height: number, forward = 0, local?: THREE.Vector3): void {
    const at = new THREE.Vector3();
    if (local) at.copy(local);
    else at.set(0, height, forward);
    this.group.localToWorld(at);
    this.onEvent?.(event, at, this.rarity);
  }

  private clearRewards(): void {
    for (const coin of this.coins) coin.mesh.visible = false;
    this.pendingResult = null;
    this.rewards = [];
    this.coinChimes = [];
    this.outgoing = null;
    this.current = null;
    for (const presenter of [this.coinPresenter, this.dewPresenter, this.itemSpinner]) presenter.visible = false;
    this.unmountItem();
    this.haloMat.opacity = 0;
    this.raysMat.opacity = 0;
    this.beamMat.uniforms.uFade.value = 0;
  }

  private modelFor(rarity: Rarity): ChestModel {
    let model = this.models.get(rarity);
    if (!model) {
      model = buildChestModel(rarity);
      this.models.set(rarity, model);
    }
    return model;
  }
}
