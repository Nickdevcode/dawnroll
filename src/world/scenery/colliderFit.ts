import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import type { SurfaceProfile } from '../../render/StaticBatch';

/**
 * Colisão que acompanha o modelo de verdade. Os construtores de cenário põem
 * colisores feitos à mão (cápsula no soldadinho, cilindro no vaso...), mas eles
 * deixam pedaços de fora: a lâmina da pá fincada, as pontas do morango, os
 * dedos da luva, a boca do vaso, os cogumelinhos do cacho. Aqui cada peça do
 * modelo é testada contra esses colisores; o que sobra de fora ganha um casco
 * convexo com a forma da própria peça.
 *
 * Folhagem (pétala, folha, caule) é "macia": a bola e o besouro atravessam, mas
 * a câmera não pode entrar — ela ganha cascos só da câmera.
 */

/** Onde os cascos novos vão parar (o dono já sabe o grupo de colisão de cada um). */
export interface FitSink {
  /** Casco sólido (bola, besouro e câmera). */
  solid(desc: RAPIER.ColliderDesc, position: THREE.Vector3): RAPIER.Collider;
  /** Casco que só a câmera enxerga. */
  soft(desc: RAPIER.ColliderDesc, position: THREE.Vector3): RAPIER.Collider;
}

/** Perfis de superfície de folhagem: macios para a bola, sólidos para a lente. */
const FOLIAGE: ReadonlySet<SurfaceProfile> = new Set<SurfaceProfile>(['plant', 'petal']);

/** Vértices por peça que viram casco (o suficiente para a silhueta). */
const HULL_SAMPLES = 64;
/** Vértices por peça no teste "já está coberta?". */
const COVER_SAMPLES = 20;
/** Um vértice a até essa distância de um colisor conta como coberto (massinha amassa). */
const COVER_TOLERANCE = 0.15;
/** Fração de vértices de fora a partir da qual a peça ganha casco próprio. */
const UNCOVERED_SHARE = 0.2;
/** Peças rígidas menores que isso (raio) não mudam nada para a bola (a menor tem 0,5). */
const MIN_SOLID_RADIUS = 0.2;
/** Folhagem menor que isso não enche a tela (a lente passa sem ninguém perceber). */
const MIN_SOFT_RADIUS = 0.3;
/** Acima disso, as peças descobertas de um objeto se juntam por vizinhança (pinha: dezenas de escamas). */
const CLUSTER_LIMIT = 10;
/** Comprimento ÷ largura a partir do qual a peça rígida é "comprida" (cabo, alça) e vira uma corrente de cascos. */
const ELONGATED = 3;
/**
 * Peça comprida mas curta (pétala, fiapo do dente-de-leão, braço do soldadinho)
 * não vira corrente: junta com as vizinhas (a cabeça da flor vira um casco só).
 * Na folhagem, tudo que passa disso vira corrente (caule e folha comprida): o
 * caule inclinado tem a caixa "gorda", então a proporção não serve pra ele.
 */
const MIN_SEGMENTED_LENGTH = 1.5;
/** Comprimento de cada gomo de uma corrente de folhagem. */
const FOLIAGE_SEGMENT = 1.5;
const MAX_SEGMENTS = 4;
/** Folhagem que não passa dessa altura do chão: a câmera nunca desce tanto (o chão dela é +0,45). */
const LOW_FOLIAGE = 0.5;

interface PartSample {
  readonly foliage: boolean;
  /** Vértices (amostrados) em mundo e o mesmo vértice no espaço da peça. */
  readonly world: THREE.Vector3[];
  readonly local: THREE.Vector3[];
  readonly center: THREE.Vector3;
  readonly radius: number;
  /** Eixo local mais comprido e em quantos gomos a peça vira casco. */
  readonly axis: 0 | 1 | 2;
  readonly segments: number;
  readonly top: number;
}

const tmpScale = new THREE.Vector3();
const tmpBox = new THREE.Box3();

/**
 * Completa os colisores de um objeto: devolve os cascos criados (sólidos e só
 * de câmera) para o dono desligar junto quando a bola arrancar o objeto.
 * `ground` = altura do chão no pé do objeto (corta folhagem rente ao chão).
 */
export function fitColliders(root: THREE.Object3D, existing: readonly RAPIER.Collider[], ground: number, sink: FitSink): RAPIER.Collider[] {
  root.updateMatrixWorld(true);
  const parts = sampleParts(root, ground);
  const created: RAPIER.Collider[] = [];

  const solids = parts.filter((p) => !p.foliage && p.radius >= MIN_SOLID_RADIUS && !isCovered(p, existing));
  if (solids.length > CLUSTER_LIMIT) {
    for (const group of clusters(solids)) addHull(created, sink.solid, group.flatMap((p) => p.world));
  } else {
    for (const p of solids) addSegmented(created, sink.solid, p);
  }

  const foliage = parts.filter((p) => p.foliage && p.radius >= MIN_SOFT_RADIUS * 0.5 && p.top > LOW_FOLIAGE);
  const long = foliage.filter((p) => p.segments > 1);
  const compact = foliage.filter((p) => p.segments === 1);
  for (const p of long) addSegmented(created, sink.soft, p);
  for (const group of clusters(compact)) {
    const points = group.flatMap((p) => p.world);
    if (boundingRadius(points) >= MIN_SOFT_RADIUS) addHull(created, sink.soft, points);
  }
  return created;
}

/** Amostra os vértices de cada peça (`part`) do objeto, em mundo e no espaço da peça. */
function sampleParts(root: THREE.Object3D, ground: number): PartSample[] {
  const out: PartSample[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const data = mesh.userData?.part as { profile: SurfaceProfile } | undefined;
    if (!mesh.isMesh || !data) return;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position || position.count < 4) return;
    const stride = Math.max(1, Math.floor(position.count / HULL_SAMPLES));
    const local: THREE.Vector3[] = [];
    const world: THREE.Vector3[] = [];
    let top = -Infinity;
    for (let i = 0; i < position.count; i += stride) {
      const l = new THREE.Vector3().fromBufferAttribute(position, i);
      const w = l.clone().applyMatrix4(mesh.matrixWorld);
      local.push(l);
      world.push(w);
      top = Math.max(top, w.y - ground);
    }
    tmpBox.setFromPoints(world);
    const center = tmpBox.getCenter(new THREE.Vector3());
    const radius = boundingRadius(world, center);

    // Comprimento de cada eixo local já em mundo (a peça pode estar esticada).
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), tmpScale);
    const dims = [size.x * Math.abs(tmpScale.x), size.y * Math.abs(tmpScale.y), size.z * Math.abs(tmpScale.z)];
    const order = [0, 1, 2].sort((a, b) => dims[b] - dims[a]) as Array<0 | 1 | 2>;
    const length = dims[order[0]];
    const width = Math.max(dims[order[1]], 1e-3);
    const foliage = FOLIAGE.has(data.profile);
    let segments = 1;
    if (length >= MIN_SEGMENTED_LENGTH) {
      if (foliage) segments = Math.min(MAX_SEGMENTS, Math.max(2, Math.round(length / FOLIAGE_SEGMENT)));
      else if (length / width >= ELONGATED) segments = Math.min(MAX_SEGMENTS, Math.max(2, Math.round(length / (width * 2))));
    }
    out.push({ foliage, world, local, center, radius, axis: order[0], segments, top });
  });
  return out;
}

/** A peça já está (quase toda) dentro dos colisores feitos à mão? */
function isCovered(part: PartSample, colliders: readonly RAPIER.Collider[]): boolean {
  if (colliders.length === 0) return false;
  const stride = Math.max(1, Math.floor(part.world.length / COVER_SAMPLES));
  let tested = 0;
  let outside = 0;
  for (let i = 0; i < part.world.length; i += stride) {
    tested++;
    if (!nearAny(part.world[i], colliders)) outside++;
  }
  return outside / tested < UNCOVERED_SHARE;
}

function nearAny(p: THREE.Vector3, colliders: readonly RAPIER.Collider[]): boolean {
  for (const c of colliders) {
    const hit = c.projectPoint(p, true);
    if (!hit) continue;
    if (hit.isInside) return true;
    const dx = hit.point.x - p.x;
    const dy = hit.point.y - p.y;
    const dz = hit.point.z - p.z;
    if (dx * dx + dy * dy + dz * dz <= COVER_TOLERANCE * COVER_TOLERANCE) return true;
  }
  return false;
}

/**
 * Peça comprida (caule, cabo, alça) vira uma corrente de cascos ao longo do eixo
 * mais comprido: um casco só "encheria" a curva (o caule inclinado viraria um cone).
 * Os gomos se sobrepõem um pouco para não deixar fresta.
 */
function addSegmented(out: RAPIER.Collider[], make: FitSink['solid'], part: PartSample): void {
  if (part.segments <= 1) {
    addHull(out, make, part.world);
    return;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const l of part.local) {
    const v = l.getComponent(part.axis);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const step = (max - min) / part.segments;
  const overlap = step * 0.15;
  for (let s = 0; s < part.segments; s++) {
    const from = min + s * step - overlap;
    const to = min + (s + 1) * step + overlap;
    const points = part.world.filter((_, i) => {
      const v = part.local[i].getComponent(part.axis);
      return v >= from && v <= to;
    });
    if (points.length >= 4) addHull(out, make, points);
  }
}

/** Casco convexo dos pontos (em mundo); peça chata demais ganha uma espessura mínima. */
function addHull(out: RAPIER.Collider[], make: FitSink['solid'], points: readonly THREE.Vector3[]): void {
  if (points.length < 4) return;
  const stride = Math.max(1, Math.floor(points.length / (HULL_SAMPLES * 1.5)));
  const center = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < points.length; i += stride, n++) center.add(points[i]);
  center.divideScalar(n);
  const flat: number[] = [];
  for (let i = 0; i < points.length; i += stride) flat.push(points[i].x - center.x, points[i].y - center.y, points[i].z - center.z);
  let desc = RAPIER.ColliderDesc.convexHull(new Float32Array(flat));
  if (!desc) {
    // Tudo num plano (pétala, folha): um tetraedrinho no meio dá volume ao casco.
    const e = 0.04;
    flat.push(e, e, e, -e, -e, e, -e, e, -e, e, -e, -e);
    desc = RAPIER.ColliderDesc.convexHull(new Float32Array(flat));
  }
  if (desc) out.push(make(desc, center));
}

/** Junta peças que se encostam (esferas envolventes sobrepostas): pétalas de uma cabeça, escamas de uma pinha. */
function clusters(parts: readonly PartSample[]): PartSample[][] {
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      if (a.center.distanceTo(b.center) < a.radius + b.radius + 0.05) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, PartSample[]>();
  parts.forEach((p, i) => {
    const root = find(i);
    let list = groups.get(root);
    if (!list) groups.set(root, (list = []));
    list.push(p);
  });
  return [...groups.values()];
}

function boundingRadius(points: readonly THREE.Vector3[], center?: THREE.Vector3): number {
  const c = center ?? tmpBox.setFromPoints(points as THREE.Vector3[]).getCenter(new THREE.Vector3());
  let r = 0;
  for (const p of points) r = Math.max(r, p.distanceTo(c));
  return r;
}
