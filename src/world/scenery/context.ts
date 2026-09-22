import type * as THREE from 'three';
import type { RAPIER } from '../../core/Physics';
import type { StaticBatch } from '../../render/StaticBatch';
import type { Rng } from '../../utils/math';

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
  addCollider(desc: RAPIER.ColliderDesc, position: THREE.Vector3, rotation?: THREE.Quaternion): void;
  /** Área ocupada no chão (grama e enfeites não nascem dentro). */
  addSolid(x: number, z: number, radius: number): void;
  /** Escurece o chão em volta (sombra de contato pintada no terreno). */
  addShade(x: number, z: number, radius: number, strength: number): void;
  /** Ponto onde borboletas e abelhas gostam de pousar (miolo de flor, chapéu de cogumelo...). */
  addLandingSpot(position: THREE.Vector3): void;
}
