import * as THREE from 'three';
import { claySphere, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { shapeFrom } from './backWear';
import { bridgeAndArms, perEye } from './faceWear';
import { TILT, collarOut, collarPoint, collarTube } from './neckWear';
import { Mat, extrude, flatRing, joint, lathe, orient, part } from './parts';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Temporada Florada (primavera no jardim): os exclusivos do passe. Brotinho,
 * chapéu de cogumelo, óculos de margarida, gola de pétalas e a pipa.
 */

/** Folhinha (contorno de folha com a ponta fina), deitada no plano XZ e dobrada no meio. */
function leafGeometry(length: number, width: number, color: string, vein: string): THREE.BufferGeometry {
  const half: Array<[number, number]> = [
    [0, 0],
    [width * 0.45, length * 0.25],
    [width * 0.5, length * 0.55],
    [width * 0.3, length * 0.85],
    [0, length],
  ];
  const shape = shapeFrom([...half, ...half.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])], false);
  const geometry = extrude(shape, 0.006, 0.0025, 16).rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  // Dobra no meio (nervura) e a ponta caindo.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = -pos.getZ(i);
    pos.setY(i, pos.getY(i) + Math.abs(x) * 0.35 - (z / length) ** 2 * length * 0.25);
  }
  geometry.computeVertexNormals();
  const base = new THREE.Color(color);
  const line = new THREE.Color(vein);
  return paintVertices(geometry, (p, _n, c) => c.copy(base).lerp(line, (1 - smoothstep(0.002, 0.006, Math.abs(p.x))) * 0.8));
}

/** Brotinho nascendo da cabeça: o talo e as duas folhas, balançando com o passo. */
export function sprout(): AccessoryModel {
  const object = new THREE.Group();
  const stemJoint = joint([0, -0.01, 0.02], [0, 0, 0], true);
  const STEM = 0.13;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.012, STEM * 0.5, 0.005), new THREE.Vector3(0, STEM, 0)]);
  stemJoint.add(part(taperedTube(curve, 16, (t) => 0.011 - t * 0.004, 8), Mat.clay('#5aa33c')));
  // Montinho de terra de onde ele sai.
  object.add(part(claySphere(0.035, 2, 0.12, 3, 4), Mat.clay('#7b4c2a'), [0, -0.01, 0.02], [0, 0, 0], [1.2, 0.45, 1.1]));
  const leafMat = Mat.painted(0.6);
  const leaves: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const hinge = joint([0, STEM, 0], [0, side > 0 ? 0 : Math.PI, 0.45], true);
    hinge.add(part(leafGeometry(0.1, 0.07, '#7cc84e', '#4f8f30'), leafMat, [0, 0, 0], [0, Math.PI / 2, 0]));
    leaves.push(hinge);
    stemJoint.add(hinge);
  }
  stemJoint.add(part(claySphere(0.012, 2, 0.05), Mat.clay('#a6e07a'), [0, STEM + 0.006, 0]));
  object.add(stemJoint);
  object.scale.setScalar(1.35);
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      stemJoint.rotation.x = -run * 0.35 + Math.sin(pose.time * 3 + 0.5) * (0.05 + run * 0.08) - pose.airborne * 0.2;
      stemJoint.rotation.z = Math.sin(pose.time * 1.8) * 0.1;
      leaves.forEach((leaf, i) => (leaf.rotation.z = 0.45 + Math.sin(pose.time * 4 + i * 1.3) * (0.08 + run * 0.1) + pose.airborne * 0.3));
    },
  };
}

/** Chapéu de cogumelo (amanita): a cúpula vermelha de bolinhas brancas e as lamelas creme embaixo. */
export function mushroomCap(): AccessoryModel {
  const object = new THREE.Group();
  const red = new THREE.Color('#e0362f');
  const dome = paintVertices(
    lathe(
      [
        [0.19, -0.012],
        [0.2, 0.01],
        [0.185, 0.06],
        [0.14, 0.12],
        [0.07, 0.155],
        [0, 0.165],
      ],
      48,
      0.005,
      29,
    ),
    (_p, _n, c) => c.copy(red),
  );
  object.add(part(dome, Mat.painted(0.4)));
  // Lamelas: anel creme com vincos, por baixo da aba.
  const gills = paintVertices(
    lathe(
      [
        [0.1, 0.0],
        [0.19, -0.012],
      ],
      96,
      0,
    ),
    (p, _n, c) => c.set('#f1e3c4').multiplyScalar(0.85 + 0.15 * Math.abs(Math.sin(Math.atan2(p.z, p.x) * 24))),
  );
  object.add(part(gills, Mat.painted(0.9)));
  // Bolinhas brancas espalhadas pela cúpula (olhando pra fora).
  const spot = claySphere(0.022, 2, 0.08, 3, 3);
  const white = Mat.clay('#fbf6ee');
  const spots: Array<[number, number]> = [
    [0.3, 0.2],
    [1.4, 0.35],
    [2.5, 0.25],
    [3.6, 0.4],
    [4.7, 0.22],
    [5.7, 0.33],
    [0.9, 0.62],
    [2.2, 0.7],
    [3.3, 0.6],
    [4.4, 0.72],
    [5.4, 0.6],
    [1.6, 1.05],
    [4.0, 1.1],
  ];
  for (const [angle, polar] of spots) {
    const r = 0.195 * Math.sin(Math.min(polar + 0.4, Math.PI / 2));
    const y = 0.02 + 0.14 * (1 - polar / 1.25);
    const at = new THREE.Vector3(Math.cos(angle) * r * (1 - polar * 0.35), y, Math.sin(angle) * r * (1 - polar * 0.35));
    const dot = part(spot, white, at.toArray() as [number, number, number], [0, 0, 0], [1, 0.4, 1]);
    orient(dot, new THREE.Vector3(at.x, 0.12 + polar * 0.1, at.z));
    object.add(dot);
  }
  object.scale.setScalar(0.82);
  object.rotation.set(-0.06, 0, 0.08);
  return { object, hidesHorn: true };
}

/** Óculos de margarida: pétalas brancas em volta de lentes amarelinhas. */
export function daisyGlasses(): AccessoryModel {
  const object = new THREE.Group();
  const petal = new THREE.SphereGeometry(0.02, 10, 8);
  const white = Mat.clay('#fdfaf3');
  const lens = Mat.glossy('#ffd84a');
  object.add(
    perEye(() => {
      const eye = new THREE.Group();
      eye.add(part(extrude(new THREE.Shape().absarc(0, 0, 0.056, 0, Math.PI * 2, false), 0.008, 0.003, 28), lens));
      eye.add(part(flatRing(0.056, 0.007, 8, 32).rotateX(Math.PI / 2), Mat.clay('#f2b62e')));
      const COUNT = 12;
      for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        eye.add(part(petal, white, [Math.cos(a) * 0.082, Math.sin(a) * 0.082, -0.004], [0, 0, a], [1.35, 0.55, 0.35]));
      }
      return eye;
    }),
  );
  object.add(bridgeAndArms(Mat.clay('#5aa33c'), 0.1, 0.006, 0.01));
  object.scale.setScalar(0.8);
  object.position.z = 0.02;
  return { object };
}

/** Gola de pétalas: duas voltas de pétalas grandes em volta do pescoço (a cabeça vira o miolo da flor). */
export function petalCollar(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(collarTube(0.012, 0.5), Mat.clay('#4f8f30')));
  const petalGeo = claySphere(0.05, 2, 0.05, 3, 7);
  const rings: Array<{ count: number; grow: number; colors: string[]; scale: [number, number, number]; tilt: number }> = [
    { count: 14, grow: 0.045, colors: ['#ff9fc4', '#ffc2d8'], scale: [1.45, 0.3, 0.8], tilt: 0.1 },
    { count: 14, grow: 0.02, colors: ['#fff3f7', '#ffe2ec'], scale: [1.1, 0.28, 0.7], tilt: 0.35 },
  ];
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(TILT);
  rings.forEach((ring, k) => {
    const mats = ring.colors.map((c) => Mat.clay(c));
    for (let i = 0; i < ring.count; i++) {
      const a = ((i + k * 0.5) / ring.count) * Math.PI * 2;
      const out = collarOut(a);
      const at = collarPoint(a, ring.grow + 0.04);
      const petalMesh = part(petalGeo, mats[i % 2], at.toArray() as [number, number, number]);
      // A pétala deita na direção pra fora da gola e levanta um pouco pra frente.
      const dir = out.clone().multiplyScalar(1).addScaledVector(normal, ring.tilt).normalize();
      petalMesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      petalMesh.scale.set(...ring.scale);
      object.add(petalMesh);
    }
  });
  // Centro: o miolo fica na emenda, discreto (a cabeça é o miolo de verdade).
  object.add(part(collarTube(0.016, 0.3), Mat.clay('#f2b62e'), [0, 0, 0], [0, 0, 0], [1.02, 1.02, 1.02]));
  return { object };
}

/**
 * Pipa: o losango colorido voando lá no alto, preso nas costas por uma linha
 * comprida, com a rabiola de lacinhos. Sobe e desce no vento.
 */
export function kite(): AccessoryModel {
  const object = new THREE.Group();
  const flight = joint([-0.1, 0.02, -0.3], [0, 0, 0], true);
  const KITE = new THREE.Vector3(0, 0.95, -0.55);
  const line = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.35, -0.45), KITE.clone().add(new THREE.Vector3(0, -0.1, 0.02)));
  flight.add(part(taperedTube(line, 30, () => 0.0025, 4), Mat.fabric('#fbf6ee')));
  const body = joint(KITE.toArray() as [number, number, number], [0.35, 0, 0], true);
  // Losango em quatro triângulos de cores diferentes.
  const W = 0.14;
  const TOP = 0.2;
  const BOTTOM = 0.12;
  const colors = ['#ff5f7e', '#ffd54a', '#4fb6ff', '#7ee07b'];
  const quads: Array<[number, number, number, number]> = [
    [0, TOP, -W, 0],
    [0, TOP, W, 0],
    [-W, 0, 0, -BOTTOM],
    [W, 0, 0, -BOTTOM],
  ];
  quads.forEach(([x1, y1, x2, y2], i) => {
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(x1, y1);
    tri.lineTo(x2, y2);
    tri.closePath();
    body.add(part(extrude(tri, 0.006, 0.002, 2), Mat.plastic(colors[i])));
  });
  const stick = Mat.clay('#8a5a30');
  body.add(part(new THREE.CylinderGeometry(0.004, 0.004, TOP + BOTTOM, 6), stick, [0, (TOP - BOTTOM) / 2, 0.006]));
  body.add(part(new THREE.CylinderGeometry(0.004, 0.004, W * 2, 6).rotateZ(Math.PI / 2), stick, [0, 0, 0.006]));
  // Rabiola: fio com lacinhos.
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -BOTTOM, 0),
    new THREE.Vector3(0.03, -BOTTOM - 0.1, 0.02),
    new THREE.Vector3(-0.02, -BOTTOM - 0.2, 0.04),
    new THREE.Vector3(0.02, -BOTTOM - 0.3, 0.05),
  ]);
  const tail = joint([0, 0, 0], [0, 0, 0], true);
  tail.add(part(taperedTube(tailCurve, 24, () => 0.002, 4), Mat.fabric('#fbf6ee')));
  const bow = claySphere(0.018, 1, 0.05, 3, 2);
  for (let i = 1; i <= 4; i++) {
    const at = tailCurve.getPointAt(i / 4.4);
    for (const side of [1, -1]) {
      tail.add(part(bow, Mat.fabric(colors[(i + (side > 0 ? 0 : 2)) % 4]), [at.x + side * 0.014, at.y, at.z], [0, 0, side * 0.5], [1.2, 0.5, 0.5]));
    }
  }
  body.add(tail);
  flight.add(body);
  object.add(flight);
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      flight.rotation.x = -pose.headPitch * 0.8 - run * 0.25 + Math.sin(pose.time * 0.7) * 0.06;
      flight.rotation.z = Math.sin(pose.time * 0.5) * 0.16 + Math.sin(pose.time * 1.7) * 0.03;
      body.rotation.z = Math.sin(pose.time * 1.3) * 0.25;
      body.rotation.x = 0.35 + Math.sin(pose.time * 1.1) * 0.12;
      tail.rotation.z = Math.sin(pose.time * 3.2) * 0.35;
    },
  };
}
