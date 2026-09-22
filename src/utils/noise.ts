import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

const perlin = new ImprovedNoise();

/** Perlin 3D em [-1, 1] (aprox.). */
export const noise3 = (x: number, y: number, z: number): number => perlin.noise(x, y, z);

/** Fractal Brownian Motion 2D — base do relevo e das manchas de cor. */
export const fbm2 = (x: number, z: number, octaves = 4, seedOffset = 0): number => {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * perlin.noise(x * frequency, seedOffset + i * 17.31, z * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
};
