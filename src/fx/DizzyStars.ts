import * as THREE from 'three';

/**
 * Estrelinhas rodando em volta da cabeça do besouro tonto (levou trombada no
 * online), como no desenho animado. Três estrelas numa malha só, sem luz (não
 * dependem do clima), que crescem ao aparecer e somem encolhendo.
 */

const STAR_COUNT = 3;
const ORBIT_RADIUS = 0.3;
const ORBIT_SPEED = 6.5;
/** Acima da cabeça (u). */
const LIFT = 0.42;
const STAR_SIZE = 0.085;

let starGeometry: THREE.BufferGeometry | null = null;
let starMaterial: THREE.Material | null = null;

/** Estrela de 5 pontas achatada (as mesmas pra todos os besouros). */
function sharedStar(): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  if (!starGeometry) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.45;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    starGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
    starGeometry.center();
    starGeometry.scale(STAR_SIZE, STAR_SIZE, STAR_SIZE);
  }
  starMaterial ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd84a').multiplyScalar(1.6), toneMapped: false });
  return { geometry: starGeometry, material: starMaterial };
}

export class DizzyStars {
  readonly group = new THREE.Group();
  private readonly stars: THREE.Mesh[] = [];
  private spin = 0;
  /** 0..1: aparecendo/sumindo. */
  private presence = 0;

  constructor() {
    const { geometry, material } = sharedStar();
    for (let i = 0; i < STAR_COUNT; i++) {
      const star = new THREE.Mesh(geometry, material);
      star.castShadow = false;
      star.userData.skipAO = true;
      this.stars.push(star);
      this.group.add(star);
    }
    this.group.name = 'dizzy-stars';
    this.group.visible = false;
  }

  /** Quadro: segue a cabeça (`head`, no mundo) e roda; `active` = está tonto. */
  update(dt: number, head: THREE.Vector3, active: boolean): void {
    this.presence = THREE.MathUtils.damp(this.presence, active ? 1 : 0, active ? 14 : 8, dt);
    const visible = this.presence > 0.02;
    this.group.visible = visible;
    if (!visible) return;
    this.spin += dt * ORBIT_SPEED;
    this.group.position.set(head.x, head.y + LIFT, head.z);
    for (let i = 0; i < this.stars.length; i++) {
      const a = this.spin + (i / this.stars.length) * Math.PI * 2;
      const star = this.stars[i];
      star.position.set(Math.cos(a) * ORBIT_RADIUS, Math.sin(a * 2 + i) * 0.05, Math.sin(a) * ORBIT_RADIUS);
      star.rotation.set(0, -a, this.spin * 1.5);
      star.scale.setScalar(this.presence);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
