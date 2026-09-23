import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import type { CatalogId } from '../../progression/catalog';
import { terrainHeight, terrainNormal } from '../Terrain';
import type { PickableFinish, SceneryContext } from '../scenery/context';
import type { SurfaceProfile } from '../../render/StaticBatch';
import type { ZoneSite } from '../zones';

/**
 * O que todo objeto de gente (e as frutas caídas) compartilha: a tabela de
 * tamanho × volume × acabamento, o registro como arrancável e os atalhos de
 * "assentar no chão" e "colisor preso no objeto".
 */

/** Objetos arrancáveis (cada um é uma figurinha do catálogo). */
export type ObjectId =
  | 'pinecone'
  | 'apple'
  | 'strawberry'
  | 'cookie'
  | 'soldier'
  | 'toyCar'
  | 'duck'
  | 'tennisBall'
  | 'pot'
  | 'trowel'
  | 'glove'
  | 'flipflop'
  | 'gnome';

export interface ObjectStats {
  /** Raio mínimo da bola para arrancar (o HUD mostra ×4 em cm). */
  readonly size: number;
  /** Quanto a bola engorda ao engolir. */
  readonly volume: number;
  /** Acabamento quando vira malha de verdade grudada na bola. */
  readonly finish: PickableFinish;
}

/**
 * Tamanho × volume de cada objeto. O volume segue a regra do jardim (≈ um quarto
 * a um terço do volume da bola que consegue arrancar, como a pedra), com os
 * gigantes do fim um pouco acima: somando tudo (~950) com os ~755 do jardim
 * natural, os 30 cm só saem varrendo quase o mapa inteiro. Maçã usa acabamento
 * brilhante (casca encerada), a exceção à regra "fruta = macia".
 */
export const OBJECT_STATS: Readonly<Record<ObjectId, ObjectStats>> = {
  strawberry: { size: 0.9, volume: 0.8, finish: 'soft' },
  cookie: { size: 1.2, volume: 1.5, finish: 'matte' },
  soldier: { size: 1.3, volume: 1.5, finish: 'glossy' },
  pinecone: { size: 1.6, volume: 4.5, finish: 'matte' },
  toyCar: { size: 1.9, volume: 7.5, finish: 'glossy' },
  apple: { size: 2.0, volume: 10, finish: 'glossy' },
  tennisBall: { size: 2.0, volume: 10, finish: 'soft' },
  duck: { size: 2.1, volume: 10, finish: 'glossy' },
  pot: { size: 2.3, volume: 18, finish: 'matte' },
  trowel: { size: 3.6, volume: 80, finish: 'glossy' },
  glove: { size: 3.9, volume: 85, finish: 'matte' },
  flipflop: { size: 4.4, volume: 105, finish: 'soft' },
  gnome: { size: 5.4, volume: 195, finish: 'glossy' },
};

/** Garantia de tipo: todo objeto é uma figurinha do catálogo. */
const asCatalogId = (id: ObjectId): CatalogId => id;

/** Uma peça de um modelo montado em cache (geometria + cor + acabamento no lote). */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  profile: SurfaceProfile;
}

export interface ObjectPlacement {
  id: ObjectId;
  /** Já posicionado no mundo, origem no pé do objeto. */
  root: THREE.Object3D;
  colliders: RAPIER.Collider[];
  probeA: THREE.Vector3;
  probeB: THREE.Vector3;
  probeRadius: number;
  /** Maior dimensão (para caber na bola ao grudar). */
  extent: number;
  tint: THREE.ColorRepresentation;
  landingSpots?: THREE.Vector3[];
  castShadow?: boolean;
}

/** Registra um objeto como arrancável (tamanho, volume e acabamento saem da tabela). */
export function addObject(ctx: SceneryContext, placement: ObjectPlacement): void {
  const stats = OBJECT_STATS[placement.id];
  ctx.addPickable({
    kind: 'object',
    variant: asCatalogId(placement.id),
    root: placement.root,
    batch: { castShadow: placement.castShadow ?? true },
    size: stats.size,
    volume: stats.volume,
    finish: stats.finish,
    probeA: placement.probeA,
    probeB: placement.probeB,
    probeRadius: placement.probeRadius,
    colliders: placement.colliders,
    landingSpots: placement.landingSpots ?? [],
    tint: placement.tint,
    extent: placement.extent,
  });
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpNormal = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/**
 * Põe o objeto no chão: pé na altura do terreno (menos `sink`), girado `yaw` em
 * volta do eixo vertical e inclinado junto com a ladeira (`follow` 0..1: 1 = deita
 * rente ao chão, 0 = fica em pé no prumo). Devolve a altura do chão.
 */
export function settle(root: THREE.Object3D, x: number, z: number, yaw: number, follow = 1, sink = 0): number {
  const ground = terrainHeight(x, z);
  root.position.set(x, ground - sink, z);
  terrainNormal(x, z, tmpNormal).lerp(UP, 1 - follow).normalize();
  root.quaternion.setFromUnitVectors(UP, tmpNormal).multiply(tmpQuat.setFromAxisAngle(UP, yaw));
  root.updateMatrixWorld(true);
  return ground;
}

/**
 * Colisor fixo preso ao objeto: `offset`/`rotation` no espaço local do `root`
 * (que precisa estar sem pai e com a matriz em dia).
 */
export function attachCollider(
  ctx: SceneryContext,
  root: THREE.Object3D,
  desc: RAPIER.ColliderDesc,
  offset = new THREE.Vector3(),
  rotation?: THREE.Quaternion,
): RAPIER.Collider {
  root.updateMatrixWorld(true);
  const position = root.localToWorld(offset.clone());
  const worldRotation = root.quaternion.clone();
  if (rotation) worldRotation.multiply(rotation);
  return ctx.addCollider(desc, position, worldRotation);
}

/**
 * Encosta o conteúdo no chão: com o `root` ainda na origem (sem giro), sobe ou
 * desce os filhos até a parte mais baixa ficar em `y = -sink`. Serve para objeto
 * tombado (fruta deitada, soldadinho caído), onde o "pé" não é óbvio.
 */
export function restOnGround(root: THREE.Object3D, sink = 0): THREE.Box3 {
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const lift = -box.min.y - sink;
  for (const child of root.children) child.position.y += lift;
  box.min.y += lift;
  box.max.y += lift;
  return box;
}

/**
 * Casco convexo fixo a partir de pontos no espaço local do `root` (luva, chinelo,
 * pá: formas que caixa e cápsula não abraçam direito). Os pontos vão para o mundo
 * e o corpo fica no meio deles.
 */
export function attachHull(ctx: SceneryContext, root: THREE.Object3D, localPoints: readonly THREE.Vector3[]): RAPIER.Collider[] {
  root.updateMatrixWorld(true);
  const world = localPoints.map((p) => root.localToWorld(p.clone()));
  const center = world.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(world.length);
  const flat = new Float32Array(world.length * 3);
  world.forEach((p, i) => flat.set([p.x - center.x, p.y - center.y, p.z - center.z], i * 3));
  const desc = RAPIER.ColliderDesc.convexHull(flat);
  return desc ? [ctx.addCollider(desc, center)] : [];
}

/** Ponto local do objeto em coordenadas de mundo. */
export function toWorld(root: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return root.localToWorld(new THREE.Vector3(x, y, z));
}

/**
 * Referencial de um cantinho: `across` para a direita de quem chega, `along` para
 * a frente (em direção ao nascimento). `yaw` gira um objeto "de frente" para quem chega.
 */
export interface ZoneFrame {
  readonly zone: ZoneSite;
  point(across: number, along: number): THREE.Vector2;
  /** Yaw de um objeto no cantinho, somado à direção em que o cantinho abre. */
  yaw(offset: number): number;
}

export function zoneFrame(zone: ZoneSite): ZoneFrame {
  const fx = Math.sin(zone.facing);
  const fz = Math.cos(zone.facing);
  // Direita de quem chega do nascimento olhando para o cantinho (olhar = −frente).
  const rx = fz;
  const rz = -fx;
  return {
    zone,
    point: (across, along) => new THREE.Vector2(zone.x + rx * across + fx * along, zone.z + rz * across + fz * along),
    yaw: (offset) => zone.facing + offset,
  };
}
