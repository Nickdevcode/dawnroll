import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_PENDING_BURIALS, readPendingBurials, writePendingBurials, type PendingBurials } from './storage';

/** O menor e o maior diâmetro que o jogo deixa enterrar (o servidor confere o mesmo). */
const MIN_CM = 3;
const MAX_CM = 30;
/** Quantos o servidor aceita por chamada. */
const BATCH = 50;
/** Espera depois de um enterro antes de mandar (junta enterros seguidos numa chamada só). */
const SEND_DELAY_MS = 1200;
/** Nova tentativa quando nada contou (ritmo, teto do dia ou sem internet): cresce até 5 min. */
const RETRY_MIN_MS = 10_000;
const RETRY_MAX_MS = 300_000;

interface RecordResult {
  counted: number;
}

/**
 * Fila de enterros a caminho do ranking. Cada bola enterrada com a conta aberta
 * entra aqui (e fica no navegador até o servidor contar), então fechar o jogo ou
 * ficar sem internet não perde enterro. O servidor conta no máximo 1 a cada 8 s
 * desde o último — o que passar do ritmo espera e vai depois.
 */
export class BurialQueue {
  /** Algum enterro acabou de contar (o ranking aberto pode recarregar). */
  onCounted: (() => void) | null = null;

  private pending: PendingBurials = readPendingBurials();
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private timer = 0;
  private retryMs = RETRY_MIN_MS;
  private sending = false;

  /** Conta aberta: a fila passa a mandar (a de outra conta, se sobrou, é descartada). */
  attach(client: SupabaseClient, userId: string): void {
    this.client = client;
    this.userId = userId;
    if (this.pending.userId !== userId) this.reset(userId);
    this.schedule(0);
  }

  /**
   * Saiu da conta: para de mandar. O que ainda não contou fica guardado com o dono
   * (volta a subir quando ele entrar de novo; outra conta entrando descarta).
   * `forget` = a conta foi excluída, não sobra nada pra mandar.
   */
  detach(forget = false): void {
    this.client = null;
    this.userId = null;
    window.clearTimeout(this.timer);
    if (forget) this.reset(null);
  }

  /** Bola enterrada com a conta aberta. */
  add(diameterCm: number): void {
    if (!this.userId) return;
    const cm = Math.round(Math.min(Math.max(diameterCm, MIN_CM), MAX_CM) * 10) / 10;
    this.pending.items.push(cm);
    if (this.pending.items.length > MAX_PENDING_BURIALS) this.pending.items.splice(0, this.pending.items.length - MAX_PENDING_BURIALS);
    writePendingBurials(this.pending);
    this.retryMs = RETRY_MIN_MS;
    this.schedule(SEND_DELAY_MS);
  }

  /** Manda o que der agora (fechando o jogo, saindo da conta). */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    await this.send();
  }

  private reset(userId: string | null): void {
    this.pending = { userId, items: [] };
    writePendingBurials(this.pending);
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    if (!this.client || this.pending.items.length === 0) return;
    this.timer = window.setTimeout(() => void this.send(), delay);
  }

  private async send(): Promise<void> {
    const client = this.client;
    if (!client || this.sending || this.pending.items.length === 0) return;
    this.sending = true;
    const batch = this.pending.items.slice(0, BATCH);
    let counted = 0;
    try {
      const { data, error } = await client.rpc('record_burials', { p_diameters: batch });
      if (error) throw error;
      counted = Math.max(0, Math.min(batch.length, (data as RecordResult | null)?.counted ?? 0));
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[online] enterros não subiram', error);
    } finally {
      this.sending = false;
    }
    // Saiu da conta no meio do caminho: o que contou, contou; a fila já foi zerada.
    if (this.client !== client) return;
    if (counted > 0) {
      this.pending.items.splice(0, counted);
      writePendingBurials(this.pending);
      this.retryMs = RETRY_MIN_MS;
      this.onCounted?.();
      // Sobrou (ritmo): o servidor libera 1 a cada 8 s.
      this.schedule(Math.min(RETRY_MAX_MS, 8_500 * Math.min(this.pending.items.length, 5)));
      return;
    }
    this.schedule(this.retryMs);
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
  }
}
