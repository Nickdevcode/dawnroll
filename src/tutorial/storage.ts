import type { SaveData } from '../core/save';
import { TUTORIAL_STEPS, type TutorialStepId } from './steps';

/**
 * Onde o tutorial parou, guardado NO APARELHO (não na conta): dá pra jogar sem conta,
 * e quem é novo aqui é quem nunca jogou neste navegador. Quem já tem progresso no save
 * deste aparelho (jogava antes do tutorial existir) não é "novo".
 */

const KEY = 'dawnroll:tutorial:v1';

export type TutorialRecord =
  /** Terminou ou pulou: nunca mais aparece sozinho (dá pra refazer em "Como jogar"). */
  | { status: 'done' }
  /** Começou e não terminou: volta do passo em que parou. */
  | { status: 'active'; step: TutorialStepId };

function read(): TutorialRecord | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.status === 'done') return { status: 'done' };
    if (data.status === 'active' && typeof data.step === 'string' && (TUTORIAL_STEPS as readonly string[]).includes(data.step)) {
      return { status: 'active', step: data.step as TutorialStepId };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeTutorial(record: TutorialRecord): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Armazenamento bloqueado (aba anônima de alguns navegadores): vale só pra esta sessão.
  }
}

/** O save já mostra alguém que jogou (enterrou, subiu de nível ou conquistou algo). */
export function hasPlayed(save: Readonly<SaveData>): boolean {
  return save.buried > 0 || save.xp > 0 || save.achievements.length > 0;
}

/**
 * Onde o tutorial começa neste aparelho: do início (primeira vez), do passo salvo
 * (parou no meio) ou `null` (já fez, ou já jogava antes: fica marcado como feito).
 */
export function tutorialStartStep(save: Readonly<SaveData>): TutorialStepId | null {
  const record = read();
  if (record?.status === 'done') return null;
  if (record?.status === 'active') return record.step;
  if (hasPlayed(save)) {
    writeTutorial({ status: 'done' });
    return null;
  }
  return TUTORIAL_STEPS[0];
}
