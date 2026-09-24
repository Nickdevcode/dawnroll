import type { SupabaseClient } from '@supabase/supabase-js';
import { emptySave, parseSave, writeSave, type SaveData } from '../core/save';
import { hasProgress, mergeSaves, sameSave } from './saveMerge';
import { readSyncMeta, writeSyncMeta, type SyncMeta } from './storage';

/** Quem tem o save que está rodando no jogo. */
export interface SaveHost {
  /** O save vivo (o mesmo objeto que o jogo usa). */
  readonly save: SaveData;
  /** Troca o conteúdo do save vivo e redesenha o que depende dele (HUD, menu, visual). */
  replaceSave(next: SaveData): void;
}

export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'offline';

interface PutResult {
  conflict: boolean;
  revision: number;
  data?: unknown;
}

/** Espera depois da última mudança antes de subir (várias mudanças seguidas viram uma gravação). */
const PUSH_DELAY_MS = 3000;
/** Mesmo mudando sem parar, sobe pelo menos a cada tanto. */
const PUSH_MAX_WAIT_MS = 15_000;
/** Sem internet: tenta de novo com espera crescente. */
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 120_000;
/** Duas gravações ao mesmo tempo (dois aparelhos): junta e tenta de novo até tantas vezes. */
const MAX_CONFLICT_ROUNDS = 4;

/**
 * Save na nuvem. O navegador continua sendo a cópia de trabalho (o jogo nunca
 * espera a rede); a nuvem recebe o save inteiro alguns segundos depois de cada
 * mudança, com trava otimista (`put_save` + revisão): se outro aparelho gravou
 * no meio, os dois saves são juntados (`mergeSaves`) e sobe de novo.
 *
 * Ao entrar numa conta: o que já estava na nuvem se junta com o do aparelho —
 * se o do aparelho for de convidado ou da mesma conta. Save de OUTRA conta
 * nunca se mistura (o jogo zera ao sair, mas fica a guarda).
 */
export class CloudSave {
  /** Mudou o estado da sincronização (a placa da conta mostra). */
  onStatus: ((status: SyncStatus) => void) | null = null;

  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private meta: SyncMeta = readSyncMeta();
  private timer = 0;
  private firstChangeAt = 0;
  private retryMs = RETRY_MIN_MS;
  private pushing: Promise<void> | null = null;
  /**
   * Sobe a cada gravação do jogo (`changed`). Quem sobe o save compara este
   * número antes e depois, e não o save vivo: o jogo mexe em contadores de
   * movimento a cada passo sem gravar, e comparar o objeto fazia a nuvem receber
   * o save a cada 3 s enquanto a bola rolava.
   */
  private localVersion = 0;
  /** Muda a cada entrar/sair: resposta que volta de uma sessão antiga é ignorada. */
  private epoch = 0;
  private _status: SyncStatus = 'idle';
  private _lastSavedAt: number | null = null;

  constructor(private readonly host: SaveHost) {
    window.addEventListener('online', () => this.schedule(0));
  }

  get status(): SyncStatus {
    return this._status;
  }

  /** Quando a nuvem confirmou a última gravação (ms desde 1970). */
  get lastSavedAt(): number | null {
    return this._lastSavedAt;
  }

  /** Tem mudança do aparelho que a nuvem ainda não confirmou? */
  get hasPendingChanges(): boolean {
    return this.meta.dirty;
  }

  /**
   * Conta aberta: busca o save da nuvem, junta com o do aparelho quando pode e
   * sobe o resultado. Devolve o save de convidado que foi trazido pra conta (pra
   * importar os enterros dele no ranking), ou null.
   */
  async attach(client: SupabaseClient, userId: string): Promise<SaveData | null> {
    const epoch = ++this.epoch;
    this.client = client;
    this.userId = userId;
    const local = this.host.save;
    const ownedByOther = this.meta.userId !== null && this.meta.userId !== userId;
    const guest = this.meta.userId === null && hasProgress(local) ? structuredClone(local) : null;
    const base = ownedByOther ? emptySave() : local;

    this.setStatus('syncing');
    const { data, error } = await client.from('saves').select('data, revision').eq('user_id', userId).maybeSingle();
    if (this.epoch !== epoch) return null;
    if (error) {
      // Sem internet na hora de entrar: continua local e tenta subir depois (com a revisão
      // desconhecida, a primeira gravação dá conflito e junta com a da nuvem — nada se perde).
      if (ownedByOther) this.apply(emptySave());
      this.meta = { userId, revision: this.meta.userId === userId ? this.meta.revision : 0, dirty: true };
      writeSyncMeta(this.meta);
      this.setStatus('offline');
      this.schedule(this.retryMs);
      return guest;
    }

    if (data) {
      const cloud = parseSave(data.data);
      const canMerge = !ownedByOther && (this.meta.userId === userId || guest !== null);
      const next = canMerge ? mergeSaves(base, cloud) : cloud;
      if (!sameSave(next, local)) this.apply(next);
      this.meta = { userId, revision: data.revision as number, dirty: !sameSave(next, cloud) };
    } else {
      if (base !== local) this.apply(base);
      this.meta = { userId, revision: 0, dirty: true };
    }
    writeSyncMeta(this.meta);
    if (this.meta.dirty) await this.push();
    else this.markSaved();
    return guest;
  }

  /**
   * Saiu da conta. `keepLocal` = o save do aparelho continua (vira de convidado:
   * foi o caso de excluir a conta); senão o aparelho volta pro começo — o
   * progresso fica guardado na conta.
   */
  detach(keepLocal: boolean): void {
    this.epoch++;
    window.clearTimeout(this.timer);
    this.client = null;
    this.userId = null;
    this.firstChangeAt = 0;
    this.meta = { userId: null, revision: 0, dirty: false };
    writeSyncMeta(this.meta);
    if (!keepLocal) this.apply(emptySave());
    this._lastSavedAt = null;
    this.setStatus('idle');
  }

  /**
   * A sessão caiu sozinha (expirou, saiu em outro aparelho): para de subir, mas o
   * save continua marcado como da conta — entrando nela de novo, junta e sobe.
   */
  suspend(): void {
    this.epoch++;
    window.clearTimeout(this.timer);
    this.client = null;
    this.userId = null;
    this.firstChangeAt = 0;
    this.setStatus('idle');
  }

  /** O jogo gravou o save local: sobe daqui a pouco. */
  changed(): void {
    this.localVersion++;
    if (!this.userId) return;
    if (!this.meta.dirty) {
      this.meta.dirty = true;
      writeSyncMeta(this.meta);
    }
    const now = performance.now();
    if (this.firstChangeAt === 0) this.firstChangeAt = now;
    const waited = now - this.firstChangeAt;
    this.schedule(Math.max(0, Math.min(PUSH_DELAY_MS, PUSH_MAX_WAIT_MS - waited)));
  }

  /** Sobe já o que estiver pendente (fechando o jogo, saindo da conta). */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.meta.dirty) await this.push();
    else await this.pushing;
  }

  /**
   * Voltou pro jogo depois de um tempo em outra aba/app: se não tem nada local
   * pra subir, confere se outro aparelho mexeu na nuvem.
   */
  async refresh(): Promise<void> {
    const client = this.client;
    const userId = this.userId;
    if (!client || !userId || this.pushing) return;
    if (this.meta.dirty) {
      await this.push();
      return;
    }
    const epoch = this.epoch;
    const { data, error } = await client.from('saves').select('data, revision').eq('user_id', userId).maybeSingle();
    if (error || !data || this.epoch !== epoch || this.meta.dirty) return;
    if ((data.revision as number) === this.meta.revision) return;
    const merged = mergeSaves(this.host.save, parseSave(data.data));
    if (!sameSave(merged, this.host.save)) this.apply(merged);
    this.meta = { userId, revision: data.revision as number, dirty: !sameSave(merged, parseSave(data.data)) };
    writeSyncMeta(this.meta);
    if (this.meta.dirty) this.schedule(0);
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    if (!this.client || !this.meta.dirty) return;
    this.timer = window.setTimeout(() => void this.push(), delay);
  }

  /** Uma gravação por vez; a que chegar no meio espera e sobe o estado mais novo. */
  private push(): Promise<void> {
    if (this.pushing) return this.pushing.then(() => (this.meta.dirty ? this.push() : undefined));
    this.pushing = this.pushNow().finally(() => (this.pushing = null));
    return this.pushing;
  }

  private async pushNow(): Promise<void> {
    const client = this.client;
    const userId = this.userId;
    if (!client || !userId) return;
    const epoch = this.epoch;
    this.firstChangeAt = 0;
    this.setStatus('syncing');
    try {
      for (let round = 0; round < MAX_CONFLICT_ROUNDS; round++) {
        const version = this.localVersion;
        const snapshot = structuredClone(this.host.save);
        const { data, error } = await client.rpc('put_save', { p_data: snapshot, p_base_revision: this.meta.revision });
        if (error) throw error;
        if (this.epoch !== epoch) return;
        const result = data as PutResult;
        if (!result.conflict) {
          // O jogo gravou de novo enquanto subia? Continua sujo e sobe daqui a pouco.
          const changedMeanwhile = this.localVersion !== version;
          this.meta = { userId, revision: result.revision, dirty: changedMeanwhile };
          writeSyncMeta(this.meta);
          this.retryMs = RETRY_MIN_MS;
          this.markSaved();
          if (changedMeanwhile) this.schedule(PUSH_DELAY_MS);
          return;
        }
        // Outro aparelho gravou antes: junta com o de lá e tenta com a revisão nova.
        const theirs = result.data ? parseSave(result.data) : null;
        if (theirs) {
          const merged = mergeSaves(this.host.save, theirs);
          if (!sameSave(merged, this.host.save)) this.apply(merged);
        }
        this.meta = { userId, revision: result.revision, dirty: true };
        writeSyncMeta(this.meta);
      }
      throw new Error('conflito persistente ao gravar o save');
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[online] save não subiu', error);
      if (this.epoch !== epoch) return;
      this.setStatus('offline');
      this.schedule(this.retryMs);
      this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    }
  }

  /** Troca o save do jogo e grava no navegador (a cópia local acompanha sempre). */
  private apply(next: SaveData): void {
    this.host.replaceSave(next);
    writeSave(this.host.save);
  }

  private markSaved(): void {
    this._lastSavedAt = Date.now();
    this.setStatus('saved');
  }

  private setStatus(status: SyncStatus): void {
    if (this._status === status && status !== 'saved') return;
    this._status = status;
    this.onStatus?.(status);
  }
}
