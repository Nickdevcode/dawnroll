import type { Input } from '../core/Input';
import { isTouchDevice } from '../core/device';

/** Ícones SVG inline (sem emoji na interface, sem dependência de biblioteca). */
const Icons = {
  ball: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="25" r="19" fill="#7b4c2a"/><circle cx="24" cy="25" r="19" fill="url(#g)"/><defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#b17a47"/><stop offset="0.6" stop-color="#7b4c2a" stop-opacity="0"/></radialGradient></defs><circle cx="17" cy="19" r="3.2" fill="#9a6a3c"/><circle cx="30" cy="31" r="4" fill="#5b3820"/><path d="M12 30c4 2 6 1 9-1" stroke="#e6c46a" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  soundOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  soundOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="3"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7 14h10"/></svg>`,
  grab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 17.2L4.3 13.8a1.5 1.5 0 0 1 2.6-1.5L8 14"/></svg>`,
  jump: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6"/><path d="M6 11l6-6 6 6"/></svg>`,
  recall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><circle cx="12" cy="12" r="3"/></svg>`,
  run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h10"/><path d="M11 6l6 6-6 6"/><path d="M19 6v12"/></svg>`,
};

/** Marcos de tamanho (cm) que disparam um aviso comemorativo. */
const MILESTONES: Array<[number, string]> = [
  [3, 'Bola respeitável'],
  [5, 'Olha o tamanho disso'],
  [8, 'Bola de campeonato'],
  [12, 'Lenda do esterco'],
  [16, 'O Rei da Bosta'],
];

const formatCm = (cm: number): string => `${cm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;

export type HintKind = 'none' | 'grab' | 'pushing' | 'tooSmall';

/**
 * Interface do jogo: tela inicial, HUD, avisos e controles de toque.
 * Só manipula DOM — o estado de jogo chega pelos métodos `set*`.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly startOverlay: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly ballCard: HTMLElement;
  private readonly ballValue: HTMLElement;
  private readonly ballMeta: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly loader: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly startLabel: HTMLElement;
  private readonly liveRegion: HTMLElement;

  private milestoneIndex = 0;
  private toastTimer = 0;
  private bumpTimer = 0;
  private currentHint: HintKind = 'none';
  private lastCm = -1;
  private lastCount = -1;

  readonly isTouch = isTouchDevice;

  onStart: (() => void) | null = null;
  onToggleSound: (() => boolean) | null = null;

  constructor(container: HTMLElement, private readonly input: Input) {
    this.root = container;
    if (this.isTouch) document.documentElement.classList.add('is-touch');
    this.root.innerHTML = this.template();

    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.startOverlay = $('[data-start]');
    this.hud = $('[data-hud]');
    this.ballCard = $('[data-ball-card]');
    this.ballValue = $('[data-ball-value]');
    this.ballMeta = $('[data-ball-meta]');
    this.progressFill = $('[data-progress]');
    this.hint = $('[data-hint]');
    this.toast = $('[data-toast]');
    this.soundButton = $('[data-sound]');
    this.loader = $('[data-loader]');
    this.startButton = $('[data-play]');
    this.startLabel = $('[data-play-label]');
    this.liveRegion = $('[data-live]');

    this.startButton.addEventListener('click', () => this.onStart?.());
    this.soundButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const muted = this.onToggleSound?.() ?? false;
      this.soundButton.innerHTML = muted ? Icons.soundOff : Icons.soundOn;
      this.soundButton.setAttribute('aria-label', muted ? 'Ligar som' : 'Desligar som');
    });
    $<HTMLButtonElement>('[data-help]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.showStart(true);
    });

    $<HTMLButtonElement>('[data-recall]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.input.queueReset();
    });

    if (this.isTouch) this.bindTouchControls();
  }

  setLoaded(): void {
    this.loader.classList.add('is-done');
    this.startButton.disabled = false;
    this.startButton.focus({ preventScroll: true });
  }

  /** Mostra a tela inicial (ou de pausa, se o jogo já começou). */
  showStart(paused: boolean): void {
    this.startOverlay.hidden = false;
    this.startLabel.textContent = paused ? 'Continuar' : 'Jogar';
    this.hud.classList.remove('is-visible');
  }

  hideStart(): void {
    this.startOverlay.hidden = true;
    this.hud.classList.add('is-visible');
  }

  get isStartVisible(): boolean {
    return !this.startOverlay.hidden;
  }

  setBall(diameterCm: number, dungCount: number): void {
    const cm = Math.round(diameterCm * 10) / 10;
    if (cm !== this.lastCm) {
      this.ballValue.textContent = formatCm(cm);
      const [prev, next] = this.milestoneRange(cm);
      const progress = next === prev ? 1 : (cm - prev) / (next - prev);
      this.progressFill.style.transform = `scaleX(${Math.min(Math.max(progress, 0), 1).toFixed(3)})`;
      if (this.lastCm > 0 && cm > this.lastCm) this.bump();
      this.lastCm = cm;

      while (this.milestoneIndex < MILESTONES.length && cm >= MILESTONES[this.milestoneIndex][0]) {
        this.showToast(`${MILESTONES[this.milestoneIndex][1]} · ${formatCm(MILESTONES[this.milestoneIndex][0])}`);
        this.milestoneIndex++;
      }
    }
    if (dungCount !== this.lastCount) {
      this.ballMeta.textContent = dungCount === 1 ? '1 montinho' : `${dungCount} montinhos`;
      this.lastCount = dungCount;
    }
  }

  setHint(kind: HintKind): void {
    if (kind === this.currentHint) return;
    this.currentHint = kind;
    const messages: Record<HintKind, string> = {
      none: '',
      grab: this.isTouch
        ? 'Toque na mão para agarrar a bola'
        : 'Segure <span class="keycap">E</span> ou o botão esquerdo para agarrar a bola',
      pushing: this.isTouch ? 'Empurre com o analógico · toque na mão para soltar' : 'Mire com o mouse e ande para rolar · solte para largar',
      tooSmall: '',
    };
    const html = messages[kind];
    if (html) {
      this.hint.innerHTML = `<span class="chip">${html}</span>`;
      this.hint.classList.add('is-visible');
    } else {
      this.hint.classList.remove('is-visible');
    }
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('is-visible');
    }
    if (this.bumpTimer > 0) {
      this.bumpTimer -= dt;
      if (this.bumpTimer <= 0) this.ballCard.classList.remove('is-bump');
    }
  }

  private bump(): void {
    this.ballCard.classList.add('is-bump');
    this.bumpTimer = 0.18;
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    this.liveRegion.textContent = text;
    this.toastTimer = 2.6;
  }

  private milestoneRange(cm: number): [number, number] {
    let prev = 2;
    for (const [value] of MILESTONES) {
      if (cm < value) return [prev, value];
      prev = value;
    }
    return [prev, prev];
  }

  private bindTouchControls(): void {
    const joystick = this.root.querySelector('[data-joystick]') as HTMLElement;
    const knob = this.root.querySelector('[data-knob]') as HTMLElement;
    const lookZone = this.root.querySelector('[data-look]') as HTMLElement;
    const grabBtn = this.root.querySelector('[data-touch-grab]') as HTMLElement;
    const jumpBtn = this.root.querySelector('[data-touch-jump]') as HTMLElement;
    const runBtn = this.root.querySelector('[data-touch-run]') as HTMLElement;

    let stickId: number | null = null;
    const radius = 56;
    const moveStick = (e: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.setTouchMove(dx / radius, -dy / radius);
    };
    joystick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) moveStick(e);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      this.input.setTouchMove(0, 0);
    };
    joystick.addEventListener('pointerup', endStick);
    joystick.addEventListener('pointercancel', endStick);

    let lookId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    lookZone.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      lookZone.setPointerCapture(e.pointerId);
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.input.addTouchLook((e.clientX - lastX) * 1.6, (e.clientY - lastY) * 1.6);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = null;
    };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    // Agarrar no toque é alternância (segurar o dedo e ainda mirar seria desconfortável).
    let grabbing = false;
    grabBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grabbing = !grabbing;
      grabBtn.classList.toggle('is-active', grabbing);
      grabBtn.setAttribute('aria-pressed', String(grabbing));
      this.input.setTouchGrab(grabbing);
    });
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.queueJump();
      jumpBtn.classList.add('is-active');
    });
    jumpBtn.addEventListener('pointerup', () => jumpBtn.classList.remove('is-active'));
    const setRun = (active: boolean) => {
      runBtn.classList.toggle('is-active', active);
      this.input.setTouchRun(active);
    };
    runBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setRun(true);
    });
    runBtn.addEventListener('pointerup', () => setRun(false));
    runBtn.addEventListener('pointercancel', () => setRun(false));
  }

  private template(): string {
    const key = (k: string) => `<span class="keycap">${k}</span>`;
    return /* html */ `
      <div class="loader" data-loader role="status" aria-live="polite">
        <div>
          <div class="loader__ball"></div>
          <div class="loader__text">Amassando a massinha…</div>
        </div>
      </div>

      <div class="hud" data-hud>
        <div class="hud__top">
          <div class="ball-card" data-ball-card>
            <div class="ball-card__icon">${Icons.ball}</div>
            <div style="flex:1">
              <div class="ball-card__label">Sua bola</div>
              <div class="ball-card__value" data-ball-value>1,3 cm</div>
              <div class="ball-card__meta" data-ball-meta>0 montinhos</div>
              <div class="progress" aria-hidden="true"><div class="progress__fill" data-progress></div></div>
            </div>
          </div>
          <div class="hud__actions">
            <button class="btn btn--icon touch-only" data-recall type="button" aria-label="Trazer a bola de volta">${Icons.recall}</button>
            <button class="btn btn--icon" data-help type="button" aria-label="Ver controles">${Icons.help}</button>
            <button class="btn btn--icon" data-sound type="button" aria-label="Desligar som">${Icons.soundOn}</button>
          </div>
        </div>

        <div class="hint" data-hint aria-hidden="true"></div>
        <div class="toast" data-toast aria-hidden="true"></div>
        <div class="sr-only" data-live aria-live="polite"></div>

        <div class="touch" aria-hidden="true">
          <div class="look-zone" data-look></div>
          <div class="joystick" data-joystick><div class="joystick__knob" data-knob></div></div>
          <div class="touch-buttons">
            <button class="btn touch-btn" data-touch-run type="button" aria-label="Correr">${Icons.run}</button>
            <button class="btn touch-btn" data-touch-grab type="button" aria-label="Agarrar a bola" aria-pressed="false">${Icons.grab}</button>
            <button class="btn touch-btn" data-touch-jump type="button" aria-label="Pular">${Icons.jump}</button>
          </div>
        </div>
      </div>

      <div class="overlay" data-start role="dialog" aria-modal="true" aria-labelledby="game-title">
        <div class="panel">
          <h1 class="title" id="game-title"><span>Rola</span> <span>Bosta</span></h1>
          <p class="tagline">Empurre, role e faça a maior bola de bosta do jardim.</p>
          <button class="btn btn--primary" data-play type="button" disabled><span data-play-label>Jogar</span></button>

          <div class="controls controls--desktop">
            <div class="controls__row"><span class="controls__keys">${key('W')}${key('A')}${key('S')}${key('D')}</span> Andar</div>
            <div class="controls__row"><span class="controls__keys">${key('Mouse')}</span> Olhar em volta</div>
            <div class="controls__row"><span class="controls__keys">${key('E')}</span> ou clique: segurar a bola</div>
            <div class="controls__row"><span class="controls__keys">${key('Espaço')}</span> Pular</div>
            <div class="controls__row"><span class="controls__keys">${key('Shift')}</span> Correr</div>
            <div class="controls__row"><span class="controls__keys">${key('R')}</span> Trazer a bola de volta</div>
          </div>
          <div class="controls controls--touch">
            <div class="controls__row">Analógico à esquerda: andar</div>
            <div class="controls__row">Arraste à direita: olhar em volta</div>
            <div class="controls__row">Mão: agarrar/soltar a bola</div>
            <div class="controls__row">Seta: pular</div>
            <div class="controls__row">Seta circular (no topo): trazer a bola</div>
          </div>
          <p class="footnote">Dica: role por cima dos montinhos pra bola crescer. Grandona, ela pega até graveto e pedrinha.</p>
        </div>
      </div>
    `;
  }
}
