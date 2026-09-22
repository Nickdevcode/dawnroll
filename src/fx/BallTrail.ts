import * as THREE from 'three';
import { terrainHeight, terrainNormal } from '../world/Terrain';

const FADE_SECONDS = 16;
const UP = new THREE.Vector3(0, 1, 0);
const tmpNormal = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();

/**
 * Rastro que a bola deixa no chão: manchinhas escuras e úmidas, alinhadas ao
 * relevo, que desbotam devagar. Um único InstancedMesh em anel (reaproveita as
 * mais velhas); o desbotamento vai por atributo instanciado, sem alocar nada.
 */
export class BallTrail {
  readonly mesh: THREE.InstancedMesh;
  private readonly fades: Float32Array;
  private readonly fadeAttr: THREE.InstancedBufferAttribute;
  private readonly ages: Float32Array;
  private cursor = 0;
  private readonly lastStamp = new THREE.Vector3(Infinity, 0, 0);

  constructor(private readonly capacity = 320) {
    const geometry = new THREE.CircleGeometry(1, 24);
    geometry.rotateX(-Math.PI / 2);
    this.fades = new Float32Array(capacity);
    this.ages = new Float32Array(capacity).fill(FADE_SECONDS);
    this.fadeAttr = new THREE.InstancedBufferAttribute(this.fades, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFade', this.fadeAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: new THREE.Color('#3f2816') }, uOpacity: { value: 0.34 } },
      ]),
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vFade = aFade;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          // Mancha com borda irregular (bosta não carimba círculo perfeito).
          float a = atan(vUv.y - 0.5, vUv.x - 0.5);
          float edge = 0.62 + 0.12 * sin(a * 5.0 + vFade * 3.0) + 0.08 * sin(a * 11.0);
          float alpha = (1.0 - smoothstep(edge * 0.55, edge, r)) * vFade * uOpacity;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      fog: true,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.skipAO = true;
    this.mesh.name = 'ball-trail';
    tmpMatrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, tmpMatrix);
  }

  /**
   * Carimba uma mancha se a bola andou o suficiente desde a última.
   * @param x,z ponto de contato no chão
   * @param radius raio da bola (a mancha acompanha o tamanho do contato)
   */
  track(x: number, z: number, radius: number, onGround: boolean): void {
    if (!onGround) {
      this.lastStamp.set(Infinity, 0, 0);
      return;
    }
    const spacing = Math.max(0.18, radius * 0.4);
    if (Number.isFinite(this.lastStamp.x) && Math.hypot(x - this.lastStamp.x, z - this.lastStamp.z) < spacing) return;
    this.lastStamp.set(x, 0, z);

    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    terrainNormal(x, z, tmpNormal);
    tmpQuat.setFromUnitVectors(UP, tmpNormal);
    tmpQuat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2));
    const size = Math.min(0.2 + radius * 0.55, 2.4) * (0.85 + Math.random() * 0.3);
    tmpPos.set(x, terrainHeight(x, z) + 0.03, z);
    tmpScale.set(size, 1, size * (0.8 + Math.random() * 0.3));
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ages[i] = 0;
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.ages[i] >= FADE_SECONDS) continue;
      this.ages[i] += dt;
      const t = this.ages[i] / FADE_SECONDS;
      this.fades[i] = t >= 1 ? 0 : (1 - t) * (1 - t * 0.5);
      changed = true;
    }
    if (changed) this.fadeAttr.needsUpdate = true;
  }
}
