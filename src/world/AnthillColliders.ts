import type * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { anthillHull } from '../fx/critters/groundModels';

/**
 * Colisão dos formigueiros: um casco convexo por montinho, sólido pra bola e
 * pro besouro (sobe a encosta como num calombo do chão; a bola rola por cima).
 *
 * Os formigueiros nascem com os bichos, no primeiro quadro de cada jardim, e
 * mudam de lugar a cada jardim novo: `sync` compara a lista de centros com a
 * última vista e refaz os colisores quando ela troca.
 */
export class AnthillColliders {
  private source: readonly THREE.Vector3[] | null = null;
  private count = 0;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly shape = anthillHull();

  constructor(private readonly physics: Physics) {}

  /** Chamar todo quadro com os centros atuais (`Effects.anthills`); só trabalha quando mudou. */
  sync(nests: readonly THREE.Vector3[]): void {
    if (nests === this.source && nests.length === this.count) return;
    this.source = nests;
    this.count = nests.length;
    const world = this.physics.world;
    for (const collider of this.colliders) world.removeCollider(collider, false);
    this.colliders.length = 0;
    for (const nest of nests) {
      const desc = RAPIER.ColliderDesc.convexHull(this.shape);
      if (!desc) continue;
      desc.setTranslation(nest.x, nest.y, nest.z).setFriction(0.9).setCollisionGroups(interactionGroups(Groups.WORLD, 0xffff));
      this.colliders.push(world.createCollider(desc));
    }
  }
}
