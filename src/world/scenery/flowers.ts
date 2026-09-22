import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, paintVertices, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import type { Rng } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import { latheGeometry, leafGeometry, smoothProfile } from './shapes';
import { sphereVolume, type SceneryContext } from './context';

export type FlowerKind = 'daisy' | 'tulip' | 'bell' | 'dandelion' | 'clover';

const DaisyPetals = ['#ffffff', '#ffe3ee', '#fff4b0', '#e2d6ff', '#ffd0b5'];
const TulipColors = ['#f0525d', '#f58ab5', '#ffc94d', '#b98cf0', '#ff8a4c'];
const BellColors = ['#8fa6f5', '#b58df0', '#7fc6f2'];
const STEM = '#6fb04a';
const LEAF = '#79c156';

const UP = new THREE.Vector3(0, 1, 0);

/** Sorteia a espécie com pesos (margarida é a mais comum). */
export function pickFlowerKind(rng: Rng): FlowerKind {
  const r = rng.next();
  if (r < 0.34) return 'daisy';
  if (r < 0.56) return 'tulip';
  if (r < 0.72) return 'bell';
  if (r < 0.86) return 'dandelion';
  return 'clover';
}

/**
 * Flor gigante (para o besouro). Caule curvo afinando, folhas com nervura na base
 * e a cabeça de cada espécie. Tudo balança com o vento (peso cresce com a altura).
 */
export function buildFlower(ctx: SceneryContext, x: number, z: number, height: number, kind: FlowerKind): void {
  const { rng } = ctx;
  const root = new THREE.Group();
  const baseY = terrainHeight(x, z) - 0.05;
  root.position.set(x, baseY, z);
  root.rotation.y = rng.next() * Math.PI * 2;

  const lean = new THREE.Vector3(rng.range(-0.28, 0.28), 1, rng.range(-0.28, 0.28)).normalize();
  const top = lean.clone().multiplyScalar(height);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(top.x * 0.15, height * 0.55, top.z * 0.15), top);
  const stemRadius = 0.1 + height * 0.018;
  const stem = taperedTube(curve, 16, (t) => stemRadius * (1.15 - t * 0.4), 8);
  root.add(part(stem, STEM, 'plant'));

  // Folhas na base, abrindo para fora.
  const leaves = kind === 'clover' ? 0 : 2 + Math.floor(rng.next() * 2);
  for (let i = 0; i < leaves; i++) {
    const length = height * rng.range(0.28, 0.42);
    const geo = leafGeometry(length, length * (kind === 'tulip' ? 0.28 : 0.42), { fold: 0.35, curl: 0.55, widest: kind === 'tulip' ? 0.3 : 0.45 });
    const leaf = part(geo, LEAF, 'plant');
    const t = rng.range(0.04, 0.25);
    leaf.position.copy(curve.getPoint(t));
    leaf.rotation.set(-rng.range(0.5, 0.9), (i / leaves) * Math.PI * 2 + rng.range(-0.4, 0.4), 0, 'YXZ');
    root.add(leaf);
  }

  const head = new THREE.Group();
  head.position.copy(top);
  root.add(head);

  let tint: THREE.Color;
  switch (kind) {
    case 'daisy':
      tint = buildDaisy(rng, head, height, lean);
      break;
    case 'tulip':
      tint = buildTulip(rng, head, height);
      break;
    case 'bell':
      tint = buildBells(rng, head, height, curve);
      break;
    case 'dandelion':
      tint = buildDandelion(rng, head, height);
      break;
    case 'clover':
      tint = buildCloverBlossom(rng, head, height);
      break;
  }

  root.updateMatrixWorld(true);
  const headWorld = head.getWorldPosition(new THREE.Vector3());
  const spot = ctx.addLandingSpot(headWorld);
  ctx.addSolid(x, z, 0.25);
  ctx.addShade(x, z, 0.9 + height * 0.08, 0.3);
  const stemCenter = new THREE.Vector3(x + top.x * 0.3, baseY + height * 0.3, z + top.z * 0.3);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.cylinder(height * 0.3, stemRadius * 1.4), stemCenter);

  const size = height * 0.36;
  ctx.addPickable({
    kind: 'flower',
    root,
    batch: { sway: 0.1 + height * 0.035 },
    size,
    probeA: new THREE.Vector3(x, baseY, z),
    probeB: headWorld,
    probeRadius: Math.max(stemRadius * 1.6, height * 0.06),
    colliders: [collider],
    landingSpots: [spot],
    tint,
    volume: sphereVolume(size * 0.42),
    extent: height,
  });
}

function buildDaisy(rng: Rng, head: THREE.Group, height: number, lean: THREE.Vector3): THREE.Color {
  // Cabeça virada levemente para o lado (flor olhando o sol).
  const facing = lean.clone().add(new THREE.Vector3(rng.range(-0.6, 0.6), 0.9, rng.range(-0.6, 0.6))).normalize();
  head.quaternion.setFromUnitVectors(UP, facing);
  const petalColor = new THREE.Color(rng.pick(DaisyPetals));
  const petalLength = height * 0.15;
  const count = 14 + Math.floor(rng.next() * 6);
  const petalGeo = leafGeometry(petalLength, petalLength * 0.34, { fold: 0.2, curl: -0.15, widest: 0.62, roundTip: 1, segmentsL: 6, segmentsW: 2 });
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < count; i++) {
      const a = ((i + ring * 0.5) / count) * Math.PI * 2;
      const petal = part(petalGeo, petalColor.clone().multiplyScalar(ring === 0 ? 1 : 0.94), 'petal');
      petal.rotation.set(-0.12 - ring * 0.14, a, 0, 'YXZ');
      petal.position.y = ring * 0.02;
      head.add(petal);
    }
  }
  // Miolo: domo granulado amarelo-laranja, mais escuro no centro.
  const disc = claySphere(petalLength * 0.36, 5, 0.12, 9, 2);
  disc.scale(1, 0.5, 1);
  paintVertices(disc, (p, _n, c) => {
    const r = Math.hypot(p.x, p.z) / (petalLength * 0.36);
    c.set('#e98a1c').lerp(new THREE.Color('#ffd23f'), Math.min(1, r * 1.1));
    return c.multiplyScalar(1 + noise3(p.x * 40, p.y * 40, p.z * 40) * 0.12);
  });
  const center = part(disc, 0xffffff, 'petal');
  center.position.y = petalLength * 0.06;
  head.add(center);
  return petalColor;
}

function buildTulip(rng: Rng, head: THREE.Group, height: number): THREE.Color {
  const color = new THREE.Color(rng.pick(TulipColors));
  const petalLength = height * 0.2;
  const petalGeo = leafGeometry(petalLength, petalLength * 0.75, { fold: 0.75, curl: -0.35, widest: 0.55, roundTip: 1, segmentsL: 8, segmentsW: 3, vein: false });
  // Petálas em taça: 3 por fora, 3 por dentro, todas inclinadas para dentro.
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 3; i++) {
      const a = ((i + ring * 0.5) / 3) * Math.PI * 2;
      const tint = color.clone().multiplyScalar(ring === 0 ? 1 : 0.88);
      const petal = part(petalGeo, tint, 'petal');
      petal.rotation.set(-1.25 - ring * 0.08, a, 0, 'YXZ');
      petal.position.set(Math.sin(a) * 0.05, 0, Math.cos(a) * 0.05);
      head.add(petal);
    }
  }
  const base = part(claySphere(petalLength * 0.22, 3, 0.05), '#4f9a3c', 'plant');
  head.add(base);
  return color;
}

function buildBells(rng: Rng, head: THREE.Group, height: number, curve: THREE.QuadraticBezierCurve3): THREE.Color {
  const color = new THREE.Color(rng.pick(BellColors));
  const bellLength = height * 0.13;
  // Sino: perfil de torno com a boca abrindo em saia e as pontinhas viradas.
  const bellGeo = latheGeometry(
    smoothProfile(
      [
        [bellLength * 0.62, 0],
        [bellLength * 0.48, bellLength * 0.1],
        [bellLength * 0.4, bellLength * 0.5],
        [bellLength * 0.3, bellLength * 0.9],
        [0.01, bellLength],
      ],
      14,
    ),
    16,
  );
  paintVertices(bellGeo, (p, _n, c) => c.copy(color).multiplyScalar(0.85 + (p.y / bellLength) * 0.25));
  // Três sinos pendurados em hastinhas ao longo do topo do caule.
  const count = 3;
  const tip = curve.getPoint(1);
  for (let i = 0; i < count; i++) {
    const t = 0.78 + i * 0.1;
    const p = curve.getPoint(Math.min(t, 1)).sub(tip);
    const a = rng.range(0, Math.PI * 2);
    const hang = new THREE.Group();
    hang.position.copy(p).add(new THREE.Vector3(Math.cos(a) * 0.35, -0.1, Math.sin(a) * 0.35));
    const bell = part(bellGeo, 0xffffff, 'petal');
    // De boca para baixo, levemente inclinado.
    bell.rotation.set(Math.PI + rng.range(-0.35, 0.35), 0, rng.range(-0.35, 0.35));
    hang.add(bell);
    const stalk = part(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 5), STEM, 'plant');
    stalk.position.set(-Math.cos(a) * 0.18, 0.18, -Math.sin(a) * 0.18);
    stalk.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    hang.add(stalk);
    head.add(hang);
  }
  return color;
}

function buildDandelion(rng: Rng, head: THREE.Group, height: number): THREE.Color {
  // Bola de sementes: hastes finas com um pompom branco na ponta (brilha no contraluz).
  const radius = height * 0.1;
  head.add(part(claySphere(radius * 0.25, 2, 0.05), '#c9b98a', 'plant'));
  const stalkGeo = new THREE.CylinderGeometry(0.012, 0.012, radius, 3, 1, true);
  stalkGeo.translate(0, radius / 2, 0);
  const puffGeo = claySphere(radius * 0.13, 0, 0.1);
  const count = 70;
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Espiral de Fibonacci: distribui as sementes por igual na esfera.
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.39996 + rng.range(-0.1, 0.1);
    dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
    const stalk = part(stalkGeo, '#f3efe4', 'petal');
    stalk.quaternion.setFromUnitVectors(UP, dir);
    head.add(stalk);
    const puff = part(puffGeo, '#ffffff', 'petal');
    puff.position.copy(dir).multiplyScalar(radius);
    puff.scale.set(1, 0.6, 1);
    puff.quaternion.setFromUnitVectors(UP, dir);
    head.add(puff);
  }
  return new THREE.Color('#f3efe4');
}

function buildCloverBlossom(rng: Rng, head: THREE.Group, height: number): THREE.Color {
  // Flor de trevo: globo de pétalas tubulares rosadas, mais claras na ponta.
  const radius = height * 0.07;
  const color = new THREE.Color(rng.next() < 0.5 ? '#f29ac0' : '#f4f0f6');
  const petalGeo = new THREE.ConeGeometry(radius * 0.18, radius * 0.8, 5);
  petalGeo.translate(0, radius * 0.55, 0);
  const count = 46;
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.39996;
    dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
    const petal = part(petalGeo, color.clone().multiplyScalar(0.8 + (y + 0.6) * 0.15), 'petal');
    petal.quaternion.setFromUnitVectors(UP, dir);
    head.add(petal);
  }
  head.add(part(claySphere(radius * 0.6, 3, 0.05), color.clone().multiplyScalar(0.7), 'petal'));
  // Trevo de três folhas embaixo da flor.
  const leafGeo = leafGeometry(radius * 2.2, radius * 2, { fold: 0.15, curl: 0.2, widest: 0.6, roundTip: 1, segmentsL: 6, segmentsW: 3 });
  for (let i = 0; i < 3; i++) {
    const leaf = part(leafGeo, LEAF, 'plant');
    leaf.position.y = -radius * 1.6;
    leaf.rotation.set(-0.3, (i / 3) * Math.PI * 2, 0, 'YXZ');
    head.add(leaf);
  }
  return color;
}
