import * as THREE from 'three';
import { createRng } from '../../utils/math';
import { Butterflies, Bees, Dragonflies } from './flyers';
import { Ladybugs, PillBugs, Snails } from './crawlers';
import { AntColonies } from './ants';
import { Frogs, Grasshoppers } from './hoppers';
import { Earthworms } from './worms';
import type { CollectedCritter, CritterContext, CritterWorld, GroundFilter, Species } from './types';

export type { CollectedCritter, CritterPuddle, CritterWorld, GroundFilter } from './types';

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

/**
 * Vida no jardim: borboletas, abelhas, libélulas, joaninhas, caracóis,
 * tatuzinhos, formigas, gafanhotos, minhocas (na chuva) e sapos (nas poças).
 * Só visual (sem física), sempre por perto do jogador, e barato: cada espécie
 * desenha todos os indivíduos com poucas malhas instanciadas.
 *
 * `count` é o orçamento do aparelho (`quality.critters`); cada espécie escala a partir dele.
 */
export class Critters {
  readonly group = new THREE.Group();
  private readonly ctx: CritterContext;
  private readonly species: Species[] = [];
  private readonly pillBugs: PillBugs;

  constructor(count: number, spots: THREE.Vector3[], isGroundFree: GroundFilter, seed = 31) {
    this.group.name = 'critters';
    this.ctx = { rng: createRng(seed), spots, isGroundFree, world: initialWorld(), time: 0, viewDir: new THREE.Vector3(0, 0, -1) };
    const n = (share: number, min: number) => Math.max(min, Math.round(count * share));
    const ctx = this.ctx;
    const g = this.group;
    this.pillBugs = new PillBugs(n(0.16, 1), ctx, g);
    this.species.push(
      new Butterflies(n(0.28, 2), ctx, g),
      new Bees(n(0.16, 1), ctx, g),
      new Dragonflies(n(0.08, 1), ctx, g),
      new Ladybugs(n(0.2, 2), ctx, g),
      new Snails(n(0.08, 1), ctx, g, n(0.06, 1)),
      this.pillBugs,
      new Grasshoppers(n(0.12, 1), ctx, g),
      new Earthworms(n(0.16, 1), ctx, g),
      new Frogs(count >= 24 ? 2 : 1, ctx, g),
      new AntColonies(count >= 24 ? 3 : 2, n(0.6, 6), g),
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
   * Katamari com bicho: um tatuzinho enrolado encostando numa bola grande o
   * bastante sai do mundo dos bichos e volta como objeto em coordenadas de mundo,
   * pronto para `ball.stick()`. Chamar 1x por frame.
   */
  collect(ballCenter: THREE.Vector3, ballRadius: number): CollectedCritter | null {
    return this.pillBugs.collect(ballCenter, ballRadius);
  }
}
