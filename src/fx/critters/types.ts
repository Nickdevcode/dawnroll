import type * as THREE from 'three';
import type { Rng } from '../../utils/math';

/** Onde o bicho pode andar no chão (fora de pedras, troncos...). */
export type GroundFilter = (x: number, z: number) => boolean;

/** Poça d'água do jeito que os bichos enxergam. */
export interface CritterPuddle {
  x: number;
  z: number;
  /** Raio da bacia (unidades de mundo). */
  radius: number;
  /** Altura (mundo) da superfície da água. */
  level: number;
  /** 0..1: quão cheia está. */
  fill: number;
}

/** O que os bichos precisam saber do jogo a cada frame (tudo já interpolado). */
export interface CritterWorld {
  /** Pés do besouro. */
  player: THREE.Vector3;
  camera: THREE.Vector3;
  /** Centro da bola. */
  ballPosition: THREE.Vector3;
  ballRadius: number;
  /** 0..1: intensidade da chuva agora. */
  rain: number;
  /** 0..1: chão molhado (sobe na chuva, seca devagar depois). */
  wetness: number;
  /** TODAS as poças (secas também, com `fill` 0): as posições servem para não montar nada dentro da bacia. */
  puddles: readonly CritterPuddle[];
}

/** Bicho que a bola pegou (estilo Katamari), pronto para grudar nela. */
export interface CollectedCritter {
  /** Objeto em coordenadas de MUNDO (sem pai, transformação já aplicada). */
  object: THREE.Object3D;
  /** "Tamanho efetivo" para a regra de grudar/soterrar. */
  size: number;
  /** Cor predominante (para as partículas). */
  color: THREE.Color;
}

/** Estado compartilhado que todas as espécies leem a cada frame. */
export interface CritterContext {
  readonly rng: Rng;
  /** Pontos de pouso VIVOS (entradas somem quando a flor é arrancada e voltam na rodada nova). */
  readonly spots: THREE.Vector3[];
  readonly isGroundFree: GroundFilter;
  world: CritterWorld;
  /** Relógio próprio dos bichos (segundos). */
  time: number;
  /** Direção horizontal (normalizada) para onde a câmera está olhando. */
  readonly viewDir: THREE.Vector3;
}

/** Uma espécie cuida de todos os indivíduos dela (e das próprias malhas instanciadas). */
export interface Species {
  update(dt: number, ctx: CritterContext): void;
  /** Susto num ponto: pousados levantam voo, tatuzinho enrola, gafanhoto pula... */
  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void;
}
