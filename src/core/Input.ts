import { GamepadInput, type MenuAction } from './GamepadInput';
import { isTouchDevice } from './device';

/**
 * Estado de entrada unificado: teclado + mouse (pointer lock) + toque + controle.
 * O resto do jogo só lê `move`, `look`, `grab`, `jump`, `run` — não sabe de onde veio.
 */

/** De onde veio a última entrada (as dicas na tela acompanham). */
export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

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
  };

  /** Delta de câmera acumulado desde o último `consumeLook` (pixels). */
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;

  readonly gamepad = new GamepadInput();
  /** Último dispositivo usado (aparelho de toque começa no toque, não no teclado). */
  device: InputDevice = isTouchDevice ? 'touch' : 'keyboard';
  /** Start/Options apertado neste quadro (pausar). */
  pausePressed = false;

  private readonly keys = new Set<string>();
  private lastUpdate = 0;
  private mouseGrab = false;
  private jumpQueued = false;
  private resetQueued = false;
  private abilityQueued = false;

  // Toque
  private touchMove = { x: 0, y: 0 };
  private touchGrab = false;
  private touchRun = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
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

  /** Chamado uma vez por frame, antes da simulação. */
  update(): void {
    const now = performance.now();
    const dt = this.lastUpdate === 0 ? 1 / 60 : Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;
    const pad = this.gamepad;
    pad.poll(dt);
    if (pad.active) this.device = 'gamepad';

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
    s.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun || pad.run;
    s.grab = this.mouseGrab || this.keys.has('KeyE') || this.touchGrab || pad.grab;
    this.lookX += pad.lookX;
    this.lookY += pad.lookY;
    this.zoomDelta += pad.zoom;
    if (pad.jumpPressed) this.jumpQueued = true;
    if (pad.recallPressed) this.resetQueued = true;
    if (pad.abilityPressed) this.abilityQueued = true;
    this.pausePressed = pad.startPressed;
    // "Pegajoso" até um passo de física consumir: em telas de 144 Hz há frames sem passo fixo.
    s.jumpPressed = s.jumpPressed || this.jumpQueued;
    s.resetPressed = s.resetPressed || this.resetQueued;
    s.abilityPressed = s.abilityPressed || this.abilityQueued;
    this.jumpQueued = false;
    this.resetQueued = false;
    this.abilityQueued = false;
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
    this.device = 'touch';
    this.touchMove.x = x;
    this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number): void {
    this.device = 'touch';
    this.lookX += dx;
    this.lookY += dy;
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

  private onKeyDown = (e: KeyboardEvent): void => {
    // Digitando num campo (e-mail, senha, apelido): WASD e espaço são letras, não o besouro.
    if (isTextField(e.target)) return;
    this.device = 'keyboard';
    if (e.repeat) return;
    if (e.code === 'Space') {
      this.jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') this.resetQueued = true;
    if (e.code === 'KeyQ') this.abilityQueued = true;
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

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    if (e.button === 0) this.mouseGrab = true;
    // Botão direito: poder de apertar (o menu de contexto já é bloqueado no canvas).
    if (e.button === 2) this.abilityQueued = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseGrab = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.device = 'keyboard';
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  private onWheel = (e: WheelEvent): void => {
    this.zoomDelta += Math.sign(e.deltaY);
  };
}
