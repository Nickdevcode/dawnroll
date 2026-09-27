import * as THREE from 'three';
import { claySphere, clayCapsule, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { brim, Mat, flatRing, joint, lathe, part } from './parts';
import { CHIN_ANGLE, collarPoint, collarTube } from './neckWear';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Só em baú: os exclusivos que dão vontade de abrir mais um. Chapéu de sapo,
 * disco voador, visor neon, o amuleto de escaravelho e as asas de anjo.
 */

/** Chapéu de sapinho: pescador verde com os olhões em cima, bochechas rosadas e o sorriso. */
export function frogHat(): AccessoryModel {
  const object = new THREE.Group();
  const green = Mat.felt('#6cc24a');
  const crown = lathe(
    [
      [0.118, -0.004],
      [0.117, 0.05],
      [0.108, 0.098],
      [0.084, 0.118],
      [0, 0.122],
    ],
    44,
    0.003,
    31,
  );
  object.add(part(crown, green));
  object.add(part(brim(0.112, 0.19, 0.014, (_a, t) => -t * 0.045), Mat.felt('#5aad3a')));
  for (const side of [1, -1]) {
    const eye = joint([side * 0.055, 0.115, 0.03]);
    eye.add(part(claySphere(0.042, 3, 0.03, 2, side), green, [0, 0, 0], [0, 0, 0], [1, 0.9, 1]));
    eye.add(part(claySphere(0.03, 3, 0.01), Mat.clay('#fbf6ee'), [0, 0.012, 0.022]));
    eye.add(part(claySphere(0.016, 2, 0), Mat.glossy('#1f1c24'), [0, 0.014, 0.046]));
    eye.add(part(claySphere(0.006, 1, 0), Mat.glossy('#ffffff'), [-0.006, 0.022, 0.058]));
    object.add(eye);
    object.add(part(claySphere(0.018, 2, 0), Mat.clay('#ff9fb3'), [side * 0.078, 0.045, 0.086], [0, 0, 0], [1, 0.6, 0.4]));
  }
  const smile = new THREE.TorusGeometry(0.04, 0.005, 6, 20, Math.PI * 0.8);
  object.add(part(smile, Mat.clay('#2f5a1c'), [0, 0.06, 0.112], [0.25, 0, Math.PI + Math.PI * 0.1]));
  object.rotation.set(0.02, 0, 0.06);
  return { object, hidesHorn: true };
}

/**
 * Disco voador pairando em cima da cabeça: cúpula de vidro com um ETzinho,
 * luzes piscando em volta e girando devagar.
 */
export function ufo(): AccessoryModel {
  const object = new THREE.Group();
  const hover = joint([0, 0.17, -0.02], [0, 0, 0], true);
  const saucer = lathe(
    [
      [0.001, -0.03],
      [0.06, -0.028],
      [0.15, -0.006],
      [0.17, 0.004],
      [0.15, 0.016],
      [0.08, 0.03],
      [0.001, 0.034],
    ],
    48,
    0.002,
    37,
  );
  const spin = joint([0, 0, 0], [0, 0, 0], true);
  spin.add(part(saucer, Mat.metal('#b9c3d1')));
  spin.add(part(flatRing(0.155, 0.008, 8, 48), Mat.metal('#7e8a9c'), [0, 0.006, 0]));
  // Luzes: duas turmas que piscam alternadas.
  const onMat = Mat.glow('#ffe36b', 2.6);
  const offMat = Mat.glow('#6bf0ff', 2.6);
  const lights: THREE.Mesh[] = [];
  const bulb = new THREE.SphereGeometry(0.011, 10, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const light = part(bulb, i % 2 ? onMat : offMat, [Math.cos(a) * 0.152, 0.013, Math.sin(a) * 0.152]);
    light.userData.keep = true;
    lights.push(light);
    spin.add(light);
  }
  hover.add(spin);
  // Cúpula de vidro com o piloto.
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfefff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false });
  hover.add(part(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0, 0.028, 0]));
  const alien = joint([0, 0.03, 0]);
  alien.add(part(claySphere(0.03, 3, 0.03), Mat.clay('#8fe36b'), [0, 0.03, 0], [0, 0, 0], [1, 1.1, 1]));
  for (const side of [1, -1]) {
    alien.add(part(claySphere(0.011, 2, 0), Mat.glossy('#1f1c24'), [side * 0.012, 0.036, 0.024], [0, 0, side * 0.5], [1, 1.4, 0.6]));
    alien.add(part(taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(side * 0.01, 0.055, 0), new THREE.Vector3(side * 0.02, 0.075, 0), new THREE.Vector3(side * 0.026, 0.085, 0.004)), 6, () => 0.002, 4), Mat.clay('#6cc24a')));
    alien.add(part(new THREE.SphereGeometry(0.005, 8, 6), Mat.glow('#fff4a8', 2), [side * 0.026, 0.087, 0.004]));
  }
  hover.add(alien);
  object.add(hover);
  return {
    object,
    update: (pose: OutfitPose) => {
      hover.position.y = 0.17 + Math.sin(pose.time * 2.1) * 0.015;
      hover.rotation.z = Math.sin(pose.time * 1.3) * 0.08;
      hover.rotation.x = -pose.headPitch * 0.5 + Math.sin(pose.time * 1.7) * 0.05;
      spin.rotation.y = pose.time * 1.8;
      alien.rotation.y = Math.sin(pose.time * 0.8) * 0.6;
      const blink = Math.floor(pose.time * 3) % 2;
      lights.forEach((light, i) => light.scale.setScalar(i % 2 === blink ? 1.25 : 0.55));
    },
  };
}

/** Visor neon: faixa escura espelhada abraçando os olhos, com a luz de varredura indo e voltando. */
export function cyberVisor(): AccessoryModel {
  const object = new THREE.Group();
  const R = 0.26;
  const ARC = 1.9;
  const band = new THREE.CylinderGeometry(R, R, 0.075, 40, 1, true, -ARC / 2, ARC);
  const visor = joint([0, 0.005, -0.09]);
  // Vidro fumê: dá pra ver os olhos atrás, meio escondidos.
  visor.add(part(band, new THREE.MeshPhysicalMaterial({ color: '#2a2450', roughness: 0.08, metalness: 0.3, clearcoat: 1, transparent: true, opacity: 0.72, side: THREE.DoubleSide })));
  // Bordas de cima e de baixo (tubinhos).
  for (const y of [0.0375, -0.0375]) {
    const edge = new THREE.EllipseCurve(0, 0, R, R, Math.PI / 2 - ARC / 2, Math.PI / 2 + ARC / 2, false, 0);
    const points = edge.getPoints(30).map((p) => new THREE.Vector3(p.x, y, p.y));
    visor.add(part(taperedTube(new THREE.CatmullRomCurve3(points), 30, () => 0.006, 6), Mat.plastic('#c9d2e0')));
  }
  object.add(visor);
  const scanMat = Mat.glow('#35f2ff', 3.2);
  const scan = joint([0, 0.005, -0.09], [0, 0, 0], true);
  const scanner = part(clayCapsule(0.009, 0.03, 0, 0, 8), scanMat, [0, 0, R + 0.004]);
  scanner.userData.keep = true;
  scan.add(scanner);
  object.add(scan);
  return {
    object,
    update: (pose: OutfitPose) => {
      scan.rotation.y = Math.sin(pose.time * 2.2) * (ARC / 2 - 0.08);
    },
  };
}

/**
 * Amuleto de escaravelho (o Khepri no peito): gola egípcia larga em faixas de
 * ouro, lápis-lazúli e turquesa, e o escaravelho de asas abertas com a pedra
 * que acende devagar.
 */
export function scarabAmulet(): AccessoryModel {
  const object = new THREE.Group();
  const gold = new THREE.Color('#f2c14e');
  const lapis = new THREE.Color('#2a4fb8');
  const turquoise = new THREE.Color('#3fc6c0');
  const collar = paintVertices(collarTube(0.03, 0.8), (p, _n, c) => {
    const bands = Math.floor((Math.atan2(p.y - 0.03, p.x) + Math.PI) * 5) % 3;
    const col = bands === 0 ? gold : bands === 1 ? lapis : turquoise;
    return c.copy(col);
  });
  object.add(part(collar, Mat.painted(0.3)));
  const goldMat = Mat.metal('#f2c14e');
  const chin = collarPoint(CHIN_ANGLE, 0.03);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.25, 0, 0], true);
  // Corpo do escaravelho.
  pivot.add(part(claySphere(0.03, 3, 0.02), goldMat, [0, -0.06, 0.008], [0, 0, 0], [0.8, 1.05, 0.45]));
  pivot.add(part(claySphere(0.016, 2, 0.02), goldMat, [0, -0.028, 0.008], [0, 0, 0], [1, 0.7, 0.45]));
  // Asas abertas em leque (penas de lápis e ouro).
  const feather = clayCapsule(0.008, 0.05, 0.02, 3, 6);
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const a = side * (0.6 + i * 0.28);
      const len = 0.05 + i * 0.006;
      pivot.add(
        part(feather, i % 2 ? Mat.metal('#f2c14e') : Mat.clay('#2a4fb8'), [side * (0.03 + Math.cos(0.5 - i * 0.3) * 0.022), -0.05 - i * 0.004, 0.004], [0, 0, a], [1, len / 0.05, 0.45]),
      );
    }
  }
  // Pedra que acende.
  const gemMat = Mat.glow('#6ff0ff', 1.6);
  const gem = part(claySphere(0.014, 2, 0), gemMat, [0, -0.06, 0.024], [0, 0, 0], [1, 1.1, 0.6]);
  gem.userData.keep = true;
  pivot.add(gem);
  object.add(pivot);
  let swing = 0;
  let velocity = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      const push = Math.sin(pose.time * (4 + pose.speed * 2)) * Math.min(pose.speed / 3, 1) * 5 + pose.airborne * 3;
      velocity += (push - swing * 55 - velocity * 4) * pose.dt;
      swing += velocity * pose.dt;
      pivot.rotation.x = -0.25 + swing * 0.4 - pose.headPitch * 0.85;
      pivot.rotation.z = Math.sin(pose.time * 1.6) * 0.04 + swing * 0.2;
      gem.scale.setScalar(0.85 + 0.25 * (0.5 + 0.5 * Math.sin(pose.time * 2.4)));
    },
  };
}

/** Asas de anjo: penas brancas em leque com as pontas douradas, batendo devagar (e brilhando de leve). */
export function angelWings(): AccessoryModel {
  const object = new THREE.Group();
  const white = new THREE.Color('#fbf8f2');
  const cream = new THREE.Color('#efe4cf');
  const gold = new THREE.Color('#f6cf5a');
  const featherGeo = (length: number, seed: number) =>
    paintVertices(clayCapsule(0.022, length, 0.04, seed, 8), (p, _n, c) => {
      const t = (p.y + length / 2 + 0.022) / (length + 0.044);
      return c.copy(cream).lerp(white, smoothstep(0, 0.4, t)).lerp(gold, smoothstep(0.78, 0.95, t) * 0.9);
    });
  const material = Mat.painted(0.55);
  const hinges: THREE.Group[] = [];
  for (const side of [1, -1] as const) {
    const hinge = joint([side * 0.05, 0.08, -0.14], [0, 0, 0], true);
    // Três fileiras: as primárias (compridas, na ponta) e as de cobertura (curtas, perto do ombro).
    const rows: Array<{ count: number; length: number; reach: number; spread: number; lift: number }> = [
      { count: 9, length: 0.3, reach: 0.22, spread: 1.15, lift: 0.0 },
      { count: 8, length: 0.2, reach: 0.14, spread: 1.0, lift: 0.02 },
      { count: 6, length: 0.11, reach: 0.07, spread: 0.85, lift: 0.035 },
    ];
    rows.forEach((row, r) => {
      const geo = featherGeo(row.length, r * 3 + (side > 0 ? 1 : 2));
      for (let i = 0; i < row.count; i++) {
        const k = i / (row.count - 1);
        const a = side * (0.25 + k * row.spread);
        const x = side * (0.04 + Math.sin(Math.abs(a)) * row.reach);
        const y = row.lift + Math.cos(a) * row.reach * 0.6 - k * 0.05;
        const feather = part(geo, material, [x, y, -0.01 * r], [0.25, 0, -a + side * 0.3], [1, 1, 0.35]);
        feather.translateY(row.length / 2);
        hinge.add(feather);
      }
    });
    hinges.push(hinge);
    object.add(hinge);
  }
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      const beat = Math.sin(pose.time * (2.2 + run * 4 + pose.airborne * 5));
      const open = 0.25 + beat * (0.12 + run * 0.12 + pose.airborne * 0.15);
      hinges[0].rotation.z = -open;
      hinges[1].rotation.z = open;
      for (const hinge of hinges) hinge.rotation.x = -0.35 - run * 0.2;
    },
  };
}
