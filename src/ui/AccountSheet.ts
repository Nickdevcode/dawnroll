import { getLocale, onLocaleChange, t, type MessageKey } from '../i18n';
import type { AccountError, Online } from '../online/Online';
import type { Progression } from '../progression/Progression';
import { skin } from '../progression/skins';
import { GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { skinIcon } from './lookIcons';
import { NicknameField } from './NicknameField';

type Mode = 'signIn' | 'signUp';
type Confirm = 'signOut' | 'delete' | null;

const PASSWORD_MIN = 8;
/** "Salvo há 2 minutos" se atualiza sozinho enquanto a placa está aberta. */
const CLOCK_MS = 30_000;

/** "agora há pouco", "há 3 minutos", "há 2 horas" (no idioma do jogo). */
function ago(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (seconds > -45) return format.format(0, 'second');
  if (seconds > -3600) return format.format(Math.round(seconds / 60), 'minute');
  if (seconds > -86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86_400), 'day');
}

/**
 * Placa da conta (dentro do menu). Sem conta: Google (se estiver ligado no
 * servidor) ou e-mail + senha, com "Já tenho conta" / "Criar conta" (o cadastro
 * pede o apelido). Com conta: o besouro e o apelido (dá pra trocar), o estado
 * do save na nuvem, "Ver ranking", sair e excluir a conta (os dois confirmam
 * antes, aqui mesmo — nada de janela do navegador).
 */
export class AccountSheet {
  readonly element: HTMLElement;
  /** "Ver ranking". */
  onOpenRanking: (() => void) | null = null;

  private readonly views: Record<'loading' | 'guest' | 'signedIn', HTMLElement>;
  private readonly signUpNick: NicknameField;
  private readonly editNick: NicknameField;
  private readonly form: HTMLFormElement;
  private readonly email: HTMLInputElement;
  private readonly password: HTMLInputElement;
  private readonly formError: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly notice: HTMLElement;
  private mode: Mode = 'signIn';
  private busy = false;
  private confirm: Confirm = null;
  private editing = false;
  private clock = 0;

  constructor(
    private readonly online: Online,
    private readonly progression: Progression,
  ) {
    this.element = document.createElement('section');
    this.element.className = 'sheet sheet--account';
    this.element.id = 'sheet-account';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sheet-account-title');
    this.element.hidden = true;
    this.element.innerHTML = /* html */ `
      <header class="sheet__header">
        <h2 class="sheet__title" id="sheet-account-title" data-t="account.title"></h2>
        <button class="sheet__close" type="button" data-close data-t-aria="menu.close">${Icons.close}</button>
      </header>
      <div class="sheet__body account">
        <div class="account-view" data-view="loading">
          <p class="account-loading"><span class="account-spinner" aria-hidden="true"></span><span data-t="account.loading"></span></p>
        </div>

        <div class="account-view" data-view="guest" hidden>
          <div class="account-hero">
            <span class="account-hero__icon" aria-hidden="true">${Icons.cloudUp}</span>
            <p data-t="account.pitch"></p>
          </div>
          <p class="account-notice" data-notice role="status" hidden></p>
          <button class="account-google" type="button" data-google hidden>${Icons.google}<span data-t="account.google"></span></button>
          <p class="account-divider" data-divider hidden><span data-t="account.or"></span></p>
          <div class="account-mode" role="radiogroup" data-t-aria="account.mode">
            <button class="account-mode__option" type="button" role="radio" data-mode="signIn" data-t="account.mode.signIn"></button>
            <button class="account-mode__option" type="button" role="radio" data-mode="signUp" data-t="account.mode.signUp"></button>
          </div>
          <form class="account-form" data-form novalidate>
            <div data-nick-slot></div>
            <div class="field">
              <label class="field__label" for="account-email" data-t="account.email"></label>
              <input class="field__input" id="account-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" required />
            </div>
            <div class="field">
              <label class="field__label" for="account-password" data-t="account.password"></label>
              <div class="field__row">
                <input class="field__input" id="account-password" name="password" type="password" autocomplete="current-password" minlength="${PASSWORD_MIN}" required aria-describedby="account-password-hint" />
                <button class="field__peek" type="button" data-peek aria-pressed="false">${Icons.eye}</button>
              </div>
              <p class="field__hint" id="account-password-hint" data-t="account.password.hint"></p>
            </div>
            <p class="account-note" data-signup-only>${GameIcons.fact}<span data-t="account.noRecovery"></span></p>
            <p class="account-error" data-form-error role="alert"></p>
            <button class="account-submit" type="submit" data-submit></button>
          </form>
        </div>

        <div class="account-view" data-view="signedIn" hidden>
          <div class="account-card">
            <span class="account-card__avatar" data-avatar aria-hidden="true"></span>
            <div class="account-card__text">
              <strong data-nick></strong>
              <span data-email></span>
            </div>
            <button class="account-icon-button" type="button" data-edit data-t-aria="account.edit">${Icons.pencil}</button>
          </div>
          <form class="account-nick-form" data-nick-form hidden novalidate>
            <div data-edit-slot></div>
            <div class="account-actions">
              <button class="account-secondary" type="button" data-edit-cancel data-t="account.cancel"></button>
              <button class="account-submit is-compact" type="submit" data-t="account.save"></button>
            </div>
          </form>
          <p class="account-sync" data-sync></p>
          <button class="account-wide" type="button" data-view-ranking>${Icons.podium}<span data-t="account.viewRanking"></span></button>
          <div class="account-exit">
            <button class="account-secondary" type="button" data-ask="signOut">${Icons.logout}<span data-t="account.signOut"></span></button>
            <button class="account-danger" type="button" data-ask="delete">${Icons.trash}<span data-t="account.delete"></span></button>
          </div>
          <div class="account-confirm" data-confirm role="alertdialog" aria-labelledby="account-confirm-text" hidden>
            <p id="account-confirm-text" data-confirm-text></p>
            <div class="account-actions">
              <button class="account-secondary" type="button" data-confirm-no data-t="account.cancel"></button>
              <button class="account-submit" type="button" data-confirm-yes></button>
            </div>
          </div>
        </div>
      </div>`;

    const $ = <T extends HTMLElement>(sel: string) => this.element.querySelector(sel) as T;
    this.views = { loading: $('[data-view="loading"]'), guest: $('[data-view="guest"]'), signedIn: $('[data-view="signedIn"]') };
    this.form = $('[data-form]');
    this.email = $('#account-email');
    this.password = $('#account-password');
    this.formError = $('[data-form-error]');
    this.submit = $('[data-submit]');
    this.notice = $('[data-notice]');
    this.modeButtons = Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-mode]'));

    this.signUpNick = new NicknameField(online, { hint: true });
    $('[data-nick-slot]').append(this.signUpNick.element);
    this.editNick = new NicknameField(online, { ownNickname: () => this.online.state.profile?.nickname ?? null });
    $('[data-edit-slot]').append(this.editNick.element);

    this.bindEvents();
    online.subscribe(() => this.render());
    progression.subscribe(() => this.renderAvatar());
    onLocaleChange(() => {
      this.signUpNick.refresh();
      this.editNick.refresh();
      this.render();
    });
    this.setMode('signIn');
    this.render();
  }

  /** Abriu a placa. */
  prepare(): void {
    this.closeConfirm();
    this.stopEditing();
    this.notice.hidden = true;
    this.render();
    window.clearInterval(this.clock);
    this.clock = window.setInterval(() => (this.element.hidden ? window.clearInterval(this.clock) : this.renderSync()), CLOCK_MS);
  }

  /** Fechou a placa: senha não fica no campo. */
  close(): void {
    window.clearInterval(this.clock);
    this.password.value = '';
    this.formError.textContent = '';
  }

  private bindEvents(): void {
    for (const button of this.modeButtons) {
      button.addEventListener('click', () => this.setMode(button.dataset.mode as Mode));
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = this.mode === 'signIn' ? 'signUp' : 'signIn';
        this.setMode(next);
        this.modeButtons.find((b) => b.dataset.mode === next)?.focus();
      });
    }
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitForm();
    });
    const peek = this.element.querySelector('[data-peek]') as HTMLButtonElement;
    peek.addEventListener('click', () => {
      const show = this.password.type === 'password';
      this.password.type = show ? 'text' : 'password';
      peek.setAttribute('aria-pressed', String(show));
      peek.innerHTML = show ? Icons.eyeOff : Icons.eye;
      this.refreshPeekLabel();
    });
    (this.element.querySelector('[data-google]') as HTMLButtonElement).addEventListener('click', () => void this.google());
    (this.element.querySelector('[data-view-ranking]') as HTMLButtonElement).addEventListener('click', () => this.onOpenRanking?.());
    (this.element.querySelector('[data-edit]') as HTMLButtonElement).addEventListener('click', () => this.startEditing());
    (this.element.querySelector('[data-edit-cancel]') as HTMLButtonElement).addEventListener('click', () => this.stopEditing(true));
    (this.element.querySelector('[data-nick-form]') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveNickname();
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-ask]').forEach((button) =>
      button.addEventListener('click', () => this.openConfirm(button.dataset.ask as Exclude<Confirm, null>)),
    );
    (this.element.querySelector('[data-confirm-no]') as HTMLButtonElement).addEventListener('click', () => this.closeConfirm(true));
    (this.element.querySelector('[data-confirm-yes]') as HTMLButtonElement).addEventListener('click', () => void this.confirmAction());
  }

  // --- entrar / criar conta ----------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const button of this.modeButtons) {
      const checked = button.dataset.mode === mode;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    }
    const signUp = mode === 'signUp';
    this.signUpNick.element.hidden = !signUp;
    (this.element.querySelector('[data-signup-only]') as HTMLElement).hidden = !signUp;
    (this.element.querySelector('#account-password-hint') as HTMLElement).hidden = !signUp;
    // Gerenciador de senha: "nova senha" no cadastro, "senha atual" no login.
    this.password.autocomplete = signUp ? 'new-password' : 'current-password';
    this.formError.textContent = '';
    this.refreshSubmit();
  }

  private refreshSubmit(): void {
    this.submit.disabled = this.busy;
    this.submit.textContent = this.busy ? t('account.working') : t(this.mode === 'signUp' ? 'account.submit.signUp' : 'account.submit.signIn');
  }

  private refreshPeekLabel(): void {
    const peek = this.element.querySelector('[data-peek]') as HTMLButtonElement;
    peek.setAttribute('aria-label', t(this.password.type === 'password' ? 'account.password.show' : 'account.password.hide'));
  }

  private async submitForm(): Promise<void> {
    if (this.busy) return;
    const email = this.email.value.trim();
    const password = this.password.value;
    const signUp = this.mode === 'signUp';
    if (signUp) {
      const nick = this.signUpNick.result;
      if (this.signUpNick.value === '' || nick === 'invalid' || nick === 'blocked' || nick === 'taken') {
        if (this.signUpNick.value === '' || nick === 'idle') this.signUpNick.showStatus('invalid');
        this.signUpNick.input.focus();
        return;
      }
    }
    if (!email) return this.showFormError('account.error.emailRequired', this.email);
    if (password.length < PASSWORD_MIN) return this.showFormError('account.error.passwordShort', this.password);

    this.busy = true;
    this.formError.textContent = '';
    this.refreshSubmit();
    const result = signUp ? await this.online.signUp(email, password, this.signUpNick.value) : await this.online.signIn(email, password);
    this.busy = false;
    this.refreshSubmit();
    if (result.ok) {
      this.password.value = '';
      this.signUpNick.clear();
      return;
    }
    this.showError(result.error);
  }

  private async google(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refreshSubmit();
    const result = await this.online.signInWithGoogle();
    // Deu certo = a página vai pro Google; só volta aqui se falhou.
    this.busy = false;
    this.refreshSubmit();
    if (!result.ok) this.showError(result.error);
  }

  private showError(error: AccountError): void {
    if (error === 'nicknameTaken' || error === 'nicknameBlocked' || error === 'nicknameInvalid') {
      this.signUpNick.showStatus(error === 'nicknameTaken' ? 'taken' : error === 'nicknameBlocked' ? 'blocked' : 'invalid');
      this.signUpNick.input.focus();
      return;
    }
    const focus = error === 'invalidEmail' || error === 'emailTaken' ? this.email : error === 'weakPassword' || error === 'invalidCredentials' ? this.password : null;
    this.showFormError(`account.error.${error}` as MessageKey, focus);
  }

  private showFormError(key: MessageKey, focus: HTMLInputElement | null): void {
    this.formError.textContent = t(key);
    focus?.focus();
  }

  // --- conta aberta ------------------------------------------------------------------

  private startEditing(): void {
    this.editing = true;
    this.closeConfirm();
    this.editNick.setValue(this.online.state.profile?.nickname ?? '');
    (this.element.querySelector('[data-nick-form]') as HTMLElement).hidden = false;
    this.editNick.input.focus();
    this.editNick.input.select();
  }

  private stopEditing(returnFocus = false): void {
    if (!this.editing) return;
    this.editing = false;
    (this.element.querySelector('[data-nick-form]') as HTMLElement).hidden = true;
    this.editNick.clear();
    if (returnFocus) (this.element.querySelector('[data-edit]') as HTMLElement).focus();
  }

  private async saveNickname(): Promise<void> {
    if (this.busy) return;
    const nick = this.editNick.value;
    if (nick === this.online.state.profile?.nickname) return this.stopEditing(true);
    this.busy = true;
    const status = await this.online.setNickname(nick);
    this.busy = false;
    if (status === 'ok') return this.stopEditing(true);
    this.editNick.showStatus(status ?? 'offline');
    this.editNick.input.focus();
  }

  private openConfirm(kind: Exclude<Confirm, null>): void {
    this.stopEditing();
    this.confirm = kind;
    const box = this.element.querySelector('[data-confirm]') as HTMLElement;
    (box.querySelector('[data-confirm-text]') as HTMLElement).textContent = t(kind === 'signOut' ? 'account.signOut.confirm' : 'account.delete.confirm');
    const yes = box.querySelector('[data-confirm-yes]') as HTMLButtonElement;
    yes.textContent = t(kind === 'signOut' ? 'account.signOut' : 'account.delete.yes');
    yes.classList.toggle('is-danger', kind === 'delete');
    box.hidden = false;
    (box.querySelector('[data-confirm-no]') as HTMLElement).focus();
  }

  private closeConfirm(returnFocus = false): void {
    const kind = this.confirm;
    this.confirm = null;
    (this.element.querySelector('[data-confirm]') as HTMLElement).hidden = true;
    if (returnFocus && kind) (this.element.querySelector(`[data-ask="${kind}"]`) as HTMLElement).focus();
  }

  private async confirmAction(): Promise<void> {
    const kind = this.confirm;
    if (!kind || this.busy) return;
    this.busy = true;
    const yes = this.element.querySelector('[data-confirm-yes]') as HTMLButtonElement;
    yes.disabled = true;
    yes.textContent = t('account.working');
    try {
      if (kind === 'signOut') {
        const result = await this.online.signOut();
        if (!result.ok) {
          (this.element.querySelector('[data-confirm-text]') as HTMLElement).textContent = t(
            result.error === 'network' ? 'account.signOut.offline' : `account.error.${result.error}` as MessageKey,
          );
          return;
        }
      } else {
        const result = await this.online.deleteAccount();
        if (!result.ok) {
          (this.element.querySelector('[data-confirm-text]') as HTMLElement).textContent = t(`account.error.${result.error}` as MessageKey);
          return;
        }
        this.notice.textContent = t('account.deleted');
        this.notice.hidden = false;
      }
      this.closeConfirm();
    } finally {
      this.busy = false;
      yes.disabled = false;
      if (this.confirm) yes.textContent = t(this.confirm === 'signOut' ? 'account.signOut' : 'account.delete.yes');
      // A tela de entrar apareceu enquanto isso (com o botão ocupado): libera.
      this.refreshSubmit();
    }
  }

  // --- desenho -----------------------------------------------------------------------

  private render(): void {
    const state = this.online.state;
    const view = state.status === 'signedIn' ? 'signedIn' : state.status === 'loading' ? 'loading' : 'guest';
    const wasHidden = this.views[view].hidden;
    for (const [name, element] of Object.entries(this.views)) element.hidden = name !== view;
    // Trocou de tela com a placa aberta (entrou/saiu): o foco não pode ficar num botão que sumiu.
    if (wasHidden && !this.element.hidden && this.element.contains(document.activeElement) === false) {
      (this.element.querySelector('[data-close]') as HTMLElement).focus({ preventScroll: true });
    }
    if (view === 'guest') this.renderGuest();
    if (view === 'signedIn') this.renderSignedIn();
    this.element.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t as MessageKey)));
    this.element.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria as MessageKey)));
    this.refreshSubmit();
    this.refreshPeekLabel();
  }

  private renderGuest(): void {
    const { providers, oauthFailed } = this.online.state;
    const google = providers?.google === true;
    (this.element.querySelector('[data-google]') as HTMLElement).hidden = !google;
    (this.element.querySelector('[data-divider]') as HTMLElement).hidden = !google;
    if (oauthFailed && this.notice.hidden) {
      this.notice.textContent = t('account.error.oauth');
      this.notice.hidden = false;
    }
  }

  private renderSignedIn(): void {
    const { profile, email } = this.online.state;
    (this.element.querySelector('[data-nick]') as HTMLElement).textContent = profile?.nickname ?? '…';
    (this.element.querySelector('[data-email]') as HTMLElement).textContent = email ?? '';
    this.renderAvatar();
    this.renderSync();
  }

  private renderAvatar(): void {
    (this.element.querySelector('[data-avatar]') as HTMLElement).innerHTML = skinIcon(skin(this.progression.skin));
  }

  private renderSync(): void {
    const { sync, lastSavedAt } = this.online.state;
    const el = this.element.querySelector('[data-sync]') as HTMLElement;
    el.dataset.state = sync;
    const [icon, text] =
      sync === 'offline'
        ? [Icons.cloudOff, t('account.sync.offline')]
        : sync === 'saved' && lastSavedAt
          ? [Icons.cloudCheck, t('account.sync.savedAgo', { when: ago(lastSavedAt) })]
          : sync === 'syncing'
            ? [Icons.cloudUp, t('account.sync.syncing')]
            : [Icons.cloudCheck, t('account.sync.saved')];
    el.innerHTML = `${icon}<span>${escapeHtml(text)}</span>`;
  }
}
