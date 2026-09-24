import { getLocale, onLocaleChange, t } from '../i18n';
import type { Online } from '../online/Online';
import { suggestNickname } from '../online/nicknames';
import type { Progression } from '../progression/Progression';
import { skin } from '../progression/skins';
import { Icons } from './icons';
import { skinIcon } from './lookIcons';
import { NicknameField } from './NicknameField';

/**
 * Janelinha "Escolha seu apelido": aparece quando a conta entrou com apelido
 * sorteado (cadastro pelo Google). Vem com uma sugestão no idioma do jogo, dá
 * pra sortear outra, e "Depois" deixa o sorteado (troca na placa da conta).
 * `<dialog>` modal de verdade: prende o foco e o Esc fecha. Só abre com o menu
 * na tela (a sessão pode terminar de carregar com a pessoa já jogando).
 */
export class NicknameDialog {
  readonly element: HTMLDialogElement;
  private readonly field: NicknameField;
  private readonly save: HTMLButtonElement;
  private busy = false;
  /** Já apareceu nesta sessão (fechou com "Depois": não insiste). */
  private dismissed = false;

  constructor(
    parent: HTMLElement,
    private readonly online: Online,
    private readonly progression: Progression,
    private readonly canShow: () => boolean,
  ) {
    this.element = document.createElement('dialog');
    this.element.className = 'nick-dialog';
    this.element.setAttribute('aria-labelledby', 'nick-dialog-title');
    this.element.setAttribute('aria-describedby', 'nick-dialog-text');
    this.element.innerHTML = /* html */ `
      <form class="nick-dialog__form" method="dialog" novalidate>
        <span class="nick-dialog__avatar" data-avatar aria-hidden="true"></span>
        <h2 class="nick-dialog__title" id="nick-dialog-title"></h2>
        <p class="nick-dialog__text" id="nick-dialog-text"></p>
        <div class="nick-dialog__field" data-slot>
          <button class="nick-dialog__shuffle" type="button" data-shuffle>${Icons.dice}</button>
        </div>
        <div class="account-actions">
          <button class="account-secondary" type="button" data-later></button>
          <button class="account-submit" type="submit" data-save></button>
        </div>
      </form>`;
    parent.append(this.element);

    this.field = new NicknameField(online);
    (this.element.querySelector('[data-slot]') as HTMLElement).prepend(this.field.element);
    this.save = this.element.querySelector('[data-save]') as HTMLButtonElement;

    (this.element.querySelector('form') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    (this.element.querySelector('[data-shuffle]') as HTMLButtonElement).addEventListener('click', () => {
      this.field.setValue(suggestNickname(getLocale()));
      this.field.input.focus();
    });
    (this.element.querySelector('[data-later]') as HTMLButtonElement).addEventListener('click', () => this.close());
    // Esc também é "Depois".
    this.element.addEventListener('cancel', () => (this.dismissed = true));
    online.subscribe(() => this.check());
    onLocaleChange(() => this.refreshTexts());
    this.refreshTexts();
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  close(): void {
    this.dismissed = true;
    if (this.element.open) this.element.close();
  }

  /** Abre se a conta precisa de apelido (e o menu está na tela); fecha se não precisa mais. */
  check(): void {
    if (!this.online.needsNickname) {
      if (this.element.open) this.element.close();
      return;
    }
    if (this.dismissed || this.element.open || !this.canShow()) return;
    (this.element.querySelector('[data-avatar]') as HTMLElement).innerHTML = skinIcon(skin(this.progression.skin));
    this.field.setValue(suggestNickname(getLocale()));
    this.element.showModal();
    this.field.input.focus();
    this.field.input.select();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.save.disabled = true;
    this.save.textContent = t('account.working');
    const status = await this.online.setNickname(this.field.value);
    this.busy = false;
    this.save.disabled = false;
    this.refreshTexts();
    if (status === 'ok') {
      this.close();
      return;
    }
    this.field.showStatus(status ?? 'offline');
    this.field.input.focus();
  }

  private refreshTexts(): void {
    (this.element.querySelector('#nick-dialog-title') as HTMLElement).textContent = t('nickDialog.title');
    (this.element.querySelector('#nick-dialog-text') as HTMLElement).textContent = t('nickDialog.text');
    const shuffle = this.element.querySelector('[data-shuffle]') as HTMLElement;
    shuffle.setAttribute('aria-label', t('nickDialog.shuffle'));
    shuffle.title = t('nickDialog.shuffle');
    (this.element.querySelector('[data-later]') as HTMLElement).textContent = t('nickDialog.later');
    if (!this.busy) this.save.textContent = t('account.save');
    this.field.refresh();
  }
}
