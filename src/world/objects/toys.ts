import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RAPIER } from '../../core/Physics';
import { claySphere, paintVertices, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { smoothstep } from '../../utils/math';
import { PUDDLES } from '../Terrain';
import { latheGeometry, smoothProfile } from '../scenery/shapes';
import type { SceneryContext } from '../scenery/context';
import type { ZoneSite } from '../zones';
import { addObject, attachCollider, restOnGround, settle, toWorld, zoneFrame, type ModelPart } from './common';
import { Footprints, type LostItem } from './compose';
import { polarOutline, slab, warp } from './forms';

/**
 * Cantinho dos brinquedos: soldadinhos verdes (alguns caídos), carrinhos (de pé,
 * capotados, de lado), patinhos de borracha (um na beira da poça) e o lugar das
 * bolas de tênis (que são soltas, com física: ver `LooseObjects`).
 */

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// --- Soldadinho -----------------------------------------------------------------

const ARMY_GREEN = '#5c8c3a';
const SOLDIER_HEIGHT = 2.5;

interface SoldierPose {
  /** Quadril → joelho → pé de cada perna. */
  legs: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]>;
  /** Ombro → cotovelo → mão de cada braço. */
  arms: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]>;
  /** Coronha → cano do fuzil. */
  rifle: [THREE.Vector3, THREE.Vector3];
  /** Inclinação do tronco para a frente. */
  lean: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Dois jeitos clássicos de soldadinho: mirando e avançando com o fuzil cruzado. */
const SoldierPoses: SoldierPose[] = [
  {
    legs: [
      [v(-0.13, 1.02, 0), v(-0.15, 0.58, 0.2), v(-0.15, 0.14, 0.3)],
      [v(0.13, 1.02, 0), v(0.15, 0.56, -0.08), v(0.16, 0.14, -0.26)],
    ],
    arms: [
      [v(0.25, 1.7, 0), v(0.34, 1.44, 0.2), v(0.12, 1.6, 0.2)],
      [v(-0.25, 1.7, 0), v(-0.2, 1.48, 0.36), v(0.06, 1.6, 0.58)],
    ],
    rifle: [v(0.12, 1.68, -0.22), v(0.1, 1.62, 1.0)],
    lean: 0.05,
  },
  {
    legs: [
      [v(-0.13, 1.0, 0), v(-0.14, 0.62, 0.3), v(-0.14, 0.14, 0.34)],
      [v(0.13, 1.0, 0), v(0.16, 0.5, -0.22), v(0.18, 0.14, -0.4)],
    ],
    arms: [
      [v(0.25, 1.7, 0), v(0.36, 1.4, 0.16), v(0.26, 1.22, 0.36)],
      [v(-0.25, 1.7, 0), v(-0.3, 1.52, 0.22), v(-0.2, 1.78, 0.4)],
    ],
    rifle: [v(0.36, 1.08, 0.3), v(-0.36, 2.02, 0.44)],
    lean: 0.18,
  },
];

const soldierParts = new Map<number, THREE.BufferGeometry[]>();

/** Peças de um soldadinho numa pose (tudo verde: é um brinquedo de plástico de uma cor só). */
function soldierGeometries(poseIndex: number): THREE.BufferGeometry[] {
  const cached = soldierParts.get(poseIndex);
  if (cached) return cached;
  const pose = SoldierPoses[poseIndex];
  const parts: THREE.BufferGeometry[] = [];
  // Base oval (o "chãozinho" que todo soldadinho tem).
  parts.push(slab(polarOutline(28, (a) => 0.56 / Math.hypot(Math.cos(a), Math.sin(a) * 1.3)), 0.09, { bevel: 0.035, rings: 2 }));

  const limb = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number) =>
    taperedTube(new THREE.CatmullRomCurve3([a, b, c]), 10, (t) => r0 + (r1 - r0) * t, 8);
  for (const [hip, knee, foot] of pose.legs) {
    parts.push(limb(hip, knee, foot, 0.13, 0.1));
    const boot = claySphere(1, 2, 0.05);
    boot.scale(0.12, 0.09, 0.2);
    boot.translate(foot.x, 0.14, foot.z + 0.05);
    parts.push(boot);
  }

  // Tronco (achatado de frente para trás), cinto e mochila.
  const torso = latheGeometry(
    smoothProfile(
      [
        [0.001, 0.92],
        [0.19, 0.96],
        [0.23, 1.25],
        [0.25, 1.52],
        [0.2, 1.76],
        [0.08, 1.84],
        [0.001, 1.85],
      ],
      14,
    ),
    14,
  );
  torso.scale(1, 1, 0.78);
  parts.push(torso);
  const belt = new THREE.TorusGeometry(0.21, 0.035, 5, 16);
  belt.rotateX(Math.PI / 2);
  belt.scale(1, 1, 0.8);
  belt.translate(0, 1.04, 0);
  parts.push(belt);
  const pack = new RoundedBoxGeometry(0.34, 0.38, 0.16, 2, 0.06);
  pack.translate(0, 1.42, -0.22);
  parts.push(pack);

  // Cabeça e capacete com aba.
  const head = claySphere(0.16, 2, 0.04);
  head.translate(0, 1.99, 0.02);
  parts.push(head);
  const helmet = latheGeometry(
    smoothProfile(
      // De baixo (aba) para cima (topo): o torno precisa desse sentido para as faces saírem para fora.
      [
        [0.18, -0.02],
        [0.24, -0.04],
        [0.26, -0.02],
        [0.22, 0.02],
        [0.2, 0.12],
        [0.12, 0.2],
        [0.001, 0.22],
      ],
      12,
    ),
    16,
  );
  helmet.translate(0, 2.04, 0.0);
  parts.push(helmet);

  for (const [shoulder, elbow, hand] of pose.arms) {
    parts.push(limb(shoulder, elbow, hand, 0.085, 0.07));
    const fist = claySphere(0.075, 1, 0.05);
    fist.translate(hand.x, hand.y, hand.z);
    parts.push(fist);
  }

  // Fuzil: corpo com coronha e um cano fino.
  const [stock, muzzle] = pose.rifle;
  const dir = muzzle.clone().sub(stock);
  const length = dir.length();
  const body = new RoundedBoxGeometry(0.09, 0.14, length * 0.62, 2, 0.03);
  body.translate(0, 0, length * 0.31);
  const barrel = new THREE.CylinderGeometry(0.03, 0.03, length * 0.42, 6);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0.02, length * 0.79);
  const magazine = new RoundedBoxGeometry(0.06, 0.16, 0.08, 1, 0.02);
  magazine.translate(0, -0.12, length * 0.4);
  const rifleQuat = new THREE.Quaternion().setFromUnitVectors(AXIS_Z, dir.normalize());
  for (const g of [body, barrel, magazine]) {
    g.applyQuaternion(rifleQuat);
    g.translate(stock.x, stock.y, stock.z);
    parts.push(g);
  }

  // Tudo o que é do corpo inclina junto (menos a base e as pernas, que ficam no chão).
  const bodyParts = parts.slice(5);
  const leanQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.lean);
  for (const g of bodyParts) {
    g.translate(0, -1.0, 0);
    g.applyQuaternion(leanQuat);
    g.translate(0, 1.0, 0);
  }
  for (const g of parts) if (!g.getAttribute('normal')) g.computeVertexNormals();
  soldierParts.set(poseIndex, parts);
  return parts;
}

/**
 * Soldadinho de plástico verde numa pose. `fallen` = tombado de lado (base em pé,
 * ele deitado no chão, como quem levou um peteleco).
 */
export function buildSoldier(ctx: SceneryContext, x: number, z: number, yaw: number, pose: number, fallen = false): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const g of soldierGeometries(pose % SoldierPoses.length)) body.add(part(g, ARMY_GREEN, 'glossy'));

  if (fallen) body.rotation.set(0, 0, Math.PI / 2 - 0.08);
  restOnGround(root, 0.02);
  settle(root, x, z, yaw, fallen ? 1 : 0.35, 0);

  // Eixo do corpo (do pé à cabeça) no mundo: em pé é o vertical; caído, deitado.
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
  const foot = body.localToWorld(new THREE.Vector3(0, 0.1, 0));
  const headTop = body.localToWorld(new THREE.Vector3(0, SOLDIER_HEIGHT, 0));
  const middle = foot.clone().lerp(headTop, 0.5);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.capsule(SOLDIER_HEIGHT * 0.32, 0.42), middle, new THREE.Quaternion().setFromUnitVectors(UP, axis));
  ctx.addSolid(middle.x, middle.z, 0.45);
  addObject(ctx, {
    id: 'soldier',
    root,
    colliders: [collider],
    probeA: foot,
    probeB: headTop,
    probeRadius: 0.55,
    extent: SOLDIER_HEIGHT,
    tint: ARMY_GREEN,
  });
}

// --- Carrinho -------------------------------------------------------------------

const CAR_RED = '#d8332d';
const CAR_LENGTH = 3.8;
let carParts: ModelPart[] | null = null;

/** Carrinho de corrida de metal (miniatura): carroceria vermelha, vidros escuros, listra e rodas. */
function carGeometries(): ModelPart[] {
  if (carParts) return carParts;
  const list: ModelPart[] = [];
  const add = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, profile: ModelPart['profile'] = 'glossy') => list.push({ geometry, color, profile });

  const lower = new RoundedBoxGeometry(1.7, 0.56, CAR_LENGTH, 4, 0.22);
  lower.translate(0, 0.62, 0);
  // Capô um pouco mais baixo na frente (perfil de carro esporte).
  warp(lower, (p) => {
    if (p.y > 0.62) p.y -= smoothstep(0.6, 1.9, p.z) * 0.12;
  });
  add(lower, CAR_RED);
  const glass = new RoundedBoxGeometry(1.4, 0.4, 1.7, 3, 0.16);
  glass.translate(0, 1.02, -0.3);
  warp(glass, (p) => {
    // Para-brisa inclinado: a frente do vidro recua conforme sobe.
    if (p.z > -0.3) p.z -= smoothstep(0.84, 1.22, p.y) * 0.35 * smoothstep(-0.3, 0.55, p.z);
  });
  add(glass, '#2c3b4e');
  const roof = new RoundedBoxGeometry(1.36, 0.12, 1.3, 2, 0.05);
  roof.translate(0, 1.23, -0.45);
  add(roof, CAR_RED);
  // Listra branca de corrida no capô, no teto e na tampa de trás.
  const stripe = new THREE.BoxGeometry(0.32, 0.02, 1.2);
  stripe.translate(0, 0.83, 1.2);
  add(stripe, '#f4f1ea');
  const roofStripe = new THREE.BoxGeometry(0.32, 0.02, 1.2);
  roofStripe.translate(0, 1.29, -0.45);
  add(roofStripe, '#f4f1ea');
  // Círculo do número nas portas.
  for (const side of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 20);
    disc.rotateZ(Math.PI / 2);
    disc.translate(side * 0.86, 0.66, -0.1);
    add(disc, '#f4f1ea');
  }
  // Faróis, lanternas e para-choques.
  for (const side of [-1, 1]) {
    const lamp = claySphere(0.13, 1, 0.02);
    lamp.scale(1, 0.7, 0.5);
    lamp.translate(side * 0.55, 0.66, CAR_LENGTH / 2 - 0.02);
    add(lamp, '#fff4c2');
    const tail = new THREE.BoxGeometry(0.34, 0.12, 0.06);
    tail.translate(side * 0.55, 0.72, -CAR_LENGTH / 2 + 0.01);
    add(tail, '#8a1414');
  }
  for (const end of [-1, 1]) {
    const bumper = new RoundedBoxGeometry(1.6, 0.14, 0.12, 2, 0.05);
    bumper.translate(0, 0.42, end * (CAR_LENGTH / 2 + 0.02));
    add(bumper, '#c8ccd2');
  }
  // Rodas: pneu preto e calota prateada para fora.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tire = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 18);
      tire.rotateZ(Math.PI / 2);
      tire.translate(sx * 0.78, 0.38, sz * 1.18);
      add(tire, '#262422', 'matte');
      const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12);
      hub.rotateZ(Math.PI / 2);
      hub.translate(sx * 0.95, 0.38, sz * 1.18);
      add(hub, '#d4d8de');
    }
  }
  carParts = list;
  return list;
}

export type CarPose = 'upright' | 'upsideDown' | 'onSide';

/** Carrinho vermelho: em pé, capotado (rodas para cima) ou de lado. */
export function buildToyCar(ctx: SceneryContext, x: number, z: number, yaw: number, pose: CarPose): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const p of carGeometries()) body.add(part(p.geometry, p.color, p.profile));
  if (pose === 'upsideDown') body.rotation.z = Math.PI;
  else if (pose === 'onSide') body.rotation.z = Math.PI / 2;
  restOnGround(root, 0.02);
  settle(root, x, z, yaw, 1, 0);

  const box = new THREE.Box3().setFromObject(body, true);
  const center = box.getCenter(new THREE.Vector3());
  const collider = ctx.addCollider(
    RAPIER.ColliderDesc.cuboid(pose === 'onSide' ? 0.68 : 0.86, pose === 'onSide' ? 0.86 : 0.64, CAR_LENGTH / 2),
    center,
    root.quaternion,
  );
  ctx.addSolid(x, z, 0.9);
  ctx.addShade(x, z, 2.1, 0.45);
  const axis = new THREE.Vector3(0, 0, CAR_LENGTH * 0.36).applyQuaternion(root.quaternion);
  addObject(ctx, {
    id: 'toyCar',
    root,
    colliders: [collider],
    probeA: center.clone().sub(axis),
    probeB: center.clone().add(axis),
    probeRadius: 1.0,
    extent: CAR_LENGTH,
    tint: CAR_RED,
  });
}

// --- Patinho de borracha --------------------------------------------------------

const DUCK_YELLOW = '#f6c93b';
let duckParts: ModelPart[] | null = null;

/** Patinho: corpo com o rabinho arrebitado, cabeça redonda, bico laranja, olhos com brilho e asinhas. */
function duckGeometries(): ModelPart[] {
  if (duckParts) return duckParts;
  const list: ModelPart[] = [];
  const body = warp(claySphere(1, 4, 0.02, 2, 3), (p) => {
    // Rabinho: a traseira sobe e afina; a barriga fica chata (boia de pé).
    const tail = Math.max(0, -p.z - 0.25);
    p.y += tail * tail * 0.75;
    p.x *= 1 - tail * 0.35;
    if (p.y < -0.55) p.y = -0.55 + (p.y + 0.55) * 0.25;
  });
  body.scale(1.3, 0.95, 1.7);
  body.translate(0, 1.0, -0.2);
  paintVertices(body, (p, _n, c) => c.set(DUCK_YELLOW).multiplyScalar(0.9 + smoothstep(0.4, 1.8, p.y) * 0.12));
  list.push({ geometry: body, color: 0xffffff, profile: 'glossy' });

  const head = claySphere(0.88, 4, 0.02, 2, 5);
  head.translate(0, 2.2, 0.72);
  list.push({ geometry: head, color: DUCK_YELLOW, profile: 'glossy' });

  // Bico: duas "folhas" gordinhas, a de cima maior (um sorrisinho).
  const upper = claySphere(1, 3, 0.02);
  upper.scale(0.42, 0.16, 0.5);
  upper.translate(0, 2.02, 1.52);
  list.push({ geometry: upper, color: '#f08a24', profile: 'glossy' });
  const lower = claySphere(1, 3, 0.02);
  lower.scale(0.34, 0.1, 0.38);
  lower.translate(0, 1.86, 1.44);
  list.push({ geometry: lower, color: '#e0701c', profile: 'glossy' });

  for (const side of [-1, 1]) {
    const eye = claySphere(0.14, 2, 0.02);
    eye.scale(1, 1.15, 0.7);
    eye.translate(side * 0.42, 2.42, 1.4);
    list.push({ geometry: eye, color: '#1d1a1a', profile: 'glossy' });
    const glint = claySphere(0.045, 1, 0);
    glint.translate(side * 0.44, 2.48, 1.5);
    list.push({ geometry: glint, color: '#ffffff', profile: 'glossy' });
    const wing = claySphere(1, 3, 0.03, 2, side);
    wing.scale(0.22, 0.52, 0.85);
    wing.rotateX(-0.35);
    wing.translate(side * 1.22, 1.25, -0.35);
    list.push({ geometry: wing, color: '#f0bb2c', profile: 'glossy' });
  }
  duckParts = list;
  return list;
}

/** Patinho de borracha amarelo, sentado no chão. */
export function buildDuck(ctx: SceneryContext, x: number, z: number, yaw: number): void {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const p of duckGeometries()) body.add(part(p.geometry, p.color, p.profile, 2));
  body.rotation.x = -0.06;
  restOnGround(root, 0.08);
  settle(root, x, z, yaw, 0.6, 0);

  const colliders = [
    attachCollider(ctx, root, RAPIER.ColliderDesc.ball(1.25), new THREE.Vector3(0, 1.05, -0.2)),
    attachCollider(ctx, root, RAPIER.ColliderDesc.ball(0.85), new THREE.Vector3(0, 2.2, 0.72)),
  ];
  ctx.addSolid(x, z, 1.2);
  ctx.addShade(x, z, 2.0, 0.4);
  const spot = ctx.addLandingSpot(toWorld(root, 0, 3.1, 0.7));
  addObject(ctx, {
    id: 'duck',
    root,
    colliders,
    probeA: toWorld(root, 0, 0.1, -0.2),
    probeB: toWorld(root, 0, 2.3, 0.5),
    probeRadius: 1.3,
    extent: 4.2,
    tint: DUCK_YELLOW,
    landingSpots: [spot],
  });
}

// --- A cena ---------------------------------------------------------------------

/** Quantos de cada brinquedo o cantinho tem (somando os que ficam perdidos pelo jardim). */
const SOLDIERS = 6;
const CARS = 3;
const TENNIS_BALLS = 2;
/** Chance de um brinquedo ter ficado esquecido longe do cantinho (vai para `lost`). */
const FORGOTTEN_CHANCE = 0.6;
/** Carrinho no chão: meio-comprimento e meia-largura (ocupa uma cápsula). */
const CAR_FOOTPRINT = { halfLength: CAR_LENGTH / 2, radius: 1.1 };

/** Pose sorteada de um carrinho largado (a maioria em pé). */
function randomCarPose(rng: SceneryContext['rng']): CarPose {
  const roll = rng.next();
  return roll < 0.6 ? 'upright' : roll < 0.85 ? 'upsideDown' : 'onSide';
}

/**
 * Poça mais perto do cantinho (onde vai o patinho "nadador"), se estiver a uma
 * distância razoável; senão os dois patinhos ficam no cantinho.
 */
function puddleForDuck(zone: ZoneSite): THREE.Vector2 | null {
  let best: THREE.Vector2 | null = null;
  let bestDistance = 34;
  for (const p of PUDDLES) {
    const d = Math.hypot(p.x - zone.x, p.z - zone.z);
    if (d >= bestDistance) continue;
    bestDistance = d;
    // Na borda da bacia, do lado virado para o cantinho.
    const k = (p.radius * 1.02) / Math.max(d, 1e-3);
    best = new THREE.Vector2(p.x + (zone.x - p.x) * k, p.z + (zone.z - p.z) * k);
  }
  return best;
}

/**
 * Monta o cantinho, sorteado a cada jardim e com folga entre as coisas (bagunça
 * de criança largada, não vitrine): soldadinhos em grupinhos de 1 a 3 (alguns
 * caídos), carrinhos em poses soltas, um patinho no cantinho e outro na beira
 * da poça mais perto. Às vezes um brinquedo ficou esquecido longe daqui (entra
 * em `lost`). Devolve onde as bolas de tênis (soltas, com física) começam.
 * Um passo (`yield`) por objeto.
 */
export function* buildToyCorner(ctx: SceneryContext, zone: ZoneSite, lost: LostItem[]): Generator<void, THREE.Vector2[]> {
  const { rng } = ctx;
  const frame = zoneFrame(zone);
  const taken = new Footprints(zone);

  let soldiers = SOLDIERS;
  let cars = CARS;
  if (rng.next() < FORGOTTEN_CHANCE) {
    const forgotten: LostItem = rng.next() < 0.6 ? 'soldier' : 'toyCar';
    lost.push(forgotten);
    if (forgotten === 'soldier') soldiers--;
    else cars--;
  }

  // Bolas de tênis primeiro (rolam: precisam de chão livre em volta).
  const tennis: THREE.Vector2[] = [];
  for (let i = 0; i < TENNIS_BALLS; i++) {
    const p = taken.spot(rng, 1.9, { gap: 1.2 });
    if (p) tennis.push(p);
  }

  for (let i = 0; i < cars; i++) {
    const yaw = rng.range(0, Math.PI * 2);
    const p = taken.spot(rng, CAR_FOOTPRINT.radius, { gap: 1.4, capsule: { yaw, halfLength: CAR_FOOTPRINT.halfLength } });
    if (!p) continue;
    buildToyCar(ctx, p.x, p.y, yaw, randomCarPose(rng));
    yield;
  }

  // Soldadinhos em grupinhos (um pelotão desfeito): o primeiro sorteia o lugar, os outros ficam por perto.
  let left = soldiers;
  while (left > 0) {
    const group = Math.min(left, 1 + Math.floor(rng.next() * 3));
    left -= group;
    const anchor = taken.spot(rng, 0.6, { gap: 1.6 });
    if (!anchor) continue;
    const heading = frame.yaw(rng.range(-0.6, 0.6));
    for (let k = 0; k < group; k++) {
      const fallen = rng.next() < 0.25;
      let x = anchor.x;
      let z = anchor.y;
      if (k > 0) {
        let placed = false;
        for (let tries = 0; tries < 12 && !placed; tries++) {
          const a = rng.next() * Math.PI * 2;
          const d = rng.range(1.3, 2.4);
          x = anchor.x + Math.cos(a) * d;
          z = anchor.y + Math.sin(a) * d;
          placed = taken.fits(x, z, 0.6, 0.3) && Math.hypot(x - zone.x, z - zone.z) < zone.radius - 1;
        }
        if (!placed) continue;
        taken.add(x, z, 0.6);
      }
      buildSoldier(ctx, x, z, fallen ? rng.range(0, Math.PI * 2) : heading + rng.range(-0.35, 0.35), Math.floor(rng.next() * SoldierPoses.length), fallen);
      yield;
    }
  }

  const inZone = taken.spot(rng, 1.4, { gap: 1 });
  if (inZone) {
    buildDuck(ctx, inZone.x, inZone.y, frame.yaw(rng.range(-0.8, 0.8)));
    yield;
  }
  const byPuddle = puddleForDuck(zone);
  if (byPuddle) {
    // O patinho da poça olha para a água.
    const puddle = PUDDLES.reduce((a, b) => (Math.hypot(a.x - byPuddle.x, a.z - byPuddle.y) < Math.hypot(b.x - byPuddle.x, b.z - byPuddle.y) ? a : b));
    buildDuck(ctx, byPuddle.x, byPuddle.y, Math.atan2(puddle.x - byPuddle.x, puddle.z - byPuddle.y));
    // Fora do cantinho: reserva o chão para a natureza não nascer em cima dele.
    ctx.reserve(byPuddle.x, byPuddle.y, 1.6);
  } else {
    const p = taken.spot(rng, 1.4, { gap: 1 });
    if (p) buildDuck(ctx, p.x, p.y, frame.yaw(rng.range(-0.8, 0.8)));
  }
  return tennis;
}
