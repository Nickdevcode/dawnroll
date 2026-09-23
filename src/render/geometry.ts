import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3 } from '../utils/noise';

/**
 * Deforma uma geometria com ruído ao longo da normal — tira a cara de
 * "primitiva perfeita" e deixa tudo com jeito de modelado à mão.
 *
 * Os vértices são fundidos antes (mergeVertices) para a deformação não abrir
 * rachaduras nas costuras da UV.
 */
export function lumpify(geometry: THREE.BufferGeometry, amount: number, frequency: number, seed = 0): THREE.BufferGeometry {
  return displace(geometry, (x, y, z) => noise3(x * frequency + seed, y * frequency + seed * 0.7, z * frequency - seed) * amount);
}

/**
 * Desloca cada vértice ao longo da normal pelo valor de `fn(x, y, z)`.
 * Recalcula normais e gera UV esférica (suficiente para o normal map isotrópico da massinha).
 */
export function displace(geometry: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const hadUv = !!geometry.getAttribute('uv');
  // Guarda a UV num atributo à parte: mergeVertices só funde vértices idênticos em TODOS os atributos.
  const bare = geometry.clone();
  for (const name of Object.keys(bare.attributes)) {
    if (name !== 'position') bare.deleteAttribute(name);
  }
  const merged = mergeVertices(bare, 1e-4);
  merged.computeVertexNormals();

  const pos = merged.getAttribute('position') as THREE.BufferAttribute;
  const nor = merged.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = fn(x, y, z);
    pos.setXYZ(i, x + nor.getX(i) * n, y + nor.getY(i) * n, z + nor.getZ(i) * n);
  }
  merged.computeVertexNormals();
  if (hadUv) sphericalUv(merged);
  geometry.dispose();
  bare.dispose();
  return merged;
}

/** UV esférica a partir da direção do vértice em relação à origem. */
export function sphericalUv(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs = new Float32Array(pos.count * 2);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i).normalize();
    uvs[i * 2] = 0.5 + Math.atan2(tmp.z, tmp.x) / (Math.PI * 2);
    uvs[i * 2 + 1] = 0.5 + Math.asin(THREE.MathUtils.clamp(tmp.y, -1, 1)) / Math.PI;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/**
 * Formas de massinha já deformadas, guardadas pelos parâmetros: deformar (fundir
 * vértices, ruído, normais) é o que mais custa para montar bicho e cenário, e o
 * jardim de cada rodada pede as mesmas formas de novo. Quem pede recebe sempre
 * uma CÓPIA (pode escalar, pintar e mover à vontade). Tamanho limitado: as
 * formas de semente aleatória não enchem a memória.
 */
const shapeCache = new Map<string, THREE.BufferGeometry>();
const SHAPE_CACHE_LIMIT = 600;

function cachedShape(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let shape = shapeCache.get(key);
  if (!shape) {
    shape = build();
    if (shapeCache.size >= SHAPE_CACHE_LIMIT) shapeCache.delete(shapeCache.keys().next().value!);
    shapeCache.set(key, shape);
  }
  return shape.clone();
}

/** Esfera "de massinha" já deformada. `detail` = subdivisões do icosaedro (3 ≈ 320 triângulos, 8 ≈ 1600). */
export function claySphere(radius: number, detail = 3, lump = 0.06, frequency = 2.2, seed = 0): THREE.BufferGeometry {
  return cachedShape(`s|${radius}|${detail}|${lump}|${frequency}|${seed}`, () =>
    lumpify(new THREE.IcosahedronGeometry(radius, detail), radius * lump, frequency / radius, seed),
  );
}

/** Cápsula com as pontas levemente amassadas. */
export function clayCapsule(radius: number, length: number, lump = 0.05, seed = 0, radialSegments = 12): THREE.BufferGeometry {
  return cachedShape(`c|${radius}|${length}|${lump}|${seed}|${radialSegments}`, () =>
    lumpify(new THREE.CapsuleGeometry(radius, length, 6, radialSegments, Math.max(1, Math.round(length / radius))), radius * lump, 3 / radius, seed),
  );
}

/**
 * Pinta vertex colors a partir de uma função (posição, normal) → cor.
 * A cor devolvida pode ser reaproveitada (é copiada na hora).
 */
export function paintVertices(
  geometry: THREE.BufferGeometry,
  fn: (position: THREE.Vector3, normal: THREE.Vector3, target: THREE.Color) => THREE.Color,
): THREE.BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const out = fn(p, n, c);
    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Vertex color de uma cor só (para geometrias que vão ser fundidas com outras coloridas). */
export function solidColor(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  return paintVertices(geometry, (_p, _n, target) => target.copy(c));
}

/**
 * Tubo ao longo de uma curva com raio variável (afina da base para a ponta).
 * O TubeGeometry do three só tem raio constante; aqui o raio de cada anel é reescalado.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radiusAt: (t: number) => number,
  radialSegments = 8,
  closed = false,
): THREE.BufferGeometry {
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, 1, radialSegments, closed);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const center = new THREE.Vector3();
  const p = new THREE.Vector3();
  const ring = radialSegments + 1;
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, center);
    const r = radiusAt(t);
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j;
      p.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}
