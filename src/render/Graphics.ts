import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { quality } from '../core/device';

/** Paleta do "clima" da cena. Centralizada para ajustar o tom do jogo num lugar só. */
export const Palette = {
  skyTop: new THREE.Color('#8fc4f0'),
  skyHorizon: new THREE.Color('#fbe3c4'),
  fog: new THREE.Color('#f3dcc0'),
  sun: new THREE.Color('#fff1dc'),
  hemiSky: new THREE.Color('#d6ecff'),
  hemiGround: new THREE.Color('#b99a6c'),
} as const;

/** Direção de onde vem o sol (normalizada). Usada pela luz e pelo céu. */
export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.78, 0.3).normalize();

const SHADOW_EXTENT = 26;

/** Vinheta + grão bem leve: dá o acabamento "fotografado" sem chamar atenção. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 c = vUv - 0.5;
      float vignette = smoothstep(0.85, 0.25, length(c * vec2(1.1, 1.0)));
      color.rgb *= mix(0.78, 1.0, vignette);
      color.rgb += (hash(vUv * 731.0) - 0.5) * 0.018;
      gl_FragColor = color;
    }
  `,
};

export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private readonly composer: EffectComposer;
  private readonly aoPass: GTAOPass;
  private readonly finishPass: ShaderPass;
  private pixelRatio: number;

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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    this.scene.fog = new THREE.Fog(Palette.fog, 45, 150);
    this.scene.background = this.createSkyTexture();

    // Reflexo ambiente suave: é o que dá vida ao sheen e ao furta-cor do casco.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(Palette.hemiSky, Palette.hemiGround, 1.35);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(Palette.sun, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: quality.msaaSamples, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.aoPass = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2, scale: 1.1, samples: 16 });
    this.aoPass.updatePdMaterial({ radius: 6, samples: 12 });
    this.aoPass.blendIntensity = 0.9;
    this.aoPass.enabled = quality.ambientOcclusion;
    this.composer.addPass(this.aoPass);

    this.composer.addPass(new OutputPass());
    this.finishPass = new ShaderPass(FinishShader);
    this.composer.addPass(this.finishPass);

    window.addEventListener('resize', this.onResize);
  }

  /** Luz do sol segue o jogador para o mapa de sombra cobrir sempre a área visível. */
  followFocus(focus: THREE.Vector3): void {
    // Encaixa no texel do shadow map: evita sombras "tremendo" com o movimento.
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIRECTION, 60);
  }

  /** Reduz custo quando o aparelho não aguenta: sem AO e com menos pixels. */
  setLowQuality(low: boolean): void {
    this.aoPass.enabled = quality.ambientOcclusion && !low;
    this.pixelRatio = low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, quality.maxPixelRatio);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.shadow.radius = low ? 1 : 4;
    this.onResize();
  }

  render(time: number): void {
    this.finishPass.uniforms.uTime.value = time % 100;
    this.composer.render();
  }

  /**
   * Céu como textura equiretangular pintada em canvas: gradiente pastel + brilho do sol.
   * Como background (e não uma esfera na cena) ele fica fora do AO e da sombra de graça.
   */
  private createSkyTexture(): THREE.Texture {
    const width = 1024;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `#${Palette.skyTop.getHexString()}`);
    gradient.addColorStop(0.42, `#${Palette.skyTop.clone().lerp(Palette.skyHorizon, 0.6).getHexString()}`);
    gradient.addColorStop(0.5, `#${Palette.skyHorizon.getHexString()}`);
    gradient.addColorStop(1, `#${Palette.fog.getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Posição do sol no mapa equiretangular (mesma convenção do three).
    const azimuth = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z);
    const elevation = Math.asin(SUN_DIRECTION.y);
    const sx = (0.5 + azimuth / (Math.PI * 2)) * width;
    const sy = (0.5 - elevation / Math.PI) * height;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 220);
    glow.addColorStop(0, 'rgba(255, 250, 235, 0.95)');
    glow.addColorStop(0.08, 'rgba(255, 238, 205, 0.6)');
    glow.addColorStop(1, 'rgba(255, 225, 190, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
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
  };
}
