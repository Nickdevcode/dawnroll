import './ui/styles.css';
import { Game } from './Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
const ui = document.getElementById('ui');

function showFatal(message: string): void {
  if (!ui) return;
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'overlay';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const title = document.createElement('h1');
  title.className = 'title';
  title.textContent = 'Ops!';
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
  showFatal('Seu navegador não suporta WebGL 2. Tente um Chrome, Edge, Firefox ou Safari atualizado.');
} else {
  const game = new Game(canvas, ui);
  game.init().catch((error: unknown) => {
    console.error(error);
    showFatal('Não deu pra carregar o jogo. Recarregue a página e tente de novo.');
  });
}
