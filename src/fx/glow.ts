import * as THREE from 'three';

/**
 * Luz "de mentirinha" pros brilhos do jardim (achado raro, baú): mancha
 * radial pra sprite e anel que pulsa no chão. Aditivos e sem escrever
 * profundidade: sem contorno, sem oclusão e sem sombra (é luz, não objeto).
 */

let sharedGlow: THREE.CanvasTexture | null = null;

/** Mancha de luz redonda (degradê radial). Uma textura só pro jogo inteiro. */
export function glowTexture(): THREE.CanvasTexture {
  if (sharedGlow) return sharedGlow;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedGlow = new THREE.CanvasTexture(canvas);
  sharedGlow.colorSpace = THREE.SRGBColorSpace;
  return sharedGlow;
}

/** Anel fininho que pulsa pra fora devagar, com um brilho mole no meio (plano no chão). */
export function pulseRingMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uColor: { value: color.clone() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float wave = fract(r - uTime * 0.4);
        float ring = smoothstep(0.0, 0.06, wave) * (1.0 - smoothstep(0.06, 0.22, wave));
        float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.35;
        float a = (ring * 0.8 + glow) * (1.0 - smoothstep(0.8, 1.0, r)) * uFade;
        // Aditivo: a cor entra multiplicada pelo alfa uma vez só (o blend já faz isso).
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Marca como "luz": fora da oclusão e desenhada depois do resto. */
export function markAsLight(object: THREE.Object3D, renderOrder = 11): void {
  object.renderOrder = renderOrder;
  object.userData.skipAO = true;
  object.traverse((child) => {
    child.userData.skipAO = true;
    (child as THREE.Mesh).castShadow = false;
    (child as THREE.Mesh).receiveShadow = false;
  });
}
