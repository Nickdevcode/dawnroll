import * as THREE from 'three';

/**
 * Pedaços de GLSL e uniforms globais compartilhados por vários materiais
 * (massinha, grama, cobertura do chão). Os uniforms são o MESMO objeto em
 * todos os shaders: atualizar aqui uma vez por frame atualiza todo mundo.
 */

/** Quantos "empurradores" (besouro + bola) amassam a vegetação ao passar. */
export const MAX_PUSHERS = 2;

export const globalUniforms = {
  uTime: { value: 0 },
  /** x, y, z = posição; w = raio de influência. */
  uPushers: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, -999, 0, 0)) },
};

/** Ruído de valor barato (hash sem textura) em 2D e 3D. */
export const noiseGLSL = /* glsl */ `
float clayHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float clayHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float clayNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = clayHash13(i);
  float b = clayHash13(i + vec3(1.0, 0.0, 0.0));
  float c = clayHash13(i + vec3(0.0, 1.0, 0.0));
  float d = clayHash13(i + vec3(1.0, 1.0, 0.0));
  float e = clayHash13(i + vec3(0.0, 0.0, 1.0));
  float g = clayHash13(i + vec3(1.0, 0.0, 1.0));
  float h = clayHash13(i + vec3(0.0, 1.0, 1.0));
  float k = clayHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float clayNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = clayHash12(i);
  float b = clayHash12(i + vec2(1.0, 0.0));
  float c = clayHash12(i + vec2(0.0, 1.0));
  float d = clayHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/**
 * Vento: ondas grandes e lentas (rajadas atravessando o campo) + tremidinha rápida.
 * Devolve o deslocamento horizontal máximo (para a ponta da planta).
 */
export const windGLSL = /* glsl */ `
uniform float uTime;
vec2 windOffset(vec3 wp) {
  float gust = sin(uTime * 1.1 + wp.x * 0.09 + wp.z * 0.05) * 0.5 + 0.5;
  gust *= gust;
  float sway = sin(uTime * 1.9 + wp.x * 0.37 + wp.z * 0.23);
  float flutter = sin(uTime * 4.7 + wp.x * 1.3 - wp.z * 0.9) * 0.35;
  float amount = 0.25 + gust * 0.85;
  return vec2(0.85, 0.5) * amount * (0.55 + sway * 0.45 + flutter * 0.4);
}
`;

/**
 * Vegetação que abre caminho: empurra os vértices para longe do besouro e da bola
 * e achata quem ficou embaixo. `h` = altura relativa do vértice (0 base, 1 ponta).
 */
export const pushersGLSL = /* glsl */ `
uniform vec4 uPushers[${MAX_PUSHERS}];
vec3 pushersOffset(vec3 wp, float h) {
  vec3 disp = vec3(0.0);
  for (int i = 0; i < ${MAX_PUSHERS}; i++) {
    vec2 d = wp.xz - uPushers[i].xz;
    float dist = length(d);
    float radius = uPushers[i].w;
    float influence = (1.0 - smoothstep(radius * 0.5, radius + 0.7, dist))
                    * step(abs(wp.y - uPushers[i].y), radius + 1.5);
    disp.xz += (d / max(dist, 1e-3)) * influence * 0.75 * h;
    disp.y -= influence * 0.6 * h;
  }
  return disp;
}
`;
