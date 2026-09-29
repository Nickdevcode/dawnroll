import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { terrainNormal } from '../world/Terrain';
import { BeetleModel } from './BeetleModel';
import { DizzyStars } from '../fx/DizzyStars';
import { accessory, isAccessoryId, type Outfit } from '../progression/accessories';
import { isSkinId, skin, DEFAULT_SKIN } from '../progression/skins';
import type { BeetlePose, NetLook } from '../net/protocol';
import { angleDelta, damp } from '../utils/math';

/** Mesmo tamanho do colisor do besouro local (o seu esbarra no dele). */
const COLLIDER_RADIUS = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const tmpNormal = new THREE.Vector3();
const tmpAlign = new THREE.Quaternion();
const tmpTurn = new THREE.Quaternion();
const tmpHead = new THREE.Vector3();

/**
 * O besouro de outro jogador: o mesmo modelo (casco, acessórios, patas,
 * piscada), animado pela pose que chega da rede (ver `PoseBuffer`), e um
 * colisor cinemático no lugar dele: o seu besouro esbarra nele (e a câmera
 * desvia). A sua bola passa por ele (senão ele a arremessaria).
 */
export class RemoteBeetle {
  readonly model = new BeetleModel();
  /** Estrelinhas de tonto (trombada): o online põe na cena junto do modelo. */
  readonly stars = new DizzyStars();
  private dizzy = false;
  /** Projeta sombra agora (longe da câmera não: cada peça do besouro é mais um desenho no passe de sombra). */
  private shadows = true;
  private readonly body: RAPIER.RigidBody;
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private prevYaw = 0;
  private currYaw = 0;
  private placed = false;
  private readonly groundUp = new THREE.Vector3(0, 1, 0);
  private readonly pose = { speed: 0, grounded: true, pushBlend: 0, pushSpeed: 0, verticalSpeed: 0, strain: 0 };
  private look: NetLook | null = null;

  constructor(private readonly physics: Physics) {
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    physics.world.createCollider(
      // Só o seu besouro (e a câmera) batem nele. A sua bola não: corpo cinemático empurra com
      // massa infinita, e um besouro encostando arremessava até a bola de 30 cm (e tirava da mão do dono).
      RAPIER.ColliderDesc.ball(COLLIDER_RADIUS).setFriction(0.6).setCollisionGroups(interactionGroups(Groups.WORLD, 0xffff & ~Groups.BALL)),
      this.body,
    );
    this.model.root.name = 'remote-beetle';
  }

  /** Veste o visual que o jogador escolheu (id desconhecido vira o casco padrão / slot vazio). */
  setLook(look: NetLook): void {
    const current = this.look;
    if (current && current.skin === look.skin && current.head === look.head && current.face === look.face && current.neck === look.neck && current.back === look.back) return;
    this.look = { ...look };
    this.model.setSkin(skin(isSkinId(look.skin) ? look.skin : DEFAULT_SKIN));
    const outfit: Outfit = { head: null, face: null, neck: null, back: null };
    for (const slot of ['head', 'face', 'neck', 'back'] as const) {
      const id = look[slot];
      // Acessório do lugar errado (cliente modificado) não veste.
      if (id && isAccessoryId(id) && accessory(id).slot === slot) outfit[slot] = id;
    }
    this.model.setOutfit(outfit);
    // Acessório novo nasce projetando sombra: segue o estado atual.
    if (!this.shadows) this.applyShadows();
  }

  /**
   * Liga/desliga a sombra do besouro (o online desliga dos que estão longe da
   * câmera). Guarda o que cada peça fazia, pra devolver igual ao ligar de novo.
   */
  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.applyShadows();
  }

  private applyShadows(): void {
    this.model.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.castShadowDefault === undefined) mesh.userData.castShadowDefault = mesh.castShadow;
      mesh.castShadow = this.shadows && mesh.userData.castShadowDefault === true;
    });
  }

  /** Passo fixo: vai pra pose interpolada (os pés, como no retrato) e guarda o resto pra animação. */
  drive(beetle: BeetlePose, ballSpeed: number, ballRadius: number): void {
    this.prev.copy(this.curr);
    this.prevYaw = this.currYaw;
    this.curr.set(beetle.x, beetle.y, beetle.z);
    this.currYaw = beetle.yaw;
    if (!this.placed) {
      // Primeira pose: nasce lá (sem voar do nada até o lugar).
      this.prev.copy(this.curr);
      this.prevYaw = this.currYaw;
      this.placed = true;
    }
    this.body.setNextKinematicTranslation({ x: beetle.x, y: beetle.y + COLLIDER_RADIUS, z: beetle.z });
    const p = this.pose;
    p.speed = beetle.riding ? ballSpeed : beetle.speed;
    p.grounded = beetle.grounded || beetle.riding;
    p.pushBlend = beetle.pushBlend;
    p.pushSpeed = ballSpeed / Math.max(ballRadius, 0.3);
    p.verticalSpeed = beetle.vy;
    p.strain = beetle.strain;
    this.dizzy = beetle.dizzy;
  }

  /** Visual interpolado entre passos (mesmo esquema do besouro local). */
  render(alpha: number, dt: number): void {
    const root = this.model.root;
    root.position.lerpVectors(this.prev, this.curr, alpha);
    const yaw = this.prevYaw + angleDelta(this.prevYaw, this.currYaw) * alpha;
    // Alinha ao chão devagar (a normal do terreno muda aos saltos entre triângulos).
    terrainNormal(root.position.x, root.position.z, tmpNormal);
    this.groundUp.x = damp(this.groundUp.x, tmpNormal.x, 8, dt);
    this.groundUp.y = damp(this.groundUp.y, tmpNormal.y, 8, dt);
    this.groundUp.z = damp(this.groundUp.z, tmpNormal.z, 8, dt);
    this.groundUp.normalize();
    root.quaternion.copy(tmpAlign.setFromUnitVectors(UP, this.groundUp)).multiply(tmpTurn.setFromAxisAngle(UP, yaw));
    this.model.update(dt, this.pose);
    this.stars.update(dt, this.model.getHeadPosition(tmpHead), this.dizzy);
  }

  /** Posição dos pés agora (placa do apelido, som). */
  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.model.root.removeFromParent();
    this.stars.dispose();
  }
}
