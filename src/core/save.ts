/**
 * Progresso salvo no próprio navegador (localStorage): recorde e quantas bolas
 * já foram enterradas. Tudo validado na leitura — dado corrompido ou editado à
 * mão vira zero, nunca quebra o jogo. Em aba anônima/bloqueada, só não salva.
 */

export interface SaveData {
  /** Maior bola já enterrada (diâmetro em cm). */
  bestCm: number;
  /** Quantas bolas foram enterradas no total. */
  buried: number;
  /** Soma dos diâmetros enterrados (cm) — "quanta bosta" o besouro já guardou. */
  totalCm: number;
}

const KEY = 'rola-bosta:progresso:v1';

const EMPTY: SaveData = { bestCm: 0, buried: 0, totalCm: 0 };

/** Número finito, não negativo e dentro de um teto sensato. */
function sane(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : 0;
}

export function loadSave(): SaveData {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const data = JSON.parse(raw) as Partial<Record<keyof SaveData, unknown>> | null;
    if (!data || typeof data !== 'object') return { ...EMPTY };
    return {
      bestCm: sane(data.bestCm, 1000),
      buried: Math.floor(sane(data.buried, 1e7)),
      totalCm: sane(data.totalCm, 1e9),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeSave(data: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Armazenamento cheio ou bloqueado: o jogo segue sem salvar.
  }
}
