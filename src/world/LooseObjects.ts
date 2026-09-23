import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import type { DungBall } from '../entities/DungBall';
import { BURROW, terrainHeight } from './Terrain';
import { zoneOf } from './zones';
import type { PickEvent } from './Pickables';
import type { Scenery } from './Scenery';
import { OBJECT_STATS } from './objects/common';
import { tennisBallSpots } from './objects/toys';
import { TENNIS_BALL_RADIUS, tennisBallGeometry } from './objects/tennisBall';

/**
 * Objetos soltos, com física de verdade: as bolas de tênis do cantinho dos
 * brinquedos. São corpos dinâmicos leves (bola de tênis é oca): a bola de bosta
 * pequena empurra, chuta e faz quicar; quando ela chega ao tamanho, engole.
 *
 * Grupo de colisão: pertencem ao MUNDO (o controlador do besouro e o raio da
 * câmera as enxergam como obstáculo, igual a uma pedra) e colidem com mundo,
 * bola e besouro. O besouro é cinemático e empurra com o "controlador" parando
 * antes de encostar; se uma bola de tênis rolar contra ele, ela é que quica
 * (o solver trata o besouro como parede).
 */

const STATS = OBJECT_STATS.tennisBall;
/** Densidade baixa: é oca (≈ 58 g numa bola de 6,7 cm). */
const DENSITY = 0.12;
/** Folga para "encostou" (o contato físico já freia antes de sobrepor). */
const TOUCH_MARGIN = 0.15;
/** Caiu para fora do mundo ou entrou na toca: volta para casa. */
const FALL_LIMIT = -30;
const TINT = new THREE.Color('#cfe04a');

interface LooseItem {
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Mesh;
  readonly home: THREE.Vector3;
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  readonly prevRot: THREE.Quaternion;
  readonly currRot: THREE.Quaternion;
  swallowed: boolean;
}

const tmpCenter = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

export class LooseObjects {
  readonly group = new THREE.Group();
  /** A bola engoliu um objeto solto (mesmo evento dos arrancáveis). */
  onPick: ((event: PickEvent) => void) | null = null;
  /** Poder Chifrudo: engole até `raio da bola × pluckReach`. */
  pluckReach = 1;
  /** Raio de bola que falta para engolir o que ela está encostando agora (0 = nada). */
  blockedBySize = 0;

  private readonly items: LooseItem[] = [];
  private readonly geometry = tennisBallGeometry();
  // Feltro: bem fosco e com muito brilho de borda (a penugem pega luz de lado).
  private readonly material = clay(0xffffff, { vertexColors: true, roughness: 0.95, sheen: 1, bump: 0.55, repeat: 2, mottle: 0.1, mottleScale: 3 });

  constructor(
    private readonly physics: Physics,
    private readonly scenery?: Scenery,
  ) {
    this.group.name = 'loose-objects';
    const zone = zoneOf('toys');
    if (!zone) return;
    for (const spot of tennisBallSpots(zone)) this.items.push(this.createBall(this.freeSpot(spot)));
  }

  /** Passo fixo (depois do passo da física): interpolação, freio de rolamento e "engolir". */
  fixedUpdate(ball: DungBall): void {
    this.blockedBySize = 0;
    const center = ball.position(tmpCenter);
    const r = ball.radius;
    for (const item of this.items) {
      if (item.swallowed) continue;
      const body = item.body;
      item.prevPos.copy(item.currPos);
      item.prevRot.copy(item.currRot);
      const t = body.translation();
      const q = body.rotation();
      item.currPos.set(t.x, t.y, t.z);
      item.currRot.set(q.x, q.y, q.z, q.w);

      // Fugiu do mapa ou caiu na toca (taparia a boca): some e volta para casa.
      if (t.y < FALL_LIMIT || Math.hypot(t.x - BURROW.x, t.z - BURROW.z) < BURROW.radius * 1.1) {
        this.resetItem(item);
        continue;
      }

      // Resistência ao rolamento (o Rapier não tem): feltro na grama para logo.
      if (!body.isSleeping()) {
        const v = body.linvel();
        const w = body.angvel();
        const speed = Math.hypot(v.x, v.z);
        const k = Math.exp(-(speed < 0.6 ? 2.8 : 0.3) * (1 / 60));
        body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, false);
        body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, false);
      }

      if (!ball.isSolid) continue;
      const gap = item.currPos.distanceTo(center) - r - TENNIS_BALL_RADIUS;
      if (gap > TOUCH_MARGIN) continue;
      if (r * this.pluckReach >= STATS.size) this.swallow(item, ball, center);
      else this.blockedBySize = Math.max(this.blockedBySize, STATS.size / this.pluckReach);
    }
  }

  /** Desenho interpolado entre os passos fixos. */
  render(alpha: number): void {
    for (const item of this.items) {
      if (item.swallowed) continue;
      item.mesh.position.lerpVectors(item.prevPos, item.currPos, alpha);
      item.mesh.quaternion.slerpQuaternions(item.prevRot, item.currRot, alpha);
    }
  }

  /** Rodada nova: tudo volta para o lugar de origem, parado. */
  restoreAll(): void {
    for (const item of this.items) this.resetItem(item);
  }

  // ---------------------------------------------------------------------------

  private createBall(home: THREE.Vector3): LooseItem {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(home.x, home.y, home.z).setLinearDamping(0.05).setAngularDamping(0.25).setCcdEnabled(true),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(TENNIS_BALL_RADIUS)
        .setDensity(DENSITY)
        .setFriction(0.9)
        .setRestitution(0.55)
        .setCollisionGroups(interactionGroups(Groups.WORLD, Groups.WORLD | Groups.BALL | Groups.PLAYER)),
      body,
    );
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(home);
    this.group.add(mesh);
    return {
      body,
      mesh,
      home,
      prevPos: home.clone(),
      currPos: home.clone(),
      prevRot: new THREE.Quaternion(),
      currRot: new THREE.Quaternion(),
      swallowed: false,
    };
  }

  /** Ponto de partida: o lugar reservado no cantinho, afastado de algum sólido se precisar. */
  private freeSpot(spot: THREE.Vector2): THREE.Vector3 {
    let x = spot.x;
    let z = spot.y;
    for (let i = 0; i < 12 && this.scenery?.isInsideSolid(x, z, TENNIS_BALL_RADIUS); i++) {
      const a = i * 2.4;
      x = spot.x + Math.cos(a) * (0.6 + i * 0.3);
      z = spot.y + Math.sin(a) * (0.6 + i * 0.3);
    }
    return new THREE.Vector3(x, terrainHeight(x, z) + TENNIS_BALL_RADIUS + 0.02, z);
  }

  private resetItem(item: LooseItem): void {
    const { body, home } = item;
    body.setEnabled(true);
    body.setTranslation(home, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    item.prevPos.copy(home);
    item.currPos.copy(home);
    item.prevRot.identity();
    item.currRot.identity();
    item.mesh.position.copy(home);
    item.mesh.quaternion.identity();
    item.mesh.visible = true;
    item.swallowed = false;
  }

  /**
   * A bola engoliu: o corpo sai da física, a bola do mundo some e uma cópia
   * (mesma malha e material) gruda na bola — a original fica guardada para a
   * rodada nova (a bola de bosta apaga o que grudou quando reinicia).
   */
  private swallow(item: LooseItem, ball: DungBall, center: THREE.Vector3): void {
    item.swallowed = true;
    item.body.setEnabled(false);
    item.mesh.visible = false;

    const stuck = new THREE.Mesh(this.geometry, this.material);
    stuck.castShadow = true;
    stuck.receiveShadow = true;
    stuck.position.copy(item.currPos);
    stuck.quaternion.copy(item.currRot);
    stuck.updateMatrixWorld(true);
    const extent = TENNIS_BALL_RADIUS * 2;
    const scale = Math.min(1, (ball.radius * 1.4) / extent);
    ball.stick(stuck, { depth: TENNIS_BALL_RADIUS * 0.45 * scale, scale, burySize: extent * scale * 0.7 });
    ball.addVolume(STATS.volume);
    ball.itemCount++;

    const toItem = tmpDir.copy(item.currPos).sub(center);
    if (toItem.lengthSq() < 1e-6) toItem.set(0, 1, 0);
    this.onPick?.({
      kind: 'object',
      position: center.clone().addScaledVector(toItem.normalize(), ball.radius),
      ground: new THREE.Vector3(item.currPos.x, terrainHeight(item.currPos.x, item.currPos.z), item.currPos.z),
      tint: TINT.clone(),
      size: STATS.size,
      variant: 'tennisBall',
    });
  }
}
