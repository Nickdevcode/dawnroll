import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, displace, lumpify, paintVertices } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import { latheGeometry, smoothProfile } from './shapes';
import { sphereVolume, type SceneryContext } from './context';

interface CapStyle {
  /** Figurinha do catálogo da toca. */
  id: string;
  top: string;
  rim: string;
  dots: boolean;
  gills: string;
}

const CapStyles: CapStyle[] = [
  { id: 'amanita', top: '#d9443c', rim: '#f2725b', dots: true, gills: '#f6dcc0' }, // amanita clássico
  { id: 'orangeCap', top: '#e8793a', rim: '#f6ad5c', dots: true, gills: '#f8e2c2' },
  { id: 'pinkCap', top: '#d24a73', rim: '#f082a3', dots: true, gills: '#f7d9e0' },
  { id: 'porcini', top: '#9a5f38', rim: '#c98b55', dots: false, gills: '#efd8b4' }, // porcino
  { id: 'violetCap', top: '#8a6fd1', rim: '#b9a3ef', dots: false, gills: '#ebe0fb' },
];

const STEM = new THREE.Color('#fbefd9');
const STEM_BASE = new THREE.Color('#d8bf9c');

/** Altura do chapéu num raio `r` (domo levemente achatado). */
const capHeightAt = (r: number, radius: number, height: number) => height * Math.pow(Math.max(0, 1 - (r / radius) ** 2), 0.62);

/**
 * Touceira de cogumelos: um grande (com colisão) e filhotes em volta.
 * Cada cogumelo tem pé com bulbo, saia, chapéu em domo com a borda virada,
 * lamelas por baixo e bolinhas no topo.
 */
export function buildMushroomCluster(ctx: SceneryContext, x: number, z: number, height: number): void {
  const { rng } = ctx;
  const style = rng.pick(CapStyles);
  buildMushroom(ctx, x, z, height, style, rng.range(-0.08, 0.08), true);
  const babies = 2 + Math.floor(rng.next() * 4);
  for (let i = 0; i < babies; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = height * rng.range(0.45, 0.8);
    const h = height * rng.range(0.22, 0.5);
    buildMushroom(ctx, x + Math.cos(a) * d, z + Math.sin(a) * d, h, style, rng.range(-0.3, 0.3), h > 1.1);
  }
  ctx.addShade(x, z, height * 0.9, 0.6);
}

function buildMushroom(ctx: SceneryContext, x: number, z: number, height: number, style: CapStyle, tilt: number, collider: boolean): void {
  const { rng } = ctx;
  const root = new THREE.Group();
  const baseY = terrainHeight(x, z) - 0.05;
  root.position.set(x, baseY, z);
  root.rotation.set(tilt, rng.next() * Math.PI * 2, tilt * 0.6);

  const stemR = height * 0.11;
  const capR = height * rng.range(0.42, 0.56);
  const capH = capR * rng.range(0.5, 0.75);
  const capY = height * 0.9;

  // Pé: bulbo na base, afina no meio e abre de leve sob o chapéu.
  const stemProfile = smoothProfile(
    [
      [stemR * 0.2, 0],
      [stemR * 1.35, height * 0.03],
      [stemR * 1.2, height * 0.14],
      [stemR * 0.92, height * 0.45],
      [stemR * 0.86, height * 0.78],
      [stemR * 1.05, capY],
    ],
    20,
  );
  const stemGeo = lumpify(latheGeometry(stemProfile, 20), stemR * 0.06, 2 / stemR, x);
  paintVertices(stemGeo, (p, _n, c) => {
    const t = THREE.MathUtils.clamp(p.y / height, 0, 1);
    c.copy(STEM_BASE).lerp(STEM, smoothstep(0, 0.35, t));
    // Estrias verticais bem sutis.
    return c.multiplyScalar(1 + Math.sin(Math.atan2(p.z, p.x) * 11 + p.y * 2) * 0.025);
  });
  root.add(part(stemGeo, 0xffffff, 'soft'));

  // Saia (anel) pendurada no pé.
  const skirtY = height * 0.68;
  const skirtGeo = latheGeometry(
    smoothProfile(
      [
        [stemR * 1.9, skirtY - height * 0.07],
        [stemR * 1.5, skirtY - height * 0.02],
        [stemR * 1.0, skirtY],
      ],
      8,
    ),
    20,
  );
  const skirt = part(skirtGeo, STEM.clone().multiplyScalar(0.97), 'soft');
  root.add(skirt);

  // Chapéu: perfil de torno de baixo (junto ao pé) para fora, borda virada e domo por cima.
  const profile: Array<[number, number]> = [
    [stemR * 0.9, -capH * 0.05],
    [capR * 0.55, -capH * 0.08],
    [capR * 0.92, -capH * 0.02],
    [capR * 1.0, capH * 0.08],
  ];
  for (let i = 1; i <= 10; i++) {
    const r = capR * (1 - i / 10) * 0.98;
    profile.push([r, capHeightAt(r, capR, capH)]);
  }
  // Lamelas esculpidas no próprio chapéu: sulcos radiais só na face de baixo.
  const gillCount = height > 1.5 ? 48 : 24;
  const capGeo = displace(latheGeometry(smoothProfile(profile, 22), gillCount * 2), (px, py, pz) => {
    const r = Math.hypot(px, pz);
    const under = (1 - smoothstep(-capH * 0.02, capH * 0.06, py)) * smoothstep(stemR * 1.2, stemR * 2, r) * (1 - smoothstep(capR * 0.86, capR * 0.97, r));
    const ridge = Math.pow(Math.abs(Math.sin(Math.atan2(pz, px) * gillCount * 0.5)), 0.5);
    return noise3(px * 1.8 / capR + z, py * 1.8 / capR, pz * 1.8 / capR) * capR * 0.035 + ridge * under * capH * 0.07;
  });
  const top = new THREE.Color(style.top);
  const rim = new THREE.Color(style.rim);
  const gills = new THREE.Color(style.gills);
  paintVertices(capGeo, (p, n, c) => {
    // Embaixo: lamelas claras, mais escuras no fundo dos sulcos (perto do pé).
    if (n.y < -0.2) return c.copy(gills).multiplyScalar(0.8 + smoothstep(stemR, capR, Math.hypot(p.x, p.z)) * 0.25);
    const r = Math.hypot(p.x, p.z) / capR;
    c.copy(top).lerp(rim, smoothstep(0.35, 1, r));
    return c.multiplyScalar(1 + noise3(p.x * 3, p.y * 3, p.z * 3) * 0.06);
  });
  const cap = part(capGeo, 0xffffff, 'glossy', 2);
  cap.position.y = capY;
  root.add(cap);

  // Bolinhas no topo, deitadas na superfície do domo.
  if (style.dots) {
    const dotGeo = claySphere(1, 3, 0.08, 2, 3);
    const count = height > 1.5 ? 11 : 5;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const theta = rng.next() * Math.PI * 2;
      const r = capR * Math.sqrt(rng.range(0.02, 0.72));
      const h = capHeightAt(r, capR, capH);
      // Normal do domo pela derivada numérica do perfil.
      const dr = capR * 0.02;
      const slope = (capHeightAt(r + dr, capR, capH) - h) / dr;
      const normal = new THREE.Vector3(-slope * Math.cos(theta), 1, -slope * Math.sin(theta)).normalize();
      const dot = part(dotGeo, '#fffaf2', 'soft');
      const s = capR * rng.range(0.07, 0.14);
      dot.scale.set(s, s * 0.32, s);
      dot.position.set(Math.cos(theta) * r, capY + h, Math.sin(theta) * r);
      dot.quaternion.setFromUnitVectors(up, normal);
      root.add(dot);
    }
  }

  ctx.addSolid(x, z, stemR * 1.4);
  const spot = ctx.addLandingSpot(new THREE.Vector3(x, baseY + capY + capH, z));

  const colliders = collider
    ? [
        ctx.addCollider(RAPIER.ColliderDesc.cylinder(height / 2, stemR), new THREE.Vector3(x, baseY + height / 2, z)),
        ctx.addCollider(RAPIER.ColliderDesc.roundCylinder(capH * 0.3, capR * 0.85, capH * 0.15), new THREE.Vector3(x, baseY + capY + capH * 0.35, z)),
      ]
    : [];

  const size = height * 0.5;
  ctx.addPickable({
    kind: 'mushroom',
    root,
    size,
    probeA: new THREE.Vector3(x, baseY, z),
    probeB: new THREE.Vector3(x, baseY + capY + capH * 0.4, z),
    probeRadius: Math.max(stemR * 1.3, capR * 0.86),
    colliders,
    landingSpots: [spot],
    tint: style.top,
    variant: style.id,
    volume: sphereVolume(size * 0.48),
    extent: Math.max(height + capH, capR * 2),
  });
}
