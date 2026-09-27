import * as THREE from 'three';
import { claySphere, clayCapsule, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { EYE_TURN, bridgeAndArms, lensCenter, lensEdge, lensGlint, perEye } from './faceWear';
import { radial } from './hats';
import { Mat, brim, extrude, flatRing, joint, lathe, part, starShape } from './parts';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Feirinha, cabeça e rosto: o que se compra com moedas (boina, chapéu de
 * pescador, pirata, fones, nariz de palhaço, tapa-olho, aviador) e com orvalho
 * (chifre de unicórnio, óculos pixelados). Mesmas convenções de `hats.ts` e
 * `faceWear.ts`: chapéu com origem no topo da cabeça, rosto no meio da linha
 * dos olhos.
 */

/** Boina vermelha: o disco fofo caído de lado, o friso e o cabinho em cima. */
export function beret(): AccessoryModel {
  const object = new THREE.Group();
  const felt = Mat.felt('#d23a45');
  const body = lathe(
    [
      [0.1, -0.004],
      [0.12, 0.014],
      [0.152, 0.036],
      [0.158, 0.056],
      [0.134, 0.076],
      [0.072, 0.09],
      [0, 0.092],
    ],
    44,
    0.004,
    11,
  );
  object.add(part(body, felt));
  object.add(part(flatRing(0.101, 0.01, 8, 44), Mat.felt('#a82a35'), [0, 0.003, 0]));
  object.add(part(new THREE.CylinderGeometry(0.004, 0.007, 0.024, 8), felt, [0.004, 0.1, 0], [0.2, 0, -0.15]));
  object.rotation.set(-0.06, 0, 0.3);
  object.position.x = 0.035;
  return { object, hidesHorn: true };
}

/** Chapéu de pescador cáqui, com a aba caída e as costuras em volta. */
export function bucketHat(): AccessoryModel {
  const object = new THREE.Group();
  const khaki = new THREE.Color('#c9b27a');
  const stitch = new THREE.Color('#8f7a4a');
  const crown = lathe(
    [
      [0.118, -0.004],
      [0.116, 0.05],
      [0.106, 0.1],
      [0.082, 0.12],
      [0, 0.124],
    ],
    44,
    0.003,
    13,
  );
  object.add(part(crown, Mat.felt('#c9b27a')));
  // Aba: cai pra fora, com três voltas de costura pintadas.
  const brimGeo = paintVertices(
    brim(0.112, 0.205, 0.014, (_a, t) => -t * 0.055),
    (p, _n, c) => {
      const r = Math.hypot(p.x, p.z);
      const line = [0.135, 0.16, 0.185].some((ring) => Math.abs(r - ring) < 0.0022) ? 1 : 0;
      return c.copy(khaki).lerp(stitch, line * 0.8);
    },
  );
  object.add(part(brimGeo, Mat.painted(0.85)));
  object.add(part(flatRing(0.117, 0.008, 6, 44), Mat.fabric('#7a6a44'), [0, 0.02, 0]));
  object.rotation.set(0.04, 0, -0.1);
  return { object, hidesHorn: true };
}

/**
 * Chapéu de pirata de desenho animado: a meia-lua preta de feltro em pé (o
 * bicorne), com o galão dourado na borda e a caveirinha com os ossos na frente.
 * De frente é a silhueta que todo mundo reconhece.
 */
export function pirateHat(): AccessoryModel {
  const object = new THREE.Group();
  const felt = Mat.felt('#1f1c24');
  const gold = Mat.metal('#e0b44a');
  // Meia-lua: arco em cima, base levemente curva (abraça a cabeça).
  const W = 0.25;
  const T = 0.17;
  const moon = new THREE.Shape();
  moon.moveTo(-W, 0.01);
  moon.bezierCurveTo(-W * 0.9, T * 0.95, -W * 0.35, T * 1.12, 0, T * 1.08);
  moon.bezierCurveTo(W * 0.35, T * 1.12, W * 0.9, T * 0.95, W, 0.01);
  moon.bezierCurveTo(W * 0.6, -0.02, -W * 0.6, -0.02, -W, 0.01);
  const body = extrude(moon, 0.07, 0.022, 28);
  // Curva de leve pra trás nas pontas (acompanha a cabeça).
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - (pos.getX(i) / W) ** 2 * 0.06);
  body.computeVertexNormals();
  object.add(part(body, felt));
  // Galão: um fio dourado seguindo o arco, na frente e atrás.
  const arc = new THREE.CatmullRomCurve3(
    moon.getSpacedPoints(60).filter((p) => p.y > 0.03).map((p) => new THREE.Vector3(p.x, p.y, 0)),
  );
  for (const z of [0.047, -0.047]) {
    const trim = taperedTube(arc, 60, () => 0.007, 6);
    const tp = trim.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) + z - (tp.getX(i) / W) ** 2 * 0.06);
    trim.computeVertexNormals();
    object.add(part(trim, gold, [0, -0.004, 0]));
  }
  // Caveirinha com os ossos cruzados, na frente.
  const bone = Mat.clay('#f6f1e6');
  const emblem = joint([0, 0.085, 0.05]);
  emblem.add(part(claySphere(0.028, 2, 0.04), bone, [0, 0.008, 0], [0, 0, 0], [1, 0.95, 0.5]));
  emblem.add(part(new THREE.BoxGeometry(0.03, 0.016, 0.012), bone, [0, -0.018, -0.002]));
  for (const side of [1, -1]) {
    emblem.add(part(claySphere(0.0075, 1, 0), Mat.clay('#1f1c24'), [side * 0.01, 0.008, 0.013]));
    emblem.add(part(clayCapsule(0.006, 0.075, 0, 0, 6), bone, [0, -0.008, -0.008], [0, 0, side * 0.75 + Math.PI / 2]));
  }
  object.add(emblem);
  object.position.set(0, 0.0, -0.01);
  object.rotation.set(-0.12, 0, 0.06);
  return { object, hidesHorn: true };
}

/**
 * Fones de ouvido: o arco por cima da cabeça e as duas conchas dos lados, atrás
 * dos olhos. A luzinha da concha pisca no ritmo e as conchas "pulsam" de leve.
 */
export function headphones(): AccessoryModel {
  const object = new THREE.Group();
  const band = Mat.plastic('#2c2a33');
  const cushion = Mat.fabric('#3a3642');
  const shell = Mat.plastic('#ff5f7e');
  const CUP_X = 0.27;
  const CUP_Y = -0.17;
  const CUP_Z = -0.05;
  const arc = new THREE.CatmullRomCurve3(
    [-1, -0.7, -0.35, 0, 0.35, 0.7, 1].map((u) => {
      const a = (u * Math.PI) / 2;
      return new THREE.Vector3(Math.sin(a) * CUP_X * 0.98, CUP_Y + 0.05 + Math.cos(a) * 0.19, CUP_Z);
    }),
  );
  object.add(part(taperedTube(arc, 40, () => 0.012, 8), band));
  // Almofadinha no alto do arco.
  object.add(part(clayCapsule(0.016, 0.12, 0.03, 3, 10), cushion, [0, CUP_Y + 0.235, CUP_Z], [0, 0, Math.PI / 2]));
  const cups: THREE.Group[] = [];
  const leds: THREE.Mesh[] = [];
  const ledMat = Mat.glow('#7dfcff', 2.2);
  for (const side of [1, -1]) {
    const cup = joint([side * CUP_X, CUP_Y, CUP_Z], [0, 0, side * -Math.PI / 2], true);
    cup.add(part(new THREE.CylinderGeometry(0.06, 0.062, 0.034, 28), shell, [0, 0.012, 0]));
    cup.add(part(new THREE.TorusGeometry(0.048, 0.016, 10, 28).rotateX(Math.PI / 2), cushion, [0, -0.012, 0]));
    cup.add(part(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 20), Mat.plastic('#fbf1e2'), [0, 0.031, 0]));
    const led = part(new THREE.SphereGeometry(0.008, 10, 8), ledMat, [0.03, 0.03, 0.02]);
    led.userData.keep = true;
    cup.add(led);
    leds.push(led);
    cups.push(cup);
    object.add(cup);
  }
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      // Batida a ~110 BPM: a concha "respira" e a luzinha pisca.
      const beat = Math.pow(0.5 + 0.5 * Math.cos(pose.time * Math.PI * 2 * 1.83), 6);
      for (const cup of cups) cup.scale.setScalar(1 + beat * 0.035);
      for (const led of leds) led.scale.setScalar(0.6 + beat * 0.7);
    },
  };
}

/**
 * Chifre de unicórnio: espiral em tons pastel que termina em ouro, trocando o
 * chifre do besouro. Três estrelinhas voam em volta.
 */
export function unicornHorn(): AccessoryModel {
  const object = new THREE.Group();
  const HEIGHT = 0.26;
  const cone = lathe(
    [
      [0.044, 0],
      [0.04, 0.05],
      [0.03, 0.12],
      [0.017, 0.2],
      [0.003, HEIGHT],
    ],
    32,
    0,
  );
  radial(cone, (a, y) => -0.005 * (0.5 + 0.5 * Math.sin(a + y * 70)) * (1 - y / HEIGHT));
  const colors = ['#ff8fc8', '#b98bff', '#6fd0ff', '#ffe27a'].map((c) => new THREE.Color(c));
  const gold = new THREE.Color('#f2c14e');
  paintVertices(cone, (p, _n, c) => {
    const t = Math.min(0.999, p.y / HEIGHT) * (colors.length - 1);
    const i = Math.floor(t);
    c.copy(colors[i]).lerp(colors[i + 1], t - i);
    const stripe = 0.5 + 0.5 * Math.sin(Math.atan2(p.z, p.x) + p.y * 70);
    c.lerp(new THREE.Color('#ffffff'), stripe * 0.12);
    return c.lerp(gold, smoothstep(HEIGHT * 0.82, HEIGHT * 0.95, p.y));
  });
  const horn = joint([0, -0.085, 0.06], [0.42, 0, 0]);
  horn.add(part(cone, Mat.painted(0.25)));
  horn.add(part(flatRing(0.046, 0.011, 8, 32), Mat.metal('#f2c14e'), [0, 0.004, 0]));
  object.add(horn);
  // Estrelinhas girando em volta (luz própria).
  const orbit = joint([0, 0.02, 0.1], [0.42, 0, 0], true);
  const starMat = Mat.glow('#fff1b0', 2.2);
  const starGeo = extrude(starShape(4, 0.02, 0.006), 0.004, 0.0015);
  const stars: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const star = part(starGeo, starMat);
    star.userData.keep = true;
    orbit.add(star);
    stars.push(star);
  }
  object.add(orbit);
  return {
    object,
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      stars.forEach((star, i) => {
        const a = pose.time * 1.6 + (i * Math.PI * 2) / 3;
        const r = 0.075 + 0.015 * Math.sin(pose.time * 2 + i);
        star.position.set(Math.cos(a) * r, Math.sin(pose.time * 1.3 + i * 2) * 0.05 + i * 0.03, Math.sin(a) * r);
        star.rotation.set(0, -a, pose.time * 3 + i);
        star.scale.setScalar(0.6 + 0.4 * Math.abs(Math.sin(pose.time * 2.5 + i * 1.7)));
      });
    },
  };
}

// --- rosto -------------------------------------------------------------------------

/** Nariz de palhaço: a bolota vermelha brilhando entre os olhos. */
export function clownNose(): AccessoryModel {
  const object = new THREE.Group();
  object.add(part(claySphere(0.045, 3, 0.02, 2, 5), Mat.glossy('#e8252f'), [0, -0.03, 0.12]));
  object.add(part(claySphere(0.012, 2, 0), Mat.glossy('#ffffff'), [-0.018, -0.012, 0.158], [0, 0, 0], [1, 0.7, 0.4]));
  return { object };
}

/** Tapa-olho de pirata no olho direito, com a tira passando por cima da cabeça. */
export function eyepatch(): AccessoryModel {
  const object = new THREE.Group();
  const cloth = Mat.leather('#1f1c24');
  const outline = new THREE.Shape();
  outline.moveTo(-0.07, 0.03);
  outline.bezierCurveTo(-0.07, 0.07, 0.07, 0.07, 0.07, 0.03);
  outline.bezierCurveTo(0.07, -0.04, 0.02, -0.075, 0, -0.075);
  outline.bezierCurveTo(-0.02, -0.075, -0.07, -0.04, -0.07, 0.03);
  const patch = joint();
  patch.position.copy(lensCenter(1, 0.075));
  patch.rotation.y = EYE_TURN;
  patch.add(part(extrude(outline, 0.012, 0.005, 16), cloth));
  patch.add(part(claySphere(0.01, 1, 0), Mat.metal('#c9a24a'), [0, 0.035, 0.012]));
  object.add(patch);
  // Tira: da borda de dentro, sobe pela testa e passa por cima; da borda de fora, vai pra trás.
  const inner = lensEdge(1, Math.PI * 0.85, 0.07);
  const outer = lensEdge(1, -0.1, 0.075);
  const over = new THREE.CatmullRomCurve3([
    inner,
    new THREE.Vector3(0, -0.005, 0.035),
    new THREE.Vector3(-0.12, 0.02, -0.1),
    new THREE.Vector3(-0.2, -0.04, -0.18),
  ]);
  const back = new THREE.CatmullRomCurve3([outer, new THREE.Vector3(outer.x + 0.03, outer.y + 0.005, outer.z - 0.08), new THREE.Vector3(outer.x + 0.02, outer.y + 0.01, outer.z - 0.18)]);
  object.add(part(taperedTube(over, 24, () => 0.006, 6), cloth));
  object.add(part(taperedTube(back, 16, () => 0.006, 6), cloth));
  return { object };
}

/** Óculos de aviador: lente em gota, degradê âmbar, aro dourado fininho e a barra dupla em cima. */
export function aviators(): AccessoryModel {
  const object = new THREE.Group();
  const gold = Mat.metal('#d9b44a');
  // Gota: larga em cima, pontuda pra dentro-embaixo.
  const drop = (side: 1 | -1) => {
    const s = new THREE.Shape();
    s.moveTo(-0.075 * side, 0.035);
    s.bezierCurveTo(-0.04 * side, 0.058, 0.05 * side, 0.058, 0.074 * side, 0.03);
    s.bezierCurveTo(0.09 * side, -0.01, 0.05 * side, -0.07, 0.005 * side, -0.068);
    s.bezierCurveTo(-0.045 * side, -0.066, -0.08 * side, -0.02, -0.075 * side, 0.035);
    return s;
  };
  const amber = new THREE.Color('#5a3a1a');
  const light = new THREE.Color('#e3a24a');
  object.add(
    perEye((side) => {
      const eye = new THREE.Group();
      const shape = drop(side);
      const lens = paintVertices(extrude(shape, 0.006, 0.002, 20), (p, _n, c) => c.copy(amber).lerp(light, smoothstep(0.04, -0.06, p.y)));
      eye.add(part(lens, Mat.painted(0.12)));
      const rim = new THREE.CatmullRomCurve3(shape.getSpacedPoints(40).map((v) => new THREE.Vector3(v.x, v.y, 0)), true);
      eye.add(part(taperedTube(rim, 60, () => 0.0045, 6, true), gold));
      eye.add(lensGlint(side, 0.008));
      return eye;
    }),
  );
  object.add(bridgeAndArms(gold, 0.078, 0.0045, 0.02));
  object.scale.setScalar(0.9);
  return { object };
}

/** Óculos pixelados ("deal with it"): quadradinhos pretos com o brilho em pixel branco. */
export function pixelShades(): AccessoryModel {
  const object = new THREE.Group();
  const PX = 0.022;
  const black = Mat.plastic('#141218');
  const white = Mat.plastic('#fbf6ee');
  const cube = new THREE.BoxGeometry(PX, PX, PX * 1.1);
  const rows: string[] = [
    // x de -8 a 8 (17 colunas); # = preto, o = brilho branco, . = vazio
    '#################',
    '.#oo####.#oo####.',
    '..######.######..',
    '...####...####...',
  ];
  rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      const x = (i - 8) * PX;
      // Curva de leve pros lados (acompanha o rosto).
      const z = 0.155 - x * x * 1.4;
      object.add(part(cube, ch === 'o' ? white : black, [x, 0.03 - y * PX, z], [0, -x * 2.2, 0]));
    }
  });
  // Hastes pra trás, rentes aos olhos.
  for (const side of [1, -1]) {
    const arm = new THREE.LineCurve3(new THREE.Vector3(side * 8 * PX, 0.03, 0.155 - (8 * PX) ** 2 * 1.4), new THREE.Vector3(side * 0.21, 0.04, -0.06));
    object.add(part(taperedTube(arm, 4, () => 0.007, 4), black));
  }
  return { object };
}
