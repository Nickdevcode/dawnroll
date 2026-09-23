import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { claySphere, displace, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { createRng, smoothstep } from '../../utils/math';
import { noise3 } from '../../utils/noise';
import { leafGeometry, latheGeometry } from '../scenery/shapes';
import { fuseParts, warp } from './forms';

/**
 * Malhas dos detritos novos (a tralha miúda que gruda na bola): achados e
 * perdidos (botão, bolinha de gude, moeda, clipe, pecinha de montar, dado),
 * comidinhas do piquenique (jujuba, cubo de açúcar, pipoca, uva) e as raridades
 * da natureza (trevo de quatro folhas, casca de cigarra).
 *
 * Cada função devolve UMA geometria com cor nos vértices, centrada na origem e
 * em escala de "tamanho 1" (o `Collectibles` escala pelo tamanho sorteado). As
 * que dizem "tingível" vêm em tons de cinza claro: a cor de verdade entra por
 * instância, e assim várias cores cabem num draw call só.
 */

const UP = new THREE.Vector3(0, 1, 0);

/** Trevo de quatro folhas: o trevinho comum, com uma folha a mais e um verde mais vivo. */
export function fourLeafGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const leaf = leafGeometry(0.2, 0.2, { fold: 0.4, curl: -0.1, widest: 0.7, roundTip: 1, segmentsL: 4, segmentsW: 2 });
    paintVertices(leaf, (p, _n, c) => c.set('#4fae45').multiplyScalar(0.85 + Math.hypot(p.x, p.z) * 1.4));
    leaf.rotateY((i / 4) * Math.PI * 2 + 0.3);
    parts.push(leaf);
  }
  // Cabinho curto no meio.
  const stem = taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, -0.01, 0.1), new THREE.Vector3(0.08, -0.02, 0.24)), 5, () => 0.012, 4);
  parts.push(solidColor(stem, '#6f9f45'));
  return fuseParts(parts);
}

/**
 * Casca vazia de cigarra (exúvia): abdome em anéis, tórax com a fenda nas costas
 * por onde o adulto saiu, olhos saltados e as seis patinhas (as da frente,
 * de cavar, mais grossas). Âmbar; comprimento ≈ 1,3.
 */
export function cicadaShellGeometry(): THREE.BufferGeometry {
  const amber = new THREE.Color('#c9924a');
  const light = new THREE.Color('#ebbd78');
  const dark = new THREE.Color('#7a4a22');
  const parts: THREE.BufferGeometry[] = [];

  const abdomen = displace(claySphere(1, 3, 0.02), (_x, _y, z) => -Math.pow(Math.abs(Math.sin(z * 9)), 6) * 0.06);
  abdomen.scale(0.3, 0.27, 0.56);
  abdomen.translate(0, 0.24, -0.3);
  paintVertices(abdomen, (p, n, c) => {
    const ring = Math.pow(Math.abs(Math.sin((p.z + 0.3) * 16)), 8);
    return c.copy(amber).lerp(light, Math.max(0, n.y) * 0.4).lerp(dark, ring * 0.55);
  });
  parts.push(abdomen);

  const thorax = displace(claySphere(1, 3, 0.02, 2, 3), (x, y) => (Math.abs(x) < 0.12 && y > 0.3 ? -0.18 : 0));
  thorax.scale(0.32, 0.3, 0.32);
  thorax.translate(0, 0.3, 0.12);
  paintVertices(thorax, (p, n, c) => {
    c.copy(amber).lerp(light, Math.max(0, n.y) * 0.5);
    // A fenda nas costas: borda escura rasgada.
    return Math.abs(p.x) < 0.06 && p.y > 0.45 ? c.copy(dark).multiplyScalar(0.7) : c;
  });
  parts.push(thorax);

  const head = claySphere(1, 2, 0.03, 2, 5);
  head.scale(0.25, 0.19, 0.16);
  head.translate(0, 0.26, 0.44);
  parts.push(solidColor(head, amber));
  for (const side of [-1, 1]) {
    const eye = claySphere(0.09, 2, 0.02);
    eye.translate(side * 0.21, 0.32, 0.43);
    parts.push(solidColor(eye, light));
  }

  // Patinhas: quadril → joelho → pé (no chão), a da frente mais grossa e para a frente.
  const legs: Array<[number, number, number, number, number, number, number]> = [
    // zQuadril, xJoelho, zJoelho, xPé, zPé, raio, altura do joelho
    [0.3, 0.42, 0.52, 0.34, 0.76, 0.07, 0.2],
    [0.1, 0.5, 0.16, 0.64, 0.02, 0.05, 0.18],
    [-0.1, 0.5, -0.24, 0.62, -0.46, 0.05, 0.16],
  ];
  for (const side of [-1, 1]) {
    for (const [hz, kx, kz, fx, fz, r, ky] of legs) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.16, 0.14, hz), new THREE.Vector3(side * kx, ky, kz), new THREE.Vector3(side * fx, 0.0, fz)]);
      parts.push(solidColor(taperedTube(curve, 8, (t) => r * (1 - t * 0.55), 5), amber.clone().multiplyScalar(0.9)));
    }
  }
  const merged = fuseParts(parts);
  merged.translate(0, -0.22, 0);
  return merged;
}

/** Botão de roupa (tingível): disco com a borda levantada, miolo côncavo e furos de verdade. */
export function buttonGeometry(holes: 2 | 4): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
  const spots: Array<[number, number]> = holes === 2 ? [[-0.26, 0], [0.26, 0]] : [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]];
  for (const [x, y] of spots) {
    const hole = new THREE.Path();
    hole.absarc(x, y, holes === 2 ? 0.13 : 0.1, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const disc = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, curveSegments: 28 });
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, -0.08, 0);
  // Miolo afundado (a borda fica alta, como nos botões de verdade).
  warp(disc, (p) => {
    const r = Math.hypot(p.x, p.z);
    if (p.y > 0) p.y -= (1 - smoothstep(0.55, 0.8, r)) * 0.08;
  });
  const rim = new THREE.TorusGeometry(0.88, 0.09, 6, 36);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.14, 0);
  const g = fuseParts([disc, rim]);
  return paintVertices(g, (p, n, c) => c.setScalar(0.82 + Math.max(0, n.y) * 0.12 + smoothstep(0.7, 0.95, Math.hypot(p.x, p.z)) * 0.06));
}

export interface MarblePalette {
  glass: string;
  swirl: string;
  accent: string;
}

/** Bolinha de gude: vidro colorido com duas fitas em espiral pintadas por dentro. */
export function marbleGeometry(palette: MarblePalette, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 9);
  const glass = new THREE.Color(palette.glass);
  const swirl = new THREE.Color(palette.swirl);
  const accent = new THREE.Color(palette.accent);
  return paintVertices(g, (p, _n, c) => {
    const a = Math.atan2(p.z, p.x);
    // Fita torcida: o ângulo gira com a altura (espiral), com uma ondinha.
    const band = Math.sin(a * 2 + p.y * 3.2 + seed + noise3(p.x * 2, p.y * 2, p.z * 2) * 0.8);
    c.copy(glass).multiplyScalar(0.8 + (p.y + 1) * 0.12);
    if (band > 0.72) c.lerp(swirl, smoothstep(0.72, 0.85, band));
    else if (band < -0.8) c.lerp(accent, smoothstep(-0.8, -0.92, band));
    return c;
  });
}

/**
 * Moeda de 1 real: bimetálica (anel dourado, miolo prateado), com a borda
 * levantada, serrilhado fininho no anel e um "1" em relevo discreto.
 */
export function coinGeometry(): THREE.BufferGeometry {
  const t = 0.075;
  const profile: Array<[number, number]> = [[0.001, t]];
  for (let r = 0.05; r < 0.6; r += 0.05) profile.push([r, t]);
  profile.push([0.61, t + 0.012], [0.64, t], [0.7, t], [0.78, t], [0.86, t], [0.9, t + 0.018], [0.96, t + 0.012], [1.0, t - 0.01], [1.0, -t + 0.01], [0.96, -t - 0.012], [0.9, -t - 0.018], [0.64, -t], [0.001, -t]);
  // O torno quer o perfil de baixo para cima (senão as faces saem do avesso).
  profile.reverse();
  const g = displace(latheGeometry(profile, 72), (x, y, z) => {
    const r = Math.hypot(x, z);
    let h = 0;
    if (Math.abs(y) > t * 0.8 && r > 0.66 && r < 0.88) h += Math.max(0, Math.sin(Math.atan2(z, x) * 60)) * 0.01;
    // O "1" (só na face de cima): haste e a bandeirinha.
    if (y > t * 0.8 && ((Math.abs(x) < 0.07 && Math.abs(z) < 0.32) || (z < -0.2 && z > -0.32 && x < 0 && x > -0.2))) h += 0.018;
    return h;
  });
  const gold = new THREE.Color('#d9b44a');
  const silver = new THREE.Color('#c9cdd2');
  return paintVertices(g, (p, n, c) => {
    const r = Math.hypot(p.x, p.z);
    c.copy(r < 0.63 && Math.abs(n.y) > 0.5 ? silver : gold);
    return c.multiplyScalar(0.9 + Math.max(0, n.y) * 0.1);
  });
}

/** Clipe de papel (tingível, prateado por padrão): arame seguindo as três voltas do clipe. */
export function clipGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    for (let i = 0; i <= 6; i++) points.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / 6, 0, z0 + ((z1 - z0) * i) / 6));
  };
  const arc = (cx: number, cz: number, r: number, from: number, to: number) => {
    for (let i = 1; i <= 10; i++) {
      const a = from + ((to - from) * i) / 10;
      points.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r));
    }
  };
  // Da ponta de dentro, subindo, contornando e descendo em voltas cada vez maiores.
  line(0.06, -0.2, 0.06, 0.3);
  arc(0, 0.3, 0.06, 0, Math.PI);
  line(-0.06, 0.3, -0.06, -0.38);
  arc(0.04, -0.38, 0.1, Math.PI, Math.PI * 2);
  line(0.14, -0.38, 0.14, 0.38);
  arc(0, 0.38, 0.14, 0, Math.PI);
  line(-0.14, 0.38, -0.14, 0.02);
  const unique = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4);
  const g = taperedTube(new THREE.CatmullRomCurve3(unique, false, 'centripetal'), 160, () => 0.022, 6);
  g.scale(1, 1, 1.25);
  return paintVertices(g, (_p, n, c) => c.setScalar(0.85 + Math.max(0, n.y) * 0.15));
}

/** Pecinha de montar 2×2 (tingível): bloco de cantos macios com os quatro pinos. */
export function brickGeometry(): THREE.BufferGeometry {
  const body = new RoundedBoxGeometry(1, 0.6, 1, 2, 0.05);
  const parts: THREE.BufferGeometry[] = [body];
  for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]]) {
    const stud = latheGeometry([[0.15, 0], [0.15, 0.08], [0.14, 0.1], [0.08, 0.105], [0.001, 0.105]], 16);
    stud.translate(x, 0.29, z);
    parts.push(stud);
  }
  const g = fuseParts(parts);
  return paintVertices(g, (p, n, c) => c.setScalar(0.86 + Math.max(0, n.y) * 0.1 - (p.y < -0.25 ? 0.06 : 0)));
}

/** Dado branco de cantos arredondados com os pontos (faces opostas somam 7; o "1" é vermelho). */
export function dieGeometry(): THREE.BufferGeometry {
  const body = paintVertices(new RoundedBoxGeometry(1, 1, 1, 4, 0.16), (_p, _n, c) => c.set('#f4efe6'));
  const parts: THREE.BufferGeometry[] = [body];
  const layouts: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  // Face → (normal, número): 1 em cima, 6 embaixo, 2/5 nos lados X, 3/4 nos lados Z.
  const faces: Array<[THREE.Vector3, number]> = [
    [new THREE.Vector3(0, 1, 0), 1],
    [new THREE.Vector3(0, -1, 0), 6],
    [new THREE.Vector3(1, 0, 0), 2],
    [new THREE.Vector3(-1, 0, 0), 5],
    [new THREE.Vector3(0, 0, 1), 3],
    [new THREE.Vector3(0, 0, -1), 4],
  ];
  for (const [normal, count] of faces) {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    for (const [u, v] of layouts[count]) {
      const pip = claySphere(1, 1, 0);
      pip.scale(count === 1 ? 0.13 : 0.09, 0.03, count === 1 ? 0.13 : 0.09);
      pip.translate(u * 0.26, 0.495, v * 0.26);
      pip.applyQuaternion(q);
      parts.push(solidColor(pip, count === 1 ? '#c8302c' : '#1f1d22'));
    }
  }
  return fuseParts(parts);
}

/** Jujuba (tingível): feijãozinho brilhante, com um lado côncavo. */
export function jellybeanGeometry(): THREE.BufferGeometry {
  const g = warp(claySphere(1, 3, 0.02), (p) => {
    p.set(p.x * 0.5, p.y * 0.3, p.z * 0.29);
    p.z += (1 - (p.x / 0.5) ** 2) * 0.1;
  });
  return paintVertices(g, (_p, n, c) => c.setScalar(0.84 + Math.max(0, n.y) * 0.16));
}

/** Cubo de açúcar: cubinho de quina gasta, todo granulado (os cristais brilham no normal map). */
export function sugarCubeGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1, 7, 7, 7);
  const inner = 0.4;
  const rounded = warp(box, (p) => {
    const cx = THREE.MathUtils.clamp(p.x, -inner, inner);
    const cy = THREE.MathUtils.clamp(p.y, -inner, inner);
    const cz = THREE.MathUtils.clamp(p.z, -inner, inner);
    const d = new THREE.Vector3(p.x - cx, p.y - cy, p.z - cz);
    if (d.lengthSq() > 1e-8) d.setLength(0.1);
    p.set(cx + d.x, cy + d.y, cz + d.z);
  });
  const g = displace(rounded, (x, y, z) => noise3(x * 16, y * 16, z * 16) * 0.025);
  return paintVertices(g, (p, _n, c) => c.set('#f8f5ee').multiplyScalar(0.9 + Math.max(0, noise3(p.x * 22, p.y * 22, p.z * 22)) * 0.12));
}

/** Pipoca: bolotas estouradas em volta do grão, com um pedacinho da casca dourada. */
export function popcornGeometry(variant: number): THREE.BufferGeometry {
  const rng = createRng(90 + variant);
  const parts: THREE.BufferGeometry[] = [];
  const cream = new THREE.Color('#fbf3dc');
  const butter = new THREE.Color('#f2d98a');
  const lobes = 5 + variant;
  for (let i = 0; i < lobes; i++) {
    const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.7, 1), rng.range(-1, 1)).normalize();
    const r = rng.range(0.26, 0.42);
    // Cada bolota bem amassada (o "estouro" da pipoca não é redondo).
    const lobe = displace(claySphere(r, 2, 0.18, 3, i + variant * 7), (x, y, z) => noise3(x * 9, y * 9, z * 9) * 0.03);
    lobe.translate(dir.x * 0.26, dir.y * 0.22, dir.z * 0.26);
    parts.push(paintVertices(lobe, (p, _n, c) => c.copy(cream).lerp(butter, (1 - smoothstep(0.1, 0.45, p.length())) * 0.7)));
  }
  const hull = claySphere(1, 1, 0.1, 2, variant);
  hull.scale(0.16, 0.06, 0.2);
  hull.translate(0.1, -0.24, 0.05);
  parts.push(solidColor(hull, '#b9773f'));
  return fuseParts(parts);
}

/** Uva: bolinha levemente comprida com "pruína" (o pó fosco da casca) e o toquinho do cabo. */
export function grapeGeometry(skin: string, bloom: string): THREE.BufferGeometry {
  const berry = new THREE.IcosahedronGeometry(1, 4);
  berry.scale(1, 1.12, 1);
  const base = new THREE.Color(skin);
  const dust = new THREE.Color(bloom);
  paintVertices(berry, (p, _n, c) => {
    c.copy(base).multiplyScalar(0.85 + (p.y + 1.1) * 0.1);
    // Pruína em manchas, mais forte longe do cabo (onde ninguém encostou).
    return c.lerp(dust, smoothstep(-0.1, 0.5, noise3(p.x * 2.5, p.y * 2.5, p.z * 2.5)) * 0.55);
  });
  const stub = new THREE.CylinderGeometry(0.07, 0.12, 0.25, 6);
  stub.translate(0, 1.18, 0);
  return fuseParts([berry, solidColor(stub, '#6f7a3a')]);
}
