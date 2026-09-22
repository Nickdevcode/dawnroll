import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay } from '../render/clayMaterial';
import { InstancePool } from '../render/InstancePool';
import { claySphere, displace, paintVertices, solidColor, taperedTube } from '../render/geometry';
import { createRng, smoothstep, type Rng } from '../utils/math';
import { noise3 } from '../utils/noise';
import { snailShell } from '../fx/critters/models';
import { leafGeometry, latheGeometry, smoothProfile } from './scenery/shapes';
import { terrainHeight, PLAY_RADIUS } from './Terrain';
import type { Scenery } from './Scenery';
import type { DungBall } from '../entities/DungBall';

/**
 * Coisas que a bola junta enquanto rola:
 *  - Montinhos de bosta: fazem a bola CRESCER (a mecânica principal).
 *  - Detritos (pedrinha, graveto, folha, fruta...): GRUDAM na superfície,
 *    estilo Katamari, quando a bola já é grande o suficiente para eles.
 */

const DUNG_PILES = 60;
const DEBRIS_COUNT = 230;
const RESPAWN_SECONDS = 18;
const ABSORB_SECONDS = 0.22;

interface Fly {
  body: THREE.Object3D;
  wings: [THREE.Object3D, THREE.Object3D];
  bodySlot: number;
  wingSlots: [number, number];
}

interface DungPile {
  /** Só guarda a transformação (o desenho é uma instância no pool de montinhos). */
  mesh: THREE.Object3D;
  size: number;
  state: 'idle' | 'absorbing' | 'gone';
  timer: number;
  flies: Fly[];
  seed: number;
  /** Vaga no pool de instâncias de montinho. */
  slot: number;
  /** De onde o montinho começou a ser sugado (o respingo sai dali). */
  readonly absorbFrom: THREE.Vector3;
}

interface Debris {
  object: THREE.Object3D;
  /** "Tamanho efetivo" para a regra de grudar (a bola precisa ser maior). */
  size: number;
  active: boolean;
  /** Parado no chão, é desenhado como instância; ao grudar vira um Mesh de verdade na bola. */
  pool: InstancePool | null;
  slot: number;
}

export interface CollectEvent {
  kind: 'dung' | 'debris';
  /** Ponto do impacto na superfície da bola (onde sai o respingo/brilho). */
  position: THREE.Vector3;
  size: number;
  /** Cor predominante do que foi pego (para as partículas). */
  color: THREE.Color;
}

export interface StinkSource {
  x: number;
  y: number;
  z: number;
  size: number;
}

const DUNG_TINT = new THREE.Color('#6e4426');

export class Collectibles {
  readonly group = new THREE.Group();
  private readonly piles: DungPile[] = [];
  private readonly debris: Debris[] = [];
  private readonly rng: Rng;
  private readonly pilePool: InstancePool;
  private readonly flyBodyPool: InstancePool;
  private readonly flyWingPool: InstancePool;
  private readonly debrisPools = new Map<string, InstancePool>();
  private time = 0;

  onCollect: ((event: CollectEvent) => void) | null = null;

  constructor(private readonly scenery: Scenery, seed = 2024) {
    this.rng = createRng(seed);
    this.group.name = 'collectibles';
    this.pilePool = new InstancePool(
      buildPileGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.78, sheen: 0.4, bump: 0.5, clearcoat: 0.2, wet: 0.7, mottle: 0.06, mottleScale: 4 }),
      DUNG_PILES,
    );
    this.flyBodyPool = new InstancePool(
      buildFlyBody(),
      clay(0xffffff, { vertexColors: true, roughness: 0.35, sheen: 0.3, iridescence: 0.7, clearcoat: 0.4, bump: 0, mottle: 0 }),
      DUNG_PILES * 2,
    );
    this.flyWingPool = new InstancePool(
      new THREE.SphereGeometry(0.06, 12, 6).scale(1, 0.12, 0.5),
      new THREE.MeshPhysicalMaterial({ color: '#e8f3ff', transparent: true, opacity: 0.45, roughness: 0.15, iridescence: 1, depthWrite: false }),
      DUNG_PILES * 4,
      false,
    );
    this.flyWingPool.mesh.userData.skipAO = true;
    this.group.add(this.pilePool.mesh, this.flyBodyPool.mesh, this.flyWingPool.mesh);

    for (let i = 0; i < DUNG_PILES; i++) this.spawnPile(i < 7);
    for (let i = 0; i < DEBRIS_COUNT; i++) this.debris.push(this.spawnDebris());
  }

  /** Passo fixo: checa contato com a bola. */
  fixedUpdate(dt: number, ball: DungBall, playerPosition: THREE.Vector3): void {
    const center = ball.position(new THREE.Vector3());
    const r = ball.radius;

    for (const pile of this.piles) {
      if (pile.state === 'idle') {
        const p = pile.mesh.position;
        const dist = Math.hypot(p.x - center.x, p.y + pile.size * 0.4 - center.y, p.z - center.z);
        if (dist < r + pile.size * 0.75) {
          pile.state = 'absorbing';
          pile.timer = ABSORB_SECONDS;
          pile.absorbFrom.copy(p);
        }
      } else if (pile.state === 'absorbing') {
        pile.timer -= dt;
        // Escorrega para dentro da bola encolhendo.
        pile.mesh.position.lerp(center, 1 - Math.exp(-14 * dt));
        pile.mesh.scale.multiplyScalar(Math.exp(-7 * dt));
        if (pile.timer <= 0) {
          pile.state = 'gone';
          pile.timer = RESPAWN_SECONDS;
          pile.mesh.visible = false;
          // Nem todo o volume vira bola — o resto "espalha". Mantém o crescimento gostoso, sem explodir.
          ball.addVolume((4 / 3) * Math.PI * Math.pow(pile.size * 0.85, 3));
          ball.dungCount++;
          const dir = pile.absorbFrom.clone().setY(pile.absorbFrom.y + pile.size * 0.4).sub(center);
          if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
          const hit = center.clone().addScaledVector(dir.normalize(), r);
          this.onCollect?.({ kind: 'dung', position: hit, size: pile.size, color: DUNG_TINT });
        }
      } else {
        pile.timer -= dt;
        if (pile.timer <= 0) this.respawnPile(pile, playerPosition);
      }
    }

    for (let i = 0; i < this.debris.length; i++) {
      const item = this.debris[i];
      if (!item.active) continue;
      if (r < item.size * 0.9) continue; // bola pequena demais: passa por cima sem pegar
      const p = item.object.position;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const reach = r + item.size * 0.35;
      if (dx * dx + dy * dy + dz * dz < reach * reach) {
        item.active = false;
        const at = p.clone();
        if (item.pool) item.pool.remove(item.slot);
        ball.stick(item.object, item.size);
        // Grudar também engorda um pouquinho a bola.
        ball.addVolume((4 / 3) * Math.PI * Math.pow(item.size * 0.35, 3));
        this.onCollect?.({ kind: 'debris', position: at, size: item.size, color: (item.object.userData.tint as THREE.Color) ?? DUNG_TINT });
        // Repõe o mundo para nunca "acabar" o que pegar — na MESMA vaga do array
        // (o que grudou agora pertence à bola; a lista não cresce com a sessão).
        this.debris[i] = this.spawnDebris(playerPosition);
      }
    }
  }

  /** Animação idle (montinho respirando, moscas voando em volta) e escrita das instâncias. */
  update(dt: number): void {
    this.time += dt;
    for (const pile of this.piles) {
      if (pile.state === 'gone') {
        this.pilePool.hide(pile.slot);
        for (const fly of pile.flies) this.hideFly(fly);
        continue;
      }
      if (pile.state === 'idle') {
        const wobble = Math.sin(this.time * 2 + pile.seed);
        const s = pile.size * (1 + wobble * 0.03);
        pile.mesh.scale.set(s, pile.size * (1 - wobble * 0.04), s);
      }
      pile.mesh.updateMatrix();
      this.pilePool.set(pile.slot, pile.mesh.matrix);

      if (pile.state !== 'idle') {
        for (const fly of pile.flies) this.hideFly(fly);
        continue;
      }
      pile.flies.forEach((fly, i) => {
        const t = this.time * (1.6 + i * 0.4) + pile.seed * 3 + i * 2.1;
        const radius = 1.1 + Math.sin(t * 0.7) * 0.25;
        fly.body.position.set(Math.cos(t) * radius, 1.4 + Math.sin(t * 2.3) * 0.3, Math.sin(t) * radius);
        fly.body.rotation.y = -t;
        const flap = Math.sin(this.time * 70 + i) * 0.6;
        fly.wings[0].rotation.x = flap;
        fly.wings[1].rotation.x = -flap;
      });
      pile.mesh.updateMatrixWorld(true);
      for (const fly of pile.flies) {
        this.flyBodyPool.set(fly.bodySlot, fly.body.matrixWorld);
        this.flyWingPool.set(fly.wingSlots[0], fly.wings[0].matrixWorld);
        this.flyWingPool.set(fly.wingSlots[1], fly.wings[1].matrixWorld);
      }
    }
  }

  private hideFly(fly: Fly): void {
    this.flyBodyPool.hide(fly.bodySlot);
    this.flyWingPool.hide(fly.wingSlots[0]);
    this.flyWingPool.hide(fly.wingSlots[1]);
  }

  /** Montinhos inteiros perto de um ponto (de onde sobe o "fedor" animado). */
  stinkSources(near: THREE.Vector3, maxDistance: number, out: StinkSource[]): StinkSource[] {
    out.length = 0;
    for (const pile of this.piles) {
      if (pile.state !== 'idle') continue;
      const p = pile.mesh.position;
      if (Math.hypot(p.x - near.x, p.z - near.z) > maxDistance) continue;
      out.push({ x: p.x, y: p.y, z: p.z, size: pile.size });
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  private randomFreeSpot(minRadius: number, maxRadius: number, footprint: number, avoid?: THREE.Vector3, avoidDist = 0): THREE.Vector2 {
    for (let i = 0; i < 60; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = minRadius + Math.sqrt(this.rng.next()) * (maxRadius - minRadius);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!this.scenery.isFree(x, z, footprint) || this.scenery.isInsideSolid(x, z, footprint)) continue;
      if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < avoidDist) continue;
      return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2(this.rng.range(-20, 20), this.rng.range(-20, 20));
  }

  private spawnPile(nearSpawn: boolean): void {
    const mesh = new THREE.Object3D();

    const pile: DungPile = {
      mesh,
      size: 1,
      state: 'idle',
      timer: 0,
      flies: [],
      seed: this.rng.next() * 100,
      absorbFrom: new THREE.Vector3(),
      slot: this.pilePool.add(new THREE.Matrix4()),
    };
    if (this.rng.next() < 0.5) {
      const flyCount = 1 + Math.floor(this.rng.next() * 2);
      for (let i = 0; i < flyCount; i++) pile.flies.push(this.buildFly(mesh));
    }
    this.piles.push(pile);
    this.placePile(pile, nearSpawn ? this.randomFreeSpot(3, 12, 0.6) : this.randomFreeSpot(6, PLAY_RADIUS - 2, 0.6));
  }

  private respawnPile(pile: DungPile, player: THREE.Vector3): void {
    this.placePile(pile, this.randomFreeSpot(6, PLAY_RADIUS - 2, 0.6, player, 14));
  }

  private placePile(pile: DungPile, spot: THREE.Vector2): void {
    pile.size = this.rng.range(0.28, 0.62);
    pile.mesh.position.set(spot.x, terrainHeight(spot.x, spot.y) - 0.03, spot.y);
    pile.mesh.rotation.y = this.rng.next() * Math.PI * 2;
    pile.mesh.scale.setScalar(pile.size);
    pile.mesh.visible = true;
    pile.state = 'idle';
  }

  private buildFly(parent: THREE.Object3D): Fly {
    const body = new THREE.Object3D();
    const wingL = new THREE.Object3D();
    wingL.position.set(0.06, 0.05, -0.02);
    const wingR = new THREE.Object3D();
    wingR.position.set(-0.06, 0.05, -0.02);
    body.add(wingL, wingR);
    // Moscas são filhas do montinho, mas não queremos que a escala dele as afete demais.
    body.scale.setScalar(2.2);
    parent.add(body);
    const identity = new THREE.Matrix4();
    return {
      body,
      wings: [wingL, wingR],
      bodySlot: this.flyBodyPool.add(identity),
      wingSlots: [this.flyWingPool.add(identity), this.flyWingPool.add(identity)],
    };
  }

  private spawnDebris(avoid?: THREE.Vector3): Debris {
    const rng = this.rng;
    const spot = this.randomFreeSpot(4, PLAY_RADIUS - 1, 0.3, avoid, avoid ? 12 : 0);
    const kind = rng.next();
    let object: THREE.Mesh;
    let size: number;
    let yOffset = 0.15;

    if (kind < 0.24) {
      size = rng.range(0.18, 0.7);
      object = DebrisKit.pebble(rng);
      object.scale.setScalar(size * 0.5);
    } else if (kind < 0.38) {
      const length = rng.range(0.6, 1.6);
      size = length * 0.55;
      object = DebrisKit.twig(rng);
      object.scale.set(1, length, 1);
      object.rotation.set(Math.PI / 2, rng.next() * Math.PI, 0);
      // Ao grudar, graveto deita tangente à bola em vez de ficar espetado.
      object.userData.lieTangent = true;
      yOffset = 0.05;
    } else if (kind < 0.54) {
      size = rng.range(0.35, 0.9);
      object = DebrisKit.leaf(rng);
      object.scale.setScalar(size);
      object.rotation.y = rng.next() * Math.PI * 2;
      yOffset = 0.03;
    } else if (kind < 0.64) {
      size = rng.range(0.2, 0.42);
      object = DebrisKit.berry(rng);
      object.scale.setScalar(size * 0.5);
    } else if (kind < 0.71) {
      size = rng.range(0.25, 0.5);
      object = DebrisKit.seed();
      object.scale.setScalar(size);
      object.rotation.y = rng.next() * Math.PI * 2;
      yOffset = 0.08;
    } else if (kind < 0.79) {
      size = rng.range(0.35, 0.6);
      object = DebrisKit.acorn();
      object.scale.setScalar(size);
      object.rotation.set(rng.range(1.2, 1.5), rng.next() * Math.PI * 2, 0, 'YXZ');
      yOffset = 0.12;
    } else if (kind < 0.86) {
      size = rng.range(0.3, 0.55);
      object = DebrisKit.clover();
      object.scale.setScalar(size * 1.6);
      object.rotation.y = rng.next() * Math.PI * 2;
      yOffset = 0.02;
    } else if (kind < 0.92) {
      size = rng.range(0.3, 0.6);
      object = DebrisKit.petal(rng);
      object.scale.setScalar(size);
      object.rotation.y = rng.next() * Math.PI * 2;
      yOffset = 0.02;
    } else if (kind < 0.96) {
      size = rng.range(0.4, 0.75);
      object = DebrisKit.shell();
      object.scale.setScalar(size * 0.7);
      object.rotation.y = rng.next() * Math.PI * 2;
      yOffset = 0.02;
    } else {
      size = rng.range(0.5, 0.8);
      object = DebrisKit.bottleCap(rng);
      object.scale.setScalar(size);
      object.rotation.set(0, rng.next() * Math.PI * 2, 0);
      yOffset = 0.08;
    }

    object.castShadow = size > 0.28;
    object.receiveShadow = true;
    const y = terrainHeight(spot.x, spot.y) + size * yOffset;
    object.position.set(spot.x, y, spot.y);
    object.updateMatrix();
    // Parado no chão ele é só uma instância; se o pool da variante lotar, vira Mesh comum.
    const pool = this.debrisPoolFor(object);
    const slot = pool.add(object.matrix);
    if (slot < 0) this.group.add(object);
    return { object, size, active: true, pool: slot < 0 ? null : pool, slot };
  }

  private debrisPoolFor(mesh: THREE.Mesh): InstancePool {
    const material = mesh.material as THREE.Material;
    const key = `${mesh.geometry.uuid}|${material.uuid}`;
    let pool = this.debrisPools.get(key);
    if (!pool) {
      pool = new InstancePool(mesh.geometry, material, 40);
      pool.mesh.name = 'debris';
      this.debrisPools.set(key, pool);
      this.group.add(pool.mesh);
    }
    return pool;
  }
}

// -----------------------------------------------------------------------------
// Modelos

/**
 * Montinho de desenho animado: base achatada + "sorvete" em espiral afinando até
 * uma pontinha virada. Vertex color escuro embaixo, mais claro e úmido em cima.
 */
function buildPileGeometry(): THREE.BufferGeometry {
  const base = claySphere(0.56, 4, 0.08, 2.5, 3);
  base.scale(1, 0.42, 1);
  base.translate(0, 0.14, 0);

  const points: THREE.Vector3[] = [];
  const turns = 2.4;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * turns * Math.PI * 2;
    const r = 0.4 * Math.pow(1 - t, 0.85) + 0.02;
    points.push(new THREE.Vector3(Math.cos(a) * r, 0.24 + t * 0.7, Math.sin(a) * r));
  }
  // Pontinha: sobe e dá uma viradinha.
  const last = points[points.length - 1];
  points.push(last.clone().add(new THREE.Vector3(0.02, 0.12, 0.03)), last.clone().add(new THREE.Vector3(0.08, 0.2, 0.05)));
  const swirl = taperedTube(new THREE.CatmullRomCurve3(points), 96, (t) => 0.26 * (1 - t * 0.8) + 0.012, 11);
  const tip = claySphere(0.03, 2, 0.02);
  const end = points[points.length - 1];
  tip.translate(end.x, end.y, end.z);

  const parts = [base, swirl, tip];
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  const lumpy = displace(merged, (x, y, z) => noise3(x * 5, y * 5, z * 5) * 0.025);

  const dark = new THREE.Color('#4f301a');
  const mid = new THREE.Color('#7b4c2a');
  const light = new THREE.Color('#a06a3b');
  return paintVertices(lumpy, (p, n, c) => {
    const h = smoothstep(0, 1.1, p.y);
    c.copy(dark).lerp(mid, smoothstep(0.02, 0.35, p.y)).lerp(light, h * 0.55 * (0.5 + n.y * 0.5));
    // Sulco entre as voltas da espiral fica mais escuro.
    const crease = Math.max(0, -n.y) * 0.35;
    return c.multiplyScalar(1 - crease + noise3(p.x * 9, p.y * 9, p.z * 9) * 0.12);
  });
}

function buildFlyBody(): THREE.BufferGeometry {
  const body = solidColor(claySphere(0.07, 3, 0.05, 2, 1), '#2a2733');
  body.scale(1, 0.9, 1.3);
  const eyes: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const eye = solidColor(claySphere(0.035, 2, 0.02), '#b3262b');
    eye.translate(side * 0.035, 0.02, 0.08);
    eyes.push(eye);
  }
  const parts = [body, ...eyes];
  for (const g of parts) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  return mergeGeometries(parts)!;
}

/** Materiais dos detritos: cores nos vértices, três acabamentos. */
const DebrisMaterials = {
  matte: () => clay(0xffffff, { vertexColors: true, roughness: 0.8, sheen: 0.35, bump: 0.35, mottle: 0.1, mottleScale: 6 }),
  glossy: () => clay(0xffffff, { vertexColors: true, roughness: 0.3, sheen: 0.25, clearcoat: 0.8, bump: 0.05, mottle: 0.04, mottleScale: 6 }),
  soft: () => clay(0xffffff, { vertexColors: true, roughness: 0.68, sheen: 0.6, bump: 0.2, mottle: 0.08, mottleScale: 5, side: THREE.DoubleSide }),
};

/** Normaliza atributos (position, normal, uv, color) para poder fundir peças. */
function fuse(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('color')) solidColor(g, '#ffffff');
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

const PebbleColors = ['#c9c1d6', '#b8b0a4', '#d8cdb9', '#a9b4c6'];
const LeafColors = ['#8fd16a', '#e9a23b', '#d9683f', '#b9d45a', '#c98a4a'];
const BerryColors = ['#e8434f', '#7a4fd1', '#3f6fe0', '#f08a3c'];
const PetalColors = ['#ffc2d9', '#ffffff', '#fff1a8', '#d9c9ff'];
const CapColors = ['#d63a3a', '#2f7fd6', '#f2b233', '#3aa655'];

/**
 * Fábrica dos detritos (geometria em cache por variante): cada um é UMA malha
 * com cores nos vértices, para grudar na bola como um objeto só.
 */
const DebrisKit = (() => {
  const cache = new Map<string, THREE.BufferGeometry>();
  const cached = (key: string, build: () => THREE.BufferGeometry) => {
    let g = cache.get(key);
    if (!g) cache.set(key, (g = build()));
    return g;
  };
  const make = (geometry: THREE.BufferGeometry, material: THREE.Material, tint: THREE.ColorRepresentation) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.tint = new THREE.Color(tint);
    return mesh;
  };

  return {
    pebble(rng: Rng): THREE.Mesh {
      const variant = Math.floor(rng.next() * 4);
      const color = rng.pick(PebbleColors);
      const g = cached(`pebble${variant}${color}`, () => {
        const geo = displace(new THREE.IcosahedronGeometry(1, 4), (x, y, z) => noise3(x * 1.4 + variant * 11, y * 1.4, z * 1.4) * 0.18 + noise3(x * 5, y * 5, z * 5 + variant) * 0.03);
        geo.scale(1.1, 0.7, 0.95);
        const base = new THREE.Color(color);
        return paintVertices(geo, (p, n, c) => c.copy(base).multiplyScalar(0.8 + n.y * 0.15 + noise3(p.x * 7, p.y * 7, p.z * 7) * 0.12));
      });
      return make(g, DebrisMaterials.matte(), color);
    },
    twig(rng: Rng): THREE.Mesh {
      const variant = Math.floor(rng.next() * 3);
      const g = cached(`twig${variant}`, () => {
        const main = taperedTube(
          new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0.03, -0.15, 0.02), new THREE.Vector3(-0.02, 0.2, -0.01), new THREE.Vector3(0.02, 0.5, 0)]),
          20,
          (t) => 0.06 * (1 - t * 0.45),
          8,
        );
        const branch = taperedTube(
          new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.05 + variant * 0.1, 0), new THREE.Vector3(0.12, 0.18 + variant * 0.1, 0), new THREE.Vector3(0.22, 0.34 + variant * 0.1, 0.02)),
          8,
          (t) => 0.03 * (1 - t * 0.6),
          6,
        );
        const bud = claySphere(0.03, 2, 0.05);
        bud.translate(0.22, 0.34 + variant * 0.1, 0.02);
        const bark = new THREE.Color('#8f6444');
        const wood = paintVertices(fuse([main, branch]), (p, _n, c) => c.copy(bark).multiplyScalar(0.8 + Math.abs(Math.sin(p.y * 40 + Math.atan2(p.z, p.x) * 3)) * 0.3));
        return fuse([wood, solidColor(bud, '#9fcf6a')]);
      });
      return make(g, DebrisMaterials.matte(), '#8f6444');
    },
    leaf(rng: Rng): THREE.Mesh {
      const color = rng.pick(LeafColors);
      const g = cached(`leaf${color}`, () => {
        const blade = leafGeometry(1.1, 0.64, { fold: 0.25, curl: 0.18, widest: 0.42, segmentsL: 10, segmentsW: 4 });
        const base = new THREE.Color(color);
        paintVertices(blade, (p, _n, c) => {
          // A leaf geometry já vem com nervura em cinza; aqui vira cor + pontinha queimada.
          const across = Math.abs(p.x) / 0.32;
          const midrib = Math.exp(-across * across * 60);
          return c.copy(base).multiplyScalar(0.9 + midrib * 0.25 - smoothstep(0.85, 1.1, p.z) * 0.25);
        });
        blade.translate(0, 0, -0.5);
        const stem = solidColor(new THREE.CylinderGeometry(0.018, 0.024, 0.28, 5), '#7d6a3f');
        stem.rotateX(Math.PI / 2);
        stem.translate(0, 0.01, -0.64);
        return fuse([blade, stem]);
      });
      return make(g, DebrisMaterials.soft(), color);
    },
    berry(rng: Rng): THREE.Mesh {
      const color = rng.pick(BerryColors);
      const g = cached(`berry${color}`, () => {
        const fruit = claySphere(1, 6, 0.03, 2, 21);
        const base = new THREE.Color(color);
        paintVertices(fruit, (p, _n, c) => c.copy(base).multiplyScalar(0.75 + (p.y + 1) * 0.18));
        const calyx: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const sepal = leafGeometry(0.35, 0.16, { fold: 0.2, curl: 0.4, segmentsL: 3, segmentsW: 1, vein: false });
          sepal.rotateX(0.2);
          sepal.rotateY((i / 5) * Math.PI * 2);
          sepal.translate(0, 0.96, 0);
          calyx.push(solidColor(sepal, '#3f6b2f'));
        }
        const stalk = solidColor(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 5), '#5a7a38');
        stalk.translate(0.03, 1.1, 0);
        return fuse([fruit, ...calyx, stalk]);
      });
      return make(g, DebrisMaterials.glossy(), color);
    },
    seed(): THREE.Mesh {
      const g = cached('seed', () => {
        // Semente de girassol: gota achatada com listras.
        const geo = claySphere(1, 4, 0.03, 2, 31);
        geo.scale(0.14, 0.09, 0.3);
        return paintVertices(geo, (p, _n, c) => c.set(Math.sin(p.x * 70) > 0.2 ? '#f1e6cf' : '#3b3130'));
      });
      return make(g, DebrisMaterials.matte(), '#e4c48e');
    },
    acorn(): THREE.Mesh {
      const g = cached('acorn', () => {
        const nut = latheGeometry(
          smoothProfile(
            [
              [0.001, -0.42],
              [0.12, -0.36],
              [0.2, -0.15],
              [0.22, 0.05],
              [0.2, 0.12],
            ],
            14,
          ),
          20,
        );
        const nutColor = new THREE.Color('#b77a3e');
        paintVertices(nut, (p, _n, c) => c.copy(nutColor).lerp(new THREE.Color('#e0b171'), smoothstep(-0.4, 0.1, p.y) * 0.5));
        // Chapéu escamado.
        const cap = displace(new THREE.SphereGeometry(0.26, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), (x, y, z) => Math.abs(Math.sin(Math.atan2(z, x) * 9 + y * 60)) * 0.015);
        cap.scale(1, 0.6, 1);
        cap.translate(0, 0.08, 0);
        paintVertices(cap, (p, _n, c) => c.set('#7a5533').multiplyScalar(0.85 + Math.sin(p.y * 90) * 0.12));
        const stem = solidColor(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 5), '#6a4a2e');
        stem.translate(0, 0.26, 0);
        return fuse([nut, cap, stem]);
      });
      return make(g, DebrisMaterials.matte(), '#b77a3e');
    },
    clover(): THREE.Mesh {
      const g = cached('clover', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 3; i++) {
          const leaf = leafGeometry(0.2, 0.2, { fold: 0.4, curl: -0.1, widest: 0.7, roundTip: 1, segmentsL: 4, segmentsW: 2 });
          paintVertices(leaf, (p, _n, c) => c.set('#76b94f').multiplyScalar(0.85 + Math.hypot(p.x, p.z) * 1.4));
          leaf.rotateY((i / 3) * Math.PI * 2);
          parts.push(leaf);
        }
        return fuse(parts);
      });
      return make(g, DebrisMaterials.soft(), '#76b94f');
    },
    petal(rng: Rng): THREE.Mesh {
      const color = rng.pick(PetalColors);
      const g = cached(`petal${color}`, () => {
        const petal = leafGeometry(0.7, 0.42, { fold: 0.35, curl: -0.2, widest: 0.62, roundTip: 1, segmentsL: 8, segmentsW: 3, vein: false });
        const base = new THREE.Color(color);
        paintVertices(petal, (p, _n, c) => c.copy(base).multiplyScalar(0.85 + p.z * 0.25));
        petal.translate(0, 0, -0.35);
        return petal;
      });
      return make(g, DebrisMaterials.soft(), color);
    },
    shell(): THREE.Mesh {
      const g = cached('shell', () => {
        const s = snailShell();
        s.translate(0.05, -0.2, 0.12);
        return fuse([s]);
      });
      return make(g, DebrisMaterials.glossy(), '#d9a878');
    },
    bottleCap(rng: Rng): THREE.Mesh {
      const color = rng.pick(CapColors);
      const g = cached(`cap${color}`, () => {
        // Tampinha: cilindro raso com a saia "crimpada" (ondinhas) e o topo liso.
        const skirt = displace(new THREE.CylinderGeometry(0.5, 0.52, 0.18, 42, 2, true), (x, _y, z) => Math.pow(Math.abs(Math.sin(Math.atan2(z, x) * 10.5)), 0.6) * 0.035);
        const top = new THREE.CircleGeometry(0.5, 42);
        top.rotateX(-Math.PI / 2);
        top.translate(0, 0.09, 0);
        const base = new THREE.Color(color);
        const skirtC = paintVertices(skirt, (_p, n, c) => c.copy(base).multiplyScalar(0.8 + Math.abs(n.x) * 0.2));
        const topC = paintVertices(top, (p, _n, c) => c.copy(base).lerp(new THREE.Color('#ffffff'), Math.abs(Math.hypot(p.x, p.z) - 0.3) < 0.03 ? 0.6 : 0));
        return fuse([skirtC, topC]);
      });
      return make(g, DebrisMaterials.glossy(), color);
    },
  };
})();
