import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay, type ClayOptions } from './clayMaterial';

/**
 * "Acabamento" da superfície de uma peça de cenário. Cada perfil vira UM material
 * compartilhado (com vertex color); a cor de cada peça é assada nos vértices.
 */
export type SurfaceProfile = 'matte' | 'soft' | 'glossy' | 'bark' | 'stone' | 'plant' | 'petal';

const PROFILES: Record<SurfaceProfile, ClayOptions> = {
  matte: { roughness: 0.78, sheen: 0.45, bump: 0.4, mottle: 0.1, mottleScale: 0.9 },
  soft: { roughness: 0.7, sheen: 0.65, bump: 0.22, mottle: 0.08, mottleScale: 1.6 },
  glossy: { roughness: 0.5, sheen: 0.55, bump: 0.18, clearcoat: 0.35, mottle: 0.08, mottleScale: 1.2 },
  bark: { roughness: 0.88, sheen: 0.3, bump: 0.7, mottle: 0.16, mottleScale: 0.5 },
  stone: { roughness: 0.82, sheen: 0.35, bump: 0.55, mottle: 0.14, mottleScale: 0.7 },
  // Plantas balançam com o vento (atributo `sway` por vértice).
  plant: { roughness: 0.7, sheen: 0.6, bump: 0.2, mottle: 0.1, mottleScale: 1.4, sway: true, side: THREE.DoubleSide },
  petal: { roughness: 0.62, sheen: 0.75, bump: 0.12, mottle: 0.06, mottleScale: 2.2, sway: true, side: THREE.DoubleSide },
};

interface PartData {
  color: THREE.Color;
  profile: SurfaceProfile;
  uvScale: number;
}

/**
 * Cria uma peça de cenário. Ela é um Mesh comum (dá para posicionar, girar, escalar
 * e aninhar em grupos à vontade); o material de verdade só nasce no `StaticBatch.build`.
 */
export function part(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, profile: SurfaceProfile = 'matte', uvScale = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, PLACEHOLDER);
  const data: PartData = { color: new THREE.Color(color), profile, uvScale };
  mesh.userData.part = data;
  return mesh;
}

/** Material que nunca é desenhado: só marca a peça até o lote ser montado. */
const PLACEHOLDER = new THREE.MeshBasicMaterial({ visible: false });

export interface AddObjectOptions {
  /**
   * Quanto a ponta do objeto balança com o vento (unidades). O peso cresce
   * com a altura do vértice acima da base do objeto (quadrático: base firme).
   */
  sway?: number;
  castShadow?: boolean;
  /**
   * Objeto que pode sumir depois (a bola arranca do chão): o lote guarda onde
   * as peças dele foram parar para `RemovableParts.hide(id)` apagá-las.
   */
  removableId?: number;
}

/** Tamanho da célula espacial: o lote é fatiado nela para o frustum culling ainda funcionar. */
const CELL_SIZE = 44;

interface Bucket {
  profile: SurfaceProfile;
  castShadow: boolean;
  parts: THREE.BufferGeometry[];
  /** Dono de cada peça (id removível) ou -1. Paralelo a `parts`. */
  owners: number[];
}

interface IndexRange {
  index: THREE.BufferAttribute;
  start: number;
  /** Cópia dos índices originais (para devolver a peça). */
  original: Uint32Array;
}

/**
 * Peças "apagáveis" dentro das malhas fundidas. Sumir = trocar os triângulos
 * da peça por triângulos degenerados (todos no mesmo vértice) direto no índice:
 * vale para TODO passe (cor, sombra, AO, profundidade) sem shader especial, e o
 * lote continua sendo um draw call só. Voltar = copiar os índices de volta.
 */
export class RemovableParts {
  private readonly ranges = new Map<number, IndexRange[]>();

  /** @internal usado pelo `StaticBatch.build`. */
  register(id: number, range: IndexRange): void {
    let list = this.ranges.get(id);
    if (!list) this.ranges.set(id, (list = []));
    list.push(range);
  }

  hide(id: number): void {
    for (const r of this.ranges.get(id) ?? []) {
      const array = r.index.array as Uint16Array | Uint32Array;
      array.fill(array[r.start], r.start, r.start + r.original.length);
      this.flush(r);
    }
  }

  show(id: number): void {
    for (const r of this.ranges.get(id) ?? []) {
      (r.index.array as Uint16Array | Uint32Array).set(r.original, r.start);
      this.flush(r);
    }
  }

  private flush(r: IndexRange): void {
    r.index.addUpdateRange(r.start, r.original.length);
    r.index.needsUpdate = true;
  }
}

/**
 * Junta milhares de peças estáticas em poucos draw calls: uma malha por
 * (perfil de superfície × célula do mapa × sombra). Cor por peça vira vertex color.
 */
export class StaticBatch {
  private readonly buckets = new Map<string, Bucket>();
  private vertexCount = 0;
  /** Onde cada objeto removível foi parar (preenchido no `build`). */
  readonly removables = new RemovableParts();

  /** Assa todas as peças (`part`) dentro de `root` com suas transformações de mundo. */
  addObject(root: THREE.Object3D, options: AddObjectOptions = {}): void {
    const { sway = 0, castShadow = true, removableId = -1 } = options;
    root.updateMatrixWorld(true);

    // Base e altura do objeto (em mundo) para o peso do vento.
    let baseY = 0;
    let height = 1;
    if (sway > 0) {
      const box = new THREE.Box3().setFromObject(root);
      baseY = box.min.y;
      height = Math.max(box.max.y - box.min.y, 1e-3);
    }
    const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    const cell = `${Math.floor(origin.x / CELL_SIZE)},${Math.floor(origin.z / CELL_SIZE)}`;

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const data = mesh.userData?.part as PartData | undefined;
      if (!mesh.isMesh || !data) return;
      const geometry = prepareGeometry(mesh.geometry, mesh.matrixWorld, data, sway, baseY, height);
      // Objeto que balança precisa que TODAS as peças usem um perfil com vento, senão desmonta.
      const profile: SurfaceProfile = sway > 0 && data.profile !== 'plant' && data.profile !== 'petal' ? 'plant' : data.profile;
      const key = `${profile}|${cell}|${castShadow}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = { profile, castShadow, parts: [], owners: [] };
        this.buckets.set(key, bucket);
      }
      bucket.parts.push(geometry);
      bucket.owners.push(removableId);
      this.vertexCount += geometry.getAttribute('position').count;
    });
  }

  /** Funde tudo. Depois disso o lote está vazio (os removíveis continuam em `removables`). */
  build(): THREE.Group {
    const steps = this.buildSteps();
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  /**
   * O mesmo `build`, um balde por passo: dá para fundir o lote aos poucos entre
   * dois quadros (o jardim da próxima rodada se monta enquanto o jogo roda).
   */
  *buildSteps(): Generator<void, THREE.Group> {
    const group = new THREE.Group();
    group.name = 'static-batch';
    for (const bucket of this.buckets.values()) {
      yield;
      // mergeGeometries concatena os índices na ordem das peças: dá para saber onde cada uma caiu.
      const counts = bucket.parts.map((g) => g.getIndex()!.count);
      const merged = mergeGeometries(bucket.parts, false);
      bucket.parts.forEach((g) => g.dispose());
      if (!merged) continue;
      const index = merged.getIndex()!;
      let start = 0;
      bucket.owners.forEach((owner, i) => {
        if (owner >= 0) {
          const original = new Uint32Array(counts[i]);
          for (let k = 0; k < counts[i]; k++) original[k] = index.getX(start + k);
          this.removables.register(owner, { index, start, original });
        }
        start += counts[i];
      });
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, clay(0xffffff, { ...PROFILES[bucket.profile], vertexColors: true }));
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }

  get vertices(): number {
    return this.vertexCount;
  }
}

/**
 * Funde todas as peças (`part`) de `root` numa geometria só, no espaço LOCAL de
 * `root` e com as cores já assadas nos vértices. É o mesmo objeto que foi para o
 * lote, agora solto (ex.: a flor que a bola arrancou e que vai grudar nela).
 */
export function bakeObject(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  const matrix = new THREE.Matrix4();
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const data = mesh.userData?.part as PartData | undefined;
    if (!mesh.isMesh || !data) return;
    parts.push(normalizePart(mesh.geometry, matrix.multiplyMatrices(toLocal, mesh.matrixWorld), data));
  });
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Normaliza para o lote e acrescenta o peso do vento por vértice (`sway`). */
function prepareGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  data: PartData,
  sway: number,
  baseY: number,
  height: number,
): THREE.BufferGeometry {
  const geometry = normalizePart(source, matrix, data);
  const count = geometry.getAttribute('position').count;
  const swayWeights = new Float32Array(count);
  if (sway > 0) {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const h = THREE.MathUtils.clamp((pos.getY(i) - baseY) / height, 0, 1);
      swayWeights[i] = h * h * sway;
    }
  }
  geometry.setAttribute('sway', new THREE.BufferAttribute(swayWeights, 1));
  return geometry;
}

/**
 * Normaliza a geometria para poder ser fundida com qualquer outra:
 * indexada, só com position/normal/uv/color, transformada por `matrix`
 * e com a cor da peça assada nos vértices.
 */
function normalizePart(source: THREE.BufferGeometry, matrix: THREE.Matrix4, data: PartData): THREE.BufferGeometry {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') geometry.deleteAttribute(name);
  }
  geometry.morphAttributes = {};
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const count = geometry.getAttribute('position').count;

  if (!geometry.getIndex()) {
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  // Escala negativa espelha a malha e inverte o sentido dos triângulos: desvira.
  if (matrix.determinant() < 0) {
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  geometry.applyMatrix4(matrix);

  // UV: garante o atributo e aplica a repetição do normal map desta peça.
  let uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    geometry.setAttribute('uv', uv);
  } else if (data.uvScale !== 1) {
    for (let i = 0; i < count; i++) uv.setXY(i, uv.getX(i) * data.uvScale, uv.getY(i) * data.uvScale);
  }

  // Cor da peça multiplicada pela vertex color que ela já tiver (gradientes, manchas...).
  const existing = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  const colors = new Float32Array(count * 3);
  const { r, g, b } = data.color;
  for (let i = 0; i < count; i++) {
    const er = existing ? existing.getX(i) : 1;
    const eg = existing ? existing.getY(i) : 1;
    const eb = existing ? existing.getZ(i) : 1;
    colors[i * 3] = r * er;
    colors[i * 3 + 1] = g * eg;
    colors[i * 3 + 2] = b * eb;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
