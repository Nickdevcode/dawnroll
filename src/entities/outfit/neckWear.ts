import * as THREE from 'three';
import { claySphere, lumpify, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { Mat, circleShape, extrude, flower, joint, lathe, orient, part, starShape } from './parts';
import { chainSkin } from './skinned';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Coisas do pescoço. O besouro não tem pescoço de verdade: a cabeça entra por
 * baixo do pronoto. A gola é uma elipse inclinada que abraça essa emenda — em
 * cima passa atrás dos olhos, dos lados por fora das bochechas e embaixo
 * aparece logo abaixo do sorriso, que é onde pendem gravata, sino e medalha.
 * Origem = centro da cabeça.
 */

const COLLAR = {
  center: new THREE.Vector3(0, 0.03, 0.05),
  rx: 0.268,
  ry: 0.2,
  /** Inclinação: o topo vai pra trás, a frente desce pro queixo. */
  tilt: -0.8,
};
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), COLLAR.tilt);

/** Ponto da gola no ângulo `a` (0 = lado direito, PI/2 = topo, -PI/2 = queixo), com folga `grow`. */
function collarPoint(a: number, grow = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(a) * (COLLAR.rx + grow), Math.sin(a) * (COLLAR.ry + grow), 0).applyQuaternion(TILT).add(COLLAR.center);
}

/** Direção "pra fora" da gola no ângulo `a` (do centro dela pro ponto). */
function collarOut(a: number): THREE.Vector3 {
  return collarPoint(a).sub(COLLAR.center).normalize();
}

/** Onde as coisas penduradas nascem: a frente da gola, embaixo do sorriso. */
const CHIN_ANGLE = -Math.PI / 2;

/** Tubo fechado seguindo a gola (raio `tube`); `flatten` achata numa fita (0 = redondo). */
function collarTube(tube: number, flatten = 0, segments = 72): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) points.push(collarPoint((i / segments) * Math.PI * 2));
  const curve = new THREE.CatmullRomCurve3(points, true);
  const geometry = taperedTube(curve, segments * 2, () => tube, 10, true);
  if (flatten > 0) {
    // Achata na direção da inclinação da gola (vira fita, não mangueira).
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(TILT);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      c.copy(p).sub(COLLAR.center);
      const d = c.dot(axis);
      p.addScaledVector(axis, -d * flatten);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Gravata-borboleta vermelha de bolinhas, embaixo do sorriso. */
export function bowTie(): AccessoryModel {
  const object = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.012);
  shape.bezierCurveTo(0.03, 0.03, 0.06, 0.055, 0.078, 0.046);
  shape.bezierCurveTo(0.094, 0.02, 0.094, -0.02, 0.078, -0.046);
  shape.bezierCurveTo(0.06, -0.055, 0.03, -0.03, 0, -0.012);
  shape.bezierCurveTo(-0.03, -0.03, -0.06, -0.055, -0.078, -0.046);
  shape.bezierCurveTo(-0.094, -0.02, -0.094, 0.02, -0.078, 0.046);
  shape.bezierCurveTo(-0.06, 0.055, -0.03, 0.03, 0, 0.012);
  const red = new THREE.Color('#d8343a');
  const dot = new THREE.Color('#fff4e6');
  const bow = paintVertices(extrude(shape, 0.018, 0.008, 14), (p, _n, c) => {
    const gx = p.x / 0.03;
    const gy = p.y / 0.03 + (Math.floor(gx + 0.5) % 2 ? 0.5 : 0);
    const d = Math.hypot(gx - Math.round(gx), gy - Math.round(gy));
    return c.copy(red).lerp(dot, 1 - smoothstep(0.2, 0.28, d));
  });
  const tie = joint(collarPoint(CHIN_ANGLE, -0.01).toArray() as [number, number, number], [-0.35, 0, 0]);
  tie.scale.setScalar(1.3);
  tie.add(part(bow, Mat.painted(0.7), [0, 0, 0.012]));
  tie.add(part(claySphere(0.022, 2, 0.04), Mat.fabric('#b8262d'), [0, 0, 0.026], [0, 0, 0], [1, 1.15, 0.8]));
  object.add(tie);
  // A gola: uma fitinha fina da mesma cor (quase escondida debaixo da cabeça).
  object.add(part(collarTube(0.008, 0.6), Mat.fabric('#b8262d')));
  return { object };
}

/** Bandana vermelha estampada: gola, o triângulo na frente e o nó atrás. */
export function bandana(): AccessoryModel {
  const object = new THREE.Group();
  const red = new THREE.Color('#d8403c');
  const cream = new THREE.Color('#fff1dc');
  const print = (p: THREE.Vector3, c: THREE.Color) => {
    // Estampa: florzinhas (anéis) e pontinhos numa grade torta.
    const gx = p.x / 0.034 + Math.sin(p.y * 90) * 0.2;
    const gy = p.y / 0.034 + p.z * 5;
    const d = Math.hypot(gx - Math.round(gx), gy - Math.round(gy));
    const ring = 1 - smoothstep(0.06, 0.1, Math.abs(d - 0.28));
    const speck = 1 - smoothstep(0.08, 0.12, d);
    return c.copy(red).lerp(cream, Math.max(ring, speck) * 0.9);
  };
  const cloth = Mat.painted(0.85);
  object.add(part(paintVertices(collarTube(0.022, 0.55), (p, _n, c) => print(p, c)), cloth));
  // Triângulo caindo na frente, curvado acompanhando o queixo.
  const tri = new THREE.Shape();
  tri.moveTo(-0.14, 0);
  tri.lineTo(0.14, 0);
  tri.quadraticCurveTo(0.03, -0.11, 0, -0.145);
  tri.quadraticCurveTo(-0.03, -0.11, -0.14, 0);
  const flap = extrude(tri, 0.012, 0.005, 12);
  const pos = flap.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - pos.getX(i) ** 2 * 2.2 + pos.getY(i) * 0.3);
  flap.computeVertexNormals();
  const chin = collarPoint(CHIN_ANGLE);
  object.add(part(paintVertices(flap, (p, _n, c) => print(p, c)), cloth, [chin.x, chin.y + 0.035, chin.z + 0.02], [-0.5, 0, 0]));
  // Nó atrás: duas pontinhas saindo da gola, no alto.
  const knot = collarPoint(Math.PI / 2, 0.012);
  object.add(part(claySphere(0.026, 2, 0.06), Mat.fabric('#d8403c'), knot.toArray() as [number, number, number]));
  for (const side of [1, -1]) {
    object.add(part(claySphere(0.03, 2, 0.08, 3, side), Mat.fabric('#c7362f'), [knot.x + side * 0.03, knot.y + 0.01, knot.z - 0.03], [0.4, side * 0.5, side * 0.6], [1, 0.35, 0.7]));
  }
  return { object };
}

/**
 * Cachecol de tricô listrado: a volta no pescoço, o nó do lado e as duas pontas
 * com franja que balançam (e voam pra trás correndo).
 */
export function scarf(): AccessoryModel {
  const object = new THREE.Group();
  const teal = new THREE.Color('#3aa3b3');
  const cream = new THREE.Color('#f4ead8');
  const knit = Mat.painted(0.95);
  // Relevo de tricô antes da pintura (deformar refaz a malha e perderia as cores).
  const untilt = TILT.clone().invert();
  const around = paintVertices(lumpify(collarTube(0.03, 0.35), 0.004, 90, 3), (p, _n, c) => {
    const rel = p.clone().sub(COLLAR.center).applyQuaternion(untilt);
    const a = Math.atan2(rel.y / COLLAR.ry, rel.x / COLLAR.rx);
    return c.copy(teal).lerp(cream, Math.sin(a * 9) > 0.35 ? 1 : 0);
  });
  object.add(part(around, knit));
  // Nó perto do queixo: as pontas pendem na frente do peito, entre as patas da frente.
  const knotAngle = -1.15;
  const knotAt = collarPoint(knotAngle, 0.02);
  const knot = paintVertices(claySphere(0.04, 2, 0.08, 3, 7), (_p, _n, c) => c.copy(teal));
  object.add(part(knot, knit, knotAt.toArray() as [number, number, number], [0, 0, 0], [1, 1, 0.8]));

  const tails: THREE.Bone[][] = [];
  for (const [i, spread] of [
    [0, 0.2],
    [1, -0.25],
  ] as const) {
    const length = i === 0 ? 0.22 : 0.18;
    const width = 0.062;
    const strip = new THREE.BoxGeometry(width, length, 0.016, 2, 10, 1).translate(0, -length / 2, 0);
    const fringe = new THREE.CylinderGeometry(0.004, 0.003, 0.03, 5);
    const parts: THREE.BufferGeometry[] = [strip];
    for (let f = 0; f < 5; f++) parts.push(fringe.clone().translate(-width / 2 + 0.006 + f * ((width - 0.012) / 4), -length - 0.014, 0));
    const merged = mergeParts(parts);
    paintVertices(merged, (p, _n, c) => c.copy(teal).lerp(cream, p.y < -length ? 1 : Math.sin(-p.y * 70) > 0.2 ? 1 : 0));
    const joints = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(0, -length * t, 0));
    const chain = chainSkin(merged, knit, joints, (p) => -p.y / length);
    const hang = joint(knotAt.toArray() as [number, number, number], [0.2, spread, 0.12 + i * 0.2], true);
    hang.add(chain.mesh);
    object.add(hang);
    tails.push(chain.bones);
  }
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 5, 1);
      tails.forEach((bones, t) => {
        bones.forEach((bone, i) => {
          // A raiz desconta a inclinação da cabeça: a ponta cai pra baixo mesmo empurrando a bola.
          if (i === 0) {
            bone.rotation.x = -pose.headPitch * 0.8;
            return;
          }
          // Correndo, as pontas voam pra trás (X positivo leva a ponta pra -Z) e tremulam; paradas, balançam de leve.
          const flutter = Math.sin(pose.time * (7 + t) - i * 1.3) * (0.05 + run * 0.18);
          bone.rotation.x = (run * 0.3 + pose.airborne * 0.25) * (0.5 + i * 0.25) + flutter;
          bone.rotation.z = Math.sin(pose.time * 2.1 + t * 1.7 + i) * 0.06;
        });
      });
    },
  };
}

/** Junta geometrias simples (sem índice misturado com índice) numa só. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of parts) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset);
    else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    offset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/** Sininho de vaca: coleira de couro e o sino de latão balançando embaixo do queixo. */
export function cowbell(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(collarTube(0.013, 0.55), Mat.leather('#7a4a28')));
  const brass = Mat.metal('#d4a84a');
  const chin = collarPoint(CHIN_ANGLE, 0.01);
  const pivot = joint(chin.toArray() as [number, number, number], [0, 0, 0], true);
  pivot.add(part(new THREE.TorusGeometry(0.014, 0.004, 6, 16), brass, [0, -0.01, 0]));
  const bell = lathe(
    [
      [0.001, -0.018],
      [0.022, -0.02],
      [0.028, -0.035],
      [0.034, -0.07],
      [0.04, -0.092],
      [0.036, -0.096],
      [0.03, -0.09],
    ],
    20,
    0.0015,
    3,
  );
  pivot.add(part(bell, brass, [0, 0, 0], [0, 0, 0], [1.2, 1, 0.85]));
  pivot.add(part(claySphere(0.012, 2, 0.03), Mat.metal('#6e5a3a'), [0, -0.092, 0]));
  object.add(pivot);
  let swing = 0;
  let velocity = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      // Pêndulo: o andar dá empurrõezinhos no ritmo do passo, a mola traz de volta.
      const push = Math.sin(pose.time * (4 + pose.speed * 2.2)) * Math.min(pose.speed / 3, 1) * 6 + pose.airborne * 3;
      velocity += (push - swing * 60 - velocity * 4) * pose.dt;
      swing += velocity * pose.dt;
      pivot.rotation.x = swing * 0.6 - pose.headPitch;
      pivot.rotation.z = Math.sin(pose.time * 2.3) * 0.05 + swing * 0.3;
    },
  };
}

/** Colar havaiano: flores grandes de todas as cores em volta do pescoço. */
export function lei(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(collarTube(0.009, 0.4), Mat.clay('#5f9a3e')));
  const palette: Array<[string, string]> = [
    ['#ff6fa5', '#ffd54a'],
    ['#ffd54a', '#ff8a3d'],
    ['#fbf6ee', '#ffd54a'],
    ['#ff8a3d', '#fff1a8'],
    ['#c59bff', '#fff1a8'],
  ];
  const COUNT = 15;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const [petal, center] = palette[i % palette.length];
    const bloom = flower({ petal, center, petals: 5, size: 0.1 }, i * 1.7);
    bloom.position.copy(collarPoint(a, 0.012));
    // Olhando pra fora da gola, um pouco pra frente (quem olha de frente vê as flores).
    orient(bloom, collarOut(a).multiplyScalar(0.8).add(new THREE.Vector3(0, 0.25, 0.45)));
    object.add(bloom);
  }
  return { object };
}

/** Medalha de ouro: fita azul e vermelha na gola, o disco com a estrela balançando no peito. */
export function medal(): AccessoryModel {
  const object = new THREE.Group();
  const blue = new THREE.Color('#2f5fd6');
  const red = new THREE.Color('#d8343a');
  const ribbon = paintVertices(collarTube(0.018, 0.75), (p, _n, c) => {
    const rel = p.clone().sub(COLLAR.center).applyQuaternion(TILT.clone().invert());
    const across = rel.z;
    return c.copy(blue).lerp(red, Math.abs(across) < 0.004 ? 1 : 0);
  });
  object.add(part(ribbon, Mat.painted(0.8)));
  const gold = Mat.metal('#f2c14e');
  const chin = collarPoint(CHIN_ANGLE, 0.012);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.25, 0, 0], true);
  pivot.add(part(new THREE.TorusGeometry(0.011, 0.0035, 6, 14), gold, [0, -0.008, 0]));
  pivot.add(part(extrude(circleShape(0.048), 0.01, 0.004, 28), gold, [0, -0.064, 0.004]));
  pivot.add(part(extrude(starShape(5, 0.03, 0.013), 0.006, 0.002), Mat.metal('#fff1b0'), [0, -0.064, 0.014]));
  object.add(pivot);
  return {
    object,
    update: (pose: OutfitPose) => {
      pivot.rotation.x = -0.25 - pose.headPitch * 0.8 + Math.sin(pose.time * (3 + pose.speed * 2)) * 0.08 * Math.min(pose.speed / 2, 1);
      pivot.rotation.z = Math.sin(pose.time * 1.7) * 0.04;
    },
  };
}
