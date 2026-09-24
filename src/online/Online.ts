import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { SaveData } from '../core/save';
import { BurialQueue } from './BurialQueue';
import { CloudSave, type SaveHost, type SyncStatus } from './CloudSave';
import { OK, fail, toAccountError, type AccountResult } from './authErrors';
import { fetchProviders, getClient, onlineConfigured, type AuthProviders } from './client';
import { nicknameFormatOk, type NicknameStatus } from './nicknames';

export type { SaveHost, SyncStatus } from './CloudSave';
export type { AccountError, AccountResult } from './authErrors';

/**
 * `disabled`: o build não tem Supabase (roda só local). `loading`: ainda
 * descobrindo se tem sessão. `guest`: sem conta. `signedIn`: conta aberta.
 */
export type AccountStatus = 'disabled' | 'loading' | 'guest' | 'signedIn';

export interface Profile {
  nickname: string;
  /** false = apelido sorteado (entrou pelo Google): o jogo pede pra escolher. */
  nicknameSet: boolean;
}

export interface OnlineState {
  status: AccountStatus;
  email: string | null;
  profile: Profile | null;
  /** Jeitos de entrar ligados no servidor (null = ainda não sabe). */
  providers: AuthProviders | null;
  sync: SyncStatus;
  /** Quando a nuvem confirmou a última gravação (ms desde 1970). */
  lastSavedAt: number | null;
  /** A volta do Google trouxe erro (a placa da conta mostra). */
  oauthFailed: boolean;
}

/** Abas do ranking (as mesmas do `leaderboard` no banco). */
export type Board = 'buried' | 'week' | 'mountain' | 'stickers';
export const BOARDS: readonly Board[] = ['buried', 'week', 'mountain', 'stickers'];

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  skin: string;
  value: number;
  isMe: boolean;
}

/** Quantas linhas o ranking mostra (o banco aceita até 100). */
const LEADERBOARD_SIZE = 50;
/** Ranking reaproveitado por um tempinho (abrir e fechar a placa não refaz a busca). */
const LEADERBOARD_TTL_MS = 20_000;
/** Voltar pra aba depois de pelo menos tanto tempo confere a nuvem de novo. */
const REFRESH_AFTER_MS = 30_000;
/** Saindo da conta: espera no máximo tanto o save e os enterros subirem. */
const FLUSH_TIMEOUT_MS = 4000;

const withTimeout = (promise: Promise<unknown>, ms: number) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

/**
 * Tudo que é online no jogo: conta (e-mail + senha ou Google), perfil com
 * apelido, save na nuvem (`CloudSave`), enterros no ranking (`BurialQueue`) e a
 * leitura do ranking. A interface lê `state` e chama os métodos; o jogo só avisa
 * quando o save mudou e quando uma bola foi enterrada.
 *
 * Nada disso atrasa o jogo: a biblioteca do Supabase só carrega depois do
 * jardim, e sem rede o jogo segue local (sobe quando a conexão voltar).
 */
export class Online {
  private readonly cloud: CloudSave;
  private readonly burials = new BurialQueue();
  private readonly listeners = new Set<() => void>();
  private readonly boardCache = new Map<Board, { at: number; rows: LeaderboardRow[] }>();
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  /** Sessão sendo aberta agora (evita tratar o mesmo login duas vezes). */
  private opening: string | null = null;
  /** O login em andamento (perfil + save da nuvem): sair espera ele. */
  private attaching: Promise<void> | null = null;
  private hiddenAt = 0;
  private _state: OnlineState = {
    status: onlineConfigured ? 'loading' : 'disabled',
    email: null,
    profile: null,
    providers: null,
    sync: 'idle',
    lastSavedAt: null,
    oauthFailed: false,
  };

  constructor(host: SaveHost) {
    this.cloud = new CloudSave(host);
    this.cloud.onStatus = (sync) => this.update({ sync, lastSavedAt: this.cloud.lastSavedAt });
    this.burials.onCounted = () => this.boardCache.clear();
  }

  get state(): Readonly<OnlineState> {
    return this._state;
  }

  /** Conta aberta com apelido sorteado (a janelinha do apelido aparece). */
  get needsNickname(): boolean {
    return this._state.status === 'signedIn' && this._state.profile !== null && !this._state.profile.nicknameSet;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Liga a parte online (depois que o jardim abriu). Sem Supabase no build, não faz nada. */
  async start(): Promise<void> {
    if (!onlineConfigured) return;
    const oauthFailed = this.cleanOAuthParams();
    if (oauthFailed) this.update({ oauthFailed });
    void fetchProviders()
      .then((providers) => this.update({ providers }))
      .catch(() => this.update({ providers: { email: true, google: false } }));
    try {
      const client = await getClient();
      this.client = client;
      // O callback roda segurando a trava da sessão: chamar o Supabase lá dentro trava
      // (aviso da própria documentação). Por isso o trabalho vai pro próximo tique.
      client.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => void this.handleSession(session), 0);
      });
      this.bindPageEvents();
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[online] Supabase não carregou', error);
      this.update({ status: 'guest' });
    }
  }

  /** O jogo gravou o save local. */
  saveChanged(): void {
    this.cloud.changed();
  }

  /** Bola enterrada (conta no ranking se a conta estiver aberta). */
  recordBurial(diameterCm: number): void {
    this.burials.add(diameterCm);
  }

  // --- conta ---------------------------------------------------------------------

  async signUp(email: string, password: string, nickname: string): Promise<AccountResult> {
    const client = this.client;
    if (!client) return fail('network');
    const nick = nickname.trim();
    if (!nicknameFormatOk(nick)) return fail('nicknameInvalid');
    const status = await this.checkNickname(nick);
    if (status === null) return fail('network');
    if (status !== 'ok') return fail(status === 'taken' ? 'nicknameTaken' : status === 'blocked' ? 'nicknameBlocked' : 'nicknameInvalid');
    try {
      const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { nickname: nick } } });
      if (error) return fail(toAccountError(error));
      // Com a confirmação de e-mail desligada no projeto, o cadastro já volta com sessão.
      return data.session ? OK : fail('unknown');
    } catch (error) {
      return fail(toAccountError(error));
    }
  }

  async signIn(email: string, password: string): Promise<AccountResult> {
    const client = this.client;
    if (!client) return fail('network');
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      return error ? fail(toAccountError(error)) : OK;
    } catch (error) {
      return fail(toAccountError(error));
    }
  }

  /** Vai pro Google e volta pro jogo (a página recarrega; o save local já está gravado). */
  async signInWithGoogle(): Promise<AccountResult> {
    const client = this.client;
    if (!client) return fail('network');
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
      });
      return error ? fail(toAccountError(error)) : OK;
    } catch (error) {
      return fail(toAccountError(error));
    }
  }

  /**
   * Sai da conta. O que faltava subir sobe antes; só depois de a nuvem confirmar
   * o aparelho volta pro começo (o progresso continua na conta). Sem internet,
   * não sai: devolve 'network' e nada é apagado.
   */
  async signOut(): Promise<AccountResult> {
    const client = this.client;
    if (!client || !this.userId) return OK;
    if (this.attaching) await withTimeout(this.attaching, FLUSH_TIMEOUT_MS);
    await withTimeout(Promise.all([this.cloud.flush(), this.burials.flush()]), FLUSH_TIMEOUT_MS);
    if (this.cloud.hasPendingChanges) return fail('network');
    try {
      // Antes de zerar: se o logout falhar (sem rede com a sessão vencida), a sessão continua
      // guardada e voltaria sozinha — aí não pode ter apagado o aparelho.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) return fail(toAccountError(error));
    } catch (error) {
      return fail(toAccountError(error));
    }
    this.closeSession(false);
    return OK;
  }

  /** Apaga a conta, o save da nuvem e o lugar no ranking. O progresso do aparelho continua (como convidado). */
  async deleteAccount(): Promise<AccountResult> {
    const client = this.client;
    if (!client || !this.userId) return fail('network');
    const { error } = await client.rpc('delete_account');
    if (error) return fail(toAccountError(error));
    this.closeSession(true, false, true);
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return OK;
  }

  /** Apelido livre e permitido? null = não deu pra perguntar (sem internet). */
  async checkNickname(nickname: string): Promise<NicknameStatus | null> {
    if (!nicknameFormatOk(nickname)) return 'invalid';
    const client = this.client ?? (await getClient().catch(() => null));
    if (!client) return null;
    const { data, error } = await client.rpc('check_nickname', { p_nickname: nickname.trim() });
    return error ? null : (data as NicknameStatus);
  }

  /** Troca o apelido. null = não deu pra falar com o servidor. */
  async setNickname(nickname: string): Promise<NicknameStatus | null> {
    const client = this.client;
    if (!client || !this.userId) return null;
    const nick = nickname.trim();
    if (!nicknameFormatOk(nick)) return 'invalid';
    const { data, error } = await client.rpc('set_nickname', { p_nickname: nick });
    if (error) return null;
    const status = data as NicknameStatus;
    if (status === 'ok') {
      this.update({ profile: { nickname: nick, nicknameSet: true } });
      this.boardCache.clear();
    }
    return status;
  }

  // --- ranking ---------------------------------------------------------------------

  /** Topo do ranking (e a linha de quem pergunta, se estiver fora). Joga erro sem rede. */
  async leaderboard(board: Board, force = false): Promise<LeaderboardRow[]> {
    const cached = this.boardCache.get(board);
    if (!force && cached && performance.now() - cached.at < LEADERBOARD_TTL_MS) return cached.rows;
    const client = this.client ?? (await getClient());
    const { data, error } = await client.rpc('leaderboard', { p_board: board, p_limit: LEADERBOARD_SIZE });
    if (error) throw error;
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      rank: Number(row.rank),
      nickname: String(row.nickname ?? ''),
      skin: String(row.skin ?? ''),
      value: Number(row.value),
      isMe: row.is_me === true,
    }));
    this.boardCache.set(board, { at: performance.now(), rows });
    return rows;
  }

  // ---------------------------------------------------------------------------------

  private async handleSession(session: Session | null): Promise<void> {
    const client = this.client;
    if (!client) return;
    const user = session?.user ?? null;
    if (!user) {
      // A sessão sumiu sem ser pelo "Sair" (expirou, saiu em outro lugar): o save do
      // aparelho fica guardado como da conta (volta a sincronizar se ela entrar de novo).
      if (this.userId) this.closeSession(true, true);
      if (this._state.status !== 'guest') this.update({ status: 'guest', email: null, profile: null });
      return;
    }
    if (user.id === this.userId || user.id === this.opening) {
      if (user.email && user.email !== this._state.email) this.update({ email: user.email });
      return;
    }
    this.opening = user.id;
    this.userId = user.id;
    this.update({ status: 'signedIn', email: user.email ?? null, oauthFailed: false });
    const run = (async () => {
      await this.loadProfile(client, user.id);
      // Saiu (ou trocou de conta) enquanto o perfil carregava: não amarra a nuvem numa sessão que já foi.
      if (this.userId !== user.id) return;
      const guest = await this.cloud.attach(client, user.id);
      if (this.userId !== user.id) return;
      this.burials.attach(client, user.id);
      if (guest) await this.importGuest(client, guest);
    })();
    this.attaching = run;
    try {
      await run;
    } finally {
      if (this.attaching === run) this.attaching = null;
      if (this.opening === user.id) this.opening = null;
    }
  }

  private async loadProfile(client: SupabaseClient, userId: string): Promise<void> {
    // O perfil nasce junto com a conta (trigger); se a rede falhar, tenta de novo daqui a pouco.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await client.from('profiles').select('nickname, nickname_set').eq('id', userId).maybeSingle();
      if (this.userId !== userId) return;
      if (!error && data) {
        this.update({ profile: { nickname: data.nickname as string, nicknameSet: data.nickname_set === true } });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }

  /** Enterros de antes da conta entram no ranking uma vez (o servidor põe teto e ignora repetição). */
  private async importGuest(client: SupabaseClient, guest: SaveData): Promise<void> {
    if (guest.buried <= 0) return;
    const { error } = await client.rpc('import_progress', { p_buried: guest.buried, p_total_cm: guest.totalCm });
    if (!error) this.boardCache.clear();
  }

  /**
   * Fecha a sessão no jogo. `keepLocal`: o save do aparelho continua (excluiu a
   * conta, ou a sessão caiu sozinha); `keepOwner`: continua marcado como da conta;
   * `deleted`: a conta não existe mais (a fila de enterros dela vai embora).
   */
  private closeSession(keepLocal: boolean, keepOwner = false, deleted = false): void {
    this.userId = null;
    this.opening = null;
    this.burials.detach(deleted);
    if (keepOwner) this.cloud.suspend();
    else this.cloud.detach(keepLocal);
    this.boardCache.clear();
    this.update({ status: 'guest', email: null, profile: null, sync: 'idle', lastSavedAt: null });
  }

  /** Tira ?code= / ?error= da URL depois da volta do Google (e diz se veio erro). */
  private cleanOAuthParams(): boolean {
    const url = new URL(window.location.href);
    const failed = url.searchParams.has('error') || url.hash.includes('error=');
    // O ?code= a biblioteca troca pela sessão; ela mesma lê a URL antes da limpeza (roda no createClient).
    if (!failed) return false;
    for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    return true;
  }

  private bindPageEvents(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = performance.now();
        // Fechando ou trocando de app: sobe o que der (o que não der fica marcado e sobe na próxima).
        void this.cloud.flush();
        void this.burials.flush();
        return;
      }
      if (this.hiddenAt > 0 && performance.now() - this.hiddenAt > REFRESH_AFTER_MS) void this.cloud.refresh();
    });
  }

  private update(patch: Partial<OnlineState>): void {
    this._state = { ...this._state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
