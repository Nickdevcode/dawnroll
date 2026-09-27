import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildAccessory } from '../entities/outfit/registry';
import type { AccessoryModel, OutfitPose } from '../entities/outfit/types';
import { lathe, starShape, extrude } from '../entities/outfit/parts';
import type { ChestResult } from '../progression/economy';
import { lookFromKey } from '../progression/looks';
import { skin, type SkinId } from '../progression/skins';
import type { Rarity } from '../progression/unlocks';
import { clay } from '../render/clayMaterial';
import { claySphere, paintVertices } from '../render/geometry';
import { clamp, damp } from '../utils/math';
import { glowTexture, markAsLight, pulseRingMaterial } from './glow';

/**
 * O baú abrindo no jardim, em 3D: ele cai do céu do lado do besouro, quica,
 * fica chacoalhando esperando o toque; ao abrir a tampa estoura, sobe um facho
 * de luz da cor do baú, as moedas espirram e caem rolando em volta, as gotas de
 * orvalho sobem e ficam boiando e, quando vem visual, ele sai girando de dentro
 * com um brilho atrás.
 *
 * Mora na cena do jogo (pega a luz, o contorno e o bloom de tudo), num grupo
 * que fica escondido fora da cerimônia. Quem manda é o `Game`: `present` (cai),
 * `open` (abre com o resultado já sorteado) e `dismiss` (some).
 */

export type ChestStageEvent = 'land' | 'rattle' | 'burst' | 'coin' | 'dew' | 'reveal';

type Phase = 'hidden' | 'drop' | 'idle' | 'charge' | 'open' | 'rest' | 'leave';

interface ChestStyle {
  body: string;
  lid: string;
  band: string;
  trim: string;
  glow: string;
  gem?: string;
}

const STYLES: Record<Rarity, ChestStyle> = {
  common: { body: '#9c5f31', lid: '#b0703a', band: '#6a3f22', trim: '#d9a441', glow: '#ffd27a' },
  rare: { body: '#7f93ad', lid: '#a4b6cc', band: '#56657c', trim: '#f1f5fa', glow: '#bfe3ff' },
  epic: { body: '#6a3fc4', lid: '#8a5fe0', band: '#3e2585', trim: '#e8dbff', glow: '#c89bff', gem: '#6ff0ff' },
  legendary: { body: '#e8962a', lid: '#ffc44a', band: '#b8621a', trim: '#fff4c2', glow: '#ffd45a', gem: '#ff7a3d' },
};

/** Medidas do baú (o besouro tem ~0,8 de comprimento). */
const W = 0.56;
const D = 0.38;
const H = 0.26;
/** Altura de onde ele cai. */
const DROP_HEIGHT = 1.8;
const DROP_TIME = 0.55;
const CHARGE_TIME = 0.42;
/** Tempo do estouro até os prêmios estarem "no lugar" (o painel mostra depois disso). */
export const CHEST_REVEAL_DELAY = 0.95;
const MAX_COINS = 16;
/** Tamanho (maior medida) do visual que sai do baú. */
const ITEM_SIZE = 0.6;
const MAX_DROPS = 8;
const GRAVITY = 7;

interface ChestModel {
  root: THREE.Group;
  lid: THREE.Group;
  gem: THREE.Mesh | null;
}

interface Coin {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  bounced: boolean;
}

interface Drop {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  phase: number;
  delay: number;
}

/** Tábuas de madeira pintadas nos vértices (linhas mais escuras entre elas). */
function planks(geometry: THREE.BufferGeometry, color: string, rarity: Rarity): THREE.BufferGeometry {
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.72);
  return paintVertices(geometry, (p, _n, c) => {
    if (rarity !== 'common') return c.copy(base).multiplyScalar(0.94 + 0.06 * Math.sin(p.x * 40 + p.y * 17));
    const seam = Math.abs(Math.sin((p.y + 0.02) * Math.PI * 14)) < 0.12 ? 1 : 0;
    return c.copy(base).lerp(dark, seam * 0.8).multiplyScalar(0.95 + 0.05 * Math.sin(p.x * 60));
  });
}

function buildChest(rarity: Rarity): ChestModel {
  const style = STYLES[rarity];
  const root = new THREE.Group();
  root.name = `chest-${rarity}`;
  const shiny = rarity !== 'common';
  const bodyMat = clay(0xffffff, { vertexColors: true, roughness: shiny ? 0.35 : 0.75, sheen: 0.5, bump: 0.25, mottle: 0.05, mottleScale: 18, clearcoat: shiny ? 0.6 : 0.1 });
  const bandMat = clay(style.band, { roughness: 0.3, sheen: 0.3, bump: 0.08, clearcoat: 0.8, mottle: 0.03, mottleScale: 20 });
  const trimMat = clay(style.trim, { roughness: 0.22, sheen: 0.25, bump: 0.04, clearcoat: 1, mottle: 0.02, mottleScale: 20 });

  const body = new THREE.Mesh(planks(new RoundedBoxGeometry(W, H, D, 3, 0.035).translate(0, H / 2, 0), style.body, rarity), bodyMat);
  root.add(body);
  for (const x of [-0.19, 0.19]) {
    root.add(new THREE.Mesh(new RoundedBoxGeometry(0.05, H + 0.012, D + 0.018, 2, 0.012).translate(x, H / 2, 0), bandMat));
  }
  // Borda de cima (onde a tampa fecha).
  root.add(new THREE.Mesh(new RoundedBoxGeometry(W + 0.016, 0.03, D + 0.016, 2, 0.01).translate(0, H - 0.012, 0), trimMat));

  // Tampa: meio cilindro deitado, com a dobradiça na borda de trás.
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  const R = D / 2;
  const dome = new THREE.CylinderGeometry(R, R, W, 28, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, R);
  lid.add(new THREE.Mesh(planks(dome, style.lid, rarity), bodyMat));
  for (const x of [-0.19, 0.19]) {
    lid.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.05, 28, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(x, 0, R), bandMat));
  }
  // Fundo da tampa (o lado de dentro aparece com ela aberta; sem ele a cúpula oca some de costas).
  const inner = clay(new THREE.Color(style.band).multiplyScalar(0.8), { roughness: 0.8, sheen: 0.3, bump: 0.2, mottle: 0.05, mottleScale: 18 });
  lid.add(new THREE.Mesh(new RoundedBoxGeometry(W - 0.01, 0.024, D - 0.01, 2, 0.008).translate(0, 0.012, R), inner));
  // Fecho na frente da tampa.
  lid.add(new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.1, 0.026, 2, 0.01).translate(0, -0.02, D + 0.006), trimMat));
  lid.add(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 8).rotateX(Math.PI / 2).translate(0, -0.03, D + 0.02), clay('#2a2230', { roughness: 0.5 })));
  let gem: THREE.Mesh | null = null;
  if (style.gem) {
    gem = new THREE.Mesh(claySphere(0.028, 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.gem).multiplyScalar(2.2) }));
    gem.position.set(0, R * 0.78, R + R * 0.62);
    lid.add(gem);
  }
  if (rarity === 'legendary') {
    // O solzinho do jogo gravado na tampa.
    const sun = new THREE.Mesh(extrude(starShape(10, 0.07, 0.045), 0.012, 0.004), trimMat);
    sun.position.set(0, R * 0.95, R);
    sun.rotation.x = -Math.PI / 2;
    lid.add(sun);
  }
  root.add(lid);
  // Boca do baú: luz da cor dele lá dentro (só aparece com a tampa aberta).
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.07, D - 0.07).rotateX(-Math.PI / 2).translate(0, H + 0.004, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.glow).multiplyScalar(1.8) }));
  root.add(mouth);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const glowing = mesh.material instanceof THREE.MeshBasicMaterial;
    mesh.castShadow = !glowing;
    mesh.receiveShadow = !glowing;
  });
  return { root, lid, gem };
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
        float up = pow(1.0 - vUv.y, 1.6);
        float rays = 0.65 + 0.35 * sin(vUv.x * 62.83 + uTime * 3.0);
        gl_FragColor = vec4(uColor, up * rays * uFade * 0.55);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Casquinho do besouro de enfeite (prêmio de casco): élitros, pronoto e cabeça nas cores do casco. */
function shellToken(id: SkinId): THREE.Group {
  const def = skin(id);
  const group = new THREE.Group();
  const opts = { roughness: def.roughness, sheen: 0.4, bump: 0.1, clearcoat: 0.8, mottle: 0.03, mottleScale: 20, iridescence: def.iridescence };
  const elytra = clay(def.elytra, opts);
  for (const side of [1, -1]) {
    const half = new THREE.Mesh(claySphere(0.16, 4, 0.02, 2, side), elytra);
    half.scale.set(0.62, 0.62, 1.1);
    half.position.set(side * 0.085, 0, -0.05);
    group.add(half);
  }
  const pronotum = new THREE.Mesh(claySphere(0.13, 4, 0.02), clay(def.pronotum, opts));
  pronotum.scale.set(1.05, 0.62, 0.72);
  pronotum.position.set(0, 0.01, 0.15);
  group.add(pronotum);
  const head = new THREE.Mesh(claySphere(0.09, 3, 0.02), clay(def.head ?? def.pronotum, opts));
  head.scale.set(1.2, 0.5, 0.8);
  head.position.set(0, -0.01, 0.27);
  group.add(head);
  const accent = def.accents?.[0];
  if (accent && def.glow) {
    const spark = new THREE.Mesh(extrude(starShape(4, 0.05, 0.012), 0.004, 0.001), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.4) }));
    spark.position.set(0.1, 0.12, 0);
    group.add(spark);
  }
  return group;
}

export class ChestStage {
  readonly group = new THREE.Group();
  /** Compila os shaders antes de aparecer (o jogo liga no renderizador). */
  compile: ((object: THREE.Object3D) => Promise<void>) | null = null;
  /** Momentos do show (o jogo toca o som e solta as partículas). A posição é no mundo. */
  onEvent: ((event: ChestStageEvent, at: THREE.Vector3, rarity: Rarity) => void) | null = null;
  /** Onde a câmera mira (no mundo): o baú e, depois de aberto, o prêmio. */
  readonly focus = new THREE.Vector3();

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
  private readonly drops: Drop[] = [];
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
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly itemSpinner = new THREE.Group();
  private item: THREE.Object3D | null = null;
  private itemModel: AccessoryModel | null = null;
  private itemRise = 0;
  private readonly pose: OutfitPose = { time: 0, dt: 0, speed: 0, pushBlend: 0, airborne: 0, verticalSpeed: 0, headPitch: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly cameraAt = new THREE.Vector3();

  constructor() {
    this.group.name = 'chest-stage';
    this.group.visible = false;
    this.group.add(this.holder);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.14, 1.7, 32, 1, true).translate(0, 0.85 + H * 0.6, 0), this.beamMat);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2).translate(0, 0.015, 0), this.ringMat);
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halo = new THREE.Sprite(this.haloMat);
    for (const light of [this.beam, this.ring, this.halo]) {
      markAsLight(light);
      this.group.add(light);
    }
    this.group.add(this.itemSpinner);
    for (let i = 0; i < MAX_COINS; i++) {
      const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.coins.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), resting: false, bounced: false });
    }
    for (let i = 0; i < MAX_DROPS; i++) {
      const mesh = new THREE.Mesh(this.dropGeo, this.dropMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.drops.push({ mesh, target: new THREE.Vector3(), phase: i * 1.7, delay: 0 });
    }
  }

  /** Tem um visual saindo do baú agora (a câmera sobe pra mostrar). */
  get showingItem(): boolean {
    return this.item !== null && this.phase !== 'leave';
  }

  /** Está no meio de uma cerimônia (de cair até sumir)? */
  get active(): boolean {
    return this.phase !== 'hidden';
  }

  /** Esperando o toque pra abrir (já caiu e parou). */
  get waiting(): boolean {
    return this.phase === 'idle';
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
    for (const coin of this.coins) coin.mesh.visible = true;
    for (const drop of this.drops) drop.mesh.visible = true;
    try {
      await this.compile?.(this.group);
    } catch {
      // Sem compilar antes: só engasga um pouquinho na primeira vez.
    }
    this.warming = false;
    // Começou uma cerimônia enquanto compilava: ela já arrumou tudo.
    if (this.phase !== 'hidden') return;
    for (const coin of this.coins) coin.mesh.visible = false;
    for (const drop of this.drops) drop.mesh.visible = false;
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
    const glow = new THREE.Color(STYLES[rarity].glow);
    this.beamMat.uniforms.uColor.value.copy(glow).multiplyScalar(1.6);
    this.ringMat.uniforms.uColor.value.copy(glow).multiplyScalar(2);
    this.haloMat.color.copy(glow).multiplyScalar(1.5);
    this.beamMat.uniforms.uFade.value = 0;
    this.ringMat.uniforms.uFade.value = 0;
    this.haloMat.opacity = 0;
    this.squash = 0;
    this.squashVelocity = 0;
    this.setPhase('drop');
    this.updateFocus();
  }

  /** Toque: chacoalha, estoura a tampa e solta o que saiu (resultado já sorteado). */
  open(result: ChestResult): void {
    if (this.phase !== 'idle' && this.phase !== 'drop') return;
    this.pendingResult = result;
    this.setPhase('charge');
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

  /** `camera` = posição da câmera no mundo (o brilho do prêmio fica atrás dele, visto de lá). */
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
      case 'open':
      case 'rest': {
        const t = this.phaseTime;
        // Tampa: abre de uma vez com um repique, depois assenta aberta.
        const open = -2.05 + Math.exp(-t * 7) * Math.cos(t * 18) * 0.5;
        model.lid.rotation.x = open;
        // O facho some antes do prêmio assentar (senão lava o visual que está saindo).
        this.beamMat.uniforms.uFade.value = Math.max(0, 1 - Math.max(0, t - 0.25) / 0.9) * Math.min(1, t * 6);
        this.ringMat.uniforms.uFade.value = damp(this.ringMat.uniforms.uFade.value, 0.45, 1.5, dt);
        if (this.phase === 'open' && t > CHEST_REVEAL_DELAY) this.setPhase('rest');
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
    if (model.gem) model.gem.scale.setScalar(0.85 + 0.25 * Math.sin(this.time * 3.2));
    this.updateCoins(dt);
    this.updateDrops(dt);
    this.updateItem(dt);
    this.updateFocus();
  }

  // ---------------------------------------------------------------------------

  private pendingResult: ChestResult | null = null;
  private warming = false;

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
    const dropCount = result.dew > 0 ? Math.min(MAX_DROPS, 1 + Math.round(result.dew / 6)) : 0;
    this.drops.forEach((drop, i) => {
      drop.mesh.visible = i < dropCount;
      if (i >= dropCount) return;
      const a = (i / Math.max(1, dropCount)) * Math.PI * 2 + 0.4;
      drop.target.set(Math.cos(a) * (0.22 + (i % 2) * 0.1), 0.62 + (i % 3) * 0.12, Math.sin(a) * 0.18 + 0.05);
      drop.mesh.position.set(0, H, 0);
      drop.mesh.scale.setScalar(0.01);
      drop.delay = 0.15 + i * 0.07;
    });
    if (dropCount > 0) this.emit('dew', 0.7, 0.35);
    if (result.look) this.showItem(result.look);
  }

  private showItem(key: NonNullable<ChestResult['look']>): void {
    const look = lookFromKey(key);
    let object: THREE.Object3D;
    if (look.kind === 'acc') {
      this.itemModel = buildAccessory(look.id);
      object = this.itemModel.object;
    } else {
      this.itemModel = null;
      object = shellToken(look.id);
    }
    // Todo prêmio do mesmo tamanho na vitrine (uma capa é bem maior que um óculos)
    // e centrado no giro (cada acessório tem a origem no ponto de encaixe).
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    object.scale.multiplyScalar(ITEM_SIZE / Math.max(size.x, size.y, size.z, 0.01));
    object.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(object).getCenter(this.tmp);
    object.position.sub(center);
    this.itemSpinner.add(object);
    this.item = object;
    this.itemRise = 0;
    this.itemSpinner.position.set(0, H, 0);
    this.itemSpinner.scale.setScalar(0.01);
    this.haloMat.opacity = 0;
    void this.compile?.(object).catch(() => undefined);
    this.emit('reveal', 0.9, 0.55);
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

  private updateDrops(dt: number): void {
    for (const drop of this.drops) {
      if (!drop.mesh.visible) continue;
      if (this.phase === 'leave') continue;
      drop.delay -= dt;
      if (drop.delay > 0) continue;
      drop.phase += dt;
      const p = drop.mesh.position;
      p.lerp(this.tmp.copy(drop.target).setY(drop.target.y + Math.sin(this.time * 1.8 + drop.phase * 2) * 0.03), 1 - Math.exp(-dt * 3.5));
      const s = damp(drop.mesh.scale.x, 1, 6, dt);
      drop.mesh.scale.setScalar(s);
      drop.mesh.rotation.y += dt * 1.2;
    }
  }

  private updateItem(dt: number): void {
    if (!this.item) return;
    if (this.phase !== 'leave') {
      this.itemRise = Math.min(1, this.itemRise + dt / 0.9);
      const e = 1 - (1 - this.itemRise) ** 3;
      this.itemSpinner.position.y = H + e * 0.7 + Math.sin(this.time * 1.6) * 0.02 * e;
      this.itemSpinner.scale.setScalar(Math.max(0.01, e));
    }
    this.itemSpinner.rotation.y += dt * 1.4;
    // O brilho fica atrás do prêmio (do lado oposto da câmera): aditivo na frente lavaria o visual.
    this.itemSpinner.getWorldPosition(this.tmp);
    this.tmp.addScaledVector(this.tmp.clone().sub(this.cameraAt).normalize(), 0.45);
    this.halo.position.copy(this.group.worldToLocal(this.tmp));
    // Do tamanho do prêmio (grande demais, na tela em pé do celular o brilho cobria tudo).
    this.halo.scale.setScalar(ITEM_SIZE * 1.6 + 0.08 * Math.sin(this.time * 2.4));
    this.haloMat.opacity = damp(this.haloMat.opacity, this.phase === 'leave' ? 0 : 0.75, 3, dt);
    if (this.itemModel?.update) {
      this.pose.time = this.time;
      this.pose.dt = dt;
      this.itemModel.update(this.pose);
    }
  }

  private updateFocus(): void {
    // Antes de abrir, o baú; depois, o meio entre o baú e o prêmio.
    const y = this.item ? H + 0.45 : H * 0.8;
    this.focus.set(0, y, 0);
    this.group.localToWorld(this.focus);
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
    for (const drop of this.drops) drop.mesh.visible = false;
    this.pendingResult = null;
    if (this.item) {
      this.itemSpinner.remove(this.item);
      // Geometria é só dele (os materiais da massinha são compartilhados e ficam).
      this.item.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.item = null;
      this.itemModel = null;
    }
    this.haloMat.opacity = 0;
    this.beamMat.uniforms.uFade.value = 0;
  }

  private modelFor(rarity: Rarity): ChestModel {
    let model = this.models.get(rarity);
    if (!model) {
      model = buildChest(rarity);
      this.models.set(rarity, model);
    }
    return model;
  }
}
