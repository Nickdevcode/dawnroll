import type { Input, InputDevice } from '../core/Input';
import { PAD_LABELS, type PadStyle } from '../core/GamepadInput';
import { isTouchDevice } from '../core/device';
import type { SaveData } from '../core/save';
import { formatCm, onLocaleChange, t, tn, type MessageKey } from '../i18n';
import { Icons } from './icons';

/** Marcos de tamanho (cm) que disparam um aviso comemorativo; o nome vem do dicionário. */
const MILESTONES: ReadonlyArray<[number, MessageKey]> = [
  [3, 'milestone.1'],
  [5, 'milestone.2'],
  [8, 'milestone.3'],
  [12, 'milestone.4'],
  [16, 'milestone.5'],
  [20, 'milestone.6'],
  [24, 'milestone.7'],
];

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
 * Interface em jogo: carregando, cartão da bola, dicas, avisos, marcador da toca,
 * resultado da rodada e controles de toque. Só manipula DOM — o estado de jogo
 * chega pelos métodos `set*`. O menu (início/pausa/configurações) mora em `Menu`.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly ballCard: HTMLElement;
  private readonly ballValue: HTMLElement;
  private readonly ballMeta: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly loader: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly recordChip: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly markerArrow: HTMLElement;
  private readonly markerLabel: HTMLElement;
  private readonly result: HTMLElement;
  private readonly fps: HTMLElement;
  /** Textos fixos: elemento + chave (+ atributo, se não for o texto). */
  private readonly texts: Array<[HTMLElement, MessageKey, string?]> = [];

  private milestoneIndex = 0;
  private toastTimer = 0;
  private bumpTimer = 0;
  private resultTimer = 0;
  private currentHint = '';
  private lastCm = -1;
  private lastMeta = '';
  private lastMarkerLabel = '';
  private lastFps = -1;
  private muted = false;
  private lastSave: SaveData | null = null;
  private lastResult: RoundResult | null = null;
  private hintState: { kind: HintKind; value: number } = { kind: 'none', value: 0 };
  /** Último dispositivo usado e estilo do controle (as dicas falam a língua dele). */
  private device: InputDevice = isTouchDevice ? 'touch' : 'keyboard';
  private padStyle: PadStyle = 'xbox';
  private markerState: BurrowMarkerState | null = null;

  readonly isTouch = isTouchDevice;

  onToggleSound: (() => boolean) | null = null;
  /** Botão de pausa/menu do HUD. */
  onOpenMenu: (() => void) | null = null;
  /** Passou de um marco de tamanho (índice do marco). */
  onMilestone: ((index: number) => void) | null = null;

  constructor(container: HTMLElement, private readonly input: Input) {
    this.root = container;
    if (this.isTouch) document.documentElement.classList.add('is-touch');
    this.root.innerHTML = this.template();

    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.hud = $('[data-hud]');
    this.ballCard = $('[data-ball-card]');
    this.ballValue = $('[data-ball-value]');
    this.ballMeta = $('[data-ball-meta]');
    this.progressFill = $('[data-progress]');
    this.hint = $('[data-hint]');
    this.toast = $('[data-toast]');
    this.soundButton = $('[data-sound]');
    this.loader = $('[data-loader]');
    this.liveRegion = $('[data-live]');
    this.recordChip = $('[data-record]');
    this.marker = $('[data-burrow]');
    this.markerArrow = $('[data-burrow-arrow]');
    this.markerLabel = $('[data-burrow-label]');
    this.result = $('[data-result]');
    this.fps = $('[data-fps]');
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => this.texts.push([el, el.dataset.t as MessageKey]));
    this.root.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((el) => this.texts.push([el, el.dataset.tAria as MessageKey, 'aria-label']));

    this.soundButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMuted(this.onToggleSound?.() ?? false);
    });
    $<HTMLButtonElement>('[data-menu-open]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenMenu?.();
    });
    $<HTMLButtonElement>('[data-recall]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.input.queueReset();
    });

    if (this.isTouch) this.bindTouchControls();
    onLocaleChange(() => this.refreshTexts());
    this.refreshTexts();
  }

  /** Mundo pronto: o "carregando" some. */
  setLoaded(): void {
    this.loader.classList.add('is-done');
  }

  /** HUD aparece durante o jogo e some por trás do menu. */
  setVisible(visible: boolean): void {
    this.hud.classList.toggle('is-visible', visible);
  }

  /** Estado do botão de som (vem das configurações salvas ou do clique). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.soundButton.innerHTML = muted ? Icons.soundOff : Icons.soundOn;
    this.soundButton.setAttribute('aria-label', t(muted ? 'hud.unmute' : 'hud.mute'));
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
        const [value, name] = MILESTONES[this.milestoneIndex];
        this.showToast(`${t(name)} · ${formatCm(value)}`);
        this.onMilestone?.(this.milestoneIndex);
        this.milestoneIndex++;
      }
    }
    const dung = tn('hud.dung', dungCount);
    const meta = itemCount > 0 ? `${dung} · ${tn('hud.items', itemCount)}` : dung;
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

  /** Recorde e bolas enterradas (chip do HUD). */
  setProgress(save: SaveData): void {
    this.lastSave = save;
    const has = save.buried > 0;
    this.recordChip.hidden = !has;
    if (!has) return;
    this.recordChip.innerHTML = `${Icons.trophy}<span data-best></span><span class="record-chip__sep" aria-hidden="true">·</span><span data-count></span>`;
    (this.recordChip.querySelector('[data-best]') as HTMLElement).textContent = t('hud.record', { cm: formatCm(save.bestCm) });
    (this.recordChip.querySelector('[data-count]') as HTMLElement).textContent = tn('hud.buried', save.buried);
  }

  /** Cartão de comemoração ao enterrar uma bola. */
  showResult(result: RoundResult): void {
    this.lastResult = result;
    this.fillResult(result);
    this.result.classList.add('is-visible');
    this.resultTimer = 4.6;
    this.hint.classList.remove('is-visible');
    this.liveRegion.textContent = `${t('result.live', { cm: formatCm(result.diameterCm) })}${result.record ? ` ${t('result.record')}` : ''}`;
  }

  setHint(kind: HintKind, value = 0): void {
    this.hintState = { kind, value };
    const key = `${kind}|${value.toFixed(1)}`;
    if (key === this.currentHint) return;
    this.currentHint = key;
    let html = '';
    switch (kind) {
      case 'grab':
        if (this.device === 'gamepad') html = escapeHtml(t('hint.grab.gamepad')).replace('{button}', this.padCap());
        else if (this.device === 'touch') html = escapeHtml(t('hint.grab.touch'));
        else html = escapeHtml(t('hint.grab.desktop')).replace('{key}', '<span class="keycap">E</span>');
        break;
      case 'pushing':
        if (this.device === 'gamepad') html = escapeHtml(t('hint.pushing.gamepad')).replace('{button}', this.padCap());
        else html = escapeHtml(t(this.device === 'touch' ? 'hint.pushing.touch' : 'hint.pushing.desktop'));
        break;
      case 'tooSmall':
        html = escapeHtml(t('hint.tooSmall', { cm: '{cm}' })).replace('{cm}', `<strong>${formatCm(value)}</strong>`);
        break;
      case 'burrowTooSmall':
        html = escapeHtml(t('hint.burrowTooSmall', { cm: '{cm}' })).replace('{cm}', `<strong>${formatCm(value)}</strong>`);
        break;
      case 'dissolving':
        html = escapeHtml(t('hint.dissolving'));
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

  /** Dispositivo em uso mudou: as dicas passam a citar os botões dele. */
  setInputDevice(device: InputDevice, padStyle: PadStyle): void {
    if (device === this.device && padStyle === this.padStyle) return;
    this.device = device;
    this.padStyle = padStyle;
    this.currentHint = '';
    this.setHint(this.hintState.kind, this.hintState.value);
  }

  /** Aviso rápido no topo (ex.: controle conectado). */
  notify(text: string): void {
    this.showToast(text);
  }

  /** FPS no canto (null esconde). */
  setFps(fps: number | null): void {
    this.fps.hidden = fps === null;
    if (fps === null) return;
    const rounded = Math.round(fps);
    if (rounded === this.lastFps) return;
    this.lastFps = rounded;
    this.fps.textContent = t('hud.fps', { n: rounded });
  }

  /**
   * Marcador da toca: pino em cima dela quando está na tela; seta presa na borda
   * apontando para ela quando está fora. `null` esconde.
   */
  setBurrowMarker(state: BurrowMarkerState | null): void {
    this.markerState = state;
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
    const label = `${t(state.ready ? 'marker.bury' : 'marker.burrow')} · ${Math.round(state.distanceCm)} cm`;
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

  /** Idioma trocou: textos fixos na hora; os dinâmicos são refeitos a partir do último estado. */
  private refreshTexts(): void {
    for (const [el, key, attr] of this.texts) {
      if (attr) el.setAttribute(attr, t(key));
      else el.textContent = t(key);
    }
    this.setMuted(this.muted);
    this.lastCm = -1;
    this.lastMeta = '';
    this.lastMarkerLabel = '';
    this.lastFps = -1;
    this.currentHint = '';
    if (this.lastSave) this.setProgress(this.lastSave);
    if (this.lastResult) this.fillResult(this.lastResult);
    this.setHint(this.hintState.kind, this.hintState.value);
    if (this.markerState) this.setBurrowMarker(this.markerState);
  }

  /** Botão de segurar a bola (RT / R2) como "tecla" na dica. */
  private padCap(): string {
    return `<span class="keycap padcap">${escapeHtml(PAD_LABELS[this.padStyle].rt)}</span>`;
  }

  private fillResult(result: RoundResult): void {
    const $ = (sel: string) => this.result.querySelector(sel) as HTMLElement;
    $('[data-result-value]').textContent = formatCm(Math.round(result.diameterCm * 10) / 10);
    const parts = [tn('hud.dung', result.dungCount)];
    if (result.itemCount > 0) parts.push(tn('result.items', result.itemCount));
    $('[data-result-meta]').textContent = parts.join(' · ');
    $('[data-result-badge]').hidden = !result.record;
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
    return /* html */ `
      <div class="loader" data-loader role="status" aria-live="polite">
        <div>
          <div class="loader__ball"></div>
          <div class="loader__text" data-t="loader.text"></div>
        </div>
      </div>

      <div class="hud" data-hud>
        <div class="burrow-marker" data-burrow aria-hidden="true">
          <div class="burrow-marker__arrow" data-burrow-arrow>${Icons.pointer}</div>
          <div class="burrow-marker__label" data-burrow-label></div>
        </div>

        <div class="hud__top">
          <div class="hud__stack">
            <div class="ball-card" data-ball-card>
              <div class="ball-card__icon">${Icons.ball}</div>
              <div style="flex:1">
                <div class="ball-card__label" data-t="hud.yourBall"></div>
                <div class="ball-card__value" data-ball-value></div>
                <div class="ball-card__meta" data-ball-meta></div>
                <div class="progress" aria-hidden="true"><div class="progress__fill" data-progress></div></div>
              </div>
            </div>
            <div class="record-chip" data-record hidden></div>
          </div>
          <div class="hud__actions">
            <button class="btn btn--icon touch-only" data-recall type="button" data-t-aria="hud.recall">${Icons.recall}</button>
            <button class="btn btn--icon" data-menu-open type="button" data-t-aria="hud.menu">${Icons.menu}</button>
            <button class="btn btn--icon" data-sound type="button">${Icons.soundOn}</button>
          </div>
        </div>

        <div class="fps-chip" data-fps hidden aria-hidden="true"></div>
        <div class="hint" data-hint aria-hidden="true"></div>
        <div class="toast" data-toast aria-hidden="true"></div>
        <div class="result" data-result aria-hidden="true">
          <div class="result__badge" data-result-badge hidden>${Icons.trophy}<span data-t="result.record"></span></div>
          <div class="result__title" data-t="result.title"></div>
          <div class="result__value" data-result-value></div>
          <div class="result__meta" data-result-meta></div>
        </div>
        <div class="sr-only" data-live aria-live="polite"></div>

        <div class="touch" aria-hidden="true">
          <div class="look-zone" data-look></div>
          <div class="joystick" data-joystick><div class="joystick__knob" data-knob></div></div>
          <div class="touch-buttons">
            <button class="btn touch-btn" data-touch-run type="button" data-t-aria="touch.runButton">${Icons.run}</button>
            <button class="btn touch-btn" data-touch-grab type="button" data-t-aria="touch.grabButton" aria-pressed="false">${Icons.grab}</button>
            <button class="btn touch-btn" data-touch-jump type="button" data-t-aria="touch.jumpButton">${Icons.jump}</button>
          </div>
        </div>
      </div>
    `;
  }
}

/** Texto traduzido vai pro innerHTML junto com marcação nossa: escapa antes. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
