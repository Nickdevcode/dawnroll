import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay } from '../render/clayMaterial';
import { claySphere, clayCapsule } from '../render/geometry';
import { createRng, type Rng } from '../utils/math';
import { noise3 } from '../utils/noise';
import { terrainHeight, PLAY_RADIUS } from './Terrain';
import type { Scenery } from './Scenery';
import type { DungBall } from '../entities/DungBall';

/**
 * Coisas que a bola junta enquanto rola:
 *  - Montinhos de bosta: fazem a bola CRESCER (a mecânica principal).
 *  - Detritos (pedrinha, graveto, folha, fruta...): GRUDAM na superfície,
 *    estilo Katamari, quando a bola já é grande o suficiente para eles.
 */

const DUNG_PILES = 55;
const DEBRIS_COUNT = 170;
const RESPAWN_SECONDS = 18;
const ABSORB_SECONDS = 0.22;

interface DungPile {
  mesh: THREE.Group;
  size: number;
  state: 'idle' | 'absorbing' | 'gone';
  timer: number;
  flies: THREE.Object3D[];
  seed: number;
}

interface Debris {
  object: THREE.Object3D;
  /** "Tamanho efetivo" para a regra de grudar (a bola precisa ser maior). */
  size: number;
  active: boolean;
}

export interface CollectEvent {
  kind: 'dung' | 'debris';
  position: THREE.Vector3;
  size: number;
}

export class Collectibles {
  readonly group = new THREE.Group();
  private readonly piles: DungPile[] = [];
  private readonly debris: Debris[] = [];
  private readonly rng: Rng;
  private readonly pileGeometry: THREE.BufferGeometry;
  private readonly pileMaterial: THREE.Material;
  private readonly flyParts: { body: THREE.BufferGeometry; wing: THREE.BufferGeometry; bodyMat: THREE.Material; wingMat: THREE.Material };
  private time = 0;

  onCollect: ((event: CollectEvent) => void) | null = null;

  constructor(private readonly scenery: Scenery, seed = 2024) {
    this.rng = createRng(seed);
    this.group.name = 'collectibles';
    this.pileGeometry = buildPileGeometry();
    this.pileMaterial = clay(0xffffff, { vertexColors: true, roughness: 0.8, sheen: 0.4, bump: 0.55, clearcoat: 0.15 });
    this.flyParts = {
      body: claySphere(0.07, 2, 0.05, 2, 1),
      wing: new THREE.SphereGeometry(0.06, 10, 6).scale(1, 0.15, 0.5),
      bodyMat: clay('#2a2733', { roughness: 0.4, sheen: 0.3, iridescence: 0.6, bump: 0 }),
      wingMat: new THREE.MeshPhysicalMaterial({ color: '#e8f3ff', transparent: true, opacity: 0.55, roughness: 0.2, transmission: 0, depthWrite: false }),
    };

    for (let i = 0; i < DUNG_PILES; i++) this.spawnPile(i < 6);
    for (let i = 0; i < DEBRIS_COUNT; i++) this.spawnDebris();
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
          this.onCollect?.({ kind: 'dung', position: center.clone(), size: pile.size });
        }
      } else {
        pile.timer -= dt;
        if (pile.timer <= 0) this.respawnPile(pile, playerPosition);
      }
    }

    for (const item of this.debris) {
      if (!item.active) continue;
      if (r < item.size * 0.9) continue; // bola pequena demais: passa por cima sem pegar
      const p = item.object.position;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const reach = r + item.size * 0.35;
      if (dx * dx + dy * dy + dz * dz < reach * reach) {
        item.active = false;
        ball.stick(item.object, item.size);
        // Grudar também engorda um pouquinho a bola.
        ball.addVolume((4 / 3) * Math.PI * Math.pow(item.size * 0.35, 3));
        this.onCollect?.({ kind: 'debris', position: center.clone(), size: item.size });
        // Repõe o mundo para nunca "acabar" o que pegar.
        this.spawnDebris(playerPosition);
      }
    }
  }

  /** Animação idle: montinho respirando, moscas voando em volta. */
  update(dt: number): void {
    this.time += dt;
    for (const pile of this.piles) {
      if (pile.state !== 'idle') continue;
      const wobble = Math.sin(this.time * 2 + pile.seed);
      const s = pile.size * (1 + wobble * 0.03);
      pile.mesh.scale.set(s, pile.size * (1 - wobble * 0.04), s);
      pile.flies.forEach((fly, i) => {
        const t = this.time * (1.6 + i * 0.4) + pile.seed * 3 + i * 2.1;
        const radius = 1.1 + Math.sin(t * 0.7) * 0.25;
        fly.position.set(Math.cos(t) * radius, 1.4 + Math.sin(t * 2.3) * 0.3, Math.sin(t) * radius);
        fly.rotation.y = -t;
        const wings = fly.children;
        const flap = Math.sin(this.time * 70 + i) * 0.6;
        if (wings[1]) wings[1].rotation.x = flap;
        if (wings[2]) wings[2].rotation.x = -flap;
      });
    }
  }

  // ---------------------------------------------------------------------------

  private randomFreeSpot(minRadius: number, maxRadius: number, footprint: number, avoid?: THREE.Vector3, avoidDist = 0): THREE.Vector2 {
    for (let i = 0; i < 60; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = minRadius + Math.sqrt(this.rng.next()) * (maxRadius - minRadius);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!this.scenery.isFree(x, z, footprint)) continue;
      if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < avoidDist) continue;
      return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2(this.rng.range(-20, 20), this.rng.range(-20, 20));
  }

  private spawnPile(nearSpawn: boolean): void {
    const mesh = new THREE.Group();
    const lump = new THREE.Mesh(this.pileGeometry, this.pileMaterial);
    lump.castShadow = true;
    lump.receiveShadow = true;
    mesh.add(lump);

    const pile: DungPile = { mesh, size: 1, state: 'idle', timer: 0, flies: [], seed: this.rng.next() * 100 };
    if (this.rng.next() < 0.45) {
      const flyCount = 1 + Math.floor(this.rng.next() * 2);
      for (let i = 0; i < flyCount; i++) pile.flies.push(this.buildFly(mesh));
    }
    this.group.add(mesh);
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

  private buildFly(parent: THREE.Object3D): THREE.Object3D {
    const fly = new THREE.Group();
    const body = new THREE.Mesh(this.flyParts.body, this.flyParts.bodyMat);
    body.scale.set(1, 0.9, 1.3);
    const wingL = new THREE.Mesh(this.flyParts.wing, this.flyParts.wingMat);
    wingL.position.set(0.06, 0.05, 0);
    const wingR = wingL.clone();
    wingR.position.x = -0.06;
    fly.add(body, wingL, wingR);
    // Moscas são filhas do montinho, mas não queremos que a escala dele as afete demais.
    fly.scale.setScalar(2.2);
    parent.add(fly);
    return fly;
  }

  private spawnDebris(avoid?: THREE.Vector3): void {
    const rng = this.rng;
    const spot = this.randomFreeSpot(4, PLAY_RADIUS - 1, 0.3, avoid, avoid ? 12 : 0);
    const kind = rng.next();
    let object: THREE.Object3D;
    let size: number;

    if (kind < 0.34) {
      size = rng.range(0.18, 0.7);
      object = new THREE.Mesh(sharedDebris.pebble(rng), clay(rng.pick(['#c9c1d6', '#b8b0a4', '#d8cdb9', '#a9b4c6']), { roughness: 0.8, sheen: 0.3, bump: 0.4 }));
      object.scale.setScalar(size * 0.5);
    } else if (kind < 0.55) {
      const length = rng.range(0.6, 1.6);
      size = length * 0.55;
      object = new THREE.Mesh(sharedDebris.twig(), clay('#8f6444', { roughness: 0.85, sheen: 0.3, bump: 0.5 }));
      object.scale.set(1, length, 1);
      object.rotation.set(Math.PI / 2, rng.next() * Math.PI, 0);
      // Ao grudar, graveto deita tangente à bola em vez de ficar espetado.
      object.userData.lieTangent = true;
    } else if (kind < 0.75) {
      size = rng.range(0.35, 0.9);
      object = new THREE.Mesh(sharedDebris.leaf(), clay(rng.pick(['#8fd16a', '#e9a23b', '#d9683f', '#b9d45a']), { roughness: 0.7, sheen: 0.6, bump: 0.25 }));
      object.scale.setScalar(size);
      object.rotation.y = rng.next() * Math.PI * 2;
    } else if (kind < 0.9) {
      size = rng.range(0.2, 0.42);
      object = new THREE.Mesh(sharedDebris.berry(), clay(rng.pick(['#e8434f', '#7a4fd1', '#3f6fe0']), { roughness: 0.3, sheen: 0.2, clearcoat: 0.8, bump: 0.05 }));
      object.scale.setScalar(size * 0.5);
    } else {
      size = rng.range(0.25, 0.5);
      object = new THREE.Mesh(sharedDebris.seed(), clay('#e4c48e', { roughness: 0.7, sheen: 0.5, bump: 0.3 }));
      object.scale.set(size * 0.35, size * 0.25, size * 0.55);
      object.rotation.y = rng.next() * Math.PI * 2;
    }

    object.castShadow = size > 0.3;
    object.receiveShadow = true;
    const y = terrainHeight(spot.x, spot.y) + size * 0.15;
    object.position.set(spot.x, y, spot.y);
    this.group.add(object);
    this.debris.push({ object, size, active: true });
  }
}

/** Montinho clássico de desenho: três "roscas" empilhadas + pontinha. */
function buildPileGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers: Array<[number, number, number]> = [
    // [raio do anel, espessura, altura]
    [0.55, 0.3, 0.2],
    [0.4, 0.26, 0.55],
    [0.24, 0.21, 0.84],
  ];
  tiers.forEach(([ringRadius, tube, y], i) => {
    const g = new THREE.TorusGeometry(ringRadius, tube, 14, 28);
    g.rotateX(Math.PI / 2);
    g.translate(0.03 * i, y, 0.02 * i);
    parts.push(g);
  });
  const fill = new THREE.SphereGeometry(0.5, 18, 12);
  fill.scale(1, 0.7, 1);
  fill.translate(0, 0.35, 0);
  parts.push(fill);
  const tip = new THREE.ConeGeometry(0.17, 0.35, 14);
  tip.translate(0.06, 1.1, 0.04);
  tip.rotateZ(-0.08);
  parts.push(tip);

  // Normaliza atributos (Cone/Torus/Sphere têm os mesmos: position, normal, uv).
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());

  // Leve deformação + manchas de cor.
  const pos = merged.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color('#5d391f');
  const mid = new THREE.Color('#7b4c2a');
  const light = new THREE.Color('#9a6538');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 4, y * 4, z * 4);
    pos.setXYZ(i, x + n * 0.03, y + n * 0.02, z + n * 0.03);
    c.copy(mid).lerp(y > 0.5 ? light : dark, Math.abs(n) * 1.4);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}

/** Geometrias compartilhadas entre todos os detritos (criadas sob demanda). */
const sharedDebris = (() => {
  const cache: Partial<Record<string, THREE.BufferGeometry>> = {};
  const pebbleVariants: THREE.BufferGeometry[] = [];
  return {
    pebble(rng: Rng): THREE.BufferGeometry {
      if (pebbleVariants.length === 0) {
        for (let i = 0; i < 4; i++) {
          const g = claySphere(1, 2, 0.18, 1.4, i * 11);
          g.scale(1.1, 0.7, 0.95);
          pebbleVariants.push(g);
        }
      }
      return rng.pick(pebbleVariants);
    },
    twig(): THREE.BufferGeometry {
      return (cache.twig ??= clayCapsule(0.06, 1, 0.15, 4));
    },
    leaf(): THREE.BufferGeometry {
      if (!cache.leaf) {
        const g = claySphere(1, 3, 0.04, 2, 8);
        g.scale(0.32, 0.05, 0.55);
        g.translate(0, 0.03, 0);
        cache.leaf = g;
      }
      return cache.leaf;
    },
    berry(): THREE.BufferGeometry {
      return (cache.berry ??= claySphere(1, 3, 0.03, 2, 21));
    },
    seed(): THREE.BufferGeometry {
      return (cache.seed ??= claySphere(1, 2, 0.05, 2, 31));
    },
  };
})();
