import * as THREE from 'three';
import type { AccessoryId } from '../progression/accessories';
import { buildAccessory } from '../entities/outfit/registry';
import type { AccessoryModel, OutfitPose } from '../entities/outfit/types';
import { terrainHeight } from './Terrain';
import { glowTexture, pulseRingMaterial } from '../fx/glow';

/**
 * O achado raro no jardim: o acessório girando devagar, baixinho, no meio do
 * capim. Achar tem que dar trabalho: de longe não há sinal nenhum além do
 * próprio item; chegando perto aparecem um brilho macio em volta dele e um anel
 * no chão (que dizem "isso aqui se pega"), e o jogo solta um brilhinho e um
 * "plim" de vez em quando (ver `Game.updateRareFind`). O besouro ou a bola
 * passando por cima pegam.
 *
 * Brilho e anel são aditivos e não escrevem profundidade: sem contorno, sem
 * oclusão e sem sombra (é luz, não objeto).
 */

/** Quanto o acessório cresce no chão (no besouro ele tem o tamanho da cabeça). */
const DISPLAY_SIZE = 0.8;
/** Altura em que ele flutua: entre as pontas do capim (meio escondido). */
const HOVER = 0.5;
/** Pega quem chegar a essa distância (besouro) ou encostar a bola nele. */
const PICK_RADIUS = 1.1;
/** O brilho e o anel aparecem de perto: inteiros até `GLOW_NEAR`, somem em `GLOW_FAR`. */
const GLOW_NEAR = 6;
const GLOW_FAR = 14;

const GOLD = new THREE.Color('#ffc94a');

interface Placed {
  id: AccessoryId;
  model: AccessoryModel;
  /** Gira e flutua (o modelo fica centrado dentro dele). */
  spinner: THREE.Group;
  position: THREE.Vector3;
}

export class RareFind {
  readonly group = new THREE.Group();
  /** Compila os shaders antes de aparecer (o jogo liga no renderizador). */
  compile: ((object: THREE.Object3D) => Promise<void>) | null = null;

  private placed: Placed | null = null;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat = pulseRingMaterial(GOLD.clone().multiplyScalar(2.4));
  private readonly pose: OutfitPose = { time: 0, dt: 0, speed: 0, pushBlend: 0, airborne: 0, verticalSpeed: 0, headPitch: 0 };
  private time = 0;
  /** Quanto o brilho está aparecendo agora (0 longe, 1 perto). */
  private fade = 0;

  constructor() {
    this.group.name = 'rare-find';
    this.haloMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: GOLD.clone().multiplyScalar(2.2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(1.9);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), this.ringMat);
    for (const light of [this.halo, this.ring]) {
      light.renderOrder = 11;
      light.userData.skipAO = true;
    }
    this.group.visible = false;
  }

  /** Tem achado no jardim agora? */
  get active(): boolean {
    return this.placed !== null;
  }

  get id(): AccessoryId | null {
    return this.placed?.id ?? null;
  }

  /** Onde ele está (pra brilhos e som), ou null. */
  get position(): THREE.Vector3 | null {
    return this.placed?.position ?? null;
  }

  /** Põe o acessório `id` em (x, z). Troca o que houver. */
  place(id: AccessoryId, x: number, z: number): void {
    this.clear();
    const model = buildAccessory(id);
    const holder = model.object;
    // Centraliza pelo tamanho real da peça (cada uma foi desenhada em volta do encaixe dela).
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = DISPLAY_SIZE / Math.max(size.x, size.y, size.z, 0.05);
    const center = box.getCenter(new THREE.Vector3());
    const spinner = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    inner.position.copy(center).multiplyScalar(-scale);
    inner.add(holder);
    spinner.add(inner);
    const y = terrainHeight(x, z);
    const position = new THREE.Vector3(x, y + HOVER, z);
    spinner.position.copy(position);
    this.halo.position.copy(position);
    this.ring.position.set(x, y + 0.03, z);
    const placed: Placed = { id, model, spinner, position };
    this.placed = placed;
    this.fade = 0;
    const show = () => {
      if (this.placed !== placed) return;
      this.group.add(spinner, this.halo, this.ring);
      this.group.visible = true;
    };
    if (this.compile) this.compile(spinner).catch(() => undefined).then(show);
    else show();
  }

  /** Tira o achado (pego, ou o jardim trocou). */
  clear(): void {
    const placed = this.placed;
    if (!placed) return;
    this.placed = null;
    this.group.remove(placed.spinner, this.halo, this.ring);
    this.group.visible = false;
    placed.spinner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  /** Anima (gira, flutua) e acende o brilho conforme o besouro chega perto. */
  update(dt: number, player: THREE.Vector3): void {
    const placed = this.placed;
    if (!placed) return;
    this.time += dt;
    const s = placed.spinner;
    s.rotation.y += dt * 0.8;
    s.position.y = placed.position.y + Math.sin(this.time * 1.6) * 0.05;
    const pose = this.pose;
    pose.time = this.time;
    pose.dt = dt;
    placed.model.update?.(pose);
    const distance = player.distanceTo(placed.position);
    const target = 1 - THREE.MathUtils.smoothstep(distance, GLOW_NEAR, GLOW_FAR);
    this.fade += (target - this.fade) * Math.min(1, dt * 3);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 2.2);
    this.haloMat.opacity = this.fade * pulse;
    this.halo.position.y = s.position.y;
    this.ringMat.uniforms.uTime.value = this.time;
    this.ringMat.uniforms.uFade.value = this.fade;
  }

  /** O besouro (pés) ou a bola passaram por cima? Devolve o acessório pego (e tira do chão). */
  collect(beetle: THREE.Vector3, ball: THREE.Vector3, ballRadius: number): AccessoryId | null {
    const placed = this.placed;
    if (!placed || !this.group.visible) return null;
    const p = placed.position;
    const nearBeetle = Math.hypot(beetle.x - p.x, beetle.z - p.z) < PICK_RADIUS && Math.abs(beetle.y - p.y) < 2;
    const nearBall = Math.hypot(ball.x - p.x, ball.z - p.z) < ballRadius + 0.5 && ball.y - ballRadius < p.y + 0.6;
    if (!nearBeetle && !nearBall) return null;
    const id = placed.id;
    this.clear();
    return id;
  }
}
