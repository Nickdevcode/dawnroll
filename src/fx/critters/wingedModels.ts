import * as THREE from 'three';
import { claySphere, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { leafGeometry } from '../../world/scenery/shapes';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { ball, glintEye, limb, mergeParts } from './models';

/**
 * Visitantes que chegam voando: a içá (tanajura, a rainha alada da saúva que
 * sai na revoada depois da chuva) e o beija-flor. Convenção: +Z = frente,
 * +Y = cima; asas do lado direito (+X) com a articulação na origem.
 */

// ---------------------------------------------------------------------------
// Içá (tanajura)

const Queen = {
  gaster: new THREE.Color('#8a3b22'),
  band: new THREE.Color('#5e2414'),
  shine: new THREE.Color('#c0663a'),
  body: new THREE.Color('#6e2a18'),
  leg: '#7a3420',
  wing: new THREE.Color('#e2c9a4'),
  vein: new THREE.Color('#8a6a4a'),
};

/** Onde nascem as asas (lado direito) da içá. */
export const QUEEN_WING_HINGE = new THREE.Vector3(0.035, 0.13, 0.05);

/**
 * Içá: o "bundão" (gáster) enorme e marrom-avermelhado que dá nome à
 * tanajura, cintura de dois nós, tórax robusto de rainha, cabeçona em
 * coração com mandíbulas e as antenas cotoveladas. As asas são peça à parte.
 */
export function flyingAntBody(): THREE.BufferGeometry {
  const gaster = claySphere(1, 4, 0.02, 2, 5);
  paintVertices(gaster, (p, n, c) => {
    c.copy(Queen.gaster);
    // Faixas das placas do abdômen e um brilho de verniz em cima.
    c.lerp(Queen.band, smoothstep(0.55, 0.95, Math.cos((p.z + 0.2) * 17)) * 0.55);
    return c.lerp(Queen.shine, smoothstep(0.55, 0.95, n.y) * 0.35);
  });
  gaster.scale(0.105, 0.095, 0.15);
  gaster.translate(0, 0.1, -0.21);
  const nodes = [ball(0.026, 0, 0.1, -0.055, Queen.body, 1), ball(0.028, 0, 0.1, -0.02, Queen.body, 1)];
  const thorax = solidColor(claySphere(1, 3, 0.03), Queen.body);
  thorax.scale(0.055, 0.06, 0.095);
  thorax.translate(0, 0.11, 0.06);
  const head = claySphere(1, 3, 0.03);
  paintVertices(head, (_p, n, c) => c.copy(Queen.body).lerp(Queen.shine, smoothstep(0.6, 0.95, n.y) * 0.25));
  head.scale(0.068, 0.058, 0.058);
  head.translate(0, 0.11, 0.19);
  const eyes = [1, -1].map((s) => glintEye(0.016, s * 0.058, 0.125, 0.2, '#120a08'));
  const mandibles = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.03, 0.085, 0.235), new THREE.Vector3(s * 0.028, 0.08, 0.27), new THREE.Vector3(s * 0.006, 0.08, 0.285)], 0.01, 0.005, Queen.band, 6, 4));
  // Antena de formiga: haste comprida e o resto dobrado para a frente (o "cotovelo").
  const antennae = [1, -1].map((s) =>
    limb([new THREE.Vector3(s * 0.025, 0.14, 0.235), new THREE.Vector3(s * 0.07, 0.2, 0.26), new THREE.Vector3(s * 0.09, 0.2, 0.3), new THREE.Vector3(s * 0.1, 0.16, 0.38)], 0.007, 0.006, Queen.leg, 14, 4),
  );
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.1 - i * 0.04;
      const reach = (i - 1) * 0.07;
      legs.push(limb([new THREE.Vector3(s * 0.035, 0.08, z), new THREE.Vector3(s * 0.12, 0.12, z + reach * 0.4), new THREE.Vector3(s * 0.16, 0.0, z + reach)], 0.01, 0.006, Queen.leg, 8, 4));
    }
  }
  return mergeParts([gaster, ...nodes, thorax, head, ...eyes, ...mandibles, ...antennae, ...legs]);
}

/**
 * Par de asas do lado direito da içá (anterior comprida + posterior), vítreas
 * com um tom de chá e as nervuras marcadas. Mais compridas que o corpo.
 */
export function flyingAntWings(): THREE.BufferGeometry {
  const make = (length: number, width: number, sweep: number, z: number) => {
    const w = leafGeometry(length, width, { fold: 0.01, curl: -0.02, widest: 0.62, roundTip: 0.9, segmentsL: 9, segmentsW: 2, vein: false });
    paintVertices(w, (p, _n, c) => {
      const lines = Math.pow(Math.abs(Math.sin(p.z * 34)), 26) + Math.pow(Math.abs(Math.sin(p.x * 50 + p.z * 12)), 26);
      c.copy(Queen.wing).lerp(Queen.vein, Math.min(lines, 1) * 0.6);
      // Mancha escura (pterostigma) na borda da frente da asa.
      if (p.z > length * 0.55 && p.z < length * 0.66 && -p.x > width * 0.15) c.copy(Queen.vein);
      return c;
    });
    w.rotateY(Math.PI / 2 - sweep);
    w.translate(0, 0, z);
    return w;
  };
  return mergeParts([make(0.7, 0.19, 0.25, 0.01), make(0.5, 0.14, 0.55, -0.03)]);
}

// ---------------------------------------------------------------------------
// Beija-flor

const Hummer = {
  back: new THREE.Color('#2f9e5a'),
  crown: new THREE.Color('#1f7a4a'),
  gorget: new THREE.Color('#1fb6a4'),
  chest: new THREE.Color('#f1efe6'),
  flank: new THREE.Color('#9fc9a0'),
  tail: new THREE.Color('#1c2a3a'),
  bill: '#141214',
};

/** Ombro direito (onde a asa bate) e a ponta do bico do beija-flor, em escala 1. */
export const HUMMINGBIRD_SHOULDER = new THREE.Vector3(0.2, 0.22, 0.06);
export const HUMMINGBIRD_BILL_TIP = new THREE.Vector3(0, 0.4, 1.62);

/**
 * Beija-flor já na postura de pairar: corpo inclinado (cabeça em cima, rabo
 * para baixo), cabeça dobrada para o bico ficar quase na horizontal. Costas e
 * coroa verdes (o material é furta-cor), garganta verde-azulada, peito
 * branco, rabinho escuro em leque, olho preto com pintinha branca atrás.
 * Origem no meio do corpo.
 */
export function hummingbirdBody(): THREE.BufferGeometry {
  const axis = new THREE.Vector3(0, 0.75, 0.66).normalize();
  const body = claySphere(1, 4, 0.02, 2, 3);
  // Corpo curto e redondo (peito estufado), sem pescoço: a cabeça encaixa direto nele.
  body.scale(0.27, 0.28, 0.42);
  // Deita o eixo comprido do corpo na diagonal (rabo embaixo-atrás, peito em cima-na-frente).
  body.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
  paintVertices(body, (p, n, c) => {
    // "Costas" = o lado de trás/de cima da diagonal; "peito" = o da frente.
    const front = n.dot(new THREE.Vector3(0, -0.66, 0.75));
    c.copy(Hummer.back).lerp(Hummer.chest, smoothstep(-0.05, 0.45, front));
    // Manchinhas verdes no flanco branco.
    if (front > 0.1 && Math.abs(n.x) > 0.5) c.lerp(Hummer.flank, smoothstep(0.2, 0.6, noise3(p.x * 30, p.y * 30, p.z * 30)) * 0.6);
    return c;
  });

  const head = claySphere(0.25, 4, 0.02);
  paintVertices(head, (_p, n, c) => {
    c.copy(Hummer.crown);
    // Garganta furta-cor embaixo do bico.
    return c.lerp(Hummer.gorget, smoothstep(0.0, -0.55, n.y) * smoothstep(-0.3, 0.4, n.z));
  });
  head.translate(0, 0.42, 0.34);
  const eyes = [1, -1].flatMap((s) => [glintEye(0.06, s * 0.18, 0.49, 0.46, '#0b0a0c'), ball(0.032, s * 0.21, 0.52, 0.32, '#f4f2ec', 1, 0.02)]);
  const bill = solidColor(
    taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.42, 0.52), new THREE.Vector3(0, 0.42, 1.05), new THREE.Vector3(0, 0.4, 1.62)]), 16, (t) => 0.045 * (1 - t) + 0.011, 6),
    Hummer.bill,
  );
  const tail: THREE.BufferGeometry[] = [];
  for (let k = -2; k <= 2; k++) {
    // Rabo em forquilha: as penas de fora mais compridas.
    const feather = leafGeometry(0.62 + Math.abs(k) * 0.07, 0.16, { fold: 0.08, curl: 0.05, widest: 0.7, roundTip: 0.7, segmentsL: 5, segmentsW: 1, vein: false });
    paintVertices(feather, (p, _n, c) => c.copy(Hummer.tail).lerp(Hummer.back, (1 - smoothstep(0, 0.25, p.z)) * 0.6));
    // Leque apontando para trás e para baixo.
    feather.rotateX(Math.PI * 0.76);
    feather.rotateY(k * 0.2);
    feather.translate(k * 0.025, -0.24, -0.28);
    tail.push(feather);
  }
  const feet = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.07, -0.16, 0.06), new THREE.Vector3(s * 0.08, -0.26, 0.1), new THREE.Vector3(s * 0.08, -0.28, 0.17)], 0.018, 0.012, '#2a2224', 5, 4));
  return mergeParts([body, head, ...eyes, bill, ...tail, ...feet]);
}

const tmpWing = new THREE.Color();

/**
 * Asa direita do beija-flor: lâmina comprida e estreita (quase só "mão"),
 * articulada no ombro e estendendo para +X. Vai com material translúcido: em
 * voo ela bate tão rápido que só se vê o borrão.
 */
export function hummingbirdWing(): THREE.BufferGeometry {
  const w = leafGeometry(1.2, 0.34, { fold: 0.02, curl: -0.06, widest: 0.42, roundTip: 0.55, segmentsL: 10, segmentsW: 2, vein: false });
  paintVertices(w, (p, _n, c) => {
    // Mais escura perto do ombro, clareando para a ponta (onde o borrão é mais largo).
    c.setRGB(0.42, 0.45, 0.46).lerp(tmpWing.setRGB(0.72, 0.76, 0.78), smoothstep(0.1, 1.1, p.z));
    // Penas de voo: riscas finas no comprimento.
    return c.multiplyScalar(0.85 + 0.25 * Math.pow(Math.abs(Math.sin(p.x * 70 + p.z * 4)), 6));
  });
  w.rotateY(Math.PI / 2);
  return mergeParts([w]);
}
