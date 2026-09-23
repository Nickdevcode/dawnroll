import type { EffectsFrame } from '../fx/Effects';

/**
 * O que o áudio precisa saber do jogo a cada quadro. O jogo preenche; o áudio
 * só lê. A parte visual (posições interpoladas, clima, poças, fedor) vem do
 * mesmo retrato que os efeitos usam — o que se ouve bate com o que se vê.
 */
export interface AudioFrame {
  readonly scene: EffectsFrame;
  /** Menu aberto (início ou pausa). */
  paused: boolean;
  /** Contador de passadas do besouro: cada incremento é uma pata tocando o chão. */
  footfalls: number;
  /** Altura dos pés acima do terreno (em cima de pedra ou tronco = chão duro). */
  feetClearance: number;
  /** 0 = grama, 1 = terra, debaixo do besouro e debaixo da bola. */
  playerDirt: number;
  ballDirt: number;
  /** A bola participa da física (falso enquanto a toca engole). */
  ballSolid: boolean;
  /** Altura da base da bola acima do terreno. */
  ballClearance: number;
  ballDissolving: boolean;
  ballItems: number;
  ballDiameterCm: number;
  burying: boolean;
  /** 0 = céu limpo, 1 = tempestade fechada. */
  overcast: number;
}
