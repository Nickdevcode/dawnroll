import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, displace, paintVertices } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import { leafGeometry, latheGeometry, smoothProfile } from './shapes';
import type { SceneryContext } from './context';

const BARK_LIGHT = new THREE.Color('#a0714a');
const BARK_DARK = new THREE.Color('#6b4630');
const MOSS = new THREE.Color('#79a948');
const WOOD = new THREE.Color('#e6c38d');
const RING = new THREE.Color('#c29160');
const FungusColors = ['#f3dfb8', '#f1a95a', '#e9c9a0'];

/**
 * Graveto caído (um tronco, para o besouro): casca com sulcos, pontas cortadas
 * mostrando os anéis, musgo por cima, orelhas-de-pau na lateral e um broto.
 */
export function buildLog(ctx: SceneryContext, x: number, z: number): void {
  const { rng } = ctx;
  const length = rng.range(4.5, 8.5);
  const radius = rng.range(0.38, 0.72);
  const seed = rng.range(0, 40);

  // Construído em pé (eixo Y) e deitado depois.
  const barkGeo = displace(new THREE.CylinderGeometry(radius, radius * 1.06, length, 28, Math.ceil(length * 3), true), (px, py, pz) => {
    const angle = Math.atan2(pz, px);
    const groove = Math.pow(Math.abs(Math.sin(angle * 7 + noise3(py * 0.4 + seed, 0, 0) * 2.5)), 0.35);
    return (groove - 1) * radius * 0.07 + noise3(px * 2 + seed, py * 0.8, pz * 2) * radius * 0.08;
  });
  paintVertices(barkGeo, (p, n, c) => {
    const angle = Math.atan2(p.z, p.x);
    const ridge = Math.abs(Math.sin(angle * 7 + noise3(p.y * 0.4 + seed, 0, 0) * 2.5));
    c.copy(BARK_DARK).lerp(BARK_LIGHT, ridge * 0.8 + noise3(p.x * 3, p.y * 3, p.z * 3) * 0.15);
    // Depois de deitado, o "+X local" vira o topo do tronco: musgo ali.
    const mossMask = smoothstep(0.35, 0.9, n.x) * smoothstep(-0.2, 0.3, noise3(p.x + seed, p.y * 0.5, p.z));
    return c.lerp(MOSS, mossMask * 0.85);
  });

  const root = new THREE.Group();
  const yaw = rng.next() * Math.PI;
  // Deita: +Y local vira horizontal e +X local aponta para cima.
  root.quaternion.setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ'));
  const y = Math.max(terrainHeight(x, z), terrainHeight(x + Math.cos(yaw) * length * 0.5, z - Math.sin(yaw) * length * 0.5)) + radius * 0.55;
  root.position.set(x, y, z);
  root.add(part(barkGeo, 0xffffff, 'bark', 2));

  // Pontas cortadas: disco levemente côncavo com anéis de crescimento.
  const endGeo = latheGeometry(
    smoothProfile(
      [
        [radius * 1.02, 0],
        [radius * 0.7, -radius * 0.03],
        [radius * 0.3, -radius * 0.05],
        [0.001, -radius * 0.04],
      ],
      10,
    ),
    28,
  );
  paintVertices(endGeo, (p, _n, c) => {
    const r = Math.hypot(p.x, p.z) / radius;
    const rings = Math.sin(r * 26 + noise3(p.x * 4, 0, p.z * 4) * 2) * 0.5 + 0.5;
    c.copy(WOOD).lerp(RING, rings * 0.6);
    return r > 0.92 ? c.lerp(BARK_DARK, 0.7) : c;
  });
  for (const side of [1, -1]) {
    const end = part(endGeo, 0xffffff, 'matte');
    end.position.y = (side * length) / 2;
    // O perfil foi feito virado para cima; a ponta de baixo gira 180°.
    if (side === -1) end.rotation.x = Math.PI;
    end.scale.setScalar(side === 1 ? 1 : 1.06);
    root.add(end);
  }

  // Orelhas-de-pau: meias-luas empilhadas na lateral.
  const fungi = rng.next() < 0.7 ? 2 + Math.floor(rng.next() * 3) : 0;
  const fungusColor = new THREE.Color(rng.pick(FungusColors));
  const fungusGeo = claySphere(1, 4, 0.08, 2, seed);
  // Achatada no X local, que depois de deitado é o "para cima" do mundo.
  fungusGeo.scale(0.22, 1, 1);
  const side = rng.next() < 0.5 ? 1 : -1;
  for (let i = 0; i < fungi; i++) {
    const s = radius * rng.range(0.35, 0.6);
    const f = part(fungusGeo, fungusColor.clone().multiplyScalar(rng.range(0.9, 1.08)), 'soft');
    f.scale.set(s, s, s * 0.8);
    f.position.set(radius * 0.15, rng.range(-0.35, 0.35) * length, side * radius * 1.02);
    root.add(f);
  }

  // Broto com duas folhinhas, saindo do topo.
  const sprout = new THREE.Group();
  sprout.position.set(radius * 0.95, length * rng.range(-0.3, 0.3), 0);
  sprout.rotation.z = -Math.PI / 2;
  const leafGeo = leafGeometry(radius * 1.1, radius * 0.55, { fold: 0.3, curl: 0.4 });
  for (let i = 0; i < 2; i++) {
    const leaf = part(leafGeo, '#8fd16a', 'soft');
    leaf.rotation.set(-0.6, i * Math.PI, 0, 'YXZ');
    sprout.add(leaf);
  }
  root.add(sprout);

  const dirX = Math.cos(yaw);
  const dirZ = -Math.sin(yaw);
  const steps = Math.ceil(length / (radius * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps - 0.5;
    ctx.addSolid(x + dirX * length * t, z + dirZ * length * t, radius * 0.9);
    ctx.addShade(x + dirX * length * t, z + dirZ * length * t, radius * 1.4, 0.55);
  }
  const collider = ctx.addCollider(RAPIER.ColliderDesc.capsule(length / 2, radius), root.position, root.quaternion);

  // Eixo do tronco no mundo (o +Y local, deitado).
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion).multiplyScalar(length / 2);
  const size = length * 0.4;
  ctx.addPickable({
    kind: 'log',
    root,
    size,
    probeA: root.position.clone().sub(axis),
    probeB: root.position.clone().add(axis),
    probeRadius: radius,
    colliders: [collider],
    landingSpots: [],
    tint: BARK_LIGHT,
    volume: Math.PI * radius * radius * length * 0.75,
    extent: length,
  });
}
