import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay } from '../render/clayMaterial';
import { ChunkedInstances, type InstanceSample } from '../render/ChunkedInstances';
import { claySphere, paintVertices, solidColor } from '../render/geometry';
import { createRng, smoothstep, type Rng } from '../utils/math';
import { fbm2 } from '../utils/noise';
import { leafGeometry } from './scenery/shapes';
import { terrainHeight, terrainNormal, dirtAmount, PLAY_RADIUS } from './Terrain';

/** Onde a cobertura não pode nascer (dentro de pedra, tronco...). */
export type CoverBlocker = (x: number, z: number) => boolean;

const LitterColors = ['#d9894a', '#e8b04f', '#c9683e', '#b58a4f', '#9fbf5a', '#e39a5c'];
const TinyFlowerColors = ['#ffffff', '#fff3a6', '#ffd1e3', '#cfd8ff', '#ffe0c2'];

interface CoverLayer {
  instances: ChunkedInstances;
}

/**
 * Tudo que fica rente ao chão entre os tufos de grama: trevos, florzinhas,
 * folhas secas caídas. Instanciado em pedaços (poucos draw calls). Trevos e
 * florzinhas deitam quando o besouro ou a bola passam por cima.
 */
export class GroundCover {
  readonly group = new THREE.Group();
  private readonly layers: CoverLayer[] = [];

  constructor(density: number, blocked: CoverBlocker, seed = 77) {
    this.group.name = 'ground-cover';
    const rng = createRng(seed);

    this.addLayer(
      rng,
      buildCloverGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.7, sheen: 0.6, bump: 0.15, mottle: 0.08, mottleScale: 5, flex: 0.3, side: THREE.DoubleSide }),
      Math.round(3600 * density),
      (x, z) => {
        // Trevo nasce em manchas (moitas de trevo), longe da terra batida.
        const patch = smoothstep(0.02, 0.3, fbm2(x * 0.09 + 11, z * 0.09 - 4, 2, 44));
        return dirtAmount(x, z) < 0.3 && rng.next() < patch * 0.9 + 0.05;
      },
      [0.7, 1.35],
      () => new THREE.Color().setHSL(rng.range(0.25, 0.31), rng.range(0.5, 0.65), rng.range(0.34, 0.45)),
      blocked,
    );

    this.addLayer(
      rng,
      buildTinyFlowerGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.65, sheen: 0.7, bump: 0.1, mottle: 0.05, mottleScale: 5, flex: 0.7, side: THREE.DoubleSide }),
      Math.round(1500 * density),
      (x, z) => dirtAmount(x, z) < 0.25 && rng.next() < smoothstep(-0.1, 0.25, fbm2(x * 0.07 - 30, z * 0.07 + 8, 2, 12)),
      [0.7, 1.3],
      () => new THREE.Color(rng.pick(TinyFlowerColors)),
      blocked,
    );

    this.addLayer(
      rng,
      buildLitterGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.75, sheen: 0.5, bump: 0.2, mottle: 0.12, mottleScale: 4, side: THREE.DoubleSide }),
      Math.round(1100 * density),
      // Folha caída junta mais perto das bordas (sob as árvores gigantes) e na terra.
      (x, z) => rng.next() < 0.25 + smoothstep(25, PLAY_RADIUS, Math.hypot(x, z)) * 0.5 + dirtAmount(x, z) * 0.3,
      [0.6, 1.4],
      () => new THREE.Color(rng.pick(LitterColors)).multiplyScalar(rng.range(0.85, 1.1)),
      blocked,
      true,
    );
  }

  setDensity(density: number): void {
    for (const layer of this.layers) layer.instances.setDensity(density);
  }

  update(camera: THREE.Camera): void {
    for (const layer of this.layers) layer.instances.update(camera.position);
  }

  private addLayer(
    rng: Rng,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    accept: (x: number, z: number) => boolean,
    scaleRange: [number, number],
    tint: () => THREE.Color,
    blocked: CoverBlocker,
    lieFlat = false,
  ): void {
    const samples: InstanceSample[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const tilt = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let attempts = 0; attempts < count * 10 && samples.length < count; attempts++) {
      const a = rng.next() * Math.PI * 2;
      const d = 1.5 + Math.sqrt(rng.next()) * (PLAY_RADIUS + 8);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!accept(x, z) || blocked(x, z)) continue;
      terrainNormal(x, z, normal);
      quat.setFromUnitVectors(up, lieFlat ? normal : normal.lerp(up, 0.5).normalize());
      quat.multiply(spin.setFromAxisAngle(up, rng.next() * Math.PI * 2));
      // Folha seca: uma inclinadinha aleatória (não fica 100% colada).
      if (lieFlat) quat.multiply(tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rng.range(-0.25, 0.25)));
      const s = rng.range(scaleRange[0], scaleRange[1]);
      scale.setScalar(s);
      pos.set(x, terrainHeight(x, z) + (lieFlat ? 0.02 : -0.02), z);
      samples.push({ matrix: new THREE.Matrix4().compose(pos, quat, scale), color: tint() });
    }
    const instances = new ChunkedInstances(geometry, material, samples, rng, {
      name: 'cover',
      chunkSize: 20,
      lodNear: 14,
      lodFar: 50,
      lodMinFraction: 0.1,
      cullDistance: 60,
      heightMargin: 1.5,
      skipAO: !lieFlat,
    });
    this.group.add(instances.group);
    this.layers.push({ instances });
  }
}

/**
 * Moitinha de trevo: três "cabeças" de três folhas em alturas diferentes, com as
 * folhas quase deitadas (em pé elas parecem hélices de papel) e a marca clara em "V".
 */
function buildCloverGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const heads: Array<[number, number, number, number]> = [
    // [x, z, altura do cabinho, escala]
    [0, 0, 0.2, 1],
    [0.16, 0.1, 0.13, 0.8],
    [-0.12, 0.14, 0.09, 0.7],
  ];
  heads.forEach(([hx, hz, h, k], index) => {
    const stem = solidColor(new THREE.CylinderGeometry(0.01, 0.014, h, 4, 1, true), '#6d9f47');
    stem.translate(hx, h / 2, hz);
    parts.push(stem);
    for (let i = 0; i < 3; i++) {
      const leaf = leafGeometry(0.16 * k, 0.19 * k, { fold: 0.3, curl: 0.12, widest: 0.72, roundTip: 1, segmentsL: 3, segmentsW: 1 });
      paintVertices(leaf, (p, _n, c) => {
        const r = Math.hypot(p.x, p.z) / k;
        const mark = Math.exp(-Math.pow((r - 0.09) / 0.02, 2)) * 0.28;
        return c.setScalar(0.55 + r * 1.3 + mark);
      });
      leaf.rotateX(-0.08);
      leaf.rotateY((i / 3) * Math.PI * 2 + index * 0.7);
      leaf.translate(hx, h, hz);
      parts.push(leaf);
    }
  });
  return mergeFlat(parts);
}

/** Florzinha rasteira: cabinho, cinco pétalas e miolo amarelo. */
function buildTinyFlowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stem = solidColor(new THREE.CylinderGeometry(0.012, 0.016, 0.5, 4, 1, true), '#6fa84a');
  stem.translate(0, 0.25, 0);
  parts.push(stem);
  for (let i = 0; i < 5; i++) {
    const petal = leafGeometry(0.11, 0.07, { fold: 0.2, curl: -0.2, widest: 0.6, roundTip: 1, segmentsL: 2, segmentsW: 1, vein: false });
    solidColor(petal, '#ffffff');
    petal.rotateX(-0.2);
    petal.rotateY((i / 5) * Math.PI * 2);
    petal.translate(0, 0.5, 0);
    parts.push(petal);
  }
  const center = solidColor(claySphere(0.035, 1, 0.05), '#f4b43a');
  center.scale(1, 0.6, 1);
  center.translate(0, 0.51, 0);
  parts.push(center);
  // Duas folhinhas no pé.
  for (let i = 0; i < 2; i++) {
    const leaf = leafGeometry(0.16, 0.07, { fold: 0.3, curl: 0.4, segmentsL: 3, segmentsW: 1 });
    paintVertices(leaf, (_p, _n, c) => c.set('#6fa84a'));
    leaf.rotateX(-0.6);
    leaf.rotateY(i * Math.PI + 0.4);
    leaf.translate(0, 0.04, 0);
    parts.push(leaf);
  }
  return mergeFlat(parts);
}

/** Folha seca caída (a cor vem da instância; aqui só a nervura e as bordas mais escuras). */
function buildLitterGeometry(): THREE.BufferGeometry {
  const leaf = leafGeometry(0.62, 0.36, { fold: 0.18, curl: -0.12, widest: 0.42, segmentsL: 6, segmentsW: 2 });
  leaf.translate(0, 0, -0.31);
  const stem = solidColor(new THREE.CylinderGeometry(0.01, 0.012, 0.14, 3, 1, true), '#8a6a45');
  stem.rotateX(Math.PI / 2);
  stem.translate(0, 0.005, -0.37);
  return mergeFlat([leaf, stem]);
}

/** Funde peças normalizando os atributos (position, normal, uv, color) e o índice. */
function mergeFlat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.getAttribute('color')) solidColor(g, '#ffffff');
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}
