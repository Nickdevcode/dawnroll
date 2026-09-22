import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { claySphere, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { leafGeometry } from '../../world/scenery/shapes';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { Weight } from './materials';

/**
 * Modelos dos voadores (borboleta, abelha, libélula, mosca) e ajudantes de
 * geometria dos bichos. Cada parte é UMA geometria com as cores assadas nos
 * vértices (ou, nas partes "de paleta", com o PESO de cada cor da instância).
 * Convenção: +Z = frente, +Y = cima; asas do lado direito (+X) com a
 * articulação na origem — o lado esquerdo é `mirrorX` da direita.
 */

// ---------------------------------------------------------------------------
// Ajudantes

/** Funde peças normalizando atributos (position, normal, color). */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('color')) solidColor(g, '#ffffff');
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Espelha em X (lado esquerdo), desvirando os triângulos para a face continuar para fora. */
export function mirrorX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = source.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const index = g.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  }
  return g;
}

/** Tubo afinando que passa pelos pontos (patas, antenas, hastes). */
export function limb(points: THREE.Vector3[], r0: number, r1: number, color: THREE.ColorRepresentation, segments = 10, radial = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return solidColor(taperedTube(curve, segments, (t) => r0 + (r1 - r0) * t, radial), color);
}

/** Bolinha já posicionada. */
export function ball(radius: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, detail = 2, lump = 0.04): THREE.BufferGeometry {
  const g = solidColor(claySphere(radius, detail, lump), color);
  g.translate(x, y, z);
  return g;
}

/** Olho de desenho animado: bolinha escura com um brilho claro "pintado" (dá vida de longe). */
export function glintEye(radius: number, x: number, y: number, z: number, iris: THREE.ColorRepresentation, light = new THREE.Vector3(0.35, 0.75, 0.55)): THREE.BufferGeometry {
  const g = claySphere(radius, 3, 0.02);
  const dir = light.clone().normalize();
  const base = new THREE.Color(iris);
  const shine = new THREE.Color('#f4f0ff');
  paintVertices(g, (_p, n, c) => c.copy(base).lerp(shine, smoothstep(0.86, 0.95, n.dot(dir))));
  g.translate(x, y, z);
  return g;
}

/** Antena fina curvada, com bolinha (clava) na ponta. */
function antenna(side: number, base: THREE.Vector3, length: number, color: string, club = true, spread = 0.45): THREE.BufferGeometry[] {
  const curve = new THREE.QuadraticBezierCurve3(
    base,
    base.clone().add(new THREE.Vector3(side * length * 0.18, length * 0.62, length * 0.3)),
    base.clone().add(new THREE.Vector3(side * length * spread, length * 0.78, length * 0.78)),
  );
  const parts = [solidColor(taperedTube(curve, 10, () => length * 0.032, 5), color)];
  if (club) {
    const tip = solidColor(claySphere(length * 0.065, 1, 0.05), color);
    tip.scale(1, 1, 1.5);
    const p = curve.getPoint(1);
    tip.translate(p.x, p.y, p.z);
    parts.push(tip);
  }
  return parts;
}

/**
 * Leque (asa de borboleta): contorno em coordenadas polares a partir da
 * articulação — `[ângulo em graus (de +X para +Z), raio]` em ordem crescente de
 * ângulo — preenchido por anéis concêntricos (mais densos perto da borda, onde
 * ficam os desenhos). Face para +Y, levemente em concha.
 */
function fanGeometry(
  outline: Array<[number, number]>,
  options: { rings: number; steps: number; camber: number; radiusScale?: (deg: number) => number },
  paint: (deg: number, rn: number, x: number, z: number, target: THREE.Color) => THREE.Color,
): THREE.BufferGeometry {
  const { rings, steps, camber, radiusScale } = options;
  const curve = new THREE.SplineCurve(outline.map(([a, r]) => new THREE.Vector2(a, r)));
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const p = new THREE.Vector2();
  for (let j = 0; j <= steps; j++) {
    curve.getPoint(j / steps, p);
    const deg = p.x;
    const radius = p.y * (radiusScale ? radiusScale(deg) : 1);
    const rad = THREE.MathUtils.degToRad(deg);
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const rn = 0.02 + 0.98 * (1 - Math.pow(1 - t, 1.55));
      const r = radius * rn;
      const x = Math.cos(rad) * r;
      const z = Math.sin(rad) * r;
      positions.push(x, camber * r * r, z);
      paint(deg, rn, x, z, color);
      colors.push(color.r, color.g, color.b);
    }
  }
  const indices: number[] = [];
  const row = rings + 1;
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < rings; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Garante a face para cima (a ordem do leque depende do sentido do contorno).
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  let up = 0;
  for (let i = 0; i < normals.count; i++) up += normals.getY(i);
  if (up < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Mistura de pesos de paleta: c = lerp(c, alvo * brilho, t). */
function mixWeight(c: THREE.Color, target: THREE.Color, t: number, brightness = 1): THREE.Color {
  if (t <= 0) return c;
  return c.lerp(tmpColor.copy(target).multiplyScalar(brightness), Math.min(t, 1));
}
const tmpColor = new THREE.Color();

// ---------------------------------------------------------------------------
// Borboleta

/** Desenho da asa; a cor vem da paleta da instância (A = fundo, B = borda/veias, C = pintas claras). */
export type WingPattern = 'veined' | 'eyespot';

export interface ButterflyPalette {
  pattern: WingPattern;
  a: string;
  b: string;
  c: string;
}

export const ButterflyPalettes: ButterflyPalette[] = [
  { pattern: 'veined', a: '#f28a22', b: '#231820', c: '#fff3dc' }, // monarca
  { pattern: 'veined', a: '#f7a8cc', b: '#6b2d52', c: '#ffffff' },
  { pattern: 'veined', a: '#ffe45c', b: '#8f6f16', c: '#fffbe0' }, // limão
  { pattern: 'veined', a: '#aee88f', b: '#2f5a2a', c: '#f4fff0' },
  { pattern: 'veined', a: '#fbf6ea', b: '#4a4550', c: '#fbf6ea' }, // branquinha da couve
  { pattern: 'eyespot', a: '#3d8df5', b: '#142552', c: '#dbeafe' }, // morpho
  { pattern: 'eyespot', a: '#e8583a', b: '#1f171c', c: '#fff8ee' }, // almirante
  { pattern: 'eyespot', a: '#c7a3ff', b: '#3b2466', c: '#ffe9a8' },
  { pattern: 'eyespot', a: '#c43d3a', b: '#2a1c22', c: '#f5d56b' }, // pavão
];

/** Corpo: tórax de pelúcia, abdômen segmentado, olhão com brilho, antenas com clava, probóscide enrolada e patinhas. */
export function butterflyBody(): THREE.BufferGeometry {
  const dark = new THREE.Color('#2b2233');
  const fuzz = new THREE.Color('#7a6680');
  const thorax = claySphere(0.062, 3, 0.22, 10, 3);
  thorax.scale(0.9, 0.85, 1.3);
  paintVertices(thorax, (p, n, c) => c.copy(dark).lerp(fuzz, Math.max(0, noise3(p.x * 90, p.y * 90, p.z * 90)) * 0.9 + Math.max(0, n.y) * 0.15));

  const abdomenCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.005, -0.05),
    new THREE.Vector3(0, -0.014, -0.17),
    new THREE.Vector3(0, -0.032, -0.3),
    new THREE.Vector3(0, -0.052, -0.38),
  ]);
  const abdomen = taperedTube(abdomenCurve, 36, (t) => (0.04 - t * 0.024) * (1 + 0.1 * Math.cos(t * Math.PI * 14)), 10);
  paintVertices(abdomen, (p, n, c) => c.copy(dark).lerp(fuzz, (0.5 + 0.5 * Math.cos(p.z * 110)) * 0.35 + Math.max(0, n.y) * 0.1));
  const tail = ball(0.017, 0, -0.053, -0.385, dark, 1);

  const head = solidColor(claySphere(0.042, 3, 0.05), dark);
  head.translate(0, 0.008, 0.095);
  const eyes = [1, -1].map((s) => glintEye(0.03, s * 0.03, 0.018, 0.108, '#241a2e'));

  // Probóscide: espiral enrolada debaixo da cabeça.
  const spiral: THREE.Vector3[] = [new THREE.Vector3(0, -0.02, 0.118)];
  for (let k = 0; k <= 26; k++) {
    const t = k / 26;
    const angle = t * Math.PI * 2 * 2.1;
    const r = 0.026 * (1 - t * 0.78);
    spiral.push(new THREE.Vector3(0, -0.05 + Math.cos(angle) * r, 0.142 + Math.sin(angle) * r));
  }
  const proboscis = solidColor(taperedTube(new THREE.CatmullRomCurve3(spiral), 60, () => 0.0045, 4), '#4a3346');

  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.045 - i * 0.042;
      legs.push(
        limb([new THREE.Vector3(s * 0.02, -0.035, z), new THREE.Vector3(s * 0.07, -0.07, z + 0.012), new THREE.Vector3(s * 0.085, -0.135, z - 0.02)], 0.0065, 0.004, dark, 8, 4),
      );
    }
  }
  return mergeParts([
    thorax,
    abdomen,
    tail,
    head,
    ...eyes,
    proboscis,
    ...legs,
    ...antenna(1, new THREE.Vector3(0.016, 0.04, 0.118), 0.36, '#2b2233', true, 0.5),
    ...antenna(-1, new THREE.Vector3(-0.016, 0.04, 0.118), 0.36, '#2b2233', true, 0.5),
  ]);
}

/**
 * Par de asas do lado direito (anterior + posterior) com o desenho em pesos de
 * paleta. Recorte de verdade: anterior triangular com a ponta arredondada;
 * posterior com a borda ondulada entre as nervuras (e rabinho no 'eyespot').
 */
export function butterflyWing(pattern: WingPattern): THREE.BufferGeometry {
  const L = 0.9;
  const eyespot = pattern === 'eyespot';
  const base = (rn: number, c: THREE.Color) => c.setRGB(0.8 + rn * 0.26, 0, 0);
  const rootDark = (rn: number, c: THREE.Color) => mixWeight(c, Weight.B, (1 - smoothstep(0.05, 0.2, rn)) * 0.75, 0.9);
  const veins = (deg: number, rn: number, c: THREE.Color, k: number) => {
    const v = Math.pow(Math.abs(Math.sin(THREE.MathUtils.degToRad(deg) * k + 0.4)), 70) * smoothstep(0.12, 0.3, rn) * (1 - smoothstep(0.76, 0.84, rn));
    return mixWeight(c, Weight.B, v * 0.85);
  };
  /** Anel de ocelo centrado em (cx, cz) (coordenadas da asa em escala 1). */
  const ocellus = (x: number, z: number, cx: number, cz: number, r: number, c: THREE.Color) => {
    const d = Math.hypot(x - cx, z - cz) / r;
    if (d > 1) return c;
    if (d < 0.22) return c.copy(Weight.C);
    if (d < 0.55) return c.copy(Weight.B).multiplyScalar(0.9);
    if (d < 0.8) return c.copy(Weight.C).multiplyScalar(0.95);
    return c.copy(Weight.B);
  };

  const fore = fanGeometry(
    [
      [-10, 0.52],
      [0, 0.6],
      [13, 0.73],
      [27, 0.87],
      [40, 0.97],
      [50, 1.0],
      [56, 0.95],
      [60, 0.78],
      [62, 0.34],
    ],
    { rings: 16, steps: 40, camber: 0.05 },
    (deg, rn, x, z, c) => {
      base(rn, c);
      rootDark(rn, c);
      veins(deg, rn, c, 10);
      if (Math.abs(rn - 0.46) < 0.02 && deg > 8 && deg < 44) mixWeight(c, Weight.B, 0.8);
      if (eyespot) {
        // Ponta escura com faixa clara atravessada e um olhinho perto da ponta.
        mixWeight(c, Weight.B, smoothstep(26, 38, deg) * smoothstep(0.5, 0.6, rn));
        const band = Math.exp(-Math.pow((rn - 0.7) / 0.055, 2)) * smoothstep(24, 34, deg) * (1 - smoothstep(58, 62, deg));
        mixWeight(c, Weight.C, band * 0.95);
        ocellus(x, z, Math.cos(THREE.MathUtils.degToRad(46)) * 0.86, Math.sin(THREE.MathUtils.degToRad(46)) * 0.86, 0.075, c);
        mixWeight(c, Weight.B, smoothstep(0.9, 0.94, rn));
      } else {
        mixWeight(c, Weight.B, smoothstep(34, 46, deg) * smoothstep(0.55, 0.66, rn));
        mixWeight(c, Weight.B, smoothstep(0.8, 0.84, rn));
        // Duas fileiras de pintinhas claras na borda escura.
        const row1 = Math.abs((deg / 6.5) % 1 - 0.5) < 0.2 && Math.abs(rn - 0.885) < 0.026;
        const row2 = Math.abs(((deg / 6.5) + 0.5) % 1 - 0.5) < 0.17 && Math.abs(rn - 0.955) < 0.02;
        if (row1 || row2) c.copy(Weight.C);
        // Manchas claras na ponta escura (a "janela" da monarca).
        for (const [sd, sr] of [[42, 0.7], [48, 0.76], [53, 0.72], [44, 0.62]]) {
          const px = Math.cos(THREE.MathUtils.degToRad(sd)) * sr;
          const pz = Math.sin(THREE.MathUtils.degToRad(sd)) * sr;
          if (Math.hypot(x - px, z - pz) < 0.04) c.copy(Weight.C);
        }
      }
      return c;
    },
  );

  const scallop = (deg: number) => 1 - 0.045 * (0.5 - 0.5 * Math.cos((deg * Math.PI * 2) / 9));
  const hind = fanGeometry(
    [
      [-106, 0.34],
      [-94, 0.5],
      [-78, 0.64],
      [-58, 0.72],
      [-38, 0.73],
      [-20, 0.68],
      [-4, 0.57],
    ],
    {
      rings: 16,
      steps: 44,
      camber: 0.04,
      // Rabinho de "rabo-de-andorinha" no padrão de ocelos.
      radiusScale: (deg) => scallop(deg) + (eyespot ? 0.34 * Math.exp(-Math.pow((deg + 87) / 4.2, 2)) : 0),
    },
    (deg, rn, x, z, c) => {
      base(rn, c);
      rootDark(rn, c);
      veins(deg, rn, c, 9);
      if (eyespot) {
        const a = THREE.MathUtils.degToRad(-50);
        ocellus(x, z, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.16, c);
        mixWeight(c, Weight.B, smoothstep(0.88, 0.93, rn));
        if (deg < -80 && rn > 0.75) mixWeight(c, Weight.B, 0.8);
      } else {
        mixWeight(c, Weight.B, smoothstep(0.8, 0.84, rn));
        const row = Math.abs((deg / 7) % 1 - 0.5) < 0.2 && Math.abs(rn - 0.9) < 0.028;
        if (row) c.copy(Weight.C);
      }
      return c;
    },
  );
  // A posterior fica um tiquinho abaixo (sem briga de profundidade onde as duas se cobrem).
  hind.translate(0, -0.004, -0.01);
  const merged = mergeParts([fore, hind]);
  merged.scale(L, L, L);
  return merged;
}

// ---------------------------------------------------------------------------
// Abelha

export function beeBody(): THREE.BufferGeometry {
  const black = new THREE.Color('#2a2120');
  const yellow = new THREE.Color('#f6c42e');
  const abdomen = claySphere(1, 4, 0.045, 12, 4);
  abdomen.scale(0.17, 0.155, 0.26);
  paintVertices(abdomen, (p, _n, c) => {
    const band = Math.sin((p.z + 0.3) * 30);
    c.copy(band > 0 ? yellow : black);
    if (p.z < -0.19) c.copy(black);
    // Pelinho: pontinhos mais claros.
    return c.multiplyScalar(0.9 + Math.max(0, noise3(p.x * 70, p.y * 70, p.z * 70)) * 0.35);
  });
  abdomen.translate(0, -0.02, -0.27);

  const thorax = claySphere(0.135, 4, 0.18, 9, 2);
  const brown = new THREE.Color('#c98a2f');
  const fluff = new THREE.Color('#f0c070');
  paintVertices(thorax, (p, n, c) => c.copy(brown).lerp(fluff, Math.max(0, noise3(p.x * 60, p.y * 60, p.z * 60)) * 0.8 + Math.max(0, n.y) * 0.2));

  const head = solidColor(claySphere(0.095, 3, 0.04), black);
  head.scale(1.1, 1, 0.85);
  head.translate(0, 0.02, 0.17);
  const eyes = [1, -1].map((s) => {
    const e = glintEye(0.05, 0, 0, 0, '#17131c');
    e.scale(0.8, 1.25, 0.9);
    e.translate(s * 0.07, 0.035, 0.19);
    return e;
  });
  const stinger = solidColor(new THREE.ConeGeometry(0.02, 0.08, 6), black);
  stinger.rotateX(-Math.PI / 2);
  stinger.translate(0, -0.02, -0.56);

  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.07 - i * 0.07;
      const knee = new THREE.Vector3(s * 0.13, -0.13, z + 0.01);
      const foot = new THREE.Vector3(s * 0.12, -0.25, z - 0.05);
      legs.push(limb([new THREE.Vector3(s * 0.06, -0.08, z), knee, foot], 0.014, 0.008, black, 8, 5));
      // Cestinha de pólen na pata de trás.
      if (i === 2) legs.push(ball(0.042, s * 0.128, -0.19, z - 0.02, '#f2a93b', 2, 0.1));
    }
  }
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.03, 0.08, 0.23), new THREE.Vector3(s * 0.06, 0.17, 0.27), new THREE.Vector3(s * 0.1, 0.21, 0.37)], 0.009, 0.007, black, 10, 4),
  );
  return mergeParts([abdomen, thorax, head, ...eyes, stinger, ...legs, ...antennae]);
}

/** Asas vítreas do lado direito (anterior + posterior), com rendinha de nervuras. */
export function beeWings(): THREE.BufferGeometry {
  const make = (length: number, width: number, sweep: number, z: number) => {
    const w = leafGeometry(length, width, { fold: 0.02, curl: -0.04, widest: 0.5, roundTip: 0.85, segmentsL: 7, segmentsW: 2, vein: false });
    paintVertices(w, (p, _n, c) => {
      const lines = Math.pow(Math.abs(Math.sin(p.z * 55)), 28) + Math.pow(Math.abs(Math.sin(p.x * 60 + p.z * 20)), 28);
      const edge = smoothstep(0.7, 1, Math.abs(p.x) / (width * 0.5));
      return c.setScalar(1 - Math.min(lines, 1) * 0.35 - edge * 0.15);
    });
    w.rotateY(Math.PI / 2 - sweep);
    w.translate(0, 0, z);
    return w;
  };
  return mergeParts([make(0.38, 0.14, 0.4, 0.02), make(0.25, 0.1, 0.9, -0.03)]);
}

// ---------------------------------------------------------------------------
// Libélula (paleta: A = corpo, B = anéis escuros, C = olhos)

export interface DragonflyPalette {
  a: string;
  b: string;
  c: string;
}

export const DragonflyPalettes: DragonflyPalette[] = [
  { a: '#2fb7c9', b: '#173a52', c: '#3c7fd9' },
  { a: '#e0453a', b: '#5a1a1a', c: '#b3262b' },
  { a: '#56c26a', b: '#1f4a2a', c: '#2c8f6f' },
  { a: '#e8b93a', b: '#5a3f12', c: '#9a5b2a' },
];

export function dragonflyBody(): THREE.BufferGeometry {
  const tail = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0, 0.02, -0.9), new THREE.Vector3(0, -0.04, -1.72)]);
  const abdomen = taperedTube(
    tail,
    60,
    (t) => {
      const waist = 1 - 0.35 * Math.exp(-Math.pow((t - 0.07) / 0.05, 2));
      const segment = 1 + 0.09 * Math.cos(t * Math.PI * 20);
      return (0.055 - t * 0.026) * waist * segment;
    },
    10,
  );
  paintVertices(abdomen, (p, n, c) => {
    const t = (-p.z - 0.12) / 1.6;
    c.copy(Weight.A);
    mixWeight(c, Weight.B, Math.pow(Math.abs(Math.cos(t * Math.PI * 10)), 18) * 0.9);
    mixWeight(c, Weight.B, Math.max(0, -n.y) * 0.45 + smoothstep(0.9, 0.98, t));
    return c;
  });
  const thorax = claySphere(0.1, 4, 0.05, 3, 7);
  thorax.scale(1, 1.1, 1.35);
  paintVertices(thorax, (p, n, c) => {
    c.copy(Weight.A).multiplyScalar(0.95);
    // Listras diagonais nas laterais.
    const stripe = smoothstep(0.55, 0.8, Math.sin(p.z * 45 + p.y * 38)) * smoothstep(0.3, 0.7, Math.abs(n.x));
    return mixWeight(c, Weight.B, stripe);
  });
  thorax.translate(0, 0.01, 0.02);
  const face = solidColor(claySphere(0.068, 3, 0.03), Weight.A.clone().lerp(Weight.C, 0.4));
  face.translate(0, 0.01, 0.175);
  const eyes = [1, -1].map((s) => {
    const e = claySphere(0.08, 4, 0.02);
    paintVertices(e, (p, n, c) => {
      c.copy(Weight.C).multiplyScalar(0.8 + Math.max(0, noise3(p.x * 160, p.y * 160, p.z * 160)) * 0.4);
      // Brilho de olho composto: canto de cima mais claro.
      if (n.dot(tmpLight) > 0.9) c.setRGB(0.2, 0.2, 1.3);
      return mixWeight(c, Weight.B, smoothstep(0.5, 0.9, n.y) * 0.35);
    });
    e.translate(s * 0.056, 0.055, 0.19);
    return e;
  });
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.08 - i * 0.05;
      legs.push(solidColor(limb([new THREE.Vector3(s * 0.04, -0.07, z), new THREE.Vector3(s * 0.08, -0.12, z + 0.02), new THREE.Vector3(s * 0.05, -0.16, z + 0.06)], 0.009, 0.006, '#000', 6, 4), Weight.B));
    }
  }
  return mergeParts([abdomen, thorax, face, ...eyes, ...legs]);
}
const tmpLight = new THREE.Vector3(0.3, 0.8, 0.5).normalize();

/** Uma asa da libélula (direita, comprida e fina) com rendinha de nervuras e o pterostigma escuro perto da ponta. */
export function dragonflyWing(): THREE.BufferGeometry {
  const length = 1.02;
  const width = 0.2;
  const w = leafGeometry(length, width, { fold: 0.02, curl: -0.03, widest: 0.34, roundTip: 0.85, segmentsL: 14, segmentsW: 3, vein: false });
  paintVertices(w, (p, _n, c) => {
    const t = p.z / length;
    const lattice = Math.pow(Math.abs(Math.sin(p.z * 70)), 30) + Math.pow(Math.abs(Math.sin(p.x * 90 + p.z * 25)), 30);
    c.setScalar(1 - Math.min(lattice, 1) * 0.28);
    // Borda de ataque (lado -x antes de girar) mais escura, com o pterostigma.
    const lead = smoothstep(0.55, 0.95, -p.x / (width * 0.5));
    c.multiplyScalar(1 - lead * 0.3);
    if (t > 0.82 && t < 0.9 && -p.x > width * 0.12) c.setRGB(0.25, 0.2, 0.18);
    return c;
  });
  w.rotateY(Math.PI / 2);
  return w;
}

// ---------------------------------------------------------------------------
// Mosca dos montinhos de bosta

/** Corpo da mosca-varejeira: verde-azulado metálico, olhões vermelhos compostos, cerdas e patinhas. */
export function dungFlyBody(): THREE.BufferGeometry {
  const teal = new THREE.Color('#2f6f66');
  const green = new THREE.Color('#3f9a5a');
  const shine = new THREE.Color('#9fe0c0');
  const thorax = claySphere(0.058, 3, 0.05, 3, 5);
  thorax.scale(1, 0.92, 1.1);
  paintVertices(thorax, (_p, n, c) => c.copy(teal).lerp(shine, smoothstep(0.55, 0.95, n.y) * 0.45));
  const abdomen = claySphere(0.064, 3, 0.04, 3, 9);
  abdomen.scale(0.95, 0.8, 1.2);
  paintVertices(abdomen, (p, n, c) => c.copy(green).lerp(teal, 0.5 + 0.5 * Math.sin(p.z * 90)).lerp(shine, smoothstep(0.6, 0.95, n.y) * 0.5));
  abdomen.translate(0, -0.008, -0.085);
  const head = solidColor(claySphere(0.042, 3, 0.03), '#2a2a30');
  head.translate(0, 0.004, 0.066);
  const eyes = [1, -1].map((s) => {
    const e = claySphere(0.034, 3, 0.02);
    paintVertices(e, (p, n, c) => {
      c.set('#b3262b').multiplyScalar(0.75 + Math.max(0, noise3(p.x * 300, p.y * 300, p.z * 300)) * 0.5);
      return n.dot(tmpLight) > 0.9 ? c.set('#ffd6d6') : c;
    });
    e.translate(s * 0.03, 0.016, 0.078);
    return e;
  });
  const bristles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = solidColor(new THREE.ConeGeometry(0.004, 0.03, 3), '#16161a');
    b.rotateX(-0.5);
    b.rotateY(a);
    b.translate(Math.cos(a) * 0.035, 0.05, Math.sin(a) * 0.04);
    bristles.push(b);
  }
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.03 - i * 0.03;
      legs.push(limb([new THREE.Vector3(s * 0.03, -0.04, z), new THREE.Vector3(s * 0.08, -0.05, z + 0.01), new THREE.Vector3(s * 0.09, -0.1, z - 0.01)], 0.006, 0.004, '#16161a', 6, 4));
    }
  }
  return mergeParts([thorax, abdomen, head, ...eyes, ...bristles, ...legs]);
}

/**
 * UMA asa da mosca (lado direito): articulação na origem, estende para +X e
 * para trás, face +Y. Bater = girar em Z (positivo levanta a ponta).
 * Vertex color quase branca com nervuras (combina com material vítreo).
 */
export function dungFlyWing(): THREE.BufferGeometry {
  const w = leafGeometry(0.15, 0.065, { fold: 0.02, curl: -0.02, widest: 0.55, roundTip: 0.85, segmentsL: 6, segmentsW: 2, vein: false });
  paintVertices(w, (p, _n, c) => c.setScalar(1 - Math.min(1, Math.pow(Math.abs(Math.sin(p.z * 80)), 24) + Math.pow(Math.abs(Math.sin(p.x * 120)), 24)) * 0.35));
  w.rotateY(Math.PI / 2 - 0.5);
  return mergeParts([w]);
}

// ---------------------------------------------------------------------------
// Casca de caracol

/**
 * Casca em espiral logarítmica (em pé, de lado: plano da espiral = plano YZ),
 * com linhas de crescimento e a boca levemente virada. `paint` recebe o
 * parâmetro ao longo da espiral (0 = boca, 1 = ápice) e o ângulo da seção.
 */
function shellGeometry(paint: (t: number, spiralAngle: number, p: THREE.Vector3, target: THREE.Color) => THREE.Color): THREE.BufferGeometry {
  const turns = 3.3;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72;
    const a = t * turns * Math.PI * 2;
    const r = 0.36 * Math.exp(-t * 1.9);
    points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, t * 0.15));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const shell = taperedTube(
    curve,
    150,
    (t) => {
      const lip = 1 + 0.12 * Math.exp(-Math.pow(t / 0.015, 2));
      const growth = 1 + 0.025 * Math.sin(t * 260);
      return (0.24 * Math.exp(-t * 1.9) + 0.012) * lip * growth;
    },
    16,
  );
  // Parâmetro ao longo da espiral por vértice: o tubo tem (150 + 1) anéis de 17 vértices.
  const pos = shell.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ringIndex = Math.floor(i / 17);
    const t = ringIndex / 150;
    p.fromBufferAttribute(pos, i);
    paint(t, t * turns * Math.PI * 2, p, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  shell.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  shell.rotateY(Math.PI / 2);
  shell.translate(-0.05, 0.38, -0.12);
  return mergeParts([shell]);
}

/** Casca com as cores assadas (também é detrito que gruda na bola). */
export function snailShell(): THREE.BufferGeometry {
  const brown = new THREE.Color('#b8733f');
  const cream = new THREE.Color('#f0d9a8');
  const dark = new THREE.Color('#6e3f22');
  return shellGeometry((t, spiral, _p, c) => {
    const band = Math.sin(spiral * 2 + t * 30);
    c.copy(brown).lerp(cream, smoothstep(-0.2, 0.6, band) * 0.7);
    if (Math.abs(Math.sin(spiral * 0.5 + 1.2)) > 0.97) c.lerp(dark, 0.6);
    return c.multiplyScalar(0.9 + 0.1 * Math.sin(t * 260));
  });
}

/** Mesma casca em pesos de paleta (A = fundo, B = faixa escura, C = creme). */
export function snailShellPalette(): THREE.BufferGeometry {
  return shellGeometry((t, spiral, _p, c) => {
    c.copy(Weight.A);
    mixWeight(c, Weight.C, smoothstep(-0.2, 0.6, Math.sin(spiral * 2 + t * 30)) * 0.65);
    mixWeight(c, Weight.B, smoothstep(0.93, 0.99, Math.abs(Math.sin(spiral * 0.5 + 1.2))) * 0.9);
    // Boca clarinha e ápice mais escuro.
    mixWeight(c, Weight.C, 1 - smoothstep(0, 0.03, t));
    c.multiplyScalar(0.88 + 0.12 * Math.sin(t * 260));
    return c;
  });
}

