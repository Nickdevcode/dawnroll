import * as THREE from 'three';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Physics } from '../core/Physics';
import { FIXED_DT } from '../core/Physics';
import type { Beetle } from '../entities/Beetle';
import { DungBall, disposeBall } from '../entities/DungBall';
import { RemoteBeetle } from '../entities/RemoteBeetle';
import type { Collectibles } from '../world/Collectibles';
import type { LooseObjects } from '../world/LooseObjects';
import type { Pickables } from '../world/Pickables';
import type { Scenery } from '../world/Scenery';
import type { Weather } from '../world/Weather';
import { NetSession, type CloseReason, type SessionStatus } from './NetSession';
import { SnapshotBuffer } from './snapshotBuffer';
import { SNAPSHOT_BYTES, SNAPSHOT_HZ, encodeSnapshot, type NetEvent, type NetLook, type NetMember, type NetWorld, type PlayerSnapshot } from './protocol';
import { createRoom, joinRoom, type RoomError, type RoomInfo } from '../online/Rooms';

/**
 * O online dentro do jogo: liga a sessão de rede (`NetSession`) ao jardim.
 *
 *  - Os outros jogadores viram besouros e bolas "fantasmas" (cinemáticos) que
 *    seguem os retratos da rede, desenhados um pouquinho no passado pra
 *    ficarem lisos (`SnapshotBuffer`).
 *  - O que a SUA bola pega vira evento pra sala; o que a bola dos outros pega
 *    some daqui e gruda na bola deles.
 *  - O dono da sala decide o mundo compartilhado: onde montinho e tralha
 *    renascem, o que rebrota (jardim livre), o clima.
 *
 * O seu besouro e a sua bola continuam 100% locais (a física do solo): não
 * existe atraso nenhum no controle.
 */

/** O que o online precisa do jogo (o jogo implementa; o online não mexe no resto). */
export interface OnlineBridge {
  readonly scene: THREE.Scene;
  readonly physics: Physics;
  readonly scenery: Scenery;
  readonly collectibles: Collectibles;
  readonly pickables: Pickables;
  readonly looseObjects: LooseObjects;
  readonly weather: Weather;
  readonly beetle: Beetle;
  readonly ball: DungBall;
  /** Apelido e visual pra se apresentar. */
  profile(): { nick: string; look: NetLook };
  /** Deixa o jardim na semente da sala (troca se for outro) e os montinhos no arranjo do online. */
  useGarden(seed: number): void;
  /** Compila o material de um modelo novo em segundo plano (sem engasgo ao aparecer). */
  compile(object: THREE.Object3D): Promise<void>;
  /** Avisos do online: alguém entrou/saiu (`text` = apelido) ou você virou o dono da sala. */
  notify(text: string, kind: 'join' | 'leave' | 'host'): void;
  remoteBurial(cm: number, nick: string): void;
  /** A sessão acabou (saiu, caiu): o jogo volta pro solo. */
  ended(reason: CloseReason): void;
}

/** Um jogador remoto na cena. */
interface Remote {
  member: NetMember;
  beetle: RemoteBeetle;
  ball: DungBall;
  buffer: SnapshotBuffer;
  placed: boolean;
}

export interface OnlinePlayer {
  uid: string;
  slot: number;
  nick: string;
  look: NetLook;
  isHost: boolean;
  isSelf: boolean;
}

/** Placa de apelido: onde desenhar cada um (atualizado a cada quadro). */
export interface NameplateSource {
  slot: number;
  nick: string;
  /** Um pouco acima da cabeça. */
  position: THREE.Vector3;
  isHost: boolean;
}

export type OnlineOutcome = { ok: true } | { ok: false; error: RoomError | 'connect' | 'signal' | 'account' };

/** Rebrota: o que foi arrancado volta sozinho depois disso (jardim livre). */
const REGROW_SECONDS = 240;
/** Clima: o dono manda o retrato a cada tanto. */
const WEATHER_SYNC_SECONDS = 2;
/** Mandar o retrato a cada N passos fixos (60 Hz / 3 = 20 Hz). */
const SNAPSHOT_EVERY = Math.round(1 / FIXED_DT / SNAPSHOT_HZ);
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;

const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const PARK = new THREE.Vector3(0, -80, 0);

export class OnlinePlay {
  private session: NetSession | null = null;
  private readonly remotes = new Map<string, Remote>();
  private readonly listeners = new Set<() => void>();
  private readonly regrowAt = new Map<number, number>();
  private readonly snapshotBuffer = new ArrayBuffer(SNAPSHOT_BYTES);
  private readonly snapshot: PlayerSnapshot = {
    slot: 0,
    time: 0,
    beetle: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0, pushBlend: 0, strain: 0, grounded: true, riding: false },
    ball: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, radius: 0.5, burying: false },
  };
  private stepCount = 0;
  private weatherTimer = 0;
  private _status: SessionStatus | 'off' = 'off';
  /** A sessão atual chegou a ficar online (fechar antes disso é "não deu pra entrar", não "a sala caiu"). */
  private everOnline = false;
  private lastLook = '';

  constructor(
    private readonly bridge: OnlineBridge,
    /** Conta aberta agora (o online exige conta). */
    private readonly player: () => { client: SupabaseClient; userId: string } | null,
  ) {}

  // --- Estado pra interface ------------------------------------------------------------

  get active(): boolean {
    return this.session !== null && this._status !== 'closed';
  }

  get status(): SessionStatus | 'off' {
    return this._status;
  }

  get isHost(): boolean {
    return this.session?.isHost ?? false;
  }

  get code(): string | null {
    return this.session?.code ?? null;
  }

  get ping(): number {
    return this.session?.ping ?? 0;
  }

  get players(): OnlinePlayer[] {
    const session = this.session;
    if (!session) return [];
    return session.memberList.map((m) => ({ uid: m.uid, slot: m.slot, nick: m.nick, look: m.look, isHost: m.uid === session.host, isSelf: m.uid === session.selfId }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Entrar e sair --------------------------------------------------------------------

  /** Cria uma sala (o jardim atual vira o da sala) e fica esperando os amigos. */
  async create(): Promise<OnlineOutcome> {
    const player = this.player();
    if (!player) return { ok: false, error: 'account' };
    if (this.session) await this.leave();
    const result = await createRoom(player.client).catch(() => null);
    if (!result) return { ok: false, error: 'offline' };
    if (!result.ok) return { ok: false, error: result.error };
    return this.open(player, result.room);
  }

  /** Entra numa sala pelo código. */
  async join(code: string): Promise<OnlineOutcome> {
    const player = this.player();
    if (!player) return { ok: false, error: 'account' };
    if (this.session) await this.leave();
    const result = await joinRoom(player.client, code).catch(() => null);
    if (!result) return { ok: false, error: 'offline' };
    if (!result.ok) return { ok: false, error: result.error };
    return this.open(player, result.room);
  }

  async leave(): Promise<void> {
    const session = this.session;
    if (!session) return;
    await session.leave();
  }

  private async open(player: { client: SupabaseClient; userId: string }, room: RoomInfo): Promise<OnlineOutcome> {
    this.everOnline = false;
    this.setStatus('connecting');
    try {
      this.session = await NetSession.open(player.client, player.userId, room, {
        profile: () => this.bridge.profile(),
        world: () => this.worldState(),
        onWelcome: (info) => this.welcome(info.members, info.world, info.isHost),
        onMemberJoin: (member) => this.memberJoined(member),
        onMemberLeave: (uid) => this.memberLeft(uid),
        onSnapshot: (snapshot) => this.receiveSnapshot(snapshot),
        onEvent: (event, from) => this.receiveEvent(event, from),
        onRoleChange: (isHost) => this.roleChanged(isHost),
        onStatus: (status, reason) => this.sessionStatus(status, reason),
      });
      this.lastLook = JSON.stringify(this.bridge.profile().look);
      return { ok: true };
    } catch (error) {
      this.session = null;
      this.teardown();
      this.setStatus('off');
      return { ok: false, error: error instanceof Error && error.message === 'signal' ? 'signal' : 'connect' };
    }
  }

  // --- Laço do jogo -------------------------------------------------------------------

  /** Passo fixo, antes da física: os fantasmas vão pra pose (no passado, interpolada). */
  beforePhysics(): void {
    const session = this.session;
    if (!session || this.remotes.size === 0) return;
    const now = session.clock.now();
    for (const remote of this.remotes.values()) {
      const sample = remote.buffer.sample(now - remote.buffer.delay(SNAPSHOT_INTERVAL));
      if (!sample) continue;
      const b = sample.ball;
      tmpPos.set(b.x, b.y, b.z);
      if (!remote.placed) {
        // Primeira pose: aparece lá (o corpo cinemático não "varre" o jardim desde o nascimento).
        remote.ball.teleport(tmpPos);
        remote.placed = true;
        remote.beetle.model.root.visible = true;
        remote.ball.root.visible = true;
      }
      tmpQuat.set(b.qx, b.qy, b.qz, b.qw);
      tmpVel.set(b.vx, b.vy, b.vz);
      remote.ball.drive(tmpPos, tmpQuat, tmpVel, b.radius, b.burying);
      remote.beetle.drive(sample.beetle, Math.hypot(b.vx, b.vz), b.radius);
    }
  }

  /** Passo fixo, depois da física: tamanho/colisor dos fantasmas e o meu retrato (20 por segundo). */
  afterPhysics(): void {
    const session = this.session;
    if (!session) return;
    for (const remote of this.remotes.values()) if (remote.placed) remote.ball.fixedUpdate(FIXED_DT);
    if (++this.stepCount % SNAPSHOT_EVERY !== 0 || session.status !== 'online') return;
    this.writeSnapshot(session);
    session.sendSnapshot(encodeSnapshot(this.snapshot, this.snapshotBuffer));
  }

  /** Quadro: desenho dos fantasmas e os relógios do dono (rebrota, clima). */
  render(alpha: number, dt: number): void {
    for (const remote of this.remotes.values()) {
      if (!remote.placed) continue;
      remote.ball.render(alpha, dt);
      remote.beetle.render(alpha, dt);
    }
    const session = this.session;
    if (!session?.isHost || session.status !== 'online') return;
    // Rebrota do que foi arrancado (jardim livre).
    const now = session.clock.now();
    for (const [id, at] of this.regrowAt) {
      if (now < at) continue;
      this.regrowAt.delete(id);
      this.bridge.pickables.regrow(id);
      session.sendEvent({ t: 'regrow', id });
    }
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = WEATHER_SYNC_SECONDS;
      session.sendEvent({ t: 'weather', w: this.bridge.weather.snapshot() });
    }
  }

  /** Onde vão as placas de apelido neste quadro. */
  nameplates(out: NameplateSource[]): NameplateSource[] {
    out.length = 0;
    const session = this.session;
    if (!session) return out;
    for (const remote of this.remotes.values()) {
      if (!remote.placed) continue;
      const p = remote.beetle.position;
      out.push({ slot: remote.member.slot, nick: remote.member.nick, position: new THREE.Vector3(p.x, p.y + 1.4, p.z), isHost: remote.member.uid === session.host });
    }
    return out;
  }

  // --- O que a minha bola fez (o jogo chama) --------------------------------------------

  localAbsorb(id: number): void {
    this.send({ t: 'absorb', id });
    this.scheduleRegrow(id);
  }

  localLoose(id: number): void {
    this.send({ t: 'loose', id });
  }

  localPile(index: number): void {
    this.send({ t: 'pile', i: index });
  }

  localDebris(index: number): void {
    this.send({ t: 'debris', i: index });
  }

  /** O dono fez um montinho renascer / repôs um detrito: manda a semente pra sala. */
  pileSpawned(index: number, seed: number, fresh: boolean): void {
    if (this.session?.isHost) this.send({ t: 'pileSpawn', i: index, seed, fresh });
  }

  debrisSpawned(index: number, seed: number): void {
    if (this.session?.isHost) this.send({ t: 'debrisSpawn', i: index, seed });
  }

  localBury(cm: number): void {
    this.send({ t: 'bury', cm: Math.round(cm * 10) / 10 });
  }

  localNewBall(): void {
    this.send({ t: 'newBall' });
  }

  /** O visual mudou (guarda-roupa): os outros veem a roupa nova. */
  lookChanged(): void {
    const look = this.bridge.profile().look;
    const key = JSON.stringify(look);
    if (key === this.lastLook) return;
    this.lastLook = key;
    this.send({ t: 'look', look });
  }

  /** Poder Cheiro de chuva: o clima é do dono. Sendo o dono, chama direto. */
  requestRain(long: boolean): void {
    if (this.session?.isHost) {
      this.bridge.weather.callRain(long);
      this.weatherTimer = 0;
    } else this.send({ t: 'rain', long });
  }

  /** Poder Faro: quem decide quais montinhos viram fresquinhos é o dono. */
  requestNose(count: number): void {
    if (this.session?.isHost) this.promote(count);
    else this.send({ t: 'nose' });
  }

  /** Raio no céu do dono: os outros piscam e trovejam junto. */
  thunder(distance: number): void {
    if (this.session?.isHost) this.send({ t: 'thunder', d: Math.max(0, Math.min(1, distance)) });
  }

  // --- Recebendo -------------------------------------------------------------------------

  private welcome(members: NetMember[], world: NetWorld | null, isHost: boolean): void {
    const session = this.session;
    const selfId = session?.selfId;
    this.applyAuthority(isHost);
    if (world) this.applyWorld(world);
    else this.bridge.useGarden(this.bridge.scenery.seed);
    const present = new Set(members.map((m) => m.uid));
    for (const uid of [...this.remotes.keys()]) if (!present.has(uid)) this.removeRemote(uid);
    for (const member of members) if (member.uid !== selfId) this.ensureRemote(member);
    this.changed();
  }

  private memberJoined(member: NetMember): void {
    if (member.uid === this.session?.selfId) return;
    this.ensureRemote(member);
    this.bridge.notify(member.nick, 'join');
    this.changed();
  }

  private memberLeft(uid: string): void {
    const remote = this.remotes.get(uid);
    if (remote) this.bridge.notify(remote.member.nick, 'leave');
    this.removeRemote(uid);
    this.changed();
  }

  private receiveSnapshot(snapshot: PlayerSnapshot): void {
    const session = this.session;
    if (!session) return;
    for (const remote of this.remotes.values()) {
      if (remote.member.slot !== snapshot.slot) continue;
      remote.buffer.push(snapshot, session.clock.now(), SNAPSHOT_INTERVAL);
      return;
    }
  }

  private receiveEvent(event: NetEvent, from: string): void {
    const b = this.bridge;
    const ballOf = (uid: string) => this.remotes.get(uid)?.ball ?? null;
    switch (event.t) {
      case 'absorb':
        b.pickables.absorbRemote(event.id, ballOf(from));
        this.scheduleRegrow(event.id);
        return;
      case 'loose':
        b.looseObjects.swallowRemote(event.id, ballOf(from));
        return;
      case 'pile':
        b.collectibles.takePileRemote(event.i, ballOf(from));
        return;
      case 'debris':
        b.collectibles.takeDebrisRemote(event.i, ballOf(from));
        return;
      case 'pileSpawn':
        b.collectibles.applyPileSpawn(event.i, event.seed, event.fresh);
        return;
      case 'debrisSpawn':
        b.collectibles.applyDebrisSpawn(event.i, event.seed);
        return;
      case 'promote':
        b.collectibles.applyPromote(event.i);
        return;
      case 'regrow':
        b.pickables.regrow(event.id);
        return;
      case 'weather':
        if (!this.session?.isHost) b.weather.applySync(event.w);
        return;
      case 'thunder':
        if (!this.session?.isHost) b.weather.remoteThunder(event.d);
        return;
      case 'garden':
        if (!this.session?.isHost) b.useGarden(event.seed);
        return;
      case 'rain':
        if (this.session?.isHost) this.requestRain(event.long);
        return;
      case 'nose':
        if (this.session?.isHost) this.promote(3);
        return;
      case 'bury': {
        const remote = this.remotes.get(from);
        if (remote) b.remoteBurial(event.cm, remote.member.nick);
        return;
      }
      case 'newBall': {
        const remote = this.remotes.get(from);
        if (remote) remote.ball.reset(remote.ball.position(tmpPos));
        return;
      }
      case 'look': {
        const remote = this.remotes.get(from);
        if (!remote) return;
        remote.member.look = event.look;
        remote.beetle.setLook(event.look);
        this.changed();
        return;
      }
      default:
        return;
    }
  }

  private roleChanged(isHost: boolean): void {
    this.applyAuthority(isHost);
    if (isHost) {
      this.bridge.collectibles.claimAuthority();
      // Assumiu a sala no meio: o que já estava arrancado rebrota a partir de agora.
      const now = this.session?.clock.now() ?? 0;
      for (const id of this.bridge.pickables.pickedIds()) if (!this.regrowAt.has(id)) this.regrowAt.set(id, now + REGROW_SECONDS);
      this.weatherTimer = 0;
      if (this._status === 'online' || this._status === 'reconnecting') this.bridge.notify('', 'host');
    }
    this.changed();
  }

  private sessionStatus(status: SessionStatus, reason?: CloseReason): void {
    if (status === 'online') this.everOnline = true;
    this.setStatus(status);
    if (status !== 'closed') return;
    this.session = null;
    this.teardown();
    // Nunca chegou a entrar: quem avisa é a placa (com o motivo), não o "a sala caiu".
    if (this.everOnline) this.bridge.ended(reason ?? 'lost');
    this.setStatus('off');
  }

  // --- Mundo -------------------------------------------------------------------------------

  /** Quem manda no que renasce: o dono (local) ou a sala (remoto). O clima segue a mesma regra. */
  private applyAuthority(isHost: boolean): void {
    const b = this.bridge;
    b.collectibles.authority = isHost ? 'local' : 'remote';
    b.collectibles.avoidPlayer = false;
    b.weather.follower = !isHost;
  }

  /** O mundo do dono da sala → o meu (quem chegou ou reconectou). */
  private applyWorld(world: NetWorld): void {
    const b = this.bridge;
    b.useGarden(world.seed);
    const gone = new Set(world.gone);
    for (const id of b.pickables.pickedIds()) if (!gone.has(id)) b.pickables.regrow(id);
    for (const id of world.gone) b.pickables.absorbRemote(id, null);
    for (const id of world.looseGone) b.looseObjects.swallowRemote(id, null);
    b.collectibles.applyWorldState(world.piles, world.debris);
    if (world.weather) b.weather.applySync(world.weather);
  }

  private worldState(): NetWorld {
    const b = this.bridge;
    const { piles, debris } = b.collectibles.worldState();
    return {
      seed: b.scenery.seed,
      gone: b.pickables.pickedIds(),
      looseGone: b.looseObjects.swallowedIds(),
      piles,
      debris,
      weather: b.weather.snapshot(),
    };
  }

  private scheduleRegrow(id: number): void {
    const session = this.session;
    if (session?.isHost) this.regrowAt.set(id, session.clock.now() + REGROW_SECONDS);
  }

  private promote(count: number): void {
    const indices = this.bridge.collectibles.promoteFresh(count);
    if (indices.length > 0) this.send({ t: 'promote', i: indices });
  }

  // --- Jogadores remotos -----------------------------------------------------------------

  private ensureRemote(member: NetMember): void {
    const existing = this.remotes.get(member.uid);
    if (existing) {
      existing.member = member;
      existing.beetle.setLook(member.look);
      return;
    }
    const b = this.bridge;
    const beetle = new RemoteBeetle(b.physics);
    beetle.model.outfit.compile = (object) => b.compile(object);
    beetle.setLook(member.look);
    const ball = new DungBall(b.physics, PARK, { proxy: true });
    // Invisíveis até o primeiro retrato chegar (senão aparecem no meio do mapa por um instante).
    beetle.model.root.visible = false;
    ball.root.visible = false;
    b.scene.add(beetle.model.root, ball.root);
    this.remotes.set(member.uid, { member, beetle, ball, buffer: new SnapshotBuffer(), placed: false });
  }

  private removeRemote(uid: string): void {
    const remote = this.remotes.get(uid);
    if (!remote) return;
    this.remotes.delete(uid);
    remote.beetle.dispose();
    disposeBall(remote.ball, this.bridge.physics);
  }

  private teardown(): void {
    for (const uid of [...this.remotes.keys()]) this.removeRemote(uid);
    this.regrowAt.clear();
    const b = this.bridge;
    b.collectibles.authority = 'local';
    b.collectibles.avoidPlayer = true;
    b.weather.follower = false;
  }

  private writeSnapshot(session: NetSession): void {
    const s = this.snapshot;
    const beetle = this.bridge.beetle;
    const ball = this.bridge.ball;
    s.slot = session.slot;
    s.time = session.clock.now();
    const feet = beetle.renderPosition(1, tmpPos);
    const v = beetle.currentVelocity;
    Object.assign(s.beetle, {
      x: feet.x,
      y: feet.y,
      z: feet.z,
      yaw: beetle.heading,
      speed: Math.hypot(v.x, v.z),
      vy: v.y,
      pushBlend: beetle.pushAmount,
      strain: beetle.pushStrength,
      grounded: beetle.isGrounded,
      riding: beetle.riding,
    });
    const p = ball.position(tmpPos);
    const q = ball.rotation(tmpQuat);
    const bv = ball.velocity(tmpVel);
    Object.assign(s.ball, { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, vx: bv.x, vy: bv.y, vz: bv.z, radius: ball.radius, burying: !ball.isSolid });
  }

  private send(event: NetEvent): void {
    if (this.session && this.session.status !== 'closed') this.session.sendEvent(event);
  }

  private setStatus(status: SessionStatus | 'off'): void {
    this._status = status;
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
