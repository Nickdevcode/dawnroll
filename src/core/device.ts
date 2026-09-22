/**
 * Perfil do aparelho, decidido uma vez no carregamento.
 * "Mobile" = tela de toque com ponteiro grosso: GPU mais fraca, sem mouse, sem pointer lock.
 */
export const isTouchDevice: boolean =
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

export interface QualityProfile {
  /** Teto do devicePixelRatio. */
  maxPixelRatio: number;
  /** Oclusão ambiente (GTAO) — o maior custo do pós-processamento. */
  ambientOcclusion: boolean;
  /** Desfoque de profundidade "miniatura" (usa a profundidade do GTAO; sem AO, sem DOF). */
  depthOfField: boolean;
  bloom: boolean;
  shadowMapSize: number;
  msaaSamples: number;
  /** Tufos de grama (o LOD por distância desenha só uma fração dos distantes). */
  grassCount: number;
  /** Multiplicador da quantidade de enfeites sem colisão (trevos, folhas caídas, pedrinhas...). */
  decorDensity: number;
  /** Resolução da malha visual do terreno (segmentos por lado). */
  terrainSegments: number;
  /** Bichinhos de ambiente (borboletas, abelhas, joaninhas...). */
  critters: number;
  /** Partículas de pólen flutuando em volta da câmera. */
  motes: number;
}

export const quality: QualityProfile = isTouchDevice
  ? {
      maxPixelRatio: 1.5,
      ambientOcclusion: false,
      depthOfField: false,
      bloom: false,
      shadowMapSize: 1024,
      msaaSamples: 2,
      grassCount: 5200,
      decorDensity: 0.45,
      terrainSegments: 160,
      critters: 8,
      motes: 180,
    }
  : {
      maxPixelRatio: 1.5,
      ambientOcclusion: true,
      depthOfField: true,
      bloom: true,
      shadowMapSize: 4096,
      msaaSamples: 4,
      grassCount: 17000,
      decorDensity: 1,
      terrainSegments: 256,
      critters: 18,
      motes: 520,
    };
