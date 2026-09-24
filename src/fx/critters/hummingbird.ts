import * as THREE from 'three';
import { dampAngle } from '../../utils/math';
import { clay } from '../../render/clayMaterial';
import { terrainHeight } from '../../world/Terrain';
import { InstancedPart } from './InstancedPart';
import { HUMMINGBIRD_BILL_TIP, HUMMINGBIRD_SHOULDER, HUMMINGBIRD_SWEEP, HUMMINGBIRD_TAIL, hummingbirdBody, hummingbirdTail, hummingbirdWing, hummingbirdWingBlur } from './wingedModels';
import { farPoint, inView, spotAlive, threatAt } from './common';
import { jointMatrix, rootMatrix } from './flyers';
import type { CritterContext, Species } from './types';

/**
 * Beija-flor: visita rara em dia de sol. Chega de longe num voo rápido, para
 * no ar em 3 a 5 flores perto do besouro (o bico enfiado na flor por uns
 * segundos, as asas em borrão) e vai embora. Enorme para um besouro de 2 cm —
 * é aí que está a graça.
 */

/** Tamanho (o modelo tem ~2,8 unidades; aqui ele fica com ~3,6 = uns 7 cm). */
const SCALE = 1.3;
/** Flor boa para beija-flor: cabeça alta o bastante para o rabo não raspar no chão. */
const MIN_FLOWER_HEIGHT = 1.6;
/** Aviso "beija-flor à vista" quando ele aparece a menos disso do besouro. */
const SEEN_DISTANCE = 14;

type BirdState = 'away' | 'fly' | 'hover';

const mRoot = new THREE.Matrix4();
const mOut = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vAway = new THREE.Vector3();
const vShoulder = new THREE.Vector3();
/** Passo da sequência de fases da asa (razão áurea): cada quadro cai longe do anterior. */
const GOLDEN = 0.6180339887;
/** Inclinação das asas para cima, a partir do ombro (rad). */
const WING_DIHEDRAL = 0.3;
const ease = (t: number) => t * t * (3 - 2 * t);

export class Hummingbird implements Species {
  private readonly body: InstancedPart;
  private readonly tail: InstancedPart;
  /** Uma lâmina por lado, cada quadro numa fase da batida. */
  private readonly wings: InstancedPart;
  /** O leque borrado que a asa varre (um por lado). */
  private readonly blur: InstancedPart;
  /** Fase da lâmina no quadro (0..1). */
  private flutter = 0;
  private state: BirdState = 'away';
  private readonly position = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private flightT = 0;
  private flightTime = 1;
  private arc = 0;
  /** Flores da visita (referências vivas dos pontos de pouso) e em qual está. */
  private readonly route: THREE.Vector3[] = [];
  private stop = 0;
  private yaw = 0;
  /** Para onde olha pairando na flor (fixo durante a parada). */
  private flowerYaw = 0;
  private timer = 0;
  private chirp = 0;
  /** Segundos até o próximo sorteio de visita. */
  private nextVisit: number;
  private seen = false;

  constructor(ctx: CritterContext, parent: THREE.Group) {
    // Penas furta-cor: o verde das costas muda de tom com o ângulo (o peito branco fica perolado).
    const plumage = clay(0xffffff, { vertexColors: true, roughness: 0.42, sheen: 0.6, iridescence: 0.9, bump: 0, mottle: 0.05, mottleScale: 9, side: THREE.DoubleSide });
    const wing = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    // A transparência do borrão vem da vertex color (RGBA).
    const blur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.body = new InstancedPart(hummingbirdBody(), plumage, 1, { name: 'hummingbird-body' });
    this.tail = new InstancedPart(hummingbirdTail(), plumage, 1, { name: 'hummingbird-tail' });
    this.wings = new InstancedPart(hummingbirdWing(), wing, 2, { name: 'hummingbird-wings', castShadow: false, skipAO: true });
    this.blur = new InstancedPart(hummingbirdWingBlur(), blur, 2, { name: 'hummingbird-wing-blur', castShadow: false, skipAO: true });
    parent.add(this.body.mesh, this.tail.mesh, this.blur.mesh, this.wings.mesh);
    this.body.allocate();
    this.tail.allocate();
    for (let i = 0; i < 2; i++) {
      this.wings.allocate();
      this.blur.allocate();
    }
    this.nextVisit = ctx.rng.range(90, 200);
  }

  /** Chega um beija-flor agora. Devolve false se não há flor boa perto do besouro (ou se já tem um aqui). */
  visit(ctx: CritterContext): boolean {
    if (this.state !== 'away') return false;
    const player = ctx.world.player;
    const candidates = ctx.spots.filter((s) => Math.hypot(s.x - player.x, s.z - player.z) < 14 && s.y - terrainHeight(s.x, s.z) > MIN_FLOWER_HEIGHT);
    if (candidates.length < 2) return false;
    this.route.length = 0;
    const stops = Math.min(candidates.length, 3 + Math.floor(ctx.rng.next() * 3));
    // Primeira flor sorteada; as outras, sempre a mais perto da anterior (rota de beija-flor).
    let current = ctx.rng.pick(candidates);
    while (this.route.length < stops) {
      this.route.push(current);
      candidates.splice(candidates.indexOf(current), 1);
      let best: THREE.Vector3 | null = null;
      let bestD = Infinity;
      for (const c of candidates) {
        const d = c.distanceTo(current) + ctx.rng.next() * 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) break;
      current = best;
    }
    farPoint(ctx, 42, 8, this.position);
    this.stop = 0;
    this.seen = false;
    this.chirp = 1;
    this.flyTo(this.route[0], 11);
    return true;
  }

  /** Voo em arco até pairar com o bico na flor `flower` (ou até `flower` mesmo, se for embora). */
  private flyTo(flower: THREE.Vector3 | null, speed: number, away?: THREE.Vector3): void {
    this.from.copy(this.position);
    if (flower) {
      this.flowerYaw = Math.atan2(flower.x - this.position.x, flower.z - this.position.z);
      this.hoverPoint(flower, this.to);
    } else if (away) {
      this.to.copy(away);
    }
    const dist = this.from.distanceTo(this.to);
    this.flightT = 0;
    this.flightTime = 0.35 + dist / speed;
    this.arc = Math.min(1.2, dist * 0.12);
    this.state = 'fly';
  }

  /** Onde o corpo fica para a ponta do bico encostar na flor (olhando para `flowerYaw`). */
  private hoverPoint(flower: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.flowerYaw);
    const c = Math.cos(this.flowerYaw);
    const reach = (HUMMINGBIRD_BILL_TIP.z + 0.06) * SCALE;
    return target.set(flower.x - s * reach, flower.y - HUMMINGBIRD_BILL_TIP.y * SCALE + 0.05, flower.z - c * reach);
  }

  update(dt: number, ctx: CritterContext): void {
    const w = ctx.world;
    if (this.state === 'away') {
      this.hide();
      this.nextVisit -= dt;
      if (this.nextVisit <= 0) {
        this.nextVisit = ctx.rng.range(180, 360);
        if (w.rain < 0.03 && !ctx.menu && ctx.rng.next() < 0.45) this.visit(ctx);
      }
      this.flush();
      return;
    }
    // Começou a chover: vai embora na hora.
    if (w.rain > 0.1 && this.stop < this.route.length) this.leave(ctx);
    const t = ctx.time;
    let pitch = 0;
    if (this.state === 'fly') {
      this.flightT = Math.min(1, this.flightT + dt / this.flightTime);
      const k = this.flightT;
      this.position.lerpVectors(this.from, this.to, ease(k));
      this.position.y += Math.sin(Math.PI * k) * this.arc;
      const travel = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
      const leaving = this.stop >= this.route.length;
      // Chegando: vira para a flor; no caminho, olha para onde vai e deita o corpo para a frente.
      this.yaw = dampAngle(this.yaw, !leaving && k > 0.7 ? this.flowerYaw : travel, 7, dt);
      pitch = 0.55 * Math.sin(Math.PI * k) * Math.min(1, this.from.distanceTo(this.to) / 3);
      if (k >= 1) {
        if (leaving) {
          this.state = 'away';
          this.hide();
          this.flush();
          return;
        }
        this.state = 'hover';
        this.timer = ctx.rng.range(2, 3);
      }
    } else {
      const flower = this.route[this.stop];
      this.timer -= dt;
      this.yaw = dampAngle(this.yaw, this.flowerYaw, 8, dt);
      // Pairando: o corpo balança um tiquinho, o bico entra e sai da flor.
      this.hoverPoint(flower, this.position);
      const dip = Math.max(0, Math.sin(t * 1.6)) * 0.08;
      this.position.x += Math.sin(t * 2.7) * 0.03 - Math.sin(this.flowerYaw) * dip;
      this.position.y += Math.sin(t * 3.9) * 0.04;
      this.position.z -= Math.cos(this.flowerYaw) * dip;
      const danger = threatAt(ctx, this.position.x, this.position.y - 1.2, this.position.z, vAway);
      if (this.timer <= 0 || !spotAlive(ctx, flower) || danger < 1.5) this.next(ctx);
    }
    // Piadinhas agudas de vez em quando.
    this.chirp -= dt;
    if (this.chirp <= 0) {
      this.chirp = ctx.rng.range(1.2, 3.5);
      ctx.sounds.call('hummingbirdChirp', this.position, 1);
    }
    ctx.sounds.hum('hummingbird', this.position);
    if (!this.seen && this.position.distanceTo(w.player) < SEEN_DISTANCE && inView(ctx, this.position.x, this.position.z)) {
      this.seen = true;
      ctx.emit({ type: 'hummingbirdSeen' });
    }
    this.draw(t, pitch);
    this.flush();
  }

  /** Próxima flor da rota (pulando as que foram arrancadas) ou embora. */
  private next(ctx: CritterContext): void {
    do this.stop++;
    while (this.stop < this.route.length && !spotAlive(ctx, this.route[this.stop]));
    if (this.stop < this.route.length) this.flyTo(this.route[this.stop], 7);
    else this.leave(ctx);
  }

  private leave(ctx: CritterContext): void {
    this.stop = this.route.length;
    this.flyTo(null, 12, farPoint(ctx, 60, 12, vTmp));
  }

  private draw(t: number, pitch: number): void {
    rootMatrix(mRoot, this.position, this.yaw, pitch, Math.sin(t * 1.9) * 0.04, SCALE);
    this.body.set(0, mRoot);
    // O rabo abana e abre o leque o tempo todo (é o leme de quem para no ar); no voo, fecha.
    const hovering = this.state === 'hover' ? 1 : 0.35;
    const pump = (Math.sin(t * 5.3) * 0.14 + Math.sin(t * 13.7) * 0.05) * hovering;
    const fan = 1 + (0.15 + 0.12 * Math.sin(t * 3.1)) * hovering;
    this.tail.set(0, jointMatrix(mRoot, HUMMINGBIRD_TAIL, pump, 0, 0, mOut, fan, 1, 1));
    // Batida em "8" quase na horizontal, ~50 por segundo: rápida demais para qualquer taxa
    // de quadros. O que o olho vê é o borrão; a lâmina aparece cada quadro numa fase da
    // batida, sem o "efeito roda de carroça" de amostrar a fase pelo relógio.
    this.flutter = (this.flutter + GOLDEN) % 1;
    const phase = this.flutter * Math.PI * 2;
    const [forward, back] = HUMMINGBIRD_SWEEP;
    const sweep = (forward + back) / 2 + ((back - forward) / 2) * Math.sin(phase);
    // A asa gira no próprio eixo: inclinada no meio da batida, em pé nas viradas (lá na
    // frente e lá atrás), e de cabeça para baixo na volta.
    const twist = phase + 0.5 * Math.cos(phase) - 0.35 * Math.sin(2 * phase);
    vShoulder.set(-HUMMINGBIRD_SHOULDER.x, HUMMINGBIRD_SHOULDER.y, HUMMINGBIRD_SHOULDER.z);
    // As pontas um pouco para cima (diedro): o leque não some quando visto de lado.
    this.blur.set(0, jointMatrix(mRoot, HUMMINGBIRD_SHOULDER, 0, 0, WING_DIHEDRAL, mOut));
    this.blur.set(1, jointMatrix(mRoot, vShoulder, 0, 0, -WING_DIHEDRAL, mOut, -1, 1, 1));
    this.wings.set(0, jointMatrix(mRoot, HUMMINGBIRD_SHOULDER, twist, sweep, WING_DIHEDRAL, mOut));
    this.wings.set(1, jointMatrix(mRoot, vShoulder, twist, -sweep, -WING_DIHEDRAL, mOut, -1, 1, 1));
  }

  private hide(): void {
    this.body.hide(0);
    this.tail.hide(0);
    for (let i = 0; i < 2; i++) {
      this.wings.hide(i);
      this.blur.hide(i);
    }
  }

  private flush(): void {
    this.body.flush();
    this.tail.flush();
    this.wings.flush();
    this.blur.flush();
  }

  startle(position: THREE.Vector3, radius: number, ctx: CritterContext): void {
    if (this.state === 'hover' && this.position.distanceTo(position) < radius + 3) this.next(ctx);
  }
}
