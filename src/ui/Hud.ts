import type { Input } from '../core/Input';
import { isTouchDevice } from '../core/device';
import type { SaveData } from '../core/save';

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
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/></svg>`,
  /** Seta do marcador da toca (aponta para cima; o HUD gira). */
  pointer: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 11h-4.5v7h-5v-7H5z" fill="currentColor"/></svg>`,
};

/** Marcos de tamanho (cm) que disparam um aviso comemorativo. */
const MILESTONES: Array<[number, string]> = [
  [3, 'Bola respeitável'],
  [5, 'Olha o tamanho disso'],
  [8, 'Bola de campeonato'],
  [12, 'Lenda do esterco'],
  [16, 'Terror do jardim'],
  [20, 'Planeta Bosta'],
  [24, 'O Rei da Bosta'],
];

const formatCm = (cm: number): string => `${cm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;
const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export type HintKind = 'none' | 'grab' | 'pushing' | 'tooSmall' | 'burrowTooSmall' | 'dissolving';

/** Onde desenhar o marcador da toca (coordenadas normalizadas da câmera). */
export interface BurrowMarkerState {
  /** -1..1 (esquerda → direita). */
  ndcX: number;
  /** -1..1 (baixo → cima). */
  ndcY: number;
  /** Ponto atrás da câmera (a direção na tela fica invertida). */
  behind: boolean;
  distanceCm: number;
  /** A bola já tem tamanho para ser enterrada. */
  ready: boolean;
}

export interface RoundResult {
  diameterCm: number;
  dungCount: number;
  itemCount: number;
  record: boolean;
}

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
  private readonly recordChip: HTMLElement;
  private readonly startRecord: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly markerArrow: HTMLElement;
  private readonly markerLabel: HTMLElement;
  private readonly result: HTMLElement;

  private milestoneIndex = 0;
  private toastTimer = 0;
  private bumpTimer = 0;
  private resultTimer = 0;
  private currentHint = '';
  private lastCm = -1;
  private lastMeta = '';
  private lastMarkerLabel = '';

  readonly isTouch = isTouchDevice;

  onStart: (() => void) | null = null;
  onToggleSound: (() => boolean) | null = null;
  /** Passou de um marco de tamanho (índice do marco). */
  onMilestone: ((index: number) => void) | null = null;

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
    this.recordChip = $('[data-record]');
    this.startRecord = $('[data-start-record]');
    this.marker = $('[data-burrow]');
    this.markerArrow = $('[data-burrow-arrow]');
    this.markerLabel = $('[data-burrow-label]');
    this.result = $('[data-result]');

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

  setBall(diameterCm: number, dungCount: number, itemCount: number): void {
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
        this.onMilestone?.(this.milestoneIndex);
        this.milestoneIndex++;
      }
    }
    const meta = itemCount > 0 ? `${plural(dungCount, 'montinho', 'montinhos')} · ${plural(itemCount, 'coisa', 'coisas')}` : plural(dungCount, 'montinho', 'montinhos');
    if (meta !== this.lastMeta) {
      this.ballMeta.textContent = meta;
      this.lastMeta = meta;
    }
  }

  /** Rodada nova: marcos e contadores voltam do zero (sem comemorar a bola pequena de novo). */
  resetRound(): void {
    this.milestoneIndex = 0;
    this.lastCm = -1;
    this.lastMeta = '';
  }

  /** Recorde e bolas enterradas (chip do HUD + linha da tela inicial). */
  setProgress(save: SaveData): void {
    const has = save.buried > 0;
    this.recordChip.hidden = !has;
    this.startRecord.hidden = !has;
    if (!has) return;
    const best = formatCm(save.bestCm);
    const count = plural(save.buried, 'enterrada', 'enterradas');
    this.recordChip.innerHTML = `${Icons.trophy}<span>Recorde <strong>${best}</strong></span><span class="record-chip__sep" aria-hidden="true">·</span><span>${count}</span>`;
    this.startRecord.innerHTML = `${Icons.trophy}<span>Seu recorde: <strong>${best}</strong> · ${plural(save.buried, 'bola enterrada', 'bolas enterradas')}</span>`;
  }

  /** Cartão de comemoração ao enterrar uma bola. */
  showResult(result: RoundResult): void {
    const $ = (sel: string) => this.result.querySelector(sel) as HTMLElement;
    $('[data-result-value]').textContent = formatCm(Math.round(result.diameterCm * 10) / 10);
    const parts = [plural(result.dungCount, 'montinho', 'montinhos')];
    if (result.itemCount > 0) parts.push(plural(result.itemCount, 'coisa grudada', 'coisas grudadas'));
    $('[data-result-meta]').textContent = parts.join(' · ');
    $('[data-result-badge]').hidden = !result.record;
    this.result.classList.add('is-visible');
    this.resultTimer = 4.6;
    this.hint.classList.remove('is-visible');
    this.liveRegion.textContent = `Bola enterrada: ${formatCm(result.diameterCm)}${result.record ? '. Novo recorde!' : ''}`;
  }

  setHint(kind: HintKind, value = 0): void {
    const key = `${kind}|${value.toFixed(1)}`;
    if (key === this.currentHint) return;
    this.currentHint = key;
    let html = '';
    switch (kind) {
      case 'grab':
        html = this.isTouch ? 'Toque na mão para agarrar a bola' : 'Segure <span class="keycap">E</span> ou o botão esquerdo para agarrar a bola';
        break;
      case 'pushing':
        html = this.isTouch ? 'Empurre com o analógico · toque na mão para soltar' : 'Mire com o mouse e ande para rolar · solte para largar';
        break;
      case 'tooSmall':
        html = `Grande demais pra sua bola · cresça até <strong>${formatCm(value)}</strong>`;
        break;
      case 'burrowTooSmall':
        html = `Bola pequena pra enterrar · cresça até <strong>${formatCm(value)}</strong>`;
        break;
      case 'dissolving':
        html = 'A água tá derretendo sua bola! Saia da poça';
        break;
      case 'none':
        break;
    }
    // Com o cartão de resultado na tela, dica nenhuma disputa o espaço com ele.
    if (html && this.resultTimer <= 0) {
      this.hint.innerHTML = `<span class="chip${kind === 'dissolving' ? ' chip--warn' : ''}">${html}</span>`;
      this.hint.classList.add('is-visible');
    } else {
      this.hint.classList.remove('is-visible');
    }
  }

  /**
   * Marcador da toca: pino em cima dela quando está na tela; seta presa na borda
   * apontando para ela quando está fora. `null` esconde.
   */
  setBurrowMarker(state: BurrowMarkerState | null): void {
    if (!state) {
      this.marker.classList.remove('is-visible');
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Área útil: fora do topo (cartão da bola) e, no toque, fora dos polegares.
    const top = this.isTouch ? 150 : 120;
    const bottom = this.isTouch ? 190 : 70;
    const side = this.isTouch ? 70 : 56;

    let x = (state.ndcX * 0.5 + 0.5) * w;
    let y = (-state.ndcY * 0.5 + 0.5) * h;
    const onScreen = !state.behind && x > side && x < w - side && y > top && y < h - bottom;
    let angle = 180; // pino apontando para baixo (para a toca)
    if (!onScreen) {
      // Direção a partir do centro; atrás da câmera, a projeção vem espelhada.
      const cx = w / 2;
      const cy = (top + h - bottom) / 2;
      let dx = x - cx;
      let dy = y - cy;
      if (state.behind) {
        dx = -dx;
        dy = -dy;
      }
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
      const hx = w / 2 - side;
      const hy = (h - bottom - top) / 2;
      const k = Math.min(hx / Math.abs(dx || 1e-3), hy / Math.abs(dy || 1e-3));
      x = cx + dx * k;
      y = cy + dy * k;
      angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    }
    this.marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.markerArrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    this.marker.classList.add('is-visible');
    this.marker.classList.toggle('is-ready', state.ready);
    this.marker.classList.toggle('is-edge', !onScreen);
    const label = `${state.ready ? 'Enterre aqui' : 'Toca'} · ${Math.round(state.distanceCm)} cm`;
    if (label !== this.lastMarkerLabel) {
      this.markerLabel.textContent = label;
      this.lastMarkerLabel = label;
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
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.result.classList.remove('is-visible');
        // Força a dica atual a reaparecer no próximo `setHint`.
        this.currentHint = '';
      }
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
        <div class="burrow-marker" data-burrow aria-hidden="true">
          <div class="burrow-marker__arrow" data-burrow-arrow>${Icons.pointer}</div>
          <div class="burrow-marker__label" data-burrow-label>Toca</div>
        </div>

        <div class="hud__top">
          <div class="hud__stack">
            <div class="ball-card" data-ball-card>
              <div class="ball-card__icon">${Icons.ball}</div>
              <div style="flex:1">
                <div class="ball-card__label">Sua bola</div>
                <div class="ball-card__value" data-ball-value>2,0 cm</div>
                <div class="ball-card__meta" data-ball-meta>0 montinhos</div>
                <div class="progress" aria-hidden="true"><div class="progress__fill" data-progress></div></div>
              </div>
            </div>
            <div class="record-chip" data-record hidden></div>
          </div>
          <div class="hud__actions">
            <button class="btn btn--icon touch-only" data-recall type="button" aria-label="Trazer a bola de volta">${Icons.recall}</button>
            <button class="btn btn--icon" data-help type="button" aria-label="Ver controles">${Icons.help}</button>
            <button class="btn btn--icon" data-sound type="button" aria-label="Desligar som">${Icons.soundOn}</button>
          </div>
        </div>

        <div class="hint" data-hint aria-hidden="true"></div>
        <div class="toast" data-toast aria-hidden="true"></div>
        <div class="result" data-result aria-hidden="true">
          <div class="result__badge" data-result-badge hidden>${Icons.trophy}<span>Novo recorde!</span></div>
          <div class="result__title">Bola enterrada!</div>
          <div class="result__value" data-result-value>0,0 cm</div>
          <div class="result__meta" data-result-meta></div>
        </div>
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
          <p class="tagline">Role a bola, engula o jardim e enterre tudo na toca.</p>
          <p class="start-record" data-start-record hidden></p>
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
          <p class="footnote">Bola grande arranca flor, cogumelo e até pedra. Siga a bandeirinha até a toca pra enterrar e bater recorde. Na chuva, fuja das poças: a água derrete a bosta.</p>
        </div>
      </div>
    `;
  }
}
