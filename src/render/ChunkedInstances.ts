import * as THREE from 'three';
import { smoothstep, type Rng } from '../utils/math';

export interface InstanceSample {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export interface ChunkedInstancesOptions {
  name: string;
  /** Lado de cada pedaço (unidades de mundo). */
  chunkSize: number;
  /** Até essa distância da câmera desenha tudo. */
  lodNear: number;
  /** A partir dessa distância desenha só `lodMinFraction`. */
  lodFar: number;
  lodMinFraction: number;
  /** Além disso o pedaço some. */
  cullDistance: number;
  /** Folga vertical da esfera de culling (altura do objeto + balanço). */
  heightMargin: number;
  castShadow?: boolean;
  /** Fora do passe de AO (vertex shader animado que o AO não roda). */
  skipAO?: boolean;
}

interface Chunk {
  mesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  total: number;
}

/**
 * Milhares de instâncias estáticas repartidas em pedaços do mapa: cada pedaço é um
 * InstancedMesh com esfera de culling própria. As instâncias são embaralhadas em
 * cada pedaço, então qualquer prefixo é uma amostra uniforme — o LOD por distância
 * é só reduzir `count` (fica mais ralo, sem buraco).
 */
export class ChunkedInstances {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private density = 1;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    samples: InstanceSample[],
    rng: Rng,
    private readonly options: ChunkedInstancesOptions,
  ) {
    this.group.name = options.name;
    const { chunkSize } = options;
    const cells = new Map<string, InstanceSample[]>();
    for (const s of samples) {
      const key = `${Math.floor(s.matrix.elements[12] / chunkSize)},${Math.floor(s.matrix.elements[14] / chunkSize)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(s);
    }

    for (const list of cells.values()) {
      const n = list.length;
      // Fisher-Yates: o prefixo de qualquer tamanho fica espalhado pelo pedaço todo.
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      const mesh = new THREE.InstancedMesh(geometry, material, n);
      const box = new THREE.Box3();
      const point = new THREE.Vector3();
      list.forEach((s, i) => {
        mesh.setMatrixAt(i, s.matrix);
        if (s.color) mesh.setColorAt(i, s.color);
        box.expandByPoint(point.setFromMatrixPosition(s.matrix));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      center.y += options.heightMargin * 0.5;
      mesh.boundingSphere = new THREE.Sphere(center.clone(), size.length() / 2 + options.heightMargin);
      mesh.castShadow = options.castShadow ?? false;
      mesh.receiveShadow = true;
      mesh.userData.skipAO = options.skipAO ?? false;
      mesh.name = `${options.name}-chunk`;
      this.group.add(mesh);
      this.chunks.push({ mesh, center, total: n });
    }
  }

  /**
   * Libera as instâncias (matrizes e cores na GPU). A geometria e o material são
   * de quem criou (e costumam continuar em uso por outro plantio).
   */
  dispose(): void {
    this.group.removeFromParent();
    for (const chunk of this.chunks) chunk.mesh.dispose();
    this.chunks.length = 0;
  }

  /** Fração desenhada (qualidade adaptativa). */
  setDensity(density: number): void {
    this.density = THREE.MathUtils.clamp(density, 0.05, 1);
  }

  update(cameraPosition: THREE.Vector3): void {
    const { lodNear, lodFar, lodMinFraction, cullDistance } = this.options;
    for (const chunk of this.chunks) {
      const d = Math.hypot(chunk.center.x - cameraPosition.x, chunk.center.z - cameraPosition.z);
      if (d > cullDistance) {
        chunk.mesh.visible = false;
        continue;
      }
      chunk.mesh.visible = true;
      const lod = THREE.MathUtils.lerp(1, lodMinFraction, smoothstep(lodNear, lodFar, d));
      chunk.mesh.count = Math.max(1, Math.floor(chunk.total * lod * this.density));
    }
  }
}
