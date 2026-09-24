import type { Locale } from '../i18n';

/**
 * Apelido público do ranking. A regra de verdade (e o filtro de palavrão) mora no
 * banco (`private.nickname_valid` / `nickname_clean`); aqui fica só a checagem de
 * formato, pra avisar na hora enquanto a pessoa digita, e o sorteio de sugestões.
 */

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;

/** Mesmo conjunto do banco: letras (com acento), números, espaço, _ . - */
const ALLOWED = /^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]+$/;
const HAS_ALNUM = /[A-Za-z0-9À-ÖØ-öø-ÿ]/;

/** Resultado da checagem de apelido (os quatro do servidor + "checando"). */
export type NicknameStatus = 'ok' | 'invalid' | 'blocked' | 'taken';

/** Formato válido? (não confere se está livre nem o filtro — isso é no servidor) */
export function nicknameFormatOk(raw: string): boolean {
  const nick = raw.trim();
  return nick.length >= NICKNAME_MIN && nick.length <= NICKNAME_MAX && ALLOWED.test(nick) && HAS_ALNUM.test(nick) && !/\s\s/.test(nick);
}

const WORDS: Record<Locale, { nouns: readonly string[]; adjectives: readonly string[] }> = {
  'pt-BR': {
    nouns: ['Besouro', 'Bolota', 'Solzinho', 'Rolador', 'Tatuzinho', 'Joaninha', 'Grilo', 'Formiga', 'Minhoca', 'Vaga-lume'],
    adjectives: ['Veloz', 'Dourado', 'Sapeca', 'Ligeiro', 'Maroto', 'Feliz', 'Valente', 'Sonhador', 'Brilhante', 'Faceiro', 'Bravo', 'Zen'],
  },
  en: {
    nouns: ['Beetle', 'Roller', 'Sunny', 'Pillbug', 'Ladybug', 'Cricket', 'Firefly', 'Earthworm', 'Snail', 'Pebble'],
    adjectives: ['Swift', 'Golden', 'Sneaky', 'Brave', 'Happy', 'Dreamy', 'Shiny', 'Mighty', 'Lucky', 'Zen', 'Bold', 'Jolly'],
  },
};

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)];

/**
 * Apelido sorteado no idioma do jogo ("Besouro Sapeca 42", "Golden Beetle 7").
 * Sempre cabe no limite de 16 (o número só entra se couber).
 */
export function suggestNickname(locale: Locale, random: () => number = Math.random): string {
  const words = WORDS[locale];
  for (let attempt = 0; attempt < 12; attempt++) {
    const noun = pick(words.nouns, random);
    const adjective = pick(words.adjectives, random);
    const base = locale === 'en' ? `${adjective} ${noun}` : `${noun} ${adjective}`;
    if (base.length > NICKNAME_MAX) continue;
    const withNumber = `${base} ${1 + Math.floor(random() * 99)}`;
    return withNumber.length <= NICKNAME_MAX ? withNumber : base;
  }
  return locale === 'en' ? `Beetle ${1000 + Math.floor(random() * 9000)}` : `Besouro ${1000 + Math.floor(random() * 9000)}`;
}
