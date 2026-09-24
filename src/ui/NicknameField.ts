import { t, type MessageKey } from '../i18n';
import type { Online } from '../online/Online';
import { NICKNAME_MAX, nicknameFormatOk, type NicknameStatus } from '../online/nicknames';
import { Icons } from './icons';

/** Espera depois da última tecla antes de perguntar ao servidor. */
const CHECK_DELAY_MS = 450;

type FieldState = 'idle' | 'checking' | 'offline' | NicknameStatus;

const MESSAGES: Record<Exclude<FieldState, 'idle'>, MessageKey> = {
  checking: 'nickname.checking',
  ok: 'nickname.ok',
  offline: 'nickname.offline',
  invalid: 'account.error.nicknameInvalid',
  blocked: 'account.error.nicknameBlocked',
  taken: 'account.error.nicknameTaken',
};

let fieldId = 0;

/**
 * Campo de apelido com a checagem enquanto digita: formato na hora, e "livre?"
 * no servidor (com espera, pra não perguntar a cada letra). Usado no cadastro,
 * na troca de apelido e na janelinha de quem entrou pelo Google.
 */
export class NicknameField {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly label: HTMLElement;
  private readonly hint: HTMLElement | null;
  private readonly ownNickname: () => string | null;
  private state: FieldState = 'idle';
  private timer = 0;
  /** Só a resposta da última pergunta vale (digitar rápido dispara várias). */
  private ticket = 0;

  constructor(
    private readonly online: Online,
    options: { hint?: boolean; ownNickname?: () => string | null } = {},
  ) {
    const id = `nick-${++fieldId}`;
    this.ownNickname = options.ownNickname ?? (() => null);
    this.element = document.createElement('div');
    this.element.className = 'field';
    this.element.innerHTML = /* html */ `
      <label class="field__label" for="${id}"></label>
      <input class="field__input" id="${id}" type="text" autocomplete="nickname" autocapitalize="words" spellcheck="false"
        maxlength="${NICKNAME_MAX}" aria-describedby="${id}-status${options.hint ? ` ${id}-hint` : ''}" />
      ${options.hint ? `<p class="field__hint" id="${id}-hint"></p>` : ''}
      <p class="field__status" id="${id}-status" aria-live="polite"></p>`;
    this.input = this.element.querySelector('input') as HTMLInputElement;
    this.label = this.element.querySelector('label') as HTMLElement;
    this.status = this.element.querySelector('.field__status') as HTMLElement;
    this.hint = this.element.querySelector('.field__hint');
    this.input.addEventListener('input', () => this.onInput());
    this.refresh();
  }

  get value(): string {
    return this.input.value.trim();
  }

  /** Último resultado conhecido (o formulário decide se deixa enviar). */
  get result(): FieldState {
    return this.state;
  }

  setValue(value: string): void {
    this.input.value = value;
    this.onInput();
  }

  /** Mostra um resultado vindo de fora (ex.: o servidor recusou no envio, ou não respondeu). */
  showStatus(status: NicknameStatus | 'offline'): void {
    window.clearTimeout(this.timer);
    this.ticket++;
    this.render(status);
  }

  /** Volta pro vazio (placa fechou, formulário trocou de modo). */
  clear(): void {
    window.clearTimeout(this.timer);
    this.ticket++;
    this.input.value = '';
    this.render('idle');
  }

  /** Troca de idioma. */
  refresh(): void {
    this.label.textContent = t('account.nickname');
    if (this.hint) this.hint.textContent = t('account.nickname.hint');
    this.render(this.state);
  }

  private onInput(): void {
    window.clearTimeout(this.timer);
    const ticket = ++this.ticket;
    const nick = this.value;
    if (nick === '') return this.render('idle');
    if (!nicknameFormatOk(nick)) return this.render('invalid');
    // O próprio apelido de agora não precisa de pergunta nenhuma.
    if (nick === this.ownNickname()) return this.render('idle');
    this.render('checking');
    this.timer = window.setTimeout(async () => {
      const status = await this.online.checkNickname(nick);
      if (ticket !== this.ticket) return;
      this.render(status ?? 'offline');
    }, CHECK_DELAY_MS);
  }

  private render(state: FieldState): void {
    this.state = state;
    this.element.dataset.state = state;
    this.input.setAttribute('aria-invalid', String(state === 'invalid' || state === 'blocked' || state === 'taken'));
    if (state === 'idle') {
      this.status.textContent = '';
      return;
    }
    const icon = state === 'ok' ? Icons.check : '';
    this.status.innerHTML = `${icon}<span></span>`;
    (this.status.querySelector('span') as HTMLElement).textContent = t(MESSAGES[state]);
  }
}
