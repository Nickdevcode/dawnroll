import * as THREE from 'three';

/** Tamanhos iniciais de um lote (crescem dobrando quando lotam). */
const START_INSTANCES = 64;
const START_VERTICES = 16384;
const START_INDICES = 49152;

/**
 * Materiais que já têm lote na cena (o programa "em lote" deles já compilou no
 * aquecimento da abertura). Quem quiser lotear no meio do jogo sem engasgar de
 * compilação só lota esses.
 */
const batchedMaterials = new WeakSet<THREE.Material>();

export function hasBatchedProgram(material: THREE.Material): boolean {
  return batchedMaterials.has(material);
}

/**
 * Um lote compartilhado (BatchedMesh) por material: dezenas de modelos
 * diferentes que usam o mesmo material saem num desenho só por passe (cena,
 * sombra e oclusão), cada objeto recortado pela câmera daquele passe. É o
 * InstancedMesh "de vários modelos": a tralha do chão tinha um desenho por
 * variante (53 na cena, 49 na sombra, 53 no AO) e passa a ter um por material.
 */
export class SharedBatch {
  readonly mesh: THREE.BatchedMesh;
  /** Algum modelo saiu desde a última compactação (tem buraco no buffer). */
  private freed = false;

  constructor(material: THREE.Material, castShadow: boolean, name: string) {
    this.mesh = new THREE.BatchedMesh(START_INSTANCES, START_VERTICES, START_INDICES, material);
    // Cada objeto é testado contra a câmera de cada passe (a da sombra inclusive); o lote inteiro nunca é descartado.
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.frustumCulled = false;
    // Coisa pequena e opaca: ordenar de frente pra trás custaria mais CPU do que economiza de GPU.
    this.mesh.sortObjects = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.name = name;
    batchedMaterials.add(material);
    // Cor por instância muda o programa do shader: o lote já nasce com ela (todas brancas),
    // pra primeira peça tingida do meio da partida não recompilar nada.
    (this.mesh as unknown as { _initColorsTexture(): void })._initColorsTexture();
  }

  /** Registra um modelo no lote (compacta ou cresce o buffer se precisar); devolve o id da geometria. */
  addGeometry(geometry: THREE.BufferGeometry): number {
    const source = geometry.index ? geometry : withSequentialIndex(geometry);
    const vertices = source.getAttribute('position').count;
    const indices = source.index!.count;
    this.reserve(vertices, indices);
    const id = this.mesh.addGeometry(source);
    if (source !== geometry) source.dispose();
    return id;
  }

  /** Tira um modelo (e as instâncias dele) do lote. O espaço volta no próximo `reserve` que precisar. */
  removeGeometry(geometryId: number): void {
    this.mesh.deleteGeometry(geometryId);
    this.freed = true;
  }

  /** Garante espaço pra mais um modelo: primeiro junta os buracos dos que saíram; se não der, dobra. */
  private reserve(vertices: number, indices: number): void {
    const mesh = this.mesh;
    if (vertices <= mesh.unusedVertexCount && indices <= mesh.unusedIndexCount) return;
    if (this.freed) {
      mesh.optimize();
      this.freed = false;
      if (vertices <= mesh.unusedVertexCount && indices <= mesh.unusedIndexCount) return;
    }
    const internal = mesh as unknown as { _maxVertexCount: number; _maxIndexCount: number; _nextVertexStart: number; _nextIndexStart: number };
    const maxVertices = Math.max(internal._maxVertexCount * 2, internal._nextVertexStart + vertices);
    const maxIndices = Math.max(internal._maxIndexCount * 2, internal._nextIndexStart + indices);
    mesh.setGeometrySize(maxVertices, maxIndices);
  }

  addInstance(geometryId: number): number {
    const mesh = this.mesh;
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    return mesh.addInstance(geometryId);
  }
}

/** Cópia com índice 0..n-1 (o lote exige que todo modelo tenha índice, ou nenhum). */
function withSequentialIndex(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geometry.clone();
  const count = copy.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  copy.setIndex(new THREE.BufferAttribute(index, 1));
  return copy;
}

/**
 * As vagas de UM modelo dentro de um lote compartilhado, com a mesma cara do
 * `InstancePool` (pôr, mover, tingir, esconder, tirar). O teto de vagas por
 * modelo continua existindo: lotou, quem pediu desenha o objeto como Mesh comum.
 */
export class BatchedPool {
  private readonly geometryId: number;
  private used = 0;

  constructor(
    private readonly batch: SharedBatch,
    geometry: THREE.BufferGeometry,
    private readonly capacity: number,
  ) {
    this.geometryId = batch.addGeometry(geometry);
  }

  /** O lote inteiro (sombra, nome): é dividido com os outros modelos do mesmo material. */
  get mesh(): THREE.BatchedMesh {
    return this.batch.mesh;
  }

  get isFull(): boolean {
    return this.used >= this.capacity;
  }

  /** Ocupa uma vaga; devolve o id da instância (ou -1 se lotou). */
  add(matrix: THREE.Matrix4): number {
    if (this.isFull) return -1;
    const id = this.batch.addInstance(this.geometryId);
    this.batch.mesh.setMatrixAt(id, matrix);
    this.used++;
    return id;
  }

  set(id: number, matrix: THREE.Matrix4): void {
    this.batch.mesh.setMatrixAt(id, matrix);
  }

  /** Tinge uma vaga (multiplica a cor do material/vértices; acima de 1 clareia). */
  setColor(id: number, color: THREE.Color): void {
    this.batch.mesh.setColorAt(id, color);
  }

  /** Esconde sem liberar a vaga. */
  hide(id: number): void {
    this.batch.mesh.setVisibleAt(id, false);
  }

  remove(id: number): void {
    this.batch.mesh.deleteInstance(id);
    this.used--;
  }
}
