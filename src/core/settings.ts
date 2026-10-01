import { isTouchDevice, QUALITY_TIERS, type QualityTier } from './device';
import { autoStartTier } from './autoTier';
import type { LanguagePreference } from '../i18n';
import type { HoldMode } from './Input';

/**
 * Configurações do jogador (gráficos, áudio, controles, idioma), salvas no
 * navegador. Tudo é validado na leitura: valor corrompido ou fora da faixa volta
 * pro padrão, nunca quebra o jogo.
 *
 * Qualidade funciona como nos jogos de PC: escolher uma predefinição preenche os
 * ajustes gráficos; mexer num ajuste solto vira "personalizada".
 */

export type QualityPreset = 'auto' | QualityTier;
export type QualityLevel = QualityPreset | 'custom';
export type ShadowQuality = 'off' | 'low' | 'high' | 'ultra';
/** Amostras de MSAA na cena (0 = só o FXAA do acabamento). */
export type MsaaSamples = 0 | 2 | 4;

export interface GraphicsSettings {
  /** Fração da resolução nativa da tela (0,35 a 1). */
  resolution: number;
  shadows: ShadowQuality;
  msaa: MsaaSamples;
  /**
   * Reflexo do céu nos materiais (brilho do casco, da bosta molhada). Trocar
   * recompila os shaders todos: no Auto só muda na abertura do jogo.
   */
  reflections: boolean;
  ambientOcclusion: boolean;
  depthOfField: boolean;
  bloom: boolean;
  /** Fração dos tufos de grama desenhados (0,3 a 1). */
  grassDensity: number;
}

export interface GameSettings extends GraphicsSettings {
  language: LanguagePreference;
  quality: QualityLevel;
  showFps: boolean;
  muted: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  ambienceVolume: number;
  /** Multiplicador da câmera no mouse e no arrasto do toque (0,4 a 2). */
  mouseSensitivity: number;
  /** Multiplicador da câmera no analógico do controle (0,4 a 2). */
  stickSensitivity: number;
  invertY: boolean;
  cameraShake: boolean;
  /** No controle e no toque, a câmera volta sozinha pra trás do besouro quando ninguém mexe nela. */
  autoCamera: boolean;
  /** Agarrar a bola: segurar o botão ou apertar pra ligar/desligar (acessibilidade; o toque é sempre alternância). */
  grabMode: HoldMode;
  /** Correr: segurar ou apertar pra ligar/desligar. */
  runMode: HoldMode;
  /** Vibração do controle (quando o navegador e o controle suportam). */
  gamepadVibration: boolean;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = ['auto', ...QUALITY_TIERS];
export const SHADOW_LEVELS: readonly ShadowQuality[] = ['off', 'low', 'high', 'ultra'];
export const MSAA_LEVELS: readonly MsaaSamples[] = [0, 2, 4];
export const HOLD_MODES: readonly HoldMode[] = ['hold', 'toggle'];
export const GRAPHICS_KEYS: ReadonlyArray<keyof GraphicsSettings> = ['resolution', 'shadows', 'msaa', 'reflections', 'ambientOcclusion', 'depthOfField', 'bloom', 'grassDensity'];

/** Densidade de pixels nativa da tela, com teto (acima de 2x o ganho não paga o custo). */
export function nativePixelRatio(): number {
  return Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
}

/** Converte "quantos pixels por ponto eu quero" em fração da resolução desta tela. */
function resolutionFor(targetPixelRatio: number): number {
  return Math.min(1, Math.max(0.35, targetPixelRatio / nativePixelRatio()));
}

/**
 * Densidade de pixels que cada degrau mira. No toque a tela é pequena e densa:
 * abaixo de 1 pixel por ponto o texto do mundo vira borrão, então a escada começa mais alto.
 */
const TIER_PIXEL_RATIO: Record<QualityTier, { desktop: number; touch: number }> = {
  minimum: { desktop: 0.6, touch: 0.75 },
  low: { desktop: 0.8, touch: 1 },
  medium: { desktop: 1, touch: 1.25 },
  high: { desktop: 1.25, touch: 1.5 },
  ultra: { desktop: 2, touch: 2 },
};

/**
 * O que cada degrau liga. Do mais caro pro mais barato, o que sai primeiro é o
 * que menos aparece pelo que custa: resolução acima da tela, MSAA 4x e sombra
 * 4096 (Alta); oclusão e desfoque (Média); brilho, MSAA e reflexo do céu
 * (Baixa); sombra de verdade e mais resolução (Mínima, que ganha sombra "de
 * mancha" sob o besouro e a bola). O Ultra é o jogo como ele foi desenhado, sem corte nenhum.
 */
export function tierGraphics(tier: QualityTier): GraphicsSettings {
  const ratio = TIER_PIXEL_RATIO[tier][isTouchDevice ? 'touch' : 'desktop'];
  const resolution = resolutionFor(ratio);
  switch (tier) {
    case 'minimum':
      return { resolution, shadows: 'off', msaa: 0, reflections: false, ambientOcclusion: false, depthOfField: false, bloom: false, grassDensity: 0.3 };
    case 'low':
      return { resolution, shadows: 'low', msaa: 0, reflections: false, ambientOcclusion: false, depthOfField: false, bloom: false, grassDensity: 0.5 };
    case 'medium':
      return { resolution, shadows: 'low', msaa: 2, reflections: true, ambientOcclusion: false, depthOfField: false, bloom: true, grassDensity: 0.75 };
    case 'high':
      return { resolution, shadows: 'high', msaa: 2, reflections: true, ambientOcclusion: true, depthOfField: true, bloom: true, grassDensity: 1 };
    case 'ultra':
      return { resolution, shadows: 'ultra', msaa: 4, reflections: true, ambientOcclusion: true, depthOfField: true, bloom: true, grassDensity: 1 };
  }
}

/**
 * Degrau que o "Auto" está usando agora. Começa no que o aparelho aprendeu
 * (ou no palpite pela placa de vídeo) e a adaptação do jogo muda com `setAutoTier`.
 */
let autoTier: QualityTier = autoStartTier();

export function currentAutoTier(): QualityTier {
  return autoTier;
}

/** O que cada predefinição liga. Auto = o degrau que a adaptação escolheu. */
export function presetGraphics(preset: QualityPreset): GraphicsSettings {
  return tierGraphics(preset === 'auto' ? autoTier : preset);
}

function defaults(): GameSettings {
  return {
    ...presetGraphics('auto'),
    language: 'auto',
    quality: 'auto',
    showFps: false,
    muted: false,
    masterVolume: 0.8,
    musicVolume: 0.7,
    effectsVolume: 1,
    ambienceVolume: 0.8,
    mouseSensitivity: 1,
    stickSensitivity: 1,
    invertY: false,
    cameraShake: true,
    autoCamera: true,
    grabMode: 'hold',
    runMode: 'hold',
    gamepadVibration: true,
  };
}

const KEY = 'dawnroll:configuracoes:v1';

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const oneOf = <T extends string>(v: unknown, options: readonly T[]): v is T => typeof v === 'string' && (options as readonly string[]).includes(v);

/** Mantém só o que for válido; o resto fica com o padrão. */
function sanitize(raw: unknown): GameSettings {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const out: GameSettings = { ...base };
  if (oneOf(r.language, ['auto', 'pt-BR', 'en'] as const)) out.language = r.language;
  if (oneOf(r.quality, [...QUALITY_PRESETS, 'custom'] as const)) out.quality = r.quality;
  if (inRange(r.resolution, 0.35, 1)) out.resolution = r.resolution;
  if (oneOf(r.shadows, SHADOW_LEVELS)) out.shadows = r.shadows;
  if ((MSAA_LEVELS as readonly unknown[]).includes(r.msaa)) out.msaa = r.msaa as MsaaSamples;
  if (isBool(r.reflections)) out.reflections = r.reflections;
  if (isBool(r.ambientOcclusion)) out.ambientOcclusion = r.ambientOcclusion;
  if (isBool(r.depthOfField)) out.depthOfField = r.depthOfField;
  if (isBool(r.bloom)) out.bloom = r.bloom;
  if (inRange(r.grassDensity, 0.3, 1)) out.grassDensity = r.grassDensity;
  if (isBool(r.showFps)) out.showFps = r.showFps;
  if (isBool(r.muted)) out.muted = r.muted;
  if (inRange(r.masterVolume, 0, 1)) out.masterVolume = r.masterVolume;
  if (inRange(r.musicVolume, 0, 1)) out.musicVolume = r.musicVolume;
  if (inRange(r.effectsVolume, 0, 1)) out.effectsVolume = r.effectsVolume;
  if (inRange(r.ambienceVolume, 0, 1)) out.ambienceVolume = r.ambienceVolume;
  if (inRange(r.mouseSensitivity, 0.4, 2)) out.mouseSensitivity = r.mouseSensitivity;
  if (inRange(r.stickSensitivity, 0.4, 2)) out.stickSensitivity = r.stickSensitivity;
  if (isBool(r.invertY)) out.invertY = r.invertY;
  if (isBool(r.cameraShake)) out.cameraShake = r.cameraShake;
  if (isBool(r.autoCamera)) out.autoCamera = r.autoCamera;
  if (oneOf(r.grabMode, HOLD_MODES)) out.grabMode = r.grabMode;
  if (oneOf(r.runMode, HOLD_MODES)) out.runMode = r.runMode;
  if (isBool(r.gamepadVibration)) out.gamepadVibration = r.gamepadVibration;
  // Predefinição salva manda nos gráficos (a tela pode ter mudado de densidade desde a última vez).
  if (out.quality !== 'custom') Object.assign(out, presetGraphics(out.quality));
  return out;
}

export type SettingsListener = (settings: Readonly<GameSettings>, changed: ReadonlySet<keyof GameSettings>) => void;

export class SettingsStore {
  private value: GameSettings;
  private readonly listeners = new Set<SettingsListener>();

  constructor() {
    this.value = sanitize(this.read());
  }

  get(): Readonly<GameSettings> {
    return this.value;
  }

  /** Muda um ou mais ajustes. Ajuste gráfico solto transforma a qualidade em "personalizada". */
  update(patch: Partial<GameSettings>): void {
    const next = { ...this.value, ...patch };
    if (!('quality' in patch) && GRAPHICS_KEYS.some((k) => k in patch && patch[k] !== this.value[k])) next.quality = 'custom';
    // O desfoque de maquete lê a profundidade da oclusão ambiente: sem uma, sem o outro.
    if (!next.ambientOcclusion) next.depthOfField = false;
    this.commit(next);
  }

  applyPreset(preset: QualityPreset): void {
    this.commit({ ...this.value, ...presetGraphics(preset), quality: preset });
  }

  /**
   * A adaptação do "Auto" trocou de degrau: os gráficos passam a ser os dele
   * (sem virar "personalizada"). Fora do Auto só guarda o degrau pra quando ele voltar.
   */
  setAutoTier(tier: QualityTier): void {
    autoTier = tier;
    if (this.value.quality === 'auto') this.commit({ ...this.value, ...tierGraphics(tier) });
  }

  /** Tudo volta ao padrão, menos o idioma (quem escolheu um idioma não quer perdê-lo num reset). */
  reset(): void {
    this.commit({ ...defaults(), language: this.value.language });
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: GameSettings): void {
    const changed = new Set<keyof GameSettings>();
    for (const key of Object.keys(next) as Array<keyof GameSettings>) if (next[key] !== this.value[key]) changed.add(key);
    if (changed.size === 0) return;
    this.value = next;
    this.write();
    for (const listener of this.listeners) listener(this.value, changed);
  }

  private read(): unknown {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Armazenamento cheio ou bloqueado: vale só pra esta sessão.
    }
  }
}

/** A instância única do jogo (lida uma vez, no carregamento). */
export const settings = new SettingsStore();
