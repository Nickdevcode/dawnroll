import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { solidColor } from '../../render/geometry';

/**
 * Formas de "massinha" que os objetos de gente pedem e que o cenário natural
 * não tinha: placa grossa com borda arredondada a partir de um contorno (sola
 * de chinelo, lâmina de pá, bolacha), faixa varrida ao longo de uma curva com
 * seção qualquer (tira do chinelo, cinto do anão) e a fusão de peças soltas
 * numa malha só (detritos). Tudo em espaço local, pronto para `part()`.
 */

/** Uma linha do perfil da borda: quanto entra para dentro do contorno e em que altura. */
type RimSample = readonly [inset: number, y: number];

export interface SlabOptions {
  /** Raio do arredondado da borda (≤ metade da espessura). */
  bevel?: number;
  /** Anéis da face de cima (mais anéis = dá para esculpir/pintar o miolo). */
  rings?: number;
  /** Anéis da face de baixo. */
  bottomRings?: number;
  /** Linhas extras na parede reta da lateral (para pintar faixas nela, como a sola do chinelo). */
  wallRows?: number;
  /** Centro do "leque" dos anéis (o contorno tem que ser estrelado em relação a ele). */
  center?: THREE.Vector2;
  /**
   * Relevo da face de cima: recebe o ponto (x, z), a fração até a borda (0 = centro,
   * 1 = começo do arredondado) e devolve quanto sobe/desce.
   */
  top?: (x: number, z: number, s: number) => number;
}

/**
 * Placa com espessura a partir de um contorno fechado no plano XZ: face de cima em
 * `y = thickness`, de baixo em `y = 0` e a lateral com a quina arredondada. As
 * faces são anéis do contorno encolhido até o centro — por isso o contorno tem
 * que ser "estrelado" (todo raio do centro cruza a borda uma vez só), o que vale
 * para sola, lâmina, bolacha e palma de luva.
 *
 * Uma malha só, sem costura (normais suaves de ponta a ponta) e com UV plana
 * para o normal map de massinha aparecer de cima.
 */
export function slab(outline: readonly THREE.Vector2[], thickness: number, options: SlabOptions = {}): THREE.BufferGeometry {
  const bevel = Math.min(options.bevel ?? thickness * 0.35, thickness * 0.5);
  const rings = Math.max(1, options.rings ?? 4);
  const bottomRings = Math.max(1, options.bottomRings ?? 2);
  const center = options.center ?? centroid(outline);
  const pts = orientClockwiseFromAbove(outline);
  const n = pts.length;

  // Normal 2D para dentro de cada ponto do contorno (média das arestas vizinhas).
  const inward = pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const e1 = new THREE.Vector2().subVectors(p, prev).normalize();
    const e2 = new THREE.Vector2().subVectors(next, p).normalize();
    const t = e1.add(e2).normalize();
    // Contorno em sentido horário visto de cima: a esquerda da tangente aponta para dentro.
    const inn = new THREE.Vector2(t.y, -t.x);
    return new THREE.Vector2().subVectors(center, p).dot(inn) < 0 ? inn.negate() : inn;
  });

  // Perfil da borda: quarto de círculo em cima, parede reta, quarto de círculo embaixo.
  const rim: RimSample[] = [];
  const arc = 4;
  for (let k = 0; k <= arc; k++) {
    const a = (k / arc) * Math.PI * 0.5;
    rim.push([bevel * (1 - Math.sin(a)), thickness - bevel * (1 - Math.cos(a))]);
  }
  const wallRows = options.wallRows ?? 0;
  for (let k = 1; k <= wallRows; k++) rim.push([0, thickness - bevel - ((thickness - 2 * bevel) * k) / (wallRows + 1)]);
  for (let k = 0; k <= arc; k++) {
    const a = (k / arc) * Math.PI * 0.5;
    rim.push([bevel * (1 - Math.cos(a)), bevel * (1 - Math.sin(a))]);
  }

  const positions: number[] = [];
  const ringAt = (inset: number, s: number, y: number | ((x: number, z: number) => number)) => {
    for (let i = 0; i < n; i++) {
      const bx = pts[i].x + inward[i].x * inset;
      const bz = pts[i].y + inward[i].y * inset;
      const x = center.x + (bx - center.x) * s;
      const z = center.y + (bz - center.y) * s;
      positions.push(x, typeof y === 'number' ? y : y(x, z), z);
    }
  };
  const topY = (s: number) => (x: number, z: number) => thickness + (options.top ? options.top(x, z, s) : 0);

  // Linhas (cada uma com n pontos): anéis de cima (de dentro para fora), a borda, anéis de baixo (de fora para dentro).
  const rows: number[] = [];
  const pushRow = () => rows.push(positions.length / 3 - n);
  for (let r = 1; r <= rings; r++) {
    const s = r / rings;
    ringAt(bevel, s, topY(s));
    pushRow();
  }
  for (let k = 1; k < rim.length; k++) {
    const [inset, y] = rim[k];
    // A quina de cima segue o relevo da face de cima (senão abre um degrau).
    ringAt(inset, 1, k <= arc ? (x: number, z: number) => y + (options.top ? options.top(x, z, 1) : 0) * (1 - k / arc) : y);
    pushRow();
  }
  for (let r = bottomRings - 1; r >= 1; r--) {
    ringAt(bevel, r / bottomRings, 0);
    pushRow();
  }
  const topCenter = positions.length / 3;
  positions.push(center.x, topY(0)(center.x, center.y), center.y);
  const bottomCenter = positions.length / 3;
  positions.push(center.x, 0, center.y);

  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(topCenter, rows[0] + j, rows[0] + i);
    const last = rows[rows.length - 1];
    index.push(bottomCenter, last + i, last + j);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      index.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  ensureOutward(geometry, topCenter, 1);
  planarUv(geometry, 1);
  return geometry;
}

/** Centro de massa (aproximado) de um contorno. */
function centroid(points: readonly THREE.Vector2[]): THREE.Vector2 {
  const c = new THREE.Vector2();
  for (const p of points) c.add(p);
  return c.divideScalar(points.length);
}

/** Garante o mesmo sentido para todo contorno (horário visto de cima = área negativa em x/z). */
function orientClockwiseFromAbove(points: readonly THREE.Vector2[]): THREE.Vector2[] {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area > 0 ? [...points].reverse() : [...points];
}

/**
 * Vira todos os triângulos se a malha saiu "do avesso": confere a normal de um
 * vértice de referência contra a direção esperada (+1 = para cima).
 */
function ensureOutward(geometry: THREE.BufferGeometry, vertex: number, expectedY: number): void {
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  if (normal.getY(vertex) * expectedY >= 0) return;
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.computeVertexNormals();
}

/** UV plana vista de cima (x, z) × escala: o normal map de massinha aparece nas faces grandes. */
export function planarUv(geometry: THREE.BufferGeometry, scale: number): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * scale;
    uv[i * 2 + 1] = pos.getZ(i) * scale + pos.getY(i) * scale * 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Contorno a partir de um raio por ângulo (bolacha com borda ondulada, botão...). */
export function polarOutline(segments: number, radiusAt: (angle: number) => number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = radiusAt(a);
    out.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

/**
 * Contorno liso a partir de pontos de controle (Catmull-Rom fechado): desenha-se
 * a forma com meia dúzia de pontos e sai uma borda redonda de massinha.
 */
export function smoothOutline(control: Array<[number, number]>, samples: number): THREE.Vector2[] {
  const curve = new THREE.CatmullRomCurve3(
    control.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  return curve.getSpacedPoints(samples).slice(0, samples).map((p) => new THREE.Vector2(p.x, p.z));
}

export interface SweepOptions {
  /** Seção transversal (fechada, em volta da origem): x = largura, y = altura da faixa. */
  section: readonly THREE.Vector2[];
  segments: number;
  /** "Para cima" da seção ao longo da curva (a largura fica perpendicular a isso e à tangente). */
  upAt?: (t: number, point: THREE.Vector3) => THREE.Vector3;
  /** Escala da seção ao longo da curva (afinar nas pontas). */
  scaleAt?: (t: number) => number;
  /** Fecha as pontas com tampa. */
  caps?: boolean;
}

/**
 * Varre uma seção qualquer ao longo de uma curva — o `TubeGeometry` só faz
 * círculo. Serve para tira de chinelo (retângulo arredondado deitado), cinto,
 * alça... A orientação da seção vem de `upAt` (não gira sozinha ao longo da curva).
 */
export function sweep(curve: THREE.Curve<THREE.Vector3>, options: SweepOptions): THREE.BufferGeometry {
  const { section, segments, upAt = () => new THREE.Vector3(0, 1, 0), scaleAt = () => 1, caps = true } = options;
  const m = section.length;
  const positions: number[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centers: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    side.crossVectors(tangent, upAt(t, point)).normalize();
    up.crossVectors(side, tangent).normalize();
    const s = scaleAt(t);
    for (const q of section) {
      positions.push(point.x + (side.x * q.x + up.x * q.y) * s, point.y + (side.y * q.x + up.y * q.y) * s, point.z + (side.z * q.x + up.z * q.y) * s);
    }
    if (i === 0 || i === segments) centers.push(point.clone());
  }
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * m;
    const b = (i + 1) * m;
    for (let k = 0; k < m; k++) {
      const l = (k + 1) % m;
      index.push(a + k, b + k, b + l, a + k, b + l, a + l);
    }
  }
  if (caps) {
    const start = positions.length / 3;
    positions.push(centers[0].x, centers[0].y, centers[0].z);
    const end = positions.length / 3;
    positions.push(centers[1].x, centers[1].y, centers[1].z);
    const lastRow = segments * m;
    // Mesmo sentido de volta que as faixas vizinhas (senão a tampa sai do avesso).
    for (let k = 0; k < m; k++) {
      const l = (k + 1) % m;
      index.push(start, k, l);
      index.push(end, lastRow + l, lastRow + k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // A normal do primeiro anel tem que apontar para fora do eixo da curva.
  const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const p0 = new THREE.Vector3(positions[m * 3], positions[m * 3 + 1], positions[m * 3 + 2]);
  curve.getPointAt(1 / segments, point);
  if (p0.sub(point).dot(new THREE.Vector3().fromBufferAttribute(nor, m)) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geometry.setIndex(index);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Retângulo de cantos arredondados (seção de tira, cinto, fita). */
export function roundedRectSection(width: number, height: number, corner = Math.min(width, height) * 0.45, perCorner = 3): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const hw = width / 2 - corner;
  const hh = height / 2 - corner;
  const centers: Array<[number, number, number]> = [
    [hw, hh, 0],
    [-hw, hh, Math.PI / 2],
    [-hw, -hh, Math.PI],
    [hw, -hh, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of centers) {
    for (let k = 0; k <= perCorner; k++) {
      const a = start + (k / perCorner) * Math.PI * 0.5;
      out.push(new THREE.Vector2(cx + Math.cos(a) * corner, cy + Math.sin(a) * corner));
    }
  }
  return out;
}

/**
 * Funde peças numa malha só com position/normal/uv/color (cor branca onde não
 * tinha): é o formato dos detritos, que viram UM objeto ao grudar na bola.
 */
export function fuseParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('color')) solidColor(g, '#ffffff');
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Transforma os vértices de uma geometria in-place (entortar, afunilar) e refaz as normais. */
export function warp(geometry: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
