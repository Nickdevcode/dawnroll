import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { lumpify, paintVertices } from '../render/geometry';
import { smoothstep } from '../utils/math';
import { terrainHeight } from './Terrain';

/**
 * Pódio da Disputa: três rodelas de tronco na clareira do nascimento (o
 * jardim sempre deixa ela livre), a mais alta no meio, com a fita de ouro,
 * prata e bronze e o número pintado na casca. Tem colisor: cada jogador põe o
 * próprio besouro em cima do degrau do time dele, e os outros o veem lá pelos
 * retratos de sempre. Quem ficou do 4º lugar pra baixo assiste de pé, na frente.
 *
 * Só existe durante o pódio (`show` / `hide`); a frente dele é +z (a câmera
 * de vitrine olha dali, ver o quadro `podium` da `ShowcaseCamera`).
 */

interface Step {
  x: number;
  height: number;
  ribbon: string;
}

/** 1º no meio, 2º à esquerda (de quem olha), 3º à direita. */
const STEPS: readonly Step[] = [
  { x: 0, height: 1.1, ribbon: '#f0bf4c' },
  { x: -3.4, height: 0.74, ribbon: '#c9cbd8' },
  { x: 3.4, height: 0.46, ribbon: '#cf8b52' },
];
const RADIUS = 1.55;
/** Quanto a rodela afunda no chão (o terreno não é plano: nenhum pé fica no ar). */
const SINK = 0.5;
/** Besouros lado a lado em cima de um degrau (e na fila da frente). */
const SPACING = 0.95;
/** Fila de quem não subiu: um pouco à frente dos degraus. */
const FRONT_ROW_Z = 2.6;

const BARK = new THREE.Color('#7a5234');
const BARK_DARK = new THREE.Color('#5b3b25');
const WOOD = new THREE.Color('#e3bd86');
const RING = new THREE.Color('#c79558');

export class Podium {
  readonly group = new THREE.Group();
  /** O que a câmera de vitrine enquadra: o chão no meio do pódio, de frente pra +z. */
  readonly anchor = new THREE.Object3D();
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly tops: number[] = [];
  private shown = false;

  constructor(private readonly physics: Physics) {
    this.group.name = 'podium';
    const ground = terrainHeight(0, 0);
    this.anchor.position.set(0, ground, 0);
    this.group.add(this.anchor);
    const barkMaterial = clay(0xffffff, { vertexColors: true, roughness: 0.9, sheen: 0.25, bump: 0.6, mottle: 0.12, mottleScale: 4 });
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      // O pé mais baixo da rodela decide onde ela começa (afundada, nunca flutuando).
      let low = Infinity;
      for (let a = 0; a < 8; a++) low = Math.min(low, terrainHeight(step.x + Math.cos(a) * RADIUS, Math.sin(a) * RADIUS));
      const base = Math.min(low, terrainHeight(step.x, 0)) - SINK;
      const top = terrainHeight(step.x, 0) + step.height;
      this.tops.push(top);
      const stump = new THREE.Mesh(stumpGeometry(RADIUS, top - base, i), barkMaterial);
      stump.position.set(step.x, base, 0);
      stump.castShadow = true;
      stump.receiveShadow = true;
      const ribbon = new THREE.Mesh(new THREE.TorusGeometry(RADIUS + 0.03, 0.07, 8, 48), clay(step.ribbon, { roughness: 0.45, sheen: 0.8, bump: 0.1, clearcoat: 0.3 }));
      ribbon.rotation.x = Math.PI / 2;
      ribbon.position.set(step.x, top - 0.22, 0);
      ribbon.castShadow = true;
      const badge = numberBadge(i + 1, step.ribbon);
      badge.position.set(step.x, top - Math.min(0.55, (top - base - SINK) * 0.55), RADIUS + 0.02);
      this.group.add(stump, ribbon, badge);
    }
  }

  get visible(): boolean {
    return this.shown;
  }

  show(scene: THREE.Scene): void {
    if (this.shown) return;
    this.shown = true;
    scene.add(this.group);
    const world = this.physics.world;
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      const top = this.tops[i];
      const bottom = top - STEPS[i].height - SINK - 1;
      const half = (top - bottom) / 2;
      const desc = RAPIER.ColliderDesc.cylinder(half, RADIUS)
        .setTranslation(step.x, bottom + half, 0)
        .setFriction(0.9)
        .setCollisionGroups(interactionGroups(Groups.WORLD, 0xffff));
      this.colliders.push(world.createCollider(desc));
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.group.removeFromParent();
    const world = this.physics.world;
    for (const collider of this.colliders) world.removeCollider(collider, false);
    this.colliders.length = 0;
  }

  /**
   * Onde fica um besouro: `rank` = posição do time/jogador (0 = primeiro),
   * `index` dele dentro do time de `count`. Do 4º em diante, na fila da frente
   * (`index` conta a fila inteira). Todo mundo olha pra frente (+z).
   */
  spot(rank: number, index: number, count: number, out: THREE.Vector3): { position: THREE.Vector3; yaw: number } {
    const n = Math.max(1, count);
    const offset = (index - (n - 1) / 2) * SPACING;
    if (rank < STEPS.length) {
      const step = STEPS[rank];
      return { position: out.set(step.x + offset, this.tops[rank] + 0.02, 0.15), yaw: 0 };
    }
    const x = offset;
    return { position: out.set(x, terrainHeight(x, FRONT_ROW_Z), FRONT_ROW_Z), yaw: 0 };
  }

  /** Topo do degrau (pros confetes). */
  top(rank: number, out: THREE.Vector3): THREE.Vector3 {
    const step = STEPS[Math.min(rank, STEPS.length - 1)];
    return out.set(step.x, this.tops[Math.min(rank, STEPS.length - 1)] + 0.4, 0);
  }
}

/** Rodela de tronco: casca por fora (com sulcos), madeira clara com anéis em cima. Origem na base. */
function stumpGeometry(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const geometry = lumpify(new THREE.CylinderGeometry(radius, radius * 1.04, height, 40, 6), 0.035, 3.5, 7 + seed);
  geometry.translate(0, height / 2, 0);
  const topY = height - 0.02;
  paintVertices(geometry, (p, n, c) => {
    if (n.y > 0.7 && p.y > topY - 0.1) {
      // Tampa: madeira clara com anéis (mais escuros pra borda).
      const r = Math.hypot(p.x, p.z) / radius;
      const rings = 0.5 + 0.5 * Math.sin(r * 38 + seed);
      return c.copy(WOOD).lerp(RING, rings * 0.35 + smoothstep(0.82, 1, r) * 0.6);
    }
    // Casca: sulcos verticais.
    const angle = Math.atan2(p.z, p.x);
    const groove = Math.abs(Math.sin(angle * 11 + Math.sin(p.y * 3 + seed) * 0.6));
    return c.copy(BARK_DARK).lerp(BARK, 0.35 + groove * 0.65);
  });
  return geometry;
}

/** Placa com o número pintado na frente da rodela (disco creme, borda na cor da fita). */
function numberBadge(place: number, ring: string): THREE.Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff5e2';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.fill();
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';
  ctx.fillStyle = '#4a3224';
  ctx.font = `800 ${Math.round(size * 0.62)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(place), size / 2, size / 2 + size * 0.04);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.7 });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), material);
  mesh.name = `podium-badge-${place}`;
  return mesh;
}
