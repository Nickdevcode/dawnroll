import * as THREE from 'three';
import type { Hud } from '../ui/Hud';
import type { ProjectedPoint } from '../ui/screenMarker';
import { Tutorial, type TutorialWorld } from './Tutorial';

/**
 * Ponte entre o tutorial e o jogo: além do cartão, aponta no mundo o que o passo
 * pede (a sua bola, quando ela está longe; os montinhos mais perto, pra crescer).
 */

/** O que o guia lê do jardim. */
export interface TutorialScene {
  readonly camera: THREE.Camera;
  /** Centro do besouro e da bola (mundo). */
  beetle: THREE.Vector3;
  ball: THREE.Vector3;
  ballRadius: number;
  /** Os montinhos inteiros mais perto de um ponto. */
  nearestPiles(near: THREE.Vector3, count: number, out: THREE.Vector3[], minDistance: number): THREE.Vector3[];
}

/** A bola a mais que isso do besouro ganha o marcador "Sua bola" no passo de agarrar. */
const BALL_MARKER_DISTANCE = 2.4;
/** Quantos montinhos apontar no passo de crescer (e nunca os que já estão embaixo da bola). */
const PILE_MARKERS = 3;

export class TutorialGuide {
  readonly tutorial = new Tutorial();
  private readonly piles: THREE.Vector3[] = [];
  private readonly points: ProjectedPoint[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly view = new THREE.Vector3();

  constructor(private readonly hud: Hud) {}

  /**
   * Um quadro: o tutorial anda, o cartão e os marcadores acompanham. `visible` falso
   * (numa sala online, no pódio) esconde tudo sem perder o passo.
   */
  update(dt: number, world: TutorialWorld, scene: TutorialScene | null, visible: boolean): void {
    const tutorial = this.tutorial;
    tutorial.update(dt, world);
    this.hud.setTutorial(visible ? tutorial.view() : null);
    const points = this.points;
    points.length = 0;
    const step = tutorial.step;
    let kind: 'ball' | 'pile' | null = null;
    if (visible && scene && !world.suspended) {
      if (step === 'grab' && !world.pushing && scene.ball.distanceTo(scene.beetle) - scene.ballRadius > BALL_MARKER_DISTANCE) {
        kind = 'ball';
        this.project(this.tmp.copy(scene.ball).setY(scene.ball.y + scene.ballRadius + 0.5), scene.camera);
      } else if (step === 'grow') {
        kind = 'pile';
        for (const pile of scene.nearestPiles(scene.ball, PILE_MARKERS, this.piles, scene.ballRadius + 0.8)) {
          this.project(this.tmp.set(pile.x, pile.y + 0.6, pile.z), scene.camera);
        }
      }
    }
    this.hud.setTutorMarkers(points, kind);
  }

  private project(point: THREE.Vector3, camera: THREE.Camera): void {
    const behind = this.view.copy(point).applyMatrix4(camera.matrixWorldInverse).z > 0;
    const ndc = point.project(camera);
    this.points.push({ ndcX: ndc.x, ndcY: ndc.y, behind });
  }
}
