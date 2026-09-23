import type { Input, InputDevice } from '../core/Input';
import { PAD_LABELS, type PadStyle } from '../core/GamepadInput';
import { isTouchDevice } from '../core/device';
import type { SaveData } from '../core/save';
import { formatCm, onLocaleChange, t, tn, type MessageKey } from '../i18n';
import type { BurialOutcome } from '../progression/Progression';
import type { PerkId } from '../progression/perks';
import { Icons } from './icons';
import { GameIcons } from './gameIcons';
import { escapeHtml } from './html';
import { PerkPicker } from './PerkPicker';
import { RoundPanel, type RoundView } from './RoundPanel';
import { placeMarker, type ProjectedPoint, type ScreenMargins } from './screenMarker';

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
export interface BurrowMarkerState extends ProjectedPoint {
  distanceCm: number;
  /** A bola já tem tamanho para ser enterrada. */
  ready: boolean;
}

export interface RoundResult {
  diameterCm: number;
  dungCount: number;
  itemCount: number;
  record: boolean;
  /** O que o enterro rendeu (comida, pedidos, figurinhas novas). */
  outcome: BurialOutcome;
}

/** Marcadores do Faro (montinhos fresquinhos) desenhados de uma vez. */
const MAX_SCENT_MARKERS = 4;

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
  private readonly liveRegion: HTMLElement;
  private readonly recordChip: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly markerArrow: HTMLElement;
  private readonly markerLabel: HTMLElement;
  private readonly result: HTMLElement;
  private readonly resultExtra: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly burrowButton: HTMLButtonElement;
  private readonly burrowBadge: HTMLElement;
  private readonly scentMarkers: HTMLElement[] = [];
  private readonly roundPanel: RoundPanel;
  readonly perkPicker: PerkPicker;
  private pantryCount = 0;
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
  /** Botão da toca (ou tecla T): pausa e abre o painel da toca. */
  onOpenBurrow: (() => void) | null = null;

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
    this.liveRegion = $('[data-live]');
    this.recordChip = $('[data-record]');
    this.marker = $('[data-burrow]');
    this.markerArrow = $('[data-burrow-arrow]');
    this.markerLabel = $('[data-burrow-label]');
    this.result = $('[data-result]');
    this.resultExtra = $('[data-result-extra]');
    this.fps = $('[data-fps]');
    this.burrowButton = $('[data-burrow-open]');
    this.burrowBadge = $('[data-burrow-badge]');
    this.roundPanel = new RoundPanel($('[data-round-slot]'), this.isTouch);
    this.perkPicker = new PerkPicker(this.hud);
    const scentLayer = $('[data-scent]');
    for (let i = 0; i < MAX_SCENT_MARKERS; i++) {
      const marker = document.createElement('div');
      marker.className = 'scent-marker';
      marker.innerHTML = `<div class="scent-marker__arrow">${Icons.pointer}</div><div class="scent-marker__dot">${GameIcons.sparkle}</div>`;
      scentLayer.append(marker);
      this.scentMarkers.push(marker);
    }
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
    this.burrowButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenBurrow?.();
    });
    $<HTMLButtonElement>('[data-recall]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.input.queueReset();
    });

    if (this.isTouch) this.bindTouchControls();
    onLocaleChange(() => this.refreshTexts());
    this.refreshTexts();
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
    this.resultTimer = 6.5;
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
    const { x, y, angle, onScreen } = placeMarker(state, this.markerMargins(), window.innerWidth, window.innerHeight);
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

  /** Estado da rodada: nível, pedidos e poderes (o painel só refaz o que mudou). */
  setRound(view: RoundView): void {
    this.roundPanel.set(view);
  }

  /** Calor do Sangue quente (0..1). */
  setHeat(heat: number): void {
    this.roundPanel.setHeat(heat);
  }

  /** Pedido cumprido: aviso + pulinho no cartão dos pedidos. */
  requestDone(): void {
    this.showToast(t('hud.requestDone'));
    this.roundPanel.flashRequests();
  }

  /** Quantas bolas esperam na despensa (bolinha no botão da toca). */
  setPantryCount(count: number): void {
    this.pantryCount = count;
    this.burrowBadge.hidden = count === 0;
    this.burrowBadge.textContent = String(count);
    this.burrowButton.setAttribute('aria-label', count > 0 ? tn('hud.burrowCount', count) : t('hud.burrow'));
    this.burrowButton.classList.toggle('has-food', count > 0);
  }

  showPerkPicker(options: readonly PerkId[], cm: number): void {
    this.hint.classList.remove('is-visible');
    this.currentHint = '';
    this.perkPicker.show(options, cm, this.device, this.padStyle);
  }

  /** Marcadores dos montinhos fresquinhos (poder Faro). Lista vazia esconde. */
  setScentMarkers(points: readonly ProjectedPoint[]): void {
    const margins = this.markerMargins();
    this.scentMarkers.forEach((el, i) => {
      const point = points[i];
      if (!point) {
        el.classList.remove('is-visible');
        return;
      }
      const { x, y, angle, onScreen } = placeMarker(point, margins, window.innerWidth, window.innerHeight);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      (el.firstElementChild as HTMLElement).style.transform = `rotate(${angle.toFixed(1)}deg)`;
      el.classList.add('is-visible');
      el.classList.toggle('is-edge', !onScreen);
    });
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
    this.setPantryCount(this.pantryCount);
    this.setHint(this.hintState.kind, this.hintState.value);
    if (this.markerState) this.setBurrowMarker(this.markerState);
  }

  /** Área útil dos marcadores: fora do topo (cartões) e, no toque, fora dos polegares. */
  private markerMargins(): ScreenMargins {
    return this.isTouch ? { top: 150, bottom: 190, side: 70 } : { top: 120, bottom: 70, side: 56 };
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
    this.resultExtra.innerHTML = this.resultLines(result.outcome)
      .map(([icon, html]) => `<li class="result__line">${icon}<span>${html}</span></li>`)
      .join('');
  }

  /** O que a toca ganhou com o enterro: comida, nível, pedidos, figurinhas e como abrir a toca. */
  private resultLines(outcome: BurialOutcome): Array<[string, string]> {
    const lines: Array<[string, string]> = [];
    const meal = outcome.meal;
    if (outcome.stored) lines.push([GameIcons.food, escapeHtml(t('result.food', { n: outcome.food.total }))]);
    else if (meal) lines.push([GameIcons.food, escapeHtml(t('result.ate', { xp: meal.xp }))]);
    if (meal && meal.levelAfter > meal.levelBefore) lines.push([GameIcons.star, `<strong>${escapeHtml(t('burrow.levelUp', { n: meal.levelAfter }))}</strong>`]);
    if (outcome.requestsDone > 0) lines.push([Icons.check, escapeHtml(tn('result.requests', outcome.requestsDone))]);
    if (outcome.discovered.length > 0) {
      const names = outcome.discovered.slice(0, 3).map((id) => t(`catalog.${id}` as MessageKey));
      const more = outcome.discovered.length > 3 ? '…' : '';
      lines.push([GameIcons.catalog, escapeHtml(t('result.new', { names: names.join(', ') + more }))]);
    }
    if (outcome.stored) {
      let hint: string;
      if (this.device === 'gamepad') hint = escapeHtml(t('result.burrow.gamepad'));
      else if (this.device === 'touch') hint = escapeHtml(t('result.burrow.touch'));
      else hint = escapeHtml(t('result.burrow.desktop', { key: '{key}' })).replace('{key}', '<span class="keycap">T</span>');
      lines.push([GameIcons.burrow, hint]);
    }
    return lines;
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
      <div class="hud" data-hud>
        <div class="scent-layer" data-scent aria-hidden="true"></div>
        <div class="burrow-marker" data-burrow aria-hidden="true">
          <div class="burrow-marker__arrow" data-burrow-arrow>${Icons.pointer}</div>
          <div class="burrow-marker__label" data-burrow-label></div>
        </div>

        <div class="hud__top">
          <div class="hud__stack" data-round-slot>
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
            <button class="btn btn--icon burrow-btn" data-burrow-open type="button" data-t-aria="hud.burrow">${GameIcons.burrow}<span class="burrow-btn__badge" data-burrow-badge hidden></span></button>
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
          <ul class="result__extra" data-result-extra></ul>
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
