import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Contorno de desenho animado em tela cheia, lido só da profundidade da cena
 * (a do próprio passe principal, que o composer já renderizou): nenhum draw call
 * a mais, funciona com instâncias, vento da grama e tudo que escreve profundidade.
 *
 * O truque é trabalhar em profundidade INVERSA (1/z): numa superfície plana ela
 * varia em linha reta pela tela, então o laplaciano dá zero no chão visto de
 * raspão e só acende onde a superfície "pula" pra trás, na silhueta. O sinal diz
 * de que lado o pixel está: a linha fica só do lado de dentro do objeto da frente,
 * com a espessura exata do deslocamento (sem engordar pro fundo).
 */
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 400 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uColor: { value: new THREE.Color('#120d12') },
    uFade: { value: new THREE.Vector2(24, 70) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec2 uTexel;
    uniform vec3 uColor;
    uniform vec2 uFade;
    varying vec2 vUv;

    float viewDistance(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float z = viewDistance(vUv);
      float inv = 1.0 / z;
      vec2 uvL = vUv - vec2(uTexel.x, 0.0);
      vec2 uvR = vUv + vec2(uTexel.x, 0.0);
      vec2 uvD = vUv - vec2(0.0, uTexel.y);
      vec2 uvU = vUv + vec2(0.0, uTexel.y);
      vec4 around = 1.0 / vec4(viewDistance(uvL), viewDistance(uvR), viewDistance(uvD), viewDistance(uvU));
      // Negativo = algum vizinho está bem mais longe que o plano previsto: somos a borda da frente.
      // Dividido por 1/z vira relativo (o mesmo degrau de 10% conta igual perto e longe).
      float jump = -(dot(around, vec4(1.0)) - 4.0 * inv) / inv;
      float edge = smoothstep(0.035, 0.12, jump);

      // O alfa da cena é o "alcance" do contorno de cada material (1 = normal; a grama
      // usa menos, senão vira pontilhado no meio do caminho). Na borda o MSAA mistura o
      // alfa do que está atrás, então vale o dos vizinhos na mesma superfície.
      vec4 alphas = vec4(texture2D(tDiffuse, uvL).a, texture2D(tDiffuse, uvR).a, texture2D(tDiffuse, uvD).a, texture2D(tDiffuse, uvU).a);
      vec4 sameSurface = step(abs(around - inv), vec4(inv * 0.04));
      float count = dot(sameSurface, vec4(1.0));
      float reach = max(count > 0.0 ? dot(sameSurface, alphas) / count : base.a, 0.05);
      // Some com a distância junto da neblina.
      edge *= 1.0 - smoothstep(uFade.x * reach, uFade.y * reach, z);
      gl_FragColor = vec4(mix(base.rgb, uColor, edge), 1.0);
    }
  `,
};

/**
 * Linha de GLSL para o fim do fragment de um material opaco: grava no alfa (que
 * nenhum passe usa antes do contorno) até que distância, em fração da normal,
 * ele ganha contorno. Materiais opacos saem com 1 e ficam com o alcance cheio.
 */
export function outlineReachGLSL(reach: number): string {
  return `gl_FragColor.a = ${THREE.MathUtils.clamp(reach, 0.05, 1).toFixed(3)};`;
}

/** Espessura da linha em pixels numa tela de 1080 de altura (escala com a resolução). */
const LINE_WIDTH_AT_1080P = 1.5;

/**
 * Passe do composer que aplica o contorno. Precisa vir logo depois do RenderPass:
 * lê a profundidade de `readBuffer.depthTexture`, que só existe no alvo onde a
 * cena acabou de ser desenhada. Não desligue com `enabled = false`: é ele que
 * devolve o alfa a 1 (sem isso a grama sai branca do resto do pós-processamento).
 * Para ver a cena sem contorno, `setFade(0, 0.001)`.
 */
export class OutlinePass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(OutlineShader.uniforms),
      vertexShader: OutlineShader.vertexShader,
      fragmentShader: OutlineShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Distâncias (da câmera) em que o contorno começa a sumir e some de vez. */
  setFade(start: number, end: number): void {
    this.material.uniforms.uFade.value.set(start, end);
  }

  setSize(width: number, height: number): void {
    // Deslocamento inteiro: a profundidade é lida sem filtro, meio texel não existe.
    const px = Math.max(1, Math.round((height / 1080) * LINE_WIDTH_AT_1080P));
    this.material.uniforms.uTexel.value.set(px / Math.max(1, width), px / Math.max(1, height));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
