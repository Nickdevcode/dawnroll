import * as THREE from 'three';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FIXED_DT } from '../core/Physics';
import { RemoteBeetle } from '../entities/RemoteBeetle';
import type { RoundLedger } from '../progression/food';
import type { Collectibles } from '../world/Collectibles';
import type { LooseObjects } from '../world/LooseObjects';
import type { Pickables } from '../world/Pickables';
import type { Scenery } from '../world/Scenery';
import type { Weather } from '../world/Weather';
import { BallSync, type BallGame } from './BallSync';
import { MatchDirector } from './MatchDirector';
import type { MatchView, NetMatch } from './match';
import { NetSession, type CloseReason, type SessionStatus } from './NetSession';
import { PoseBuffer, beetleOps, type RemoteBeetlePose } from './snapshotBuffer';
import {
  DEFAULT_RULES,
  EMOTE_HERE,
  SNAPSHOT_HZ,
  effectiveRules,
  encodeSnapshot,
  type BallPose,
  type NetEvent,
  type NetLook,
  type NetMember,
  type NetRules,
  type NetWorld,
  type PlayerSnapshot,
  type RoomModeId,
} from './protocol';
import { DIZZY_SECONDS, TACKLE_COOLDOWN, TACKLE_LOOSE_SECONDS, TACKLE_MIN_SPEED, TACKLE_REACH, judgeTackle, relation, type BeetleFacts } from './rules';
import { createRoom, joinRoom, quickMatch, setRoomState, type RoomError, type RoomInfo } from '../online/Rooms';

/**
 * O online dentro do jogo: liga a sessão de rede (`NetSession`) ao jardim.
 *
 *  - Os outros jogadores viram besouros "fantasmas" (cinemáticos) que seguem
 *    os retratos da rede, desenhados um pouquinho no passado pra ficarem lisos.
 *  - As bolas (suas e dos outros) ficam com o `BallSync`: cada uma tem dono,
 *    e roubar, engolir e fundir passam pelo dono da sala.
 *  - O que a SUA bola pega vira evento pra sala; o que a bola dos outros pega
 *    some daqui e gruda na bola deles.
 *  - O dono da sala decide o mundo compartilhado: onde montinho e tralha
 *    renascem, o que rebrota (jardim livre), o clima, e confere a trombada.
 *
 * O seu besouro e a sua bola continuam 100% locais (a física do solo): não
 * existe atraso nenhum no controle.
 */

/** O que o online precisa do jogo (o jogo implementa; o online não mexe no resto). */
export interface OnlineBridge extends BallGame {
  /** A câmera do jogo (sombra dos besouros remotos só perto dela). */
  readonly camera: THREE.Camera;
  readonly scenery: Scenery;
  readonly collectibles: Collectibles;
  readonly pickables: Pickables;
  readonly looseObjects: LooseObjects;
  readonly weather: Weather;
  /** O que a bola principal tem dentro agora (a rodada em curso). */
  mainLedger(): RoundLedger;
  /** Apelido e visual pra se apresentar. */
  profile(): { nick: string; look: NetLook };
  /**
   * Deixa o jardim na semente da sala (troca se for outro) e os montinhos no arranjo do online.
   * `slot` = a sua vaga na sala: trocando de jardim, cada vaga nasce num ponto (ninguém em cima de ninguém).
   */
  useGarden(seed: number, slot: number): void;
  /** Compila o material de um modelo novo em segundo plano (sem engasgo ao aparecer). */
  compile(object: THREE.Object3D): Promise<void>;
  /** Avisos do online: alguém entrou/saiu (`text` = apelido) ou você virou o dono da sala. */
  notify(text: string, kind: 'join' | 'leave' | 'host'): void;
  /** Alguém enterrou uma bola (e a sua parte nela, se você doou bola pra ela). */
  remoteBurial(cm: number, nick: string, share: number, food: number): void;
  /** Trombada: `by` derrubou `target` (um dos dois pode ser você). */
  tackle(by: string, target: string, at: THREE.Vector3, mine: 'by' | 'target' | null): void;
  /** Reação de alguém (a roda): o jogo mostra o balão (e o marcador no chão, no "Aqui!"). */
  emote(uid: string, emote: number, at: THREE.Vector3 | null): void;
  /** A sessão acabou (saiu, caiu): o jogo volta pro solo. */
  ended(reason: CloseReason): void;
  /** Disputa nova (contagem ou entrou no meio): jardim da semente, bolas zeradas, besouro na largada. */
  matchSetup(seed: number, spot: { x: number; z: number; yaw: number }): void;
  /** A fase da Disputa mudou (contagem, valendo, tempo esgotado, pódio, livre). */
  matchView(view: MatchView, prev: MatchView): void;
  /** Resultado da Disputa (uma vez por partida). */
  matchResult(match: NetMatch, won: boolean): void;
}

/** Um jogador remoto na cena. */
interface Remote {
  member: NetMember;
  beetle: RemoteBeetle;
  buffer: PoseBuffer<RemoteBeetlePose>;
  placed: boolean;
}

export interface OnlinePlayer {
  uid: string;
  slot: number;
  nick: string;
  /** Tag da turma (null = sem turma). */
  tag: string | null;
  look: NetLook;
  isHost: boolean;
  isSelf: boolean;
  /** Time (−1 = cada um por si). */
  team: number;
  /** Pediu pra trocar pra esse time (cheio) e espera alguém de lá topar; null = sem pedido. */
  swapTo: number | null;
}

/** Placa de apelido: onde desenhar cada um (atualizado a cada quadro). */
export interface NameplateSource {
  uid: string;
  slot: number;
  nick: string;
  /** Tag da turma (null = sem turma). */
  tag: string | null;
  /** Um pouco acima da cabeça. */
  position: THREE.Vector3;
  isHost: boolean;
  /** Reação que ele mandou agora (índice da roda), ou -1. */
  emote: number;
  /** Tonto (levou trombada). */
  dizzy: boolean;
  /** Time (−1 = cada um por si): a placa ganha a cor e o ícone dele. */
  team: number;
}

/** Marcador "Aqui!" no chão: de quem (a vaga dá a cor) e até quando. */
export interface PingMarker {
  slot: number;
  position: THREE.Vector3;
  until: number;
}

export type OnlineOutcome = { ok: true } | { ok: false; error: RoomError | 'connect' | 'signal' | 'account' };

/** Rebrota: o que foi arrancado volta sozinho depois disso (jardim livre). */
const REGROW_SECONDS = 240;
/** Clima: o dono manda o retrato a cada tanto. */
const WEATHER_SYNC_SECONDS = 2;
/** Mandar o retrato a cada N passos fixos (60 Hz / 3 = 20 Hz). */
const SNAPSHOT_EVERY = Math.round(1 / FIXED_DT / SNAPSHOT_HZ);
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;
/** Balão da reação: quanto tempo fica em cima do besouro. "Aqui!": quanto tempo o marcador fica no chão. */
const EMOTE_SECONDS = 3;
const PING_SECONDS = 6;
/** Uma reação a cada tanto (a roda não vira metralhadora). */
const EMOTE_COOLDOWN = 1.2;
/** A Disputa anda no relógio mesmo com a aba escondida (o dono vira as fases). */
const MATCH_TICK_MS = 250;
/**
 * Besouro remoto mais longe que isso da câmera não projeta sombra: são ~70
 * peças (patas, antenas, acessórios), e cada uma é mais um desenho no passe de
 * sombra (no celular, a sala cheia dobrava os draw calls). De longe ninguém vê.
 */
const REMOTE_SHADOW_DISTANCE = 14;

const tmpPos = new THREE.Vector3();

export class OnlinePlay {
  private session: NetSession | null = null;
  private readonly remotes = new Map<string, Remote>();
  private readonly listeners = new Set<() => void>();
  private readonly regrowAt = new Map<number, number>();
  readonly balls: BallSync;
  /** Times e Disputa (o dono conduz; todo mundo reage às fases). */
  readonly director: MatchDirector;
  /** A sala no banco (código, visibilidade, modo de quando foi criada). */
  private room: RoomInfo | null = null;
  private matchTimer = 0;
  private readonly snapshot: PlayerSnapshot = {
    slot: 0,
    time: 0,
    beetle: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0, pushBlend: 0, strain: 0, grounded: true, riding: false, dizzy: false },
    assist: { ball: 0, ax: 0, az: 0 },
    balls: [],
  };
  private stepCount = 0;
  private weatherTimer = 0;
  private _status: SessionStatus | 'off' = 'off';
  /** A sessão atual chegou a ficar online (fechar antes disso é "não deu pra entrar", não "a sala caiu"). */
  private everOnline = false;
  private lastLook = '';
  private _rules: NetRules = { ...DEFAULT_RULES };
  /** Trombada: quando você pode dar a próxima (relógio da sala), e o dono da sala anota a de cada um. */
  private tackleReadyAt = 0;
  private readonly tackleLog = new Map<string, number>();
  private readonly dizzyUntil = new Map<string, number>();
  /** Reações em cima de cada besouro (uid → qual e até quando) e os "Aqui!" no chão. */
  private readonly emotes = new Map<string, { e: number; until: number }>();
  readonly pings: PingMarker[] = [];
  private emoteReadyAt = 0;
  /**
   * Sua conta na sala (vale já no "welcome" do dono, que acontece antes de a
   * sessão terminar de abrir: ali `session` ainda é null).
   */
  private selfUid = '';
  /** A sessão abrindo (o "welcome" chega antes de `open` devolver): relógio e vaga já valem. */
  private opening: NetSession | null = null;

  constructor(
    private readonly bridge: OnlineBridge,
    /** Conta aberta agora (o online exige conta). */
    private readonly player: () => { client: SupabaseClient; userId: string } | null,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const play = this;
    this.balls = new BallSync(bridge, {
      get selfId() {
        return play.selfUid;
      },
      get isHost() {
        return (play.session ?? play.opening)?.isHost ?? false;
      },
      now: () => this.now(),
      rules: () => effectiveRules(this._rules),
      teams: () => play.director.teams,
      send: (event) => this.send(event),
      request: (event) => this.request(event),
      nick: (uid) => this.nick(uid),
      beetleAt: (uid, out) => this.beetleAt(uid, out),
    });
    this.director = new MatchDirector(
      {
        get selfId() {
          return play.selfUid;
        },
        get isHost() {
          return (play.session ?? play.opening)?.isHost ?? false;
        },
        get isPublic() {
          return play.room?.visibility === 'public';
        },
        now: () => this.now(),
        send: (event) => this.send(event),
        members: () => (this.session ?? this.opening)?.memberList ?? [],
        rules: () => this._rules,
        setRules: (rules) => this.setRules(rules),
        roomState: (mode, status) => this.saveRoomState(mode, status),
      },
      {
        matchSetup: (seed, spot) => {
          this.regrowAt.clear();
          bridge.matchSetup(seed, spot);
        },
        matchView: (view, prev) => {
          bridge.matchView(view, prev);
          this.changed();
        },
        matchResult: (match, won) => bridge.matchResult(match, won),
        matchChanged: () => this.changed(),
      },
    );
  }

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

  get selfId(): string {
    return this.selfUid;
  }

  /** Relógio da sala (segundos): o mesmo pra todo mundo. */
  get time(): number {
    return this.now();
  }

  /** As regras escolhidas pelo dono (a placa mostra; o roubo da Disputa é sempre ligado, ver `effectiveRules`). */
  get rules(): Readonly<NetRules> {
    return this._rules;
  }

  /** Sala pública (procurar partida). */
  get isPublic(): boolean {
    return this.room?.visibility === 'public';
  }

  /** O besouro está travado pela Disputa (contagem, tempo esgotado, pódio). */
  get inputLocked(): boolean {
    return this.active && this.director.inputLocked;
  }

  /** Disputa valendo (ou na contagem): atributos iguais pra todo mundo. */
  get equalStats(): boolean {
    return this.active && this._rules.mode === 'match' && this.director.running;
  }

  /** A sua vaga na sala (0 = quem criou; cada um tem a sua enquanto estiver lá). */
  get slot(): number {
    return this.session?.slot ?? 0;
  }

  get players(): OnlinePlayer[] {
    const session = this.session;
    if (!session) return [];
    return session.memberList.map((m) => ({
      uid: m.uid,
      slot: m.slot,
      nick: m.nick,
      tag: m.look.tag ?? null,
      look: m.look,
      isHost: m.uid === session.host,
      isSelf: m.uid === session.selfId,
      team: this.teamOf(m.uid),
      swapTo: this._rules.teamSize > 1 ? (this.director.swapWishes.get(m.uid) ?? null) : null,
    }));
  }

  /** Segundos até poder dar outra trombada (0 = pronta). */
  get tackleCooldown(): number {
    return Math.max(0, this.tackleReadyAt - this.now());
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

  /** Procurar partida: cai numa sala pública do modo (ou cria uma, e os próximos caem nela). */
  async quickMatch(mode: RoomModeId): Promise<OnlineOutcome> {
    const player = this.player();
    if (!player) return { ok: false, error: 'account' };
    if (this.session) await this.leave();
    const result = await quickMatch(player.client, mode).catch(() => null);
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

  /**
   * Dono da sala: muda as regras (roubo, modo, tamanho do time, tempo da
   * Disputa); `change` é só o que muda. Todo mundo guarda as regras: se o dono
   * cair, quem assume continua com elas.
   */
  setRules(change: Partial<NetRules>): void {
    if (!this.session?.isHost) return;
    const prev = this._rules;
    this._rules = { ...prev, ...change };
    this.send({ t: 'rules', rules: this._rules });
    this.director.rulesChanged(prev, this._rules);
    this.changed();
  }

  /** Dono: começa a Disputa (precisa de 2 ou mais na sala). */
  startMatch(): boolean {
    return this.director.start();
  }

  /** Pedir pra ir pro time `team` (cheio = pedido de troca; de novo = desiste). */
  chooseTeam(team: number): void {
    if (this.active) this.director.chooseTeam(team);
  }

  /** Dono: embaralha os times. */
  shuffleTeams(): void {
    this.director.shuffle();
  }

  /** Só o dono: o banco fica sabendo do modo e da Disputa (sem esperar; se falhar, a próxima mudança acerta). */
  private saveRoomState(mode: RoomModeId, status: 'open' | 'playing'): void {
    const player = this.player();
    const room = this.room;
    if (!player || !room || !(this.session ?? this.opening)?.isHost) return;
    void setRoomState(player.client, room.id, mode, status).catch(() => undefined);
  }

  private async open(player: { client: SupabaseClient; userId: string }, room: RoomInfo): Promise<OnlineOutcome> {
    this.everOnline = false;
    this.selfUid = player.userId;
    this.room = room;
    // Quem cria a sala começa no modo dela (procurar Disputa = sala de Disputa); quem entra recebe as regras do dono.
    this._rules = { ...DEFAULT_RULES, mode: room.mode };
    this.director.reset();
    window.clearInterval(this.matchTimer);
    this.matchTimer = window.setInterval(() => {
      if (this.session) this.director.update();
    }, MATCH_TICK_MS);
    this.setStatus('connecting');
    try {
      this.session = await NetSession.open(player.client, player.userId, room, {
        onOpen: (session) => {
          this.opening = session;
        },
        profile: () => this.bridge.profile(),
        world: () => this.worldState(),
        onWelcome: (info) => this.welcome(info.members, info.world, info.isHost, info.slot),
        onMemberJoin: (member) => this.memberJoined(member),
        onMemberLeave: (uid) => this.memberLeft(uid),
        onSnapshot: (snapshot) => this.receiveSnapshot(snapshot),
        onEvent: (event, from) => this.receiveEvent(event, from),
        onRoleChange: (isHost) => this.roleChanged(isHost),
        onStatus: (status, reason) => this.sessionStatus(status, reason),
      });
      this.opening = null;
      this.lastLook = JSON.stringify(this.bridge.profile().look);
      return { ok: true };
    } catch (error) {
      this.opening = null;
      this.session = null;
      this.room = null;
      this.teardown();
      this.setStatus('off');
      return { ok: false, error: error instanceof Error && error.message === 'signal' ? 'signal' : 'connect' };
    }
  }

  // --- Laço do jogo -------------------------------------------------------------------

  /** Passo fixo, antes da física: os fantasmas vão pra pose (no passado, interpolada) e as ajudas no empurrão entram. */
  beforePhysics(): void {
    const session = this.session;
    if (!session) return;
    const now = session.clock.now();
    for (const remote of this.remotes.values()) {
      const pose = remote.buffer.sample(now - remote.buffer.delay(SNAPSHOT_INTERVAL));
      if (!pose) continue;
      if (!remote.placed) {
        remote.placed = true;
        remote.beetle.model.root.visible = true;
      }
      const pushed = this.pushedPose(remote.member.uid);
      remote.beetle.drive(pose.beetle, pushed ? Math.hypot(pushed.vx, pushed.vz) : 0, pushed?.radius ?? 0.5, remote.buffer.jumped);
    }
    this.balls.beforePhysics(now);
  }

  /** Passo fixo, depois da física: bolas, trombada e o meu retrato (20 por segundo). */
  afterPhysics(): void {
    const session = this.session;
    if (!session) return;
    const now = session.clock.now();
    this.balls.afterPhysics(now);
    this.detectTackle(now);
    if (++this.stepCount % SNAPSHOT_EVERY !== 0 || session.status !== 'online') return;
    this.writeSnapshot(session);
    session.sendSnapshot(encodeSnapshot(this.snapshot));
  }

  /** Quadro: desenho dos fantasmas e os relógios do dono (rebrota, clima). */
  render(alpha: number, dt: number): void {
    const eye = this.bridge.camera.position;
    for (const remote of this.remotes.values()) {
      if (!remote.placed) continue;
      remote.beetle.render(alpha, dt);
      remote.beetle.setShadows(remote.beetle.position.distanceTo(eye) < REMOTE_SHADOW_DISTANCE);
    }
    this.balls.render(alpha, dt);
    const session = this.session;
    if (!session) return;
    this.director.update();
    const now = session.clock.now();
    for (const [uid, emote] of this.emotes) if (now > emote.until) this.emotes.delete(uid);
    for (let i = this.pings.length - 1; i >= 0; i--) if (now > this.pings[i].until) this.pings.splice(i, 1);
    if (!session.isHost || session.status !== 'online') return;
    // Rebrota do que foi arrancado (jardim livre).
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

  /** Onde vão as placas de apelido neste quadro (e o balão de reação, inclusive o seu). */
  nameplates(out: NameplateSource[]): NameplateSource[] {
    out.length = 0;
    const session = this.session;
    if (!session) return out;
    for (const remote of this.remotes.values()) {
      if (!remote.placed) continue;
      const p = remote.beetle.position;
      const uid = remote.member.uid;
      out.push({
        uid,
        slot: remote.member.slot,
        nick: remote.member.nick,
        tag: remote.member.look.tag ?? null,
        position: new THREE.Vector3(p.x, p.y + 1.4, p.z),
        isHost: uid === session.host,
        emote: this.emotes.get(uid)?.e ?? -1,
        dizzy: remote.buffer.latest?.pose.beetle.dizzy ?? false,
        team: this.teamOf(uid),
      });
    }
    // O seu balão também aparece (em cima do seu besouro, sem placa de nome).
    const mine = this.emotes.get(session.selfId);
    if (mine) {
      const p = this.bridge.beetle.renderPosition(1, tmpPos);
      out.push({ uid: session.selfId, slot: session.slot, nick: '', tag: null, position: new THREE.Vector3(p.x, p.y + 1.4, p.z), isHost: false, emote: mine.e, dizzy: false, team: this.teamOf(session.selfId) });
    }
    return out;
  }

  // --- O que a minha bola fez (o jogo chama) --------------------------------------------

  localAbsorb(id: number): void {
    this.send({ t: 'absorb', id, b: this.balls.mainId });
    this.scheduleRegrow(id);
  }

  localLoose(id: number): void {
    this.send({ t: 'loose', id, b: this.balls.mainId });
  }

  localPile(index: number): void {
    this.send({ t: 'pile', i: index, b: this.balls.mainId });
  }

  localDebris(index: number): void {
    this.send({ t: 'debris', i: index, b: this.balls.mainId });
  }

  /** O dono fez um montinho renascer / repôs um detrito: manda a semente pra sala. */
  pileSpawned(index: number, seed: number, fresh: boolean): void {
    if (this.session?.isHost) this.send({ t: 'pileSpawn', i: index, seed, fresh });
  }

  debrisSpawned(index: number, seed: number): void {
    if (this.session?.isHost) this.send({ t: 'debrisSpawn', i: index, seed });
  }

  /**
   * Enterrei a bola principal: a sala fica sabendo (tamanho e a parte de cada
   * um, pra quem doou bola pra ela receber a comida dele). Devolve a minha parte.
   */
  localBury(cm: number, food: number, sunCm: number): void {
    const { all } = this.balls.burialShares();
    const event = { t: 'bury', b: this.balls.mainId || 1, cm: Math.round(cm * 10) / 10, food: Math.round(food), sun: Math.round(sunCm * 10) / 10, s: all } as const;
    this.send(event);
    if (this.session?.isHost) this.director.noteBurial(this.selfUid, event.cm, event.sun, event.s);
  }

  /** A minha parte na bola principal (0..1), pra o enterro dividir a comida. */
  burialShare(): number {
    return this.balls.burialShares().mine;
  }

  /** A bola principal renasceu pequena depois do enterro (ou na largada da Disputa): pra sala é outra bola. Devolve o conteúdo novo. */
  localNewBall(why: 'buried' | 'crumble' = 'buried'): RoundLedger {
    return this.balls.renewMain(why);
  }

  /** O visual mudou (guarda-roupa, turma nova): os outros veem a roupa (e a tag) nova. */
  lookChanged(): void {
    const look = this.bridge.profile().look;
    const key = JSON.stringify(look);
    if (key === this.lastLook) return;
    this.lastLook = key;
    // A minha linha na sala também (o lobby e o "oi" que o dono manda pra quem chega depois).
    const session = this.session;
    const me = session?.member(session.selfId);
    if (me) me.look = look;
    this.send({ t: 'look', look });
    this.changed();
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

  /** Reação da roda (a 8ª, "Aqui!", marca o chão onde você está). Devolve se mandou. */
  sendEmote(index: number): boolean {
    const session = this.session;
    if (!session || session.status !== 'online') return false;
    const now = this.now();
    if (now < this.emoteReadyAt) return false;
    this.emoteReadyAt = now + EMOTE_COOLDOWN;
    let event: NetEvent = { t: 'emote', e: index };
    if (index === EMOTE_HERE) {
      const p = this.bridge.beetle.renderPosition(1, tmpPos);
      event = { t: 'emote', e: index, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
    }
    this.send(event);
    this.showEmote(session.selfId, event);
    return true;
  }

  // --- Recebendo -------------------------------------------------------------------------

  private welcome(members: NetMember[], world: NetWorld | null, isHost: boolean, slot: number): void {
    const selfId = this.selfUid;
    this.applyAuthority(isHost);
    if (world) this.applyWorld(world, slot);
    else this.bridge.useGarden(this.bridge.scenery.seed, slot);
    const present = new Set(members.map((m) => m.uid));
    for (const uid of [...this.remotes.keys()]) if (!present.has(uid)) this.removeRemote(uid);
    for (const member of members) if (member.uid !== selfId) this.ensureRemote(member);
    // A bola que você estava fazendo vira a sua bola na sala (e o conteúdo dela vai pra todos).
    this.balls.start(this.bridge.mainLedger());
    this.balls.resendInfo();
    this.director.welcome(world);
    this.changed();
  }

  private memberJoined(member: NetMember): void {
    if (member.uid === this.selfUid) return;
    this.ensureRemote(member);
    this.balls.resendInfo();
    this.director.memberJoined(member);
    this.bridge.notify(member.nick, 'join');
    // O dono conta as regras da sala pra quem chegou (o "welcome" já leva, mas quem já estava na sala pode ter perdido).
    this.changed();
  }

  private memberLeft(uid: string): void {
    const remote = this.remotes.get(uid);
    if (remote) this.bridge.notify(remote.member.nick, 'leave');
    this.removeRemote(uid);
    this.director.memberLeft(uid);
    this.changed();
  }

  private receiveSnapshot(snapshot: PlayerSnapshot): void {
    const session = this.session;
    if (!session) return;
    const now = session.clock.now();
    for (const remote of this.remotes.values()) {
      if (remote.member.slot !== snapshot.slot) continue;
      remote.buffer.push(snapshot.time, snapshot, now, SNAPSHOT_INTERVAL);
      this.balls.receive(remote.member.uid, snapshot, now);
      return;
    }
  }

  private receiveEvent(event: NetEvent, from: string): void {
    const b = this.bridge;
    if (this.director.onEvent(event, from)) return;
    switch (event.t) {
      case 'absorb':
        b.pickables.absorbRemote(event.id, this.balls.proxyBall(event.b));
        this.scheduleRegrow(event.id);
        return;
      case 'loose':
        b.looseObjects.swallowRemote(event.id, this.balls.proxyBall(event.b));
        return;
      case 'pile':
        b.collectibles.takePileRemote(event.i, this.balls.proxyBall(event.b));
        return;
      case 'debris':
        b.collectibles.takeDebrisRemote(event.i, this.balls.proxyBall(event.b));
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
        if (!this.session?.isHost) b.useGarden(event.seed, this.slot);
        return;
      case 'rain':
        if (this.session?.isHost) this.requestRain(event.long);
        return;
      case 'nose':
        if (this.session?.isHost) this.promote(3);
        return;
      case 'bury': {
        const remote = this.remotes.get(from);
        const share = event.s.find(([uid]) => uid === this.selfUid)?.[1] ?? 0;
        if (remote) b.remoteBurial(event.cm, remote.member.nick, share, event.food * share);
        if (this.session?.isHost && this.plausibleBurial(from, event.b, event.cm)) this.director.noteBurial(from, event.cm, event.sun, event.s);
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
      case 'emote':
        this.showEmote(from, event);
        return;
      // Pedidos ao dono da sala.
      case 'claim':
      case 'swallow':
      case 'merge':
      case 'pull':
      case 'tackle':
        if (this.session?.isHost) this.judge(event, from);
        return;
      // Decisões do dono da sala.
      case 'tackled':
        this.applyTackle(event.by, event.target, event.b);
        return;
      case 'rules':
        if (!this.session?.isHost) {
          this._rules = { ...event.rules };
          this.changed();
        }
        return;
      case 'own':
      case 'swallowed':
      case 'merged':
      case 'pulled':
      case 'gone':
      case 'ball':
        this.balls.onEvent(event, from);
        return;
      default:
        return;
    }
  }

  /** Pedido de jogador (ou meu, sendo o dono): confere as regras, anuncia e aplica a decisão. */
  private judge(event: NetEvent, from: string): void {
    const decision = event.t === 'tackle' ? this.judgeTackle(event.target, from) : this.balls.judge(event, from);
    if (!decision) return;
    this.send(decision);
    this.receiveEvent(decision, this.selfUid);
    this.director.noteDecision(decision);
  }

  /** Manda um pedido pro dono da sala; sendo o dono, decide na hora. */
  private request(event: NetEvent): void {
    const session = this.session;
    if (!session || session.status === 'closed') return;
    if (session.isHost) this.judge(event, session.selfId);
    else session.sendEvent(event);
  }

  private roleChanged(isHost: boolean): void {
    this.applyAuthority(isHost);
    if (isHost) {
      this.director.becameHost();
      this.bridge.collectibles.claimAuthority();
      // Assumiu a sala no meio: o que já estava arrancado rebrota a partir de agora.
      const now = this.now();
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
    this.room = null;
    this.teardown();
    // Nunca chegou a entrar: quem avisa é a placa (com o motivo), não o "a sala caiu".
    if (this.everOnline) this.bridge.ended(reason ?? 'lost');
    this.setStatus('off');
  }

  // --- Trombada -------------------------------------------------------------------------

  /**
   * Correndo, o seu besouro encostou num rival que está empurrando: pede a
   * trombada pro dono da sala (o som e o tranco saem na hora, sem esperar).
   */
  private detectTackle(now: number): void {
    const beetle = this.bridge.beetle;
    if (now < this.tackleReadyAt || !effectiveRules(this._rules).steal || beetle.pushing || beetle.riding || beetle.dizzy || this.inputLocked) return;
    const v = beetle.currentVelocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < TACKLE_MIN_SPEED) return;
    const me = beetle.center;
    const selfId = this.selfUid;
    for (const remote of this.remotes.values()) {
      const latest = remote.buffer.latest?.pose.beetle;
      if (!remote.placed || !latest || latest.dizzy || relation(selfId, remote.member.uid, this.director.teams) !== 'rival') continue;
      if (latest.pushBlend < 0.5 && !latest.riding) continue;
      const p = remote.beetle.position;
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const d = Math.hypot(dx, dz);
      // Encostou, e indo pra cima dele (não de raspão por trás).
      if (d > TACKLE_REACH || (dx * v.x + dz * v.z) / Math.max(d * speed, 1e-6) < 0.3) continue;
      this.tackleReadyAt = now + TACKLE_COOLDOWN;
      this.request({ t: 'tackle', target: remote.member.uid });
      return;
    }
  }

  /** Dono da sala: confere a trombada com o que ele sabe dos dois besouros. */
  private judgeTackle(target: string, from: string): NetEvent | null {
    const now = this.now();
    const by = this.beetleFacts(from, now);
    const victim = this.beetleFacts(target, now);
    if (judgeTackle(by, victim, from, target, now, effectiveRules(this._rules), this.director.teams) !== 'ok') return null;
    this.tackleLog.set(from, now);
    this.dizzyUntil.set(target, now + DIZZY_SECONDS);
    return { t: 'tackled', by: from, target, b: this.pushedBallOf(target) };
  }

  private beetleFacts(uid: string, now: number): BeetleFacts | undefined {
    const selfId = this.selfUid;
    const lastTackleAt = this.tackleLog.get(uid) ?? -Infinity;
    const dizzy = (this.dizzyUntil.get(uid) ?? 0) > now;
    if (uid === selfId) {
      const beetle = this.bridge.beetle;
      return { x: beetle.center.x, z: beetle.center.z, pushing: beetle.pushing || beetle.riding, dizzy: dizzy || beetle.dizzy, lastTackleAt };
    }
    const pose = this.remotes.get(uid)?.buffer.latest?.pose.beetle;
    if (!pose) return undefined;
    return { x: pose.x, z: pose.z, pushing: pose.pushBlend > 0.5 || pose.riding, dizzy: dizzy || pose.dizzy, lastTackleAt };
  }

  /** A bola que `uid` estava empurrando (a dele, marcada no retrato), ou 0. */
  private pushedBallOf(uid: string): number {
    if (uid === this.selfUid) {
      const beetle = this.bridge.beetle;
      return beetle.pushing || beetle.riding ? (this.balls.recordOf(beetle.currentBall)?.id ?? 0) : 0;
    }
    return this.pushedPose(uid)?.id ?? 0;
  }

  /** Pose (mais nova) da bola que o jogador remoto está empurrando, se tiver. */
  private pushedPose(uid: string): BallPose | null {
    for (const rec of this.balls.records.values()) {
      if (rec.local || rec.owner !== uid) continue;
      const pose = rec.buffer?.latest?.pose;
      if (pose?.pushed) return pose;
    }
    return null;
  }

  /** Trombada decidida: quem levou fica tonto e solta a bola (que fica solta pra todo mundo). */
  private applyTackle(by: string, target: string, ball: number): void {
    const selfId = this.selfUid;
    const now = this.now();
    this.dizzyUntil.set(target, now + DIZZY_SECONDS);
    if (ball) {
      this.balls.markLoose(ball);
      const rec = this.balls.records.get(ball);
      if (rec) rec.looseUntil = now + TACKLE_LOOSE_SECONDS;
    }
    if (target === selfId) this.bridge.beetle.stun(DIZZY_SECONDS);
    const at = target === selfId ? this.bridge.beetle.renderPosition(1, tmpPos) : (this.remotes.get(target)?.beetle.position ?? null);
    if (at) this.bridge.tackle(this.nick(by), this.nick(target), at.clone(), by === selfId ? 'by' : target === selfId ? 'target' : null);
  }

  // --- Reações ----------------------------------------------------------------------------

  private showEmote(uid: string, event: Extract<NetEvent, { t: 'emote' }>): void {
    const now = this.now();
    this.emotes.set(uid, { e: event.e, until: now + EMOTE_SECONDS });
    let at: THREE.Vector3 | null = null;
    if (event.e === EMOTE_HERE && event.x !== undefined && event.z !== undefined) {
      at = new THREE.Vector3(event.x, 0, event.z);
      const slot = uid === this.selfUid ? (this.session?.slot ?? 0) : (this.remotes.get(uid)?.member.slot ?? 0);
      // Um marcador por jogador (o novo substitui o antigo).
      const index = this.pings.findIndex((p) => p.slot === slot);
      if (index >= 0) this.pings.splice(index, 1);
      this.pings.push({ slot, position: at, until: now + PING_SECONDS });
    }
    this.bridge.emote(uid, event.e, at);
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
  private applyWorld(world: NetWorld, slot: number): void {
    const b = this.bridge;
    b.useGarden(world.seed, slot);
    const gone = new Set(world.gone);
    for (const id of b.pickables.pickedIds()) if (!gone.has(id)) b.pickables.regrow(id);
    for (const id of world.gone) b.pickables.absorbRemote(id, null);
    for (const id of world.looseGone) b.looseObjects.swallowRemote(id, null);
    b.collectibles.applyWorldState(world.piles, world.debris);
    if (world.weather) b.weather.applySync(world.weather);
    this._rules = { ...world.rules };
  }

  /**
   * Dono da sala, antes de pontuar um enterro dos outros: a bola é mesmo de
   * quem mandou e não é maior do que ele via (folga pro retrato atrasado).
   * Bola que ele nem conhece (acabou de reconectar) passa: na dúvida, conta.
   */
  private plausibleBurial(from: string, ball: number, cm: number): boolean {
    const rec = this.balls.records.get(ball);
    return !rec || (rec.owner === from && cm <= rec.ball.diameterCm + 4);
  }

  /** Time de um jogador (−1 = cada um por si). */
  teamOf(uid: string): number {
    return this._rules.teamSize > 1 ? (this.director.teams.get(uid) ?? -1) : -1;
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
      rules: { ...this._rules },
      ...this.director.worldPart(),
    };
  }

  /** Jardim livre: o que foi arrancado rebrota. Na Disputa o jardim é fixo (o que foi, foi). */
  private scheduleRegrow(id: number): void {
    const session = this.session;
    if (session?.isHost && this._rules.mode === 'garden') this.regrowAt.set(id, session.clock.now() + REGROW_SECONDS);
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
    // Invisível até o primeiro retrato chegar (senão aparece no meio do mapa por um instante).
    beetle.model.root.visible = false;
    b.scene.add(beetle.model.root, beetle.stars.group);
    this.remotes.set(member.uid, { member, beetle, buffer: new PoseBuffer(beetleOps), placed: false });
  }

  private removeRemote(uid: string): void {
    const remote = this.remotes.get(uid);
    if (!remote) return;
    this.remotes.delete(uid);
    remote.beetle.dispose();
    this.balls.removeOwner(uid);
    this.emotes.delete(uid);
  }

  private teardown(): void {
    window.clearInterval(this.matchTimer);
    this.matchTimer = 0;
    this.director.reset();
    for (const uid of [...this.remotes.keys()]) this.removeRemote(uid);
    this.balls.stop();
    this.regrowAt.clear();
    this.tackleLog.clear();
    this.dizzyUntil.clear();
    this.emotes.clear();
    this.pings.length = 0;
    const b = this.bridge;
    b.collectibles.authority = 'local';
    b.collectibles.avoidPlayer = true;
    b.weather.follower = false;
  }

  private writeSnapshot(session: NetSession): void {
    const s = this.snapshot;
    const beetle = this.bridge.beetle;
    s.slot = session.slot;
    s.time = session.clock.now();
    const feet = beetle.renderPosition(1, tmpPos);
    const v = beetle.currentVelocity;
    const pose = s.beetle;
    pose.x = feet.x;
    pose.y = feet.y;
    pose.z = feet.z;
    pose.yaw = beetle.heading;
    pose.speed = Math.hypot(v.x, v.z);
    pose.vy = v.y;
    pose.pushBlend = beetle.pushAmount;
    pose.strain = beetle.pushStrength;
    pose.grounded = beetle.isGrounded;
    pose.riding = beetle.riding;
    pose.dizzy = beetle.dizzy;
    Object.assign(s.assist, this.balls.assistOf(beetle));
    this.balls.writeBalls(s.balls);
  }

  /** Pés do besouro de alguém (o retrato mais novo; o seu, agora). */
  private beetleAt(uid: string, out: THREE.Vector3): THREE.Vector3 | null {
    if (uid === this.selfUid) return this.bridge.beetle.renderPosition(1, out);
    const pose = this.remotes.get(uid)?.buffer.latest?.pose.beetle;
    return pose ? out.set(pose.x, pose.y, pose.z) : null;
  }

  /** Apelido de um jogador da sala ('?' se não conhece). */
  nickOf(uid: string): string {
    return this.nick(uid);
  }

  private nick(uid: string): string {
    return this.session?.member(uid)?.nick ?? this.remotes.get(uid)?.member.nick ?? '?';
  }

  private now(): number {
    return (this.session ?? this.opening)?.clock.now() ?? performance.now() / 1000;
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

