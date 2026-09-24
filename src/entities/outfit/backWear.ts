import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { claySphere, lumpify, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { Mat, extrude, joint, lathe, part } from './parts';
import { chainSkin, slab } from './skinned';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Coisas das costas. Origem = topo das costas, onde o pronoto encontra os
 * élitros (logo à frente do escutelo). Os élitros são duas cúpulas: o topo de
 * cada uma fica a ±0,17 u pro lado, ~0,03 u acima da origem e ~0,23 u pra trás;
 * no meio delas há um vale (a sutura).
 *
 * Empurrando a bola o besouro fica de ponta-cabeça (traseira pra cima, na
 * bola): o que sai pra trás (chamas do foguete) apaga nessa pose.
 */

/** Casca que envolve as duas cúpulas dos élitros (a capa e a mochila apoiam nela). */
const SHELL = { cy: -0.25, cz: -0.23, rx: 0.46, ry: 0.33, rz: 0.48 };

/** Espelha um contorno 2D no eixo X (desenha a asa da esquerda a partir da direita). */
function shapeFrom(points: ReadonlyArray<readonly [number, number]>, mirror: boolean): THREE.Shape {
  const list = mirror ? [...points].reverse().map(([x, y]) => [-x, y] as const) : points;
  const shape = new THREE.Shape();
  shape.moveTo(list[0][0], list[0][1]);
  // Curva suave passando pelos pontos (spline do próprio three).
  shape.splineThru(list.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  return shape;
}

/** Bandeirinha de bicicleta: mastro fininho e a flâmula laranja com o solzinho, tremulando. */
export function flag(): AccessoryModel {
  const object = new THREE.Group();
  const white = Mat.plastic('#f6f1e8');
  const mast = joint([0.15, 0.01, -0.36], [-0.14, 0, -0.08]);
  mast.add(part(new THREE.CylinderGeometry(0.0055, 0.0075, 0.5, 8).translate(0, 0.25, 0), white));
  mast.add(part(claySphere(0.013, 2, 0.02), white, [0, 0.505, 0]));
  mast.add(part(claySphere(0.018, 2, 0.05), Mat.plastic('#3a3a40'), [0, 0.004, 0], [0, 0, 0], [1, 0.5, 1]));
  // Flâmula: triângulo comprido pra trás, com o solzinho perto do mastro.
  const LENGTH = 0.32;
  const tri = new THREE.Shape();
  tri.moveTo(0, 0.075);
  tri.lineTo(LENGTH, 0.005);
  tri.lineTo(LENGTH, -0.005);
  tri.lineTo(0, -0.075);
  tri.closePath();
  const orange = new THREE.Color('#ff8a3d');
  const sun = new THREE.Color('#ffd54a');
  const cloth = paintVertices(extrude(tri, 0.006, 0.002, 4), (p, _n, c) => {
    const d = Math.hypot(p.x - 0.075, p.y);
    const rays = Math.abs(Math.sin(Math.atan2(p.y, p.x - 0.075) * 5)) < 0.3 && d < 0.05 ? 1 : 0;
    return c.copy(orange).lerp(sun, d < 0.029 ? 1 : rays);
  });
  // Mais divisões no comprimento pra dobrar bonito.
  const bones = [0, 0.25, 0.5, 0.75, 1].map((t) => new THREE.Vector3(t * LENGTH, 0, 0));
  const pennant = chainSkin(subdivideAlong(cloth, 'x', 0.012), Mat.painted(0.75), bones, (p) => p.x / LENGTH);
  const hang = joint([0, 0.415, 0], [0, Math.PI / 2, 0], true);
  hang.add(pennant.mesh);
  mast.add(hang);
  object.add(mast);
  return {
    object,
    update: (pose: OutfitPose) => {
      const wind = 0.35 + Math.min(pose.speed / 4, 1) * 0.65;
      pennant.bones.forEach((bone, i) => {
        if (i === 0) return;
        bone.rotation.y = Math.sin(pose.time * (4 + wind * 5) - i * 1.1) * 0.22 * wind;
        bone.rotation.z = -0.05 * (1 - wind) * i;
      });
    },
  };
}

/**
 * Subdivide as faces compridas de uma geometria ao longo de um eixo, pra ela
 * poder dobrar suave (extrude de triângulo sai com arestas longas demais pro osso).
 */
function subdivideAlong(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', maxEdge: number): THREE.BufferGeometry {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (let pass = 0; pass < 6; pass++) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    const out: number[] = [];
    const outColor: number[] = [];
    let split = false;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
    const push = (p: THREE.Vector3, k: THREE.Color) => {
      out.push(p.x, p.y, p.z);
      outColor.push(k.r, k.g, k.b);
    };
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        v[k].fromBufferAttribute(pos, i + k);
        if (col) c[k].fromBufferAttribute(col, i + k);
      }
      // Aresta mais comprida no eixo pedido: corta no meio.
      let worst = -1;
      let longest = maxEdge;
      for (let k = 0; k < 3; k++) {
        const len = Math.abs(v[k][axis] - v[(k + 1) % 3][axis]);
        if (len > longest) {
          longest = len;
          worst = k;
        }
      }
      if (worst < 0) {
        for (let k = 0; k < 3; k++) push(v[k], c[k]);
        continue;
      }
      split = true;
      const a = worst;
      const b = (worst + 1) % 3;
      const o = (worst + 2) % 3;
      const m = v[a].clone().lerp(v[b], 0.5);
      const mc = c[a].clone().lerp(c[b], 0.5);
      push(v[a], c[a]);
      push(m, mc);
      push(v[o], c[o]);
      push(m, mc);
      push(v[b], c[b]);
      push(v[o], c[o]);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(outColor, 3));
    if (!split) break;
  }
  g.computeVertexNormals();
  return g;
}

/** Mochilinha vermelha: bolso amarelo, tampa, alças pelos lados do pronoto e um chaveiro de sol balançando. */
export function backpack(): AccessoryModel {
  const object = new THREE.Group();
  const red = Mat.fabric('#e5483f');
  const pack = joint([0, 0.085, -0.22], [-0.12, 0, 0]);
  pack.add(part(lumpify(new RoundedBoxGeometry(0.3, 0.13, 0.26, 4, 0.045), 0.003, 25, 2), red));
  pack.add(part(new RoundedBoxGeometry(0.2, 0.05, 0.13, 3, 0.02), Mat.fabric('#ffc23d'), [0, 0.07, -0.03]));
  pack.add(part(new RoundedBoxGeometry(0.29, 0.03, 0.1, 3, 0.012), Mat.fabric('#b8322f'), [0, 0.066, 0.085], [0.18, 0, 0]));
  const metal = Mat.metal('#d9dde3');
  pack.add(part(new THREE.BoxGeometry(0.028, 0.02, 0.01), metal, [0, 0.07, 0.137]));
  // Zíper do bolso.
  pack.add(part(new THREE.BoxGeometry(0.16, 0.006, 0.006), metal, [0, 0.096, -0.03]));
  object.add(pack);
  const strap = Mat.fabric('#3a3a44');
  for (const side of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.12, 0.05, -0.11),
      new THREE.Vector3(side * 0.2, 0.02, -0.02),
      new THREE.Vector3(side * 0.29, -0.1, 0.05),
      new THREE.Vector3(side * 0.31, -0.22, 0.04),
    ]);
    object.add(part(taperedTube(curve, 20, () => 0.013, 6), strap, [0, 0, 0], [0, 0, 0], [1, 1, 1]));
  }
  // Chaveiro: argolinha e o solzinho, pendurado no canto de trás.
  const charm = joint([0.15, 0.08, -0.32], [0, 0, 0], true);
  charm.add(part(new THREE.TorusGeometry(0.01, 0.003, 6, 12), metal, [0, -0.01, 0], [0, Math.PI / 2, 0]));
  const sun = joint([0, -0.034, 0]);
  sun.add(part(claySphere(0.017, 2, 0.03), Mat.clay('#ffc23d'), [0, 0, 0], [0, 0, 0], [1, 1, 0.5]));
  const ray = new THREE.ConeGeometry(0.005, 0.012, 5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    sun.add(part(ray, Mat.clay('#ffc23d'), [Math.cos(a) * 0.023, Math.sin(a) * 0.023, 0], [0, 0, a - Math.PI / 2]));
  }
  charm.add(sun);
  object.add(charm);
  let swing = 0;
  let velocity = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      const push = Math.sin(pose.time * (5 + pose.speed * 2)) * Math.min(pose.speed / 3, 1) * 5 + pose.airborne * 4;
      velocity += (push - swing * 55 - velocity * 3.5) * pose.dt;
      swing += velocity * pose.dt;
      charm.rotation.x = swing * 0.7;
      charm.rotation.z = Math.sin(pose.time * 1.9) * 0.08;
    },
  };
}

/** Capa de herói vermelha com forro dourado nas bordas e fecho de ouro: esvoaça correndo e no pulo. */
export function cape(): AccessoryModel {
  const object = new THREE.Group();
  const THETA0 = 1.02;
  const THETA1 = 2.9;
  const { cy, cz, rx, ry, rz } = SHELL;
  const meridian = (v: number, target: THREE.Vector3) => {
    const theta = THETA0 + (THETA1 - THETA0) * v;
    return target.set(0, cy + ry * Math.sin(theta), cz + rz * Math.cos(theta));
  };
  const normalAt = (v: number, target: THREE.Vector3) => {
    const theta = THETA0 + (THETA1 - THETA0) * v;
    return target.set(0, Math.sin(theta) / ry, Math.cos(theta) / rz).normalize();
  };
  const m = new THREE.Vector3();
  const n = new THREE.Vector3();
  /** Quanto do comprimento segue o casco; o resto cai solto atrás da traseira. */
  const ON_SHELL = 0.78;
  const FALL = new THREE.Vector3(0, -0.92, -0.38).normalize();
  const surface = (u: number, v: number, target: THREE.Vector3) => {
    const along = Math.min(v, ON_SHELL) / ON_SHELL;
    meridian(along, m);
    normalAt(along, n);
    // Estreita no ombro, abre embaixo; dos lados o pano dobra acompanhando o casco.
    const half = 0.14 + 0.2 * smoothstep(0, 1, v);
    const wrap = 1.2;
    const a = u * wrap;
    const radius = half / wrap;
    const side = Math.sin(a) * radius * (rx / ry);
    const drop = (1 - Math.cos(a)) * radius * 1.05;
    // Pregas que vão abrindo até a barra.
    const fold = Math.sin(u * Math.PI * 3.5) * 0.013 * smoothstep(0.15, 1, v);
    target.set(side, m.y - n.y * drop, m.z - n.z * drop).addScaledVector(n, 0.02 + fold);
    return target.addScaledVector(FALL, Math.max(0, v - ON_SHELL) * 0.75);
  };
  const red = new THREE.Color('#d6343a');
  const gold = new THREE.Color('#f2c14e');
  const geometry = slab(surface, 16, 22, 0.011);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // Barrado dourado na borda de baixo e fininho nos lados.
  let index = 0;
  paintVertices(geometry, (_p, _nn, c) => {
    const u = uv.getX(index);
    const v = uv.getY(index++);
    const trim = Math.max(smoothstep(0.93, 0.955, v), smoothstep(0.035, 0.012, u), smoothstep(0.965, 0.988, u));
    return c.copy(red).lerp(gold, trim);
  });
  const joints = [0, 0.25, 0.5, 0.75, 1].map((v) => surface(0, v, new THREE.Vector3()));
  const chain = chainSkin(geometry, Mat.painted(0.8), joints, (_p, i) => uv.getY(i));
  object.add(chain.mesh);
  // Fecho: dois botões de ouro no ombro.
  const clasp = Mat.metal('#f2c14e');
  for (const side of [1, -1]) {
    const at = surface(side * 0.9, 0.015, new THREE.Vector3());
    object.add(part(claySphere(0.022, 2, 0.03), clasp, at.toArray() as [number, number, number], [0, 0, 0], [1, 0.7, 1]));
  }
  let lift = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 5, 1) * (1 - pose.pushBlend * 0.8);
      lift += ((run * 0.55 + pose.airborne * 0.35) - lift) * Math.min(1, pose.dt * 4);
      chain.bones.forEach((bone, i) => {
        if (i === 0) return;
        const flutter = Math.sin(pose.time * (6 + run * 6) - i * 1.2) * (0.03 + lift * 0.12);
        bone.rotation.x = lift * (0.12 + i * 0.08) + flutter;
        bone.rotation.z = Math.sin(pose.time * 2.4 + i * 0.9) * 0.025 * (1 + run);
      });
    },
  };
}

/** Asas de borboleta em lilás, rosa e pêssego, com veios e pintinhas: batem devagar (e mais rápido correndo). */
export function butterflyWings(): AccessoryModel {
  const object = new THREE.Group();
  const upper: Array<[number, number]> = [
    [0.01, 0.02],
    [0.08, 0.14],
    [0.2, 0.2],
    [0.31, 0.17],
    [0.3, 0.05],
    [0.19, -0.03],
    [0.04, -0.02],
  ];
  const lower: Array<[number, number]> = [
    [0.01, -0.03],
    [0.12, -0.05],
    [0.22, -0.11],
    [0.2, -0.21],
    [0.11, -0.22],
    [0.03, -0.1],
  ];
  const violet = new THREE.Color('#7a4fd6');
  const pink = new THREE.Color('#ff8fc8');
  const peach = new THREE.Color('#ffc27a');
  const ink = new THREE.Color('#2b2040');
  const white = new THREE.Color('#fff8f0');
  const paint = (p: THREE.Vector3, c: THREE.Color) => {
    // Aqui p.x = distância pra fora (já espelhada), p.z = frente/trás.
    const s = Math.abs(p.x);
    const r = Math.hypot(s, p.z);
    c.copy(violet).lerp(pink, smoothstep(0.03, 0.16, r)).lerp(peach, smoothstep(0.16, 0.28, r));
    const vein = 1 - smoothstep(0.0, 0.05, Math.abs(Math.sin(Math.atan2(p.z, s) * 7)));
    c.lerp(ink, vein * smoothstep(0.05, 0.12, r) * 0.55);
    c.lerp(ink, smoothstep(0.24, 0.29, r) * 0.85);
    const gx = s / 0.04;
    const gz = p.z / 0.04;
    const dot = 1 - smoothstep(0.16, 0.22, Math.hypot(gx - Math.round(gx), gz - Math.round(gz)));
    return c.lerp(white, dot * smoothstep(0.2, 0.25, r));
  };
  const material = Mat.painted(0.6);
  const hinges: THREE.Group[] = [];
  for (const side of [1, -1] as const) {
    const mirror = side < 0;
    const geos = [upper, lower].map((pts) => extrude(shapeFrom(pts, mirror), 0.008, 0.003, 20).rotateX(Math.PI / 2));
    const hinge = joint([side * 0.02, 0.06, -0.12], [0, 0, 0], true);
    hinge.scale.setScalar(1.4);
    for (const g of geos) hinge.add(part(paintVertices(g, (p, _n, c) => paint(p, c)), material));
    hinges.push(hinge);
    object.add(hinge);
  }
  // As asas de cima e de baixo batem juntas (mesma junta): funde as duas de cada lado.
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      const beat = Math.sin(pose.time * (3 + run * 9 + pose.airborne * 8));
      const angle = 0.95 + beat * (0.2 + run * 0.28 + pose.airborne * 0.2);
      hinges[0].rotation.z = angle;
      hinges[1].rotation.z = -angle;
    },
  };
}

/** Foguete de garrafa: duas garrafas PET com fita, aletas e fogo de mentirinha saindo pra trás. */
export function bottleRocket(): AccessoryModel {
  const object = new THREE.Group();
  const bottleMat = Mat.glossy('#9fe0ea');
  const capMat = Mat.plastic('#e5483f');
  const tape = Mat.fabric('#9aa0aa');
  const bottle = lathe(
    [
      [0.001, 0],
      [0.042, 0.003],
      [0.05, 0.016],
      [0.05, 0.17],
      [0.045, 0.2],
      [0.021, 0.238],
      [0.017, 0.246],
    ],
    28,
    0.0015,
    5,
  ).rotateX(-Math.PI / 2);
  const capGeo = lathe(
    [
      [0.019, 0],
      [0.02, 0.004],
      [0.02, 0.024],
      [0.014, 0.027],
      [0.001, 0.028],
    ],
    20,
    0,
  )
    .rotateX(-Math.PI / 2)
    .translate(0, 0, -0.244);
  const label = lathe(
    [
      [0.0515, 0.08],
      [0.0525, 0.083],
      [0.0525, 0.137],
      [0.0515, 0.14],
    ],
    28,
    0,
  ).rotateX(-Math.PI / 2);
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.045, -0.02);
  finShape.lineTo(0.045, 0.02);
  finShape.lineTo(0, 0.06);
  finShape.closePath();
  const finGeo = extrude(finShape, 0.006, 0.002, 4);
  // As duas chamas numa junta só (fundem em dois draw calls: a de fora e a de dentro).
  const flames = joint([0, 0.075, -0.352], [0, 0, 0], true);
  const outerMat = Mat.glow('#ff7a2a', 2.6);
  const innerMat = Mat.glow('#ffe7a0', 3.2);
  const outerGeo = new THREE.ConeGeometry(0.024, 0.11, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.055);
  const innerGeo = new THREE.ConeGeometry(0.013, 0.07, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.035);
  for (const side of [1, -1]) {
    const b = joint([side * 0.075, 0.075, -0.08]);
    b.add(part(bottle, bottleMat));
    b.add(part(capGeo, capMat));
    b.add(part(label, Mat.plastic('#fbf6ee')));
    b.add(part(claySphere(0.02, 2, 0.02), Mat.clay('#ffb547'), [0, 0.05, -0.11], [0, 0, 0], [1, 0.3, 1]));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (side > 0 ? 0.5 : -0.5);
      // Aleta em pé, saindo do corpo da garrafa: x do desenho = pra fora, y = pra trás.
      const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const basis = new THREE.Matrix4().makeBasis(radial, new THREE.Vector3(0, 0, -1), new THREE.Vector3(-Math.sin(a), Math.cos(a), 0));
      const fin = part(finGeo, capMat, [radial.x * 0.042, radial.y * 0.042, -0.19]);
      fin.quaternion.setFromRotationMatrix(basis);
      b.add(fin);
    }
    flames.add(part(outerGeo, outerMat, [side * 0.075, 0, 0]), part(innerGeo, innerMat, [side * 0.075, 0, 0]));
    object.add(b);
  }
  object.add(flames);
  // Fita prendendo as duas garrafas uma na outra (e no besouro).
  for (const z of [-0.02, -0.16]) {
    object.add(part(new THREE.TorusGeometry(0.06, 0.009, 6, 32), tape, [0, 0.075, z - 0.08], [0, 0, 0], [2.25, 1.05, 1]));
  }
  object.scale.setScalar(1.35);
  object.position.set(0, -0.02, 0.02);
  let flicker = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      flicker += pose.dt;
      // Empurrando a bola (de ponta-cabeça, garrafa na bosta): fogo apagado.
      const on = 1 - smoothstep(0.3, 0.7, pose.pushBlend);
      const power = (0.55 + Math.min(pose.speed / 5, 1) * 0.45 + pose.airborne * 0.5) * on;
      const f = 0.82 + 0.18 * Math.sin(flicker * 31) + 0.12 * Math.sin(flicker * 17.3);
      flames.scale.set(0.9 + 0.1 * f, 0.9 + 0.1 * f, power * f);
      flames.visible = power > 0.02;
    },
  };
}
