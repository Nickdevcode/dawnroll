import * as THREE from 'three';
import { clay } from '../../render/clayMaterial';
import { claySphere, lumpify, paintVertices } from '../../render/geometry';
import { smoothstep } from '../../utils/math';

/**
 * Peças e materiais dos acessórios: tudo de massinha, como o resto do jardim.
 * As peças são pequenas (o besouro tem ~0,8 u de comprimento), então o
 * mosqueado usa escala alta e o relevo de "dedada" fica fininho.
 */

/** Materiais por "tecido". O cache da massinha junta as peças que pedem a mesma cor. */
export const Mat = {
  /** Pano (cachecol, bandana, capa): fosco e aveludado. */
  fabric: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.88, sheen: 0.9, bump: 0.3, mottle: 0.07, mottleScale: 28 }),
  /** Feltro de chapéu. */
  felt: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.82, sheen: 0.7, bump: 0.22, mottle: 0.06, mottleScale: 20 }),
  /** Couro (chapéu de cangaceiro, alça). */
  leather: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.6, sheen: 0.45, bump: 0.3, clearcoat: 0.18, mottle: 0.1, mottleScale: 16 }),
  /** Metal pintado ou polido (coroa, medalha, fivela). */
  metal: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.26, sheen: 0.25, bump: 0.05, clearcoat: 0.9, mottle: 0.03, mottleScale: 22 }),
  /** Plástico de brinquedo (boné, óculos, garrafa). */
  plastic: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.38, sheen: 0.35, bump: 0.08, clearcoat: 0.45, mottle: 0.03, mottleScale: 22 }),
  /** Lente, bala de açúcar: bem lisinho e brilhante. */
  glossy: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.12, sheen: 0.15, bump: 0, clearcoat: 1, mottle: 0 }),
  /** Massinha comum (flores, pompons). */
  clay: (color: THREE.ColorRepresentation) => clay(color, { roughness: 0.72, sheen: 0.55, bump: 0.25, mottle: 0.08, mottleScale: 24 }),
  /** Com cor por vértice (listras, degradê assado na peça). */
  painted: (roughness = 0.8) => clay(0xffffff, { vertexColors: true, roughness, sheen: 0.7, bump: 0.25, mottle: 0.05, mottleScale: 24 }),
  /** Luz própria (auréola, lâmpada, chama): cor acima de 1 acende o bloom. */
  glow: (color: THREE.ColorRepresentation, intensity: number) =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: true }),
};

/**
 * Peça torneada (chapéus, cones, cúpulas): perfil (raio, altura) girado em volta
 * do eixo Y. `lump` deixa com cara de modelada à mão.
 */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 36, lump = 0.004, seed = 0): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y));
  const geometry = new THREE.LatheGeometry(points, segments);
  return lump > 0 ? lumpify(geometry, lump, 18, seed) : geometry;
}

/**
 * Aba de chapéu: anel grosso com a borda arredondada, entre `inner` e `outer`.
 * `curl(x)` levanta a borda (x = 0 na base, 1 na ponta) — a aba do cowboy sobe dos lados.
 */
export function brim(inner: number, outer: number, thickness: number, curl: (angle: number, t: number) => number = () => 0, segments = 48): THREE.BufferGeometry {
  const rings = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  // Seção: volta fechada (em cima de dentro pra fora, embaixo de fora pra dentro).
  const section: Array<[number, number]> = [];
  for (let i = 0; i <= rings; i++) section.push([i / rings, thickness / 2]);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 - (i / 6) * Math.PI;
    section.push([1 + (Math.cos(a) * thickness) / 2 / (outer - inner), (Math.sin(a) * thickness) / 2]);
  }
  for (let i = rings; i >= 0; i--) section.push([i / rings, -thickness / 2]);
  const cols = section.length;
  for (let s = 0; s <= segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [t, y] of section) {
      const r = inner + (outer - inner) * t;
      positions.push(cos * r, y + curl(angle, Math.min(t, 1)), sin * r);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = s * cols + c;
      const b = (s + 1) * cols + c;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Anel deitado (no plano XZ): fita de chapéu, aro de óculos na horizontal, colar. */
export function flatRing(radius: number, tube: number, radialSegments = 10, tubularSegments = 48): THREE.BufferGeometry {
  return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments).rotateX(Math.PI / 2);
}

/** Forma 2D extrudada com a borda arredondada (estrela, coração, fivela), centrada em z. */
export function extrude(shape: THREE.Shape, depth: number, bevel = depth * 0.45, curveSegments = 10): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Estrela de `points` pontas (raios de fora e de dentro), pontas arredondadas de leve. */
export function starShape(points: number, outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/** Coração (ponta pra baixo), com `size` de largura. */
export function heartShape(size: number): THREE.Shape {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -s * 0.95);
  shape.bezierCurveTo(-s * 0.35, -s * 0.55, -s * 1.02, -s * 0.2, -s * 0.98, s * 0.28);
  shape.bezierCurveTo(-s * 0.95, s * 0.78, -s * 0.35, s * 0.95, 0, s * 0.52);
  shape.bezierCurveTo(s * 0.35, s * 0.95, s * 0.95, s * 0.78, s * 0.98, s * 0.28);
  shape.bezierCurveTo(s * 1.02, -s * 0.2, s * 0.35, -s * 0.55, 0, -s * 0.95);
  return shape;
}

/** Círculo como `Shape` (lente redonda, medalha). */
export function circleShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

/** Listras horizontais por vértice (em altura `y`), alternando `a` e `b` a cada `period`. */
export function paintStripesY(geometry: THREE.BufferGeometry, a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, period: number, offset = 0): THREE.BufferGeometry {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return paintVertices(geometry, (p, _n, c) => {
    const phase = ((p.y + offset) / period) % 1;
    const k = smoothstep(0.42, 0.5, Math.abs(phase < 0 ? phase + 1 : phase) - 0.0) * (1 - smoothstep(0.92, 1, phase < 0 ? phase + 1 : phase));
    return c.copy(ca).lerp(cb, k);
  });
}

/** Cor chapada por vértice (pra fundir com peças listradas no mesmo material pintado). */
export function paintSolid(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c0 = new THREE.Color(color);
  return paintVertices(geometry, (_p, _n, c) => c.copy(c0));
}

/** Mesh com posição/rotação/escala numa chamada (os modelos ficam legíveis). */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
  scale: number | readonly [number, number, number] = 1,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (typeof scale === 'number') mesh.scale.setScalar(scale);
  else mesh.scale.set(...scale);
  return mesh;
}

/**
 * Grupo com posição/rotação. `animated` = a peça mexe essa junta sozinha
 * (hélice, asa, sino): ela e o que está dentro dela ficam como estão. As outras
 * são só pra montar e somem na hora de fundir (ver `flattenStatic`).
 */
export function joint(position: readonly [number, number, number] = [0, 0, 0], rotation: readonly [number, number, number] = [0, 0, 0], animated = false): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.set(...rotation);
  if (animated) group.userData.animated = true;
  return group;
}

const tmpMatrix = new THREE.Matrix4();

/**
 * Tira as peças paradas de dentro dos grupos de montagem e põe direto na raiz,
 * com a transformação assada na geometria (cópia): assim peças iguais de grupos
 * diferentes (as flores de um colar, as duas lentes dos óculos) viram um draw
 * call só na fusão. Juntas animadas, o que está dentro delas, malhas com osso e
 * peças marcadas `keep` ficam onde estão.
 */
export function flattenStatic(root: THREE.Object3D): void {
  root.updateMatrix();
  const visit = (group: THREE.Object3D, toRoot: THREE.Matrix4) => {
    for (const child of [...group.children]) {
      child.updateMatrix();
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        if (group === root || mesh.userData.keep || mesh.children.length > 0 || (mesh as THREE.SkinnedMesh).isSkinnedMesh) continue;
        tmpMatrix.multiplyMatrices(toRoot, mesh.matrix);
        mesh.geometry = mesh.geometry.clone().applyMatrix4(tmpMatrix);
        mesh.position.set(0, 0, 0);
        mesh.quaternion.identity();
        mesh.scale.set(1, 1, 1);
        root.add(mesh);
        continue;
      }
      if (child.userData.animated || (child as THREE.Bone).isBone) continue;
      visit(child, new THREE.Matrix4().multiplyMatrices(toRoot, child.matrix));
      if (child !== root && child.children.length === 0) group.remove(child);
    }
  };
  visit(root, new THREE.Matrix4());
}

const UP = new THREE.Vector3(0, 1, 0);

/** Aponta o +Y do objeto pra `direction` (flor olhando pra fora, estrela deitada na superfície). */
export function orient(object: THREE.Object3D, direction: THREE.Vector3): THREE.Object3D {
  object.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  return object;
}

/**
 * Arco de fita por cima de uma cúpula: pedaço de toro de `span` radianos,
 * centrado no topo (+Y), no plano YZ (de frente pra trás) ou XY (de lado a lado).
 */
export function arcOver(radius: number, tube: number, span = Math.PI * 0.8, plane: 'yz' | 'xy' = 'yz'): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 36, span);
  geometry.rotateZ(Math.PI / 2 - span / 2);
  if (plane === 'yz') geometry.rotateY(Math.PI / 2);
  return geometry;
}

/**
 * Faixa de coroa: parede fina de raio `radius` e espessura `thickness`, com a
 * borda de cima seguindo `heightAt(ângulo)` (as pontas da coroa saem daí).
 */
export function crownBand(radius: number, thickness: number, heightAt: (angle: number) => number, segments = 160): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const ro = radius + thickness / 2;
  const ri = radius - thickness / 2;
  // Por segmento: fora-embaixo, fora-em-cima, dentro-em-cima, dentro-embaixo.
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const n = Math.sin(a);
    const h = heightAt(a);
    positions.push(c * ro, 0, n * ro, c * ro, h, n * ro, c * ri, h, n * ri, c * ri, 0, n * ri);
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 4;
    const b = (s + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      indices.push(a + k, a + k2, b + k, b + k, a + k2, b + k2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface FlowerStyle {
  petal: THREE.ColorRepresentation;
  center: THREE.ColorRepresentation;
  petals: number;
  /** Diâmetro da flor. */
  size: number;
  /** Pétala mais comprida (margarida) ou mais redonda (hibisco). */
  long?: boolean;
}

/** Florzinha de massinha olhando pra +Y: pétalas em volta de um miolo. */
export function flower(style: FlowerStyle, seed = 0): THREE.Group {
  const group = new THREE.Group();
  const petalMat = Mat.clay(style.petal);
  // Pétala é pequenininha: 80 triângulos bastam (um colar tem 15 flores).
  const petalGeo = claySphere(style.size * 0.28, 1, 0.08, 3, seed);
  const reach = style.size * (style.long ? 0.3 : 0.24);
  for (let i = 0; i < style.petals; i++) {
    const a = (i / style.petals) * Math.PI * 2 + seed;
    group.add(part(petalGeo, petalMat, [Math.cos(a) * reach, 0, Math.sin(a) * reach], [0, -a, 0.12], style.long ? [1.15, 0.32, 0.5] : [1, 0.34, 0.8]));
  }
  group.add(part(claySphere(style.size * 0.16, 1, 0.1, 3, seed + 1), Mat.clay(style.center), [0, style.size * 0.05, 0], [0, 0, 0], [1, 0.62, 1]));
  return group;
}
