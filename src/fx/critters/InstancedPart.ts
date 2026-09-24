import * as THREE from 'three';
import { inFrameView } from '../../render/frameView';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const tmpCenter = new THREE.Vector3();

/**
 * Folga (unidades) em volta da visão: bicho fora da tela mas perto da borda ainda
 * pode jogar sombra pra dentro dela (os que voam ficam alto, a sombra cai longe).
 */
const VIEW_MARGIN = 3;

export interface InstancedPartOptions {
  name: string;
  castShadow?: boolean;
  /** Fora do passe de AO (transparente, ou pequeno demais para valer o custo). */
  skipAO?: boolean;
  /** Cor por instância multiplicando a vertex color. */
  tinted?: boolean;
  /**
   * Três cores por instância (usar com `paletteClay`): a vertex color (r, g, b)
   * vira o PESO de cada cor. Uma geometria só serve todas as variantes da espécie.
   */
  palette?: boolean;
}

/**
 * Uma parte de bicho (corpo, asa direita, pata...) para TODOS os indivíduos de
 * uma espécie: um InstancedMesh só, um draw call. Cada indivíduo reserva uma
 * vaga e, a cada frame, escreve a matriz dela (ou esconde). Se ninguém
 * apareceu no frame, o draw call inteiro é desligado.
 *
 * As vagas guardam matriz, cor e paleta; no `flush` só as vagas visíveis e na
 * visão da câmera vão para a GPU, uma atrás da outra (vaga escondida ou atrás
 * da câmera não custa vértice em nenhum passe).
 */
export class InstancedPart {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private allocated = 0;
  private shown = 0;
  /** Alguma vaga mudou desde o último envio para a GPU. */
  private dirty = true;
  private readonly matrices: Float32Array;
  /** Esfera de cada vaga no mundo: centro xyz + raio (raio 0 = escondida). */
  private readonly spheres: Float32Array;
  private readonly localCenter: THREE.Vector3;
  private readonly localRadius: number;
  private colors: Float32Array | null = null;
  private readonly paletteSource: [Float32Array, Float32Array, Float32Array] | null = null;
  private readonly palette: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute] | null = null;
  /** Vaga que está em cada posição do buffer enviado (para não reenviar à toa). */
  private readonly packed: Int32Array;
  private packedCount = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, options: InstancedPartOptions) {
    this.capacity = Math.max(1, capacity);
    let geo = geometry;
    if (options.palette) {
      // Os atributos de paleta são por malha: clona para duas partes nunca dividirem o mesmo buffer.
      geo = geometry.clone();
      const make = (name: string) => {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
        attr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(name, attr);
        return attr;
      };
      this.palette = [make('aPaletteA'), make('aPaletteB'), make('aPaletteC')];
      this.paletteSource = [0, 1, 2].map(() => new Float32Array(this.capacity * 3).fill(1)) as [Float32Array, Float32Array, Float32Array];
    }
    this.mesh = new THREE.InstancedMesh(geo, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // O que desenhar é escolhido aqui (vaga a vaga), não pela esfera da malha inteira.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = options.castShadow ?? true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.skipAO = options.skipAO ?? false;
    this.mesh.name = options.name;
    this.matrices = new Float32Array(this.capacity * 16);
    this.spheres = new Float32Array(this.capacity * 4);
    this.packed = new Int32Array(this.capacity);
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    this.localCenter = geo.boundingSphere!.center.clone();
    this.localRadius = geo.boundingSphere!.radius;
    if (options.tinted) this.ensureColors();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Reserva uma vaga (índice da instância). */
  allocate(): number {
    if (this.allocated >= this.capacity) throw new Error(`InstancedPart "${this.mesh.name}" lotou (${this.capacity})`);
    return this.allocated++;
  }

  set(slot: number, matrix: THREE.Matrix4): void {
    this.write(slot, matrix);
    this.shown++;
  }

  /**
   * Instância parada (teia, orvalho): a matriz escrita antes continua valendo,
   * só conta como visível neste frame — sem reenviar nada para a GPU.
   */
  keep(): void {
    this.shown++;
  }

  hide(slot: number): void {
    this.write(slot, HIDDEN);
  }

  setColor(slot: number, color: THREE.Color): void {
    this.ensureColors();
    color.toArray(this.colors!, slot * 3);
    this.dirty = true;
  }

  /** As três cores da paleta desta instância (peso r, g, b da vertex color). */
  setPalette(slot: number, a: THREE.Color, b: THREE.Color, c: THREE.Color): void {
    if (!this.paletteSource) return;
    a.toArray(this.paletteSource[0], slot * 3);
    b.toArray(this.paletteSource[1], slot * 3);
    c.toArray(this.paletteSource[2], slot * 3);
    this.dirty = true;
  }

  /**
   * Fim do frame: junta as vagas visíveis e na visão, sobe o que mudou e
   * desliga o draw call se nenhuma instância apareceu.
   */
  flush(): void {
    const shown = this.shown;
    this.shown = 0;
    if (shown === 0) {
      this.mesh.visible = false;
      return;
    }
    let n = 0;
    let same = true;
    for (let slot = 0; slot < this.allocated; slot++) {
      const s = slot * 4;
      const radius = this.spheres[s + 3];
      if (radius <= 0 || !inFrameView(this.spheres[s], this.spheres[s + 1], this.spheres[s + 2], radius, VIEW_MARGIN)) continue;
      if (n >= this.packedCount || this.packed[n] !== slot) same = false;
      this.packed[n++] = slot;
    }
    if (n !== this.packedCount) same = false;
    this.packedCount = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0 || (same && !this.dirty)) return;
    this.dirty = false;
    this.upload(n);
  }

  private write(slot: number, matrix: THREE.Matrix4): void {
    matrix.toArray(this.matrices, slot * 16);
    const s = slot * 4;
    tmpCenter.copy(this.localCenter).applyMatrix4(matrix);
    this.spheres[s] = tmpCenter.x;
    this.spheres[s + 1] = tmpCenter.y;
    this.spheres[s + 2] = tmpCenter.z;
    this.spheres[s + 3] = this.localRadius * matrix.getMaxScaleOnAxis();
    this.dirty = true;
  }

  private ensureColors(): void {
    if (this.colors) return;
    this.colors = new Float32Array(this.capacity * 3).fill(1);
    // Cria o atributo de cor do tamanho da capacidade (o shader passa a usar cor por instância).
    this.mesh.setColorAt(0, WHITE);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  /** Copia as `n` vagas escolhidas para os buffers da GPU (só o trecho usado sobe). */
  private upload(n: number): void {
    const matrixOut = this.mesh.instanceMatrix.array as Float32Array;
    const colorOut = this.colors ? (this.mesh.instanceColor!.array as Float32Array) : null;
    for (let i = 0; i < n; i++) {
      const slot = this.packed[i];
      matrixOut.set(this.matrices.subarray(slot * 16, slot * 16 + 16), i * 16);
      if (colorOut) colorOut.set(this.colors!.subarray(slot * 3, slot * 3 + 3), i * 3);
      if (this.palette) {
        for (let k = 0; k < 3; k++) (this.palette[k].array as Float32Array).set(this.paletteSource![k].subarray(slot * 3, slot * 3 + 3), i * 3);
      }
    }
    markRange(this.mesh.instanceMatrix, n * 16);
    if (this.mesh.instanceColor && colorOut) markRange(this.mesh.instanceColor, n * 3);
    if (this.palette) for (const attr of this.palette) markRange(attr, n * 3);
  }
}

function markRange(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}
