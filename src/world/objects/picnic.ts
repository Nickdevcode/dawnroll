import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import { claySphere, paintVertices, solidColor, taperedTube } from '../../render/geometry';
import { part } from '../../render/StaticBatch';
import { noise3 } from '../../utils/noise';
import { smoothstep } from '../../utils/math';
import { terrainHeight } from '../Terrain';
import type { CoverArea, SceneryContext } from '../scenery/context';
import type { ZoneSite } from '../zones';
import { addObject, settle, zoneFrame } from './common';
import { buildStrawberry } from './fruits';
import { fuseParts, polarOutline, slab } from './forms';

/**
 * Cantinho do piquenique: a ponta de uma toalha xadrez jogada na grama (pano de
 * massinha que acompanha o relevo, com barra e franja), morangos e bolachas
 * recheadas espalhados. As comidinhas miúdas (jujuba, pipoca, uva, açúcar) são
 * detritos e nascem por aqui (ver `Collectibles`).
 */

/** Lado de um quadradinho do xadrez (≈ 1,8 cm, como um guingão de verdade). */
const CHECK = 0.9;
/** Resolução do pano: dois quadradinhos de malha por quadradinho do xadrez. */
const CELL = CHECK / 2;
/** Espessura do pano (a face de baixo aparece na ponta levantada). */
const CLOTH = 0.025;

const GINGHAM_WHITE = new THREE.Color('#f6f0e4');
const GINGHAM_PINK = new THREE.Color('#e8918d');
const GINGHAM_RED = new THREE.Color('#c1262f');
const HEM_RED = new THREE.Color('#a91f28');

interface TowelShape {
  x: number;
  z: number;
  yaw: number;
  /** Lado do quadrado (múltiplo do xadrez). */
  size: number;
}

/**
 * Altura do pano acima do terreno em coordenadas locais: dobras largas e macias
 * (pano jogado na grama), barra um pouco mais grossa e a ponta da frente
 * levantada, como se o vento tivesse dobrado.
 */
function towelLift(lx: number, lz: number, half: number, withCurl: boolean): number {
  const folds = Math.pow(Math.max(0, Math.sin(lx * 0.62 + Math.sin(lz * 0.33) * 1.8)), 2) * 0.05;
  const lumps = Math.max(0, noise3(lx * 0.35, 3.1, lz * 0.35)) * 0.08;
  const edge = Math.min(half - Math.abs(lx), half - Math.abs(lz));
  const hem = (1 - smoothstep(0, CELL * 1.2, edge)) * 0.03;
  const curl = withCurl ? Math.pow(1 - smoothstep(0, 4.2, Math.hypot(half - lx, half - lz)), 2) * 1.3 : 0;
  return 0.035 + folds + lumps + hem + curl;
}

/** Cor de um quadradinho de malha: guingão (listras vermelhas cruzando) com barra lisa. */
function ginghamColor(i: number, j: number, cells: number, target: THREE.Color): THREE.Color {
  if (i === 0 || j === 0 || i === cells - 1 || j === cells - 1) return target.copy(HEM_RED);
  const a = Math.floor(i / 2) % 2 === 1;
  const b = Math.floor(j / 2) % 2 === 1;
  target.copy(a && b ? GINGHAM_RED : a || b ? GINGHAM_PINK : GINGHAM_WHITE);
  // Cada quadradinho tingido à mão, nunca igualzinho ao vizinho.
  return target.multiplyScalar(0.95 + noise3(i * 0.9, j * 0.9, 7.7) * 0.08);
}

/**
 * Toalha xadrez: face de cima com o guingão em quadradinhos de cor chapada (a
 * cor não borra entre um e outro), face de baixo desbotada e franja nos dois
 * lados. Tudo acompanha o terreno, vértice a vértice. Devolve a área coberta.
 */
function buildTowel(ctx: SceneryContext, shape: TowelShape): CoverArea {
  const { x: cx, z: cz, yaw, size } = shape;
  const half = size / 2;
  const cells = Math.round(size / CELL);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const worldOf = (lx: number, lz: number) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos] as const;

  // Grade compartilhada (para as normais saírem lisas) ...
  const row = cells + 1;
  const grid = new Float32Array(row * row * 3);
  for (let j = 0; j <= cells; j++) {
    for (let i = 0; i <= cells; i++) {
      let lx = -half + i * CELL;
      let lz = -half + j * CELL;
      const h = towelLift(lx, lz, half, true);
      // A ponta levantada também recua um pouco (o pano dobra para trás).
      const curl = Math.max(0, h - towelLift(lx, lz, half, false));
      lx -= curl * 0.3;
      lz -= curl * 0.3;
      const [wx, wz] = worldOf(lx, lz);
      const k = (j * row + i) * 3;
      grid[k] = wx - cx;
      grid[k + 1] = terrainHeight(wx, wz) + h;
      grid[k + 2] = wz - cz;
    }
  }
  const shared = new THREE.BufferGeometry();
  shared.setAttribute('position', new THREE.BufferAttribute(grid, 3));
  const sharedIndex: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * row + i;
      sharedIndex.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  shared.setIndex(sharedIndex);
  shared.computeVertexNormals();
  const normals = shared.getAttribute('normal') as THREE.BufferAttribute;

  // ... e depois cada quadradinho com os próprios vértices (cor chapada por quadradinho).
  const quads = cells * cells;
  const positions = new Float32Array(quads * 8 * 3);
  const normalOut = new Float32Array(quads * 8 * 3);
  const colors = new Float32Array(quads * 8 * 3);
  const index: number[] = [];
  const color = new THREE.Color();
  const under = new THREE.Color();
  let v = 0;
  const put = (g: number, c: THREE.Color, offset: number, flip: boolean) => {
    const nx = normals.getX(g) * (flip ? -1 : 1);
    const ny = normals.getY(g) * (flip ? -1 : 1);
    const nz = normals.getZ(g) * (flip ? -1 : 1);
    positions[v * 3] = grid[g * 3] - normals.getX(g) * offset;
    positions[v * 3 + 1] = grid[g * 3 + 1] - normals.getY(g) * offset;
    positions[v * 3 + 2] = grid[g * 3 + 2] - normals.getZ(g) * offset;
    normalOut.set([nx, ny, nz], v * 3);
    colors.set([c.r, c.g, c.b], v * 3);
    return v++;
  };
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const g = [j * row + i, j * row + i + 1, (j + 1) * row + i + 1, (j + 1) * row + i];
      ginghamColor(i, j, cells, color);
      const top = g.map((k) => put(k, color, 0, false));
      index.push(top[0], top[3], top[1], top[1], top[3], top[2]);
      // Avesso: desbotado (a tinta do guingão passa pro outro lado mais fraca).
      under.copy(color).lerp(GINGHAM_WHITE, 0.35).multiplyScalar(0.9);
      const bottom = g.map((k) => put(k, under, CLOTH, true));
      index.push(bottom[0], bottom[1], bottom[3], bottom[1], bottom[2], bottom[3]);
    }
  }
  shared.dispose();
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  cloth.setAttribute('normal', new THREE.BufferAttribute(normalOut, 3));
  cloth.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  cloth.setIndex(index);
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let k = 0; k < positions.length / 3; k++) {
    uv[k * 2] = positions[k * 3] * 0.35;
    uv[k * 2 + 1] = positions[k * 3 + 2] * 0.35;
  }
  cloth.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  root.add(part(cloth, 0xffffff, 'soft'));
  root.add(part(buildFringe(ctx, shape, worldOf), 0xffffff, 'soft'));
  // Pano rente ao chão: sombra própria só daria serrilhado.
  ctx.batch.addObject(root, { castShadow: false });

  return {
    x: cx,
    z: cz,
    yaw,
    halfWidth: half + 0.7,
    halfLength: half + 0.7,
    lift: (x, z) => {
      const dx = x - cx;
      const dz = z - cz;
      return towelLift(dx * cos - dz * sin, dx * sin + dz * cos, half, false);
    },
  };
}

/** Franja nos dois lados (fios deitados na grama, na cor da listra de onde saem). */
function buildFringe(ctx: SceneryContext, shape: TowelShape, worldOf: (lx: number, lz: number) => readonly [number, number]): THREE.BufferGeometry {
  const { rng } = ctx;
  const half = shape.size / 2;
  const strands: THREE.BufferGeometry[] = [];
  const spacing = 0.3;
  const count = Math.floor(shape.size / spacing);
  for (const side of [-1, 1]) {
    for (let k = 0; k < count; k++) {
      const lx = -half + (k + 0.5) * spacing;
      const length = rng.range(0.45, 0.75);
      const bend = rng.range(-0.2, 0.2);
      const points = [0, 0.5, 1].map((t) => {
        const [wx, wz] = worldOf(lx + bend * t * t, side * (half + t * length));
        return new THREE.Vector3(wx - shape.x, terrainHeight(wx, wz) + 0.05 - t * 0.02, wz - shape.z);
      });
      const strand = taperedTube(new THREE.CatmullRomCurve3(points), 4, (t) => 0.045 - t * 0.02, 4);
      const stripe = Math.floor((k * spacing) / CHECK) % 2 === 1;
      strands.push(solidColor(strand, stripe ? GINGHAM_RED : GINGHAM_WHITE));
    }
  }
  return fuseParts(strands);
}

// --- Bolacha recheada -----------------------------------------------------------

const COOKIE_RADIUS = 1.1;
const WAFER = 0.2;
const CREAM = 0.16;

/** Mordida: um arco de dentes tirado da borda (raio até onde a boca chegou). */
function bitten(radius: number, angle: number, bite: boolean): number {
  if (!bite) return radius;
  // Círculo da mordida fora da bolacha; o raio vira a distância até ele nessa direção.
  const cxb = COOKIE_RADIUS * 1.05;
  const rho = COOKIE_RADIUS * 0.5;
  const u = Math.cos(angle) * cxb;
  const disc = u * u - (cxb * cxb - rho * rho);
  if (disc < 0) return radius;
  const t = u - Math.sqrt(disc);
  return t > 0 && t < radius ? t + Math.sin(angle * 60) * 0.015 : radius;
}

const cookieCache = new Map<string, THREE.BufferGeometry>();

/** Bolacha de chocolate com relevo (borda, raios e anel) — a face de cima é a de fora. */
function waferGeometry(bite: boolean): THREE.BufferGeometry {
  const key = `wafer${bite}`;
  let g = cookieCache.get(key);
  if (g) return g;
  const outline = polarOutline(120, (a) => bitten(COOKIE_RADIUS * (1 + Math.cos(a * 24) * 0.022), a, bite));
  g = slab(outline, WAFER, {
    bevel: 0.07,
    rings: 18,
    center: new THREE.Vector2(bite ? -0.1 : 0, 0),
    top: (x, z, s) => {
      const a = Math.atan2(z, x);
      const rim = smoothstep(0.84, 0.9, s) * (1 - smoothstep(0.96, 1, s));
      const rays = smoothstep(0.55, 0.92, Math.cos(a * 12)) * smoothstep(0.42, 0.5, s) * (1 - smoothstep(0.72, 0.8, s));
      const ring = Math.exp(-(((s - 0.33) / 0.05) ** 2));
      return (rim + rays * 0.8 + ring * 0.7) * 0.035;
    },
  });
  const dark = new THREE.Color('#34201a');
  const light = new THREE.Color('#5a3a2a');
  paintVertices(g, (p, _n, c) => c.copy(dark).lerp(light, smoothstep(WAFER, WAFER + 0.035, p.y)).multiplyScalar(0.92 + noise3(p.x * 8, p.y * 8, p.z * 8) * 0.12));
  cookieCache.set(key, g);
  return g;
}

function creamGeometry(bite: boolean): THREE.BufferGeometry {
  const key = `cream${bite}`;
  let g = cookieCache.get(key);
  if (g) return g;
  const outline = polarOutline(96, (a) => bitten(COOKIE_RADIUS * 0.92, a, bite) - (bite ? 0.04 : 0));
  g = slab(outline, CREAM, { bevel: 0.07, rings: 3, center: new THREE.Vector2(bite ? -0.1 : 0, 0) });
  paintVertices(g, (p, _n, c) => c.set('#f4ebda').multiplyScalar(0.95 + noise3(p.x * 6, p.y * 20, p.z * 6) * 0.08));
  cookieCache.set(key, g);
  return g;
}

/** Bolacha recheada deitada: duas bolachas de chocolate com o creme aparecendo no meio. */
export function buildCookie(ctx: SceneryContext, x: number, z: number, yaw: number, options: { lift?: number; bite?: boolean } = {}): void {
  const { rng } = ctx;
  const bite = options.bite ?? false;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const bottom = part(waferGeometry(bite), 0xffffff, 'matte', 3);
  // A bolacha de baixo fica de cabeça para baixo (o relevo dela é para fora).
  bottom.rotation.x = Math.PI;
  bottom.position.y = WAFER;
  const cream = part(creamGeometry(bite), 0xffffff, 'soft', 3);
  cream.position.y = WAFER - 0.01;
  const top = part(waferGeometry(bite), 0xffffff, 'matte', 3);
  top.position.y = WAFER + CREAM - 0.02;
  // O de cima nunca fica perfeitamente alinhado.
  top.rotation.y = rng.range(-0.08, 0.08);
  top.position.x = rng.range(-0.03, 0.03);
  body.add(bottom, cream, top);
  body.rotation.set(rng.range(-0.05, 0.05), 0, rng.range(-0.05, 0.05));

  const ground = settle(root, x, z, yaw, 1, -(options.lift ?? 0));
  const height = WAFER * 2 + CREAM - 0.02;
  const center = new THREE.Vector3(x, root.position.y + height / 2, z);
  const collider = ctx.addCollider(RAPIER.ColliderDesc.cylinder(height / 2, COOKIE_RADIUS * 0.95), center, root.quaternion);
  ctx.addSolid(x, z, COOKIE_RADIUS * 0.8);
  ctx.addShade(x, z, COOKIE_RADIUS * 1.4, 0.35);
  addObject(ctx, {
    id: 'cookie',
    root,
    colliders: [collider],
    probeA: new THREE.Vector3(x, ground, z),
    probeB: new THREE.Vector3(x, root.position.y + height, z),
    probeRadius: COOKIE_RADIUS,
    extent: COOKIE_RADIUS * 2,
    tint: '#6b4430',
  });

  if (bite) scatterCrumbs(ctx, x, z, yaw, options.lift ?? 0);
}

/** Farelos em volta da bolacha mordida (enfeite fixo, não gruda). */
function scatterCrumbs(ctx: SceneryContext, x: number, z: number, yaw: number, lift: number): void {
  const { rng } = ctx;
  const crumbs = new THREE.Group();
  const geo = claySphere(1, 1, 0.2, 3, 4);
  for (let i = 0; i < 9; i++) {
    // Mais farelo do lado da mordida (+X local da bolacha).
    const a = yaw + rng.range(-1.1, 1.1);
    const d = COOKIE_RADIUS * rng.range(1.05, 1.9);
    const px = x + Math.cos(a) * d;
    const pz = z - Math.sin(a) * d;
    const crumb = part(geo, rng.next() < 0.3 ? '#efe4cf' : '#3e261c', 'matte');
    const s = rng.range(0.05, 0.12);
    crumb.scale.set(s, s * 0.6, s * 1.2);
    crumb.position.set(px, terrainHeight(px, pz) + lift + s * 0.3, pz);
    crumb.rotation.y = rng.range(0, Math.PI * 2);
    crumbs.add(crumb);
  }
  ctx.batch.addObject(crumbs, { castShadow: false });
}

// --- A cena -------------------------------------------------------------------

/**
 * Monta o cantinho: a toalha com a ponta virada para quem chega, morangos em
 * cima e em volta dela e as bolachas (uma mordida, com farelo).
 */
export function buildPicnicCorner(ctx: SceneryContext, zone: ZoneSite): void {
  const frame = zoneFrame(zone);
  const size = CHECK * 17;
  // Girada 45°: um canto aponta para o nascimento (a "ponta" da toalha).
  const center = frame.point(0, -0.8);
  const towel = buildTowel(ctx, { x: center.x, z: center.y, yaw: frame.yaw(-Math.PI / 4), size });
  ctx.addCover(towel);
  const lift = (p: THREE.Vector2) => towel.lift?.(p.x, p.y) ?? 0;

  const strawberries: Array<[number, number]> = [
    [-1.2, 4.6],
    [0.6, 5.4],
    [1.9, 3.9],
    [5.6, 2.2],
    [-6.4, 1.1],
  ];
  for (const [across, along] of strawberries) {
    const p = frame.point(across, along);
    buildStrawberry(ctx, p.x, p.y, ctx.rng.range(0, Math.PI * 2), lift(p));
  }

  const cookies: Array<[number, number, boolean]> = [
    [-3.2, 1.6, true],
    [2.8, -2.2, false],
    [-1.4, -4.6, false],
    [7.4, -1.8, false],
  ];
  for (const [across, along, bite] of cookies) {
    const p = frame.point(across, along);
    buildCookie(ctx, p.x, p.y, ctx.rng.range(0, Math.PI * 2), { lift: lift(p), bite });
  }
}
