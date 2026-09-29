import type { HoldMode } from '../core/Input';
import { formatCm, onLocaleChange, t, type MessageKey } from '../i18n';
import { STEP_COPY, type TutorialStepId } from '../tutorial/steps';
import type { TutorialView } from '../tutorial/Tutorial';
import { CatalogIcons, GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { actionCaps, withCaps, type PromptContext } from './prompts';

const STEP_ICONS: Record<TutorialStepId, string> = {
  look: Icons.eye,
  move: Icons.move,
  run: Icons.run,
  jump: Icons.jump,
  grab: Icons.grab,
  grow: CatalogIcons.dung,
  bury: GameIcons.burrow,
  eat: GameIcons.food,
};

/** Como agarrar e correr funcionam agora (o texto muda: "segure" x "aperte"). */
export interface HoldModes {
  grab: HoldMode;
  run: HoldMode;
}

/**
 * Cartão do tutorial no HUD: passo atual (ícone, título, o que fazer com a tecla do
 * dispositivo em uso), barrinha de progresso, bolinhas dos passos e como pular. O
 * texto só é refeito quando algo que ele mostra muda; a barrinha anda a cada quadro.
 */
export class TutorialCard {
  readonly element: HTMLElement;
  /** Pular (botão do cartão; no teclado/controle o caminho é a pausa). */
  onSkip: (() => void) | null = null;

  private readonly eyebrow: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly cm: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly skipHint: HTMLElement;
  private readonly live: HTMLElement;
  private shown = '';
  private shownFill = -1;
  private shownCm = '';
  private lastSpoken = '';
  /** Passo desenhado por último (passo novo = animação de entrada; só troca de dispositivo, não). */
  private lastStep = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('section');
    this.element.className = 'tutor';
    this.element.hidden = true;
    this.element.setAttribute('aria-labelledby', 'tutor-title');
    this.element.innerHTML = /* html */ `
      <div class="tutor__head">
        <span class="tutor__eyebrow" data-eyebrow></span>
        <ol class="tutor__dots" data-dots aria-hidden="true"></ol>
      </div>
      <div class="tutor__main">
        <span class="tutor__icon" data-icon aria-hidden="true"></span>
        <div class="tutor__text">
          <h2 class="tutor__title" id="tutor-title" data-title></h2>
          <p class="tutor__body" data-body></p>
        </div>
      </div>
      <div class="tutor__bar" data-bar aria-hidden="true"><div class="tutor__track"><div class="tutor__fill" data-fill></div></div><span class="tutor__cm" data-cm></span></div>
      <p class="tutor__tip" data-tip hidden></p>
      <footer class="tutor__foot" data-foot>
        <span class="tutor__skip-hint" data-skip-hint></span>
        <button class="tutor__skip" type="button" data-skip></button>
      </footer>
      <p class="sr-only" data-live aria-live="polite"></p>`;
    parent.append(this.element);
    const $ = (sel: string) => this.element.querySelector(sel) as HTMLElement;
    this.eyebrow = $('[data-eyebrow]');
    this.dots = $('[data-dots]');
    this.icon = $('[data-icon]');
    this.title = $('[data-title]');
    this.body = $('[data-body]');
    this.bar = $('[data-bar]');
    this.fill = $('[data-fill]');
    this.cm = $('[data-cm]');
    this.tip = $('[data-tip]');
    this.foot = $('[data-foot]');
    this.skipHint = $('[data-skip-hint]');
    this.live = $('[data-live]');
    const skip = $('[data-skip]');
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSkip?.();
    });
    // Tocar no cartão não vira arrastar de câmera.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    onLocaleChange(() => (this.shown = ''));
  }

  /** Mostra o passo (ou o cartão final); `null` esconde. */
  render(view: TutorialView | null, ctx: PromptContext, modes: HoldModes): void {
    if (!view) {
      if (!this.element.hidden) this.element.hidden = true;
      this.shown = '';
      this.lastStep = '';
      return;
    }
    this.element.hidden = false;
    const key = view.kind === 'finish' ? `finish|${ctx.device}` : `${view.step}|${view.done}|${view.tip}|${ctx.device}|${ctx.style}|${modes.grab}|${modes.run}`;
    if (key !== this.shown) {
      this.shown = key;
      this.shownFill = -1;
      this.shownCm = '';
      if (view.kind === 'finish') this.renderFinish();
      else this.renderStep(view, ctx, modes);
    }
    if (view.kind === 'step') this.renderProgress(view);
  }

  private renderStep(view: Extract<TutorialView, { kind: 'step' }>, ctx: PromptContext, modes: HoldModes): void {
    const copy = STEP_COPY[view.step];
    const el = this.element;
    el.dataset.step = view.step;
    el.classList.toggle('is-done', view.done);
    el.classList.remove('is-finish');
    this.enter(view.step);
    this.eyebrow.textContent = t('tutorial.eyebrow', { n: view.index + 1, total: view.total });
    this.dots.innerHTML = Array.from({ length: view.total }, (_, i) => {
      const state = i < view.index || (i === view.index && view.done) ? 'is-past' : i === view.index ? 'is-current' : '';
      return `<li class="${state}"></li>`;
    }).join('');
    this.icon.innerHTML = view.done ? Icons.check : STEP_ICONS[view.step];
    this.title.textContent = t(copy.title);
    this.body.innerHTML = this.bodyHtml(view.step, ctx, modes);
    this.bar.hidden = view.progress === null;
    this.tip.hidden = view.tip === null;
    if (view.tip === 'recall') this.tip.innerHTML = ctx.device === 'touch' ? escapeHtml(t('tutorial.tip.recallTouch')) : withCaps(t('tutorial.tip.recall'), 'recall', ctx);
    // Pular: no toque um botão; no teclado/controle, a pausa (o mouse está preso no jogo).
    this.foot.hidden = view.done;
    const touch = ctx.device === 'touch';
    this.foot.classList.toggle('is-touch', touch);
    (this.foot.querySelector('[data-skip]') as HTMLElement).textContent = t('tutorial.skip');
    this.skipHint.innerHTML = touch ? '' : escapeHtml(t('tutorial.skipHint')).replace('{key}', actionCaps('pause', ctx));
    // Leitor de tela: o passo novo (não a barrinha andando).
    const spoken = view.done ? t('tutorial.doneSpoken', { step: t(copy.title) }) : `${t(copy.title)}. ${this.body.textContent ?? ''}`;
    if (spoken !== this.lastSpoken) {
      this.lastSpoken = spoken;
      this.live.textContent = spoken;
    }
  }

  /** Passo novo entra deslizando (a classe é refeita pra animação recomeçar). */
  private enter(step: string): void {
    if (step === this.lastStep) return;
    this.lastStep = step;
    const el = this.element;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');
  }

  private bodyHtml(step: TutorialStepId, ctx: PromptContext, modes: HoldModes): string {
    const copy = STEP_COPY[step];
    if (ctx.device === 'touch') return escapeHtml(t(copy.bodyTouch));
    const toggle = (step === 'grab' && modes.grab === 'toggle') || (step === 'run' && modes.run === 'toggle');
    const key: MessageKey = toggle && copy.bodyToggle ? copy.bodyToggle : ctx.device === 'gamepad' && copy.bodyPad ? copy.bodyPad : copy.body;
    return withCaps(t(key), copy.action, ctx);
  }

  private renderProgress(view: Extract<TutorialView, { kind: 'step' }>): void {
    if (view.progress !== null) {
      const fill = Math.round(view.progress * 200) / 200;
      if (fill !== this.shownFill) {
        this.shownFill = fill;
        this.fill.style.transform = `scaleX(${fill.toFixed(3)})`;
      }
    }
    const cm = view.cm ? `${formatCm(Math.min(view.cm.now, view.cm.goal))} / ${formatCm(view.cm.goal)}` : '';
    if (cm !== this.shownCm) {
      this.shownCm = cm;
      this.cm.textContent = cm;
    }
  }

  private renderFinish(): void {
    const el = this.element;
    el.dataset.step = 'finish';
    el.classList.remove('is-done');
    el.classList.add('is-finish');
    this.enter('finish');
    this.eyebrow.textContent = t('tutorial.finishEyebrow');
    this.dots.innerHTML = '';
    this.icon.innerHTML = GameIcons.star;
    this.title.textContent = t('tutorial.finish.title');
    this.body.textContent = t('tutorial.finish.body');
    this.bar.hidden = true;
    this.tip.hidden = true;
    this.foot.hidden = true;
    this.live.textContent = `${t('tutorial.finish.title')} ${t('tutorial.finish.body')}`;
  }
}
