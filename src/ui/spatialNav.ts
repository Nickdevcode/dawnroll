/**
 * Navegação espacial (controle): a partir do elemento em foco, o vizinho na direção pedida,
 * medido pelos retângulos na tela. Primeiro acha a "fileira" mais próxima naquela direção,
 * depois o mais alinhado dentro dela — numa grade (catálogo) anda por linha e coluna; numa
 * lista (configurações, toca) vai pro de baixo mesmo que ele não esteja alinhado. Funciona
 * com a placa rolada (quem está fora da vista continua com retângulo).
 */

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** Folga (px) pra considerar dois vizinhos na mesma fileira (alturas/larguras diferentes). */
const ROW_TOLERANCE = 16;

export function nearestInDirection(from: HTMLElement, candidates: readonly HTMLElement[], direction: NavDirection): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const vertical = direction === 'up' || direction === 'down';
  const forward = direction === 'down' || direction === 'right';
  const center = (r: DOMRect) => (vertical ? r.left + r.width / 2 : r.top + r.height / 2);
  const along = (r: DOMRect) => (vertical ? r.top + r.height / 2 : r.left + r.width / 2);
  const size = (r: DOMRect) => (vertical ? r.height : r.width);

  const ahead: Array<{ el: HTMLElement; gap: number; crossGap: number; offset: number }> = [];
  for (const el of candidates) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    // De fato do lado pedido: o centro passa da metade do menor dos dois.
    const lead = (along(b) - along(a)) * (forward ? 1 : -1);
    if (lead <= Math.min(size(a), size(b)) / 2) continue;
    const gap = vertical ? (forward ? b.top - a.bottom : a.top - b.bottom) : forward ? b.left - a.right : a.left - b.right;
    // Desalinhamento: 0 quando se sobrepõem no outro eixo; senão, a distância entre as bordas.
    const crossGap = vertical ? Math.max(0, b.left - a.right, a.left - b.right) : Math.max(0, b.top - a.bottom, a.top - b.bottom);
    // Pros lados, só na mesma linha (senão a primeira figurinha da linha "pulava" pra uma aba lá em cima).
    if (!vertical && crossGap > 0) continue;
    ahead.push({ el, gap: Math.max(gap, 0), crossGap, offset: Math.abs(center(b) - center(a)) });
  }
  if (ahead.length === 0) return null;

  const nearest = Math.min(...ahead.map((c) => c.gap));
  let best: (typeof ahead)[number] | null = null;
  for (const c of ahead) {
    if (c.gap > nearest + ROW_TOLERANCE) continue;
    if (!best || c.crossGap < best.crossGap || (c.crossGap === best.crossGap && c.offset < best.offset)) best = c;
  }
  return best?.el ?? null;
}
