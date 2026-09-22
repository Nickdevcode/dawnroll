import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
    const parts = meshes.map((mesh) => {
      mesh.updateMatrix();
      const g = mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
      }
      const count = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      if (needsColor && !g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      if (!needsColor && g.getAttribute('color')) g.deleteAttribute('color');
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
