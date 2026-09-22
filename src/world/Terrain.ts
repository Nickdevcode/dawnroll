import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { fbm2 } from '../utils/noise';
import { smoothstep } from '../utils/math';

/** Lado do mapa em unidades (1 unidade ≈ 2 cm: é um jardim visto por um besouro). */
export const WORLD_SIZE = 160;
/** Raio da área jogável antes do "morro de borda" subir. */
export const PLAY_RADIUS = 58;
const SEGMENTS = 160;

const GRASS_A = new THREE.Color('#9fd06b');
const GRASS_B = new THREE.Color('#7cbf5b');
const GRASS_C = new THREE.Color('#c3dc7c');
const DIRT = new THREE.Color('#d9a76c');
const DIRT_DARK = new THREE.Color('#b9844f');

/**
 * Altura analítica do terreno. É a fonte única da verdade: a malha visual,
 * o colisor e o posicionamento dos objetos usam esta mesma função.
 */
export function terrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const rolling = fbm2(x * 0.018, z * 0.018, 4, 3) * 4.2 + fbm2(x * 0.06, z * 0.06, 3, 9) * 0.7;
  // Centro mais plano: o jogador começa num gramado tranquilo.
  const flatten = 0.06 + 0.94 * smoothstep(9, 38, dist);
  const rim = dist > PLAY_RADIUS ? Math.pow((dist - PLAY_RADIUS) / 10, 2) * 5 : 0;
  return rolling * flatten + Math.min(rim, 28);
}

/** Normal por diferença finita da função de altura. */
export function terrainNormal(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.35;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  return target.set(hL - hR, 2 * e, hD - hU).normalize();
}

/** Quanto de "terra batida" há num ponto (0 = grama, 1 = terra). Reaproveitado pela vegetação. */
export function dirtAmount(x: number, z: number): number {
  const n = fbm2(x * 0.045 + 40, z * 0.045 - 12, 3, 21);
  // Trilha sinuosa cruzando o mapa — dá leitura de caminho ao cenário.
  const path = Math.abs(z - Math.sin(x * 0.06) * 14 - 6) ;
  const pathMask = 1 - smoothstep(1.8, 4.2, path);
  return Math.max(smoothstep(0.18, 0.34, n), pathMask * 0.95);
}

export class Terrain {
  readonly mesh: THREE.Mesh;

  constructor(physics: Physics) {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    const normal = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));

      const variation = fbm2(x * 0.08, z * 0.08, 2, 5) * 0.5 + 0.5;
      color.copy(GRASS_A).lerp(GRASS_B, variation);
      color.lerp(GRASS_C, Math.max(0, fbm2(x * 0.2, z * 0.2, 2, 13)) * 0.8);

      const dirt = dirtAmount(x, z);
      const dirtColor = DIRT.clone().lerp(DIRT_DARK, fbm2(x * 0.3, z * 0.3, 2, 2) * 0.5 + 0.5);
      color.lerp(dirtColor, dirt);

      // Encostas ficam mais terrosas e escuras.
      terrainNormal(x, z, normal);
      const slope = 1 - normal.y;
      color.lerp(DIRT_DARK, smoothstep(0.12, 0.35, slope) * 0.6);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    this.mesh = new THREE.Mesh(geometry, clay(0xffffff, { vertexColors: true, roughness: 0.85, sheen: 0.25, bump: 0.45, repeat: 22 }));
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';

    // Colisor trimesh gerado da própria malha (sem ambiguidade de layout do heightfield).
    const vertices = new Float32Array(pos.array as ArrayLike<number>);
    const indices = new Uint32Array(geometry.getIndex()!.array as ArrayLike<number>);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(1)
      .setCollisionGroups(interactionGroups(Groups.WORLD, 0xffff));
    physics.world.createCollider(desc, body);
  }
}
