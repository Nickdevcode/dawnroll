import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { claySphere, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { leafGeometry } from '../../world/scenery/shapes';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { ball, glintEye, limb, mergeParts } from './models';

/**
 * Visitantes que chegam voando: a içá (tanajura, a rainha alada da saúva que
 * sai na revoada depois da chuva) e o beija-flor. Convenção: +Z = frente,
 * +Y = cima; asas do lado direito (+X) com a articulação na origem.
 */

// ---------------------------------------------------------------------------
// Içá (tanajura)

const Queen = {
  gaster: new THREE.Color('#8a3b22'),
  band: new THREE.Color('#5e2414'),
  shine: new THREE.Color('#c0663a'),
  body: new THREE.Color('#6e2a18'),
  leg: '#7a3420',
  wing: new THREE.Color('#e2c9a4'),
  vein: new THREE.Color('#8a6a4a'),
};

/** Onde nascem as asas (lado direito) da içá. */
export const QUEEN_WING_HINGE = new THREE.Vector3(0.035, 0.13, 0.05);

/**
 * Içá: o "bundão" (gáster) enorme e marrom-avermelhado que dá nome à
 * tanajura, cintura de dois nós, tórax robusto de rainha, cabeçona em
 * coração com mandíbulas e as antenas cotoveladas. As asas são peça à parte.
 */
export function flyingAntBody(): THREE.BufferGeometry {
  const gaster = claySphere(1, 4, 0.02, 2, 5);
  paintVertices(gaster, (p, n, c) => {
    c.copy(Queen.gaster);
    // Faixas das placas do abdômen e um brilho de verniz em cima.
    c.lerp(Queen.band, smoothstep(0.55, 0.95, Math.cos((p.z + 0.2) * 17)) * 0.55);
    return c.lerp(Queen.shine, smoothstep(0.55, 0.95, n.y) * 0.35);
  });
  gaster.scale(0.105, 0.095, 0.15);
  gaster.translate(0, 0.1, -0.21);
  const nodes = [ball(0.026, 0, 0.1, -0.055, Queen.body, 1), ball(0.028, 0, 0.1, -0.02, Queen.body, 1)];
  const thorax = solidColor(claySphere(1, 3, 0.03), Queen.body);
  thorax.scale(0.055, 0.06, 0.095);
  thorax.translate(0, 0.11, 0.06);
  const head = claySphere(1, 3, 0.03);
  paintVertices(head, (_p, n, c) => c.copy(Queen.body).lerp(Queen.shine, smoothstep(0.6, 0.95, n.y) * 0.25));
  head.scale(0.068, 0.058, 0.058);
  head.translate(0, 0.11, 0.19);
  const eyes = [1, -1].map((s) => glintEye(0.016, s * 0.058, 0.125, 0.2, '#120a08'));
  const mandibles = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.03, 0.085, 0.235), new THREE.Vector3(s * 0.028, 0.08, 0.27), new THREE.Vector3(s * 0.006, 0.08, 0.285)], 0.01, 0.005, Queen.band, 6, 4));
  // Antena de formiga: haste comprida e o resto dobrado para a frente (o "cotovelo").
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.025, 0.14, 0.235), new THREE.Vector3(s * 0.07, 0.2, 0.26), new THREE.Vector3(s * 0.09, 0.2, 0.3), new THREE.Vector3(s * 0.1, 0.16, 0.38)], 0.007, 0.006, Queen.leg, 14, 4),
  );
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.1 - i * 0.04;
      const reach = (i - 1) * 0.07;
      legs.push(limb([new THREE.Vector3(s * 0.035, 0.08, z), new THREE.Vector3(s * 0.12, 0.12, z + reach * 0.4), new THREE.Vector3(s * 0.16, 0.0, z + reach)], 0.01, 0.006, Queen.leg, 8, 4));
    }
  }
  return mergeParts([gaster, ...nodes, thorax, head, ...eyes, ...mandibles, ...antennae, ...legs]);
}

/**
 * Par de asas do lado direito da içá (anterior comprida + posterior), vítreas
 * com um tom de chá e as nervuras marcadas. Mais compridas que o corpo.
 */
export function flyingAntWings(): THREE.BufferGeometry {
  const make = (length: number, width: number, sweep: number, z: number) => {
    const w = leafGeometry(length, width, { fold: 0.01, curl: -0.02, widest: 0.62, roundTip: 0.9, segmentsL: 9, segmentsW: 2, vein: false });
    paintVertices(w, (p, _n, c) => {
      const lines = Math.pow(Math.abs(Math.sin(p.z * 34)), 26) + Math.pow(Math.abs(Math.sin(p.x * 50 + p.z * 12)), 26);
      c.copy(Queen.wing).lerp(Queen.vein, Math.min(lines, 1) * 0.6);
      // Mancha escura (pterostigma) na borda da frente da asa.
      if (p.z > length * 0.55 && p.z < length * 0.66 && -p.x > width * 0.15) c.copy(Queen.vein);
      return c;
    });
    w.rotateY(Math.PI / 2 - sweep);
    w.translate(0, 0, z);
    return w;
  };
  return mergeParts([make(0.7, 0.19, 0.25, 0.01), make(0.5, 0.14, 0.55, -0.03)]);
}

// ---------------------------------------------------------------------------
// Beija-flor

/**
 * Estrelinha-ametista (Calliphlox amethystina), beija-flor miudinho de jardim
 * brasileiro: costas verde-esmeralda (bronzeando no sobre), garganta ametista
 * furta-cor, colar branco no peito, flancos verde-acinzentados e rabo escuro
 * em forquilha.
 */
const Hummer = {
  back: new THREE.Color('#1f9a58'),
  rump: new THREE.Color('#728f3c'),
  crown: new THREE.Color('#12805a'),
  gorget: new THREE.Color('#a8166a'),
  glitter: new THREE.Color('#f05aa8'),
  collar: new THREE.Color('#f6f3ec'),
  belly: new THREE.Color('#e2e5da'),
  flank: new THREE.Color('#78a071'),
  tail: new THREE.Color('#212428'),
  tailBase: new THREE.Color('#3d6b3c'),
  tailTip: new THREE.Color('#9a9d94'),
  bill: '#151214',
  wing: new THREE.Color('#47423f'),
  wingEdge: new THREE.Color('#8d8883'),
  /** O borrão pega a luz: bem mais claro que a asa parada. */
  blur: new THREE.Color('#b9b3aa'),
  blurEdge: new THREE.Color('#dedad2'),
};

/** Ombro direito (onde a asa bate), ponta do bico e base do rabo do beija-flor, em escala 1. */
export const HUMMINGBIRD_SHOULDER = new THREE.Vector3(0.15, 0.25, 0.02);
export const HUMMINGBIRD_BILL_TIP = new THREE.Vector3(0, 0.43, 1.62);
export const HUMMINGBIRD_TAIL = new THREE.Vector3(0, -0.37, -0.27);

/** Espinha do corpo, do sobre (rabo) até a testa: sobe inclinada e deita na cabeça. */
const SPINE = [
  [0, -0.42, -0.25],
  [0, -0.22, -0.1],
  [0, 0.02, 0.05],
  [0, 0.24, 0.17],
  [0, 0.39, 0.29],
  [0, 0.46, 0.42],
  [0, 0.47, 0.6],
] as const;

/**
 * Seção do corpo ao longo da espinha (t = fração do comprimento): meia
 * largura, altura para as costas e para o peito. Peito estufado, pescoço
 * curtinho e cabeça redonda um tico mais larga que ele.
 */
const PROFILE: ReadonlyArray<readonly [t: number, width: number, back: number, belly: number]> = [
  [0, 0.06, 0.06, 0.06],
  [0.1, 0.15, 0.14, 0.15],
  [0.3, 0.235, 0.21, 0.25],
  [0.47, 0.245, 0.22, 0.26],
  [0.62, 0.19, 0.17, 0.2],
  [0.72, 0.168, 0.165, 0.17],
  [0.84, 0.19, 0.2, 0.165],
  [0.93, 0.15, 0.15, 0.11],
  [0.985, 0.07, 0.07, 0.05],
  [1, 0.02, 0.02, 0.015],
];

/** Interpola a tabela `PROFILE` (Catmull-Rom: sem os degraus de um smoothstep por trecho). */
function profileAt(t: number, column: 1 | 2 | 3): number {
  let i = 0;
  while (i < PROFILE.length - 2 && PROFILE[i + 1][0] < t) i++;
  const a = PROFILE[Math.max(0, i - 1)][column];
  const b = PROFILE[i][column];
  const c = PROFILE[i + 1][column];
  const d = PROFILE[Math.min(PROFILE.length - 1, i + 2)][column];
  const u = (t - PROFILE[i][0]) / (PROFILE[i + 1][0] - PROFILE[i][0]);
  return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
}

/**
 * Corpo inteiro numa peça só (sobre, barriga, peito, pescoço e cabeça), feito
 * de anéis ao longo da `SPINE`: silhueta contínua, sem a emenda de bolas
 * encaixadas. `paint(t, dorsal, p, cor)` pinta cada vértice pela posição no
 * corpo (dorsal = 1 nas costas, -1 no peito e na garganta).
 */
function bodyLoft(stations: number, radial: number, paint: (t: number, dorsal: number, p: THREE.Vector3, target: THREE.Color) => THREE.Color): THREE.BufferGeometry {
  const spine = new THREE.CatmullRomCurve3(SPINE.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3(1, 0, 0);
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  const push = (t: number, dorsal: number) => {
    positions.push(p.x, p.y, p.z);
    paint(t, dorsal, p, color);
    colors.push(color.r, color.g, color.b);
  };
  // Anéis mais juntos nas pontas (onde a curva do corpo fecha).
  for (let j = 0; j <= stations; j++) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * j) / stations);
    spine.getPointAt(t, center);
    spine.getTangentAt(t, tangent);
    up.crossVectors(tangent, side).normalize();
    const w = profileAt(t, 1);
    const hBack = profileAt(t, 2);
    const hBelly = profileAt(t, 3);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const sin = Math.sin(a);
      p.copy(center).addScaledVector(side, w * Math.cos(a)).addScaledVector(up, (sin > 0 ? hBack : hBelly) * sin);
      push(t, sin);
    }
  }
  const ring = (j: number, i: number) => j * radial + (i % radial);
  for (let j = 0; j < stations; j++) {
    for (let i = 0; i < radial; i++) indices.push(ring(j, i), ring(j, i + 1), ring(j + 1, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i));
  }
  // Tampas nas duas pontas: um vértice cada, um tiquinho para fora.
  for (const end of [0, 1]) {
    spine.getPointAt(end, center);
    spine.getTangentAt(end, tangent);
    p.copy(center).addScaledVector(tangent, end === 0 ? -0.012 : 0.012);
    const tip = positions.length / 3;
    push(end, 0);
    const j = end * stations;
    for (let i = 0; i < radial; i++) {
      if (end === 0) indices.push(tip, ring(j, i + 1), ring(j, i));
      else indices.push(tip, ring(j, i), ring(j, i + 1));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const tmpUnder = new THREE.Color();
const tmpThroat = new THREE.Color();

/**
 * Beija-flor já na postura de pairar: corpo inclinado (cabeça em cima, sobre
 * para baixo) e a cabeça deitada para o bico ficar quase na horizontal. O
 * material é furta-cor: o verde das costas e a garganta ametista mudam de tom
 * com o ângulo. Olhão preto com brilho e a pintinha branca atrás dele, bico
 * fino e comprido, pezinhos recolhidos. Asas e rabo são peças à parte (batem e
 * abanam). Origem no meio do corpo.
 */
export function hummingbirdBody(): THREE.BufferGeometry {
  const body = bodyLoft(46, 22, (t, dorsal, p, c) => {
    const speckle = noise3(p.x * 34, p.y * 34, p.z * 34);
    // Costas: esmeralda, bronzeando no sobre, mais fechado na coroa.
    c.copy(Hummer.back).lerp(Hummer.rump, 1 - smoothstep(0.06, 0.38, t));
    c.lerp(Hummer.crown, smoothstep(0.68, 0.82, t) * 0.8);
    c.multiplyScalar(0.9 + 0.16 * speckle);
    const under = smoothstep(0.1, -0.4, dorsal);
    if (under <= 0) return c;
    // Por baixo: barriga clara com os flancos verdes, colar branco e a garganta ametista até o queixo.
    const flank = smoothstep(-0.95, -0.35, dorsal) * (1 - smoothstep(0.42, 0.52, t));
    const below = tmpUnder.copy(Hummer.belly).lerp(Hummer.flank, flank * (0.55 + 0.3 * speckle));
    below.lerp(Hummer.collar, smoothstep(0.48, 0.54, t) * (1 - smoothstep(0.6, 0.64, t)));
    const throat = smoothstep(0.6, 0.66, t) * (1 - smoothstep(0.97, 1, t));
    if (throat > 0) below.lerp(tmpThroat.copy(Hummer.gorget).lerp(Hummer.glitter, smoothstep(0.35, 0.8, speckle) * 0.6), throat);
    return c.lerp(below, under);
  });

  const eyes = [1, -1].flatMap((s) => {
    const spot = solidColor(claySphere(0.03, 2, 0.02), '#f6f4ee');
    spot.scale(0.7, 1, 1.2);
    spot.translate(s * 0.172, 0.515, 0.345);
    return [glintEye(0.052, s * 0.163, 0.5, 0.445, '#0b0a0c'), spot];
  });
  // Bico reto, fino e comprido: grosso na base (entra na testa) e quase agulha na ponta.
  const bill = solidColor(
    taperedTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.47, 0.5), new THREE.Vector3(0, 0.466, 0.9), new THREE.Vector3(0, 0.452, 1.3), HUMMINGBIRD_BILL_TIP.clone()]),
      18,
      (t) => 0.05 * Math.pow(1 - t, 1.3) + 0.009,
      7,
    ),
    Hummer.bill,
  );
  const feet = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.07, -0.2, 0.0), new THREE.Vector3(s * 0.08, -0.27, 0.05), new THREE.Vector3(s * 0.08, -0.28, 0.11)], 0.016, 0.01, '#2a2224', 5, 4));
  return mergeParts([body, ...eyes, bill, ...feet]);
}

/**
 * Rabo em forquilha (as penas de fora mais compridas), em leque para trás e
 * para baixo, com origem na base (`HUMMINGBIRD_TAIL`): a instância abana e
 * abre o leque enquanto o beija-flor paira.
 */
export function hummingbirdTail(): THREE.BufferGeometry {
  const feathers: THREE.BufferGeometry[] = [];
  for (let k = -3; k <= 3; k++) {
    const outer = Math.abs(k);
    const length = 0.5 + outer * 0.075;
    const feather = leafGeometry(length, 0.13, { fold: 0.05, curl: 0.05, widest: 0.62, roundTip: 0.3, segmentsL: 6, segmentsW: 1, vein: false });
    paintVertices(feather, (p, _n, c) => {
      c.copy(Hummer.tail).lerp(Hummer.tailBase, 1 - smoothstep(0.05, 0.3, p.z));
      // Pontinhas claras nas penas de fora.
      if (outer >= 2) c.lerp(Hummer.tailTip, smoothstep(length * 0.8, length * 0.95, p.z) * 0.8);
      return c;
    });
    // As de fora ficam por baixo das do meio (sem brigar pela mesma profundidade).
    feather.translate(0, -outer * 0.006, 0);
    feather.rotateY(k * 0.14);
    feather.rotateX(Math.PI * 0.73);
    feathers.push(feather);
  }
  return mergeParts(feathers);
}

/**
 * Asa direita do beija-flor, estendendo para +X a partir do ombro: lâmina
 * comprida e estreita em foice (quase só "mão"), a borda de trás recortada
 * pelas pontas das primárias. Escura na borda da frente, clareando atrás.
 */
export function hummingbirdWing(): THREE.BufferGeometry {
  const length = 1.15;
  const along = 16;
  const across = 3;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= along; i++) {
    const s = i / along;
    // Estreita no ombro, larga no meio, fechando numa ponta arredondada; a borda de trás
    // recortada pelas pontas das penas.
    let chord = wingChord(s);
    if (s > 0.3) chord *= 1 - 0.08 * Math.pow(Math.abs(Math.sin(s * Math.PI * 7)), 0.6);
    const lead = 0.035 - 0.14 * s * s;
    for (let k = 0; k <= across; k++) {
      const v = k / across;
      positions.push(s * length, 0.025 * Math.sin(v * Math.PI) * (1 - s), lead - chord * v);
      c.copy(Hummer.wing).lerp(Hummer.wingEdge, smoothstep(0.2, 1, v) * 0.7 + s * 0.15);
      colors.push(c.r, c.g, c.b);
    }
  }
  const row = across + 1;
  for (let i = 0; i < along; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Varredura da asa (rotação em Y no ombro): de `[0]` (para a frente) a `[1]` (para trás). */
export const HUMMINGBIRD_SWEEP = [-1.0, 0.95] as const;

/** Largura da asa (corda) a `s` (0 = ombro, 1 = ponta), do mesmo desenho de `hummingbirdWing`. */
function wingChord(s: number): number {
  let chord = 0.12 + 0.2 * Math.sin(Math.min(s / 0.42, 1) * Math.PI * 0.5);
  if (s > 0.42) chord *= Math.pow(Math.max(0, Math.cos(((s - 0.42) / 0.58) * Math.PI * 0.5)), 0.55);
  return chord + 0.012;
}

/**
 * O borrão da batida (lado direito), com a transparência na vertex color
 * (RGBA): o leque que a asa varre no ar, mais denso nas duas pontas da
 * varredura, e as duas "asas fantasma" em pé onde ela freia e vira (lá na
 * frente e lá atrás) — é assim que um beija-flor pairando sai na foto, e é o
 * que ainda aparece quando a câmera vê o leque de raspão.
 */
export function hummingbirdWingBlur(): THREE.BufferGeometry {
  return mergeBlur([wingFan(), wingGhost(HUMMINGBIRD_SWEEP[0] - 0.02), wingGhost(HUMMINGBIRD_SWEEP[1] + 0.12)]);
}

/** Junta as peças do borrão (todas RGBA e indexadas; `mergeParts` só conhece RGB). */
function mergeBlur(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** A asa parada em pé na direção `angle` (rotação em Y no ombro), desfiada nas bordas. */
function wingGhost(angle: number): THREE.BufferGeometry {
  const length = 1.1;
  const along = 12;
  const across = 4;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  const dirX = Math.cos(angle);
  const dirZ = -Math.sin(angle);
  for (let i = 0; i <= along; i++) {
    const s = i / along;
    const chord = wingChord(s) * 1.15;
    const r = 0.08 + s * length;
    for (let k = 0; k <= across; k++) {
      const v = k / across;
      // Borda da frente em cima, a corda pendurada para baixo (e um tico para fora).
      const y = 0.03 - chord * v + 0.02 * r;
      positions.push(dirX * r, y, dirZ * r);
      c.copy(Hummer.blur).lerp(Hummer.blurEdge, v);
      const edge = Math.sin(v * Math.PI);
      // Some perto do ombro: a raiz da asa quase não se move (e não vela o corpo).
      colors.push(c.r, c.g, c.b, 0.42 * Math.pow(edge, 0.7) * smoothstep(0.15, 0.5, s) * (1 - 0.45 * smoothstep(0.8, 1, s)));
    }
  }
  const row = across + 1;
  for (let i = 0; i < along; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** O leque que a ponta da asa varre (plano do ombro). */
function wingFan(): THREE.BufferGeometry {
  // A corda da asa fica atrás da borda da frente: o leque vai um pouco além da varredura para trás.
  const from = HUMMINGBIRD_SWEEP[0] - 0.05;
  const to = HUMMINGBIRD_SWEEP[1] + 0.28;
  const steps = 30;
  const rings = 6;
  const inner = 0.1;
  const outer = 1.1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= steps; j++) {
    const a = from + ((to - from) * j) / steps;
    const u = (2 * j) / steps - 1;
    const dwell = 0.5 + 0.5 * Math.pow(u, 4);
    for (let i = 0; i <= rings; i++) {
      const rn = i / rings;
      const r = inner + (outer - inner) * rn;
      positions.push(Math.cos(a) * r, 0.02 * r, -Math.sin(a) * r);
      c.copy(Hummer.blur).lerp(Hummer.blurEdge, rn);
      colors.push(c.r, c.g, c.b, 0.5 * dwell * smoothstep(0.1, 0.45, rn) * (1 - 0.5 * smoothstep(0.82, 1, rn)));
    }
  }
  const row = rings + 1;
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < rings; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
