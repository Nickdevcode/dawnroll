import type * as THREE from 'three';
import type { RAPIER } from '../../core/Physics';
import type { AddObjectOptions, StaticBatch } from '../../render/StaticBatch';
import type { Rng } from '../../utils/math';

export type PickableKind = 'flower' | 'mushroom' | 'rock' | 'log';

/**
 * Algo do cenário que a bola arranca do chão quando fica grande o bastante
 * (Katamari). Tudo em coordenadas de mundo.
 */
export interface PickableSpec {
  kind: PickableKind;
  /** Grupo (ou peça) com as `part`, já posicionado no mundo; a origem é o pé do objeto. */
  root: THREE.Object3D;
  /** Opções do lote (vento, sombra) — as mesmas de um objeto estático comum. */
  batch?: Omit<AddObjectOptions, 'removableId'>;
  /** Raio mínimo da bola para arrancar. */
  size: number;
  /** Segmento de contato + raio (uma cápsula): a bola arranca ao encostar nela. */
  probeA: THREE.Vector3;
  probeB: THREE.Vector3;
  probeRadius: number;
  /** Colisores que somem junto (a bola passa a rolar por cima do lugar). */
  colliders: RAPIER.Collider[];
  /** Pontos de pouso de inseto que pertencem a este objeto (miolo da flor, chapéu...). */
  landingSpots: THREE.Vector3[];
  /** Cor predominante (partículas do "arrancou"). */
  tint: THREE.ColorRepresentation;
  /** Volume que a bola ganha ao engolir. */
  volume: number;
  /** Maior dimensão do objeto (para caber na bola quando gruda). */
  extent: number;
}

/**
 * O que os construtores de cenário recebem: sorteio determinístico, o lote
 * estático onde as peças são assadas e os registros que o resto do jogo usa
 * (colisores, áreas sólidas, sombras de contato, pontos de pouso de inseto).
 */
export interface SceneryContext {
  readonly rng: Rng;
  readonly batch: StaticBatch;
  /** Multiplicador de enfeites sem colisão (qualidade do aparelho). */
  readonly decor: number;
  addCollider(desc: RAPIER.ColliderDesc, position: THREE.Vector3, rotation?: THREE.Quaternion): RAPIER.Collider;
  /** Área ocupada no chão (grama e enfeites não nascem dentro). */
  addSolid(x: number, z: number, radius: number): void;
  /** Escurece o chão em volta (sombra de contato pintada no terreno). */
  addShade(x: number, z: number, radius: number, strength: number): void;
  /** Ponto onde borboletas e abelhas gostam de pousar (miolo de flor, chapéu de cogumelo...). Devolve o ponto guardado. */
  addLandingSpot(position: THREE.Vector3): THREE.Vector3;
  /** Assa o objeto no lote como "arrancável" e registra o que some junto com ele. */
  addPickable(spec: PickableSpec): void;
}

/** Volume de uma esfera — atalho para o "quanto engorda" dos arrancáveis. */
export const sphereVolume = (radius: number): number => (4 / 3) * Math.PI * radius * radius * radius;
