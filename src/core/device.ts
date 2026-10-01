/**
 * Perfil do aparelho, decidido uma vez no carregamento.
 * "Mobile" = tela de toque com ponteiro grosso: GPU mais fraca, sem mouse, sem pointer lock.
 */
export const isTouchDevice: boolean =
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

/** Degraus de qualidade, do mais leve ao mais bonito. */
export type QualityTier = 'minimum' | 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_TIERS: readonly QualityTier[] = ['minimum', 'low', 'medium', 'high', 'ultra'];

/** Degrau vizinho (`step` = -1 desce, +1 sobe), preso nas pontas. */
export function stepTier(tier: QualityTier, step: -1 | 1): QualityTier {
  const i = QUALITY_TIERS.indexOf(tier) + step;
  return QUALITY_TIERS[Math.min(QUALITY_TIERS.length - 1, Math.max(0, i))];
}

function lowerOf(a: QualityTier, b: QualityTier): QualityTier {
  return QUALITY_TIERS.indexOf(a) <= QUALITY_TIERS.indexOf(b) ? a : b;
}

export interface GpuInfo {
  /** Nome da placa como o navegador conta (vazio se ele esconder). */
  renderer: string;
  /** Renderização por software (sem placa de vídeo): tudo no mínimo. */
  software: boolean;
}

/**
 * Pergunta o nome da placa de vídeo num contexto WebGL descartável (o do jogo
 * ainda não existe quando as configurações são lidas). Chrome, Edge e Safari
 * dão o nome de verdade; o Firefox dá um nome aproximado, que serve igual.
 */
function detectGpu(): GpuInfo {
  const none: GpuInfo = { renderer: '', software: false };
  if (typeof document === 'undefined') return none;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return none;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String((debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, software: /swiftshader|llvmpipe|softpipe|basic render|software/i.test(renderer) };
  } catch {
    return none;
  }
}

export const gpu: GpuInfo = detectGpu();

/** Primeiro número de 3 ou 4 dígitos depois do padrão (ex.: "adreno (tm) 640" → 640). */
function modelNumber(renderer: string, pattern: RegExp): number {
  const match = renderer.match(pattern);
  return match ? Number(match[1]) : 0;
}

/** Celular/tablet pelo chip gráfico. Nunca passa de "média": celular esquenta e baixa o clock. */
function mobileTier(r: string): QualityTier {
  if (r.includes('adreno')) {
    const n = modelNumber(r, /adreno[^\d]*(\d{3})/);
    if (n >= 730) return 'medium';
    if (n >= 610) return 'low';
    return 'minimum';
  }
  if (r.includes('immortalis') || r.includes('xclipse')) return 'medium';
  if (r.includes('mali')) {
    const n = modelNumber(r, /mali-g(\d{2,3})/);
    if (n >= 710) return 'medium';
    if (n >= 57) return 'low';
    return 'minimum';
  }
  if (r.includes('powervr')) return 'minimum';
  // iPhone/iPad ("Apple GPU"): de A12 pra cima seguram bem a média.
  if (r.includes('apple')) return 'medium';
  return 'low';
}

/** Computador pelo nome da placa. Desconhecida = média (a adaptação corrige para os dois lados). */
function desktopTier(r: string): QualityTier {
  if (r.includes('nvidia') || r.includes('geforce') || r.includes('quadro')) {
    if (/rtx|quadro|titan/.test(r)) return 'high';
    const gtx = modelNumber(r, /gtx\s*(\d{3,4})/);
    if (gtx >= 1060) return 'high';
    if (gtx >= 950) return 'medium';
    return 'low'; // MX, GT 1030, GTX antigas
  }
  if (r.includes('radeon') || r.includes('amd')) {
    const rx = modelNumber(r, /rx\s*(\d{3,4})/);
    // RX 470–590 ficam na turma da GTX 1060; RX 5000 em diante, acima.
    if ((rx >= 1000 ? rx >= 5000 : rx >= 470) || /vega\s*(56|64)|radeon vii|radeon pro/.test(r)) return 'high';
    if (rx >= 400) return 'medium';
    if (/radeon r\d|hd \d{4}/.test(r)) return 'low';
    return 'medium'; // integrada moderna ("Radeon(TM) Graphics", Vega 8, 680M...)
  }
  if (r.includes('intel')) {
    if (/arc.*a\d{3}/.test(r)) return 'high'; // Arc de mesa (A380, A770...)
    if (r.includes('arc') || r.includes('iris(r) xe') || r.includes('iris xe')) return 'medium';
    return 'low'; // HD, UHD, Iris Plus
  }
  if (r.includes('apple')) return 'high'; // Mac com M1 em diante
  if (r.includes('adreno') && /x\d-\d{2}/.test(r)) return 'medium'; // Snapdragon X (Windows ARM)
  if (r.includes('adreno') || r.includes('mali')) return 'low'; // Windows ARM antigo, Chromebook
  return 'medium';
}

/**
 * Palpite de degrau pro "Auto" antes de medir nada: placa de vídeo, núcleos e
 * memória. Nunca chuta "ultra" (isso fica pra quem escolhe ou pra adaptação,
 * que sobe um degrau quando sobra folga de verdade).
 */
function guessTier(): QualityTier {
  if (gpu.software) return 'minimum';
  const r = gpu.renderer.toLowerCase();
  const mobile = isTouchDevice && /adreno|mali|powervr|immortalis|xclipse|apple gpu/.test(r);
  let tier = mobile || (isTouchDevice && !r) ? mobileTier(r) : desktopTier(r);
  if (typeof navigator !== 'undefined') {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (cores <= 2 || memory <= 2) tier = lowerOf(tier, 'minimum');
    else if (memory <= 4 && isTouchDevice) tier = lowerOf(tier, 'low');
  }
  return tier;
}

export const deviceTier: QualityTier = guessTier();

/**
 * O que só vale na montagem do mundo (malha do chão, quantidade de bichos,
 * partículas...): muda pouco o custo por pixel, muito o custo por quadro.
 */
export interface SceneBudget {
  /** Tufos de grama (o LOD por distância desenha só uma fração dos distantes). */
  grassCount: number;
  /** Multiplicador da quantidade de enfeites sem colisão (trevos, folhas caídas, pedrinhas...). */
  decorDensity: number;
  /** Resolução da malha visual do terreno (segmentos por lado). */
  terrainSegments: number;
  /** Orçamento de bichinhos de ambiente (borboletas, abelhas, formigas...): cada espécie escala a partir dele. */
  critters: number;
  /** Partículas de pólen flutuando em volta da câmera. */
  motes: number;
  /** Riscos de chuva em volta da câmera (no pico da tempestade). */
  rainDrops: number;
  /** Respingos (anéis) que a chuva abre no chão e nas poças, por segundo, no pico. */
  rainSplashes: number;
  /** Teto de coisas grudadas visíveis na bola. */
  stuckItems: number;
  /**
   * Multiplicador do tamanho dos pedaços de grama e cobertura do chão. Pedaço
   * maior = menos draw calls (o que pesa em processador fraco), recorte mais grosso.
   */
  chunkScale: number;
  /** Lado das fatias do cenário fundido (sem sombra do sol, fatia maior: menos desenhos). */
  sceneryCell: number;
}

const DESKTOP_BUDGET: Record<QualityTier, SceneBudget> = {
  minimum: { grassCount: 17000, decorDensity: 0.35, terrainSegments: 128, critters: 10, motes: 100, rainDrops: 400, rainSplashes: 25, stuckItems: 30, chunkScale: 2, sceneryCell: 44 },
  low: { grassCount: 17000, decorDensity: 0.5, terrainSegments: 160, critters: 14, motes: 180, rainDrops: 650, rainSplashes: 40, stuckItems: 45, chunkScale: 1.5, sceneryCell: 22 },
  medium: { grassCount: 17000, decorDensity: 0.75, terrainSegments: 192, critters: 22, motes: 320, rainDrops: 1100, rainSplashes: 70, stuckItems: 60, chunkScale: 1, sceneryCell: 22 },
  high: { grassCount: 17000, decorDensity: 1, terrainSegments: 256, critters: 32, motes: 520, rainDrops: 1800, rainSplashes: 110, stuckItems: 90, chunkScale: 1, sceneryCell: 22 },
  ultra: { grassCount: 17000, decorDensity: 1, terrainSegments: 256, critters: 32, motes: 520, rainDrops: 1800, rainSplashes: 110, stuckItems: 90, chunkScale: 1, sceneryCell: 22 },
};

/** Tetos no toque (o que o celular sempre usou, mesmo no Ultra). */
const TOUCH_CAP: Partial<SceneBudget> = { grassCount: 5200, decorDensity: 0.45, terrainSegments: 160, critters: 14, motes: 180, rainDrops: 650, rainSplashes: 40, stuckItems: 45 };
/** Pisos no toque: processador de celular sente cada draw call, então os pedaços nunca ficam pequenos. */
const TOUCH_FLOOR: Partial<SceneBudget> = { chunkScale: 1.5 };

export function sceneBudget(tier: QualityTier): SceneBudget {
  const out = { ...DESKTOP_BUDGET[tier] };
  if (!isTouchDevice) return out;
  for (const [key, cap] of Object.entries(TOUCH_CAP) as Array<[keyof SceneBudget, number]>) out[key] = Math.min(out[key], cap);
  for (const [key, floor] of Object.entries(TOUCH_FLOOR) as Array<[keyof SceneBudget, number]>) out[key] = Math.max(out[key], floor);
  return out;
}
