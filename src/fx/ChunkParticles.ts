import * as THREE from 'three';
import { terrainHeight } from '../world/Terrain';

export interface ChunkSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: THREE.Color;
  size: number;
  life: number;
  /** Quanto quica no chão (0 = gruda, 1 = bola de borracha). */
  bounce?: number;
  /** Folha/confete: cai planando, balançando de um lado para o outro. */
  flutter?: boolean;
  /** Velocidade de giro (rad/s). */
  spin?: number;
}

const GRAVITY = 18;
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

/**
 * Pedacinhos sólidos (instanciados, com luz e sombra de verdade): respingos de
 * bosta, torrões de terra, pedaços de capim, confete, folhas caindo.
 * Física de brinquedo própria: gravidade, arrasto, quique no terreno e giro.
 */
export class ChunkParticles {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly state: Float32Array; // [x,y,z, vx,vy,vz, age,life, size,bounce, spin, flutter, ax,ay,az, angle, rest]
  private readonly stride = 17;
  private cursor = 0;
  private alive = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow = true) {
    this.capacity = capacity;
    this.state = new Float32Array(capacity * this.stride);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'particles-chunks';
    // Sem nada vivo, não desenha nada (count volta ao máximo no primeiro spawn).
    this.mesh.count = 0;
    tmpMatrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, tmpMatrix);
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
  }

  spawn(s: ChunkSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const o = i * this.stride;
    const st = this.state;
    st[o] = s.x;
    st[o + 1] = s.y;
    st[o + 2] = s.z;
    st[o + 3] = s.vx;
    st[o + 4] = s.vy;
    st[o + 5] = s.vz;
    st[o + 6] = 0;
    st[o + 7] = s.life;
    st[o + 8] = s.size;
    st[o + 9] = s.bounce ?? 0.3;
    st[o + 10] = s.spin ?? 6;
    st[o + 11] = s.flutter ? 1 : 0;
    tmpAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    st[o + 12] = tmpAxis.x;
    st[o + 13] = tmpAxis.y;
    st[o + 14] = tmpAxis.z;
    st[o + 15] = Math.random() * Math.PI * 2;
    st[o + 16] = 0; // parado no chão?
    this.mesh.setColorAt(i, s.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alive = Math.min(this.alive + 1, this.capacity);
    this.mesh.count = this.capacity;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    const st = this.state;
    let stillAlive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * this.stride;
      const life = st[o + 7];
      if (life <= 0) continue;
      const age = (st[o + 6] += dt);
      if (age >= life) {
        st[o + 7] = 0;
        tmpMatrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, tmpMatrix);
        continue;
      }
      stillAlive++;
      const flutter = st[o + 11] > 0;
      const resting = st[o + 16] > 0;
      if (!resting) {
        if (flutter) {
          // Planando: queda lenta com velocidade terminal e zigue-zague.
          st[o + 4] = Math.max(st[o + 4] - GRAVITY * 0.35 * dt, -1.1);
          const drag = Math.exp(-2.2 * dt);
          st[o + 3] = st[o + 3] * drag + Math.sin(age * 3.3 + o) * 2.2 * dt;
          st[o + 5] = st[o + 5] * drag + Math.cos(age * 2.7 + o) * 2.2 * dt;
        } else {
          st[o + 4] -= GRAVITY * dt;
          const drag = Math.exp(-0.4 * dt);
          st[o + 3] *= drag;
          st[o + 5] *= drag;
        }
        st[o] += st[o + 3] * dt;
        st[o + 1] += st[o + 4] * dt;
        st[o + 2] += st[o + 5] * dt;
        st[o + 15] += st[o + 10] * dt;

        const size = st[o + 8];
        const ground = terrainHeight(st[o], st[o + 2]) + size * 0.35;
        if (st[o + 1] < ground) {
          st[o + 1] = ground;
          if (st[o + 4] < -1.5 && !flutter) {
            st[o + 4] = -st[o + 4] * st[o + 9];
            st[o + 3] *= 0.55;
            st[o + 5] *= 0.55;
            st[o + 10] *= 0.6;
          } else {
            st[o + 16] = 1;
            st[o + 3] = st[o + 4] = st[o + 5] = 0;
          }
        }
      }
      // Encolhe no último quarto da vida (some "derretendo" no chão).
      const t = age / life;
      const scale = st[o + 8] * (t > 0.75 ? 1 - (t - 0.75) / 0.25 : Math.min(1, t / 0.05));
      tmpAxis.set(st[o + 12], st[o + 13], st[o + 14]);
      tmpQuat.setFromAxisAngle(tmpAxis, st[o + 15]);
      tmpPos.set(st[o], st[o + 1], st[o + 2]);
      tmpScale.setScalar(Math.max(scale, 1e-4));
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.mesh.setMatrixAt(i, tmpMatrix);
    }
    this.alive = stillAlive;
    if (stillAlive === 0) this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
