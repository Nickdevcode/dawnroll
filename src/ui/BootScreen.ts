import { t, type MessageKey } from '../i18n';

/** Quanto a barra fica cheia na tela antes de sumir (dá tempo de ver o sol chegar). */
const HOLD_FULL_MS = 380;
/** Duração do sumiço: atraso + transição do céu no `index.html` (220 + 700 ms). */
const FADE_MS = 920;

/**
 * Tela de carregamento. O desenho mora no `index.html` (aparece antes do
 * download do jogo); aqui o jogo só avança o progresso por etapa e some com
 * ela no fim, revelando o menu (que também é madrugada: a troca não pula).
 */
export class BootScreen {
  private readonly root: HTMLElement | null;
  private readonly text: HTMLElement | null;

  constructor(root: HTMLElement | null = document.getElementById('boot')) {
    this.root = root;
    this.text = root?.querySelector<HTMLElement>('[data-boot-text]') ?? null;
  }

  /** Avança o sol no horizonte (0..1) e troca a frase da etapa. */
  step(progress: number, message: MessageKey): void {
    if (!this.root) return;
    this.root.style.setProperty('--p', Math.min(1, Math.max(0, progress)).toFixed(3));
    if (this.text) this.text.textContent = t(message);
  }

  /** Terminou: barra cheia por um instante, depois some. */
  finish(): Promise<void> {
    const root = this.root;
    if (!root) return Promise.resolve();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        root.classList.add('is-done');
        window.setTimeout(() => {
          root.remove();
          resolve();
        }, FADE_MS);
      }, HOLD_FULL_MS);
    });
  }

  /** Deu erro: sai da frente na hora (a tela de erro precisa aparecer). */
  dismiss(): void {
    this.root?.remove();
  }
}
