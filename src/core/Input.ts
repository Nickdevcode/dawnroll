import { GamepadInput, type MenuAction, type PadStyle } from './GamepadInput';
import { isTouchDevice } from './device';

/**
 * Estado de entrada unificado: teclado + mouse (pointer lock) + toque + controle.
 * O resto do jogo só lê `move`, `look`, `grab`, `jump`, `run` — não sabe de onde veio.
 */

/** De onde veio a última entrada (as dicas na tela acompanham). */
export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** Segurar o botão o tempo todo, ou apertar uma vez pra ligar e outra pra desligar (acessibilidade). */
export type HoldMode = 'hold' | 'toggle';

export interface InputState {
  /** Eixo de movimento no plano: x = direita, y = frente. Magnitude ≤ 1. */
  moveX: number;
  moveY: number;
  run: boolean;
  grab: boolean;
  /** true desde que o pulo foi apertado até o próximo passo de física consumir. */
  jumpPressed: boolean;
  resetPressed: boolean;
  /** Poder de apertar (Equilibrista): mesmo esquema "pegajoso" do pulo. */
  abilityPressed: boolean;
  /** Online: segurando o botão de fundir (doar a sua bola pra outro, juntar as suas). */
  merge: boolean;
  /** Online: segurando o botão de puxar (a bola do rival encostada entra na sua). */
  pull: boolean;
  /** Online: abrir a roda de reações (pegajoso como o pulo). */
  emotePressed: boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * Teclas que não dizem nada sobre o dispositivo em uso: modificador sozinho (Alt-Tab,
 * Ctrl de atalho), tecla de sistema, de volume/mídia e de função (F11 tela cheia, F12).
 * Controle que manda volume pelo teclado virtual não pode trocar as dicas pro teclado.
 */
const NEUTRAL_KEY = /^(Alt|AltGraph|Control|Meta|OS|Hyper|Super|Fn|FnLock|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|Unidentified|Dead|F\d{1,2}|Audio.*|Media.*|Launch.*|Browser.*|Volume.*|Mic.*)$/;

/**
 * Mouse só vira o dispositivo em uso depois de andar isso (px) em pouco tempo. O
 * navegador solta `mousemove` "fantasma" (parado, quando algo muda embaixo do cursor ou
 * quando o pointer lock entra) e mão encostada na mesa mexe 1–2 px: sem esse filtro, quem
 * jogava no controle via "aperte T" no fim do enterro.
 */
const MOUSE_INTENT_PX = 24;
const MOUSE_INTENT_WINDOW_MS = 300;

/** O alvo da tecla é um campo de texto? (aí WASD, espaço e os atalhos são letras) */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(target.type);
}

export class Input {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    run: false,
    grab: false,
    jumpPressed: false,
    resetPressed: false,
    abilityPressed: false,
    merge: false,
    pull: false,
    emotePressed: false,
  };

  /** Delta de câmera acumulado desde o último `consumeLook` (pixels). */
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;

  readonly gamepad = new GamepadInput();
  private _device: InputDevice = isTouchDevice ? 'touch' : 'keyboard';
  /** Start/Options apertado neste quadro (pausar). */
  pausePressed = false;
  /** View/Create no controle ou T no teclado neste quadro (abrir/fechar a toca). */
  burrowPressed = false;
  /** R3 no controle ou botão do meio do mouse neste quadro (câmera volta pra trás do besouro). */
  recenterPressed = false;

  /** Agarrar: segurar ou alternar (configurações; o toque é sempre alternância). */
  grabMode: HoldMode = 'hold';
  /** Correr: segurar ou alternar (configurações). */
  runMode: HoldMode = 'hold';
  /** Multiplicador do mouse e do arrasto no toque (configurações). */
  pointerLookScale = 1;

  /** Quem mostra dica escuta aqui: o dispositivo em uso (ou o estilo do controle) mudou. */
  private readonly deviceListeners = new Set<(device: InputDevice, style: PadStyle) => void>();
  private lastStyle: PadStyle = 'xbox';

  private readonly keys = new Set<string>();
  private lastUpdate = 0;
  private mouseGrab = false;
  private jumpQueued = false;
  private resetQueued = false;
  private abilityQueued = false;
  private emoteQueued = false;
  private burrowQueued = false;
  private recenterQueued = false;
  private pauseQueued = false;
  private mouseTravel = 0;
  private mouseTravelAt = 0;

  // Alternância (modo "apertar pra ligar"): estado ligado e o botão cru do quadro anterior.
  private grabLatched = false;
  private grabRawBefore = false;
  private runLatched = false;
  private runRawBefore = false;
  /** L3 liga a corrida até o besouro parar (como nos jogos de mundo aberto). */
  private sprintLatched = false;
  private stillTime = 0;
  /** Andou desde que a corrida foi ligada (só aí parar desliga: ligar parado e sair andando vale). */
  private movedWhileLatched = false;

  // Toque
  private touchMove = { x: 0, y: 0 };
  private touchGrab = false;
  private touchRun = false;
  private touchMerge = false;
  private touchPull = false;

  constructor(private readonly target: HTMLElement) {
    document.documentElement.dataset.input = this._device;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    // Clique/toque em qualquer lugar (menu incluso) diz quem está jogando.
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Último dispositivo usado de propósito (aparelho de toque começa no toque, não no teclado). */
  get device(): InputDevice {
    return this._device;
  }

  /** Estilo do controle em uso (Xbox, PlayStation, Switch). */
  get padStyle(): PadStyle {
    return this.gamepad.style;
  }

  /** Avisa quando o dispositivo em uso (ou o estilo do controle) muda. Devolve o cancelamento. */
  onDeviceChange(listener: (device: InputDevice, style: PadStyle) => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    // Em navegadores antigos o retorno não é Promise; o catch protege os novos.
    const result = this.target.requestPointerLock?.() as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  }

  /** Ações de menu vindas do controle neste quadro. */
  get menuActions(): readonly MenuAction[] {
    return this.gamepad.menuActions;
  }

  /**
   * Tira a alternância de agarrar (a bola foi embora: enterro, pulo, perdeu a bola). Sem
   * isso o besouro agarraria sozinho a próxima bola que encostasse.
   */
  releaseGrabLatch(): void {
    this.grabLatched = false;
  }

  /** Chamado uma vez por frame, antes da simulação. */
  update(): void {
    const now = performance.now();
    const dt = this.lastUpdate === 0 ? 1 / 60 : Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;
    const pad = this.gamepad;
    pad.poll(dt);
    // Controle segurado continua valendo (analógico inclinado sem borda nova), mas só a
    // intenção (borda) tira as dicas de outro dispositivo.
    if (pad.intent) this.setDevice('gamepad');
    else if (pad.style !== this.lastStyle && this._device === 'gamepad') this.setDevice('gamepad');

    let x = pad.moveX;
    let y = pad.moveY;
    for (const code of this.keys) {
      const axis = MOVE_KEYS[code];
      if (axis) {
        x += axis[0];
        y += axis[1];
      }
    }
    x += this.touchMove.x;
    y += this.touchMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const s = this.state;
    s.moveX = x;
    s.moveY = y;

    // Correr: Shift/LT/B/botão do toque; L3 liga até parar de andar.
    const moving = Math.hypot(x, y) > 0.2;
    this.stillTime = moving ? 0 : this.stillTime + dt;
    if (pad.sprintTogglePressed) this.sprintLatched = !this.sprintLatched;
    const runRaw = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || pad.run;
    if (this.runMode === 'toggle' && runRaw && !this.runRawBefore) this.runLatched = !this.runLatched;
    this.runRawBefore = runRaw;
    if (!this.sprintLatched && !this.runLatched) this.movedWhileLatched = false;
    else if (moving) this.movedWhileLatched = true;
    // Andou e parou (um instante): a corrida ligada desliga, como nos jogos que têm "correr alternado".
    if (this.movedWhileLatched && this.stillTime > 0.35) this.sprintLatched = this.runLatched = false;
    s.run = this.touchRun || this.sprintLatched || (this.runMode === 'toggle' ? this.runLatched : runRaw);

    const grabRaw = this.mouseGrab || this.keys.has('KeyE') || pad.grab;
    if (this.grabMode === 'toggle' && grabRaw && !this.grabRawBefore) this.grabLatched = !this.grabLatched;
    this.grabRawBefore = grabRaw;
    s.grab = this.touchGrab || (this.grabMode === 'toggle' ? this.grabLatched : grabRaw);
    s.merge = this.keys.has('KeyF') || this.touchMerge || pad.mergeHeld;
    s.pull = this.keys.has('KeyC') || this.touchPull || pad.pullHeld;
    this.lookX += pad.lookX;
    this.lookY += pad.lookY;
    this.zoomDelta += pad.zoom;
    if (pad.jumpPressed) this.jumpQueued = true;
    if (pad.recallPressed) this.resetQueued = true;
    if (pad.abilityPressed) this.abilityQueued = true;
    if (pad.emotePressed) this.emoteQueued = true;
    this.pausePressed = pad.startPressed || this.pauseQueued;
    this.burrowPressed = pad.burrowPressed || this.burrowQueued;
    this.recenterPressed = pad.recenterPressed || this.recenterQueued;
    this.pauseQueued = this.burrowQueued = this.recenterQueued = false;
    // "Pegajoso" até um passo de física consumir: em telas de 144 Hz há frames sem passo fixo.
    s.jumpPressed = s.jumpPressed || this.jumpQueued;
    s.resetPressed = s.resetPressed || this.resetQueued;
    s.abilityPressed = s.abilityPressed || this.abilityQueued;
    s.emotePressed = s.emotePressed || this.emoteQueued;
    this.jumpQueued = false;
    this.resetQueued = false;
    this.abilityQueued = false;
    this.emoteQueued = false;
  }

  consumeLook(): { x: number; y: number; zoom: number } {
    const out = { x: this.lookX, y: this.lookY, zoom: this.zoomDelta };
    this.lookX = 0;
    this.lookY = 0;
    this.zoomDelta = 0;
    return out;
  }

  // --- API de toque (usada pelos controles virtuais do HUD) ---
  setTouchMove(x: number, y: number): void {
    this.setDevice('touch');
    this.touchMove.x = x;
    this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number): void {
    this.setDevice('touch');
    this.lookX += dx * this.pointerLookScale;
    this.lookY += dy * this.pointerLookScale;
  }
  setTouchGrab(active: boolean): void {
    this.touchGrab = active;
  }
  setTouchRun(active: boolean): void {
    this.touchRun = active;
  }
  queueJump(): void {
    this.jumpQueued = true;
  }
  queueReset(): void {
    this.resetQueued = true;
  }
  queueAbility(): void {
    this.abilityQueued = true;
  }
  setTouchMerge(active: boolean): void {
    this.touchMerge = active;
  }
  setTouchPull(active: boolean): void {
    this.touchPull = active;
  }
  queueEmote(): void {
    this.emoteQueued = true;
  }

  private setDevice(device: InputDevice): void {
    const style = this.gamepad.style;
    if (device === this._device && style === this.lastStyle) return;
    this._device = device;
    this.lastStyle = style;
    document.documentElement.dataset.input = device;
    for (const listener of this.deviceListeners) listener(device, style);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Digitando num campo (e-mail, senha, apelido): WASD e espaço são letras, não o besouro.
    if (isTextField(e.target)) return;
    if (!NEUTRAL_KEY.test(e.key)) this.setDevice('keyboard');
    if (e.repeat) return;
    if (e.code === 'Space') {
      this.jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') this.resetQueued = true;
    if (e.code === 'KeyQ') this.abilityQueued = true;
    if (e.code === 'KeyG') this.emoteQueued = true;
    if (e.code === 'KeyT') this.burrowQueued = true;
    if (e.code === 'KeyP') this.pauseQueued = true;
    if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    // Evita tecla "presa" quando a janela perde o foco com algo apertado.
    this.keys.clear();
    this.mouseGrab = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.setDevice('keyboard');
    else if (e.pointerType === 'touch' && isTouchDevice) this.setDevice('touch');
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.setDevice('keyboard');
    if (e.button === 0) this.mouseGrab = true;
    // Botão do meio: câmera volta pra trás do besouro.
    if (e.button === 1) {
      this.recenterQueued = true;
      e.preventDefault();
    }
    // Botão direito: poder de apertar (o menu de contexto já é bloqueado no canvas).
    if (e.button === 2) this.abilityQueued = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseGrab = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.noteMouseTravel(Math.abs(e.movementX) + Math.abs(e.movementY));
    if (!this.pointerLocked) return;
    this.lookX += e.movementX * this.pointerLookScale;
    this.lookY += e.movementY * this.pointerLookScale;
  };

  /** Soma o quanto o mouse andou em pouco tempo; passou do limite, o mouse é o dispositivo em uso. */
  private noteMouseTravel(distance: number): void {
    // No celular o navegador inventa `mousemove` de compatibilidade a cada toque (com salto
    // do último toque até o novo): lá o mouse só conta pelo clique de verdade (pointerType).
    if (distance <= 0 || this._device === 'keyboard' || isTouchDevice) return;
    const now = performance.now();
    if (now - this.mouseTravelAt > MOUSE_INTENT_WINDOW_MS) this.mouseTravel = 0;
    this.mouseTravelAt = now;
    this.mouseTravel += distance;
    if (this.mouseTravel >= MOUSE_INTENT_PX) {
      this.mouseTravel = 0;
      this.setDevice('keyboard');
    }
  }

  private onWheel = (e: WheelEvent): void => {
    this.zoomDelta += Math.sign(e.deltaY);
  };
}
