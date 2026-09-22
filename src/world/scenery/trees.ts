import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, displace, paintVertices, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import type { SceneryContext } from './context';

const BARK_LIGHT = new THREE.Color('#9a6c4b');
const BARK_DARK = new THREE.Color('#6a4631');
const LeafColors = ['#6fae4f', '#86c35d', '#5e9c48', '#94c867'];

/**
 * Árvore gigante fora da área jogável: vende a escala de "mundo em miniatura".
 * Tronco com sulcos verticais, raízes saindo para o chão e copa de muitos
 * "pompons" (mais claros em cima, sombreados por baixo).
 */
export function buildGiantTree(ctx: SceneryContext, x: number, z: number, radius: number, height: number): void {
  const { rng } = ctx;
  const seed = rng.range(0, 60);
  const baseY = terrainHeight(x, z) - 2;
  const root = new THREE.Group();
  root.position.set(x, baseY, z);

  const trunkGeo = displace(new THREE.CylinderGeometry(radius * 0.78, radius * 1.3, height, 36, 28), (px, py, pz) => {
    const angle = Math.atan2(pz, px);
    const groove = Math.pow(Math.abs(Math.sin(angle * 9 + noise3(py * 0.03 + seed, 0, 0) * 3)), 0.4);
    return (groove - 1) * radius * 0.07 + noise3(px * 0.15 + seed, py * 0.08, pz * 0.15) * radius * 0.12;
  });
  paintVertices(trunkGeo, (p, _n, c) => {
    const angle = Math.atan2(p.z, p.x);
    const ridge = Math.abs(Math.sin(angle * 9 + noise3(p.y * 0.03 + seed, 0, 0) * 3));
    return c.copy(BARK_DARK).lerp(BARK_LIGHT, ridge * 0.85 + noise3(p.x * 0.3, p.y * 0.2, p.z * 0.3) * 0.2);
  });
  const trunk = part(trunkGeo, 0xffffff, 'bark', 7);
  trunk.position.y = height / 2;
  root.add(trunk);

  // Raízes: tubos que saem do pé do tronco e mergulham na terra.
  const roots = 5 + Math.floor(rng.next() * 3);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const reach = radius * rng.range(1.6, 2.6);
    const curve = new THREE.CatmullRomCurve3([
      dir.clone().multiplyScalar(radius * 0.6).setY(radius * 1.6),
      dir.clone().multiplyScalar(radius * 1.25).setY(radius * 0.7),
      dir.clone().multiplyScalar(reach).setY(0.9),
      dir.clone().multiplyScalar(reach * 1.25).setY(-0.8),
    ]);
    const rootGeo = taperedTube(curve, 18, (t) => radius * (0.42 - t * 0.3), 10);
    root.add(part(rootGeo, BARK_DARK.clone().lerp(BARK_LIGHT, 0.4), 'bark', 3));
  }

  // Copa: pompons com vertex color (luz de cima, sombra por baixo, variação de tom).
  const puffs = 10 + Math.floor(rng.next() * 4);
  for (let j = 0; j < puffs; j++) {
    const r = rng.range(11, 19);
    const geo = claySphere(r, ctx.decor < 1 ? 3 : 5, 0.12, 1.4, seed + j);
    const tint = new THREE.Color(rng.pick(LeafColors));
    paintVertices(geo, (p, n, c) => {
      const light = 0.62 + smoothstep(-0.6, 0.9, n.y) * 0.55;
      return c.copy(tint).multiplyScalar(light * (1 + noise3(p.x * 0.2, p.y * 0.2, p.z * 0.2) * 0.1));
    });
    const puff = part(geo, 0xffffff, 'soft', 4);
    puff.position.set(rng.range(-15, 15), height * 0.95 + rng.range(-7, 9), rng.range(-15, 15));
    root.add(puff);
  }

  ctx.batch.addObject(root);
  ctx.addShade(x, z, radius * 3, 0.8);
  ctx.addCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius), new THREE.Vector3(x, baseY + height / 2, z));
}
