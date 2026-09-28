import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { extrude, lathe, starShape } from '../entities/outfit/parts';
import { slab } from '../entities/outfit/skinned';
import { mulberry32 } from '../progression/economy';
import type { Rarity } from '../progression/unlocks';
import { clay } from '../render/clayMaterial';
import { claySphere } from '../render/geometry';
import { mergeStaticTree } from '../render/mergeStatic';

/**
 * Os quatro baús, modelados peça por peça: tábuas separadas (com o veio da
 * madeira numa textura feita em código), cantoneiras e cintas de metal com
 * rebite, alças de argola, fechadura com espelho e pezinhos. Cada raridade tem
 * silhueta própria, pra ler de longe antes da cor:
 *
 * - Madeira (comum): o baú de pirata clássico, madeira e ferro.
 * - Prata (raro): madeira azul-marinho e muita prata (cantos e cintas largas,
 *   a faixa do meio da tampa e a estrela em cima).
 * - Cristal (épico): laca roxa com ouro e ametistas brotando da tampa.
 * - Sol (lendário): laca de urucum, ouro por todo lado e a crista do solzinho
 *   do jogo em pé em cima da tampa.
 *
 * Medidas: o besouro tem ~0,8 de comprimento. Origem no chão, no meio do baú;
 * +Z = frente (a fechadura). A tampa gira na dobradiça da borda de trás.
 */

/** Largura (X), profundidade (Z) e altura do corpo, pés inclusos (a tampa começa aí). */
export const CHEST_W = 0.56;
export const CHEST_D = 0.38;
const FEET = 0.034;
const BODY = 0.25;
export const CHEST_H = FEET + BODY;
/** Raio da tampa (meio cilindro deitado). */
const R = CHEST_D / 2;

export interface ChestModel {
  root: THREE.Group;
  /** Junta da tampa (dobradiça atrás, em cima do corpo). */
  lid: THREE.Group;
  /** Pedra da fechadura, que pulsa (baús que têm). */
  gem: THREE.Mesh | null;
  /** Peças de luz própria que acompanham o pulso da pedra (cristais do épico, o sol do lendário). */
  glows: THREE.Mesh[];
}

interface ChestStyle {
  /** Madeira do corpo e da tampa (duas tábuas alternando de tom). */
  wood: [string, string];
  /** Metal das cantoneiras, cintas, rebites e alças. */
  metal: string;
  /** Metal nobre da fechadura e dos enfeites. */
  trim: string;
  /** Fundo, entre as tábuas. */
  inside: string;
  /** Forro de veludo da tampa e do fundo (aparece com ela aberta). */
  lining: string;
  /** Cor da luz lá de dentro (facho, anel, brilho do prêmio). */
  glow: string;
  gem?: string;
  /** Laca: madeira pintada e envernizada (menos veio, mais brilho). */
  lacquer: boolean;
}

export const CHEST_STYLES: Record<Rarity, ChestStyle> = {
  common: { wood: ['#a0643a', '#8f5530'], metal: '#5a5561', trim: '#d9a441', inside: '#3b2415', lining: '#5a2a1c', glow: '#ffd27a', lacquer: false },
  rare: { wood: ['#3f5f8f', '#35527c'], metal: '#dfe6ef', trim: '#f4f7fb', inside: '#1c2436', lining: '#23346a', glow: '#bfe3ff', gem: '#5fc4ff', lacquer: true },
  epic: { wood: ['#6a3cc4', '#5a30ad'], metal: '#f0c14e', trim: '#ffd970', inside: '#241040', lining: '#4a1f8c', glow: '#c89bff', gem: '#6ff0ff', lacquer: true },
  legendary: { wood: ['#e27a2c', '#cc6724'], metal: '#ffc94a', trim: '#fff0b0', inside: '#3a1608', lining: '#a3172e', glow: '#ffd45a', gem: '#ff7a3d', lacquer: true },
};

// --- texturas -------------------------------------------------------------------------

const woodMaps = new Map<string, THREE.CanvasTexture>();

/**
 * Veio de madeira em tons de cinza (a cor vem do material): linhas onduladas
 * ao longo do X da textura, um ou dois nós com anéis e as pontas da tábua mais
 * escuras (cada face da tábua vai de 0 a 1, então a emenda entre tábuas lê).
 * `lacquer` = pintada: veio bem apagado.
 */
function woodTexture(seed: number, lacquer: boolean): THREE.CanvasTexture {
  const key = `${seed}:${lacquer}`;
  const cached = woodMaps.get(key);
  if (cached) return cached;
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const random = mulberry32(seed * 7919 + 13);
  g.fillStyle = lacquer ? '#f2f2f2' : '#ececec';
  g.fillRect(0, 0, W, H);
  const lines = lacquer ? 18 : 46;
  for (let i = 0; i < lines; i++) {
    const y0 = random() * H;
    const amp = 1.5 + random() * 5;
    const freq = 0.004 + random() * 0.01;
    const phase = random() * 10;
    const shade = lacquer ? 200 + random() * 30 : 120 + random() * 70;
    g.strokeStyle = `rgba(${shade}, ${shade * 0.94}, ${shade * 0.88}, ${lacquer ? 0.25 : 0.35 + random() * 0.4})`;
    g.lineWidth = 0.6 + random() * (lacquer ? 1 : 2.4);
    g.beginPath();
    for (let x = -4; x <= W + 4; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase * 2) * amp * 0.3;
      if (x < 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  if (!lacquer) {
    const knots = 1 + Math.floor(random() * 2);
    for (let k = 0; k < knots; k++) {
      const cx = 60 + random() * (W - 120);
      const cy = 20 + random() * (H - 40);
      for (let r = 9; r > 0; r -= 2) {
        g.strokeStyle = `rgba(90, 70, 55, ${0.18 + (9 - r) * 0.05})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(cx, cy, r * 2.4, r, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(70, 50, 38, 0.55)';
      g.beginPath();
      g.ellipse(cx, cy, 4, 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Borda da tábua gasta (mais escura): a emenda entre uma e outra aparece.
  const edge = g.createLinearGradient(0, 0, 0, H);
  edge.addColorStop(0, 'rgba(60, 40, 30, 0.45)');
  edge.addColorStop(0.1, 'rgba(60, 40, 30, 0)');
  edge.addColorStop(0.9, 'rgba(60, 40, 30, 0)');
  edge.addColorStop(1, 'rgba(60, 40, 30, 0.45)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  const ends = g.createLinearGradient(0, 0, W, 0);
  ends.addColorStop(0, 'rgba(60, 40, 30, 0.35)');
  ends.addColorStop(0.04, 'rgba(60, 40, 30, 0)');
  ends.addColorStop(0.96, 'rgba(60, 40, 30, 0)');
  ends.addColorStop(1, 'rgba(60, 40, 30, 0.35)');
  g.fillStyle = ends;
  g.fillRect(0, 0, W, H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  woodMaps.set(key, texture);
  return texture;
}

// --- materiais -------------------------------------------------------------------------

function woodMaterial(color: string, seed: number, lacquer: boolean): THREE.MeshPhysicalMaterial {
  const material = clay(color, {
    roughness: lacquer ? 0.34 : 0.74,
    sheen: 0.4,
    bump: lacquer ? 0.08 : 0.22,
    clearcoat: lacquer ? 0.75 : 0.08,
    mottle: 0.04,
    mottleScale: 16,
    unique: true,
  });
  material.map = woodTexture(seed, lacquer);
  return material;
}

function metalMaterial(color: string, glow = 0): THREE.MeshPhysicalMaterial {
  const material = clay(color, { roughness: 0.24, sheen: 0.25, bump: 0.05, clearcoat: 1, mottle: 0.03, mottleScale: 22, unique: glow > 0 });
  if (glow > 0) {
    material.emissive = new THREE.Color(color);
    material.emissiveIntensity = glow;
  }
  return material;
}

// --- peças ------------------------------------------------------------------------------

const box = (w: number, h: number, d: number, radius = 0.006, segments = 2) => new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** Moldura retangular (quatro barras) deitada, centrada em (0, y, z): o aro da boca do baú e da tampa. */
function frame(parent: THREE.Object3D, material: THREE.Material, w: number, d: number, bar: number, h: number, y: number, z = 0): void {
  for (const side of [1, -1]) {
    parent.add(mesh(box(w, h, bar, 0.008), material, 0, y, z + side * (d / 2 - bar / 2)));
    parent.add(mesh(box(bar, h, d - bar * 2 + 0.004, 0.008), material, side * (w / 2 - bar / 2), y, z));
  }
}

/** Espelho da fechadura: escudinho de ponta pra baixo. */
function hasp(width: number, height: number): THREE.Shape {
  const w = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w, height * 0.25);
  shape.quadraticCurveTo(-w, height * 0.5, -w * 0.55, height * 0.5);
  shape.lineTo(w * 0.55, height * 0.5);
  shape.quadraticCurveTo(w, height * 0.5, w, height * 0.25);
  shape.lineTo(w, -height * 0.12);
  shape.quadraticCurveTo(w * 0.9, -height * 0.38, 0, -height * 0.5);
  shape.quadraticCurveTo(-w * 0.9, -height * 0.38, -w, -height * 0.12);
  shape.closePath();
  return shape;
}

/** Buraco da fechadura: bolinha e o rabo trapézio. */
function keyhole(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0.006, 0.0085, -Math.PI * 0.25, Math.PI * 1.25, false);
  shape.lineTo(-0.007, -0.016);
  shape.lineTo(0.007, -0.016);
  shape.closePath();
  return shape;
}

/** Cristal de ametista: prisma de 6 faces com a ponta em pirâmide (facetado). */
function crystal(radius: number, height: number): THREE.BufferGeometry {
  const geometry = lathe(
    [
      [radius * 0.7, -0.01],
      [radius, 0.004],
      [radius * 0.96, height * 0.72],
      [0.0005, height],
    ],
    6,
    0,
  );
  return geometry;
}

/**
 * Monta o baú. `seed` muda só o sorteio do veio (dois baús iguais em cena não
 * ficam idênticos tábua por tábua).
 */
export function buildChestModel(rarity: Rarity, seed = 1): ChestModel {
  const style = CHEST_STYLES[rarity];
  const root = new THREE.Group();
  root.name = `chest-${rarity}`;
  const random = mulberry32(seed * 131 + rarity.length);
  const woods = style.wood.map((c, i) => woodMaterial(c, seed * 10 + i, style.lacquer));
  const metal = metalMaterial(style.metal);
  const trim = metalMaterial(style.trim, rarity === 'legendary' ? 0.12 : 0);
  const inside = clay(style.inside, { roughness: 0.85, sheen: 0.3, bump: 0.2, mottle: 0.05, mottleScale: 18 });
  const dark = clay('#1d1620', { roughness: 0.6, sheen: 0.2, bump: 0 });
  const velvet = clay(style.lining, { roughness: 0.95, sheen: 1, bump: 0.3, mottle: 0.06, mottleScale: 30 });
  const rivet = claySphere(0.0085, 1, 0.04);
  const glows: THREE.Mesh[] = [];
  const W = CHEST_W;
  const D = CHEST_D;

  // --- corpo ---------------------------------------------------------------------------
  const body = new THREE.Group();
  body.name = 'chest-body';
  // Miolo: fundo até a metade (a boca tem profundidade) e as paredes de dentro forradas.
  const FLOOR = FEET + BODY * 0.42;
  body.add(mesh(box(W - 0.03, FLOOR - FEET - 0.006, D - 0.03, 0.01), inside, 0, (FEET + 0.006 + FLOOR) / 2, 0));
  body.add(mesh(box(W - 0.05, 0.012, D - 0.05, 0.004), velvet, 0, FLOOR, 0));
  frame(body, inside, W - 0.044, D - 0.044, 0.012, CHEST_H - FLOOR - 0.01, (FLOOR + CHEST_H - 0.01) / 2);
  const ROWS = 3;
  const plankH = (BODY - 0.014) / ROWS;
  for (let r = 0; r < ROWS; r++) {
    const y = FEET + 0.007 + plankH * (r + 0.5);
    for (const side of [1, -1]) {
      // Frente/trás: tábuas compridas; lados: curtas. Um tiquinho tortas (feito à mão).
      const front = mesh(box(W - 0.05, plankH - 0.007, 0.024, 0.006), woods[(r + (side > 0 ? 0 : 1)) % 2], 0, y + (random() - 0.5) * 0.002, side * (D / 2 - 0.012));
      front.rotation.z = (random() - 0.5) * 0.008;
      body.add(front);
      const lateral = mesh(box(0.024, plankH - 0.007, D - 0.05, 0.006), woods[(r + (side > 0 ? 1 : 0)) % 2], side * (W / 2 - 0.012), y + (random() - 0.5) * 0.002, 0);
      lateral.rotation.x = (random() - 0.5) * 0.008;
      body.add(lateral);
    }
  }
  // Bordas de metal em cima e embaixo, e as cantoneiras (mais largas na prata e no Sol).
  frame(body, metal, W + 0.014, D + 0.014, 0.036, 0.026, FEET + BODY - 0.011);
  body.add(mesh(box(W + 0.014, 0.03, D + 0.014, 0.008), metal, 0, FEET + 0.015, 0));
  const corner = rarity === 'common' ? 0.07 : 0.09;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const cx = sx * (W / 2 - corner / 2 + 0.012);
      const cz = sz * (D / 2 - corner / 2 + 0.012);
      // Cantoneira em L: uma chapa na frente/trás, outra no lado e o canto arredondado.
      body.add(mesh(box(corner, BODY + 0.006, 0.014, 0.005), metal, cx, FEET + BODY / 2, sz * (D / 2 + 0.005)));
      body.add(mesh(box(0.014, BODY + 0.006, corner, 0.005), metal, sx * (W / 2 + 0.005), FEET + BODY / 2, cz));
      body.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, BODY + 0.006, 10), metal, sx * (W / 2 + 0.003), FEET + BODY / 2, sz * (D / 2 + 0.003)));
      for (const y of [0.05, 0.125, 0.2]) {
        body.add(mesh(rivet, trim, cx - sx * corner * 0.12, FEET + y, sz * (D / 2 + 0.013)));
        body.add(mesh(rivet, trim, sx * (W / 2 + 0.013), FEET + y, cz - sz * corner * 0.12));
      }
      // Pés: taquinho de madeira no comum, bola de metal nos outros.
      if (rarity === 'common') body.add(mesh(box(0.07, FEET + 0.006, 0.07, 0.01), woods[1], cx, (FEET + 0.006) / 2, cz));
      else {
        const foot = mesh(claySphere(0.036, 2, 0.02), metal, cx, FEET * 0.52, cz);
        foot.scale.set(1, 0.72, 1);
        body.add(foot);
      }
    }
  }
  // Cintas: duas em volta do corpo (a do meio da prata vem na tampa).
  const STRAP = rarity === 'common' ? 0.044 : 0.056;
  const STRAP_X = 0.15;
  for (const sx of [1, -1]) {
    // Cinta em U: chapa na frente e atrás (o fundo não aparece); a boca fica livre.
    for (const sz of [1, -1]) body.add(mesh(box(STRAP, BODY + 0.002, 0.012, 0.005), metal, sx * STRAP_X, FEET + BODY / 2, sz * (D / 2 + 0.004)));
    for (const sz of [1, -1]) {
      for (const y of [0.06, 0.13, 0.2]) body.add(mesh(rivet, trim, sx * STRAP_X, FEET + y, sz * (D / 2 + 0.011)));
    }
    // Alça: chapinha no lado e a argola pendurada.
    body.add(mesh(box(0.016, 0.032, 0.08, 0.005), metal, sx * (W / 2 + 0.018), FEET + BODY * 0.66, 0));
    const ring = mesh(new THREE.TorusGeometry(0.036, 0.0075, 8, 28), metal, sx * (W / 2 + 0.028), FEET + BODY * 0.66 - 0.032, 0);
    ring.rotation.set(0, Math.PI / 2, 0);
    ring.rotateX(sx * 0.18);
    body.add(ring);
  }
  // Enfeite da frente: medalhão do sol (lendário) ou florão de cristal (épico) entre as cintas, embaixo da fechadura.
  if (rarity === 'legendary') {
    const medal = mesh(extrude(starShape(12, 0.05, 0.036), 0.01, 0.004), trim, 0, FEET + BODY * 0.4, D / 2 + 0.012);
    body.add(medal);
    const core = mesh(claySphere(0.022, 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.gem!).multiplyScalar(2) }), 0, FEET + BODY * 0.4, D / 2 + 0.022);
    core.scale.set(1, 1, 0.5);
    glows.push(core);
    body.add(core);
  }
  root.add(body);

  // --- tampa ----------------------------------------------------------------------------
  const lid = new THREE.Group();
  lid.name = 'chest-lid';
  lid.position.set(0, CHEST_H, -D / 2);
  // Miolo escuro (aparece nas frestas e é o forro com a tampa aberta).
  lid.add(mesh(new THREE.CylinderGeometry(R - 0.018, R - 0.018, W - 0.03, 28, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, R), inside));
  const STAVES = 6;
  for (let k = 0; k < STAVES; k++) {
    const a0 = (k / STAVES) * Math.PI + 0.012;
    const a1 = ((k + 1) / STAVES) * Math.PI - 0.012;
    const stave = slab(
      (u, v, t) => {
        const a = a0 + (a1 - a0) * v;
        return t.set(u * (W / 2 - 0.026), Math.sin(a) * (R - 0.002), R + Math.cos(a) * (R - 0.002));
      },
      2,
      6,
      0.022,
    );
    lid.add(mesh(stave, woods[k % 2]));
  }
  // Tampinhas dos lados (meio disco de madeira) com o friso de metal na borda curva.
  const halfDisc = new THREE.Shape();
  halfDisc.absarc(0, 0, R + 0.004, 0, Math.PI, false);
  halfDisc.closePath();
  for (const sx of [1, -1]) {
    lid.add(mesh(extrude(halfDisc, 0.022, 0.004, 24).rotateY(Math.PI / 2), woods[1], sx * (W / 2 - 0.013), 0, R));
    lid.add(mesh(new THREE.TorusGeometry(R + 0.008, 0.01, 8, 30, Math.PI).rotateY(Math.PI / 2), metal, sx * (W / 2 - 0.004), 0, R));
  }
  frame(lid, metal, W + 0.014, D + 0.014, 0.036, 0.024, 0.012, R);
  lid.add(mesh(box(W - 0.05, 0.008, D - 0.05, 0.003), velvet, 0, 0.006, R));
  // Cintas da tampa seguindo a curva, com rebites.
  const strapXs = rarity === 'rare' ? [STRAP_X, -STRAP_X, 0] : [STRAP_X, -STRAP_X];
  for (const x of strapXs) {
    const width = x === 0 ? 0.07 : STRAP;
    lid.add(
      mesh(
        slab(
          (u, v, t) => {
            const a = v * Math.PI;
            return t.set(x + u * (width / 2), Math.sin(a) * (R + 0.012), R + Math.cos(a) * (R + 0.012));
          },
          1,
          26,
          0.012,
        ),
        metal,
      ),
    );
    for (let i = 1; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      lid.add(mesh(rivet, trim, x, Math.sin(a) * (R + 0.02), R + Math.cos(a) * (R + 0.02)));
    }
  }
  // Fechadura: espelho de ponta pra baixo (desce da tampa pro corpo), o buraco e, nos raros pra cima, a pedra.
  const haspMesh = mesh(extrude(hasp(0.085, 0.12), 0.012, 0.004, 12), trim, 0, -0.018, D + 0.016);
  lid.add(haspMesh);
  lid.add(mesh(extrude(keyhole(), 0.004, 0.0012, 10), dark, 0, style.gem ? -0.052 : -0.024, D + 0.026));
  let gem: THREE.Mesh | null = null;
  if (style.gem) {
    gem = mesh(claySphere(0.02, 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.gem).multiplyScalar(2.2) }), 0, 0.006, D + 0.026);
    gem.scale.set(1, 1, 0.55);
    lid.add(gem);
    const bezel = mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 24), trim, 0, 0.006, D + 0.024);
    lid.add(bezel);
  }

  if (rarity === 'rare') {
    // Estrela de prata no alto da tampa.
    const star = mesh(extrude(starShape(5, 0.05, 0.022), 0.012, 0.004), trim, 0, R + 0.026, R);
    star.rotation.x = -Math.PI / 2;
    lid.add(star);
  }
  if (rarity === 'epic') {
    // Ametistas brotando da tampa: um cacho grande no meio e dois menores nos cantos de trás.
    const amethyst = clay('#b58cff', { roughness: 0.12, sheen: 0.2, bump: 0, clearcoat: 1, iridescence: 0.7, flatShading: true, mottle: 0, unique: true });
    amethyst.emissive = new THREE.Color('#6a2fe0');
    amethyst.emissiveIntensity = 0.6;
    const clusters: Array<[number, number, number, number]> = [
      // [x, onde na curva da tampa (0 = frente, 1 = trás), escala, giro]
      [0, 0.5, 1.25, 0],
      [0.19, 0.72, 0.8, 1.2],
      [-0.2, 0.68, 0.85, 2.1],
    ];
    // Cada cacho: o cristal grande e três menores inclinados em volta. [pra frente/trás, pro lado, desloca x, desloca na curva, raio, altura]
    const shards: Array<[number, number, number, number, number, number]> = [
      [0, 0, 0, 0, 0.034, 0.17],
      [0.35, 0.5, 0.03, 0.012, 0.022, 0.11],
      [-0.3, -0.55, -0.032, -0.01, 0.024, 0.12],
      [0.6, -0.2, -0.008, 0.036, 0.018, 0.085],
    ];
    const X = new THREE.Vector3(1, 0, 0);
    for (const [x, t, s, twist] of clusters) {
      const a = t * Math.PI;
      const normal = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
      const tangent = new THREE.Vector3(0, Math.cos(a), -Math.sin(a));
      const base = new THREE.Vector3(x, Math.sin(a) * R, R + Math.cos(a) * R).addScaledVector(normal, -0.006);
      for (const [tilt, lean, dx, dt, radius, height] of shards) {
        const dir = normal.clone().addScaledVector(tangent, Math.tan(tilt)).addScaledVector(X, Math.tan(lean)).normalize();
        const shard = mesh(crystal(radius * s, height * s), amethyst);
        shard.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        shard.rotateY(twist + tilt * 3);
        shard.position.copy(base).addScaledVector(X, dx * s).addScaledVector(tangent, dt * s);
        lid.add(shard);
      }
    }
  }
  if (rarity === 'legendary') {
    // Crista do sol em pé no alto da tampa: raios dourados, o disco e o miolo aceso.
    const crest = new THREE.Group();
    crest.position.set(0, R + 0.004, R + 0.01);
    crest.add(mesh(extrude(starShape(14, 0.13, 0.085), 0.016, 0.006, 6), metal, 0, 0.07, 0));
    crest.add(mesh(extrude(new THREE.Shape().absarc(0, 0, 0.074, 0, Math.PI * 2, false), 0.022, 0.008, 32), trim, 0, 0.07, 0.006));
    const sunCore = mesh(claySphere(0.045, 3, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(2.1) }), 0, 0.07, 0.02);
    sunCore.scale.set(1, 1, 0.42);
    glows.push(sunCore);
    crest.add(sunCore);
    // Pé da crista (o cabo que prende na tampa).
    crest.add(mesh(box(0.05, 0.04, 0.05, 0.012), metal, 0, -0.004, 0));
    crest.rotation.x = -0.12;
    lid.add(crest);
    // Solzinhos gravados nas tampinhas dos lados.
    for (const sx of [1, -1]) {
      const side = mesh(extrude(starShape(10, 0.05, 0.034), 0.008, 0.003), trim, sx * (W / 2 + 0.012), R * 0.5, R);
      side.rotation.y = (sx * Math.PI) / 2;
      lid.add(side);
    }
  }
  root.add(lid);

  // Boca do baú: luz da cor dele lá dentro (só aparece com a tampa aberta).
  const mouth = mesh(new THREE.PlaneGeometry(W - 0.09, D - 0.09).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.glow).multiplyScalar(1.8) }), 0, FEET + BODY * 0.42 + 0.008, 0);
  root.add(mouth);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const glowing = m.material instanceof THREE.MeshBasicMaterial;
    m.castShadow = !glowing;
    m.receiveShadow = !glowing;
    if (glowing || m === gem) m.userData.keep = true;
  });
  // Peças paradas do mesmo material viram um draw call (a tampa continua junta própria).
  mergeStaticTree(root);
  return { root, lid, gem, glows };
}
