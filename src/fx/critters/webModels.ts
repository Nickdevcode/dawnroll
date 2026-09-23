import * as THREE from 'three';
import { claySphere, paintVertices, solidColor } from '../../render/geometry';
import { noise3 } from '../../utils/noise';
import { createRng, smoothstep } from '../../utils/math';
import { ball, glintEye, limb, mergeParts } from './models';

/**
 * Teia orbicular e a aranha-de-jardim (Argiope): o desenho da teia num canvas
 * (raios, espiral de captura, o miolo e o "X" em zigue-zague que a Argiope
 * tece no meio — o estabilimento), a aranha em três poses (na teia e duas de
 * corrida), o fio de seda, a gotinha de orvalho e o chumaço de teia que gruda
 * na bola.
 */

// ---------------------------------------------------------------------------
// Teia (textura)

export interface WebPattern {
  texture: THREE.CanvasTexture;
  /** Pontos da espiral de captura (x, y no disco unitário), onde o orvalho pousa. */
  dew: Float32Array;
}

const WEB_SIZE = 512;

/**
 * Desenha a teia uma vez (todas as teias usam a mesma textura, cada uma girada
 * e espelhada do seu jeito). Fundo transparente, fios brancos.
 */
export function webPattern(seed = 7): WebPattern {
  const rng = createRng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WEB_SIZE;
  const g = canvas.getContext('2d')!;
  const c = WEB_SIZE / 2;
  const scale = c * 0.96;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(248, 251, 255, 0.85)';

  // Moldura irregular (onde os raios terminam) e os raios, nem todos iguais.
  const spokes = 30;
  const frame: number[] = [];
  const angles: number[] = [];
  for (let i = 0; i < spokes; i++) {
    angles.push(((i + rng.range(-0.25, 0.25)) / spokes) * Math.PI * 2);
    frame.push(rng.range(0.9, 1));
  }
  const at = (angle: number, r: number): [number, number] => [c + Math.cos(angle) * r * scale, c + Math.sin(angle) * r * scale];
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i <= spokes; i++) {
    const [x, y] = at(angles[i % spokes], frame[i % spokes]);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.lineWidth = 1.3;
  for (let i = 0; i < spokes; i++) {
    g.beginPath();
    g.moveTo(...at(angles[i], 0.02));
    g.lineTo(...at(angles[i], frame[i]));
    g.stroke();
  }

  // Espiral de captura: de fora para dentro, reta entre um raio e o próximo (e um tiquinho caída).
  const dew: number[] = [];
  g.lineWidth = 1.1;
  g.strokeStyle = 'rgba(248, 251, 255, 0.72)';
  const inner = 0.2;
  const outer = 0.86;
  const turns = 21;
  const steps = turns * spokes;
  g.beginPath();
  for (let k = 0; k <= steps; k++) {
    const i = k % spokes;
    const r = outer - ((outer - inner) * k) / steps;
    const rr = r * Math.min(1, frame[i] / 0.95);
    const [x, y] = at(angles[i] + Math.floor(k / spokes) * 1e-3, rr);
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
    if (rng.next() < 0.5) dew.push(Math.cos(angles[i]) * rr * 0.96, Math.sin(angles[i]) * rr * 0.96);
  }
  g.stroke();

  // Miolo: fiozinhos embolados no centro, depois uma "zona livre" até a espiral.
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(248, 251, 255, 0.7)';
  g.beginPath();
  for (let k = 0; k < 90; k++) {
    const r = 0.015 + (k / 90) * 0.09;
    const [x, y] = at(k * 0.9 + rng.range(-0.2, 0.2), r);
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();

  // Estabilimento da Argiope: quatro braços em zigue-zague formando um "X" mais grosso e branco.
  g.lineWidth = 3.2;
  g.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  for (let arm = 0; arm < 4; arm++) {
    const a = Math.PI / 4 + (arm * Math.PI) / 2 + rng.range(-0.08, 0.08);
    const across = a + Math.PI / 2;
    g.beginPath();
    const n = 16;
    for (let k = 0; k <= n; k++) {
      const r = 0.12 + (k / n) * rng.range(0.34, 0.4);
      const zig = (k % 2 === 0 ? 1 : -1) * 0.028 * (1 - k / (n * 1.4));
      const x = c + (Math.cos(a) * r + Math.cos(across) * zig) * scale;
      const y = c + (Math.sin(a) * r + Math.sin(across) * zig) * scale;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, dew: new Float32Array(dew) };
}

/** Quadrado 2×2 no plano XY (face +Z): a instância escala pelo raio da teia. */
export function webQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(2, 2);
}

/** Fio de seda: cilindro finíssimo de altura 1, da origem para +Y (a instância estica). */
export function silkThread(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  return g;
}

/** Gotinha de orvalho (raio 1; a instância escala). */
export function dewDrop(): THREE.BufferGeometry {
  return mergeParts([solidColor(claySphere(1, 2, 0.015), '#eef8ff')]);
}

/** Chumaço de teia arrancada (o "item" que gruda na bola): bolota fofa com fios soltos. */
export function webTuft(): THREE.BufferGeometry {
  const rng = createRng(31);
  const wad = claySphere(0.13, 3, 0.35, 2.4, 3);
  paintVertices(wad, (p, _n, c) => c.setRGB(0.93, 0.95, 0.99).multiplyScalar(0.86 + 0.14 * noise3(p.x * 40, p.y * 40, p.z * 40)));
  wad.scale(1.25, 0.7, 1);
  wad.translate(0, 0.06, 0);
  const strands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.range(0.18, 0.32);
    const points = [
      new THREE.Vector3(Math.cos(a) * 0.08, 0.07, Math.sin(a) * 0.08),
      new THREE.Vector3(Math.cos(a + 0.4) * r * 0.7, rng.range(0.1, 0.18), Math.sin(a + 0.4) * r * 0.7),
      new THREE.Vector3(Math.cos(a + 0.7) * r, rng.range(0.0, 0.08), Math.sin(a + 0.7) * r),
    ];
    strands.push(limb(points, 0.008, 0.004, '#f2f5fb', 8, 3));
  }
  return mergeParts([wad, ...strands]);
}

// ---------------------------------------------------------------------------
// Aranha-de-jardim (Argiope)

export type SpiderPose = 'web' | 'runA' | 'runB';

const Spider = {
  silver: new THREE.Color('#e4e2d8'),
  hair: new THREE.Color('#b8b5aa'),
  yellow: new THREE.Color('#f2c230'),
  black: new THREE.Color('#1b1815'),
  cream: new THREE.Color('#f3f1e8'),
  femur: '#c07a36',
  shin: '#231d18',
  knee: '#e3b24a',
};

/** Pares de patas: ângulo (graus, da frente para o lado) na teia e correndo, comprimento e onde nasce. */
const LEGS = [
  { web: 20, run: 38, length: 0.56, z: 0.1 },
  { web: 32, run: 68, length: 0.52, z: 0.08 },
  { web: 118, run: 108, length: 0.3, z: 0.055 },
  { web: 142, run: 142, length: 0.5, z: 0.03 },
];

/**
 * Aranha numa pose. Na teia (`web`): o corpo no plano da teia (dorso +Y) e as
 * patas em pares formando o "X" da Argiope (a teia fica no plano XZ local).
 * Correndo (`runA`/`runB`): corpo levantado, joelhos altos e as patas
 * alternando (stop-motion); origem no chão.
 */
export function spiderBody(pose: SpiderPose): THREE.BufferGeometry {
  const by = pose === 'web' ? 0 : 0.11;
  const thorax = claySphere(1, 3, 0.03);
  paintVertices(thorax, (p, _n, c) => c.copy(Spider.silver).lerp(Spider.hair, smoothstep(0.1, 0.6, noise3(p.x * 9, p.y * 9, p.z * 9)) * 0.6));
  thorax.scale(0.075, 0.042, 0.085);
  thorax.translate(0, by, 0.06);

  const abdomen = claySphere(1, 4, 0.02);
  paintVertices(abdomen, (p, n, c) => {
    // Frente prateada; atrás, faixas amarelas e pretas onduladas; barriga preta com duas listras.
    if (n.y < -0.35) return c.copy(Spider.black).lerp(Spider.yellow, smoothstep(0.1, 0.05, Math.abs(Math.abs(p.x) - 0.3)) * 0.9);
    if (p.z > 0.55) return c.copy(Spider.cream);
    const band = Math.sin(p.z * Math.PI * 3.1 + 0.6 + Math.cos(p.x * 7) * 0.5);
    c.copy(band > 0.05 ? Spider.yellow : Spider.black);
    // Pintinhas amarelas na beirada preta.
    if (Math.abs(p.x) > 0.7 && noise3(p.x * 6, p.y * 6, p.z * 6) > 0.25) c.copy(Spider.yellow);
    return c;
  });
  abdomen.scale(0.125, 0.085, 0.18);
  abdomen.translate(0, by + 0.02, -0.15);
  const spinnerets = ball(0.018, 0, by + 0.0, -0.325, Spider.black, 1);
  const eyes = [1, -1].flatMap((s) => [glintEye(0.017, s * 0.022, by + 0.03, 0.135, '#0a0908'), ball(0.008, s * 0.04, by + 0.034, 0.118, '#0a0908', 1)]);
  const palps = [1, -1].map((s) => limb([new THREE.Vector3(s * 0.025, by - 0.005, 0.13), new THREE.Vector3(s * 0.045, by + 0.01, 0.17), new THREE.Vector3(s * 0.04, by - 0.01, 0.2)], 0.01, 0.007, Spider.shin, 6, 4));

  const legs: THREE.BufferGeometry[] = [];
  LEGS.forEach((leg, i) => {
    for (const side of [1, -1]) {
      let angle = pose === 'web' ? leg.web : leg.run;
      if (pose !== 'web') {
        // Marcha alternada: numa pose, I e III da direita vão para a frente; na outra, II e IV.
        const forward = (i + (side > 0 ? 0 : 1) + (pose === 'runA' ? 0 : 1)) % 2 === 0;
        angle += forward ? -12 : 12;
      }
      const a = THREE.MathUtils.degToRad(angle);
      const dir = new THREE.Vector3(Math.sin(a) * side, 0, Math.cos(a));
      const hip = new THREE.Vector3(side * 0.05, by, leg.z);
      const L = leg.length;
      const kneeUp = pose === 'web' ? 0.05 : 0.15;
      const knee = hip.clone().addScaledVector(dir, L * 0.4).setY(by + kneeUp);
      const ankle = hip.clone().addScaledVector(dir, L * 0.78).setY(pose === 'web' ? by + 0.02 : 0.04);
      const tip = hip.clone().addScaledVector(dir, L).setY(pose === 'web' ? by : 0);
      legs.push(limb([hip, hip.clone().lerp(knee, 0.5).setY(by + kneeUp * 0.8), knee], 0.013, 0.011, Spider.femur, 6, 4));
      legs.push(limb([knee, ankle, tip], 0.011, 0.005, Spider.shin, 10, 4));
      legs.push(ball(0.014, knee.x, knee.y, knee.z, Spider.knee, 1, 0.02));
    }
  });
  return mergeParts([thorax, abdomen, spinnerets, ...eyes, ...palps, ...legs]);
}
