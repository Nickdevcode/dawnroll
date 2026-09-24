import type * as THREE from 'three';
import type { AccessorySlot } from '../../progression/accessories';

/**
 * Onde cada acessório encaixa no besouro. Todos seguem a convenção do modelo:
 * +Z = frente, +Y = cima, origem no ponto de apoio da peça.
 *
 * - `head`: no alto da cabeça, entre os olhos (chapéus). Presa na cabeça, mas
 *   desconta parte do balanço dela (o chapéu não afunda no pronoto quando a
 *   cabeça levanta).
 * - `face`: no meio da linha dos olhos (óculos, bigode).
 * - `neck`: no centro da cabeça, que é onde ela encontra o pronoto (a gola
 *   abraça essa emenda; gravata e medalha pendem debaixo do sorriso). Presa na
 *   cabeça: acompanha o balanço dela.
 * - `back`: no topo das costas, onde o pronoto encontra os élitros (capa, mochila, asas).
 */
export type OutfitAnchors = Record<AccessorySlot, THREE.Group>;

/** O que os acessórios animados precisam saber do besouro a cada quadro. */
export interface OutfitPose {
  /** Relógio próprio do modelo (s). */
  time: number;
  dt: number;
  /** Velocidade horizontal (u/s). */
  speed: number;
  /** 0 = andando, 1 = de ponta-cabeça empurrando a bola. */
  pushBlend: number;
  /** 1 = no ar. */
  airborne: number;
  verticalSpeed: number;
  /**
   * Quanto a cabeça está de nariz pra baixo em relação ao chão (rad, + = pra
   * baixo): o que pende do pescoço desconta isso pra continuar caindo "pra
   * baixo" (empurrando a bola, o besouro fica de cara no chão).
   */
  headPitch: number;
}

export interface AccessoryModel {
  /** Vai dentro do encaixe do lugar dele. */
  readonly object: THREE.Object3D;
  /** Esconde o chifre enquanto está vestido (chapéu que cobre o topo da cabeça). */
  readonly hidesHorn?: boolean;
  /** Animação (hélice, capa, asas...). */
  update?(pose: OutfitPose): void;
}
