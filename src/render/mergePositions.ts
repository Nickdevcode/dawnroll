import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Maior valor (já multiplicado) que cabe na chave inteira de 32 bits. */
const INT_LIMIT = 2 ** 31 - 1;

/**
 * O `mergeVertices` do three para o caso que o jogo usa toda hora (geometria só
 * com posição, sem morph): o mesmo resultado, bit a bit — mesma ordem de vértices,
 * mesmos valores, mesmo índice —, só que com a chave em inteiros numa tabela
 * hash em vez de texto. Montar um jardim deforma centenas de peças de massinha e
 * a versão do three (uma string por vértice) era o que mais pesava na montagem.
 *
 * Qualquer coisa fora desse caso (outros atributos, morph, valor enorme) cai na
 * versão do three, pra nunca dar um resultado diferente.
 */
export function mergePositions(geometry: THREE.BufferGeometry, tolerance = 1e-4): THREE.BufferGeometry {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const names = Object.keys(geometry.attributes);
  if (
    !positions ||
    names.length !== 1 ||
    positions.itemSize !== 3 ||
    positions.normalized ||
    Object.keys(geometry.morphAttributes).length > 0 ||
    (positions as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute
  ) {
    return mergeVertices(geometry, tolerance);
  }

  // A mesma conta de arredondamento do three (truncar valor × 10^casas + meia tolerância).
  tolerance = Math.max(tolerance, Number.EPSILON);
  const halfTolerance = tolerance * 0.5;
  const exponent = Math.log10(1 / tolerance);
  const hashMultiplier = Math.pow(10, exponent);
  const hashAdditive = halfTolerance * hashMultiplier;

  const indices = geometry.getIndex();
  const indexArray = indices ? indices.array : null;
  const vertexCount = indices ? indices.count : positions.count;
  // Atributo simples (sem intercalar, sem normalizar): ler o array direto é o mesmo que getX/getY/getZ.
  const source = positions.array;
  const count = positions.count;
  const keys = new Int32Array(count * 3);
  // Chave de cada vértice da origem (calculada uma vez por vértice, não por referência).
  for (let c = 0; c < count * 3; c++) {
    const value = Math.trunc(source[c] * hashMultiplier + hashAdditive);
    // Fora do inteiro de 32 bits (ou NaN, que o three trata como chave própria): versão do three.
    if (!(value <= INT_LIMIT && value >= -INT_LIMIT)) return mergeVertices(geometry, tolerance);
    keys[c] = value;
  }

  // Endereçamento aberto: cada vaga guarda o índice novo + 1 (0 = vazia).
  let capacity = 1;
  while (capacity < vertexCount * 2) capacity <<= 1;
  const mask = capacity - 1;
  const slots = new Int32Array(capacity);
  const slotKeys = new Int32Array(capacity * 3);

  const out = new (source.constructor as Float32ArrayConstructor)(count * 3);
  const newIndices: number[] = new Array(vertexCount);
  let next = 0;
  for (let i = 0; i < vertexCount; i++) {
    const index = indexArray ? indexArray[i] : i;
    const x = keys[index * 3];
    const y = keys[index * 3 + 1];
    const z = keys[index * 3 + 2];
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d)) & mask;
    for (;;) {
      const slot = slots[h];
      if (slot === 0) {
        // Primeira vez: vértice novo, com os valores deste (como o three faz).
        slots[h] = next + 1;
        slotKeys[h * 3] = x;
        slotKeys[h * 3 + 1] = y;
        slotKeys[h * 3 + 2] = z;
        out[next * 3] = source[index * 3];
        out[next * 3 + 1] = source[index * 3 + 1];
        out[next * 3 + 2] = source[index * 3 + 2];
        newIndices[i] = next;
        next++;
        break;
      }
      if (slotKeys[h * 3] === x && slotKeys[h * 3 + 1] === y && slotKeys[h * 3 + 2] === z) {
        newIndices[i] = slot - 1;
        break;
      }
      h = (h + 1) & mask;
    }
  }

  const result = geometry.clone();
  result.setAttribute('position', new (positions.constructor as typeof THREE.BufferAttribute)(out.slice(0, next * 3), 3, positions.normalized));
  result.setIndex(newIndices);
  return result;
}
