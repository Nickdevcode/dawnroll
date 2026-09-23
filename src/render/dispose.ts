import * as THREE from 'three';

/**
 * Libera a GPU de algo que saiu de cena e foi trocado por um substituto (os
 * bichos de um jardim pelos do jardim novo). Geometria e material que o
 * substituto também usa (caches de modelo, materiais do `clay`) ficam; o resto
 * é descartado. Chamar só depois que o substituto já foi desenhado uma vez: aí
 * os programas de shader já estão com ele e nada recompila.
 */
export function disposeReplaced(old: THREE.Object3D, replacement: THREE.Object3D): void {
  const keepGeometry = new Set<THREE.BufferGeometry>();
  const keepMaterial = new Set<THREE.Material>();
  replacement.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.geometry) return;
    keepGeometry.add(mesh.geometry);
    for (const material of materialsOf(mesh)) keepMaterial.add(material);
  });
  const disposed = new Set<object>();
  old.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.geometry) return;
    if (!keepGeometry.has(mesh.geometry) && !disposed.has(mesh.geometry)) {
      disposed.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    for (const material of materialsOf(mesh)) {
      if (keepMaterial.has(material) || disposed.has(material)) continue;
      disposed.add(material);
      material.dispose();
    }
    // Instâncias (matrizes e cores) moram na malha, não na geometria.
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
  });
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
