/**
 * Protocolo do online: o que os besouros de uma sala dizem uns pros outros.
 *
 * Dois canais por conexão (WebRTC DataChannel):
 *   - `state`: sem garantia de entrega nem de ordem (tipo UDP). Só o retrato de
 *     cada jogador, 20 vezes por segundo, em binário. Perdeu um? O próximo chega
 *     50 ms depois; reenviar só atrasaria o resto.
 *   - `event`: confiável e em ordem. Tudo que não pode se perder (alguém engoliu
 *     a flor 12, o montinho 3 renasceu, fulano entrou), em JSON pequeno.
 *
 * Tudo que chega da rede é validado aqui antes de tocar no jogo: tipo, faixa e
 * tamanho. Mensagem torta é descartada em silêncio (um cliente modificado não
 * derruba a sala).
 */

/** Sobe quando o formato muda de um jeito que página velha não entende (a sala recusa quem difere). */
export const NET_PROTOCOL = 1;

/** Jogadores por sala (o banco confere o mesmo teto). */
export const MAX_PLAYERS = 6;

/** Retratos por segundo de cada jogador. */
export const SNAPSHOT_HZ = 20;

// --- Retrato (binário, canal `state`) ----------------------------------------------

/** Pose de um jogador num instante: o besouro e a bola que ele empurra. */
export interface PlayerSnapshot {
  /** Vaga do jogador na sala (0..5). O dono da sala regrava com a vaga da conexão (ninguém se passa por outro). */
  slot: number;
  /** Relógio da sala (segundos), no instante do retrato. */
  time: number;
  beetle: {
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
  };
  ball: {
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
  };
}

const SNAPSHOT_TAG = 1;
/** Tamanho fixo do retrato em bytes (conferido na leitura). */
export const SNAPSHOT_BYTES = 58;

const FLAG_GROUNDED = 1;
const FLAG_RIDING = 2;
const FLAG_BURYING = 4;

const i16 = (value: number, scale: number) => Math.max(-32767, Math.min(32767, Math.round(value * scale)));
const u8 = (value01: number) => Math.max(0, Math.min(255, Math.round(value01 * 255)));

/** Retrato → 58 bytes. `out` pode ser reaproveitado entre chamadas. */
export function encodeSnapshot(s: PlayerSnapshot, out = new ArrayBuffer(SNAPSHOT_BYTES)): ArrayBuffer {
  const v = new DataView(out);
  const b = s.beetle;
  const ball = s.ball;
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
  v.setUint8(24, (b.grounded ? FLAG_GROUNDED : 0) | (b.riding ? FLAG_RIDING : 0) | (ball.burying ? FLAG_BURYING : 0));
  v.setFloat32(25, ball.x);
  v.setFloat32(29, ball.y);
  v.setFloat32(33, ball.z);
  // Quatérnio normalizado: cada componente em [-1, 1] cabe num int16.
  v.setInt16(37, i16(ball.qx, 32767));
  v.setInt16(39, i16(ball.qy, 32767));
  v.setInt16(41, i16(ball.qz, 32767));
  v.setInt16(43, i16(ball.qw, 32767));
  v.setInt16(45, i16(ball.vx, 100));
  v.setInt16(47, i16(ball.vy, 100));
  v.setInt16(49, i16(ball.vz, 100));
  v.setUint16(51, Math.max(0, Math.min(65535, Math.round(ball.radius * 4000))));
  // 53..57: reservado (versões futuras ganham campo sem mudar o tamanho).
  v.setUint32(53, 0);
  v.setUint8(57, 0);
  return out;
}

/** 58 bytes → retrato, ou null se não for um retrato válido (tamanho, número fora do mundo). */
export function decodeSnapshot(data: ArrayBuffer): PlayerSnapshot | null {
  if (data.byteLength !== SNAPSHOT_BYTES) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== SNAPSHOT_TAG) return null;
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
      grounded: (flags & FLAG_GROUNDED) !== 0,
      riding: (flags & FLAG_RIDING) !== 0,
    },
    ball: {
      x: v.getFloat32(25),
      y: v.getFloat32(29),
      z: v.getFloat32(33),
      qx: v.getInt16(37) / 32767,
      qy: v.getInt16(39) / 32767,
      qz: v.getInt16(41) / 32767,
      qw: v.getInt16(43) / 32767,
      vx: v.getInt16(45) / 100,
      vy: v.getInt16(47) / 100,
      vz: v.getInt16(49) / 100,
      radius: v.getUint16(51) / 4000,
      burying: (flags & FLAG_BURYING) !== 0,
    },
  };
  if (s.slot >= MAX_PLAYERS || !Number.isFinite(s.time)) return null;
  if (!inWorld(s.beetle.x, s.beetle.y, s.beetle.z) || !inWorld(s.ball.x, s.ball.y, s.ball.z)) return null;
  // Raio fora do que o jogo permite (2 cm a 30 cm, com folga) = retrato forjado ou corrompido.
  if (s.ball.radius < 0.3 || s.ball.radius > 8) return null;
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

/** Clima (o dono da sala manda; os outros seguem). */
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
}

/**
 * Tudo que viaja no canal confiável. `from` é carimbado pelo dono da sala ao
 * repassar (o remetente não escolhe quem ele é).
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
  // Mundo: o que a bola de alguém pegou (o dono registra e repassa).
  | { t: 'absorb'; id: number; from?: string }
  | { t: 'loose'; id: number; from?: string }
  | { t: 'pile'; i: number; from?: string }
  | { t: 'debris'; i: number; from?: string }
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
  // Social / placar.
  | { t: 'bury'; cm: number; from?: string }
  | { t: 'newBall'; from?: string }
  | { t: 'look'; look: NetLook; from?: string };

export type NetEventType = NetEvent['t'];

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
    (w.weather === null || isWeather(w.weather))
  );
}

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
      return isInt(e.id, 0, 4096) ? { t: e.t, id: e.id, from } : null;
    case 'pile':
    case 'debris':
      return isInt(e.i, 0, 1023) ? { t: e.t, i: e.i, from } : null;
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
    case 'bury':
      return isNum(e.cm, 0, 40) ? { t: 'bury', cm: e.cm, from } : null;
    case 'newBall':
      return { t: 'newBall', from };
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
  'bury',
  'newBall',
  'look',
]);

/** Eventos de jogador que o dono repassa pros outros (carimbando `from`). */
export const RELAYED_EVENTS: ReadonlySet<NetEventType> = new Set<NetEventType>(['absorb', 'loose', 'pile', 'debris', 'bury', 'newBall', 'look']);
