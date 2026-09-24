import * as THREE from 'three';
import { claySphere, lumpify, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { latheGeometry, leafGeometry, smoothProfile } from '../../world/scenery/shapes';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { Weight } from './materials';
import { ball, glintEye, limb, mergeParts, mirrorX } from './models';

/**
 * Modelos dos bichos de chão: joaninha, caracol, tatuzinho, gafanhoto,
 * formiga (+ formigueiro), minhoca e sapo. Mesma convenção dos voadores:
 * +Z = frente, +Y = cima, origem no chão embaixo do bicho (a não ser quando a
 * parte gira em torno de uma articulação — aí a origem é a articulação).
 */

const tmpColor = new THREE.Color();

/** Mistura de pesos de paleta: c = lerp(c, alvo * brilho, t). */
function mixWeight(c: THREE.Color, target: THREE.Color, t: number, brightness = 1): THREE.Color {
  if (t <= 0) return c;
  return c.lerp(tmpColor.copy(target).multiplyScalar(brightness), Math.min(t, 1));
}

/** Esfera com os polos no eixo Z (anéis correm ao longo do corpo). */
function zSphere(width: number, height: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, width, height);
  g.rotateX(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Joaninha

/** Articulação dos élitros (frente, em cima, no meio das costas). */
export const LADYBUG_ELYTRA_PIVOT = new THREE.Vector3(0, 0.15, 0.13);
/** Onde nascem as asas de voo (lado direito). */
export const LADYBUG_WING_HINGE = new THREE.Vector3(0.03, 0.13, 0.08);
/** Quadris das seis patas (lado direito; o esquerdo é o mesmo com x negativo). */
export const LADYBUG_HIPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.085, 0.05, 0.11],
  [0.1, 0.05, 0.01],
  [0.085, 0.05, -0.09],
];

/** Onde ficam as articulações de um besourinho que anda e voa (joaninha, vaquinha). */
export interface BeetleRig {
  /** Articulação dos élitros. */
  readonly elytraPivot: THREE.Vector3;
  /** Onde nascem as asas de voo (lado direito). */
  readonly wingHinge: THREE.Vector3;
  /** Quadris das seis patas (lado direito; o esquerdo é o mesmo com x negativo). */
  readonly hips: ReadonlyArray<readonly [number, number, number]>;
}

export const LADYBUG_RIG: BeetleRig = { elytraPivot: LADYBUG_ELYTRA_PIVOT, wingHinge: LADYBUG_WING_HINGE, hips: LADYBUG_HIPS };

export interface LadybugPalette {
  a: string;
  b: string;
}

/** Vermelha clássica, laranja, amarela e a "invertida" (preta de pinta vermelha). */
export const LadybugPalettes: LadybugPalette[] = [
  { a: '#e2352f', b: '#1a1416' },
  { a: '#ef7a22', b: '#1a1416' },
  { a: '#f2c230', b: '#1a1416' },
  { a: '#1c1719', b: '#d8322e' },
];

/** Barriga, "pescoço" (pronoto) de manchas brancas e cabeça com bochechas claras. */
export function ladybugBody(): THREE.BufferGeometry {
  const black = '#1a1416';
  const cream = '#f6f1e6';
  const belly = solidColor(claySphere(1, 3, 0.03), black);
  belly.scale(0.155, 0.045, 0.2);
  belly.translate(0, 0.055, -0.01);
  const pronotum = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  paintVertices(pronotum, (p, _n, c) => c.set(Math.abs(p.x) > 0.5 && p.y < 0.75 ? cream : black));
  pronotum.scale(0.125, 0.075, 0.075);
  pronotum.translate(0, 0.06, 0.19);
  const head = solidColor(claySphere(0.062, 3, 0.03), black);
  head.scale(1.15, 0.8, 0.85);
  head.translate(0, 0.055, 0.255);
  const cheeks = [1, -1].map((s) => ball(0.018, s * 0.035, 0.07, 0.3, cream, 1));
  const eyes = [1, -1].map((s) => glintEye(0.013, s * 0.045, 0.075, 0.29, '#0d0a0c'));
  const antennae = [1, -1].flatMap((s) => [
    limb([new THREE.Vector3(s * 0.03, 0.07, 0.29), new THREE.Vector3(s * 0.06, 0.1, 0.33), new THREE.Vector3(s * 0.075, 0.105, 0.36)], 0.006, 0.005, black, 6, 4),
    ball(0.011, s * 0.076, 0.106, 0.365, black, 1),
  ]);
  return mergeParts([belly, pronotum, head, ...cheeks, ...eyes, ...antennae]);
}

/** Élitro direito (meia cúpula) em pesos de paleta: A = fundo, B = pintas; origem na articulação. */
export function ladybugElytron(): THREE.BufferGeometry {
  // phi de PI/2 a 3PI/2 = só o lado x >= 0; theta até PI/2 = só a metade de cima.
  const g = new THREE.SphereGeometry(1, 22, 12, Math.PI / 2, Math.PI, 0, Math.PI / 2);
  const spots: Array<[number, number]> = [
    [0.55, 0.3],
    [0.62, -0.32],
    [0.3, -0.66],
    [0.0, 0.8],
  ];
  paintVertices(g, (p, _n, c) => {
    c.copy(Weight.A).multiplyScalar(0.82 + p.y * 0.3);
    for (const [sx, sz] of spots) {
      const d = Math.hypot(p.x - sx, p.z - sz);
      if (d < 0.2) return c.copy(Weight.B);
      if (d < 0.25) mixWeight(c, Weight.B, 0.5);
    }
    // Costura entre os élitros e bordinha de baixo mais escura.
    if (p.x < 0.04) mixWeight(c, Weight.B, 0.55);
    return c.multiplyScalar(0.8 + smoothstep(0, 0.25, p.y) * 0.2);
  });
  g.scale(0.17, 0.13, 0.21);
  g.translate(0, 0.05, -0.01);
  g.translate(-LADYBUG_ELYTRA_PIVOT.x, -LADYBUG_ELYTRA_PIVOT.y, -LADYBUG_ELYTRA_PIVOT.z);
  return mergeParts([g]);
}

/** Asa de voo (direita), membrana vítrea que desdobra de baixo do élitro. */
export function ladybugWing(): THREE.BufferGeometry {
  const w = leafGeometry(0.34, 0.14, { fold: 0.02, curl: -0.02, widest: 0.55, roundTip: 0.8, segmentsL: 6, segmentsW: 2, vein: false });
  paintVertices(w, (p, _n, c) => c.setScalar(0.85 - Math.pow(Math.abs(Math.sin(p.z * 40)), 20) * 0.3));
  w.rotateY(Math.PI / 2 - 0.35);
  return mergeParts([w]);
}

/** Pata (lado direito), com o quadril na origem; a esquerda é a mesma girada 180°. */
export function ladybugLeg(): THREE.BufferGeometry {
  return mergeParts([limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, 0.016, 0), new THREE.Vector3(0.1, -0.048, 0.006)], 0.01, 0.006, '#1a1416', 8, 5)]);
}

// ---------------------------------------------------------------------------
// Caracol

/** Onde ficam os pedúnculos dos olhos (lado direito). */
export const SNAIL_STALK_BASE = new THREE.Vector3(0.045, 0.27, 0.62);

export interface SnailPalette {
  a: string;
  b: string;
  c: string;
}

export const SnailPalettes: SnailPalette[] = [
  { a: '#b8733f', b: '#5a3218', c: '#f0d9a8' },
  { a: '#d9b25a', b: '#6b4a1c', c: '#fff1c4' },
  { a: '#c98a7a', b: '#6b3a32', c: '#fbe3d6' },
  { a: '#9a7a52', b: '#3f2c18', c: '#e8d8b0' },
];

/** Corpo (pé) de pele granulada, mais escuro em cima, com os tentáculos de baixo. */
export function snailBody(): THREE.BufferGeometry {
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.05, -0.62),
    new THREE.Vector3(0, 0.07, -0.2),
    new THREE.Vector3(0, 0.09, 0.25),
    new THREE.Vector3(0, 0.2, 0.55),
    new THREE.Vector3(0, 0.27, 0.66),
  ]);
  const foot = lumpify(taperedTube(path, 30, (t) => 0.11 * (0.3 + Math.sin(t * Math.PI * 0.85) * 0.8), 14), 0.01, 30, 4);
  foot.scale(1.25, 1, 1);
  const skin = new THREE.Color('#cdb79a');
  const back = new THREE.Color('#8f7a62');
  const fringe = new THREE.Color('#e8dac6');
  paintVertices(foot, (p, n, c) => {
    c.copy(skin).lerp(back, smoothstep(0.1, 0.8, n.y) * 0.6 * (0.6 + 0.4 * noise3(p.x * 30, p.y * 30, p.z * 30)));
    return c.lerp(fringe, smoothstep(-0.2, -0.7, n.y) * 0.7);
  });
  const tentacles = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.04, 0.24, 0.68), new THREE.Vector3(s * 0.065, 0.21, 0.74), new THREE.Vector3(s * 0.08, 0.18, 0.79)], 0.018, 0.012, '#bfa98c', 6, 5));
  return mergeParts([foot, ...tentacles]);
}

/** Pedúnculo do olho (origem na base): escala em Y recolhe o olho. */
export function snailStalk(): THREE.BufferGeometry {
  return mergeParts([
    limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.14, 0.03), new THREE.Vector3(0.02, 0.26, 0.06)], 0.024, 0.018, '#bfa98c', 10, 6),
    glintEye(0.034, 0.02, 0.275, 0.066, '#3b2c26'),
  ]);
}

// ---------------------------------------------------------------------------
// Tatuzinho (tatu-bola)

/** Raio da bolinha do tatuzinho enrolado. */
export const PILLBUG_BALL_RADIUS = 0.12;

const PillColors = {
  plate: new THREE.Color('#707888'),
  edge: new THREE.Color('#aab2be'),
  spot: new THREE.Color('#cdbf9c'),
  belly: new THREE.Color('#b9ae9c'),
  dark: new THREE.Color('#4f5563'),
  leg: '#d6ccbd',
};

/** Casco de placas (dente-de-serra: cada placa sobe até a borda de trás, que é mais clara). */
function plateShade(s: number, c: THREE.Color, side: number, p: THREE.Vector3): THREE.Color {
  const f = s - Math.floor(s);
  c.copy(PillColors.plate).lerp(PillColors.edge, smoothstep(0.72, 0.95, f) * 0.9);
  // Sulco escuro logo depois da borda (onde uma placa entra embaixo da outra).
  c.lerp(PillColors.dark, (1 - smoothstep(0, 0.12, f)) * 0.7);
  if (side > 0.5 && noise3(p.x * 9, p.y * 9, p.z * 9) > 0.15) c.lerp(PillColors.spot, 0.6);
  return c;
}

/**
 * Tatuzinho andando, em duas poses de patinhas (stop-motion: alternar as duas
 * a ~10 Hz lê como sete pares de patas correndo).
 */
export function pillBugWalk(pose: 0 | 1): THREE.BufferGeometry {
  const dome = zSphere(22, 40);
  const pos = dome.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const s = (z + 1) * 5.2;
    const f = s - Math.floor(s);
    if (y > 0) y *= 1 + 0.08 * f;
    // Barriga reta: tudo que ficou embaixo vira o plano de baixo.
    else y *= 0.08;
    pos.setY(i, y);
  }
  dome.computeVertexNormals();
  paintVertices(dome, (p, n, c) => (n.y < -0.5 ? c.copy(PillColors.belly) : plateShade((p.z + 1) * 5.2, c, Math.abs(p.x), p)));
  dome.scale(0.12, 0.09, 0.2);
  dome.translate(0, 0.02, 0);

  const head = solidColor(claySphere(0.05, 2, 0.04), PillColors.dark);
  head.scale(1.2, 0.7, 0.8);
  head.translate(0, 0.035, 0.2);
  const eyes = [1, -1].map((s) => ball(0.01, s * 0.04, 0.05, 0.22, '#111', 1));
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.03, 0.04, 0.23), new THREE.Vector3(s * 0.075, 0.07, 0.27), new THREE.Vector3(s * 0.1, 0.03, 0.31)], 0.008, 0.005, '#5b6270', 8, 4),
  );
  const tail = [1, -1].map((s) => {
    const t = solidColor(new THREE.ConeGeometry(0.015, 0.05, 4), PillColors.dark);
    t.rotateX(-Math.PI / 2 - 0.3);
    t.translate(s * 0.03, 0.02, -0.21);
    return t;
  });
  const legs: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 7; i++) {
      const z = 0.14 - i * 0.045;
      const swing = ((i + (side > 0 ? 0 : 1) + pose) % 2 === 0 ? 1 : -1) * 0.03;
      legs.push(limb([new THREE.Vector3(side * 0.08, 0.022, z), new THREE.Vector3(side * 0.12, 0.02, z + swing * 0.5), new THREE.Vector3(side * 0.135, 0.0, z + swing)], 0.008, 0.005, PillColors.leg, 5, 4));
    }
  }
  const all = mergeParts([dome, head, ...eyes, ...antennae, ...tail, ...legs]);
  all.translate(0, 0.012, 0);
  return all;
}

/** Tatuzinho enrolado: bolinha de placas em faixas em volta do eixo X (rola para a frente). Origem no centro. */
export function pillBugBall(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 36, 18);
  g.rotateZ(Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const s = ((Math.atan2(p.y, p.z) / (Math.PI * 2)) + 0.5) * 11;
    const f = s - Math.floor(s);
    const bulge = (1 + 0.06 * f) * (1 - 0.18 * Math.pow(Math.abs(p.x), 3));
    pos.setXYZ(i, p.x * (1 - 0.12 * Math.pow(Math.abs(p.x), 2)), p.y * bulge, p.z * bulge);
  }
  g.computeVertexNormals();
  paintVertices(g, (q, _n, c) => {
    const s = ((Math.atan2(q.y, q.z) / (Math.PI * 2)) + 0.5) * 11;
    plateShade(s, c, Math.abs(q.x) * 0.9, q);
    return c.lerp(PillColors.dark, smoothstep(0.72, 0.9, Math.abs(q.x)) * 0.8);
  });
  g.scale(PILLBUG_BALL_RADIUS, PILLBUG_BALL_RADIUS, PILLBUG_BALL_RADIUS);
  return mergeParts([g]);
}

// ---------------------------------------------------------------------------
// Gafanhoto (paleta: A = corpo, B = escuro, C = barriga/rosto claro)

export const GRASSHOPPER_HIP = new THREE.Vector3(0, 0.22, -0.05);
export const GRASSHOPPER_KNEE = new THREE.Vector3(0, 0.42, -0.42);

export const GrasshopperPalettes: Array<{ a: string; b: string; c: string }> = [
  { a: '#7fbf3f', b: '#3f6b1f', c: '#d8e79a' },
  { a: '#b58a4f', b: '#5a3f22', c: '#e8d3a6' },
  { a: '#a8c94a', b: '#56701f', c: '#eef5b0' },
];

export function grasshopperBody(): THREE.BufferGeometry {
  const abdomenCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.2, -0.02), new THREE.Vector3(0, 0.19, -0.4), new THREE.Vector3(0, 0.23, -0.74)]);
  const abdomen = taperedTube(abdomenCurve, 30, (t) => 0.1 * (1 - t * 0.55) * (1 + 0.05 * Math.cos(t * Math.PI * 16)), 10);
  paintVertices(abdomen, (p, n, c) => {
    c.copy(Weight.A);
    mixWeight(c, Weight.C, smoothstep(-0.1, -0.6, n.y));
    return mixWeight(c, Weight.B, Math.pow(Math.abs(Math.cos(p.z * 26)), 20) * 0.6);
  });
  const tip = solidColor(claySphere(0.045, 2, 0.04), Weight.A);
  tip.translate(0, 0.23, -0.75);

  const thorax = claySphere(0.12, 3, 0.04, 2, 3);
  thorax.scale(0.95, 1.05, 1.6);
  paintVertices(thorax, (p, n, c) => {
    c.copy(Weight.A);
    // Faixa clara na lateral do "selim".
    mixWeight(c, Weight.C, Math.exp(-Math.pow((p.y + 0.02) / 0.025, 2)) * smoothstep(0.4, 0.8, Math.abs(n.x)) * 0.8);
    return mixWeight(c, Weight.B, smoothstep(0.8, 1, n.y) * 0.3);
  });
  thorax.translate(0, 0.23, 0.08);

  const head = claySphere(0.11, 3, 0.03, 2, 5);
  head.scale(0.9, 1.25, 1);
  paintVertices(head, (_p, n, c) => mixWeight(c.copy(Weight.A), Weight.C, smoothstep(0.1, -0.7, n.y) * 0.7 + smoothstep(0.5, 0.9, n.z) * 0.3));
  head.rotateX(0.25);
  head.translate(0, 0.27, 0.3);

  const eyes = [1, -1].map((s) => {
    const e = claySphere(0.05, 3, 0.02);
    paintVertices(e, (_p, n, c) => (n.dot(eyeLight) > 0.88 ? c.copy(Weight.C).multiplyScalar(1.4) : c.copy(Weight.B).multiplyScalar(0.7)));
    e.scale(0.7, 1, 0.9);
    e.translate(s * 0.085, 0.32, 0.33);
    return e;
  });
  const antennae = [1, -1].map((s) =>
    solidColor(
      limb([new THREE.Vector3(s * 0.03, 0.37, 0.37), new THREE.Vector3(s * 0.07, 0.5, 0.52), new THREE.Vector3(s * 0.12, 0.56, 0.72)], 0.011, 0.006, '#000', 12, 4),
      Weight.A.clone().multiplyScalar(0.6).add(Weight.B.clone().multiplyScalar(0.4)),
    ),
  );
  // Asas dobradas em "telhadinho" ao longo das costas.
  const wings = leafGeometry(0.85, 0.2, { fold: 0.55, curl: 0.03, widest: 0.35, roundTip: 0.6, segmentsL: 10, segmentsW: 3, vein: false });
  paintVertices(wings, (p, _n, c) => {
    c.copy(Weight.A).multiplyScalar(0.7).add(tmpColor.copy(Weight.B).multiplyScalar(0.3));
    return mixWeight(c, Weight.B, Math.pow(Math.abs(Math.sin(p.z * 34)), 16) * 0.4);
  });
  wings.rotateY(Math.PI);
  wings.translate(0, 0.33, 0.14);

  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (const [hz, fz] of [
      [0.18, 0.3],
      [0.05, -0.02],
    ]) {
      legs.push(
        solidColor(
          limb([new THREE.Vector3(s * 0.06, 0.16, hz), new THREE.Vector3(s * 0.16, 0.19, hz + 0.04), new THREE.Vector3(s * 0.19, 0.0, fz)], 0.016, 0.01, '#000', 8, 5),
          Weight.A.clone().multiplyScalar(0.85),
        ),
      );
    }
  }
  return mergeParts([abdomen, tip, thorax, head, ...eyes, ...antennae, wings, ...legs]);
}
const eyeLight = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
const UP_Y = new THREE.Vector3(0, 1, 0);

/** Coxas das patas de trás (as duas), com o desenho de "espinha de peixe". Origem no quadril. */
export function grasshopperFemurs(): THREE.BufferGeometry {
  const hip = new THREE.Vector3(0.1, 0.22, -0.05);
  const knee = new THREE.Vector3(0.17, 0.42, -0.42);
  const curve = new THREE.LineCurve3(hip, knee);
  const right = taperedTube(curve, 16, (t) => 0.026 + 0.034 * Math.sin(Math.PI * Math.min(1, t * 1.15)), 8);
  paintVertices(right, (p, _n, c) => {
    const t = (p.z + 0.05) / -0.37;
    c.copy(Weight.A);
    const chevron = Math.sin(t * 40 + Math.abs(p.y - 0.32) * 60);
    return mixWeight(c, Weight.B, smoothstep(0.6, 0.9, chevron) * 0.55);
  });
  const both = mergeParts([right, mirrorX(right)]);
  both.translate(-GRASSHOPPER_HIP.x, -GRASSHOPPER_HIP.y, -GRASSHOPPER_HIP.z);
  return both;
}

/** Canelas (as duas) dobradas sob a coxa, com o pezinho. Origem no joelho. */
export function grasshopperTibias(): THREE.BufferGeometry {
  const right = mergeParts([
    solidColor(limb([new THREE.Vector3(0.17, 0.42, -0.42), new THREE.Vector3(0.175, 0.2, -0.28), new THREE.Vector3(0.18, 0.03, -0.14)], 0.02, 0.012, '#000', 10, 5), Weight.A.clone().multiplyScalar(0.8).add(new THREE.Color(0, 0.2, 0))),
    solidColor(limb([new THREE.Vector3(0.18, 0.03, -0.14), new THREE.Vector3(0.18, 0.01, -0.06)], 0.012, 0.009, '#000', 4, 4), Weight.B),
  ]);
  const both = mergeParts([right, mirrorX(right)]);
  both.translate(-GRASSHOPPER_KNEE.x, -GRASSHOPPER_KNEE.y, -GRASSHOPPER_KNEE.z);
  return both;
}

// ---------------------------------------------------------------------------
// Formigas

/** Formiga em duas poses de patas (tripé alternado); cor neutra, a colônia tinge por instância. */
export function antBody(pose: 0 | 1): THREE.BufferGeometry {
  const base = new THREE.Color('#6a5a52');
  const shine = new THREE.Color('#9a8a82');
  const gaster = claySphere(1, 3, 0.04, 2, 2);
  gaster.scale(0.07, 0.058, 0.1);
  paintVertices(gaster, (p, n, c) => c.copy(base).lerp(shine, smoothstep(0.6, 1, n.y) * 0.5).multiplyScalar(0.92 + 0.12 * Math.sin(p.z * 120)));
  gaster.rotateX(-0.25);
  gaster.translate(0, 0.07, -0.12);
  const petiole = ball(0.02, 0, 0.058, -0.04, base, 1);
  const thorax = solidColor(claySphere(1, 2, 0.04), base);
  thorax.scale(0.034, 0.036, 0.07);
  thorax.translate(0, 0.062, 0.01);
  const head = solidColor(claySphere(1, 3, 0.03), base);
  head.scale(0.05, 0.044, 0.05);
  head.translate(0, 0.066, 0.1);
  const mandibles = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.02, 0.05, 0.14), new THREE.Vector3(s * 0.012, 0.045, 0.165)], 0.008, 0.004, base, 3, 4));
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.02, 0.09, 0.13), new THREE.Vector3(s * 0.03, 0.135, 0.15), new THREE.Vector3(s * 0.065, 0.125, 0.22)], 0.005, 0.004, base, 8, 3),
  );
  const legs: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.035 - i * 0.025;
      const forward = ((i + (side > 0 ? 0 : 1) + pose) % 2 === 0 ? 1 : -1) * 0.04;
      legs.push(limb([new THREE.Vector3(side * 0.02, 0.05, z), new THREE.Vector3(side * 0.08, 0.075, z + forward * 0.4), new THREE.Vector3(side * 0.11, 0.0, z + forward + (i - 1) * 0.03)], 0.006, 0.004, base, 6, 3));
    }
  }
  return mergeParts([gaster, petiole, thorax, head, ...mandibles, ...antennae, ...legs]);
}

/** Pedacinho de folha que a formiga carrega (a cor vem da instância). Origem no meio. */
export function leafBit(): THREE.BufferGeometry {
  const leaf = leafGeometry(0.22, 0.17, { fold: 0.2, curl: 0.12, widest: 0.5, roundTip: 0.6, segmentsL: 4, segmentsW: 2 });
  leaf.translate(0, 0, -0.11);
  return mergeParts([leaf]);
}

/** Formigueiro: montinho de terra granulada com a boca escura no topo e torrões em volta. */
/**
 * Perfil do formigueiro (raio, altura), de fora pra dentro: a encosta sobe até
 * a borda da cratera (r ≈ 0,22) e desce pro buraco no meio. Serve pro desenho,
 * pra altura em que as formigas pisam e pro colisor.
 */
const ANTHILL_PROFILE: Array<[number, number]> = [
  [1.4, -0.05],
  [1.15, 0.1],
  [0.8, 0.28],
  [0.45, 0.42],
  [0.22, 0.47],
  [0.13, 0.4],
  [0.06, 0.18],
  [0.001, 0.12],
];
/** Raio da base do formigueiro. */
export const ANTHILL_RADIUS = 1.4;
/** Quanto o montinho fica enterrado (a base entra no chão em terreno torto). */
export const ANTHILL_SINK = 0.08;
const ANTHILL_SMOOTH = smoothProfile(ANTHILL_PROFILE, 40);

/** Altura da superfície do formigueiro (antes do `ANTHILL_SINK`) a `r` do centro; 0 fora dele. */
export function anthillHeight(r: number): number {
  if (r >= ANTHILL_RADIUS) return 0;
  for (let i = 1; i < ANTHILL_SMOOTH.length; i++) {
    const [r0, y0] = ANTHILL_SMOOTH[i - 1];
    const [r1, y1] = ANTHILL_SMOOTH[i];
    if (r <= r0 && r >= r1) return y0 + ((y1 - y0) * (r0 - r)) / Math.max(r0 - r1, 1e-6);
  }
  return ANTHILL_SMOOTH[ANTHILL_SMOOTH.length - 1][1];
}

/**
 * Pontos do casco convexo do formigueiro (x, y, z intercalados, origem no
 * centro da base, já com o `ANTHILL_SINK`). O casco tampa a cratera: por cima
 * dá pra andar e rolar, o buraco é só das formigas.
 */
export function anthillHull(sides = 16): Float32Array {
  const points: number[] = [];
  for (const [r, y] of ANTHILL_PROFILE) {
    if (r < 0.2) continue;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      points.push(Math.cos(a) * r * 0.97, y - ANTHILL_SINK, Math.sin(a) * r * 0.97);
    }
  }
  return new Float32Array(points);
}

export function anthill(seed: number): THREE.BufferGeometry {
  const mound = lumpify(latheGeometry(smoothProfile(ANTHILL_PROFILE, 20), 32), 0.045, 6, seed);
  const dirt = new THREE.Color('#b98a5a');
  const crumb = new THREE.Color('#d2a672');
  const hole = new THREE.Color('#3a2616');
  paintVertices(mound, (p, _n, c) => {
    const r = Math.hypot(p.x, p.z);
    c.copy(dirt).lerp(crumb, Math.max(0, noise3(p.x * 9 + seed, p.y * 9, p.z * 9)) * 0.7);
    return c.lerp(hole, 1 - smoothstep(0.08, 0.2, r));
  });
  const crumbs: THREE.BufferGeometry[] = [];
  let s = seed * 97 + 13;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.3 + rand() * 1.5;
    const y = Math.max(0, 0.45 * (1 - d / 1.4));
    crumbs.push(ball(0.03 + rand() * 0.05, Math.cos(a) * d, y, Math.sin(a) * d, rand() < 0.5 ? dirt : crumb, 1, 0.2));
  }
  return mergeParts([mound, ...crumbs]);
}

// ---------------------------------------------------------------------------
// Minhoca

/** Um gomo de minhoca (esfera de massinha lisinha); cor e escala vêm da instância. */
export function wormSegment(): THREE.BufferGeometry {
  return mergeParts([solidColor(claySphere(1, 2, 0.05, 2, 3), '#ffffff')]);
}

// ---------------------------------------------------------------------------
// Sapo (paleta: A = costas, B = manchas/escuro, C = barriga e íris dourada)

export const FROG_HIP = new THREE.Vector3(0, 0.55, -0.55);

export const FrogPalettes: Array<{ a: string; b: string; c: string }> = [
  { a: '#5fae4a', b: '#2f5a26', c: '#ecc04e' },
  { a: '#a7784a', b: '#5a3a22', c: '#e8c060' },
  { a: '#4fb89a', b: '#1f5a4a', c: '#efcf62' },
];

/** Corpo sentado (nariz para cima), cabeça larga, olhões dourados de pupila deitada, patas da frente. */
export function frogBody(): THREE.BufferGeometry {
  const body = new THREE.IcosahedronGeometry(1, 5);
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    // Quadril largo atrás, "corcundinha" de sapo sentado e barriga achatada.
    const hump = 0.2 * Math.exp(-Math.pow((z + 0.45) / 0.4, 2)) * Math.max(0, y);
    y = y * 0.62 + hump;
    if (y < -0.4) y = -0.4 + (y + 0.4) * 0.3;
    pos.setXYZ(i, x * 0.9 * (1 + 0.12 * -z), y, z * 1.2);
  }
  body.computeVertexNormals();
  const bodyGeo = lumpify(body, 0.03, 2.5, 3);
  paintVertices(bodyGeo, (p, n, c) => {
    c.copy(Weight.A).multiplyScalar(0.9 + 0.12 * n.y);
    const spots = smoothstep(0.35, 0.5, noise3(p.x * 2.6 + 4, p.y * 2.6, p.z * 2.6)) * smoothstep(-0.1, 0.4, n.y);
    mixWeight(c, Weight.B, spots * 0.85);
    return mixWeight(c, tmpColor.copy(Weight.C).lerp(Weight.A, 0.25), smoothstep(-0.1, -0.6, n.y));
  });
  bodyGeo.rotateX(-0.3);
  bodyGeo.translate(0, 0.72, -0.1);

  const head = claySphere(1, 4, 0.03, 2, 8);
  head.scale(0.78, 0.42, 0.62);
  paintVertices(head, (p, n, c) => {
    c.copy(Weight.A).multiplyScalar(0.92 + 0.1 * n.y);
    mixWeight(c, tmpColor.copy(Weight.C).lerp(Weight.A, 0.25), smoothstep(0, -0.6, n.y));
    // Boca: risco escuro dando a volta na frente.
    if (Math.abs(p.y + 0.04) < 0.022 && p.z > 0.05) mixWeight(c, Weight.B, 0.85, 0.6);
    return c;
  });
  head.translate(0, 1.0, 0.72);

  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const socket = solidColor(claySphere(0.27, 3, 0.04), Weight.A);
    socket.translate(s * 0.4, 1.24, 0.66);
    eyes.push(socket);
    const eye = claySphere(0.23, 6, 0.005);
    const look = new THREE.Vector3(s * 0.6, 0.25, 0.75).normalize();
    // Base local do olhar: pupila deitada (elipse larga e baixa) centrada na direção do olhar.
    const across = new THREE.Vector3().crossVectors(UP_Y, look).normalize();
    const upward = new THREE.Vector3().crossVectors(look, across).normalize();
    paintVertices(eye, (_p, n, c) => {
      const facing = n.dot(look);
      if (n.dot(eyeLight) > 0.94) return c.copy(Weight.C).multiplyScalar(1.7);
      const u = n.dot(across) / 0.42;
      const v = n.dot(upward) / 0.19;
      if (facing > 0 && u * u + v * v < 1) return c.setRGB(0.03, 0.03, 0.03);
      if (facing > 0.45) {
        // Íris dourada com um anel mais escuro na borda.
        c.copy(Weight.C).multiplyScalar(0.8 + (facing - 0.45) * 0.5);
        return mixWeight(c, Weight.B, (1 - smoothstep(0.45, 0.55, facing)) * 0.5);
      }
      return c.copy(Weight.A).multiplyScalar(0.9);
    });
    eye.translate(s * 0.44, 1.3, 0.76);
    eyes.push(eye);
    eyes.push(ball(0.025, s * 0.12, 1.05, 1.3, new THREE.Color(0, 0.6, 0), 1));
  }

  const armColor = Weight.A.clone().multiplyScalar(0.95);
  const pad = tmpColor.copy(Weight.C).lerp(Weight.A, 0.4).clone();
  const arms: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    arms.push(solidColor(limb([new THREE.Vector3(s * 0.42, 0.66, 0.42), new THREE.Vector3(s * 0.6, 0.36, 0.52), new THREE.Vector3(s * 0.55, 0.07, 0.78)], 0.11, 0.07, '#000', 10, 8), armColor));
    for (let k = 0; k < 4; k++) {
      const a = (k - 1.5) * 0.45;
      const tipX = s * (0.55 + Math.sin(a) * 0.2);
      const tipZ = 0.78 + Math.cos(a) * 0.2;
      arms.push(solidColor(limb([new THREE.Vector3(s * 0.55, 0.06, 0.78), new THREE.Vector3(tipX, 0.03, tipZ)], 0.035, 0.028, '#000', 4, 5), armColor));
      arms.push(ball(0.045, tipX, 0.035, tipZ, pad, 1, 0.05));
    }
  }
  return mergeParts([bodyGeo, head, ...eyes, ...arms]);
}

/** Papo (bolsa vocal) debaixo do queixo: incha quando o sapo coaxa. Origem no centro dele. */
export function frogThroat(): THREE.BufferGeometry {
  const g = claySphere(0.26, 3, 0.03);
  g.scale(1.15, 0.72, 1);
  return mergeParts([solidColor(g, '#f4ecc4')]);
}

/** As duas patas de trás dobradas (coxa, canela, pé comprido com dedos de ventosa). Origem no quadril. */
export function frogHindLegs(): THREE.BufferGeometry {
  const leg = Weight.A.clone().multiplyScalar(0.95);
  const under = tmpColor.copy(Weight.C).lerp(Weight.A, 0.35).clone();
  const hip = new THREE.Vector3(0.5, 0.55, -0.55);
  const knee = new THREE.Vector3(0.98, 0.34, 0.08);
  const ankle = new THREE.Vector3(0.78, 0.15, -0.72);
  const heel = new THREE.Vector3(0.82, 0.05, -0.45);
  const thigh = limb([hip, new THREE.Vector3(0.82, 0.5, -0.25), knee], 0.22, 0.13, '#000', 12, 10);
  paintVertices(thigh, (p, n, c) => {
    c.copy(leg);
    mixWeight(c, Weight.B, smoothstep(0.4, 0.55, noise3(p.x * 3, p.y * 3, p.z * 3)) * smoothstep(0, 0.5, n.y) * 0.8);
    return mixWeight(c, under, smoothstep(0, -0.6, n.y));
  });
  const shin = solidColor(limb([knee, new THREE.Vector3(0.95, 0.24, -0.35), ankle], 0.13, 0.08, '#000', 12, 8), leg);
  const foot = solidColor(limb([ankle, heel], 0.08, 0.06, '#000', 4, 6), leg);
  // Juntas arredondadas (sem quina onde os tubos se encontram).
  const joints = [solidColor(claySphere(0.14, 2, 0.03), leg), solidColor(claySphere(0.09, 2, 0.03), leg)];
  joints[0].translate(knee.x, knee.y, knee.z);
  joints[1].translate(ankle.x, ankle.y, ankle.z);
  const toes: THREE.BufferGeometry[] = [...joints];
  for (let k = 0; k < 4; k++) {
    const a = (k - 1.5) * 0.28;
    const tip = new THREE.Vector3(0.82 + Math.sin(a) * 0.45, 0.03, -0.45 + Math.cos(a) * 0.45);
    toes.push(solidColor(limb([heel, tip], 0.04, 0.03, '#000', 4, 5), leg));
    toes.push(ball(0.05, tip.x, tip.y + 0.01, tip.z, under, 1, 0.05));
  }
  const right = mergeParts([thigh, shin, foot, ...toes]);
  const both = mergeParts([right, mirrorX(right)]);
  both.translate(-FROG_HIP.x, -FROG_HIP.y, -FROG_HIP.z);
  return both;
}
