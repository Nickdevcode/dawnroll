import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Passo fixo da simulação. Física em passo fixo = comportamento igual em 60 Hz ou 144 Hz. */
export const FIXED_DT = 1 / 60;

/**
 * Gravidade "de brinquedo": mais forte que a real para a escala do mundo
 * (1 unidade ≈ 2 cm) não parecer em câmera lenta.
 */
export const GRAVITY = 22;

/** Grupos de colisão (16 bits de pertença << 16 | 16 bits de filtro). */
export const Groups = {
  WORLD: 1 << 0,
  BALL: 1 << 1,
  PLAYER: 1 << 2,
} as const;

export const interactionGroups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

export class Physics {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    // Mais iterações = contato bola/chão mais estável quando a bola fica grande e pesada.
    this.world.numSolverIterations = 6;
  }

  /** O wasm do Rapier precisa ser carregado antes de qualquer uso. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  step(): void {
    this.world.step();
  }
}
