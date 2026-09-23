import type { CatalogShape } from '../progression/catalog';
import type { PerkId } from '../progression/perks';
import type { GiverId } from '../progression/requests';

/**
 * Ícones do jogo em si: figurinhas do catálogo (preenchidas, com a cor de cada
 * uma via `currentColor`), os poderes (traço, como os ícones da interface), os
 * bichos que fazem os pedidos da rodada (figurinhas multicor, com carinha) e o
 * besouro de cada casco. Os de interface pura (fechar, engrenagem...) moram em
 * `icons.ts`.
 *
 * Tudo em 24×24. As figurinhas levam contorno fino de tinta e realces claros;
 * peças que formam um corpo só passam por `merged`, que contorna a união (e não
 * cada peça), senão o desenho vira um monte de riscos por dentro.
 */

const INK = 'rgba(58,42,34,0.55)';
const INK_SOLID = '#3a2a22';
const INK_ALPHA = 0.55;
const CREAM = '#fff4de';
const STEM = '#5f9a3e';
const BARK = '#6a4a2e';
const LEAF = '#6fb04a';
const LEG = '#3b2c33';
const EYE = '#2b2230';
const BLUSH = '#ff9aa8';
const WING = 'rgba(228,240,252,0.85)';
const CREASE = 'rgba(58,42,34,0.32)';

const filled = (paths: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

const stroke = (paths: string, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

type Point = readonly [number, number];

/** Arredonda pra 2 casas: o SVG gerado fica curto. */
const r2 = (value: number) => Math.round(value * 100) / 100;
const pt = ([x, y]: Point) => `${r2(x)} ${r2(y)}`;

const petals = (count: number, rx: number, ry: number, distance: number, fill: string) =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i * 360) / count;
    return `<ellipse cx="12" cy="${12 - distance}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${angle} 12 12)"/>`;
  }).join('');

const mushroomCap = (dots: boolean) =>
  `<path d="M10 13.5h4l.6 6.2a1.2 1.2 0 0 1-1.2 1.3h-2.8a1.2 1.2 0 0 1-1.2-1.3z" fill="${CREAM}"/>` +
  `<path d="M3.2 13.6C3.2 8.5 7.1 4.5 12 4.5s8.8 4 8.8 9.1c0 .6-.5 1-1.1 1H4.3c-.6 0-1.1-.4-1.1-1z" fill="currentColor"/>` +
  (dots ? `<g fill="${CREAM}" stroke="none"><circle cx="8.3" cy="9.6" r="1.3"/><circle cx="13.2" cy="7.6" r="1.1"/><circle cx="16.2" cy="11" r="1.2"/><circle cx="11.4" cy="11.6" r=".9"/></g>` : '');

/** Espelha o desenho no eixo vertical `x = cx` (bicho é simétrico: desenha-se um lado só). */
const mirrored = (paths: string, cx = 12) => `${paths}<g transform="matrix(-1 0 0 1 ${cx * 2} 0)">${paths}</g>`;

/** Brilho: elipse clara sem contorno. */
const shine = (cx: number, cy: number, rx: number, ry: number, angle = 0, alpha = 0.45) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="rgba(255,255,255,${alpha})" stroke="none"${angle ? ` transform="rotate(${angle} ${cx} ${cy})"` : ''}/>`;

/** Bolinhas sem contorno (pintas, sementes, furos, grãos). */
const dots = (points: readonly Point[], r: number, fill: string) =>
  points.map(([x, y]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}" stroke="none"/>`).join('');

/** Traço de detalhe sem preenchimento (vinco, costura, pata, antena). */
const line = (d: string, color = CREASE, width = 1.1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

/** Fio com contorno (arame, teia, pata comprida): a tinta por baixo, a cor por cima. */
const wire = (d: string, width: number, color = 'currentColor', outline = 1.4) => line(d, INK, width + outline) + line(d, color, width);

/**
 * Peças coladas num contorno só: a tinta contorna a união, não cada peça. A
 * opacidade vai no grupo inteiro pra tinta não escurecer onde as peças se
 * sobrepõem. As peças não podem trazer `stroke` próprio.
 */
const merged = (parts: string) =>
  `<g stroke="${INK_SOLID}" stroke-width="2.2" opacity="${INK_ALPHA}">${parts}</g><g stroke="none">${parts}</g>`;

/** Folhinha (maçã, uva, broto) saindo de (x, y) na direção de `angle` graus. */
const smallLeaf = (x: number, y: number, angle: number, scale = 1) =>
  `<path d="M0 0c1.2-1.5 3.2-2 5-1.3-.8 1.7-3 2.5-5 1.3z" fill="${LEAF}" transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"/>`;

/** Estrela de `count` pontas (tampinha, impacto, raios do sol). */
const starPath = (count: number, outer: number, inner: number, cx = 12, cy = 12, turn = 0) =>
  Array.from({ length: count * 2 }, (_, i) => {
    const angle = turn + (i / (count * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outer : inner;
    return `${i === 0 ? 'M' : 'L'}${pt([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])}`;
  }).join('') + 'z';

/** Espiral de concha: meias-voltas que crescem `step` a cada vez (a última fica aberta). */
const spiral = (cx: number, cy: number, step: number, turns: number) =>
  `M${cx} ${cy}` +
  Array.from({ length: turns }, (_, i) => {
    const radius = r2(step * (i + 1));
    const offset = i % 2 === 0 ? radius : -radius;
    return `a${radius} ${radius} 0 ${i < turns - 1 ? 1 : 0} 1 ${offset} ${offset}`;
  }).join('');

/** Faixa horizontal dentro de um círculo, entre `y1` e `y2` (listra da abelha). */
const circleBand = (cx: number, cy: number, r: number, y1: number, y2: number) => {
  const half = (y: number) => Math.sqrt(Math.max(r * r - (y - cy) ** 2, 0));
  const a = half(y1);
  const b = half(y2);
  return `M${pt([cx - a, y1])}H${r2(cx + a)}A${r} ${r} 0 0 1 ${pt([cx + b, y2])}H${r2(cx - b)}A${r} ${r} 0 0 1 ${pt([cx - a, y1])}z`;
};

/** Disco visto de lado (camadas da bolacha): a lateral e, com `lid`, a tampa. */
const disc = (cy: number, rx: number, ry: number, height: number, fill: string, lid: boolean) =>
  `<path d="M${r2(12 - rx)} ${cy}v${height}a${rx} ${ry} 0 0 0 ${r2(rx * 2)} 0v${-height}z" fill="${fill}"/>` +
  (lid ? `<ellipse cx="12" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>` : '');

type BoxFace = 'top' | 'left' | 'right';

/**
 * Caixa em perspectiva (dado, cubo de açúcar, pecinha de montar): topo em
 * losango e duas laterais sombreadas. `at(face, u, v)` acha um ponto dentro de
 * uma face (u e v de 0 a 1) pra pôr pinta, pino ou grão.
 */
function isoBox(top: number, halfW: number, halfH: number, depth: number) {
  const T: Point = [12, top];
  const R: Point = [12 + halfW, top + halfH];
  const B: Point = [12, top + halfH * 2];
  const L: Point = [12 - halfW, top + halfH];
  const down = (p: Point): Point => [p[0], p[1] + depth];
  // Cada face: origem, ponta do eixo u e ponta do eixo v.
  const frames: Record<BoxFace, readonly [Point, Point, Point]> = {
    top: [T, R, L],
    left: [L, B, down(L)],
    right: [B, R, down(B)],
  };
  const at = (face: BoxFace, u: number, v: number): Point => {
    const [o, a, b] = frames[face];
    return [o[0] + (a[0] - o[0]) * u + (b[0] - o[0]) * v, o[1] + (a[1] - o[1]) * u + (b[1] - o[1]) * v];
  };
  const poly = (...points: Point[]) => `M${points.map(pt).join('L')}z`;
  const topFace = poly(T, R, B, L);
  const leftFace = poly(L, B, down(B), down(L));
  const rightFace = poly(B, R, down(R), down(B));
  // Sombra por cima da cor e o contorno por último, pra sombra não comer a tinta.
  const markup =
    `<path d="${topFace}${leftFace}${rightFace}" fill="currentColor" stroke="none"/>` +
    `<path d="${leftFace}" fill="rgba(58,42,34,0.1)" stroke="none"/>` +
    `<path d="${rightFace}" fill="rgba(58,42,34,0.24)" stroke="none"/>` +
    `<path d="${topFace}" fill="rgba(255,255,255,0.16)" stroke="none"/>` +
    `<path d="${topFace}${leftFace}${rightFace}" fill="none"/>`;
  return { markup, at };
}

/** Pino de pecinha de montar em pé sobre (x, y) do topo da caixa. */
const stud = ([x, y]: Point) =>
  `<path d="M${r2(x - 1.9)} ${r2(y)}v-1.5a1.9 .98 0 0 1 3.8 0v1.5a1.9 .98 0 0 1-3.8 0z" fill="currentColor"/>` +
  `<ellipse cx="${r2(x)}" cy="${r2(y - 1.5)}" rx="1.9" ry=".98" fill="currentColor"/>` +
  `<ellipse cx="${r2(x)}" cy="${r2(y - 1.5)}" rx="1.9" ry=".98" fill="rgba(255,255,255,0.22)" stroke="none"/>`;

/** Olhinho de conta com brilho: o mesmo em todo personagem, pra parecerem da mesma turma. */
const beadEye = (cx: number, cy: number, r = 1.05) =>
  `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(r)}" ry="${r2(r * 1.2)}" fill="${EYE}" stroke="none"/>` +
  `<circle cx="${r2(cx + r * 0.35)}" cy="${r2(cy - r * 0.45)}" r="${r2(r * 0.4)}" fill="#fff" stroke="none"/>`;

/** Olho saltado (branco com pupila), pros bichos de olho grande: sapo, caracol. */
const bigEye = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>` + beadEye(cx + r * 0.1, cy + r * 0.12, r * 0.55);

/** Bochechas rosadas nos dois lados de `cx`. */
const cheeks = (cx: number, cy: number, spread: number) =>
  `<g fill="${BLUSH}" stroke="none" opacity="0.85"><ellipse cx="${r2(cx - spread)}" cy="${cy}" rx="1.1" ry=".65"/><ellipse cx="${r2(cx + spread)}" cy="${cy}" rx="1.1" ry=".65"/></g>`;

const smile = (cx: number, cy: number, width = 1.8) => line(`M${r2(cx - width / 2)} ${cy}q${r2(width / 2)} ${r2(width / 2)} ${r2(width)} 0`, EYE, 0.9);

/** Rosto padrão dos personagens: olhinhos, bochechas e sorriso. */
const face = (cx: number, cy: number, spread: number, eyeR = 1.05) =>
  beadEye(cx - spread, cy, eyeR) + beadEye(cx + spread, cy, eyeR) + cheeks(cx, r2(cy + 1.7), spread + 0.9) + smile(cx, r2(cy + 1.3));

interface BeetleLook {
  readonly shell: string;
  readonly pronotum: string;
  readonly head: string;
  readonly legs: string;
  /** Pontinha da antena (o laranja do besouro do jogo). */
  readonly club?: string;
  /** Pintas nos élitros (vaquinha). */
  readonly spots?: string;
  /** Cabeça em pá, de rola-bosta; sem isso, cabecinha redonda. */
  readonly shovel?: boolean;
  /** Olhinhos na cabeça (o nosso besouro). */
  readonly eyes?: boolean;
}

/** Besouro visto de cima: élitros com a sutura, pronoto, cabeça, 6 patas e antenas. */
function beetleFigure(look: BeetleLook): string {
  const limbs =
    line('M9.4 9.4 6.6 7.8 5.8 5.6M8.6 13.2 4.8 12.8 3.2 14.8M9.2 16.8l-3 2.6.2 2.2', look.legs, 1.4) +
    // Antena comprida e aberta pro lado: curta e de bolota grande, vira orelhinha de urso.
    line('M10.5 4c-1-1.3-2.4-2-4.1-1.9', look.legs, 1) +
    (look.club ? `<circle cx="6.3" cy="2.1" r=".85" fill="${look.club}"/>` : '');
  const head = look.shovel
    ? `<path d="M8.2 6.8c-.3-2 1.5-3.8 3.8-3.8s4.1 1.8 3.8 3.8c-.1.6-.5.9-1.1.9H9.3c-.6 0-1-.3-1.1-.9z" fill="${look.head}"/>`
    : `<ellipse cx="12" cy="6" rx="2.6" ry="2.3" fill="${look.head}"/>`;
  const eyes = look.eyes ? mirrored(dots([[10.1, 5.1]], 0.95, '#fbf6ee') + dots([[10.2, 4.85]], 0.5, EYE)) : '';
  const spots = look.spots ? mirrored(dots([[9.2, 13.6], [9.4, 16.8]], 1.15, look.spots) + dots([[10.4, 19.4]], 0.85, look.spots)) : '';
  return (
    mirrored(limbs) +
    head +
    eyes +
    `<path d="M7.2 10.2c0-2.3 2.2-3.8 4.8-3.8s4.8 1.5 4.8 3.8c0 .8-.6 1.3-1.4 1.3H8.6c-.8 0-1.4-.5-1.4-1.3z" fill="${look.pronotum}"/>` +
    `<path d="M6.3 12.6c0-1.1.9-1.9 2-1.9h7.4c1.1 0 2 .8 2 1.9 0 5.1-2.5 8.8-5.7 8.8s-5.7-3.7-5.7-8.8z" fill="${look.shell}"/>` +
    line('M12 10.9v10.4', INK, 1) +
    spots +
    shine(9.2, 14, 1, 2.3, 14, 0.35) +
    shine(10.2, 8.4, 1.4, 0.6, -12, 0.3)
  );
}

/** Escamas da pinha: fileiras desencontradas de "U". */
const PINE_SCALES = (
  [
    [7.6, [10, 14]],
    [10.6, [8, 12, 16]],
    [13.6, [10, 14]],
    [16.6, [12]],
  ] as const
)
  .flatMap(([y, xs]) => xs.map((x) => `M${x - 2} ${y}q2 2.6 4 0`))
  .join('');

/** Folha do trevo em coração, com a ponta no centro, girada `angle` graus. */
const heartLeaf = (angle: number) =>
  `<g transform="rotate(${angle} 12 12)"><path d="M12 12c-.6-2.3-3.5-3.3-3.5-5.8a2.1 2.1 0 0 1 3.5-1.6 2.1 2.1 0 0 1 3.5 1.6c0 2.5-2.9 3.5-3.5 5.8z" fill="currentColor"/>` +
  `${line('M12 11.2V6.4', 'rgba(255,255,255,0.45)', 1)}</g>`;

/** Teia orbicular: raios e três voltas que cedem um pouco entre um raio e outro. */
function webMarkup(): string {
  const spokes = 8;
  const angle = (i: number) => 0.25 + (i / spokes) * Math.PI * 2;
  const at = (a: number, r: number): Point => [12 + Math.cos(a) * r, 12 + Math.sin(a) * r];
  let d = Array.from({ length: spokes }, (_, i) => `M12 12L${pt(at(angle(i), 9.6))}`).join('');
  for (const r of [2.6, 5.3, 8]) {
    d += `M${pt(at(angle(0), r))}` + Array.from({ length: spokes }, (_, i) => `Q${pt(at(angle(i + 0.5), r * 0.84))} ${pt(at(angle(i + 1), r))}`).join('') + 'z';
  }
  const drop = at(angle(1), 5.3);
  return wire(d, 1.1) + `<circle cx="${r2(drop[0])}" cy="${r2(drop[1])}" r="1.3" fill="#bfe6fb"/>` + dots([[drop[0] - 0.4, drop[1] - 0.45]], 0.4, '#fff');
}

/** Lacraia: segmentos espaçados por igual ao longo de uma onda, cada um com seu par de patas. */
function centipedeMarkup(): string {
  // Diagonal de baixo-esquerda pra cima-direita, com um S leve (onda forte embola as patas).
  const wave = (t: number): Point => [3.8 + 14.6 * t, 19.2 - 13.4 * t + 2.4 * Math.sin(Math.PI * 2 * t)];
  // Comprimento acumulado da curva, pra andar por ela em passos iguais.
  const samples = Array.from({ length: 121 }, (_, i) => wave(i / 120));
  const lengths: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  const total = lengths[lengths.length - 1];
  /** Ponto e direção (unitária, rumo à cabeça) a uma fração `s` do comprimento. */
  const along = (s: number) => {
    const target = s * total;
    const i = Math.max(1, lengths.findIndex((length) => length >= target));
    const [a, b] = [samples[i - 1], samples[i]];
    const k = (target - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const size = Math.hypot(dx, dy);
    return { p: [a[0] + dx * k, a[1] + dy * k] as Point, t: [dx / size, dy / size] as Point };
  };
  const count = 11;
  const parts = Array.from({ length: count }, (_, i) => along(i / (count - 1)));
  const offset = ({ p, t }: { p: Point; t: Point }, forward: number, side: number): Point => [p[0] + t[0] * forward - t[1] * side, p[1] + t[1] * forward + t[0] * side];
  const segment = (part: { p: Point; t: Point }, rx: number, ry: number) =>
    `<ellipse cx="${r2(part.p[0])}" cy="${r2(part.p[1])}" rx="${rx}" ry="${ry}" fill="currentColor" transform="rotate(${r2((Math.atan2(part.t[1], part.t[0]) * 180) / Math.PI)} ${pt(part.p)})"/>`;
  const body = parts.slice(0, -1);
  const head = parts[count - 1];
  const legs = body.map((part) => [1, -1].map((side) => `M${pt(offset(part, 0, side * 1.2))}L${pt(offset(part, -0.9, side * 3.3))}`).join('')).join('');
  const tail = [1, -1].map((side) => `M${pt(offset(parts[0], -0.8, side * 0.7))}L${pt(offset(parts[0], -3.2, side * 1.9))}`).join('');
  const antennae = [1, -1].map((side) => `M${pt(offset(head, 1.2, side * 0.7))}Q${pt(offset(head, 3, side * 1))} ${pt(offset(head, 3.8, side * 2.6))}`).join('');
  return line(legs + tail, LEG, 0.9) + line(antennae, LEG, 0.9) + body.map((part) => segment(part, 1.1, 1.75)).join('') + segment(head, 1.4, 1.9);
}

/** Minhoca: o corpo é um traço grosso (contorno na união com a cabeça). */
const WORM_BODY = 'M8.6 21.4c-.6-3.4.6-5.8 3-7.4s3.4-3.8 2.6-6.6';

export const CatalogIcons: Record<CatalogShape, string> = {
  dung: filled(
    `<path d="M3.5 18.2c0-1.7 1.7-2.9 3.8-3.1-.4-1.9 1.1-3.4 3.3-3.5-.3-1.9 1-3.6 3.4-4.3-.3 1.4.6 2.6 1.9 3 .2 1.7-.8 2.9-2 3.3 2.2.3 3.6 1.6 3.3 3.4 1.5.4 2.6 1.4 2.6 2.7 0 1.6-3.4 2.3-8.1 2.3s-8.2-.7-8.2-2.3z" fill="currentColor"/>` +
      `<path d="M8 15.3c2.1.8 5.1.8 7.4-.1M10.2 11.8c1.4.5 3.2.5 4.5-.2" fill="none" stroke="rgba(255,240,210,0.6)" stroke-width="1.2"/>`,
  ),
  daisy: filled(`${petals(10, 2, 4.2, 5.4, 'currentColor')}<circle cx="12" cy="12" r="3.1" fill="#f2c230"/>`),
  tulip: filled(
    `<path d="M12 14v8" stroke="${STEM}" stroke-width="1.8"/>` +
      `<path d="M6.2 6.5c0 5.2 2.2 8.5 5.8 8.5s5.8-3.3 5.8-8.5l-2.9 2.4L12 4.2 9.1 8.9z" fill="currentColor"/>`,
  ),
  bell: filled(
    `<path d="M12 2.5v3" stroke="${STEM}" stroke-width="1.8"/>` +
      `<path d="M7.6 10c0-2.6 2-4.6 4.4-4.6s4.4 2 4.4 4.6c0 3.4 1.1 5.8 3 7.6.4.4.1 1-.4 1H5c-.5 0-.8-.6-.4-1 1.9-1.8 3-4.2 3-7.6z" fill="currentColor"/>` +
      `<circle cx="12" cy="20.3" r="1.4" fill="#f2c230"/>`,
  ),
  dandelion: filled(`${petals(14, 1.3, 3.6, 5.6, 'currentColor')}${petals(8, 1.2, 2.4, 2.8, '#f7d765')}<circle cx="12" cy="12" r="1.8" fill="#e9a91c"/>`),
  cloverFlower: filled(
    `<circle cx="12" cy="11" r="6.8" fill="currentColor"/>` +
      `<g fill="rgba(255,255,255,0.45)" stroke="none"><circle cx="9.3" cy="8.8" r="1.2"/><circle cx="12.6" cy="7.4" r="1"/><circle cx="14.8" cy="10.2" r="1.1"/><circle cx="10.6" cy="12.4" r="1"/><circle cx="13.8" cy="13.6" r=".9"/></g>` +
      `<path d="M7.5 17.5c1.6 1.2 3 1.8 4.5 1.8s2.9-.6 4.5-1.8" fill="none" stroke="${STEM}" stroke-width="1.8"/>`,
  ),
  mushroomDots: filled(mushroomCap(true)),
  mushroom: filled(mushroomCap(false)),
  rock: filled(
    `<path d="M3.5 17.5 5.6 9.8 10.4 5.5l6.2 1.3 3.9 5.4-1 6.3-6.6 2.2-7.4-.4z" fill="currentColor"/>` +
      `<path d="M10.4 5.5 11.8 11l4.8 1M11.8 11l-5.4 2" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.1"/>`,
  ),
  log: filled(
    `<path d="M5 7.5h12.5a3.5 4.5 0 0 1 0 9H5z" fill="currentColor"/>` +
      `<ellipse cx="5" cy="12" rx="3.5" ry="4.5" fill="#e3b98a"/>` +
      `<ellipse cx="5" cy="12" rx="1.7" ry="2.3" fill="none" stroke="#b07a4c" stroke-width="1"/>` +
      `<path d="M10 9.5h5M12 14.5h4" fill="none" stroke="rgba(58,42,34,0.35)" stroke-width="1.1"/>`,
  ),
  pinecone: filled(
    line('M12 4.6V2.4', BARK, 1.6) +
      `<path d="M12 4.4c3.6 0 6.3 2.6 6.3 6.4 0 4.6-3.2 8.6-6.3 10.6-3.1-2-6.3-6-6.3-10.6 0-3.8 2.7-6.4 6.3-6.4z" fill="currentColor"/>` +
      line(PINE_SCALES, 'rgba(58,42,34,0.42)', 1.05) +
      shine(8.6, 8.4, 0.9, 1.8, 30, 0.35),
  ),
  apple: filled(
    line('M12 7.4c-.1-1.6.3-3 1.1-4.1', BARK, 1.5) +
      `<path d="M12 7.4c-1.3-1-2.8-1.4-4.3-1.1C5 6.8 3.6 9.3 4 12.6c.5 4.3 3.3 8.2 5.9 8.2.9 0 1.4-.5 2.1-.5s1.2.5 2.1.5c2.6 0 5.4-3.9 5.9-8.2.4-3.3-1-5.8-3.7-6.3-1.5-.3-3 .1-4.3 1.1z" fill="currentColor"/>` +
      smallLeaf(12.9, 4.6, -18) +
      shine(7.6, 10.6, 1.2, 2.1, 22, 0.45),
  ),
  pebble: filled(`<path d="M4 14.2c0-3.6 3.4-6.4 7.8-6.4 4.6 0 8.2 2.5 8.2 5.7 0 3.3-3.4 5.3-8 5.3S4 17.3 4 14.2z" fill="currentColor"/><ellipse cx="9.2" cy="11.6" rx="2.2" ry="1.1" fill="rgba(255,255,255,0.45)" stroke="none"/>`),
  twig: filled(
    `<path d="M4 19.5 18.8 5" fill="none" stroke="currentColor" stroke-width="2.6"/>` +
      `<path d="M10.5 13.2c.2-2.6 1.4-4.3 3.6-5.2" fill="none" stroke="currentColor" stroke-width="1.8"/>` +
      `<circle cx="14.3" cy="7.9" r="1.3" fill="#9fcf6a"/>`,
  ),
  leaf: filled(
    `<path d="M4.5 19.5C4.5 10.5 10 4.5 20 4.5c0 9.5-5.8 15-15.5 15z" fill="currentColor"/>` +
      `<path d="M5.5 18.5 15.5 8.5M9.2 14.9l-.6-3.6M12.4 11.7l3.1.3" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.1"/>`,
  ),
  berry: filled(
    `<circle cx="12" cy="13.5" r="6.5" fill="currentColor"/>` +
      `<path d="M12 7.2 9.4 5.4M12 7.2l2.8-1.6M12 7.2V4" fill="none" stroke="#3f6b2f" stroke-width="1.6"/>` +
      `<circle cx="9.6" cy="11.3" r="1.5" fill="rgba(255,255,255,0.5)" stroke="none"/>`,
  ),
  seed: filled(
    `<path d="M12 3.5c3.3 3 5 6.7 5 10.4 0 3.8-2.2 6.6-5 6.6s-5-2.8-5-6.6c0-3.7 1.7-7.4 5-10.4z" fill="currentColor"/>` +
      `<path d="M9.3 9.5c.3 3.5.3 6.7 0 9.2M12 5.5v14.8M14.7 9.5c-.3 3.5-.3 6.7 0 9.2" fill="none" stroke="#f1e6cf" stroke-width="1"/>`,
  ),
  acorn: filled(
    `<path d="M7 11.5h10c0 5.2-2.3 9-5 9s-5-3.8-5-9z" fill="currentColor"/>` +
      `<path d="M5.3 11.5c0-3.2 3-5.5 6.7-5.5s6.7 2.3 6.7 5.5z" fill="#7a5533"/>` +
      `<path d="M12 6V3.4" fill="none" stroke="${BARK}" stroke-width="1.6"/>`,
  ),
  clover: filled(
    `<path d="M12 12.5V21" fill="none" stroke="${STEM}" stroke-width="1.7"/>` +
      `<g fill="currentColor"><path d="M12 12c-3.2-.1-5.7-1.7-5.7-4.2a2.6 2.6 0 0 1 5.2-.4 2.6 2.6 0 0 1 .5 4.6z"/><path d="M12 12c3.2-.1 5.7-1.7 5.7-4.2a2.6 2.6 0 0 0-5.2-.4 2.6 2.6 0 0 0-.5 4.6z"/><path d="M12 12c-1.8 2.6-1.7 5.6.4 6.9a2.6 2.6 0 0 0 2.9-4.3A2.6 2.6 0 0 0 12 12z"/></g>`,
  ),
  fourLeaf: filled(line('M12.6 12.8c.9 3 2.5 5.6 4.8 7.8', '#3f7f35', 1.7) + [0, 90, 180, 270].map(heartLeaf).join('')),
  petal: filled(
    `<path d="M12 21c-4.2-2.6-6.5-6.4-6.5-10.2C5.5 6.6 8.4 3.5 12 3.5s6.5 3.1 6.5 7.3C18.5 14.6 16.2 18.4 12 21z" fill="currentColor"/>` +
      `<path d="M12 19V8" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.1"/>`,
  ),
  shell: filled(`<circle cx="12" cy="12.5" r="8" fill="currentColor"/>` + line(spiral(12, 12.5, 1.6, 4), 'rgba(90,55,29,0.6)', 1.2)),
  cicadaShell: filled(
    mirrored(wire('M8.8 10.4c-2.2-.3-3.9.7-4.7 2.6l1.9.5M8.9 13.2l-3.6 1.6-.4 2.3M9.5 15.6l-2.7 3.3.4 2', 1.1)) +
      `<path d="M8.4 13.2c0 4.4 1.6 7.8 3.6 7.8s3.6-3.4 3.6-7.8z" fill="currentColor"/>` +
      `<path d="M7 12.4C7 8.9 9.2 6.6 12 6.6s5 2.3 5 5.8c0 .9-.7 1.4-1.6 1.4H8.6c-.9 0-1.6-.5-1.6-1.4z" fill="currentColor"/>` +
      `<ellipse cx="12" cy="6.3" rx="3.7" ry="2.3" fill="currentColor"/>` +
      mirrored(`<circle cx="8.6" cy="5.9" r="1.5" fill="currentColor"/>` + dots([[8.6, 5.9]], 0.8, 'rgba(58,42,34,0.4)')) +
      line('M8.9 15.6c2 .6 4.2.6 6.2 0M9.4 17.9c1.7.5 3.5.5 5.2 0M10.3 20c1.1.3 2.3.3 3.4 0') +
      line('M12 7.2v5.4', 'rgba(58,42,34,0.6)', 1.5) +
      shine(9.4, 9.8, 0.8, 1.7, 25, 0.45),
  ),
  web: filled(webMarkup()),
  cap: filled(`<path d="${starPath(8, 8.6, 7.6)}" fill="currentColor"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="1.3"/>`),
  button: filled(
    `<circle cx="12" cy="12" r="8.6" fill="currentColor"/>` +
      `<circle cx="12" cy="12" r="6.1" fill="none" stroke="rgba(58,42,34,0.28)" stroke-width="1.2"/>` +
      dots([[10.4, 10.4], [13.6, 10.4], [10.4, 13.6], [13.6, 13.6]], 1.15, 'rgba(58,42,34,0.62)') +
      line('M10.4 10.4l3.2 3.2M13.6 10.4l-3.2 3.2', '#fbf4e6', 1.1) +
      line('M5.9 9.4a6.6 6.6 0 0 1 3.1-3.3', 'rgba(255,255,255,0.55)', 1.4),
  ),
  marble: filled(
    `<circle cx="12" cy="12" r="8.4" fill="currentColor"/>` +
      // O "olho de gato": uma lâmina torcida por dentro do vidro.
      line('M12.8 5c-3.4 3.6 2.4 7.2-1.6 14', '#f7c948', 2.3) +
      line('M8.4 6.8c-.8 3.2 2.2 5.2 1.4 9', 'rgba(255,255,255,0.6)', 1.1) +
      shine(8.6, 8.2, 2.2, 1.3, -38, 0.75) +
      dots([[15.8, 16]], 0.8, 'rgba(255,255,255,0.45)'),
  ),
  coin: filled(
    `<circle cx="12" cy="12" r="8.8" fill="currentColor"/>` +
      line('M12 4.6a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 1 1 0-14.8', 'rgba(255,255,255,0.55)', 0.9).replace('/>', ' stroke-dasharray=".1 1.75"/>') +
      `<circle cx="12" cy="12" r="5.2" fill="#d3d8df"/>` +
      line('M10.8 10.4 12.5 9v6.2', 'rgba(70,74,88,0.55)', 1.3) +
      shine(10, 9.4, 1.3, 0.7, -35, 0.6) +
      line('M5.4 9.2a7.2 7.2 0 0 1 3.2-3.6', 'rgba(255,255,255,0.6)', 1.3),
  ),
  clip: filled(`<g transform="rotate(35 12 12)">${wire('M10.3 8.5v7.3a1.7 1.7 0 0 0 3.4 0V6.2a2.5 2.5 0 0 0-5 0v11.4a3.4 3.4 0 0 0 6.8 0V9', 1.8)}</g>`),
  brick: filled(
    (() => {
      const box = isoBox(6.4, 8, 4.1, 6.8);
      const studs = ([[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const).map(([u, v]) => stud(box.at('top', u, v))).join('');
      return box.markup + studs;
    })(),
  ),
  die: filled(
    (() => {
      const box = isoBox(4, 7.6, 3.9, 8.2);
      const pip = (face: 'left' | 'right', spots: readonly Point[]) => dots(spots.map(([u, v]) => box.at(face, u, v)), 0.95, EYE);
      const [cx, cy] = box.at('top', 0.5, 0.5);
      return (
        box.markup +
        `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="1.5" ry=".78" fill="#d9443c" stroke="none"/>` +
        pip('left', [[0.28, 0.28], [0.72, 0.72]]) +
        pip('right', [[0.25, 0.75], [0.5, 0.5], [0.75, 0.25]])
      );
    })(),
  ),
  soldier: filled(
    merged(
      `<path d="M9.2 6.4c0-2.1 1.3-3.6 3-3.6s3 1.5 3 3.6z" fill="currentColor"/>` +
        `<rect x="8.5" y="5.9" width="7.4" height="1.2" rx=".6" fill="currentColor"/>` +
        `<circle cx="12.2" cy="7.9" r="1.8" fill="currentColor"/>` +
        `<path d="M9.7 9.6h5l.5 5.2H9.2z" fill="currentColor"/>` +
        `<path d="M9.3 14.4h2.5l-.7 5.8H8.5zM12.6 14.4h2.5l1 5.8h-2.4z" fill="currentColor"/>` +
        `<rect x="4.8" y="10.7" width="14" height="1.5" rx=".75" fill="currentColor" transform="rotate(-32 12 11.4)"/>` +
        `<rect x="9.4" y="10.2" width="5.4" height="1.9" rx=".95" fill="currentColor" transform="rotate(26 12 11)"/>`,
    ) +
      `<rect x="5.4" y="19.9" width="13.2" height="2" rx="1" fill="currentColor"/>` +
      line('M9 6.5h6.4M9.5 14.6h5.6') +
      shine(10.9, 4.7, 0.9, 0.5, -25, 0.45),
  ),
  toyCar: filled(
    `<path d="M3.8 17h16.4c.6 0 1-.4 1-1v-2.6c0-.9-.6-1.6-1.5-1.8l-2.6-.6-2.1-3.3c-.4-.6-1-.9-1.7-.9h-3.8c-.7 0-1.3.3-1.7.9l-2 3.3-2 .4c-.6.1-1 .6-1 1.2V16c0 .6.4 1 1 1z" fill="currentColor"/>` +
      `<path d="M7.4 10.8 9 8.2h2.4v2.6zM12.6 8.2h1.8l1.6 2.6h-3.4z" fill="#c4e6f6"/>` +
      line('M3.4 13.9h17.4', 'rgba(255,255,255,0.6)', 1.2) +
      dots([[20.3, 12.6]], 0.65, '#fff3b0') +
      [7.4, 16.8].map((x) => `<circle cx="${x}" cy="17" r="2.5" fill="#3a2e38"/>` + dots([[x, 17]], 0.95, '#d7dde3')).join(''),
  ),
  duck: filled(
    merged(
      `<path d="M5 13.6c-.6 3.9 2.6 6.9 7.4 6.9 4.9 0 8.1-2.7 8.1-6.6 0-1.7-.5-3.1-1.3-4.3-.8 1.9-2.1 2.8-4 2.8-2.2 0-3.5-.8-5.3-.8-2 0-4.2.6-4.9 2z" fill="currentColor"/>` +
        `<circle cx="9.2" cy="8.3" r="3.9" fill="currentColor"/>`,
    ) +
      `<path d="M6 8.2c-1.5-.5-3-.3-4 .6 1 1 2.6 1.4 4.1.9z" fill="#f08a24"/>` +
      `<path d="M11.4 14.2c.9 2.2 3.3 3.1 5.9 2.3-.7-1.8-2.9-2.9-5.9-2.3z" fill="rgba(222,140,20,0.35)" stroke="${CREASE}" stroke-width="1"/>` +
      beadEye(8.3, 7.4, 0.85) +
      cheeks(10.4, 9.7, 0) +
      shine(10.8, 6.1, 1.1, 0.6, -30, 0.55),
  ),
  tennisBall: filled(
    `<circle cx="12" cy="12" r="8.4" fill="currentColor"/>` +
      line('M6.1 6.1c2.8 3.2 2.8 8.6 0 11.8M17.9 6.1c-2.8 3.2-2.8 8.6 0 11.8', '#fbfaf0', 1.5) +
      shine(9.4, 7.6, 1.4, 0.8, -35, 0.45),
  ),
  pot: filled(
    line('M12 6.4V3.6', STEM, 1.4) +
      smallLeaf(12, 4.4, -30, 0.7) +
      smallLeaf(12, 4.9, 210, 0.6) +
      `<path d="M5.8 9.8h12.4l-1.5 9.8c-.1.8-.8 1.4-1.6 1.4H8.9c-.8 0-1.5-.6-1.6-1.4z" fill="currentColor"/>` +
      `<rect x="4.2" y="6.2" width="15.6" height="3.8" rx="1.2" fill="currentColor"/>` +
      line('M6.3 10.6h11.4', 'rgba(58,42,34,0.28)', 1.3) +
      line('M8.1 12.4l.8 6.4M5.6 7.6h3', 'rgba(255,255,255,0.4)', 1.2),
  ),
  trowel: filled(
    `<g transform="rotate(40 12 12)">` +
      `<rect x="10.2" y="1.8" width="3.6" height="7.6" rx="1.8" fill="#b8763e"/>` +
      dots([[12, 3.6]], 0.6, 'rgba(58,42,34,0.5)') +
      `<rect x="11.2" y="9.2" width="1.6" height="2.4" fill="currentColor"/>` +
      `<path d="M12 11.2c3.4 0 5.7 1.3 5.7 3.8 0 2.9-2.6 5.6-5.7 7.2-3.1-1.6-5.7-4.3-5.7-7.2 0-2.5 2.3-3.8 5.7-3.8z" fill="currentColor"/>` +
      line('M12 12.8v7.4', 'rgba(255,255,255,0.5)', 1.1) +
      shine(8.9, 14.6, 0.7, 1.7, 20, 0.4) +
      `</g>`,
  ),
  glove: filled(
    merged(
      `<rect x="7.4" y="5.6" width="2.4" height="7.4" rx="1.2" fill="currentColor"/>` +
        `<rect x="10.5" y="4.2" width="2.4" height="8.8" rx="1.2" fill="currentColor"/>` +
        `<rect x="13.6" y="5" width="2.4" height="8" rx="1.2" fill="currentColor"/>` +
        `<rect x="16.7" y="7" width="2.4" height="6" rx="1.2" fill="currentColor"/>` +
        `<rect x="3" y="9.8" width="3" height="7.8" rx="1.5" fill="currentColor" transform="rotate(-35 4.5 13.7)"/>` +
        `<path d="M7 11.4h12.4v5.2c0 1.7-1 2.6-2.4 2.6H9.4c-1.4 0-2.4-.9-2.4-2.6z" fill="currentColor"/>`,
    ) +
      `<rect x="7.2" y="18.2" width="12" height="3.6" rx="1.1" fill="${CREAM}"/>` +
      line('M10 18.8v2.4M13.2 18.8v2.4M16.4 18.8v2.4', 'rgba(58,42,34,0.22)', 1) +
      line('M8.3 14.8c1.6 1 3.4 1.1 5.2.4', CREASE, 1) +
      shine(11.2, 6.6, 0.45, 1.3, 0, 0.5),
  ),
  flipflop: filled(
    `<g transform="rotate(20 12 12)">` +
      `<path d="M12 2.6c3.1 0 5.1 2.4 5.1 5.7 0 2.7-1.1 4.2-1.3 6.4-.2 2.4.9 3.4.9 5.2 0 1.7-2 2.6-4.6 2.6s-4.4-.9-4.4-2.7c0-1.9 1.1-2.9.9-5.3-.2-2.1-1.6-3.4-1.6-6.1C7 5 8.9 2.6 12 2.6z" fill="currentColor"/>` +
      shine(10, 7.4, 1, 2.2, 10, 0.3) +
      wire('M12 6.6c-1.6 1.6-3.1 3.6-3.8 6.4M12 6.6c1.6 1.6 3.1 3.6 3.8 6.4', 1.6, '#f2c230') +
      `<circle cx="12" cy="6.6" r="1.15" fill="#f2c230"/>` +
      `</g>`,
  ),
  gnome: filled(
    `<path d="M7.4 15.6h9.2l1.5 5.4c.2.7-.3 1.4-1 1.4H6.9c-.7 0-1.2-.7-1-1.4z" fill="#3f6fb5"/>` +
      `<circle cx="12" cy="12.6" r="3" fill="#f4c7a1"/>` +
      `<path d="M7.6 13c0 4.4 2 7.4 4.4 7.4s4.4-3 4.4-7.4c-1.2.9-2.6 1.4-4.4 1.4S8.8 13.9 7.6 13z" fill="#f7f3ea"/>` +
      `<path d="M17 1.8c-3.6.4-7.4 3.8-10.2 8.6-.3.5.1 1.1.7 1.1h9.2c.6 0 1-.5.9-1.1-.6-2.9-1.1-5.6-.6-8.6z" fill="currentColor"/>` +
      shine(11.4, 7.4, 0.8, 1.9, 40, 0.35) +
      dots([[10.4, 12.4], [13.6, 12.4]], 0.5, EYE) +
      `<circle cx="12" cy="13.6" r="1.2" fill="#f0a08a"/>`,
  ),
  jellybean: filled(
    `<g transform="rotate(-28 12 12)">` +
      `<path d="M7.6 8.4c1.8 0 2.8 1 4.4 1s2.6-1 4.4-1c2 0 3.6 1.6 3.6 3.6s-1.6 3.6-3.6 3.6H7.6C5.6 15.6 4 14 4 12s1.6-3.6 3.6-3.6z" fill="currentColor"/>` +
      line('M6.6 10.6c.9-.6 1.9-.7 2.8-.3', 'rgba(255,255,255,0.75)', 1.3) +
      `</g>`,
  ),
  sugarCube: filled(
    (() => {
      const box = isoBox(5.2, 7, 3.6, 7.2);
      const grains = (face: BoxFace, spots: readonly Point[]) => dots(spots.map(([u, v]) => box.at(face, u, v)), 0.42, 'rgba(58,42,34,0.2)');
      return (
        box.markup +
        grains('top', [[0.3, 0.3], [0.7, 0.4], [0.45, 0.7], [0.2, 0.75]]) +
        grains('left', [[0.25, 0.3], [0.6, 0.5], [0.3, 0.75], [0.8, 0.2]]) +
        grains('right', [[0.3, 0.35], [0.7, 0.6], [0.45, 0.8], [0.8, 0.25]]) +
        `<rect x="3.6" y="19.6" width="1.4" height="1.4" rx=".3" fill="currentColor" transform="rotate(20 4.3 20.3)"/>` +
        `<rect x="19.2" y="19.2" width="1.1" height="1.1" rx=".25" fill="currentColor" transform="rotate(-15 19.75 19.75)"/>`
      );
    })(),
  ),
  popcorn: filled(
    merged(
      [
        [8.6, 11.4, 3.4],
        [13.8, 9.6, 3.8],
        [17, 14, 3.2],
        [12, 15.2, 4],
        [7.4, 15.8, 3],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`)
        .join(''),
    ) +
      // Vincos na borda dos gomos da frente (solto no meio, parecia uma carinha).
      line('M8.24 13.83A4 4 0 0 1 10.63 11.44M14.23 15.6A3.2 3.2 0 0 1 13.99 12.91', CREASE, 1) +
      `<path d="M15 17.6c.9 1.1 2.6 1.2 3.8.1-1-.6-2.6-.7-3.8-.1z" fill="#c47a2c"/>` +
      shine(12.8, 7.6, 1.5, 0.8, -20, 0.6),
  ),
  grape: filled(
    line('M12 6.4c0-1.4.4-2.6 1.2-3.6', BARK, 1.5) +
      smallLeaf(12.8, 4.2, -15, 0.85) +
      (
        [
          [7.2, 9],
          [12, 9],
          [16.8, 9],
          [9.6, 13.2],
          [14.4, 13.2],
          [12, 17.4],
        ] as const
      )
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="currentColor"/>` + dots([[x - 0.9, y - 0.9]], 0.75, 'rgba(255,255,255,0.5)'))
        .join(''),
  ),
  strawberry: filled(
    `<path d="M12 21.2c-3.9-2.3-7.2-6.2-7.2-10.1 0-2.5 2-4 4.3-4 1.1 0 2 .4 2.9.4s1.8-.4 2.9-.4c2.3 0 4.3 1.5 4.3 4 0 3.9-3.3 7.8-7.2 10.1z" fill="currentColor"/>` +
      (
        [
          [7.8, 11],
          [10.6, 10.4],
          [13.4, 10.4],
          [16.2, 11],
          [9.2, 13.8],
          [12, 13.4],
          [14.8, 13.8],
          [10.6, 16.6],
          [13.4, 16.6],
          [12, 19],
        ] as const
      )
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx=".42" ry=".7" fill="#fbe38a" stroke="none"/>`)
        .join('') +
      `<path d="${starPath(5, 4.6, 1.5, 12, 7.4, -Math.PI / 2)}" fill="#5aa53a" transform="translate(0 7.4) scale(1 .62) translate(0 -7.4)"/>` +
      line('M12 7.2c0-1.4.3-2.6 1-3.6', STEM, 1.5) +
      shine(8.4, 12.2, 0.8, 1.6, 25, 0.4),
  ),
  cookie: filled(
    disc(13.6, 8.4, 3.9, 3, 'currentColor', false) +
      disc(12.5, 8.3, 3.8, 1.7, CREAM, false) +
      disc(9.8, 8.4, 3.9, 2.8, 'currentColor', true) +
      `<ellipse cx="12" cy="9.8" rx="6" ry="2.6" fill="none" stroke="rgba(58,42,34,0.28)" stroke-width="1" stroke-dasharray="1.2 1.1"/>` +
      dots([[12, 9.8]], 0.7, 'rgba(58,42,34,0.28)') +
      shine(8, 8.4, 1.6, 0.6, -12, 0.35),
  ),
  pillbug: filled(
    `<path d="M3.5 14.5c0-4.2 3.8-7.5 8.5-7.5s8.5 3.3 8.5 7.5c0 1.2-.9 2-2 2H5.5c-1.1 0-2-.8-2-2z" fill="currentColor"/>` +
      `<path d="M8 7.9v8.6M12 7v9.5M16 7.9v8.6" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.1"/>` +
      `<path d="M4.5 12.5 2.4 10.4M5.3 11 4 8.3" fill="none" stroke="${INK}" stroke-width="1.2"/>`,
  ),
  earwig: filled(
    `<g transform="rotate(32 12 12)">` +
      mirrored(line('M10.3 8.2 7.6 6.8M10.2 10 7 10.4M10.4 11.6 8 13.8', LEG, 1.2) + line('M11.2 4.2C10.4 2.6 9 1.8 7.4 1.8', LEG, 1) + wire('M11.3 19.2c-1.6.8-2.2 2.6-.9 3.9', 1.2, '#6b3a22')) +
      `<ellipse cx="12" cy="5.4" rx="1.9" ry="1.7" fill="currentColor"/>` +
      `<path d="M9.8 12.6h4.4l-.4 5.8c-.1.8-.8 1.3-1.8 1.3s-1.7-.5-1.8-1.3z" fill="currentColor"/>` +
      `<rect x="9.8" y="6.8" width="4.4" height="2.9" rx="1.2" fill="currentColor"/>` +
      `<rect x="9.4" y="9.4" width="5.2" height="3.6" rx="1.1" fill="currentColor"/>` +
      `<rect x="9.4" y="9.4" width="5.2" height="3.6" rx="1.1" fill="rgba(255,255,255,0.2)" stroke="none"/>` +
      line('M12 9.6v3.2M10.1 14.8h3.8M10.3 16.8h3.4') +
      `</g>`,
  ),
  centipede: filled(centipedeMarkup()),
  stickInsect: filled(
    wire('M15.9 8.1 13.9 4.6l1-2.4M15.9 8.1l3.5 2 2.4-.9M14.1 9.9l-3.7-2.3-1-2.8M14.1 9.9l2.3 3.7 3.2 1M12.6 11.4l-4.4-.6-2.6-2.4M12.6 11.4l.4 4.6-1.4 3.2', 0.85, 'currentColor', 1) +
      line('M18.1 5.9l3.2-3.8M18.6 6.5l3.6-2.4', LEG, 0.9) +
      wire('M5 19 17.6 6.4', 2.2) +
      `<ellipse cx="18" cy="6" rx="1.5" ry="1.1" fill="currentColor" transform="rotate(-45 18 6)"/>`,
  ),
  caterpillar: filled(
    dots(
      [
        [4.6, 18.6],
        [7.6, 19.2],
        [10.8, 18.8],
        [13.8, 17.4],
      ],
      0.75,
      LEG,
    ) +
      (
        [
          [4.6, 16.4, 2.3],
          [7.6, 16.8, 2.5],
          [10.8, 16.2, 2.6],
          [13.8, 14.8, 2.7],
        ] as const
      )
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>` + dots([[x - 0.5, y - 1]], 0.7, 'rgba(255,255,255,0.4)'))
        .join('') +
      mirrored(line('M16.2 8.4 15.2 6', LEG, 1) + dots([[15.2, 5.9]], 0.75, LEG), 17.4) +
      `<circle cx="17.4" cy="11.6" r="3.6" fill="currentColor"/>` +
      face(17.5, 11.2, 1.45, 0.8),
  ),
  slug: filled(
    line('M1.8 21.2h9.6', 'rgba(150,200,228,0.8)', 1.3) +
      wire('M19.2 11 17.8 6.6M20.6 10.8l.9-4.4', 1.1) +
      dots([[17.8, 6.5], [21.5, 6.3]], 0.95, 'currentColor') +
      `<path d="M2.6 19.4c1.8-.2 3.4-1.4 5.6-2.6 2.4-1.3 5.2-1.7 7.6-1.9.5-2.3 1.7-4.5 3.6-4.5 1.8 0 2.6 1.8 2.4 4.1-.2 2.8-1.6 5.3-4.6 5.5l-13.8.2c-.9 0-1.4-.7-.8-.8z" fill="currentColor"/>` +
      `<ellipse cx="13.6" cy="16.9" rx="3.4" ry="1.5" fill="rgba(58,42,34,0.12)"/>` +
      dots([[17.9, 6.4], [21.6, 6.2]], 0.4, EYE) +
      shine(18.6, 12.2, 0.6, 1.3, 20, 0.45),
  ),
  flyingAnt: filled(
    `<g transform="rotate(-12 12 12)">` +
      mirrored(line('M10.8 8.8 8.2 7.2 7.4 5M10.6 10.2 7.4 11.2 6 13.6M11 11.4 9 14.8l.2 2.6', LEG, 1.1) + line('M11.1 3.6 10.3 1.9 8.1 1.5', LEG, 1)) +
      mirrored(`<ellipse cx="8.2" cy="14.2" rx="2.3" ry="6" fill="${WING}" transform="rotate(28 8.2 14.2)"/>` + line('M10.4 9.6 6.6 17.6', 'rgba(58,42,34,0.25)', 0.8)) +
      `<ellipse cx="12" cy="16.6" rx="2.9" ry="3.8" fill="currentColor"/>` +
      `<circle cx="12" cy="12.3" r=".9" fill="currentColor"/>` +
      `<ellipse cx="12" cy="9.4" rx="1.7" ry="2.3" fill="currentColor"/>` +
      `<circle cx="12" cy="5.2" r="2.2" fill="currentColor"/>` +
      shine(11, 15.4, 0.8, 1.6, 10, 0.35) +
      `</g>`,
  ),
  leafBeetle: filled(beetleFigure({ shell: 'currentColor', pronotum: 'currentColor', head: '#b5452b', legs: LEG, spots: '#f4d23a' })),
};

export const PerkIcons: Record<PerkId, string> = {
  sticky: stroke('<circle cx="12" cy="13" r="5"/><path d="M4.5 8.5a9 9 0 0 1 3-3.4M19.5 8.5a9 9 0 0 0-3-3.4M3 14a9 9 0 0 0 1.4 4.3M21 14a9 9 0 0 1-1.4 4.3"/>'),
  hotBlood: stroke('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.3 3.7-8.3.9 1.7 1.8 2.6 3 3.2.2-2.8 1.4-5 3.2-6.7.2 3.7 3.1 6 3.1 10.4 0 4.2-2.8 7.6-6.5 7.6z"/><path d="M12 21c-1.7 0-2.8-1.1-2.8-2.8 0-1.9 1.6-2.8 2.4-4.6 1.6 1.4 3.2 2.5 3.2 4.6 0 1.7-1.1 2.8-2.8 2.8z"/>'),
  mudShell: stroke('<path d="M12 3.2 19.5 6v5.7c0 4.6-3.2 8-7.5 9.3-4.3-1.3-7.5-4.7-7.5-9.3V6z"/><path d="M12 8.2c1.9 2.3 2.9 3.9 2.9 5.2a2.9 2.9 0 0 1-5.8 0c0-1.3 1-2.9 2.9-5.2z"/>'),
  nose: stroke('<path d="M4 20.5h16"/><path d="M7 20.5c0-2.6 2.2-4.2 5-4.2s5 1.6 5 4.2"/><path d="M8.5 12.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/><path d="M12 11.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/><path d="M15.5 12.5c-1-1.1-1-2.2 0-3.3s1-2.2 0-3.3"/>'),
  // Besourinho de lado (cúpula cheia) em pé na bola vazada, uma pata no ar pra se equilibrar.
  // Com os dois só no traço (ou de frente), virava boneco de neve.
  rider: stroke('<path d="M3.5 21.6h17"/><circle cx="12" cy="16" r="5.4"/><path d="M7.4 7.6c0-2.4 2-4.2 4.6-4.2s4.6 1.8 4.6 4.2z" fill="currentColor" stroke-width="1.4"/><circle cx="17.7" cy="6.4" r="1.3" fill="currentColor" stroke-width="1.2"/><path d="M9.6 7.8 9 11.2M14.4 7.8l.6 3.4M7.6 7.2 4.8 5.6M18.6 5.4l1.4-1.4"/>'),
  sneaky: stroke('<circle cx="16.5" cy="13.5" r="4.5"/><path d="M3 10h6M2 14h5M4 18h6"/>'),
  horned: stroke('<path d="M4 20c1.2-5.5 4.3-9 8.4-10.6C15.3 8.3 17.4 6.4 18.5 3c1.8 3.9 1.6 8.4-.8 11.5-2 2.6-5.3 3.8-8.7 3.3"/><path d="M8 20h12"/>'),
  downhill: stroke('<path d="M2.5 9 21.5 21"/><circle cx="16" cy="13" r="3.8"/><path d="M5.6 6.4l4 2.5M7.8 3.6l3.4 2.1"/>'),
  // Estrela de impacto cheia: vazada, no tamanho do HUD, parecia engrenagem.
  bump: stroke(`<circle cx="9.4" cy="14" r="4.8"/><path d="${starPath(7, 5.2, 2.5, 18, 9.6, -Math.PI / 2)}" fill="currentColor" stroke-width="1.2"/><path d="M1.6 11h1.6M1.2 14h2M1.6 17h1.6"/>`),
  curious: stroke('<circle cx="10" cy="10" r="6.2"/><path d="M14.6 14.6 20.2 20.2" stroke-width="3"/><path d="M10 6.8c.3 1.7.9 2.3 2.6 2.6-1.7.3-2.3.9-2.6 2.6-.3-1.7-.9-2.3-2.6-2.6 1.7-.3 2.3-.9 2.6-2.6z" fill="currentColor" stroke-width="1.2"/>'),
  // Folha pontuda em diagonal, presa na boca: reta e em cima de um cabinho, parecia cogumelo.
  antFriend: stroke('<path d="M15.4 11.4c-1-4.2 1.4-7.6 6.2-8.6.8 4.8-1.6 8.2-6.2 8.6zM15.4 11.4l4.4-6.4"/><circle cx="6.2" cy="15.4" r="2.8"/><circle cx="10.6" cy="14.8" r="1.6"/><circle cx="15" cy="13.6" r="2.2"/><path d="M9.4 16.2 8.2 19.6M10.6 16.4v3.2M11.8 16.2l1.4 3.4"/>', 2),
  stench: stroke('<path d="M7 20.5c-1.4-1.6-1.4-3.2 0-4.8s1.4-3.2 0-4.8"/><path d="M12 21c-1.4-1.6-1.4-3.2 0-4.8s1.4-3.2 0-4.8"/><path d="M17 20.5c-1.4-1.6-1.4-3.2 0-4.8s1.4-3.2 0-4.8"/><path d="M12 8.6c-2.4-1.5-3.8-2.9-3.8-4.4 0-1.1.9-1.9 1.9-1.9.8 0 1.5.5 1.9 1.1.4-.6 1.1-1.1 1.9-1.1 1 0 1.9.8 1.9 1.9 0 1.5-1.4 2.9-3.8 4.4z" fill="currentColor"/>'),
  rainCall: stroke('<path d="M7.2 15h9.6a3.7 3.7 0 0 0 .5-7.2 5.2 5.2 0 0 0-10-.6A3.9 3.9 0 0 0 7.2 15z"/><path d="M8.6 18.2l-1 2.6M12.6 18.2l-1 2.6M16.6 18.2l-1 2.6"/>'),
};

/**
 * Quem faz os pedidos da rodada: figurinhas multicor com a mesma carinha
 * (olhinho de conta, bochecha rosada), pra parecerem uma turma só.
 */
export const GiverIcons: Record<GiverId, string> = {
  bee: filled(
    mirrored(`<ellipse cx="7.4" cy="6.4" rx="2.5" ry="3.7" fill="${WING}" transform="rotate(-38 7.4 6.4)"/>` + line('M10.3 7.4c-.3-1.8-1.1-3-2.3-3.6', LEG, 1.1) + dots([[7.9, 3.6]], 0.95, LEG)) +
      `<circle cx="12" cy="13.4" r="7.2" fill="#f6c93b"/>` +
      `<path d="${circleBand(12, 13.4, 7.2, 15.4, 17)}${circleBand(12, 13.4, 7.2, 18.4, 19.9)}" fill="#3a2d33" stroke="none"/>` +
      `<circle cx="12" cy="13.4" r="7.2" fill="none"/>` +
      face(12, 11.4, 2.4) +
      shine(8.4, 9, 1.5, 0.8, -40, 0.5),
  ),
  snail: filled(
    wire('M7.4 10.4 6 6.2M9.2 10.2l1.2-4', 1.2, '#c9b6e4') +
      `<path d="M4.2 19.8c-.8 0-1.2-.9-.7-1.5 1-1 1.6-2.4 1.7-4.4.1-2.4 1.1-4.2 3-4.2s2.8 1.6 2.9 3.6l.3 2.8h8c1.1 0 2 .8 2 1.8s-.9 1.9-2 1.9z" fill="#c9b6e4"/>` +
      bigEye(6, 5.6, 1.5) +
      bigEye(10.4, 5.4, 1.5) +
      `<circle cx="15.6" cy="11.6" r="5.4" fill="#f0a45c"/>` +
      line(spiral(15.6, 11.6, 1.1, 4), 'rgba(140,70,24,0.6)', 1.2) +
      shine(13.4, 8.4, 1.3, 0.7, -35, 0.45) +
      cheeks(6.6, 13.4, 0) +
      smile(8.3, 14.2, 1.6),
  ),
  frog: filled(
    merged(
      `<path d="M3.6 14.4c0-4.2 3.8-6.8 8.4-6.8s8.4 2.6 8.4 6.8c0 3.8-3.8 6.4-8.4 6.4s-8.4-2.6-8.4-6.4z" fill="#6cc04a"/>` +
        `<circle cx="7.8" cy="8.4" r="3.1" fill="#6cc04a"/><circle cx="16.2" cy="8.4" r="3.1" fill="#6cc04a"/>`,
    ) +
      `<ellipse cx="12" cy="17.9" rx="4.6" ry="2.1" fill="#b9e27c" stroke="none"/>` +
      bigEye(7.8, 8.4, 2) +
      bigEye(16.2, 8.4, 2) +
      dots([[11.1, 12.2], [12.9, 12.2]], 0.35, EYE) +
      cheeks(12, 15.2, 5.6) +
      line('M7.8 14.2c2.6 2.1 5.8 2.1 8.4 0', EYE, 1),
  ),
  antQueen: filled(
    mirrored(line('M9.4 8.6 7.6 4.8 4.8 4.2', LEG, 1.2) + dots([[4.7, 4.2]], 0.95, LEG)) +
      `<ellipse cx="12" cy="13.6" rx="6.6" ry="6.1" fill="#a64d2e"/>` +
      `<path d="M7.8 8.8 7.2 4.6l2.6 1.9L12 3l2.2 3.5 2.6-1.9-.6 4.2z" fill="#f5c63b"/>` +
      `<g fill="#f5c63b"><circle cx="7.2" cy="4.6" r=".6"/><circle cx="12" cy="3" r=".6"/><circle cx="16.8" cy="4.6" r=".6"/></g>` +
      dots([[12, 6.8]], 0.75, '#e8434f') +
      mirrored(line('M8.7 12.3 8 11.6', EYE, 0.8)) +
      face(12, 13.2, 2.5) +
      shine(8.6, 10.4, 1.3, 0.7, -35, 0.35),
  ),
  fly: filled(
    mirrored(`<ellipse cx="6.4" cy="8.6" rx="2.3" ry="4.6" fill="${WING}" transform="rotate(-52 6.4 8.6)"/>` + line('M11.2 7.1 10.8 5.6', INK, 1)) +
      `<circle cx="12" cy="13.4" r="6.4" fill="#5b6273"/>` +
      [8.9, 15.1].map((x) => `<circle cx="${x}" cy="11.8" r="3.1" fill="#e0483f"/>` + beadEye(x + (x < 12 ? 0.5 : -0.5), 12.3, 1.05) + shine(x - 1, 10.3, 0.9, 0.45, -30, 0.55)).join('') +
      cheeks(12, 16.2, 3.8) +
      smile(12, 16.4, 1.8),
  ),
  butterfly: filled(
    mirrored(
      line('M11.3 5.4c-.5-1.7-1.5-2.8-2.9-3.1', LEG, 1) +
        dots([[8.3, 2.3]], 0.8, LEG) +
        `<path d="M11.4 9.4C9.8 5.4 6.6 3.4 4.2 4.4 2.4 5.2 2.6 8.8 4.4 10.8c1.6 1.8 4.4 2.4 7 1.8z" fill="#ff8fb8"/>` +
        `<path d="M11.4 12.4c-2.6-.4-5.6.6-6.4 3-.6 2 .8 3.8 2.8 3.6 2.2-.2 3.6-3.2 3.6-6.6z" fill="#b49cf0"/>` +
        dots([[6.4, 7.6]], 1.3, 'rgba(255,255,255,0.6)') +
        dots([[7.6, 16.4]], 0.9, 'rgba(255,255,255,0.55)'),
    ) +
      `<rect x="10.5" y="8" width="3" height="11.6" rx="1.5" fill="#4b3f86"/>` +
      `<circle cx="12" cy="6.9" r="2.6" fill="#4b3f86"/>` +
      dots([[11, 6.8], [13, 6.8]], 0.75, '#fff') +
      dots([[11.1, 7], [13.1, 7]], 0.38, EYE),
  ),
  ladybug: filled(
    mirrored(line('M6.4 12.4 4.2 11.2M6.2 15.4l-2.3.6M7.2 18.4l-1.8 1.6', EYE, 1.2) + line('M10.4 4.8 9 2.6', EYE, 1) + dots([[8.9, 2.5]], 0.8, EYE)) +
      `<circle cx="12" cy="14.2" r="6.8" fill="#e8433c"/>` +
      line('M12 9.4v11.6', INK, 1) +
      dots([[8.9, 12.9], [9.5, 17.3], [15.1, 12.9], [14.5, 17.3]], 1.25, EYE) +
      shine(8.2, 15.2, 0.8, 1.8, 20, 0.35) +
      `<path d="M7.4 9c0-2.8 2.1-4.6 4.6-4.6s4.6 1.8 4.6 4.6c0 .7-.5 1.2-1.2 1.2H8.6c-.7 0-1.2-.5-1.2-1.2z" fill="${EYE}"/>` +
      [10.2, 13.8].map((x) => `<circle cx="${x}" cy="7.4" r="1.2" fill="#fff" stroke="none"/>` + dots([[x + 0.2, 7.6]], 0.6, EYE)).join('') +
      cheeks(12, 9.1, 3.4),
  ),
  // De lado: de frente, as coxas atrás da cabeça viravam orelhas.
  grasshopper: filled(
    line('M6.6 7.4C8 3.8 11.4 2 15.6 2.2M5.4 7.6C6 4.4 8.4 2.2 11.6 1.4', LEG, 1) +
      wire('M19 7.6 21 17.8', 1, '#79b33f', 1.2) +
      line('M8.6 15.6 7.6 19.4M11.4 16 11 19.6', LEG, 1.2) +
      `<path d="M8.6 12.2c3.4-1.8 8.6-2 12.2-.4 1 .5 1.1 1.7.2 2.3-3.4 2.1-8.8 2.5-12.2 1.1z" fill="#8cc63f"/>` +
      line('M10.4 12.6c3.2-1 6.8-1.1 9.6-.2') +
      `<path d="M12.4 14.6c1.2-3.6 3.4-6.4 6-7.8.8-.4 1.7.3 1.3 1.1-1 2.9-3 5.6-5.8 7.4z" fill="#79b33f"/>` +
      `<ellipse cx="7" cy="11.6" rx="4" ry="4.6" fill="#9ccc4a" transform="rotate(-12 7 11.6)"/>` +
      `<ellipse cx="4.9" cy="14.5" rx="1.4" ry="1" fill="#c9e47e" stroke="none"/>` +
      beadEye(6.3, 10.2, 1.45) +
      cheeks(4.5, 12.4, 0) +
      smile(5.2, 13.8, 1.6),
  ),
  worm: filled(
    `<g stroke="${INK_SOLID}" opacity="${INK_ALPHA}"><path d="${WORM_BODY}" fill="none" stroke-width="6.6"/><circle cx="14.2" cy="6.8" r="3.3" fill="${INK_SOLID}" stroke-width="2.2"/></g>` +
      `<path d="${WORM_BODY}" fill="none" stroke="#f28ca4" stroke-width="4.4"/><circle cx="14.2" cy="6.8" r="3.3" fill="#f28ca4" stroke="none"/>` +
      line('M7.5 16.6c1.3.5 2.8.3 4-.6M10.6 12.3c1.1.9 2.6 1.2 4 .8', 'rgba(58,42,34,0.3)', 1) +
      face(14.2, 6.4, 1.35, 0.8) +
      `<path d="M3.2 22.2c.9-2.6 3.3-4.1 6.2-4.1s5.3 1.5 6.2 4.1z" fill="#8a5a3a"/>` +
      dots([[6.6, 20.6], [9.6, 19.8], [12.2, 20.8]], 0.45, 'rgba(255,230,200,0.35)'),
  ),
  elder: filled(
    `<ellipse cx="11" cy="15.6" rx="7.2" ry="5.6" fill="#4b4478"/>` +
      shine(6.6, 16.4, 0.8, 2, 20, 0.25) +
      dots([[7.6, 21.2], [14.4, 21.2]], 1.2, LEG) +
      mirrored(line('M9.4 7c-.6-1.8-1.6-2.8-2.8-3.2', LEG, 1.1) + `<circle cx="6.5" cy="3.7" r="1" fill="#f4a73b"/>`, 11) +
      `<path d="M5.4 12.6c0-3.5 2.5-6 5.6-6s5.6 2.5 5.6 6c0 1.1-.9 2-2 2H7.4c-1.1 0-2-.9-2-2z" fill="#3f3a78"/>` +
      mirrored(line('M7.2 10c.9-1.1 2.3-1.5 3.3-.8', '#f4efe6', 1.7) + line('M8.1 11.7q.8-.8 1.6 0', '#fbf6ee', 0.9), 11) +
      cheeks(11, 12.8, 4) +
      mirrored(`<path d="M11 13c-1 1.2-2.6 1.7-4 1-.7-.4-.6-1.3.2-1.3 1.2.2 2.6-.2 3.8.3z" fill="#f4efe6"/>`, 11) +
      line('M16.4 14.6 19.2 13.8', LEG, 1.4) +
      wire('M19.2 21.6v-9.8a1.9 1.9 0 0 0-3.8 0', 1.5, '#b8763e'),
  ),
  sun: filled(
    `<path d="${starPath(12, 11, 7.8, 12, 12, 0.13)}" fill="#f7a93b"/>` +
      `<circle cx="12" cy="12" r="7" fill="#ffd45e"/>` +
      shine(9.2, 8.8, 2, 1, -35, 0.45) +
      `<g transform="translate(12 12.4) scale(.46) translate(-12 -12.2)">${beetleFigure({ shell: '#3d3689', pronotum: '#3d3689', head: '#3d3689', legs: '#3d3689', club: '#f4a73b', shovel: true })}</g>`,
  ),
};

/**
 * Besouro visto de cima com as cores de um casco (aba "Cascos" da toca):
 * `shell` pinta os élitros, `pronotum` o pronoto e a cabeça, `accent` a
 * pontinha das antenas (laranja, como no besouro do jogo, se não vier).
 */
export function beetleIcon(colors: { shell: string; pronotum: string; accent?: string }): string {
  return filled(beetleFigure({ shell: colors.shell, pronotum: colors.pronotum, head: colors.pronotum, legs: LEG, club: colors.accent ?? '#f4a73b', shovel: true, eyes: true }));
}

export const GameIcons = {
  burrow: stroke('<path d="M2.5 20h19"/><path d="M4 20c1.2-4.8 4.3-7.8 8-7.8s6.8 3 8 7.8"/><ellipse cx="12" cy="19.2" rx="3.2" ry="1.9" fill="currentColor"/><path d="M12 12.2V4l4.6 2.1L12 8.2"/>'),
  pantry: stroke('<circle cx="7.5" cy="15.5" r="4"/><circle cx="16.5" cy="15.5" r="4"/><circle cx="12" cy="8" r="4"/>'),
  catalog: stroke('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  sparkle: stroke('<path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z"/><path d="M19 16.5c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3z"/>'),
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>`,
  lock: stroke('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  food: stroke('<path d="M4 13h16a8 8 0 0 1-16 0z"/><path d="M8.5 9.5c0-1.5 1-2 1-3.5M12 9.5c0-1.5 1-2 1-3.5M15.5 9.5c0-1.5 1-2 1-3.5"/>'),
  /** Conquista secreta: cadeado com interrogação. */
  secret: stroke('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M10.3 14.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3" stroke-width="1.8"/><path d="M12 19.1h.01" stroke-width="2.4"/>'),
  /** Curiosidade da figurinha: lâmpada. */
  fact: stroke('<path d="M9.3 16.4v-.9c0-.8-.3-1.4-.9-1.9A6 6 0 1 1 15.6 13.6c-.6.5-.9 1.1-.9 1.9v.9z"/><path d="M9.6 19h4.8M10.6 21.4h2.8"/><path d="M9.4 9.2a2.8 2.8 0 0 1 2.4-2.4" stroke-width="1.6"/>'),
  /** Habilidade ativa (genérica): raio num círculo. */
  ability: stroke('<circle cx="12" cy="12" r="9"/><path d="M13 6.5 8.5 13H12l-1 4.5 4.5-6.5H12z" fill="currentColor" stroke-width="1.4"/>'),
  /** Aba "Cascos": casco de besouro. */
  shell: stroke('<path d="M5.8 11.4c0-1.3 1-2.2 2.2-2.2h8c1.2 0 2.2.9 2.2 2.2 0 5.4-2.8 9.4-6.2 9.4s-6.2-4-6.2-9.4z"/><path d="M12 9.2v11.4"/><path d="M8.6 9.2c0-2.2 1.5-3.8 3.4-3.8s3.4 1.6 3.4 3.8"/><path d="M10.4 5.6 8.8 3.2M13.6 5.6l1.6-2.4"/>'),
};
