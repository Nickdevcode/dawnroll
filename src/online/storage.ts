/**
 * Guardadinhos da parte online no navegador (fora o save, que mora em
 * `core/save`). Tudo validado na leitura: dado estranho vira o padrão.
 */

const SYNC_KEY = 'dawnroll:nuvem:v1';
const BURIALS_KEY = 'dawnroll:enterros:v1';

/** De quem é o save deste aparelho e até onde ele já subiu pra nuvem. */
export interface SyncMeta {
  /** Conta dona do save local (null = progresso de convidado, sem conta). */
  userId: string | null;
  /** Última revisão da nuvem que este aparelho conhece (0 = nunca subiu). */
  revision: number;
  /** Tem mudança local que ainda não subiu. */
  dirty: boolean;
}

/** Enterros que ainda não chegaram no ranking (sem internet, ou rápido demais pro servidor). */
export interface PendingBurials {
  userId: string | null;
  /** Diâmetros em cm. */
  items: number[];
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento cheio ou bloqueado: vale só pra esta sessão.
  }
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

export function readSyncMeta(): SyncMeta {
  const data = read(SYNC_KEY) as Partial<SyncMeta> | null;
  return {
    userId: isId(data?.userId) ? data.userId : null,
    revision: typeof data?.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
    dirty: data?.dirty === true,
  };
}

export function writeSyncMeta(meta: SyncMeta): void {
  write(SYNC_KEY, meta);
}

/** Teto da fila (se passar disso, alguma coisa está muito errada; os mais velhos saem). */
export const MAX_PENDING_BURIALS = 200;

export function readPendingBurials(): PendingBurials {
  const data = read(BURIALS_KEY) as Partial<PendingBurials> | null;
  const items = Array.isArray(data?.items)
    ? data.items.filter((cm): cm is number => typeof cm === 'number' && Number.isFinite(cm) && cm >= 3 && cm <= 30).slice(-MAX_PENDING_BURIALS)
    : [];
  return { userId: isId(data?.userId) ? data.userId : null, items };
}

export function writePendingBurials(pending: PendingBurials): void {
  write(BURIALS_KEY, pending);
}
