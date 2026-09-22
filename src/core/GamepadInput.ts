/**
 * Controle (Gamepad API, mapeamento "standard" — Xbox, PlayStation e a maioria
 * dos genéricos). O navegador não avisa quando um botão muda: o estado é lido
 * a cada quadro (`poll`) e as "apertadas" saem da comparação com o quadro anterior.
 *
 * Mapeamento (Xbox / PlayStation):
 *   analógico esquerdo  andar            analógico direito   câmera
 *   A / ✕               pular            RT / R2 (ou X / □)  segurar a bola
 *   LT / L2 (ou B / ○)  correr           Y / △               trazer a bola
 *   LB / RB             zoom             Start / Options     pausar
 * No menu: direcional ou analógico navegam, A escolhe, B volta.
 */

export type PadStyle = 'xbox' | 'playstation';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start';

/** Rótulo de cada botão no estilo do controle (para dicas e ajuda). */
export const PAD_LABELS: Record<PadStyle, Record<'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'start', string>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'Start' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Options' },
};

const enum Button {
  A = 0,
  B = 1,
  X = 2,
  Y = 3,
  LB = 4,
  RB = 5,
  LT = 6,
  RT = 7,
  Back = 8,
  Start = 9,
  L3 = 10,
  Up = 12,
  Down = 13,
  Left = 14,
  Right = 15,
}

/** Zona morta dos analógicos (controle gasto "anda sozinho" abaixo disso). */
const DEADZONE = 0.16;
/** Gatilho conta como apertado a partir daqui. */
const TRIGGER = 0.35;
/** Velocidade da câmera no analógico, em "pixels de mouse" por segundo (a câmera converte). */
const LOOK_SPEED_X = 950;
const LOOK_SPEED_Y = 560;
/** Navegação no menu segurando a direção: primeira repetição e as seguintes. */
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.11;

/** Zona morta radial + curva quadrática (precisão perto do centro, velocidade na ponta). */
function stick(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
  const k = (scaled * scaled) / len;
  return [x * k, y * k];
}

export class GamepadInput {
  connected = false;
  style: PadStyle = 'xbox';

  // Estado deste quadro (jogo)
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  zoom = 0;
  grab = false;
  run = false;
  jumpPressed = false;
  recallPressed = false;
  startPressed = false;
  /** Algo foi mexido no controle neste quadro (o jogo passa a mostrar dicas de controle). */
  active = false;
  /** Ações de menu deste quadro (bordas, com repetição ao segurar a direção). */
  readonly menuActions: MenuAction[] = [];

  onConnectionChange: ((connected: boolean, style: PadStyle) => void) | null = null;

  private index = -1;
  private previous: boolean[] = [];
  private repeatDir: MenuAction | null = null;
  private repeatTimer = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', () => this.refreshConnection());
    window.addEventListener('gamepaddisconnected', () => this.refreshConnection());
  }

  /** Lê o controle. `dt` em segundos. */
  poll(dt: number): void {
    this.menuActions.length = 0;
    this.jumpPressed = this.recallPressed = this.startPressed = false;
    this.moveX = this.moveY = this.lookX = this.lookY = this.zoom = 0;
    this.grab = this.run = this.active = false;

    const pad = this.pad();
    if (!pad) return;
    const pressed = pad.buttons.map((b, i) => b.pressed || b.value > (i === Button.LT || i === Button.RT ? TRIGGER : 0.5));
    const down = (b: Button) => pressed[b] ?? false;
    const edge = (b: Button) => down(b) && !(this.previous[b] ?? false);

    const [mx, my] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [lx, ly] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    this.moveX = mx;
    this.moveY = -my;
    this.lookX = lx * LOOK_SPEED_X * dt;
    this.lookY = ly * LOOK_SPEED_Y * dt;
    this.zoom = ((down(Button.RB) ? 1 : 0) - (down(Button.LB) ? 1 : 0)) * 5 * dt;
    this.grab = down(Button.RT) || down(Button.X);
    this.run = down(Button.LT) || down(Button.B) || down(Button.L3);
    this.jumpPressed = edge(Button.A);
    this.recallPressed = edge(Button.Y);
    this.startPressed = edge(Button.Start) || edge(Button.Back);
    this.active = mx !== 0 || my !== 0 || lx !== 0 || ly !== 0 || pressed.some(Boolean);

    // Menu: A escolhe, B volta; direções com repetição ao segurar (direcional ou analógico).
    if (edge(Button.A)) this.menuActions.push('confirm');
    if (edge(Button.B)) this.menuActions.push('back');
    if (this.startPressed) this.menuActions.push('start');
    const rawX = pad.axes[0] ?? 0;
    const rawY = pad.axes[1] ?? 0;
    const dir: MenuAction | null =
      down(Button.Up) || rawY < -0.6 ? 'up' : down(Button.Down) || rawY > 0.6 ? 'down' : down(Button.Left) || rawX < -0.6 ? 'left' : down(Button.Right) || rawX > 0.6 ? 'right' : null;
    if (dir !== this.repeatDir) {
      this.repeatDir = dir;
      this.repeatTimer = REPEAT_DELAY;
      if (dir) this.menuActions.push(dir);
    } else if (dir) {
      this.repeatTimer -= dt;
      if (this.repeatTimer <= 0) {
        this.repeatTimer = REPEAT_RATE;
        this.menuActions.push(dir);
      }
    }
    this.previous = pressed;
  }

  /** Vibração (0..1 em cada motor). Silenciosa onde o navegador/controle não suporta. */
  rumble(strong: number, weak: number, durationMs: number): void {
    const pad = this.pad();
    const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    actuator?.playEffect?.('dual-rumble', { duration: durationMs, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch(() => undefined);
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let pad = this.index >= 0 ? pads[this.index] : null;
    if (!pad?.connected) {
      pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected) ?? null;
      if (pad) this.adopt(pad);
    }
    return pad?.connected ? pad : null;
  }

  private refreshConnection(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const pad = pads.find((p): p is Gamepad => !!p && p.connected) ?? null;
    if (pad) this.adopt(pad);
    else if (this.connected) {
      this.connected = false;
      this.index = -1;
      this.onConnectionChange?.(false, this.style);
    }
  }

  private adopt(pad: Gamepad): void {
    this.index = pad.index;
    // Xbox primeiro: "Xbox Wireless Controller" também contém "Wireless Controller", que é
    // o nome que o controle de PS4 dá em vários navegadores. 045e = Microsoft, 054c = Sony.
    const id = pad.id;
    const style: PadStyle = /xbox|045e/i.test(id) ? 'xbox' : /054c|playstation|dualshock|dualsense|wireless controller/i.test(id) ? 'playstation' : 'xbox';
    const changed = !this.connected || style !== this.style;
    this.connected = true;
    this.style = style;
    this.previous = [];
    if (changed) this.onConnectionChange?.(true, style);
  }
}
