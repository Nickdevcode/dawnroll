import type { SupabaseClient } from '@supabase/supabase-js';
import {
  callClan,
  createClan,
  fetchMyClan,
  findClan,
  inviteToClan,
  joinClan,
  kickClanMember,
  leaveClan,
  promoteClanMember,
  respondClanInvite,
  setClanOpen,
  type CallClanStatus,
  type ClanCard,
  type ClanInvite,
  type ClanInviteStatus,
  type CreateClanStatus,
  type FoundClan,
  type JoinClanStatus,
  type LeaderActionStatus,
  type MyClan,
  type RespondClanStatus,
} from './Clans';
import type { Online } from './Online';
import type { Social } from './Social';

export interface ClanState {
  /** A tela Turma (null = ainda não buscou, ou a conta fechou). */
  mine: MyClan | null;
  loading: boolean;
  /** A última busca falhou (sem rede). */
  failed: boolean;
}

/** Placa da turma aberta: a lista (quem está onde, o placar) se atualiza sozinha. */
const WATCH_MS = 15_000;
/** Várias notícias seguidas (canal + presença): uma busca só. */
const NEWS_DEBOUNCE_MS = 400;
/** Abrindo o jogo, só avisa convite de turma mais novo que isso (o resto fica na bolinha). */
const FRESH_INVITE_MS = 10 * 60_000;
/** Convidou um amigo pra turma: o botão fica "Chamado" por um tempo (o convite vale 7 dias). */
const INVITED_MS = 10 * 60_000;

/**
 * O lado vivo das turmas: com a conta aberta, busca a "minha turma" (a tag tem
 * que existir antes de entrar numa sala: ela vai no visual que a sala vê), se
 * atualiza enquanto a placa está aberta e quando chega notícia (convite pelo
 * canal, contagem da presença). Convite novo vira aviso pela diferença entre
 * uma lista e a próxima (o mesmo jeito dos amigos). As ações da tela passam por
 * aqui e atualizam o estado. A interface lê `state` e assina.
 */
export class ClanStore {
  /** Convite novo pra turma (o aviso do canto mostra). */
  onInvite: ((invite: ClanInvite) => void) | null = null;

  private readonly listeners = new Set<() => void>();
  private _state: ClanState = { mine: null, loading: false, failed: false };
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private refreshSeq = 0;
  private watchers = 0;
  private watchTimer = 0;
  private newsTimer = 0;
  private readonly announced = new Set<number>();
  private readonly invitedAt = new Map<string, number>();

  constructor(
    private readonly online: Online,
    private readonly social: Social,
  ) {
    online.subscribe(() => this.syncAccount());
    social.onClanNews = () => {
      window.clearTimeout(this.newsTimer);
      this.newsTimer = window.setTimeout(() => void this.refresh(), NEWS_DEBOUNCE_MS);
    };
  }

  get state(): Readonly<ClanState> {
    return this._state;
  }

  get ready(): boolean {
    return this.client !== null;
  }

  /** Id da conta aberta (pra tela marcar "Você"). */
  get selfId(): string | null {
    return this.userId;
  }

  /** A sua turma (null = sem turma, ou ainda não sabe). */
  get clan(): ClanCard | null {
    return this._state.mine?.clan ?? null;
  }

  /** Tag que vai antes do seu apelido na sala (a escondida pela moderação não vai). */
  get tag(): string | null {
    const clan = this.clan;
    return clan && !clan.hidden ? clan.tag : null;
  }

  get isLeader(): boolean {
    return this._state.mine?.role === 'leader';
  }

  /** Convites pra turma esperando (sem turma). */
  get invites(): readonly ClanInvite[] {
    return this._state.mine?.invites ?? [];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A placa da turma está aberta: busca agora e se atualiza sozinha enquanto alguém olha. Devolve o "parei de olhar". */
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

  async refresh(): Promise<void> {
    const client = this.client;
    if (!client) return;
    // Duas buscas ao mesmo tempo: só a mais nova vale.
    const seq = ++this.refreshSeq;
    this.update({ loading: true });
    const mine = await fetchMyClan(client).catch(() => null);
    if (client !== this.client || seq !== this.refreshSeq) return;
    if (!mine) {
      this.update({ loading: false, failed: true });
      return;
    }
    this.announceChanges(this._state.mine, mine);
    this.social.setInClan(mine.clan !== null);
    this.update({ mine, loading: false, failed: false });
  }

  // --- Ações da tela ---------------------------------------------------------------------

  async create(name: string, tag: string, open: boolean): Promise<CreateClanStatus> {
    const client = this.client;
    if (!client) return 'offline';
    const { status } = await createClan(client, name, tag, open).catch(() => ({ status: 'offline' as const, clan: null }));
    if (status === 'ok' || status === 'in_clan') await this.refresh();
    return status;
  }

  async find(tag: string): Promise<{ status: 'found' | 'not_found' | 'rate_limited' | 'offline' | 'unknown'; clan: FoundClan | null }> {
    const client = this.client;
    if (!client) return { status: 'offline', clan: null };
    return findClan(client, tag).catch(() => ({ status: 'offline' as const, clan: null }));
  }

  async join(clanId: string): Promise<JoinClanStatus> {
    return this.act((client) => joinClan(client, clanId), 'offline');
  }

  async respond(invite: ClanInvite, accept: boolean): Promise<RespondClanStatus> {
    return this.act((client) => respondClanInvite(client, invite.id, accept), 'offline');
  }

  async leave(): Promise<boolean> {
    return this.act((client) => leaveClan(client), false);
  }

  async kick(userId: string): Promise<LeaderActionStatus> {
    return this.act((client) => kickClanMember(client, userId), 'offline');
  }

  async promote(userId: string): Promise<LeaderActionStatus> {
    return this.act((client) => promoteClanMember(client, userId), 'offline');
  }

  async setOpen(open: boolean): Promise<LeaderActionStatus> {
    return this.act((client) => setClanOpen(client, open), 'offline');
  }

  /** Chama um amigo pra turma. */
  async invite(userId: string): Promise<ClanInviteStatus> {
    const client = this.client;
    if (!client) return 'offline';
    const status = await inviteToClan(client, userId).catch(() => 'offline' as const);
    if (status === 'sent') {
      this.invitedAt.set(userId, Date.now());
      this.emit();
    }
    return status;
  }

  /** Já chamou esse amigo pra turma agora há pouco? */
  invitedRecently(userId: string, now = Date.now()): boolean {
    const at = this.invitedAt.get(userId);
    return at !== undefined && now - at < INVITED_MS;
  }

  /** "Jogar com a turma" dentro de uma sala: chama quem está online. */
  async call(): Promise<{ status: CallClanStatus; count: number }> {
    const client = this.client;
    if (!client) return { status: 'offline', count: 0 };
    return callClan(client).catch(() => ({ status: 'offline' as const, count: 0 }));
  }

  // ---------------------------------------------------------------------------------------

  private async act<T>(run: (client: SupabaseClient) => Promise<T>, offline: T): Promise<T> {
    const client = this.client;
    if (!client) return offline;
    const result = await run(client).catch(() => offline);
    await this.refresh();
    return result;
  }

  /** A conta abriu, fechou ou trocou. */
  private syncAccount(): void {
    const player = this.online.player;
    const id = player?.userId ?? null;
    if (id === this.userId) return;
    window.clearInterval(this.watchTimer);
    window.clearTimeout(this.newsTimer);
    this.client = player?.client ?? null;
    this.userId = id;
    this.announced.clear();
    this.invitedAt.clear();
    this._state = { mine: null, loading: false, failed: false };
    this.emit();
    if (!player) return;
    if (this.watchers > 0) {
      this.watchTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void this.refresh();
      }, WATCH_MS);
    }
    void this.refresh();
  }

  /**
   * Convite novo entre uma lista e a próxima vira aviso. Na primeira lista da
   * sessão, só o mais novo avisa, e só se for recente (convite velho não fica
   * aparecendo a cada vez que abre o jogo: a bolinha conta).
   */
  private announceChanges(before: MyClan | null, after: MyClan): void {
    const fresh = Date.now() + 7 * 86_400_000 - FRESH_INVITE_MS;
    // O banco manda quanto falta pra vencer (7 dias): convite recente = vence daqui a quase 7 dias.
    const candidates = before ? after.invites : after.invites.slice(0, 1).filter((i) => i.expiresAt > fresh);
    for (const invite of candidates) {
      if (this.announced.has(invite.id)) continue;
      this.onInvite?.(invite);
    }
    for (const invite of after.invites) this.announced.add(invite.id);
  }

  private update(patch: Partial<ClanState>): void {
    this._state = { ...this._state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
