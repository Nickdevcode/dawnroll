import * as THREE from 'three';
import { createRng } from '../utils/math';
import { globalUniforms, noiseGLSL, pushersGLSL, windGLSL } from './shaderChunks';

/**
 * Material de "massinha": o visual Human Fall Flat vem de algumas coisas juntas —
 * superfície fosca com brilho aveludado (sheen), micro-relevo de dedo apertando
 * (normal map procedural com digitais e poros), leve variação de cor "de mão"
 * (mosqueado no shader) e oclusão ambiente forte (feita no pós-processamento).
 */

const TEXTURE_SIZE = 512;

let sharedNormalMap: THREE.DataTexture | null = null;

/**
 * Gera um normal map tileável com "dedadas" suaves (algumas com digital),
 * poros finos e granulado. Tudo com distância em wrap-around para não aparecer
 * costura ao repetir.
 */
function buildClayNormalMap(): THREE.DataTexture {
  const size = TEXTURE_SIZE;
  const height = new Float32Array(size * size);
  const rng = createRng(1337);

  /** Depressão gaussiana; `ridges` > 0 grava anéis de digital dentro dela. */
  const addDent = (cx: number, cy: number, radius: number, depth: number, ridges: number) => {
    const r2 = radius * radius;
    const reach = Math.ceil(radius * 2);
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 * 4) continue;
        const x = (ix + dx + size * 4) % size;
        const y = (iy + dy + size * 4) % size;
        const falloff = Math.exp(-d2 / r2);
        let h = -depth * falloff;
        if (ridges > 0) {
          // Anéis levemente elípticos: parece a ponta do dedo que apertou a massa.
          const d = Math.sqrt(dx * dx * 1.25 + dy * dy);
          h += Math.sin(d * ridges + Math.sin(dy * 0.21) * 1.5) * 0.035 * depth * falloff * Math.min(1, d / (radius * 0.25));
        }
        height[y * size + x] += h;
      }
    }
  };

  for (let i = 0; i < 230; i++) {
    const withPrint = rng.next() < 0.16;
    addDent(rng.next() * size, rng.next() * size, rng.range(20, 64), rng.range(0.35, 1), withPrint ? rng.range(1.1, 1.5) : 0);
  }
  // Poros: pontinhos afundados bem pequenos (a massinha nunca é lisa de verdade).
  for (let i = 0; i < 1400; i++) {
    addDent(rng.next() * size, rng.next() * size, rng.range(1.2, 2.8), rng.range(0.08, 0.2), 0);
  }

  // Granulado: ruído de valor numa grade que dá a volta (tileável), em duas escalas.
  const addValueNoise = (cells: number, amplitude: number, seed: number) => {
    const grid = new Float32Array(cells * cells);
    const g = createRng(seed);
    for (let i = 0; i < grid.length; i++) grid[i] = g.next();
    const cell = size / cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx) % cells;
        const y0 = Math.floor(gy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = gx - Math.floor(gx);
        const ty = gy - Math.floor(gy);
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        height[y * size + x] += (v - 0.5) * amplitude;
      }
    }
  };
  addValueNoise(32, 0.4, 7);
  addValueNoise(96, 0.14, 11);
  addValueNoise(256, 0.05, 19);

  // Sobel -> normal em espaço tangente.
  const data = new Uint8Array(size * size * 4);
  const sample = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export function getClayNormalMap(): THREE.DataTexture {
  sharedNormalMap ??= buildClayNormalMap();
  return sharedNormalMap;
}

const repeatedMaps = new Map<number, THREE.Texture>();

/** Normal map com repetição própria; os dados da textura continuam compartilhados. */
export function getClayNormalMapRepeated(repeat: number): THREE.Texture {
  const base = getClayNormalMap();
  if (repeat === 1) return base;
  let map = repeatedMaps.get(repeat);
  if (!map) {
    map = base.clone();
    map.repeat.set(repeat, repeat);
    map.needsUpdate = true;
    repeatedMaps.set(repeat, map);
  }
  return map;
}

export interface ClayOptions {
  roughness?: number;
  /** Intensidade do brilho aveludado de borda. */
  sheen?: number;
  /** Força do micro-relevo; 0 desliga o normal map. */
  bump?: number;
  /** Repetição do normal map (para superfícies grandes, como o chão). */
  repeat?: number;
  /** Casco de besouro: brilho furta-cor. */
  iridescence?: number;
  clearcoat?: number;
  vertexColors?: boolean;
  flatShading?: boolean;
  /** Variação de cor "feita à mão" (0 = cor chapada). */
  mottle?: number;
  /**
   * Frequência do mosqueado em unidades locais da geometria. Peças pequenas
   * (modeladas em escala ~1) pedem valor maior que o cenário (em unidades de mundo).
   */
  mottleScale?: number;
  /** Manchas úmidas e brilhantes (bosta fresca). 0..1. */
  wet?: number;
  /** Balança com o vento (lê o atributo `sway` da geometria). */
  sway?: boolean;
  /**
   * Vegetação instanciada: balança com o vento e deita quando o besouro ou a bola
   * passam por cima. O valor é a altura (local) considerada "ponta" da planta.
   */
  flex?: number;
  side?: THREE.Side;
  /**
   * Material próprio, fora do cache: pra quem vai mudar cor/brilho depois
   * (o casco do besouro). Mexer num material do cache repintaria todo mundo que
   * divide ele. O programa de GPU continua o mesmo dos outros de massinha.
   */
  unique?: boolean;
}

/**
 * Injeta no MeshPhysicalMaterial: mosqueado de cor, manchas úmidas e (opcional) vento
 * por atributo (`sway`, cenário fundido) ou vegetação instanciada que deita (`flex`).
 * O código gerado só depende dessas duas chaves, então os materiais de massinha
 * compartilham poucos programas de GPU; os valores vão por uniform.
 */
function installClayShader(material: THREE.MeshPhysicalMaterial, mottle: number, mottleScale: number, wet: number, sway: boolean, flex: number): void {
  const useFlex = flex > 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMottle = { value: mottle };
    shader.uniforms.uMottleScale = { value: mottleScale };
    shader.uniforms.uWet = { value: wet };
    shader.uniforms.uWetness = globalUniforms.uWetness;
    if (sway || useFlex) shader.uniforms.uTime = globalUniforms.uTime;
    if (useFlex) {
      shader.uniforms.uPushers = globalUniforms.uPushers;
      shader.uniforms.uFlexHeight = { value: flex };
    }

    const flexCode = /* glsl */ `
      {
        mat4 flexModel = modelMatrix;
        #ifdef USE_INSTANCING
          flexModel = modelMatrix * instanceMatrix;
        #endif
        vec3 flexWorld = (flexModel * vec4(transformed, 1.0)).xyz;
        float flexH = clamp(position.y / uFlexHeight, 0.0, 1.0);
        vec2 flexWind = windOffset(flexWorld) * 0.12 * flexH * flexH;
        vec3 flexDisp = vec3(flexWind.x, 0.0, flexWind.y) + pushersOffset(flexWorld, flexH) * 0.6;
        // Deslocamento calculado no mundo, aplicado de volta no espaço local da instância.
        transformed += inverse(mat3(flexModel)) * flexDisp;
      }`;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vClayPos;
        ${sway ? 'attribute float sway;' : ''}
        ${sway || useFlex ? windGLSL : ''}
        ${useFlex ? `uniform float uFlexHeight;\n${pushersGLSL}` : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec4 clayP = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          clayP = instanceMatrix * clayP;
        #endif
        vClayPos = clayP.xyz;
        ${sway ? 'transformed.xz += windOffset(transformed) * sway;' : ''}
        ${useFlex ? flexCode : ''}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vClayPos;
        uniform float uMottle;
        uniform float uMottleScale;
        uniform float uWet;
        uniform float uWetness;
        ${noiseGLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 clayQ = vClayPos * uMottleScale;
        float clayN = clayNoise3(clayQ) * 0.65 + clayNoise3(clayQ * 2.7 + 13.1) * 0.35;
        diffuseColor.rgb *= 1.0 + (clayN - 0.5) * uMottle * 2.0;
        // Chuva: massinha molhada fica um tom mais escura.
        diffuseColor.rgb *= 1.0 - uWetness * 0.14;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        if (uWet > 0.0) {
          float wetMask = smoothstep(0.5, 0.72, clayNoise3(clayQ * 1.9 + 41.0));
          roughnessFactor = mix(roughnessFactor, 0.2, wetMask * uWet);
        }
        // Chuva: película d'água em manchas (nunca 100% espelhada, senão vira plástico).
        if (uWetness > 0.0) {
          float film = 0.55 + 0.45 * smoothstep(0.35, 0.65, clayNoise3(clayQ * 0.8 - 7.0));
          roughnessFactor = mix(roughnessFactor, 0.28, uWetness * film * 0.75);
        }`,
      );
  };
  material.customProgramCacheKey = () => `clay|${sway ? 'sway' : ''}|${useFlex ? 'flex' : ''}`;
}

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * Fábrica de materiais de massinha, com cache: a mesma cor+opções devolve
 * a mesma instância (menos trocas de shader/programa na GPU).
 */
export function clay(color: THREE.ColorRepresentation, options: ClayOptions = {}): THREE.MeshPhysicalMaterial {
  const {
    roughness = 0.72,
    sheen = 0.5,
    bump = 0.35,
    repeat = 1,
    iridescence = 0,
    clearcoat = 0,
    vertexColors = false,
    flatShading = false,
    mottle = 0.1,
    mottleScale = 3,
    wet = 0,
    sway = false,
    flex = 0,
    side = THREE.FrontSide,
    unique = false,
  } = options;

  const key = [
    new THREE.Color(color).getHexString(),
    roughness,
    sheen,
    bump,
    repeat,
    iridescence,
    clearcoat,
    vertexColors,
    flatShading,
    mottle,
    mottleScale,
    wet,
    sway,
    flex,
    side,
  ].join('|');
  const cached = unique ? undefined : cache.get(key);
  if (cached) return cached;

  const base = new THREE.Color(color);
  // Com vertex color a cor base é branca: o sheen fica num creme neutro.
  const sheenBase = vertexColors ? new THREE.Color('#f2e6d8') : base;
  const material = new THREE.MeshPhysicalMaterial({
    color: vertexColors ? 0xffffff : base,
    roughness,
    metalness: 0,
    sheen,
    // Sheen levemente mais claro que a base: é o "pózinho" de massinha na borda.
    sheenColor: sheenBase.clone().lerp(new THREE.Color(0xffffff), 0.55),
    sheenRoughness: 0.8,
    iridescence,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 600],
    clearcoat,
    clearcoatRoughness: 0.35,
    vertexColors,
    flatShading,
    side,
  });

  if (bump > 0) {
    material.normalMap = getClayNormalMapRepeated(repeat);
    material.normalScale.set(bump, bump);
  }
  installClayShader(material, mottle, mottleScale, wet, sway, flex);

  if (!unique) cache.set(key, material);
  return material;
}
