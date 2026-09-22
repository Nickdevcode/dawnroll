import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { displace, paintVertices } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import type { SceneryContext } from './context';

const RockColors = ['#b9b1c9', '#aaa39b', '#cabfae', '#9fa6b8', '#c4b7a6'];
const MossColors = ['#7fae4f', '#6d9d47', '#8dbb5a'];
const LICHEN = new THREE.Color('#ece3b6');

/**
 * Rochedo (uma pedra comum, vista por um besouro): forma em três oitavas de ruído,
 * base mais escura, veios horizontais, musgo nas faces de cima e liquens claros.
 * Em volta, um punhado de pedrinhas soltas.
 */
export function buildRock(ctx: SceneryContext, x: number, z: number, size: number): void {
  const { rng } = ctx;
  const sx = size * rng.range(0.9, 1.3);
  const sy = size * rng.range(0.45, 0.8);
  const sz = size * rng.range(0.8, 1.2);
  const seed = rng.range(0, 50);

  // Detalhe da malha acompanha o aparelho (no celular a pedra é mais simples).
  const geometry = displace(new THREE.IcosahedronGeometry(1, ctx.decor < 1 ? 5 : 8), (px, py, pz) =>
    noise3(px * 1.3 + seed, py * 1.3, pz * 1.3 - seed) * 0.22 +
    noise3(px * 3.6 + seed, py * 3.6, pz * 3.6) * 0.06 +
    noise3(px * 9 - seed, py * 9 + seed, pz * 9) * 0.016,
  );
  geometry.scale(sx, sy, sz);

  const base = new THREE.Color(rng.pick(RockColors));
  const moss = new THREE.Color(rng.pick(MossColors));
  const mossAmount = rng.next() < 0.75 ? rng.range(0.5, 1) : 0;
  paintVertices(geometry, (p, n, c) => {
    const h = THREE.MathUtils.clamp((p.y / sy + 1) / 2, 0, 1);
    c.copy(base).multiplyScalar(0.7 + h * 0.42);
    // Veios: faixas horizontais onduladas (rocha sedimentar de massinha).
    const band = Math.sin((p.y / size) * 9 + noise3(p.x * 0.7, p.y * 0.3, p.z * 0.7) * 3);
    c.multiplyScalar(1 + band * 0.045);
    const mossMask = smoothstep(0.4, 0.85, n.y) * smoothstep(-0.15, 0.3, noise3(p.x * 0.6 + seed, p.y * 0.6, p.z * 0.6)) * mossAmount;
    c.lerp(moss, mossMask * 0.9);
    if (noise3(p.x * 3.3, p.y * 3.3, p.z * 3.3 + seed) > 0.4) c.lerp(LICHEN, 0.4 * (1 - mossMask));
    return c;
  });

  const mesh = part(geometry, 0xffffff, 'stone', 1 + size * 0.35);
  const y = terrainHeight(x, z) - size * 0.15;
  mesh.position.set(x, y, z);
  mesh.rotation.y = rng.next() * Math.PI * 2;
  ctx.batch.addObject(mesh);

  // Casco convexo a partir dos próprios vértices; a rotação vai no corpo rígido.
  mesh.updateMatrix();
  const points = new Float32Array(geometry.getAttribute('position').array as ArrayLike<number>);
  const desc = RAPIER.ColliderDesc.convexHull(points);
  if (desc) ctx.addCollider(desc, mesh.position, mesh.quaternion);

  ctx.addSolid(x, z, Math.min(sx, sz) * 0.85);
  ctx.addShade(x, z, Math.max(sx, sz) * 1.1, 0.75);

  const pebbles = Math.round(rng.range(3, 8) * ctx.decor);
  for (let i = 0; i < pebbles; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.max(sx, sz) * rng.range(0.95, 1.5);
    buildPebble(ctx, x + Math.cos(a) * d, z + Math.sin(a) * d, size * rng.range(0.05, 0.14), base);
  }
}

const pebbleShapes: THREE.BufferGeometry[] = [];

/** Pedrinha solta (sem colisão): só enfeite de chão. */
export function buildPebble(ctx: SceneryContext, x: number, z: number, size: number, tint?: THREE.Color): void {
  const { rng } = ctx;
  if (pebbleShapes.length === 0) {
    for (let i = 0; i < 5; i++) {
      const g = displace(new THREE.IcosahedronGeometry(1, 2), (px, py, pz) => noise3(px * 1.6 + i * 7, py * 1.6, pz * 1.6) * 0.2);
      g.scale(1.15, 0.6, 0.95);
      pebbleShapes.push(g);
    }
  }
  const color = (tint ?? new THREE.Color(rng.pick(RockColors))).clone().multiplyScalar(rng.range(0.85, 1.12));
  const mesh = part(rng.pick(pebbleShapes), color, 'stone');
  mesh.scale.setScalar(size);
  mesh.position.set(x, terrainHeight(x, z) + size * 0.15, z);
  mesh.rotation.set(rng.range(-0.2, 0.2), rng.next() * Math.PI * 2, rng.range(-0.2, 0.2));
  ctx.batch.addObject(mesh, { castShadow: size > 0.18 });
}
