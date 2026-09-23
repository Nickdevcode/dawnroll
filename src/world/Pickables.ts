import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { bakeObject } from '../render/StaticBatch';
import type { DungBall, StickOptions } from '../entities/DungBall';
import type { PickableFinish, PickableKind } from './scenery/context';
import type { PickableRecord, Scenery } from './Scenery';

/**
 * Katamari do jardim: quando a bola fica maior que uma flor, um cogumelo, uma
 * pedra ou um tronco, encostar nele o arranca do chão e ele gruda na bola.
 * Menor que isso, a bola só bate (e o jogo avisa quanto falta crescer).
 */

export interface PickEvent {
  kind: PickableKind;
  /** Ponto na superfície da bola onde o objeto encostou. */
  position: THREE.Vector3;
  /** Pé do objeto no chão (de onde sai a terra). */
  ground: THREE.Vector3;
  tint: THREE.Color;
  /** Tamanho do que foi arrancado (≈ raio mínimo de bola). */
  size: number;
  /** Espécie (flor e cogumelo), para o catálogo da toca. */
  variant: string | undefined;
}

/** O arrancável grande demais que a bola está encostando agora (ver `Pickables.blocked`). */
export interface BlockedContact {
  kind: PickableKind;
  variant: string | undefined;
  /** Ponto da superfície do objeto do lado da bola (de onde cai a tralha na trombada). */
  point: THREE.Vector3;
  /** Raio de bola que o objeto pede. */
  size: number;
}

/** Folga para "encostou" pela cápsula (colisor ainda não tocou, mas vai). */
const TOUCH_MARGIN = 0.14;
/** Folga para avisar "bola pequena demais" (quase encostando). */
const WARN_MARGIN = 0.4;

/** Como cada tipo gruda: quanto afunda, quanto deita e que acabamento tem. */
const StickStyles: Record<PickableKind, { depth: number; lean: [number, number]; lieTangent: boolean }> = {
  // Flor e cogumelo têm a origem no pé: o pé afunda e o resto deita por cima da bola.
  flower: { depth: 0.08, lean: [0.9, 1.3], lieTangent: false },
  mushroom: { depth: 0.14, lean: [0.7, 1.2], lieTangent: false },
  // Pedra tem a origem no meio: afunda até a metade.
  rock: { depth: 0.24, lean: [0, Math.PI], lieTangent: false },
  // Tronco também tem a origem no meio, com o comprimento no Y local: deita tangente.
  log: { depth: 0.05, lean: [0, 0.25], lieTangent: true },
  // Objeto (brinquedo, fruta, ferramenta): origem no pé, afunda um pouco e tomba de lado.
  object: { depth: 0.12, lean: [0.6, 1.4], lieTangent: false },
};

const Materials: Record<Exclude<PickableKind, 'object'>, () => THREE.Material> = {
  flower: () => clay(0xffffff, { vertexColors: true, roughness: 0.66, sheen: 0.7, bump: 0.16, mottle: 0.07, mottleScale: 1.8, side: THREE.DoubleSide }),
  mushroom: () => clay(0xffffff, { vertexColors: true, roughness: 0.62, sheen: 0.6, bump: 0.2, clearcoat: 0.2, mottle: 0.08, mottleScale: 1.4, side: THREE.DoubleSide }),
  rock: () => clay(0xffffff, { vertexColors: true, roughness: 0.82, sheen: 0.35, bump: 0.55, mottle: 0.14, mottleScale: 0.7 }),
  log: () => clay(0xffffff, { vertexColors: true, roughness: 0.86, sheen: 0.3, bump: 0.6, mottle: 0.14, mottleScale: 0.6, side: THREE.DoubleSide }),
};

/**
 * Objeto de gente escolhe o acabamento pelo que ele é: plástico e resina
 * brilham, barro e pano são foscos, fruta e borracha ficam aveludadas. Os mesmos
 * perfis do lote estático, para ele não mudar de cara ao grudar.
 */
const FinishMaterials: Record<PickableFinish, () => THREE.Material> = {
  glossy: () => clay(0xffffff, { vertexColors: true, roughness: 0.5, sheen: 0.55, bump: 0.18, clearcoat: 0.35, mottle: 0.08, mottleScale: 1.2, side: THREE.DoubleSide }),
  matte: () => clay(0xffffff, { vertexColors: true, roughness: 0.78, sheen: 0.45, bump: 0.4, mottle: 0.1, mottleScale: 0.9, side: THREE.DoubleSide }),
  soft: () => clay(0xffffff, { vertexColors: true, roughness: 0.7, sheen: 0.65, bump: 0.22, mottle: 0.08, mottleScale: 1.6, side: THREE.DoubleSide }),
};

const materialFor = (record: PickableRecord): THREE.Material =>
  record.kind === 'object' ? FinishMaterials[record.finish ?? 'glossy']() : Materials[record.kind]();

const tmpCenter = new THREE.Vector3();
const tmpClosest = new THREE.Vector3();
const tmpSeg = new THREE.Vector3();

/** Ponto do segmento AB mais perto de P. */
function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const ab = tmpSeg.subVectors(b, a);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-8 ? THREE.MathUtils.clamp(target.subVectors(p, a).dot(ab) / len2, 0, 1) : 0;
  return target.copy(a).addScaledVector(ab, t);
}

export class Pickables {
  onPick: ((event: PickEvent) => void) | null = null;
  /**
   * Tamanho de bola (raio) que falta para arrancar o que ela está encostando
   * agora; 0 = nada grande demais encostado. Lido pelo HUD (dica).
   */
  blockedBySize = 0;
  /**
   * O arrancável grande demais que a bola está encostando agora (o maior, se
   * forem vários), ou null. Atualizado a cada passo fixo; o objeto é reaproveitado
   * de um passo para o outro (copie o ponto se precisar guardar).
   */
  blocked: BlockedContact | null = null;
  /** Poder Chifrudo: arranca objeto até `raio da bola × pluckReach` (1 = só o que cabe). */
  pluckReach = 1;

  /** Geometria assada de cada arrancável (feita na primeira vez que ele é pego). */
  private readonly baked = new Map<number, THREE.BufferGeometry>();
  private readonly blockedContact: BlockedContact = { kind: 'rock', variant: undefined, point: new THREE.Vector3(), size: 0 };
  /** Tamanho do maior objeto barrando neste passo (0 = nenhum ainda). */
  private blockedSize = 0;

  constructor(
    private readonly physics: Physics,
    private readonly scenery: Scenery,
  ) {}

  /** Passo fixo: encostou e cabe = arranca; encostou e não cabe = avisa. */
  fixedUpdate(ball: DungBall, random: () => number = Math.random): void {
    this.blockedBySize = 0;
    this.blocked = null;
    this.blockedSize = 0;
    if (!ball.isSolid) return;
    const center = ball.position(tmpCenter);
    const r = ball.radius;

    for (const record of this.scenery.pickables) {
      if (record.picked) continue;
      // Descarte rápido pelo meio da cápsula.
      if (center.distanceToSquared(record.center) > (r + record.reach + WARN_MARGIN) ** 2) continue;
      const gap = closestOnSegment(center, record.probeA, record.probeB, tmpClosest).distanceTo(center) - record.probeRadius - r;
      if (gap > WARN_MARGIN) continue;

      const touching = gap < TOUCH_MARGIN || this.isTouching(ball, record);
      if (!touching) continue;
      if (r * this.pluckReach >= record.size) this.absorb(record, ball, center, random);
      else {
        this.blockedBySize = Math.max(this.blockedBySize, record.size / this.pluckReach);
        if (record.size > this.blockedSize) this.markBlocked(record, center);
      }
    }
  }

  /** Guarda o maior objeto barrando a bola: tipo, espécie e o ponto da superfície dele do lado da bola. */
  private markBlocked(record: PickableRecord, center: THREE.Vector3): void {
    const contact = this.blockedContact;
    closestOnSegment(center, record.probeA, record.probeB, contact.point);
    const toBall = tmpSeg.subVectors(center, contact.point);
    if (toBall.lengthSq() > 1e-8) contact.point.addScaledVector(toBall.normalize(), record.probeRadius);
    contact.kind = record.kind;
    contact.variant = record.variant;
    contact.size = record.size;
    this.blockedSize = record.size;
    this.blocked = contact;
  }

  /** O colisor da bola está em contato (de verdade) com algum colisor do objeto? */
  private isTouching(ball: DungBall, record: PickableRecord): boolean {
    let touching = false;
    for (const collider of record.colliders) {
      this.physics.world.contactPair(ball.collider, collider, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
      if (touching) return true;
    }
    return false;
  }

  private absorb(record: PickableRecord, ball: DungBall, center: THREE.Vector3, random: () => number): void {
    this.scenery.detach(record);

    let geometry = this.baked.get(record.id);
    if (!geometry) {
      geometry = bakeObject(record.root);
      this.baked.set(record.id, geometry);
    }
    const mesh = new THREE.Mesh(geometry, materialFor(record));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    record.root.updateMatrixWorld(true);
    record.root.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld(true);

    // Cabe na bola: coisa muito comprida "amassa" um pouco ao grudar (senão vira espeto).
    const scale = Math.min(1, (ball.radius * 1.4) / record.extent);
    const style = StickStyles[record.kind];
    const options: StickOptions = {
      depth: record.extent * scale * style.depth,
      lean: style.lean[0] + (style.lean[1] - style.lean[0]) * random(),
      lieTangent: style.lieTangent,
      scale,
      // Coisa grande demora mais para ser soterrada pela bosta.
      burySize: record.extent * scale * 0.7,
    };
    ball.stick(mesh, options);
    ball.addVolume(record.volume);
    ball.itemCount++;

    const toObject = tmpSeg.copy(record.center).sub(center);
    if (toObject.lengthSq() < 1e-6) toObject.set(0, 1, 0);
    const contact = center.clone().addScaledVector(toObject.normalize(), ball.radius);
    this.onPick?.({
      kind: record.kind,
      position: contact,
      ground: record.probeA.clone(),
      tint: new THREE.Color(record.tint),
      size: record.size,
      variant: record.variant,
    });
  }
}
