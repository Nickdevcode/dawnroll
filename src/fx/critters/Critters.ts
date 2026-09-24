import * as THREE from 'three';
import { createRng } from '../../utils/math';
import { terrainHeight } from '../../world/Terrain';
import type { ZoneSite } from '../../world/zones';
import { Butterflies, Bees, Dragonflies } from './flyers';
import { PillBugs, SmallBeetles, Snails } from './crawlers';
import { AntColonies } from './ants';
import { Frogs, Grasshoppers } from './hoppers';
import { Earthworms } from './worms';
import { Centipedes, Earwigs } from './underRock';
import { StickInsects } from './stickInsects';
import { Caterpillars } from './caterpillars';
import { Slugs } from './slugs';
import { FlyingAnts } from './swarm';
import { Spiders } from './spiders';
import { Hummingbird } from './hummingbird';
import { ladybugBody, ladybugElytron, LadybugPalettes, LADYBUG_RIG } from './groundModels';
import { leafBeetleBody, leafBeetleElytron, LEAF_BEETLE_RIG } from './leafModels';
import type { AttractLevel, CollectedCritter, CritterContext, CritterEvent, CritterSounds, CritterWorld, GroundFilter, Species } from './types';

export type { AttractLevel, CollectedCritter, CritterEvent, CritterPuddle, CritterSounds, CritterWorld, GroundFilter } from './types';

/** Ninguém escutando (testes, ou jogo sem áudio). */
const SILENT: CritterSounds = { call() {}, hum() {} };

/** Mundo "vazio" até o primeiro frame (os construtores já precisam de um jogador para espalhar os bichos). */
function initialWorld(): CritterWorld {
  return {
    player: new THREE.Vector3(),
    camera: new THREE.Vector3(0, 4, 8),
    ballPosition: new THREE.Vector3(0, -100, 0),
    ballRadius: 0.5,
    rain: 0,
    wetness: 0,
    puddles: [],
  };
}

/** Teste de desenvolvimento: força um acontecimento raro agora. */
export type CritterDebug = 'hummingbird' | 'swarm' | 'scatter';

/**
 * Vida no jardim: borboletas, abelhas, libélulas, joaninhas e vaquinhas,
 * caracóis, tatuzinhos, formigas, gafanhotos, bicho-pau, lagarta mede-palmo,
 * aranhas nas teias, minhocas e lesmas (na chuva), sapos (nas poças), os
 * moradores de debaixo da pedra (tesourinha e lacraia) e as visitas raras
 * (revoada de tanajuras depois da chuva, beija-flor no sol). Só visual (sem
 * física), sempre por perto do jogador, e barato: cada espécie desenha todos
 * os indivíduos com poucas malhas instanciadas.
 *
 * `count` é o orçamento do aparelho (`quality.critters`); cada espécie escala a partir dele.
 */
export class Critters {
  readonly group = new THREE.Group();
  /** Onde a fauna conta o que aconteceu (revoada, beija-flor, teia rasgada). */
  onEvent: ((event: CritterEvent) => void) | null = null;
  private readonly ctx: CritterContext;
  private readonly species: Species[] = [];
  private readonly ants: AntColonies;
  private readonly earwigs: Earwigs;
  private readonly centipedes: Centipedes;
  private readonly slugs: Slugs;
  private readonly swarm: FlyingAnts;
  private readonly hummingbird: Hummingbird;

  constructor(count: number, spots: THREE.Vector3[], isGroundFree: GroundFilter, picnic: ZoneSite | undefined, sounds: CritterSounds = SILENT, seed = 31) {
    this.group.name = 'critters';
    // Bicho de chão não passeia na toalha do piquenique: ele anda no terreno e ficaria "por baixo" do pano.
    const groundFree: GroundFilter = picnic ? (x, z) => Math.hypot(x - picnic.x, z - picnic.z) > picnic.radius && isGroundFree(x, z) : isGroundFree;
    this.ctx = {
      rng: createRng(seed),
      sounds,
      spots,
      isGroundFree: groundFree,
      picnic,
      world: initialWorld(),
      time: 0,
      viewDir: new THREE.Vector3(0, 0, -1),
      attract: 0,
      // O jogo abre no menu (madrugada).
      menu: true,
      emit: (event) => this.onEvent?.(event),
    };
    const n = (share: number, min: number) => Math.max(min, Math.round(count * share));
    const big = count >= 24;
    const ctx = this.ctx;
    const g = this.group;
    this.ants = new AntColonies(big ? 3 : 2, n(0.6, 6), g);
    this.earwigs = new Earwigs(big ? 6 : 4, ctx, g);
    this.centipedes = new Centipedes(big ? 3 : 2, ctx, g);
    this.slugs = new Slugs(n(0.1, 1), ctx, g);
    this.swarm = new FlyingAnts(Math.max(10, Math.round(count * 0.56)), ctx, g, () => this.ants.nests);
    this.hummingbird = new Hummingbird(ctx, g);
    const beetles = new SmallBeetles(
      [
        { count: n(0.2, 2), rig: LADYBUG_RIG, body: ladybugBody(), elytron: ladybugElytron(), palettes: LadybugPalettes, wary: 1.2, urge: [15, 40], walkSpeed: 0.55, scale: [1.05, 1.3] },
        {
          count: n(0.1, 1),
          rig: LEAF_BEETLE_RIG,
          body: leafBeetleBody(),
          elytron: leafBeetleElytron(),
          wary: 0.35,
          urge: [35, 80],
          walkSpeed: 0.45,
          scale: [1.0, 1.15],
          collect: { id: 'leafBeetle', size: 0.35, color: '#5fb23c' },
        },
      ],
      ctx,
      g,
    );
    this.species.push(
      new Butterflies(n(0.28, 2), ctx, g),
      new Bees(n(0.16, 1), ctx, g),
      new Dragonflies(n(0.08, 1), ctx, g),
      beetles,
      new Snails(n(0.08, 1), ctx, g, n(0.06, 1)),
      new PillBugs(n(0.16, 1), ctx, g),
      new Grasshoppers(n(0.12, 1), ctx, g),
      new Earthworms(n(0.16, 1), ctx, g),
      new Frogs(big ? 2 : 1, ctx, g),
      this.ants,
      new StickInsects(Math.max(2, Math.round(count * 0.08)), ctx, g),
      new Caterpillars(n(0.1, 1), ctx, g),
      this.slugs,
      this.earwigs,
      this.centipedes,
      this.swarm,
      new Spiders(big ? 6 : 4, g),
      this.hummingbird,
    );
  }

  update(dt: number, world: CritterWorld): void {
    const ctx = this.ctx;
    ctx.world = world;
    ctx.time += dt;
    // Para onde a câmera olha (no plano): bicho novo nasce fora da vista.
    const view = ctx.viewDir.set(world.player.x - world.camera.x, 0, world.player.z - world.camera.z);
    if (view.lengthSq() < 1e-6) view.set(0, 0, -1);
    view.normalize();
    const step = Math.min(dt, 0.1);
    for (const s of this.species) s.update(step, ctx);
  }

  /** Algo aconteceu aqui (flor arrancada, bola caiu forte): bichos por perto se assustam. */
  startle(position: THREE.Vector3, radius: number): void {
    for (const s of this.species) s.startle(position, radius, this.ctx);
  }

  /**
   * Katamari com bicho: um bicho que gruda (tatuzinho enrolado, tesourinha,
   * lacraia, bicho-pau, lagarta, lesma, vaquinha, tanajura pousada) encostando
   * numa bola grande o bastante sai do mundo dos bichos e volta como objeto em
   * coordenadas de mundo, pronto para `ball.stick()`. No máximo um por chamada:
   * chamar 1x por frame.
   */
  collect(ballCenter: THREE.Vector3, ballRadius: number): CollectedCritter | null {
    for (const s of this.species) {
      const found = s.collect?.(ballCenter, ballRadius, this.ctx);
      if (found) return found;
    }
    return null;
  }

  /**
   * A bola arrancou uma pedra ou um tronco em `ground`: de 3 a 6 moradores de
   * baixo dela (tesourinhas e lacraias) saem correndo. `size` = tamanho do que saiu.
   */
  scatterFrom(ground: THREE.Vector3, size: number): void {
    const rng = this.ctx.rng;
    const total = 3 + Math.min(3, Math.floor(size * 1.2 + rng.next() * 1.5));
    const centipedes = (rng.next() < 0.55 ? 1 : 0) + (total >= 5 && rng.next() < 0.5 ? 1 : 0);
    const spread = Math.max(0.4, size * 0.5);
    const out = this.centipedes.spawn(ground, spread, centipedes, this.ctx);
    this.earwigs.spawn(ground, spread, total - out, this.ctx);
  }

  /** 0..1: quanto rastro fresco de lesma há em (x, z) — o chão ali escorrega. */
  slimeAt(x: number, z: number): number {
    return this.slugs.slimeAt(x, z);
  }

  /** Poder "Fedor irresistível" (0 = normal; 1 = alcance ~10; 2 = ~16 e mais rápido). */
  setAttract(level: AttractLevel): void {
    this.ctx.attract = level;
  }

  /** Menu aberto (madrugada): visitas de dia (beija-flor, revoada) esperam o jogo voltar. */
  setMenu(open: boolean): void {
    this.ctx.menu = open;
  }

  /** Centros dos formigueiros deste jardim (vazio até o primeiro quadro; depois, sempre a mesma lista). */
  get anthills(): readonly THREE.Vector3[] {
    return this.ants.nests;
  }

  /** Poder "Formigueiro amigo": formigas no raio largam a folhinha; devolve onde cada uma caiu. */
  takeAntLeaves(center: THREE.Vector3, radius: number, max: number): THREE.Vector3[] {
    return this.ants.takeLeaves(center, radius, max);
  }

  /** Rodada nova: teias refeitas, rastro de gosma limpo. */
  newRound(): void {
    for (const s of this.species) s.newRound?.(this.ctx);
  }

  /** Só para testes: força agora um acontecimento raro (perto do besouro). Devolve se aconteceu. */
  debug(kind: CritterDebug): boolean {
    const ctx = this.ctx;
    if (kind === 'hummingbird') return this.hummingbird.visit(ctx);
    if (kind === 'swarm') return this.swarm.start(ctx);
    const p = ctx.world.player;
    const x = p.x + ctx.viewDir.x * 2.5;
    const z = p.z + ctx.viewDir.z * 2.5;
    this.scatterFrom(new THREE.Vector3(x, terrainHeight(x, z), z), 1);
    return true;
  }
}
