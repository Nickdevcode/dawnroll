/**
 * Erros de conta que a interface sabe explicar. Tudo que vem do Supabase (código
 * da API de login, erro de rede, 429) cai num destes.
 */
export type AccountError =
  | 'invalidCredentials'
  | 'emailTaken'
  | 'weakPassword'
  | 'invalidEmail'
  | 'rateLimited'
  | 'network'
  | 'nicknameTaken'
  | 'nicknameInvalid'
  | 'nicknameBlocked'
  | 'providerDisabled'
  | 'unknown';

export type AccountResult = { ok: true } | { ok: false; error: AccountError };

interface ErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

/** Traduz o erro do Supabase (auth ou PostgREST) pra um código da interface. */
export function toAccountError(error: unknown): AccountError {
  const e = (error ?? {}) as ErrorLike;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  if (e.name === 'AuthRetryableFetchError' || e.name === 'TypeError' || message.includes('failed to fetch') || message.includes('network')) {
    return 'network';
  }
  if (e.status === 429 || code.startsWith('over_') || message.includes('rate limit')) return 'rateLimited';
  switch (code) {
    case 'invalid_credentials':
      return 'invalidCredentials';
    case 'user_already_exists':
    case 'email_exists':
      return 'emailTaken';
    case 'weak_password':
      return 'weakPassword';
    case 'email_address_invalid':
    case 'email_address_not_authorized':
      return 'invalidEmail';
    case 'provider_disabled':
    case 'email_provider_disabled':
    case 'signup_disabled':
      return 'providerDisabled';
  }
  if (message.includes('invalid login credentials')) return 'invalidCredentials';
  if (message.includes('already registered')) return 'emailTaken';
  if (message.includes('password')) return 'weakPassword';
  if (message.includes('email') && message.includes('invalid')) return 'invalidEmail';
  return 'unknown';
}

export const fail = (error: AccountError): AccountResult => ({ ok: false, error });
export const OK: AccountResult = { ok: true };
