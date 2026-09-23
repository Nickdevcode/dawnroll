import * as THREE from 'three';
import { damp, smoothstep } from '../../utils/math';
import { terrainHeight, terrainNormal, PLAY_RADIUS } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { critterMaterials } from './materials';
import {
  frogBody,
  frogHindLegs,
  frogThroat,
  FrogPalettes,
  FROG_HIP,
  grasshopperBody,
  grasshopperFemurs,
  grasshopperTibias,
  GrasshopperPalettes,
  GRASSHOPPER_HIP,
  GRASSHOPPER_KNEE,
} from './groundModels';
import { UP, groundSpotNear, inView, puddleAt, threatAt } from './common';
import { jointMatrix } from './flyers';
import type { CritterContext, CritterPuddle, Species } from './types';

/**
 * Pulões: gafanhotos (parados no capim, saltam num arco quando o besouro chega)
 * e sapos (aparecem na beira das poças cheias, coaxam inflando o papo e fogem
 * aos pulos — enormes para um besouro, e é aí que está a graça).
 */

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const qAlign = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vUp = new THREE.Vector3();
const vScale = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Raiz alinhada a uma normal (misturada com o "para cima"), com guinada e arfagem. */
function hopperRoot(target: THREE.Matrix4, position: THREE.Vector3, up: THREE.Vector3, yaw: number, pitch: number, scale: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  qAlign.setFromUnitVectors(UP, up);
  qAlign.multiply(qYaw.setFromAxisAngle(UP, yaw)).multiply(qPitch.setFromAxisAngle(X_AXIS, pitch));
  return target.compose(position, qAlign, vScale.set(scale * sx, scale * sy, scale * sz));
}

/** Pulo em arco de A até B. */
interface Leap {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  t: number;
  duration: number;
  height: number;
}

function leapPosition(leap: Leap, target: THREE.Vector3): THREE.Vector3 {
  const k = leap.t;
  target.lerpVectors(leap.from, leap.to, k);
  target.y += Math.sin(Math.PI * k) * leap.height;
  return target;
}

// ---------------------------------------------------------------------------
// Gafanhotos

interface Grasshopper {
  slot: number;
  state: 'idle' | 'crouch' | 'jump';
  position: THREE.Vector3;
  up: THREE.Vector3;
  yaw: number;
  scale: number;
  timer: number;
  leap: Leap;
  placed: boolean;
  seed: number;
}

export class Grasshoppers implements Species {
  private readonly body: InstancedPart;
  private readonly femurs: InstancedPart;
  private readonly tibias: InstancedPart;
  private readonly hoppers: Grasshopper[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.body = new InstancedPart(grasshopperBody(), mats.paletteBody, count, { name: 'grasshopper-body', palette: true });
    this.femurs = new InstancedPart(grasshopperFemurs(), mats.paletteBody, count, { name: 'grasshopper-femurs', palette: true });
    this.tibias = new InstancedPart(grasshopperTibias(), mats.paletteBody, count, { name: 'grasshopper-tibias', palette: true, skipAO: true });
    parent.add(this.body.mesh, this.femurs.mesh, this.tibias.mesh);
    for (let i = 0; i < count; i++) {
      const slot = this.body.allocate();
      this.femurs.allocate();
      this.tibias.allocate();
      const p = GrasshopperPalettes[i % GrasshopperPalettes.length];
      const a = new THREE.Color(p.a);
      const b = new THREE.Color(p.b);
      const c = new THREE.Color(p.c);
      for (const part of [this.body, this.femurs, this.tibias]) part.setPalette(slot, a, b, c);
      this.hoppers.push({
        slot,
        state: 'idle',
        position: new THREE.Vector3(),
        up: new THREE.Vector3(0, 1, 0),
        yaw: ctx.rng.next() * Math.PI * 2,
        scale: ctx.rng.range(0.85, 1.15),
        timer: ctx.rng.range(4, 14),
        leap: { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, duration: 0.5, height: 1 },
        placed: false,
        seed: ctx.rng.next() * 100,
      });
    }
  }

  /** Escolhe onde cair: na direção `dir` (com uma folga de ângulo), em chão livre e seco. */
  private jump(h: Grasshopper, ctx: CritterContext, dir: THREE.Vector3 | null, min: number, max: number): void {
    if (h.state !== 'idle') return;
    const base = dir ? Math.atan2(dir.x, dir.z) : ctx.rng.next() * Math.PI * 2;
    for (let i = 0; i < 14; i++) {
      const a = base + ctx.rng.range(-0.7, 0.7);
      const d = ctx.rng.range(min, max);
      const x = h.position.x + Math.sin(a) * d;
      const z = h.position.z + Math.cos(a) * d;
      if (Math.hypot(x, z) > PLAY_RADIUS - 2 || !ctx.isGroundFree(x, z) || puddleAt(ctx, x, z, 0.3)) continue;
      h.leap.from.copy(h.position);
      h.leap.to.set(x, terrainHeight(x, z), z);
      h.leap.t = 0;
      h.leap.duration = 0.42 + d * 0.05;
      h.leap.height = 0.8 + d * 0.3;
      h.yaw = a;
      h.state = 'crouch';
      h.timer = 0.12;
      return;
    }
  }

  update(dt: number, ctx: CritterContext): void {
    for (const h of this.hoppers) {
      if (!h.placed || (h.state === 'idle' && Math.hypot(h.position.x - ctx.world.player.x, h.position.z - ctx.world.player.z) > 40)) {
        h.placed = groundSpotNear(ctx, h.placed ? 18 : 6, h.placed ? 30 : 24, true, h.position);
        if (!h.placed) {
          this.hide(h);
          continue;
        }
        h.state = 'idle';
      }
      let femur = 0;
      let tibia = 0;
      let pitch = 0;
      let shake = 0;
      if (h.state === 'idle') {
        h.timer -= dt;
        const danger = threatAt(ctx, h.position.x, h.position.y, h.position.z, vAway);
        if (danger < 2.4) this.jump(h, ctx, vAway, 3, 6);
        else if (h.timer <= 0) {
          h.timer = ctx.rng.range(6, 18);
          this.jump(h, ctx, null, 1, 2.5);
        }
        // "Canto" do gafanhoto: tremidinha da perna de vez em quando.
        const song = Math.sin((ctx.time + h.seed) * 0.6);
        if (song > 0.8) {
          shake = Math.sin(ctx.time * 60) * 0.05;
          ctx.sounds.hum('stridulate', h.position);
        }
        h.up.lerp(terrainNormal(h.position.x, h.position.z, vTmp).lerp(UP, 0.4).normalize(), 1 - Math.exp(-8 * dt));
      } else if (h.state === 'crouch') {
        h.timer -= dt;
        femur = -0.3;
        tibia = -0.15;
        if (h.timer <= 0) {
          h.state = 'jump';
          ctx.sounds.call('hop', h.position, h.scale);
        }
      } else {
        const leap = h.leap;
        leap.t = Math.min(1, leap.t + dt / leap.duration);
        leapPosition(leap, h.position);
        // Pernas esticam no impulso, ficam para trás no voo e dobram antes de cair.
        tibia = 1.8 * (1 - smoothstep(0.55, 0.95, leap.t));
        femur = 0.35 * (1 - smoothstep(0.6, 1, leap.t));
        pitch = (0.5 - leap.t) * -1.1;
        h.up.lerp(UP, 1 - Math.exp(-10 * dt));
        if (leap.t >= 1) {
          h.state = 'idle';
          h.position.copy(leap.to);
        }
      }
      hopperRoot(mRoot, h.position, h.up, h.yaw, pitch, h.scale);
      this.body.set(h.slot, mRoot);
      this.femurs.set(h.slot, jointMatrix(mRoot, GRASSHOPPER_HIP, femur + shake, 0, 0, mOut));
      // Canela presa no joelho da coxa (que também girou).
      const cf = Math.cos(femur + shake);
      const sf = Math.sin(femur + shake);
      const ky = GRASSHOPPER_KNEE.y - GRASSHOPPER_HIP.y;
      const kz = GRASSHOPPER_KNEE.z - GRASSHOPPER_HIP.z;
      vTmp.set(0, GRASSHOPPER_HIP.y + ky * cf - kz * sf, GRASSHOPPER_HIP.z + ky * sf + kz * cf);
      this.tibias.set(h.slot, jointMatrix(mRoot, vTmp, femur + shake + tibia, 0, 0, mOut));
    }
    this.body.flush();
    this.femurs.flush();
    this.tibias.flush();
  }

  private hide(h: Grasshopper): void {
    this.body.hide(h.slot);
    this.femurs.hide(h.slot);
    this.tibias.hide(h.slot);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const h of this.hoppers) {
      if (h.state !== 'idle' || h.position.distanceTo(position) > radius + 3) continue;
      vAway.copy(h.position).sub(position).setY(0).normalize();
      this.jump(h, ctx, vAway, 3, 6);
    }
  }
}

// ---------------------------------------------------------------------------
// Sapos

interface Frog {
  slot: number;
  state: 'hidden' | 'sit' | 'hop' | 'leave';
  position: THREE.Vector3;
  up: THREE.Vector3;
  yaw: number;
  scale: number;
  pond: CritterPuddle | null;
  leap: Leap;
  /** Segundos até o próximo pulinho à toa. */
  wander: number;
  croak: number;
  croakTime: number;
  throat: number;
  search: number;
  seed: number;
}

/** Ponto da margem da poça num ângulo (de onde o sapo olha para a água). */
function shorePoint(pond: CritterPuddle, angle: number, scale: number, target: THREE.Vector3): THREE.Vector3 | null {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  for (let d = pond.radius * 0.25; d < pond.radius * 1.6; d += 0.15) {
    const x = pond.x + dx * d;
    const z = pond.z + dz * d;
    if (terrainHeight(x, z) > pond.level + 0.06) {
      // O focinho encosta na água; o corpo fica em terra firme.
      const back = d + 0.95 * scale;
      const bx = pond.x + dx * back;
      const bz = pond.z + dz * back;
      return target.set(bx, terrainHeight(bx, bz), bz);
    }
  }
  return null;
}

export class Frogs implements Species {
  private readonly body: InstancedPart;
  private readonly throat: InstancedPart;
  private readonly legs: InstancedPart;
  private readonly frogs: Frog[] = [];

  constructor(count: number, ctx: CritterContext, parent: THREE.Group) {
    const mats = critterMaterials();
    this.body = new InstancedPart(frogBody(), mats.paletteGloss, count, { name: 'frog-body', palette: true });
    this.throat = new InstancedPart(frogThroat(), mats.slimy, count, { name: 'frog-throat', skipAO: true });
    this.legs = new InstancedPart(frogHindLegs(), mats.paletteGloss, count, { name: 'frog-legs', palette: true });
    parent.add(this.body.mesh, this.throat.mesh, this.legs.mesh);
    for (let i = 0; i < count; i++) {
      const slot = this.body.allocate();
      this.throat.allocate();
      this.legs.allocate();
      const p = FrogPalettes[i % FrogPalettes.length];
      const a = new THREE.Color(p.a);
      const b = new THREE.Color(p.b);
      const c = new THREE.Color(p.c);
      this.body.setPalette(slot, a, b, c);
      this.legs.setPalette(slot, a, b, c);
      this.frogs.push({
        slot,
        state: 'hidden',
        position: new THREE.Vector3(),
        up: new THREE.Vector3(0, 1, 0),
        yaw: 0,
        scale: ctx.rng.range(1.15, 1.35),
        pond: null,
        leap: { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, duration: 0.5, height: 1 },
        wander: ctx.rng.range(8, 16),
        croak: ctx.rng.range(2, 6),
        croakTime: 0,
        throat: 0,
        search: ctx.rng.range(0, 1),
        seed: ctx.rng.next() * 100,
      });
    }
  }

  /** Poça cheia mais perto do jogador (e ainda não ocupada por outro sapo, se der). */
  private findPond(ctx: CritterContext, self: Frog): CritterPuddle | null {
    const w = ctx.world;
    let best: CritterPuddle | null = null;
    let bestScore = Infinity;
    for (const p of w.puddles) {
      if (p.fill < 0.32) continue;
      const d = Math.hypot(p.x - w.player.x, p.z - w.player.z);
      if (d > 36) continue;
      const taken = this.frogs.some((f) => f !== self && f.state !== 'hidden' && f.pond === p);
      const score = d + (taken ? 12 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private hopTo(frog: Frog, target: THREE.Vector3): void {
    frog.leap.from.copy(frog.position);
    frog.leap.to.copy(target);
    frog.leap.t = 0;
    const d = frog.leap.from.distanceTo(target);
    frog.leap.duration = 0.45 + d * 0.05;
    frog.leap.height = (0.5 + d * 0.22) * frog.scale;
    frog.yaw = Math.atan2(target.x - frog.position.x, target.z - frog.position.z);
    frog.state = frog.state === 'leave' ? 'leave' : 'hop';
  }

  /** Pula pela margem, para um ângulo `delta` longe do atual. */
  private hopAlongShore(frog: Frog, delta: number): boolean {
    const pond = frog.pond;
    if (!pond) return false;
    const current = Math.atan2(frog.position.z - pond.z, frog.position.x - pond.x);
    if (!shorePoint(pond, current + delta, frog.scale, vTmp)) return false;
    this.hopTo(frog, vTmp);
    return true;
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    for (const frog of this.frogs) {
      if (frog.state === 'hidden') {
        this.hide(frog);
        frog.search -= dt;
        if (frog.search > 0) continue;
        frog.search = 0.6;
        const pond = this.findPond(ctx, frog);
        if (!pond) continue;
        // Aparece fora da vista, na margem, olhando para a água.
        for (let i = 0; i < 12; i++) {
          const angle = ctx.rng.next() * Math.PI * 2;
          if (!shorePoint(pond, angle, frog.scale, frog.position)) continue;
          if (!ctx.isGroundFree(frog.position.x, frog.position.z)) continue;
          if (i < 9 && inView(ctx, frog.position.x, frog.position.z, 30)) continue;
          frog.pond = pond;
          frog.state = 'sit';
          frog.yaw = Math.atan2(pond.x - frog.position.x, pond.z - frog.position.z);
          frog.up.copy(UP);
          break;
        }
        if (frog.state === 'hidden') continue;
      }

      let legs = 0;
      let pitch = 0;
      if (frog.state === 'sit') {
        const pond = frog.pond;
        const danger = threatAt(ctx, frog.position.x, frog.position.y, frog.position.z, vAway) - 0.8 * frog.scale;
        if (!pond || pond.fill < 0.2) {
          // A poça secou: vai embora pulando.
          frog.state = 'leave';
          this.hopTo(frog, vTmp.copy(frog.position).addScaledVector(vAway.set(Math.sin(frog.yaw + Math.PI), 0, Math.cos(frog.yaw + Math.PI)), 4.5));
        } else if (danger < 1.6) {
          // Susto: pulo grande pela margem, para longe do perigo.
          const side = vAway.x * -(frog.position.z - pond.z) + vAway.z * (frog.position.x - pond.x) > 0 ? 1 : -1;
          if (!this.hopAlongShore(frog, side * ctx.rng.range(0.9, 1.5))) this.hopTo(frog, vTmp.copy(frog.position).addScaledVector(vAway, 4));
        } else {
          frog.wander -= dt;
          if (frog.wander <= 0) {
            frog.wander = ctx.rng.range(8, 18);
            this.hopAlongShore(frog, ctx.rng.range(-0.5, 0.5));
          }
        }
        // Coaxar: três infladas do papo, depois silêncio.
        frog.croak -= dt;
        if (frog.croak <= 0) {
          frog.croakTime = 1.4;
          frog.croak = ctx.rng.range(4, 9);
          ctx.sounds.call('croak', frog.position, frog.scale);
        }
        frog.up.lerp(terrainNormal(frog.position.x, frog.position.z, vUp).lerp(UP, 0.6).normalize(), 1 - Math.exp(-4 * dt));
      } else if (frog.state === 'hop' || frog.state === 'leave') {
        const leap = frog.leap;
        leap.t = Math.min(1, leap.t + dt / leap.duration);
        leapPosition(leap, frog.position);
        // Não afunda: na água, fica boiando na superfície.
        const pond = frog.pond;
        if (pond && pond.fill > 0.05 && Math.hypot(frog.position.x - pond.x, frog.position.z - pond.z) < pond.radius * 1.05) {
          frog.position.y = Math.max(frog.position.y, pond.level - 0.35 * frog.scale);
        }
        legs = leap.t < 0.65 ? Math.sin((leap.t / 0.65) * Math.PI) : 0;
        pitch = -0.45 * (1 - leap.t) + 0.25 * leap.t;
        if (leap.t >= 1) {
          if (frog.state === 'leave') {
            if (!inView(ctx, frog.position.x, frog.position.z) || frog.position.distanceTo(w.player) > 30) {
              frog.state = 'hidden';
              frog.pond = null;
              frog.search = ctx.rng.range(4, 10);
              this.hide(frog);
              continue;
            }
            this.hopTo(frog, vTmp.copy(frog.position).addScaledVector(vAway.set(Math.sin(frog.yaw), 0, Math.cos(frog.yaw)), 4));
          } else {
            frog.state = 'sit';
            if (frog.pond) frog.yaw = Math.atan2(frog.pond.x - frog.position.x, frog.pond.z - frog.position.z);
          }
        }
      }
      if (frog.croakTime > 0) {
        frog.croakTime -= dt;
        const k = 1 - frog.croakTime / 1.4;
        frog.throat = Math.max(0, Math.sin(k * Math.PI * 3)) * 0.9;
      } else {
        frog.throat = damp(frog.throat, 0, 8, dt);
      }
      this.draw(frog, legs, pitch, ctx.time);
    }
    this.body.flush();
    this.throat.flush();
    this.legs.flush();
  }

  private draw(frog: Frog, legs: number, pitch: number, time: number): void {
    // Respiração: o corpo sobe e desce bem de leve.
    const breath = 1 + Math.sin((time + frog.seed) * 2.2) * 0.02;
    hopperRoot(mRoot, frog.position, frog.up, frog.yaw, pitch, frog.scale, 1, breath, 1);
    this.body.set(frog.slot, mRoot);
    const k = frog.throat;
    vTmp.set(0, 0.64 - k * 0.05, 0.98 + k * 0.04);
    this.throat.set(frog.slot, jointMatrix(mRoot, vTmp, 0, 0, 0, mOut, 1 + k * 0.5, 1 + k * 0.9, 1 + k * 0.6));
    this.legs.set(frog.slot, jointMatrix(mRoot, FROG_HIP, legs * 0.9, 0, 0, mOut, 1, 1, 1 + legs * 0.9));
  }

  private hide(frog: Frog): void {
    this.body.hide(frog.slot);
    this.throat.hide(frog.slot);
    this.legs.hide(frog.slot);
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    for (const frog of this.frogs) {
      if (frog.state !== 'sit' || frog.position.distanceTo(position) > radius + 3) continue;
      if (!this.hopAlongShore(frog, (ctx.rng.next() < 0.5 ? -1 : 1) * ctx.rng.range(0.8, 1.4))) {
        vAway.copy(frog.position).sub(position).setY(0).normalize();
        this.hopTo(frog, vTmp.copy(frog.position).addScaledVector(vAway, 4));
      }
    }
  }
}
