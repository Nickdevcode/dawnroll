import * as THREE from 'three';
import { createRng } from '../utils/math';

/**
 * O mesmo ruído de valor do `clayNoise2` (grade inteira, interpolação suave),
 * só que pré-calculado numa textura que se repete. No chão ele aparece em dez
 * escalas por pixel: calcular os hashes na hora custava quase metade do passe
 * da cena em 4K; ler da textura sai por uma fração disso.
 *
 * Cada célula da grade vira TEXELS_PER_CELL texels: o filtro bilinear entre eles
 * segue a curva suave com erro abaixo de ~1%. Com mipmap e filtro anisotrópico
 * o chão distante fica estável (a versão calculada cintilava ao longe).
 */
const CELLS = 128;
const TEXELS_PER_CELL = 8;
const SIZE = CELLS * TEXELS_PER_CELL;
const SEED = 0x5eed;

let texture: THREE.DataTexture | null = null;

function buildTexture(): THREE.DataTexture {
  // Valores da grade (repetem a cada CELLS células: a textura emenda sem costura).
  const rng = createRng(SEED);
  const lattice = new Float32Array(CELLS * CELLS);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();

  // Peso suave (3t² − 2t³) no centro de cada texel, igual para todas as células.
  const weights = new Float32Array(TEXELS_PER_CELL);
  for (let t = 0; t < TEXELS_PER_CELL; t++) {
    const f = (t + 0.5) / TEXELS_PER_CELL;
    weights[t] = f * f * (3 - 2 * f);
  }

  const data = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const cy = Math.floor(y / TEXELS_PER_CELL);
    const wy = weights[y % TEXELS_PER_CELL];
    const row0 = cy * CELLS;
    const row1 = ((cy + 1) % CELLS) * CELLS;
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.floor(x / TEXELS_PER_CELL);
      const cx1 = (cx + 1) % CELLS;
      const wx = weights[x % TEXELS_PER_CELL];
      const bottom = lattice[row0 + cx] + (lattice[row0 + cx1] - lattice[row0 + cx]) * wx;
      const top = lattice[row1 + cx] + (lattice[row1 + cx1] - lattice[row1 + cx]) * wx;
      data[y * SIZE + x] = Math.round((bottom + (top - bottom) * wy) * 255);
    }
  }

  const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  // O three limita ao máximo da placa de vídeo.
  map.anisotropy = 8;
  map.colorSpace = THREE.NoColorSpace;
  map.name = 'clay-noise';
  map.needsUpdate = true;
  return map;
}

/** Textura única do ruído (montada na primeira vez que alguém pede). */
export function getNoiseTexture(): THREE.DataTexture {
  texture ??= buildTexture();
  return texture;
}

/**
 * GLSL: `clayNoise2Tex(p)` equivale a `clayNoise2(p)` (0..1, uma célula por
 * unidade de `p`), lido da textura. Precisa do uniform `tClayNoise` = {@link getNoiseTexture}.
 */
export const noiseTextureGLSL = /* glsl */ `
uniform sampler2D tClayNoise;
float clayNoise2Tex(vec2 p) {
  return texture2D(tClayNoise, p * ${(1 / CELLS).toFixed(8)}).r;
}
`;
