import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RAPIER } from '../../core/Physics';
import { claySphere, displace, paintVertices, taperedTube } from '../../render/geometry';
import { part, type SurfaceProfile } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { latheGeometry, smoothProfile } from '../scenery/shapes';
import type { SceneryContext } from '../scenery/context';
import { addObject, attachCollider, settle, toWorld } from './common';
import { polarOutline, slab, warp } from './forms';

/**
 * O anão de jardim: o troféu do fim de jogo. Estátua de resina pintada (tudo
 * brilhante), em cima de uma pedrinha com musgo: botas de bico virado, calça
 * marrom, camisa azul com cinto e fivela dourada, barbona branca com mechas,
 * bochechas rosadas, nariz de batata, chapéu vermelho pontudo com a ponta
 * caída — e uma lasquinha de tinta faltando no chapéu, mostrando a resina.
 * Segura uma lanterna numa mão; a outra descansa na barriga.
 *
 * Frente para +Z, pé na origem, ~12,5 unidades de altura (≈ 25 cm).
 */

const HAT_RED = new THREE.Color('#d8433b');
const SHIRT_BLUE = new THREE.Color('#3f6fc4');
const SKIN = new THREE.Color('#f3c6a1');
const BEARD = new THREE.Color('#f4f1ea');
const RESIN = new THREE.Color('#dcd4c6');
const BELT = '#2e211a';
const GOLD = '#e6c04a';
const BOOT = '#4a3222';
const TROUSERS = '#6b4a2e';

export const GNOME_HEIGHT = 12.6;

interface GnomePart {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  profile: SurfaceProfile;
  uvScale?: number;
}

let gnomeParts: GnomePart[] | null = null;

/** Lasquinha de tinta: mancha de borda irregular onde a resina aparece. */
function chip(p: THREE.Vector3, center: THREE.Vector3, radius: number, color: THREE.Color, paint: THREE.Color): THREE.Color {
  const d = p.distanceTo(center) + noise3(p.x * 6, p.y * 6, p.z * 6) * radius * 0.45;
  if (d < radius) return color.copy(RESIN).multiplyScalar(0.95 + noise3(p.x * 20, p.y * 20, p.z * 20) * 0.08);
  // Beirinha mais escura onde a tinta descascou.
  if (d < radius * 1.18) return color.copy(paint).multiplyScalar(0.7);
  return color.copy(paint);
}

function buildGnomeParts(): GnomePart[] {
  const list: GnomePart[] = [];
  const add = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, profile: SurfaceProfile = 'glossy', uvScale = 2) => list.push({ geometry, color, profile, uvScale });

  // Pedestal: pedra achatada com musgo por cima.
  const base = slab(
    polarOutline(40, (a) => 2.75 * (1 + noise3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 2.2) * 0.12)),
    0.7,
    { bevel: 0.3, rings: 4 },
  );
  const stone = new THREE.Color('#9a9587');
  const moss = new THREE.Color('#6d9d47');
  paintVertices(base, (p, n, c) => {
    c.copy(stone).multiplyScalar(0.85 + noise3(p.x * 2, p.y * 2, p.z * 2) * 0.15);
    return c.lerp(moss, smoothstep(0.5, 0.9, n.y) * smoothstep(-0.2, 0.3, noise3(p.x * 0.9, 0, p.z * 0.9)) * 0.85);
  });
  add(base, 0xffffff, 'stone');

  // Botas de bico virado para cima (botinha de duende).
  for (const side of [-1, 1]) {
    const boot = warp(claySphere(1, 3, 0.03, 2, side + 3), (p) => {
      if (p.z > 0.2) p.y += (p.z - 0.2) ** 2 * 0.55;
      if (p.y < -0.35) p.y = -0.35 + (p.y + 0.35) * 0.3;
    });
    boot.scale(0.72, 0.6, 1.2);
    boot.rotateY(side * 0.22);
    boot.translate(side * 0.85, 0.95, 0.5);
    add(boot, BOOT);
  }
  // Calça: duas pernas curtinhas saindo do casaco.
  for (const side of [-1, 1]) {
    const leg = latheGeometry(smoothProfile([[0.52, 0], [0.58, 0.5], [0.6, 1.1], [0.001, 1.2]], 10), 14);
    leg.translate(side * 0.8, 1.05, 0.15);
    add(leg, TROUSERS);
  }

  // Camisa/casaco em forma de sino (barriga redonda), barra dobrada embaixo.
  const coat = latheGeometry(
    smoothProfile(
      [
        [0.001, 1.9],
        [1.7, 1.95],
        [1.98, 2.25],
        [2.08, 3.0],
        [2.12, 3.6],
        [1.98, 4.4],
        [1.62, 5.2],
        [1.2, 5.8],
        [0.62, 6.1],
        [0.001, 6.15],
      ],
      30,
    ),
    36,
  );
  coat.scale(1, 1, 0.92);
  paintVertices(coat, (p, _n, c) => c.copy(SHIRT_BLUE).multiplyScalar(p.y < 2.25 ? 0.82 : 0.95 + noise3(p.x * 2, p.y * 2, p.z * 2) * 0.08));
  add(coat, 0xffffff);

  // Cinto e fivela (a fivela é um anel quadrado: toro de 4 lados girado 45°).
  const belt = new THREE.TorusGeometry(2.1, 0.2, 8, 40);
  belt.rotateX(Math.PI / 2);
  belt.scale(1, 1.3, 0.93);
  belt.translate(0, 3.25, 0);
  add(belt, BELT);
  const buckle = new THREE.TorusGeometry(0.36, 0.09, 6, 4);
  buckle.rotateZ(Math.PI / 4);
  buckle.scale(1.15, 0.95, 1);
  buckle.translate(0, 3.25, 2.12);
  add(buckle, GOLD);
  const prong = new THREE.BoxGeometry(0.08, 0.5, 0.06);
  prong.translate(0, 3.25, 2.18);
  add(prong, GOLD);

  // Braços: manga azul e mão (a direita segura a lanterna, a esquerda na barriga).
  const arms: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
    [new THREE.Vector3(1.3, 5.4, 0), new THREE.Vector3(2.05, 4.3, 0.15), new THREE.Vector3(2.15, 3.35, 0.85)],
    [new THREE.Vector3(-1.3, 5.4, 0), new THREE.Vector3(-2.05, 4.4, 0.45), new THREE.Vector3(-1.2, 3.9, 1.75)],
  ];
  for (const [shoulder, elbow, wrist] of arms) {
    add(taperedTube(new THREE.CatmullRomCurve3([shoulder, elbow, wrist]), 14, (t) => 0.55 - t * 0.12, 12), SHIRT_BLUE);
    const cuff = new THREE.TorusGeometry(0.42, 0.1, 6, 16);
    const dir = wrist.clone().sub(elbow).normalize();
    cuff.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
    cuff.translate(wrist.x, wrist.y, wrist.z);
    add(cuff, SHIRT_BLUE.clone().multiplyScalar(0.8));
    const hand = claySphere(0.44, 3, 0.04, 2, wrist.x);
    hand.scale(1, 0.9, 1.1);
    hand.translate(wrist.x + dir.x * 0.3, wrist.y + dir.y * 0.3, wrist.z + dir.z * 0.3);
    add(hand, SKIN);
  }

  // Lanterna pendurada na mão direita: aro, telhadinho, vidro aceso e base.
  const lx = 2.2;
  const lz = 1.25;
  const ring = new THREE.TorusGeometry(0.26, 0.05, 6, 16);
  ring.translate(lx, 2.9, lz);
  add(ring, '#3b3b3e');
  const roof = new THREE.ConeGeometry(0.6, 0.5, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(lx, 2.45, lz);
  add(roof, '#3b3b3e');
  const glass = new RoundedBoxGeometry(0.72, 0.95, 0.72, 2, 0.08);
  glass.translate(lx, 1.7, lz);
  add(glass, '#ffd76a');
  const floor = new THREE.CylinderGeometry(0.5, 0.45, 0.14, 4);
  floor.rotateY(Math.PI / 4);
  floor.translate(lx, 1.18, lz);
  add(floor, '#3b3b3e');
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const post = new THREE.CylinderGeometry(0.05, 0.05, 1.05, 5);
    post.translate(lx + cx * 0.37, 1.7, lz + cz * 0.37);
    add(post, '#3b3b3e');
  }

  // Cabeça: rosto, bochechas coradas, nariz de batata, olhos, sobrancelhas e orelhas.
  const cheeks = [new THREE.Vector3(0.62, 6.72, 1.1), new THREE.Vector3(-0.62, 6.72, 1.1)];
  const face = claySphere(1.15, 4, 0.02, 2, 9);
  face.translate(0, 6.9, 0.25);
  const blush = new THREE.Color('#ee8c86');
  paintVertices(face, (p, _n, c) => {
    const k = Math.max(...cheeks.map((q) => Math.exp(-p.distanceToSquared(q) / 0.12)));
    return c.copy(SKIN).lerp(blush, k * 0.85);
  });
  add(face, 0xffffff);
  const nose = claySphere(0.4, 3, 0.05, 2, 4);
  nose.scale(1, 0.9, 0.95);
  nose.translate(0, 6.78, 1.42);
  add(nose, '#f2a48a');
  for (const side of [-1, 1]) {
    const eye = claySphere(0.12, 2, 0.02);
    eye.scale(1, 1.3, 0.6);
    eye.translate(side * 0.44, 7.18, 1.24);
    add(eye, '#1f1a18');
    const glint = claySphere(0.04, 1, 0);
    glint.translate(side * 0.44 + 0.03, 7.25, 1.31);
    add(glint, '#ffffff');
    const brow = taperedTube(
      new THREE.QuadraticBezierCurve3(new THREE.Vector3(side * 0.18, 7.45, 1.28), new THREE.Vector3(side * 0.45, 7.6, 1.26), new THREE.Vector3(side * 0.75, 7.42, 1.1)),
      8,
      (t) => 0.1 - Math.abs(t - 0.4) * 0.08,
      6,
    );
    add(brow, BEARD);
    const ear = claySphere(0.28, 2, 0.04);
    ear.scale(0.55, 1, 0.8);
    ear.translate(side * 1.12, 6.95, 0.15);
    add(ear, SKIN);
  }

  // Barba: gota grande pendurada do rosto até a barriga, com mechas esculpidas.
  const beard = displace(
    warp(claySphere(1, 5, 0.02, 2, 21), (p) => {
      // Afina para baixo (ponta da barba) e fica gordinha em cima (bochechas).
      if (p.y < 0) {
        const k = 1 + p.y * 0.55;
        p.x *= k;
        p.z *= 0.6 + k * 0.4;
      }
    }),
    (x, y, z) => Math.sin(x * 11 + Math.sin(y * 3) * 1.5) * 0.035 + noise3(x * 4, y * 4, z * 4) * 0.02,
  );
  beard.scale(1.42, 1.75, 0.8);
  beard.translate(0, 5.45, 1.05);
  paintVertices(beard, (p, _n, c) => c.copy(BEARD).multiplyScalar(0.9 + (Math.sin(p.x * 12 + Math.sin(p.y * 3.5) * 1.6) * 0.5 + 0.5) * 0.1));
  add(beard, 0xffffff);
  // Bigode: duas mechas curvas saindo de baixo do nariz.
  for (const side of [-1, 1]) {
    const moustache = taperedTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 6.5, 1.42), new THREE.Vector3(side * 0.5, 6.42, 1.4), new THREE.Vector3(side * 0.95, 6.55, 1.15), new THREE.Vector3(side * 1.12, 6.8, 0.95)]),
      12,
      (t) => 0.24 - t * 0.17,
      8,
    );
    add(moustache, BEARD);
  }

  // Chapéu: cone alto com a ponta caída para trás e para o lado, e a aba enrolada.
  const hatBase = 7.35;
  const hatHeight = GNOME_HEIGHT - hatBase;
  const hat = warp(
    latheGeometry(
      smoothProfile(
        Array.from({ length: 12 }, (_, i) => {
          const t = i / 11;
          return [Math.max(0.001, 1.32 * Math.pow(1 - t, 1.15)), t * hatHeight] as [number, number];
        }),
        40,
      ),
      32,
    ),
    (p) => {
      const t = Math.max(0, (p.y - hatHeight * 0.35) / (hatHeight * 0.65));
      p.z -= t * t * 1.3;
      p.x += t * t * 0.55;
      p.y -= t * t * 0.6;
    },
  );
  hat.translate(0, hatBase, 0.12);
  const chipCenter = new THREE.Vector3(0.78, hatBase + 1.35, 0.95);
  paintVertices(hat, (p, _n, c) => chip(p, chipCenter, 0.34, c, HAT_RED.clone().multiplyScalar(0.94 + noise3(p.x * 2, p.y * 2, p.z * 2) * 0.08)));
  add(hat, 0xffffff);
  const brim = new THREE.TorusGeometry(1.3, 0.17, 8, 36);
  brim.rotateX(Math.PI / 2);
  brim.translate(0, hatBase + 0.08, 0.12);
  add(brim, HAT_RED.clone().multiplyScalar(0.88));

  gnomeParts = list;
  return list;
}

/** Ponta do chapéu (depois da caída), no espaço do anão. */
const HAT_TIP = new THREE.Vector3(0.55, GNOME_HEIGHT - 0.6, 0.12 - 1.3);

/** Anão de jardim de pé no seu pedestal, olhando para `yaw`. */
export function buildGnome(ctx: SceneryContext, x: number, z: number, yaw: number): void {
  const root = new THREE.Group();
  for (const p of gnomeParts ?? buildGnomeParts()) root.add(part(p.geometry, p.color, p.profile, p.uvScale));
  // Estátua fica no prumo (o pedestal afunda um pouco no chão do lado de cima da ladeira).
  const ground = settle(root, x, z, yaw, 0.15, 0.2);

  const colliders = [
    attachCollider(ctx, root, RAPIER.ColliderDesc.cylinder(0.35, 2.7), new THREE.Vector3(0, 0.35, 0)),
    attachCollider(ctx, root, RAPIER.ColliderDesc.cylinder(2.3, 2.15), new THREE.Vector3(0, 3.6, 0.1)),
    attachCollider(ctx, root, RAPIER.ColliderDesc.ball(1.35), new THREE.Vector3(0, 6.85, 0.45)),
    attachCollider(ctx, root, RAPIER.ColliderDesc.cone(2.2, 1.3), new THREE.Vector3(0, 9.6, 0)),
  ];
  ctx.addSolid(x, z, 2.5);
  ctx.addShade(x, z, 4.2, 0.8);
  const spot = ctx.addLandingSpot(toWorld(root, HAT_TIP.x, HAT_TIP.y + 0.3, HAT_TIP.z));
  addObject(ctx, {
    id: 'gnome',
    root,
    colliders,
    probeA: new THREE.Vector3(x, ground, z),
    probeB: toWorld(root, 0, 8.6, 0),
    probeRadius: 2.6,
    extent: GNOME_HEIGHT,
    tint: HAT_RED,
    landingSpots: [spot],
  });
}
