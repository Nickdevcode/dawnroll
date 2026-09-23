import * as THREE from 'three';
import type { Rng } from '../../utils/math';
import type { ZoneSite } from '../zones';

/**
 * Montagem procedural de um cantinho: guarda o chão já ocupado (círculos) e
 * sorteia lugares livres dentro do cantinho para o próximo objeto. Objeto
 * comprido (pá, luva, carrinho deitado) ocupa uma fileira de círculos ao longo
 * do comprimento — uma "cápsula" no chão.
 */

/**
 * Coisa que "fugiu" do cantinho: o morango que as formigas arrastaram, o
 * soldadinho esquecido no meio do gramado. O cantinho monta sem ela e o jardim
 * a larga num lugar qualquer.
 */
export type LostItem = 'strawberry' | 'cookie' | 'soldier' | 'toyCar' | 'glove' | 'pot';

/** Objeto comprido no chão: meio-comprimento ao longo do giro (eixo `(sin yaw, cos yaw)`). */
export interface Capsule {
  yaw: number;
  halfLength: number;
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface SpotOptions {
  /** Até que fração do raio do cantinho o objeto pode ir (o resto é folga da borda). */
  reach?: number;
  /** Distância mínima do meio do cantinho (deixa o miolo para outra coisa). */
  inner?: number;
  /** Espaço extra entre este objeto e os vizinhos. */
  gap?: number;
  capsule?: Capsule;
  attempts?: number;
}

export class Footprints {
  private readonly circles: Circle[] = [];

  constructor(private readonly zone: ZoneSite) {}

  /** O círculo (x, z, r) cabe sem encostar em nada (com `gap` de folga)? */
  fits(x: number, z: number, r: number, gap = 0): boolean {
    for (const c of this.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + r + gap) return false;
    return true;
  }

  add(x: number, z: number, r: number, capsule?: Capsule): void {
    for (const c of capsuleCircles(x, z, r, capsule)) this.circles.push(c);
  }

  /**
   * Lugar livre sorteado dentro do cantinho (null se não achou). Com `capsule`,
   * testa o comprimento todo; o lugar volta já reservado.
   */
  spot(rng: Rng, r: number, options: SpotOptions = {}): THREE.Vector2 | null {
    const { reach = 0.9, gap = 0.6 } = options;
    // Cantinho apertado: tenta de novo encostando mais nos vizinhos e indo até a borda.
    return this.trySpot(rng, r, options, reach, gap) ?? this.trySpot(rng, r, options, Math.min(1, reach + 0.1), gap * 0.3);
  }

  private trySpot(rng: Rng, r: number, options: SpotOptions, reach: number, gap: number): THREE.Vector2 | null {
    const { inner = 0, capsule, attempts = 120 } = options;
    const zone = this.zone;
    const maxD = Math.max(inner, zone.radius * reach - r);
    for (let i = 0; i < attempts; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = inner + Math.sqrt(rng.next()) * (maxD - inner);
      const x = zone.x + Math.cos(a) * d;
      const z = zone.z + Math.sin(a) * d;
      const circles = capsuleCircles(x, z, r, capsule);
      if (!circles.every((c) => Math.hypot(c.x - zone.x, c.z - zone.z) + c.r <= zone.radius + 0.5 && this.fits(c.x, c.z, c.r, gap))) continue;
      this.circles.push(...circles);
      return new THREE.Vector2(x, z);
    }
    return null;
  }
}

/** Os círculos que cobrem uma cápsula no chão (ou o círculo só, se não for comprida). */
export function capsuleCircles(x: number, z: number, r: number, capsule?: Capsule): Circle[] {
  if (!capsule || capsule.halfLength <= r * 0.5) return [{ x, z, r }];
  const dx = Math.sin(capsule.yaw);
  const dz = Math.cos(capsule.yaw);
  const n = Math.max(2, Math.ceil((capsule.halfLength * 2) / r));
  const out: Circle[] = [];
  for (let i = 0; i < n; i++) {
    const t = -capsule.halfLength + (i / (n - 1)) * capsule.halfLength * 2;
    out.push({ x: x + dx * t, z: z + dz * t, r });
  }
  return out;
}
