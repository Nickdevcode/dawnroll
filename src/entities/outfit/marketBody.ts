import * as THREE from 'three';
import { claySphere, clayCapsule, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { shapeFrom } from './backWear';
import { CHIN_ANGLE, collarPoint, collarTube } from './neckWear';
import { Mat, circleShape, extrude, joint, lathe, part } from './parts';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Feirinha, pescoço e costas: gravata, apito, colar de pérolas, balão,
 * casca de caracol, guarda-chuva de folha, violão (moedas) e o cordão de ouro e
 * as asas de libélula (orvalho). Pescoço com origem no centro da cabeça (a gola
 * de `neckWear.ts`), costas no topo delas (`backWear.ts`).
 */

/** Pêndulo com mola: o que pende do queixo balança no ritmo do passo e cai "pra baixo". */
function pendulum(pivot: THREE.Object3D, rest = 0, stiffness = 60): (pose: OutfitPose) => void {
  let swing = 0;
  let velocity = 0;
  return (pose) => {
    const push = Math.sin(pose.time * (4 + pose.speed * 2.2)) * Math.min(pose.speed / 3, 1) * 6 + pose.airborne * 3;
    velocity += (push - swing * stiffness - velocity * 4) * pose.dt;
    swing += velocity * pose.dt;
    pivot.rotation.x = rest + swing * 0.5 - pose.headPitch * 0.9;
    pivot.rotation.z = Math.sin(pose.time * 2.1) * 0.04 + swing * 0.25;
  };
}

/** Gravata azul-marinho com listras diagonais douradas e o nó. */
export function tie(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(collarTube(0.01, 0.6), Mat.fabric('#23305c')));
  const navy = new THREE.Color('#23305c');
  const gold = new THREE.Color('#e8b640');
  // Curtinha e larga: o queixo do besouro fica quase no chão (uma gravata comprida sumiria na grama).
  const blade = new THREE.Shape();
  blade.moveTo(-0.024, 0);
  blade.lineTo(0.024, 0);
  blade.lineTo(0.05, -0.085);
  blade.lineTo(0, -0.118);
  blade.lineTo(-0.05, -0.085);
  blade.closePath();
  const bladeGeo = paintVertices(extrude(blade, 0.012, 0.005, 4), (p, _n, c) => {
    const stripe = Math.abs(Math.sin((p.x + p.y) * 60)) > 0.88 ? 1 : 0;
    return c.copy(navy).lerp(gold, stripe);
  });
  const chin = collarPoint(CHIN_ANGLE, 0.005);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.75, 0, 0], true);
  pivot.add(part(bladeGeo, Mat.painted(0.75), [0, -0.012, 0.006]));
  pivot.add(part(claySphere(0.022, 2, 0.04), Mat.fabric('#23305c'), [0, -0.006, 0.012], [0, 0, 0], [1, 1.1, 0.75]));
  object.add(pivot);
  return { object, update: pendulum(pivot, -0.75) };
}

/** Apito de juiz prateado no cordãozinho vermelho. */
export function whistle(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(collarTube(0.006, 0.3), Mat.fabric('#d8343a')));
  const steel = Mat.metal('#c9ced6');
  const chin = collarPoint(CHIN_ANGLE, 0.01);
  const pivot = joint(chin.toArray() as [number, number, number], [0, 0, 0], true);
  pivot.add(part(new THREE.TorusGeometry(0.012, 0.0035, 6, 14), steel, [0, -0.01, 0]));
  // Corpo: cilindro deitado com a boquinha pra frente.
  pivot.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 20).rotateZ(Math.PI / 2), steel, [0, -0.052, 0.004]));
  pivot.add(part(new THREE.BoxGeometry(0.03, 0.02, 0.05), steel, [0, -0.04, 0.035]));
  pivot.add(part(new THREE.BoxGeometry(0.022, 0.006, 0.016), Mat.plastic('#2c2a33'), [0, -0.036, 0.02]));
  object.add(pivot);
  return { object, update: pendulum(pivot) };
}

/** Colar de pérolas: uma volta de pérolas perfeitas e a gota maior pendurada na frente. */
export function pearls(): AccessoryModel {
  const object = new THREE.Group();
  const pearl = Mat.glossy('#f4ede4');
  const bead = new THREE.SphereGeometry(0.017, 14, 10);
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    object.add(part(bead, pearl, collarPoint(a, 0.012).toArray() as [number, number, number]));
  }
  const chin = collarPoint(CHIN_ANGLE, 0.02);
  object.add(part(new THREE.SphereGeometry(0.028, 16, 12), pearl, [chin.x, chin.y - 0.035, chin.z + 0.012], [0, 0, 0], [1, 1.2, 1]));
  object.add(part(claySphere(0.009, 1, 0), Mat.metal('#e0b44a'), [chin.x, chin.y - 0.006, chin.z + 0.01]));
  return { object };
}

/** Cordão de ouro grosso com o medalhão do besouro balançando no peito. */
export function goldChain(): AccessoryModel {
  const object = new THREE.Group();
  const gold = Mat.metal('#f2c14e');
  const link = new THREE.TorusGeometry(0.014, 0.0055, 8, 16);
  const COUNT = 34;
  const tangent = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const p = collarPoint(a, 0.014);
    tangent.subVectors(collarPoint(a + 0.02, 0.014), p).normalize();
    const mesh = part(link, gold, p.toArray() as [number, number, number]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    mesh.rotateX(i % 2 ? Math.PI / 2 : 0);
    object.add(mesh);
  }
  const chin = collarPoint(CHIN_ANGLE, 0.02);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.2, 0, 0], true);
  pivot.add(part(new THREE.TorusGeometry(0.013, 0.005, 8, 16), gold, [0, -0.012, 0]));
  pivot.add(part(extrude(circleShape(0.055), 0.014, 0.005, 32), gold, [0, -0.075, 0.004]));
  // Besourinho em relevo no medalhão (casco, cabeça e as patinhas).
  const deep = Mat.metal('#c98f1e');
  pivot.add(part(claySphere(0.026, 2, 0.02), deep, [0, -0.082, 0.014], [0, 0, 0], [0.85, 1, 0.35]));
  pivot.add(part(claySphere(0.014, 2, 0.02), deep, [0, -0.052, 0.014], [0, 0, 0], [1, 0.8, 0.35]));
  for (const side of [1, -1]) {
    for (const y of [-0.068, -0.086, -0.1]) {
      pivot.add(part(clayCapsule(0.003, 0.018, 0, 0, 4), deep, [side * 0.03, y, 0.012], [0, 0, side * (Math.PI / 2 - 0.4)]));
    }
  }
  object.add(pivot);
  return { object, update: pendulum(pivot, -0.2, 45) };
}

// --- costas -------------------------------------------------------------------------

/** Balão vermelho preso nas costas por um barbante, boiando e balançando no vento. */
export function balloon(): AccessoryModel {
  const object = new THREE.Group();
  const sway = joint([0.12, 0.02, -0.3], [0, 0, 0], true);
  const HEIGHT = 0.62;
  const string = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.02, HEIGHT * 0.35, -0.01),
    new THREE.Vector3(-0.015, HEIGHT * 0.7, 0.01),
    new THREE.Vector3(0, HEIGHT, 0),
  ]);
  sway.add(part(taperedTube(string, 30, () => 0.0028, 5), Mat.fabric('#f6f1e8')));
  const body = lathe(
    [
      [0.001, 0],
      [0.03, 0.02],
      [0.11, 0.1],
      [0.14, 0.2],
      [0.13, 0.28],
      [0.08, 0.34],
      [0.001, 0.36],
    ],
    36,
    0.003,
    23,
  );
  sway.add(part(body, Mat.glossy('#e8313b'), [0, HEIGHT + 0.01, 0]));
  sway.add(part(claySphere(0.014, 2, 0.05), Mat.glossy('#c4222c'), [0, HEIGHT + 0.004, 0], [0, 0, 0], [1, 0.7, 1]));
  sway.add(part(claySphere(0.03, 2, 0), Mat.glossy('#ffffff'), [-0.06, HEIGHT + 0.25, 0.08], [0.3, 0, 0.5], [0.6, 1, 0.3]));
  object.add(sway);
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      // Fica em pé (desconta o corpo virando) e fica pra trás quando corre.
      sway.rotation.x = -pose.headPitch * 0.8 - run * 0.45 + Math.sin(pose.time * 1.3) * 0.08;
      sway.rotation.z = Math.sin(pose.time * 0.9) * 0.12 + Math.sin(pose.time * 2.3) * 0.03;
      sway.position.y = 0.02 + Math.sin(pose.time * 1.7) * 0.01;
    },
  };
}

/** Casca de caracol nas costas: espiral de listras creme e caramelo. */
export function snailShell(): AccessoryModel {
  const object = new THREE.Group();
  // Espiral logarítmica no plano YZ (vista de lado), com o tubo engordando.
  const TURNS = 2.6;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const theta = t * TURNS * Math.PI * 2;
    const r = 0.012 * Math.exp(0.21 * theta);
    points.push(new THREE.Vector3((1 - t) * 0.03, Math.sin(theta) * r, Math.cos(theta) * r));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const cream = new THREE.Color('#f1dcb0');
  const caramel = new THREE.Color('#b0692e');
  const tube = paintVertices(
    taperedTube(curve, 160, (t) => 0.006 + 0.0042 * Math.exp(0.21 * t * TURNS * Math.PI * 2), 16),
    (p, _n, c) => {
      const band = 0.5 + 0.5 * Math.sin(Math.atan2(p.y, p.z) * 3 + Math.hypot(p.y, p.z) * 60);
      return c.copy(cream).lerp(caramel, smoothstep(0.35, 0.65, band));
    },
  );
  const shell = joint([0, 0.17, -0.25], [0, 0, 0]);
  shell.scale.setScalar(1.35);
  shell.add(part(tube, Mat.painted(0.4)));
  object.add(shell);
  return { object };
}

/** Folha-guarda-chuva: o talo saindo das costas e uma folha enorme por cima, balançando. */
export function leafUmbrella(): AccessoryModel {
  const object = new THREE.Group();
  const stem = joint([0.08, 0.03, -0.3], [-0.2, 0, -0.15], true);
  const STEM = 0.5;
  const stalk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.01, STEM * 0.5, 0.02),
    new THREE.Vector3(-0.01, STEM, 0.06),
  ]);
  stem.add(part(taperedTube(stalk, 20, (t) => 0.013 - t * 0.005, 8), Mat.clay('#4f8a34')));
  // Folha: contorno de folha, curvada pra baixo nos lados e na ponta.
  const outline: Array<[number, number]> = [
    [0, -0.36],
    [0.16, -0.26],
    [0.25, -0.05],
    [0.22, 0.14],
    [0.12, 0.28],
    [0, 0.36],
  ];
  const shape = shapeFrom([...outline, ...outline.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])], false);
  const leafGeo = extrude(shape, 0.01, 0.004, 32).rotateX(-Math.PI / 2);
  const pos = leafGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) - x * x * 1.6 - Math.max(0, -z - 0.1) ** 2 * 1.2);
  }
  leafGeo.computeVertexNormals();
  const green = new THREE.Color('#5fae3f');
  const light = new THREE.Color('#a6d86a');
  paintVertices(leafGeo, (p, _n, c) => {
    const mid = 1 - smoothstep(0.006, 0.014, Math.abs(p.x));
    const veins = 1 - smoothstep(0.0, 0.012, Math.abs(Math.sin((Math.abs(p.x) * 1.4 - p.z) * 24)) * 0.06);
    return c.copy(green).lerp(light, Math.max(mid, veins * smoothstep(0.02, 0.05, Math.abs(p.x)) * 0.5));
  });
  const canopy = joint([-0.01, STEM, 0.06], [0.15, 0, 0], true);
  canopy.scale.setScalar(1.5);
  canopy.add(part(leafGeo, Mat.painted(0.55)));
  stem.add(canopy);
  object.add(stem);
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      stem.rotation.x = -0.2 - pose.headPitch * 0.7 - run * 0.3 + Math.sin(pose.time * 1.4) * 0.05;
      stem.rotation.z = -0.15 + Math.sin(pose.time * 1.1) * 0.06;
      canopy.rotation.z = Math.sin(pose.time * 2.6 + 1) * (0.05 + run * 0.08);
      canopy.rotation.x = 0.15 + Math.sin(pose.time * 2.1) * (0.03 + run * 0.06);
    },
  };
}

/** Violãozinho de madeira atravessado nas costas, com a alça. */
export function guitar(): AccessoryModel {
  const object = new THREE.Group();
  const wood = new THREE.Color('#e0a35c');
  const edge = new THREE.Color('#8a4f22');
  // Corpo em "8": duas curvas unidas pela cintura.
  const body = shapeFrom(
    [
      [0, -0.14],
      [0.09, -0.12],
      [0.11, -0.05],
      [0.065, 0.0],
      [0.085, 0.06],
      [0.06, 0.11],
      [0, 0.12],
      [-0.06, 0.11],
      [-0.085, 0.06],
      [-0.065, 0.0],
      [-0.11, -0.05],
      [-0.09, -0.12],
    ],
    false,
  );
  const top = paintVertices(extrude(body, 0.05, 0.012, 32), (p, _n, c) => {
    const r = Math.abs(p.z) > 0.024 ? 0 : 1;
    return c.copy(wood).lerp(edge, r * 0.9);
  });
  // Quase em pé nas costas, atravessado: de três quartos a câmera vê o tampo e o braço.
  const g = joint([0.04, 0.2, -0.3], [-0.55, 0.35, 0.75]);
  g.scale.setScalar(1.55);
  g.add(part(top, Mat.painted(0.45)));
  g.add(part(extrude(circleShape(0.03), 0.004, 0.001, 20), Mat.clay('#3a2418'), [0, -0.02, 0.027]));
  g.add(part(new THREE.BoxGeometry(0.03, 0.2, 0.018), Mat.clay('#5a3a22'), [0, 0.2, 0.014]));
  g.add(part(new THREE.BoxGeometry(0.042, 0.06, 0.016), Mat.clay('#3a2418'), [0, 0.32, 0.012]));
  g.add(part(new THREE.BoxGeometry(0.06, 0.012, 0.012), Mat.clay('#3a2418'), [0, -0.085, 0.03]));
  for (const x of [-0.009, -0.003, 0.003, 0.009]) {
    g.add(part(new THREE.CylinderGeometry(0.0012, 0.0012, 0.39, 4), Mat.metal('#e8e2d6'), [x, 0.11, 0.03]));
  }
  object.add(g);
  // Alça: passa por cima das costas, de um lado pro outro.
  const strap = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.2, -0.06, 0.02),
    new THREE.Vector3(0.12, 0.05, -0.02),
    new THREE.Vector3(-0.05, 0.1, -0.12),
    new THREE.Vector3(-0.2, 0.05, -0.3),
  ]);
  object.add(part(taperedTube(strap, 24, () => 0.009, 6), Mat.fabric('#c8323c'), [0, 0, 0], [0, 0, 0], [1, 1, 1]));
  return { object };
}

/** Asas de libélula: quatro compridas, furta-cor com veios, vibrando rápido. */
export function dragonflyWings(): AccessoryModel {
  const object = new THREE.Group();
  const wing: Array<[number, number]> = [
    [0.0, 0.02],
    [0.12, 0.06],
    [0.3, 0.07],
    [0.43, 0.03],
    [0.42, -0.035],
    [0.27, -0.065],
    [0.08, -0.05],
    [0.0, -0.02],
  ];
  const teal = new THREE.Color('#7fe3f0');
  const violet = new THREE.Color('#c3a6ff');
  const green = new THREE.Color('#aef5c5');
  const vein = new THREE.Color('#2b3a52');
  const paint = (p: THREE.Vector3, c: THREE.Color) => {
    const s = Math.abs(p.x);
    c.copy(teal).lerp(violet, smoothstep(0.05, 0.35, s)).lerp(green, 0.5 + 0.5 * Math.sin(s * 20 + p.z * 40) > 0.8 ? 0.35 : 0);
    const cells = Math.max(1 - smoothstep(0, 0.004, Math.abs(Math.sin(s * 90)) * 0.02), 1 - smoothstep(0, 0.004, Math.abs(Math.sin(p.z * 160)) * 0.02));
    c.lerp(vein, cells * 0.45);
    // Pintinha escura na ponta (o pterostigma).
    return c.lerp(vein, smoothstep(0.33, 0.35, s) * (1 - smoothstep(0.37, 0.39, s)) * 0.8);
  };
  const material = Mat.painted(0.25);
  const hinges: THREE.Group[] = [];
  for (const side of [1, -1] as const) {
    const geo = paintVertices(extrude(shapeFrom(wing, side < 0), 0.004, 0.0015, 20).rotateX(Math.PI / 2), (p, _n, c) => paint(p, c));
    for (const [z, sweep] of [
      [-0.08, 0.25],
      [-0.16, -0.12],
    ] as const) {
      const hinge = joint([side * 0.03, 0.07, z], [0, side * sweep, 0], true);
      hinge.add(part(geo, material));
      hinges.push(hinge);
      object.add(hinge);
    }
  }
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      const rate = 14 + run * 18 + pose.airborne * 20;
      hinges.forEach((hinge, i) => {
        const side = i < 2 ? 1 : -1;
        // Pares da frente e de trás batem desencontrados (como as de verdade).
        const beat = Math.sin(pose.time * rate + (i % 2) * Math.PI * 0.6);
        // Bem levantadas (de lado a câmera baixa via as asas deitadas de quina).
        hinge.rotation.z = side * (0.62 + beat * (0.12 + run * 0.12 + pose.airborne * 0.1));
      });
    },
  };
}
