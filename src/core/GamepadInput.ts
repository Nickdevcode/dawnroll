/**
 * Controle (Gamepad API, mapeamento "standard" — Xbox, PlayStation, Switch Pro e a
 * maioria dos genéricos). O navegador não avisa quando um botão muda: o estado é lido
 * a cada quadro (`poll`) e as "apertadas" saem da comparação com o quadro anterior.
 *
 * Mapeamento (Xbox · PlayStation), no padrão dos jogos de aventura em 3ª pessoa
 * (gatilhos pras ações de segurar, botões de face pras de apertar):
 *   analógico esquerdo  andar (L3: corrida liga/desliga)
 *   analógico direito   câmera (R3: câmera volta pra trás do besouro)
 *   A · ✕               pular
 *   RT · R2             segurar a bola
 *   LT · L2  (ou B · ○) correr, segurando
 *   X · □   (ou ↑)      poder de apertar (Equilibrista)
 *   Y · △               trazer a bola
 *   LB / RB · L1 / R1   zoom
 *   View · Create/Share abrir/fechar a toca
 *   Start · Options     pausar
 *   direcional ↓ ← →    online: reações, fundir (segurar), entrar no convite
 * No menu: direcional ou analógico navegam, A escolhe, B volta, LB/RB trocam de aba e o
 * analógico direito rola a placa aberta.
 */

/** Família do controle: decide o nome/forma de cada botão nas dicas. */
export type PadStyle = 'xbox' | 'ps4' | 'ps5' | 'nintendo';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start' | 'prevTab' | 'nextTab';

/** Botões com nome nas dicas (os do direcional e dos analógicos também). */
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'view' | 'start' | 'l3' | 'r3' | 'ls' | 'rs' | 'up' | 'down' | 'left' | 'right';

/**
 * Rótulo de cada botão no estilo do controle. No Switch o botão de baixo se chama B
 * (a posição manda: o de baixo pula em qualquer controle).
 */
export const PAD_LABELS: Record<PadStyle, Record<PadButton, string>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: 'View', start: 'Menu', l3: 'L3', r3: 'R3', ls: 'L', rs: 'R', up: '↑', down: '↓', left: '←', right: '→' },
  ps4: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: 'Share', start: 'Options', l3: 'L3', r3: 'R3', ls: 'L', rs: 'R', up: '↑', down: '↓', left: '←', right: '→' },
  ps5: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: 'Create', start: 'Options', l3: 'L3', r3: 'R3', ls: 'L', rs: 'R', up: '↑', down: '↓', left: '←', right: '→' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', view: '−', start: '+', l3: 'L3', r3: 'R3', ls: 'L', rs: 'R', up: '↑', down: '↓', left: '←', right: '→' },
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
  View = 8,
  Start = 9,
  L3 = 10,
  R3 = 11,
  Up = 12,
  Down = 13,
  Left = 14,
  Right = 15,
}

/** Zona morta interna dos analógicos (controle gasto "anda sozinho" abaixo disso). */
const DEADZONE = 0.16;
/** Zona morta externa: analógico gasto nem sempre chega em 1; daqui pra fora já é o máximo. */
const OUTER_DEADZONE = 0.94;
/** Gatilho conta como apertado a partir daqui. */
const TRIGGER = 0.35;
/**
 * Analógico conta como "mexeu de propósito" (troca as dicas pro controle) quando passa
 * daqui. Bem acima da zona morta: controle largado na mesa, com o analógico torto ou
 * um eixo parado em -1 (mapeamento não padrão), não rouba as dicas de quem está no teclado.
 */
const INTENT = 0.5;
/** Velocidade da câmera no analógico, em "pixels de mouse" por segundo (a câmera converte). */
const LOOK_SPEED_X = 950;
const LOOK_SPEED_Y = 560;
/** Navegação no menu segurando a direção: primeira repetição e as seguintes. */
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.11;
/** Analógico conta como direção de menu a partir daqui (no eixo dominante). */
const MENU_STICK = 0.6;
/** Rolagem da placa pelo analógico direito, em pixels por segundo na ponta. */
const MENU_SCROLL_SPEED = 900;

/**
 * Zona morta radial + resposta. Andar é linear (meia inclinação = meia velocidade, como
 * nos jogos de plataforma); a câmera usa curva quadrática (precisão perto do centro,
 * velocidade na ponta).
 */
function stick(x: number, y: number, exponent: 1 | 2): [number, number] {
  const len = Math.hypot(x, y);
  if (len < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (len - DEADZONE) / (OUTER_DEADZONE - DEADZONE));
  const k = (exponent === 2 ? scaled * scaled : scaled) / len;
  return [x * k, y * k];
}

/** Estilo pelo nome que o navegador dá ao controle (vendor/product quando tem). */
export function padStyleFromId(id: string): PadStyle {
  // Xbox primeiro: "Xbox Wireless Controller" também contém "Wireless Controller", que é
  // o nome que o controle de PS4 dá em vários navegadores. 045e = Microsoft, 054c = Sony, 057e = Nintendo.
  if (/xbox|045e|xinput/i.test(id)) return 'xbox';
  // DualSense (PS5) e DualSense Edge: 0ce6 / 0df2.
  if (/dualsense|0ce6|0df2/i.test(id)) return 'ps5';
  if (/054c|playstation|dualshock|wireless controller/i.test(id)) return 'ps4';
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
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
  /** L3 apertado agora: liga/desliga a corrida (desliga sozinha quando o besouro para). */
  sprintTogglePressed = false;
  jumpPressed = false;
  recallPressed = false;
  startPressed = false;
  /** View/Create/Share: abre (ou fecha) a toca. */
  burrowPressed = false;
  /** R3: a câmera volta pra trás do besouro. */
  recenterPressed = false;
  /** Poder de apertar (X / □, ou direcional pra cima). */
  abilityPressed = false;
  /** Online: direcional ← segurado (fundir a bola) e ↓ apertado (roda de reações). */
  mergeHeld = false;
  emotePressed = false;
  /** Algo foi mexido no controle neste quadro (qualquer entrada, até leve). */
  active = false;
  /**
   * Alguém usou o controle DE PROPÓSITO neste quadro: botão que acabou de ser apertado ou
   * analógico que acabou de passar da metade. É isso que troca as dicas pro controle.
   */
  intent = false;
  /** Ações de menu deste quadro (bordas, com repetição ao segurar a direção). */
  readonly menuActions: MenuAction[] = [];
  /**
   * Só o direcional (sem o analógico), apertado agora: as cartas de poder do
   * online usam ←/→ e ↓ sem brigar com o andar (o analógico) nem com o pulo (A).
   */
  readonly dpadPressed = { left: false, right: false, down: false };
  /** Rolagem pedida pelo analógico direito neste quadro (pixels; positivo = pra baixo). */
  menuScroll = 0;
  /** Multiplicador da câmera no analógico (configurações). */
  lookScale = 1;

  onConnectionChange: ((connected: boolean, style: PadStyle) => void) | null = null;

  private index = -1;
  private previous: boolean[] = [];
  /** Cada eixo estava além de `INTENT` no quadro anterior (pra achar a borda). */
  private previousAxes: boolean[] = [];
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
    this.dpadPressed.left = this.dpadPressed.right = this.dpadPressed.down = false;
    this.jumpPressed = this.recallPressed = this.startPressed = this.abilityPressed = this.emotePressed = false;
    this.burrowPressed = this.recenterPressed = this.sprintTogglePressed = false;
    this.moveX = this.moveY = this.lookX = this.lookY = this.zoom = this.menuScroll = 0;
    this.grab = this.run = this.active = this.intent = this.mergeHeld = false;

    const pad = this.pad();
    if (!pad) return;
    const pressed = pad.buttons.map((b, i) => b.pressed || b.value > (i === Button.LT || i === Button.RT ? TRIGGER : 0.5));
    const down = (b: Button) => pressed[b] ?? false;
    const edge = (b: Button) => down(b) && !(this.previous[b] ?? false);

    const [mx, my] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 1);
    const [lx, ly] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 2);
    this.moveX = mx;
    this.moveY = -my;
    this.lookX = lx * LOOK_SPEED_X * this.lookScale * dt;
    this.lookY = ly * LOOK_SPEED_Y * this.lookScale * dt;
    this.zoom = ((down(Button.RB) ? 1 : 0) - (down(Button.LB) ? 1 : 0)) * 5 * dt;
    this.grab = down(Button.RT);
    this.run = down(Button.LT) || down(Button.B);
    this.sprintTogglePressed = edge(Button.L3);
    this.jumpPressed = edge(Button.A);
    this.recallPressed = edge(Button.Y);
    this.abilityPressed = edge(Button.X) || edge(Button.Up);
    this.startPressed = edge(Button.Start);
    this.burrowPressed = edge(Button.View);
    this.recenterPressed = edge(Button.R3);
    this.active = mx !== 0 || my !== 0 || lx !== 0 || ly !== 0 || pressed.some(Boolean);
    this.intent = pressed.some((p, i) => p && !(this.previous[i] ?? false)) || this.axisIntent(pad.axes);

    this.dpadPressed.left = edge(Button.Left);
    this.dpadPressed.right = edge(Button.Right);
    this.dpadPressed.down = edge(Button.Down);
    this.mergeHeld = down(Button.Left);
    this.emotePressed = this.dpadPressed.down;

    // Menu: A escolhe, B volta, LB/RB trocam de aba; direções com repetição ao segurar.
    if (edge(Button.A)) this.menuActions.push('confirm');
    if (edge(Button.B)) this.menuActions.push('back');
    if (edge(Button.LB)) this.menuActions.push('prevTab');
    if (edge(Button.RB)) this.menuActions.push('nextTab');
    if (this.startPressed) this.menuActions.push('start');
    this.menuScroll = ly * MENU_SCROLL_SPEED * dt;
    const dir = this.menuDirection(down, pad.axes[0] ?? 0, pad.axes[1] ?? 0);
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

  /** Algum eixo acabou de passar da metade (e não estava lá no quadro anterior). */
  private axisIntent(axes: readonly number[]): boolean {
    let crossed = false;
    for (let i = 0; i < axes.length; i++) {
      const beyond = Math.abs(axes[i] ?? 0) >= INTENT;
      if (beyond && !(this.previousAxes[i] ?? true)) crossed = true;
      this.previousAxes[i] = beyond;
    }
    return crossed;
  }

  /**
   * Um menu acabou de abrir (pausa, cartas de poder): a direção que já estava apertada
   * — normalmente o analógico de andar — não vale até ser solta. Sem isso ela seguia
   * repetindo e arrastava a seleção sozinha.
   */
  suppressHeldDirection(): void {
    this.repeatTimer = Infinity;
  }

  /**
   * Direção de menu: o direcional manda; no analógico vale o eixo dominante (na diagonal
   * "direita e um pouco pra cima" é direita — antes o cima ganhava e a seleção ia pro outro lado).
   */
  private menuDirection(down: (b: Button) => boolean, x: number, y: number): MenuAction | null {
    if (down(Button.Up)) return 'up';
    if (down(Button.Down)) return 'down';
    if (down(Button.Left)) return 'left';
    if (down(Button.Right)) return 'right';
    if (Math.max(Math.abs(x), Math.abs(y)) < MENU_STICK) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
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
    const style = padStyleFromId(pad.id);
    const changed = !this.connected || style !== this.style;
    this.connected = true;
    this.style = style;
    // Tudo o que já estava apertado/inclinado quando o controle chegou não conta como borda.
    this.previous = pad.buttons.map((b) => b.pressed);
    this.previousAxes = pad.axes.map((v) => Math.abs(v) >= INTENT);
    if (changed) this.onConnectionChange?.(true, style);
  }
}
