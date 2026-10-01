import { deviceTier, gpu, QUALITY_TIERS, type QualityTier } from './device';

/**
 * Degrau que o "Auto" aprendeu neste aparelho. Fica guardado junto com o nome
 * da placa de vídeo: trocou de placa (ou de navegador que conta outro nome), o
 * palpite recomeça do zero.
 */
const KEY = 'dawnroll:qualidade-auto:v1';

interface Learned {
  gpu: string;
  tier: QualityTier;
}

function readLearned(): QualityTier | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Learned>;
    if (data.gpu !== gpu.renderer || !QUALITY_TIERS.includes(data.tier as QualityTier)) return null;
    return data.tier as QualityTier;
  } catch {
    return null;
  }
}

/** Guarda o degrau que funcionou (a próxima partida já começa nele). */
export function saveLearnedTier(tier: QualityTier): void {
  try {
    const data: Learned = { gpu: gpu.renderer, tier };
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Armazenamento cheio ou bloqueado: a adaptação recomeça do palpite na próxima vez.
  }
}

/** Onde o "Auto" começa: o que este aparelho já aprendeu, senão o palpite pela placa. */
export function autoStartTier(): QualityTier {
  return readLearned() ?? deviceTier;
}
