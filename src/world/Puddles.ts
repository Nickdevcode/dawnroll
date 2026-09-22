import * as THREE from 'three';
import { globalUniforms, noiseGLSL } from '../render/shaderChunks';
import { PUDDLES } from './Terrain';
import { PUDDLE_FREEBOARD, puddleBedHeight, type PuddleSite } from './sites';

/**
 * As poças: um disco d'água plano por bacia, subindo e descendo com o nível.
 * O terreno esconde o que fica "embaixo do chão", então a margem se desenha
 * sozinha e a poça cresce de verdade quando enche. No shader: borda rasa
 * transparente (a lama aparece por baixo), fundo mais escuro, reflexo do céu
 * e anéis de gota caindo quando chove.
 */

/** Estado público de cada poça (lido pelos bichos, pela bola, pelos efeitos). */
export interface PuddleState {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Altura (mundo) da superfície da água. */
  level: number;
  /** 0..1: quão cheia. */
  fill: number;
}

interface Pool {
  site: PuddleSite;
  mesh: THREE.Mesh;
  uniforms: { uLevel: { value: number } };
  state: PuddleState;
}

export class Puddles {
  readonly group = new THREE.Group();
  readonly states: PuddleState[] = [];
  private readonly pools: Pool[] = [];

  constructor(sites: readonly PuddleSite[] = PUDDLES) {
    this.group.name = 'puddles';
    for (const site of sites) {
      const geometry = new THREE.CircleGeometry(site.radius, 64);
      geometry.rotateX(-Math.PI / 2);
      const uniforms = { uLevel: { value: site.rim - site.depth } };
      const mesh = new THREE.Mesh(geometry, createWaterMaterial(site, uniforms));
      mesh.position.set(site.x, uniforms.uLevel.value, site.z);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.visible = false;
      // O AO não sabe lidar com transparência (e a água não oclui nada).
      mesh.userData.skipAO = true;
      mesh.name = 'puddle';
      const state: PuddleState = { x: site.x, z: site.z, radius: site.radius, level: uniforms.uLevel.value, fill: 0 };
      this.pools.push({ site, mesh, uniforms, state });
      this.states.push(state);
      this.group.add(mesh);
    }
  }

  /** Nível da água de todas as poças (0 = secas, 1 = cheias até quase a borda). */
  setFill(fill: number): void {
    for (const pool of this.pools) {
      const { site, mesh, uniforms, state } = pool;
      const level = site.rim - site.depth + fill * (site.depth - PUDDLE_FREEBOARD);
      state.level = level;
      state.fill = fill;
      uniforms.uLevel.value = level;
      mesh.position.y = level;
      mesh.visible = fill > 0.015;
    }
  }

  /** Profundidade da água num ponto (0 = seco ou fora das poças). */
  depthAt(x: number, z: number): number {
    for (const { site, state } of this.pools) {
      if (state.fill <= 0.015) continue;
      const d = Math.hypot(x - site.x, z - site.z);
      if (d >= site.radius) continue;
      return Math.max(0, state.level - puddleBedHeight(site, d));
    }
    return 0;
  }

  /** Altura da superfície da água num ponto, ou null se ali está seco. */
  surfaceAt(x: number, z: number): number | null {
    for (const { site, state } of this.pools) {
      if (state.fill <= 0.015) continue;
      const d = Math.hypot(x - site.x, z - site.z);
      if (d < site.radius && state.level > puddleBedHeight(site, d)) return state.level;
    }
    return null;
  }
}

/**
 * Água de poça: MeshPhysical (reflexo do céu e brilho do sol de graça) com três
 * injeções no shader — cor/transparência pela profundidade (calculada com a mesma
 * fórmula da bacia), anéis de chuva e marolinha de vento na normal.
 */
function createWaterMaterial(site: PuddleSite, levelUniform: { uLevel: { value: number } }): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0,
    // Espelho d'água: o reflexo do céu é o que faz a poça "ler" como água.
    envMapIntensity: 2.2,
    specularIntensity: 1,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLevel = levelUniform.uLevel;
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uRain = globalUniforms.uRain;
    shader.uniforms.uSite = { value: new THREE.Vector4(site.x, site.z, site.radius, site.depth) };
    shader.uniforms.uRim = { value: site.rim };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(position, 1.0)).xz;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vWaterXZ;
        uniform float uLevel;
        uniform float uTime;
        uniform float uRain;
        uniform vec4 uSite;
        uniform float uRim;
        ${noiseGLSL}

        // Profundidade da água: nível - fundo da bacia (mesma fórmula do relevo).
        float waterDepth() {
          float t = length(vWaterXZ - uSite.xy) / uSite.z;
          float k = max(1.0 - t * t, 0.0);
          return uLevel - (uRim - uSite.w * k * sqrt(k));
        }

        // Anéis de gota: cada célula da grade tem uma gota com fase própria.
        vec2 rippleSlope(vec2 p, float cellSize, float seed) {
          vec2 slope = vec2(0.0);
          vec2 cell = floor(p / cellSize);
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 c = cell + vec2(float(i), float(j));
              float h = clayHash12(c + seed);
              if (h > uRain * 0.95 + 0.05) continue; // chuva fraca = menos gotas
              vec2 center = (c + vec2(clayHash12(c + seed + 3.1), clayHash12(c + seed + 7.7))) * cellSize;
              float phase = fract(uTime / (0.7 + h * 0.5) + h * 13.0);
              vec2 d = p - center;
              float dist = length(d);
              float x = dist - phase * cellSize * 0.85;
              float wave = cos(x * 26.0) * exp(-x * x * 90.0) * (1.0 - phase);
              slope += wave * d / max(dist, 1e-3);
            }
          }
          return slope;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float wDepth = waterDepth();
        // Rasinho = lama aparecendo por baixo; fundo = água barrenta escura (quase preta no meio).
        vec3 shallow = vec3(0.4, 0.31, 0.2);
        vec3 deep = vec3(0.075, 0.085, 0.065);
        float deepness = smoothstep(0.03, 0.5, wDepth);
        diffuseColor.rgb = mix(shallow, deep, deepness);
        diffuseColor.a = smoothstep(0.0, 0.06, wDepth) * mix(0.3, 0.94, deepness);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Marolinha de vento sempre; anéis de gota com a chuva.
          vec2 p = vWaterXZ;
          vec2 slope = vec2(
            clayNoise2(p * 1.7 + vec2(uTime * 0.35, 0.0)) - clayNoise2(p * 1.7 + vec2(uTime * 0.35 + 0.37, 0.0)),
            clayNoise2(p * 1.7 + vec2(0.0, uTime * 0.28)) - clayNoise2(p * 1.7 + vec2(0.0, uTime * 0.28 + 0.37))
          ) * 0.3;
          if (uRain > 0.02) {
            slope += (rippleSlope(p, 0.9, 1.3) + rippleSlope(p + 0.45, 1.3, 7.9) * 0.7) * 0.6 * min(uRain * 1.5, 1.0);
          }
          vec3 worldNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
          normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'puddle-water';
  return material;
}
