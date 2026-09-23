import type * as THREE from 'three';
import type { Rng } from '../../utils/math';
import type { CatalogId } from '../../progression/catalog';

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
  /** Figurinha do catálogo (tatuzinho, tesourinha, bicho-pau...). */
  id: CatalogId;
  /** Objeto em coordenadas de MUNDO (sem pai, transformação já aplicada). */
  object: THREE.Object3D;
  /** "Tamanho efetivo" para a regra de grudar/soterrar. */
  size: number;
  /** Cor predominante (para as partículas). */
  color: THREE.Color;
}

/**
 * Algo na fauna que o jogo pode querer contar (aviso na tela, conquista,
 * catálogo): a revoada começou, o beija-flor apareceu, a bola rasgou uma teia
 * (e o chumaço de teia vem junto, pronto para grudar).
 */
export type CritterEvent = { type: 'swarm' } | { type: 'hummingbirdSeen' } | { type: 'webTorn'; item: CollectedCritter };

/** Barulho pontual de bicho (coaxada, pulo, teia rasgando, piado do beija-flor). */
export type CritterCall = 'croak' | 'hop' | 'webTear' | 'hummingbirdChirp';
/** Barulho contínuo de bicho: só o mais perto de cada tipo soa (zumbido, cantoria). */
export type CritterHum = 'bee' | 'stridulate' | 'hummingbird' | 'swarm';

/**
 * Onde os bichos avisam que fizeram barulho. Os bichos não sabem nada de áudio:
 * só contam o que fizeram e onde; quem escuta decide o que tocar.
 */
export interface CritterSounds {
  call(kind: CritterCall, position: THREE.Vector3, size: number): void;
  hum(kind: CritterHum, position: THREE.Vector3): void;
}

/** Poder "Fedor irresistível": 0 = normal; 1 e 2 = bichos de chão que grudam vão ATÉ a bola. */
export type AttractLevel = 0 | 1 | 2;

/** Estado compartilhado que todas as espécies leem a cada frame. */
export interface CritterContext {
  readonly rng: Rng;
  readonly sounds: CritterSounds;
  /** Pontos de pouso VIVOS (entradas somem quando a flor é arrancada e voltam na rodada nova). */
  readonly spots: THREE.Vector3[];
  readonly isGroundFree: GroundFilter;
  world: CritterWorld;
  /** Relógio próprio dos bichos (segundos). */
  time: number;
  /** Direção horizontal (normalizada) para onde a câmera está olhando. */
  readonly viewDir: THREE.Vector3;
  /** Poder "Fedor irresistível" ativo (ver `attraction` em common.ts). */
  attract: AttractLevel;
  /** Menu aberto (madrugada): visitante de dia (beija-flor, revoada) não começa agora. */
  menu: boolean;
  /** Conta ao jogo um acontecimento da fauna. */
  emit(event: CritterEvent): void;
}

/** Uma espécie cuida de todos os indivíduos dela (e das próprias malhas instanciadas). */
export interface Species {
  update(dt: number, ctx: CritterContext): void;
  /** Susto num ponto: pousados levantam voo, tatuzinho enrola, gafanhoto pula... */
  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void;
  /**
   * Katamari de bicho (só quem gruda): se algum indivíduo está encostando numa
   * bola grande o bastante, sai do mundo dos bichos e volta como objeto de mundo.
   */
  collect?(ballCenter: THREE.Vector3, ballRadius: number, ctx: CritterContext): CollectedCritter | null;
  /** Rodada nova: o jardim se refaz (teias voltam...). */
  newRound?(ctx: CritterContext): void;
}
