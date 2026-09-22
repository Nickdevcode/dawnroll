import * as THREE from 'three';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Vagas de instância num InstancedMesh: dá para "pôr" e "tirar" objetos sem
 * recriar nada (vaga livre = matriz de escala zero). Serve para coisas paradas
 * que de vez em quando somem ou reaparecem (detritos, montinhos, moscas).
 *
 * Só desenha até a última vaga ocupada (`count`): vaga vazia no fim não custa
 * vértice nenhum. As vagas livres mais baixas são reaproveitadas primeiro, o que
 * mantém o bloco ocupado compacto.
 */
export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly occupied: Uint8Array;
  private highest = -1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instâncias espalhadas pelo mapa inteiro e se mexendo: culling por esfera não compensa.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.occupied = new Uint8Array(capacity);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.count = 0;
  }

  get isFull(): boolean {
    return this.occupied.indexOf(0) === -1;
  }

  /** Ocupa uma vaga; devolve o índice (ou -1 se lotou). */
  add(matrix: THREE.Matrix4): number {
    const index = this.occupied.indexOf(0);
    if (index === -1) return -1;
    this.occupied[index] = 1;
    if (index > this.highest) {
      this.highest = index;
      this.mesh.count = index + 1;
    }
    this.set(index, matrix);
    return index;
  }

  set(index: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Esconde sem liberar a vaga (o dono vai voltar a usar). */
  hide(index: number): void {
    this.set(index, HIDDEN);
  }

  remove(index: number): void {
    this.hide(index);
    this.occupied[index] = 0;
    while (this.highest >= 0 && this.occupied[this.highest] === 0) this.highest--;
    this.mesh.count = this.highest + 1;
  }
}
