/**
 * Texto que vai pro innerHTML junto com marcação nossa (ícones SVG, <strong>...)
 * sempre passa por aqui antes. Hoje só entram textos do próprio dicionário, mas
 * a interface não deve depender disso pra ser segura.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
