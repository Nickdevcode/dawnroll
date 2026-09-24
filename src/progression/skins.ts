import type { AchievementId } from './achievements';
import { unlockedByAchievement, unlockedByLevels, type Rarity, type Unlock } from './unlocks';

/**
 * Cascos do besouro: só aparência, nenhum dá vantagem. Os comuns vêm de
 * espécies de verdade (ou do mito); os raros são fantasias pintadas; os épicos
 * e lendários são vivos — o desenho do casco se mexe e alguns soltam brilho.
 *
 * As cores descrevem o casco inteiro: élitros (as "asas" duras), pronoto (o
 * escudo do tórax), cabeça, barriga, patas e a clava da antena. O degradê
 * (borda mais escura) é sombra assada no modelo; o desenho sai do shader do
 * casco (`render/skinShader.ts`), escolhido por `pattern`.
 */

export type SkinId =
  | 'indigo'
  | 'sacred'
  | 'bronze'
  | 'emerald'
  | 'taurus'
  | 'rainbow'
  | 'amazon'
  | 'pearl'
  | 'ladybug'
  | 'bee'
  | 'gingham'
  | 'watermelon'
  | 'camo'
  | 'jaguar'
  | 'moon'
  | 'crystal'
  | 'abyss'
  | 'magma'
  | 'aurora'
  | 'holo'
  | 'khepri'
  | 'galaxy'
  | 'dawn';

/**
 * Desenho do casco. Os de `ANIMATED_PATTERNS` mexem com o tempo.
 * `plain` = cor chapada por parte (élitros, pronoto, cabeça).
 */
export type SkinPattern =
  | 'plain'
  | 'spots'
  | 'stripes'
  | 'rosettes'
  | 'gingham'
  | 'melon'
  | 'camo'
  | 'crystal'
  | 'galaxy'
  | 'magma'
  | 'aurora'
  | 'holo'
  | 'abyss'
  | 'dawn'
  | 'gold';

/** Partículas em volta do besouro (só nos cascos vivos). */
export type SkinAura = 'embers' | 'stars' | 'sparkles' | 'motes' | 'glints' | 'bubbles';

export interface SkinDef {
  readonly id: SkinId;
  readonly rarity: Rarity;
  /** Como libera (sem = livre desde o começo). */
  readonly unlock?: Unlock;
  /** Élitros (a cor do topo; a borda escurece sozinha). */
  readonly elytra: string;
  /** Pronoto (alguns rola-bostas têm o tórax de outra cor). */
  readonly pronotum: string;
  /** Cabeça, chifre e pálpebras (sem = a cor do pronoto). */
  readonly head?: string;
  readonly belly: string;
  readonly leg: string;
  /** Clava da antena (as "sobrancelhas" laranja; sem = laranja de sempre). */
  readonly club?: string;
  /** Brilho furta-cor (0..1). */
  readonly iridescence: number;
  /** Aspereza do verniz (menor = mais espelhado, cara de metal). */
  readonly roughness: number;
  /** Quanto é metal de verdade (reflete o céu tingido da própria cor). Sem = 0. */
  readonly metalness?: number;
  readonly pattern?: SkinPattern;
  /** Cores extras do desenho (pintas, listras, rachaduras, estrelas...). */
  readonly accents?: readonly [string, string?, string?];
  /** Quanto o desenho acende sozinho (vira brilho no bloom). */
  readonly glow?: number;
  readonly aura?: SkinAura;
  /** Cores das partículas da aura (sem = as do tipo). */
  readonly auraColors?: readonly string[];
}

export const DEFAULT_CLUB = '#f4a73b';

export const ANIMATED_PATTERNS: ReadonlySet<SkinPattern> = new Set(['crystal', 'galaxy', 'magma', 'aurora', 'holo', 'abyss', 'dawn', 'gold']);

export const SKINS: readonly SkinDef[] = [
  {
    // O de sempre: índigo, a cor do menu.
    id: 'indigo',
    rarity: 'common',
    elytra: '#3d3689',
    pronotum: '#3d3689',
    belly: '#211d45',
    leg: '#352a4d',
    iridescence: 0.85,
    roughness: 0.4,
  },
  {
    // Scarabaeus sacer, o escaravelho sagrado do Egito: preto acetinado.
    id: 'sacred',
    rarity: 'common',
    unlock: { achievement: 'bury10' },
    elytra: '#3a3638',
    pronotum: '#3a3638',
    belly: '#1a1718',
    leg: '#2a2527',
    iridescence: 0.25,
    roughness: 0.5,
  },
  {
    // Kheper: bronze esverdeado metálico.
    id: 'bronze',
    rarity: 'common',
    unlock: { achievement: 'level5' },
    elytra: '#8a6b34',
    pronotum: '#7d7a3a',
    belly: '#2e2413',
    leg: '#4a3a22',
    iridescence: 0.7,
    roughness: 0.32,
    metalness: 0.3,
  },
  {
    // Oxysternon e parentes: verde-metálico das matas da América do Sul.
    id: 'emerald',
    rarity: 'common',
    unlock: { level: 3 },
    elytra: '#1f9a62',
    pronotum: '#2bb37a',
    belly: '#0f3526',
    leg: '#1d4a37',
    iridescence: 0.95,
    roughness: 0.28,
  },
  {
    // Onthophagus taurus, o dos chifres: marrom-escuro com reflexo de cobre.
    id: 'taurus',
    rarity: 'common',
    unlock: { achievement: 'fullPower' },
    elytra: '#4a3024',
    pronotum: '#5a3a28',
    belly: '#211510',
    leg: '#33221a',
    iridescence: 0.55,
    roughness: 0.36,
  },
  {
    // Phanaeus, o "besouro-arco-íris": élitros verdes e pronoto cobre.
    id: 'rainbow',
    rarity: 'rare',
    unlock: { achievement: 'catalog30' },
    elytra: '#3fa65a',
    pronotum: '#d9793a',
    belly: '#1d3324',
    leg: '#2b4a33',
    iridescence: 1,
    roughness: 0.28,
  },
  {
    // Coprophanaeus, o rola-bosta grandão da Amazônia: azul-violeta metálico.
    id: 'amazon',
    rarity: 'rare',
    unlock: { achievement: 'size24' },
    elytra: '#3f6fd8',
    pronotum: '#5a54d6',
    belly: '#171c42',
    leg: '#27306a',
    iridescence: 1,
    roughness: 0.26,
  },
  {
    // Madrepérola: branco leitoso que troca de cor conforme o ângulo.
    id: 'pearl',
    rarity: 'rare',
    unlock: { level: 8 },
    elytra: '#efe6dc',
    pronotum: '#f6efe7',
    belly: '#b9aca4',
    leg: '#cbbdb3',
    club: '#f2b9c8',
    iridescence: 1,
    roughness: 0.22,
  },
  {
    // Fantasia de joaninha: vermelho com pintas; o "rosto" preto com as manchinhas brancas.
    id: 'ladybug',
    rarity: 'rare',
    unlock: { achievement: 'zoo' },
    elytra: '#e3322b',
    pronotum: '#1d1a1f',
    head: '#1d1a1f',
    belly: '#151215',
    leg: '#1d1a1f',
    club: '#1d1a1f',
    iridescence: 0.15,
    roughness: 0.3,
    pattern: 'spots',
    accents: ['#141116', '#fbf4ea'],
  },
  {
    // Fantasia de abelha: listras pretas e amarelas, cabeça escura.
    id: 'bee',
    rarity: 'rare',
    unlock: { achievement: 'bouquet' },
    elytra: '#f5bf2a',
    pronotum: '#e9a92a',
    head: '#2b2226',
    belly: '#2b2226',
    leg: '#2b2226',
    club: '#2b2226',
    iridescence: 0.1,
    roughness: 0.55,
    pattern: 'stripes',
    accents: ['#2b2226'],
  },
  {
    // A toalha xadrez do piquenique.
    id: 'gingham',
    rarity: 'rare',
    unlock: { achievement: 'picnic' },
    elytra: '#fbf3e8',
    pronotum: '#fbf3e8',
    head: '#d8403c',
    belly: '#9f2c2a',
    leg: '#b8322f',
    club: '#fbf3e8',
    iridescence: 0,
    roughness: 0.75,
    pattern: 'gingham',
    accents: ['#d8403c'],
  },
  {
    // Melancia: casca listrada nos élitros, a polpa com sementes no pronoto.
    id: 'watermelon',
    rarity: 'rare',
    unlock: { level: 9 },
    elytra: '#2f7d3b',
    pronotum: '#f0545d',
    head: '#5aa345',
    belly: '#1f4d27',
    leg: '#2f6a36',
    club: '#9ad06a',
    iridescence: 0.1,
    roughness: 0.4,
    pattern: 'melon',
    accents: ['#8fce6a', '#2a1c1c', '#f4f1d0'],
  },
  {
    // O bicho-pau é mestre do disfarce; este é o casco de quem aprendeu com ele.
    id: 'camo',
    rarity: 'rare',
    unlock: { achievement: 'stickInsect' },
    elytra: '#6f7f45',
    pronotum: '#6f7f45',
    belly: '#3a3a26',
    leg: '#4d4a30',
    club: '#b39a62',
    iridescence: 0,
    roughness: 0.8,
    pattern: 'camo',
    accents: ['#3f5230', '#8a6a3e', '#c2b07a'],
  },
  {
    // Onça-pintada: dourado com rosetas.
    id: 'jaguar',
    rarity: 'epic',
    unlock: { achievement: 'size20' },
    elytra: '#e3a247',
    pronotum: '#e8ad55',
    head: '#eeb865',
    belly: '#f3e4c8',
    leg: '#c98a3c',
    club: '#2a1d17',
    iridescence: 0.05,
    roughness: 0.6,
    pattern: 'rosettes',
    accents: ['#2a1d17', '#b8742c'],
  },
  {
    // Prateado da madrugada, pra quem cumpre o pedido do Sol.
    id: 'moon',
    rarity: 'epic',
    unlock: { achievement: 'golden' },
    elytra: '#c9d0e6',
    pronotum: '#dfe3f2',
    belly: '#3b3f57',
    leg: '#565b78',
    iridescence: 0.9,
    roughness: 0.3,
    metalness: 0.35,
  },
  {
    // Cristal: facetas geladas que piscam e a luz que vira arco-íris nas bordas.
    id: 'crystal',
    rarity: 'epic',
    unlock: { achievement: 'rainbow' },
    elytra: '#c6ecfa',
    pronotum: '#d4effa',
    belly: '#5c8fae',
    leg: '#7fb3cf',
    club: '#e8f8ff',
    iridescence: 1,
    roughness: 0.12,
    pattern: 'crystal',
    accents: ['#ffffff', '#4f9fd6'],
    glow: 1,
    aura: 'glints',
  },
  {
    // Abissal: pontinhos que acendem em onda, como os bichos do fundo do mar.
    id: 'abyss',
    rarity: 'epic',
    unlock: { achievement: 'melted' },
    elytra: '#10244a',
    pronotum: '#13295a',
    belly: '#081328',
    leg: '#0f1f3f',
    club: '#5ef2e6',
    iridescence: 0.6,
    roughness: 0.3,
    pattern: 'abyss',
    accents: ['#5ef2e6', '#8a7bff'],
    glow: 1,
    aura: 'bubbles',
  },
  {
    // Magma: crosta escura com rachaduras em brasa que pulsam.
    id: 'magma',
    rarity: 'epic',
    unlock: { achievement: 'fever' },
    elytra: '#2a1a17',
    pronotum: '#2f1d19',
    belly: '#1a0f0d',
    leg: '#24160f',
    club: '#ff8a2a',
    iridescence: 0,
    roughness: 0.7,
    pattern: 'magma',
    accents: ['#ff5a1c', '#ffd65a'],
    glow: 1,
    aura: 'embers',
  },
  {
    // Aurora: cortinas verdes e lilases correndo pelo casco.
    id: 'aurora',
    rarity: 'epic',
    unlock: { achievement: 'marathon' },
    elytra: '#0f2a33',
    pronotum: '#12303b',
    belly: '#08171d',
    leg: '#10262e',
    club: '#7dffb0',
    iridescence: 0.5,
    roughness: 0.3,
    pattern: 'aurora',
    accents: ['#5dffa0', '#b77dff', '#5fd8ff'],
    glow: 1,
    aura: 'motes',
  },
  {
    // Holográfico: prateado que vira arco-íris conforme gira.
    id: 'holo',
    rarity: 'epic',
    unlock: { achievement: 'fashion' },
    elytra: '#d9dde8',
    pronotum: '#e4e7ef',
    belly: '#8d93a8',
    leg: '#a3a9bd',
    club: '#ffffff',
    iridescence: 1,
    roughness: 0.15,
    pattern: 'holo',
    glow: 0.6,
    aura: 'sparkles',
    auraColors: ['#ff8fc8', '#8fd0ff', '#b4ff9a', '#fff38a'],
  },
  {
    // Khepri, o deus-escaravelho que rola o sol: dourado, com um brilho que corre.
    id: 'khepri',
    rarity: 'legendary',
    unlock: { achievement: 'size30' },
    elytra: '#f2bd3c',
    pronotum: '#ffd463',
    belly: '#5a3a0e',
    leg: '#7a5418',
    iridescence: 0.6,
    roughness: 0.24,
    metalness: 0.4,
    pattern: 'gold',
    accents: ['#fff4c2'],
    glow: 0.8,
    aura: 'sparkles',
  },
  {
    // Via Láctea: rola-bostas se orientam pela faixa da galáxia nas noites sem lua.
    id: 'galaxy',
    rarity: 'legendary',
    unlock: { achievement: 'bury100' },
    elytra: '#120f33',
    pronotum: '#171342',
    belly: '#0a0820',
    leg: '#16123a',
    club: '#ffe9a8',
    iridescence: 0.4,
    roughness: 0.3,
    pattern: 'galaxy',
    accents: ['#c34bd6', '#3f7cff', '#ffffff'],
    glow: 1,
    aura: 'stars',
  },
  {
    // Amanhecer: a madrugada índigo virando dia no casco, como o menu do jogo.
    id: 'dawn',
    rarity: 'legendary',
    unlock: { achievement: 'level20' },
    elytra: '#ffbe4d',
    pronotum: '#ffc766',
    belly: '#2b2a5e',
    leg: '#3a2f6e',
    club: '#ffe7a3',
    iridescence: 0.6,
    roughness: 0.3,
    pattern: 'dawn',
    accents: ['#232163', '#7d58c4', '#ff9a7a'],
    glow: 1,
    aura: 'motes',
    auraColors: ['#ffc27a', '#ff9a7a', '#ffe7a3', '#c9a8ff'],
  },
];

const IDS = new Set<string>(SKINS.map((skin) => skin.id));
const BY_ID = new Map<SkinId, SkinDef>(SKINS.map((skin) => [skin.id, skin]));

export const DEFAULT_SKIN: SkinId = 'indigo';

export function isSkinId(value: string): value is SkinId {
  return IDS.has(value);
}

export function skin(id: SkinId): SkinDef {
  return BY_ID.get(id)!;
}

/** O desenho desse casco se mexe sozinho? */
export function isAnimatedSkin(def: SkinDef): boolean {
  return def.pattern !== undefined && ANIMATED_PATTERNS.has(def.pattern);
}

/** Cascos que a conquista `id` libera (pra avisar na hora). */
export function skinsUnlockedBy(id: AchievementId): SkinId[] {
  return unlockedByAchievement(SKINS, id).map((s) => s.id);
}

/** Cascos liberados ao subir do nível `from` para o `to`. */
export function skinsUnlockedByLevels(from: number, to: number): SkinId[] {
  return unlockedByLevels(SKINS, from, to).map((s) => s.id);
}
