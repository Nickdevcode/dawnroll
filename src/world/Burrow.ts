import * as THREE from 'three';
import { clay } from '../render/clayMaterial';
import { claySphere, paintVertices, taperedTube } from '../render/geometry';
import { createRng, clamp, lerp, smoothstep } from '../utils/math';
import { leafGeometry } from './scenery/shapes';
import { BURROW, terrainHeight } from './Terrain';
import type { DungBall } from '../entities/DungBall';

/**
 * A toca: o objetivo de cada rodada. O rola-bosta de verdade rola a bola até
 * um lugar de terra fofa e enterra ela (é a despensa/berçário dele). Aqui, empurrar
 * a bola para dentro da boca da toca dispara o enterro: a bola centraliza, afunda
 * girando, a terra espirra, e a rodada fecha com o placar.
 */

/** Menor bola que vale enterrar (raio): 3 cm de diâmetro. */
export const MIN_BURY_RADIUS = 0.75;

/** Quanto do raio da boca conta como "dentro da toca". */
const MOUTH_FRACTION = 0.58;
const CENTER_SECONDS = 0.5;
const SINK_SECONDS = 1.9;
const OUTRO_SECONDS = 1.3;
const DIG_INTERVAL = 0.09;

export interface BurialResult {
  diameterCm: number;
  dungCount: number;
  itemCount: number;
}

type Phase = 'idle' | 'centering' | 'sinking' | 'outro';

const SOIL_COLORS = ['#a8764c', '#8f623e', '#b98552', '#7a5234'];

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

export class Burrow {
  readonly group = new THREE.Group();
  /** Ponto acima da boca da toca (âncora do marcador do HUD). */
  readonly marker = new THREE.Vector3();

  onBurialStart: ((at: THREE.Vector3, radius: number) => void) | null = null;
  /** Terra espirrando enquanto a bola afunda (`strength` ~ tamanho da bola). */
  onDig: ((at: THREE.Vector3, strength: number) => void) | null = null;
  onBuried: ((result: BurialResult, at: THREE.Vector3) => void) | null = null;
  /** Fim da comemoração: hora de começar a rodada nova. */
  onFinished: (() => void) | null = null;

  /** A bola está na boca da toca, mas ainda é pequena demais para enterrar. */
  tooSmall = false;

  private phase: Phase = 'idle';
  private timer = 0;
  private digTimer = 0;
  private readonly startPos = new THREE.Vector3();
  private readonly startRot = new THREE.Quaternion();
  private readonly spinAxis = new THREE.Vector3(1, 0, 0);
  private radius = 1;
  private result: BurialResult = { diameterCm: 0, dungCount: 0, itemCount: 0 };
  private readonly rng = createRng(1717);

  // Visual
  private readonly flagPivot = new THREE.Group();
  private readonly flag: THREE.Object3D;
  private readonly ring: THREE.Mesh;
  private readonly ringUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ffb547') } };
  private ringVisibility = 0;

  constructor() {
    this.group.name = 'burrow';
    const ground = terrainHeight(BURROW.x, BURROW.z);
    this.marker.set(BURROW.x, BURROW.ground + 3.2, BURROW.z);

    this.group.add(this.buildThroat(ground));
    this.group.add(this.buildClods());
    this.flag = this.buildFlag();
    this.group.add(this.flagPivot);
    this.ring = this.buildRing();
    this.group.add(this.ring);
  }

  get isBusy(): boolean {
    return this.phase !== 'idle';
  }

  /** Passo fixo (ANTES do passo de física: durante o enterro a toca conduz a bola). */
  fixedUpdate(dt: number, ball: DungBall): void {
    if (this.phase === 'idle') {
      this.tooSmall = false;
      if (!ball.isSolid) return;
      const p = ball.position(tmpPos);
      const r = ball.radius;
      const horizontal = Math.hypot(p.x - BURROW.x, p.z - BURROW.z);
      // Dentro da boca e encostada no chão (não passando voando por cima).
      const inMouth = horizontal < BURROW.radius * MOUTH_FRACTION && p.y - r < BURROW.ground + 0.7;
      if (!inMouth) return;
      if (r < MIN_BURY_RADIUS) {
        this.tooSmall = true;
        return;
      }
      this.begin(ball);
      return;
    }

    this.timer += dt;
    const r = this.radius;
    if (this.phase === 'centering') {
      const t = smoothstep(0, 1, this.timer / CENTER_SECONDS);
      const restY = BURROW.ground + r - Math.min(r, BURROW.depth) * 0.55;
      tmpPos.set(lerp(this.startPos.x, BURROW.x, t), lerp(this.startPos.y, restY, t), lerp(this.startPos.z, BURROW.z, t));
      ball.setBurialPose(tmpPos, this.spun(this.timer * 0.8));
      if (this.timer >= CENTER_SECONDS) this.enter('sinking');
    } else if (this.phase === 'sinking') {
      const t = clamp(this.timer / SINK_SECONDS, 0, 1);
      const restY = BURROW.ground + r - Math.min(r, BURROW.depth) * 0.55;
      const bottom = BURROW.ground - BURROW.depth - r * 1.15 - 0.4;
      // Afunda devagar no começo (cavando) e some rápido no fim; balança de um lado para o outro.
      const e = t * t * (3 - 2 * t) * 0.35 + t * t * 0.65;
      const wobble = Math.sin(this.timer * 17) * 0.05 * r * (1 - t);
      tmpPos.set(BURROW.x + wobble, lerp(restY, bottom, e), BURROW.z - wobble * 0.6);
      ball.setBurialPose(tmpPos, this.spun(CENTER_SECONDS * 0.8 + this.timer * (1.4 + t * 2)));

      this.digTimer -= dt;
      while (this.digTimer <= 0 && t < 0.92) {
        this.digTimer += DIG_INTERVAL;
        const a = this.rng.next() * Math.PI * 2;
        const lip = Math.min(r, BURROW.radius) * this.rng.range(0.7, 1.05);
        const x = BURROW.x + Math.cos(a) * lip;
        const z = BURROW.z + Math.sin(a) * lip;
        this.onDig?.(tmpPos.set(x, terrainHeight(x, z) + 0.1, z), Math.min(1, 0.35 + r * 0.18));
      }
      if (this.timer >= SINK_SECONDS) {
        this.onBuried?.(this.result, tmpPos.set(BURROW.x, BURROW.ground + 0.3, BURROW.z));
        this.enter('outro');
      }
    } else if (this.timer >= OUTRO_SECONDS) {
      this.phase = 'idle';
      this.onFinished?.();
    }
  }

  /** Visual por frame: bandeira no vento e o anel "pode enterrar aqui". */
  update(dt: number, time: number, ballRadius: number): void {
    this.flagPivot.rotation.y = Math.sin(time * 0.9) * 0.45 + Math.sin(time * 2.3) * 0.12;
    this.flag.rotation.x = Math.sin(time * 3.4) * 0.22 + Math.sin(time * 5.1) * 0.08;

    const ready = this.phase === 'idle' && ballRadius >= MIN_BURY_RADIUS;
    this.ringVisibility = THREE.MathUtils.damp(this.ringVisibility, ready ? 1 : 0, 4, dt);
    this.ringUniforms.uTime.value = time;
    this.ringUniforms.uOpacity.value = this.ringVisibility * (0.55 + Math.sin(time * 3) * 0.2);
    this.ring.visible = this.ringVisibility > 0.01;
  }

  private begin(ball: DungBall): void {
    this.radius = ball.radius;
    this.result = { diameterCm: ball.diameterCm, dungCount: ball.dungCount, itemCount: ball.itemCount };
    ball.position(this.startPos);
    ball.rotation(this.startRot);
    // Continua girando "para dentro" da toca, na direção em que chegou.
    const toCenter = tmpPos.set(BURROW.x - this.startPos.x, 0, BURROW.z - this.startPos.z);
    if (toCenter.lengthSq() < 1e-4) toCenter.set(0, 0, 1);
    this.spinAxis.set(toCenter.z, 0, -toCenter.x).normalize();
    ball.beginBurial();
    this.digTimer = 0;
    this.enter('centering');
    this.onBurialStart?.(this.startPos, this.radius);
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.timer = 0;
  }

  /** Rotação inicial da bola + `angle` rad em volta do eixo de rolagem. */
  private spun(angle: number): THREE.Quaternion {
    return tmpQuat.setFromAxisAngle(this.spinAxis, angle).multiply(this.startRot);
  }

  // --- modelos ----------------------------------------------------------------

  /** Fundo do buraco: disco que escurece para o meio (vende a profundidade). */
  private buildThroat(ground: number): THREE.Mesh {
    const radius = BURROW.radius * 0.5;
    const geometry = new THREE.CircleGeometry(radius, 40, 0, Math.PI * 2);
    geometry.rotateX(-Math.PI / 2);
    const edge = new THREE.Color('#3a2719');
    const deep = new THREE.Color('#0b0604');
    paintVertices(geometry, (p, _n, c) => c.copy(deep).lerp(edge, smoothstep(0.1, 1, Math.hypot(p.x, p.z) / radius)));
    const mesh = new THREE.Mesh(geometry, clay(0xffffff, { vertexColors: true, roughness: 0.95, sheen: 0.1, bump: 0.3, mottle: 0.1, mottleScale: 2 }));
    mesh.position.set(BURROW.x, ground + 0.035, BURROW.z);
    mesh.receiveShadow = true;
    mesh.name = 'burrow-throat';
    return mesh;
  }

  /** Torrões de terra fofa espalhados em volta da boca. */
  private buildClods(): THREE.Group {
    const group = new THREE.Group();
    const rng = createRng(88);
    const geometry = claySphere(1, 2, 0.22, 2.2, 5);
    const materials = SOIL_COLORS.map((c) => clay(c, { roughness: 0.9, sheen: 0.3, bump: 0.5, mottle: 0.12, mottleScale: 5 }));
    for (let i = 0; i < 18; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = BURROW.radius * rng.range(0.98, 1.5);
      const x = BURROW.x + Math.cos(a) * d;
      const z = BURROW.z + Math.sin(a) * d;
      const s = rng.range(0.1, 0.28);
      const clod = new THREE.Mesh(geometry, rng.pick(materials));
      clod.scale.set(s, s * rng.range(0.6, 0.9), s * rng.range(0.8, 1.2));
      clod.position.set(x, terrainHeight(x, z) + s * 0.25, z);
      clod.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3);
      clod.castShadow = s > 0.18;
      clod.receiveShadow = true;
      group.add(clod);
    }
    group.name = 'burrow-clods';
    return group;
  }

  /** Bandeirinha: graveto fincado no monte de terra com uma folha laranja amarrada. */
  private buildFlag(): THREE.Object3D {
    const x = BURROW.x + BURROW.moundX * BURROW.radius * 1.75;
    const z = BURROW.z + BURROW.moundZ * BURROW.radius * 1.75;
    const base = terrainHeight(x, z) - 0.2;
    const height = 5.4;

    const pole = taperedTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, height * 0.4, 0.04), new THREE.Vector3(-0.04, height * 0.75, 0), new THREE.Vector3(0.06, height, 0.02)]),
      24,
      (t) => 0.11 * (1 - t * 0.45),
      8,
    );
    paintVertices(pole, (p, _n, c) => c.set('#8f6444').multiplyScalar(0.82 + Math.abs(Math.sin(p.y * 7 + Math.atan2(p.z, p.x) * 2)) * 0.25));
    const poleMesh = new THREE.Mesh(pole, clay(0xffffff, { vertexColors: true, roughness: 0.85, sheen: 0.3, bump: 0.5, mottle: 0.1, mottleScale: 3 }));
    poleMesh.castShadow = true;
    poleMesh.receiveShadow = true;

    const leaf = leafGeometry(2.3, 1.35, { fold: 0.18, curl: 0.12, widest: 0.45, segmentsL: 12, segmentsW: 4 });
    const orange = new THREE.Color('#ff9f2e');
    const cream = new THREE.Color('#fff1d6');
    paintVertices(leaf, (p, _n, c) => {
      // Faixa creme no meio: lê como "bandeira" e não como folha caída.
      const stripe = smoothstep(0.08, 0.02, Math.abs(p.z / 2.3 - 0.55));
      return c.copy(orange).multiplyScalar(0.9 + (p.z / 2.3) * 0.15).lerp(cream, stripe * 0.85);
    });
    // Folha cresce em +Z com a face para +Y: vira "de pé" (plano vertical), presa pelo cabo.
    leaf.rotateZ(Math.PI / 2);
    leaf.rotateY(Math.PI / 2);
    const flag = new THREE.Mesh(leaf, clay(0xffffff, { vertexColors: true, roughness: 0.62, sheen: 0.7, bump: 0.15, mottle: 0.06, mottleScale: 3, side: THREE.DoubleSide }));
    flag.castShadow = true;
    flag.position.y = height - 1.05;
    const knot = new THREE.Mesh(claySphere(0.16, 2, 0.1), clay('#e8c35a', { roughness: 0.7, sheen: 0.5, bump: 0.2 }));
    knot.position.set(0.04, height - 0.45, 0);

    this.flagPivot.position.set(x, base, z);
    this.flagPivot.add(poleMesh, flag, knot);
    return flag;
  }

  /** Anel tracejado rente ao chão em volta da boca (só aparece quando a bola já pode ser enterrada). */
  private buildRing(): THREE.Mesh {
    const inner = BURROW.radius * 1.28;
    const outer = BURROW.radius * 1.42;
    const geometry = new THREE.RingGeometry(inner, outer, 96, 1);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + BURROW.x;
      const z = pos.getZ(i) + BURROW.z;
      pos.setY(i, terrainHeight(x, z) + 0.07);
    }
    geometry.translate(BURROW.x, 0, BURROW.z);
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.ringUniforms]),
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        #include <fog_pars_vertex>
        void main() {
          vLocal = position.xz - vec2(${BURROW.x.toFixed(3)}, ${BURROW.z.toFixed(3)});
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vLocal;
        #include <fog_pars_fragment>
        void main() {
          // Traços girando devagar em volta da boca.
          float a = atan(vLocal.y, vLocal.x) / 6.2831853;
          float dash = smoothstep(0.35, 0.45, fract(a * 18.0 - uTime * 0.25)) * smoothstep(0.95, 0.85, fract(a * 18.0 - uTime * 0.25));
          gl_FragColor = vec4(uColor * 1.4, uOpacity * dash);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    // O merge copia os uniforms: aponta para os do material (os que o shader lê).
    this.ringUniforms.uTime = material.uniforms.uTime as { value: number };
    this.ringUniforms.uOpacity = material.uniforms.uOpacity as { value: number };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 3;
    mesh.userData.skipAO = true;
    mesh.visible = false;
    mesh.name = 'burrow-ring';
    return mesh;
  }
}
