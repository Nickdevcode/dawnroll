import * as THREE from 'three';
import { SharedBatch } from './BatchedPool';

const tmpInverse = new THREE.Matrix4();
const tmpMatrix = new THREE.Matrix4();

interface Part {
  object: THREE.Mesh;
  instance: number;
}

/**
 * Peças articuladas do mesmo material (as patas do besouro: coxa, fêmur,
 * joelho e tarso de seis patas, cada uma pendurada numa junta diferente)
 * desenhadas num lote só. As peças continuam na hierarquia (a animação mexe
 * nelas como sempre), só que invisíveis; na hora de desenhar, cada passe
 * (sombra, cena, oclusão) copia a pose de mundo delas pro lote. Eram 24
 * desenhos por passe, vira 1.
 */
export class RigBatch {
  private readonly batch: SharedBatch;
  private readonly parts: Part[] = [];
  /** Último quadro do renderizador em que as poses foram copiadas (cada `render` conta um). */
  private syncedFrame = -1;

  constructor(
    private readonly root: THREE.Object3D,
    meshes: readonly THREE.Mesh[],
    name: string,
  ) {
    const material = meshes[0].material as THREE.Material;
    this.batch = new SharedBatch(material, meshes.some((m) => m.castShadow), name);
    const mesh = this.batch.mesh;
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    const geometries = new Map<THREE.BufferGeometry, number>();
    for (const object of meshes) {
      let geometryId = geometries.get(object.geometry);
      if (geometryId === undefined) {
        geometryId = this.batch.addGeometry(object.geometry);
        geometries.set(object.geometry, geometryId);
      }
      this.parts.push({ object, instance: this.batch.addInstance(geometryId) });
      object.visible = false;
    }
    root.add(mesh);

    // A pose é copiada antes de cada passe (o da sombra vem antes da cena, no mesmo quadro).
    const beforeRender = mesh.onBeforeRender.bind(mesh);
    const beforeShadow = mesh.onBeforeShadow.bind(mesh);
    mesh.onBeforeRender = (renderer, ...rest) => {
      this.sync(renderer);
      beforeRender(renderer, ...rest);
    };
    mesh.onBeforeShadow = (renderer, ...rest) => {
      this.sync(renderer);
      beforeShadow(renderer, ...rest);
    };
  }

  /** O lote (sombra, nome): as peças originais ficam invisíveis. */
  get mesh(): THREE.BatchedMesh {
    return this.batch.mesh;
  }

  private sync(renderer: THREE.WebGLRenderer): void {
    const frame = renderer.info.render.frame;
    if (frame === this.syncedFrame) return;
    this.syncedFrame = frame;
    // Espaço do lote = o da raiz: pose de cada peça relativa a ela.
    tmpInverse.copy(this.root.matrixWorld).invert();
    for (const part of this.parts) {
      this.batch.mesh.setMatrixAt(part.instance, tmpMatrix.multiplyMatrices(tmpInverse, part.object.matrixWorld));
    }
  }
}
