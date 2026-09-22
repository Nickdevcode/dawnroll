import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { claySphere, clayCapsule, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { leafGeometry } from '../../world/scenery/shapes';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';

/**
 * Modelos dos bichinhos de ambiente. Cada bicho é 1 malha de corpo + (se voa)
 * 1 malha por lado de asa, com as cores assadas nos vértices: poucos draw calls
 * mesmo com vários bichos na tela. Convenção: +Z = frente, +Y = cima.
 */

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

/** Antena fina curvada com bolinha na ponta. */
function antenna(side: number, base: THREE.Vector3, length: number, color: string, club = true): THREE.BufferGeometry[] {
  const curve = new THREE.QuadraticBezierCurve3(
    base,
    base.clone().add(new THREE.Vector3(side * length * 0.2, length * 0.6, length * 0.35)),
    base.clone().add(new THREE.Vector3(side * length * 0.45, length * 0.8, length * 0.8)),
  );
  const parts = [solidColor(taperedTube(curve, 8, () => length * 0.035, 4), color)];
  if (club) {
    const tip = solidColor(claySphere(length * 0.07, 1, 0.05), color);
    const p = curve.getPoint(1);
    tip.translate(p.x, p.y, p.z);
    parts.push(tip);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Borboleta

export interface WingPalette {
  base: string;
  border: string;
  spot: string;
}

export const ButterflyPalettes: WingPalette[] = [
  { base: '#f39a2e', border: '#2a1c24', spot: '#fff6e6' }, // monarca
  { base: '#6fa8f7', border: '#1f2a55', spot: '#e6f2ff' },
  { base: '#ffe066', border: '#8a6a1f', spot: '#fff9d9' },
  { base: '#f5a3c7', border: '#6b2d52', spot: '#ffffff' },
  { base: '#b9f0a2', border: '#2f5a2a', spot: '#f4fff0' },
];

export function butterflyBody(): THREE.BufferGeometry {
  const dark = '#2b2233';
  const thorax = solidColor(clayCapsule(0.045, 0.12, 0.05, 1, 8), dark);
  thorax.rotateX(Math.PI / 2);
  const abdomen = solidColor(clayCapsule(0.03, 0.22, 0.05, 2, 8), '#3a2d40');
  abdomen.rotateX(Math.PI / 2);
  abdomen.translate(0, -0.01, -0.2);
  const head = solidColor(claySphere(0.045, 3, 0.03), dark);
  head.translate(0, 0.01, 0.12);
  return mergeParts([thorax, abdomen, head, ...antenna(1, new THREE.Vector3(0.02, 0.04, 0.14), 0.3, dark), ...antenna(-1, new THREE.Vector3(-0.02, 0.04, 0.14), 0.3, dark)]);
}

/** Par de asas do lado direito (+X); o esquerdo é o mesmo espelhado. */
export function butterflyWings(palette: WingPalette, span: number): THREE.BufferGeometry {
  const base = new THREE.Color(palette.base);
  const border = new THREE.Color(palette.border);
  const spot = new THREE.Color(palette.spot);
  const paintWing = (g: THREE.BufferGeometry, length: number, seed: number) =>
    paintVertices(g, (p, _n, c) => {
      const r = Math.hypot(p.x, p.z) / length;
      c.copy(base).multiplyScalar(0.8 + r * 0.3);
      // Nervuras escuras saindo da base.
      const vein = Math.pow(Math.abs(Math.sin(Math.atan2(p.z, p.x) * 9)), 12) * smoothstep(0.2, 0.6, r);
      c.lerp(border, vein * 0.5);
      c.lerp(border, smoothstep(0.72, 0.84, r));
      // Pintinhas claras na borda escura.
      if (r > 0.84 && noise3(p.x * 18 + seed, 0, p.z * 18) > 0.25) c.lerp(spot, 0.9);
      return c;
    });
  const fore = leafGeometry(span * 0.55, span * 0.34, { fold: 0.05, curl: -0.05, widest: 0.7, roundTip: 1, segmentsL: 8, segmentsW: 4, vein: false });
  paintWing(fore, span * 0.55, 1);
  fore.rotateY(Math.PI / 2 - 0.45);
  const hind = leafGeometry(span * 0.4, span * 0.36, { fold: 0.05, curl: -0.05, widest: 0.6, roundTip: 1, segmentsL: 7, segmentsW: 4, vein: false });
  paintWing(hind, span * 0.4, 7);
  hind.rotateY(Math.PI / 2 + 0.55);
  hind.translate(0, -0.005, -0.03);
  return mergeParts([fore, hind]);
}

// ---------------------------------------------------------------------------
// Abelha

export function beeBody(): THREE.BufferGeometry {
  const abdomen = claySphere(1, 5, 0.03, 2, 4);
  abdomen.scale(0.17, 0.16, 0.26);
  paintVertices(abdomen, (p, _n, c) => {
    // Listras amarelo/preto ao longo do corpo.
    const band = Math.sin((p.z + 0.3) * 32);
    return c.set(band > 0 ? '#f7c531' : '#2a2120');
  });
  abdomen.translate(0, 0, -0.26);
  const thorax = solidColor(claySphere(0.14, 4, 0.12, 6, 2), '#c9892f'); // bem "felpudo"
  const head = solidColor(claySphere(0.1, 4, 0.04), '#2a2120');
  head.translate(0, 0.02, 0.17);
  const eyes: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const eye = solidColor(claySphere(0.045, 2, 0.02), '#15121a');
    eye.scale(0.7, 1, 0.9);
    eye.translate(side * 0.075, 0.04, 0.2);
    eyes.push(eye);
  }
  const stinger = solidColor(new THREE.ConeGeometry(0.02, 0.07, 6), '#2a2120');
  stinger.rotateX(-Math.PI / 2);
  stinger.translate(0, 0, -0.54);
  return mergeParts([abdomen, thorax, head, ...eyes, stinger, ...antenna(1, new THREE.Vector3(0.03, 0.08, 0.22), 0.2, '#2a2120', false), ...antenna(-1, new THREE.Vector3(-0.03, 0.08, 0.22), 0.2, '#2a2120', false)]);
}

/** Asas translúcidas (lado direito). */
export function thinWings(length: number, width: number, pairs: number, sweep: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < pairs; i++) {
    const w = leafGeometry(length * (1 - i * 0.12), width, { fold: 0, curl: 0, widest: 0.45, roundTip: 0.7, segmentsL: 6, segmentsW: 2, vein: false });
    paintVertices(w, (p, _n, c) => {
      // Rendinha de nervuras: linhas finas mais escuras.
      const lines = Math.pow(Math.abs(Math.sin(p.z * 60)), 30) + Math.pow(Math.abs(Math.sin(p.x * 50)), 30);
      return c.setScalar(1 - Math.min(lines, 1) * 0.35);
    });
    w.rotateY(Math.PI / 2 + (i === 0 ? -sweep : sweep));
    w.translate(0, 0, i === 0 ? 0.02 : -0.03);
    parts.push(w);
  }
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Libélula

export function dragonflyBody(): THREE.BufferGeometry {
  const tail = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.15), new THREE.Vector3(0, 0.02, -0.9), new THREE.Vector3(0, -0.05, -1.7)]);
  const abdomen = taperedTube(tail, 28, (t) => 0.06 * (1 - t * 0.55) * (1 + Math.sin(t * 60) * 0.08), 8);
  paintVertices(abdomen, (p, _n, c) => {
    // Segmentos azul-turquesa com anéis escuros.
    const ring = Math.pow(Math.abs(Math.sin(p.z * 9)), 16);
    return c.set('#2fb7c9').lerp(new THREE.Color('#1c3e5a'), ring * 0.8 + smoothstep(-1.2, -1.7, p.z) * 0.5);
  });
  const thorax = solidColor(claySphere(0.11, 4, 0.04), '#1f8fa3');
  thorax.scale(1, 1, 1.4);
  const head = solidColor(claySphere(0.08, 3, 0.03), '#1f6f7f');
  head.translate(0, 0.02, 0.17);
  const eyes: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const eye = solidColor(claySphere(0.075, 4, 0.02), '#3c7fd9');
    eye.translate(side * 0.065, 0.05, 0.19);
    eyes.push(eye);
  }
  return mergeParts([abdomen, thorax, head, ...eyes]);
}

// ---------------------------------------------------------------------------
// Joaninha

export function ladybugBody(): THREE.BufferGeometry {
  const shell = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(0.16, 0.12, 0.19);
  const spots: Array<[number, number]> = [
    [0.08, 0.06],
    [-0.08, 0.06],
    [0.1, -0.06],
    [-0.1, -0.06],
    [0.045, -0.13],
    [-0.045, -0.13],
    [0, 0.14],
  ];
  paintVertices(shell, (p, _n, c) => {
    c.set('#e2352f');
    // Linha do meio (divisão dos élitros) e bolinhas pretas.
    if (Math.abs(p.x) < 0.008 && p.z < 0.14) return c.set('#1a1416');
    for (const [sx, sz] of spots) if (Math.hypot(p.x - sx, p.z - sz) < 0.038) return c.set('#1a1416');
    return c.multiplyScalar(0.85 + p.y * 1.5);
  });
  const belly = solidColor(new THREE.CircleGeometry(1, 20), '#1a1416');
  belly.rotateX(Math.PI / 2);
  belly.scale(0.155, 1, 0.185);
  const head = solidColor(claySphere(0.07, 3, 0.03), '#1a1416');
  head.scale(1.2, 0.8, 0.9);
  head.translate(0, 0.02, 0.19);
  const cheeks: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const cheek = solidColor(claySphere(0.022, 1, 0.02), '#f6f1e6');
    cheek.translate(side * 0.045, 0.045, 0.23);
    cheeks.push(cheek);
  }
  const legs: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const leg = solidColor(new THREE.CylinderGeometry(0.008, 0.006, 0.09, 4), '#1a1416');
      leg.rotateZ(side * 1.0);
      leg.translate(side * 0.14, -0.02, 0.08 - i * 0.08);
      legs.push(leg);
    }
  }
  const all = mergeParts([shell, belly, head, ...cheeks, ...legs]);
  all.translate(0, 0.035, 0);
  return all;
}

// ---------------------------------------------------------------------------
// Caracol

export function snailBody(): THREE.BufferGeometry {
  // Corpo: "lesma" afinando para trás, erguendo a cabeça na frente.
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.06, -0.55),
    new THREE.Vector3(0, 0.08, -0.1),
    new THREE.Vector3(0, 0.1, 0.3),
    new THREE.Vector3(0, 0.22, 0.55),
  ]);
  const foot = taperedTube(path, 24, (t) => 0.1 * (0.35 + Math.sin(t * Math.PI * 0.85) * 0.75), 12);
  foot.scale(1.25, 1, 1);
  paintVertices(foot, (p, _n, c) => c.set('#d9c7ad').multiplyScalar(0.85 + p.y * 1.2));
  const parts = [foot];
  for (const side of [1, -1]) {
    const stalkCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(side * 0.04, 0.26, 0.58),
      new THREE.Vector3(side * 0.07, 0.42, 0.62),
      new THREE.Vector3(side * 0.1, 0.52, 0.7),
    );
    parts.push(paintVertices(taperedTube(stalkCurve, 8, (t) => 0.022 * (1 - t * 0.3), 6), (_p, _n, c) => c.set('#cdb99c')));
    const eye = solidColor(claySphere(0.035, 2, 0.02), '#3b2c26');
    const tip = stalkCurve.getPoint(1);
    eye.translate(tip.x, tip.y, tip.z);
    parts.push(eye);
  }
  return mergeParts(parts);
}

/** Casca em espiral logarítmica, com faixas marrons e creme. */
export function snailShell(): THREE.BufferGeometry {
  const turns = 3.2;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * turns * Math.PI * 2;
    const r = 0.36 * Math.exp(-t * 1.9);
    points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, t * 0.14));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const shell = taperedTube(curve, 120, (t) => 0.24 * Math.exp(-t * 1.9) + 0.012, 14);
  paintVertices(shell, (p, _n, c) => {
    const angle = Math.atan2(p.y, p.x);
    const band = Math.sin(angle * 2 + Math.hypot(p.x, p.y) * 30);
    return c.set('#b8733f').lerp(new THREE.Color('#f0d9a8'), smoothstep(-0.2, 0.6, band) * 0.7);
  });
  // Casca em pé, de lado (plano da espiral = plano YZ).
  shell.rotateY(Math.PI / 2);
  shell.translate(-0.05, 0.38, -0.12);
  return mergeParts([shell]);
}
