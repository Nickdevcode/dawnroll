import * as THREE from 'three';
import { hasBatchedProgram, SharedBatch } from './BatchedPool';

interface Batch {
  shared: SharedBatch;
  /** Modelos no lote e quantos objetos usam cada um (sai do lote quando ninguém mais usa). */
  geometries: Map<string, { id: number; refs: number }>;
}

interface Entry {
  batch: Batch;
  instance: number;
  geometry: string;
}

/**
 * Objetos soltos, cada um com o próprio modelo (a tralha grudada na bola),
 * desenhados em lotes por material: o objeto continua existindo (é ele que
 * guarda a pose), mas fica invisível e vira uma instância do lote do material
 * dele. Uma bola com 90 coisas grudadas saía em 90 desenhos por passe (cena,
 * sombra e oclusão); em lote, em um por material.
 *
 * Os lotes são filhos de `parent`: a pose de cada objeto é a local dele, no
 * mesmo espaço (os objetos precisam ser filhos diretos de `parent`).
 */
export class ObjectBatches {
  private readonly batches = new Map<string, Batch>();
  private readonly entries = new Map<THREE.Object3D, Entry>();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly name: string,
  ) {}

  /**
   * Põe o objeto num lote (ele some e a instância aparece no lugar). Devolve
   * false quando ele não cabe em lote nenhum (grupo, transparente, animado,
   * material que nunca foi desenhado em lote): aí ele continua sendo desenhado
   * sozinho, como antes. O último caso evita compilar shader no meio do jogo.
   */
  add(object: THREE.Object3D): boolean {
    const mesh = object as THREE.Mesh;
    if (this.entries.has(object) || !batchable(mesh) || !hasBatchedProgram(mesh.material as THREE.Material)) return false;
    const material = mesh.material as THREE.Material;
    const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${signature(mesh.geometry)}`;
    let batch = this.batches.get(key);
    if (!batch) {
      const shared = new SharedBatch(material, mesh.castShadow, this.name);
      shared.mesh.receiveShadow = mesh.receiveShadow;
      batch = { shared, geometries: new Map() };
      this.batches.set(key, batch);
      this.parent.add(shared.mesh);
    }
    const geometryKey = mesh.geometry.uuid;
    let geometry = batch.geometries.get(geometryKey);
    if (!geometry) {
      geometry = { id: batch.shared.addGeometry(mesh.geometry), refs: 0 };
      batch.geometries.set(geometryKey, geometry);
    }
    geometry.refs++;
    const instance = batch.shared.addInstance(geometry.id);
    mesh.updateMatrix();
    batch.shared.mesh.setMatrixAt(instance, mesh.matrix);
    mesh.visible = false;
    this.entries.set(object, { batch, instance, geometry: geometryKey });
    return true;
  }

  /** A pose do objeto mudou (ele está voando até a bola): a instância acompanha. */
  sync(object: THREE.Object3D): void {
    const entry = this.entries.get(object);
    if (!entry) return;
    object.updateMatrix();
    entry.batch.shared.mesh.setMatrixAt(entry.instance, object.matrix);
  }

  /** Tira o objeto do lote e devolve a visibilidade dele (ele pode ser desenhado sozinho de novo). */
  remove(object: THREE.Object3D): void {
    const entry = this.entries.get(object);
    if (!entry) return;
    this.entries.delete(object);
    const { batch } = entry;
    batch.shared.mesh.deleteInstance(entry.instance);
    const geometry = batch.geometries.get(entry.geometry)!;
    if (--geometry.refs === 0) {
      batch.shared.removeGeometry(geometry.id);
      batch.geometries.delete(entry.geometry);
    }
    object.visible = true;
  }

  clear(): void {
    for (const object of [...this.entries.keys()]) this.remove(object);
  }

  /** Libera os lotes (buffers e texturas de instância na GPU). Os materiais são de quem criou os objetos. */
  dispose(): void {
    this.clear();
    for (const batch of this.batches.values()) {
      batch.shared.mesh.removeFromParent();
      batch.shared.mesh.dispose();
    }
    this.batches.clear();
  }
}

/** Dá pra desenhar em lote: um Mesh simples, opaco, de material padrão do three, sem animação de vértice. */
function batchable(mesh: THREE.Mesh): boolean {
  if (!mesh.isMesh || mesh.children.length > 0 || mesh.userData.noBatch) return false;
  const kind = mesh as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
  if (kind.isInstancedMesh || kind.isSkinnedMesh || kind.isBatchedMesh) return false;
  const material = mesh.material;
  if (Array.isArray(material) || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial || material.transparent) return false;
  const geometry = mesh.geometry;
  if (!geometry.getAttribute('position') || !geometry.getAttribute('normal')) return false;
  return Object.keys(geometry.morphAttributes).length === 0 && geometry.groups.length <= 1;
}

/** Atributos (nome, tamanho, tipo) e índice: só modelos com o mesmo formato dividem um lote. */
function signature(geometry: THREE.BufferGeometry): string {
  return Object.keys(geometry.attributes)
    .sort()
    .map((name) => {
      const a = geometry.getAttribute(name) as THREE.BufferAttribute;
      return `${name}:${a.itemSize}:${a.normalized ? 'n' : ''}:${a.array.constructor.name}`;
    })
    .join(',');
}
