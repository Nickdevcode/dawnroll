import * as THREE from 'three';
import { dampAngle } from '../../utils/math';
import { terrainHeight, terrainNormal } from '../../world/Terrain';
import { UP, groundSpotNear, puddleAt } from './common';
import type { CritterContext } from './types';

const tmpNormal = new THREE.Vector3();
const qAlign = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const vScale = new THREE.Vector3();

/**
 * Andar de bicho de chão: passeia devagar em volta de um "canto", colado no
 * relevo, com pausas. Se o jogador se afasta muito, o canto se muda para perto
 * dele — fora da vista da câmera. Reaproveitado por joaninha, caracol e tatuzinho.
 */
export class GroundWalker {
  readonly position = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  readonly groundUp = new THREE.Vector3(0, 1, 0);
  yaw = 0;
  pause = 0;
  /** Distância andada no último passo (para a animação das patas). */
  moved = 0;

  constructor(
    private readonly wander: number,
    public stickToGround = true,
  ) {}

  /** Muda o canto para perto do jogador. Devolve false se não achou lugar (tenta de novo depois). */
  relocate(ctx: CritterContext, min: number, max: number, hidden: boolean): boolean {
    if (!groundSpotNear(ctx, min, max, hidden, this.home)) return false;
    this.position.copy(this.home);
    this.target.copy(this.home);
    this.yaw = ctx.rng.next() * Math.PI * 2;
    this.pause = ctx.rng.range(0.2, 1.5);
    this.groundUp.copy(terrainNormal(this.home.x, this.home.z, tmpNormal));
    return true;
  }

  /** Um passo de passeio. `speed` 0 = parado (pensando). */
  step(dt: number, ctx: CritterContext, speed: number, turnRate = 3): void {
    const pos = this.position;
    this.moved = 0;
    if (this.pause > 0) {
      this.pause -= dt;
    } else if (speed > 0) {
      const dx = this.target.x - pos.x;
      const dz = this.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.1) {
        this.pause = ctx.rng.range(0.5, 3);
        this.pickWanderTarget(ctx);
      } else {
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), turnRate, dt);
        const step = Math.min(dist, speed * dt);
        const nx = pos.x + Math.sin(this.yaw) * step;
        const nz = pos.z + Math.cos(this.yaw) * step;
        // Não entra em pedra nem em água: desiste do destino e pensa de novo.
        if (!ctx.isGroundFree(nx, nz) || puddleAt(ctx, nx, nz, 0.15)) {
          this.pause = ctx.rng.range(0.3, 1);
          this.pickWanderTarget(ctx);
        } else {
          pos.x = nx;
          pos.z = nz;
          this.moved = step;
        }
      }
    }
    if (this.stickToGround) {
      pos.y = terrainHeight(pos.x, pos.z);
      this.groundUp.lerp(terrainNormal(pos.x, pos.z, tmpNormal), 1 - Math.exp(-6 * dt)).normalize();
    }
  }

  /** Corre para longe de um perigo (direção já normalizada no plano). */
  flee(away: THREE.Vector3, distance: number): void {
    this.target.set(this.position.x + away.x * distance, 0, this.position.z + away.z * distance);
    this.home.copy(this.target);
    this.pause = 0;
  }

  pickWanderTarget(ctx: CritterContext): void {
    for (let i = 0; i < 8; i++) {
      const a = ctx.rng.next() * Math.PI * 2;
      const d = ctx.rng.range(0.4, this.wander);
      const x = this.home.x + Math.cos(a) * d;
      const z = this.home.z + Math.sin(a) * d;
      if (ctx.isGroundFree(x, z) && !puddleAt(ctx, x, z, 0.3)) {
        this.target.set(x, 0, z);
        return;
      }
    }
    this.target.copy(this.position);
  }

  /** Matriz raiz: alinhada à normal do chão, girada no yaw, com arfagem extra opcional. */
  matrix(target: THREE.Matrix4, scale: number, yOffset = 0, extraPitch = 0, up: THREE.Vector3 = this.groundUp): THREE.Matrix4 {
    qAlign.setFromUnitVectors(UP, up);
    qYaw.setFromAxisAngle(UP, this.yaw);
    qAlign.multiply(qYaw);
    if (extraPitch !== 0) qAlign.multiply(qYaw.setFromAxisAngle(tmpNormal.set(1, 0, 0), extraPitch));
    tmpNormal.copy(this.position);
    tmpNormal.y += yOffset;
    return target.compose(tmpNormal, qAlign, vScale.setScalar(scale));
  }
}
