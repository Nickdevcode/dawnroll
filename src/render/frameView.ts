import * as THREE from 'three';

/**
 * Visão da câmera no quadro atual, para quem instancia coisas pelo mapa inteiro
 * (montinhos, detritos, bichos) escolher o que vale mandar para a GPU. O jogo
 * atualiza uma vez por quadro, logo depois de posicionar a câmera; antes da
 * primeira atualização tudo conta como visível.
 */
const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const sphere = new THREE.Sphere();
let ready = false;

export function updateFrameView(camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  ready = true;
}

/**
 * Sem visão: tudo conta como visível. É o que o menu usa — lá tudo é desenhado
 * (e cada shader compila) antes de o jogo começar, sem engasgo no primeiro olhar.
 */
export function clearFrameView(): void {
  ready = false;
}

/**
 * A esfera (centro + raio) encosta na visão, com `margin` de folga: coisa fora
 * da tela mas perto da borda ainda pode jogar sombra pra dentro dela.
 */
export function inFrameView(x: number, y: number, z: number, radius: number, margin: number): boolean {
  if (!ready) return true;
  sphere.center.set(x, y, z);
  sphere.radius = radius + margin;
  return frustum.intersectsSphere(sphere);
}
