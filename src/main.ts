import './ui/styles.css';
import './ui/menu.css';
import { settings } from './core/settings';
import { setLanguagePreference, t } from './i18n';
import { Game } from './Game';
import { BootScreen } from './ui/BootScreen';

// Idioma antes de qualquer tela: salvo pelo jogador ou, no automático, o do navegador.
setLanguagePreference(settings.get().language);

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
const ui = document.getElementById('ui');
const boot = new BootScreen();

function showFatal(message: string): void {
  boot.dismiss();
  if (!ui) return;
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'overlay';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const title = document.createElement('h1');
  title.className = 'title';
  title.textContent = t('fatal.title');
  const text = document.createElement('p');
  text.className = 'tagline';
  text.textContent = message;
  panel.append(title, text);
  box.append(panel);
  ui.append(box);
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!canvas || !ui) {
  throw new Error('Elementos #scene e #ui não encontrados no index.html');
}

if (!hasWebGL2()) {
  showFatal(t('fatal.webgl'));
} else {
  const game = new Game(canvas, ui);
  game.init(boot).catch((error: unknown) => {
    console.error(error);
    showFatal(t('fatal.load'));
  });
}
