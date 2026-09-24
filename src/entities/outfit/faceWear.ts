import * as THREE from 'three';
import { claySphere, clayCapsule, taperedTube } from '../../render/geometry';
import { Mat, extrude, heartShape, joint, part, starShape } from './parts';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Coisas do rosto. Origem = meio da linha dos olhos. Cada olho fica a 0,13 u
 * pro lado, virado 0,35 rad pra fora, com 0,085 u de raio (a pálpebra, 0,094):
 * a lente mora 0,1 u à frente do centro do olho, olhando pra onde ele olha.
 */

const EYE_X = 0.13;
const EYE_TURN = 0.35;
const LENS_OUT = 0.1;

/** Centro da lente do olho de um lado (1 = direita do besouro). */
function lensCenter(side: 1 | -1, out = LENS_OUT): THREE.Vector3 {
  return new THREE.Vector3(side * (EYE_X + Math.sin(EYE_TURN) * out), 0, Math.cos(EYE_TURN) * out);
}

/** Ponto na borda da lente (ângulo no plano da lente, raio `r`), já no espaço do rosto. */
function lensEdge(side: 1 | -1, angle: number, r: number): THREE.Vector3 {
  const local = new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0);
  return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), side * EYE_TURN).add(lensCenter(side));
}

/** Uma peça por olho, na frente dele. */
function perEye(build: (side: 1 | -1) => THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  for (const side of [1, -1] as const) {
    const piece = build(side);
    piece.position.copy(lensCenter(side));
    piece.rotation.y = side * EYE_TURN;
    group.add(piece);
  }
  return group;
}

/** Ponte (arquinho entre as lentes) e as hastes que vão pra trás, pelos lados dos olhos. */
function bridgeAndArms(material: THREE.Material, halfWidth: number, radius: number, lift = 0.012): THREE.Group {
  const group = new THREE.Group();
  const inner = lensEdge(1, Math.PI, halfWidth);
  const bridge = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-inner.x, lift, inner.z),
    new THREE.Vector3(0, lift + 0.03, inner.z + 0.015),
    new THREE.Vector3(inner.x, lift, inner.z),
  );
  group.add(part(taperedTube(bridge, 12, () => radius, 8), material));
  for (const side of [1, -1] as const) {
    const outer = lensEdge(side, 0, halfWidth);
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(outer.x, lift + 0.004, outer.z),
      new THREE.Vector3(outer.x + side * 0.012, lift + 0.01, outer.z - 0.06),
      new THREE.Vector3(outer.x + side * 0.004, lift + 0.02, outer.z - 0.17),
    ]);
    group.add(part(taperedTube(arm, 12, () => radius, 8), material));
  }
  return group;
}

/** Retângulo de cantos redondos (lente de óculos escuros). */
function roundedRect(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

/** Risquinho de brilho na lente (diagonal, em cima e pro lado de dentro). */
function lensGlint(side: 1 | -1, offset: number): THREE.Mesh {
  return part(clayCapsule(0.0055, 0.035, 0, 0, 8), Mat.glossy('#ffffff'), [-side * 0.025, 0.02, offset], [0, 0, side * 0.75], [1, 1, 0.35]);
}

/** Óculos escuros: lentes pretas espelhadas, armação grossa. */
export function sunglasses(): AccessoryModel {
  const object = new THREE.Group();
  const frame = Mat.plastic('#17141d');
  const lens = Mat.glossy('#221d2c');
  const lensGeo = extrude(roundedRect(0.15, 0.105, 0.04), 0.008, 0.003);
  const frameGeo = extrude(roundedRect(0.172, 0.126, 0.05), 0.01, 0.004);
  object.add(
    perEye((side) => {
      const eye = new THREE.Group();
      eye.add(part(frameGeo, frame, [0, 0, -0.004]));
      eye.add(part(lensGeo, lens, [0, 0, 0.004]));
      eye.add(lensGlint(side, 0.011));
      return eye;
    }),
  );
  object.add(bridgeAndArms(frame, 0.086, 0.008, 0.02));
  object.position.y = 0.004;
  return { object };
}

/** Óculos redondos de aro fino dourado (sem lente: só o reflexo). */
export function roundGlasses(): AccessoryModel {
  const object = new THREE.Group();
  const wire = Mat.metal('#c9a24a');
  const rimGeo = new THREE.TorusGeometry(0.072, 0.0065, 8, 40);
  const glintGeo = new THREE.TorusGeometry(0.05, 0.0035, 6, 16, 1.0);
  object.add(
    perEye((side) => {
      const eye = new THREE.Group();
      eye.add(part(rimGeo, wire));
      eye.add(part(glintGeo, Mat.glossy('#ffffff'), [0, 0, 0.004], [0, 0, side > 0 ? 2.0 : 0.15]));
      return eye;
    }),
  );
  object.add(bridgeAndArms(wire, 0.072, 0.005, 0.01));
  return { object };
}

/** Óculos de coração cor-de-rosa. */
export function heartGlasses(): AccessoryModel {
  const object = new THREE.Group();
  const frame = Mat.plastic('#ff3d8b');
  const lens = Mat.glossy('#ff9cc8');
  const lensGeo = extrude(heartShape(0.148), 0.008, 0.003);
  const frameGeo = extrude(heartShape(0.176), 0.01, 0.004);
  object.add(
    perEye((side) => {
      const eye = new THREE.Group();
      eye.add(part(frameGeo, frame, [0, 0.006, -0.004]));
      eye.add(part(lensGeo, lens, [0, 0.006, 0.004]));
      eye.add(lensGlint(side, 0.011));
      return eye;
    }),
  );
  object.add(bridgeAndArms(frame, 0.084, 0.008, 0.022));
  return { object };
}

/** Óculos de estrela: lente laranja e armação dourada, de festa. */
export function starGlasses(): AccessoryModel {
  const object = new THREE.Group();
  const frame = Mat.metal('#f2c14e');
  const lens = Mat.glossy('#ff9f3a');
  const lensGeo = extrude(starShape(5, 0.078, 0.04), 0.008, 0.003);
  const frameGeo = extrude(starShape(5, 0.094, 0.05), 0.01, 0.004);
  object.add(
    perEye((side) => {
      const eye = new THREE.Group();
      eye.add(part(frameGeo, frame, [0, 0, -0.004]));
      eye.add(part(lensGeo, lens, [0, 0, 0.004]));
      eye.add(lensGlint(side, 0.011));
      return eye;
    }),
  );
  object.add(bridgeAndArms(frame, 0.06, 0.007, 0.018));
  return { object };
}

/** Bigode de guidão, com as pontas enroladinhas, entre os olhos e o sorriso. */
export function mustache(): AccessoryModel {
  const object = new THREE.Group();
  const hair = Mat.clay('#3a2a22');
  const radius = (t: number) => (t < 0.3 ? 0.017 : 0.017 - (t - 0.3) * 0.02) + 0.001;
  for (const side of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.004),
      new THREE.Vector3(side * 0.035, -0.012, 0),
      new THREE.Vector3(side * 0.072, -0.008, -0.012),
      new THREE.Vector3(side * 0.098, 0.018, -0.026),
      new THREE.Vector3(side * 0.09, 0.04, -0.028),
      new THREE.Vector3(side * 0.076, 0.034, -0.024),
    ]);
    object.add(part(taperedTube(curve, 28, radius, 10), hair));
  }
  object.add(part(claySphere(0.021, 2, 0.04), hair, [0, -0.004, 0.006], [0, 0, 0], [1.2, 0.85, 0.8]));
  object.position.set(0, -0.083, 0.14);
  object.scale.setScalar(1.3);
  object.rotation.x = -0.1;
  return { object };
}

/** Monóculo de ouro no olho direito, com a correntinha e um brilho que passa de vez em quando. */
export function monocle(): AccessoryModel {
  const object = new THREE.Group();
  const gold = Mat.metal('#e0b44a');
  const eye = joint();
  eye.position.copy(lensCenter(1, LENS_OUT + 0.004));
  eye.rotation.y = EYE_TURN;
  eye.add(part(new THREE.TorusGeometry(0.074, 0.009, 10, 44), gold));
  eye.add(part(new THREE.TorusGeometry(0.05, 0.0035, 6, 16, 1.0), Mat.glossy('#ffffff'), [0, 0, 0.004], [0, 0, 2.0]));
  const sparkleMat = Mat.glow('#ffffff', 2.4);
  const sparkle = part(extrude(starShape(4, 0.02, 0.005), 0.002, 0.0008), sparkleMat, [-0.045, 0.05, 0.01]);
  sparkle.userData.keep = true;
  eye.add(sparkle);
  object.add(eye);
  // Correntinha: elos alternados descendo da borda de fora até o "pescoço".
  const start = lensEdge(1, -0.5, 0.078);
  const chain = new THREE.CatmullRomCurve3([
    start,
    start.clone().add(new THREE.Vector3(0.025, -0.06, -0.02)),
    start.clone().add(new THREE.Vector3(0.02, -0.13, -0.07)),
    start.clone().add(new THREE.Vector3(-0.005, -0.16, -0.14)),
  ]);
  const linkGeo = new THREE.TorusGeometry(0.007, 0.0022, 5, 10);
  const links = Math.round(chain.getLength() / 0.011);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i <= links; i++) {
    const t = i / links;
    chain.getPointAt(t, point);
    chain.getTangentAt(t, tangent);
    const link = part(linkGeo, gold, [point.x, point.y, point.z]);
    link.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    link.rotateX(i % 2 ? Math.PI / 2 : 0);
    object.add(link);
  }
  sparkle.scale.setScalar(0);
  return {
    object,
    update: (pose: OutfitPose) => {
      const phase = pose.time % 4.2;
      const k = phase < 0.6 ? Math.sin((phase / 0.6) * Math.PI) : 0;
      sparkle.scale.setScalar(k);
      sparkle.rotation.z = pose.time * 2.5;
    },
  };
}
