import { DONE_SECONDS, FINISH_SECONDS, MIN_STEP_SECONDS, STEP_GOAL, TUTORIAL_STEPS, type TutorialStepId } from './steps';
import { writeTutorial } from './storage';

/**
 * Tutorial da primeira vez: um passo por vez, cumprido jogando. O jogo conta o que
 * acontece (`note*`) e manda um retrato do mundo a cada quadro (`update`); daqui sai
 * o que o cartão mostra (`view`). Nada aqui toca em DOM, física ou câmera.
 */

/** O que o tutorial precisa saber do jogo a cada quadro. */
export interface TutorialWorld {
  /** Pausado, escolhendo poder, enterrando, numa sala online: os relógios do tutorial esperam. */
  suspended: boolean;
  /** Andando com a corrida ligada. */
  running: boolean;
  /** Empurrando a bola. */
  pushing: boolean;
  /** Diâmetro atual da bola e o mínimo pra enterrar (cm). */
  ballCm: number;
  buryCm: number;
  /** A bola ficou longe do besouro (dica de "trazer a bola"). */
  ballFar: boolean;
}

export type TutorialView =
  | {
      kind: 'step';
      step: TutorialStepId;
      /** 0-based. */
      index: number;
      total: number;
      /** 0..1 pros passos que enchem uma barrinha; null nos de "fez uma vez". */
      progress: number | null;
      /** Passo cumprido: o "feito!" está na tela antes do próximo. */
      done: boolean;
      /** Dica extra embaixo do passo (a bola ficou longe: "trazer a bola"). */
      tip: 'recall' | null;
      /** Crescer: onde a bola está e onde precisa chegar (cm). */
      cm?: { now: number; goal: number };
    }
  | { kind: 'finish' };

/** A bola longe por esse tempo (s) mostra a dica de trazer ela. */
const FAR_TIP_SECONDS = 2.5;

export class Tutorial {
  /** Passo cumprido: som e vibração de "feito!". */
  onStepDone: ((step: TutorialStepId) => void) | null = null;
  /** O tutorial acabou (terminou ou pulou). */
  onEnd: ((completed: boolean) => void) | null = null;

  private index = -1;
  private stepTime = 0;
  /** > 0: mostrando o "feito!" do passo atual. */
  private doneTimer = 0;
  /** > 0: cartão final na tela. */
  private finishTimer = 0;
  private farTime = 0;

  // O que já aconteceu desde o começo (quem faz antes da hora não precisa refazer).
  private looked = 0;
  private walked = 0;
  private ranFor = 0;
  private jumped = false;
  private grabbed = false;
  private buried = false;
  private burrowOpened = false;
  private lastWorld: TutorialWorld | null = null;

  /** Algum passo na tela (ou o cartão final). */
  get active(): boolean {
    return this.index >= 0 || this.finishTimer > 0;
  }

  /** Passo atual (null sem tutorial ou no cartão final). */
  get step(): TutorialStepId | null {
    return this.index >= 0 ? TUTORIAL_STEPS[this.index] : null;
  }

  /** Começa (ou recomeça) no passo pedido. */
  begin(from: TutorialStepId = TUTORIAL_STEPS[0]): void {
    this.index = Math.max(0, TUTORIAL_STEPS.indexOf(from));
    this.stepTime = 0;
    this.doneTimer = 0;
    this.finishTimer = 0;
    this.farTime = 0;
    this.looked = this.walked = this.ranFor = 0;
    this.jumped = this.grabbed = this.buried = this.burrowOpened = false;
    writeTutorial({ status: 'active', step: TUTORIAL_STEPS[this.index] });
  }

  /** Pular (pausa → "Pular tutorial", ou o botão do cartão no toque). */
  skip(): void {
    if (!this.active) return;
    this.index = -1;
    this.finishTimer = 0;
    writeTutorial({ status: 'done' });
    this.onEnd?.(false);
  }

  // --- o que o jogo conta ---------------------------------------------------------------

  /** Câmera girada pelo jogador (pixels de mouse ou equivalente). */
  noteLook(amount: number): void {
    if (this.index >= 0) this.looked += amount;
  }
  /** Distância andada neste passo de física (unidades do mundo). */
  noteMove(distance: number): void {
    if (this.index >= 0) this.walked += distance;
  }
  noteJump(): void {
    if (this.index >= 0) this.jumped = true;
  }
  noteBuried(): void {
    if (this.index >= 0) this.buried = true;
  }
  /** A toca abriu pela tecla/botão/ícone: só vale no passo de comer (abrir antes é explorar). */
  noteBurrowOpened(): void {
    if (this.step === 'eat') this.burrowOpened = true;
  }

  /** Ainda não passou do passo de agarrar: a dica "segure pra agarrar" do HUD fica quieta (o cartão ensina na hora dele). */
  get teachingGrab(): boolean {
    return this.index >= 0 && this.index <= TUTORIAL_STEPS.indexOf('grab');
  }

  /**
   * Com o tutorial na tela a toca não se apresenta sozinha depois do enterro: quem abre
   * é o jogador, no passo de comer (e aprende a tecla/botão). Vale pra qualquer passo:
   * dá pra enterrar ainda no "crescer" (a bola de 3 cm já cabe na toca).
   */
  get wantsBurrow(): boolean {
    return this.index >= 0;
  }

  update(dt: number, world: TutorialWorld): void {
    this.lastWorld = world;
    if (world.suspended) return;
    if (this.finishTimer > 0) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this.onEnd?.(true);
      return;
    }
    const step = this.step;
    if (!step) return;
    if (world.running) this.ranFor += dt;
    if (world.pushing) this.grabbed = true;
    this.farTime = world.ballFar ? this.farTime + dt : 0;

    if (this.doneTimer > 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) this.advance();
      return;
    }
    this.stepTime += dt;
    if (this.stepTime >= MIN_STEP_SECONDS && this.complete(step, world)) {
      this.doneTimer = DONE_SECONDS;
      this.onStepDone?.(step);
    }
  }

  view(): TutorialView | null {
    if (this.finishTimer > 0) return { kind: 'finish' };
    const step = this.step;
    if (!step) return null;
    const world = this.lastWorld;
    const tipStep = step === 'grab' || step === 'grow' || step === 'bury';
    return {
      kind: 'step',
      step,
      index: this.index,
      total: TUTORIAL_STEPS.length,
      progress: this.doneTimer > 0 ? 1 : this.progress(step, world),
      done: this.doneTimer > 0,
      tip: tipStep && this.farTime > FAR_TIP_SECONDS && this.doneTimer <= 0 ? 'recall' : null,
      cm: step === 'grow' && world ? { now: world.ballCm, goal: world.buryCm } : undefined,
    };
  }

  private progress(step: TutorialStepId, world: TutorialWorld | null): number | null {
    switch (step) {
      case 'look':
        return Math.min(1, this.looked / STEP_GOAL.look);
      case 'move':
        return Math.min(1, this.walked / STEP_GOAL.move);
      case 'run':
        return Math.min(1, this.ranFor / STEP_GOAL.run);
      case 'grow':
        return world ? growProgress(world) : 0;
      default:
        return null;
    }
  }

  private complete(step: TutorialStepId, world: TutorialWorld): boolean {
    switch (step) {
      case 'look':
        return this.looked >= STEP_GOAL.look;
      case 'move':
        return this.walked >= STEP_GOAL.move;
      case 'run':
        return this.ranFor >= STEP_GOAL.run;
      case 'jump':
        return this.jumped;
      case 'grab':
        return this.grabbed;
      case 'grow':
        return growProgress(world) >= 1;
      case 'bury':
        return this.buried;
      case 'eat':
        return this.burrowOpened;
    }
  }

  private advance(): void {
    this.index++;
    this.stepTime = 0;
    this.farTime = 0;
    if (this.index < TUTORIAL_STEPS.length) {
      writeTutorial({ status: 'active', step: TUTORIAL_STEPS[this.index] });
      return;
    }
    // Acabou: o cartão final fica um pouco (conta só com o jogo rodando, a toca costuma estar aberta agora).
    this.index = -1;
    this.finishTimer = FINISH_SECONDS;
    writeTutorial({ status: 'done' });
  }
}

/** Crescer: de 2 cm (a bola nova) até o mínimo pra enterrar. */
function growProgress(world: TutorialWorld): number {
  const start = 2;
  return Math.min(1, Math.max(0, (world.ballCm - start) / Math.max(0.1, world.buryCm - start)));
}
