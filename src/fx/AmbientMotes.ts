import * as THREE from 'three';

/** Meio-lado da caixa de pólen em volta da câmera (unidades). */
const RANGE = 16;

/**
 * Pólen e fiapos de dente-de-leão flutuando no ar, sempre em volta da câmera.
 * Nada roda na CPU: cada ponto tem uma semente fixa e o vertex shader calcula a
 * deriva, dá a volta na caixa (campo "infinito") e faz cintilar. Aditivo, com
 * cor acima de 1: pega o bloom e brilha no sol.
 */
export class AmbientMotes {
  readonly points: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uScale: { value: 500 },
  };

  constructor(count: number, seed = 5) {
    const seeds = new Float32Array(count * 4);
    let s = seed;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const geometry = new THREE.BufferGeometry();
    // O `position` é só para o three saber quantos pontos há; a posição real vem do shader.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(this.uniforms),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uScale;
        varying float vAlpha;
        varying float vKind;
        void main() {
          float R = ${RANGE.toFixed(1)};
          vec3 p = aSeed.xyz * 2.0 * R - R;
          float t = uTime * (0.6 + aSeed.w * 0.6);
          p += vec3(
            sin(t * 0.31 + aSeed.y * 40.0) * 1.8 + uTime * 0.35,
            sin(t * 0.53 + aSeed.x * 30.0) * 0.9 + uTime * 0.12,
            cos(t * 0.27 + aSeed.z * 50.0) * 1.8 + uTime * 0.18
          );
          vec3 rel = mod(p - uCenter + R, 2.0 * R) - R;
          vec3 world = uCenter + vec3(rel.x, rel.y * 0.28 + 1.2, rel.z);
          // Some na borda da caixa (sem "pipocar" quando dá a volta).
          float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), max(abs(rel.z), abs(rel.y))) / R);
          float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + aSeed.w * 3.0) + aSeed.x * 60.0);
          vAlpha = edge * twinkle;
          vKind = step(0.9, aSeed.w); // ~10% são fiapos maiores de dente-de-leão
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          // Sem neblina aqui (somar a cor da neblina acenderia o céu): some com a distância.
          vAlpha *= 1.0 - smoothstep(12.0, 20.0, -mvPosition.z);
          float size = mix(0.045, 0.16, vKind);
          gl_PointSize = size * uScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          // Pólen: pontinho quente e duro. Fiapo: estrelinha macia e branca.
          float core = mix(pow(1.0 - r2, 4.0), pow(1.0 - r2, 1.5) * (0.6 + 0.4 * abs(sin(atan(c.y, c.x) * 3.0))), vKind);
          vec3 color = mix(vec3(2.4, 2.1, 1.3), vec3(1.6, 1.6, 1.55), vKind);
          gl_FragColor = vec4(color * core * vAlpha, 1.0);
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

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    this.points.userData.skipAO = true;
    this.points.name = 'ambient-motes';
  }

  update(time: number, center: THREE.Vector3, pixelScale: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uScale.value = pixelScale;
  }
}
