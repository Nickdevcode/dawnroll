import * as THREE from 'three';
import { terrainHeight, terrainNormal } from '../world/Terrain';
import { SUN_DIRECTION } from '../render/Graphics';

/** Tom da mancha: o verde-escuro da sombra pintada no chão, um pouco mais fundo. */
const SHADE = new THREE.Color('#26331d');
const UP = new THREE.Vector3(0, 1, 0);
/** Para onde a sombra do sol cai (no chão), por unidade de altura: a mancha escorrega junto. */
const CAST_X = -SUN_DIRECTION.x / SUN_DIRECTION.y;
const CAST_Z = -SUN_DIRECTION.z / SUN_DIRECTION.y;
const tmpNormal = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/**
 * Sombra "de mancha" no chão embaixo do besouro e das bolas, para quando a
 * sombra do sol está desligada (qualidade Mínima): sem nada embaixo, tudo
 * parece flutuar. Um círculo escuro e macio por objeto, todos num draw call.
 * A mancha encolhe e clareia com a altura (pulo, bola quicando).
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;

  constructor(private readonly capacity = 24) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: SHADE } }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          vUv = uv;
          // A força de cada mancha vai no vermelho da cor por instância.
          vStrength = instanceColor.r;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          float r = length(vUv * 2.0 - 1.0);
          float a = 1.0 - smoothstep(0.2, 1.0, r);
          gl_FragColor = vec4(uColor, a * a * vStrength);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // A cor por instância precisa existir antes da primeira compilação (muda o programa).
    this.mesh.setColorAt(0, tmpColor.setRGB(0, 0, 0));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.mesh.userData.skipAO = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'blob-shadows';
    this.mesh.visible = false;
  }

  get enabled(): boolean {
    return this.mesh.visible;
  }

  set enabled(on: boolean) {
    this.mesh.visible = on;
    if (!on) this.mesh.count = 0;
  }

  /** Começa um quadro (as manchas do quadro anterior somem). */
  begin(): void {
    this.used = 0;
  }

  /**
   * Uma mancha embaixo de algo com `radius` (unidades) cujo ponto mais baixo
   * está em `bottomY`. `strength` = escuridão no chão (0..1).
   */
  add(x: number, bottomY: number, z: number, radius: number, strength: number): void {
    if (this.used >= this.capacity || radius <= 0) return;
    // O centro do objeto está a ~1 raio do chão: a sombra dele cai um pouco pro lado oposto ao sol.
    x += CAST_X * radius * 0.6;
    z += CAST_Z * radius * 0.6;
    const ground = terrainHeight(x, z);
    const lift = Math.max(0, bottomY - ground);
    const fade = 1 - THREE.MathUtils.smoothstep(lift, 0, radius * 3 + 0.8);
    if (fade <= 0.01) return;
    terrainNormal(x, z, tmpNormal);
    tmpQuat.setFromUnitVectors(UP, tmpNormal);
    const size = radius * (1 - lift * 0.08);
    tmpScale.set(size, 1, size);
    tmpPos.set(x, ground + 0.03, z);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(this.used, tmpMatrix);
    this.mesh.setColorAt(this.used, tmpColor.setRGB(strength * fade, 0, 0));
    this.used++;
  }

  /** Fecha o quadro: sobe só as manchas usadas. */
  end(): void {
    const mesh = this.mesh;
    mesh.count = this.used;
    if (this.used === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, this.used * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges();
    mesh.instanceColor!.addUpdateRange(0, this.used * 3);
    mesh.instanceColor!.needsUpdate = true;
  }
}
