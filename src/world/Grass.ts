import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../utils/math';
import { terrainHeight, terrainNormal, dirtAmount, PLAY_RADIUS } from './Terrain';

/** Quantos "empurradores" (besouro + bola) amassam a grama ao passar. */
const MAX_PUSHERS = 2;

/**
 * Grama instanciada: um único draw call para milhares de tufos.
 * O vertex shader faz o vento e abre caminho quando o besouro ou a bola passam.
 */
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uPushers: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, -999, 0, 0)) },
  };

  constructor(count = 3200, seed = 42) {
    const rng = createRng(seed);
    const geometry = buildClumpGeometry(rng);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uPushers = this.uniforms.uPushers;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime;
          uniform vec4 uPushers[${MAX_PUSHERS}];`,
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          float h = clamp(position.y / 1.6, 0.0, 1.0);
          float h2 = h * h;
          float gust = sin(uTime * 1.6 + worldPos.x * 0.31 + worldPos.z * 0.23) * 0.6
                     + sin(uTime * 3.3 + worldPos.x * 0.9 - worldPos.z * 0.4) * 0.25;
          vec3 disp = vec3(gust * 0.16, 0.0, gust * 0.08) * h2;
          for (int i = 0; i < ${MAX_PUSHERS}; i++) {
            vec2 d = worldPos.xz - uPushers[i].xz;
            float dist = length(d);
            float radius = uPushers[i].w;
            float influence = (1.0 - smoothstep(radius * 0.5, radius + 0.7, dist))
                            * step(abs(worldPos.y - uPushers[i].y), radius + 1.5);
            disp.xz += (d / max(dist, 1e-3)) * influence * 0.75 * h;
            disp.y -= influence * 0.55 * h;
          }
          // Tufos colados na câmera se abaixam: grama gigante não pode tapar a visão.
          float camDist = length(worldPos.xz - cameraPosition.xz);
          float nearFade = 1.0 - smoothstep(1.2, 4.0, camDist);
          disp.y -= nearFade * position.y * instanceMatrix[1][1] * 0.92;
          worldPos.xyz += disp;
          vec4 mvPosition = viewMatrix * worldPos;
          gl_Position = projectionMatrix * mvPosition;`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false; // sombra com vento exigiria shader de profundidade próprio
    this.mesh.frustumCulled = false; // o bounding box instanciado não conta o deslocamento do vento
    this.mesh.name = 'grass';

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 6) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * (PLAY_RADIUS + 12);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Nada de grama na terra batida nem colada no ponto de nascimento.
      if (dirtAmount(x, z) > 0.45 || Math.hypot(x, z) < 2.5) continue;

      terrainNormal(x, z, normal);
      quat.setFromUnitVectors(up, normal.lerp(up, 0.6).normalize());
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng.next() * Math.PI * 2));
      const s = rng.range(0.7, 1.5);
      scale.set(s, s * rng.range(0.8, 1.35), s);
      pos.set(x, terrainHeight(x, z) - 0.05, z);
      matrix.compose(pos, quat, scale);
      this.mesh.setMatrixAt(placed, matrix);
      color.setHSL(rng.range(0.22, 0.3), rng.range(0.5, 0.65), rng.range(0.4, 0.52));
      this.mesh.setColorAt(placed, color);
      placed++;
    }
    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** @param pushers x, y, z = posição; w = raio de influência */
  update(time: number, pushers: THREE.Vector4[]): void {
    this.uniforms.uTime.value = time;
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const p = pushers[i];
      if (p) this.uniforms.uPushers.value[i].copy(p);
    }
  }
}

/** Tufo de 5–6 folhas afiladas e curvas, com gradiente escuro→claro em vertex color. */
function buildClumpGeometry(rng: Rng): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const bladeCount = 6;
  for (let i = 0; i < bladeCount; i++) {
    const height = rng.range(0.9, 1.7);
    const blade = new THREE.ConeGeometry(0.07, height, 4, 5, true);
    blade.translate(0, height / 2, 0);
    blade.scale(1, 1, 0.3);
    const pos = blade.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const bend = rng.range(0.15, 0.45);
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = y / height;
      pos.setX(v, pos.getX(v) + t * t * bend);
      // Base mais escura (a AO "de pintura") e ponta mais clara.
      const shade = 0.55 + t * 0.55;
      colors[v * 3] = shade;
      colors[v * 3 + 1] = shade;
      colors[v * 3 + 2] = shade;
    }
    blade.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    blade.rotateY((i / bladeCount) * Math.PI * 2 + rng.range(-0.4, 0.4));
    blade.translate(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12));
    blade.computeVertexNormals();
    blades.push(blade);
  }
  const merged = mergeGeometries(blades);
  blades.forEach((b) => b.dispose());
  return merged;
}
