import * as THREE from 'three';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { getClayNormalMapRepeated } from '../render/clayMaterial';
import { globalUniforms } from '../render/shaderChunks';
import { getNoiseTexture, noiseTextureGLSL } from '../render/noiseTexture';
import { fbm2 } from '../utils/noise';
import { lerp, smoothstep } from '../utils/math';
import { createBurrowSite, pickPuddleSites, puddleBowl, puddleFlatten, type BurrowSite, type PuddleSite } from './sites';

/** Lado do mapa em unidades (1 unidade ≈ 2 cm: é um jardim visto por um besouro). */
export const WORLD_SIZE = 160;
/** Raio da área jogável antes do "morro de borda" subir. */
export const PLAY_RADIUS = 58;
/** O colisor usa uma grade mais grossa que a malha visual: a altura é suave nessa escala. */
const COLLIDER_SEGMENTS = 192;

const GRASS_A = new THREE.Color('#a3d46c');
const GRASS_B = new THREE.Color('#7cbf5b');
const GRASS_C = new THREE.Color('#cfe08a');
const GRASS_DEEP = new THREE.Color('#5d9a46');
const DIRT = new THREE.Color('#dcab70');
const DIRT_DARK = new THREE.Color('#b9844f');
const DIRT_EDGE = new THREE.Color('#9f7045');
const RIM = new THREE.Color('#79b458');
const SHADE = new THREE.Color('#4f7a3a');
const MUD = new THREE.Color('#7d5b3d');
const MUD_DEEP = new THREE.Color('#5e4330');
const SOIL = new THREE.Color('#a8764c');
const HOLE = new THREE.Color('#3e2a1c');

/** Relevo "cru": colinas suaves + morro de borda, antes de cavar toca e poças. */
function baseHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const rolling = fbm2(x * 0.018, z * 0.018, 4, 3) * 4.2 + fbm2(x * 0.06, z * 0.06, 3, 9) * 0.7;
  // Centro mais plano: o jogador começa num gramado tranquilo.
  const flatten = 0.06 + 0.94 * smoothstep(9, 38, dist);
  const rim = dist > PLAY_RADIUS ? Math.pow((dist - PLAY_RADIUS) / 10, 2) * 5 : 0;
  return rolling * flatten + Math.min(rim, 28);
}

/** A toca do besouro: onde a bola é enterrada. */
export const BURROW: BurrowSite = createBurrowSite(baseHeight);
/** Bacias rasas onde a chuva empoça. */
export const PUDDLES: readonly PuddleSite[] = pickPuddleSites(baseHeight, PLAY_RADIUS, BURROW);

/** Alcance da escultura da toca (aplainamento em volta + monte de terra). */
const BURROW_REACH = BURROW.radius * 2.8;

/** Toca: funil com borda de terra fofa e o monte escavado para um lado. */
function shapeBurrow(h: number, x: number, z: number): number {
  const dx = x - BURROW.x;
  const dz = z - BURROW.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > BURROW_REACH * BURROW_REACH) return h;
  const d = Math.sqrt(d2);
  const r = BURROW.radius;
  h = lerp(h, BURROW.ground, 1 - smoothstep(r * 1.5, BURROW_REACH, d));
  if (d < r) h -= BURROW.depth * (1 - smoothstep(0, 1, d / r));
  // Beiço de terra fofa em volta da boca.
  const lip = (d - r * 1.08) / (r * 0.24);
  h += 0.32 * Math.exp(-lip * lip);
  // Monte da terra que saiu do buraco.
  const mx = x - (BURROW.x + BURROW.moundX * r * 1.75);
  const mz = z - (BURROW.z + BURROW.moundZ * r * 1.75);
  h += 0.95 * Math.exp(-(mx * mx + mz * mz) / (r * r * 0.5));
  return h;
}

/**
 * Altura analítica do terreno. É a fonte única da verdade: a malha visual,
 * o colisor e o posicionamento dos objetos usam esta mesma função.
 */
export function terrainHeight(x: number, z: number): number {
  let h = baseHeight(x, z);
  for (const p of PUDDLES) {
    const dx = x - p.x;
    const dz = z - p.z;
    const reach = p.radius * 1.8;
    if (dx * dx + dz * dz > reach * reach) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    h = lerp(h, p.rim, puddleFlatten(p, d)) - puddleBowl(p, d);
  }
  return shapeBurrow(h, x, z);
}

/** Quanto de "fundo de poça" (lama) há num ponto: 0 = fora, 1 = no meio da bacia. */
export function mudAmount(x: number, z: number): number {
  let mud = 0;
  for (const p of PUDDLES) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.radius * 1.15) mud = Math.max(mud, 1 - smoothstep(p.radius * 0.55, p.radius * 1.1, d));
  }
  return mud;
}

/** Terra revolvida da toca (boca, beiço e monte): 0 = fora, 1 = terra fofa. */
function burrowSoil(x: number, z: number): number {
  const d = Math.hypot(x - BURROW.x, z - BURROW.z);
  if (d > BURROW_REACH) return 0;
  const r = BURROW.radius;
  const mound = Math.hypot(x - (BURROW.x + BURROW.moundX * r * 1.75), z - (BURROW.z + BURROW.moundZ * r * 1.75));
  return Math.max(1 - smoothstep(r * 1.15, r * 1.75, d), 1 - smoothstep(r * 0.6, r * 1.2, mound));
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

/** Distância até o eixo da trilha sinuosa que cruza o mapa. */
function pathDistance(x: number, z: number): number {
  return Math.abs(z - Math.sin(x * 0.06) * 14 - 6);
}

/** Quanto de "terra batida" há num ponto (0 = grama, 1 = terra). Reaproveitado pela vegetação. */
export function dirtAmount(x: number, z: number): number {
  const n = fbm2(x * 0.045 + 40, z * 0.045 - 12, 3, 21);
  // Trilha sinuosa cruzando o mapa — dá leitura de caminho ao cenário.
  const pathMask = 1 - smoothstep(1.8, 4.2, pathDistance(x, z));
  // Fundo das poças e terra revolvida da toca também são "terra" (a grama não nasce ali).
  return Math.max(smoothstep(0.18, 0.34, n), pathMask * 0.95, mudAmount(x, z) * 0.95, burrowSoil(x, z));
}

export interface ContactShade {
  x: number;
  z: number;
  radius: number;
  /** 0..1 — quanto escurece o chão em volta (sombra de contato "pintada"). */
  strength: number;
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly segments: number;
  private readonly baseColors: Float32Array;

  constructor(physics: Physics, segments = 160) {
    this.segments = segments;
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    geometry.computeVertexNormals();

    const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const dirtValues = new Float32Array(pos.count);
    const mudValues = new Float32Array(pos.count);
    const color = new THREE.Color();
    const dirtColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Gramado: base + manchas ensolaradas + manchas escuras (trevo, sombra de moita).
      const variation = fbm2(x * 0.08, z * 0.08, 2, 5) * 0.5 + 0.5;
      color.copy(GRASS_A).lerp(GRASS_B, variation);
      color.lerp(GRASS_C, Math.max(0, fbm2(x * 0.2, z * 0.2, 2, 13)) * 0.85);
      color.lerp(GRASS_DEEP, smoothstep(0.15, 0.45, fbm2(x * 0.13 + 7, z * 0.13 - 3, 2, 31)) * 0.55);

      // Terra batida, com a borda da trilha mais escura (sulco úmido).
      const dirt = dirtAmount(x, z);
      dirtColor.copy(DIRT).lerp(DIRT_DARK, fbm2(x * 0.3, z * 0.3, 2, 2) * 0.5 + 0.5);
      const edge = smoothstep(0.25, 0.55, dirt) * (1 - smoothstep(0.7, 0.95, dirt));
      dirtColor.lerp(DIRT_EDGE, edge * 0.5);
      color.lerp(dirtColor, dirt);
      dirtValues[i] = dirt;

      // Encostas ficam mais terrosas e escuras; o morro da borda, mais verde e fechado.
      const slope = 1 - nor.getY(i);
      color.lerp(DIRT_DARK, smoothstep(0.12, 0.35, slope) * 0.55);
      const dist = Math.hypot(x, z);
      color.lerp(RIM, smoothstep(PLAY_RADIUS, PLAY_RADIUS + 14, dist) * 0.6);

      // Fundo das poças: lama mais escura no meio (mesmo seco, dá para ver onde a água junta).
      const mud = mudAmount(x, z);
      mudValues[i] = mud;
      if (mud > 0) color.lerp(MUD, smoothstep(0, 0.55, mud) * 0.85).lerp(MUD_DEEP, smoothstep(0.45, 1, mud) * 0.55);
      // Toca: terra fofa revolvida e a boca escurecendo para dentro.
      const soil = burrowSoil(x, z);
      if (soil > 0) {
        color.lerp(SOIL, soil * 0.8);
        const inHole = Math.hypot(x - BURROW.x, z - BURROW.z) / BURROW.radius;
        color.lerp(HOLE, (1 - smoothstep(0.1, 0.9, inHole)) * 0.92);
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    this.baseColors = colors.slice();
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('dirt', new THREE.BufferAttribute(dirtValues, 1));
    geometry.setAttribute('mud', new THREE.BufferAttribute(mudValues, 1));

    this.mesh = new THREE.Mesh(geometry, createTerrainMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.matrixAutoUpdate = false;

    this.createCollider(physics);
  }

  /**
   * Escurece o chão em volta de pedras, cogumelos e troncos: a "sombra de contato"
   * pintada que a massinha real tem (poeira e umidade acumulam na base das coisas).
   */
  paintContactShade(spots: ContactShade[]): void {
    const colorAttr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = colorAttr.array as Float32Array;
    colors.set(this.baseColors);
    const seg = WORLD_SIZE / this.segments;
    const half = WORLD_SIZE / 2;
    const row = this.segments + 1;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (const spot of spots) {
      const reach = spot.radius * 1.7;
      // A grade é regular: só visita os vértices dentro do quadrado de alcance.
      const ix0 = Math.max(0, Math.floor((spot.x - reach + half) / seg));
      const ix1 = Math.min(this.segments, Math.ceil((spot.x + reach + half) / seg));
      const iy0 = Math.max(0, Math.floor((half - (spot.z + reach)) / seg));
      const iy1 = Math.min(this.segments, Math.ceil((half - (spot.z - reach)) / seg));
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = iy * row + ix;
          const d = Math.hypot(pos.getX(i) - spot.x, pos.getZ(i) - spot.z);
          const k = (1 - smoothstep(spot.radius * 0.55, reach, d)) * spot.strength;
          if (k <= 0) continue;
          colors[i * 3] += (SHADE.r - colors[i * 3]) * k * 0.55;
          colors[i * 3 + 1] += (SHADE.g - colors[i * 3 + 1]) * k * 0.55;
          colors[i * 3 + 2] += (SHADE.b - colors[i * 3 + 2]) * k * 0.55;
        }
      }
    }
    colorAttr.needsUpdate = true;
  }

  /** Colisor trimesh numa grade própria (sem ambiguidade de layout do heightfield). */
  private createCollider(physics: Physics): void {
    const grid = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, COLLIDER_SEGMENTS, COLLIDER_SEGMENTS);
    grid.rotateX(-Math.PI / 2);
    const pos = grid.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    const vertices = new Float32Array(pos.array as ArrayLike<number>);
    const indices = new Uint32Array(grid.getIndex()!.array as ArrayLike<number>);
    grid.dispose();
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(1)
      .setCollisionGroups(interactionGroups(Groups.WORLD, 0xffff));
    physics.world.createCollider(desc, body);
  }
}

/**
 * Material do chão: massinha com vertex color + detalhe em espaço de mundo no shader
 * (variação do gramado, pedrinhas e grumos na terra). Os vértices sozinhos (~0,6 u)
 * são grossos demais para esse nível de detalhe.
 */
function createTerrainMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    sheen: 0.25,
    sheenColor: new THREE.Color('#f4ead2'),
    sheenRoughness: 0.85,
    normalMap: getClayNormalMapRepeated(26),
    normalScale: new THREE.Vector2(0.32, 0.32),
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = globalUniforms.uWetness;
    shader.uniforms.tClayNoise = { value: getNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float dirt;\nattribute float mud;\nvarying float vDirt;\nvarying float vMud;\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = dirt;\nvMud = mud;\nvGround = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vDirt;\nvarying float vMud;\nvarying vec2 vGround;\nuniform float uWetness;\n${noiseTextureGLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        // Chão molhado: terra e lama brilham (poça rasa entre os grumos), gramado quase nada.
        float soaked = uWetness * (0.2 + 0.45 * smoothstep(0.3, 0.8, vDirt) + 0.35 * vMud);
        roughnessFactor = mix(roughnessFactor, 0.24, soaked);`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float broad = clayNoise2Tex(vGround * 0.21);
        float mid = clayNoise2Tex(vGround * 0.93 + 17.0);
        diffuseColor.rgb *= 0.9 + broad * 0.12 + mid * 0.09;
        float grassMask = 1.0 - smoothstep(0.2, 0.6, vDirt);
        // Gramado: pontinhos claros e escuros (sensação de grama baixa entre os tufos).
        float fleck = smoothstep(0.62, 0.92, clayNoise2Tex(vGround * 6.5 + 3.0));
        float dark = smoothstep(0.66, 0.9, clayNoise2Tex(vGround * 4.1 - 11.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.14, 0.9), fleck * grassMask * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.86, 0.78), dark * grassMask * 0.6);
        // Terra: pedrinhas claras e grumos escuros.
        float dirtMask = smoothstep(0.3, 0.8, vDirt);
        // Média de duas oitavas: manchas redondinhas (uma oitava só dá recorte quadrado).
        float pebbleN = clayNoise2Tex(vGround * 5.4 + 9.0) * 0.6 + clayNoise2Tex(vGround * 11.0 - 3.0) * 0.4;
        float pebble = smoothstep(0.66, 0.8, pebbleN);
        float clod = smoothstep(0.68, 0.88, clayNoise2Tex(vGround * 2.7 - 21.0) * 0.7 + clayNoise2Tex(vGround * 6.1) * 0.3);
        float grit = clayNoise2Tex(vGround * 14.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.16 + vec3(0.025), pebble * dirtMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.76, clod * dirtMask * 0.8);
        diffuseColor.rgb *= 1.0 + (grit - 0.5) * 0.12 * dirtMask;
        // Molhado escurece (a terra bem mais que a grama).
        diffuseColor.rgb *= 1.0 - uWetness * (0.1 + 0.2 * dirtMask + 0.12 * vMud);`,
      );
  };
  material.customProgramCacheKey = () => 'terrain';
  return material;
}
