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
  shadowMapSize: number;
  msaaSamples: number;
  grassCount: number;
}

export const quality: QualityProfile = isTouchDevice
  ? { maxPixelRatio: 1.5, ambientOcclusion: false, shadowMapSize: 1024, msaaSamples: 2, grassCount: 1700 }
  : { maxPixelRatio: 1.75, ambientOcclusion: true, shadowMapSize: 2048, msaaSamples: 4, grassCount: 3200 };
