import { ptBR } from './pt-BR';
import { en } from './en';

/**
 * Idiomas do jogo. O português é o dicionário de referência; o inglês tem que
 * cumprir as mesmas chaves (o TypeScript acusa se faltar alguma).
 *
 * Detecção: no modo "automático", o idioma sai da lista de preferência do
 * navegador (`navigator.languages`, que segue o sistema) — o primeiro que o jogo
 * souber falar ganha. Se o jogador trocar o idioma do navegador com o jogo
 * aberto, o evento `languagechange` troca junto.
 */

export type Locale = 'pt-BR' | 'en';
export type LanguagePreference = 'auto' | Locale;
export type MessageKey = keyof typeof ptBR;
export type Messages = Record<MessageKey, string>;

/** Chaves que têm singular/plural (`base.one` + `base.other`). */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}.one` ? Base : never) : never;

export const LOCALES: readonly Locale[] = ['pt-BR', 'en'];

/** Nome de cada idioma nele mesmo (não se traduz: quem procura "English" procura escrito assim). */
export const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
};

const catalogs: Record<Locale, Messages> = { 'pt-BR': ptBR, en };

/**
 * Primeiro idioma da lista de preferência que o jogo fala. Qualquer variante de
 * português (pt-PT, pt-AO...) cai no pt-BR; qualquer inglês cai no en; o resto,
 * em inglês (a língua franca pra quem não fala nenhum dos dois).
 */
export function detectLocale(preferred: readonly string[] = browserLanguages()): Locale {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split(/[-_]/)[0];
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'en') return 'en';
  }
  return 'en';
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

let preference: LanguagePreference = 'auto';
let current: Locale = detectLocale();
const listeners = new Set<() => void>();

/** Idioma em uso agora. */
export function getLocale(): Locale {
  return current;
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

/** O que o automático escolheria (para mostrar "Detectado: ..." nas configurações). */
export function detectedLocale(): Locale {
  return detectLocale();
}

/** Troca a preferência (automático ou fixo) e avisa quem mostra texto. */
export function setLanguagePreference(next: LanguagePreference): void {
  preference = next;
  switchTo(next === 'auto' ? detectLocale() : next);
}

/** Chama `listener` sempre que o idioma mudar. Devolve a função que cancela. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function switchTo(locale: Locale): void {
  const changed = locale !== current;
  current = locale;
  applyToDocument();
  if (changed) for (const listener of listeners) listener();
}

/** `lang` do documento (leitores de tela, hifenização) e a descrição da página. */
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (preference === 'auto') switchTo(detectLocale());
  });
}

/** Texto traduzido, com `{param}` substituído. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = catalogs[current][key] ?? ptBR[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * Singular ou plural pelo número (`n` já entra formatado no `{n}`).
 * Não usa `Intl.PluralRules` de propósito: pro português ele trata o zero como
 * singular ("0 montinho"), e na interface o natural é "0 montinhos".
 */
export function tn(key: PluralKey, n: number, params?: Record<string, string | number>): string {
  const form = n === 1 ? 'one' : 'other';
  return t(`${key}.${form}` as MessageKey, { n: formatInteger(n), ...params });
}

export function formatInteger(n: number): string {
  return n.toLocaleString(current);
}

/** Centímetros com uma casa (vírgula em português, ponto em inglês). */
export function formatCm(cm: number): string {
  return `${cm.toLocaleString(current, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;
}
