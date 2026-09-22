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
}

/** Tamanho da célula espacial: o lote é fatiado nela para o frustum culling ainda funcionar. */
const CELL_SIZE = 44;

/**
 * Junta milhares de peças estáticas em poucos draw calls: uma malha por
 * (perfil de superfície × célula do mapa × sombra). Cor por peça vira vertex color.
 */
export class StaticBatch {
  private readonly buckets = new Map<string, { profile: SurfaceProfile; castShadow: boolean; parts: THREE.BufferGeometry[] }>();
  private vertexCount = 0;

  /** Assa todas as peças (`part`) dentro de `root` com suas transformações de mundo. */
  addObject(root: THREE.Object3D, options: AddObjectOptions = {}): void {
    const { sway = 0, castShadow = true } = options;
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
        bucket = { profile, castShadow, parts: [] };
        this.buckets.set(key, bucket);
      }
      bucket.parts.push(geometry);
      this.vertexCount += geometry.getAttribute('position').count;
    });
  }

  /** Funde tudo. Depois disso o lote está vazio e pode ser descartado. */
  build(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'static-batch';
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.parts, false);
      bucket.parts.forEach((g) => g.dispose());
      if (!merged) continue;
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
 * Normaliza a geometria para poder ser fundida com qualquer outra do lote:
 * indexada, só com position/normal/uv/color/sway, já em espaço de mundo.
 */
function prepareGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  data: PartData,
  sway: number,
  baseY: number,
  height: number,
): THREE.BufferGeometry {
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

  // Peso do vento por vértice.
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
