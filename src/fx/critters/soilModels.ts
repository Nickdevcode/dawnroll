import * as THREE from 'three';
import { claySphere, lumpify, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { ball, glintEye, limb, mergeParts } from './models';

/**
 * Modelos dos bichos de terra úmida: tesourinha e lacraia (os que moram
 * debaixo da pedra) e a lesma (com o rastro de gosma). Mesma convenção dos
 * outros: +Z = frente, +Y = cima, origem no chão embaixo do bicho.
 */

// ---------------------------------------------------------------------------
// Tesourinha

const Earwig = {
  head: new THREE.Color('#6e2f1c'),
  shield: new THREE.Color('#472217'),
  rim: new THREE.Color('#b88a5a'),
  wingCase: new THREE.Color('#b8864f'),
  wingTip: new THREE.Color('#e3cfae'),
  belly: new THREE.Color('#5a2716'),
  plate: new THREE.Color('#7e3c22'),
  pincer: '#34170e',
  leg: '#d9b27a',
  antenna: '#8a5a3a',
};

/**
 * Tesourinha correndo, numa das duas poses de patas (stop-motion, como a
 * formiga): cabeça em coração, antenas de continhas, escudo com a borda clara,
 * élitros curtinhos (a asa dobrada aparece atrás deles), abdômen comprido de
 * placas brilhantes e as pinças do rabo — o que todo mundo reconhece.
 */
export function earwigBody(pose: 0 | 1): THREE.BufferGeometry {
  const abdomenCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.055, -0.04), new THREE.Vector3(0, 0.056, -0.19), new THREE.Vector3(0, 0.06, -0.33)]);
  const abdomen = taperedTube(abdomenCurve, 32, (t) => 0.05 * (0.9 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * (1 + 0.07 * Math.cos(t * Math.PI * 14)), 10);
  // Achatado (a tesourinha vive espremida debaixo de pedra).
  abdomen.translate(0, -0.055, 0);
  abdomen.scale(1, 0.62, 1);
  abdomen.translate(0, 0.055, 0);
  paintVertices(abdomen, (p, n, c) => {
    const ring = 0.5 + 0.5 * Math.cos(p.z * 95);
    c.copy(Earwig.belly).lerp(Earwig.plate, ring * 0.55 * smoothstep(-0.2, 0.6, n.y));
    return c.multiplyScalar(0.9 + 0.2 * Math.max(0, n.y));
  });
  const tip = solidColor(claySphere(0.032, 2, 0.04), Earwig.belly);
  tip.scale(1.2, 0.7, 1);
  tip.translate(0, 0.058, -0.34);

  const pincers = [1, -1].map((s) =>
    limb(
      [new THREE.Vector3(s * 0.022, 0.055, -0.34), new THREE.Vector3(s * 0.052, 0.058, -0.41), new THREE.Vector3(s * 0.04, 0.06, -0.48), new THREE.Vector3(s * 0.008, 0.058, -0.52)],
      0.013,
      0.004,
      Earwig.pincer,
      14,
      5,
    ),
  );

  // Élitros curtos (a "capinha") e a pontinha clara da asa dobrada saindo de baixo.
  const cases = [1, -1].map((s) => {
    const g = claySphere(1, 3, 0.02);
    paintVertices(g, (p, _n, c) => c.copy(Earwig.wingCase).multiplyScalar(0.8 + 0.3 * Math.max(0, p.y)).lerp(Earwig.shield, smoothstep(0.75, 0.95, -p.x * s) * 0.6));
    g.scale(0.034, 0.022, 0.066);
    g.translate(s * 0.029, 0.078, -0.03);
    return g;
  });
  const wingTips = [1, -1].map((s) => {
    const g = solidColor(claySphere(1, 2, 0.02), Earwig.wingTip);
    g.scale(0.016, 0.01, 0.03);
    g.translate(s * 0.02, 0.083, -0.098);
    return g;
  });

  const shield = claySphere(1, 3, 0.02);
  paintVertices(shield, (p, _n, c) => c.copy(Earwig.shield).lerp(Earwig.rim, smoothstep(0.65, 0.9, Math.abs(p.x))));
  shield.scale(0.046, 0.024, 0.042);
  shield.translate(0, 0.07, 0.065);

  const head = solidColor(claySphere(1, 3, 0.03), Earwig.head);
  head.scale(0.044, 0.03, 0.05);
  head.translate(0, 0.064, 0.13);
  const eyes = [1, -1].map((s) => glintEye(0.014, s * 0.036, 0.074, 0.14, '#140b08'));
  const antennae = [1, -1].flatMap((s) => {
    const points = [new THREE.Vector3(s * 0.022, 0.075, 0.165), new THREE.Vector3(s * 0.05, 0.1, 0.23), new THREE.Vector3(s * 0.085, 0.095, 0.31)];
    const curve = new THREE.CatmullRomCurve3(points);
    const parts = [limb(points, 0.007, 0.005, Earwig.antenna, 10, 4)];
    // Antena de "continhas": gominhos ao longo dela.
    for (let k = 1; k <= 6; k++) {
      const p = curve.getPoint(k / 6.5);
      parts.push(ball(0.0085, p.x, p.y, p.z, Earwig.antenna, 1, 0.02));
    }
    return parts;
  });

  const legs: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.085 - i * 0.045;
      const swing = ((i + (side > 0 ? 0 : 1) + pose) % 2 === 0 ? 1 : -1) * 0.035;
      legs.push(
        limb(
          [new THREE.Vector3(side * 0.03, 0.05, z), new THREE.Vector3(side * 0.085, 0.075, z + swing * 0.4), new THREE.Vector3(side * 0.12, 0.0, z + swing + (1 - i) * 0.035)],
          0.009,
          0.005,
          Earwig.leg,
          8,
          4,
        ),
      );
    }
  }
  return mergeParts([abdomen, tip, ...pincers, ...cases, ...wingTips, shield, head, ...eyes, ...antennae, ...legs]);
}

// ---------------------------------------------------------------------------
// Lacraia

/** Distância entre dois segmentos da lacraia (unidades, escala 1). */
export const CENTIPEDE_SPACING = 0.068;

const Centipede = {
  plate: new THREE.Color('#c2622d'),
  seam: new THREE.Color('#6e2c14'),
  spine: new THREE.Color('#e08a4a'),
  head: new THREE.Color('#a8481f'),
  leg: '#e7a95a',
  antenna: '#d98a3c',
  fang: '#2a120a',
};

/**
 * Um segmento da lacraia com o seu par de patas, numa das duas poses. O corpo
 * alterna as poses segmento a segmento com a fase andando para trás: é a onda
 * de patas (metacronal) que dá a cara de lacraia correndo. Origem no chão.
 */
export function centipedeSegment(pose: 0 | 1): THREE.BufferGeometry {
  const plate = claySphere(1, 3, 0.02);
  paintVertices(plate, (p, n, c) => {
    c.copy(Centipede.plate).lerp(Centipede.spine, Math.exp(-Math.pow(p.x / 0.12, 2)) * smoothstep(0.3, 0.9, n.y) * 0.5);
    // Borda de trás escura: onde uma placa encaixa embaixo da próxima.
    return c.lerp(Centipede.seam, smoothstep(-0.25, -0.75, p.z) * 0.9);
  });
  // Placa achatada e mais comprida que o espaçamento: uma encaixa por baixo da outra.
  plate.scale(0.058, 0.017, 0.048);
  plate.translate(0, 0.032, 0.004);
  const swing = pose === 0 ? 0.03 : -0.03;
  const legs = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.04, 0.026, 0), new THREE.Vector3(s * 0.09, 0.048, swing * 0.5), new THREE.Vector3(s * 0.125, 0.0, swing * s)], 0.0075, 0.0045, Centipede.leg, 6, 4),
  );
  return mergeParts([plate, ...legs]);
}

/** Cabeça da lacraia: placa achatada, olhinhos, presas (forcípulas) e as antenas compridas. */
export function centipedeHead(): THREE.BufferGeometry {
  const head = claySphere(1, 3, 0.02);
  paintVertices(head, (_p, n, c) => c.copy(Centipede.head).multiplyScalar(0.85 + 0.3 * Math.max(0, n.y)));
  head.scale(0.05, 0.022, 0.05);
  head.translate(0, 0.034, 0.02);
  const eyes = [1, -1].map((s) => glintEye(0.011, s * 0.034, 0.056, 0.042, '#140a06'));
  const fangs = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.022, 0.03, 0.05), new THREE.Vector3(s * 0.034, 0.026, 0.085), new THREE.Vector3(s * 0.008, 0.026, 0.105)], 0.008, 0.004, Centipede.fang, 8, 4),
  );
  const antennae = [1, -1].map((s) =>
    limb(
      [new THREE.Vector3(s * 0.018, 0.05, 0.06), new THREE.Vector3(s * 0.06, 0.075, 0.15), new THREE.Vector3(s * 0.12, 0.07, 0.24), new THREE.Vector3(s * 0.17, 0.05, 0.3)],
      0.006,
      0.003,
      Centipede.antenna,
      16,
      4,
    ),
  );
  return mergeParts([head, ...eyes, ...fangs, ...antennae]);
}

/** Lacraia enrolada (bicho grudado na bola): os segmentos numa espiral, cabeça por fora. */
export function centipedeCurled(segments: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segment = centipedeSegment(0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (geometry: THREE.BufferGeometry, k: number, scale: number) => {
    // Espiral de Arquimedes: a cabeça (k = 0) fica por fora, o rabo no meio.
    const s = (segments - k) * CENTIPEDE_SPACING;
    const angle = s / 0.12;
    const r = 0.05 + angle * 0.022;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    q.setFromAxisAngle(up, -angle);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(scale, 1, scale));
    parts.push(geometry.clone().applyMatrix4(m));
  };
  for (let k = segments - 1; k >= 1; k--) place(segment, k, 1 - (k / segments) * 0.35);
  place(centipedeHead(), 0, 1);
  segment.dispose();
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Lesma

/** Onde nascem os tentáculos dos olhos da lesma (lado direito). */
export const SLUG_STALK_BASE = new THREE.Vector3(0.032, 0.14, 0.36);

const Slug = {
  skin: new THREE.Color('#b58a58'),
  back: new THREE.Color('#7a5634'),
  groove: new THREE.Color('#5a3c22'),
  mantle: new THREE.Color('#8e6840'),
  fringe: new THREE.Color('#e6cfa6'),
  pore: new THREE.Color('#3a2414'),
};

/**
 * Lesma: corpo comprido, baixo e úmido, com o manto (a "sela" lisa e mais alta
 * na frente, com o buraquinho de respirar do lado direito), a pele de
 * sulquinhos em rede no resto, a saia clara do pé e a quilha no rabo que
 * afina. Os dois tentáculos pequenos de baixo vêm junto; os de cima (com
 * olho) são peças à parte, que recolhem.
 */
export function slugBody(): THREE.BufferGeometry {
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.03, -0.46),
    new THREE.Vector3(0, 0.055, -0.2),
    new THREE.Vector3(0, 0.07, 0.1),
    new THREE.Vector3(0, 0.08, 0.3),
    new THREE.Vector3(0, 0.095, 0.4),
  ]);
  // t = 0 no rabo, 1 no focinho.
  const radius = (t: number) => {
    const body = 0.1 * (0.12 + 0.88 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5));
    const mantle = 1 + 0.3 * Math.exp(-Math.pow((t - 0.68) / 0.13, 2));
    const nose = 1 - 0.3 * smoothstep(0.9, 1, t);
    return body * mantle * nose;
  };
  const body = lumpify(taperedTube(path, 44, radius, 16), 0.004, 40, 7);
  // Barriga chata (o pé), bem mais larga que alta, e a saia saindo um tiquinho para os lados.
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const skirt = 1 + 0.12 * (1 - smoothstep(0.02, 0.06, y));
    pos.setX(i, pos.getX(i) * 1.32 * skirt);
    if (y < 0.03) pos.setY(i, 0.03 - (0.03 - y) * 0.2);
  }
  body.computeVertexNormals();
  const poreAt = new THREE.Vector3(0.1, 0.12, 0.15);
  paintVertices(body, (p, n, c) => {
    c.copy(Slug.skin).lerp(Slug.back, smoothstep(0.0, 0.75, n.y) * 0.75);
    const onMantle = smoothstep(-0.01, 0.04, p.z) * (1 - smoothstep(0.3, 0.34, p.z)) * smoothstep(0.1, 0.4, n.y);
    // Fora do manto, sulquinhos em rede (a pele de lesma); no manto, liso com anéis finos.
    const net = Math.abs(noise3(p.x * 30, p.y * 30, p.z * 30));
    c.lerp(Slug.groove, (1 - smoothstep(0.03, 0.09, net)) * (1 - onMantle) * smoothstep(-0.1, 0.4, n.y) * 0.8);
    c.lerp(Slug.mantle, onMantle * 0.7).multiplyScalar(1 - onMantle * 0.1 * (0.5 + 0.5 * Math.sin(Math.hypot(p.x, p.z - 0.15) * 150)));
    // A borda de trás do manto: uma dobra mais escura.
    c.lerp(Slug.groove, Math.exp(-Math.pow((p.z - 0.0) / 0.012, 2)) * smoothstep(0.2, 0.6, n.y) * 0.7);
    // Quilha clarinha no alto do rabo.
    c.lerp(Slug.fringe, Math.exp(-Math.pow(p.x / 0.012, 2)) * smoothstep(-0.02, -0.15, p.z) * smoothstep(0.7, 0.95, n.y) * 0.45);
    if (p.distanceTo(poreAt) < 0.02) c.copy(Slug.pore);
    return c.lerp(Slug.fringe, smoothstep(-0.1, -0.6, n.y) * 0.85);
  });
  const lower = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.022, 0.06, 0.36), new THREE.Vector3(s * 0.042, 0.048, 0.42), new THREE.Vector3(s * 0.052, 0.034, 0.46)], 0.013, 0.009, '#a07a4c', 6, 5));
  return mergeParts([body, ...lower]);
}

/** Tentáculo do olho da lesma (origem na base; escala em Y recolhe). */
export function slugStalk(): THREE.BufferGeometry {
  return mergeParts([
    limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.008, 0.1, 0.03), new THREE.Vector3(0.016, 0.19, 0.07)], 0.016, 0.012, '#9a7148', 10, 6),
    glintEye(0.022, 0.017, 0.198, 0.075, '#2b1c14'),
  ]);
}

/**
 * Pedaço do rastro de gosma: faixa deitada no chão (face +Y), com as bordas
 * transparentes (alfa no vértice). No comprimento o alfa vai de 0 nas pontas
 * a 1 no meio: pedaços com metade de sobreposição se somam num rastro liso,
 * sem "degraus". Comprimento 1 em Z (de −0,5 a 0,5) e largura 1 em X.
 */
export function slimeStrip(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 4, 2);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const across = Math.abs(pos.getX(i)) * 2;
    const along = 1 - Math.abs(pos.getZ(i)) * 2;
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = (across > 0.99 ? 0 : 1 - across * 0.35) * along;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  g.deleteAttribute('uv');
  return g;
}
