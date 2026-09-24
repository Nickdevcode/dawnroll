import * as THREE from 'three';
import { globalUniforms } from './shaderChunks';
import type { SkinDef, SkinPattern } from '../progression/skins';

/**
 * Desenho do casco do besouro, pintado no shader por cima da massinha.
 *
 * Cada vértice do casco carrega `skinPos`: a posição dele no espaço do corpo EM
 * REPOUSO (xyz) e de que parte é (w: 0 = élitros, 1 = pronoto, 2 = cabeça,
 * chifre e pálpebras). Assim o desenho fica grudado no casco (não escorrega
 * quando o corpo amassa, inclina ou a pálpebra pisca) e é o mesmo dos dois
 * lados (as pintas da joaninha saem espelhadas).
 *
 * Um programa só pra todos os desenhos: o tipo vai por uniform (`uSkinKind`) e
 * o `if` em cima de uniform é coerente na GPU (só o ramo escolhido roda). Trocar
 * de casco não recompila nada.
 *
 * Os desenhos "vivos" leem o relógio global e somam brilho próprio
 * (`totalEmissiveRadiance`), que o bloom transforma em luz.
 */

/** Índice de cada desenho no shader (a ordem tem que bater com o GLSL abaixo). */
const PATTERN_INDEX: Record<SkinPattern, number> = {
  plain: 0,
  spots: 1,
  stripes: 2,
  rosettes: 3,
  gingham: 4,
  melon: 5,
  camo: 6,
  crystal: 7,
  galaxy: 8,
  magma: 9,
  aurora: 10,
  holo: 11,
  abyss: 12,
  dawn: 13,
  gold: 14,
};

/** Parte do casco no `skinPos.w`. */
export const SkinPart = { elytra: 0, pronotum: 1, head: 2 } as const;
export type SkinPartId = (typeof SkinPart)[keyof typeof SkinPart];

export interface SkinUniforms {
  [name: string]: THREE.IUniform;
  uSkinKind: { value: number };
  uSkinElytra: { value: THREE.Color };
  uSkinPronotum: { value: THREE.Color };
  uSkinHead: { value: THREE.Color };
  uSkinA: { value: THREE.Color };
  uSkinB: { value: THREE.Color };
  uSkinC: { value: THREE.Color };
  uSkinGlow: { value: number };
}

export function createSkinUniforms(): SkinUniforms {
  return {
    uSkinKind: { value: 0 },
    uSkinElytra: { value: new THREE.Color() },
    uSkinPronotum: { value: new THREE.Color() },
    uSkinHead: { value: new THREE.Color() },
    uSkinA: { value: new THREE.Color() },
    uSkinB: { value: new THREE.Color() },
    uSkinC: { value: new THREE.Color() },
    uSkinGlow: { value: 0 },
  };
}

/** Passa as cores e o desenho do casco pros uniforms (não recompila nada). */
export function applySkinUniforms(uniforms: SkinUniforms, def: SkinDef): void {
  uniforms.uSkinKind.value = PATTERN_INDEX[def.pattern ?? 'plain'];
  uniforms.uSkinElytra.value.set(def.elytra);
  uniforms.uSkinPronotum.value.set(def.pronotum);
  uniforms.uSkinHead.value.set(def.head ?? def.pronotum);
  const [a = def.elytra, b = a, c = b] = def.accents ?? [];
  uniforms.uSkinA.value.set(a);
  uniforms.uSkinB.value.set(b);
  uniforms.uSkinC.value.set(c);
  uniforms.uSkinGlow.value = def.glow ?? 0;
}

const skinVertexPars = /* glsl */ `
attribute vec4 skinPos;
varying vec4 vSkinPos;
`;

/**
 * Funções dos desenhos. Entram logo antes do `main()` do fragment, depois do
 * ruído da massinha (`clayHash13`, `clayNoise3`...) e das varyings do three
 * (`vNormal`, `vViewPosition`), que elas usam.
 */
const skinFragmentPars = /* glsl */ `
varying vec4 vSkinPos;
uniform float uSkinKind;
uniform vec3 uSkinElytra;
uniform vec3 uSkinPronotum;
uniform vec3 uSkinHead;
uniform vec3 uSkinA;
uniform vec3 uSkinB;
uniform vec3 uSkinC;
uniform float uSkinGlow;
uniform float uSkinTime;

float skinFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * clayNoise3(p);
    p = p * 2.03 + 7.1;
    amp *= 0.5;
  }
  return sum;
}

/** Células (Worley): x = distância ao centro mais perto, y = ao segundo; id = célula vencedora. */
vec2 skinCells(vec3 p, out vec3 id) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  id = i;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(clayHash13(i + g), clayHash13(i + g + 17.31), clayHash13(i + g + 41.73));
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = i + g; }
        else if (d < d2) { d2 = d; }
      }
    }
  }
  return vec2(sqrt(d1), sqrt(d2));
}

vec3 skinHue(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

/** Ângulo em volta do eixo do corpo (z): a "longitude" do casco, pra listras que abraçam a cúpula. */
float skinAround(vec3 p) {
  return atan(p.x, p.y - 0.26);
}

/** Estrelinhas: pontos em células 3D, cada um piscando no seu ritmo. Devolve o brilho (0..1+). */
float skinStars(vec3 p, float density, float scale) {
  vec3 sp = p * scale;
  vec3 si = floor(sp);
  vec3 sf = fract(sp) - 0.5;
  float h = clayHash13(si);
  if (h < 1.0 - density) return 0.0;
  vec3 off = vec3(clayHash13(si + 3.1), clayHash13(si + 7.7), clayHash13(si + 11.3)) - 0.5;
  float d = length(sf - off * 0.5);
  float star = 1.0 - smoothstep(0.0, 0.14, d);
  float twinkle = 0.45 + 0.55 * sin(uSkinTime * (1.5 + h * 4.0) + h * 60.0);
  return star * twinkle;
}

/**
 * Cor do casco neste ponto (antes da sombra assada nos vértices) e o brilho
 * próprio (\`glow\`, em luz linear).
 */
vec3 skinColor(vec3 p, float part, out vec3 glow) {
  glow = vec3(0.0);
  vec3 base = part < 0.5 ? uSkinElytra : (part < 1.5 ? uSkinPronotum : uSkinHead);
  int kind = int(uSkinKind + 0.5);
  if (kind == 0) return base;

  vec3 V = normalize(vViewPosition);
  #ifndef FLAT_SHADED
    vec3 N = normalize(vNormal);
  #else
    vec3 N = V;
  #endif
  float fresnel = 1.0 - abs(dot(N, V));

  if (kind == 1) {
    // Joaninha: pintas pretas espelhadas (e uma no meio, sobre a emenda dos élitros);
    // no pronoto preto, as duas manchas brancas da frente.
    vec2 q = vec2(abs(p.x), p.z);
    if (part < 0.5) {
      float s = 1.0 - smoothstep(0.062, 0.074, length(q - vec2(0.0, 0.2)));
      s = max(s, 1.0 - smoothstep(0.066, 0.078, length(q - vec2(0.19, 0.04))));
      s = max(s, 1.0 - smoothstep(0.072, 0.084, length(q - vec2(0.27, -0.2))));
      s = max(s, 1.0 - smoothstep(0.058, 0.07, length(q - vec2(0.13, -0.37))));
      return mix(base, uSkinA, s);
    }
    if (part < 1.5) {
      float w = 1.0 - smoothstep(0.07, 0.085, length((q - vec2(0.22, 0.37)) * vec2(1.0, 1.4)));
      return mix(base, uSkinB, w);
    }
    return base;
  }

  if (kind == 2) {
    // Abelha: faixas pretas atravessando os élitros.
    if (part < 0.5) {
      float band = sin((p.z + 0.02) * 23.0);
      return mix(base, uSkinA, smoothstep(-0.12, 0.12, band));
    }
    return base;
  }

  if (kind == 3) {
    // Onça: rosetas (anel quebrado em volta de um miolo mais escuro); na cabeça, pintinhas.
    vec3 id;
    float scale = part > 1.5 ? 16.0 : 9.0;
    vec2 d = skinCells(p * scale, id);
    float h = clayHash13(id * 1.7);
    vec3 c = base * (0.94 + 0.12 * h);
    if (part > 1.5) {
      return mix(c, uSkinA, (1.0 - smoothstep(0.18, 0.26, d.x)) * step(0.35, h));
    }
    float ring = smoothstep(0.2, 0.27, d.x) * (1.0 - smoothstep(0.36, 0.44, d.x));
    ring *= smoothstep(0.32, 0.42, clayNoise3(p * 34.0 + h * 9.0));
    c = mix(c, uSkinB, (1.0 - smoothstep(0.0, 0.24, d.x)) * 0.55);
    return mix(c, uSkinA, ring);
  }

  if (kind == 4) {
    // Xadrez de toalha (gingham): faixa + faixa = quadradinho cheio, uma só = meio-tom.
    vec2 q = vec2(skinAround(p) * 0.34, p.z) * 12.0;
    float bx = smoothstep(0.46, 0.54, fract(q.x));
    float bz = smoothstep(0.46, 0.54, fract(q.y));
    float weave = 0.035 * sin(q.x * 38.0) * sin(q.y * 38.0);
    vec3 c = mix(base, uSkinA, clamp((bx + bz) * 0.5 + weave, 0.0, 1.0));
    return part > 1.5 ? base : c;
  }

  if (kind == 5) {
    // Melancia: listras irregulares na casca; no pronoto, a polpa com sementes e a borda clara.
    if (part < 0.5) {
      float warp = clayNoise3(p * 7.0) * 1.6;
      float stripe = sin(skinAround(p) * 13.0 + warp);
      return mix(base, uSkinA, smoothstep(0.1, 0.45, stripe) * 0.85);
    }
    if (part < 1.5) {
      vec3 id;
      vec2 d = skinCells(vec3(p.x * 1.0, p.y * 0.6, p.z * 1.5) * 13.0, id);
      float h = clayHash13(id);
      float seed = (1.0 - smoothstep(0.14, 0.2, d.x)) * step(0.5, h);
      vec3 c = mix(base, uSkinB, seed);
      // Faixa branca-esverdeada onde o pronoto encosta nos élitros (a casca da fatia).
      float rind = 1.0 - smoothstep(0.1, 0.15, p.z);
      return mix(c, uSkinC, rind);
    }
    return base;
  }

  if (kind == 6) {
    // Camuflado: manchas de ruído em camadas.
    vec3 c = base;
    c = mix(c, uSkinA, smoothstep(0.5, 0.53, skinFbm(p * 5.0)));
    c = mix(c, uSkinB, smoothstep(0.55, 0.58, skinFbm(p * 5.0 + 13.0)));
    c = mix(c, uSkinC, smoothstep(0.6, 0.63, skinFbm(p * 7.0 + 31.0)));
    return c;
  }

  if (kind == 7) {
    // Cristal: facetas de tons diferentes, arestas claras, uma faceta ou outra
    // acendendo, e a borda (fresnel) abrindo em arco-íris.
    vec3 id;
    vec2 d = skinCells(p * 11.0, id);
    float h = clayHash13(id);
    // Cada faceta num tom (umas quase brancas, outras no azul mais fundo).
    vec3 c = mix(uSkinB, base, 0.35 + 0.65 * h) * (0.8 + 0.35 * h);
    float edge = 1.0 - smoothstep(0.0, 0.06, d.y - d.x);
    c = mix(c, uSkinA, edge * 0.8);
    float flash = pow(max(0.0, sin(uSkinTime * (0.9 + h * 1.4) + h * 40.0)), 14.0);
    glow += uSkinA * flash * 2.4 * (1.0 - smoothstep(0.0, 0.55, d.x)) * uSkinGlow;
    glow += uSkinA * edge * 0.18 * uSkinGlow;
    vec3 prism = skinHue(fresnel * 0.9 + h * 0.25 + uSkinTime * 0.04);
    c += prism * pow(fresnel, 1.5) * 0.55;
    glow += prism * pow(fresnel, 2.5) * 0.35 * uSkinGlow;
    return c;
  }

  if (kind == 8) {
    // Via Láctea: nebulosa correndo devagar, a faixa da galáxia na diagonal e estrelas piscando.
    vec3 q = p * 3.2 + vec3(0.0, 0.0, uSkinTime * 0.035);
    float n = skinFbm(q + skinFbm(q * 1.7 + 3.0) * 0.9);
    vec3 nebula = mix(uSkinA, uSkinB, smoothstep(0.35, 0.7, skinFbm(q * 1.3 + 5.0)));
    float band = exp(-pow((p.x * 0.75 + p.z * 0.65 + 0.04) / 0.15, 2.0));
    float cloud = smoothstep(0.38, 0.75, n) * (0.5 + band * 1.1);
    vec3 c = base + nebula * cloud * 0.9;
    glow += nebula * cloud * 0.55 * uSkinGlow;
    // A faixa da galáxia: uma poeira clara e fina seguindo a diagonal.
    float dust = band * smoothstep(0.45, 0.8, skinFbm(p * 9.0 + uSkinTime * 0.02));
    c += uSkinC * dust * 0.35;
    glow += uSkinC * dust * 0.4 * uSkinGlow;
    float stars = skinStars(p, 0.16 + band * 0.25, 38.0) + skinStars(p + 9.0, 0.1, 70.0) * 0.8;
    c += uSkinC * stars * 0.9;
    glow += uSkinC * stars * 3.2 * uSkinGlow;
    return c;
  }

  if (kind == 9) {
    // Magma: crosta em placas, rachaduras em brasa com um pulso que corre de ponta a ponta.
    vec3 id;
    vec2 d = skinCells(p * 8.5, id);
    float h = clayHash13(id);
    float crack = 1.0 - smoothstep(0.015, 0.1, d.y - d.x);
    float flow = 0.5 + 0.5 * sin(uSkinTime * 1.8 + h * 6.28 - p.z * 10.0);
    vec3 hot = mix(uSkinA, uSkinB, crack * flow);
    vec3 c = mix(base * (0.75 + 0.5 * h), hot, crack);
    glow += hot * crack * (0.6 + flow * 2.2) * uSkinGlow;
    float warm = (1.0 - smoothstep(0.0, 0.3, d.x)) * (0.5 + 0.5 * sin(uSkinTime * 0.8 + h * 9.0));
    glow += uSkinA * warm * 0.1 * uSkinGlow;
    return c;
  }

  if (kind == 10) {
    // Aurora: cortinas de luz ondulando pelo casco.
    float a = skinAround(p);
    float w = clayNoise3(vec3(a * 2.0, p.z * 3.0, uSkinTime * 0.25));
    float curtain = sin(a * 5.0 + p.z * 4.0 + w * 3.2 + uSkinTime * 0.7);
    // Os "raios" finos da cortina: listras quase verticais que tremulam.
    float rays = 0.45 + 0.55 * smoothstep(0.3, 0.8, clayNoise3(vec3(a * 26.0 + w * 4.0, p.y * 2.0, uSkinTime * 0.8)));
    float band = smoothstep(0.1, 0.95, curtain) * rays;
    vec3 col = mix(uSkinA, uSkinB, smoothstep(-0.3, 0.4, sin(p.z * 5.0 + uSkinTime * 0.4)));
    col = mix(col, uSkinC, smoothstep(0.6, 1.0, w) * 0.6);
    // Estrelinhas atrás da aurora.
    float stars = skinStars(p, 0.08, 60.0) * (1.0 - band);
    glow += col * band * 1.4 * uSkinGlow + vec3(0.9, 0.95, 1.0) * stars * 1.6 * uSkinGlow;
    return base + col * band * 0.7 + stars * 0.4;
  }

  if (kind == 11) {
    // Holográfico: o arco-íris muda com o ângulo, a posição e o tempo.
    float hue = fract(fresnel * 1.3 + (p.x + p.y * 0.5 + p.z) * 1.2 + uSkinTime * 0.1);
    vec3 rainbow = skinHue(hue);
    vec3 c = mix(base, rainbow * 0.85 + 0.2, 0.45 + fresnel * 0.4);
    glow += rainbow * pow(fresnel, 2.0) * 0.6 * uSkinGlow;
    return c;
  }

  if (kind == 12) {
    // Abissal: fileiras de pontinhos que acendem numa onda da cabeça pra trás.
    vec2 g = vec2(skinAround(p) * 2.3, p.z) * 8.0;
    vec2 gi = floor(g);
    vec2 gf = fract(g) - 0.5;
    float h = clayHash12(gi + part * 31.0);
    float size = 0.16 + 0.1 * h;
    float dotMask = (1.0 - smoothstep(size, size + 0.1, length(gf))) * step(0.25, h);
    float wave = pow(0.5 + 0.5 * sin(p.z * 8.0 + uSkinTime * 2.2 + h * 1.5), 3.0);
    vec3 light = mix(uSkinA, uSkinB, step(0.8, h));
    // Veios finos que acendem junto (a "renda" dos bichos do fundo).
    float vein = (1.0 - smoothstep(0.0, 0.035, abs(sin(skinAround(p) * 9.0 + clayNoise3(p * 6.0) * 1.5)))) * 0.5;
    glow += light * dotMask * (0.35 + wave * 3.2) * uSkinGlow + uSkinA * vein * wave * 0.5 * uSkinGlow;
    return base + light * dotMask * (0.4 + wave * 0.35) + uSkinA * vein * 0.15;
  }

  if (kind == 13) {
    // Amanhecer: noite embaixo virando dia em cima, com a linha do horizonte
    // subindo e descendo devagar e as últimas estrelas sumindo na luz.
    // Como o céu do menu: noite no alto (com as últimas estrelas), lilás, pêssego e o
    // dourado do sol nascendo embaixo. O horizonte sobe e desce devagar.
    float h = clamp((p.y - 0.18) / 0.46, 0.0, 1.0);
    float rise = 0.14 * sin(uSkinTime * 0.3);
    float k = 1.0 - h + rise - (part > 1.5 ? 0.15 : 0.0);
    vec3 c = mix(uSkinA, uSkinB, smoothstep(0.12, 0.42, k));
    c = mix(c, uSkinC, smoothstep(0.4, 0.62, k));
    c = mix(c, base, smoothstep(0.6, 0.82, k));
    float night = 1.0 - smoothstep(0.15, 0.4, k);
    float stars = skinStars(p, 0.14, 55.0) * night;
    c += vec3(1.0, 0.95, 0.85) * stars * 0.7;
    glow += vec3(1.0, 0.95, 0.85) * stars * 2.4 * uSkinGlow;
    glow += base * smoothstep(0.62, 0.95, k) * 0.55 * uSkinGlow;
    // Linha do horizonte acesa.
    glow += uSkinC * exp(-pow((k - 0.52) / 0.05, 2.0)) * 0.35 * uSkinGlow;
    return c;
  }

  if (kind == 14) {
    // Ouro do Khepri: uma faixa de brilho que atravessa o casco de tempos em tempos e pontinhos que cintilam.
    float sweep = fract(uSkinTime * 0.16);
    float s = p.x * 0.55 + p.z - p.y * 0.3;
    float band = exp(-pow((s - mix(-0.9, 1.0, sweep)) / 0.08, 2.0));
    vec3 c = base * (1.0 + band * 0.5);
    glow += uSkinA * band * 1.2 * uSkinGlow;
    float glint = skinStars(p, 0.06, 70.0);
    glow += uSkinA * glint * 1.6 * uSkinGlow;
    return c;
  }

  return base;
}
`;

/**
 * Liga o desenho do casco num material de massinha (depois do shader da
 * própria massinha: encadeia o `onBeforeCompile` que já existe). Os uniforms
 * são o objeto `uniforms` (compartilhado pelas peças do mesmo besouro).
 */
export function installSkinShader(material: THREE.MeshPhysicalMaterial, uniforms: SkinUniforms): void {
  const clayCompile = material.onBeforeCompile;
  const clayKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    clayCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uSkinTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${skinVertexPars}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkinPos = skinPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${skinFragmentPars}\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 skinGlow;
          diffuseColor.rgb *= skinColor(vSkinPos.xyz, vSkinPos.w, skinGlow);
          // O brilho próprio acompanha a sombra assada (a borda de baixo acende menos).
          #ifdef USE_COLOR
            skinGlow *= 0.35 + 0.65 * vColor.r;
          #endif
          totalEmissiveRadiance += skinGlow;
        }`,
      );
  };
  material.customProgramCacheKey = () => `${clayKey}|skin`;
}
