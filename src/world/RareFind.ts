import * as THREE from 'three';
import type { AccessoryId } from '../progression/accessories';
import { buildAccessory } from '../entities/outfit/registry';
import type { AccessoryModel, OutfitPose } from '../entities/outfit/types';
import { terrainHeight } from './Terrain';

/**
 * O achado raro no jardim: o acessório em tamanho grande, girando e flutuando
 * em cima de um anel no chão, dentro de um facho de luz dourado que se vê de
 * longe (por cima da grama). O besouro ou a bola passando por cima pegam.
 *
 * O facho e o anel são aditivos e não escrevem profundidade: sem contorno, sem
 * oclusão e sem sombra (é luz, não objeto).
 */

/** Quanto o acessório cresce no chão (no besouro ele tem o tamanho da cabeça). */
const DISPLAY_SIZE = 1.05;
/** Altura em que ele flutua (acima do capim). */
const HOVER = 1.05;
/** Pega quem chegar a essa distância (besouro) ou encostar a bola nele. */
const PICK_RADIUS = 1.1;

const GOLD = new THREE.Color('#ffc94a');

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: GOLD.clone().multiplyScalar(2.2) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        // Some pra cima, mais forte no meio do facho (visto de frente) que na borda.
        float up = pow(1.0 - vUv.y, 1.3);
        float core = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.2);
        float flicker = 0.85 + 0.15 * sin(uTime * 3.0 + vUv.y * 9.0);
        float stripes = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 4.0);
        // Mais fraco embaixo, onde o item flutua (a luz não "lava" o acessório); a coluna sobe a partir dele.
        float clear = 0.3 + 0.7 * smoothstep(0.12, 0.3, vUv.y);
        float a = up * core * clear * flicker * stripes * 0.75;
        // Aditivo: a cor entra multiplicada pelo alfa uma vez só (o blend já faz isso).
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function ringMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: GOLD.clone().multiplyScalar(1.8) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // Anel que pulsa pra fora, e um brilho mole no meio.
        float wave = fract(r - uTime * 0.6);
        float ring = smoothstep(0.0, 0.08, wave) * (1.0 - smoothstep(0.08, 0.3, wave));
        float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.35;
        float a = (ring * 0.8 + glow) * (1.0 - smoothstep(0.85, 1.0, r));
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface Placed {
  id: AccessoryId;
  model: AccessoryModel;
  /** Gira e flutua (o modelo fica centrado dentro dele). */
  spinner: THREE.Group;
  position: THREE.Vector3;
}

export class RareFind {
  readonly group = new THREE.Group();
  /** Compila os shaders antes de aparecer (o jogo liga no renderizador). */
  compile: ((object: THREE.Object3D) => Promise<void>) | null = null;

  private placed: Placed | null = null;
  private readonly beam: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly beamMat = beamMaterial();
  private readonly ringMat = ringMaterial();
  private readonly pose: OutfitPose = { time: 0, dt: 0, speed: 0, pushBlend: 0, airborne: 0, verticalSpeed: 0 };
  private time = 0;
  /** Contador pro jogo soltar um brilho de tempos em tempos. */
  private glint = 0;

  constructor() {
    this.group.name = 'rare-find';
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 9, 28, 1, true).translate(0, 4.5, 0), this.beamMat);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2), this.ringMat);
    for (const light of [this.beam, this.ring]) {
      light.renderOrder = 11;
      light.frustumCulled = false;
      light.userData.skipAO = true;
    }
    this.group.visible = false;
  }

  /** Tem achado no jardim agora? */
  get active(): boolean {
    return this.placed !== null;
  }

  get id(): AccessoryId | null {
    return this.placed?.id ?? null;
  }

  /** Onde ele está (pra brilhos e som), ou null. */
  get position(): THREE.Vector3 | null {
    return this.placed?.position ?? null;
  }

  /** Põe o acessório `id` em (x, z). Troca o que houver. */
  place(id: AccessoryId, x: number, z: number): void {
    this.clear();
    const model = buildAccessory(id);
    const holder = model.object;
    // Centraliza pelo tamanho real da peça (cada uma foi desenhada em volta do encaixe dela).
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = DISPLAY_SIZE / Math.max(size.x, size.y, size.z, 0.05);
    const center = box.getCenter(new THREE.Vector3());
    const spinner = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    inner.position.copy(center).multiplyScalar(-scale);
    inner.add(holder);
    spinner.add(inner);
    const y = terrainHeight(x, z);
    const position = new THREE.Vector3(x, y + HOVER, z);
    spinner.position.copy(position);
    this.beam.position.set(x, y, z);
    this.ring.position.set(x, y + 0.03, z);
    const placed: Placed = { id, model, spinner, position };
    this.placed = placed;
    const show = () => {
      if (this.placed !== placed) return;
      this.group.add(spinner, this.beam, this.ring);
      this.group.visible = true;
    };
    if (this.compile) this.compile(spinner).catch(() => undefined).then(show);
    else show();
  }

  /** Tira o achado (pego, ou o jardim trocou). */
  clear(): void {
    const placed = this.placed;
    if (!placed) return;
    this.placed = null;
    this.group.remove(placed.spinner, this.beam, this.ring);
    this.group.visible = false;
    placed.spinner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  /** Anima (gira, flutua, facho pulsando). Devolve true quando é hora de um brilho. */
  update(dt: number): boolean {
    const placed = this.placed;
    if (!placed) return false;
    this.time += dt;
    const s = placed.spinner;
    s.rotation.y += dt * 1.1;
    s.position.y = placed.position.y + Math.sin(this.time * 2) * 0.08;
    const pose = this.pose;
    pose.time = this.time;
    pose.dt = dt;
    placed.model.update?.(pose);
    this.beamMat.uniforms.uTime.value = this.time;
    this.ringMat.uniforms.uTime.value = this.time;
    this.glint -= dt;
    if (this.glint <= 0) {
      this.glint = 0.9;
      return true;
    }
    return false;
  }

  /** O besouro (pés) ou a bola passaram por cima? Devolve o acessório pego (e tira do chão). */
  collect(beetle: THREE.Vector3, ball: THREE.Vector3, ballRadius: number): AccessoryId | null {
    const placed = this.placed;
    if (!placed || !this.group.visible) return null;
    const p = placed.position;
    const nearBeetle = Math.hypot(beetle.x - p.x, beetle.z - p.z) < PICK_RADIUS && Math.abs(beetle.y - p.y) < 2;
    const nearBall = Math.hypot(ball.x - p.x, ball.z - p.z) < ballRadius + 0.5 && ball.y - ballRadius < p.y + 0.6;
    if (!nearBeetle && !nearBall) return null;
    const id = placed.id;
    this.clear();
    return id;
  }
}
