import type { SupabaseClient } from '@supabase/supabase-js';
import { RoomClock } from './clock';
import {
  CLIENT_EVENTS,
  MAX_PLAYERS,
  NET_PROTOCOL,
  RELAYED_EVENTS,
  decodeSnapshot,
  parseEvent,
  stampSnapshotSlot,
  type NetEvent,
  type NetLook,
  type NetMember,
  type NetWorld,
  type PlayerSnapshot,
} from './protocol';
import { RoomChannel } from './transport/signaling';
import { StarNet, forceRelayFromUrl, netSimFromUrl } from './transport/StarNet';
import { iceConfig } from './transport/iceServers';
import type { Lane } from './transport/PeerLink';
import { claimHost, heartbeat, joinRoom, leaveRoom, leaveRoomOnUnload, reportConnection, type RoomInfo } from '../online/Rooms';

/**
 * Uma sala online viva: quem está nela, quem é o dono, o relógio da sala e o
 * vai-e-vem de mensagens (ver `protocol.ts`).
 *
 * O dono da sala (quem criou, ou quem assumiu) é o centro da estrela: recebe
 * de cada jogador e repassa pros outros, carimbando quem mandou; também
 * responde o relógio e decide as vagas. Os outros falam só com ele.
 *
 * Se o dono cair, a sala não morre: depois de ~6 s sem ele bater o ponto no
 * banco, o próximo que chegou primeiro assume (`claim_host`) e todo mundo
 * reconecta nele. O jogo local de cada um nunca para nesse meio tempo.
 */

export type SessionStatus = 'connecting' | 'online' | 'reconnecting' | 'closed';
/** Por que a sessão fechou (vira frase na interface). */
export type CloseReason = 'left' | 'lost' | 'signal' | 'connect' | 'full';

export interface SessionHandlers {
  /**
   * A sessão existe (antes de conectar): quem usa já pode ler o relógio da
   * sala e a vaga no "welcome", que chega antes de `open` terminar.
   */
  onOpen?(session: NetSession): void;
  /** O que eu anuncio pros outros (apelido e visual). */
  profile(): { nick: string; look: NetLook };
  /** O mundo compartilhado agora (o dono manda pra quem chega). */
  world(): NetWorld;
  /**
   * Entrei (ou reentrei) na sala: minha vaga, quem está e o mundo do dono
   * (null se eu mesmo sou o dono desde o começo).
   */
  onWelcome(info: { slot: number; members: NetMember[]; world: NetWorld | null; isHost: boolean }): void;
  onMemberJoin(member: NetMember): void;
  /**
   * Quem já estava na sala se apresentou de novo (a conexão dele piscou, ou
   * todo mundo reconectou num dono novo): mesma vaga, nada de "entrou".
   */
  onMemberReturn(member: NetMember): void;
  onMemberLeave(uid: string): void;
  onSnapshot(snapshot: PlayerSnapshot): void;
  /** Evento do mundo; `from` = quem causou (o dono, nos eventos do dono). */
  onEvent(event: NetEvent, from: string): void;
  onRoleChange(isHost: boolean): void;
  onStatus(status: SessionStatus, reason?: CloseReason): void;
}

const TICK_MS = 250;
const HOST_BEAT_MS = 2000;
const CLIENT_BEAT_MS = 5000;
/** Sem ouvir o dono por isso, o jogador considera que ele caiu (o dono manda retrato 20×/s e pong a cada 2 s; a folga cobre a travada de compilar shader num aparelho fraco). */
const HOST_SILENCE_S = 8;
/** Sem ouvir um jogador por isso, o dono fecha a conexão dele. */
const PEER_SILENCE_S = 12;
/**
 * A conexão com um jogador caiu sem ele dizer tchau (a rede piscou, o celular
 * foi pro segundo plano, o aparelho travou): a vaga, o besouro e as bolas dele
 * esperam isso antes de virar "saiu". Quem volta nesse meio tempo reconecta na
 * mesma vaga, sem aviso nenhum. Quem sai de verdade diz tchau (aviso na hora).
 */
const AWAY_GRACE_S = 20;
/** Buraco entre dois tiques maior que isso = esta página ficou congelada (celular em segundo plano, travada longa). */
const STALL_S = 2;
/**
 * Voltou de um congelamento há menos disso: quem sumiu fui eu, o dono
 * provavelmente continua lá (a queda aparece logo depois de acordar; mais que
 * isso, tentar no dono antigo só atrasaria a troca, se ele morreu mesmo).
 */
const STALL_MEMORY_S = 10;
/** Depois de congelar: fôlego pra fila de mensagens parada chegar antes de achar que alguém sumiu. */
const THAW_GRACE_S = 1.5;
/** Tempo pra chegar o "welcome" depois de conectar. */
const WELCOME_TIMEOUT_MS = 10000;
/** Recuperação (dono caiu): tentativas rápidas no começo (1 s), depois a cada 2 s; ~40 s no total. */
const RECOVERY_TRIES = 25;
const RECOVERY_FAST_TRIES = 10;
/** Antes disso, não tenta reconectar no dono que sumiu (quase sempre ele morreu: outro vai assumir). */
const RECOVERY_SAME_HOST_FROM = 6;
/** Limites por jogador no dono (mensagens por segundo, com folga pra rajada). */
const STATE_RATE = 40;
const EVENT_RATE = 30;

interface PeerBudget {
  state: number;
  event: number;
  lastSeen: number;
  /** Mandou mensagem proibida/torta demais: tolerância antes de derrubar. */
  strikes: number;
}

export class NetSession {
  readonly clock = new RoomClock();
  private readonly members = new Map<string, NetMember>();
  private readonly budgets = new Map<string, PeerBudget>();
  private channel!: RoomChannel;
  private star!: StarNet;
  private hostId: string;
  private _isHost = false;
  private _slot = 0;
  private _status: SessionStatus = 'connecting';
  private tickTimer = 0;
  private beatTimer = 0;
  private lastHostMessage = 0;
  private pingCount = 0;
  private nextPingAt = 0;
  private recovering = false;
  private accessToken: string | null = null;
  private welcomeWaiter: ((ok: boolean) => void) | null = null;
  private reported = false;
  /** Dono novo anunciado pelo canal da sala (atalho da recuperação). */
  private hostHint: string | null = null;
  /** Saindo de propósito: a conexão que cai nesse meio tempo (o dono respondeu ao "tchau") não é queda. */
  private leaving = false;
  /** Dono: quem está sem conexão e até quando a vaga dele fica guardada (relógio local). */
  private readonly away = new Map<string, number>();
  /** Jogador: o dono disse tchau antes de a conexão cair (saiu de verdade, não foi a rede). */
  private hostSaidBye: string | null = null;
  /** Último tique (relógio local): um buraco grande entre dois = a página congelou. */
  private lastTickAt = 0;
  /** Quando esta página voltou do último congelamento. */
  private thawedAt = -Infinity;

  private constructor(
    private readonly client: SupabaseClient,
    readonly selfId: string,
    private room: RoomInfo,
    private readonly handlers: SessionHandlers,
  ) {
    this.hostId = room.hostId;
  }

  /** Abre a sala já criada/entrada no banco: sinalização, conexão com o dono (ou vira o dono). */
  static async open(client: SupabaseClient, selfId: string, room: RoomInfo, handlers: SessionHandlers): Promise<NetSession> {
    const session = new NetSession(client, selfId, room, handlers);
    handlers.onOpen?.(session);
    await session.begin();
    return session;
  }

  get status(): SessionStatus {
    return this._status;
  }

  get isHost(): boolean {
    return this._isHost;
  }

  get slot(): number {
    return this._slot;
  }

  get code(): string {
    return this.room.code;
  }

  get roomId(): string {
    return this.room.id;
  }

  get host(): string {
    return this.hostId;
  }

  get memberList(): NetMember[] {
    return [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  member(uid: string): NetMember | undefined {
    return this.members.get(uid);
  }

  /** Dono: `uid` está sem conexão (a vaga está guardada esperando ele voltar). */
  isAway(uid: string): boolean {
    return this._isHost && this.away.has(uid);
  }

  /** Ping até o dono (ms); 0 pro próprio dono. */
  get ping(): number {
    return this._isHost ? 0 : this.clock.ping;
  }

  // --- Mandar ------------------------------------------------------------------------

  /** Meu retrato (codificado): o dono carimba a vaga e manda pra todos; o jogador manda pro dono. */
  sendSnapshot(data: ArrayBuffer): void {
    if (this.isClosed()) return;
    if (this._isHost) {
      stampSnapshotSlot(data, this._slot);
      this.star.broadcast('state', data);
    } else {
      this.star.send(this.hostId, 'state', data);
    }
  }

  /**
   * Evento meu (engoli a flor 12) ou, sendo o dono, uma decisão do mundo
   * (o montinho 3 renasceu). O dono carimba `from` nos repassáveis.
   */
  sendEvent(event: NetEvent): void {
    if (this.isClosed()) return;
    if (this._isHost) {
      const stamped = RELAYED_EVENTS.has(event.t) ? ({ ...event, from: this.selfId } as NetEvent) : event;
      this.star.broadcast('event', JSON.stringify(stamped));
    } else {
      this.star.send(this.hostId, 'event', JSON.stringify(event));
    }
  }

  /** Só o dono: manda um evento pra um jogador (o mundo inteiro pra quem reconectou, por exemplo). */
  sendTo(uid: string, event: NetEvent): void {
    if (this._isHost) this.star.send(uid, 'event', JSON.stringify(event));
  }

  // --- Ciclo de vida ------------------------------------------------------------------

  /**
   * Sai da sala de verdade (botão "Sair"): avisa ("bye"), sai do banco (que já
   * passa a sala pro próximo) e só então fecha as conexões. Fechar antes cortava
   * o "bye" no caminho (pelo TURN, principalmente) e o próximo demorava a assumir.
   */
  async leave(): Promise<void> {
    if (this.isClosed()) return;
    this.leaving = true;
    this.say({ t: 'bye' });
    try {
      await Promise.race([leaveRoom(this.client), sleep(1500)]);
    } catch {
      // Sem rede: a faxina do banco tira a vaga em ~3 min.
    }
    this.shutdown('left');
  }

  private async begin(): Promise<void> {
    this.setStatus('connecting');
    const token = (await this.client.auth.getSession()).data.session?.access_token ?? null;
    this.accessToken = token;
    this.channel = new RoomChannel(this.client, this.room.id, { uid: this.selfId, nick: this.handlers.profile().nick });
    try {
      await this.channel.open();
    } catch {
      this.shutdown('signal');
      throw new Error('signal');
    }
    this.star = new StarNet(this.channel, this.selfId, () => iceConfig(this.client), this.room.visibility === 'public' || forceRelayFromUrl(), netSimFromUrl());
    this.star.onMessage = (peer, lane, data) => (this._isHost ? this.hostReceive(peer, lane, data) : this.clientReceive(peer, lane, data));
    this.star.onLinkClose = (peer) => this.linkClosed(peer);
    this.channel.onHostAnnounce = (uid) => {
      if (uid === this.hostId && this._status === 'online') return;
      this.hostHint = uid;
    };
    this.star.onLinkOpen = (peer) => {
      if (this._isHost) this.budgets.set(peer, { state: STATE_RATE, event: EVENT_RATE, lastSeen: RoomClock.local(), strikes: 0 });
    };
    window.addEventListener('pagehide', this.onPageHide);
    this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);

    if (this.room.hostId === this.selfId) {
      this.becomeHost(true);
    } else if (!(await this.connectToHost(this.room.hostId))) {
      // O dono do banco não respondeu: pode ter acabado de cair. Tenta o caminho da recuperação.
      if (!this.isClosed()) await this.recover(this.room.hostId);
      if (this._status !== 'online') {
        if (!this.isClosed()) this.shutdown('connect');
        void reportConnection(this.client, 'failed', null, this.members.size + 1).catch(() => undefined);
        throw new Error('connect');
      }
    }
    this.scheduleBeat();
  }

  /**
   * Viro o dono. `fresh` = sala nova (só eu). Assumindo no meio, `departed` é o
   * dono antigo quando se sabe que ele saiu de verdade (o banco passou a sala
   * pelo botão "Sair"); se ele só sumiu, fica esperando voltar como todo mundo.
   */
  private becomeHost(fresh: boolean, departed: string | null = null): void {
    const wasHost = this._isHost;
    this._isHost = true;
    this.hostId = this.selfId;
    this.star.becomeHost();
    this.clock.becomeReference();
    this.budgets.clear();
    this.away.clear();
    if (fresh) {
      this.members.clear();
      const { nick, look } = this.handlers.profile();
      this._slot = 0;
      this.members.set(this.selfId, { uid: this.selfId, slot: 0, nick, look, joinedAt: this.clock.now() });
    } else {
      if (departed && departed !== this.selfId && this.members.delete(departed)) this.handlers.onMemberLeave(departed);
      // Todo mundo precisa reconectar em mim: a vaga de cada um fica guardada até lá (quem não voltar, saiu).
      const deadline = RoomClock.local() + AWAY_GRACE_S;
      for (const uid of this.members.keys()) if (uid !== this.selfId) this.away.set(uid, deadline);
    }
    if (!wasHost) this.handlers.onRoleChange(true);
    if (fresh) this.handlers.onWelcome({ slot: 0, members: this.memberList, world: null, isHost: true });
    // Assumiu no meio: avisa a sala (quem está reconectando vem direto, sem esperar o banco).
    else void this.channel.announceHost().catch(() => undefined);
    this.setStatus('online');
    this.scheduleBeat();
  }

  /** Conecta no dono, se apresenta e espera o "welcome". */
  private async connectToHost(hostId: string): Promise<boolean> {
    const wasHost = this._isHost;
    this._isHost = false;
    this.hostId = hostId;
    // Quem espera quem voltar agora é o dono novo.
    this.away.clear();
    if (wasHost) this.handlers.onRoleChange(false);
    try {
      await this.star.connectTo(hostId);
    } catch {
      return false;
    }
    if (this.isClosed()) return false;
    this.lastHostMessage = RoomClock.local();
    this.pingCount = 0;
    this.nextPingAt = 0;
    const welcomed = new Promise<boolean>((resolve) => {
      this.welcomeWaiter = resolve;
      window.setTimeout(() => resolve(false), WELCOME_TIMEOUT_MS);
    });
    const { nick, look } = this.handlers.profile();
    this.say({ t: 'hello', v: NET_PROTOCOL, uid: this.selfId, nick, look });
    const ok = await welcomed;
    this.welcomeWaiter = null;
    if (!ok) {
      this.star.drop(hostId);
      return false;
    }
    this.hostSaidBye = null;
    this.setStatus('online');
    this.scheduleBeat();
    if (!this.reported) {
      this.reported = true;
      // Depois de assentar (o ping já tem medidas), conta por onde passou a conexão.
      window.setTimeout(() => {
        const link = this.star.link(this.hostId);
        if (!link) return;
        void link.route().then((route) => {
          if (route !== 'unknown') void reportConnection(this.client, route, this.clock.ping || null, this.members.size).catch(() => undefined);
        });
      }, 5000);
    }
    return true;
  }

  /**
   * O dono sumiu (conexão caiu, ficou mudo, saiu). Bate o ponto, vê quem o
   * banco diz que é o dono, e: se for eu, assumo; se for outro, conecto nele;
   * se ainda for o mesmo, tento reconectar nele e peço pra assumir (o banco só
   * deixa quando ele passa 6 s sem bater o ponto).
   */
  private async recover(lostHost: string): Promise<void> {
    if (this.recovering || this.isClosed()) return;
    if (import.meta.env.DEV) console.warn(`[net] dono sumiu, recuperando (${(performance.now() / 1000).toFixed(2)} s)`);
    this.recovering = true;
    this.hostHint = null;
    this.setStatus('reconnecting');
    // Disse tchau: saiu mesmo, avisa já. Senão pode ser só a conexão piscando (a minha ou a dele): o
    // besouro dele fica parado onde estava até saber — o "welcome" de quem for o dono diz quem continua.
    if (this.hostSaidBye === lostHost && this.members.delete(lostHost)) this.handlers.onMemberLeave(lostHost);
    let triedSameHost = false;
    try {
      for (let attempt = 0; attempt < RECOVERY_TRIES && !this.isClosed(); attempt++) {
        if (attempt > 0) await this.waitForHint(attempt < RECOVERY_FAST_TRIES ? 1000 : 2000);
        // Atalho: alguém já anunciou que assumiu.
        const hint = this.hostHint;
        this.hostHint = null;
        if (hint && hint !== lostHost && hint !== this.selfId && (await this.connectToHost(hint))) return;
        const hb = await heartbeat(this.client, this.room.id).catch(() => null);
        if (this.isClosed()) return;
        if (!hb) continue;
        if (!hb.member) {
          const again = await joinRoom(this.client, this.room.code).catch(() => null);
          if (!again?.ok) {
            this.shutdown(again && !again.ok && again.error === 'room_full' ? 'full' : 'lost', `recuperação: não é mais membro e reentrar deu ${again ? again.error : 'sem rede'}`);
            return;
          }
          this.room = again.room;
          continue;
        }
        let host = hb.hostId;
        if (import.meta.env.DEV) console.warn(`[net] recuperação ${attempt}: banco diz dono=${host === this.selfId ? 'eu' : host === lostHost ? 'o que sumiu' : 'outro'} (${(performance.now() / 1000).toFixed(2)} s)`);
        // Fui eu que congelei (celular em segundo plano): o dono provavelmente está bem; tenta nele logo de cara, uma vez.
        if (host === lostHost && !triedSameHost && this.justThawed()) {
          triedSameHost = true;
          if (await this.connectToHost(host)) return;
          continue;
        }
        // O banco já me passou a sala (o dono saiu pelo botão): ele saiu de verdade.
        const passedToMe = host === this.selfId;
        // Ordem de chegada: o primeiro da fila tenta assumir já; os outros esperam a vez dele.
        const queue = this.memberList.filter((m) => m.uid !== lostHost).map((m) => m.uid);
        const myTurn = queue.indexOf(this.selfId) <= Math.floor(attempt / 3);
        if (host === lostHost && myTurn) host = (await claimHost(this.client, this.room.id).catch(() => null)) ?? host;
        if (host === this.selfId) {
          this.becomeHost(false, passedToMe ? lostHost : null);
          return;
        }
        // O mesmo dono de antes: só tenta reconectar nele depois de um tempo (se ele tivesse
        // morrido, outro já teria assumido); até lá, bater nele só gastaria a espera do "answer".
        if (host && (host !== lostHost || attempt >= RECOVERY_SAME_HOST_FROM) && (await this.connectToHost(host))) return;
      }
      if (this._status !== 'online' && !this.isClosed()) this.shutdown('lost', 'recuperação: acabaram as tentativas');
    } finally {
      this.recovering = false;
    }
  }

  /** Espera até `ms`, ou menos se chegar o anúncio de um dono novo. */
  private async waitForHint(ms: number): Promise<void> {
    const until = performance.now() + ms;
    while (performance.now() < until && !this.hostHint && !this.isClosed()) await sleep(100);
  }

  private linkClosed(peer: string): void {
    if (this.isClosed() || this.leaving) return;
    if (this._isHost) {
      this.budgets.delete(peer);
      // Caiu sem tchau: pode ser só a rede piscando. A vaga espera ele voltar (ver `AWAY_GRACE_S`).
      if (this.members.has(peer) && !this.away.has(peer)) {
        if (import.meta.env.DEV) console.warn(`[net] conexão com ${this.members.get(peer)?.nick} caiu: vaga guardada`);
        this.away.set(peer, RoomClock.local() + AWAY_GRACE_S);
      }
    } else if (peer === this.hostId && this._status === 'online') {
      void this.recover(peer);
    }
  }

  private scheduleBeat(): void {
    window.clearInterval(this.beatTimer);
    this.beatTimer = window.setInterval(() => void this.beat(), this._isHost ? HOST_BEAT_MS : CLIENT_BEAT_MS);
  }

  /** Bate o ponto no banco. A resposta também avisa troca de dono feita por outro caminho. */
  private async beat(): Promise<void> {
    if (this.isClosed() || this.recovering) return;
    const session = await this.client.auth.getSession().catch(() => null);
    this.accessToken = session?.data.session?.access_token ?? this.accessToken;
    const hb = await heartbeat(this.client, this.room.id).catch(() => null);
    if (!hb || this.isClosed() || this.recovering) return;
    if (!hb.member) {
      // A vaga expirou (aba dormindo muito tempo): entra de novo pelo código.
      const again = await joinRoom(this.client, this.room.code).catch(() => null);
      if (!again?.ok) this.shutdown('lost', `ponto: vaga expirou e reentrar deu ${again ? again.error : 'sem rede'}`);
      return;
    }
    if (!hb.hostId || hb.hostId === this.hostId) return;
    if (hb.hostId === this.selfId) {
      // O banco me passou a sala sem eu pedir: o dono saiu pelo botão (e o tchau se perdeu).
      this.becomeHost(false, this.hostId);
    } else {
      // Outro virou dono (eu inclusive posso ter caído e voltado): vou pra ele.
      const target = hb.hostId;
      this.setStatus('reconnecting');
      if (!(await this.connectToHost(target))) void this.recover(target);
    }
  }

  private tick(): void {
    if (this.isClosed()) return;
    this.clock.update(TICK_MS / 1000);
    const now = RoomClock.local();
    const gap = this.lastTickAt > 0 ? now - this.lastTickAt : 0;
    this.lastTickAt = now;
    if (gap > STALL_S) this.thaw(gap - TICK_MS / 1000, now);
    if (this._isHost) {
      // Recarrega o limite de cada um e derruba quem ficou mudo demais.
      const refill = TICK_MS / 1000;
      for (const [peer, budget] of this.budgets) {
        budget.state = Math.min(STATE_RATE, budget.state + STATE_RATE * refill);
        budget.event = Math.min(EVENT_RATE * 2, budget.event + EVENT_RATE * refill);
        if (now - budget.lastSeen > PEER_SILENCE_S) this.star.drop(peer);
      }
      // Quem caiu e não voltou a tempo: agora sim, saiu.
      for (const [uid, deadline] of this.away) if (now > deadline) this.dropMember(uid);
      return;
    }
    if (this._status !== 'online') return;
    if (now - this.lastHostMessage > HOST_SILENCE_S) {
      this.star.drop(this.hostId);
      void this.recover(this.hostId);
      return;
    }
    // Relógio: 6 medidas rápidas pra acertar logo, depois uma a cada 2 s.
    if (now >= this.nextPingAt) {
      this.pingCount++;
      this.nextPingAt = now + (this.pingCount < 6 ? 0.25 : 2);
      this.say({ t: 'ping', c: now });
    }
  }

  /**
   * Esta página ficou congelada `frozen` segundos (celular com o jogo em
   * segundo plano, travada longa): quem sumiu fui eu, não os outros. O que
   * ficou parado na fila ainda vai chegar: o silêncio de cada um ganha um
   * fôlego curto antes de contar (se a conexão morreu mesmo, a queda aparece
   * logo). E a vaga guardada de quem caiu não gasta o tempo em que eu não
   * podia receber ninguém.
   */
  /**
   * Esta página acabou de voltar de um congelamento? Vale também quando o
   * tique ainda nem rodou (a queda da conexão às vezes chega antes dele).
   */
  private justThawed(): boolean {
    const now = RoomClock.local();
    return now - this.thawedAt < STALL_MEMORY_S || (this.lastTickAt > 0 && now - this.lastTickAt > STALL_S);
  }

  private thaw(frozen: number, now: number): void {
    if (import.meta.env.DEV) console.warn(`[net] página congelou ${frozen.toFixed(1)} s`);
    this.thawedAt = now;
    this.lastHostMessage = Math.max(this.lastHostMessage, now - HOST_SILENCE_S + THAW_GRACE_S);
    for (const budget of this.budgets.values()) budget.lastSeen = Math.max(budget.lastSeen, now - PEER_SILENCE_S + THAW_GRACE_S);
    for (const [uid, deadline] of this.away) this.away.set(uid, deadline + frozen);
  }

  // --- Receber ------------------------------------------------------------------------

  /** Dono: confere o limite, valida, carimba quem mandou e repassa pros outros. */
  private hostReceive(peer: string, lane: Lane, data: ArrayBuffer | string): void {
    const budget = this.budgets.get(peer);
    if (!budget) return;
    budget.lastSeen = RoomClock.local();
    if (lane === 'state') {
      if (budget.state < 1) return;
      budget.state -= 1;
      const member = this.members.get(peer);
      if (!member || typeof data === 'string' || data.byteLength < 2) return;
      stampSnapshotSlot(data, member.slot);
      const snapshot = decodeSnapshot(data);
      if (!snapshot) return this.strike(peer, budget);
      this.star.broadcast('state', data, peer);
      this.handlers.onSnapshot(snapshot);
      return;
    }
    if (budget.event < 1) return;
    budget.event -= 1;
    if (typeof data !== 'string') return this.strike(peer, budget);
    const event = parseEvent(data);
    if (!event || !CLIENT_EVENTS.has(event.t)) return this.strike(peer, budget);
    switch (event.t) {
      case 'hello':
        this.admit(peer, event);
        return;
      case 'ping':
        this.star.send(peer, 'event', JSON.stringify({ t: 'pong', c: event.c, h: this.clock.now() } satisfies NetEvent));
        return;
      case 'bye':
        // Saiu de verdade (botão "Sair", fechou a aba): avisa já, sem guardar a vaga.
        this.dropMember(peer);
        this.star.drop(peer);
        return;
      default: {
        if (!this.members.has(peer)) return;
        const stamped = { ...event, from: peer } as NetEvent;
        if (RELAYED_EVENTS.has(event.t)) this.star.broadcast('event', JSON.stringify(stamped), peer);
        this.handlers.onEvent(stamped, peer);
      }
    }
  }

  /** Dono: alguém se apresentou. Dá a vaga (a mesma, se é reconexão), manda o mundo e avisa os outros. */
  private admit(peer: string, hello: Extract<NetEvent, { t: 'hello' }>): void {
    if (hello.uid !== peer || hello.v !== NET_PROTOCOL) {
      this.star.drop(peer);
      return;
    }
    const known = this.members.get(peer);
    let slot = known?.slot ?? -1;
    if (slot < 0) {
      const taken = new Set([...this.members.values()].map((m) => m.slot));
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (!taken.has(s)) {
          slot = s;
          break;
        }
      }
    }
    if (slot < 0) {
      this.star.drop(peer);
      return;
    }
    const member: NetMember = { uid: peer, slot, nick: hello.nick.slice(0, 16), look: hello.look, joinedAt: known?.joinedAt ?? this.clock.now() };
    this.members.set(peer, member);
    this.away.delete(peer);
    this.star.send(peer, 'event', JSON.stringify({ t: 'welcome', slot, hostTime: this.clock.now(), members: this.memberList, world: this.handlers.world() } satisfies NetEvent));
    this.star.broadcast('event', JSON.stringify({ t: 'join', member } satisfies NetEvent), peer);
    if (known) this.handlers.onMemberReturn(member);
    else this.handlers.onMemberJoin(member);
  }

  /** Dono: `uid` saiu de vez (disse tchau, ou não voltou a tempo). A vaga libera e a sala fica sabendo. */
  private dropMember(uid: string): void {
    this.away.delete(uid);
    const member = this.members.get(uid);
    if (!member) return;
    if (import.meta.env.DEV) console.warn(`[net] ${member.nick} saiu da sala`);
    this.members.delete(uid);
    this.star.broadcast('event', JSON.stringify({ t: 'leave', uid } satisfies NetEvent));
    this.handlers.onMemberLeave(uid);
  }

  /** Jogador: tudo vem do dono. */
  private clientReceive(peer: string, lane: Lane, data: ArrayBuffer | string): void {
    if (peer !== this.hostId) return;
    this.lastHostMessage = RoomClock.local();
    if (lane === 'state') {
      if (typeof data === 'string') return;
      const snapshot = decodeSnapshot(data);
      if (snapshot && snapshot.slot !== this._slot) this.handlers.onSnapshot(snapshot);
      return;
    }
    if (typeof data !== 'string') return;
    const event = parseEvent(data);
    if (!event) return;
    switch (event.t) {
      case 'welcome': {
        this._slot = event.slot;
        this.clock.seed(event.hostTime);
        const before = new Set(this.members.keys());
        this.members.clear();
        for (const m of event.members) this.members.set(m.uid, m);
        for (const uid of before) if (!this.members.has(uid)) this.handlers.onMemberLeave(uid);
        this.handlers.onWelcome({ slot: event.slot, members: this.memberList, world: event.world, isHost: false });
        this.welcomeWaiter?.(true);
        return;
      }
      case 'join': {
        if (event.member.uid === this.selfId) return;
        const known = this.members.has(event.member.uid);
        this.members.set(event.member.uid, event.member);
        if (known) this.handlers.onMemberReturn(event.member);
        else this.handlers.onMemberJoin(event.member);
        return;
      }
      case 'leave':
        if (this.members.delete(event.uid)) this.handlers.onMemberLeave(event.uid);
        return;
      case 'pong':
        this.clock.addSample(event.c, event.h);
        return;
      case 'bye':
        // O dono avisou que está saindo: já parte pra recuperação (sem esperar o silêncio), e ele sai da lista na hora.
        this.hostSaidBye = this.hostId;
        this.star.drop(this.hostId);
        return;
      default:
        this.handlers.onEvent(event, 'from' in event && event.from ? event.from : this.hostId);
    }
  }

  private strike(peer: string, budget: PeerBudget): void {
    budget.strikes++;
    if (budget.strikes > 20) this.star.drop(peer);
  }

  /** Mensagem minha pelo canal confiável (pro dono, ou pra todos se sou o dono). */
  private say(event: NetEvent): void {
    const text = JSON.stringify(event);
    if (this._isHost) this.star?.broadcast('event', text);
    else this.star?.send(this.hostId, 'event', text);
  }

  /** Fechou? (método, não comparação direta: o status muda no meio dos `await`.) */
  private isClosed(): boolean {
    return this._status === 'closed';
  }

  private setStatus(status: SessionStatus, reason?: CloseReason): void {
    if (this._status === status && status !== 'closed') return;
    this._status = status;
    this.handlers.onStatus(status, reason);
  }

  private shutdown(reason: CloseReason, detail = ''): void {
    if (this.isClosed()) return;
    // Em desenvolvimento, o motivo aparece no console (os testes de várias abas leem de lá).
    if (import.meta.env.DEV) {
      const where = new Error().stack?.split('\n').slice(2, 7).join(' <- ') ?? '';
      console.warn(`[net] sessão fechou: ${reason}${detail ? ` (${detail})` : ''} ${where}`);
    }
    window.clearInterval(this.tickTimer);
    window.clearInterval(this.beatTimer);
    window.removeEventListener('pagehide', this.onPageHide);
    this.welcomeWaiter?.(false);
    this.star?.close();
    void this.channel?.close();
    this.setStatus('closed', reason);
  }

  /** Fechando a aba: avisa quem está conectado e libera a vaga (sem esperar resposta). */
  private readonly onPageHide = (): void => {
    this.say({ t: 'bye' });
    if (this.accessToken) leaveRoomOnUnload(this.accessToken);
    this.shutdown('left');
  };
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
