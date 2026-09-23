import * as THREE from 'three';
import { displace, paintVertices } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { noise3 } from '../../utils/noise';

/**
 * Bola de tênis: feltro verde-amarelado (felpudo no relevo e na cor) com a
 * costura branca em "S" que dá a volta na bola, afundada num sulquinho. A curva
 * é a clássica das bolas de tênis/beisebol (duas metades iguais encaixadas).
 */

/** Raio da bola de tênis (≈ 6,7 cm de diâmetro). */
export const TENNIS_BALL_RADIUS = 1.68;

const FELT = new THREE.Color('#cfe04a');
const FELT_DARK = new THREE.Color('#aebd33');
const SEAM = new THREE.Color('#f1efe4');

/** Pontos da costura numa esfera de raio 1. */
function seamPoints(samples: number): THREE.Vector3[] {
  const a = 0.7;
  const b = 1 - a;
  const c = 2 * Math.sqrt(a * b);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    points.push(new THREE.Vector3(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)).normalize());
  }
  return points;
}

let cached: THREE.BufferGeometry | null = null;

export function tennisBallGeometry(): THREE.BufferGeometry {
  if (cached) return cached;
  const R = TENNIS_BALL_RADIUS;
  const seam = seamPoints(360);
  const halfWidth = 0.055;
  // Distância (na esfera unitária) até a costura, calculada uma vez por vértice.
  const seamDistance = (x: number, y: number, z: number) => {
    const len = Math.hypot(x, y, z) || 1;
    let best = Infinity;
    for (const s of seam) {
      const d = (x / len - s.x) ** 2 + (y / len - s.y) ** 2 + (z / len - s.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const g = displace(new THREE.IcosahedronGeometry(1, 20), (x, y, z) => {
    const d = seamDistance(x, y, z);
    // Sulco da costura + penugem do feltro.
    return -(1 - smoothstep(halfWidth * 0.6, halfWidth * 1.6, d)) * 0.022 + noise3(x * 30, y * 30, z * 30) * 0.006;
  });
  paintVertices(g, (p, _n, c) => {
    const d = seamDistance(p.x, p.y, p.z);
    c.copy(FELT).lerp(FELT_DARK, smoothstep(-0.2, 0.6, noise3(p.x * 6, p.y * 6, p.z * 6)) * 0.45);
    c.multiplyScalar(0.94 + noise3(p.x * 40, p.y * 40, p.z * 40) * 0.1);
    return c.lerp(SEAM, 1 - smoothstep(halfWidth * 0.7, halfWidth, d));
  });
  g.scale(R, R, R);
  cached = g;
  return g;
}
