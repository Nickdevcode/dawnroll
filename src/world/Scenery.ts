import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import { createRng } from '../utils/math';
import type { ContactShade } from './Terrain';
import { buildGiantTree } from './scenery/trees';
import { buildBush, buildFlowerPot } from './scenery/backdrop';
import { Clouds } from './scenery/Clouds';
import { SceneryLayer, type PickableRecord } from './scenery/SceneryLayer';
import { buildGarden, type GardenPlan } from './gardenLayout';
import type { ZoneKind, ZoneSite } from './zones';

export type { PickableRecord } from './scenery/SceneryLayer';

/** Semente do horizonte (árvores gigantes, moitas e o vaso): o fundo do jardim nunca muda. */
const HORIZON_SEED = 7;

/**
 * Cenário "jardim visto por um besouro": pedras viram rochedos, cogumelos e
 * flores são árvores, gravetos são troncos. Cada tipo tem seu construtor em
 * `scenery/` e `objects/`; ONDE cada coisa vai é sorteado por `gardenLayout`.
 *
 * São duas camadas: o horizonte (nasce uma vez) e o jardim, que muda a cada
 * rodada — o próximo se monta aos poucos (`prepareNext` + `stepNext`) enquanto o
 * jogo roda e entra de uma vez no `commitNext`. Quem consulta o cenário (grama,
 * bichos, detritos, câmera) sempre enxerga o jardim atual.
 *
 * Flores, cogumelos, pedras, troncos e objetos são "arrancáveis": continuam no
 * lote, mas o lote sabe apagá-los quando a bola os leva.
 */
export class Scenery {
  readonly group = new THREE.Group();

  private readonly horizon: SceneryLayer;
  private readonly clouds: Clouds;
  private garden: SceneryLayer;
  private plan: GardenPlan;
  /** O jardim da próxima rodada, montando (null = nada em andamento). */
  private next: { layer: SceneryLayer; steps: Generator<void, GardenPlan>; plan: GardenPlan | null } | null = null;

  constructor(
    private readonly physics: Physics,
    private readonly decor: number,
    seed: number,
  ) {
    this.group.name = 'scenery';
    this.horizon = new SceneryLayer(physics, false, 'horizon');
    this.addHorizon();
    runToEnd(this.horizon.finish());
    this.group.add(this.horizon.group);

    this.garden = new SceneryLayer(physics, false, 'garden');
    this.plan = runToEnd(buildGarden(this.garden, seed, decor));
    this.group.add(this.garden.group);

    this.clouds = new Clouds(createRng(HORIZON_SEED + 1), 16);
    this.group.add(this.clouds.group);
  }

  // --- Jardim da próxima rodada ---------------------------------------------------

  /** Começa a montar o jardim da próxima rodada (colisores desligados até a troca). */
  prepareNext(seed: number): void {
    this.discardNext();
    const layer = new SceneryLayer(this.physics, true, 'garden');
    this.next = { layer, steps: buildGarden(layer, seed, this.decor), plan: null };
  }

  /** Avança a montagem por até `budgetMs`. Devolve true quando o próximo jardim está pronto. */
  stepNext(budgetMs: number): boolean {
    const next = this.next;
    if (!next) return false;
    if (next.plan) return true;
    const until = performance.now() + budgetMs;
    do {
      const step = next.steps.next();
      if (step.done) {
        next.plan = step.value;
        return true;
      }
    } while (performance.now() < until);
    return false;
  }

  /** O jardim em montagem (para plantar a grama e os bichos dele antes da troca), se já estiver pronto. */
  get pending(): SceneryLayer | null {
    return this.next?.plan ? this.next.layer : null;
  }

  /** Tem jardim novo em montagem (ou pronto) esperando a troca? */
  get hasNext(): boolean {
    return this.next !== null;
  }

  get pendingPlan(): GardenPlan | null {
    return this.next?.plan ?? null;
  }

  /**
   * Onde grama e enfeites de chão NÃO nascem: dentro de algo sólido ou em cima
   * de algo chato (toalha, chinelo...). `pending` = do jardim em montagem (para
   * plantar o gramado dele antes da troca).
   */
  groundBlocker(margin: number, pending = false): (x: number, z: number) => boolean {
    const garden = pending ? (this.pending ?? this.garden) : this.garden;
    const horizon = this.horizon;
    return (x, z) => garden.isInsideSolid(x, z, margin) || garden.isCovered(x, z, margin) || horizon.isInsideSolid(x, z, margin);
  }

  /** Onde bicho de chão pode andar num jardim (fora de pedra, tronco, toca e poça), preso a ele. */
  critterGround(pending = false): (x: number, z: number) => boolean {
    const garden = pending ? (this.pending ?? this.garden) : this.garden;
    return (x, z) => !garden.isInsideSolid(x, z, 0.5) && !garden.isDug(x, z);
  }

  /** Termina de montar na hora (se ainda faltar algo) e troca o jardim. Devolve false se não havia próximo. */
  commitNext(): boolean {
    const next = this.next;
    if (!next) return false;
    if (!next.plan) next.plan = runToEnd(next.steps);
    this.next = null;
    this.garden.dispose();
    this.garden = next.layer;
    this.plan = next.plan;
    this.garden.activate();
    this.group.add(this.garden.group);
    return true;
  }

  private discardNext(): void {
    if (!this.next) return;
    this.next.layer.dispose();
    this.next = null;
  }

  // --- O jardim atual ---------------------------------------------------------------

  get seed(): number {
    return this.plan.seed;
  }

  get zones(): readonly ZoneSite[] {
    return this.plan.zones;
  }

  /** O cantinho de um tipo (pode faltar se não coube: quem usa confere). */
  zoneOf(kind: ZoneKind): ZoneSite | undefined {
    return this.plan.zones.find((zone) => zone.kind === kind);
  }

  /** Onde as bolas de tênis começam neste jardim. */
  get tennisBalls(): readonly THREE.Vector2[] {
    return this.plan.tennisBalls;
  }

  /** Tudo que a bola pode arrancar do chão. */
  get pickables(): readonly PickableRecord[] {
    return this.garden.pickables;
  }

  /** Pontos de pouso para borboletas e abelhas (array vivo: some o que foi arrancado). */
  get landingSpots(): THREE.Vector3[] {
    return this.garden.landingSpots;
  }

  /** Sombras de contato para o terreno pintar (horizonte + jardim). */
  get shades(): ContactShade[] {
    return [...this.horizon.shades, ...this.garden.shades];
  }

  /** Nuvens passeando devagar. */
  update(dt: number): void {
    this.clouds.update(dt);
  }

  /** Céu fechando (0 = limpo, 1 = tempestade): nuvens ficam cinzentas. */
  setOvercast(amount: number): void {
    this.clouds.setOvercast(amount);
  }

  /** Posições livres (para outros sistemas espalharem coisas sem cair dentro de pedra). */
  isFree(x: number, z: number, radius: number): boolean {
    return this.garden.isFree(x, z, radius);
  }

  /** Dentro do "pé" de algo sólido (pedra, tronco, caule, árvore do horizonte)? Grama e enfeites evitam. */
  isInsideSolid(x: number, z: number, margin = 0): boolean {
    return this.garden.isInsideSolid(x, z, margin) || this.horizon.isInsideSolid(x, z, margin);
  }

  /**
   * Em cima de algo chato que cobre o chão (a toalha do piquenique, chinelo, luva,
   * pá deitada, terra derramada)? Grama e cobertura do chão não devem nascer ali.
   * Não é "sólido": bicho anda por cima.
   */
  isCovered(x: number, z: number, margin = 0): boolean {
    return this.garden.isCovered(x, z, margin);
  }

  /** Quanto a superfície fica acima do terreno num ponto (a toalha ondulada); 0 fora dela. */
  coverHeight(x: number, z: number): number {
    return this.garden.coverHeight(x, z);
  }

  /** Dentro da toca ou de uma bacia de poça (bicho de chão não passeia ali). */
  isDug(x: number, z: number): boolean {
    return this.garden.isDug(x, z);
  }

  /** A bola arrancou: some do lote, os colisores desligam e os insetos perdem o pouso. */
  detach(record: PickableRecord): void {
    this.garden.detach(record);
  }

  /** Árvores gigantes, moitas e o vaso: o horizonte do jardim. */
  private addHorizon(): void {
    const rng = createRng(HORIZON_SEED);
    const ctx = this.horizon.context(rng, this.decor);
    const trees = 11;
    for (let i = 0; i < trees; i++) {
      const angle = (i / trees) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const dist = rng.range(80, 98);
      buildGiantTree(ctx, Math.cos(angle) * dist, Math.sin(angle) * dist, rng.range(5, 8.5), rng.range(70, 98));
    }
    for (let i = 0; i < 22; i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.range(70, 92);
      buildBush(ctx, Math.cos(angle) * dist, Math.sin(angle) * dist, rng.range(5, 10));
    }
    buildFlowerPot(ctx, 58, -64);
  }
}

/** Roda um gerador de montagem até o fim, de uma vez (carregamento). */
function runToEnd<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
