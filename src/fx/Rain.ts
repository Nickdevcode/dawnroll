import * as THREE from 'three';
import { createRng } from '../utils/math';

/** Meia-largura e altura da caixa de chuva em volta da câmera (unidades). */
const BOX_HALF = 20;
const BOX_HEIGHT = 26;
/** Velocidade de queda (de brinquedo: gota de verdade, nessa escala, seria um borrão). */
const FALL_SPEED = 34;
const SPLASH_SECONDS = 0.42;
const UP = new THREE.Vector3(0, 1, 0);

/** Onde uma gota bate: altura e se é água (anel maior, sem terra). */
export type SurfaceProbe = (x: number, z: number) => { y: number; water: boolean; normal: THREE.Vector3 };

/**
 * Chuva: riscos finos caindo inclinados pelo vento, todos calculados no vertex
 * shader a partir de uma semente fixa (nada na CPU, igual ao pólen), e anéis de
 * respingo abrindo onde as gotas batem (chão e poças). A quantidade visível
 * acompanha a intensidade: com garoa, só uma fração das gotas acende.
 */
export class Rain {
  readonly group = new THREE.Group();
  private readonly streaks: THREE.Mesh;
  private readonly splashes: THREE.InstancedMesh;
  private readonly splashStart: Float32Array;
  private readonly splashStartAttr: THREE.InstancedBufferAttribute;
  private readonly streakUniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uRain: { value: 0 },
    uWind: { value: new THREE.Vector2(4, 2.5) },
  };
  private readonly splashUniforms = { uTime: { value: 0 } };
  private splashCursor = 0;
  private splashAcc = 0;
  private lastRingTime = -100;
  private readonly rng = createRng(4455);
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();

  constructor(
    dropCount: number,
    private readonly splashesPerSecond: number,
  ) {
    this.group.name = 'rain';
    this.streaks = this.buildStreaks(dropCount);
    const capacity = Math.max(32, Math.ceil(splashesPerSecond * SPLASH_SECONDS * 1.6));
    this.splashStart = new Float32Array(capacity).fill(-100);
    this.splashStartAttr = new THREE.InstancedBufferAttribute(this.splashStart, 1).setUsage(THREE.DynamicDrawUsage);
    this.splashes = this.buildSplashes(capacity);
    this.group.add(this.streaks, this.splashes);
  }

  /**
   * @param intensity 0..1 (0 = sem chuva: nada é desenhado)
   * @param focus onde os respingos se concentram (o besouro)
   */
  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3, intensity: number, probe: SurfaceProbe): void {
    const visible = intensity > 0.01;
    this.streaks.visible = visible;
    this.streakUniforms.uTime.value = time;
    this.streakUniforms.uCenter.value.copy(camera.position);
    this.streakUniforms.uRain.value = intensity;
    this.splashUniforms.uTime.value = time;
    // Anéis continuam visíveis até o último terminar de abrir.
    this.splashes.visible = visible || time - this.lastRingTime < SPLASH_SECONDS;
    if (!visible) return;

    // Respingos: mais perto do besouro (onde o olho está), alguns em volta da câmera.
    this.splashAcc += this.splashesPerSecond * intensity * dt;
    const forward = this.tmpPos.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const fx = forward.x;
    const fz = forward.z;
    while (this.splashAcc >= 1) {
      this.splashAcc -= 1;
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * 13;
      // Empurra para a frente da câmera: respingo atrás dela ninguém vê.
      const x = focus.x + Math.cos(a) * d + fx * 4;
      const z = focus.z + Math.sin(a) * d + fz * 4;
      this.spawnSplash(time, x, z, probe);
    }
  }

  /** Anel avulso na água (algo caiu/andou na poça), mesmo com tempo seco. */
  ripple(time: number, x: number, y: number, z: number, size: number): void {
    this.splashes.visible = true;
    this.placeRing(time, x, y, z, UP, size);
  }

  private spawnSplash(time: number, x: number, z: number, probe: SurfaceProbe): void {
    const hit = probe(x, z);
    const size = hit.water ? this.rng.range(0.28, 0.5) : this.rng.range(0.14, 0.26);
    this.placeRing(time, x, hit.y, z, hit.normal, size);
  }

  private placeRing(time: number, x: number, y: number, z: number, normal: THREE.Vector3, size: number): void {
    const i = this.splashCursor;
    this.splashCursor = (this.splashCursor + 1) % this.splashStart.length;
    this.tmpQuat.setFromUnitVectors(UP, normal);
    this.tmpMatrix.compose(this.tmpPos.set(x, y + 0.025, z), this.tmpQuat, this.tmpScale.setScalar(size));
    this.splashes.setMatrixAt(i, this.tmpMatrix);
    this.splashes.instanceMatrix.needsUpdate = true;
    this.splashStart[i] = time;
    this.splashStartAttr.needsUpdate = true;
    this.lastRingTime = time;
  }

  private buildStreaks(count: number): THREE.Mesh {
    const rng = createRng(90210);
    const seeds = new Float32Array(count * 4 * 4);
    const corners = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    const cornerList = [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ];
    for (let i = 0; i < count; i++) {
      // Limiar de "acender" espalhado: garoa acende poucas, tempestade acende todas.
      const seed = [rng.next(), rng.next(), rng.next(), rng.next() * 0.98 + 0.01];
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        seeds.set(seed, v * 4);
        corners[v * 2] = cornerList[c][0];
        corners[v * 2 + 1] = cornerList[c][1];
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    // `position` só existe para o three contar vértices; a posição real sai do shader.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.streakUniforms]),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        attribute vec2 aCorner;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uRain;
        uniform vec2 uWind;
        varying float vAlpha;
        varying vec2 vCorner;
        #include <fog_pars_vertex>
        void main() {
          float R = ${BOX_HALF.toFixed(1)};
          float H = ${BOX_HEIGHT.toFixed(1)};
          float speed = ${FALL_SPEED.toFixed(1)} * (0.85 + fract(aSeed.x * 13.7) * 0.3);
          float t = uTime * speed;
          vec3 fall = normalize(vec3(uWind.x, -${FALL_SPEED.toFixed(1)}, uWind.y));
          // Posição em "mundo infinito" que cai e deriva; depois dá a volta numa caixa em volta da câmera.
          vec3 p = vec3(aSeed.x * 2.0 * R, aSeed.y * H, aSeed.z * 2.0 * R) + fall * t;
          vec3 rel = vec3(
            mod(p.x - uCenter.x + R, 2.0 * R) - R,
            mod(p.y - uCenter.y + H * 0.45, H) - H * 0.45,
            mod(p.z - uCenter.z + R, 2.0 * R) - R
          );
          vec3 center = uCenter + rel;
          vec3 toCam = cameraPosition - center;
          float dist = length(toCam);
          vec3 side = normalize(cross(fall, toCam / max(dist, 1e-3)));
          float len = 1.1 + fract(aSeed.y * 17.3) * 1.2;
          // Nunca mais fino que ~1 px lá longe (senão vira chuvisco serrilhado).
          float width = max(0.026, dist * 0.0019);
          vec3 world = center + fall * (aCorner.y - 0.5) * len + side * aCorner.x * width;
          vCorner = aCorner;
          float lit = step(aSeed.w, uRain);
          float edge = 1.0 - smoothstep(0.75, 1.0, max(abs(rel.x), abs(rel.z)) / R);
          // Gota colada na lente vira um traço gigante: some perto da câmera.
          float nearFade = smoothstep(1.2, 3.5, dist);
          vAlpha = lit * edge * nearFade * (0.28 + 0.2 * uRain);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec2 vCorner;
        #include <fog_pars_fragment>
        void main() {
          // Macio nas laterais, cauda mais fraca (a gota "risca" o ar).
          float across = 1.0 - abs(vCorner.x);
          float along = smoothstep(0.0, 0.35, vCorner.y) * (0.55 + 0.45 * vCorner.y);
          float a = vAlpha * across * along;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(0.86, 0.9, 0.97), a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const u = material.uniforms;
    this.streakUniforms.uTime = u.uTime as { value: number };
    this.streakUniforms.uCenter = u.uCenter as { value: THREE.Vector3 };
    this.streakUniforms.uRain = u.uRain as { value: number };
    this.streakUniforms.uWind = u.uWind as { value: THREE.Vector2 };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 13;
    mesh.userData.skipAO = true;
    mesh.visible = false;
    mesh.name = 'rain-streaks';
    return mesh;
  }

  private buildSplashes(capacity: number): THREE.InstancedMesh {
    const geometry = new THREE.RingGeometry(0.62, 1, 28, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute('aStart', this.splashStartAttr);
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.splashUniforms]),
      vertexShader: /* glsl */ `
        attribute float aStart;
        uniform float uTime;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          float t = (uTime - aStart) / ${SPLASH_SECONDS.toFixed(2)};
          float alive = step(0.0, t) * step(t, 1.0);
          // O anel abre rápido e perde força; morto, vira ponto (sem custo de pixel).
          float grow = mix(0.15, 1.0, 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), 2.5)) * alive;
          vAlpha = pow(1.0 - clamp(t, 0.0, 1.0), 1.6) * alive;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position * grow, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(vec3(0.9, 0.94, 1.0), vAlpha * 0.5);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.splashUniforms.uTime = material.uniforms.uTime as { value: number };
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.userData.skipAO = true;
    mesh.visible = false;
    mesh.name = 'rain-splashes';
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, hidden);
    return mesh;
  }
}
