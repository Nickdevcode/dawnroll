import type { NetEvent, NetMember, NetRules, NetWorld, RoomModeId } from './protocol';
import {
  AUTO_START_SECONDS,
  COUNTDOWN_SECONDS,
  END_GRACE_SECONDS,
  MAX_BOARD,
  PODIUM_SECONDS,
  burialPoints,
  creditBurial,
  idleMatch,
  isSunset,
  matchView,
  scoringOpen,
  startOrder,
  startSpot,
  winners,
  type MatchEntry,
  type MatchView,
  type NetMatch,
} from './match';
import { arrangeTeams, autoTeamSize, canJoinTeam, pickTeam, shuffleTeams, type TeamMap } from './teams';
import { newBallId, relation } from './rules';

/**
 * Os times e a Disputa de uma sala viva.
 *
 * O dono da sala conduz: distribui os times, começa a partida (sozinho, na
 * sala pública), vira as fases no relógio da sala, soma os pontos de cada
 * enterro e as façanhas (roubo, fusão) e manda tudo pra sala a cada mudança
 * (`teams`, `match`). Todo mundo (o dono inclusive) olha a fase no relógio da
 * sala e avisa o jogo quando ela muda: a contagem arruma o jardim e a
 * largada, o fim trava o besouro, o pódio mostra o resultado.
 *
 * Quem assume a sala no meio continua do último estado que recebeu: o
 * relógio da sala não muda de dono pra dono.
 */

/** O que o diretor precisa da sala. */
export interface MatchRoom {
  readonly selfId: string;
  readonly isHost: boolean;
  /** Sala pública (procurar partida): a Disputa começa e recomeça sozinha. */
  readonly isPublic: boolean;
  now(): number;
  send(event: NetEvent): void;
  /** Quem está na sala, por ordem de chegada. */
  members(): readonly NetMember[];
  /** As regras escolhidas pelo dono (sem o "roubo sempre ligado" da Disputa). */
  rules(): NetRules;
  /** Só o dono: muda as regras (e avisa a sala). */
  setRules(rules: NetRules): void;
  /** Só o dono: conta pro banco o modo e se a Disputa está rolando. */
  roomState(mode: RoomModeId, status: 'open' | 'playing'): void;
}

/** O que o diretor avisa o jogo. */
export interface MatchGame {
  /** Partida nova (contagem ou entrou no meio): jardim da semente, bolas zeradas, besouro na largada. */
  matchSetup(seed: number, spot: { x: number; z: number; yaw: number }): void;
  /** A fase vista mudou (contagem, valendo, tempo esgotado, pódio, livre). */
  matchView(view: MatchView, prev: MatchView): void;
  /** Resultado anunciado (uma vez por partida): você ganhou? */
  matchResult(match: NetMatch, won: boolean): void;
  /** Placar ou times mudaram (a interface redesenha). */
  matchChanged(): void;
}

export class MatchDirector {
  private _teams: TeamMap = new Map();
  private _match: NetMatch = idleMatch();
  private _view: MatchView = 'idle';
  private setupRound = -1;
  private resultRound = -1;
  /** Resultado da última partida (o cartão continua mostrando depois que o pódio acaba). */
  private _lastResult: NetMatch | null = null;

  constructor(
    private readonly room: MatchRoom,
    private readonly game: MatchGame,
  ) {}

  // --- Leitura ------------------------------------------------------------------------------

  get teams(): ReadonlyMap<string, number> {
    return this._teams;
  }

  get match(): Readonly<NetMatch> {
    return this._match;
  }

  get lastResult(): Readonly<NetMatch> | null {
    return this._lastResult;
  }

  /** A fase como o jogador vê agora. */
  get view(): MatchView {
    return this._view;
  }

  /** Partida valendo ou na contagem (atributos iguais, placar na tela). */
  get running(): boolean {
    return this._match.phase === 'countdown' || this._match.phase === 'playing';
  }

  /** O besouro fica parado: contagem, tempo esgotado esperando o resultado e o pódio. */
  get inputLocked(): boolean {
    const v = this._view;
    return v === 'countdown' || v === 'overtime' || v === 'ended';
  }

  /** Pontos que o enterro de agora renderia (pro aviso na tela): null fora da partida. */
  burialPreview(cm: number, sunCm: number): { points: number; sunset: boolean } | null {
    const now = this.room.now();
    if (!scoringOpen(this._match, now)) return null;
    const sunset = isSunset(this._match, now);
    return { points: burialPoints(cm, sunCm, sunset), sunset };
  }

  /** Pro "welcome" de quem chega. */
  worldPart(): Pick<NetWorld, 'teams' | 'match'> {
    return { teams: [...this._teams], match: structuredClone(this._match) };
  }

  // --- Ações (interface) ------------------------------------------------------------------------

  /** Dono: começa a Disputa (a contagem já sai). Precisa de pelo menos 2 besouros. */
  start(): boolean {
    const room = this.room;
    const rules = room.rules();
    const m = this._match;
    if (!room.isHost || rules.mode !== 'match' || this.running) return false;
    const members = room.members();
    if (members.length < 2) return false;
    const order = members.map((mem) => mem.uid);
    let size = rules.teamSize;
    // Sala pública: o tamanho do time sai de quantos estão (4 ou 6 = duplas).
    if (room.isPublic) {
      size = autoTeamSize(members.length);
      if (size !== rules.teamSize) room.setRules({ ...rules, teamSize: size });
    }
    this._teams = arrangeTeams(order, size, this._teams);
    this.sendTeams();
    const now = room.now();
    const board: MatchEntry[] = members.map((mem) => this.entryFor(mem, size));
    const startsAt = now + COUNTDOWN_SECONDS;
    this._match = { phase: 'countdown', round: m.round + 1, seed: newBallId(), startsAt, endsAt: startsAt + rules.minutes * 60, until: 0, teamSize: size, board };
    this.sendMatch();
    room.roomState('match', 'playing');
    return true;
  }

  /** Pedir pra ir pro time `team` (o dono decide na hora; os outros pedem pra ele). */
  chooseTeam(team: number): void {
    if (this.room.isHost) this.applyTeamRequest(this.room.selfId, team);
    else this.room.send({ t: 'team', team });
  }

  /** Dono: embaralha os times (fora da partida). */
  shuffle(): void {
    const rules = this.room.rules();
    if (!this.room.isHost || this.running || rules.teamSize === 1) return;
    this._teams = shuffleTeams(
      this.room.members().map((m) => m.uid),
      rules.teamSize,
    );
    this.sendTeams();
  }

  /** Dono: as regras mudaram (tamanho do time redistribui; sair da Disputa encerra a partida). */
  rulesChanged(prev: NetRules, next: NetRules): void {
    if (!this.room.isHost) return;
    if (prev.teamSize !== next.teamSize) {
      this._teams = arrangeTeams(
        this.room.members().map((m) => m.uid),
        next.teamSize,
        this._teams,
      );
      this.sendTeams();
    }
    if (prev.mode !== next.mode) {
      if (next.mode === 'garden' && this._match.phase !== 'idle') {
        this._match = idleMatch(this._match.round);
        this.sendMatch();
      }
      this.room.roomState(next.mode, this.running ? 'playing' : 'open');
    }
  }

  // --- Ciclo da sala --------------------------------------------------------------------------

  /** Saiu da sala: tudo volta ao começo. */
  reset(): void {
    this._teams = new Map();
    this._match = idleMatch();
    this._view = 'idle';
    this.setupRound = -1;
    this.resultRound = -1;
    this._lastResult = null;
  }

  /** Entrou (ou reentrou): times e partida do dono; sala nova = do zero. */
  welcome(world: NetWorld | null): void {
    if (!world) {
      this.reset();
      return;
    }
    this._teams = new Map(world.teams);
    this._match = world.match;
    this.game.matchChanged();
  }

  /** Dono: alguém chegou. Ganha um time (o com menos gente) e, com a Disputa rolando, uma linha no placar. */
  memberJoined(member: NetMember): void {
    if (!this.room.isHost) return;
    const size = this.room.rules().teamSize;
    if (size > 1 && !this._teams.has(member.uid)) {
      const team = pickTeam(this._teams, size, this.room.members().length);
      if (team >= 0) this._teams.set(member.uid, team);
      this.sendTeams();
    }
    const m = this._match;
    if (this.running && !m.board.some((e) => e.uid === member.uid) && m.board.length < MAX_BOARD) {
      m.board.push(this.entryFor(member, m.teamSize));
      this.sendMatch();
    }
  }

  /** Dono: alguém saiu. Fora da partida a vaga no time libera; o placar guarda o que ele fez. */
  memberLeft(uid: string): void {
    if (!this.room.isHost || this.running || !this._teams.delete(uid)) return;
    this.sendTeams();
  }

  /** Virei o dono no meio: o banco fica sabendo do estado atual. */
  becameHost(): void {
    this.room.roomState(this.room.rules().mode, this.running ? 'playing' : 'open');
  }

  /** Eventos de time e de partida. Devolve se era dele. */
  onEvent(event: NetEvent, from: string): boolean {
    switch (event.t) {
      case 'team':
        if (this.room.isHost) this.applyTeamRequest(from, event.team);
        return true;
      case 'teams':
        if (!this.room.isHost) {
          this._teams = new Map(event.m);
          this.game.matchChanged();
        }
        return true;
      case 'match':
        if (!this.room.isHost) {
          this._match = event.m;
          this.game.matchChanged();
        }
        return true;
      default:
        return false;
    }
  }

  /** Dono: uma bola foi enterrada (`shares` = parte de cada um). Na partida, vira ponto. */
  noteBurial(burier: string, cm: number, sunCm: number, shares: ReadonlyArray<readonly [string, number]>): void {
    const m = this._match;
    const now = this.room.now();
    if (!this.room.isHost || !scoringOpen(m, now)) return;
    creditBurial(m.board, burier, cm, burialPoints(cm, sunCm, isSunset(m, now)), shares);
    this.sendMatch();
  }

  /** Dono: uma decisão dele (roubo, engolida, puxada, fusão) conta pros destaques. */
  noteDecision(event: NetEvent): void {
    const m = this._match;
    if (!this.room.isHost || !scoringOpen(m, this.room.now())) return;
    let who: string | null = null;
    let field: 'steals' | 'gifts' = 'steals';
    if (event.t === 'own' && relation(event.to, event.prev, this._teams) === 'rival') who = event.to;
    else if (event.t === 'swallowed' || event.t === 'pulled') who = event.by;
    else if (event.t === 'merged') {
      who = event.by;
      field = 'gifts';
    }
    const entry = who ? m.board.find((e) => e.uid === who) : undefined;
    if (!entry) return;
    entry[field]++;
    this.sendMatch();
  }

  // --- Relógio ------------------------------------------------------------------------------

  /**
   * A cada quadro (e num intervalo, pra aba escondida do dono): o dono vira as
   * fases; todo mundo avisa o jogo quando a fase vista muda.
   */
  update(): void {
    const now = this.room.now();
    if (this.room.isHost) this.hostTick(now);
    const m = this._match;
    const view = matchView(m, now);
    // Resultado novo: guarda antes de avisar a fase (o pódio e o cartão já leem ele).
    const result = m.phase === 'ended' && m.round !== this.resultRound;
    if (result) {
      this.resultRound = m.round;
      this._lastResult = structuredClone(m);
    }
    if (view !== this._view) {
      const prev = this._view;
      this._view = view;
      this.game.matchView(view, prev);
    }
    // Partida nova (contagem, ou entrou no meio dela): arruma o jardim e a largada, uma vez só.
    if ((m.phase === 'countdown' || (m.phase === 'playing' && view === 'playing')) && m.round !== this.setupRound) {
      this.setupRound = m.round;
      const order = startOrder(m.board);
      let index = order.indexOf(this.room.selfId);
      if (index < 0) index = order.length;
      this.game.matchSetup(m.seed, startSpot(index, Math.max(order.length, index + 1)));
    }
    // Quem nem jogou esta partida (chegou no pódio) não ganha nada.
    if (result && m.board.some((e) => e.uid === this.room.selfId)) this.game.matchResult(m, winners(m).has(this.room.selfId));
  }

  private hostTick(now: number): void {
    const m = this._match;
    const rules = this.room.rules();
    switch (m.phase) {
      case 'idle': {
        // Sala pública de Disputa: com 2 ou mais, começa sozinha depois do aquecimento.
        const auto = rules.mode === 'match' && this.room.isPublic && this.room.members().length >= 2;
        if (auto && m.until === 0) {
          m.until = now + AUTO_START_SECONDS;
          this.sendMatch();
        } else if (!auto && m.until !== 0) {
          m.until = 0;
          this.sendMatch();
        } else if (auto && now >= m.until) this.start();
        return;
      }
      case 'countdown':
        if (now < m.startsAt) return;
        m.phase = 'playing';
        this.sendMatch();
        return;
      case 'playing':
        if (now < m.endsAt + END_GRACE_SECONDS) return;
        m.phase = 'ended';
        m.until = now + PODIUM_SECONDS;
        this.sendMatch();
        this.room.roomState('match', 'open');
        return;
      case 'ended':
        if (now < m.until) return;
        this._match = { ...idleMatch(m.round), seed: m.seed };
        this.sendMatch();
        // Quem saiu no meio da partida larga a vaga no time; o resto fica equilibrado.
        this._teams = arrangeTeams(
          this.room.members().map((mem) => mem.uid),
          rules.teamSize,
          this._teams,
        );
        this.sendTeams();
        return;
    }
  }

  private applyTeamRequest(uid: string, team: number): void {
    const size = this.room.rules().teamSize;
    if (this.running || !canJoinTeam(this._teams, uid, team, size) || !this.room.members().some((m) => m.uid === uid)) return;
    this._teams.set(uid, team);
    this.sendTeams();
  }

  private entryFor(member: NetMember, size: number): MatchEntry {
    const team = size > 1 ? (this._teams.get(member.uid) ?? -1) : -1;
    return { uid: member.uid, nick: member.nick, slot: member.slot, team, points: 0, best: 0, steals: 0, gifts: 0 };
  }

  private sendTeams(): void {
    this.room.send({ t: 'teams', m: [...this._teams] });
    this.game.matchChanged();
  }

  private sendMatch(): void {
    this.room.send({ t: 'match', m: structuredClone(this._match) });
    this.game.matchChanged();
  }
}
