import * as THREE from 'three';
import { createRng, smoothstep, type Rng } from '../utils/math';
import { globalUniforms, pushersGLSL, windGLSL } from '../render/shaderChunks';
import { SUN_DIRECTION } from '../render/Graphics';
import { ChunkedInstances, type InstanceSample } from '../render/ChunkedInstances';
import { terrainHeight, terrainNormal, dirtAmount, PLAY_RADIUS, WORLD_SIZE } from './Terrain';

/** Altura (local) considerada "ponta" da lâmina para o vento e para a translucidez. */
const BLADE_TIP = 1.75;

/** Filtro opcional: devolve true onde NÃO pode nascer grama (dentro de pedra, tronco...). */
export type GrassBlocker = (x: number, z: number) => boolean;

/**
 * Grama instanciada em pedaços: milhares de tufos, poucos draw calls, LOD por distância.
 * - O vertex shader faz o vento e abre caminho quando o besouro ou a bola passam.
 * - O fragment "acende" a lâmina contra o sol (translucidez barata) — é o que dá o
 *   brilho dourado no gramado quando se olha na direção do sol.
 * - No morro da borda, touceiras gigantes (a mesma grama, 6–12x maior) fecham o horizonte.
 */
export class Grass {
  readonly group = new THREE.Group();
  private readonly field: ChunkedInstances;
  private readonly rim: ChunkedInstances;

  constructor(count: number, blocked: GrassBlocker = () => false, seed = 42) {
    this.group.name = 'grass';
    const rng = createRng(seed);
    const geometry = buildClumpGeometry(rng);
    const material = createGrassMaterial();

    const samples: InstanceSample[] = [];
    const quat = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const reach = Math.min(PLAY_RADIUS + 14, WORLD_SIZE / 2 - 1);
    let attempts = 0;
    while (samples.length < count && attempts < count * 8) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * reach;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const dirt = dirtAmount(x, z);
      // Terra batida: rareia na borda da trilha e some no meio dela.
      if (dirt > 0.55 || rng.next() < smoothstep(0.2, 0.55, dirt)) continue;
      if (Math.hypot(x, z) < 2.2 || blocked(x, z)) continue;

      terrainNormal(x, z, normal);
      quat.setFromUnitVectors(up, normal.lerp(up, 0.6).normalize());
      quat.multiply(spin.setFromAxisAngle(up, rng.next() * Math.PI * 2));
      // Tufos mais baixos na borda da trilha (grama pisada).
      const trampled = 1 - smoothstep(0.05, 0.45, dirt) * 0.45;
      const s = rng.range(0.7, 1.45) * trampled;
      scale.set(s, s * rng.range(0.75, 1.35), s);
      pos.set(x, terrainHeight(x, z) - 0.05, z);
      samples.push({ matrix: new THREE.Matrix4().compose(pos, quat, scale), color: grassTint(rng) });
    }
    this.field = new ChunkedInstances(geometry, material, samples, rng, {
      name: 'grass',
      chunkSize: 16,
      lodNear: 20,
      lodFar: 80,
      lodMinFraction: 0.16,
      cullDistance: 105,
      heightMargin: 3,
      skipAO: true, // o passe de AO não roda este vertex shader (grama "fantasma")
    });

    // Touceiras gigantes no morro da borda.
    const rimSamples: InstanceSample[] = [];
    const rimCount = Math.round(count * 0.035);
    for (let i = 0; i < rimCount; i++) {
      const angle = rng.next() * Math.PI * 2;
      const radius = rng.range(PLAY_RADIUS + 3, PLAY_RADIUS + 24);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) > WORLD_SIZE / 2 - 2 || Math.abs(z) > WORLD_SIZE / 2 - 2 || blocked(x, z)) continue;
      const s = rng.range(4, 11) * (0.6 + (radius - PLAY_RADIUS) / 40);
      quat.setFromAxisAngle(up, rng.next() * Math.PI * 2);
      scale.set(s, s * rng.range(0.9, 1.4), s);
      pos.set(x, terrainHeight(x, z) - 0.3, z);
      rimSamples.push({ matrix: new THREE.Matrix4().compose(pos, quat, scale), color: grassTint(rng) });
    }
    this.rim = new ChunkedInstances(geometry, material, rimSamples, rng, {
      name: 'grass-rim',
      chunkSize: 32,
      lodNear: 200,
      lodFar: 300,
      lodMinFraction: 1,
      cullDistance: 400,
      heightMargin: 30,
      skipAO: true,
    });
    this.group.add(this.field.group, this.rim.group);
  }

  /** Fração de tufos desenhada (qualidade adaptativa). */
  setDensity(density: number): void {
    this.field.setDensity(density);
  }

  /** LOD por distância da câmera. */
  update(camera: THREE.Camera): void {
    this.field.update(camera.position);
    this.rim.update(camera.position);
  }
}

/** Maioria verde viva; alguns tufos mais amarelados (secos). */
function grassTint(rng: Rng): THREE.Color {
  const dry = rng.next() < 0.12;
  return new THREE.Color().setHSL(
    dry ? rng.range(0.14, 0.19) : rng.range(0.22, 0.3),
    dry ? rng.range(0.45, 0.6) : rng.range(0.5, 0.68),
    dry ? rng.range(0.5, 0.6) : rng.range(0.38, 0.52),
  );
}

function createGrassMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  const sunDirection = { value: SUN_DIRECTION.clone() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uPushers = globalUniforms.uPushers;
    shader.uniforms.uSunDirection = sunDirection;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying float vGrassH;
        ${windGLSL}
        ${pushersGLSL}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        float h = clamp(position.y / ${BLADE_TIP.toFixed(2)}, 0.0, 1.0);
        vGrassH = h;
        vec2 wind = windOffset(worldPos.xyz);
        // Touceira gigante balança proporcionalmente mais (senão parece de pedra).
        vec3 disp = vec3(wind.x, 0.0, wind.y) * 0.34 * h * h * max(1.0, instanceMatrix[1][1] * 0.45);
        disp += pushersOffset(worldPos.xyz, h);
        // Tufos colados na câmera se abaixam: grama gigante não pode tapar a visão.
        float camDist = length(worldPos.xz - cameraPosition.xz);
        float nearFade = 1.0 - smoothstep(1.2, 4.0, camDist);
        disp.y -= nearFade * position.y * instanceMatrix[1][1] * 0.92;
        worldPos.xyz += disp;
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying float vGrassH;
        uniform vec3 uSunDirection;`,
      )
      // Normal "de tufo" (quase para cima) nos dois lados: sem o verso escuro de folha fina.
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Translucidez: olhando contra o sol, a ponta da lâmina acende.
        vec3 sunView = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);
        float backlit = pow(max(dot(normalize(-vViewPosition), sunView), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.92, 0.6) * backlit * vGrassH * 0.9;`,
      );
  };
  material.customProgramCacheKey = () => 'grass';
  return material;
}

/**
 * Tufo de lâminas finas, afiladas e curvas (tiras de 4 segmentos), com gradiente
 * escuro→claro em vertex color. Normais apontam "para fora e para cima" do tufo:
 * o conjunto é iluminado como uma moita macia, não como folhas soltas.
 */
function buildClumpGeometry(rng: Rng): THREE.BufferGeometry {
  const bladeCount = 7;
  const segments = 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const lean = new THREE.Vector3();
  const center = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let b = 0; b < bladeCount; b++) {
    const height = rng.range(0.85, BLADE_TIP);
    const width = rng.range(0.06, 0.11);
    const angle = (b / bladeCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
    lean.set(Math.cos(angle), 0, Math.sin(angle));
    side.crossVectors(up, lean).normalize();
    const bend = rng.range(0.25, 0.6);
    const ox = rng.range(-0.1, 0.1) + lean.x * 0.05;
    const oz = rng.range(-0.1, 0.1) + lean.z * 0.05;
    // Cada lâmina com um tom levemente diferente (umas mais amarelas, outras mais frias).
    const tint = rng.range(-0.06, 0.06);
    const first = positions.length / 3;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t * height;
      const offset = t * t * bend * height * 0.55;
      center.set(ox + lean.x * offset, y, oz + lean.z * offset);
      n.copy(up).multiplyScalar(0.85).addScaledVector(lean, 0.45 + t * 0.2).normalize();
      const shade = 0.5 + t * 0.62;
      const r = shade * (1 + tint + t * 0.08);
      const g = shade;
      const bl = shade * (1 - tint * 0.5 - t * 0.12);
      if (s === segments) {
        positions.push(center.x, center.y, center.z);
        normals.push(n.x, n.y, n.z);
        colors.push(r, g, bl);
      } else {
        const w = width * (1 - t * 0.82) * 0.5;
        positions.push(center.x - side.x * w, center.y, center.z - side.z * w, center.x + side.x * w, center.y, center.z + side.z * w);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z);
        colors.push(r, g, bl, r, g, bl);
      }
    }
    for (let s = 0; s < segments - 1; s++) {
      const a = first + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const lastPair = first + (segments - 1) * 2;
    indices.push(lastPair, lastPair + 1, first + segments * 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
