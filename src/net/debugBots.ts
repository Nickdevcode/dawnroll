import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import { FIXED_DT } from '../core/Physics';
import { DungBall } from '../entities/DungBall';
import { RemoteBeetle } from '../entities/RemoteBeetle';
import { clay } from '../render/clayMaterial';
import { ACCESSORIES } from '../progression/accessories';
import { SKINS } from '../progression/skins';
import { terrainHeight } from '../world/Terrain';

/**
 * Só em desenvolvimento (`?bots=5`): besouros de mentira pra medir o custo de
 * uma sala cheia sem abrir 6 navegadores. Cada um é o mesmo que o online põe
 * na cena por jogador remoto (o besouro com casco e acessórios e uma bola
 * fantasma com tralha grudada no teto do fantasma), rodando em volta do seu besouro.
 */

const ORBIT = 7;
const SPEED = 0.35;

interface Bot {
  beetle: RemoteBeetle;
  ball: DungBall;
  phase: number;
  orbit: number;
}

const tmp = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpVel = new THREE.Vector3();

export class DebugBots {
  private readonly bots: Bot[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, physics: Physics, count: number) {
    const slots = ['head', 'face', 'neck', 'back'] as const;
    for (let i = 0; i < count; i++) {
      const beetle = new RemoteBeetle(physics);
      const pick = (slot: (typeof slots)[number]) => ACCESSORIES.filter((a) => a.slot === slot)[i + 1]?.id ?? null;
      beetle.setLook({ skin: SKINS[(i * 3 + 1) % SKINS.length].id, head: pick('head'), face: pick('face'), neck: pick('neck'), back: pick('back') });
      const ball = new DungBall(physics, new THREE.Vector3(0, -40, 0), { proxy: true });
      // Tralha grudada: uma malha por item, como na bola de verdade (o fantasma mostra até o teto dele).
      for (let k = 0; k < 40; k++) {
        const item = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), clay(k % 2 ? '#c9a24f' : '#7cbf5b', { unique: true }));
        item.position.set(Math.cos(k) * 3, 1, Math.sin(k) * 3);
        ball.stick(item, { depth: 0.04 });
      }
      ball.addVolume((4 / 3) * Math.PI * (1.6 ** 3));
      scene.add(beetle.model.root, beetle.stars.group, ball.root);
      this.bots.push({ beetle, ball, phase: (i / count) * Math.PI * 2, orbit: ORBIT + i * 1.5 });
    }
  }

  /** Passo fixo: cada bola roda em volta de `center`, com o besouro empurrando atrás. */
  fixedUpdate(center: THREE.Vector3): void {
    this.time += FIXED_DT;
    for (const bot of this.bots) {
      const a = this.time * SPEED + bot.phase;
      const x = center.x + Math.cos(a) * bot.orbit;
      const z = center.z + Math.sin(a) * bot.orbit;
      const r = bot.ball.radius;
      tmp.set(x, terrainHeight(x, z) + r, z);
      const vx = -Math.sin(a) * bot.orbit * SPEED;
      const vz = Math.cos(a) * bot.orbit * SPEED;
      tmpQuat.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), this.time * 2);
      bot.ball.drive(tmp, tmpQuat, tmpVel.set(vx, 0, vz), r, false);
      bot.ball.fixedUpdate(FIXED_DT);
      const back = Math.hypot(vx, vz) || 1;
      const bx = x - (vx / back) * (r + 0.7);
      const bz = z - (vz / back) * (r + 0.7);
      bot.beetle.drive(
        { x: bx, y: terrainHeight(bx, bz), z: bz, yaw: Math.atan2(-vx, -vz), speed: back, vy: 0, pushBlend: 1, strain: 0.6, grounded: true, riding: false, dizzy: false },
        back,
        r,
      );
    }
  }

  /** Quadro (mesma regra do online: sombra dos besouros só perto da câmera). */
  render(alpha: number, dt: number, eye: THREE.Vector3): void {
    for (const bot of this.bots) {
      bot.ball.render(alpha, dt);
      bot.beetle.render(alpha, dt);
      bot.beetle.setShadows(bot.beetle.position.distanceTo(eye) < 14);
    }
  }
}
