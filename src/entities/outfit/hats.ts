import * as THREE from 'three';
import { claySphere, clayCapsule, lumpify, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { clay } from '../../render/clayMaterial';
import { Mat, arcOver, brim, crownBand, extrude, flatRing, flower, joint, lathe, orient, part, starShape } from './parts';
import { slab as slabSurface } from './skinned';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Chapéus. Origem = topo da cabeça, entre os olhos (os olhos ficam logo abaixo
 * da aba, dos dois lados); +Y pra cima, +Z pra frente. A copa tem ~0,11 u de
 * raio: a aba apoia em cima das pálpebras e as clavas das antenas aparecem por
 * cima dela, como sobrancelhas.
 *
 * Quase todos escondem o chifre (ele atravessaria a copa); os que são "abertos"
 * (coroa, coroa de flores, auréola) e o viking (a piada dos três chifres) deixam.
 */

const gaussian = (x: number, width: number) => Math.exp(-((x / width) ** 2));

/** Deforma os vértices de uma geometria por uma função (posição → nova posição). */
export function bend(geometry: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Desloca na horizontal (pra fora do eixo Y) — relevo de tricô, pregas. */
export function radial(geometry: THREE.BufferGeometry, offset: (angle: number, y: number) => number): THREE.BufferGeometry {
  return bend(geometry, (p) => {
    const r = Math.hypot(p.x, p.z);
    if (r < 1e-5) return;
    const k = 1 + offset(Math.atan2(p.z, p.x), p.y) / r;
    p.x *= k;
    p.z *= k;
  });
}

/** Chapéu de cowboy: aba virada pros lados, copa com o vinco no meio e fita de couro. */
export function cowboyHat(): AccessoryModel {
  const felt = Mat.felt('#b07a45');
  const band = Mat.leather('#5a3420');
  const object = new THREE.Group();
  const brimGeo = brim(0.115, 0.28, 0.02, (angle, t) => t * t * (0.1 * Math.abs(Math.cos(angle)) ** 1.6 - 0.018 * Math.abs(Math.sin(angle))));
  object.add(part(brimGeo, felt));
  const crown = lathe(
    [
      [0.122, -0.005],
      [0.126, 0.05],
      [0.122, 0.11],
      [0.108, 0.15],
      [0.07, 0.165],
      [0, 0.168],
    ],
    40,
    0.003,
    3,
  );
  // Vinco do meio (cattleman) e a "pinça" da frente.
  bend(crown, (p) => {
    const top = smoothstep(0.1, 0.165, p.y);
    p.y -= 0.045 * gaussian(p.x, 0.045) * top;
    p.x *= 1 - 0.2 * smoothstep(0.07, 0.15, p.y) * smoothstep(0, 0.12, p.z);
  });
  object.add(part(crown, felt));
  object.add(part(flatRing(0.125, 0.014, 8, 48), band, [0, 0.022, 0], [0, 0, 0], [1, 1.25, 1]));
  // Fivelinha na lateral da fita.
  object.add(part(new THREE.BoxGeometry(0.03, 0.026, 0.012), Mat.metal('#d9b44a'), [0.09, 0.022, 0.088], [0, Math.PI / 4, 0]));
  object.scale.setScalar(0.8);
  object.position.set(0, 0.015, -0.02);
  object.rotation.x = -0.12;
  return { object, hidesHorn: true };
}

/** Cartola preta com fita vinho. */
export function topHat(): AccessoryModel {
  const felt = Mat.felt('#26222c');
  const object = new THREE.Group();
  object.add(part(brim(0.1, 0.2, 0.016, (angle, t) => t * t * 0.04 * Math.abs(Math.cos(angle)) ** 2), felt));
  const crown = lathe(
    [
      [0.1, -0.004],
      [0.097, 0.03],
      [0.102, 0.18],
      [0.112, 0.24],
      [0.106, 0.248],
      [0, 0.25],
    ],
    40,
    0.002,
    5,
  );
  object.add(part(crown, felt));
  object.add(
    part(
      lathe(
        [
          [0.096, 0.012],
          [0.104, 0.016],
          [0.105, 0.066],
          [0.098, 0.07],
        ],
        40,
        0,
      ),
      Mat.fabric('#8b2440'),
    ),
  );
  object.rotation.set(0.1, 0, -0.12);
  return { object, hidesHorn: true };
}

/** Chapéu de festa: cone listrado em espiral, pompom no topo e babadinho na base. */
export function partyHat(): AccessoryModel {
  const object = new THREE.Group();
  const pink = new THREE.Color('#ff6fa5');
  const yellow = new THREE.Color('#ffd54a');
  const cone = paintVertices(
    lathe(
      [
        [0.1, 0],
        [0.085, 0.07],
        [0.055, 0.16],
        [0.02, 0.25],
        [0.004, 0.28],
      ],
      40,
      0.002,
      7,
    ),
    (p, _n, c) => {
      const angle = Math.atan2(p.z, p.x);
      return c.copy(pink).lerp(yellow, smoothstep(-0.08, 0.08, Math.sin(angle * 3 + p.y * 38)));
    },
  );
  object.add(part(cone, Mat.painted(0.7)));
  const pompom = lumpify(new THREE.IcosahedronGeometry(0.038, 3), 0.01, 60, 2);
  object.add(part(pompom, Mat.fabric('#7fd3ff'), [0, 0.282, 0]));
  // Babado: bolinhas em volta da base.
  const puff = claySphere(0.022, 2, 0.12, 3, 4);
  const ruffle = Mat.fabric('#ffffff');
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    object.add(part(puff, ruffle, [Math.cos(a) * 0.1, 0.006, Math.sin(a) * 0.1], [0, -a, 0], [1, 0.75, 1]));
  }
  object.rotation.set(0.05, 0, 0.22);
  object.position.x = 0.02;
  return { object, hidesHorn: true };
}

/** Boné azul: gomos costurados, botão no topo, aba curva e o solzinho na frente. */
export function cap(): AccessoryModel {
  const object = new THREE.Group();
  const blue = new THREE.Color('#2f7fd6');
  const seam = new THREE.Color('#1f5aa0');
  const crown = paintVertices(
    lathe(
      [
        [0.112, -0.004],
        [0.116, 0.03],
        [0.108, 0.07],
        [0.088, 0.1],
        [0.052, 0.122],
        [0, 0.128],
      ],
      48,
      0.002,
      9,
    ),
    (p, _n, c) => {
      const panel = Math.abs(Math.sin(Math.atan2(p.z, p.x) * 3));
      return c.copy(blue).lerp(seam, (1 - smoothstep(0, 0.07, panel)) * smoothstep(0.02, 0.05, p.y));
    },
  );
  object.add(part(crown, Mat.painted(0.8)));
  // Aba: meia-elipse achatada, curvada pra baixo nas pontas e na frente.
  const shape = new THREE.Shape();
  shape.moveTo(-0.105, 0);
  shape.bezierCurveTo(-0.12, 0.1, -0.06, 0.165, 0, 0.17);
  shape.bezierCurveTo(0.06, 0.165, 0.12, 0.1, 0.105, 0);
  shape.lineTo(-0.105, 0);
  const visor = extrude(shape, 0.01, 0.005, 16).rotateX(Math.PI / 2);
  bend(visor, (p) => {
    p.y -= p.x * p.x * 1.6 + Math.max(0, p.z) * Math.max(0, p.z) * 0.9;
  });
  object.add(part(visor, Mat.felt('#23609f'), [0, 0.014, 0.05], [-0.08, 0, 0]));
  object.add(part(claySphere(0.017, 2, 0.05), Mat.felt('#23609f'), [0, 0.127, 0], [0, 0, 0], [1, 0.6, 1]));
  // Solzinho do jogo na frente.
  object.add(part(claySphere(0.03, 3, 0.03), Mat.clay('#ffc23d'), [0, 0.06, 0.104], [-0.45, 0, 0], [1, 1, 0.32]));
  object.rotation.set(-0.04, 0.18, 0);
  return { object, hidesHorn: true };
}

/** Gorro de lã: canelado na barra, tricô no resto, listra e pompom. */
export function beanie(): AccessoryModel {
  const object = new THREE.Group();
  const red = new THREE.Color('#d64545');
  const cream = new THREE.Color('#f4ead8');
  const CUFF = 0.05;
  const knit = radial(
    lathe(
      [
        [0.118, -0.006],
        [0.123, 0.02],
        [0.122, CUFF - 0.004],
        [0.114, CUFF + 0.004],
        [0.113, 0.1],
        [0.099, 0.15],
        [0.067, 0.186],
        [0.03, 0.199],
        [0, 0.201],
      ],
      72,
      0,
    ),
    (a, y) => (y < CUFF ? 0.0045 * Math.sin(a * 36) : 0.0028 * Math.sin(a * 30) * Math.sin(y * 150) * smoothstep(0.2, 0.15, y)),
  );
  paintVertices(knit, (p, _n, c) => {
    const stripe = smoothstep(0.092, 0.097, p.y) * (1 - smoothstep(0.118, 0.123, p.y));
    return c.copy(red).lerp(cream, p.y < CUFF + 0.002 ? 1 : stripe);
  });
  object.add(part(knit, Mat.painted(0.95)));
  const pompom = lumpify(new THREE.IcosahedronGeometry(0.048, 3), 0.014, 55, 5);
  object.add(part(pompom, Mat.fabric('#f4ead8'), [0, 0.215, 0]));
  object.rotation.set(-0.06, 0, 0.08);
  return { object, hidesHorn: true };
}

/** Chapéu de palha: trançado nas cores da palha, fita vermelha e uma margaridinha. */
export function strawHat(): AccessoryModel {
  const object = new THREE.Group();
  const light = new THREE.Color('#ecd08a');
  const dark = new THREE.Color('#c79a4a');
  /** Trama: xadrez fino entre fios claros e escuros. */
  const weave = (u: number, v: number, c: THREE.Color) => c.copy(light).lerp(dark, (Math.sin(u) > 0) !== (Math.sin(v) > 0) ? 0.45 : 0.05);
  const brimGeo = paintVertices(
    brim(0.1, 0.25, 0.014, (angle, t) => t * (0.006 * Math.sin(angle * 7)) - t * t * 0.03),
    (p, _n, c) => weave(Math.hypot(p.x, p.z) * 240, Math.atan2(p.z, p.x) * 44, c),
  );
  object.add(part(brimGeo, Mat.painted(0.9)));
  const crown = paintVertices(
    lathe(
      [
        [0.102, -0.004],
        [0.106, 0.05],
        [0.1, 0.095],
        [0.082, 0.108],
        [0, 0.11],
      ],
      44,
      0.003,
      11,
    ),
    (p, _n, c) => weave(p.y * 230 + Math.hypot(p.x, p.z) * 200, Math.atan2(p.z, p.x) * 36, c),
  );
  object.add(part(crown, Mat.painted(0.9)));
  object.add(part(flatRing(0.106, 0.016, 8, 48), Mat.fabric('#d8403c'), [0, 0.024, 0], [0, 0, 0], [1, 1.1, 1]));
  const daisy = flower({ petal: '#fbf6ee', center: '#f2c230', petals: 8, size: 0.06, long: true }, 2);
  daisy.position.set(0.078, 0.03, 0.078);
  orient(daisy, new THREE.Vector3(0.7, 0.2, 0.7));
  object.add(daisy);
  object.rotation.set(-0.05, 0, -0.06);
  return { object, hidesHorn: true };
}

/** Coroa de flores: um ramo verde com margaridas, botões cor-de-rosa e miosótis. Deixa o chifre de fora. */
export function flowerCrown(): AccessoryModel {
  const object = new THREE.Group();
  const vine = Mat.clay('#5f9a3e');
  object.add(part(flatRing(0.112, 0.011, 8, 56), vine, [0, 0.012, 0]));
  const leafGeo = claySphere(0.022, 2, 0.06, 3, 3);
  const styles = [
    { petal: '#fbf6ee', center: '#f2c230', petals: 8, size: 0.072, long: true },
    { petal: '#ff9fc4', center: '#ffd54a', petals: 5, size: 0.062 },
    { petal: '#7fb7ff', center: '#fbf6ee', petals: 5, size: 0.054 },
  ];
  const COUNT = 9;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + 0.3;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const bloom = flower(styles[i % styles.length], i);
    bloom.position.copy(out).multiplyScalar(0.114).setY(0.022);
    orient(bloom, out.clone().multiplyScalar(0.55).setY(0.85));
    object.add(bloom);
    // Folhinhas entre as flores.
    const b = a + Math.PI / COUNT;
    object.add(part(leafGeo, vine, [Math.cos(b) * 0.116, 0.014, Math.sin(b) * 0.116], [0, -b, 0.4], [1.3, 0.3, 0.6]));
  }
  object.rotation.set(-0.08, 0, 0.05);
  return { object };
}

/** Chapéu de chef: faixa lisa e o "cogumelo" pregueado em cima. */
export function chefHat(): AccessoryModel {
  const object = new THREE.Group();
  const cloth = Mat.fabric('#fbf8f2');
  object.add(
    part(
      lathe(
        [
          [0.103, -0.004],
          [0.108, 0.004],
          [0.108, 0.06],
          [0.103, 0.066],
        ],
        44,
        0.001,
      ),
      cloth,
    ),
  );
  const puff = radial(
    lathe(
      [
        [0.098, 0.056],
        [0.125, 0.085],
        [0.142, 0.13],
        [0.146, 0.17],
        [0.13, 0.205],
        [0.09, 0.226],
        [0.04, 0.236],
        [0, 0.238],
      ],
      72,
      0,
    ),
    (a, y) => 0.012 * Math.sin(a * 9) * smoothstep(0.07, 0.17, y) * (1 - smoothstep(0.2, 0.238, y) * 0.6),
  );
  bend(puff, (p) => {
    // O topo estufa em gomos (acompanhando as pregas).
    const a = Math.atan2(p.z, p.x);
    p.y += 0.01 * Math.sin(a * 9) * smoothstep(0.2, 0.236, p.y);
  });
  object.add(part(lumpify(puff, 0.003, 30, 4), cloth));
  object.rotation.set(-0.04, 0, 0.1);
  return { object, hidesHorn: true };
}

/** Gorro de anão: o cone vermelho do anão do jardim, com a ponta caída pra trás. */
export function gnomeHat(): AccessoryModel {
  const object = new THREE.Group();
  const cone = lathe(
    [
      [0.114, -0.004],
      [0.116, 0.02],
      [0.106, 0.05],
      [0.09, 0.12],
      [0.066, 0.2],
      [0.043, 0.27],
      [0.021, 0.33],
      [0.004, 0.365],
    ],
    44,
    0.003,
    13,
  );
  bend(cone, (p) => {
    const t = Math.max(0, (p.y - 0.12) / 0.245);
    p.z -= t * t * 0.15;
    p.y -= t * t * 0.035;
  });
  object.add(part(cone, Mat.felt('#d8433b')));
  object.scale.setScalar(0.88);
  object.rotation.set(-0.05, 0, 0.04);
  return { object, hidesHorn: true };
}

/** Capacete de mineiro: casco amarelo, frisos, aba curta e a lanterna acesa (pulsa de leve). */
export function minerHelmet(): AccessoryModel {
  const object = new THREE.Group();
  const shell = Mat.plastic('#f6c93b');
  object.add(
    part(
      lathe(
        [
          [0.118, -0.004],
          [0.12, 0.02],
          [0.114, 0.07],
          [0.095, 0.112],
          [0.06, 0.136],
          [0, 0.142],
        ],
        44,
        0.002,
        15,
      ),
      shell,
    ),
  );
  object.add(part(arcOver(0.128, 0.013, Math.PI * 0.72, 'yz'), shell, [0, 0.008, 0]));
  object.add(part(brim(0.112, 0.15, 0.012, (_a, t) => -t * t * 0.012), shell));
  // Lanterna: corpo escuro, aro de metal e a lente acesa.
  const lamp = joint([0, 0.072, 0.108], [-0.35, 0, 0]);
  lamp.add(part(new THREE.CylinderGeometry(0.032, 0.036, 0.034, 20).rotateX(Math.PI / 2), Mat.plastic('#3a3a40')));
  lamp.add(part(flatRing(0.031, 0.006, 6, 24).rotateX(Math.PI / 2), Mat.metal('#c9ced6'), [0, 0, 0.018]));
  const lensMat = Mat.glow('#fff1b0', 2.6);
  const lens = part(new THREE.CircleGeometry(0.027, 24), lensMat, [0, 0, 0.0185]);
  lamp.add(lens);
  object.add(lamp);
  const base = lensMat.color.clone();
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      lensMat.color.copy(base).multiplyScalar(0.9 + 0.1 * Math.sin(pose.time * 7) * Math.sin(pose.time * 2.3));
    },
  };
}

/** Capacete viking: cúpula de ferro com frisos de bronze, rebites, protetor de nariz e dois chifres. */
export function vikingHelmet(): AccessoryModel {
  const object = new THREE.Group();
  const iron = Mat.metal('#a9b3bd');
  const bronze = Mat.metal('#b8864a');
  object.add(
    part(
      lathe(
        [
          [0.118, -0.004],
          [0.121, 0.03],
          [0.113, 0.08],
          [0.089, 0.124],
          [0.05, 0.149],
          [0, 0.155],
        ],
        44,
        0.002,
        17,
      ),
      iron,
    ),
  );
  object.add(
    part(
      lathe(
        [
          [0.118, -0.006],
          [0.126, 0.0],
          [0.126, 0.03],
          [0.118, 0.036],
        ],
        44,
        0.001,
      ),
      bronze,
    ),
  );
  object.add(part(arcOver(0.12, 0.009, Math.PI * 0.95, 'yz'), bronze, [0, 0.004, 0]));
  object.add(part(arcOver(0.12, 0.009, Math.PI * 0.95, 'xy'), bronze, [0, 0.004, 0]));
  const rivet = claySphere(0.008, 1, 0.05);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    object.add(part(rivet, iron, [Math.cos(a) * 0.127, 0.017, Math.sin(a) * 0.127]));
  }
  // Protetor de nariz: descendo entre os olhos.
  object.add(part(clayCapsule(0.012, 0.05, 0.02, 3, 8), bronze, [0, -0.012, 0.12], [0.25, 0, 0], [1, 1, 0.55]));
  // Chifres de marfim, curvando pra fora e pra cima.
  const hornMat = Mat.clay('#f1e6cf');
  for (const side of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.1, 0.055, 0),
      new THREE.Vector3(side * 0.17, 0.085, 0.01),
      new THREE.Vector3(side * 0.225, 0.16, 0.02),
      new THREE.Vector3(side * 0.22, 0.24, 0),
    ]);
    object.add(part(taperedTube(curve, 20, (t) => 0.034 * (1 - t) + 0.005, 12), hornMat));
    object.add(part(claySphere(0.006, 1, 0.02), hornMat, [side * 0.22, 0.24, 0]));
  }
  object.rotation.x = -0.05;
  return { object };
}

/** Boné de hélice: gomos coloridos e a hélice que gira (mais rápido correndo e no pulo). */
export function propellerCap(): AccessoryModel {
  const object = new THREE.Group();
  const colors = ['#e5483f', '#ffd54a', '#2f7fd6', '#5fb84a'].map((c) => new THREE.Color(c));
  const seam = new THREE.Color('#2b2226');
  const crown = paintVertices(
    lathe(
      [
        [0.112, -0.004],
        [0.115, 0.03],
        [0.104, 0.075],
        [0.078, 0.105],
        [0.04, 0.122],
        [0, 0.126],
      ],
      48,
      0.002,
      19,
    ),
    (p, _n, c) => {
      const a = (Math.atan2(p.z, p.x) + Math.PI * 2) % (Math.PI * 2);
      const slot = Math.floor(a / (Math.PI / 2));
      const edge = Math.abs(Math.sin(a * 2));
      return c.copy(colors[slot % 4]).lerp(seam, (1 - smoothstep(0, 0.05, edge)) * 0.8);
    },
  );
  object.add(part(crown, Mat.painted(0.6)));
  object.add(part(new THREE.CylinderGeometry(0.008, 0.01, 0.045, 10), Mat.metal('#c9ced6'), [0, 0.145, 0]));
  const rotor = joint([0, 0.17, 0], [0, 0, 0], true);
  rotor.add(part(claySphere(0.016, 2, 0.03), Mat.plastic('#ffd54a')));
  const blade = clayCapsule(0.018, 0.1, 0.02, 21, 10);
  for (const side of [1, -1]) {
    rotor.add(part(blade, Mat.plastic(side > 0 ? '#e5483f' : '#2f7fd6'), [side * 0.065, 0, 0], [side * 0.35, 0, Math.PI / 2], [1, 1, 0.3]));
  }
  object.add(rotor);
  object.rotation.set(-0.05, 0, -0.08);
  let spin = 0;
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      spin += pose.dt * (3 + Math.min(pose.speed, 8) * 2.5 + pose.airborne * 14);
      rotor.rotation.y = spin;
    },
  };
}

/** Chapéu de mago: cone torto com estrelas douradas, aba mole e uma estrela que cintila na ponta. */
export function wizardHat(): AccessoryModel {
  const object = new THREE.Group();
  const felt = Mat.felt('#3b3aa0');
  object.add(part(brim(0.1, 0.235, 0.012, (angle, t) => -t * t * 0.03 + t * 0.012 * Math.sin(angle * 3)), felt));
  const cone = lathe(
    [
      [0.104, -0.004],
      [0.1, 0.04],
      [0.08, 0.14],
      [0.057, 0.24],
      [0.033, 0.33],
      [0.013, 0.4],
      [0.003, 0.42],
    ],
    44,
    0.003,
    23,
  );
  const tipAt = (y: number) => {
    const t = Math.max(0, (y - 0.2) / 0.22);
    return { x: t * t * 0.08, z: -t * t * 0.1, y: -t * t * 0.02 };
  };
  bend(cone, (p) => {
    const d = tipAt(p.y);
    p.x += d.x;
    p.z += d.z;
    p.y += d.y;
  });
  object.add(part(cone, felt));
  object.add(part(flatRing(0.101, 0.011, 8, 48), Mat.metal('#e6b84a'), [0, 0.02, 0], [0, 0, 0], [1, 1.4, 1]));
  // Estrelas e a lua no cone (deitadas na superfície).
  const gold = Mat.metal('#f2c14e');
  const starGeo = extrude(starShape(5, 0.022, 0.009), 0.006, 0.002);
  const decorations: Array<[number, number, number]> = [
    [0.3, 0.09, 1],
    [2.2, 0.16, 0.8],
    [4.1, 0.12, 0.9],
    [1.1, 0.26, 0.7],
    [5.3, 0.23, 0.75],
  ];
  for (const [a, y, s] of decorations) {
    const r = 0.104 - y * 0.2;
    const d = tipAt(y);
    const star = part(starGeo, gold, [Math.cos(a) * r + d.x, y + d.y, Math.sin(a) * r + d.z], [0, Math.PI / 2 - a, 0], s);
    object.add(star);
  }
  const moon = new THREE.Shape();
  moon.absarc(0, 0, 0.026, Math.PI * 0.25, Math.PI * 1.75, false);
  moon.absarc(0.012, 0, 0.02, Math.PI * 1.6, Math.PI * 0.4, true);
  object.add(part(extrude(moon, 0.006, 0.002), gold, [0, 0.07, 0.093], [-0.2, 0, 0.3]));
  // Estrela da ponta: acesa, girando devagar e piscando.
  const tip = tipAt(0.42);
  const sparkle = joint([tip.x, 0.425 + tip.y, tip.z], [0, 0, 0], true);
  const sparkleMat = Mat.glow('#ffe27a', 2.2);
  sparkle.add(part(extrude(starShape(5, 0.03, 0.013), 0.008, 0.003), sparkleMat));
  object.add(sparkle);
  object.rotation.set(-0.06, 0, 0.06);
  const base = sparkleMat.color.clone();
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      sparkle.rotation.y = pose.time * 1.2;
      const twinkle = 0.75 + 0.25 * Math.sin(pose.time * 5.3) + 0.15 * Math.sin(pose.time * 13.1);
      sparkle.scale.setScalar(0.9 + 0.15 * twinkle);
      sparkleMat.color.copy(base).multiplyScalar(twinkle);
    },
  };
}

/** Auréola dourada flutuando acima da cabeça (sobe e desce devagar). Deixa o chifre de fora. */
export function halo(): AccessoryModel {
  const object = new THREE.Group();
  const ring = joint([0, 0.22, -0.04], [-0.3, 0, 0], true);
  ring.add(part(flatRing(0.098, 0.016, 12, 56), Mat.glow('#ffc94a', 2)));
  object.add(ring);
  return {
    object,
    update: (pose: OutfitPose) => {
      ring.position.y = 0.22 + Math.sin(pose.time * 1.9) * 0.012;
      ring.rotation.z = Math.sin(pose.time * 1.3) * 0.06;
    },
  };
}

/**
 * Chapéu de cangaceiro (o de couro do Lampião): copa redonda e a aba oval
 * dobrada pra cima na frente e atrás, em duas "meias-luas" quase em pé e bem
 * mais altas que a copa; dos lados ela fica deitada e estreita. Na meia-lua da
 * frente, o signo de Salomão (estrela de seis pontas) no meio, moedas dos lados
 * e tachinhas seguindo o debrum de couro escuro; atrás, uma estrela menor.
 */
export function cangaceiroHat(): AccessoryModel {
  const object = new THREE.Group();
  const THICKNESS = 0.012;
  const brimGeo = slabSurface((u, v, target) => cangaceiroBrim(u * Math.PI, v, target), 180, 18, THICKNESS);
  // Couro claro na face e o debrum escuro na borda; cor por vértice pelo (u, v) da chapa.
  const tan = new THREE.Color('#a8703c');
  const deep = new THREE.Color('#4a2b14');
  paintByUv(brimGeo, (u, v, c) => {
    const span = cangaceiroRadius(u * Math.PI) - CANGACEIRO.inner;
    const fromEdge = (1 - v) * span;
    return c.copy(tan).lerp(deep, Math.max(1 - smoothstep(0.007, 0.014, fromEdge), (1 - smoothstep(0, 0.03, v * span)) * 0.45));
  });
  object.add(part(brimGeo, clay(0xffffff, { vertexColors: true, roughness: 0.6, sheen: 0.45, bump: 0.3, clearcoat: 0.18, mottle: 0.1, mottleScale: 16 })));
  const leather = Mat.leather('#6b4222');
  object.add(
    part(
      lathe(
        [
          [0.108, -0.006],
          [0.112, 0.03],
          [0.106, 0.07],
          [0.086, 0.1],
          [0.05, 0.116],
          [0, 0.12],
        ],
        44,
        0.002,
        29,
      ),
      leather,
    ),
  );
  object.add(part(flatRing(0.111, 0.009, 8, 48), Mat.leather('#3f2410'), [0, 0.012, 0], [0, 0, 0], [1, 1.3, 1]));
  const metal = Mat.metal('#e6c35c');
  const lift = THICKNESS / 2;
  // Signo de Salomão: o hexagrama (as pontas de dentro a 1/√3 das de fora) com o botão no meio.
  const star = extrude(starShape(6, 0.046, 0.046 / Math.sqrt(3)), 0.007, 0.0025);
  const front = cangaceiroWall(1, 0, 0.085, lift + 0.004);
  object.add(placed(part(star, metal), front));
  object.add(placed(part(claySphere(0.011, 2, 0.02), Mat.metal('#c9962e'), [0, 0, 0.006], [0, 0, 0], [1, 1, 0.55]), front));
  object.add(placed(part(star, metal, [0, 0, 0], [0, 0, 0], 0.62), cangaceiroWall(-1, 0, 0.08, lift + 0.004)));
  // Moedas dos lados da estrela (disco com o aro), deitadas na parede.
  const coin = new THREE.CylinderGeometry(0.016, 0.016, 0.004, 20).rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.016, 0.0022, 6, 24);
  for (const side of [1, -1]) {
    for (const [x, d, size] of [
      [0.075, 0.07, 1],
      [0.118, 0.045, 0.78],
    ] as const) {
      const at = cangaceiroWall(1, side * x, d, lift + 0.003);
      object.add(placed(part(coin, metal, [0, 0, 0], [0, 0, 0], size), at));
      object.add(placed(part(rim, metal, [0, 0, 0.001], [0, 0, 0], size), at));
    }
  }
  // Tachinhas seguindo o debrum das duas meias-luas (só onde a aba está em pé).
  const stud = claySphere(0.0062, 1, 0.05);
  for (const face of [1, -1] as const) {
    for (let i = -7; i <= 7; i++) {
      const x = i * 0.02;
      const d = cangaceiroEdge(x) - 0.016;
      if (d < 0.02) continue;
      object.add(placed(part(stud, metal), cangaceiroWall(face, x, d, lift + 0.002)));
    }
  }
  object.scale.setScalar(0.95);
  object.rotation.x = -0.06;
  return { object, hidesHorn: true };
}

/** Medidas da aba do cangaceiro. */
const CANGACEIRO = {
  inner: 0.106,
  /** Linha da dobra (reta, de lado a lado), a essa distância do centro na frente e atrás. */
  fold: 0.112,
  /** Quanto a meia-lua fica em pé (rad; um tico aberta pra fora). */
  rise: 1.32,
  /** Semieixos da aba oval deitada: estreita dos lados, comprida na frente e atrás (vira a meia-lua). */
  rx: 0.168,
  rz: 0.28,
};

/** Raio da aba oval (ainda deitada) no ângulo `theta` a partir de +Z. */
function cangaceiroRadius(theta: number): number {
  return 1 / Math.hypot(Math.sin(theta) / CANGACEIRO.rx, Math.cos(theta) / CANGACEIRO.rz);
}

/**
 * Dobra: um ponto que estava `d` depois da linha da dobra, deitado, vai pra
 * `along` (pra fora) e `up` (pra cima). A dobra é uma curvinha, não um vinco.
 */
function cangaceiroFold(d: number): { along: number; up: number } {
  const START = -0.01;
  if (d <= START) return { along: d, up: 0 };
  const STEPS = 20;
  const step = (d - START) / STEPS;
  let along = START;
  let up = 0;
  for (let i = 0; i < STEPS; i++) {
    const t = START + (i + 0.5) * step;
    const a = CANGACEIRO.rise * smoothstep(-0.006, 0.018, t);
    along += Math.cos(a) * step;
    up += Math.sin(a) * step;
  }
  return { along, up };
}

/** Superfície do meio da aba: `theta` na volta, `v` (0..1) da copa até a borda oval. */
function cangaceiroBrim(theta: number, v: number, target: THREE.Vector3): THREE.Vector3 {
  const r = CANGACEIRO.inner - 0.004 + v * (cangaceiroRadius(theta) - CANGACEIRO.inner + 0.004);
  const x = Math.sin(theta) * r;
  const z = Math.cos(theta) * r;
  const f = cangaceiroFold(Math.abs(z) - CANGACEIRO.fold);
  return target.set(x, f.up, Math.sign(z) * (CANGACEIRO.fold + f.along));
}

/** Até onde a meia-lua vai (distância depois da dobra) na altura lateral `x`. */
function cangaceiroEdge(x: number): number {
  const k = 1 - (x / CANGACEIRO.rx) ** 2;
  return k <= 0 ? 0 : CANGACEIRO.rz * Math.sqrt(k) - CANGACEIRO.fold;
}

/**
 * Lugar na face de fora da meia-lua (`face` 1 = frente, -1 = trás), na
 * posição lateral `x` e a `d` depois da dobra, `lift` acima da superfície do
 * meio: +Z da peça sai da parede, +Y sobe por ela.
 */
function cangaceiroWall(face: 1 | -1, x: number, d: number, lift: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const f = cangaceiroFold(d);
  const up = new THREE.Vector3(0, Math.sin(CANGACEIRO.rise), face * Math.cos(CANGACEIRO.rise));
  const out = new THREE.Vector3(0, -Math.cos(CANGACEIRO.rise), face * Math.sin(CANGACEIRO.rise));
  const side = new THREE.Vector3().crossVectors(up, out);
  return {
    position: new THREE.Vector3(x, f.up, face * (CANGACEIRO.fold + f.along)).addScaledVector(out, lift),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, out)),
  };
}

/** Põe a peça no lugar/orientação dados (a posição/rotação próprias dela viram deslocamento local). */
function placed(mesh: THREE.Mesh, frame: { position: THREE.Vector3; quaternion: THREE.Quaternion }): THREE.Mesh {
  const local = mesh.position.clone().applyQuaternion(frame.quaternion);
  mesh.quaternion.premultiply(frame.quaternion);
  mesh.position.copy(frame.position).add(local);
  return mesh;
}

/** Pinta por vértice a partir do `uv` da chapa (u na volta, v da copa pra borda). */
function paintByUv(geometry: THREE.BufferGeometry, fn: (u: number, v: number, color: THREE.Color) => THREE.Color): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < uv.count; i++) fn(uv.getX(i) * 2 - 1, uv.getY(i), c).toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Coroa de ouro com cinco pontas, pérolas, pedras e um brilho que corre pelas pedras. Deixa o chifre de fora. */
export function crown(): AccessoryModel {
  const object = new THREE.Group();
  const gold = Mat.metal('#f2c14e');
  const band = crownBand(0.112, 0.012, (a) => 0.045 + 0.075 * Math.pow(Math.max(0, Math.cos(a * 5)), 0.55));
  object.add(part(lumpify(band, 0.0015, 40, 3), gold));
  object.add(part(flatRing(0.113, 0.009, 8, 56), gold, [0, 0.004, 0]));
  object.add(part(flatRing(0.113, 0.007, 8, 56), gold, [0, 0.044, 0]));
  const pearl = claySphere(0.014, 2, 0.02);
  const pearlMat = Mat.glossy('#fbf6ee');
  const gems = ['#e2334a', '#2f6fe0', '#2fb86a', '#e2334a', '#2f6fe0'];
  /** Onde fica cada pedra (o brilho pula de uma pra outra). */
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    object.add(part(pearl, pearlMat, [Math.cos(a) * 0.112, 0.124, Math.sin(a) * 0.112]));
    const g = a + Math.PI / 5;
    const out = new THREE.Vector3(Math.cos(g), 0, Math.sin(g));
    object.add(part(claySphere(0.014, 2, 0.02), Mat.glossy(gems[i]), [out.x * 0.12, 0.026, out.z * 0.12], [0, -g, 0], [0.55, 0.95, 0.95]));
    spots.push(out.multiplyScalar(0.132).setY(0.03));
  }
  // Um brilho só (um draw call), que passa de pedra em pedra.
  const glint = part(extrude(starShape(4, 0.016, 0.004), 0.002, 0.0008), Mat.glow('#ffffff', 2.4));
  glint.scale.setScalar(0);
  glint.userData.keep = true; // animado sozinho: não pode ser fundido com os outros
  object.add(glint);
  object.rotation.set(-0.08, 0, 0.05);
  return {
    object,
    update: (pose: OutfitPose) => {
      const t = pose.time * 0.9;
      const slot = Math.floor(t / 0.7);
      const phase = t - slot * 0.7;
      const at = spots[((slot % 5) + 5) % 5];
      glint.position.copy(at);
      glint.rotation.set(0, Math.PI / 2 - Math.atan2(at.z, at.x), t * 2);
      // Acende e apaga em meio segundo; descansa até a próxima pedra.
      glint.scale.setScalar(phase < 0.5 ? Math.sin((phase / 0.5) * Math.PI) : 0);
    },
  };
}
