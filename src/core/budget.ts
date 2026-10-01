import { sceneBudget, type QualityTier, type SceneBudget } from './device';
import { currentAutoTier, settings, type GraphicsSettings } from './settings';

/** Degrau mais parecido com um ajuste personalizado (pelo que ele liga de mais caro). */
function nearestTier(g: Readonly<GraphicsSettings>): QualityTier {
  if (g.ambientOcclusion) return g.shadows === 'ultra' ? 'ultra' : 'high';
  if (g.bloom || g.msaa > 0 || g.reflections) return 'medium';
  return g.shadows === 'off' ? 'minimum' : 'low';
}

/** Degrau das configurações de agora (o do Auto, a predefinição ou o mais parecido com o personalizado). */
export function effectiveTier(): QualityTier {
  const s = settings.get();
  if (s.quality === 'auto') return currentAutoTier();
  if (s.quality === 'custom') return nearestTier(s);
  return s.quality;
}

/**
 * Orçamentos da montagem do mundo, decididos na abertura: malha do chão,
 * enfeites, partículas e teto de coisas grudadas não se remontam no meio do
 * jogo (trocar a qualidade depois vale pra resolução, sombra e efeitos na
 * hora; isso aqui, na próxima vez que o jogo abrir). Os bichos seguem o degrau
 * de cada jardim novo (`sceneBudget(effectiveTier()).critters`).
 */
export const budget: Readonly<SceneBudget> = sceneBudget(effectiveTier());
