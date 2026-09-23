import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, displace, paintVertices, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { latheGeometry, leafGeometry, smoothProfile } from '../scenery/shapes';
import type { SceneryContext } from '../scenery/context';
import { addObject, restOnGround, settle, toWorld } from './common';
import { fuseParts } from './forms';

/**
 * Frutas caídas: maçã (com a folhinha), morango (com as sementinhas em
 * covinhas) e pinha (escamas em espiral de Fibonacci). Cada uma deitada de um
 * jeito, encostada no chão, e com colisor para a bola pequena bater.
 */

const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// --- Maçã ---------------------------------------------------------------------

const APPLE_RADIUS = 1.8;
const AppleReds = ['#c9302c', '#b8262f', '#d23b2c'];

/** Casca: vermelho com o lado da sombra amarelado, estrias verticais e pontinhos claros. */
function appleGeometry(red: string, seed: number): THREE.BufferGeometry {
  const R = APPLE_RADIUS;
  const profile = smoothProfile(
    [
      [0.001, -0.66],
      [0.16, -0.72],
      [0.42, -0.84],
      [0.72, -0.77],
      [0.93, -0.44],
      [1.0, -0.04],
      [0.97, 0.3],
      [0.86, 0.6],
      [0.63, 0.8],
      [0.34, 0.79],
      [0.14, 0.64],
      [0.001, 0.56],
    ].map(([r, y]) => [r * R, y * R] as [number, number]),
    40,
  );
  const geo = displace(latheGeometry(profile, 44), (x, y, z) => noise3(x * 0.7 + seed, y * 0.7, z * 0.7) * R * 0.035);
  const base = new THREE.Color(red);
  const deep = base.clone().multiplyScalar(0.62);
  const blush = new THREE.Color('#e8c349');
  const pale = new THREE.Color('#f3dc86');
  return paintVertices(geo, (p, _n, c) => {
    const angle = Math.atan2(p.z, p.x);
    // Um lado pegou sol (vermelho fundo), o outro ficou amarelado.
    const side = Math.cos(angle - seed) * 0.5 + 0.5;
    const streak = noise3(angle * 5 + seed, p.y * 0.35, 0) * 0.5 + 0.5;
    c.copy(blush).lerp(base, smoothstep(0.1, 0.55, side * 0.8 + streak * 0.35));
    c.lerp(deep, smoothstep(0.55, 0.95, side) * 0.55);
    // Covinhas do cabo e do "umbigo": mais claras e esverdeadas.
    const r = Math.hypot(p.x, p.z) / R;
    const dimple = (1 - smoothstep(0.1, 0.42, r)) * (Math.abs(p.y) > R * 0.3 ? 1 : 0);
    c.lerp(new THREE.Color('#b9b04a'), dimple * 0.55);
    // Lenticelas: pontinhos claros espalhados.
    if (noise3(p.x * 9 + seed, p.y * 9, p.z * 9) > 0.52) c.lerp(pale, 0.55);
    return c;
  });
}

/** Maçã caída, meio deitada, com o cabinho e uma folha. */
export function buildApple(ctx: SceneryContext, x: number, z: number, yaw: number): void {
  const { rng } = ctx;
  const R = APPLE_RADIUS;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const red = rng.pick(AppleReds);
  body.add(part(appleGeometry(red, rng.range(0, 6)), 0xffffff, 'glossy', 2));

  // Cabinho curvo saindo da covinha e a folha presa nele.
  const top = new THREE.Vector3(0, R * 0.58, 0);
  const stemEnd = new THREE.Vector3(R * 0.08, R * 1.02, R * 0.04);
  const stem = taperedTube(new THREE.QuadraticBezierCurve3(top, new THREE.Vector3(0, R * 0.85, 0), stemEnd), 8, (t) => R * (0.05 - t * 0.018), 6);
  body.add(part(stem, '#6b4a2e', 'matte'));
  const leaf = part(leafGeometry(R * 1.05, R * 0.5, { fold: 0.3, curl: 0.35, widest: 0.42 }), '#6fae4a', 'soft');
  leaf.position.set(R * 0.03, R * 0.8, 0);
  leaf.rotation.set(-0.35, rng.range(0, Math.PI * 2), 0, 'YXZ');
  body.add(leaf);

  // Tombada para um lado (maçã caída raramente fica de pé).
  body.rotation.set(rng.range(0.35, 0.7), rng.range(0, Math.PI * 2), 0, 'YXZ');
  restOnGround(root, 0.12);
  settle(root, x, z, yaw, 1, 0);

  const center = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.ball(R * 0.92), center);
  ctx.addSolid(x, z, R * 0.85);
  ctx.addShade(x, z, R * 1.3, 0.5);
  const spot = ctx.addLandingSpot(center.clone().add(new THREE.Vector3(0, R * 0.9, 0)));
  addObject(ctx, {
    id: 'apple',
    root,
    colliders: [collider],
    probeA: new THREE.Vector3(x, center.y - R * 0.5, z),
    probeB: new THREE.Vector3(x, center.y + R * 0.4, z),
    probeRadius: R,
    extent: R * 2.3,
    tint: red,
    landingSpots: [spot],
  });
}

// --- Morango ------------------------------------------------------------------

const STRAWBERRY_LENGTH = 1.7;
const strawberryCache = new Map<number, THREE.BufferGeometry[]>();

/**
 * Corpo em torno de Y (ponta em y = 0), com covinhas onde ficam as sementes, e
 * as sementes (aquênios) como gotinhas amarelas deitadas nas covinhas.
 */
function strawberryParts(variant: number): THREE.BufferGeometry[] {
  const cached = strawberryCache.get(variant);
  if (cached) return cached;
  const L = STRAWBERRY_LENGTH;
  const profile = smoothProfile(
    [
      [0.001, 0],
      [0.13, 0.07],
      [0.33, 0.34],
      [0.5, 0.72],
      [0.6, 1.08],
      [0.61 + variant * 0.04, 1.34],
      [0.52, 1.54],
      [0.3, 1.66],
      [0.001, 1.62],
    ].map(([r, y]) => [r, (y / 1.66) * L] as [number, number]),
    30,
  );
  const radiusAt = (y: number) => {
    // Raio do perfil numa altura (busca linear: o perfil é curto).
    for (let i = 1; i < profile.length; i++) {
      const [r0, y0] = profile[i - 1];
      const [r1, y1] = profile[i];
      if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return r0 + ((y - y0) / (y1 - y0 || 1)) * (r1 - r0);
    }
    return 0;
  };

  // Sementes em espiral dourada entre a ponta e o ombro.
  const seeds: Array<{ p: THREE.Vector3; n: THREE.Vector3 }> = [];
  const count = 64;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const y = L * (0.06 + t * 0.8);
    const a = i * GOLDEN_ANGLE + variant;
    const r = radiusAt(y);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    // Normal aproximada do corpo (o perfil afina para a ponta).
    const slope = (radiusAt(y + 0.02) - radiusAt(y - 0.02)) / 0.04;
    seeds.push({ p: dir.clone().multiplyScalar(r).setY(y), n: dir.clone().setY(-slope).normalize() });
  }

  const body = displace(latheGeometry(profile, 40), (x, y, z) => {
    let dent = 0;
    for (const s of seeds) {
      const d2 = (x - s.p.x) ** 2 + (y - s.p.y) ** 2 + (z - s.p.z) ** 2;
      if (d2 < 0.012) dent = Math.max(dent, 1 - d2 / 0.012);
    }
    return -dent * 0.035;
  });
  const red = new THREE.Color('#d8232d');
  const ripe = new THREE.Color('#b3141f');
  const shoulder = new THREE.Color('#ea5a55');
  paintVertices(body, (p, _n, c) => {
    c.copy(red).lerp(ripe, 1 - smoothstep(0, L * 0.5, p.y));
    // Perto do cálice ainda está clarinho (é a última parte a amadurecer).
    return c.lerp(shoulder, smoothstep(L * 0.82, L * 0.97, p.y) * 0.45).multiplyScalar(0.94 + noise3(p.x * 6, p.y * 6, p.z * 6) * 0.1);
  });

  const seedShape = new THREE.IcosahedronGeometry(1, 1);
  seedShape.scale(0.026, 0.02, 0.042);
  const seedParts = seeds.map((s) => {
    const g = seedShape.clone();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, s.n));
    g.translate(s.p.x - s.n.x * 0.012, s.p.y - s.n.y * 0.012, s.p.z - s.n.z * 0.012);
    return paintVertices(g, (_p, _n, c) => c.set('#f2d25a'));
  });
  seedShape.dispose();
  // As sementes viram uma malha só (uma peça no lote em vez de 64).
  const parts = [body, fuseParts(seedParts)];
  strawberryCache.set(variant, parts);
  return parts;
}

/** Morango deitado de lado; `lift` = altura extra do que está embaixo (a toalha). */
export function buildStrawberry(ctx: SceneryContext, x: number, z: number, yaw: number, lift = 0): void {
  const { rng } = ctx;
  const L = STRAWBERRY_LENGTH;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const [flesh, seeds] = strawberryParts(Math.floor(rng.next() * 2));
  body.add(part(flesh, 0xffffff, 'glossy', 3), part(seeds, 0xffffff, 'glossy'));

  // Cálice: estrela de sépalas caídas por cima do ombro e o cabinho.
  const sepals = 6;
  // Sépalas saindo por cima do ombro e caindo rente a ele (a ponta encosta no morango).
  const sepal = leafGeometry(0.62, 0.26, { fold: 0.3, curl: 0.7, widest: 0.4, segmentsL: 6, segmentsW: 2 });
  for (let i = 0; i < sepals; i++) {
    const s = part(sepal, '#4e8f35', 'soft');
    s.position.set(0, L * 0.99, 0);
    s.rotation.set(-0.12, (i / sepals) * Math.PI * 2 + rng.range(-0.2, 0.2), 0, 'YXZ');
    body.add(s);
  }
  const stem = taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, L * 0.96, 0), new THREE.Vector3(0.02, L * 1.1, 0), new THREE.Vector3(0.1, L * 1.2, 0.03)), 6, (t) => 0.05 - t * 0.02, 5);
  body.add(part(stem, '#5d8f3a', 'soft'));

  // Deitado de lado, com a ponta um pouco mais baixa.
  body.rotation.set(Math.PI / 2 - rng.range(0.05, 0.3), rng.range(0, Math.PI * 2), 0, 'YXZ');
  restOnGround(root, 0.05);
  settle(root, x, z, yaw, 1, -lift);

  const center = toWorld(root, 0, 0.55, 0);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.ball(0.6), center);
  ctx.addSolid(x, z, 0.5);
  const spot = ctx.addLandingSpot(center.clone().add(new THREE.Vector3(0, 0.5, 0)));
  addObject(ctx, {
    id: 'strawberry',
    root,
    colliders: [collider],
    probeA: new THREE.Vector3(x, center.y - 0.4, z),
    probeB: new THREE.Vector3(x, center.y + 0.3, z),
    probeRadius: 0.85,
    extent: L * 1.15,
    tint: '#d8232d',
    landingSpots: [spot],
  });
}

// --- Pinha --------------------------------------------------------------------

const PINECONE_LENGTH = 3.6;
let pineScale: THREE.BufferGeometry | null = null;

/** Escama: cunha de massinha com a ponta (apófise) mais clara e o umbigo escuro. */
function pineScaleGeometry(): THREE.BufferGeometry {
  if (pineScale) return pineScale;
  const g = claySphere(1, 2, 0.08, 2, 5);
  g.scale(0.5, 0.2, 0.55);
  g.translate(0, 0, 0.5);
  // Mais grossa na ponta, fina na base (onde entra no miolo).
  const shaped = displace(g, (_x, _y, z) => smoothstep(0.1, 0.9, z) * 0.035);
  pineScale = paintVertices(shaped, (p, n, c) => {
    const tip = smoothstep(0.55, 1.0, p.z);
    c.set('#6e4427').lerp(new THREE.Color('#c08a52'), tip * (0.6 + n.y * 0.3));
    // Umbigo escuro bem na pontinha.
    if (p.z > 0.97 && n.y > 0.2) c.lerp(new THREE.Color('#4a2e1c'), 0.6);
    return c;
  });
  return pineScale;
}

/** Pinha caída de lado: miolo ovalado e escamas abertas em espiral, maiores no meio. */
export function buildPinecone(ctx: SceneryContext, x: number, z: number, yaw: number): void {
  const { rng } = ctx;
  const L = PINECONE_LENGTH;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const coreProfile = smoothProfile(
    [
      [0.001, -L * 0.5],
      [0.22, -L * 0.42],
      [0.45, -L * 0.15],
      [0.42, L * 0.2],
      [0.22, L * 0.44],
      [0.001, L * 0.5],
    ],
    16,
  );
  body.add(part(latheGeometry(coreProfile, 14), '#5b3a22', 'bark'));

  // Espiral dourada de escamas: abertas, apontando para a ponta, maiores no terço de baixo.
  const count = ctx.decor < 1 ? 50 : 76;
  const scaleGeo = pineScaleGeometry();
  const out = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const y = -L * 0.46 + t * L * 0.92;
    const a = i * GOLDEN_ANGLE;
    out.set(Math.cos(a), 0, Math.sin(a));
    const tilt = 0.25 + t * 0.75;
    dir.copy(out).multiplyScalar(Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt)).normalize();
    normal.copy(UP).multiplyScalar(Math.cos(tilt)).addScaledVector(out, -Math.sin(tilt)).normalize();
    side.crossVectors(normal, dir);
    const size = 0.42 + Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.25)), 0.7) * 0.75;
    const scale = part(scaleGeo, 0xffffff, 'bark');
    basis.makeBasis(side, normal, dir);
    scale.quaternion.setFromRotationMatrix(basis);
    scale.scale.setScalar(size * rng.range(0.9, 1.08));
    const coreR = Math.max(0.12, 0.45 * Math.sin(Math.PI * (0.08 + t * 0.84)));
    scale.position.copy(out).multiplyScalar(coreR * 0.8).setY(y);
    body.add(scale);
  }
  // Cabinho quebrado na base.
  const stalk = part(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 6), '#5b3a22', 'bark');
  stalk.position.y = -L * 0.52;
  body.add(stalk);

  // Deitada: o eixo fica quase na horizontal, com a ponta um pouco para cima.
  body.rotation.set(Math.PI / 2 - rng.range(0.05, 0.25), rng.range(0, Math.PI * 2), 0, 'YXZ');
  restOnGround(root, 0.15);
  settle(root, x, z, yaw, 1, 0);

  body.updateMatrixWorld(true);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
  const center = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.capsule(L * 0.28, 0.85), center, new THREE.Quaternion().setFromUnitVectors(UP, axis));
  ctx.addSolid(x, z, 0.9);
  ctx.addShade(x, z, L * 0.55, 0.45);
  addObject(ctx, {
    id: 'pinecone',
    root,
    colliders: [collider],
    probeA: center.clone().addScaledVector(axis, -L * 0.36),
    probeB: center.clone().addScaledVector(axis, L * 0.36),
    probeRadius: 1.0,
    extent: L,
    tint: '#9a6a3f',
  });
}
