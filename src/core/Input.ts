/**
 * Estado de entrada unificado: teclado + mouse (pointer lock) + toque.
 * O resto do jogo só lê `move`, `look`, `grab`, `jump`, `run` — não sabe de onde veio.
 */

export interface InputState {
  /** Eixo de movimento no plano: x = direita, y = frente. Magnitude ≤ 1. */
  moveX: number;
  moveY: number;
  run: boolean;
  grab: boolean;
  /** true desde que o pulo foi apertado até o próximo passo de física consumir. */
  jumpPressed: boolean;
  resetPressed: boolean;
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

export class Input {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    run: false,
    grab: false,
    jumpPressed: false,
    resetPressed: false,
  };

  /** Delta de câmera acumulado desde o último `consumeLook` (pixels). */
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;

  private readonly keys = new Set<string>();
  private mouseGrab = false;
  private jumpQueued = false;
  private resetQueued = false;

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

  /** Chamado uma vez por frame, antes da simulação. */
  update(): void {
    let x = 0;
    let y = 0;
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
    s.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun;
    s.grab = this.mouseGrab || this.keys.has('KeyE') || this.touchGrab;
    // "Pegajoso" até um passo de física consumir: em telas de 144 Hz há frames sem passo fixo.
    s.jumpPressed = s.jumpPressed || this.jumpQueued;
    s.resetPressed = s.resetPressed || this.resetQueued;
    this.jumpQueued = false;
    this.resetQueued = false;
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
    this.touchMove.x = x;
    this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number): void {
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

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      this.jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') this.resetQueued = true;
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
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseGrab = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  private onWheel = (e: WheelEvent): void => {
    this.zoomDelta += Math.sign(e.deltaY);
  };
}
