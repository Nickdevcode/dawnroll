import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  blockUser,
  dismissInvite,
  fetchFriends,
  goOfflineOnUnload,
  inviteFriend,
  liveInvites,
  parseSocialPush,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  touchPresence,
  unblockUser,
  type FriendProfile,
  type FriendRequestStatus,
  type FriendsList,
  type InviteStatus,
  type PresenceInfo,
  type PresenceStatus,
  type RoomInvite,
  type SocialPush,
} from './Friends';
import type { Online } from './Online';

export interface SocialState {
  /** A lista inteira (null = ainda não buscou, ou a conta fechou). */
  list: FriendsList | null;
  /** Buscando a lista agora. */
  loading: boolean;
  /** A última busca da lista falhou (sem rede). */
  failed: boolean;
  /** Pedidos de amizade esperando você responder. */
  requests: number;
  /** Amigos com o jogo aberto agora. */
  online: number;
  /** Convites válidos pra você (o mais novo primeiro, um por amigo). */
  invites: RoomInvite[];
  /** Canal de avisos na hora ligado (sem ele, a presença consulta mais vezes). */
  live: boolean;
  /** Convites pra turma esperando (o que a presença contou; a lista em si é da `ClanStore`). */
  clanInvites: number;
}

/** "Estou aqui" a cada tanto (a presença do banco vence em 75 s). */
const TOUCH_MS = 30_000;
/** Sem o canal de avisos e com alguém que possa chamar: consulta mais vezes (o convite vale 2 min). */
const TOUCH_FALLBACK_MS = 15_000;
/** Placa de amigos aberta: a lista (quem está onde) se atualiza sozinha. */
const WATCH_MS = 15_000;
/** Mudou de tela (menu ↔ jardim): avisa depois de um respiro (abre e fecha o menu rápido = uma chamada). */
const ACTIVITY_DEBOUNCE_MS = 1500;
/** Convidou: o botão fica "Chamado" enquanto o convite vale. */
const INVITED_MS = 120_000;
/** O canal de avisos não abriu: espera isso antes de tentar de novo (a presença cobre enquanto isso). */
const CHANNEL_RETRY_MS = 60_000;
/** Abrindo o jogo, só avisa pedido de amizade mais novo que isso (o resto fica na bolinha). */
const FRESH_REQUEST_MS = 10 * 60_000;

/**
 * O lado vivo dos amigos: com a conta aberta, avisa a presença (menu ou
 * jogando) a cada 30 s e recebe o que espera por você (pedidos, convites);
 * com alguém que possa te chamar, abre o canal privado `user:<id>` pra o aviso
 * chegar na hora. As ações da placa (pedir, aceitar, tirar, bloquear, chamar)
 * passam por aqui e atualizam a lista. A interface lê `state` e assina.
 *
 * Aba escondida não avisa presença (vira offline em ~75 s, a não ser que esteja
 * numa sala); fechar a aba avisa na hora.
 */
export class Social {
  /** Convite novo (pela presença ou pelo canal): o aviso do canto mostra. */
  onInvite: ((invite: RoomInvite) => void) | null = null;
  /** Alguém te pediu amizade (aviso na hora). */
  onRequest: ((from: FriendProfile) => void) | null = null;
  /** Alguém aceitou o seu pedido (aviso na hora). */
  onAccepted: ((from: FriendProfile) => void) | null = null;
  /** Um convite saiu (dispensado ou usado pela central): o aviso do canto some junto. */
  onWithdraw: ((inviteId: number) => void) | null = null;
  /** Chegou convite pra turma (canal) ou a contagem mudou (presença): a turma busca de novo. */
  onClanNews: (() => void) | null = null;

  private readonly listeners = new Set<() => void>();
  private _state: SocialState = { list: null, loading: false, failed: false, requests: 0, online: 0, invites: [], live: false, clanInvites: 0 };
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private accessToken: string | null = null;
  private activity: PresenceStatus = 'menu';
  private sentActivity: PresenceStatus | null = null;
  /** Tem amigo, pedido enviado ou turma (vale abrir o canal de avisos). */
  private hasPeople = false;
  /** Tem turma (colega de turma também chama pra sala). */
  private inClan = false;
  private channel: RealtimeChannel | null = null;
  /** O canal falhou: só tenta de novo depois disso (ms desde 1970). */
  private channelRetryAt = 0;
  private touchTimer = 0;
  private activityTimer = 0;
  private watchTimer = 0;
  private watchers = 0;
  private touching: Promise<void> | null = null;
  private refreshSeq = 0;
  /** Convites já avisados (o aviso não repete a cada consulta) e os dispensados (não voltam). */
  private readonly announced = new Set<number>();
  private readonly dismissed = new Set<number>();
  /** Pedidos recebidos e aceites já avisados (por id do amigo): o canal e a lista não avisam duas vezes. */
  private readonly announcedRequests = new Set<string>();
  private readonly announcedAccepts = new Set<string>();
  private readonly invitedAt = new Map<string, number>();

  constructor(private readonly online: Online) {
    online.subscribe(() => this.syncAccount());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') window.clearTimeout(this.touchTimer);
      else if (this.client) void this.touch();
    });
    window.addEventListener('pagehide', () => {
      if (this.client && this.accessToken) goOfflineOnUnload(this.accessToken);
    });
  }

  get state(): Readonly<SocialState> {
    return this._state;
  }

  /** Conta aberta (os amigos só existem com conta). */
  get ready(): boolean {
    return this.client !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** O jogo mudou de tela: no menu ou jogando. */
  setActivity(status: PresenceStatus): void {
    this.activity = status;
    window.clearTimeout(this.activityTimer);
    if (!this.client || status === this.sentActivity) return;
    this.activityTimer = window.setTimeout(() => void this.touch(), ACTIVITY_DEBOUNCE_MS);
  }

  /**
   * A placa dos amigos (ou o lobby) está aberta: a lista busca agora e se
   * atualiza sozinha enquanto alguém olha. Devolve o "parei de olhar".
   */
  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) {
      void this.refresh();
      this.watchTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void this.refresh();
      }, WATCH_MS);
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) window.clearInterval(this.watchTimer);
    };
  }

  /** Busca a lista de novo. */
  async refresh(): Promise<void> {
    const client = this.client;
    if (!client) return;
    // Duas buscas ao mesmo tempo (canal + placa): só a mais nova vale (a resposta velha não sobrescreve).
    const seq = ++this.refreshSeq;
    this.update({ loading: true });
    const list = await fetchFriends(client).catch(() => null);
    if (client !== this.client || seq !== this.refreshSeq) return;
    if (!list) {
      this.update({ loading: false, failed: true });
      return;
    }
    this.announceChanges(this._state.list, list);
    this.hasPeople = list.friends.length + list.outgoing.length > 0 || this.inClan;
    this.syncChannel();
    this.update({
      list,
      loading: false,
      failed: false,
      requests: list.incoming.length,
      online: list.friends.filter((f) => f.status !== 'offline').length,
    });
  }

  // --- Ações da placa -------------------------------------------------------------------

  async addFriend(nickname: string): Promise<{ status: FriendRequestStatus; friend: FriendProfile | null }> {
    const client = this.client;
    if (!client) return { status: 'offline', friend: null };
    const result = await sendFriendRequest(client, nickname).catch(() => ({ status: 'offline' as const, friend: null }));
    if (result.status === 'sent' || result.status === 'accepted') await this.refresh();
    return result;
  }

  async respond(userId: string, accept: boolean): Promise<boolean> {
    return this.act((client) => respondFriendRequest(client, userId, accept));
  }

  /** Tira dos amigos, cancela o pedido enviado ou recusa. */
  async remove(userId: string): Promise<boolean> {
    return this.act((client) => removeFriend(client, userId));
  }

  async block(userId: string): Promise<boolean> {
    return this.act((client) => blockUser(client, userId));
  }

  async unblock(userId: string): Promise<boolean> {
    return this.act((client) => unblockUser(client, userId));
  }

  /** Chama o amigo pra sala em que você está. */
  async invite(userId: string): Promise<InviteStatus> {
    const client = this.client;
    if (!client) return 'network';
    const status = await inviteFriend(client, userId).catch(() => 'network' as const);
    if (status === 'sent') {
      this.invitedAt.set(userId, Date.now());
      this.emit();
    } else if (status === 'offline' || status === 'in_room' || status === 'not_friend') {
      // A lista estava velha: atualiza (o amigo saiu, já entrou, deixou de ser amigo).
      void this.refresh();
    }
    return status;
  }

  /** Entrou ou saiu de uma turma: o canal de avisos abre (ou pode fechar) sem esperar a próxima presença. */
  setInClan(inClan: boolean): void {
    if (this.inClan === inClan) return;
    this.inClan = inClan;
    this.hasPeople = inClan || (this._state.list ? this._state.list.friends.length + this._state.list.outgoing.length > 0 : this.hasPeople);
    this.syncChannel();
    this.schedule();
  }

  /** Já chamou esse amigo agora há pouco (o convite ainda vale)? */
  invitedRecently(userId: string, now = Date.now()): boolean {
    const at = this.invitedAt.get(userId);
    return at !== undefined && now - at < INVITED_MS;
  }

  /** "Agora não" (ou já entrou): o convite some daqui e do banco. */
  dismiss(invite: RoomInvite): void {
    this.dismissed.add(invite.id);
    this.update({ invites: this._state.invites.filter((i) => i.id !== invite.id) });
    this.onWithdraw?.(invite.id);
    const client = this.client;
    if (client) void dismissInvite(client, invite.id).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------------------

  private async act(run: (client: SupabaseClient) => Promise<boolean>): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    const ok = await run(client).catch(() => false);
    await this.refresh();
    return ok;
  }

  /** A conta abriu, fechou ou trocou. */
  private syncAccount(): void {
    const player = this.online.player;
    const id = player?.userId ?? null;
    if (id === this.userId) return;
    this.stop();
    if (!player) return;
    this.client = player.client;
    this.userId = player.userId;
    void this.touch();
    void this.refresh();
  }

  private stop(): void {
    window.clearTimeout(this.touchTimer);
    window.clearTimeout(this.activityTimer);
    this.closeChannel();
    this.client = null;
    this.userId = null;
    this.accessToken = null;
    this.sentActivity = null;
    this.hasPeople = false;
    this.inClan = false;
    this.announced.clear();
    this.dismissed.clear();
    this.announcedRequests.clear();
    this.announcedAccepts.clear();
    this.invitedAt.clear();
    this._state = { list: null, loading: false, failed: false, requests: 0, online: 0, invites: [], live: false, clanInvites: 0 };
    this.emit();
  }

  /** "Estou aqui" + o que espera por você. Uma de cada vez; reagenda a próxima. */
  private touch(): Promise<void> {
    if (this.touching) return this.touching;
    const run = (async () => {
      const client = this.client;
      if (!client) return;
      window.clearTimeout(this.touchTimer);
      window.clearTimeout(this.activityTimer);
      const session = await client.auth.getSession().catch(() => null);
      this.accessToken = session?.data.session?.access_token ?? this.accessToken;
      const activity = this.activity;
      const info = await touchPresence(client, activity).catch(() => null);
      if (client !== this.client) return;
      if (info) {
        this.sentActivity = activity;
        this.absorb(info);
      }
      this.schedule();
    })();
    this.touching = run;
    void run.finally(() => {
      if (this.touching === run) this.touching = null;
    });
    return run;
  }

  private schedule(): void {
    window.clearTimeout(this.touchTimer);
    if (!this.client || document.visibilityState === 'hidden') return;
    const ms = this.hasPeople && !this._state.live ? TOUCH_FALLBACK_MS : TOUCH_MS;
    this.touchTimer = window.setTimeout(() => void this.touch(), ms);
  }

  /** O que a presença trouxe: contadores, convites (o banco manda os válidos) e o canal. */
  private absorb(info: PresenceInfo): void {
    const hadPeople = this.hasPeople;
    this.inClan = info.clan;
    this.hasPeople = info.friends > 0 || info.clan;
    const requestsGrew = info.requests > this._state.requests;
    const clanChanged = info.clanInvites !== this._state.clanInvites;
    const invites = liveInvites(info.invites.filter((i) => !this.dismissed.has(i.id)));
    this.update({ requests: info.requests, online: info.online, invites, clanInvites: info.clanInvites });
    if (clanChanged) this.onClanNews?.();
    this.announce(invites);
    this.syncChannel();
    // Chegou pedido sem o canal: a lista vem (e o aviso sai dela). Amigo novo/aceito: a lista aberta acompanha.
    if (requestsGrew || (this.watchers > 0 && hadPeople !== this.hasPeople)) void this.refresh();
  }

  /**
   * O que mudou entre uma lista e a próxima vira aviso (vale tanto pro que veio
   * pelo canal quanto pelo que a consulta periódica achou): pedido novo e pedido
   * seu que virou amizade. Na primeira lista da sessão, só o pedido mais novo
   * avisa, e só se for recente (pedido velho não fica aparecendo a cada vez que
   * abre o jogo: a bolinha conta); um aviso já dado pelo canal não repete.
   */
  private announceChanges(before: FriendsList | null, after: FriendsList): void {
    const fresh = Date.now() - FRESH_REQUEST_MS;
    const candidates = before ? after.incoming : after.incoming.slice(0, 1).filter((r) => r.at > fresh);
    const incoming = candidates.filter((r) => !this.announcedRequests.has(r.id));
    for (const request of after.incoming) this.announcedRequests.add(request.id);
    for (const request of incoming) this.onRequest?.(request);
    if (!before) return;
    const friends = new Set(after.friends.map((f) => f.id));
    for (const request of before.outgoing) {
      if (!friends.has(request.id) || this.announcedAccepts.has(request.id)) continue;
      this.announcedAccepts.add(request.id);
      this.onAccepted?.(request);
    }
  }

  private announce(invites: readonly RoomInvite[]): void {
    for (const invite of invites) {
      if (this.announced.has(invite.id)) continue;
      this.announced.add(invite.id);
      this.onInvite?.(invite);
    }
  }

  private receive(push: SocialPush): void {
    if (push.kind === 'clan_invite') {
      this.update({ clanInvites: this._state.clanInvites + 1 });
      this.onClanNews?.();
      return;
    }
    if (push.kind === 'invite') {
      if (this.dismissed.has(push.invite.id)) return;
      const invites = liveInvites([push.invite, ...this._state.invites]);
      this.update({ invites });
      this.announce(invites);
      return;
    }
    // Avisa já (o canal é o caminho rápido); a lista que vem depois não repete o aviso.
    if (push.kind === 'request') {
      if (!this.announcedRequests.has(push.from.id)) {
        this.announcedRequests.add(push.from.id);
        this.onRequest?.(push.from);
      }
      this.update({ requests: this._state.requests + 1 });
    } else if (!this.announcedAccepts.has(push.from.id)) {
      this.announcedAccepts.add(push.from.id);
      this.onAccepted?.(push.from);
    }
    void this.refresh();
  }

  // --- Canal de avisos (só com alguém que possa te chamar: não gasta conexão à toa) -------

  private syncChannel(): void {
    if (this.hasPeople && this.client && !this.channel && Date.now() >= this.channelRetryAt) void this.openChannel();
    else if (!this.hasPeople && this.channel) this.closeChannel();
  }

  private async openChannel(): Promise<void> {
    const client = this.client;
    const userId = this.userId;
    if (!client || !userId) return;
    const token = (await client.auth.getSession().catch(() => null))?.data.session?.access_token;
    if (client !== this.client || this.channel) return;
    if (token) await client.realtime.setAuth(token);
    const channel = client.channel(`user:${userId}`, { config: { private: true } });
    this.channel = channel;
    channel.on('broadcast', { event: 'social' }, ({ payload }) => {
      const push = parseSocialPush(payload);
      if (push) this.receive(push);
    });
    channel.subscribe((status) => {
      if (this.channel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.update({ live: true });
        this.schedule();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Sem canal (limite de conexões, rede): a presença consulta mais vezes e daqui a pouco tenta abrir de novo.
        this.channelRetryAt = Date.now() + CHANNEL_RETRY_MS;
        this.closeChannel();
        this.schedule();
      }
    });
  }

  private closeChannel(): void {
    const channel = this.channel;
    if (!channel) return;
    this.channel = null;
    void this.client?.removeChannel(channel).catch(() => undefined);
    if (this._state.live) this.update({ live: false });
  }

  private update(patch: Partial<SocialState>): void {
    this._state = { ...this._state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
