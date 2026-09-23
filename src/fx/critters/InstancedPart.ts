import * as THREE from 'three';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

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
 */
export class InstancedPart {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private allocated = 0;
  private shown = 0;
  /** Alguma matriz mudou desde o último envio para a GPU. */
  private dirty = true;
  private readonly palette: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute] | null = null;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, options: InstancedPartOptions) {
    this.capacity = Math.max(1, capacity);
    let geo = geometry;
    if (options.palette) {
      // Os atributos de paleta são por malha: clona para duas partes nunca dividirem o mesmo buffer.
      geo = geometry.clone();
      const make = (name: string) => {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
        geo.setAttribute(name, attr);
        return attr;
      };
      this.palette = [make('aPaletteA'), make('aPaletteB'), make('aPaletteC')];
    }
    this.mesh = new THREE.InstancedMesh(geo, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Tudo se mexe e fica perto do jogador: culling por esfera não compensa.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = options.castShadow ?? true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.skipAO = options.skipAO ?? false;
    this.mesh.name = options.name;
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      if (options.tinted) this.mesh.setColorAt(i, WHITE);
    }
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Reserva uma vaga (índice da instância). */
  allocate(): number {
    if (this.allocated >= this.capacity) throw new Error(`InstancedPart "${this.mesh.name}" lotou (${this.capacity})`);
    const slot = this.allocated++;
    this.mesh.count = this.allocated;
    return slot;
  }

  set(slot: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(slot, matrix);
    this.shown++;
    this.dirty = true;
  }

  /**
   * Instância parada (teia, orvalho): a matriz escrita antes continua valendo,
   * só conta como visível neste frame — sem reenviar nada para a GPU.
   */
  keep(): void {
    this.shown++;
  }

  hide(slot: number): void {
    this.mesh.setMatrixAt(slot, HIDDEN);
    this.dirty = true;
  }

  setColor(slot: number, color: THREE.Color): void {
    this.mesh.setColorAt(slot, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** As três cores da paleta desta instância (peso r, g, b da vertex color). */
  setPalette(slot: number, a: THREE.Color, b: THREE.Color, c: THREE.Color): void {
    if (!this.palette) return;
    const colors = [a, b, c];
    for (let k = 0; k < 3; k++) {
      this.palette[k].setXYZ(slot, colors[k].r, colors[k].g, colors[k].b);
      this.palette[k].needsUpdate = true;
    }
  }

  /** Fim do frame: sobe as matrizes (se mudaram) e desliga o draw call se nenhuma instância apareceu. */
  flush(): void {
    if (this.dirty) this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
    this.mesh.visible = this.shown > 0;
    this.shown = 0;
  }
}
