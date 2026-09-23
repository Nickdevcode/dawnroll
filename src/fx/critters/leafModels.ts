import * as THREE from 'three';
import { claySphere, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { ball, glintEye, limb, mergeParts } from './models';
import type { BeetleRig } from './groundModels';

/**
 * Modelos dos bichos de folha e capim: bicho-pau, lagarta mede-palmo e
 * vaquinha (Diabrotica). Convenção de sempre: +Z = frente, +Y = cima, origem
 * no chão embaixo do bicho (ou na articulação, nas peças que giram).
 */

// ---------------------------------------------------------------------------
// Bicho-pau

const Stick = {
  bark: new THREE.Color('#6f5a32'),
  dark: new THREE.Color('#45351d'),
  moss: new THREE.Color('#66723a'),
  light: new THREE.Color('#9c8a58'),
};

/** Altura do corpo deitado (parado, fingindo de graveto). */
export const STICK_BODY_Y = 0.06;
/** Quanto o corpo sobe quando o bicho-pau fica de pé para andar. */
export const STICK_STAND_LIFT = 0.26;

/** Quadris (lado direito) e comprimento de cada par de patas: da frente, do meio e de trás. */
export const STICK_LEGS: ReadonlyArray<{ hip: THREE.Vector3; length: number }> = [
  { hip: new THREE.Vector3(0.028, STICK_BODY_Y, 0.7), length: 0.95 },
  { hip: new THREE.Vector3(0.03, STICK_BODY_Y, 0.3), length: 0.72 },
  { hip: new THREE.Vector3(0.03, STICK_BODY_Y, 0.1), length: 0.86 },
];

/** Casca de graveto: estrias no comprimento, nós mais escuros e manchinhas de musgo. */
function barkPaint(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): THREE.Color {
  const streak = noise3(p.x * 60, p.y * 60, p.z * 5);
  c.copy(Stick.bark).lerp(Stick.dark, smoothstep(0.1, 0.5, streak) * 0.6);
  c.lerp(Stick.moss, smoothstep(0.35, 0.6, noise3(p.x * 20 + 7, p.y * 20, p.z * 9)) * 0.55);
  c.lerp(Stick.light, smoothstep(0.55, 0.9, n.y) * 0.25);
  return c;
}

/**
 * Corpo do bicho-pau: cabecinha, tórax comprido e fino com nós, abdômen
 * afinando com a pontinha virada e as duas antenas compridas para a frente.
 * Deitado no chão parece graveto; as patas são uma peça à parte.
 */
export function stickInsectBody(): THREE.BufferGeometry {
  const y = STICK_BODY_Y;
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, y + 0.004, 0.9),
    new THREE.Vector3(0, y, 0.45),
    new THREE.Vector3(0, y, -0.2),
    new THREE.Vector3(0, y + 0.004, -0.8),
    new THREE.Vector3(0, y + 0.03, -1.12),
  ]);
  // Raio ao longo do corpo (t = 0 na cabeça): nós nas juntas do tórax e anéis no abdômen.
  const knot = (t: number, at: number) => Math.exp(-Math.pow((t - at) / 0.012, 2));
  const body = taperedTube(
    spine,
    120,
    (t) => {
      const base = t < 0.06 ? 0.034 + t * 0.1 : t < 0.5 ? 0.037 : 0.037 - (t - 0.5) * 0.04;
      const joints = 0.18 * (knot(t, 0.08) + knot(t, 0.22) + knot(t, 0.4));
      const rings = t > 0.5 ? 0.06 * Math.cos(t * Math.PI * 34) : 0;
      return base * (1 + joints + rings);
    },
    8,
  );
  paintVertices(body, barkPaint);
  const head = claySphere(1, 3, 0.03);
  paintVertices(head, barkPaint);
  head.scale(0.036, 0.034, 0.06);
  head.translate(0, y + 0.006, 0.9);
  const eyes = [1, -1].map((s) => glintEye(0.013, s * 0.03, y + 0.02, 0.93, '#2a1f14'));
  const antennae = [1, -1].map((s) =>
    solidColor(limb([new THREE.Vector3(s * 0.016, y + 0.02, 0.95), new THREE.Vector3(s * 0.045, y + 0.03, 1.2), new THREE.Vector3(s * 0.07, y + 0.02, 1.52)], 0.007, 0.003, '#000', 16, 4), Stick.dark),
  );
  // Pontinha do rabo (as "pinças" de fechar a ponta, bem discretas).
  const tip = [1, -1].map((s) => solidColor(limb([new THREE.Vector3(s * 0.006, y + 0.03, -1.1), new THREE.Vector3(s * 0.016, y + 0.045, -1.17)], 0.007, 0.004, '#000', 4, 4), Stick.dark));
  return mergeParts([body, head, ...eyes, ...antennae, ...tip]);
}

/**
 * Pata do bicho-pau (lado direito, comprimento 1: a instância escala): coxa
 * subindo até o joelho e canela descendo até o pezinho. Origem no quadril,
 * estende para +X; a esquerda é a mesma girada 180° em Y.
 */
export function stickInsectLeg(): THREE.BufferGeometry {
  const femur = limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.24, 0.07, 0), new THREE.Vector3(0.46, 0.12, 0)], 0.018, 0.014, '#000', 10, 5);
  const tibia = limb([new THREE.Vector3(0.46, 0.12, 0), new THREE.Vector3(0.74, 0.03, 0), new THREE.Vector3(1.0, -0.1, 0)], 0.013, 0.009, '#000', 10, 5);
  const foot = limb([new THREE.Vector3(1.0, -0.1, 0), new THREE.Vector3(1.06, -0.12, 0)], 0.009, 0.007, '#000', 3, 4);
  const knee = claySphere(0.02, 1, 0.02);
  knee.translate(0.46, 0.12, 0);
  const leg = mergeParts([femur, tibia, foot, knee]);
  paintVertices(leg, (p, n, c) => barkPaint(p, n, c).multiplyScalar(0.92));
  return leg;
}

/** Ângulo (abaixo da horizontal) do pezinho visto do quadril, e o alcance da pata de comprimento 1. */
export const STICK_FOOT_ANGLE = Math.atan2(-0.12, 1.06);
export const STICK_FOOT_REACH = Math.hypot(1.06, 0.12);

// ---------------------------------------------------------------------------
// Lagarta mede-palmo

const Inchworm = {
  green: new THREE.Color('#8cc63f'),
  dorsal: new THREE.Color('#5f9a2c'),
  stripe: new THREE.Color('#eef2b0'),
  belly: new THREE.Color('#b9dc7a'),
  seam: new THREE.Color('#6d9f33'),
  head: new THREE.Color('#a8d451'),
};

/** Raio de um gomo da lagarta (escala 1). */
export const INCHWORM_RADIUS = 0.045;

/**
 * Um gomo da lagarta (esfera unitária; a instância estica em Z): verde com as
 * duas listras claras dos lados, linha mais escura no dorso e barriga clara.
 */
export function inchwormSegment(): THREE.BufferGeometry {
  const g = claySphere(1, 3, 0.015);
  paintVertices(g, (p, n, c) => {
    c.copy(Inchworm.green);
    c.lerp(Inchworm.dorsal, Math.exp(-Math.pow(p.x / 0.2, 2)) * smoothstep(0.6, 0.95, n.y) * 0.7);
    // Listra clara fininha em cada flanco, um pouco abaixo do meio (ângulo em volta do corpo: 0 = lado).
    const around = Math.atan2(n.y, Math.abs(n.x));
    const stripe = smoothstep(-0.55, -0.42, around) * (1 - smoothstep(-0.2, -0.08, around));
    c.lerp(Inchworm.stripe, stripe * (1 - smoothstep(0.75, 0.95, Math.abs(n.z))) * 0.8);
    c.lerp(Inchworm.belly, smoothstep(-0.4, -0.8, n.y) * 0.7);
    // Dobrinha entre um gomo e outro.
    return c.lerp(Inchworm.seam, smoothstep(0.8, 0.97, Math.abs(n.z)) * 0.35);
  });
  return mergeParts([g]);
}

/**
 * Cabeça da lagarta (origem no centro dela, olhando para +Z): redondinha,
 * olhinhos pretos com brilho, bochechas claras e as três pares de patinhas
 * verdadeiras logo atrás.
 */
export function inchwormHead(): THREE.BufferGeometry {
  const r = INCHWORM_RADIUS;
  const head = claySphere(r * 1.08, 3, 0.02);
  paintVertices(head, (_p, n, c) => c.copy(Inchworm.head).lerp(Inchworm.belly, smoothstep(0.2, -0.6, n.y) * 0.5));
  head.scale(1, 0.95, 0.92);
  const eyes = [1, -1].map((s) => glintEye(r * 0.26, s * r * 0.5, r * 0.3, r * 0.82, '#161a0c'));
  const cheeks = [1, -1].map((s) => ball(r * 0.2, s * r * 0.62, -r * 0.18, r * 0.72, '#dff0a0', 1, 0.02));
  const mouth = ball(r * 0.16, 0, -r * 0.55, r * 0.8, '#6b7a2a', 1, 0.02);
  const legs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const z = -r * (0.9 + i * 0.75);
    for (const s of [1, -1]) {
      legs.push(limb([new THREE.Vector3(s * r * 0.35, -r * 0.5, z), new THREE.Vector3(s * r * 0.5, -r * 0.95, z + r * 0.15)], r * 0.14, r * 0.1, '#7a8a32', 3, 4));
    }
  }
  return mergeParts([head, ...eyes, ...cheeks, mouth, ...legs]);
}

/** Lagarta enroladinha em "C" (grudada na bola): os gomos num arco, cabeça numa ponta. */
export function inchwormCurled(segments: number, length: number): THREE.BufferGeometry {
  const segment = inchwormSegment();
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const r = INCHWORM_RADIUS;
  const arc = Math.PI * 1.45;
  const radius = length / arc;
  for (let i = 0; i < segments; i++) {
    const a = (i / (segments - 1)) * arc - arc / 2;
    q.setFromAxisAngle(up, -a);
    m.compose(new THREE.Vector3(Math.sin(a) * radius, r, Math.cos(a) * radius - radius * 0.3), q, new THREE.Vector3(r, r * 0.95, r * 1.45));
    parts.push(segment.clone().applyMatrix4(m));
  }
  const a = arc / 2 + 0.2;
  q.setFromAxisAngle(up, -a + Math.PI);
  m.compose(new THREE.Vector3(Math.sin(a) * radius, r * 1.05, Math.cos(a) * radius - radius * 0.3), q, new THREE.Vector3(1, 1, 1));
  parts.push(inchwormHead().applyMatrix4(m));
  segment.dispose();
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Vaquinha (Diabrotica speciosa)

export const LEAF_BEETLE_RIG: BeetleRig = {
  elytraPivot: new THREE.Vector3(0, 0.13, 0.15),
  wingHinge: new THREE.Vector3(0.025, 0.12, 0.1),
  hips: [
    [0.06, 0.045, 0.14],
    [0.072, 0.045, 0.03],
    [0.068, 0.045, -0.08],
  ],
};

const Diabrotica = {
  green: new THREE.Color('#5fb23c'),
  deep: new THREE.Color('#2f6e22'),
  spot: new THREE.Color('#f3d54a'),
  head: '#8a3b22',
  pronotum: '#9ccc4e',
  belly: '#1e1a14',
  antenna: '#2a2018',
};

/**
 * Corpo da vaquinha: barriga escura, "pescoço" (pronoto) verde-claro,
 * cabecinha marrom-avermelhada e as antenas compridas e finas — o que separa
 * de longe uma vaquinha de uma joaninha.
 */
export function leafBeetleBody(): THREE.BufferGeometry {
  const belly = solidColor(claySphere(1, 3, 0.03), Diabrotica.belly);
  belly.scale(0.085, 0.04, 0.2);
  belly.translate(0, 0.05, -0.03);
  const pronotum = solidColor(claySphere(1, 3, 0.03), Diabrotica.pronotum);
  pronotum.scale(0.07, 0.042, 0.05);
  pronotum.translate(0, 0.085, 0.19);
  const head = solidColor(claySphere(1, 3, 0.03), Diabrotica.head);
  head.scale(0.052, 0.042, 0.048);
  head.translate(0, 0.08, 0.25);
  const eyes = [1, -1].map((s) => glintEye(0.017, s * 0.04, 0.092, 0.268, '#0d0a0c'));
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.025, 0.1, 0.285), new THREE.Vector3(s * 0.07, 0.17, 0.36), new THREE.Vector3(s * 0.13, 0.2, 0.45), new THREE.Vector3(s * 0.19, 0.19, 0.53)], 0.007, 0.005, Diabrotica.antenna, 16, 4),
  );
  return mergeParts([belly, pronotum, head, ...eyes, ...antennae]);
}

/**
 * Élitro direito da vaquinha (cores assadas, origem na articulação): comprido,
 * de lados quase paralelos, verde com as três pintas amarelas de cada lado.
 */
export function leafBeetleElytron(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 20, Math.PI / 2, Math.PI, 0, Math.PI / 2);
  // Lados paralelos: alarga as pontas (de esfera para quase cápsula).
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const k = Math.sqrt(Math.max(0, 1 - z ** 4)) / Math.max(Math.sqrt(Math.max(0, 1 - z * z)), 0.25);
    pos.setX(i, pos.getX(i) * Math.min(k, 1.6));
    pos.setY(i, pos.getY(i) * Math.min(k, 1.6));
  }
  g.computeVertexNormals();
  const spots: Array<[number, number]> = [
    [0.52, 0.56],
    [0.6, 0.0],
    [0.48, -0.56],
  ];
  paintVertices(g, (p, _n, c) => {
    c.copy(Diabrotica.green).multiplyScalar(0.85 + p.y * 0.25);
    for (const [sx, sz] of spots) {
      // Pinta redonda (a esfera é esticada 2× no comprimento: compensa em z).
      const d = Math.hypot(p.x - sx, (p.z - sz) * 1.9);
      if (d < 0.26) return c.copy(Diabrotica.spot);
      if (d < 0.31) c.lerp(Diabrotica.spot, 0.5);
    }
    // Costura e bordinha mais escuras.
    if (p.x < 0.05) c.lerp(Diabrotica.deep, 0.6);
    return c.lerp(Diabrotica.deep, (1 - smoothstep(0, 0.2, p.y)) * 0.35);
  });
  g.scale(0.1, 0.09, 0.21);
  g.translate(0, 0.05, -0.02);
  const pivot = LEAF_BEETLE_RIG.elytraPivot;
  g.translate(-pivot.x, -pivot.y, -pivot.z);
  return mergeParts([g]);
}
