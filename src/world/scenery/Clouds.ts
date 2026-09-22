import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { claySphere, paintVertices } from '../../render/geometry';
import type { Rng } from '../../utils/math';

const TOP = new THREE.Color('#ffffff');
const BELLY = new THREE.Color('#d9d6ef');

/**
 * Nuvens de algodão passeando devagar: pompons fundidos, base achatada,
 * barriga levemente lilás (luz do céu por baixo) e topo branco.
 */
const STORM_TINT = new THREE.Color('#8f94a3');

export class Clouds {
  readonly group = new THREE.Group();
  private readonly clouds: THREE.Mesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;

  constructor(rng: Rng, count = 16) {
    this.group.name = 'clouds';
    const material = (this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      emissive: '#fff4ea',
      emissiveIntensity: 0.28,
      fog: false,
    }));
    for (let i = 0; i < count; i++) {
      const parts: THREE.BufferGeometry[] = [];
      const puffs = 5 + Math.floor(rng.next() * 6);
      const span = puffs * 4.2;
      for (let j = 0; j < puffs; j++) {
        const t = j / (puffs - 1) - 0.5;
        // Pompons maiores no meio: silhueta de nuvem de desenho.
        const r = rng.range(4, 7) * (1.25 - Math.abs(t) * 0.9);
        const g = claySphere(r, 4, 0.07, 1, i * 13 + j);
        g.translate(t * span + rng.range(-1, 1), rng.range(-0.5, 2.5) * (1 - Math.abs(t)), rng.range(-3.5, 3.5));
        parts.push(g);
      }
      const geometry = mergeGeometries(parts)!;
      parts.forEach((g) => g.dispose());
      // Achata a barriga: tudo abaixo de y = -1 é empurrado para cima.
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v);
        if (y < -1) pos.setY(v, -1 + (y + 1) * 0.25);
      }
      geometry.computeVertexNormals();
      geometry.scale(1, 0.7, 1);
      paintVertices(geometry, (p, n, c) => c.copy(BELLY).lerp(TOP, THREE.MathUtils.clamp(0.35 + n.y * 0.5 + p.y * 0.05, 0, 1)));

      const cloud = new THREE.Mesh(geometry, material);
      cloud.position.set(rng.range(-170, 170), rng.range(55, 90), rng.range(-170, 170));
      cloud.rotation.y = rng.range(-0.4, 0.4);
      cloud.userData.speed = rng.range(0.6, 1.6);
      cloud.userData.skipAO = true;
      this.clouds.push(cloud);
      this.group.add(cloud);
    }
  }

  update(dt: number): void {
    for (const cloud of this.clouds) {
      cloud.position.x += dt * cloud.userData.speed;
      if (cloud.position.x > 170) cloud.position.x = -170;
    }
  }

  /** Tempo fechando: algodão vira nuvem de chuva (cinza e sem o brilho de sol). */
  setOvercast(amount: number): void {
    this.material.color.setRGB(1, 1, 1).lerp(STORM_TINT, amount);
    this.material.emissiveIntensity = 0.28 * (1 - amount * 0.85);
  }
}
