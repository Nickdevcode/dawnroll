import type * as THREE from 'three';

/**
 * Liga/desliga a sombra que as malhas de `root` projetam sem esquecer o que
 * cada uma fazia (guardado em `userData.castShadowDefault`): desligar tira do
 * passe de sombra, ligar devolve exatamente como era.
 */
export function setCastShadows(root: THREE.Object3D, on: boolean): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.castShadowDefault === undefined) mesh.userData.castShadowDefault = mesh.castShadow;
    mesh.castShadow = on && mesh.userData.castShadowDefault === true;
  });
}
