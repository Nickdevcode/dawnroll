import * as THREE from 'three';

/**
 * Malha com uma cadeia de "ossos": cada vértice segue os dois ossos mais perto
 * dele (peso linear pela posição ao longo da cadeia), então pano dobra suave —
 * capa, ponta de cachecol, bandeirinha. O skinning roda na GPU e vale em todos
 * os passes (sombra, oclusão, contorno), ao contrário de deformar no shader.
 */
export interface Chain {
  readonly mesh: THREE.SkinnedMesh;
  /** Do primeiro (preso) ao último (a ponta). */
  readonly bones: THREE.Bone[];
}

/**
 * `joints` = onde fica cada osso (no espaço da geometria), em ordem. `along`
 * diz em que ponto da cadeia (0 = primeiro osso, 1 = último) cada vértice fica
 * (pela posição ou pelo índice do vértice, pra quem guardou isso num atributo).
 */
export function chainSkin(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  joints: readonly THREE.Vector3[],
  along: (position: THREE.Vector3, index: number) => number,
): Chain {
  const bones: THREE.Bone[] = [];
  joints.forEach((joint, i) => {
    const bone = new THREE.Bone();
    if (i === 0) bone.position.copy(joint);
    else bone.position.subVectors(joint, joints[i - 1]);
    if (i > 0) bones[i - 1].add(bone);
    bones.push(bone);
  });

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const indices = new Uint16Array(pos.count * 4);
  const weights = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  const last = joints.length - 1;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const t = THREE.MathUtils.clamp(along(p, i), 0, 1) * last;
    const i0 = Math.min(Math.floor(t), last);
    const i1 = Math.min(i0 + 1, last);
    const w1 = t - i0;
    indices[i * 4] = i0;
    indices[i * 4 + 1] = i1;
    weights[i * 4] = 1 - w1;
    weights[i * 4 + 1] = w1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  // Os ossos levam a malha pra fora da caixa da pose de repouso: não recorta pela câmera.
  mesh.frustumCulled = false;
  // Animada: nunca entra na fusão de peças paradas.
  mesh.userData.keep = true;
  return { mesh, bones };
}

/**
 * Chapa com espessura a partir de uma superfície P(u, v) (u de -1 a 1 na
 * largura, v de 0 a 1 no comprimento): frente, verso e as bordas. A normal de
 * cada ponto sai das derivadas; `thickness` é a grossura total. O atributo `uv`
 * guarda o (u, v) de cada vértice (u já em 0..1), pra pintar e pesar os ossos.
 */
export function slab(surface: (u: number, v: number, target: THREE.Vector3) => THREE.Vector3, uSegments: number, vSegments: number, thickness: number): THREE.BufferGeometry {
  const cols = uSegments + 1;
  const rows = vSegments + 1;
  const top: THREE.Vector3[] = [];
  const bottom: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const n = new THREE.Vector3();
  const eps = 1e-3;
  for (let j = 0; j < rows; j++) {
    const v = j / vSegments;
    for (let i = 0; i < cols; i++) {
      const u = -1 + (2 * i) / uSegments;
      const p = surface(u, v, new THREE.Vector3());
      du.subVectors(surface(Math.min(u + eps, 1), v, a), surface(Math.max(u - eps, -1), v, b));
      dv.subVectors(surface(u, Math.min(v + eps, 1), a), surface(u, Math.max(v - eps, 0), b));
      n.crossVectors(dv, du).normalize();
      top.push(p.clone().addScaledVector(n, thickness / 2));
      bottom.push(p.clone().addScaledVector(n, -thickness / 2));
    }
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const push = (list: THREE.Vector3[]) => {
    const base = positions.length / 3;
    list.forEach((p, k) => {
      positions.push(p.x, p.y, p.z);
      uvs.push((k % cols) / uSegments, Math.floor(k / cols) / vSegments);
    });
    return base;
  };
  const t0 = push(top);
  const b0 = push(bottom);
  for (let j = 0; j < vSegments; j++) {
    for (let i = 0; i < uSegments; i++) {
      const k = j * cols + i;
      indices.push(t0 + k, t0 + k + cols, t0 + k + 1, t0 + k + 1, t0 + k + cols, t0 + k + cols + 1);
      indices.push(b0 + k, b0 + k + 1, b0 + k + cols, b0 + k + 1, b0 + k + cols + 1, b0 + k + cols);
    }
  }
  // Bordas: a volta inteira da chapa (em cima, embaixo e dos lados).
  const ring: number[] = [];
  for (let i = 0; i < cols; i++) ring.push(i);
  for (let j = 1; j < rows; j++) ring.push(j * cols + uSegments);
  for (let i = uSegments - 1; i >= 0; i--) ring.push(vSegments * cols + i);
  for (let j = vSegments - 1; j >= 1; j--) ring.push(j * cols);
  for (let r = 0; r < ring.length; r++) {
    const k = ring[r];
    const k2 = ring[(r + 1) % ring.length];
    indices.push(t0 + k, t0 + k2, b0 + k, t0 + k2, b0 + k2, b0 + k);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
