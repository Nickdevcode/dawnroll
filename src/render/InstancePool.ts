import * as THREE from 'three';
import { inFrameView } from './frameView';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpCenter = new THREE.Vector3();

/**
 * Folga (unidades) em volta da visão ao escolher quem é desenhado: coisa fora da
 * tela mas perto da borda ainda pode jogar sombra pra dentro dela (o sol é alto,
 * a sombra cai a menos de ~1 unidade do objeto).
 */
const SHADOW_MARGIN = 1.5;

/**
 * Vagas de instância num InstancedMesh: dá para "pôr" e "tirar" objetos sem
 * recriar nada. Serve para coisas espalhadas pelo mapa que de vez em quando
 * somem ou reaparecem (detritos, montinhos, moscas).
 *
 * As vagas guardam a matriz (e a cor) de cada objeto; a cada quadro, `sync`
 * copia para a GPU só as que estão na visão da câmera (com folga para sombra),
 * uma atrás da outra: o que está atrás da câmera não custa vértice nenhum em
 * nenhum passe (cena, sombra e oclusão).
 */
export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrices: Float32Array;
  /** Cor por vaga (criada no primeiro `setColor`; antes disso o material vale sozinho). */
  private colors: Float32Array | null = null;
  /** Esfera de cada vaga no mundo: centro xyz + raio (raio 0 = vaga escondida). */
  private readonly spheres: Float32Array;
  private readonly occupied: Uint8Array;
  private readonly localCenter: THREE.Vector3;
  private readonly localRadius: number;
  private highest = -1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instâncias espalhadas pelo mapa inteiro: quem escolhe o que desenhar é o `sync`.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.matrices = new Float32Array(capacity * 16);
    this.spheres = new Float32Array(capacity * 4);
    this.occupied = new Uint8Array(capacity);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.localCenter = geometry.boundingSphere!.center.clone();
    this.localRadius = geometry.boundingSphere!.radius;
  }

  get isFull(): boolean {
    return this.occupied.indexOf(0) === -1;
  }

  /** Ocupa uma vaga; devolve o índice (ou -1 se lotou). */
  add(matrix: THREE.Matrix4): number {
    const index = this.occupied.indexOf(0);
    if (index === -1) return -1;
    this.occupied[index] = 1;
    if (index > this.highest) this.highest = index;
    this.set(index, matrix);
    return index;
  }

  set(index: number, matrix: THREE.Matrix4): void {
    matrix.toArray(this.matrices, index * 16);
    const s = index * 4;
    tmpCenter.copy(this.localCenter).applyMatrix4(matrix);
    this.spheres[s] = tmpCenter.x;
    this.spheres[s + 1] = tmpCenter.y;
    this.spheres[s + 2] = tmpCenter.z;
    this.spheres[s + 3] = this.localRadius * matrix.getMaxScaleOnAxis();
  }

  /** Tinge uma vaga (multiplica a cor do material/vértices; valores acima de 1 clareiam). */
  setColor(index: number, color: THREE.Color): void {
    if (!this.colors) {
      this.colors = new Float32Array(this.occupied.length * 3).fill(1);
      // Cria o atributo de cor já do tamanho da capacidade (o shader passa a usar cor por instância).
      this.mesh.setColorAt(0, color);
    }
    color.toArray(this.colors, index * 3);
  }

  /** Esconde sem liberar a vaga (o dono vai voltar a usar). */
  hide(index: number): void {
    this.set(index, HIDDEN);
  }

  remove(index: number): void {
    this.hide(index);
    this.occupied[index] = 0;
    while (this.highest >= 0 && this.occupied[this.highest] === 0) this.highest--;
  }

  /**
   * Monta o que a GPU desenha neste quadro: as vagas ocupadas, visíveis e dentro
   * da visão da câmera (`frameView`), compactadas no começo do buffer.
   */
  sync(): void {
    const mesh = this.mesh;
    const out = mesh.instanceMatrix.array as Float32Array;
    const outColors = this.colors ? (mesh.instanceColor!.array as Float32Array) : null;
    let n = 0;
    for (let i = 0; i <= this.highest; i++) {
      const s = i * 4;
      const radius = this.spheres[s + 3];
      if (this.occupied[i] === 0 || radius <= 0) continue;
      if (!inFrameView(this.spheres[s], this.spheres[s + 1], this.spheres[s + 2], radius, SHADOW_MARGIN)) continue;
      out.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16);
      if (outColors) outColors.set(this.colors!.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    mesh.count = n;
    if (n === 0) return;
    // Sobe só o trecho usado (o resto do buffer não é desenhado).
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (outColors) {
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
  }
}
