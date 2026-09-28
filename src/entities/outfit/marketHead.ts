import * as THREE from 'three';
import { claySphere, clayCapsule, paintVertices, taperedTube } from '../../render/geometry';
import { smoothstep } from '../../utils/math';
import { EYE_TURN, bridgeAndArms, lensCenter, lensGlint, perEye } from './faceWear';
import { radial } from './hats';
import { Mat, brim, extrude, flatRing, joint, lathe, part, starShape } from './parts';
import { slab } from './skinned';
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
 * Tricórnio de pirata: a aba presa pra cima em três paredes (a da frente com a
 * caveira), os três cantos deitados apontando pra fora, galão dourado na borda
 * e uma pena vermelha enfiada do lado. De frente lê como o chapéu de pirata dos
 * desenhos; de lado e de costas tem volume (copa e as outras duas paredes).
 */
export function pirateHat(): AccessoryModel {
  const object = new THREE.Group();
  const felt = Mat.felt('#221e29');
  const gold = Mat.metal('#e3b54c');
  const brimGeo = tricornBrim();
  object.add(part(brimGeo.geometry, felt));
  object.add(
    part(
      lathe(
        [
          [0.114, -0.006],
          [0.118, 0.03],
          [0.113, 0.07],
          [0.096, 0.104],
          [0.058, 0.127],
          [0, 0.133],
        ],
        44,
        0.003,
        29,
      ),
      felt,
    ),
  );
  // Galão: um cordão dourado seguindo a borda inteira (paredes e cantos).
  object.add(part(taperedTube(brimGeo.edge, 220, () => 0.0065, 6, true), gold));
  // Caveira com os ossos cruzados na parede da frente, deitada nela.
  const bone = Mat.clay('#f6f1e6');
  const hole = Mat.clay('#221e29');
  const emblem = joint(brimGeo.front.position.toArray() as [number, number, number]);
  emblem.quaternion.copy(brimGeo.front.quaternion);
  emblem.add(part(claySphere(0.024, 2, 0.03), bone, [0, 0.009, 0.004], [0, 0, 0], [1, 0.92, 0.45]));
  emblem.add(part(claySphere(0.014, 2, 0.03), bone, [0, -0.012, 0.004], [0, 0, 0], [1, 0.7, 0.4]));
  for (const side of [1, -1]) {
    emblem.add(part(claySphere(0.0068, 1, 0), hole, [side * 0.0092, 0.008, 0.014], [0, 0, 0], [1, 1.1, 0.5]));
    const boneBar = part(clayCapsule(0.0048, 0.074, 0, 0, 6), bone, [0, 0.0, -0.001], [0, 0, side * 0.72 + Math.PI / 2]);
    emblem.add(boneBar);
    for (const end of [1, -1]) {
      const a = side * 0.72 + Math.PI / 2;
      const ex = -Math.sin(a) * 0.041 * end;
      const ey = Math.cos(a) * 0.041 * end;
      emblem.add(part(claySphere(0.0062, 1, 0), bone, [ex + Math.cos(a) * 0.004, ey + Math.sin(a) * 0.004, -0.001]));
      emblem.add(part(claySphere(0.0062, 1, 0), bone, [ex - Math.cos(a) * 0.004, ey - Math.sin(a) * 0.004, -0.001]));
    }
  }
  emblem.add(part(claySphere(0.0035, 1, 0), hole, [0, -0.002, 0.015], [0, 0, 0], [1, 0.8, 0.5]));
  emblem.scale.setScalar(0.82);
  object.add(emblem);
  // Pena vermelha enfiada atrás da parede da direita, subindo e varrendo pra trás.
  object.add(part(plume(), Mat.painted(0.7), [0.07, 0.07, -0.04], [0, 0, -0.35]));
  object.position.set(0, 0.0, -0.012);
  object.rotation.set(-0.1, 0, 0.05);
  return { object, hidesHorn: true };
}

/**
 * Aba do tricórnio: anel que sai da copa deitado e dobra pra cima nas três
 * paredes. Cada parede é reta (plana) entre dois cantos, como a aba presa de
 * verdade: a dobra fica a `WALL` do centro no meio da parede e se afasta até o
 * canto, onde a aba já acabou antes de dobrar (o canto fica deitado, em ponta).
 * Devolve também a borda (pro galão) e onde fica o meio da parede da frente.
 */
function tricornBrim(): { geometry: THREE.BufferGeometry; edge: THREE.Curve<THREE.Vector3>; front: { position: THREE.Vector3; quaternion: THREE.Quaternion } } {
  const INNER = 0.108;
  const WIDTH = 0.138;
  const WALL = 0.124;
  const RISE = 1.42; // quanto a parede fica em pé (rad, quase vertical, levemente aberta)
  const STEPS = 28;
  // Ângulo a partir da frente (+Z) girando pra +X; paredes centradas em 0 e ±120°.
  const fold = (theta: number) => {
    const sector = (2 * Math.PI) / 3;
    const d = ((((theta % sector) + sector * 1.5) % sector) - sector / 2);
    return WALL / Math.cos(d);
  };
  const section = (theta: number, v: number, target: THREE.Vector3) => {
    const f = fold(theta);
    const bendAt = f - INNER;
    let r = INNER - 0.004;
    let y = 0;
    const len = v * WIDTH;
    const step = len / STEPS;
    for (let i = 0; i < STEPS; i++) {
      const l = (i + 0.5) * step;
      // Deitada até a dobra, sobe numa curva curtinha; os cantos levantam só um pouco.
      const a = 0.12 + (RISE - 0.12) * smoothstep(bendAt - 0.012, bendAt + 0.018, l);
      r += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    return target.set(Math.sin(theta) * r, y, Math.cos(theta) * r);
  };
  const geometry = slab((u, v, target) => section(u * Math.PI, v, target), 150, 14, 0.012);
  const edgePoints: THREE.Vector3[] = [];
  for (let i = 0; i < 180; i++) edgePoints.push(section((i / 180) * Math.PI * 2, 1, new THREE.Vector3()));
  const edge = new THREE.CatmullRomCurve3(edgePoints, true);
  // Meio da parede da frente: ponto a ~55% da altura e a normal pra fora (pra deitar a caveira).
  const a = section(0, 0.52, new THREE.Vector3());
  const b = section(0, 0.72, new THREE.Vector3());
  const up = b.clone().sub(a).normalize();
  const out = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize();
  const position = a.clone().lerp(b, 0.5).addScaledVector(out, 0.007);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, out), up, out);
  return { geometry, edge, front: { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(basis) } };
}

/**
 * Pluma: chapa curvada ao longo da nervura (sobe e cai pra trás), com a
 * largura deitada a 45° (aparece de lado e da câmera de trás), a nervura clara
 * no meio e as barbas escurecendo pras bordas.
 */
function plume(): THREE.BufferGeometry {
  const spine = (v: number) => new THREE.Vector3(v * 0.05, Math.sin(v * 1.9) * 0.15, -v * 0.24);
  const side = new THREE.Vector3(0.65, 0.75, 0.1).normalize();
  const geometry = slab(
    (u, v, target) => {
      const width = 0.05 * Math.sin(Math.PI * Math.min(1, v * 1.05 + 0.04)) ** 0.6 * (1 - v * 0.2);
      const droop = Math.abs(u) ** 2 * 0.012;
      return target.copy(spine(v)).addScaledVector(side, u * width).setY(target.y - droop);
    },
    10,
    22,
    0.004,
  );
  const crimson = new THREE.Color('#d0293b');
  const deep = new THREE.Color('#7e1224');
  const shaft = new THREE.Color('#f7d9c4');
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * 2 - 1;
    const v = uv.getY(i);
    // Barbas: listrinhas finas oblíquas (a pena "penteada").
    const barb = 0.5 + 0.5 * Math.sin((v * 34 - Math.abs(u) * 3) * Math.PI);
    c.copy(crimson).lerp(deep, smoothstep(0.45, 1, Math.abs(u)) * 0.65 + barb * 0.12);
    c.lerp(shaft, (1 - smoothstep(0.05, 0.14, Math.abs(u))) * (1 - v * 0.5));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
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

/**
 * Tapa-olho de pirata: uma calota de couro abraçando o olho direito (por fora
 * da pálpebra, senão o brilho do olho vaza), o rebite dourado no meio e a tira
 * saindo da borda: por cima da testa de um lado, pra trás do outro.
 */
export function eyepatch(): AccessoryModel {
  const object = new THREE.Group();
  const cloth = Mat.leather('#1f1c24');
  // Calota: casca esférica de raio um tiquinho maior que a pálpebra (0,094), aberta em ~41°.
  const R = 0.102;
  const OPEN = 0.72;
  const THICK = 0.008;
  const profile: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * OPEN;
    profile.push([Math.sin(t) * R, Math.cos(t) * R]);
  }
  for (let i = 12; i >= 0; i--) {
    const t = (i / 12) * OPEN;
    profile.push([Math.sin(t) * (R - THICK), Math.cos(t) * (R - THICK)]);
  }
  const patch = joint(lensCenter(1, 0).toArray() as [number, number, number]);
  const out = new THREE.Vector3(Math.sin(EYE_TURN), 0.04, Math.cos(EYE_TURN)).normalize();
  patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
  patch.add(part(lathe(profile, 32, 0.0015, 7), cloth, [0, 0, 0], [0, 0, 0], [1, 1, 0.9]));
  patch.add(part(claySphere(0.011, 1, 0), Mat.metal('#c9a24a'), [0, R + 0.002, 0]));
  object.add(patch);
  // Onde a tira sai: o ponto da borda mais pra testa/nariz e o mais pro lado de fora.
  patch.updateMatrix();
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    rim.push(new THREE.Vector3(Math.sin(OPEN) * R * Math.cos(a), Math.cos(OPEN) * R, Math.sin(OPEN) * R * Math.sin(a) * 0.9).applyMatrix4(patch.matrix));
  }
  const pick = (score: (p: THREE.Vector3) => number) => rim.reduce((best, p) => (score(p) > score(best) ? p : best));
  const inner = pick((p) => p.y * 0.7 - p.x);
  const outer = pick((p) => p.x - p.z * 0.4 + p.y * 0.2);
  const over = new THREE.CatmullRomCurve3([
    inner,
    new THREE.Vector3(0.02, inner.y + 0.02, inner.z - 0.02),
    new THREE.Vector3(-0.12, 0.03, -0.1),
    new THREE.Vector3(-0.2, -0.03, -0.18),
  ]);
  const back = new THREE.CatmullRomCurve3([outer, new THREE.Vector3(outer.x + 0.025, outer.y + 0.005, outer.z - 0.07), new THREE.Vector3(outer.x + 0.02, outer.y + 0.01, outer.z - 0.18)]);
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
