import * as THREE from 'three';
import { clamp, smoothstep } from '../../utils/math';
import { terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { wormSegment } from './groundModels';
import { groundSpotNear, puddleAt } from './common';
import type { CritterContext, Species } from './types';

/**
 * Minhocas: só com o chão molhado. Saem de um buraquinho, rastejam em S com a
 * onda de contração correndo pelo corpo (peristaltismo) e voltam para a terra —
 * de ré, pelo mesmo buraco, se levam susto; de cabeça, cavando, quando o chão
 * seca ou cansam de passear. O corpo segue o rastro da cabeça, gomo a gomo.
 */

const SEGMENTS = 22;
const SPACING = 0.12;
const TRAIL_STEP = 0.05;
/** Profundidade que o "poço" desce por unidade de corpo (o que está lá dentro fica escondido). */
const SHAFT_SLOPE = 0.9;

const BODY = new THREE.Color('#c4786a');
const HEAD = new THREE.Color('#a95c57');
const COLLAR = new THREE.Color('#dd9f88');
const Z_AXIS = new THREE.Vector3(0, 0, 1);

interface Worm {
  slots: number[];
  state: 'hidden' | 'crawl' | 'dive' | 'retract';
  hole: THREE.Vector3;
  /** Rastro da cabeça a partir do buraco: x, z, altura do chão e profundidade (0 = na superfície). */
  trail: number[];
  headS: number;
  heading: number;
  speed: number;
  scale: number;
  threshold: number;
  timer: number;
  wait: number;
  divePlunge: number;
  seed: number;
}

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vTan = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const mOut = new THREE.Matrix4();

export class Earthworms implements Species {
  private readonly segments: InstancedPart;
  private readonly worms: Worm[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.segments = new InstancedPart(wormSegment(), mats.slimy, count * SEGMENTS, { name: 'earthworms', tinted: true, skipAO: true });
    parent.add(this.segments.mesh);
    for (let i = 0; i < count; i++) {
      const slots = Array.from({ length: SEGMENTS }, (_, k) => {
        const slot = this.segments.allocate();
        const t = k / (SEGMENTS - 1);
        const color = k < 2 ? HEAD : t > 0.24 && t < 0.34 ? COLLAR : BODY;
        this.segments.setColor(slot, color.clone().multiplyScalar(1 + Math.sin(k * 1.7) * 0.03));
        return slot;
      });
      this.worms.push({
        slots,
        state: 'hidden',
        hole: new THREE.Vector3(),
        trail: [],
        headS: 0,
        heading: 0,
        speed: ctx.rng.range(0.3, 0.45),
        scale: ctx.rng.range(0.85, 1.2),
        threshold: ctx.rng.range(0.3, 0.45),
        timer: 0,
        wait: ctx.rng.range(0, 6),
        divePlunge: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  private emerge(worm: Worm, ctx: CritterContext): boolean {
    if (!groundSpotNear(ctx, 4, 16, false, worm.hole, (x, z) => Math.hypot(x - ctx.world.ballPosition.x, z - ctx.world.ballPosition.z) > ctx.world.ballRadius + 2)) return false;
    worm.trail.length = 0;
    worm.trail.push(worm.hole.x, worm.hole.z, worm.hole.y, 0);
    worm.headS = 0;
    worm.heading = ctx.rng.next() * Math.PI * 2;
    worm.state = 'crawl';
    worm.timer = ctx.rng.range(8, 20);
    worm.divePlunge = 0;
    return true;
  }

  /** Ponto do corpo no comprimento `s` do rastro (s < 0 = dentro do buraco). Devolve a profundidade. */
  private pointAt(worm: Worm, s: number, target: THREE.Vector3): number {
    if (s <= 0) {
      target.set(worm.hole.x, worm.hole.y + s * SHAFT_SLOPE, worm.hole.z);
      return -s * SHAFT_SLOPE;
    }
    const points = worm.trail.length / 4;
    const f = clamp(s / TRAIL_STEP, 0, points - 1.001);
    const i = Math.floor(f);
    const k = f - i;
    const a = i * 4;
    const b = Math.min(i + 1, points - 1) * 4;
    const t = worm.trail;
    const depth = t[a + 3] + (t[b + 3] - t[a + 3]) * k;
    target.set(t[a] + (t[b] - t[a]) * k, t[a + 2] + (t[b + 2] - t[a + 2]) * k - depth, t[a + 1] + (t[b + 1] - t[a + 1]) * k);
    return depth;
  }

  /** Cabeça anda `distance` para a frente, estendendo o rastro (rastejando ou cavando para baixo). */
  private advance(worm: Worm, distance: number, ctx: CritterContext, digging: boolean): void {
    worm.headS += distance;
    const t = worm.trail;
    while ((t.length / 4 - 1) * TRAIL_STEP < worm.headS) {
      const last = t.length - 4;
      let x = t[last];
      let z = t[last + 1];
      for (let attempt = 0; attempt < 6; attempt++) {
        const nx = t[last] + Math.sin(worm.heading) * TRAIL_STEP;
        const nz = t[last + 1] + Math.cos(worm.heading) * TRAIL_STEP;
        if (digging || (ctx.isGroundFree(nx, nz) && !puddleAt(ctx, nx, nz, 0.2) && Math.hypot(nx, nz) < PLAY_RADIUS - 2)) {
          x = nx;
          z = nz;
          break;
        }
        // Esbarrou em algo (pedra, poça, borda): vira e tenta de novo.
        worm.heading += Math.PI * 0.3;
      }
      const depth = digging ? t[last + 3] + TRAIL_STEP * 0.75 : 0;
      t.push(x, z, terrainHeight(x, z), depth);
    }
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const worm of this.worms) {
      const length = SEGMENTS * SPACING * worm.scale;
      if (worm.state === 'hidden') {
        this.hide(worm);
        worm.wait -= dt;
        if (worm.wait <= 0 && w.wetness > worm.threshold) {
          if (!this.emerge(worm, ctx)) {
            worm.wait = 1;
            continue;
          }
        } else continue;
      }
      const head = vA;
      this.pointAt(worm, worm.headS, head);
      const farAway = Math.hypot(head.x - w.player.x, head.z - w.player.z) > 38;
      const scared =
        Math.hypot(head.x - w.player.x, head.z - w.player.z) < 1.4 ||
        Math.hypot(head.x - w.ballPosition.x, head.z - w.ballPosition.z) < w.ballRadius + 0.8;

      if (worm.state === 'crawl') {
        worm.timer -= dt;
        if (scared) worm.state = worm.headS < length * 1.3 ? 'retract' : 'dive';
        else if (worm.timer <= 0 || w.wetness < worm.threshold - 0.12 || farAway) worm.state = 'dive';
        else {
          // Serpenteia: a cabeça vai e volta enquanto avança.
          worm.heading += Math.sin(ctx.time * 0.8 + worm.seed) * 0.9 * dt;
          this.advance(worm, worm.speed * dt, ctx, false);
        }
      } else if (worm.state === 'dive') {
        this.advance(worm, worm.speed * (scared ? 2.2 : 1) * dt, ctx, true);
        worm.divePlunge += worm.speed * dt;
        if (worm.divePlunge > length + 0.6) this.bury(worm, ctx);
      } else if (worm.state === 'retract') {
        worm.headS -= 1.1 * dt;
        if (worm.headS < -0.3) this.bury(worm, ctx);
      }
      if (worm.state !== 'hidden') this.draw(worm, ctx.time);
    }
    this.segments.flush();
  }

  private bury(worm: Worm, ctx: CritterContext): void {
    worm.state = 'hidden';
    worm.wait = ctx.rng.range(3, 12);
    this.hide(worm);
  }

  private draw(worm: Worm, time: number): void {
    const n = SEGMENTS;
    for (let i = 0; i < n; i++) {
      const s = worm.headS - i * SPACING * worm.scale;
      const depth = this.pointAt(worm, s, vA);
      const t = i / (n - 1);
      let r = 0.088 * worm.scale * (t < 0.1 ? 0.72 + t * 2.8 : 1 - 0.38 * smoothstep(0.6, 1, t));
      if (t > 0.24 && t < 0.34) r *= 1.14;
      // Onda de contração correndo do rabo para a cabeça.
      r *= 1 + 0.08 * Math.sin(s * 9 - time * 7);
      if (depth > r * 2.2) {
        this.segments.hide(worm.slots[i]);
        continue;
      }
      this.pointAt(worm, s + 0.06, vB);
      vTan.copy(vB);
      this.pointAt(worm, s - 0.06, vB);
      vTan.sub(vB);
      if (vTan.lengthSq() < 1e-8) vTan.set(Math.sin(worm.heading), 0, Math.cos(worm.heading));
      qTmp.setFromUnitVectors(Z_AXIS, vTan.normalize());
      vA.y += r * 0.85;
      mOut.compose(vA, qTmp, vScale.set(r, r * 0.92, r * 1.9));
      this.segments.set(worm.slots[i], mOut);
    }
  }

  private hide(worm: Worm): void {
    for (const s of worm.slots) this.segments.hide(s);
  }

  startle(position: THREE.Vector3, radius: number, _ctx: CritterContext): void {
    for (const worm of this.worms) {
      if (worm.state !== 'crawl') continue;
      this.pointAt(worm, worm.headS, vA);
      if (vA.distanceTo(position) < radius + 2.5) worm.state = worm.headS < SEGMENTS * SPACING * worm.scale * 1.3 ? 'retract' : 'dive';
    }
  }
}
