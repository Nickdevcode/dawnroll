import * as THREE from 'three';
import { damp } from '../utils/math';
import { terrainHeight } from '../world/Terrain';

/** Meio-lado da caixa de vaga-lumes em volta do ponto que a câmera olha (unidades). */
const RANGE = 7;
/** Quão à frente da câmera fica o centro do enxame. */
const AHEAD = 4.5;

const tmp = new THREE.Vector3();

/**
 * Vaga-lumes da madrugada do menu: pontinhos amarelo-esverdeados flutuando
 * baixo, perto do chão, cada um piscando no seu ritmo (acende rápido, apaga
 * devagar, como o de verdade). Tudo no shader, como o pólen: cada ponto tem
 * uma semente fixa e o vertex shader calcula deriva, volta na caixa e pisca.
 * Aditivo e com cor acima de 1, para o bloom fazer o brilho. Aparece e some
 * suave quando o menu abre e fecha.
 */
export class Fireflies {
  readonly points: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uScale: { value: 500 },
    uVisibility: { value: 0 },
  };
  private target = 0;

  constructor(count: number, seed = 17) {
    const seeds = new Float32Array(count * 4);
    let s = seed;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const geometry = new THREE.BufferGeometry();
    // O `position` só diz quantos pontos há; a posição de verdade sai do shader.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(this.uniforms),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uScale;
        uniform float uVisibility;
        varying float vGlow;
        void main() {
          float R = ${RANGE.toFixed(1)};
          // Deriva lenta e preguiçosa (vaga-lume voa devagar, em curvas).
          float t = uTime * (0.35 + aSeed.w * 0.3);
          vec3 p = vec3(aSeed.x * 2.0 * R - R, 0.0, aSeed.z * 2.0 * R - R);
          p.x += sin(t * 0.7 + aSeed.y * 40.0) * 1.3 + sin(t * 0.23 + aSeed.z * 9.0) * 0.8;
          p.z += cos(t * 0.6 + aSeed.x * 30.0) * 1.3 + cos(t * 0.19 + aSeed.y * 7.0) * 0.8;
          vec3 rel = vec3(mod(p.x - uCenter.x + R, 2.0 * R) - R, 0.0, mod(p.z - uCenter.z + R, 2.0 * R) - R);
          float height = 0.35 + aSeed.y * 2.1 + sin(t * 1.1 + aSeed.w * 20.0) * 0.25;
          vec3 world = vec3(uCenter.x + rel.x, uCenter.y + height, uCenter.z + rel.z);
          // Pisca: acende rápido, apaga devagar, cada um no seu período (2,5 a 5 s).
          float period = 2.5 + aSeed.w * 2.5;
          float ph = fract(uTime / period + aSeed.x * 7.0);
          float flash = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.2, 0.55, ph));
          float edge = 1.0 - smoothstep(0.75, 1.0, max(abs(rel.x), abs(rel.z)) / R);
          vGlow = (0.16 + flash) * edge * uVisibility;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          vGlow *= 1.0 - smoothstep(16.0, 24.0, -mvPosition.z);
          gl_PointSize = (0.1 + 0.2 * flash) * uScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          // Miolo quente e duro + halo macio (o bloom completa).
          float core = pow(1.0 - r2, 8.0);
          float halo = pow(1.0 - r2, 2.5) * 0.55;
          vec3 color = mix(vec3(1.3, 2.6, 0.2), vec3(3.0, 4.0, 0.7), core);
          gl_FragColor = vec4(color * (core + halo) * vGlow, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const u = material.uniforms;
    this.uniforms.uTime = u.uTime as { value: number };
    this.uniforms.uCenter = u.uCenter as { value: THREE.Vector3 };
    this.uniforms.uScale = u.uScale as { value: number };
    this.uniforms.uVisibility = u.uVisibility as { value: number };

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    this.points.userData.skipAO = true;
    this.points.visible = false;
    this.points.name = 'fireflies';
  }

  /** Menu aberto (madrugada) acende os vaga-lumes; jogando, eles somem devagar. */
  setActive(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  update(dt: number, time: number, camera: THREE.Camera, pixelScale: number): void {
    const u = this.uniforms;
    u.uVisibility.value = damp(u.uVisibility.value, this.target, this.target > 0 ? 0.8 : 1.6, dt);
    this.points.visible = u.uVisibility.value > 0.01;
    if (!this.points.visible) return;
    u.uTime.value = time;
    u.uScale.value = pixelScale;
    // Centro no chão, um pouco à frente da câmera (onde o olhar cai).
    camera.getWorldDirection(tmp);
    tmp.y = 0;
    if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, -1);
    tmp.normalize().multiplyScalar(AHEAD).add(camera.position);
    u.uCenter.value.set(tmp.x, terrainHeight(tmp.x, tmp.z), tmp.z);
  }
}
