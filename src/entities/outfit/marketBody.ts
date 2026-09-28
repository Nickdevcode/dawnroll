import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clay } from '../../render/clayMaterial';
import { claySphere, clayCapsule, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { shapeFrom } from './backWear';
import { bend } from './hats';
import { CHIN_ANGLE, collarPoint, collarTube } from './neckWear';
import { Mat, circleShape, extrude, joint, lathe, part } from './parts';
import { slab } from './skinned';
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
  // Caixa da lâmina lisa; as listras vão numa chapa por cima com vértice no miolo (tampa de
  // extrusão só tem vértice na borda, e a listra pintada ali virava um borrão dourado).
  const bladeGeo = extrude(blade, 0.012, 0.005, 4);
  const stripes = ringPlate(blade.getSpacedPoints(90).slice(0, -1), new THREE.Vector2(0, -0.055), 16, (_t, x, y, c) => {
    const phase = (((x + y) / 0.034) % 1 + 1) % 1;
    return c.copy(navy).lerp(gold, 1 - smoothstep(0.26, 0.34, Math.abs(phase - 0.5)));
  });
  const chin = collarPoint(CHIN_ANGLE, 0.005);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.75, 0, 0], true);
  pivot.add(part(bladeGeo, Mat.fabric('#23305c'), [0, -0.012, 0.006]));
  pivot.add(part(stripes, Mat.painted(0.75), [0, -0.012, 0.006 + 0.0115], [0, 0, 0], [0.97, 0.97, 1]));
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
  // Elos encaixados: quantos cabem na volta com o passo menor que o elo (sem vão entre eles).
  let around = 0;
  for (let i = 0; i < 90; i++) around += collarPoint((i / 90) * Math.PI * 2, 0.014).distanceTo(collarPoint(((i + 1) / 90) * Math.PI * 2, 0.014));
  const COUNT = Math.round(around / 0.03);
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

/**
 * Concha de caracol nas costas, em 3D de verdade: um tubo enrolado numa espiral
 * logarítmica (cada volta ~2,6× maior que a anterior, gordo: a volta nova
 * abraça a de dentro, como as conchas globosas de jardim), com a espira saindo um pouco pro lado (cônica, baixinha),
 * a boca virada pra frente e pra baixo apoiada no casco, com o lábio claro. Faixas
 * espirais escuras correndo ao longo das voltas e as linhas de crescimento
 * atravessando, como as conchas de jardim.
 */
export function snailShell(): AccessoryModel {
  const object = new THREE.Group();
  const GROWTH = Math.log(2.6) / (Math.PI * 2);
  const TURNS = 2.9;
  const END = TURNS * Math.PI * 2;
  const R_END = 0.15;
  const SPIRE = 0.13;
  const TUBE = 0.6;
  const radiusAt = (theta: number) => R_END * Math.exp(GROWTH * (theta - END));
  // A boca (fim do tubo) fica embaixo, andando pra frente (+Z): ângulo -90° no fim.
  const PHASE = -Math.PI / 2 - END;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 260; i++) {
    const theta = (i / 260) * END;
    const r = radiusAt(theta);
    const a = theta + PHASE;
    points.push(new THREE.Vector3(SPIRE * (1 - r / R_END), Math.sin(a) * r, Math.cos(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const spiralRadius = (t: number) => {
    const p = curve.getPointAt(t);
    return Math.hypot(p.y, p.z);
  };
  const RADIAL = 32;
  const tube = taperedTube(curve, 220, (t) => 0.002 + spiralRadius(t) * TUBE, RADIAL);
  const cream = new THREE.Color('#f3dc97');
  const pale = new THREE.Color('#f4ead0');
  const band = new THREE.Color('#6b3519');
  const growthLine = new THREE.Color('#b98a4c');
  const apex = new THREE.Color('#c9936a');
  // Pinta pela posição, não pelo uv (o quadro do tubo gira ao longo da espiral): o ângulo em
  // volta do tubo é medido contra o eixo da concha — 0 = lado de fora da volta, ±90° = as faces
  // que aparecem de lado (onde as faixas correm), 180° = encostado na volta de dentro.
  const uv = tube.getAttribute('uv') as THREE.BufferAttribute;
  const pos = tube.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  const center = new THREE.Vector3();
  let ring = -1;
  let ringRadius = 0;
  let tubeRadius = 1;
  for (let i = 0; i < uv.count; i++) {
    const along = uv.getX(i);
    const r = Math.floor(i / (RADIAL + 1));
    if (r !== ring) {
      ring = r;
      curve.getPointAt(along, center);
      ringRadius = Math.hypot(center.y, center.z);
      tubeRadius = 0.002 + ringRadius * TUBE;
    }
    const out = (Math.hypot(pos.getY(i), pos.getZ(i)) - ringRadius) / tubeRadius;
    const side = (pos.getX(i) - center.x) / tubeRadius;
    const phi = Math.atan2(side, out);
    const bands = [-1.35, -0.6, 0.55, 1.3].reduce((k, at, j) => Math.max(k, 1 - smoothstep(0.1 + (j % 2) * 0.03, 0.2 + (j % 2) * 0.04, Math.abs(phi - at))), 0);
    const lines = 1 - smoothstep(0.0, 0.14, Math.abs(Math.sin(along * Math.PI * 44)));
    c.copy(pale).lerp(cream, smoothstep(0.15, 0.6, along));
    c.lerp(band, bands * smoothstep(0.06, 0.25, along) * 0.88);
    c.lerp(growthLine, lines * 0.3 * smoothstep(0.1, 0.4, along));
    c.lerp(apex, 1 - smoothstep(0.0, 0.08, along));
    c.toArray(colors, i * 3);
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const shell = joint([-0.02, 0.29, -0.3]);
  shell.scale.setScalar(1.2);
  shell.add(part(tube, Mat.painted(0.42)));
  // Boca: o lábio claro virado pra fora e o fundo escuro lá dentro.
  const mouth = curve.getPointAt(1);
  const tangent = curve.getTangentAt(1);
  const lipRadius = 0.002 + R_END * TUBE;
  const lip = part(new THREE.TorusGeometry(lipRadius, 0.009, 8, 36), Mat.clay('#fbf3e3'), mouth.toArray() as [number, number, number]);
  lip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  shell.add(lip);
  const inside = part(new THREE.CircleGeometry(lipRadius * 0.98, 32), Mat.clay('#4a2616'), mouth.clone().addScaledVector(tangent, -0.004).toArray() as [number, number, number]);
  inside.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  shell.add(inside);
  // Vira de ¾ e deita de leve (o redemoinho da espira aparece pra câmera que vem de trás).
  shell.rotation.set(0.1, 0.62, 0.06);
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

/**
 * Violão atravessado nas costas, de tampo pra cima (a câmera vem de trás e de
 * cima e vê o tampo): corpo em 8 com a borda arredondada e o filete creme,
 * tampo sunburst, boca com roseta, escudo, cavalete com rastilho, braço com
 * escala, trastes e marcações, mão inclinada com as tarraxas, seis cordas e a
 * alça tecida descendo pelos dois lados do casco.
 *
 * Montado num sistema próprio (Y = braço, Z = tampo, X = largura, origem no
 * meio do corpo) e deitado nas costas por uma base: o corpo apoia atrás, na
 * descida dos élitros, e o braço sobe na diagonal por cima do ombro esquerdo.
 */
export function guitar(): AccessoryModel {
  const object = new THREE.Group();
  const DEPTH = 0.03;
  const BEVEL = 0.009;
  const TOP = DEPTH / 2 + BEVEL;
  // Contorno do corpo (metade direita, de baixo pra cima; a esquerda é o espelho).
  const half: Array<[number, number]> = [
    [0, -0.152],
    [0.058, -0.143],
    [0.094, -0.115],
    [0.106, -0.075],
    [0.098, -0.036],
    [0.074, -0.002],
    [0.073, 0.026],
    [0.084, 0.056],
    [0.078, 0.088],
    [0.048, 0.108],
    [0, 0.114],
  ];
  const loop = [...half, ...half.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];
  const outline = new THREE.Shape();
  outline.moveTo(loop[0][0], loop[0][1]);
  outline.splineThru([...loop.slice(1), loop[0]].map(([x, y]) => new THREE.Vector2(x, y)));

  // Caixa: laterais e fundo de jacarandá, filete creme na quina do tampo.
  const rosewood = new THREE.Color('#5a2c17');
  const back = new THREE.Color('#6d361b');
  const binding = new THREE.Color('#f3e6c9');
  // Dois materiais pintados por vértice (madeiras e miudezas / metais e brilhos): o violão
  // inteiro sai em poucos draw calls depois da fusão, em vez de um por peça.
  const wood = Mat.painted(0.45);
  const shiny = clay(0xffffff, { vertexColors: true, roughness: 0.26, sheen: 0.25, bump: 0.04, clearcoat: 0.9, mottle: 0.02, mottleScale: 22 });
  const tint = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) => solidColor(geometry.clone(), color);
  // Poucas divisões: o contorno é uma spline só e o three multiplica pelos pontos dela.
  const box = paintVertices(extrude(outline, DEPTH, BEVEL, 5), (_p, n, c) => {
    if (n.z > 0.93) return c.copy(back);
    if (n.z > 0.45) return c.copy(binding);
    if (n.z < -0.45) return c.copy(back);
    return c.copy(rosewood);
  });
  const g = new THREE.Group();
  g.add(part(box, wood));

  // Tampo em anéis concêntricos (o sunburst precisa de vértice no meio, não só na borda).
  const center = new THREE.Vector2(0, -0.03);
  const amber = new THREE.Color('#f4c46a');
  const honey = new THREE.Color('#d9892f');
  const burst = new THREE.Color('#6a2f12');
  const plate = ringPlate(outline.getSpacedPoints(120).slice(0, -1), center, 9, (t, _x, _y, c) =>
    c.copy(amber).lerp(honey, smoothstep(0.35, 0.78, t)).lerp(burst, smoothstep(0.74, 1, t)),
  );
  g.add(part(plate, wood, [0, 0, TOP + 0.0006], [0, 0, 0], [0.975, 0.975, 1]));

  // Boca, roseta e escudo (tartaruga), cavalete com o rastilho.
  const hole = new THREE.Vector3(0, 0.045, TOP);
  g.add(part(tint(new THREE.CircleGeometry(0.029, 32), '#1c110b'), wood, [hole.x, hole.y, TOP + 0.0012]));
  g.add(part(tint(new THREE.TorusGeometry(0.035, 0.0035, 6, 40), '#2f7a5c'), wood, [hole.x, hole.y, TOP + 0.0014], [0, 0, 0], [1, 1, 0.35]));
  g.add(part(tint(new THREE.TorusGeometry(0.0405, 0.0022, 6, 40), '#f0dca8'), shiny, [hole.x, hole.y, TOP + 0.0014], [0, 0, 0], [1, 1, 0.35]));
  const guard = new THREE.Shape();
  guard.moveTo(0.02, 0.012);
  guard.bezierCurveTo(0.058, 0.02, 0.07, -0.01, 0.06, -0.038);
  guard.bezierCurveTo(0.052, -0.058, 0.03, -0.052, 0.024, -0.03);
  guard.bezierCurveTo(0.036, -0.012, 0.03, 0.004, 0.02, 0.012);
  g.add(part(tint(extrude(guard, 0.0015, 0.0006, 16), '#3a1c10'), shiny, [0.004, 0.004, TOP + 0.0014]));
  const bridge = new RoundedBoxGeometry(0.086, 0.019, 0.008, 2, 0.0035);
  g.add(part(tint(bridge, '#2a160c'), wood, [0, -0.086, TOP + 0.004]));
  g.add(part(tint(new RoundedBoxGeometry(0.058, 0.0035, 0.004, 1, 0.0012), '#f7f1e3'), wood, [0, -0.081, TOP + 0.0088]));

  // Braço: sai do ombro do corpo, com a escala escura por cima (entra um pouco no tampo).
  const NECK_FROM = 0.1;
  const NUT = 0.32;
  const neckLength = NUT - NECK_FROM;
  const neck = new RoundedBoxGeometry(0.034, neckLength, 0.022, 3, 0.008);
  bend(neck, (p) => {
    // Afina da junção pra pestana.
    p.x *= 1 - 0.16 * ((p.y + neckLength / 2) / neckLength);
  });
  g.add(part(tint(neck, '#7a4020'), wood, [0, NECK_FROM + neckLength / 2, TOP - 0.012]));
  const BOARD_FROM = 0.074;
  const boardLength = NUT - BOARD_FROM;
  const board = new RoundedBoxGeometry(0.034, boardLength, 0.005, 1, 0.0015);
  bend(board, (p) => {
    p.x *= 1 - 0.16 * Math.max(0, (p.y + boardLength / 2 - (NECK_FROM - BOARD_FROM)) / neckLength);
  });
  const boardZ = TOP + 0.0035;
  g.add(part(tint(board, '#2b1a12'), wood, [0, BOARD_FROM + boardLength / 2, boardZ]));
  // Trastes (espaçamento de escala de verdade, encurtando pro corpo) e as bolinhas.
  const SCALE = 0.4;
  const fret = '#e8e2d2';
  const pearl = '#f5ecd8';
  for (let k = 1; k <= 12; k++) {
    const y = NUT - SCALE * (1 - 2 ** (-k / 12));
    if (y < BOARD_FROM + 0.006) break;
    const width = 0.034 * (1 - 0.16 * Math.min(1, (NUT - y) / neckLength)) * 0.96;
    g.add(part(tint(new THREE.CylinderGeometry(0.0012, 0.0012, width, 5).rotateZ(Math.PI / 2), fret), shiny, [0, y, boardZ + 0.0026]));
    if ([3, 5, 7, 9].includes(k)) {
      const prev = NUT - SCALE * (1 - 2 ** (-(k - 1) / 12));
      g.add(part(tint(new THREE.CircleGeometry(0.0035, 12), pearl), wood, [0, (y + prev) / 2, boardZ + 0.0027]));
    }
  }
  g.add(part(tint(new RoundedBoxGeometry(0.034, 0.005, 0.008, 1, 0.0015), pearl), wood, [0, NUT, boardZ + 0.0015]));

  // Mão: inclinada pra trás a partir da pestana, com as tarraxas dos dois lados.
  const head = joint([0, NUT, boardZ - 0.004], [-0.22, 0, 0]);
  const headShape = new THREE.Shape();
  headShape.moveTo(-0.017, 0);
  headShape.lineTo(0.017, 0);
  headShape.bezierCurveTo(0.024, 0.03, 0.026, 0.06, 0.022, 0.078);
  headShape.bezierCurveTo(0.012, 0.086, -0.012, 0.086, -0.022, 0.078);
  headShape.bezierCurveTo(-0.026, 0.06, -0.024, 0.03, -0.017, 0);
  head.add(part(tint(extrude(headShape, 0.008, 0.003, 16), '#3a2014'), wood, [0, 0, -0.004]));
  const peg = tint(new THREE.CylinderGeometry(0.0022, 0.0022, 0.02, 6).rotateZ(Math.PI / 2), '#d8c07a');
  const post = tint(new THREE.CylinderGeometry(0.0024, 0.0024, 0.008, 6).rotateX(Math.PI / 2), '#d8c07a');
  const button = tint(claySphere(0.0065, 1, 0), '#f3ead6');
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const y = 0.02 + i * 0.022;
      head.add(part(peg, shiny, [side * 0.028, y, -0.004]));
      head.add(part(button, shiny, [side * 0.04, y, -0.004], [0, 0, 0], [0.55, 1, 0.9]));
      head.add(part(post, shiny, [side * 0.009, y, 0.006]));
    }
  }
  g.add(head);

  // Cordas: do rastilho até a pestana (as graves mais grossas), abrindo um pouco no cavalete.
  const stringColor = '#ece7dc';
  for (let i = 0; i < 6; i++) {
    const k = (i - 2.5) / 2.5;
    const from = new THREE.Vector3(k * 0.023, -0.081, TOP + 0.0105);
    const to = new THREE.Vector3(k * 0.012, NUT - 0.001, boardZ + 0.0055);
    const string = stick(from, to, 0.0009 + (1 - i / 5) * 0.0006, shiny);
    solidColor(string.geometry, stringColor);
    g.add(string);
  }

  // Base nas costas: o corpo deitado na descida dos élitros, o braço subindo por cima do ombro esquerdo.
  const up = new THREE.Vector3(0.12, 0.93, -0.34).normalize();
  const along = new THREE.Vector3(-0.56, 0.36, 0.75);
  along.addScaledVector(up, -along.dot(up)).normalize();
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(along, up), along, up);
  g.quaternion.setFromRotationMatrix(basis);
  g.position.set(0.085, 0.04, -0.35);
  g.scale.setScalar(1.36);
  object.add(g);

  // Alça tecida: sai do pino do fundo e do calcanhar do braço e desce abraçando a cúpula
  // do élitro de cada lado (some por baixo da barriga).
  const strapColor = new THREE.Color('#b8283a');
  const strapStripe = new THREE.Color('#f2c14e');
  const strapMat = Mat.painted(0.8);
  object.updateMatrixWorld(true);
  const toBack = (x: number, y: number, z: number) => g.localToWorld(new THREE.Vector3(x, y, z));
  const endPin = toBack(0, -0.155, -0.01);
  const heel = toBack(0, 0.112, -0.012);
  const strapCurves = [hugDome(endPin, 1, new THREE.Vector3(1, -0.55, -0.15)), hugDome(heel, -1, new THREE.Vector3(-1, -0.55, 0.25))];
  const shellCenter = new THREE.Vector3(0, -0.3, -0.23);
  for (const curve of strapCurves) {
    const geo = ribbon(curve, 0.022, 0.005, 24, (p) => p.clone().sub(shellCenter));
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const colors = new Float32Array(uv.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      // Zigue-zague de tapeçaria no meio da fita.
      const zig = Math.abs(((v * 18) % 1) - 0.5) * 0.6 + 0.2;
      c.copy(strapColor).lerp(strapStripe, Math.abs(u - zig) < 0.09 ? 1 : 0);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    object.add(part(geo, strapMat));
  }
  return { object };
}

/** Cúpula de um élitro, no espaço das costas (centro e raios do modelo do besouro). */
const DOME = { x: 0.172, y: -0.22, z: -0.23, rx: 0.205, ry: 0.25, rz: 0.43 };

/**
 * Caminho que desce colado na cúpula do élitro do lado `side`, de `from` (em
 * cima dela) até a direção `to` (vista do centro da cúpula): pra alça abraçar o casco.
 */
function hugDome(from: THREE.Vector3, side: 1 | -1, to: THREE.Vector3): THREE.CatmullRomCurve3 {
  const c = new THREE.Vector3(side * DOME.x, DOME.y, DOME.z);
  const r = new THREE.Vector3(DOME.rx, DOME.ry, DOME.rz);
  const d0 = from.clone().sub(c).divide(r).normalize();
  const d1 = to.clone().normalize();
  const points = [from.clone()];
  for (let i = 1; i <= 8; i++) {
    const d = d0.clone().lerp(d1, i / 8).normalize();
    points.push(d.multiply(r).multiplyScalar(1.035).add(c));
  }
  return new THREE.CatmullRomCurve3(points);
}

/**
 * Chapa plana (normal +Z) em anéis: o contorno encolhido em volta de `center`,
 * do meio (t = 0) pra borda (t = 1). Dá vértice no miolo pra pintar degradê.
 */
function ringPlate(
  outline: THREE.Vector2[],
  center: THREE.Vector2,
  rings: number,
  paint: (t: number, x: number, y: number, target: THREE.Color) => THREE.Color,
): THREE.BufferGeometry {
  const positions: number[] = [center.x, center.y, 0];
  const colors: number[] = [];
  const c = new THREE.Color();
  paint(0, center.x, center.y, c).toArray(colors, 0);
  const n = outline.length;
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    for (const p of outline) {
      const x = center.x + (p.x - center.x) * t;
      const y = center.y + (p.y - center.y) * t;
      positions.push(x, y, 0);
      const col = paint(t, x, y, c);
      colors.push(col.r, col.g, col.b);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * n;
    const b0 = 1 + r * n;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      indices.push(a0 + i, b0 + i, b0 + i2, a0 + i, b0 + i2, a0 + i2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Contorno no sentido horário vira a chapa de costas: garante a normal pra +Z.
  const nz = (geometry.getAttribute('normal') as THREE.BufferAttribute).getZ(0);
  if (nz < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Cilindro fininho de `a` até `b` (corda, vareta). */
function stick(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 5), material);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/**
 * Fita chata ao longo de uma curva (alça, tira): largura deitada na superfície
 * de quem ela abraça — `outward(p)` diz pra onde é "fora" em cada ponto.
 */
function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, thickness: number, segments: number, outward: (p: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  return slab(
    (u, v, target) => {
      curve.getPointAt(v, target);
      curve.getTangentAt(v, tangent);
      side.crossVectors(tangent, outward(target)).normalize();
      return target.addScaledVector(side, (u * width) / 2);
    },
    4,
    segments,
    thickness,
  );
}

/**
 * Asas de libélula (lendário): quatro asas compridas abertas quase na
 * horizontal, como a libélula pousada — as da frente mais estreitas, as de trás
 * mais largas na base. A rede de nervuras é uma textura desenhada uma vez (tem
 * que ser nítida: pintura por vértice borraria tudo), com a costa grossa no
 * bordo de ataque, o nódulo, o pterostigma escuro perto da ponta e a base
 * âmbar; o material furta-cor faz o arco-íris mudar com o ângulo. Parada,
 * tremem de leve; correndo e no ar, batem forte (pares da frente e de trás
 * desencontrados, como as de verdade).
 */
export function dragonflyWings(): AccessoryModel {
  const object = new THREE.Group();
  const material = wingMaterial();
  // Mais largas que as de verdade (que têm ~6× o comprimento na corda): de longe, asa fina vira palito.
  const fore = dragonflyWing(0.46, 0.05, 0.12, 0.34);
  const hind = dragonflyWing(0.44, 0.095, 0.152, 0.22);
  const hinges: Array<{ joint: THREE.Group; fore: boolean }> = [];
  for (const side of [1, -1] as const) {
    // Espelho no grupo (escala -1): o renderizador acerta a face da frente sozinho.
    const mirror = joint([0, 0, 0], [0, 0, 0], true);
    mirror.scale.x = side;
    for (const [geometry, z, sweep, isFore] of [
      [fore, -0.05, -0.16, true],
      [hind, -0.12, 0.2, false],
    ] as const) {
      const hinge = joint([0.03, 0.05, z], [0, sweep, 0], true);
      hinge.add(part(geometry, material));
      mirror.add(hinge);
      hinges.push({ joint: hinge, fore: isFore });
    }
    object.add(mirror);
  }
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      const beat = Math.min(1, run + pose.airborne);
      const rate = 24 + beat * 10;
      for (const { joint: hinge, fore: isFore } of hinges) {
        const phase = isFore ? 0 : Math.PI * 0.6;
        // Parada: um tremor fininho (a luz corre no furta-cor). Batendo: sobe e desce inteira.
        const tremble = Math.sin(pose.time * 31 + phase * 2) * 0.025;
        const flap = Math.sin(pose.time * rate + phase) * beat * 0.3;
        hinge.rotation.z = 0.16 + tremble + flap;
        hinge.rotation.x = Math.sin(pose.time * 27 + phase) * (0.02 + beat * 0.08);
      }
    },
  };
}

/**
 * Uma asa (a da direita, crescendo pra +X; +Z = bordo de ataque): chapa fina
 * com um tiquinho de arqueado e a ponta caindo. `root`/`chord` = largura na
 * base e a máxima, `widest` = onde ela é mais larga (fração do comprimento).
 */
function dragonflyWing(length: number, root: number, chord: number, widest: number): THREE.BufferGeometry {
  const widthAt = (v: number) => {
    if (v < widest) return root + (chord - root) * smoothstep(0, widest, v);
    const t = (v - widest) / (1 - widest);
    return chord * Math.max(0, 1 - t ** 2.4) ** 0.5;
  };
  return slab(
    (u, v, target) => {
      const w = widthAt(v);
      // Bordo de ataque quase reto; o de fuga faz a curva (a asa "pende" pra trás).
      const lead = 0.008 - 0.012 * v * v;
      const z = lead - (1 - (u + 1) / 2) * w;
      const camber = Math.sin(((u + 1) / 2) * Math.PI) * 0.005 * (1 - v * 0.6);
      return target.set(v * length, camber - v * v * 0.022, z);
    },
    10,
    40,
    0.0035,
  );
}

let wingTexture: THREE.CanvasTexture | null = null;

/** Material das asas: brilho de vidro furta-cor em cima da textura das nervuras (uma pra todas). */
function wingMaterial(): THREE.MeshPhysicalMaterial {
  const material = clay(0xffffff, { roughness: 0.16, sheen: 0.25, bump: 0, clearcoat: 1, mottle: 0, iridescence: 1, unique: true });
  material.map = (wingTexture ??= drawWingVeins());
  material.needsUpdate = true;
  return material;
}

/**
 * Nervuras da asa (x = corda, do bordo de fuga ao de ataque; y = da base à
 * ponta): longitudinais convergindo, transversais irregulares formando as
 * celinhas, a costa grossa, o nódulo, o pterostigma e a base âmbar.
 */
function drawWingVeins(): THREE.CanvasTexture {
  const W = 128;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Canvas: y = 0 em cima; a textura vira (flipY), então a base (v = 0) fica embaixo.
  const Y = (v: number) => (1 - v) * H;
  const glass = ctx.createLinearGradient(0, Y(0), 0, Y(1));
  glass.addColorStop(0, '#d7ad5a');
  glass.addColorStop(0.1, '#b9e4e6');
  glass.addColorStop(0.42, '#b8dcf7');
  glass.addColorStop(0.78, '#cfc6f6');
  glass.addColorStop(1, '#e3d9fd');
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, W, H);
  // Mais claro no bordo de fuga, mais saturado no de ataque.
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  edge.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
  edge.addColorStop(1, 'rgba(40, 120, 170, 0.12)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  // Poucas e grossas: a asa aparece pequena na tela e a textura encolhe (fio fino some no mipmap).
  const ink = 'rgba(26, 34, 60, 0.9)';
  const lanes = [0.05, 0.27, 0.48, 0.67, 0.83, 0.95];
  const laneX = (k: number, v: number) => (lanes[k] + Math.sin(v * 9 + k * 1.7) * 0.014 * (1 - lanes[k])) * W;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  lanes.forEach((_, k) => {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const v = i / 64;
      const x = laneX(k, v);
      if (i === 0) ctx.moveTo(x, Y(v));
      else ctx.lineTo(x, Y(v));
    }
    ctx.stroke();
  });
  // Transversais: cada faixa entre duas longitudinais ganha travessas em alturas sorteadas (celinhas).
  ctx.lineWidth = 1.7;
  for (let k = 0; k < lanes.length - 1; k++) {
    let v = 0.025 + random() * 0.02;
    while (v < 0.975) {
      const tilt = (random() - 0.5) * 0.016;
      ctx.beginPath();
      ctx.moveTo(laneX(k, v), Y(v));
      ctx.lineTo(laneX(k + 1, v + tilt), Y(v + tilt));
      ctx.stroke();
      // Mais miúdas na ponta e no bordo de fuga (como nas asas de verdade).
      v += 0.024 + random() * 0.022 * (0.6 + lanes[k]);
    }
  }
  // Costa: o bordo de ataque grosso e escuro, e o nódulo (a "dobrinha" no meio).
  ctx.strokeStyle = 'rgba(28, 32, 48, 0.95)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(W - 3.5, Y(0));
  ctx.lineTo(W - 3.5, Y(1));
  ctx.stroke();
  ctx.fillStyle = 'rgba(28, 32, 48, 0.95)';
  ctx.fillRect(W * 0.8, Y(0.47), W * 0.2, 5);
  // Pterostigma: a manchinha escura alongada perto da ponta, no bordo de ataque.
  ctx.fillStyle = '#3b2620';
  ctx.fillRect(W * 0.84, Y(0.9), W * 0.16, H * 0.07);
  // Bordo de fuga: fio escuro fininho fechando a asa.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(1.5, Y(0));
  ctx.lineTo(1.5, Y(1));
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
