import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, lumpify, paintVertices, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import { latheGeometry, leafGeometry, smoothProfile } from '../scenery/shapes';
import type { SceneryContext } from '../scenery/context';
import type { ZoneSite } from '../zones';
import { addObject, attachHull, restOnGround, settle, toWorld, zoneFrame, type ModelPart } from './common';
import { roundedRectSection, slab, smoothOutline, sweep, warp } from './forms';
import { buildGnome } from './gnome';

/**
 * Cantinho do jardineiro: vasinhos de barro (um tombado, com a terra
 * derramada), pás de jardinagem (uma fincada na terra), luvas largadas, um par
 * de chinelos de dedo e, no meio de tudo, o anão de jardim — o chefão.
 */

const UP = new THREE.Vector3(0, 1, 0);
const SOIL = new THREE.Color('#4a3222');
const SOIL_LIGHT = new THREE.Color('#6b4a31');

// --- Vasinho de barro -------------------------------------------------------------

const POT_HEIGHT = 4.0;
const POT_RIM = 2.24;
let potGeometry: THREE.BufferGeometry | null = null;

/** Vaso com parede grossa (perfil fechado: fora, beiço da borda, dentro e fundo). */
function potBody(): THREE.BufferGeometry {
  if (potGeometry) return potGeometry;
  const H = POT_HEIGHT;
  const profile = smoothProfile(
    [
      [0.001, 0],
      [1.3, 0],
      [1.5, 0.1],
      [1.62, 1.2],
      [1.8, 2.8],
      [1.86, 3.08],
      [2.16, 3.16],
      [POT_RIM, 3.4],
      [2.22, H - 0.02],
      [2.08, H + 0.04],
      [1.94, H - 0.06],
      [1.72, 3.1],
      [1.52, 1.2],
      [1.3, 0.34],
      [0.001, 0.32],
    ],
    70,
  );
  const geo = lumpify(latheGeometry(profile, 36), 0.035, 1.4, 11);
  const clay = new THREE.Color('#c8704a');
  const rim = new THREE.Color('#d98a5e');
  const inside = new THREE.Color('#8f4d33');
  const bloom = new THREE.Color('#e9dccb');
  potGeometry = paintVertices(geo, (p, n, c) => {
    const radial = (p.x * n.x + p.z * n.z) / Math.max(Math.hypot(p.x, p.z), 1e-3);
    c.copy(clay).lerp(rim, smoothstep(3.0, 3.3, p.y) * 0.8);
    if (radial < -0.2 && p.y > 0.3) c.copy(inside);
    // Salitre: manchas esbranquiçadas de água secando (embaixo e na borda).
    const stain = smoothstep(0.35, 0.6, noise3(p.x * 1.3, p.y * 2.2, p.z * 1.3)) * (1 - smoothstep(0.4, 1.6, p.y) * 0.8);
    c.lerp(bloom, stain * 0.55 * (radial > 0 ? 1 : 0));
    return c.multiplyScalar(0.93 + noise3(p.x * 4, p.y * 4, p.z * 4) * 0.1);
  });
  return potGeometry;
}

/** Terra dentro do vaso (disco encaroçado). */
function potSoil(): THREE.BufferGeometry {
  const g = claySphere(1.78, 3, 0.1, 2, 4);
  g.scale(1, 0.14, 1);
  return paintVertices(g, (p, _n, c) => c.copy(SOIL).lerp(SOIL_LIGHT, smoothstep(-0.2, 0.6, noise3(p.x * 3, 0, p.z * 3))));
}

export type PotContents = 'seedling' | 'label' | 'empty';

/** Vasinho de pé (com muda ou plaquinha) ou tombado (vazio, a terra fica no chão). Devolve o meio da boca (mundo). */
export function buildPot(ctx: SceneryContext, x: number, z: number, yaw: number, contents: PotContents, toppled = false): THREE.Vector3 {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(part(potBody(), 0xffffff, 'matte', 2));
  if (contents !== 'empty') {
    const soil = part(potSoil(), 0xffffff, 'matte', 2);
    soil.position.y = POT_HEIGHT - 0.45;
    body.add(soil);
  }
  if (contents === 'seedling') {
    // Mudinha: caule curto e duas folhas de cotilédone.
    const stem = taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.2, POT_HEIGHT - 0.4, 0), new THREE.Vector3(0.25, POT_HEIGHT + 0.5, 0.05), new THREE.Vector3(0.1, POT_HEIGHT + 1.1, 0)), 8, (t) => 0.08 - t * 0.03, 6);
    body.add(part(stem, '#7fb04f', 'soft'));
    const leafGeo = leafGeometry(1.0, 0.62, { fold: 0.3, curl: 0.3, widest: 0.5, roundTip: 1 });
    for (let i = 0; i < 2; i++) {
      const leaf = part(leafGeo, '#8fc75a', 'soft');
      leaf.position.set(0.1, POT_HEIGHT + 1.05, 0);
      leaf.rotation.set(-0.45, i * Math.PI + 0.4, 0, 'YXZ');
      body.add(leaf);
    }
  } else if (contents === 'label') {
    // Plaquinha de plástico fincada na terra (a etiqueta da muda).
    const stake = part(slab(smoothOutline([[-0.28, 0], [0.28, 0], [0.3, 1.9], [0, 2.2], [-0.3, 1.9]], 20), 0.06, { bevel: 0.025, rings: 2 }), '#f4f1e6', 'glossy');
    stake.rotation.set(-Math.PI / 2 + 0.15, 0.3, 0, 'YXZ');
    stake.position.set(-0.6, POT_HEIGHT - 1.4, 0.4);
    body.add(stake);
  }

  if (toppled) body.rotation.x = Math.PI / 2 - Math.atan((POT_RIM - 1.5) / POT_HEIGHT);
  restOnGround(root, 0.12);
  settle(root, x, z, yaw, 1, 0);

  // Eixo do vaso (fundo → boca) no mundo.
  const q = body.getWorldQuaternion(new THREE.Quaternion());
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const base = body.localToWorld(new THREE.Vector3(0, 0, 0));
  const mouth = body.localToWorld(new THREE.Vector3(0, POT_HEIGHT, 0));
  const middle = base.clone().lerp(mouth, 0.5);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.cylinder(POT_HEIGHT / 2, 1.95), middle, new THREE.Quaternion().setFromUnitVectors(UP, axis));
  ctx.addSolid(middle.x, middle.z, 1.9);
  ctx.addShade(middle.x, middle.z, 2.8, 0.55);
  addObject(ctx, {
    id: 'pot',
    root,
    colliders: [collider],
    probeA: toppled ? base : new THREE.Vector3(x, root.position.y, z),
    probeB: toppled ? mouth : mouth.clone().add(new THREE.Vector3(0, contents === 'seedling' ? 1 : 0, 0)),
    probeRadius: 2.1,
    extent: POT_HEIGHT + 0.4,
    tint: '#c8704a',
  });
  return mouth;
}

/**
 * Terra derramada da boca do vaso tombado: um leque encaroçado no chão e
 * torrões soltos. Enfeite fixo (fica no chão quando a bola leva o vaso).
 */
function buildSpill(ctx: SceneryContext, from: THREE.Vector3, yaw: number): THREE.Vector2 {
  const { rng } = ctx;
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const group = new THREE.Group();
  const lumps = 9;
  for (let i = 0; i < lumps; i++) {
    const t = i / (lumps - 1);
    const spread = (rng.next() - 0.5) * (0.6 + t * 3.2);
    const d = 0.4 + t * 3.6;
    const px = from.x + dx * d + dz * spread;
    const pz = from.z + dz * d - dx * spread;
    const r = rng.range(0.9, 1.5) * (1.2 - t * 0.5);
    const g = claySphere(1, 3, 0.18, 1.6, i);
    paintVertices(g, (p, _n, c) => c.copy(SOIL).lerp(SOIL_LIGHT, smoothstep(-0.3, 0.7, noise3(p.x * 2 + i, p.y * 2, p.z * 2))));
    const lump = part(g, 0xffffff, 'matte', 2);
    lump.scale.set(r, r * rng.range(0.22, 0.34), r * 1.2);
    lump.position.set(px, terrainHeight(px, pz) - r * 0.08, pz);
    lump.rotation.y = yaw + rng.range(-0.4, 0.4);
    group.add(lump);
  }
  // Torrões soltos mais longe.
  for (let i = 0; i < 14; i++) {
    const d = rng.range(1.5, 5.5);
    const spread = rng.range(-2.4, 2.4);
    const px = from.x + dx * d + dz * spread;
    const pz = from.z + dz * d - dx * spread;
    const s = rng.range(0.12, 0.3);
    const clod = part(claySphere(1, 1, 0.2, 2, i), rng.next() < 0.5 ? SOIL : SOIL_LIGHT, 'matte');
    clod.scale.set(s, s * 0.7, s);
    clod.position.set(px, terrainHeight(px, pz) + s * 0.3, pz);
    group.add(clod);
  }
  ctx.batch.addObject(group, { castShadow: true });
  const center = new THREE.Vector2(from.x + dx * 2.3, from.z + dz * 2.3);
  ctx.addCover({ x: center.x, z: center.y, yaw, halfWidth: 2.2, halfLength: 2.8 });
  return center;
}

// --- Pá de jardinagem ------------------------------------------------------------

const BLADE_LENGTH = 6;
let trowelParts: ModelPart[] | null = null;

/**
 * Pá: lâmina de metal em concha (com a nervura no meio e terra na ponta),
 * pescoço dobrado, anel de metal e cabo de madeira envernizado com o furinho de
 * pendurar. Construída com a lâmina para +Z e o cabo para −Z.
 */
function trowelGeometries(): ModelPart[] {
  if (trowelParts) return trowelParts;
  const outline = smoothOutline(
    [
      [0.32, -0.05],
      [1.15, 0.5],
      [1.72, 1.6],
      [1.68, 3.2],
      [1.18, 4.7],
      [0.42, 5.75],
      [0, BLADE_LENGTH],
      [-0.42, 5.75],
      [-1.18, 4.7],
      [-1.68, 3.2],
      [-1.72, 1.6],
      [-1.15, 0.5],
      [-0.32, -0.05],
    ],
    72,
  );
  const blade = warp(
    slab(outline, 0.12, {
      bevel: 0.05,
      rings: 6,
      center: new THREE.Vector2(0, 2.8),
      // Nervura no meio da lâmina, sumindo perto da ponta.
      top: (x, z) => Math.exp(-((x / 0.28) ** 2)) * 0.07 * (1 - smoothstep(1.5, 4.5, z)),
    }),
    (p) => {
      // Concha: as bordas sobem; a ponta levanta um pouquinho.
      p.y += (p.x / 1.7) ** 2 * 0.85 + smoothstep(3.5, BLADE_LENGTH, p.z) * 0.18;
    },
  );
  const steel = new THREE.Color('#9aa7b3');
  const shine = new THREE.Color('#d9e1e8');
  const dirt = new THREE.Color('#6b5040');
  paintVertices(blade, (p, n, c) => {
    c.copy(steel).lerp(shine, smoothstep(1.2, 1.7, Math.abs(p.x)) * 0.6 + Math.max(0, n.y) * 0.1);
    // Terra grudada na ponta e na concha (a pá foi usada).
    const soil = smoothstep(0.1, 0.5, noise3(p.x * 1.6, p.y * 3, p.z * 1.2)) * smoothstep(2.5, 5.5, p.z);
    return c.lerp(dirt, soil * 0.85);
  });

  const neck = taperedTube(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.12, 0.35), new THREE.Vector3(0, 0.3, -0.35), new THREE.Vector3(0, 0.75, -0.9), new THREE.Vector3(0, 0.85, -1.3)]),
    12,
    (t) => 0.2 - t * 0.04,
    8,
  );
  paintVertices(neck, (_p, _n, c) => c.copy(steel).multiplyScalar(0.85));

  const ferrule = new THREE.CylinderGeometry(0.44, 0.4, 0.7, 18);
  ferrule.rotateX(Math.PI / 2);
  ferrule.translate(0, 0.85, -1.55);
  paintVertices(ferrule, (p, _n, c) => c.copy(shine).multiplyScalar(0.8 + Math.abs(Math.sin(p.z * 18)) * 0.12));

  // Cabo: perfil de torno com a pegada mais gorda no meio e a ponta arredondada.
  const handle = latheGeometry(
    smoothProfile(
      [
        [0.36, 0],
        [0.42, 0.4],
        [0.55, 2.0],
        [0.5, 3.4],
        [0.44, 4.2],
        [0.3, 4.55],
        [0.001, 4.6],
      ],
      26,
    ),
    18,
  );
  handle.rotateX(-Math.PI / 2);
  handle.translate(0, 0.85, -1.85);
  const wood = new THREE.Color('#b9773f');
  const grain = new THREE.Color('#8a5328');
  paintVertices(handle, (p, _n, c) => {
    const stripe = Math.sin(p.z * 5 + noise3(p.x * 3, p.y * 3, p.z) * 3) * 0.5 + 0.5;
    c.copy(wood).lerp(grain, stripe * 0.35);
    // Furinho de pendurar na ponta (anel escuro).
    const holeZ = -1.85 - 4.15;
    if (Math.abs(p.z - holeZ) < 0.1 && Math.abs(p.x) < 0.2) c.set('#2c1c12');
    return c;
  });
  trowelParts = [blade, neck, ferrule, handle].map((geometry) => ({ geometry, color: 0xffffff, profile: 'glossy' as const }));
  return trowelParts;
}

/** Pontos do casco da pá (lâmina + cabo), no espaço do corpo. */
const TROWEL_HULL_POINTS = [
  [1.8, 0, 1.4],
  [-1.8, 0, 1.4],
  [1.3, 1.0, 4.6],
  [-1.3, 1.0, 4.6],
  [0, 0.2, BLADE_LENGTH],
  [0.6, 0.1, -0.2],
  [-0.6, 0.1, -0.2],
  [0, 1.4, -6.4],
  [0.55, 0.4, -6.2],
  [-0.55, 0.4, -6.2],
  [0, 1.45, -1.6],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

/**
 * Pá de jardinagem deitada no chão ou fincada (`planted`): a lâmina enterrada
 * na diagonal, com o cabo para cima.
 */
export function buildTrowel(ctx: SceneryContext, x: number, z: number, yaw: number, planted = false): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const p of trowelGeometries()) body.add(part(p.geometry, p.color, p.profile, 2));

  let colliders: RAPIER.Collider[];
  if (planted) {
    // Lâmina para baixo, uns 50° do prumo, com metade enterrada.
    body.rotation.set(Math.PI / 2 + 0.7, 0, 0);
    body.position.set(0, 2.4, 0);
    settle(root, x, z, yaw, 0.3, 0);
    const handleEnd = body.localToWorld(new THREE.Vector3(0, 0.85, -6.4));
    const neck = body.localToWorld(new THREE.Vector3(0, 0.6, -0.6));
    const axis = handleEnd.clone().sub(neck);
    const length = axis.length();
    colliders = [ctx.addCollider(RAPIER.ColliderDesc.capsule(length / 2, 0.6), neck.clone().lerp(handleEnd, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, axis.normalize()))];
  } else {
    restOnGround(root, 0.03);
    settle(root, x, z, yaw, 1, 0);
    colliders = attachHull(ctx, root, TROWEL_HULL_POINTS.map((p) => body.position.clone().add(p)));
  }
  const tip = body.localToWorld(new THREE.Vector3(0, 0.2, BLADE_LENGTH));
  const end = body.localToWorld(new THREE.Vector3(0, 0.85, -6.4));
  ctx.addSolid(x, z, 1.2);
  ctx.addShade(x, z, 3.2, 0.4);
  if (!planted) ctx.addCover({ x, z, yaw, halfWidth: 1.8, halfLength: 3.2 });
  addObject(ctx, {
    id: 'trowel',
    root,
    colliders,
    probeA: tip,
    probeB: end,
    probeRadius: planted ? 1.0 : 1.3,
    extent: BLADE_LENGTH + 6.4,
    tint: '#8fa0ad',
  });
}

// --- Luva ------------------------------------------------------------------------

const GLOVE_ORANGE = new THREE.Color('#e39a3a');
const GLOVE_PALM = new THREE.Color('#b8672c');
const CUFF_GREEN = new THREE.Color('#3f7a4a');
let gloveParts: ModelPart[] | null = null;

/** Tecido: costas laranja, palma emborrachada com bolinhas de aderência. */
function paintFabric(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return paintVertices(geometry, (p, n, c) => {
    if (n.y < -0.25) {
      c.copy(GLOVE_PALM);
      // Bolinhas de borracha na palma.
      if (Math.sin(p.x * 9) * Math.sin(p.z * 9) > 0.55) c.multiplyScalar(0.72);
      return c;
    }
    return c.copy(GLOVE_ORANGE).multiplyScalar(0.92 + noise3(p.x * 5, p.y * 5, p.z * 5) * 0.1);
  });
}

/**
 * Luva de jardinagem deitada com as costas para cima: palma estofada, quatro
 * dedos meio dobrados (as pontas tocam o chão), polegar para o lado e o punho
 * canelado verde (um tubo achatado, aberto). Dedos para +Z, punho para −Z.
 */
function gloveGeometries(): ModelPart[] {
  if (gloveParts) return gloveParts;
  const list: ModelPart[] = [];
  const palmOutline = smoothOutline(
    [
      [-1.75, -1.7],
      [1.75, -1.7],
      [1.95, 0.4],
      [1.8, 1.95],
      [0, 2.15],
      [-1.8, 1.95],
      [-1.95, 0.4],
    ],
    48,
  );
  const palm = warp(slab(palmOutline, 1.0, { bevel: 0.45, rings: 4 }), (p) => {
    // Costas da mão abauladas.
    if (p.y > 0.5) p.y += (1 - (p.x / 1.95) ** 2) * 0.28;
  });
  list.push({ geometry: paintFabric(palm), color: 0xffffff, profile: 'matte' });

  const fingers: Array<[number, number, number]> = [
    [-1.3, 2.3, -0.12],
    [-0.44, 2.75, -0.03],
    [0.44, 2.6, 0.04],
    [1.28, 2.05, 0.14],
  ];
  for (const [fx, length, splay] of fingers) {
    const base = new THREE.Vector3(fx, 0.5, 1.8);
    const dir = new THREE.Vector3(Math.sin(splay), 0, Math.cos(splay));
    const curve = new THREE.CatmullRomCurve3([
      base,
      base.clone().addScaledVector(dir, length * 0.5).setY(0.55),
      base.clone().addScaledVector(dir, length).setY(0.36),
    ]);
    const finger = taperedTube(curve, 12, (t) => 0.44 - t * 0.06, 10);
    finger.scale(1, 0.82, 1);
    const tipCap = claySphere(0.38, 2, 0.03);
    const end = curve.getPoint(1);
    tipCap.scale(1, 0.82, 1);
    tipCap.translate(end.x, end.y * 0.82, end.z);
    list.push({ geometry: paintFabric(finger), color: 0xffffff, profile: 'matte' }, { geometry: paintFabric(tipCap), color: 0xffffff, profile: 'matte' });
  }
  const thumbCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(1.7, 0.5, 0.2), new THREE.Vector3(2.5, 0.5, 0.9), new THREE.Vector3(2.9, 0.38, 1.9)]);
  const thumb = taperedTube(thumbCurve, 10, (t) => 0.5 - t * 0.08, 10);
  thumb.scale(1, 0.85, 1);
  const thumbTip = claySphere(0.42, 2, 0.03);
  thumbTip.scale(1, 0.85, 1);
  thumbTip.translate(2.9, 0.38 * 0.85, 1.9);
  list.push({ geometry: paintFabric(thumb), color: 0xffffff, profile: 'matte' }, { geometry: paintFabric(thumbTip), color: 0xffffff, profile: 'matte' });

  // Punho: anel grosso (perfil fechado) deitado ao longo de Z e achatado.
  const cuff = latheGeometry(
    [
      [1.72, 0],
      [1.95, 0],
      [2.02, 1.1],
      [2.1, 2.2],
      [1.9, 2.25],
      [1.82, 1.1],
      [1.72, 0.05],
    ],
    28,
  );
  cuff.rotateX(-Math.PI / 2);
  cuff.scale(1, 0.42, 1);
  cuff.translate(0, 0.72, -1.4);
  paintVertices(cuff, (p, _n, c) => {
    // Canelado do elástico.
    c.copy(CUFF_GREEN).multiplyScalar(0.85 + Math.max(0, Math.sin(Math.atan2(p.y - 0.72, p.x) * 22)) * 0.25);
    return p.z < -3.4 ? c.lerp(new THREE.Color('#f1e6c8'), 0.7) : c;
  });
  list.push({ geometry: cuff, color: 0xffffff, profile: 'soft' });
  gloveParts = list;
  return list;
}

/** Luva largada: com as costas para cima ou virada (palma emborrachada para cima). */
export function buildGlove(ctx: SceneryContext, x: number, z: number, yaw: number, palmUp = false): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const p of gloveGeometries()) body.add(part(p.geometry, p.color, p.profile, 2));
  if (palmUp) body.rotation.z = Math.PI;
  restOnGround(root, 0.06);
  settle(root, x, z, yaw, 1, 0);

  const h = 1.3;
  const hull = [
    [-2, 0, -3.7],
    [2, 0, -3.7],
    [-2, h, -3.7],
    [2, h, -3.7],
    [-2.1, 0, 2],
    [2.1, 0, 2],
    [-1.8, h, 1.8],
    [1.8, h, 1.8],
    [3.3, 0, 2.1],
    [3.1, 0.7, 1.9],
    [-1.4, 0, 4.4],
    [0.9, 0, 4.7],
    [-0.6, 0.8, 4.2],
  ].map(([px, py, pz]) => new THREE.Vector3(palmUp ? -px : px, py, pz));
  const colliders = attachHull(ctx, root, hull);
  ctx.addShade(x, z, 3.6, 0.45);
  ctx.addCover({ x, z, yaw, halfWidth: 2.4, halfLength: 4.2 });
  addObject(ctx, {
    id: 'glove',
    root,
    colliders,
    probeA: toWorld(root, 0, 0.6, -3.2),
    probeB: toWorld(root, 0, 0.6, 3.6),
    probeRadius: 2.0,
    extent: 8.6,
    tint: GLOVE_ORANGE,
  });
}

// --- Chinelo de dedo -------------------------------------------------------------

const SOLE_THICKNESS = 0.75;
const FLIPFLOP_GREEN = new THREE.Color('#3aa36a');
const TREAD_GREEN = new THREE.Color('#2f8f5a');
let flipflopParts: THREE.BufferGeometry[] | null = null;

/** Pegada gasta: calcanhar, planta e dedos marcados mais escuros (e afundados). */
const footprint = (x: number, z: number): number => {
  const heel = Math.exp(-(((x - 0.05) / 1.05) ** 2 + ((z + 3.3) / 1.2) ** 2));
  const ball = Math.exp(-(((x - 0.25) / 1.3) ** 2 + ((z - 1.9) / 1.2) ** 2));
  let toes = 0;
  for (const [tx, tz, r] of [[0.9, 4.0, 0.42], [0.0, 4.3, 0.34], [-0.62, 4.05, 0.3], [-1.1, 3.6, 0.27], [-1.4, 3.05, 0.24]]) {
    toes = Math.max(toes, Math.exp(-(((x - tx) / r) ** 2 + ((z - tz) / r) ** 2)));
  }
  return Math.min(1, heel + ball * 0.8 + toes * 0.8);
};

/**
 * Chinelo de dedo (pé esquerdo; o direito é o espelho): sola grossa em três
 * camadas (verde, faixa branca, verde), pegada gasta, tiras em "V" saindo do
 * pino entre os dedos. Bico para +Z.
 */
function flipflopGeometries(): THREE.BufferGeometry[] {
  if (flipflopParts) return flipflopParts;
  const outline = smoothOutline(
    [
      [0.2, 5.0],
      [1.3, 4.6],
      [1.95, 3.4],
      [2.0, 2.0],
      [1.65, 0.1],
      [1.45, -1.6],
      [1.6, -3.3],
      [1.25, -4.6],
      [0, -5.05],
      [-1.3, -4.6],
      [-1.6, -3.3],
      [-1.35, -1.6],
      [-1.45, 0.2],
      [-1.8, 2.2],
      [-1.6, 3.9],
      [-0.8, 4.8],
    ],
    96,
  );
  const sole = slab(outline, SOLE_THICKNESS, {
    bevel: 0.2,
    rings: 10,
    bottomRings: 2,
    wallRows: 6,
    center: new THREE.Vector2(0.1, 0),
    top: (x, z) => -footprint(x, z) * 0.08,
  });
  paintVertices(sole, (p, n, c) => {
    if (n.y > 0.55) return c.copy(FLIPFLOP_GREEN).lerp(new THREE.Color('#237a4c'), footprint(p.x, p.z) * 0.6);
    if (n.y < -0.55) return c.copy(TREAD_GREEN).multiplyScalar(0.8 + (Math.sin(p.x * 6 + p.z * 6) > 0.6 ? 0.15 : 0));
    // Lateral: camada de baixo verde, faixa branca no meio, camada de cima verde.
    if (p.y < 0.26) return c.copy(TREAD_GREEN);
    if (p.y < 0.5) return c.set('#f3efe4');
    return c.copy(FLIPFLOP_GREEN);
  });

  // Tiras: do pino (entre o dedão e o segundo dedo) até as laterais, arqueando por cima do peito do pé.
  const post = new THREE.Vector3(0.45, SOLE_THICKNESS + 0.28, 3.55);
  const strapUp = (_t: number, p: THREE.Vector3) => new THREE.Vector3(p.x - 0.1, p.y - 0.3, 0).normalize();
  const straps = [1, -1].map((side) =>
    sweep(new THREE.CatmullRomCurve3([post, new THREE.Vector3(side * 0.95 + 0.2, SOLE_THICKNESS + 1.35, 1.6), new THREE.Vector3(side * 1.45, SOLE_THICKNESS + 0.1, -0.4)]), {
      section: roundedRectSection(0.62, 0.18),
      segments: 16,
      upAt: strapUp,
    }),
  );
  const pin = new THREE.CylinderGeometry(0.13, 0.16, 0.4, 10);
  pin.translate(post.x, SOLE_THICKNESS + 0.12, post.z);
  const cap = claySphere(0.22, 2, 0.02);
  cap.scale(1, 0.6, 1);
  cap.translate(post.x, post.y + 0.02, post.z);
  const plugs = [1, -1].map((side) => {
    const g = claySphere(0.24, 2, 0.02);
    g.scale(1, 0.55, 1.3);
    g.translate(side * 1.4, SOLE_THICKNESS + 0.08, -0.4);
    return g;
  });
  const strapColor = new THREE.Color('#277d4f');
  for (const g of [...straps, pin, cap, ...plugs]) paintVertices(g, (_p, n, c) => c.copy(strapColor).multiplyScalar(0.9 + Math.max(0, n.y) * 0.15));
  flipflopParts = [sole, ...straps, pin, cap, ...plugs];
  return flipflopParts;
}

export function buildFlipflop(ctx: SceneryContext, x: number, z: number, yaw: number, right: boolean): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const g of flipflopGeometries()) body.add(part(g, 0xffffff, 'soft', 2));
  if (right) body.scale.x = -1;
  restOnGround(root, 0.05);
  settle(root, x, z, yaw, 1, 0);

  const flip = right ? -1 : 1;
  const soleHull = [
    [2.0, 0, 2.2],
    [-1.8, 0, 2.2],
    [1.3, 0, 4.7],
    [-0.9, 0, 4.8],
    [1.6, 0, -3.3],
    [-1.6, 0, -3.3],
    [0, 0, -5.0],
    [2.0, SOLE_THICKNESS, 2.2],
    [-1.8, SOLE_THICKNESS, 2.2],
    [1.3, SOLE_THICKNESS, 4.7],
    [-0.9, SOLE_THICKNESS, 4.8],
    [1.6, SOLE_THICKNESS, -3.3],
    [-1.6, SOLE_THICKNESS, -3.3],
    [0, SOLE_THICKNESS, -5.0],
  ].map(([px, py, pz]) => new THREE.Vector3(px * flip, py, pz));
  const strapHull = [
    [0.45, SOLE_THICKNESS, 3.6],
    [1.5, SOLE_THICKNESS, -0.4],
    [-1.5, SOLE_THICKNESS, -0.4],
    [0.2, SOLE_THICKNESS + 1.5, 1.6],
    [1.1, SOLE_THICKNESS + 1.3, 1.4],
    [-0.8, SOLE_THICKNESS + 1.3, 1.4],
  ].map(([px, py, pz]) => new THREE.Vector3(px * flip, py, pz));
  const colliders = [...attachHull(ctx, root, soleHull), ...attachHull(ctx, root, strapHull)];
  ctx.addShade(x, z, 3.6, 0.35);
  ctx.addCover({ x, z, yaw, halfWidth: 2.1, halfLength: 5.1 });
  addObject(ctx, {
    id: 'flipflop',
    root,
    colliders,
    probeA: toWorld(root, 0, 0.5, -4.2),
    probeB: toWorld(root, 0, 0.5, 4.2),
    probeRadius: 2.0,
    extent: 10.2,
    tint: TREAD_GREEN,
  });
}

// --- A cena ----------------------------------------------------------------------

/**
 * Monta o cantinho: o anão no fundo, olhando para quem chega; vasos à esquerda
 * (um tombado, com a pá fincada na terra derramada); luvas, a outra pá e o par
 * de chinelos espalhados pela frente e pela direita.
 */
export function buildGardenerCorner(ctx: SceneryContext, zone: ZoneSite): void {
  const frame = zoneFrame(zone);
  const at = (across: number, along: number) => frame.point(across, along);

  const gnome = at(0, -6);
  buildGnome(ctx, gnome.x, gnome.y, frame.yaw(-0.12));

  const potA = at(-5.5, -7);
  buildPot(ctx, potA.x, potA.y, frame.yaw(0.3), 'seedling');
  const potB = at(-8.6, -3.6);
  buildPot(ctx, potB.x, potB.y, frame.yaw(1.1), 'label');
  // Tombado à esquerda, com a boca virada para quem chega; a terra escorre dali e a pá ficou fincada nela.
  const spillYaw = frame.yaw(0.2);
  const potC = at(-10.4, -0.6);
  const mouth = buildPot(ctx, potC.x, potC.y, spillYaw, 'empty', true);
  const spill = buildSpill(ctx, mouth, spillYaw);
  buildTrowel(ctx, spill.x + Math.sin(spillYaw) * 0.6, spill.y + Math.cos(spillYaw) * 0.6, spillYaw + Math.PI, true);

  // Pá deitada atravessando o meio (lâmina para a direita).
  const trowel = at(1, 0);
  buildTrowel(ctx, trowel.x, trowel.y, frame.yaw(Math.PI / 2 - 0.3));

  // Luva com os dedos apontando para quem chega, entre a terra derramada e os chinelos.
  const gloveA = at(-3.2, 8.2);
  buildGlove(ctx, gloveA.x, gloveA.y, frame.yaw(0.2));
  const gloveB = at(8, -5);
  buildGlove(ctx, gloveB.x, gloveB.y, frame.yaw(-0.6), true);

  // O par de chinelos largado lado a lado, um meio torto.
  const left = at(2.4, 7.8);
  buildFlipflop(ctx, left.x, left.y, frame.yaw(0.15), false);
  const right = at(8, 6);
  buildFlipflop(ctx, right.x, right.y, frame.yaw(-0.15), true);
}

