import type { MessageKey } from '../i18n';
import type { PromptAction } from '../ui/prompts';

/**
 * Os passos do tutorial da primeira vez, na ordem em que o jogo ensina: câmera,
 * andar, correr, pular, agarrar, crescer, enterrar e comer. Cada um se cumpre FAZENDO
 * a coisa no jardim de verdade (nada de parede de texto) e cita a tecla/botão do
 * dispositivo em uso.
 */

export type TutorialStepId = 'look' | 'move' | 'run' | 'jump' | 'grab' | 'grow' | 'bury' | 'eat';

export const TUTORIAL_STEPS: readonly TutorialStepId[] = ['look', 'move', 'run', 'jump', 'grab', 'grow', 'bury', 'eat'];

export interface StepCopy {
  title: MessageKey;
  /** Texto com `{key}` (a tecla/botão de `action`) pro teclado e pro controle. */
  body: MessageKey;
  /** Variante do controle, quando a frase muda ("incline o analógico"). */
  bodyPad?: MessageKey;
  /** Variante do toque (sem tecla: "toque na mão"). */
  bodyTouch: MessageKey;
  /** Variante com "apertar pra ligar" (configuração de agarrar/correr alternados). */
  bodyToggle?: MessageKey;
  action: PromptAction;
}

export const STEP_COPY: Record<TutorialStepId, StepCopy> = {
  look: { title: 'tutorial.look.title', body: 'tutorial.look.body', bodyPad: 'tutorial.look.bodyPad', bodyTouch: 'tutorial.look.bodyTouch', action: 'look' },
  move: { title: 'tutorial.move.title', body: 'tutorial.move.body', bodyPad: 'tutorial.move.bodyPad', bodyTouch: 'tutorial.move.bodyTouch', action: 'move' },
  run: { title: 'tutorial.run.title', body: 'tutorial.run.body', bodyTouch: 'tutorial.run.bodyTouch', bodyToggle: 'tutorial.run.bodyToggle', action: 'run' },
  jump: { title: 'tutorial.jump.title', body: 'tutorial.jump.body', bodyTouch: 'tutorial.jump.bodyTouch', action: 'jump' },
  grab: { title: 'tutorial.grab.title', body: 'tutorial.grab.body', bodyPad: 'tutorial.grab.bodyPad', bodyTouch: 'tutorial.grab.bodyTouch', bodyToggle: 'tutorial.grab.bodyToggle', action: 'grab' },
  grow: { title: 'tutorial.grow.title', body: 'tutorial.grow.body', bodyTouch: 'tutorial.grow.body', action: 'grab' },
  bury: { title: 'tutorial.bury.title', body: 'tutorial.bury.body', bodyTouch: 'tutorial.bury.body', action: 'grab' },
  eat: { title: 'tutorial.eat.title', body: 'tutorial.eat.body', bodyTouch: 'tutorial.eat.bodyTouch', action: 'burrow' },
};

/** Quanto de cada coisa conta como "aprendeu" (unidades do passo). */
export const STEP_GOAL = {
  /** Pixels de câmera (mouse; o analógico e o dedo convertem pra mesma escala): ~meia volta. */
  look: 900,
  /** Unidades do mundo andadas (o besouro tem ~0,5). */
  move: 4,
  /** Segundos correndo de verdade (andando com a corrida ligada). */
  run: 1.2,
} as const;

/** Tempo mínimo de cada passo na tela antes de valer (quem já tinha feito vê o passo e o "feito!"). */
export const MIN_STEP_SECONDS = 1.1;
/** Quanto o "feito!" fica na tela antes do próximo passo. */
export const DONE_SECONDS = 1.1;
/** O cartão final ("Tudo pronto!") some sozinho depois disso. */
export const FINISH_SECONDS = 6;
