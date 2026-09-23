import * as THREE from 'three';
import { damp, dampAngle } from '../../utils/math';
import { terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import { INCHWORM_RADIUS, inchwormCurled, inchwormHead, inchwormSegment } from './leafModels';
import { UP, attraction, ballTakes, collectedMesh, groundSpotNear, inView, puddleAt, shoveFromBall, threatAt } from './common';
import type { CollectedCritter, CritterContext, Species } from './types';

/**
 * Lagarta mede-palmo (de mariposa geometrídea): só tem patas nas duas pontas,
 * então anda em "sanfona" — segura a frente, traz o rabo até ela arqueando o
 * corpo em "Ω", depois segura o rabo e estica a frente (levantando a cabeça,
 * como quem procura onde pisar). Com susto, faz o truque de verdade: trava o
 * corpo reto e inclinado, fingindo de galhinho, até o perigo passar.
 */

const SEGMENTS = 12;
/** Comprimento do corpo (escala 1), medido pelo arco. */
const LENGTH = 0.7;
/** Pedaço de cada ponta que fica colado no chão (as patas). */
const FLAT = 0.13;
/** Distância entre as pontas (fração do comprimento): esticada e toda arqueada. */
const CHORD_MAX = 0.92;
const CHORD_MIN = 0.4;
/** Segundos de um ciclo completo (junta + estica). */
const CYCLE = 1.7;
/** Inclinação do corpo fingindo de galhinho. */
const TWIG_ANGLE = 0.95;
const CATERPILLAR_SIZE = 0.4;

type InchwormState = 'crawl' | 'freeze';

interface Inchworm {
  headSlot: number;
  segmentSlots: number[];
  state: InchwormState;
  /** Pontas no chão (só x e z valem): frente e rabo. */
  readonly front: THREE.Vector3;
  readonly rear: THREE.Vector3;
  readonly home: THREE.Vector3;
  /** Direção do rabo para a frente (ângulo no plano) e para onde ela quer ir. */
  heading: number;
  goal: number;
  /** 0..1 no ciclo: < 0,5 o rabo vem; > 0,5 a frente estica. */
  phase: number;
  scale: number;
  /** 0..1: quanto está na pose de galhinho. */
  twig: number;
  freeze: number;
  placed: boolean;
  gone: number;
  seed: number;
}

const vDir = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vPos = new THREE.Vector3();
const vTan = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const mOut = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** Centros dos gomos no frame (rascunho reaproveitado: nada de alocar por quadro). */
const points = new Float32Array(SEGMENTS * 3);

const ease = (t: number) => t * t * (3 - 2 * t);

export class Caterpillars implements Species {
  private readonly head: InstancedPart;
  private readonly segments: InstancedPart;
  private readonly worms: Inchworm[] = [];
  private curled: THREE.BufferGeometry | null = null;

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.head = new InstancedPart(inchwormHead(), mats.body, count, { name: 'caterpillar-head' });
    this.segments = new InstancedPart(inchwormSegment(), mats.body, count * SEGMENTS, { name: 'caterpillar-body', skipAO: true });
    parent.add(this.head.mesh, this.segments.mesh);
    for (let i = 0; i < count; i++) {
      this.worms.push({
        headSlot: this.head.allocate(),
        segmentSlots: Array.from({ length: SEGMENTS }, () => this.segments.allocate()),
        state: 'crawl',
        front: new THREE.Vector3(),
        rear: new THREE.Vector3(),
        home: new THREE.Vector3(),
        heading: 0,
        goal: 0,
        phase: ctx.rng.next(),
        scale: ctx.rng.range(0.9, 1.12),
        twig: 0,
        freeze: 0,
        placed: false,
        gone: 0,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  /** Comprimento da corda (frente–rabo) numa fase do ciclo. */
  private chord(phase: number): number {
    return phase < 0.5 ? CHORD_MAX + (CHORD_MIN - CHORD_MAX) * ease(phase * 2) : CHORD_MIN + (CHORD_MAX - CHORD_MIN) * ease((phase - 0.5) * 2);
  }

  private place(worm: Inchworm, ctx: CritterContext, min: number, max: number): boolean {
    if (!groundSpotNear(ctx, min, max, true, worm.front)) return false;
    worm.home.copy(worm.front);
    worm.heading = worm.goal = ctx.rng.next() * Math.PI * 2;
    worm.phase = 0.5;
    worm.state = 'crawl';
    worm.twig = 0;
    this.pinRear(worm);
    return true;
  }

  /** Rabo atrás da frente, na corda da fase atual. */
  private pinRear(worm: Inchworm): void {
    const d = this.chord(worm.phase) * LENGTH * worm.scale;
    worm.rear.set(worm.front.x - Math.sin(worm.heading) * d, 0, worm.front.z - Math.cos(worm.heading) * d);
  }

  update(dt: number, ctx: CritterContext): void {
    const player = ctx.world.player;
    for (const worm of this.worms) {
      if (worm.gone > 0) {
        worm.gone -= dt;
        this.hide(worm);
        if (worm.gone > 0) continue;
        worm.placed = false;
      }
      const far = Math.hypot(worm.front.x - player.x, worm.front.z - player.z) > 40;
      if (!worm.placed || (far && !inView(ctx, worm.front.x, worm.front.z))) {
        worm.placed = this.place(worm, ctx, worm.placed ? 16 : 5, worm.placed ? 28 : 22);
        if (!worm.placed) {
          this.hide(worm);
          continue;
        }
      }
      const f = worm.front;
      const hurry = attraction(ctx, f.x, f.z, vTmp);
      const danger = threatAt(ctx, f.x, terrainHeight(f.x, f.z), f.z, vAway);
      if (hurry > 0) {
        worm.state = 'crawl';
        worm.goal = Math.atan2(vTmp.x, vTmp.z);
      } else if (danger < 1.3) {
        worm.state = 'freeze';
        worm.freeze = 2.5;
      }
      if (worm.state === 'freeze') {
        worm.twig = damp(worm.twig, 1, 7, dt);
        if (danger > 1.6) worm.freeze -= dt;
        if (worm.freeze <= 0) worm.state = 'crawl';
      } else {
        worm.twig = damp(worm.twig, 0, 3, dt);
        if (worm.twig < 0.2) this.crawl(worm, dt, ctx, hurry > 0 ? hurry : 1);
      }
      // A bola não passa por cima: empurra o bicho inteiro.
      vTmp.set(f.x, terrainHeight(f.x, f.z), f.z);
      if (shoveFromBall(ctx, vTmp, 0.1, 0.1)) {
        worm.rear.x += vTmp.x - f.x;
        worm.rear.z += vTmp.z - f.z;
        f.x = vTmp.x;
        f.z = vTmp.z;
      }
      this.draw(worm);
    }
    this.head.flush();
    this.segments.flush();
  }

  private crawl(worm: Inchworm, dt: number, ctx: CritterContext, hurry: number): void {
    const before = worm.phase;
    worm.phase = (worm.phase + (dt / CYCLE) * hurry) % 1;
    if (worm.phase < before) {
      // Ciclo novo: escolhe a próxima direção (passeando em volta de casa).
      const homeward = Math.atan2(worm.home.x - worm.front.x, worm.home.z - worm.front.z);
      const away = Math.hypot(worm.home.x - worm.front.x, worm.home.z - worm.front.z) > 2.5;
      if (ctx.attract === 0) worm.goal = away ? homeward : worm.heading + ctx.rng.range(-0.7, 0.7);
    }
    const scaleLength = LENGTH * worm.scale;
    if (worm.phase < 0.5) {
      // Rabo vem até a frente (a frente fica parada).
      const d = this.chord(worm.phase) * scaleLength;
      worm.rear.set(worm.front.x - Math.sin(worm.heading) * d, 0, worm.front.z - Math.cos(worm.heading) * d);
      return;
    }
    // Frente estica (o rabo fica parado) e a cabeça escolhe o rumo.
    const heading = dampAngle(worm.heading, worm.goal, 2.5, dt);
    const d = this.chord(worm.phase) * scaleLength;
    const nx = worm.rear.x + Math.sin(heading) * d;
    const nz = worm.rear.z + Math.cos(heading) * d;
    if (!ctx.isGroundFree(nx, nz) || puddleAt(ctx, nx, nz, 0.1) || Math.hypot(nx, nz) > PLAY_RADIUS - 2) {
      // Esbarrou: segura o passo e vira.
      worm.phase = before;
      worm.goal = worm.heading + Math.PI * 0.6;
      worm.heading = heading;
      return;
    }
    worm.heading = heading;
    worm.front.set(nx, 0, nz);
  }

  /** Calcula os centros dos gomos (da frente para o rabo) em `points`. */
  private shape(worm: Inchworm): void {
    const L = LENGTH * worm.scale;
    const r = INCHWORM_RADIUS * worm.scale;
    const flat = FLAT * L;
    const dx = worm.front.x - worm.rear.x;
    const dz = worm.front.z - worm.rear.z;
    const chord = Math.hypot(dx, dz);
    vDir.set(dx / Math.max(chord, 1e-4), 0, dz / Math.max(chord, 1e-4));
    // Arco do meio: corda e comprimento que sobram tirando as duas pontas coladas.
    const midChord = Math.max(0, chord - flat * 2);
    const midLength = L - flat * 2;
    const height = 0.5 * Math.sqrt(Math.max(0, midLength * midLength - midChord * midChord)) * 0.9;
    // Arco bem fechado vira "Ω": a volta de cima fica mais larga que a base.
    const bulge = Math.max(0, height - midChord) * 0.32;
    // Esticando a frente, a cabeça levanta um pouco (procurando onde pisar).
    const reach = worm.phase > 0.5 ? Math.sin(Math.PI * (worm.phase - 0.5) * 2) * 0.07 * worm.scale : 0;
    const twig = ease(worm.twig);
    for (let i = 0; i < SEGMENTS; i++) {
      const s = (i / (SEGMENTS - 1)) * L;
      let back: number;
      let y: number;
      if (s < flat) {
        back = s;
        y = reach * (1 - s / flat) ** 2;
      } else if (s > L - flat) {
        back = chord - (L - s);
        y = 0;
      } else {
        const theta = (Math.PI * (s - flat)) / midLength;
        back = flat + midChord * 0.5 * (1 - Math.cos(theta)) - bulge * Math.sin(theta * 2);
        y = height * Math.sin(theta);
      }
      let x = worm.front.x - vDir.x * back;
      let z = worm.front.z - vDir.z * back;
      if (twig > 0) {
        // Galhinho: o rabo fica no chão e o resto sobe reto, inclinado.
        const up = Math.max(0, L - flat - s);
        const tx = worm.rear.x + vDir.x * (flat * 0.5 + up * Math.cos(TWIG_ANGLE));
        const tz = worm.rear.z + vDir.z * (flat * 0.5 + up * Math.cos(TWIG_ANGLE));
        const ty = up * Math.sin(TWIG_ANGLE);
        x += (tx - x) * twig;
        z += (tz - z) * twig;
        y += (ty - y) * twig;
      }
      points[i * 3] = x;
      points[i * 3 + 1] = terrainHeight(x, z) + y + r * 0.95;
      points[i * 3 + 2] = z;
    }
  }

  private draw(worm: Inchworm): void {
    this.shape(worm);
    const r = INCHWORM_RADIUS * worm.scale;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = Math.max(0, i - 1) * 3;
      const b = Math.min(SEGMENTS - 1, i + 1) * 3;
      vTan.set(points[a] - points[b], points[a + 1] - points[b + 1], points[a + 2] - points[b + 2]);
      if (vTan.lengthSq() < 1e-10) vTan.copy(vDir);
      qTmp.setFromUnitVectors(Z_AXIS, vTan.normalize());
      // Afina um pouco no rabo.
      const k = i / (SEGMENTS - 1);
      const t = r * (k > 0.7 ? 1 - (k - 0.7) * 0.5 : 1);
      vPos.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      this.segments.set(worm.segmentSlots[i], mOut.compose(vPos, qTmp, vScale.set(t, t * 0.95, t * 1.65)));
      if (i === 0) {
        // Cabeça logo à frente do primeiro gomo, olhando para onde o corpo aponta.
        vPos.addScaledVector(vTan, r * 1.15);
        this.head.set(worm.headSlot, mOut.compose(vPos, qTmp, vScale.setScalar(worm.scale)));
      }
    }
  }

  private hide(worm: Inchworm): void {
    this.head.hide(worm.headSlot);
    for (const s of worm.segmentSlots) this.segments.hide(s);
  }

  startle(position: THREE.Vector3, radius: number): void {
    for (const worm of this.worms) {
      if (worm.placed && worm.gone <= 0 && Math.hypot(worm.front.x - position.x, worm.front.z - position.z) < radius + 2) {
        worm.state = 'freeze';
        worm.freeze = 3;
      }
    }
  }

  collect(center: THREE.Vector3, radius: number): CollectedCritter | null {
    if (radius < CATERPILLAR_SIZE * 1.6) return null;
    for (const worm of this.worms) {
      if (!worm.placed || worm.gone > 0) continue;
      this.shape(worm);
      let touching = false;
      for (let i = 0; i < SEGMENTS && !touching; i += 4) {
        touching = ballTakes(center, radius, CATERPILLAR_SIZE, points[i * 3], points[i * 3 + 1], points[i * 3 + 2], INCHWORM_RADIUS * worm.scale * 1.5);
      }
      if (!touching) continue;
      const mid = Math.floor(SEGMENTS / 2) * 3;
      vPos.set(points[mid], terrainHeight(points[mid], points[mid + 2]), points[mid + 2]);
      qTmp.setFromAxisAngle(UP, worm.heading);
      this.curled ??= inchwormCurled(SEGMENTS, LENGTH);
      worm.gone = 25;
      this.hide(worm);
      return {
        id: 'caterpillar',
        object: collectedMesh(this.curled, critterMaterials().body, mOut.compose(vPos, qTmp, vScale.setScalar(worm.scale))),
        size: CATERPILLAR_SIZE,
        color: new THREE.Color('#8cc63f'),
      };
    }
    return null;
  }
}
