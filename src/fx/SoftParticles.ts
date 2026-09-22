import * as THREE from 'three';

export interface SoftSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  color: THREE.Color;
  /** Diâmetro inicial (unidades de mundo). */
  size: number;
  /** Duração em segundos. */
  life: number;
  /** Multiplicador do tamanho no fim da vida (poeira "abre"). */
  grow?: number;
  /** Freio do ar por segundo. */
  drag?: number;
  /** Aceleração vertical (negativo = sobe, como fumaça). */
  gravity?: number;
  alpha?: number;
  /** Balanço lateral (fedor que sobe serpenteando). */
  wobble?: number;
}

/**
 * Partículas macias em pool: um único THREE.Points, sem alocação por frame.
 * Cada ponto é desenhado como um pompom de borda suave com "luz" vindo de cima —
 * poeira e fumaça com volume de massinha, não discos chapados.
 * No modo aditivo (brilhos, pólen) as cores podem passar de 1 e acendem o bloom.
 */
export class SoftParticles {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocity: Float32Array;
  private readonly meta: Float32Array; // por partícula: [idade, vida, tamanho0, grow, drag, gravity, alpha, wobble, fase]
  private cursor = 0;
  private alive = 0;
  private readonly uniforms = { uScale: { value: 500 } };
  private readonly geometry: THREE.BufferGeometry;

  constructor(capacity: number, additive = false) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.meta = new Float32Array(capacity * 9);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uniforms]),
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.001 ? aSize * uScale / max(-mvPosition.z, 0.1) : 0.0;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          ${
            additive
              ? 'float soft = pow(1.0 - r2, 3.0); vec3 col = vColor;'
              : // Pompom: borda macia + claro em cima, escuro embaixo (gl_PointCoord.y cresce para baixo).
                'float soft = pow(1.0 - r2, 1.4); vec3 col = vColor * (0.78 + 0.22 * sqrt(1.0 - r2) - c.y * 0.12);'
          }
          gl_FragColor = vec4(col, vAlpha * soft);
          ${
            additive
              ? // Aditivo: misturar com a cor da neblina acenderia o fundo; em vez disso, apaga.
                '#ifdef USE_FOG\n gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);\n #endif'
              : '#include <fog_fragment>'
          }
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    // O `uniforms` do material é uma cópia (merge): guarda a referência certa para atualizar.
    this.uniforms.uScale = material.uniforms.uScale as { value: number };

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 10;
    this.points.userData.skipAO = true;
    this.points.name = additive ? 'particles-glow' : 'particles-soft';
  }

  spawn(s: SoftSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.positions[i3] = s.x;
    this.positions[i3 + 1] = s.y;
    this.positions[i3 + 2] = s.z;
    this.velocity[i3] = s.vx ?? 0;
    this.velocity[i3 + 1] = s.vy ?? 0;
    this.velocity[i3 + 2] = s.vz ?? 0;
    this.colors[i3] = s.color.r;
    this.colors[i3 + 1] = s.color.g;
    this.colors[i3 + 2] = s.color.b;
    const m = i * 9;
    this.meta[m] = 0;
    this.meta[m + 1] = Math.max(s.life, 0.05);
    this.meta[m + 2] = s.size;
    this.meta[m + 3] = s.grow ?? 1.8;
    this.meta[m + 4] = s.drag ?? 2;
    this.meta[m + 5] = s.gravity ?? 0;
    this.meta[m + 6] = s.alpha ?? 0.6;
    this.meta[m + 7] = s.wobble ?? 0;
    this.meta[m + 8] = Math.random() * Math.PI * 2;
    this.alphas[i] = 0.0011; // vivo (o update define o valor real)
    this.alive = Math.min(this.alive + 1, this.capacity);
  }

  /** @param pixelScale altura do buffer de desenho / (2·tan(fov/2)) — converte tamanho em pixels. */
  update(dt: number, pixelScale: number): void {
    this.uniforms.uScale.value = pixelScale;
    if (this.alive === 0) return;
    let stillAlive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.alphas[i] <= 0) continue;
      const m = i * 9;
      const age = (this.meta[m] += dt);
      const life = this.meta[m + 1];
      if (age >= life) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      stillAlive++;
      const t = age / life;
      const i3 = i * 3;
      const drag = Math.exp(-this.meta[m + 4] * dt);
      this.velocity[i3] *= drag;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * drag - this.meta[m + 5] * dt;
      this.velocity[i3 + 2] *= drag;
      const wobble = this.meta[m + 7];
      const phase = this.meta[m + 8];
      this.positions[i3] += (this.velocity[i3] + (wobble ? Math.sin(age * 3.1 + phase) * wobble : 0)) * dt;
      this.positions[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.positions[i3 + 2] += (this.velocity[i3 + 2] + (wobble ? Math.cos(age * 2.3 + phase) * wobble : 0)) * dt;
      this.sizes[i] = this.meta[m + 2] * (1 + (this.meta[m + 3] - 1) * (1 - (1 - t) * (1 - t)));
      // Entra rápido, some devagar.
      const fadeIn = Math.min(1, t / 0.08);
      const fadeOut = 1 - Math.max(0, (t - 0.35) / 0.65);
      this.alphas[i] = Math.max(0.0011, this.meta[m + 6] * fadeIn * fadeOut * fadeOut);
    }
    this.alive = stillAlive;
    const attrs = this.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aColor.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
  }
}
