import { isTouchDevice, quality as deviceProfile } from './device';
import type { LanguagePreference } from '../i18n';

/**
 * Configurações do jogador (gráficos, áudio, controles, idioma), salvas no
 * navegador. Tudo é validado na leitura: valor corrompido ou fora da faixa volta
 * pro padrão, nunca quebra o jogo.
 *
 * Qualidade funciona como nos jogos de PC: escolher uma predefinição preenche os
 * ajustes gráficos; mexer num ajuste solto vira "personalizada".
 */

export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type QualityLevel = QualityPreset | 'custom';
export type ShadowQuality = 'off' | 'low' | 'high';

export interface GraphicsSettings {
  /** Fração da resolução nativa da tela (0,35 a 1). */
  resolution: number;
  shadows: ShadowQuality;
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
  effectsVolume: number;
  ambienceVolume: number;
  /** Multiplicador da velocidade da câmera (0,4 a 2). */
  mouseSensitivity: number;
  invertY: boolean;
  cameraShake: boolean;
  /** Vibração do controle (quando o navegador e o controle suportam). */
  gamepadVibration: boolean;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const GRAPHICS_KEYS: ReadonlyArray<keyof GraphicsSettings> = ['resolution', 'shadows', 'ambientOcclusion', 'depthOfField', 'bloom', 'grassDensity'];

/** Densidade de pixels nativa da tela, com teto (acima de 2x o ganho não paga o custo). */
export function nativePixelRatio(): number {
  return Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
}

/** Converte "quantos pixels por ponto eu quero" em fração da resolução desta tela. */
function resolutionFor(targetPixelRatio: number): number {
  return Math.min(1, Math.max(0.35, targetPixelRatio / nativePixelRatio()));
}

/** O que cada predefinição liga. Auto = o perfil do aparelho (e o jogo ainda pode baixar sozinho). */
export function presetGraphics(preset: QualityPreset): GraphicsSettings {
  switch (preset) {
    case 'low':
      return { resolution: resolutionFor(0.75), shadows: 'low', ambientOcclusion: false, depthOfField: false, bloom: false, grassDensity: 0.45 };
    case 'medium':
      return { resolution: resolutionFor(1), shadows: 'low', ambientOcclusion: false, depthOfField: false, bloom: true, grassDensity: 0.7 };
    case 'high':
      return { resolution: resolutionFor(1.5), shadows: 'high', ambientOcclusion: true, depthOfField: true, bloom: true, grassDensity: 1 };
    case 'ultra':
      return { resolution: resolutionFor(2), shadows: 'high', ambientOcclusion: true, depthOfField: true, bloom: true, grassDensity: 1 };
    case 'auto':
      return {
        resolution: resolutionFor(deviceProfile.maxPixelRatio),
        shadows: isTouchDevice ? 'low' : 'high',
        ambientOcclusion: deviceProfile.ambientOcclusion,
        depthOfField: deviceProfile.depthOfField,
        bloom: deviceProfile.bloom,
        grassDensity: 1,
      };
  }
}

function defaults(): GameSettings {
  return {
    ...presetGraphics('auto'),
    language: 'auto',
    quality: 'auto',
    showFps: false,
    muted: false,
    masterVolume: 0.8,
    effectsVolume: 1,
    ambienceVolume: 0.8,
    mouseSensitivity: 1,
    invertY: false,
    cameraShake: true,
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
  if (oneOf(r.quality, ['auto', 'low', 'medium', 'high', 'ultra', 'custom'] as const)) out.quality = r.quality;
  if (inRange(r.resolution, 0.35, 1)) out.resolution = r.resolution;
  if (oneOf(r.shadows, ['off', 'low', 'high'] as const)) out.shadows = r.shadows;
  if (isBool(r.ambientOcclusion)) out.ambientOcclusion = r.ambientOcclusion;
  if (isBool(r.depthOfField)) out.depthOfField = r.depthOfField;
  if (isBool(r.bloom)) out.bloom = r.bloom;
  if (inRange(r.grassDensity, 0.3, 1)) out.grassDensity = r.grassDensity;
  if (isBool(r.showFps)) out.showFps = r.showFps;
  if (isBool(r.muted)) out.muted = r.muted;
  if (inRange(r.masterVolume, 0, 1)) out.masterVolume = r.masterVolume;
  if (inRange(r.effectsVolume, 0, 1)) out.effectsVolume = r.effectsVolume;
  if (inRange(r.ambienceVolume, 0, 1)) out.ambienceVolume = r.ambienceVolume;
  if (inRange(r.mouseSensitivity, 0.4, 2)) out.mouseSensitivity = r.mouseSensitivity;
  if (isBool(r.invertY)) out.invertY = r.invertY;
  if (isBool(r.cameraShake)) out.cameraShake = r.cameraShake;
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
