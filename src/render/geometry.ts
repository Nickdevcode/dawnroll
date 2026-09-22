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
  const uv = geometry.getAttribute('uv');
  // Guarda a UV num atributo à parte: mergeVertices só funde vértices idênticos em TODOS os atributos.
  const withoutUv = geometry.clone();
  withoutUv.deleteAttribute('uv');
  withoutUv.deleteAttribute('normal');
  const merged = mergeVertices(withoutUv, 1e-4);
  merged.computeVertexNormals();

  const pos = merged.getAttribute('position') as THREE.BufferAttribute;
  const nor = merged.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * frequency + seed, y * frequency + seed * 0.7, z * frequency - seed) * amount;
    pos.setXYZ(i, x + nor.getX(i) * n, y + nor.getY(i) * n, z + nor.getZ(i) * n);
  }
  merged.computeVertexNormals();

  // UV esférica simples; basta para o normal map de massinha (que é isotrópico).
  if (uv) {
    const uvs = new Float32Array(pos.count * 2);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).normalize();
      uvs[i * 2] = 0.5 + Math.atan2(tmp.z, tmp.x) / (Math.PI * 2);
      uvs[i * 2 + 1] = 0.5 + Math.asin(THREE.MathUtils.clamp(tmp.y, -1, 1)) / Math.PI;
    }
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  geometry.dispose();
  withoutUv.dispose();
  return merged;
}

/** Esfera "de massinha" já deformada. */
export function claySphere(radius: number, detail = 3, lump = 0.06, frequency = 2.2, seed = 0): THREE.BufferGeometry {
  return lumpify(new THREE.IcosahedronGeometry(radius, detail), radius * lump, frequency / radius, seed);
}

/** Cápsula com as pontas levemente amassadas. */
export function clayCapsule(radius: number, length: number, lump = 0.05, seed = 0): THREE.BufferGeometry {
  return lumpify(new THREE.CapsuleGeometry(radius, length, 6, 12), radius * lump, 3 / radius, seed);
}
