import * as THREE from 'three';
import { clamp } from '../../utils/math';
import { terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import { puddleAt } from './common';
import type { CritterContext } from './types';

/** Distância (unidades) entre duas amostras do rastro. */
export const TRAIL_STEP = 0.05;

/**
 * Rastro da cabeça de um bicho comprido (minhoca, lacraia): o corpo segue o
 * caminho que a cabeça fez, gomo a gomo. Cada amostra guarda x, z, a altura do
 * chão e a profundidade (0 = na superfície; cavando, ela cresce). Antes do
 * começo (s < 0) fica o "poço" descendo pelo buraco de onde o bicho saiu.
 *
 * O anel tem tamanho fixo (só o que o corpo ainda pode cobrir): nada é alocado
 * enquanto o bicho anda.
 */
export class GroundTrail {
  readonly hole = new THREE.Vector3();
  /** Comprimento andado pela cabeça desde o buraco. */
  headS = 0;
  /** Para onde a cabeça vai (ângulo no plano). */
  heading = 0;
  private readonly data: Float32Array;
  private readonly capacity: number;
  /** Amostras escritas desde o buraco (a amostra k fica em s = k·TRAIL_STEP). */
  private written = 0;

  /**
   * @param reach comprimento máximo que o corpo cobre atrás da cabeça
   * @param shaftSlope profundidade que o poço desce por unidade de corpo
   */
  constructor(
    reach: number,
    private readonly shaftSlope = 0.9,
  ) {
    this.capacity = Math.ceil(reach / TRAIL_STEP) + 4;
    this.data = new Float32Array(this.capacity * 4);
  }

  /** Começa um rastro novo saindo do buraco `hole`. */
  start(hole: THREE.Vector3, heading: number): void {
    this.hole.copy(hole);
    this.heading = heading;
    this.headS = 0;
    this.written = 0;
    this.push(hole.x, hole.z, hole.y, 0);
  }

  /** Ponto do corpo no comprimento `s` do rastro (s < 0 = dentro do buraco). Devolve a profundidade. */
  pointAt(s: number, target: THREE.Vector3): number {
    if (s <= 0 || this.written < 2) {
      const depth = Math.max(0, -s * this.shaftSlope);
      target.set(this.hole.x, this.hole.y - depth, this.hole.z);
      return depth;
    }
    const oldest = Math.max(0, this.written - this.capacity);
    const f = clamp(s / TRAIL_STEP, oldest, this.written - 1.001);
    const i = Math.floor(f);
    const k = f - i;
    const d = this.data;
    const a = (i % this.capacity) * 4;
    const b = (Math.min(i + 1, this.written - 1) % this.capacity) * 4;
    const depth = d[a + 3] + (d[b + 3] - d[a + 3]) * k;
    target.set(d[a] + (d[b] - d[a]) * k, d[a + 2] + (d[b + 2] - d[a + 2]) * k - depth, d[a + 1] + (d[b + 1] - d[a + 1]) * k);
    return depth;
  }

  /**
   * Cabeça anda `distance` para a frente, estendendo o rastro (na superfície,
   * desviando de pedra, poça e borda; ou cavando para baixo, `digRate` de
   * profundidade por unidade andada).
   */
  advance(distance: number, ctx: CritterContext, digging: boolean, digRate = 0.75): void {
    this.headS += distance;
    const d = this.data;
    while ((this.written - 1) * TRAIL_STEP < this.headS) {
      const last = ((this.written - 1) % this.capacity) * 4;
      let x = d[last];
      let z = d[last + 1];
      for (let attempt = 0; attempt < 6; attempt++) {
        const nx = d[last] + Math.sin(this.heading) * TRAIL_STEP;
        const nz = d[last + 1] + Math.cos(this.heading) * TRAIL_STEP;
        if (digging || (ctx.isGroundFree(nx, nz) && !puddleAt(ctx, nx, nz, 0.2) && Math.hypot(nx, nz) < PLAY_RADIUS - 2)) {
          x = nx;
          z = nz;
          break;
        }
        // Esbarrou em algo (pedra, poça, borda): vira e tenta de novo.
        this.heading += Math.PI * 0.3;
      }
      const depth = digging ? d[last + 3] + TRAIL_STEP * digRate : 0;
      this.push(x, z, terrainHeight(x, z), depth);
    }
  }

  private push(x: number, z: number, groundY: number, depth: number): void {
    const i = (this.written % this.capacity) * 4;
    this.data[i] = x;
    this.data[i + 1] = z;
    this.data[i + 2] = groundY;
    this.data[i + 3] = depth;
    this.written++;
  }
}
