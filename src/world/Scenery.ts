import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Groups, interactionGroups, type Physics } from '../core/Physics';
import { clay } from '../render/clayMaterial';
import { claySphere, lumpify } from '../render/geometry';
import { createRng, type Rng } from '../utils/math';
import { terrainHeight, dirtAmount, PLAY_RADIUS } from './Terrain';

/**
 * Cenário "jardim visto por um besouro": pedras viram rochedos, cogumelos e
 * flores são árvores, gravetos são troncos. Tudo com colisor simples do Rapier.
 */

const worldGroups = interactionGroups(Groups.WORLD, 0xffff);

const RockColors = ['#b9b1c9', '#aaa39b', '#cabfae', '#9fa6b8'];
const CapColors = ['#ef6b5b', '#f39a4a', '#e9587a'];
const PetalColors = ['#ffffff', '#ffd6e4', '#fff2a8', '#d9c9ff'];

interface Placement {
  x: number;
  z: number;
  radius: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  private readonly placements: Placement[] = [];
  private readonly clouds: THREE.Object3D[] = [];
  private readonly rng: Rng;

  constructor(private readonly physics: Physics, seed = 7) {
    this.rng = createRng(seed);
    this.group.name = 'scenery';

    // O ponto de nascimento fica livre.
    this.placements.push({ x: 0, z: 0, radius: 7 });

    this.placeMany(26, 2.6, (x, z) => this.addRock(x, z, this.rng.range(1.1, 3.8)));
    this.placeMany(9, 3.5, (x, z) => this.addMushroom(x, z, this.rng.range(2.6, 5.5)));
    this.placeMany(34, 1.4, (x, z) => this.addFlower(x, z, this.rng.range(2.8, 6.5)));
    this.placeMany(7, 5, (x, z) => this.addLog(x, z));
    this.addGiantTrees();
    this.addClouds();

    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** Nuvens passeando devagar. */
  update(dt: number): void {
    for (const cloud of this.clouds) {
      cloud.position.x += dt * cloud.userData.speed;
      if (cloud.position.x > 170) cloud.position.x = -170;
    }
  }

  /** Posições livres (para outros sistemas espalharem coisas sem cair dentro de pedra). */
  isFree(x: number, z: number, radius: number): boolean {
    return this.placements.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + radius);
  }

  private placeMany(count: number, footprint: number, build: (x: number, z: number) => void): void {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const angle = this.rng.next() * Math.PI * 2;
      const radius = 8 + Math.sqrt(this.rng.next()) * (PLAY_RADIUS - 10);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (dirtAmount(x, z) > 0.6 && footprint > 2) continue; // deixa a trilha desimpedida
      if (!this.isFree(x, z, footprint)) continue;
      this.placements.push({ x, z, radius: footprint });
      build(x, z);
      placed++;
    }
  }

  private addFixedCollider(desc: RAPIER.ColliderDesc, position: THREE.Vector3, rotation?: THREE.Quaternion): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (rotation) bodyDesc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const body = this.physics.world.createRigidBody(bodyDesc);
    this.physics.world.createCollider(desc.setCollisionGroups(worldGroups).setFriction(0.9), body);
  }

  private addRock(x: number, z: number, size: number): void {
    const rng = this.rng;
    const geometry = lumpify(new THREE.IcosahedronGeometry(1, 3), 0.22, 1.3, rng.range(0, 50));
    geometry.scale(size * rng.range(0.9, 1.3), size * rng.range(0.45, 0.75), size * rng.range(0.8, 1.2));
    const mesh = new THREE.Mesh(geometry, clay(rng.pick(RockColors), { roughness: 0.8, sheen: 0.35, bump: 0.5 }));
    const y = terrainHeight(x, z) - size * 0.15;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rng.next() * Math.PI * 2;
    this.group.add(mesh);

    // Casco convexo a partir dos próprios vértices (já rotacionados em Y).
    mesh.updateMatrix();
    const points = new Float32Array(geometry.getAttribute('position').array as ArrayLike<number>);
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (desc) this.addFixedCollider(desc, mesh.position, mesh.quaternion);
  }

  private addMushroom(x: number, z: number, height: number): void {
    const rng = this.rng;
    const group = new THREE.Group();
    const baseY = terrainHeight(x, z);
    group.position.set(x, baseY, z);

    const stemRadius = height * 0.12;
    const stemGeo = lumpify(new THREE.CylinderGeometry(stemRadius * 0.8, stemRadius * 1.15, height, 18, 6), stemRadius * 0.08, 1.5, x);
    const stem = new THREE.Mesh(stemGeo, clay('#fbefd9', { roughness: 0.75, sheen: 0.5 }));
    stem.position.y = height / 2;
    group.add(stem);

    const capRadius = height * rng.range(0.42, 0.55);
    const capGeo = lumpify(new THREE.SphereGeometry(capRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), capRadius * 0.04, 2 / capRadius, z);
    capGeo.scale(1, 0.62, 1);
    const cap = new THREE.Mesh(capGeo, clay(rng.pick(CapColors), { roughness: 0.6, sheen: 0.6, clearcoat: 0.2 }));
    cap.position.y = height * 0.92;
    group.add(cap);

    // Parte de baixo do chapéu (lamelas claras).
    const under = new THREE.Mesh(new THREE.CircleGeometry(capRadius * 0.98, 32), clay('#f6dcc0', { bump: 0.2 }));
    under.rotation.x = Math.PI / 2;
    under.position.y = height * 0.92 + 0.01;
    group.add(under);

    // Bolinhas brancas no chapéu.
    const dotGeo = claySphere(1, 2, 0.05, 2, 3);
    const dotMat = clay('#fffaf2', { roughness: 0.7, sheen: 0.3, bump: 0.1 });
    for (let i = 0; i < 9; i++) {
      const theta = rng.next() * Math.PI * 2;
      const phi = rng.range(0.15, 1.2);
      const n = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi) * 0.62, Math.sin(phi) * Math.sin(theta));
      const dot = new THREE.Mesh(dotGeo, dotMat);
      const s = capRadius * rng.range(0.1, 0.17);
      dot.scale.set(s, s * 0.35, s);
      dot.position.copy(n).multiplyScalar(capRadius).add(new THREE.Vector3(0, height * 0.92, 0));
      dot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.normalize());
      group.add(dot);
    }
    this.group.add(group);

    const stemCenter = new THREE.Vector3(x, baseY + height / 2, z);
    this.addFixedCollider(RAPIER.ColliderDesc.cylinder(height / 2, stemRadius), stemCenter);
    const capCenter = new THREE.Vector3(x, baseY + height * 0.92 + capRadius * 0.3, z);
    this.addFixedCollider(RAPIER.ColliderDesc.roundCylinder(capRadius * 0.18, capRadius * 0.85, capRadius * 0.12), capCenter);
  }

  private addFlower(x: number, z: number, height: number): void {
    const rng = this.rng;
    const group = new THREE.Group();
    const baseY = terrainHeight(x, z);
    group.position.set(x, baseY, z);
    const lean = new THREE.Vector3(rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25)).normalize();

    // Caule curvo como tubo.
    const top = lean.clone().multiplyScalar(height);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(top.x * 0.2, height * 0.55, top.z * 0.2), top);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.16, 10), clay('#6fb04a', { roughness: 0.7, bump: 0.2 }));
    group.add(stem);

    // Folhas no caule.
    const leafGeo = claySphere(1, 2, 0.05, 2, 9);
    const leafMat = clay('#7cc257', { roughness: 0.7, sheen: 0.5, bump: 0.2 });
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const t = 0.25 + i * 0.2;
      leaf.position.copy(curve.getPoint(t));
      leaf.scale.set(0.5, 0.06, 0.18);
      leaf.rotation.set(0, i * Math.PI + rng.range(-0.4, 0.4), 0.5);
      leaf.translateX(0.45);
      group.add(leaf);
    }

    // Flor: miolo + pétalas em anel, virada levemente pro lado.
    const head = new THREE.Group();
    head.position.copy(top);
    head.lookAt(top.clone().add(lean.clone().multiplyScalar(1).add(new THREE.Vector3(rng.range(-0.6, 0.6), 0.6, rng.range(-0.6, 0.6)))));
    const petalColor = rng.pick(PetalColors);
    const petalMat = clay(petalColor, { roughness: 0.65, sheen: 0.7, bump: 0.15 });
    const petalCount = 9 + Math.floor(rng.next() * 4);
    const petalLength = height * 0.14;
    const petalGeo = claySphere(1, 2, 0.05, 2, 1);
    for (let i = 0; i < petalCount; i++) {
      const a = (i / petalCount) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.scale.set(petalLength * 0.32, petalLength * 0.08, petalLength * 0.62);
      petal.position.set(Math.cos(a) * petalLength * 0.62, Math.sin(a) * petalLength * 0.62, 0);
      petal.rotation.set(0, 0, a);
      petal.rotateX(Math.PI / 2);
      petal.rotateX(-0.2);
      head.add(petal);
    }
    const center = new THREE.Mesh(claySphere(petalLength * 0.4, 3, 0.06, 2, 2), clay('#f7b733', { roughness: 0.85, sheen: 0.4, bump: 0.7 }));
    center.scale.z = 0.55;
    head.add(center);
    group.add(head);
    this.group.add(group);

    const stemCenter = new THREE.Vector3(x + top.x * 0.3, baseY + height * 0.3, z + top.z * 0.3);
    this.addFixedCollider(RAPIER.ColliderDesc.cylinder(height * 0.3, 0.18), stemCenter);
  }

  private addLog(x: number, z: number): void {
    const rng = this.rng;
    const length = rng.range(4.5, 8.5);
    const radius = rng.range(0.35, 0.7);
    const geometry = lumpify(new THREE.CapsuleGeometry(radius, length, 6, 14), radius * 0.1, 1.2, x + z);
    // Vertex colors: casca marrom com "anéis".
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color('#9b6a43');
    const b = new THREE.Color('#7d5234');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.sin(pos.getY(i) * 3.1) * 0.5 + 0.5;
      c.copy(a).lerp(b, t);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, clay(0xffffff, { vertexColors: true, roughness: 0.85, sheen: 0.3, bump: 0.6, repeat: 2 }));
    const yaw = rng.next() * Math.PI;
    mesh.quaternion.setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ'));
    const y = Math.max(terrainHeight(x, z), terrainHeight(x + Math.cos(yaw) * length * 0.5, z - Math.sin(yaw) * length * 0.5)) + radius * 0.55;
    mesh.position.set(x, y, z);
    this.group.add(mesh);

    // Folhinha brotando do graveto — detalhe de charme.
    const sprout = new THREE.Mesh(claySphere(1, 2, 0.05, 2, 4), clay('#8fd16a', { sheen: 0.6, bump: 0.2 }));
    sprout.scale.set(0.35, 0.05, 0.18);
    sprout.position.set(0, length * 0.2, radius * 1.05);
    mesh.add(sprout);

    this.addFixedCollider(RAPIER.ColliderDesc.capsule(length / 2, radius), mesh.position, mesh.quaternion);
  }

  /** Troncos gigantes fora da área jogável: vendem a escala de "mundo em miniatura". */
  private addGiantTrees(): void {
    const rng = this.rng;
    const trunkMat = clay('#8b6246', { roughness: 0.85, sheen: 0.3, bump: 0.7, repeat: 6 });
    const leafMats = ['#6fae4f', '#86c35d', '#5e9c48'].map((c) => clay(c, { roughness: 0.75, sheen: 0.5, bump: 0.4, repeat: 3 }));
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const dist = rng.range(78, 96);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const radius = rng.range(5, 8);
      const height = rng.range(70, 95);
      const baseY = terrainHeight(x, z) - 2;
      const trunkGeo = lumpify(new THREE.CylinderGeometry(radius * 0.8, radius * 1.3, height, 24, 12), radius * 0.08, 0.2, i * 13);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, baseY + height / 2, z);
      this.group.add(trunk);

      const canopyParts: THREE.BufferGeometry[] = [];
      for (let j = 0; j < 7; j++) {
        const r = rng.range(12, 20);
        const g = claySphere(r, 2, 0.1, 1.5, i * 7 + j);
        g.translate(rng.range(-14, 14), height * 0.95 + rng.range(-6, 8), rng.range(-14, 14));
        canopyParts.push(g);
      }
      const canopy = new THREE.Mesh(mergeGeometries(canopyParts), rng.pick(leafMats));
      canopy.position.set(x, baseY, z);
      this.group.add(canopy);
      canopyParts.forEach((g) => g.dispose());

      this.addFixedCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius), trunk.position);
    }
  }

  private addClouds(): void {
    const rng = this.rng;
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#fff6ec', emissiveIntensity: 0.35, fog: false });
    for (let i = 0; i < 12; i++) {
      const parts: THREE.BufferGeometry[] = [];
      const puffs = 4 + Math.floor(rng.next() * 4);
      for (let j = 0; j < puffs; j++) {
        const r = rng.range(4, 8);
        const g = claySphere(r, 2, 0.06, 1, i + j);
        g.translate(j * 5 - puffs * 2.5, rng.range(-1, 2), rng.range(-3, 3));
        parts.push(g);
      }
      const geometry = mergeGeometries(parts);
      geometry.scale(1, 0.62, 1);
      parts.forEach((g) => g.dispose());
      const cloud = new THREE.Mesh(geometry, material);
      cloud.position.set(rng.range(-170, 170), rng.range(55, 85), rng.range(-170, 170));
      cloud.userData.speed = rng.range(0.6, 1.6);
      cloud.userData.noShadow = true;
      this.clouds.push(cloud);
      this.group.add(cloud);
    }
  }
}
