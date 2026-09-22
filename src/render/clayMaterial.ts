import * as THREE from 'three';
import { createRng } from '../utils/math';

/**
 * Material de "massinha": o visual Human Fall Flat vem de três coisas juntas —
 * superfície fosca com brilho aveludado (sheen), micro-relevo de dedo apertando
 * (normal map procedural) e oclusão ambiente forte (feita no pós-processamento).
 */

const TEXTURE_SIZE = 256;

let sharedNormalMap: THREE.DataTexture | null = null;

/**
 * Gera um normal map tileável com "dedadas" suaves + granulado fino.
 * Tudo com distância em wrap-around para não aparecer costura ao repetir.
 */
function buildClayNormalMap(): THREE.DataTexture {
  const size = TEXTURE_SIZE;
  const height = new Float32Array(size * size);
  const rng = createRng(1337);

  // Dedadas: depressões gaussianas largas e rasas.
  const dents = 70;
  for (let i = 0; i < dents; i++) {
    const cx = rng.next() * size;
    const cy = rng.next() * size;
    const radius = rng.range(10, 34);
    const depth = rng.range(0.35, 1);
    const r2 = radius * radius;
    const reach = Math.ceil(radius * 2);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 * 4) continue;
        const x = (Math.floor(cx) + dx + size) % size;
        const y = (Math.floor(cy) + dy + size) % size;
        height[y * size + x] -= depth * Math.exp(-d2 / r2);
      }
    }
  }

  // Granulado: ruído de valor numa grade que dá a volta (tileável), em duas escalas.
  const addValueNoise = (cells: number, amplitude: number, seed: number) => {
    const grid = new Float32Array(cells * cells);
    const g = createRng(seed);
    for (let i = 0; i < grid.length; i++) grid[i] = g.next();
    const cell = size / cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx) % cells;
        const y0 = Math.floor(gy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = gx - Math.floor(gx);
        const ty = gy - Math.floor(gy);
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        height[y * size + x] += (v - 0.5) * amplitude;
      }
    }
  };
  addValueNoise(32, 0.35, 7);
  addValueNoise(96, 0.12, 11);

  // Sobel -> normal em espaço tangente.
  const data = new Uint8Array(size * size * 4);
  const sample = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function getClayNormalMap(): THREE.DataTexture {
  sharedNormalMap ??= buildClayNormalMap();
  return sharedNormalMap;
}

export interface ClayOptions {
  roughness?: number;
  /** Intensidade do brilho aveludado de borda. */
  sheen?: number;
  /** Força do micro-relevo; 0 desliga o normal map. */
  bump?: number;
  /** Repetição do normal map (para superfícies grandes, como o chão). */
  repeat?: number;
  /** Casco de besouro: brilho furta-cor. */
  iridescence?: number;
  clearcoat?: number;
  vertexColors?: boolean;
  flatShading?: boolean;
}

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * Fábrica de materiais de massinha, com cache: a mesma cor+opções devolve
 * a mesma instância (menos trocas de shader/programa na GPU).
 */
export function clay(color: THREE.ColorRepresentation, options: ClayOptions = {}): THREE.MeshPhysicalMaterial {
  const {
    roughness = 0.72,
    sheen = 0.5,
    bump = 0.35,
    repeat = 1,
    iridescence = 0,
    clearcoat = 0,
    vertexColors = false,
    flatShading = false,
  } = options;

  const key = `${new THREE.Color(color).getHexString()}|${roughness}|${sheen}|${bump}|${repeat}|${iridescence}|${clearcoat}|${vertexColors}|${flatShading}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = new THREE.Color(color);
  const material = new THREE.MeshPhysicalMaterial({
    color: vertexColors ? 0xffffff : base,
    roughness,
    metalness: 0,
    sheen,
    // Sheen levemente mais claro que a base: é o "pózinho" de massinha na borda.
    sheenColor: base.clone().lerp(new THREE.Color(0xffffff), 0.55),
    sheenRoughness: 0.8,
    iridescence,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 600],
    clearcoat,
    clearcoatRoughness: 0.35,
    vertexColors,
    flatShading,
  });

  if (bump > 0) {
    const map = getClayNormalMap();
    if (repeat !== 1) {
      // Clona só a referência de repetição; os dados da textura continuam compartilhados.
      const repeated = map.clone();
      repeated.repeat.set(repeat, repeat);
      repeated.needsUpdate = true;
      material.normalMap = repeated;
    } else {
      material.normalMap = map;
    }
    material.normalScale.set(bump, bump);
  }

  cache.set(key, material);
  return material;
}
