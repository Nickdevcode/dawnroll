import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay } from '../render/clayMaterial';
import { InstancePool } from '../render/InstancePool';
import { claySphere, displace, paintVertices, solidColor, taperedTube } from '../render/geometry';
import { createRng, smoothstep, type Rng } from '../utils/math';
import { noise3 } from '../utils/noise';
import { dungFlyBody, dungFlyWing, snailShell } from '../fx/critters/models';
import { leafGeometry, latheGeometry, smoothProfile } from './scenery/shapes';
import { terrainHeight, PLAY_RADIUS } from './Terrain';
import type { Scenery } from './Scenery';
import type { DungBall } from '../entities/DungBall';
import { zoneOf, type ZoneKind } from './zones';
import {
  brickGeometry,
  buttonGeometry,
  cicadaShellGeometry,
  clipGeometry,
  coinGeometry,
  dieGeometry,
  fourLeafGeometry,
  grapeGeometry,
  jellybeanGeometry,
  marbleGeometry,
  popcornGeometry,
  sugarCubeGeometry,
  type MarblePalette,
} from './objects/debrisModels';

/**
 * Coisas que a bola junta enquanto rola:
 *  - Montinhos de bosta: fazem a bola CRESCER (a mecânica principal).
 *  - Detritos (pedrinha, graveto, folha, fruta...): GRUDAM na superfície,
 *    estilo Katamari, quando a bola já é grande o suficiente para eles.
 */

const DUNG_PILES = 60;
const DEBRIS_COUNT = 300;
/** Vagas do anel de detritos extras (poderes que soltam tralha): o mais velho sai quando lota. */
const EXTRA_SLOTS = 40;
/** Detrito extra que ninguém pegou some sozinho depois disso (segundos). */
const EXTRA_LIFETIME = 25;
/** Nos últimos instantes o extra encolhe até sumir (em vez de desaparecer do nada). */
const EXTRA_FADE = 0.6;
/** Duração do pulinho de quando o extra sai voando até o chão. */
const HOP_SECONDS = 0.45;
/** 1 em cada ~80 trevinhos nasce de quatro folhas (figurinha rara). */
const FOUR_LEAF_CHANCE = 1 / 80;
const RESPAWN_SECONDS = 18;
const ABSORB_SECONDS = 0.22;
/** Moscas por montinho no máximo (o fresquinho junta todas). */
const MAX_FLIES = 3;
/** Chance de um montinho nascer fresquinho (sem o poder Faro). */
export const FRESH_CHANCE = 0.1;
/** O fresquinho vale o dobro de bola. */
const FRESH_VOLUME = 2;
/** Tom do fresquinho: mais claro, dourado e úmido (multiplica as cores do montinho). */
const FRESH_TINT = new THREE.Color(1.55, 1.2, 0.62);
const PLAIN_TINT = new THREE.Color(1, 1, 1);

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
  /** Quantas das moscas aparecem (o resto fica guardado para quando ele for fresquinho). */
  flyCount: number;
  /** Montinho fresquinho: raro, cheira mais, rende o dobro e conta no catálogo. */
  fresh: boolean;
  seed: number;
  /** Vaga no pool de instâncias de montinho. */
  slot: number;
  /** De onde o montinho começou a ser sugado (o respingo sai dali). */
  readonly absorbFrom: THREE.Vector3;
}

/** Do que o detrito é feito (decide o som de quando ele gruda na bola). */
export type DebrisMaterial =
  | 'pebble'
  | 'twig'
  | 'leaf'
  | 'berry'
  | 'seed'
  | 'acorn'
  | 'clover'
  | 'fourLeaf'
  | 'petal'
  | 'shell'
  | 'cicadaShell'
  | 'cap'
  | 'button'
  | 'marble'
  | 'coin'
  | 'clip'
  | 'brick'
  | 'die'
  | 'jellybean'
  | 'sugarCube'
  | 'popcorn'
  | 'grape'
  | 'pillbug';

interface Debris {
  object: THREE.Mesh;
  /** "Tamanho efetivo" para a regra de grudar (a bola precisa ser maior). */
  size: number;
  material: DebrisMaterial;
  active: boolean;
  /** Parado no chão, é desenhado como instância; ao grudar vira um Mesh de verdade na bola. */
  pool: InstancePool | null;
  slot: number;
}

/** Detrito solto por um poder: tem prazo de validade e chega ao chão com um pulinho. */
interface ExtraDebris extends Debris {
  /** Segundos até sumir sozinho. */
  life: number;
  /** Progresso do pulinho (0..1); só dá para pegar depois de pousar. */
  hop: number;
  /** De onde ele saiu voando. */
  readonly from: THREE.Vector3;
}

/** O que dá para sortear no chão (o trevo de quatro folhas sai do sorteio do trevinho). */
type SpawnMaterial = Exclude<DebrisMaterial, 'pillbug' | 'fourLeaf'>;

interface SpawnRule {
  material: SpawnMaterial;
  /** Peso no sorteio (a tabela soma 1). */
  weight: number;
  /** Cantinho onde ele costuma aparecer, e a chance de nascer lá (o resto se espalha). */
  zone?: { kind: ZoneKind; share: number };
}

/**
 * Sorteio da tralha do chão. A natureza continua sendo ~3/4 (o jardim de sempre);
 * o resto é coisa de gente: comidinha perto do piquenique, brinquedinho perto
 * dos brinquedos e achados (botão, moeda, clipe) em qualquer canto, mais raros.
 */
const SPAWN_TABLE: readonly SpawnRule[] = [
  { material: 'pebble', weight: 0.175 },
  { material: 'twig', weight: 0.11 },
  { material: 'leaf', weight: 0.13 },
  { material: 'berry', weight: 0.075 },
  { material: 'seed', weight: 0.055 },
  { material: 'acorn', weight: 0.06 },
  { material: 'clover', weight: 0.055 },
  { material: 'petal', weight: 0.045 },
  { material: 'shell', weight: 0.03 },
  { material: 'cap', weight: 0.03 },
  { material: 'cicadaShell', weight: 0.008 },
  { material: 'button', weight: 0.025 },
  { material: 'coin', weight: 0.015 },
  { material: 'clip', weight: 0.02 },
  { material: 'marble', weight: 0.025, zone: { kind: 'toys', share: 0.75 } },
  { material: 'brick', weight: 0.025, zone: { kind: 'toys', share: 0.75 } },
  { material: 'die', weight: 0.017, zone: { kind: 'toys', share: 0.75 } },
  { material: 'jellybean', weight: 0.03, zone: { kind: 'picnic', share: 0.7 } },
  { material: 'sugarCube', weight: 0.02, zone: { kind: 'picnic', share: 0.7 } },
  { material: 'popcorn', weight: 0.03, zone: { kind: 'picnic', share: 0.7 } },
  { material: 'grape', weight: 0.02, zone: { kind: 'picnic', share: 0.7 } },
];

/** Um detrito recém-modelado, ainda sem lugar no mundo. */
interface BuiltDebris {
  object: THREE.Mesh;
  size: number;
  material: DebrisMaterial;
  /** Altura do centro acima do chão, em múltiplos do tamanho. */
  yOffset: number;
}

export interface CollectEvent {
  kind: 'dung' | 'debris';
  /** Ponto do impacto na superfície da bola (onde sai o respingo/brilho). */
  position: THREE.Vector3;
  size: number;
  /** Cor predominante do que foi pego (para as partículas). */
  color: THREE.Color;
  /** Do que é feito (só detrito; montinho de bosta é `null`). */
  material: DebrisMaterial | null;
  /** Montinho fresquinho (só montinho). */
  fresh: boolean;
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
  /** Anel de extras soltos pelos poderes (tamanho fixo: nunca cresce com a sessão). */
  private readonly extras: Array<ExtraDebris | null> = new Array<ExtraDebris | null>(EXTRA_SLOTS).fill(null);
  private extraCursor = 0;
  private readonly rng: Rng;
  private readonly pilePool: InstancePool;
  private readonly flyBodyPool: InstancePool;
  private readonly flyWingPool: InstancePool;
  private readonly debrisPools = new Map<string, InstancePool>();
  private time = 0;

  onCollect: ((event: CollectEvent) => void) | null = null;
  /** Poder Bola grudenta: alcance extra (unidades) para montinho e detrito grudarem. */
  magnet = 0;
  /** Chance de um montinho renascer fresquinho (o poder Faro aumenta). */
  freshChance = FRESH_CHANCE;

  constructor(private readonly scenery: Scenery, seed = 2024) {
    this.rng = createRng(seed);
    this.group.name = 'collectibles';
    this.pilePool = new InstancePool(
      buildPileGeometry(),
      clay(0xffffff, { vertexColors: true, roughness: 0.78, sheen: 0.4, bump: 0.5, clearcoat: 0.2, wet: 0.7, mottle: 0.06, mottleScale: 4 }),
      DUNG_PILES,
    );
    this.flyBodyPool = new InstancePool(
      dungFlyBody(),
      clay(0xffffff, { vertexColors: true, roughness: 0.35, sheen: 0.3, iridescence: 0.7, clearcoat: 0.4, bump: 0, mottle: 0 }),
      DUNG_PILES * MAX_FLIES,
    );
    this.flyWingPool = new InstancePool(
      dungFlyWing(),
      // Dupla face: a asa esquerda é a direita espelhada (escala -1 em X).
      new THREE.MeshPhysicalMaterial({ color: '#e8f3ff', vertexColors: true, transparent: true, opacity: 0.5, roughness: 0.15, iridescence: 1, depthWrite: false, side: THREE.DoubleSide }),
      DUNG_PILES * MAX_FLIES * 2,
      false,
    );
    this.flyWingPool.mesh.userData.skipAO = true;
    this.group.add(this.pilePool.mesh, this.flyBodyPool.mesh, this.flyWingPool.mesh);

    for (let i = 0; i < DUNG_PILES; i++) this.spawnPile(i < 7);
    for (let i = 0; i < DEBRIS_COUNT; i++) this.debris.push(this.spawnDebris());
    this.prepareTintedPools();
  }

  /** Passo fixo: checa contato com a bola. */
  fixedUpdate(dt: number, ball: DungBall, playerPosition: THREE.Vector3): void {
    const center = ball.position(new THREE.Vector3());
    const r = ball.radius;

    // Bola sendo enterrada não pega nada (mas os montinhos continuam renascendo).
    const solid = ball.isSolid;
    for (const pile of this.piles) {
      if (pile.state === 'idle') {
        if (!solid) continue;
        const p = pile.mesh.position;
        const dist = Math.hypot(p.x - center.x, p.y + pile.size * 0.4 - center.y, p.z - center.z);
        if (dist < r + pile.size * 0.75 + this.magnet) {
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
          // O montinho inteiro vira bola (o Katamari do cenário dá o resto do crescimento).
          ball.addVolume((4 / 3) * Math.PI * Math.pow(pile.size, 3) * (pile.fresh ? FRESH_VOLUME : 1));
          ball.dungCount++;
          const dir = pile.absorbFrom.clone().setY(pile.absorbFrom.y + pile.size * 0.4).sub(center);
          if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
          const hit = center.clone().addScaledVector(dir.normalize(), r);
          this.onCollect?.({ kind: 'dung', position: hit, size: pile.size, color: DUNG_TINT, material: null, fresh: pile.fresh });
        }
      } else {
        pile.timer -= dt;
        if (pile.timer <= 0) this.respawnPile(pile, playerPosition);
      }
    }

    if (!solid) return;
    for (let i = 0; i < this.debris.length; i++) {
      // Repõe o mundo para nunca "acabar" o que pegar — na MESMA vaga do array
      // (o que grudou agora pertence à bola; a lista não cresce com a sessão).
      if (this.tryStick(this.debris[i], center, r, ball)) this.debris[i] = this.spawnDebris(playerPosition);
    }
    for (let i = 0; i < this.extras.length; i++) {
      const extra = this.extras[i];
      if (!extra) continue;
      extra.life -= dt;
      if (extra.hop >= 1 && this.tryStick(extra, center, r, ball)) {
        this.extras[i] = null;
      } else if (extra.life <= 0) {
        this.discard(extra);
        this.extras[i] = null;
      }
    }
  }

  /** O detrito está ao alcance e a bola é grande o bastante: gruda (e avisa). */
  private tryStick(item: Debris, center: THREE.Vector3, r: number, ball: DungBall): boolean {
    if (!item.active || r < item.size * 0.9) return false; // bola pequena demais: passa por cima sem pegar
    const p = item.object.position;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    const reach = r + item.size * 0.35 + this.magnet;
    if (dx * dx + dy * dy + dz * dz >= reach * reach) return false;
    item.active = false;
    const at = p.clone();
    if (item.pool) item.pool.remove(item.slot);
    // Cor por instância não vai junto para o Mesh solto: a cor é assada na geometria.
    const tint = item.object.userData.instanceTint as THREE.Color | undefined;
    if (tint) item.object.geometry = DebrisKit.tinted(item.object.geometry, tint);
    ball.stick(item.object, {
      // Afunda ~um terço do item na bosta; fica com cara de "grudou mesmo".
      depth: -item.size * 0.18,
      lieTangent: item.object.userData.lieTangent === true,
      burySize: item.size,
    });
    ball.itemCount++;
    // Grudar também engorda um pouquinho a bola.
    ball.addVolume((4 / 3) * Math.PI * Math.pow(item.size * 0.45, 3));
    this.onCollect?.({ kind: 'debris', position: at, size: item.size, color: (item.object.userData.tint as THREE.Color) ?? DUNG_TINT, material: item.material, fresh: false });
    return true;
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
        if (i >= pile.flyCount) return;
        const t = this.time * (1.6 + i * 0.4) + pile.seed * 3 + i * 2.1;
        const radius = 1.1 + Math.sin(t * 0.7) * 0.25;
        fly.body.position.set(Math.cos(t) * radius, 1.4 + Math.sin(t * 2.3) * 0.3, Math.sin(t) * radius);
        fly.body.rotation.y = -t;
        // Asa articulada na raiz: girar em Z levanta a ponta (a espelhada gira ao contrário).
        const flap = 0.25 + Math.sin(this.time * 70 + i) * 0.7;
        fly.wings[0].rotation.z = flap;
        fly.wings[1].rotation.z = -flap;
      });
      pile.mesh.updateMatrixWorld(true);
      for (let i = 0; i < pile.flies.length; i++) {
        const fly = pile.flies[i];
        if (i >= pile.flyCount) {
          this.hideFly(fly);
          continue;
        }
        this.flyBodyPool.set(fly.bodySlot, fly.body.matrixWorld);
        this.flyWingPool.set(fly.wingSlots[0], fly.wings[0].matrixWorld);
        this.flyWingPool.set(fly.wingSlots[1], fly.wings[1].matrixWorld);
      }
    }
    this.animateExtras(dt);
  }

  /** Extras: o pulinho até o chão e o encolher antes de sumir (só o desenho; a lógica usa o lugar final). */
  private animateExtras(dt: number): void {
    for (const extra of this.extras) {
      if (!extra?.pool) continue;
      const fading = extra.life < EXTRA_FADE;
      if (extra.hop >= 1 && !fading) continue;
      const o = extra.object;
      tmpPose.position.copy(o.position);
      tmpPose.quaternion.copy(o.quaternion);
      tmpPose.scale.copy(o.scale);
      if (extra.hop < 1) {
        extra.hop = Math.min(1, extra.hop + dt / HOP_SECONDS);
        const t = extra.hop;
        tmpPose.position.lerpVectors(extra.from, o.position, t);
        // Arco de pulinho e um giro no ar (assenta na pose final).
        tmpPose.position.y += Math.sin(Math.PI * t) * (0.6 + extra.size);
        tmpPose.rotateY((1 - t) * 5);
      }
      if (fading) tmpPose.scale.multiplyScalar(Math.max(extra.life / EXTRA_FADE, 0.001));
      tmpPose.updateMatrix();
      extra.pool.set(extra.slot, tmpPose.matrix);
    }
  }

  private hideFly(fly: Fly): void {
    this.flyBodyPool.hide(fly.bodySlot);
    this.flyWingPool.hide(fly.wingSlots[0]);
    this.flyWingPool.hide(fly.wingSlots[1]);
  }

  /** Rodada nova: todo montinho que foi comido volta para o jardim de uma vez (e a tralha extra some). */
  respawnAll(player: THREE.Vector3): void {
    for (const pile of this.piles) {
      if (pile.state !== 'idle') this.respawnPile(pile, player);
    }
    for (let i = 0; i < this.extras.length; i++) {
      const extra = this.extras[i];
      if (extra) this.discard(extra);
      this.extras[i] = null;
    }
  }

  /**
   * Solta `count` detritos de um material no chão em volta de `at` (poderes que
   * derrubam tralha). Eles saem de `at` num pulinho e pousam a até ~`spread`×2
   * unidades; quem ninguém pegar some sozinho em ~25 s. Vão para um anel de
   * vagas fixo: se lotar, o extra mais antigo dá lugar ao novo.
   */
  spawnDebrisBurst(material: DebrisMaterial, at: THREE.Vector3, count: number, spread = 1): void {
    if (material === 'pillbug') return; // bicho não é tralha de chão
    const rng = this.rng;
    for (let n = 0; n < count; n++) {
      const built = this.buildDebris(material, rng);
      let x = at.x;
      let z = at.z;
      for (let tries = 0; tries < 6; tries++) {
        const a = rng.next() * Math.PI * 2;
        const d = (0.5 + rng.next() * 1.4) * spread + built.size * 0.5;
        x = at.x + Math.cos(a) * d;
        z = at.z + Math.sin(a) * d;
        if (!this.scenery.isInsideSolid(x, z, built.size * 0.3) && !this.scenery.isDug(x, z)) break;
      }
      const item = this.place(built, x, z);
      const old = this.extras[this.extraCursor];
      if (old) this.discard(old);
      const extra: ExtraDebris = { ...item, life: EXTRA_LIFETIME, hop: item.pool ? 0 : 1, from: at.clone() };
      // Até o primeiro quadro do pulinho, a instância já nasce no ponto de saída.
      if (item.pool) {
        tmpPose.position.copy(at);
        tmpPose.quaternion.copy(item.object.quaternion);
        tmpPose.scale.copy(item.object.scale);
        tmpPose.updateMatrix();
        item.pool.set(item.slot, tmpPose.matrix);
      }
      this.extras[this.extraCursor] = extra;
      this.extraCursor = (this.extraCursor + 1) % EXTRA_SLOTS;
    }
  }

  /** Tira um detrito do mundo sem ninguém pegar (extra vencido ou despejado do anel). */
  private discard(item: Debris): void {
    item.active = false;
    if (item.pool) item.pool.remove(item.slot);
    else item.object.removeFromParent();
  }

  /** Montinhos inteiros perto de um ponto (de onde sobe o "fedor" animado). */
  stinkSources(near: THREE.Vector3, maxDistance: number, out: StinkSource[]): StinkSource[] {
    out.length = 0;
    for (const pile of this.piles) {
      if (pile.state !== 'idle') continue;
      const p = pile.mesh.position;
      if (Math.hypot(p.x - near.x, p.z - near.z) > maxDistance) continue;
      out.push({ x: p.x, y: p.y, z: p.z, size: pile.fresh ? pile.size * 1.6 : pile.size });
    }
    return out;
  }

  /** Onde estão os montinhos fresquinhos inteiros (para o brilho e o Faro). */
  freshSpots(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0;
    for (const pile of this.piles) if (pile.state === 'idle' && pile.fresh) out.push(pile.mesh.position);
    return out;
  }

  /** Poder Faro: alguns montinhos comuns, sorteados, viram fresquinhos na hora. */
  promoteFresh(count: number): void {
    const plain = this.piles.filter((pile) => pile.state === 'idle' && !pile.fresh);
    for (let i = 0; i < count && plain.length > 0; i++) {
      const [pile] = plain.splice(Math.floor(this.rng.next() * plain.length), 1);
      this.setFresh(pile, true);
    }
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
      flyCount: 0,
      fresh: false,
      seed: this.rng.next() * 100,
      absorbFrom: new THREE.Vector3(),
      slot: this.pilePool.add(new THREE.Matrix4()),
    };
    for (let i = 0; i < MAX_FLIES; i++) pile.flies.push(this.buildFly(mesh));
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
    this.setFresh(pile, this.rng.next() < this.freshChance);
  }

  private setFresh(pile: DungPile, fresh: boolean): void {
    pile.fresh = fresh;
    // Metade dos comuns tem 1–2 moscas; o fresquinho junta todas.
    pile.flyCount = fresh ? MAX_FLIES : this.rng.next() < 0.5 ? 1 + Math.floor(this.rng.next() * 2) : 0;
    this.pilePool.setColor(pile.slot, fresh ? FRESH_TINT : PLAIN_TINT);
  }

  private buildFly(parent: THREE.Object3D): Fly {
    const body = new THREE.Object3D();
    // Raiz das asas no alto do tórax; a do lado -X é a mesma asa espelhada.
    const wingL = new THREE.Object3D();
    wingL.position.set(0.024, 0.048, -0.012);
    const wingR = new THREE.Object3D();
    wingR.position.set(-0.024, 0.048, -0.012);
    wingR.scale.x = -1;
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

  /** Sorteia um detrito da tabela e acha um lugar para ele (no cantinho dele, às vezes). */
  private spawnDebris(avoid?: THREE.Vector3): Debris {
    const rng = this.rng;
    const rule = pickRule(rng.next());
    const material: DebrisMaterial = rule.material === 'clover' && rng.next() < FOUR_LEAF_CHANCE ? 'fourLeaf' : rule.material;
    const built = this.buildDebris(material, rng);
    const zone = rule.zone && rng.next() < rule.zone.share ? this.zoneSpot(rule.zone.kind, built.size, avoid) : null;
    const spot = zone ?? this.randomFreeSpot(4, PLAY_RADIUS - 1, 0.3, avoid, avoid ? 12 : 0);
    return this.place(built, spot.x, spot.y);
  }

  /** Ponto livre dentro de um cantinho (em cima da toalha vale; dentro de objeto, não). */
  private zoneSpot(kind: ZoneKind, size: number, avoid?: THREE.Vector3): THREE.Vector2 | null {
    const zone = zoneOf(kind);
    if (!zone) return null;
    for (let i = 0; i < 30; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * zone.radius * 0.95;
      const x = zone.x + Math.cos(a) * d;
      const z = zone.z + Math.sin(a) * d;
      if (this.scenery.isInsideSolid(x, z, size * 0.4 + 0.1) || this.scenery.isDug(x, z)) continue;
      if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < 12) continue;
      return new THREE.Vector2(x, z);
    }
    return null;
  }

  /** Assenta um detrito no chão (ou na toalha) e o põe no pool de instâncias da variante dele. */
  private place(built: BuiltDebris, x: number, z: number): Debris {
    const { object, size } = built;
    object.castShadow = size > 0.28;
    object.receiveShadow = true;
    const y = terrainHeight(x, z) + this.scenery.coverHeight(x, z) + size * built.yOffset;
    object.position.set(x, y, z);
    object.updateMatrix();
    // Parado no chão ele é só uma instância; se o pool da variante lotar, vira Mesh comum.
    const pool = this.debrisPoolFor(object);
    const slot = pool.add(object.matrix);
    const tint = object.userData.instanceTint as THREE.Color | undefined;
    if (slot >= 0 && tint) pool.setColor(slot, tint);
    if (slot < 0) {
      if (tint) object.geometry = DebrisKit.tinted(object.geometry, tint);
      this.group.add(object);
    }
    return { object, size, material: built.material, active: true, pool: slot < 0 ? null : pool, slot };
  }

  /** Modela um detrito do material pedido (tamanho, pose e altura sorteados). */
  private buildDebris(material: Exclude<DebrisMaterial, 'pillbug'>, rng: Rng): BuiltDebris {
    let object: THREE.Mesh;
    let size: number;
    let yOffset = 0.15;
    const spin = () => rng.next() * Math.PI * 2;

    switch (material) {
      case 'pebble':
        size = rng.range(0.18, 0.7);
        object = DebrisKit.pebble(rng);
        object.scale.setScalar(size * 0.5);
        break;
      case 'twig': {
        const length = rng.range(0.6, 1.6);
        size = length * 0.55;
        object = DebrisKit.twig(rng);
        object.scale.set(1, length, 1);
        object.rotation.set(Math.PI / 2, rng.next() * Math.PI, 0);
        // Ao grudar, graveto deita tangente à bola em vez de ficar espetado.
        object.userData.lieTangent = true;
        yOffset = 0.05;
        break;
      }
      case 'leaf':
        size = rng.range(0.35, 0.9);
        object = DebrisKit.leaf(rng);
        object.scale.setScalar(size);
        object.rotation.y = spin();
        yOffset = 0.03;
        break;
      case 'berry':
        size = rng.range(0.2, 0.42);
        object = DebrisKit.berry(rng);
        object.scale.setScalar(size * 0.5);
        break;
      case 'seed':
        size = rng.range(0.25, 0.5);
        object = DebrisKit.seed();
        object.scale.setScalar(size);
        object.rotation.y = spin();
        yOffset = 0.08;
        break;
      case 'acorn':
        size = rng.range(0.35, 0.6);
        object = DebrisKit.acorn();
        object.scale.setScalar(size);
        object.rotation.set(rng.range(1.2, 1.5), spin(), 0, 'YXZ');
        yOffset = 0.12;
        break;
      case 'clover':
      case 'fourLeaf':
        size = rng.range(0.3, 0.55);
        object = material === 'fourLeaf' ? DebrisKit.fourLeaf() : DebrisKit.clover();
        object.scale.setScalar(size * 1.6);
        object.rotation.y = spin();
        yOffset = 0.02;
        break;
      case 'petal':
        size = rng.range(0.3, 0.6);
        object = DebrisKit.petal(rng);
        object.scale.setScalar(size);
        object.rotation.y = spin();
        yOffset = 0.02;
        break;
      case 'shell':
        size = rng.range(0.4, 0.75);
        object = DebrisKit.shell();
        object.scale.setScalar(size * 0.7);
        object.rotation.y = spin();
        yOffset = 0.02;
        break;
      case 'cap':
        size = rng.range(0.5, 0.8);
        object = DebrisKit.bottleCap(rng);
        object.scale.setScalar(size);
        object.rotation.set(0, spin(), 0);
        yOffset = 0.08;
        break;
      case 'cicadaShell':
        size = rng.range(0.5, 0.6);
        object = DebrisKit.cicadaShell();
        object.scale.setScalar(size * 1.9);
        object.rotation.set(rng.range(-0.1, 0.1), spin(), rng.range(-0.1, 0.1));
        yOffset = 0.4;
        break;
      case 'button':
        size = rng.range(0.35, 0.5);
        object = DebrisKit.button(rng);
        object.scale.setScalar(size * 0.95);
        object.rotation.set(rng.range(-0.08, 0.08), spin(), 0);
        yOffset = 0.12;
        break;
      case 'marble':
        size = rng.range(0.36, 0.44);
        object = DebrisKit.marble(rng);
        object.scale.setScalar(size);
        object.rotation.set(spin(), spin(), 0);
        yOffset = 0.9;
        break;
      case 'coin':
        size = rng.range(0.55, 0.65);
        object = DebrisKit.coin();
        object.scale.setScalar(size * 1.12);
        // Às vezes cai com a coroa para cima.
        object.rotation.set(rng.next() < 0.5 ? 0 : Math.PI, spin(), 0);
        yOffset = 0.09;
        break;
      case 'clip':
        size = rng.range(0.45, 0.55);
        object = DebrisKit.clip(rng);
        object.scale.setScalar(size * 2.2);
        object.rotation.y = spin();
        yOffset = 0.05;
        break;
      case 'brick':
        size = rng.range(0.42, 0.48);
        object = DebrisKit.brick(rng);
        object.scale.setScalar(size * 1.8);
        object.rotation.y = spin();
        yOffset = 0.52;
        break;
      case 'die':
        size = rng.range(0.42, 0.48);
        object = DebrisKit.die();
        object.scale.setScalar(size * 1.8);
        // Face sorteada para cima (giros de 90° em X e Z).
        object.rotation.set(Math.floor(rng.next() * 4) * (Math.PI / 2), spin(), Math.floor(rng.next() * 4) * (Math.PI / 2), 'YXZ');
        yOffset = 0.88;
        break;
      case 'jellybean':
        size = rng.range(0.32, 0.38);
        object = DebrisKit.jellybean(rng);
        object.scale.setScalar(size * 2.8);
        object.rotation.set(rng.range(-0.3, 0.3), spin(), rng.range(-0.2, 0.2));
        yOffset = 0.7;
        break;
      case 'sugarCube':
        size = rng.range(0.36, 0.44);
        object = DebrisKit.sugarCube();
        object.scale.setScalar(size * 2);
        object.rotation.y = spin();
        yOffset = 0.96;
        break;
      case 'popcorn':
        size = rng.range(0.35, 0.45);
        object = DebrisKit.popcorn(rng);
        object.scale.setScalar(size * 1.5);
        object.rotation.set(spin(), spin(), 0);
        yOffset = 0.75;
        break;
      case 'grape':
        size = rng.range(0.45, 0.55);
        object = DebrisKit.grape(rng);
        object.scale.setScalar(size);
        // Deitada de lado, com o toquinho do cabo para um lado qualquer.
        object.rotation.set(Math.PI / 2 + rng.range(-0.3, 0.3), spin(), 0, 'YXZ');
        yOffset = 0.95;
        break;
    }
    return { object, size, material, yOffset };
  }

  private debrisPoolFor(mesh: THREE.Mesh): InstancePool {
    const material = mesh.material as THREE.Material;
    const key = `${mesh.geometry.uuid}|${material.uuid}`;
    let pool = this.debrisPools.get(key);
    if (!pool) {
      // Tralha chata (moeda, botão, clipe, trevo) não precisa de sombra própria: o AO já assenta.
      pool = new InstancePool(mesh.geometry, material, 40, mesh.userData.flat !== true);
      pool.mesh.name = 'debris';
      // Cor por instância muda o programa do shader: todas as vagas ganham cor já na construção.
      if (mesh.userData.instanceTint) for (let i = 0; i < 40; i++) pool.setColor(i, WHITE);
      this.debrisPools.set(key, pool);
      this.group.add(pool.mesh);
    }
    return pool;
  }

  /**
   * Garante desde a construção os pools tingidos (mesmo que a variante ainda não
   * tenha nascido), para o `renderer.compile` já aquecer o programa com cor por
   * instância e o primeiro botão azul do meio da partida não engasgar.
   */
  private prepareTintedPools(): void {
    for (const mesh of DebrisKit.tintedPrototypes()) this.debrisPoolFor(mesh);
  }
}

/** Regra da tabela de sorteio para um número 0..1. */
function pickRule(roll: number): SpawnRule {
  let acc = 0;
  for (const rule of SPAWN_TABLE) {
    acc += rule.weight;
    if (roll < acc) return rule;
  }
  return SPAWN_TABLE[0];
}

const WHITE = new THREE.Color(1, 1, 1);
/** Pose de rascunho para escrever a matriz dos extras animados. */
const tmpPose = new THREE.Object3D();

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

/** Materiais dos detritos: cores nos vértices, três acabamentos. */
const DebrisMaterials = {
  matte: () => clay(0xffffff, { vertexColors: true, roughness: 0.8, sheen: 0.35, bump: 0.35, mottle: 0.1, mottleScale: 6 }),
  glossy: () => clay(0xffffff, { vertexColors: true, roughness: 0.3, sheen: 0.25, clearcoat: 0.8, bump: 0.05, mottle: 0.04, mottleScale: 6 }),
  soft: () => clay(0xffffff, { vertexColors: true, roughness: 0.68, sheen: 0.6, bump: 0.2, mottle: 0.08, mottleScale: 5, side: THREE.DoubleSide }),
  /** Vidro da bolinha de gude: bem liso e brilhante (opaco: vidro transparente não combina com massinha). */
  glass: () => clay(0xffffff, { vertexColors: true, roughness: 0.1, sheen: 0.15, clearcoat: 1, bump: 0, mottle: 0.02, mottleScale: 6 }),
  /** Casquinha de açúcar da jujuba. */
  candy: () => clay(0xffffff, { vertexColors: true, roughness: 0.22, sheen: 0.3, clearcoat: 0.9, bump: 0.08, mottle: 0.05, mottleScale: 8 }),
  /** Cubo de açúcar: áspero, mas com os cristais pegando luz (normal map forte + verniz). */
  sugar: () => clay(0xffffff, { vertexColors: true, roughness: 0.55, sheen: 0.5, clearcoat: 0.45, bump: 0.8, repeat: 3, mottle: 0.04, mottleScale: 10 }),
  metal: () => metalMaterial(),
};

let metal: THREE.MeshPhysicalMaterial | null = null;

/**
 * Metal (moeda, clipe): a massinha brilhante com metalicidade, para refletir o céu
 * do mapa de ambiente. `clay()` não tem metalicidade e devolve material de cache
 * (mexer nele mudaria outros), então é uma cópia com o mesmo shader de massinha.
 */
function metalMaterial(): THREE.MeshPhysicalMaterial {
  if (metal) return metal;
  const base = clay(0xffffff, { vertexColors: true, roughness: 0.32, sheen: 0.2, clearcoat: 0.6, bump: 0.12, mottle: 0.03, mottleScale: 7 });
  metal = base.clone();
  metal.onBeforeCompile = base.onBeforeCompile;
  metal.customProgramCacheKey = base.customProgramCacheKey;
  metal.metalness = 0.65;
  return metal;
}

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
const ButtonColors = ['#d9483b', '#2f4f8f', '#efe4c8', '#6cc4a1'];
const BrickColors = ['#e84a3c', '#2f6fd6', '#f2c230', '#3aa655'];
const JellybeanColors = ['#f0508a', '#f59a3a', '#f2d34a', '#7bc96a', '#9b62d1', '#e0393e', '#f4f0e6'];
const CLIP_SILVER = '#cdd5de';
const ClipColors = ['#d8443a', '#3f7fd6', '#f2c230'];
const MarblePalettes: readonly MarblePalette[] = [
  { glass: '#3b7fd0', swirl: '#ffffff', accent: '#f28c28' },
  { glass: '#3aa66a', swirl: '#f6e05a', accent: '#ffffff' },
  { glass: '#d9dfe6', swirl: '#e0393e', accent: '#2f6fd6' },
];

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
  /**
   * Detrito tingível: a geometria é cinza-clara e a cor vem por instância (uma
   * cor a mais não custa draw call). O evento de "grudou" leva a cor de verdade.
   */
  const tintable = (geometry: THREE.BufferGeometry, material: THREE.Material, color: THREE.ColorRepresentation, flat = false) => {
    const mesh = make(geometry, material, color);
    mesh.userData.instanceTint = new THREE.Color(color);
    if (flat) mesh.userData.flat = true;
    return mesh;
  };
  const tintedCache = new Map<string, THREE.BufferGeometry>();

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
    fourLeaf(): THREE.Mesh {
      const mesh = make(cached('fourLeaf', fourLeafGeometry), DebrisMaterials.soft(), '#4fae45');
      mesh.userData.flat = true;
      return mesh;
    },
    cicadaShell(): THREE.Mesh {
      return make(cached('cicadaShell', cicadaShellGeometry), DebrisMaterials.soft(), '#c9924a');
    },
    button(rng: Rng): THREE.Mesh {
      const holes = rng.next() < 0.5 ? 2 : 4;
      return tintable(cached(`button${holes}`, () => buttonGeometry(holes)), DebrisMaterials.glossy(), rng.pick(ButtonColors), true);
    },
    marble(rng: Rng): THREE.Mesh {
      const index = Math.floor(rng.next() * MarblePalettes.length);
      return make(cached(`marble${index}`, () => marbleGeometry(MarblePalettes[index], index * 1.7)), DebrisMaterials.glass(), MarblePalettes[index].glass);
    },
    coin(): THREE.Mesh {
      const mesh = make(cached('coin', coinGeometry), DebrisMaterials.metal(), '#d9b44a');
      mesh.userData.flat = true;
      return mesh;
    },
    clip(rng: Rng): THREE.Mesh {
      // A maioria é prateada; de vez em quando um encapado colorido.
      const color = rng.next() < 0.6 ? CLIP_SILVER : rng.pick(ClipColors);
      return tintable(cached('clip', clipGeometry), DebrisMaterials.metal(), color, true);
    },
    brick(rng: Rng): THREE.Mesh {
      return tintable(cached('brick', brickGeometry), DebrisMaterials.glossy(), rng.pick(BrickColors));
    },
    die(): THREE.Mesh {
      return make(cached('die', dieGeometry), DebrisMaterials.glossy(), '#f4efe6');
    },
    jellybean(rng: Rng): THREE.Mesh {
      return tintable(cached('jellybean', jellybeanGeometry), DebrisMaterials.candy(), rng.pick(JellybeanColors));
    },
    sugarCube(): THREE.Mesh {
      return make(cached('sugarCube', sugarCubeGeometry), DebrisMaterials.sugar(), '#f7f3ea');
    },
    popcorn(rng: Rng): THREE.Mesh {
      const variant = Math.floor(rng.next() * 2);
      return make(cached(`popcorn${variant}`, () => popcornGeometry(variant)), DebrisMaterials.matte(), '#f6e3a6');
    },
    grape(rng: Rng): THREE.Mesh {
      const green = rng.next() < 0.4;
      const g = cached(`grape${green}`, () => (green ? grapeGeometry('#a8c85a', '#e6eecb') : grapeGeometry('#5e3790', '#b7a6cf')));
      return make(g, DebrisMaterials.soft(), green ? '#9cc45a' : '#7b4fb8');
    },
    /** Um exemplar de cada detrito tingível (para criar os pools logo na construção). */
    tintedPrototypes(): THREE.Mesh[] {
      const glossy = DebrisMaterials.glossy();
      return [
        tintable(cached('button2', () => buttonGeometry(2)), glossy, '#ffffff', true),
        tintable(cached('button4', () => buttonGeometry(4)), glossy, '#ffffff', true),
        tintable(cached('clip', clipGeometry), DebrisMaterials.metal(), '#ffffff', true),
        tintable(cached('brick', brickGeometry), glossy, '#ffffff'),
        tintable(cached('jellybean', jellybeanGeometry), DebrisMaterials.candy(), '#ffffff'),
      ];
    },
    /** Geometria com a cor da instância assada nos vértices (para o Mesh que gruda na bola). */
    tinted(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
      const key = `${geometry.uuid}|${color.getHexString()}`;
      let g = tintedCache.get(key);
      if (!g) {
        g = geometry.clone();
        const colors = g.getAttribute('color') as THREE.BufferAttribute;
        for (let i = 0; i < colors.count; i++) colors.setXYZ(i, colors.getX(i) * color.r, colors.getY(i) * color.g, colors.getZ(i) * color.b);
        tintedCache.set(key, g);
      }
      return g;
    },
  };
})();
