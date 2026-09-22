import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { quality } from '../core/device';
import { createRng } from '../utils/math';

/** Paleta do "clima" da cena. Centralizada para ajustar o tom do jogo num lugar só. */
export const Palette = {
  skyZenith: new THREE.Color('#78b2ea'),
  skyTop: new THREE.Color('#9ccbf2'),
  skyHorizon: new THREE.Color('#fde5c6'),
  fog: new THREE.Color('#f2dcc2'),
  sun: new THREE.Color('#fff0d6'),
  hemiSky: new THREE.Color('#d6ecff'),
  hemiGround: new THREE.Color('#b99a6c'),
  groundBounce: new THREE.Color('#8fae62'),
} as const;

/** O mesmo jardim num dia de chuva: céu chumbo, neblina fria, luz sem direção. */
export const StormPalette = {
  skyZenith: new THREE.Color('#6d7788'),
  skyTop: new THREE.Color('#87919f'),
  skyHorizon: new THREE.Color('#c3c3bd'),
  fog: new THREE.Color('#b3b7b8'),
  sun: new THREE.Color('#dde4ea'),
  hemiSky: new THREE.Color('#c6ced8'),
  hemiGround: new THREE.Color('#8c8672'),
} as const;

interface SkyColors {
  skyZenith: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fog: THREE.Color;
}

/** Direção de onde vem o sol (normalizada). Usada pela luz, pelo céu e pela grama. */
export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.78, 0.3).normalize();

const SHADOW_EXTENT = 26;
const tmpSize = new THREE.Vector2();

/**
 * Esconde, só durante o passe de AO, o que o AO não consegue ver direito:
 * vegetação com vertex shader animado (o override de material do GTAO desenharia
 * a versão parada) e coisas transparentes.
 */
class AOVisibilityPass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly hide: boolean,
    private readonly hidden: THREE.Object3D[],
  ) {
    super();
    this.needsSwap = false;
  }

  render(): void {
    if (this.hide) {
      this.scene.traverseVisible((object) => {
        if (object.userData.skipAO) this.hidden.push(object);
      });
      for (const object of this.hidden) object.visible = false;
    } else {
      for (const object of this.hidden) object.visible = true;
      this.hidden.length = 0;
    }
  }
}

/**
 * GTAO em meia resolução: a oclusão da massinha é macia de qualquer jeito, e
 * isso corta ~70% do custo do passe mais caro do jogo (o composer continua
 * chamando setSize com o tamanho cheio; aqui ele vira metade).
 */
class HalfResGTAOPass extends GTAOPass {
  static readonly SCALE = 0.5;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super(scene, camera, Math.max(1, Math.round(width * HalfResGTAOPass.SCALE)), Math.max(1, Math.round(height * HalfResGTAOPass.SCALE)));
  }

  setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * HalfResGTAOPass.SCALE)), Math.max(1, Math.round(height * HalfResGTAOPass.SCALE)));
  }
}

/**
 * Profundidade de campo "de maquete": o que está na distância do besouro fica nítido,
 * o fundo desfoca progressivamente (e o que cola na lente, um pouco). É o truque de
 * fotografia macro que faz o jardim parecer um diorama de massinha.
 * Usa a profundidade que o GTAO já renderizou (sem custo de um passe extra).
 */
const DepthOfFieldShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 400 },
    uFocus: { value: 6 },
    uMaxBlur: { value: 8 },
    uResolution: { value: new THREE.Vector2(1, 1) },
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
    uniform float uFocus;
    uniform float uMaxBlur;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float circleOfConfusion(vec2 uv) {
      // textureLod: sem derivadas dentro do laço (o early-return deixa o laço "variável").
      float depth = textureLod(tDepth, uv, 0.0).x;
      float dist = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
      float far = smoothstep(uFocus * 1.6, uFocus * 6.0, dist);
      float near = 1.0 - smoothstep(uFocus * 0.22, uFocus * 0.5, dist);
      return max(far, near * 0.7);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float coc = circleOfConfusion(vUv);
      if (coc < 0.02) { gl_FragColor = base; return; }
      vec3 sum = base.rgb;
      float weight = 1.0;
      float radius = coc * uMaxBlur;
      for (int i = 0; i < 20; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / 20.0);
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * radius / uResolution;
        // Amostra em foco não vaza para o desfoque (sem halo em volta do besouro).
        float w = clamp(circleOfConfusion(uv) * 1.6 / coc, 0.0, 1.0);
        sum += textureLod(tDiffuse, uv, 0.0).rgb * w;
        weight += w;
      }
      gl_FragColor = vec4(sum / weight, base.a);
    }
  `,
};

/**
 * Acabamento final (já em sRGB): sombras levemente erguidas para um lilás quente
 * (massinha nunca tem preto puro), um pouco mais de saturação, vinheta e grão.
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uOvercast: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uOvercast;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 c = color.rgb;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c += vec3(0.04, 0.018, 0.055) * pow(1.0 - luma, 2.0);
      // Dia de chuva: um pouco menos de cor e um tom mais frio (sem virar cinza morto).
      c = mix(vec3(luma), c, 1.08 - uOvercast * 0.2);
      c *= mix(vec3(1.015, 1.0, 0.975), vec3(0.975, 0.995, 1.025), uOvercast);
      vec2 d = vUv - 0.5;
      float vignette = smoothstep(0.9, 0.28, length(d * vec2(1.1, 1.0)));
      c *= mix(0.8, 1.0, vignette);
      c += (hash(vUv * 731.0) - 0.5) * 0.016;
      gl_FragColor = vec4(c, color.a);
    }
  `,
};

/**
 * Cúpula do céu: mistura o céu de sol com o de chuva pelo `uOvercast` e acende
 * no relâmpago. Fica colada na câmera e é desenhada no plano do fundo (z = w),
 * então nunca tampa nada — faz o papel do `scene.background`, mas com clima.
 */
function createSkyDome(sunny: THREE.Texture, storm: THREE.Texture): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tSunny: { value: sunny },
      tStorm: { value: storm },
      uOvercast: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Colado no plano do fundo (um fio antes dele: z == w exato é recortado em algumas GPUs).
        gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform sampler2D tSunny;
      uniform sampler2D tStorm;
      uniform float uOvercast;
      uniform float uFlash;
      varying vec3 vDirection;
      void main() {
        vec2 uv = equirectUv(normalize(vDirection));
        vec3 color = mix(texture2D(tSunny, uv).rgb, texture2D(tStorm, uv).rgb, uOvercast);
        color += vec3(0.75, 0.8, 0.95) * uFlash * (0.4 + 0.6 * smoothstep(-0.1, 0.6, normalize(vDirection).y));
        gl_FragColor = vec4(color, 1.0);
      }`,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.skipAO = true;
  mesh.name = 'sky-dome';
  return mesh;
}

export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private readonly hemi: THREE.HemisphereLight;
  private readonly skyDome: THREE.Mesh;
  private readonly fog: THREE.Fog;
  private readonly composer: EffectComposer;
  private readonly aoPass: GTAOPass;
  private readonly aoHide: AOVisibilityPass;
  private readonly aoRestore: AOVisibilityPass;
  private readonly dofPass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly finishPass: ShaderPass;
  private pixelRatio: number;
  private lowQuality = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // o MSAA fica no render target do composer
      powerPreference: 'high-performance',
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral preserva as cores pastel da massinha (ACES satura e escurece demais).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    this.fog = new THREE.Fog(Palette.fog, 42, 175);
    this.scene.fog = this.fog;
    this.skyDome = createSkyDome(this.createSkyTexture(2048, 1024, true, Palette), this.createSkyTexture(1024, 512, true, StormPalette));
    this.scene.add(this.skyDome);

    // Reflexo ambiente do próprio céu (azul em cima, grama embaixo): dá vida ao
    // furta-cor do casco, ao verniz das frutinhas e ao brilho úmido da bosta.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envSource = this.createSkyTexture(512, 256, false, Palette);
    this.scene.environment = pmrem.fromEquirectangular(envSource).texture;
    this.scene.environmentIntensity = 0.5;
    envSource.dispose();
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(Palette.hemiSky, Palette.hemiGround, 1.3);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(Palette.sun, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: quality.msaaSamples, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const hidden: THREE.Object3D[] = [];
    this.aoHide = new AOVisibilityPass(this.scene, true, hidden);
    this.aoRestore = new AOVisibilityPass(this.scene, false, hidden);
    this.aoPass = new HalfResGTAOPass(this.scene, this.camera, size.x, size.y);
    this.aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2, scale: 1.15, samples: 12 });
    this.aoPass.updatePdMaterial({ radius: 4, samples: 8 });
    this.aoPass.blendIntensity = 0.92;
    this.composer.addPass(this.aoHide);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(this.aoRestore);

    this.dofPass = new ShaderPass(DepthOfFieldShader);
    this.dofPass.uniforms.tDepth.value = this.aoPass.depthTexture;
    this.composer.addPass(this.dofPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 1.45);
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());
    this.finishPass = new ShaderPass(FinishShader);
    this.composer.addPass(this.finishPass);

    this.applyQuality();
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  /** Luz do sol segue o jogador para o mapa de sombra cobrir sempre a área visível. */
  followFocus(focus: THREE.Vector3): void {
    // Encaixa no texel do shadow map: evita sombras "tremendo" com o movimento.
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIRECTION, 70);
  }

  /** Converte tamanho de mundo em pixels para partículas: altura do buffer / (2·tan(fov/2)). */
  get pixelScale(): number {
    const height = this.renderer.getDrawingBufferSize(tmpSize).y;
    return height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /** Distância (da câmera) que fica em foco no desfoque de maquete. */
  setFocusDistance(distance: number): void {
    this.dofPass.uniforms.uFocus.value = Math.max(distance, 1);
  }

  /** Reduz custo quando o aparelho não aguenta: sem AO/DOF/bloom e com menos pixels. */
  setLowQuality(low: boolean): void {
    this.lowQuality = low;
    this.pixelRatio = low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, quality.maxPixelRatio);
    this.sun.shadow.radius = low ? 1 : 4;
    this.applyQuality();
    this.onResize();
  }

  /** Segundo degrau (aparelho bem fraco): sombra menor e resolução abaixo de 1:1. */
  setMinimumQuality(): void {
    this.setLowQuality(true);
    const size = Math.min(this.sun.shadow.mapSize.x, 1024);
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.pixelRatio = Math.min(window.devicePixelRatio, 0.8);
    this.onResize();
  }

  /**
   * Clima na luz: céu, sol (e a sombra dele), luz ambiente, neblina, reflexo e
   * acabamento acompanham `overcast`; `flash` é o relâmpago (0..1).
   */
  setWeather(overcast: number, flash: number): void {
    const k = THREE.MathUtils.clamp(overcast, 0, 1);
    const sky = this.skyDome.material as THREE.ShaderMaterial;
    sky.uniforms.uOvercast.value = k;
    sky.uniforms.uFlash.value = flash;
    this.sun.intensity = THREE.MathUtils.lerp(2.5, 0.6, k);
    this.sun.color.copy(Palette.sun).lerp(StormPalette.sun, k);
    // Céu fechado = luz difusa: a sombra do sol quase some.
    this.sun.shadow.intensity = 1 - k * 0.75;
    this.hemi.intensity = THREE.MathUtils.lerp(1.3, 1.15, k) + flash * 1.6;
    this.hemi.color.copy(Palette.hemiSky).lerp(StormPalette.hemiSky, k);
    this.hemi.groundColor.copy(Palette.hemiGround).lerp(StormPalette.hemiGround, k);
    this.fog.color.copy(Palette.fog).lerp(StormPalette.fog, k);
    this.fog.near = THREE.MathUtils.lerp(42, 26, k);
    this.fog.far = THREE.MathUtils.lerp(175, 118, k);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.5, 0.36, k);
    this.renderer.toneMappingExposure = 1.02 - k * 0.05 + flash * 0.35;
    this.finishPass.uniforms.uOvercast.value = k;
  }

  render(time: number): void {
    this.finishPass.uniforms.uTime.value = time % 100;
    this.skyDome.position.copy(this.camera.position);
    const u = this.dofPass.uniforms;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    this.composer.render();
  }

  private applyQuality(): void {
    const ao = quality.ambientOcclusion && !this.lowQuality;
    this.aoPass.enabled = ao;
    this.aoHide.enabled = ao;
    this.aoRestore.enabled = ao;
    // O DOF lê a profundidade do GTAO: sem AO, sem DOF.
    this.dofPass.enabled = ao && quality.depthOfField;
    this.bloomPass.enabled = quality.bloom && !this.lowQuality;
  }

  /**
   * Céu como textura equiretangular pintada em canvas: gradiente pastel, brilho do sol
   * e faixas de nuvem bem suaves perto do horizonte. Como background (e não uma esfera
   * na cena) ele fica fora do AO e da sombra de graça.
   * Com `forBackground = false`, a metade de baixo vira "chão" (verde) para o reflexo
   * ambiente: o que está embaixo dos objetos reflete grama, não céu.
   */
  private createSkyTexture(width: number, height: number, forBackground: boolean, colors: SkyColors): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const hex = (c: THREE.Color) => `#${c.getHexString()}`;
    const stormy = colors !== Palette;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, hex(colors.skyZenith));
    gradient.addColorStop(0.28, hex(colors.skyTop));
    gradient.addColorStop(0.44, hex(colors.skyTop.clone().lerp(colors.skyHorizon, 0.6)));
    gradient.addColorStop(0.5, hex(colors.skyHorizon));
    if (forBackground) {
      gradient.addColorStop(1, hex(colors.fog));
    } else {
      gradient.addColorStop(0.53, hex(Palette.groundBounce.clone().lerp(colors.skyHorizon, 0.4)));
      gradient.addColorStop(1, hex(Palette.groundBounce.clone().multiplyScalar(0.7)));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Posição do sol na convenção do `equirectUv` do three (a mesma que a cúpula usa).
    const u = Math.atan2(SUN_DIRECTION.z, SUN_DIRECTION.x) / (Math.PI * 2) + 0.5;
    const v = Math.asin(SUN_DIRECTION.y) / Math.PI + 0.5;
    const sx = u * width;
    const sy = (1 - v) * height;

    if (forBackground) this.paintCloudBands(ctx, width, height, stormy);

    // Com chuva o sol não aparece: só uma claridade difusa onde ele estaria.
    const glowRadius = width * (stormy ? 0.18 : 0.11);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
    if (stormy) {
      glow.addColorStop(0, 'rgba(235, 238, 240, 0.35)');
      glow.addColorStop(1, 'rgba(235, 238, 240, 0)');
    } else {
      glow.addColorStop(0, 'rgba(255, 252, 240, 1)');
      glow.addColorStop(0.05, 'rgba(255, 245, 220, 0.85)');
      glow.addColorStop(0.2, 'rgba(255, 236, 200, 0.35)');
      glow.addColorStop(1, 'rgba(255, 225, 190, 0)');
    }
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (forBackground) {
      // A cúpula amostra por direção: sem mipmap, a costura do atan (u = 0/1) não vira uma linha.
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
    }
    return texture;
  }

  /**
   * Nuvens "de pincel" no céu de fundo: elipses macias empilhadas perto do horizonte.
   * No céu de chuva são muitas, mais altas e cinzentas (o céu inteiro fecha).
   */
  private paintCloudBands(ctx: CanvasRenderingContext2D, width: number, height: number, stormy: boolean): void {
    const rng = createRng(stormy ? 9191 : 4242);
    const horizon = height * 0.5;
    const blob = (x: number, y: number, rx: number, ry: number, alpha: number, shade: number) => {
      const c = Math.round(255 * shade);
      // Desenha também deslocado de uma volta inteira: a costura em u = 0/1 some.
      for (const offset of [-width, 0, width]) {
        ctx.save();
        ctx.translate(x + offset, y);
        ctx.scale(rx, ry);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(${c}, ${c}, ${Math.min(255, c + 4)}, ${alpha})`);
        g.addColorStop(0.55, `rgba(${c}, ${c}, ${Math.min(255, c + 6)}, ${alpha * 0.55})`);
        g.addColorStop(1, `rgba(${c}, ${c}, ${c}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    const count = stormy ? 70 : 26;
    for (let i = 0; i < count; i++) {
      const cx = rng.next() * width;
      const cy = horizon - height * (stormy ? rng.range(0.02, 0.42) : rng.range(0.03, 0.2));
      const span = width * rng.range(0.04, stormy ? 0.14 : 0.1);
      const puffs = 4 + Math.floor(rng.next() * 5);
      for (let j = 0; j < puffs; j++) {
        const shade = stormy ? rng.range(0.52, 0.72) : 1;
        blob(
          cx + rng.range(-1, 1) * span,
          cy + rng.range(-1, 0.4) * height * 0.015,
          span * rng.range(0.35, 0.7),
          height * rng.range(0.012, stormy ? 0.05 : 0.03),
          stormy ? rng.range(0.3, 0.6) : rng.range(0.25, 0.5),
          shade,
        );
      }
    }
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Em pé (retrato) a tela é estreita: abre o campo de visão pra caber besouro + bola.
    this.camera.fov = w / h < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.dofPass.uniforms.uResolution.value.copy(size);
    // Desfoque proporcional à altura da tela (mesma "lente" em qualquer resolução).
    this.dofPass.uniforms.uMaxBlur.value = size.y / 115;
  };
}
