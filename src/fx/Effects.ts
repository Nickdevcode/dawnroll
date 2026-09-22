import * as THREE from 'three';
import { clay } from '../render/clayMaterial';
import { claySphere } from '../render/geometry';
import { createRng } from '../utils/math';
import { dirtAmount, terrainHeight } from '../world/Terrain';
import { leafGeometry } from '../world/scenery/shapes';
import type { StinkSource } from '../world/Collectibles';
import { SoftParticles } from './SoftParticles';
import { ChunkParticles } from './ChunkParticles';
import { BallTrail } from './BallTrail';
import { AmbientMotes } from './AmbientMotes';
import { Critters, type GroundFilter } from './critters/Critters';

/** O que os efeitos precisam saber do jogo a cada frame (tudo já interpolado). */
export interface EffectsFrame {
  time: number;
  camera: THREE.PerspectiveCamera;
  /** altura do buffer / (2·tan(fov/2)): converte tamanho de mundo em pixels. */
  pixelScale: number;
  player: THREE.Vector3;
  playerVelocity: THREE.Vector3;
  playerGrounded: boolean;
  pushing: boolean;
  strain: number;
  head: THREE.Vector3;
  ballPosition: THREE.Vector3;
  ballVelocity: THREE.Vector3;
  ballRadius: number;
  stink: StinkSource[];
}

export interface EffectsOptions {
  critters: number;
  motes: number;
  landingSpots: THREE.Vector3[];
  isGroundFree: GroundFilter;
}

const Dust = {
  dirt: new THREE.Color('#d8b287'),
  grass: new THREE.Color('#d7dfb4'),
  dung: new THREE.Color('#8a5a33'),
  stink: new THREE.Color('#a9bd6c'),
  sweat: new THREE.Color('#bfe6ff'),
  glint: new THREE.Color(2.6, 2.3, 1.6),
};
const DungChunks = ['#5b3820', '#6e4426', '#83542f', '#9a6a3c'].map((c) => new THREE.Color(c));
const DirtChunks = ['#b9844f', '#9f7045', '#c99a64'].map((c) => new THREE.Color(c));
const GrassChunks = ['#7cbf5b', '#9fd06b', '#5f9f48'].map((c) => new THREE.Color(c));
const ConfettiColors = ['#f4a73b', '#ff7aa2', '#7cc6ff', '#9be27a', '#ffe066', '#c59bff', '#ffffff'].map((c) => new THREE.Color(c));
const FallingLeafColors = ['#e9a23b', '#d9683f', '#c9a24f', '#9fbf5a', '#e8c35a'].map((c) => new THREE.Color(c));

const tmp = new THREE.Vector3();
const tmpColor = new THREE.Color();

/**
 * Central de efeitos: poeira, respingos, brilhos, confete, rastro, fedor, suor,
 * folhas caindo, pólen e bichinhos. O jogo só avisa o que aconteceu (`jump`,
 * `splat`, `sparkle`...) e chama `update` por frame; as emissões contínuas
 * (passos, bola rolando, fedor) são decididas aqui a partir do `EffectsFrame`.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly dust = new SoftParticles(1600);
  private readonly glow = new SoftParticles(420, true);
  private readonly chunks: ChunkParticles;
  private readonly drops: ChunkParticles;
  private readonly confetti: ChunkParticles;
  private readonly leaves: ChunkParticles;
  private readonly trail = new BallTrail();
  private readonly motes: AmbientMotes;
  private readonly critters: Critters;
  private readonly rng = createRng(909);

  // Acumuladores de emissão contínua (partículas "devidas" desde o último frame).
  private footAcc = 0;
  private rollAcc = 0;
  private crumbAcc = 0;
  private sweatAcc = 0;
  private leafTimer = 1.5;
  private stinkAcc = 0;
  private wasPushing = false;

  constructor(options: EffectsOptions) {
    this.group.name = 'effects';
    const lumpGeo = claySphere(1, 1, 0.22, 2, 3);
    this.chunks = new ChunkParticles(lumpGeo, clay(0xffffff, { roughness: 0.8, sheen: 0.4, bump: 0.3, wet: 0.4, mottle: 0.08, mottleScale: 6 }), 520);
    this.drops = new ChunkParticles(claySphere(1, 2, 0.02), clay(0xffffff, { roughness: 0.15, sheen: 0.2, clearcoat: 1, bump: 0, mottle: 0 }), 140, false);
    this.confetti = new ChunkParticles(
      new THREE.BoxGeometry(1, 0.1, 0.62),
      clay(0xffffff, { roughness: 0.55, sheen: 0.6, bump: 0.1, mottle: 0.04, mottleScale: 8 }),
      180,
    );
    const leafGeo = leafGeometry(1, 0.6, { fold: 0.25, curl: 0.15, widest: 0.42, segmentsL: 6, segmentsW: 2 });
    leafGeo.translate(0, 0, -0.5);
    this.leaves = new ChunkParticles(leafGeo, clay(0xffffff, { vertexColors: true, roughness: 0.7, sheen: 0.55, bump: 0.2, side: THREE.DoubleSide }), 48);
    this.motes = new AmbientMotes(options.motes);
    this.critters = new Critters(options.critters, options.landingSpots, options.isGroundFree);

    this.group.add(
      this.trail.mesh,
      this.chunks.mesh,
      this.drops.mesh,
      this.confetti.mesh,
      this.leaves.mesh,
      this.dust.points,
      this.glow.points,
      this.motes.points,
      this.critters.group,
    );
  }

  // --- eventos pontuais -------------------------------------------------------

  jump(feet: THREE.Vector3): void {
    this.puffRing(feet, 7, 0.35, 1.4, this.groundDust(feet));
  }

  land(feet: THREE.Vector3, strength: number): void {
    this.puffRing(feet, Math.round(8 + strength * 10), 0.4 + strength * 0.3, 1.8 + strength * 2, this.groundDust(feet));
    this.clods(feet, Math.round(strength * 6), 1.6);
  }

  /** Bosta absorvida pela bola: respingo marrom, gotas brilhando e anel de poeira. */
  splat(at: THREE.Vector3, size: number): void {
    const count = Math.round(12 + size * 16);
    for (let i = 0; i < count; i++) {
      const dir = tmp.set(this.rng.range(-1, 1), this.rng.range(0.3, 1.4), this.rng.range(-1, 1)).normalize();
      const speed = this.rng.range(2, 5) * (0.8 + size);
      this.chunks.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: dir.x * speed,
        vy: dir.y * speed,
        vz: dir.z * speed,
        color: this.rng.pick(DungChunks),
        size: this.rng.range(0.05, 0.13) * (1 + size),
        life: this.rng.range(1.6, 3.2),
        bounce: 0.15,
        spin: this.rng.range(4, 12),
      });
    }
    for (let i = 0; i < 6; i++) {
      this.drops.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: this.rng.range(-2, 2),
        vy: this.rng.range(2.5, 5),
        vz: this.rng.range(-2, 2),
        color: tmpColor.set('#6b4a2c'),
        size: this.rng.range(0.03, 0.06),
        life: this.rng.range(0.8, 1.4),
        bounce: 0,
      });
    }
    this.puffRing(at, 8, 0.4 + size * 0.4, 1.6, Dust.dung, 0.4);
  }

  /** Coisa grudou na bola: estrelinhas + estalinho de poeira clara. */
  sparkle(at: THREE.Vector3, color: THREE.Color): void {
    for (let i = 0; i < 10; i++) {
      const dir = tmp.set(this.rng.range(-1, 1), this.rng.range(-0.2, 1.2), this.rng.range(-1, 1)).normalize();
      const speed = this.rng.range(1.5, 3.5);
      this.glow.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: dir.x * speed,
        vy: dir.y * speed,
        vz: dir.z * speed,
        color: Dust.glint,
        size: this.rng.range(0.1, 0.2),
        life: this.rng.range(0.35, 0.6),
        grow: 0.3,
        drag: 5,
        alpha: 1,
      });
    }
    this.puffRing(at, 5, 0.25, 1.2, tmpColor.copy(color).lerp(Dust.grass, 0.5), 0.35);
  }

  /** Bola caiu/bateu forte no chão. */
  impact(ballPosition: THREE.Vector3, radius: number, strength: number): void {
    const feet = tmp.set(ballPosition.x, terrainHeight(ballPosition.x, ballPosition.z), ballPosition.z);
    const color = this.groundDust(feet).clone();
    this.puffRing(feet, Math.round(10 + strength * 14), 0.35 + radius * 0.4, 2 + strength * 3, color, 0.55, radius * 0.7);
    this.clods(feet, Math.round(strength * 10 * (0.6 + radius * 0.3)), 2.5);
  }

  /** Marco de tamanho: chuva de confete + brilho em volta da bola. */
  celebrate(ballPosition: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 90; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(2, 6);
      this.confetti.spawn({
        x: ballPosition.x + Math.cos(a) * radius * 0.5,
        y: ballPosition.y + radius + 0.4,
        z: ballPosition.z + Math.sin(a) * radius * 0.5,
        vx: Math.cos(a) * speed,
        vy: this.rng.range(5, 10),
        vz: Math.sin(a) * speed,
        color: this.rng.pick(ConfettiColors),
        size: this.rng.range(0.12, 0.22),
        life: this.rng.range(3.5, 5.5),
        flutter: true,
        spin: this.rng.range(5, 12),
      });
    }
    for (let i = 0; i < 24; i++) {
      const dir = tmp.set(this.rng.range(-1, 1), this.rng.range(0, 1), this.rng.range(-1, 1)).normalize();
      this.glow.spawn({
        x: ballPosition.x + dir.x * radius,
        y: ballPosition.y + dir.y * radius,
        z: ballPosition.z + dir.z * radius,
        vx: dir.x * 2,
        vy: dir.y * 2 + 1,
        vz: dir.z * 2,
        color: Dust.glint,
        size: this.rng.range(0.18, 0.32),
        life: this.rng.range(0.6, 1.1),
        grow: 0.4,
        drag: 3,
        alpha: 1,
      });
    }
  }

  // --- contínuo -----------------------------------------------------------------

  update(dt: number, f: EffectsFrame): void {
    this.emitFootsteps(dt, f);
    this.emitBallRolling(dt, f);
    this.emitStink(dt, f);
    this.emitSweat(dt, f);
    this.emitFallingLeaves(dt, f);

    this.dust.update(dt, f.pixelScale);
    this.glow.update(dt, f.pixelScale);
    this.chunks.update(dt);
    this.drops.update(dt);
    this.confetti.update(dt);
    this.leaves.update(dt);
    this.trail.update(dt);
    this.motes.update(f.time, f.camera.position, f.pixelScale);
    this.critters.update(dt, f.player, f.camera.position);
  }

  private emitFootsteps(dt: number, f: EffectsFrame): void {
    const speed = Math.hypot(f.playerVelocity.x, f.playerVelocity.z);
    // Empurrando, as patas da frente cavam o chão; andando, levanta pó a cada passo.
    const rate = !f.playerGrounded ? 0 : f.pushing ? 5 + f.strain * 8 : speed > 1.6 ? speed * 2.2 : 0;
    this.footAcc += rate * dt;
    if (f.pushing && !this.wasPushing) this.puffRing(f.player, 5, 0.3, 1.2, this.groundDust(f.player), 0.35);
    this.wasPushing = f.pushing;
    while (this.footAcc >= 1) {
      this.footAcc -= 1;
      const color = this.groundDust(f.player);
      const back = speed > 0.1 ? tmp.set(-f.playerVelocity.x / speed, 0, -f.playerVelocity.z / speed) : tmp.set(0, 0, 0);
      this.dust.spawn({
        x: f.player.x + back.x * 0.3 + this.rng.range(-0.25, 0.25),
        y: f.player.y + 0.08,
        z: f.player.z + back.z * 0.3 + this.rng.range(-0.25, 0.25),
        vx: back.x * 0.6 + this.rng.range(-0.3, 0.3),
        vy: this.rng.range(0.4, 0.9),
        vz: back.z * 0.6 + this.rng.range(-0.3, 0.3),
        color,
        size: this.rng.range(0.22, 0.4),
        life: this.rng.range(0.6, 1.1),
        grow: 2.3,
        drag: 3,
        alpha: color === Dust.dirt ? 0.45 : 0.22,
      });
    }
  }

  private emitBallRolling(dt: number, f: EffectsFrame): void {
    const p = f.ballPosition;
    const r = f.ballRadius;
    const ground = terrainHeight(p.x, p.z);
    const onGround = p.y - r - ground < 0.25;
    this.trail.track(p.x, p.z, r, onGround);
    const speed = Math.hypot(f.ballVelocity.x, f.ballVelocity.z);
    if (!onGround || speed < 0.6) return;

    const dirt = dirtAmount(p.x, p.z) > 0.4;
    const inv = 1 / speed;
    const bx = -f.ballVelocity.x * inv;
    const bz = -f.ballVelocity.z * inv;
    // Poeira sai de trás do ponto de contato, abrindo para os lados.
    this.rollAcc += speed * (dirt ? 3.2 : 1.4) * (0.7 + r * 0.5) * dt;
    while (this.rollAcc >= 1) {
      this.rollAcc -= 1;
      const side = this.rng.range(-1, 1) * r * 0.5;
      this.dust.spawn({
        x: p.x + bx * r * 0.35 - bz * side,
        y: ground + 0.1,
        z: p.z + bz * r * 0.35 + bx * side,
        vx: bx * speed * 0.35 + this.rng.range(-0.3, 0.3),
        vy: this.rng.range(0.4, 1),
        vz: bz * speed * 0.35 + this.rng.range(-0.3, 0.3),
        color: dirt ? Dust.dirt : Dust.grass,
        size: this.rng.range(0.3, 0.55) * (0.8 + r * 0.35),
        life: this.rng.range(0.7, 1.3),
        grow: 2.4,
        drag: 2.5,
        alpha: dirt ? 0.5 : 0.2,
      });
    }
    // Torrões / pedaços de capim levantados + migalhas da própria bola.
    this.crumbAcc += speed * (0.6 + r * 0.25) * dt;
    while (this.crumbAcc >= 1) {
      this.crumbAcc -= 1;
      const fromBall = this.rng.next() < 0.45;
      const palette = fromBall ? DungChunks : dirt ? DirtChunks : GrassChunks;
      const side = this.rng.range(-1, 1) * r * 0.4;
      this.chunks.spawn({
        x: p.x + bx * r * 0.3 - bz * side,
        y: fromBall ? p.y - r * 0.2 : ground + 0.08,
        z: p.z + bz * r * 0.3 + bx * side,
        vx: bx * speed * 0.4 + this.rng.range(-0.6, 0.6),
        vy: this.rng.range(1.5, 3.2),
        vz: bz * speed * 0.4 + this.rng.range(-0.6, 0.6),
        color: this.rng.pick(palette),
        size: this.rng.range(0.035, 0.08) * (1 + r * 0.25),
        life: this.rng.range(1, 2),
        bounce: 0.25,
      });
    }
  }

  private emitStink(dt: number, f: EffectsFrame): void {
    this.stinkAcc += dt * f.stink.length * 1.4;
    while (this.stinkAcc >= 1 && f.stink.length > 0) {
      this.stinkAcc -= 1;
      const s = this.rng.pick(f.stink);
      this.dust.spawn({
        x: s.x + this.rng.range(-0.15, 0.15) * s.size,
        y: s.y + s.size * 1.05,
        z: s.z + this.rng.range(-0.15, 0.15) * s.size,
        vy: this.rng.range(0.25, 0.5),
        color: Dust.stink,
        size: s.size * this.rng.range(0.5, 0.8),
        life: this.rng.range(2, 3),
        grow: 2.6,
        drag: 0.6,
        gravity: -0.12,
        alpha: 0.2,
        wobble: 0.45,
      });
    }
  }

  private emitSweat(dt: number, f: EffectsFrame): void {
    if (!f.pushing || f.strain < 0.65) return;
    this.sweatAcc += dt * (f.strain - 0.5) * 5;
    while (this.sweatAcc >= 1) {
      this.sweatAcc -= 1;
      const side = this.rng.next() < 0.5 ? -1 : 1;
      this.drops.spawn({
        x: f.head.x + this.rng.range(-0.1, 0.1),
        y: f.head.y + 0.2,
        z: f.head.z + this.rng.range(-0.1, 0.1),
        vx: side * this.rng.range(0.6, 1.2),
        vy: this.rng.range(1.8, 2.8),
        vz: this.rng.range(-0.5, 0.5),
        color: Dust.sweat,
        size: this.rng.range(0.035, 0.05),
        life: 0.9,
        bounce: 0,
      });
    }
  }

  private emitFallingLeaves(dt: number, f: EffectsFrame): void {
    this.leafTimer -= dt;
    if (this.leafTimer > 0) return;
    this.leafTimer = this.rng.range(1.2, 3.2);
    const a = this.rng.next() * Math.PI * 2;
    const d = this.rng.range(2, 12);
    const x = f.player.x + Math.cos(a) * d;
    const z = f.player.z + Math.sin(a) * d;
    this.leaves.spawn({
      x,
      y: terrainHeight(x, z) + this.rng.range(7, 11),
      z,
      vx: this.rng.range(-0.5, 0.5),
      vy: -0.5,
      vz: this.rng.range(-0.5, 0.5),
      color: this.rng.pick(FallingLeafColors),
      size: this.rng.range(0.4, 0.7),
      life: this.rng.range(14, 18),
      flutter: true,
      spin: this.rng.range(1.5, 3.5),
    });
  }

  // --- ajudantes ------------------------------------------------------------------

  /** Cor da poeira conforme o chão (terra levanta pó; grama, quase nada). */
  private groundDust(at: THREE.Vector3): THREE.Color {
    return dirtAmount(at.x, at.z) > 0.4 ? Dust.dirt : Dust.grass;
  }

  /** Anel de poeira abrindo rente ao chão. */
  private puffRing(center: THREE.Vector3, count: number, size: number, speed: number, color: THREE.Color, alpha = 0.45, radius = 0.2): void {
    const ground = terrainHeight(center.x, center.z);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng.range(-0.2, 0.2);
      const s = speed * this.rng.range(0.7, 1.2);
      this.dust.spawn({
        x: center.x + Math.cos(a) * radius,
        y: Math.max(center.y, ground) + 0.08,
        z: center.z + Math.sin(a) * radius,
        vx: Math.cos(a) * s,
        vy: this.rng.range(0.3, 0.9),
        vz: Math.sin(a) * s,
        color,
        size: size * this.rng.range(0.8, 1.2),
        life: this.rng.range(0.7, 1.2),
        grow: 2.2,
        drag: 3.5,
        alpha,
      });
    }
  }

  /** Torrões de terra/capim pulando do chão. */
  private clods(at: THREE.Vector3, count: number, speed: number): void {
    const dirt = dirtAmount(at.x, at.z) > 0.4;
    const ground = terrainHeight(at.x, at.z);
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const s = speed * this.rng.range(0.5, 1.2);
      this.chunks.spawn({
        x: at.x,
        y: ground + 0.1,
        z: at.z,
        vx: Math.cos(a) * s,
        vy: this.rng.range(2, 4),
        vz: Math.sin(a) * s,
        color: this.rng.pick(dirt ? DirtChunks : GrassChunks),
        size: this.rng.range(0.04, 0.08),
        life: this.rng.range(0.8, 1.6),
        bounce: 0.3,
      });
    }
  }
}
