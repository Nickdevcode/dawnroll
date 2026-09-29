import { isCatalogId, type CatalogId } from '../progression/catalog';
import { isHue, type Hue } from '../progression/colors';

/**
 * Protocolo do online: o que os besouros de uma sala dizem uns pros outros.
 *
 * Dois canais por conexão (WebRTC DataChannel):
 *   - `state`: sem garantia de entrega nem de ordem (tipo UDP). Só o retrato de
 *     cada jogador (o besouro e as bolas dele), 20 vezes por segundo, em
 *     binário. Perdeu um? O próximo chega 50 ms depois; reenviar só atrasaria o resto.
 *   - `event`: confiável e em ordem. Tudo que não pode se perder (alguém engoliu
 *     a flor 12, o montinho 3 renasceu, fulano pegou a bola de ciclano), em JSON pequeno.
 *
 * Cada bola tem um número (`id`) e um dono: quem simula ela. Roubar, engolir e
 * fundir são PEDIDOS ao dono da sala, que confere as regras (`rules.ts`) e
 * anuncia a decisão pra todo mundo.
 *
 * Tudo que chega da rede é validado aqui antes de tocar no jogo: tipo, faixa e
 * tamanho. Mensagem torta é descartada em silêncio (um cliente modificado não
 * derruba a sala).
 */

/** Sobe quando o formato muda de um jeito que página velha não entende (a sala recusa quem difere). */
export const NET_PROTOCOL = 2;

/** Jogadores por sala (o banco confere o mesmo teto). */
export const MAX_PLAYERS = 6;

/** Retratos por segundo de cada jogador. */
export const SNAPSHOT_HZ = 20;

/** Bolas num retrato: a que o jogador está fazendo + as dele que ficaram paradas no jardim. */
export const MAX_SNAPSHOT_BALLS = 4;

// --- Retrato (binário, canal `state`) ----------------------------------------------

export interface BeetlePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Velocidade horizontal (u/s) e vertical: animação das patas, pulo e queda. */
  speed: number;
  vy: number;
  pushBlend: number;
  strain: number;
  grounded: boolean;
  riding: boolean;
  /** Tonto (levou trombada). */
  dizzy: boolean;
}

export interface BallPose {
  /** Número da bola na sala (não muda quando ela troca de dono). */
  id: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  /** Afundando na toca (sem colisão; a pose vem do dono). */
  burying: boolean;
  /** O dono está empurrando (ou em cima dela). Bola sem isso por um tempo fica "solta". */
  pushed: boolean;
  /** Broto novo: ninguém pega nem engole ainda. */
  immune: boolean;
  /** O dono está segurando "fundir" encostado noutra bola: não pode ser engolida (a doação vem em menos de 1 s). */
  gift: boolean;
  /** 0..1: Sol excedente (o brilho a mais). */
  glow: number;
}

/** Ajudando a empurrar a bola de outro jogador: qual (0 = nenhuma) e a aceleração pedida (u/s²). */
export interface AssistPose {
  ball: number;
  ax: number;
  az: number;
}

/** Pose de um jogador num instante: o besouro, a ajuda no empurrão e as bolas dele. */
export interface PlayerSnapshot {
  /** Vaga do jogador na sala (0..5). O dono da sala regrava com a vaga da conexão (ninguém se passa por outro). */
  slot: number;
  /** Relógio da sala (segundos), no instante do retrato. */
  time: number;
  beetle: BeetlePose;
  assist: AssistPose;
  balls: BallPose[];
}

const SNAPSHOT_TAG = 2;
/** Cabeçalho (vaga, hora, besouro, ajuda, quantas bolas) e cada bola, em bytes. */
const HEADER_BYTES = 34;
const BALL_BYTES = 34;

export const snapshotBytes = (balls: number): number => HEADER_BYTES + BALL_BYTES * balls;

const BEETLE_GROUNDED = 1;
const BEETLE_RIDING = 2;
const BEETLE_DIZZY = 4;
const BALL_BURYING = 1;
const BALL_PUSHED = 2;
const BALL_IMMUNE = 4;
const BALL_GIFT = 8;

const i16 = (value: number, scale: number) => Math.max(-32767, Math.min(32767, Math.round(value * scale)));
const u8 = (value01: number) => Math.max(0, Math.min(255, Math.round(value01 * 255)));

/** Um buffer por quantidade de bolas (reaproveitados: o canal copia na hora de mandar). */
const outBuffers: ArrayBuffer[] = [];

/** Retrato → bytes. O buffer devolvido é reaproveitado na próxima chamada com o mesmo número de bolas. */
export function encodeSnapshot(s: PlayerSnapshot): ArrayBuffer {
  const n = Math.min(s.balls.length, MAX_SNAPSHOT_BALLS);
  const out = (outBuffers[n] ??= new ArrayBuffer(snapshotBytes(n)));
  const v = new DataView(out);
  const b = s.beetle;
  v.setUint8(0, SNAPSHOT_TAG);
  v.setUint8(1, s.slot);
  v.setFloat32(2, s.time);
  v.setFloat32(6, b.x);
  v.setFloat32(10, b.y);
  v.setFloat32(14, b.z);
  v.setInt16(18, i16(wrapAngle(b.yaw), 32767 / Math.PI));
  v.setUint8(20, Math.max(0, Math.min(255, Math.round(b.speed * 20))));
  v.setInt8(21, Math.max(-127, Math.min(127, Math.round(b.vy * 4))));
  v.setUint8(22, u8(b.pushBlend));
  v.setUint8(23, u8(b.strain));
  v.setUint8(24, (b.grounded ? BEETLE_GROUNDED : 0) | (b.riding ? BEETLE_RIDING : 0) | (b.dizzy ? BEETLE_DIZZY : 0));
  v.setUint32(25, s.assist.ball >>> 0);
  v.setInt16(29, i16(s.assist.ax, 100));
  v.setInt16(31, i16(s.assist.az, 100));
  v.setUint8(33, n);
  for (let i = 0; i < n; i++) {
    const ball = s.balls[i];
    const o = HEADER_BYTES + i * BALL_BYTES;
    v.setUint32(o, ball.id >>> 0);
    v.setFloat32(o + 4, ball.x);
    v.setFloat32(o + 8, ball.y);
    v.setFloat32(o + 12, ball.z);
    // Quatérnio normalizado: cada componente em [-1, 1] cabe num int16.
    v.setInt16(o + 16, i16(ball.qx, 32767));
    v.setInt16(o + 18, i16(ball.qy, 32767));
    v.setInt16(o + 20, i16(ball.qz, 32767));
    v.setInt16(o + 22, i16(ball.qw, 32767));
    v.setInt16(o + 24, i16(ball.vx, 100));
    v.setInt16(o + 26, i16(ball.vy, 100));
    v.setInt16(o + 28, i16(ball.vz, 100));
    v.setUint16(o + 30, Math.max(0, Math.min(65535, Math.round(ball.radius * 4000))));
    v.setUint8(o + 32, (ball.burying ? BALL_BURYING : 0) | (ball.pushed ? BALL_PUSHED : 0) | (ball.immune ? BALL_IMMUNE : 0) | (ball.gift ? BALL_GIFT : 0));
    v.setUint8(o + 33, u8(ball.glow));
  }
  return out;
}

/** Bytes → retrato, ou null se não for um retrato válido (tamanho, número fora do mundo, bola repetida). */
export function decodeSnapshot(data: ArrayBuffer): PlayerSnapshot | null {
  if (data.byteLength < HEADER_BYTES) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== SNAPSHOT_TAG) return null;
  const n = v.getUint8(33);
  if (n > MAX_SNAPSHOT_BALLS || data.byteLength !== snapshotBytes(n)) return null;
  const flags = v.getUint8(24);
  const s: PlayerSnapshot = {
    slot: v.getUint8(1),
    time: v.getFloat32(2),
    beetle: {
      x: v.getFloat32(6),
      y: v.getFloat32(10),
      z: v.getFloat32(14),
      yaw: (v.getInt16(18) * Math.PI) / 32767,
      speed: v.getUint8(20) / 20,
      vy: v.getInt8(21) / 4,
      pushBlend: v.getUint8(22) / 255,
      strain: v.getUint8(23) / 255,
      grounded: (flags & BEETLE_GROUNDED) !== 0,
      riding: (flags & BEETLE_RIDING) !== 0,
      dizzy: (flags & BEETLE_DIZZY) !== 0,
    },
    assist: { ball: v.getUint32(25), ax: v.getInt16(29) / 100, az: v.getInt16(31) / 100 },
    balls: [],
  };
  if (s.slot >= MAX_PLAYERS || !Number.isFinite(s.time)) return null;
  if (!inWorld(s.beetle.x, s.beetle.y, s.beetle.z)) return null;
  for (let i = 0; i < n; i++) {
    const o = HEADER_BYTES + i * BALL_BYTES;
    const ballFlags = v.getUint8(o + 32);
    const ball: BallPose = {
      id: v.getUint32(o),
      x: v.getFloat32(o + 4),
      y: v.getFloat32(o + 8),
      z: v.getFloat32(o + 12),
      qx: v.getInt16(o + 16) / 32767,
      qy: v.getInt16(o + 18) / 32767,
      qz: v.getInt16(o + 20) / 32767,
      qw: v.getInt16(o + 22) / 32767,
      vx: v.getInt16(o + 24) / 100,
      vy: v.getInt16(o + 26) / 100,
      vz: v.getInt16(o + 28) / 100,
      radius: v.getUint16(o + 30) / 4000,
      burying: (ballFlags & BALL_BURYING) !== 0,
      pushed: (ballFlags & BALL_PUSHED) !== 0,
      immune: (ballFlags & BALL_IMMUNE) !== 0,
      gift: (ballFlags & BALL_GIFT) !== 0,
      glow: v.getUint8(o + 33) / 255,
    };
    if (ball.id === 0 || !inWorld(ball.x, ball.y, ball.z)) return null;
    // Raio fora do que o jogo permite (2 cm a 30 cm, com folga) = retrato forjado ou corrompido.
    if (ball.radius < 0.3 || ball.radius > 8) return null;
    if (s.balls.some((other) => other.id === ball.id)) return null;
    s.balls.push(ball);
  }
  return s;
}

/** Regrava a vaga de um retrato já codificado (o dono da sala carimba com a vaga da conexão). */
export function stampSnapshotSlot(data: ArrayBuffer, slot: number): void {
  new DataView(data).setUint8(1, slot);
}

/** Dentro de uma caixa generosa em volta do jardim (o horizonte fica a ~100 u). */
function inWorld(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Math.abs(x) < 200 && Math.abs(z) < 200 && y > -60 && y < 120;
}

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r < -Math.PI) r += twoPi;
  return r;
}

// --- Eventos (JSON, canal `event`) --------------------------------------------------

/** O visual de um jogador (o casco e os 4 acessórios; validados contra o catálogo na chegada). */
export interface NetLook {
  skin: string;
  head: string | null;
  face: string | null;
  neck: string | null;
  back: string | null;
}

export interface NetMember {
  uid: string;
  slot: number;
  nick: string;
  look: NetLook;
  /** Relógio da sala em que entrou (ordem de chegada = quem assume se o dono cair). */
  joinedAt: number;
}

/** Estado de um montinho de bosta: semente de onde ele está, se é fresquinho e se está no chão. */
export interface NetPile {
  seed: number;
  fresh: boolean;
  gone: boolean;
}

/** Clima (o dono manda; os outros seguem). */
export interface NetWeather {
  phase: string;
  timer: number;
  duration: number;
  time: number;
  event: { peak: number; cover: number; length: number; stormy: boolean };
  overcast: number;
  rain: number;
  wetness: number;
  puddleFill: number;
}

/** Regras da sala (o dono escolhe na placa da sala). */
export interface NetRules {
  /** Roubar bola solta, trombada e engolir bola alheia valem. */
  steal: boolean;
}

export const DEFAULT_RULES: NetRules = { steal: true };

/** Tudo do mundo compartilhado que quem chega precisa pra ver o mesmo jardim. */
export interface NetWorld {
  seed: number;
  /** Arrancáveis que já foram engolidos (somem da cena). */
  gone: number[];
  /** Bolas de tênis engolidas. */
  looseGone: number[];
  piles: NetPile[];
  /** Semente de cada vaga de tralha no chão. */
  debris: number[];
  weather: NetWeather | null;
  rules: NetRules;
}

/** Por que uma bola saiu do jogo (o dono avisa). */
export type GoneReason = 'buried' | 'crumble' | 'merged' | 'left';

/** Por que uma bola mudou de dono. */
export type OwnReason = 'grab' | 'tackle';

/**
 * Tudo que viaja no canal confiável. `from` é carimbado pelo dono da sala ao
 * repassar (o remetente não escolhe quem ele é). `b` é o número de uma bola.
 */
export type NetEvent =
  // Quem chega se apresenta; o dono responde com a vaga e o mundo.
  | { t: 'hello'; v: number; uid: string; nick: string; look: NetLook }
  | { t: 'welcome'; slot: number; hostTime: number; members: NetMember[]; world: NetWorld }
  | { t: 'join'; member: NetMember }
  | { t: 'leave'; uid: string }
  | { t: 'bye' }
  // Relógio da sala.
  | { t: 'ping'; c: number }
  | { t: 'pong'; c: number; h: number }
  // Mundo: o que a bola `b` de alguém pegou (o dono registra e repassa).
  | { t: 'absorb'; id: number; b: number; from?: string }
  | { t: 'loose'; id: number; b: number; from?: string }
  | { t: 'pile'; i: number; b: number; from?: string }
  | { t: 'debris'; i: number; b: number; from?: string }
  // Mundo: o que o dono decide (renascer, rebrotar, clima, jardim novo).
  | { t: 'pileSpawn'; i: number; seed: number; fresh: boolean }
  | { t: 'promote'; i: number[] }
  | { t: 'debrisSpawn'; i: number; seed: number }
  | { t: 'regrow'; id: number }
  | { t: 'weather'; w: NetWeather }
  | { t: 'thunder'; d: number }
  | { t: 'garden'; seed: number }
  // Pedidos ao dono (poderes que mexem no mundo de todo mundo).
  | { t: 'rain'; long: boolean; from?: string }
  | { t: 'nose'; from?: string }
  // Bolas: o que tem dentro (dono da bola → todos), saiu do jogo, foi enterrada.
  | { t: 'ball'; b: number; c: Array<[CatalogId, number]>; h: Array<[Hue, number]>; k: Array<[string, number]>; d: number; i: number; from?: string }
  | { t: 'gone'; b: number; why: GoneReason; from?: string }
  | { t: 'bury'; b: number; cm: number; food: number; sun: number; s: Array<[string, number]>; from?: string }
  // Pedidos ao dono da sala (ele confere as regras e decide).
  | { t: 'claim'; b: number; from?: string }
  | { t: 'tackle'; target: string; from?: string }
  | { t: 'swallow'; b: number; target: number; from?: string }
  | { t: 'merge'; b: number; target: number; from?: string }
  // Decisões do dono da sala.
  | { t: 'own'; b: number; to: string; prev: string; why: OwnReason }
  | { t: 'tackled'; by: string; target: string; b: number }
  | { t: 'swallowed'; b: number; into: number; by: string }
  | { t: 'merged'; b: number; into: number; by: string }
  | { t: 'rules'; rules: NetRules }
  // Social.
  | { t: 'emote'; e: number; x?: number; z?: number; from?: string }
  | { t: 'look'; look: NetLook; from?: string };

export type NetEventType = NetEvent['t'];

/** Reações rápidas (a roda): quantas existem. A 8ª ("Aqui!") marca um ponto no chão. */
export const EMOTE_COUNT = 8;
export const EMOTE_HERE = 7;

/** Maior evento aceito (o `welcome` com o mundo inteiro fica bem abaixo disso). */
const MAX_EVENT_CHARS = 64 * 1024;
const LOOK_ID = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isUid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
const isIntList = (v: unknown, max: number, limit: number): v is number[] => Array.isArray(v) && v.length <= limit && v.every((n) => isInt(n, 0, max));
const isSlotId = (v: unknown): v is string | null => v === null || (typeof v === 'string' && LOOK_ID.test(v));
/** Número de bola: qualquer inteiro de 32 bits menos zero (zero = "nenhuma"). */
const isBallId = (v: unknown): v is number => isInt(v, 1, 0xffffffff);

function isLook(v: unknown): v is NetLook {
  if (!v || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  return typeof l.skin === 'string' && LOOK_ID.test(l.skin) && isSlotId(l.head) && isSlotId(l.face) && isSlotId(l.neck) && isSlotId(l.back);
}

function isMember(v: unknown): v is NetMember {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return isUid(m.uid) && isInt(m.slot, 0, MAX_PLAYERS - 1) && isStr(m.nick, 40) && isLook(m.look) && isNum(m.joinedAt, -1, 1e9);
}

function isWeather(v: unknown): v is NetWeather {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  const e = w.event as Record<string, unknown> | undefined;
  return (
    isStr(w.phase, 16) &&
    isNum(w.timer, 0, 1e5) &&
    isNum(w.duration, 0, 1e5) &&
    isNum(w.time, 0, 1e9) &&
    !!e &&
    isNum(e.peak, 0, 1) &&
    isNum(e.cover, 0, 1) &&
    isNum(e.length, 0, 1e4) &&
    isBool(e.stormy) &&
    isNum(w.overcast, 0, 1) &&
    isNum(w.rain, 0, 1) &&
    isNum(w.wetness, 0, 1) &&
    isNum(w.puddleFill, 0, 1)
  );
}

function isRules(v: unknown): v is NetRules {
  return !!v && typeof v === 'object' && isBool((v as NetRules).steal);
}

function isWorld(v: unknown): v is NetWorld {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    isInt(w.seed, 0, 0xffffffff) &&
    isIntList(w.gone, 4096, 4096) &&
    isIntList(w.looseGone, 64, 64) &&
    Array.isArray(w.piles) &&
    w.piles.length <= 256 &&
    w.piles.every((p) => !!p && isInt((p as NetPile).seed, 0, 0xffffffff) && isBool((p as NetPile).fresh) && isBool((p as NetPile).gone)) &&
    isIntList(w.debris, 0xffffffff, 1024) &&
    (w.weather === null || isWeather(w.weather)) &&
    isRules(w.rules)
  );
}

/** Lista de pares [chave, número] (conteúdo da bola, parte de cada um), com chave conferida. */
function isPairs<K extends string>(v: unknown, isKey: (k: unknown) => k is K, limit: number, max: number): v is Array<[K, number]> {
  return Array.isArray(v) && v.length <= limit && v.every((p) => Array.isArray(p) && p.length === 2 && isKey(p[0]) && isNum(p[1], 0, max));
}

const isCatalogKey = (k: unknown): k is CatalogId => typeof k === 'string' && isCatalogId(k);

/**
 * Texto que chegou da rede → evento validado (ou null). Campos a mais são
 * ignorados; faltando ou fora da faixa, descarta.
 */
export function parseEvent(text: string): NetEvent | null {
  if (text.length > MAX_EVENT_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const from = e.from === undefined || isUid(e.from) ? (e.from as string | undefined) : null;
  if (from === null) return null;
  switch (e.t) {
    case 'hello':
      return isInt(e.v, 1, 1000) && isUid(e.uid) && isStr(e.nick, 40) && isLook(e.look) ? { t: 'hello', v: e.v, uid: e.uid, nick: e.nick, look: e.look } : null;
    case 'welcome':
      return isInt(e.slot, 0, MAX_PLAYERS - 1) && isNum(e.hostTime, 0, 1e9) && Array.isArray(e.members) && e.members.length <= MAX_PLAYERS && e.members.every(isMember) && isWorld(e.world)
        ? { t: 'welcome', slot: e.slot, hostTime: e.hostTime, members: e.members, world: e.world }
        : null;
    case 'join':
      return isMember(e.member) ? { t: 'join', member: e.member } : null;
    case 'leave':
      return isUid(e.uid) ? { t: 'leave', uid: e.uid } : null;
    case 'bye':
      return { t: 'bye' };
    case 'ping':
      return isNum(e.c, 0, 1e12) ? { t: 'ping', c: e.c } : null;
    case 'pong':
      return isNum(e.c, 0, 1e12) && isNum(e.h, 0, 1e9) ? { t: 'pong', c: e.c, h: e.h } : null;
    case 'absorb':
    case 'loose':
      return isInt(e.id, 0, 4096) && isBallId(e.b) ? { t: e.t, id: e.id, b: e.b, from } : null;
    case 'pile':
    case 'debris':
      return isInt(e.i, 0, 1023) && isBallId(e.b) ? { t: e.t, i: e.i, b: e.b, from } : null;
    case 'pileSpawn':
      return isInt(e.i, 0, 255) && isInt(e.seed, 0, 0xffffffff) && isBool(e.fresh) ? { t: 'pileSpawn', i: e.i, seed: e.seed, fresh: e.fresh } : null;
    case 'promote':
      return isIntList(e.i, 255, 32) ? { t: 'promote', i: e.i } : null;
    case 'debrisSpawn':
      return isInt(e.i, 0, 1023) && isInt(e.seed, 0, 0xffffffff) ? { t: 'debrisSpawn', i: e.i, seed: e.seed } : null;
    case 'regrow':
      return isInt(e.id, 0, 4096) ? { t: 'regrow', id: e.id } : null;
    case 'weather':
      return isWeather(e.w) ? { t: 'weather', w: e.w } : null;
    case 'thunder':
      return isNum(e.d, 0, 1) ? { t: 'thunder', d: e.d } : null;
    case 'garden':
      return isInt(e.seed, 0, 0xffffffff) ? { t: 'garden', seed: e.seed } : null;
    case 'rain':
      return isBool(e.long) ? { t: 'rain', long: e.long, from } : null;
    case 'nose':
      return { t: 'nose', from };
    case 'ball':
      // Tetos folgados pro que uma bola de verdade junta (centenas de coisas), bem abaixo de "infinito".
      return isBallId(e.b) &&
        isPairs(e.c, isCatalogKey, 128, 5000) &&
        isPairs(e.h, isHue, 16, 5000) &&
        isPairs(e.k, isUid, MAX_PLAYERS * 4, 1e5) &&
        isInt(e.d, 0, 1e5) &&
        isInt(e.i, 0, 1e5)
        ? { t: 'ball', b: e.b, c: e.c, h: e.h, k: e.k, d: e.d, i: e.i, from }
        : null;
    case 'gone':
      return isBallId(e.b) && (e.why === 'buried' || e.why === 'crumble' || e.why === 'merged' || e.why === 'left') ? { t: 'gone', b: e.b, why: e.why, from } : null;
    case 'bury':
      return isBallId(e.b) && isNum(e.cm, 0, 40) && isNum(e.food, 0, 1e5) && isNum(e.sun, 0, 400) && isPairs(e.s, isUid, MAX_PLAYERS * 4, 1)
        ? { t: 'bury', b: e.b, cm: e.cm, food: e.food, sun: e.sun, s: e.s, from }
        : null;
    case 'claim':
      return isBallId(e.b) ? { t: 'claim', b: e.b, from } : null;
    case 'tackle':
      return isUid(e.target) ? { t: 'tackle', target: e.target, from } : null;
    case 'swallow':
    case 'merge':
      return isBallId(e.b) && isBallId(e.target) && e.b !== e.target ? { t: e.t, b: e.b, target: e.target, from } : null;
    case 'own':
      return isBallId(e.b) && isUid(e.to) && isUid(e.prev) && (e.why === 'grab' || e.why === 'tackle') ? { t: 'own', b: e.b, to: e.to, prev: e.prev, why: e.why } : null;
    case 'tackled':
      return isUid(e.by) && isUid(e.target) && isInt(e.b, 0, 0xffffffff) ? { t: 'tackled', by: e.by, target: e.target, b: e.b } : null;
    case 'swallowed':
    case 'merged':
      return isBallId(e.b) && isBallId(e.into) && isUid(e.by) ? { t: e.t, b: e.b, into: e.into, by: e.by } : null;
    case 'rules':
      return isRules(e.rules) ? { t: 'rules', rules: { steal: e.rules.steal } } : null;
    case 'emote':
      if (!isInt(e.e, 0, EMOTE_COUNT - 1)) return null;
      if (e.x === undefined && e.z === undefined) return { t: 'emote', e: e.e, from };
      return isNum(e.x, -200, 200) && isNum(e.z, -200, 200) ? { t: 'emote', e: e.e, x: e.x, z: e.z, from } : null;
    case 'look':
      return isLook(e.look) ? { t: 'look', look: e.look, from } : null;
    default:
      return null;
  }
}

/** Eventos que um jogador comum pode mandar pro dono (o resto é só do dono). */
export const CLIENT_EVENTS: ReadonlySet<NetEventType> = new Set<NetEventType>([
  'hello',
  'bye',
  'ping',
  'absorb',
  'loose',
  'pile',
  'debris',
  'rain',
  'nose',
  'ball',
  'gone',
  'bury',
  'claim',
  'tackle',
  'swallow',
  'merge',
  'emote',
  'look',
]);

/** Eventos de jogador que o dono repassa pros outros (carimbando `from`). Os pedidos (roubar, engolir...) ele decide e anuncia. */
export const RELAYED_EVENTS: ReadonlySet<NetEventType> = new Set<NetEventType>(['absorb', 'loose', 'pile', 'debris', 'ball', 'gone', 'bury', 'emote', 'look']);
