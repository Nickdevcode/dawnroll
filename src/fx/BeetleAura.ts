import * as THREE from 'three';
import type { SkinAura } from '../progression/skins';
import { createRng } from '../utils/math';
import { SoftParticles } from './SoftParticles';

/**
 * O "clima" em volta dos cascos vivos: faíscas subindo do magma, estrelinhas
 * da galáxia, brilhos do ouro, bolhas do abissal... Um único THREE.Points
 * aditivo (um draw call), com teto de partículas; nos cascos sem aura, nada
 * nasce e o custo é zero.
 *
 * As partículas nascem em cima do casco (uma cúpula no espaço do besouro,
 * transformada pela matriz dele) e depois vivem no mundo: ficam pra trás
 * quando ele corre, como faísca de verdade.
 */

interface AuraStyle {
  /** Partículas por segundo parado e o extra correndo (por u/s). */
  rate: number;
  moveRate: number;
  colors: THREE.Color[];
  size: [number, number];
  life: [number, number];
  /** Subida (negativo = sobe) e freio do ar. */
  gravity: number;
  drag: number;
  /** Velocidade inicial pra cima e espalhada pros lados. */
  rise: number;
  spread: number;
  wobble: number;
  alpha: number;
  grow: number;
}

const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

const STYLES: Record<SkinAura, AuraStyle> = {
  embers: {
    rate: 9,
    moveRate: 3,
    colors: [hdr('#ff6a1c', 3), hdr('#ffb13a', 3.2), hdr('#ffe08a', 2.6)],
    size: [0.025, 0.045],
    life: [0.7, 1.3],
    gravity: -1.4,
    drag: 1.6,
    rise: 0.5,
    spread: 0.25,
    wobble: 0.35,
    alpha: 0.9,
    grow: 0.4,
  },
  stars: {
    rate: 7,
    moveRate: 1.5,
    colors: [hdr('#ffffff', 2.6), hdr('#bcd2ff', 2.6), hdr('#e3b6ff', 2.4)],
    size: [0.018, 0.034],
    life: [1.2, 2.2],
    gravity: -0.12,
    drag: 2.5,
    rise: 0.12,
    spread: 0.12,
    wobble: 0.08,
    alpha: 0.95,
    grow: 0.6,
  },
  sparkles: {
    rate: 6,
    moveRate: 2,
    colors: [hdr('#fff2b8', 3), hdr('#ffd66b', 3), hdr('#ffffff', 2.8)],
    size: [0.02, 0.04],
    life: [0.35, 0.7],
    gravity: -0.2,
    drag: 3,
    rise: 0.1,
    spread: 0.08,
    wobble: 0,
    alpha: 1,
    grow: 0.2,
  },
  glints: {
    rate: 5,
    moveRate: 1.5,
    colors: [hdr('#ffffff', 3), hdr('#cdeeff', 3)],
    size: [0.022, 0.04],
    life: [0.25, 0.45],
    gravity: 0,
    drag: 4,
    rise: 0,
    spread: 0.05,
    wobble: 0,
    alpha: 1,
    grow: 0.15,
  },
  motes: {
    rate: 5,
    moveRate: 1.5,
    colors: [hdr('#7dffb0', 2.2), hdr('#b77dff', 2.2), hdr('#ffc27a', 2.2)],
    size: [0.03, 0.05],
    life: [1.4, 2.4],
    gravity: -0.25,
    drag: 2,
    rise: 0.15,
    spread: 0.15,
    wobble: 0.25,
    alpha: 0.7,
    grow: 0.8,
  },
  bubbles: {
    rate: 5,
    moveRate: 1.5,
    colors: [hdr('#5ef2e6', 2.4), hdr('#8a7bff', 2.2)],
    size: [0.02, 0.038],
    life: [1.2, 2],
    gravity: -0.45,
    drag: 1.8,
    rise: 0.2,
    spread: 0.06,
    wobble: 0.3,
    alpha: 0.75,
    grow: 1.1,
  },
};

const tmp = new THREE.Vector3();
const tmpVel = new THREE.Vector3();

export class BeetleAura {
  readonly points: THREE.Points;
  private readonly particles = new SoftParticles(110, true);
  private readonly rng = createRng(4242);
  private style: AuraStyle | null = null;
  private colors: THREE.Color[] = [];
  private pending = 0;
  private readonly lastPosition = new THREE.Vector3();
  private hasLast = false;

  constructor() {
    this.points = this.particles.points;
    this.points.name = 'beetle-aura';
  }

  /** Troca o tipo (null = sem aura). `colors` substitui a paleta padrão do tipo. */
  setKind(kind: SkinAura | null, colors?: readonly string[]): void {
    this.style = kind ? STYLES[kind] : null;
    this.colors = this.style ? (colors ? colors.map((c) => hdr(c, 2.4)) : this.style.colors) : [];
  }

  /**
   * Um quadro: nasce o que está devido (mais correndo) em cima do casco e as
   * vivas andam. `root` = raiz do modelo do besouro (já posicionado neste quadro).
   */
  update(dt: number, root: THREE.Object3D, pixelScale: number): void {
    const style = this.style;
    const origin = tmp.setFromMatrixPosition(root.matrixWorld);
    const speed = this.hasLast && dt > 0 ? Math.min(origin.distanceTo(this.lastPosition) / dt, 10) : 0;
    this.lastPosition.copy(origin);
    this.hasLast = true;
    if (style) {
      this.pending += dt * (style.rate + style.moveRate * speed);
      while (this.pending >= 1) {
        this.pending -= 1;
        this.emit(style, root);
      }
    }
    this.particles.update(dt, pixelScale);
  }

  private emit(style: AuraStyle, root: THREE.Object3D): void {
    const r = this.rng;
    // Ponto na cúpula do casco (espaço do besouro): mais em cima que dos lados.
    const a = r.next() * Math.PI * 2;
    const up = Math.pow(r.next(), 0.6);
    const ring = Math.sqrt(1 - up * up);
    const local = tmpVel.set(Math.cos(a) * ring * 0.4, 0.3 + up * 0.32, -0.08 + Math.sin(a) * ring * 0.48);
    const world = local.applyMatrix4(root.matrixWorld);
    this.particles.spawn({
      x: world.x,
      y: world.y,
      z: world.z,
      vx: r.range(-1, 1) * style.spread,
      vy: style.rise * r.range(0.5, 1.2),
      vz: r.range(-1, 1) * style.spread,
      color: this.colors[Math.floor(r.next() * this.colors.length)],
      size: r.range(style.size[0], style.size[1]),
      life: r.range(style.life[0], style.life[1]),
      grow: style.grow,
      drag: style.drag,
      gravity: style.gravity,
      alpha: style.alpha,
      wobble: style.wobble,
    });
  }
}
