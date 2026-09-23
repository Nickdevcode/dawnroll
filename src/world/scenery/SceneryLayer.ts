import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../../core/Physics';
import { StaticBatch, type RemovableParts } from '../../render/StaticBatch';
import type { Rng } from '../../utils/math';
import type { ContactShade } from '../Terrain';
import type { CoverArea, PickableSpec, SceneryContext } from './context';
import { fitColliders, type FitSink } from './colliderFit';

const solidGroups = interactionGroups(Groups.WORLD, 0xffff);
/** Casco só da câmera: nada físico encosta nele, só a consulta da lente. */
const cameraGroups = interactionGroups(Groups.CAMERA, Groups.CAMERA);

/** Área coberta já com seno/cosseno do giro (o teste roda milhares de vezes na grama). */
interface Cover extends CoverArea {
  readonly cos: number;
  readonly sin: number;
  /** Raio do círculo que envolve o retângulo (descarte rápido). */
  readonly bound: number;
}

/** Um círculo ocupado no chão. */
export interface Placement {
  x: number;
  z: number;
  radius: number;
}

/** Um arrancável registrado, com o estado de jogo dele. */
export interface PickableRecord extends PickableSpec {
  readonly id: number;
  /** Meio da cápsula de contato (para descartar rápido o que está longe). */
  readonly center: THREE.Vector3;
  /** Metade do comprimento da cápsula + raio (alcance a partir do centro). */
  readonly reach: number;
  picked: boolean;
}

/**
 * Uma camada de cenário: tudo que um sorteio pôs no mundo (peças assadas num
 * lote estático, colisores, áreas sólidas e cobertas, sombras de contato, pontos
 * de pouso e arrancáveis). O horizonte é uma camada que nasce uma vez; o jardim
 * é outra, refeita a cada rodada.
 *
 * Camada "adiada" nasce com os colisores desligados: ela pode ser montada aos
 * poucos enquanto o jogo roda (o jardim da próxima rodada) e só passa a existir
 * para a física no `activate()`.
 */
export class SceneryLayer {
  readonly group = new THREE.Group();
  /** Pontos de pouso para borboletas e abelhas. Array vivo: some o que foi arrancado. */
  readonly landingSpots: THREE.Vector3[] = [];
  readonly shades: ContactShade[] = [];
  readonly pickables: PickableRecord[] = [];
  /** Círculos ocupados (nada novo nasce em cima). */
  readonly placements: Placement[] = [];
  /** Áreas cavadas (toca e poças): nada de enfeite solto dentro delas. */
  readonly dug: Placement[] = [];

  private readonly solids: Placement[] = [];
  private readonly covers: Cover[] = [];
  private readonly batch = new StaticBatch();
  private readonly body: RAPIER.RigidBody;
  private readonly colliders: RAPIER.Collider[] = [];
  private removables: RemovableParts | null = null;
  private active: boolean;

  constructor(
    private readonly physics: Physics,
    deferred: boolean,
    name: string,
  ) {
    this.active = !deferred;
    this.group.name = name;
    // Um corpo fixo só para a camada inteira: jogar a camada fora é remover um corpo.
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** O que os construtores de cenário recebem para montar dentro desta camada. */
  context(rng: Rng, decor: number): SceneryContext {
    return {
      rng,
      batch: this.batch,
      decor,
      addCollider: (desc, position, rotation) => this.addCollider(desc, solidGroups, position, rotation),
      addSolid: (x, z, radius) => this.solids.push({ x, z, radius }),
      addShade: (x, z, radius, strength) => this.shades.push({ x, z, radius, strength }),
      addLandingSpot: (p) => {
        const spot = p.clone();
        this.landingSpots.push(spot);
        return spot;
      },
      addPickable: (spec) => this.addPickable(spec),
      addCover: (area) => {
        this.covers.push({ ...area, cos: Math.cos(area.yaw), sin: Math.sin(area.yaw), bound: Math.hypot(area.halfWidth, area.halfLength) });
      },
      reserve: (x, z, radius) => this.placements.push({ x, z, radius }),
    };
  }

  /**
   * Funde o lote (um balde por passo, para caber entre dois quadros) e guarda os
   * removíveis. Depois disso a camada está pronta.
   */
  *finish(): Generator<void, void> {
    const built = yield* this.batch.buildSteps();
    this.group.add(built);
    this.removables = this.batch.removables;
  }

  /** Liga os colisores de uma camada adiada (a troca de jardim). */
  activate(): void {
    if (this.active) return;
    this.active = true;
    for (const collider of this.colliders) collider.setEnabled(true);
    // O que já estava arrancado (não deveria, mas não custa) continua desligado.
    for (const record of this.pickables) if (record.picked) for (const c of record.colliders) c.setEnabled(false);
  }

  /** Tira a camada do mundo: física some agora; as malhas fundidas são só dela. */
  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.group.removeFromParent();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      // O material vem do cache do `clay` (compartilhado com o jardim novo): só a geometria é desta camada.
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  // --- Consultas ---------------------------------------------------------------

  isFree(x: number, z: number, radius: number): boolean {
    for (const p of this.placements) if (Math.hypot(p.x - x, p.z - z) <= p.radius + radius) return false;
    return true;
  }

  isInsideSolid(x: number, z: number, margin = 0): boolean {
    for (const s of this.solids) {
      const dx = s.x - x;
      const dz = s.z - z;
      const r = s.radius + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  isCovered(x: number, z: number, margin = 0): boolean {
    for (const c of this.covers) if (insideCover(c, x, z, margin)) return true;
    return false;
  }

  /** Quanto a superfície fica acima do terreno num ponto (a toalha ondulada); 0 fora dela. */
  coverHeight(x: number, z: number): number {
    for (const c of this.covers) if (c.lift && insideCover(c, x, z, 0)) return c.lift(x, z);
    return 0;
  }

  isDug(x: number, z: number): boolean {
    return this.dug.some((d) => Math.hypot(d.x - x, d.z - z) < d.radius);
  }

  // --- Arrancáveis ---------------------------------------------------------------

  detach(record: PickableRecord): void {
    if (record.picked) return;
    record.picked = true;
    this.removables?.hide(record.id);
    for (const collider of record.colliders) collider.setEnabled(false);
    for (const spot of record.landingSpots) {
      const i = this.landingSpots.indexOf(spot);
      if (i >= 0) this.landingSpots.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------

  private addPickable(spec: PickableSpec): void {
    const id = this.pickables.length;
    this.batch.addObject(spec.root, { ...spec.batch, removableId: id });
    // O que os colisores à mão deixaram de fora ganha casco (sólido ou só de câmera).
    const fitted = fitColliders(spec.root, spec.colliders, spec.root.position.y, this.fitSink);
    const colliders = fitted.length > 0 ? [...spec.colliders, ...fitted] : spec.colliders;
    const center = spec.probeA.clone().add(spec.probeB).multiplyScalar(0.5);
    const reach = spec.probeA.distanceTo(spec.probeB) / 2 + spec.probeRadius;
    this.pickables.push({ ...spec, colliders, id, center, reach, picked: false });
  }

  private readonly fitSink: FitSink = {
    solid: (desc, position) => this.addCollider(desc, solidGroups, position),
    soft: (desc, position) => this.addCollider(desc, cameraGroups, position),
  };

  private addCollider(desc: RAPIER.ColliderDesc, groups: number, position: THREE.Vector3, rotation?: THREE.Quaternion): RAPIER.Collider {
    desc.setTranslation(position.x, position.y, position.z).setCollisionGroups(groups).setFriction(0.9).setEnabled(this.active);
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const collider = this.physics.world.createCollider(desc, this.body);
    this.colliders.push(collider);
    return collider;
  }
}

function insideCover(c: Cover, x: number, z: number, margin: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const reach = c.bound + margin;
  if (dx * dx + dz * dz > reach * reach) return false;
  // Coordenadas locais do retângulo (o comprimento é o Z local depois do giro).
  const lx = dx * c.cos - dz * c.sin;
  const lz = dx * c.sin + dz * c.cos;
  return Math.abs(lx) <= c.halfWidth + margin && Math.abs(lz) <= c.halfLength + margin;
}
