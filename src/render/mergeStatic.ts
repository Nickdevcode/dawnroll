import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Atributos que a fusão sempre trata (os outros são descartados, a não ser que alguma peça tenha). */
const KNOWN_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'color']);

/**
 * Funde os Meshes FILHOS DIRETOS de um grupo que usam o mesmo material num Mesh só
 * (as transformações locais são assadas na geometria). Grupos filhos ficam como
 * estão — é assim que as partes animadas (junta, pálpebra, antena) continuam
 * independentes enquanto os enfeites presos nelas (espinhos, pelos, dentes) viram
 * um único draw call.
 *
 * Aplique de baixo para cima (folhas da hierarquia primeiro) ou use `mergeStaticTree`.
 */
export function mergeStaticChildren(group: THREE.Object3D): void {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || mesh.children.length > 0 || Array.isArray(mesh.material) || mesh.userData.keep) continue;
    const material = mesh.material as THREE.Material;
    let list = buckets.get(material);
    if (!list) buckets.set(material, (list = []));
    list.push(mesh);
  }

  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const needsColor = (material as THREE.MeshStandardMaterial).vertexColors === true;
    // Atributos próprios (ex.: `skinPos` do casco) passam junto se alguma peça tiver.
    const extras = new Map<string, number>();
    for (const mesh of meshes) {
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        if (!KNOWN_ATTRIBUTES.has(name)) extras.set(name, attribute.itemSize);
      }
    }
    const parts = meshes.map((mesh) => {
      mesh.updateMatrix();
      const g = mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) {
        if (!KNOWN_ATTRIBUTES.has(name) && !extras.has(name)) g.deleteAttribute(name);
      }
      const count = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      if (needsColor && !g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      if (!needsColor && g.getAttribute('color')) g.deleteAttribute('color');
      for (const [name, size] of extras) {
        if (!g.getAttribute(name)) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * size), size));
      }
      if (!g.index) g.setIndex(Array.from({ length: count }, (_, i) => i));
      g.applyMatrix4(mesh.matrix);
      return g;
    });
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) continue;
    const fused = new THREE.Mesh(merged, material);
    fused.castShadow = meshes.some((m) => m.castShadow);
    fused.receiveShadow = meshes.some((m) => m.receiveShadow);
    fused.name = `${group.name || 'group'}-fused`;
    for (const m of meshes) group.remove(m);
    group.add(fused);
  }
}

/** Aplica `mergeStaticChildren` em todos os grupos da árvore, das folhas para a raiz. */
export function mergeStaticTree(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) groups.push(o);
  });
  for (let i = groups.length - 1; i >= 0; i--) mergeStaticChildren(groups[i]);
}
