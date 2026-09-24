import type { AccessoryId, AccessorySlot } from '../progression/accessories';
import type { Look } from '../progression/looks';
import { DEFAULT_CLUB, skin, type SkinDef } from '../progression/skins';

/**
 * Ícones do guarda-roupa: o besourinho de cada casco (com o desenho do casco e,
 * nos vivos, uma animação em CSS) e a figurinha de cada acessório. Mesmo estilo
 * das figurinhas do catálogo (`gameIcons.ts`): 24×24, contorno fino de tinta,
 * realce claro, cores chapadas.
 */

const INK = 'rgba(58,42,34,0.55)';
const EYE = '#2b2230';
const CREASE = 'rgba(58,42,34,0.32)';

const filled = (paths: string, extraClass = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"${extraClass ? ` class="${extraClass}"` : ''} stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const r2 = (value: number) => Math.round(value * 100) / 100;

/** Claridade (0..1) de uma cor #rrggbb: a média do canal mais forte com o mais fraco. */
const lightness = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...c) + Math.min(...c)) / 510;
};

const line = (d: string, color = CREASE, width = 1.1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

const dots = (points: ReadonlyArray<readonly [number, number]>, r: number, fill: string) =>
  points.map(([x, y]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}" stroke="none"/>`).join('');

const shine = (cx: number, cy: number, rx: number, ry: number, angle = 0, alpha = 0.45) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="rgba(255,255,255,${alpha})" stroke="none"${angle ? ` transform="rotate(${angle} ${cx} ${cy})"` : ''}/>`;

const mirrored = (paths: string, cx = 12) => `${paths}<g transform="matrix(-1 0 0 1 ${cx * 2} 0)">${paths}</g>`;

/** Estrela de `count` pontas como caminho. */
const starPath = (count: number, outer: number, inner: number, cx: number, cy: number, turn = -Math.PI / 2) =>
  Array.from({ length: count * 2 }, (_, i) => {
    const angle = turn + (i / (count * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner;
    return `${i === 0 ? 'M' : 'L'}${r2(cx + Math.cos(angle) * radius)} ${r2(cy + Math.sin(angle) * radius)}`;
  }).join('') + 'z';

/** Coração (ponta pra baixo) centrado em (cx, cy), com `w` de largura. */
const heartPath = (cx: number, cy: number, w: number) => {
  const s = w / 2;
  return `M${r2(cx)} ${r2(cy + s * 0.9)}C${r2(cx - s * 0.4)} ${r2(cy + s * 0.55)} ${r2(cx - s)} ${r2(cy + s * 0.15)} ${r2(cx - s)} ${r2(cy - s * 0.3)}C${r2(cx - s)} ${r2(cy - s * 0.85)} ${r2(cx - s * 0.3)} ${r2(cy - s)} ${r2(cx)} ${r2(cy - s * 0.5)}C${r2(cx + s * 0.3)} ${r2(cy - s)} ${r2(cx + s)} ${r2(cy - s * 0.85)} ${r2(cx + s)} ${r2(cy - s * 0.3)}C${r2(cx + s)} ${r2(cy + s * 0.15)} ${r2(cx + s * 0.4)} ${r2(cy + s * 0.55)} ${r2(cx)} ${r2(cy + s * 0.9)}z`;
};

/** Florzinha de 5 pétalas (colar, coroa, chapéu de palha). */
const flower = (cx: number, cy: number, r: number, petal: string, center: string) =>
  Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${r2(cx + Math.cos(a) * r * 0.62)}" cy="${r2(cy + Math.sin(a) * r * 0.62)}" r="${r2(r * 0.5)}" fill="${petal}"/>`;
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="${r2(r * 0.38)}" fill="${center}"/>`;

// --- cascos ------------------------------------------------------------------------

const ELYTRA = 'M6.3 12.6c0-1.1.9-1.9 2-1.9h7.4c1.1 0 2 .8 2 1.9 0 5.1-2.5 8.8-5.7 8.8s-5.7-3.7-5.7-8.8z';
const PRONOTUM = 'M7.2 10.2c0-2.3 2.2-3.8 4.8-3.8s4.8 1.5 4.8 3.8c0 .8-.6 1.3-1.4 1.3H8.6c-.8 0-1.4-.5-1.4-1.3z';
const SHOVEL = 'M8.2 6.8c-.3-2 1.5-3.8 3.8-3.8s4.1 1.8 3.8 3.8c-.1.6-.5.9-1.1.9H9.3c-.6 0-1-.3-1.1-.9z';

let uid = 0;

/**
 * O desenho do casco por cima da cor dos élitros e do pronoto (recortado no
 * formato de cada um). Os vivos ganham classes com animação (ver `menu.css`).
 */
function skinPattern(def: SkinDef, id: string): { elytra: string; pronotum: string; defs: string; animated: string } {
  const [a = def.elytra, b = a, c = b] = def.accents ?? [];
  const clipE = `url(#${id}-e)`;
  const clipP = `url(#${id}-p)`;
  const onE = (markup: string, cls = '') => `<g clip-path="${clipE}" stroke="none"${cls ? ` class="${cls}"` : ''}>${markup}</g>`;
  const onP = (markup: string, cls = '') => `<g clip-path="${clipP}" stroke="none"${cls ? ` class="${cls}"` : ''}>${markup}</g>`;
  const none = { elytra: '', pronotum: '', defs: '', animated: '' };
  switch (def.pattern ?? 'plain') {
    case 'plain':
      // Casco quase branco e furta-cor (pérola): um degradê rosa-azulado, senão some no fundo creme.
      if (def.iridescence >= 1 && lightness(def.elytra) > 0.8) {
        return {
          ...none,
          defs: `<linearGradient id="${id}-i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4a9c8"/><stop offset=".5" stop-color="#fff3e8"/><stop offset="1" stop-color="#9fd0f0"/></linearGradient>`,
          elytra: onE(`<rect x="5" y="10" width="14" height="12" fill="url(#${id}-i)" opacity=".85"/>`),
          pronotum: onP(`<rect x="6" y="6" width="12" height="6" fill="url(#${id}-i)" opacity=".7"/>`),
        };
      }
      return none;
    case 'spots':
      return {
        ...none,
        elytra: onE(dots([[12, 11.6], [9.1, 13.9], [14.9, 13.9], [9.3, 17.4], [14.7, 17.4], [12, 20.2]], 1.2, a)),
        pronotum: onP(dots([[9.4, 9.7], [14.6, 9.7]], 0.95, b)),
      };
    case 'stripes':
      return { ...none, elytra: onE(`<path d="M5 13.4h14v1.5H5zM5 16.6h14v1.5H5zM5 19.8h14v1.5H5z" fill="${a}"/>`) };
    case 'rosettes':
      return {
        ...none,
        elytra: onE(
          [[9.2, 13.4], [14.6, 12.9], [11.8, 16.3], [8.8, 18.6], [15, 17.8], [12.2, 20.6]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.05" fill="${b}" stroke="${a}" stroke-width=".65" stroke-dasharray="1.4 .55"/>`)
            .join(''),
        ),
      };
    case 'gingham':
      return {
        ...none,
        defs: `<pattern id="${id}-g" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><rect width="1.2" height="2.4" fill="${a}" opacity=".55"/><rect width="2.4" height="1.2" fill="${a}" opacity=".55"/></pattern>`,
        elytra: onE(`<rect x="5" y="10" width="14" height="12" fill="url(#${id}-g)"/>`),
        pronotum: onP(`<rect x="6" y="6" width="12" height="6" fill="url(#${id}-g)"/>`),
      };
    case 'melon':
      return {
        ...none,
        elytra: onE(`<path d="M8.4 10.5c-.8 3.6.2 7.4 1.4 11M12 10.5c-.5 3.8.5 7.3 0 11M15.6 10.5c.8 3.6-.2 7.4-1.4 11" fill="none" stroke="${a}" stroke-width="1.3"/>`),
        pronotum: onP(dots([[9.8, 9.2], [12, 8.3], [14.2, 9.2], [11, 10.4], [13, 10.4]], 0.45, b)),
      };
    case 'camo':
      return {
        ...none,
        elytra: onE(`<ellipse cx="9" cy="14" rx="2.3" ry="1.5" fill="${a}"/><ellipse cx="14.6" cy="16.6" rx="2.1" ry="1.8" fill="${b}"/><ellipse cx="10.6" cy="19.2" rx="1.9" ry="1.3" fill="${c}"/><ellipse cx="15.2" cy="12.6" rx="1.5" ry="1.1" fill="${c}"/><ellipse cx="8.6" cy="17.3" rx="1.2" ry="1" fill="${b}"/>`),
        pronotum: onP(`<ellipse cx="10" cy="8.6" rx="1.6" ry="1" fill="${a}"/><ellipse cx="14.4" cy="9.8" rx="1.3" ry=".9" fill="${b}"/>`),
      };
    case 'crystal':
      return {
        ...none,
        elytra: onE(`<path d="M6 13.5l4-2.2 3 3.4 4.8-2.4M7 18l3.2-3.3 3.4 2.6 3.8-1.6M9.4 21.4l.8-6.7M13.6 17.3l.2 4.4" fill="none" stroke="${a}" stroke-width=".7" opacity=".9"/><path d="M8 15.4l2.2-4.1 2.8 3.4z" fill="${b}" opacity=".35"/><path d="M13.6 17.3l3.8-1.6-1 4.6z" fill="${b}" opacity=".3"/>`),
        animated: `<path class="look-anim-twinkle" d="${starPath(4, 2.3, 0.55, 15.4, 12.9)}" fill="#fff" stroke="none"/>`,
      };
    case 'galaxy':
      return {
        ...none,
        defs: `<radialGradient id="${id}-n1"><stop offset="0" stop-color="${a}" stop-opacity=".9"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient><radialGradient id="${id}-n2"><stop offset="0" stop-color="${b}" stop-opacity=".85"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>`,
        elytra: onE(`<circle cx="9.4" cy="14.6" r="4" fill="url(#${id}-n1)"/><circle cx="15" cy="18" r="4.2" fill="url(#${id}-n2)"/><path d="M6 19.5 18 11" stroke="rgba(255,255,255,.35)" stroke-width="1.6"/>`),
        animated: `<g class="look-anim-twinkle" stroke="none">${dots([[8.6, 12.6], [15.4, 13.4], [11.4, 16.8], [13.8, 20]], 0.45, c)}</g><g class="look-anim-twinkle look-anim-late" stroke="none">${dots([[10.2, 19.4], [14.6, 15.6], [9, 16], [12.6, 12.4]], 0.35, c)}</g>`,
      };
    case 'magma':
      return {
        ...none,
        elytra: onE(`<path d="M6 13.2l3.2.8 2.8-1.8 3.2 1.4 3-.6M8.6 13.8l1 3.4-2.8 1.8M12 12.2l.6 4.4 3.4 1M12.6 16.6l-2.2 2.2.8 2.8M16 17.6l-.4 3" fill="none" stroke="${a}" stroke-width=".9" class="look-anim-pulse"/><path d="M12 12.2l.6 4.4" fill="none" stroke="${b}" stroke-width=".45" class="look-anim-pulse"/>`),
        pronotum: onP(`<path d="M8.4 9.4l2.4.6 1.8-1.4 2.6.8" fill="none" stroke="${a}" stroke-width=".8" class="look-anim-pulse"/>`),
      };
    case 'aurora':
      return {
        ...none,
        elytra: onE(`<g class="look-anim-shift"><path d="M4 15.2c2.6-2.2 5.2 1.6 8-.4s5.2-2 8 .4" fill="none" stroke="${a}" stroke-width="1.8" opacity=".85"/><path d="M4 18.6c2.6-2 5.4 1.4 8-.4s5.4-1.8 8 .6" fill="none" stroke="${b}" stroke-width="1.5" opacity=".85"/></g>`),
      };
    case 'holo':
      return {
        ...none,
        defs: `<linearGradient id="${id}-h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ed2"/><stop offset=".35" stop-color="#9fd6ff"/><stop offset=".65" stop-color="#b8ffb0"/><stop offset="1" stop-color="#fff29a"/></linearGradient>`,
        elytra: onE(`<rect x="5" y="10" width="14" height="12" fill="url(#${id}-h)" opacity=".75"/>`, 'look-anim-hue'),
        pronotum: onP(`<rect x="6" y="6" width="12" height="6" fill="url(#${id}-h)" opacity=".7"/>`, 'look-anim-hue'),
      };
    case 'abyss':
      return {
        ...none,
        elytra: onE(`<g class="look-anim-pulse">${dots([[8.4, 13], [10.4, 12.2], [13.6, 12.2], [15.6, 13], [8.8, 15.6], [15.2, 15.6], [9.6, 18.2], [14.4, 18.2], [12, 20.4]], 0.55, a)}</g>`),
      };
    case 'dawn':
      return {
        ...none,
        defs: `<linearGradient id="${id}-d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".42" stop-color="${b}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${def.elytra}"/></linearGradient>`,
        elytra: onE(`<rect x="5" y="10" width="14" height="12" fill="url(#${id}-d)"/>`),
        animated: `<g class="look-anim-twinkle" stroke="none">${dots([[9.4, 12.4], [14.2, 13], [11.8, 11.8]], 0.4, '#fff4d8')}</g>`,
      };
    case 'gold':
      return {
        ...none,
        elytra: onE(`<rect x="2" y="9" width="3" height="15" fill="rgba(255,255,255,.55)" transform="rotate(20 12 16)" class="look-anim-sweep"/>`),
      };
  }
}

/** Besourinho visto de cima com as cores e o desenho do casco. */
export function skinIcon(def: SkinDef): string {
  const id = `sk${++uid}`;
  const pattern = skinPattern(def, id);
  const head = def.head ?? def.pronotum;
  const club = def.club ?? DEFAULT_CLUB;
  const limbs =
    line('M9.4 9.4 6.6 7.8 5.8 5.6M8.6 13.2 4.8 12.8 3.2 14.8M9.2 16.8l-3 2.6.2 2.2', def.leg, 1.4) +
    line('M10.5 4c-1-1.3-2.4-2-4.1-1.9', def.leg, 1) +
    `<circle cx="6.3" cy="2.1" r=".85" fill="${club}"/>`;
  const eyes = mirrored(dots([[10.1, 5.1]], 0.95, '#fbf6ee') + dots([[10.2, 4.85]], 0.5, EYE));
  return filled(
    `<defs><clipPath id="${id}-e"><path d="${ELYTRA}"/></clipPath><clipPath id="${id}-p"><path d="${PRONOTUM}"/></clipPath>${pattern.defs}</defs>` +
      mirrored(limbs) +
      `<path d="${SHOVEL}" fill="${head}"/>` +
      eyes +
      `<path d="${PRONOTUM}" fill="${def.pronotum}"/>` +
      pattern.pronotum +
      `<path d="${PRONOTUM}" fill="none"/>` +
      `<path d="${ELYTRA}" fill="${def.elytra}"/>` +
      pattern.elytra +
      `<path d="${ELYTRA}" fill="none"/>` +
      line('M12 10.9v10.4', INK, 1) +
      pattern.animated +
      shine(9.2, 14, 1, 2.3, 14, 0.35) +
      shine(10.2, 8.4, 1.4, 0.6, -12, 0.3),
  );
}

// --- acessórios --------------------------------------------------------------------

const GOLD = '#f2c14e';
const GOLD_DEEP = '#d9a232';

export const AccessoryIcons: Record<AccessoryId, string> = {
  partyHat: filled(
    `<path d="M12 3.6 5.6 19.4h12.8z" fill="#ff6fa5"/>` +
      `<path d="M10.6 7.1l2.5.9.7 1.7-3.9-1.4zM8.6 12l5.4 1.9.8 2-6.9-2.4zM6.8 16.6l7.8 2.7H6z" fill="#ffd54a" stroke="none"/>` +
      `<path d="M12 3.6 5.6 19.4h12.8z" fill="none"/>` +
      Array.from({ length: 7 }, (_, i) => `<circle cx="${r2(6.2 + i * 1.93)}" cy="19.6" r="1.15" fill="#fff"/>`).join('') +
      `<circle cx="12" cy="3.4" r="1.9" fill="#7fd3ff"/>` +
      shine(10, 11, 0.6, 2.6, 22, 0.35),
  ),
  cap: filled(
    `<path d="M4.4 15.2c0-4.8 3.4-8.3 7.6-8.3s7.6 3.5 7.6 8.3z" fill="#2f7fd6"/>` +
      line('M12 7v8.2M8 8.4c-.6 2-.8 4.3-.7 6.8M16 8.4c.6 2 .8 4.3.7 6.8', 'rgba(20,50,100,0.45)', 0.8) +
      `<path d="M4.2 15.2h14.6c2.2 0 3.8.8 3.8 1.7s-1.6 1.5-3.8 1.5H5.8c-1 0-1.6-.6-1.6-1.6z" fill="#23609f"/>` +
      `<circle cx="12" cy="6.8" r="1.1" fill="#23609f"/>` +
      `<circle cx="12" cy="11.6" r="1.9" fill="#ffc23d"/>` +
      shine(8.4, 10.4, 1.4, 0.7, -40, 0.4),
  ),
  beanie: filled(
    `<path d="M4.6 15.4c0-5.4 3.3-9.2 7.4-9.2s7.4 3.8 7.4 9.2z" fill="#d64545"/>` +
      `<path d="M5 10.8h14v2.1H5z" fill="#f4ead8" stroke="none"/>` +
      `<path d="M4.6 15.4c0-5.4 3.3-9.2 7.4-9.2s7.4 3.8 7.4 9.2z" fill="none"/>` +
      `<rect x="3.8" y="15" width="16.4" height="4.4" rx="1.6" fill="#f4ead8"/>` +
      line('M6.4 15.4v3.6M8.6 15.4v3.6M10.8 15.4v3.6M13 15.4v3.6M15.2 15.4v3.6M17.4 15.4v3.6', 'rgba(58,42,34,0.2)', 0.8) +
      `<circle cx="12" cy="5" r="2.4" fill="#f4ead8"/>` +
      shine(8.8, 9.6, 1.2, 0.7, -35, 0.4),
  ),
  strawHat: filled(
    `<ellipse cx="12" cy="15.6" rx="10.4" ry="3.8" fill="#ecd08a"/>` +
      `<path d="M7 15.2c0-4.4 2.2-7.4 5-7.4s5 3 5 7.4c0 .9-2.2 1.6-5 1.6s-5-.7-5-1.6z" fill="#e2bd6c"/>` +
      `<path d="M7.1 13.2c1.5.8 3.2 1.1 4.9 1.1s3.4-.3 4.9-1.1l.1 1.9c-1.5.9-3.2 1.3-5 1.3s-3.5-.4-5-1.3z" fill="#d8403c"/>` +
      line('M4 16.4c1.4.8 3 1.2 4.6 1.4M15.4 17.8c1.6-.2 3.2-.6 4.6-1.4', 'rgba(140,100,40,0.45)', 0.7) +
      flower(15.6, 13.4, 1.8, '#fbf6ee', '#f2c230'),
  ),
  flowerCrown: filled(
    `<ellipse cx="12" cy="14" rx="8.4" ry="3.6" fill="none" stroke="#5f9a3e" stroke-width="1.6"/>` +
      flower(4.8, 13.2, 2.2, '#fbf6ee', '#f2c230') +
      flower(9, 16.8, 2.2, '#ff9fc4', '#ffd54a') +
      flower(15, 16.8, 2.2, '#7fb7ff', '#fbf6ee') +
      flower(19.2, 13.2, 2.2, '#fbf6ee', '#f2c230') +
      flower(12, 10.6, 2, '#ff9fc4', '#ffd54a') +
      flower(7.2, 10.6, 1.6, '#7fb7ff', '#fbf6ee') +
      flower(16.8, 10.6, 1.6, '#fbf6ee', '#f2c230'),
  ),
  cowboy: filled(
    `<path d="M1.8 12.6c1.2 2.6 5 4.2 10.2 4.2s9-1.6 10.2-4.2c-2.2.9-3.9 1.1-5.4 1.1H7.2c-1.5 0-3.2-.2-5.4-1.1z" fill="#b07a45"/>` +
      `<path d="M7 13.7c-.2-4.2.8-7.6 2.6-7.6.9 0 1.5.9 2.4.9s1.5-.9 2.4-.9c1.8 0 2.8 3.4 2.6 7.6z" fill="#c08850"/>` +
      `<path d="M7 11.4h10v1.9H7z" fill="#5a3420"/>` +
      `<rect x="13.2" y="11.1" width="1.9" height="2.4" rx=".4" fill="${GOLD}"/>` +
      line('M12 7.2v3.4', 'rgba(58,42,34,0.35)', 0.8) +
      shine(9.2, 8.8, 0.7, 1.6, 10, 0.35),
  ),
  topHat: filled(
    `<ellipse cx="12" cy="18.6" rx="8.6" ry="2.2" fill="#26222c"/>` +
      `<path d="M7.4 18.4 7 4.4c0-.6 2.2-1.1 5-1.1s5 .5 5 1.1l-.4 14c0 .7-2 1.2-4.6 1.2s-4.6-.5-4.6-1.2z" fill="#2f2a36"/>` +
      `<path d="M7.3 14.6c1.4.5 3 .8 4.7.8s3.3-.3 4.7-.8l-.1 2.4c-1.4.5-3 .8-4.6.8s-3.2-.3-4.6-.8z" fill="#8b2440"/>` +
      shine(9.4, 8.4, 0.8, 3, 0, 0.25),
  ),
  chefHat: filled(
    `<path d="M7.2 20.2V14h9.6v6.2c0 .6-2.1 1.1-4.8 1.1s-4.8-.5-4.8-1.1z" fill="#f4efe6"/>` +
      `<path d="M7 14.4c-2.3-.4-3.6-2.2-3.4-4.3.3-2.2 2.2-3.6 4.4-3.4.8-2.1 2.4-3.3 4-3.3s3.2 1.2 4 3.3c2.2-.2 4.1 1.2 4.4 3.4.2 2.1-1.1 3.9-3.4 4.3z" fill="#fffdf8"/>` +
      line('M9.4 14.6v5.8M12 14.8v6M14.6 14.6v5.8', 'rgba(58,42,34,0.18)', 0.8) +
      shine(8.2, 8.8, 1.2, 0.7, -30, 0.5),
  ),
  gnomeHat: filled(
    `<path d="M4.6 20.2c.9-5.6 2.8-10.4 5.6-13.8 2.1-2.5 4.9-3.6 8.2-2.6-2 .3-3.3 1.4-3.8 3.1-.6 2.2.8 7.2 4.8 13.3-2.4.8-5 1.2-7.4 1.2s-5-.4-7.4-1.2z" fill="#d8433b"/>` +
      shine(9.4, 12.4, 0.8, 3, 20, 0.35),
  ),
  miner: filled(
    `<path d="M4.4 16.2c0-5.4 3.4-9.4 7.6-9.4s7.6 4 7.6 9.4z" fill="#f6c93b"/>` +
      `<path d="M10.8 6.9h2.4v9.3h-2.4z" fill="#e5b224" stroke="none"/>` +
      `<path d="M4.4 16.2c0-5.4 3.4-9.4 7.6-9.4s7.6 4 7.6 9.4z" fill="none"/>` +
      `<rect x="2.6" y="15.6" width="18.8" height="2.6" rx="1.3" fill="#f6c93b"/>` +
      `<circle cx="12" cy="12" r="2.6" fill="#3a3a40"/><circle cx="12" cy="12" r="1.7" fill="#fff1b0"/>` +
      line('M12 7.6V6.2M15.4 8.6l.9-1M8.6 8.6l-.9-1', '#ffcf4a', 0.9),
  ),
  viking: filled(
    `<path d="M5.6 12.4C4.2 10.8 3.4 8.4 3.8 5.4c.9 2.4 2.3 3.8 4.6 4.4z" fill="#f1e6cf"/>` +
      `<path d="M18.4 12.4c1.4-1.6 2.2-4 1.8-7-.9 2.4-2.3 3.8-4.6 4.4z" fill="#f1e6cf"/>` +
      `<path d="M5.2 17c0-5 3-8.6 6.8-8.6s6.8 3.6 6.8 8.6z" fill="#a9b3bd"/>` +
      `<path d="M11 8.5h2v8.5h-2z" fill="#b8864a" stroke="none"/>` +
      `<path d="M5.2 17c0-5 3-8.6 6.8-8.6s6.8 3.6 6.8 8.6z" fill="none"/>` +
      `<rect x="4.4" y="15.8" width="15.2" height="2.6" rx="1" fill="#b8864a"/>` +
      dots([[7, 17.1], [9.6, 17.1], [14.4, 17.1], [17, 17.1]], 0.45, '#e2e6ea') +
      `<path d="M11.2 18.4h1.6l-.2 3.2h-1.2z" fill="#b8864a"/>` +
      shine(8.2, 12.2, 0.8, 1.8, 30, 0.4),
  ),
  propeller: filled(
    `<path d="M4.6 17c0-5 3.3-8.6 7.4-8.6S19.4 12 19.4 17z" fill="#e5483f"/>` +
      `<path d="M12 8.4c2.2 0 4.1 1.1 5.4 2.9L12 17z" fill="#ffd54a" stroke="none"/>` +
      `<path d="M12 8.4c-2.2 0-4.1 1.1-5.4 2.9L12 17z" fill="#2f7fd6" stroke="none"/>` +
      `<path d="M17.4 11.3c1.3 1.6 2 3.5 2 5.7H12z" fill="#5fb84a" stroke="none"/>` +
      `<path d="M4.6 17c0-5 3.3-8.6 7.4-8.6S19.4 12 19.4 17z" fill="none"/>` +
      `<path d="M12 8.4V5.6" stroke="#9aa4ad" stroke-width="1.4"/>` +
      `<path d="M12 5.2c-1.6-1.3-4.6-1.5-6.6-.6 1.6 1.2 4.6 1.4 6.6.6zM12 5.2c1.6-1.3 4.6-1.5 6.6-.6-1.6 1.2-4.6 1.4-6.6.6z" fill="#ff6fa5"/>` +
      `<circle cx="12" cy="5.2" r="1" fill="#ffd54a"/>`,
  ),
  wizardHat: filled(
    `<ellipse cx="12" cy="19" rx="9.6" ry="2.4" fill="#3b3aa0"/>` +
      `<path d="M6.6 18.8c1.4-6.2 3.2-10.6 5.6-13.4 1.5-1.8 3.6-2.6 6.2-2.4-1.6.8-2.4 2-2.4 3.6 0 2.8.4 7 1.6 12.2-1.5.6-3.4 1-5.6 1s-4-.4-5.4-1z" fill="#4543b8"/>` +
      `<path d="M7 16.6c1.5.6 3.2.9 5 .9s3.6-.3 5.1-.9l.2 1.8c-1.5.6-3.3.9-5.3.9s-3.7-.3-5.3-.9z" fill="#e6b84a"/>` +
      `<path d="${starPath(5, 1.6, 0.7, 10.6, 12)}" fill="${GOLD}" stroke="none"/>` +
      `<path d="${starPath(5, 1.1, 0.5, 14, 9)}" fill="${GOLD}" stroke="none"/>` +
      `<path class="look-anim-twinkle" d="${starPath(5, 1.6, 0.7, 18.4, 3)}" fill="#ffe27a" stroke="none"/>`,
  ),
  halo: filled(
    `<ellipse cx="12" cy="11" rx="8.6" ry="3.4" fill="none" stroke="#e8b83a" stroke-width="3.4"/>` +
      `<ellipse cx="12" cy="11" rx="8.6" ry="3.4" fill="none" stroke="#fff1b0" stroke-width="1.8" stroke-opacity=".9"/>` +
      `<path class="look-anim-twinkle" d="${starPath(4, 2, 0.5, 19.2, 6.2)}" fill="#fff" stroke="none"/>` +
      `<path class="look-anim-twinkle look-anim-late" d="${starPath(4, 1.4, 0.4, 5.2, 16.4)}" fill="#fff" stroke="none"/>`,
  ),
  cangaceiro: filled(
    `<path d="M1.8 9.2c2.4 5.6 5.8 8.4 10.2 8.4s7.8-2.8 10.2-8.4c-2.6 2.2-5.8 3.2-10.2 3.2S4.4 11.4 1.8 9.2z" fill="#8a5a33"/>` +
      `<path d="M7.4 14.4c0-3.6 2-6.4 4.6-6.4s4.6 2.8 4.6 6.4" fill="#5e3a1e"/>` +
      `<path d="M1.8 9.2c2.4 5.6 5.8 8.4 10.2 8.4s7.8-2.8 10.2-8.4c-2.6 2.2-5.8 3.2-10.2 3.2S4.4 11.4 1.8 9.2z" fill="none"/>` +
      `<path d="${starPath(6, 2.4, 1.3, 12, 14.6, -Math.PI / 2)}" fill="#e0bd5a"/>` +
      dots([[4.2, 11.8], [6.2, 13.8], [17.8, 13.8], [19.8, 11.8]], 0.55, '#e0bd5a'),
  ),
  crown: filled(
    `<path d="M4.4 18.6 3.4 8.6l4.4 3.6L12 5.6l4.2 6.6 4.4-3.6-1 10z" fill="${GOLD}"/>` +
      `<rect x="4.2" y="16.6" width="15.6" height="3.2" rx="1" fill="${GOLD_DEEP}"/>` +
      dots([[3.4, 8.4], [12, 5.2], [20.6, 8.4]], 1.1, '#fbf6ee') +
      dots([[8.2, 18.2]], 0.9, '#e2334a') +
      dots([[12, 18.2]], 0.9, '#2f6fe0') +
      dots([[15.8, 18.2]], 0.9, '#2fb86a') +
      shine(8.6, 13.6, 0.7, 2, 20, 0.4) +
      `<path class="look-anim-twinkle" d="${starPath(4, 1.8, 0.45, 16.6, 13.4)}" fill="#fff" stroke="none"/>`,
  ),
  sunglasses: filled(
    `<path d="M9.8 11.4c1.3-.7 3.1-.7 4.4 0" fill="none" stroke="#17141d" stroke-width="1.4"/>` +
      `<path d="M1.6 10.6 3 10M22.4 10.6 21 10" stroke="#17141d" stroke-width="1.4"/>` +
      `<rect x="2.6" y="9" width="7.6" height="6.4" rx="2" fill="#221d2c"/>` +
      `<rect x="13.8" y="9" width="7.6" height="6.4" rx="2" fill="#221d2c"/>` +
      line('M4.6 13.4 7 10.6M15.8 13.4l2.4-2.8', 'rgba(255,255,255,0.7)', 0.9),
  ),
  roundGlasses: filled(
    `<circle cx="7.2" cy="12" r="3.9" fill="rgba(210,235,250,0.35)" stroke="#c9a24a" stroke-width="1.4"/>` +
      `<circle cx="16.8" cy="12" r="3.9" fill="rgba(210,235,250,0.35)" stroke="#c9a24a" stroke-width="1.4"/>` +
      `<path d="M11.1 11.6c.6-.5 1.2-.5 1.8 0M3.3 11.4 1.6 10.6M20.7 11.4l1.7-.8" fill="none" stroke="#c9a24a" stroke-width="1.1"/>` +
      line('M5.4 10.4c.5-.7 1.2-1 2-1M15 10.4c.5-.7 1.2-1 2-1', 'rgba(255,255,255,0.9)', 0.8),
  ),
  heartGlasses: filled(
    `<path d="M10 11.6c1.3-.6 2.7-.6 4 0M2.4 10.8 1.4 10.2M21.6 10.8l1-.6" fill="none" stroke="#ff3d8b" stroke-width="1.3"/>` +
      `<path d="${heartPath(6.6, 12, 8.4)}" fill="#ff9cc8" stroke="#ff3d8b" stroke-width="1.3"/>` +
      `<path d="${heartPath(17.4, 12, 8.4)}" fill="#ff9cc8" stroke="#ff3d8b" stroke-width="1.3"/>` +
      shine(4.8, 10.6, 0.6, 1.1, 30, 0.6) +
      shine(15.6, 10.6, 0.6, 1.1, 30, 0.6),
  ),
  starGlasses: filled(
    `<path d="M10.4 11.4c1-.5 2.2-.5 3.2 0M2.2 10.6 1.2 10M21.8 10.6l1-.6" fill="none" stroke="${GOLD_DEEP}" stroke-width="1.3"/>` +
      `<path d="${starPath(5, 5, 2.4, 6.4, 12.4)}" fill="#ff9f3a" stroke="${GOLD}" stroke-width="1.3"/>` +
      `<path d="${starPath(5, 5, 2.4, 17.6, 12.4)}" fill="#ff9f3a" stroke="${GOLD}" stroke-width="1.3"/>` +
      shine(5.4, 11.2, 0.5, 1, 30, 0.6) +
      shine(16.6, 11.2, 0.5, 1, 30, 0.6),
  ),
  mustache: filled(
    `<path d="M12 11.2c-1.2-1.6-3.4-2-5.2-1.2-1.6.7-2.4 2.3-3.6 2.6-.9.2-1.7-.2-2-.9-.2 1.8 1.2 3.4 3.4 3.4 2.6 0 4.4-1.6 5.6-2.6.7-.5 1.3-.6 1.8-.1.5-.5 1.1-.4 1.8.1 1.2 1 3 2.6 5.6 2.6 2.2 0 3.6-1.6 3.4-3.4-.3.7-1.1 1.1-2 .9-1.2-.3-2-1.9-3.6-2.6-1.8-.8-4-.4-5.2 1.2z" fill="#3a2a22"/>` +
      shine(7.8, 11.6, 1.4, 0.5, -15, 0.3) +
      shine(16.2, 11.6, 1.4, 0.5, 15, 0.3),
  ),
  monocle: filled(
    `<path d="M14.6 15.4c1.6 1.4 2.4 3 2.6 4.8.1 1-.2 2-1 2.8" fill="none" stroke="${GOLD_DEEP}" stroke-width="1" stroke-dasharray="1 .7"/>` +
      `<circle cx="10.6" cy="10.4" r="5.4" fill="rgba(210,235,250,0.35)" stroke="#e0b44a" stroke-width="1.8"/>` +
      line('M7.8 8.4c.7-1 1.8-1.6 3-1.6', 'rgba(255,255,255,0.9)', 1) +
      `<path class="look-anim-twinkle" d="${starPath(4, 1.8, 0.45, 15.6, 5.4)}" fill="#fff" stroke="none"/>`,
  ),
  bowTie: filled(
    `<path d="M12 12c-2.2-2.6-5-4.2-7.4-3.8-.9 1.2-.9 6.4 0 7.6 2.4.4 5.2-1.2 7.4-3.8z" fill="#d8343a"/>` +
      `<path d="M12 12c2.2-2.6 5-4.2 7.4-3.8.9 1.2.9 6.4 0 7.6-2.4.4-5.2-1.2-7.4-3.8z" fill="#d8343a"/>` +
      dots([[6.6, 10.4], [6.4, 13.6], [8.8, 12], [17.4, 10.4], [17.6, 13.6], [15.2, 12]], 0.6, '#fff4e6') +
      `<rect x="10.4" y="10" width="3.2" height="4" rx="1.3" fill="#b8262d"/>`,
  ),
  bandana: filled(
    `<path d="M3 7.6c2.8 1.2 5.8 1.8 9 1.8s6.2-.6 9-1.8l-1 2.2c-1.7 5-4.4 9-8 10.6-3.6-1.6-6.3-5.6-8-10.6z" fill="#d8403c"/>` +
      `<g fill="none" stroke="#fff1dc" stroke-width=".8">${[[8, 11.6], [12, 12.6], [16, 11.6], [10, 15.4], [14, 15.4], [12, 18]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9"/>`)
        .join('')}</g>` +
      `<path d="M2.4 7.2c-.4-1.4 0-2.6 1.2-3.2.6 1.2 1.6 2.2 3 2.6M21.6 7.2c.4-1.4 0-2.6-1.2-3.2-.6 1.2-1.6 2.2-3 2.6" fill="#c7362f"/>`,
  ),
  scarf: filled(
    `<path d="M3.6 8.4c2.4 2 5.2 3 8.4 3s6-1 8.4-3l.6 3.6c-2.6 2.2-5.6 3.2-9 3.2s-6.4-1-9-3.2z" fill="#3aa3b3"/>` +
      `<path d="M6.2 10.4l-.6 3.4M9.2 11.4 9 14.8M12.2 11.6v3.4M15.2 11.4l.2 3.4M18.2 10.4l.6 3.4" stroke="#f4ead8" stroke-width="1.4"/>` +
      `<path d="M14.6 13.6l.6 7.4h3.4l-.8-7.8zM17.4 13.4l2.6 6.6 2.8-1.2-3-6.4z" fill="#3aa3b3"/>` +
      `<path d="M15 16.2h3.2M15.3 18.6h3.2M18.4 15l2.8-1.2M19.4 17.4l2.8-1.2" stroke="#f4ead8" stroke-width="1.1"/>` +
      line('M15.6 21.2v1.2M16.8 21.2v1.2M18 21.2v1.2', '#3aa3b3', 0.8),
  ),
  cowbell: filled(
    `<path d="M4 5.4c2.4 1.6 5 2.4 8 2.4s5.6-.8 8-2.4" fill="none" stroke="#7a4a28" stroke-width="2"/>` +
      `<circle cx="12" cy="8.8" r="1.2" fill="none" stroke="#b8864a" stroke-width="1"/>` +
      `<path d="M8.8 10.2h6.4l1.6 9.2c-1.4.8-3.1 1.2-4.8 1.2s-3.4-.4-4.8-1.2z" fill="#d4a84a"/>` +
      `<circle cx="12" cy="20.4" r="1.2" fill="#6e5a3a"/>` +
      shine(10.2, 14, 0.7, 2.6, 8, 0.45),
  ),
  lei: filled(
    `<ellipse cx="12" cy="11.6" rx="8.2" ry="6.4" fill="none" stroke="#5f9a3e" stroke-width="1"/>` +
      flower(12, 18, 2.4, '#ff6fa5', '#ffd54a') +
      flower(6.4, 16, 2.2, '#ffd54a', '#ff8a3d') +
      flower(17.6, 16, 2.2, '#fbf6ee', '#ffd54a') +
      flower(4, 11, 2, '#ff8a3d', '#fff1a8') +
      flower(20, 11, 2, '#c59bff', '#fff1a8') +
      flower(7, 6.2, 1.8, '#fbf6ee', '#ffd54a') +
      flower(17, 6.2, 1.8, '#ff6fa5', '#ffd54a'),
  ),
  medal: filled(
    `<path d="M6.4 2.8h3.4l3 8.4-2.6 1.2zM17.6 2.8h-3.4l-3 8.4 2.6 1.2z" fill="#2f5fd6"/>` +
      `<path d="M8.1 2.8 11 11.4M15.9 2.8 13 11.4" stroke="#d8343a" stroke-width=".9"/>` +
      `<circle cx="12" cy="15.8" r="5.4" fill="${GOLD}"/>` +
      `<circle cx="12" cy="15.8" r="3.9" fill="none" stroke="${GOLD_DEEP}" stroke-width=".8"/>` +
      `<path d="${starPath(5, 2.6, 1.1, 12, 16)}" fill="#fff1b0" stroke="none"/>`,
  ),
  flag: filled(
    `<path d="M6 21.6V3" stroke="#f6f1e8" stroke-width="2.4"/><path d="M6 21.6V3" stroke="${INK}" stroke-width=".6"/>` +
      `<circle cx="6" cy="2.8" r="1.3" fill="#f6f1e8"/>` +
      `<path d="M6.8 4.6c3.6.4 8.2 2 13.4 4.6-5.2 1.2-9.8 2.8-13.4 5z" fill="#ff8a3d"/>` +
      `<circle cx="10.2" cy="9" r="1.9" fill="#ffd54a" stroke="none"/>` +
      line('M10.2 5.8v-.9M13.2 7.4l.7-.5M13.2 10.6l.7.5M10.2 12.2v.9', '#ffd54a', 0.9),
  ),
  backpack: filled(
    `<path d="M7.4 7.2V5.6a4.6 4.6 0 0 1 9.2 0v1.6" fill="none" stroke="#3a3a44" stroke-width="1.8"/>` +
      `<rect x="4.4" y="6.6" width="15.2" height="15" rx="4" fill="#e5483f"/>` +
      `<path d="M4.6 11c2.2 1 4.6 1.4 7.4 1.4s5.2-.4 7.4-1.4" fill="none" stroke="#b8322f" stroke-width="1.6"/>` +
      `<rect x="7.4" y="13.8" width="9.2" height="5.8" rx="2" fill="#ffc23d"/>` +
      line('M8.6 15.6h6.8', 'rgba(58,42,34,0.35)', 0.8) +
      `<rect x="11.2" y="10.4" width="1.6" height="2.4" rx=".5" fill="#d9dde3"/>` +
      shine(7.4, 9.4, 1.4, 0.6, -20, 0.4),
  ),
  cape: filled(
    `<path d="M8 3.6h8c.6 3.4 2 7.4 4.6 11.6.8 1.4.2 3.2-1.2 3.8-2.4 1-4.8 1.6-7.4 1.6S6.4 20 4 19c-1.4-.6-2-2.4-1.2-3.8C5.4 11 7 7 8 3.6z" fill="#d6343a"/>` +
      `<path d="M3.4 17.8c2.6 1.2 5.6 1.8 8.6 1.8s6-.6 8.6-1.8l-.4 1.4c-2.6 1.2-5.3 1.8-8.2 1.8s-5.6-.6-8.2-1.8z" fill="${GOLD}" stroke="none"/>` +
      line('M9.6 6.6c-.6 3.8-1.8 7.6-3.8 11M14.4 6.6c.6 3.8 1.8 7.6 3.8 11M12 6.4v13', 'rgba(90,20,20,0.35)', 0.8) +
      dots([[8.2, 4.2], [15.8, 4.2]], 1.3, GOLD),
  ),
  butterflyWings: filled(
    mirrored(
      `<path d="M11.4 11.4C9.6 6.2 6.8 3.4 3.8 3.8 2 4 1.4 5.8 2 7.8c.9 2.8 4.4 4 9.4 3.6z" fill="#ff8fc8"/>` +
        `<path d="M11.4 12.6c-4.2-.2-7.4 1.4-8 4-.4 1.8.8 3.4 2.6 3.2 2.6-.3 4.6-2.8 5.4-7.2z" fill="#c59bff"/>` +
        `<path d="M9.8 10.2C8 7.6 6 6 4.2 5.8" fill="none" stroke="rgba(90,40,110,0.4)" stroke-width=".8"/>` +
        dots([[3.8, 6], [5.8, 4.8]], 0.6, '#fff8f0'),
    ) + `<path d="M12 8.4v8.4" stroke="#3b2c33" stroke-width="1.6"/>`,
  ),
  bottleRocket: filled(
    `<path d="M7.4 19.6c-.6 1.2-.4 2.4.4 3.2.8-.8 1-2 .4-3.2zM16.2 19.6c-.6 1.2-.4 2.4.4 3.2.8-.8 1-2 .4-3.2z" fill="#ffb13a" stroke="none" class="look-anim-pulse"/>` +
      `<path d="M5.6 6.8c0-1.4.8-2.6 2.2-3.2V2.4h1.2v1.2c1.4.6 2.2 1.8 2.2 3.2v11.6H5.6z" fill="#9fe0ea"/>` +
      `<path d="M13 6.8c0-1.4.8-2.6 2.2-3.2V2.4h1.2v1.2c1.4.6 2.2 1.8 2.2 3.2v11.6H13z" fill="#9fe0ea"/>` +
      `<rect x="5.4" y="17.8" width="5.8" height="2.2" rx=".6" fill="#e5483f"/><rect x="12.8" y="17.8" width="5.8" height="2.2" rx=".6" fill="#e5483f"/>` +
      `<path d="M4.6 9.6h14.8v1.8H4.6zM4.6 14h14.8v1.8H4.6z" fill="#9aa0aa"/>` +
      shine(7.2, 8, 0.5, 1.8, 0, 0.6) +
      shine(14.6, 8, 0.5, 1.8, 0, 0.6),
  ),
};

/** Ícone de "nada" (lugar vazio): o contorno do lugar, tracejado. */
export const EmptySlotIcon = stroke('<circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/><path d="M8.5 15.5l7-7"/>', 1.8);

/** Ícones de traço das abas do guarda-roupa (seguem a cor do texto). */
export const WardrobeTabIcons: Record<'skins' | AccessorySlot, string> = {
  skins: stroke('<path d="M5.8 11.4c0-1.3 1-2.2 2.2-2.2h8c1.2 0 2.2.9 2.2 2.2 0 5.4-2.8 9.4-6.2 9.4s-6.2-4-6.2-9.4z"/><path d="M12 9.2v11.4"/><path d="M8.6 9.2c0-2.2 1.5-3.8 3.4-3.8s3.4 1.6 3.4 3.8"/><path d="M10.4 5.6 8.8 3.2M13.6 5.6l1.6-2.4"/>'),
  head: stroke('<path d="M3 18.5h18"/><path d="M6.5 18.5V8.2c0-.9 2.5-1.7 5.5-1.7s5.5.8 5.5 1.7v10.3"/><path d="M6.5 14.5c1.6.6 3.5.9 5.5.9s3.9-.3 5.5-.9"/>'),
  face: stroke('<circle cx="7" cy="13" r="3.6"/><circle cx="17" cy="13" r="3.6"/><path d="M10.6 12.4c.9-.7 1.9-.7 2.8 0M3.4 12 2 10.6M20.6 12l1.4-1.4"/>'),
  neck: stroke('<path d="M12 12 5 8v8zM12 12l7-4v8z"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  back: stroke('<path d="M8 4h8c.6 3.6 2 7.4 4.4 11.4.5.9.1 2-.9 2.4-2.4 1-4.8 1.6-7.5 1.6s-5.1-.6-7.5-1.6c-1-.4-1.4-1.5-.9-2.4C6 11.4 7.4 7.6 8 4z"/><path d="M12 4.2v15"/>'),
};

/** Cabide: o botão do guarda-roupa no menu. */
export const HangerIcon = stroke('<path d="M12 7.4a2.2 2.2 0 1 1 2.2-2.2c0 1-.6 1.5-1.4 2-.5.3-.8.7-.8 1.3v.5"/><path d="M12 9 3.4 15.4c-.9.7-.4 2.1.7 2.1h15.8c1.1 0 1.6-1.4.7-2.1z"/>');

export function lookIcon(look: Look): string {
  return look.kind === 'skin' ? skinIcon(skin(look.id)) : AccessoryIcons[look.id];
}
