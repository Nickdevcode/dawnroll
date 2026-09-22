import * as THREE from 'three';
import { claySphere, lumpify, paintVertices } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import { latheGeometry, leafGeometry, smoothProfile } from './shapes';
import type { SceneryContext } from './context';

const BushColors = ['#5f9a47', '#6fae4f', '#7cb957', '#588f43'];

/**
 * Moita no horizonte: vários pompons de folhagem no nível do chão, fechando a
 * linha do fundo entre as árvores gigantes (some suave na neblina).
 */
export function buildBush(ctx: SceneryContext, x: number, z: number, size: number): void {
  const { rng } = ctx;
  const root = new THREE.Group();
  root.position.set(x, terrainHeight(x, z) - size * 0.3, z);
  const puffs = 5 + Math.floor(rng.next() * 4);
  for (let i = 0; i < puffs; i++) {
    const r = size * rng.range(0.45, 0.8);
    const geo = claySphere(r, ctx.decor < 1 ? 2 : 4, 0.14, 1.6, x + i);
    const tint = new THREE.Color(rng.pick(BushColors));
    paintVertices(geo, (_p, n, c) => c.copy(tint).multiplyScalar(0.6 + smoothstep(-0.5, 0.9, n.y) * 0.55));
    const puff = part(geo, 0xffffff, 'soft', 3);
    const a = rng.next() * Math.PI * 2;
    const d = size * rng.range(0, 0.9);
    puff.position.set(Math.cos(a) * d, r * rng.range(0.3, 0.8), Math.sin(a) * d);
    root.add(puff);
  }
  ctx.batch.addObject(root);
}

/**
 * Vaso de terracota gigante com uma planta: marco visual no canto do jardim
 * (e a piada de escala — é um vaso comum de varanda).
 */
export function buildFlowerPot(ctx: SceneryContext, x: number, z: number): void {
  const { rng } = ctx;
  const root = new THREE.Group();
  const ground = terrainHeight(x, z);
  root.position.set(x, ground - 3, z);
  root.rotation.y = rng.next() * Math.PI * 2;

  const R = 15;
  const H = 24;
  // Corpo afunilado + borda grossa, num perfil de torno só.
  const potGeo = lumpify(
    latheGeometry(
      smoothProfile(
        [
          [R * 0.62, 0],
          [R * 0.78, H * 0.45],
          [R * 0.92, H * 0.82],
          [R * 0.95, H * 0.84],
          [R * 1.06, H * 0.86],
          [R * 1.08, H * 0.98],
          [R * 1.02, H * 1.0],
          [R * 0.9, H * 0.97],
        ],
        30,
      ),
      48,
    ),
    0.35,
    0.12,
    x,
  );
  paintVertices(potGeo, (p, _n, c) => {
    c.set('#d4774a').lerp(new THREE.Color('#e79a6a'), smoothstep(H * 0.84, H, p.y) * 0.6);
    // Marcas de água e sujeira na base.
    c.lerp(new THREE.Color('#a45a3a'), (1 - smoothstep(0, H * 0.35, p.y)) * 0.45);
    return c.multiplyScalar(1 + noise3(p.x * 0.3, p.y * 0.3, p.z * 0.3) * 0.08);
  });
  root.add(part(potGeo, 0xffffff, 'matte', 6));

  const soil = part(claySphere(R * 0.9, 5, 0.06, 1.5, 3), '#6d4a33', 'matte', 5);
  soil.scale.set(1, 0.12, 1);
  soil.position.y = H * 0.93;
  root.add(soil);

  // Planta: leque de folhas enormes com nervura.
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const length = rng.range(18, 28);
    const leaf = part(leafGeometry(length, length * 0.38, { fold: 0.4, curl: 0.7, widest: 0.45, segmentsL: 14, segmentsW: 5 }), rng.pick(['#5f9e44', '#72b451', '#86c35d']), 'plant', 4);
    leaf.position.y = H * 0.95;
    leaf.rotation.set(-rng.range(0.5, 1.1), (i / leaves) * Math.PI * 2 + rng.range(-0.2, 0.2), 0, 'YXZ');
    root.add(leaf);
  }
  ctx.batch.addObject(root, { sway: 0 });
  ctx.addShade(x, z, R * 1.5, 0.8);
}
