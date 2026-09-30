import * as THREE from 'three';
import { FIXED_DT, type Physics } from '../core/Physics';
import { DungBall } from '../entities/DungBall';
import { GRAB_REACH, type Beetle } from '../entities/Beetle';
import { RoundLedger } from '../progression/food';
import { TEAM_PUSH_SECONDS, type AchievementId } from '../progression/achievements';
import { PoseBuffer, ballOps } from './snapshotBuffer';
import { MAX_SNAPSHOT_BALLS, SNAPSHOT_HZ, type BallPose, type GoneReason, type NetEvent, type NetRules, type PlayerSnapshot } from './protocol';
import {
  ABANDON_SECONDS,
  ASSIST_STALE_SECONDS,
  CO_PUSH_SPEED_BONUS,
  GIFT_RESPROUT_SECONDS,
  MAX_HELPERS,
  MAX_OWNED_BALLS,
  MERGE_HOLD_SECONDS,
  MERGE_REACH,
  PULL_HOLD_SECONDS,
  PULL_KEEP_SLACK,
  RESPROUT_SECONDS,
  SPROUT_IMMUNE_SECONDS,
  SWALLOW_RATIO,
  addShares,
  isLoose,
  judgeClaim,
  judgeMerge,
  judgePull,
  judgeSwallow,
  mergeDirection,
  newBallId,
  pullBlock,
  relation,
  canHelp,
  canTakeFrom,
  settleShares,
  shareFractions,
  takeShares,
  type BallFacts,
  type Shares,
} from './rules';

/**
 * As bolas da sala: cada uma tem um número, um dono (quem simula ela) e o que
 * tem dentro. As suas rodam na física daqui; as dos outros são fantasmas que
 * seguem a rede. Quando uma bola muda de dono (roubo), é a MESMA bola que
 * troca de papel (`DungBall.setProxy`): a tralha grudada e o tamanho continuam.
 *
 * Também é aqui que o dono da sala confere os pedidos de pegar, engolir,
 * fundir e puxar (`judge`) e que todo mundo aplica as decisões dele.
 */

/**
 * Acontecimentos da bagunça que viram aviso na tela (e som). Puxar: `pulled`
 * = você puxou a bola de alguém; `pulledMine` = alguém puxou a sua.
 */
export type Happening = 'took' | 'taken' | 'swallowed' | 'eaten' | 'gave' | 'got' | 'joined' | 'crumbled' | 'pulled' | 'pulledMine';

/** Segurando o botão de fundir (doar / juntar as suas) ou o de puxar (a bola do rival pra sua). */
export type MergeMode = 'give' | 'pull';

/** O que dá pra fazer com a bola encostada na sua agora, e o que você está segurando. */
export interface MergeView {
  /** Bola com que dá pra fundir a sua (doar pra outro, juntar uma sua largada), ou null. */
  give: BallRecord | null;
  /** Bola de rival que dá pra puxar pra sua, ou null. */
  pull: BallRecord | null;
  /** Segurando agora (null = nada) e o quanto já foi (0..1). */
  holding: MergeMode | null;
  progress: number;
}

/** Como uma bola entra noutra: engolida (rolou por cima), doada (fundir) ou puxada (roubo). */
type AbsorbKind = 'swallow' | 'gift' | 'pull';

/** O que as bolas precisam do jogo. */
export interface BallGame {
  readonly scene: THREE.Scene;
  readonly physics: Physics;
  readonly beetle: Beetle;
  /** A bola principal agora (a que você está fazendo: câmera, HUD, toca). */
  readonly ball: DungBall;
  /** Bola nova sua, fora de jogo (vai nascer como broto), já com os sons e efeitos do jogo. */
  createBall(): DungBall;
  /** Essa bola sua passa a ser a principal; os pedidos passam a contar o conteúdo dela. */
  setMainBall(ball: DungBall, ledger: RoundLedger): void;
  /** Onde nasce um broto (do lado do besouro, fora da boca da toca). */
  sproutSpot(out: THREE.Vector3): THREE.Vector3;
  /** Um broto seu nasceu (brilho e som). */
  sprouted(ball: DungBall): void;
  /** Brilhinho de broto imune (a cada tanto, em cima da bola). */
  shimmer(at: THREE.Vector3, radius: number): void;
  /** Aviso na tela (e som) do que aconteceu com as bolas. */
  happened(kind: Happening, nick: string, at: THREE.Vector3 | null): void;
  /** Uma bola esfarelou (poeira). */
  crumbled(at: THREE.Vector3, radius: number): void;
  achieve(id: AchievementId): void;
}

/** O que as bolas precisam da sala. */
export interface BallRoom {
  readonly selfId: string;
  readonly isHost: boolean;
  /** Relógio da sala. */
  now(): number;
  /** As regras que valem agora (na Disputa o roubo é sempre ligado). */
  rules(): NetRules;
  /** Times (uid → time); vazio = cada um por si. */
  teams(): ReadonlyMap<string, number>;
  send(event: NetEvent): void;
  /** Pedido ao dono da sala (sendo o dono, decide na hora). */
  request(event: NetEvent): void;
  nick(uid: string): string;
  /** Pés do besouro de alguém no retrato mais novo (o dono da sala confere distância). */
  beetleAt(uid: string, out: THREE.Vector3): THREE.Vector3 | null;
}

/** Uma bola da sala, sua ou de outro. */
export interface BallRecord {
  readonly id: number;
  readonly ball: DungBall;
  /** Quem simula (uid). */
  owner: string;
  /** Dono anterior (um "sumiu" atrasado dele ainda vale, ver `applyGone`). */
  prevOwner: string | null;
  /** Sua (física daqui) ou fantasma. */
  local: boolean;
  /** O que tem dentro (a sua: a de verdade; a dos outros: o espelho do último aviso do dono). */
  readonly ledger: RoundLedger;
  /** Parte de cada jogador (volume): quem doou bola pra ela leva a parte no enterro. */
  shares: Shares;
  /** Fantasma: poses que chegaram da rede. */
  buffer: PoseBuffer<BallPose> | null;
  /** O fantasma já apareceu (antes da primeira pose fica escondido). */
  placed: boolean;
  /** Relógio da sala da última vez que o dono empurrou. */
  lastPushAt: number;
  /** Solta à força até aqui (o dono levou trombada). */
  looseUntil: number;
  /** Sua: quando o broto saiu do chão (imune por um tempo). */
  bornAt: number;
  /** Fantasma: quando apareceu pra este aparelho (o dono da sala limita a imunidade por aqui). */
  firstSeen: number;
  /** Fantasma: bandeiras do retrato mais novo. */
  immune: boolean;
  burying: boolean;
  gift: boolean;
  /** Fantasma: o dono está puxando alguma bola com ela (quem estiver encostado vê o aviso). */
  pull: boolean;
  /** Sua: ajudas no empurrão (quem, quanto, quando chegou). */
  readonly assists: Map<string, { ax: number; az: number; at: number }>;
  /** Sua: último conteúdo mandado (reenvia quando muda). */
  sentVersion: number;
  sentCounts: number;
  lastInfoAt: number;
  /** Sua e largada (não é a principal): desde quando ninguém mexe. */
  idleSince: number;
  /** Próxima tentativa de engolir esta (ela é o alvo). */
  retryAt: number;
}

const INTERVAL = 1 / SNAPSHOT_HZ;
/** Conteúdo da bola: no máximo um aviso a cada tanto (engolir 10 coisas seguidas manda um só). */
const INFO_SECONDS = 0.5;
/** Pedir pra pegar a bola que você está empurrando junto (ela ficou solta): de quanto em quanto. */
const CLAIM_RETRY = 0.8;
/** Engolida/fusão: a bola some encolhendo pra dentro da outra. */
const GULP_SECONDS = 0.35;
/** Número de bola que saiu do jogo fica ignorado por isso (retrato atrasado não ressuscita). */
const TOMBSTONE_SECONDS = 15;
/** Brilhinho do broto imune: de quanto em quanto tempo. */
const SHIMMER_SECONDS = 0.7;

const PARK = new THREE.Vector3(0, -80, 0);
const tmpPos = new THREE.Vector3();
const tmpPos2 = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

interface Gulp {
  ball: DungBall;
  into: DungBall | null;
  t: number;
  from: THREE.Vector3;
  scale: number;
}

export class BallSync {
  readonly records = new Map<number, BallRecord>();
  private readonly byBall = new Map<DungBall, BallRecord>();
  private readonly tombstones = new Map<number, number>();
  private readonly gulps: Gulp[] = [];
  private readonly poses: BallPose[] = [];
  /** Broto esperando pra nascer (perdeu a bola). */
  private sprout: { rec: BallRecord; at: number } | null = null;
  /** Segurando fundir/puxar: qual, em que bola (número) e há quanto tempo. */
  private holdKind: MergeMode | null = null;
  private holdTarget = 0;
  private holdTime = 0;
  /** Acabou de fundir/puxar: aquele botão só vale de novo depois de soltar (não emenda uma na outra). */
  private holdSpent: MergeMode | null = null;
  private readonly mergeView: MergeView = { give: null, pull: null, holding: null, progress: 0 };
  private teamPush = 0;
  private claimAt = 0;
  private shimmerTimer = 0;

  constructor(
    private readonly game: BallGame,
    private readonly room: BallRoom,
  ) {}

  // --- Leitura ----------------------------------------------------------------------------

  recordOf(ball: DungBall): BallRecord | undefined {
    return this.byBall.get(ball);
  }

  /** Número da sua bola principal (0 fora da sala). */
  get mainId(): number {
    return this.byBall.get(this.game.ball)?.id ?? 0;
  }

  /** Fantasma de uma bola (pra grudar nela o que ela pegou), ou null. */
  proxyBall(id: number): DungBall | null {
    const rec = this.records.get(id);
    return rec && !rec.local ? rec.ball : null;
  }

  /** Esperando o broto nascer (perdeu a bola): segundos que faltam, ou 0. */
  get sproutIn(): number {
    return this.sprout ? Math.max(0, this.sprout.at - this.room.now()) : 0;
  }

  /** Quantos estão ajudando a empurrar a sua bola principal agora. */
  get helpers(): number {
    const rec = this.byBall.get(this.game.ball);
    return rec ? Math.min(MAX_HELPERS, rec.assists.size) : 0;
  }

  /** Velocidade de empurrar: cada ajudante acelera a bola; ajudando alguém, você mira na mesma velocidade dele. */
  pushSpeedBoost(): number {
    if (this.game.beetle.assisting) return 1 + CO_PUSH_SPEED_BONUS;
    return 1 + CO_PUSH_SPEED_BONUS * this.helpers;
  }

  /** Dono da bola que o besouro está empurrando junto (null = não está ajudando ninguém). */
  assistingOwner(): string | null {
    const beetle = this.game.beetle;
    if (!beetle.assisting) return null;
    return this.byBall.get(beetle.currentBall)?.owner ?? null;
  }

  /** A sua parte (0..1) na bola principal e a de cada um (pro enterro dividir a comida). */
  burialShares(): { mine: number; all: Array<[string, number]> } {
    const rec = this.byBall.get(this.game.ball);
    if (!rec) return { mine: 1, all: [] };
    settleShares(rec.shares, this.room.selfId, rec.ball.totalVolume);
    const all = shareFractions(rec.shares);
    const mine = all.find(([uid]) => uid === this.room.selfId)?.[1] ?? (all.length === 0 ? 1 : 0);
    return { mine, all };
  }

  // --- Suas bolas ---------------------------------------------------------------------------

  /** Entrou na sala: a bola que você está fazendo ganha número e passa a valer pra sala. */
  start(ledger: RoundLedger): void {
    if (this.byBall.has(this.game.ball)) return;
    this.registerLocal(this.game.ball, ledger);
  }

  /** Bola sua nova na sala (número novo, conteúdo próprio). */
  registerLocal(ball: DungBall, ledger: RoundLedger): BallRecord {
    const now = this.room.now();
    ball.overflow = true;
    const rec: BallRecord = {
      id: newBallId(),
      ball,
      owner: this.room.selfId,
      prevOwner: null,
      local: true,
      ledger,
      shares: new Map(),
      buffer: null,
      placed: true,
      lastPushAt: now,
      looseUntil: 0,
      bornAt: now,
      firstSeen: now,
      immune: false,
      burying: false,
      gift: false,
      pull: false,
      assists: new Map(),
      sentVersion: -1,
      sentCounts: -1,
      lastInfoAt: -Infinity,
      idleSince: 0,
      retryAt: 0,
    };
    this.records.set(rec.id, rec);
    this.byBall.set(ball, rec);
    return rec;
  }

  /**
   * Enterrou a bola principal (ou a Disputa largou) e ela vai renascer pequena
   * (a mesma bola, zerada): pra sala ela é outra bola (número novo, conteúdo
   * novo). Devolve o conteúdo novo.
   */
  renewMain(why: GoneReason = 'buried'): RoundLedger {
    const ball = this.game.ball;
    const old = this.byBall.get(ball);
    if (old) {
      this.forget(old);
      this.tombstone(old.id);
      this.room.send({ t: 'gone', b: old.id, why });
    }
    return this.registerLocal(ball, new RoundLedger()).ledger;
  }

  /**
   * Largada da Disputa (e pódio): as suas bolas largadas esfarelam, o broto que
   * ia nascer não nasce mais (a bola principal recomeça do zero, ver `renewMain`)
   * e ninguém fica segurando "fundir"/"puxar" ou ajudando alguém.
   */
  clearForMatch(): void {
    this.sprout = null;
    this.releaseHold();
    this.teamPush = 0;
    const main = this.game.ball;
    for (const rec of [...this.records.values()]) if (rec.local && rec.ball !== main) this.crumble(rec, false);
    this.game.beetle.attachBall(main);
  }

  /** A sala acabou: some com os fantasmas e as suas bolas largadas; a principal fica (volta pro solo). */
  stop(): void {
    const main = this.game.ball;
    // Esperando broto: ele nasce agora (o solo não fica sem bola).
    if (this.sprout && this.sprout.rec.ball === main && main.isParked) main.unpark(this.game.sproutSpot(tmpPos));
    this.sprout = null;
    for (const rec of [...this.records.values()]) {
      if (rec.ball === main) {
        this.forget(rec);
        continue;
      }
      this.forget(rec);
      this.dispose(rec.ball);
    }
    main.overflow = false;
    // Ajudando alguém quando a sala acabou: volta pra sua bola.
    this.game.beetle.attachBall(main);
    // As que estavam sendo engolidas já saíram da física: só o desenho vai embora.
    for (const gulp of this.gulps) {
      gulp.ball.root.removeFromParent();
      gulp.ball.disposeMaterial();
    }
    this.gulps.length = 0;
    this.tombstones.clear();
    this.releaseHold();
    this.teamPush = 0;
  }

  /** Um jogador saiu: as bolas dele saem junto. */
  removeOwner(uid: string): void {
    for (const rec of [...this.records.values()]) {
      if (rec.local || rec.owner !== uid) continue;
      this.forget(rec);
      this.tombstone(rec.id);
      this.releaseIfHeld(rec.ball);
      this.dispose(rec.ball);
    }
  }

  /** Alguém chegou: o conteúdo das suas bolas vai de novo (ele precisa pra roubar/fundir certo). */
  resendInfo(): void {
    for (const rec of this.records.values()) if (rec.local) rec.sentVersion = -1;
  }

  // --- Retratos -------------------------------------------------------------------------------

  /** As suas bolas no retrato (a principal primeiro). A lista e as poses são reaproveitadas. */
  writeBalls(out: BallPose[]): BallPose[] {
    out.length = 0;
    const main = this.byBall.get(this.game.ball);
    if (main) this.writeOne(main, out);
    for (const rec of this.records.values()) if (rec.local && rec !== main) this.writeOne(rec, out);
    return out;
  }

  private writeOne(rec: BallRecord, out: BallPose[]): void {
    const ball = rec.ball;
    if (ball.isParked || out.length >= MAX_SNAPSHOT_BALLS) return;
    const pose = (this.poses[out.length] ??= ballOps.create());
    const p = ball.position(tmpPos);
    const q = ball.rotation(tmpQuat);
    const v = ball.velocity(tmpVel);
    pose.id = rec.id;
    pose.x = p.x;
    pose.y = p.y;
    pose.z = p.z;
    pose.qx = q.x;
    pose.qy = q.y;
    pose.qz = q.z;
    pose.qw = q.w;
    pose.vx = v.x;
    pose.vy = v.y;
    pose.vz = v.z;
    pose.radius = ball.radius;
    pose.burying = ball.isBurying;
    pose.pushed = this.pushedByMe(rec);
    pose.immune = this.room.now() - rec.bornAt < SPROUT_IMMUNE_SECONDS;
    pose.gift = this.isGifting(rec);
    pose.pull = this.isPulling(rec);
    pose.glow = ball.excessLevel;
    out.push(pose);
  }

  /** Ajuda no empurrão que vai no retrato (qual bola e quanto). */
  assistOf(beetle: Beetle): { ball: number; ax: number; az: number } {
    if (!beetle.assisting) return { ball: 0, ax: 0, az: 0 };
    const rec = this.byBall.get(beetle.currentBall);
    return rec ? { ball: rec.id, ax: beetle.assist.x, az: beetle.assist.z } : { ball: 0, ax: 0, az: 0 };
  }

  /** Chegou o retrato de `owner`: as bolas dele (fantasmas) e a ajuda dele numa bola (se for sua, a força vale aqui). */
  receive(owner: string, snapshot: PlayerSnapshot, arrival: number): void {
    for (const pose of snapshot.balls) {
      if (this.tombstones.has(pose.id)) continue;
      let rec = this.records.get(pose.id);
      if (!rec) rec = this.createProxy(pose.id, owner);
      // Retrato atrasado do dono antigo (a bola já mudou de mão): não vale.
      if (rec.local || rec.owner !== owner) continue;
      const buffer = rec.buffer!;
      const newest = !buffer.latest || snapshot.time > buffer.latest.time;
      buffer.push(snapshot.time, pose, arrival, INTERVAL);
      if (!newest) continue;
      if (pose.pushed) rec.lastPushAt = Math.max(rec.lastPushAt, snapshot.time);
      rec.immune = pose.immune;
      rec.burying = pose.burying;
      rec.gift = pose.gift;
      rec.pull = pose.pull;
    }
    const assist = snapshot.assist;
    if (assist.ball !== 0) {
      const rec = this.records.get(assist.ball);
      // Rival na Disputa não "ajuda" (seria cabo de guerra com a sua bola).
      if (rec?.local && canHelp(relation(this.room.selfId, owner, this.room.teams()), this.room.rules())) {
        // Força de mentira (cliente modificado) não passa do que um besouro faz.
        const k = Math.min(1, 40 / Math.max(1e-6, Math.hypot(assist.ax, assist.az)));
        rec.assists.set(owner, { ax: assist.ax * k, az: assist.az * k, at: arrival });
      }
    }
  }

  // --- Passo fixo -------------------------------------------------------------------------------

  /** Antes da física: fantasmas na pose (no passado, interpolada), força dos ajudantes nas suas, fantasma engolível sem colisão. */
  beforePhysics(now: number): void {
    const main = this.game.ball;
    const swallowing = main.isSolid && !main.proxy && this.room.rules().steal;
    const mainRec = this.byBall.get(main);
    const mainImmune = !mainRec || now - mainRec.bornAt < SPROUT_IMMUNE_SECONDS;
    const mainPos = main.position(tmpPos2);
    for (const rec of this.records.values()) {
      const ball = rec.ball;
      if (rec.local) {
        this.applyAssists(rec, now);
        continue;
      }
      const buffer = rec.buffer!;
      const pose = buffer.sample(now - buffer.delay(INTERVAL));
      if (pose) {
        tmpPos.set(pose.x, pose.y, pose.z);
        if (!rec.placed) {
          // Primeira pose: aparece lá (o corpo cinemático não "varre" o jardim desde o nascimento).
          ball.teleport(tmpPos);
          ball.root.visible = true;
          rec.placed = true;
        } else if (buffer.jumped) {
          // Teletransporte (largada, broto novo): aparece lá, sem varrer o caminho.
          ball.teleport(tmpPos);
        }
        ball.drive(tmpPos, tmpQuat.set(pose.qx, pose.qy, pose.qz, pose.qw), tmpVel.set(pose.vx, pose.vy, pose.vz), pose.radius, pose.burying, pose.glow);
      }
      // Uma engole a outra (a sua a dele, ou a dele a sua): perto, as duas se atravessam, pra uma rolar
      // por cima da outra (o dono da sala confirma). Sem isso a grande só empurraria a pequena pra longe.
      let ghost = false;
      if (swallowing && rec.placed && !rec.burying && relation(this.room.selfId, rec.owner, this.room.teams()) === 'rival') {
        const r = ball.radius;
        const eats = r <= main.radius * SWALLOW_RATIO && !rec.immune && !rec.gift;
        const eaten = main.radius <= r * SWALLOW_RATIO && !mainImmune;
        if (eats || eaten) ghost = ball.position(tmpPos).distanceTo(mainPos) < main.radius + r + 1.2;
      }
      ball.setGhost(ghost);
    }
  }

  /** Força de quem está ajudando a empurrar uma bola sua (cada um no máximo por um instante sem renovar). */
  private applyAssists(rec: BallRecord, now: number): void {
    if (rec.assists.size === 0) return;
    let ax = 0;
    let az = 0;
    for (const [uid, a] of rec.assists) {
      if (now - a.at > ASSIST_STALE_SECONDS) {
        rec.assists.delete(uid);
        continue;
      }
      ax += a.ax;
      az += a.az;
    }
    const ball = rec.ball;
    if (!ball.isSolid || (ax === 0 && az === 0)) return;
    const m = ball.mass * FIXED_DT;
    ball.body.applyImpulse({ x: ax * m, y: 0, z: az * m }, true);
  }

  /** Depois da física: tamanho dos fantasmas, suas bolas largadas, broto, pegar a bola solta que você empurra, engolir. */
  afterPhysics(now: number): void {
    const main = this.game.ball;
    const beetle = this.game.beetle;
    for (const rec of this.records.values()) {
      if (!rec.local) {
        if (rec.placed) rec.ball.fixedUpdate(FIXED_DT);
      } else if (rec.ball !== main) rec.ball.fixedUpdate(FIXED_DT);
    }
    const mainRec = this.byBall.get(main);
    if (mainRec) {
      mainRec.idleSince = 0;
      if (this.pushedByMe(mainRec)) mainRec.lastPushAt = now;
    }
    this.updateSprout(now);
    this.updateSpares(now);
    this.updateAssist(now, beetle);
    this.detectSwallow(now);
    this.sendInfos(now);
    for (const [id, until] of this.tombstones) if (now > until) this.tombstones.delete(id);
  }

  /** Quadro: desenho dos fantasmas e das suas bolas largadas, bolas sendo engolidas, brilho dos brotos. */
  render(alpha: number, dt: number): void {
    const main = this.game.ball;
    for (const rec of this.records.values()) {
      if (rec.ball === main || (!rec.local && !rec.placed)) continue;
      rec.ball.render(alpha, dt);
    }
    this.updateGulps(dt);
    this.shimmerTimer -= dt;
    if (this.shimmerTimer <= 0) {
      this.shimmerTimer = SHIMMER_SECONDS;
      const now = this.room.now();
      for (const rec of this.records.values()) {
        const immune = rec.local ? !rec.ball.isParked && now - rec.bornAt < SPROUT_IMMUNE_SECONDS : rec.placed && rec.immune;
        if (immune) this.game.shimmer(rec.ball.root.position, rec.ball.radius);
      }
    }
  }

  // --- Pegar, fundir -----------------------------------------------------------------------------

  /**
   * Apertou pra agarrar: qual bola (a mais perto do lado do besouro): a sua
   * principal, uma sua largada, ou a de outro (empurrar junto / pegar se estiver solta).
   */
  pickGrabTarget(): DungBall | null {
    const beetle = this.game.beetle;
    const now = this.room.now();
    const rules = this.room.rules();
    let best: DungBall | null = null;
    let bestGap = GRAB_REACH;
    for (const rec of this.records.values()) {
      if (!rec.local && !rec.placed) continue;
      // Bola de rival na Disputa: só agarra se der pra pegar (solta); empurrar junto com rival, não.
      if (!rec.local) {
        const rel = relation(this.room.selfId, rec.owner, this.room.teams());
        if (!canHelp(rel, rules) && !(canTakeFrom(rel, rules) && isLoose(rec, now) && !rec.immune && !rec.burying)) continue;
      }
      const gap = beetle.grabGap(rec.ball);
      // A principal ganha no empate (é a de sempre).
      if (gap < bestGap || (gap === bestGap && rec.ball === this.game.ball)) {
        bestGap = gap;
        best = rec.ball;
      }
    }
    return best;
  }

  /**
   * Bola de outro jogador solta aqui perto (ninguém empurra, e as regras
   * deixam pegar): a dica "bola solta, pega!". `reach` = folga da superfície.
   */
  looseNearby(reach: number): BallRecord | null {
    const beetle = this.game.beetle;
    const now = this.room.now();
    const rules = this.room.rules();
    for (const rec of this.records.values()) {
      if (rec.local || !rec.placed || rec.burying || rec.immune) continue;
      if (!canTakeFrom(relation(this.room.selfId, rec.owner, this.room.teams()), rules) || !isLoose(rec, now)) continue;
      if (beetle.grabGap(rec.ball) < reach) return rec;
    }
    return null;
  }

  /** Agarrou uma bola sua largada: ela vira a principal (a de antes fica largada no lugar). */
  promote(ball: DungBall): void {
    const rec = this.byBall.get(ball);
    if (!rec?.local || ball === this.game.ball) return;
    rec.idleSince = 0;
    this.game.setMainBall(ball, rec.ledger);
  }

  /** A bola com que dá pra fundir a sua principal agora (encostando): uma sua largada ou a de outro jogador. */
  mergeTarget(): BallRecord | null {
    const main = this.game.ball;
    if (!main.isSolid || !this.byBall.has(main)) return null;
    const c = main.position(tmpPos2);
    const rules = this.room.rules();
    let best: BallRecord | null = null;
    let bestGap = MERGE_REACH;
    for (const rec of this.records.values()) {
      if (rec.ball === main || !rec.ball.isSolid || (!rec.local && (!rec.placed || rec.burying))) continue;
      if (!rec.local && !canHelp(relation(this.room.selfId, rec.owner, this.room.teams()), rules)) continue;
      const gap = rec.ball.position(tmpPos).distanceTo(c) - main.radius - rec.ball.radius;
      if (gap < bestGap) {
        bestGap = gap;
        best = rec;
      }
    }
    return best;
  }

  /**
   * A bola de rival que dá pra puxar pra dentro da sua agora (encostando, e as
   * regras deixam: ver `pullBlock`). A que você já está puxando pode se afastar
   * um pouquinho sem cair (`PULL_KEEP_SLACK`: o quique da física não zera a puxada).
   */
  pullTarget(): BallRecord | null {
    const main = this.game.ball;
    const mainRec = this.byBall.get(main);
    if (!mainRec || !main.isSolid) return null;
    const now = this.room.now();
    const rules = this.room.rules();
    const teams = this.room.teams();
    const mine = this.facts(mainRec, now);
    const c = main.position(tmpPos2);
    let best: BallRecord | null = null;
    let bestGap = Infinity;
    for (const rec of this.records.values()) {
      if (rec.local || !rec.placed || !rec.ball.isSolid) continue;
      const reach = MERGE_REACH + (this.holdKind === 'pull' && this.holdTarget === rec.id ? PULL_KEEP_SLACK : 0);
      const gap = rec.ball.position(tmpPos).distanceTo(c) - main.radius - rec.ball.radius;
      if (gap >= reach || gap >= bestGap) continue;
      if (pullBlock(mine, this.facts(rec, now), this.room.selfId, now, rules, teams) !== 'ok') continue;
      best = rec;
      bestGap = gap;
    }
    return best;
  }

  /**
   * Um rival está puxando a sua bola agora (a bola dele, com a bandeira de
   * puxar, encostada na sua, e as regras deixam)? Devolve a bola dele pro
   * aviso "fulano está puxando a sua bola!", ou null.
   */
  pulledBy(): BallRecord | null {
    const main = this.game.ball;
    const mainRec = this.byBall.get(main);
    if (!mainRec || !main.isSolid) return null;
    const now = this.room.now();
    const rules = this.room.rules();
    const teams = this.room.teams();
    const mine = this.facts(mainRec, now);
    const c = main.position(tmpPos2);
    for (const rec of this.records.values()) {
      if (rec.local || !rec.placed || !rec.pull) continue;
      const gap = rec.ball.position(tmpPos).distanceTo(c) - main.radius - rec.ball.radius;
      // Um pouco mais de folga que o de quem puxa: o aviso não pisca com o atraso da rede.
      if (gap > MERGE_REACH + PULL_KEEP_SLACK + 0.4) continue;
      if (pullBlock(this.facts(rec, now), mine, rec.owner, now, rules, teams) === 'ok') return rec;
    }
    return null;
  }

  /**
   * Segurando fundir (`give`) ou puxar (`pull`): depois do tempo de cada um
   * encostado na MESMA bola, funde (a sua entra na outra) ou puxa (a do rival
   * entra na sua). Trocou de bola ou desencostou: recomeça do zero. Os dois
   * botões juntos: puxar ganha (quem aperta os dois quer levar, não dar).
   */
  updateMerge(give: boolean, pull: boolean, dt: number): MergeView {
    const view = this.mergeView;
    view.give = this.mergeTarget();
    view.pull = this.pullTarget();
    // Soltou o botão do que acabou de fazer: ele volta a valer.
    if (this.holdSpent && !(this.holdSpent === 'give' ? give : pull)) this.holdSpent = null;
    const kind: MergeMode | null =
      this.holdKind === 'pull' && pull ? 'pull' : this.holdKind === 'give' && give ? 'give' : pull && view.pull ? 'pull' : give && view.give ? 'give' : null;
    const target = kind === 'pull' ? view.pull : kind === 'give' ? view.give : null;
    if (!kind || !target || kind === this.holdSpent) {
      this.holdKind = null;
      this.holdTime = 0;
      view.holding = null;
      view.progress = 0;
      return view;
    }
    if (this.holdKind !== kind || this.holdTarget !== target.id) {
      this.holdKind = kind;
      this.holdTarget = target.id;
      this.holdTime = 0;
    }
    this.holdTime += dt;
    const need = kind === 'pull' ? PULL_HOLD_SECONDS : MERGE_HOLD_SECONDS;
    view.holding = kind;
    view.progress = Math.min(1, this.holdTime / need);
    if (this.holdTime < need) return view;
    this.holdSpent = kind;
    this.holdKind = null;
    this.holdTime = 0;
    const main = this.byBall.get(this.game.ball)!;
    if (kind === 'pull') this.room.request({ t: 'pull', b: main.id, target: target.id });
    else if (target.local) this.mergeOwn(target, main);
    else this.room.request({ t: 'merge', b: main.id, target: target.id });
    return view;
  }

  /** Ninguém segurando fundir/puxar (a sala acabou, largada da Disputa). */
  private releaseHold(): void {
    this.holdKind = null;
    this.holdTarget = 0;
    this.holdTime = 0;
    this.holdSpent = null;
  }

  /** Juntou duas bolas suas (a largada entra na principal): sem dono da sala, é tudo seu. */
  private mergeOwn(spare: BallRecord, main: BallRecord): void {
    this.absorbContent(main, spare, 'gift');
    this.forget(spare);
    this.tombstone(spare.id);
    this.room.send({ t: 'gone', b: spare.id, why: 'merged' });
    this.retire(spare.ball, main.ball);
    this.game.happened('joined', '', main.ball.root.position);
  }

  // --- Pedidos ao dono da sala -------------------------------------------------------------------

  /**
   * Dono da sala: confere um pedido de pegar/engolir/fundir. Devolve a decisão
   * (que ele anuncia e aplica), ou null se não vale.
   */
  judge(event: NetEvent, from: string): NetEvent | null {
    const now = this.room.now();
    const rules = this.room.rules();
    switch (event.t) {
      case 'claim': {
        const rec = this.records.get(event.b);
        if (!rec || this.tombstones.has(event.b)) return null;
        const at = this.room.beetleAt(from, tmpPos2);
        const gap = at ? this.centerOf(rec, tmpPos).distanceTo(at) - this.facts(rec, now).radius : Infinity;
        if (judgeClaim(this.facts(rec, now), from, now, rules, gap, this.room.teams()) !== 'ok') return null;
        const why = rec.looseUntil > now ? 'tackle' : 'grab';
        return { t: 'own', b: rec.id, to: from, prev: rec.owner, why };
      }
      case 'swallow': {
        const ball = this.records.get(event.b);
        const prey = this.records.get(event.target);
        if (!ball || !prey || this.tombstones.has(event.b) || this.tombstones.has(event.target)) return null;
        const distance = this.centerOf(ball, tmpPos).distanceTo(this.centerOf(prey, tmpPos2));
        if (judgeSwallow(this.facts(ball, now), this.facts(prey, now), from, rules, distance, this.room.teams()) !== 'ok') return null;
        return { t: 'swallowed', b: prey.id, into: ball.id, by: from };
      }
      case 'merge': {
        const ball = this.records.get(event.b);
        const target = this.records.get(event.target);
        if (!ball || !target || this.tombstones.has(event.b) || this.tombstones.has(event.target)) return null;
        const distance = this.centerOf(ball, tmpPos).distanceTo(this.centerOf(target, tmpPos2));
        const teams = this.room.teams();
        if (judgeMerge(this.facts(ball, now), this.facts(target, now), from, distance, teams, rules) !== 'ok') return null;
        // Com parceiro, a menor entra na maior (o raio é o mais novo que chegou).
        const [prey, into] = mergeDirection({ rec: ball, owner: ball.owner, radius: this.facts(ball, now).radius }, { rec: target, owner: target.owner, radius: this.facts(target, now).radius }, from, teams);
        return { t: 'merged', b: prey.rec.id, into: into.rec.id, by: from };
      }
      case 'pull': {
        const ball = this.records.get(event.b);
        const target = this.records.get(event.target);
        if (!ball || !target || this.tombstones.has(event.b) || this.tombstones.has(event.target)) return null;
        const distance = this.centerOf(ball, tmpPos).distanceTo(this.centerOf(target, tmpPos2));
        if (judgePull(this.facts(ball, now), this.facts(target, now), from, now, rules, distance, this.room.teams()) !== 'ok') return null;
        return { t: 'pulled', b: target.id, into: ball.id, by: from };
      }
      default:
        return null;
    }
  }

  /** O que o dono da sala sabe da bola agora (a pose mais nova que chegou, não a desenhada). */
  private facts(rec: BallRecord, now: number): BallFacts {
    if (rec.local) {
      return {
        owner: rec.owner,
        radius: rec.ball.radius,
        burying: rec.ball.isBurying,
        immune: rec.ball.isParked || now - rec.bornAt < SPROUT_IMMUNE_SECONDS,
        lastPushAt: rec.lastPushAt,
        looseUntil: rec.looseUntil,
        gift: this.isGifting(rec),
      };
    }
    const latest = rec.buffer?.latest?.pose;
    return {
      owner: rec.owner,
      radius: latest?.radius ?? rec.ball.radius,
      burying: latest?.burying ?? rec.burying,
      // Imune só no começo da vida da bola (a bandeira sozinha não segura pra sempre).
      immune: (latest?.immune ?? rec.immune) && now - rec.firstSeen < SPROUT_IMMUNE_SECONDS + 1,
      lastPushAt: rec.lastPushAt,
      looseUntil: rec.looseUntil,
      gift: latest?.gift ?? rec.gift,
    };
  }

  private centerOf(rec: BallRecord, out: THREE.Vector3): THREE.Vector3 {
    const latest = !rec.local ? rec.buffer?.latest?.pose : null;
    return latest ? out.set(latest.x, latest.y, latest.z) : rec.ball.position(out);
  }

  // --- Decisões e avisos que chegam ---------------------------------------------------------------

  /** Eventos das bolas (decisões do dono da sala e avisos dos donos das bolas). */
  onEvent(event: NetEvent, from: string): void {
    switch (event.t) {
      case 'own':
        this.applyOwn(event.b, event.to, event.prev);
        return;
      case 'swallowed':
        this.applyAbsorb(event.b, event.into, event.by, 'swallow');
        return;
      case 'merged':
        this.applyAbsorb(event.b, event.into, event.by, 'gift');
        return;
      case 'pulled':
        this.applyAbsorb(event.b, event.into, event.by, 'pull');
        return;
      case 'gone':
        this.applyGone(event.b, event.why, from);
        return;
      case 'ball':
        this.applyInfo(event, from);
        return;
      default:
        return;
    }
  }

  /** Trombada decidida: a bola de quem levou fica solta por um tempo (pra todo mundo). */
  markLoose(id: number): void {
    const rec = this.records.get(id);
    if (rec) rec.looseUntil = this.room.now() + 2.5;
  }

  private applyOwn(id: number, to: string, prev: string): void {
    const rec = this.records.get(id);
    if (!rec || this.tombstones.has(id)) return;
    const self = this.room.selfId;
    rec.lastPushAt = this.room.now();
    rec.looseUntil = 0;
    if (to === self && !rec.local) this.gain(rec, prev);
    else if (rec.local && to !== self) this.lose(rec, to);
    else if (!rec.local) {
      rec.prevOwner = rec.owner;
      rec.owner = to;
    }
  }

  /** A bola de outro virou sua: continua da pose mais nova, a tralha e o conteúdo vêm junto. */
  private gain(rec: BallRecord, prev: string): void {
    const now = this.room.now();
    const latest = rec.buffer?.latest;
    const ball = rec.ball;
    if (latest) {
      const p = latest.pose;
      const ahead = Math.max(0, Math.min(0.25, now - latest.time));
      tmpPos.set(p.x + p.vx * ahead, p.y, p.z + p.vz * ahead);
      ball.snapTo(tmpPos, tmpQuat.set(p.qx, p.qy, p.qz, p.qw));
    }
    ball.setProxy(false);
    ball.overflow = true;
    rec.local = true;
    rec.prevOwner = prev;
    rec.owner = this.room.selfId;
    rec.buffer = null;
    rec.assists.clear();
    rec.bornAt = -Infinity;
    rec.sentVersion = -1;
    rec.idleSince = 0;
    // De rival, é roubo: a bola inteira passa a ser sua. De parceiro de time, cada um continua com a sua parte.
    if (relation(this.room.selfId, prev, this.room.teams()) === 'rival') takeShares(rec.shares, this.room.selfId, ball.totalVolume);
    else settleShares(rec.shares, prev, ball.totalVolume);
    this.game.setMainBall(ball, rec.ledger);
    this.game.happened('took', this.room.nick(prev), ball.position(tmpPos));
    if (relation(this.room.selfId, prev, this.room.teams()) === 'rival') this.game.achieve('mpSteal');
  }

  /** A sua bola foi pra outro: vira fantasma dele. Era a principal? Broto novo daqui a pouco. */
  private lose(rec: BallRecord, to: string): void {
    // Já afundando na toca: o enterro ganha (o "sumiu" no fim acerta os outros).
    if (rec.ball.isBurying) return;
    const now = this.room.now();
    const ball = rec.ball;
    rec.local = false;
    rec.prevOwner = rec.owner;
    rec.owner = to;
    rec.buffer = new PoseBuffer(ballOps);
    rec.placed = true;
    rec.firstSeen = now;
    rec.assists.clear();
    ball.overflow = false;
    ball.setProxy(true);
    if (ball === this.game.ball) this.loseMain(RESPROUT_SECONDS);
    this.releaseIfHeld(ball);
    this.game.happened('taken', this.room.nick(to), ball.position(tmpPos));
  }

  /** Engolida (`swallow`), doada (`gift`) ou puxada (`pull`): `preyId` entra em `intoId`. */
  private applyAbsorb(preyId: number, intoId: number, by: string, kind: AbsorbKind): void {
    const prey = this.records.get(preyId);
    const into = this.records.get(intoId);
    if (!prey || this.tombstones.has(preyId)) return;
    const self = this.room.selfId;
    const preyOwner = prey.owner;
    if (into?.local) this.absorbContent(into, prey, kind);
    this.forget(prey);
    this.tombstone(preyId);
    const wasMain = prey.local && prey.ball === this.game.ball;
    if (wasMain) this.loseMain(kind === 'gift' ? GIFT_RESPROUT_SECONDS : RESPROUT_SECONDS);
    this.releaseIfHeld(prey.ball);
    this.retire(prey.ball, into?.ball ?? null);
    const at = into?.ball.root.position ?? null;
    if (kind === 'swallow') {
      if (by === self) {
        this.game.happened('swallowed', this.room.nick(preyOwner), at);
        this.game.achieve('mpSwallow');
      } else if (preyOwner === self) this.game.happened('eaten', this.room.nick(by), at);
    } else if (kind === 'pull') {
      // Puxar é roubo: vale a mesma conquista de pegar a bola de alguém.
      if (by === self) {
        this.game.happened('pulled', this.room.nick(preyOwner), at);
        this.game.achieve('mpSteal');
      } else if (preyOwner === self) this.game.happened('pulledMine', this.room.nick(by), at);
    } else if (preyOwner === self) {
      // A sua bola entrou na de outro (você doou, ou o parceiro puxou a sua menor pra dele).
      this.game.happened('gave', into ? this.room.nick(into.owner) : '', at);
      this.game.achieve('mpGift');
    } else if (into?.owner === self) this.game.happened('got', this.room.nick(preyOwner), at);
  }

  /**
   * Soma a bola `prey` na sua bola `into`: volume (o que passar dos 30 cm vira
   * Sol excedente), contagens e conteúdo. Parte de cada um: engolida ou puxada
   * é toda sua; doada, quem doou continua com a parte dele.
   */
  private absorbContent(into: BallRecord, prey: BallRecord, kind: AbsorbKind): void {
    const self = this.room.selfId;
    const volume = prey.ball.totalVolume;
    settleShares(into.shares, self, into.ball.totalVolume);
    if (kind !== 'gift') into.shares.set(self, (into.shares.get(self) ?? 0) + volume);
    else {
      const donated = new Map(prey.shares);
      settleShares(donated, prey.owner, volume);
      addShares(into.shares, donated);
    }
    into.ball.addVolume(volume);
    into.ball.dungCount += prey.ball.dungCount;
    into.ball.itemCount += prey.ball.itemCount;
    into.ledger.mergeFrom(prey.ledger);
    into.sentVersion = -1;
  }

  private applyGone(id: number, why: string, from: string): void {
    const rec = this.records.get(id);
    this.tombstone(id);
    if (!rec) return;
    if (rec.local) {
      // Corrida rara: ela "virou minha" enquanto o dono antigo já enterrava. O enterro ganha.
      if (from !== rec.prevOwner || why !== 'buried') return;
      if (rec.ball === this.game.ball) this.loseMain(RESPROUT_SECONDS);
    } else if (rec.owner !== from) return;
    this.forget(rec);
    this.releaseIfHeld(rec.ball);
    if (why === 'crumble') this.game.crumbled(rec.ball.root.position, rec.ball.radius);
    if (why === 'merged') this.retire(rec.ball, null);
    else this.dispose(rec.ball);
  }

  private applyInfo(event: Extract<NetEvent, { t: 'ball' }>, from: string): void {
    if (this.tombstones.has(event.b)) return;
    let rec = this.records.get(event.b);
    if (!rec) rec = this.createProxy(event.b, from);
    if (rec.local || rec.owner !== from) return;
    rec.ledger.loadWire({ c: event.c, h: event.h });
    rec.shares = new Map(event.k);
    rec.ball.dungCount = event.d;
    rec.ball.itemCount = event.i;
  }

  // --- Internos -------------------------------------------------------------------------------

  private createProxy(id: number, owner: string): BallRecord {
    const ball = new DungBall(this.game.physics, PARK, { proxy: true });
    ball.root.visible = false;
    this.game.scene.add(ball.root);
    const now = this.room.now();
    const rec: BallRecord = {
      id,
      ball,
      owner,
      prevOwner: null,
      local: false,
      ledger: new RoundLedger(),
      shares: new Map(),
      buffer: new PoseBuffer(ballOps),
      placed: false,
      lastPushAt: now,
      looseUntil: 0,
      bornAt: now,
      firstSeen: now,
      immune: false,
      burying: false,
      gift: false,
      pull: false,
      assists: new Map(),
      sentVersion: 0,
      sentCounts: 0,
      lastInfoAt: 0,
      idleSince: 0,
      retryAt: 0,
    };
    this.records.set(id, rec);
    this.byBall.set(ball, rec);
    return rec;
  }

  /** Principal perdida: um broto novo (fora de jogo até nascer) já vira a principal. */
  private loseMain(delay: number): void {
    const ball = this.game.createBall();
    const rec = this.registerLocal(ball, new RoundLedger());
    this.game.setMainBall(ball, rec.ledger);
    this.sprout = { rec, at: this.room.now() + delay };
  }

  /** Hora do broto: nasce do lado do besouro (se nesse meio tempo pegou outra bola, ele nem nasce). */
  private updateSprout(now: number): void {
    const sprout = this.sprout;
    if (!sprout || now < sprout.at) return;
    this.sprout = null;
    const { rec } = sprout;
    if (rec.ball !== this.game.ball) {
      this.forget(rec);
      this.dispose(rec.ball);
      return;
    }
    rec.ball.unpark(this.game.sproutSpot(tmpPos));
    rec.bornAt = now;
    rec.lastPushAt = now;
    this.game.sprouted(rec.ball);
  }

  /** Suas bolas largadas: esfarelam depois de um tempo paradas (e se passar do limite, a mais velha vai antes). */
  private updateSpares(now: number): void {
    const main = this.game.ball;
    const spares: BallRecord[] = [];
    for (const rec of this.records.values()) {
      if (!rec.local || rec.ball === main || rec.ball.isParked) continue;
      if (rec.idleSince === 0) rec.idleSince = now;
      spares.push(rec);
    }
    spares.sort((a, b) => a.idleSince - b.idleSince);
    for (let i = 0; i < spares.length; i++) {
      const rec = spares[i];
      const tooMany = spares.length - i >= MAX_OWNED_BALLS;
      if (!tooMany && now - rec.idleSince < ABANDON_SECONDS) continue;
      this.crumble(rec);
    }
  }

  private crumble(rec: BallRecord, notify = true): void {
    this.forget(rec);
    this.tombstone(rec.id);
    this.room.send({ t: 'gone', b: rec.id, why: 'crumble' });
    this.game.crumbled(rec.ball.root.position, rec.ball.radius);
    if (notify) this.game.happened('crumbled', '', null);
    this.releaseIfHeld(rec.ball);
    this.dispose(rec.ball);
  }

  /**
   * Empurrando a bola de outro: se ela ficou solta (o dono largou), pede pra
   * pegar; se o dono também empurra, conta pro "empurrar junto".
   */
  private updateAssist(now: number, beetle: Beetle): void {
    const rec = beetle.assisting ? this.byBall.get(beetle.currentBall) : undefined;
    const mainRec = this.byBall.get(this.game.ball);
    const helped = !!mainRec && mainRec.assists.size > 0 && this.pushedByMe(mainRec);
    if (rec && !rec.local) {
      const ownerPushing = now - rec.lastPushAt < 0.4;
      this.teamPush = ownerPushing ? this.teamPush + FIXED_DT : 0;
      const facts = this.facts(rec, now);
      if (now >= this.claimAt && isLoose(facts, now) && !facts.immune && !facts.burying && canTakeFrom(relation(this.room.selfId, rec.owner, this.room.teams()), this.room.rules())) {
        this.claimAt = now + CLAIM_RETRY;
        this.room.request({ t: 'claim', b: rec.id });
      }
    } else this.teamPush = helped ? this.teamPush + FIXED_DT : 0;
    if (this.teamPush >= TEAM_PUSH_SECONDS) this.game.achieve('mpTeamPush');
  }

  /** A sua bola rolou por cima de uma bola rival pequena: pede pra engolir. */
  private detectSwallow(now: number): void {
    const main = this.game.ball;
    const mainRec = this.byBall.get(main);
    if (!mainRec || !main.isSolid || !this.room.rules().steal) return;
    const c = main.position(tmpPos2);
    for (const rec of this.records.values()) {
      if (rec.local || !rec.placed || rec.immune || rec.burying || rec.gift || now < rec.retryAt) continue;
      if (relation(this.room.selfId, rec.owner, this.room.teams()) !== 'rival' || rec.ball.radius > main.radius * SWALLOW_RATIO) continue;
      // "Rolou por cima": o centro da rival já está bem dentro da sua bola. Vale a pose mais nova
      // da rede (a mesma que o dono da sala confere): o desenho interpolado de uma bola que o dono
      // teleportou ("trazer a bola") passa por dentro das outras no caminho, e isso não é engolir.
      const latest = rec.buffer?.latest?.pose;
      const at = latest ? tmpPos.set(latest.x, latest.y, latest.z) : rec.ball.position(tmpPos);
      if (at.distanceTo(c) > main.radius + rec.ball.radius * 0.2) continue;
      rec.retryAt = now + 1;
      this.room.request({ t: 'swallow', b: mainRec.id, target: rec.id });
    }
  }

  /** Conteúdo das suas bolas que mudou vai pra sala (no máximo um aviso por bola a cada meio segundo). */
  private sendInfos(now: number): void {
    for (const rec of this.records.values()) {
      if (!rec.local || rec.ball.isParked || now - rec.lastInfoAt < INFO_SECONDS) continue;
      const counts = rec.ball.dungCount * 100000 + rec.ball.itemCount;
      if (rec.sentVersion === rec.ledger.version && rec.sentCounts === counts) continue;
      settleShares(rec.shares, this.room.selfId, rec.ball.totalVolume);
      const wire = rec.ledger.toWire();
      const k: Array<[string, number]> = [...rec.shares].map(([uid, v]) => [uid, Math.round(v * 1000) / 1000]);
      this.room.send({ t: 'ball', b: rec.id, c: wire.c, h: wire.h, k, d: rec.ball.dungCount, i: rec.ball.itemCount });
      rec.sentVersion = rec.ledger.version;
      rec.sentCounts = counts;
      rec.lastInfoAt = now;
    }
  }

  /** Você está doando essa bola (segurando "fundir" encostado noutra)? Enquanto isso, ninguém engole ela. */
  private isGifting(rec: BallRecord): boolean {
    return rec.ball === this.game.ball && this.holdKind === 'give' && this.holdTime > 0;
  }

  /** Você está puxando uma bola de rival com essa (segurando "puxar" encostado nela)? Vai no retrato: o rival vê o aviso. */
  private isPulling(rec: BallRecord): boolean {
    return rec.ball === this.game.ball && this.holdKind === 'pull' && this.holdTime > 0;
  }

  /** O besouro está empurrando (ou em cima de) essa bola sua? */
  private pushedByMe(rec: BallRecord): boolean {
    const beetle = this.game.beetle;
    return beetle.currentBall === rec.ball && (beetle.pushing || beetle.riding) && !rec.ball.proxy;
  }

  /** O besouro estava agarrado (ou em cima) dessa bola: solta e volta pra principal. */
  private releaseIfHeld(ball: DungBall): void {
    const beetle = this.game.beetle;
    if (beetle.currentBall === ball) beetle.attachBall(this.game.ball);
  }

  private forget(rec: BallRecord): void {
    this.records.delete(rec.id);
    this.byBall.delete(rec.ball);
  }

  private tombstone(id: number): void {
    this.tombstones.set(id, this.room.now() + TOMBSTONE_SECONDS);
  }

  /** A bola some encolhendo pra dentro de outra (ou no lugar), e depois sai do mundo. */
  private retire(ball: DungBall, into: DungBall | null): void {
    ball.leaveWorld(this.game.physics);
    this.gulps.push({ ball, into, t: 0, from: ball.root.position.clone(), scale: ball.root.scale.x });
  }

  private updateGulps(dt: number): void {
    for (let i = this.gulps.length - 1; i >= 0; i--) {
      const gulp = this.gulps[i];
      gulp.t = Math.min(1, gulp.t + dt / GULP_SECONDS);
      const e = gulp.t * gulp.t;
      const root = gulp.ball.root;
      if (gulp.into) root.position.lerpVectors(gulp.from, gulp.into.root.position, e);
      root.scale.setScalar(Math.max(0.001, gulp.scale * (1 - e)));
      if (gulp.t < 1) continue;
      this.gulps.splice(i, 1);
      root.removeFromParent();
      gulp.ball.disposeMaterial();
    }
  }

  private dispose(ball: DungBall): void {
    ball.leaveWorld(this.game.physics);
    ball.root.removeFromParent();
    ball.disposeMaterial();
  }
}

