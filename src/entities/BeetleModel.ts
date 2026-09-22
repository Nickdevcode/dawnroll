import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clay } from '../render/clayMaterial';
import { claySphere, clayCapsule } from '../render/geometry';
import { clamp, damp, lerp } from '../utils/math';

/**
 * Modelo procedural do besouro rola-bosta.
 *
 * Convenção local: +Z = frente (cabeça), +Y = cima, origem no chão sob o corpo.
 * Não há esqueleto nem arquivo externo: as patas são cadeias de grupos
 * (quadril → fêmur → joelho → tíbia) animadas por fase, e a pose de
 * "empurrar a bola" é uma segunda pose misturada por `pushBlend`.
 */

const Colors = {
  shell: '#2f2c63',
  shellDeep: '#211d45',
  leg: '#34294a',
  eyeWhite: '#fbf6ee',
  pupil: '#151019',
  cheek: '#ff9aa8',
  antennaClub: '#f4a73b',
  mouth: '#1b1424',
};

interface Leg {
  side: 1 | -1;
  /** 0 = dianteira, 1 = meio, 2 = traseira */
  pair: 0 | 1 | 2;
  hip: THREE.Group;
  femur: THREE.Group;
  knee: THREE.Group;
  /** Fase da passada (tripé: pares alternados em PI). */
  phase: number;
  restYaw: number;
}

export interface BeetlePose {
  /** Velocidade horizontal atual (u/s). */
  speed: number;
  grounded: boolean;
  /** 0 = andando normal, 1 = de ponta-cabeça empurrando a bola. */
  pushBlend: number;
  /** Velocidade com que a bola está rolando (move as patas traseiras). */
  pushSpeed: number;
  /** Velocidade vertical — estica no pulo, amassa na queda. */
  verticalSpeed: number;
  /** Quanto o besouro "fez força" (0..1) — treme de leve quando a bola pesa. */
  strain: number;
}

export class BeetleModel {
  readonly root = new THREE.Group();
  /** Corpo inteiro (inclina na pose de empurrar). */
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly antennae: THREE.Group[] = [];
  private readonly eyelids: THREE.Mesh[] = [];
  private readonly pupils: THREE.Group[] = [];

  private time = 0;
  private stride = 0;
  private pushStride = 0;
  private blinkTimer = 2.5;
  private blink = 0;
  private squash = 1;
  private landingImpulse = 0;
  private wasGrounded = true;

  constructor() {
    this.root.name = 'beetle';
    this.root.add(this.body);
    this.buildShell();
    this.buildHead();
    this.buildLegs();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  private buildShell(): void {
    const shell = clay(Colors.shell, { roughness: 0.42, sheen: 0.6, iridescence: 0.85, clearcoat: 0.5, bump: 0.25 });
    const deep = clay(Colors.shellDeep, { roughness: 0.5, sheen: 0.5, iridescence: 0.6, bump: 0.25 });

    // Élitros: duas metades que se encostam no meio formando o vinco característico.
    const elytraGeo = claySphere(1, 3, 0.03, 2, 4);
    for (const side of [1, -1]) {
      const half = new THREE.Mesh(elytraGeo, shell);
      half.scale.set(0.205, 0.25, 0.43);
      half.position.set(side * 0.175, 0.36, -0.13);
      half.rotation.set(0.12, side * 0.05, side * -0.08);
      this.body.add(half);
    }

    // Barriga escura por baixo: dá volume e esconde a junção das patas.
    const belly = new THREE.Mesh(claySphere(1, 2, 0.04, 2, 8), deep);
    belly.scale.set(0.3, 0.13, 0.46);
    belly.position.set(0, 0.24, -0.05);
    this.body.add(belly);

    // Pronoto (o "escudo" do tórax), largo e arredondado.
    const pronotum = new THREE.Mesh(claySphere(1, 3, 0.03, 2, 12), shell);
    pronotum.scale.set(0.33, 0.2, 0.22);
    pronotum.position.set(0, 0.37, 0.28);
    pronotum.rotation.x = -0.15;
    this.body.add(pronotum);
  }

  private buildHead(): void {
    const shell = clay(Colors.shell, { roughness: 0.42, sheen: 0.6, iridescence: 0.85, clearcoat: 0.5, bump: 0.25 });
    this.head.position.set(0, 0.3, 0.46);
    this.body.add(this.head);

    // Cabeça em forma de pá (clípeo) — é com ela que o rola-bosta molda a bola.
    const shovel = new THREE.Mesh(claySphere(1, 3, 0.04, 2, 17), shell);
    shovel.scale.set(0.25, 0.1, 0.19);
    shovel.position.set(0, 0, 0.1);
    this.head.add(shovel);
    // Serrilhado da borda da pá.
    const toothGeo = claySphere(0.035, 1, 0.1, 3, 2);
    for (let i = -2; i <= 2; i++) {
      const tooth = new THREE.Mesh(toothGeo, shell);
      const a = i * 0.32;
      tooth.position.set(Math.sin(a) * 0.23, -0.02, 0.1 + Math.cos(a) * 0.17);
      tooth.scale.set(1, 0.6, 1);
      this.head.add(tooth);
    }

    // Chifre em "topete": o charme do bonitão.
    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.06, 0.08),
      new THREE.Vector3(0, 0.18, 0.12),
      new THREE.Vector3(0, 0.29, 0.06),
      new THREE.Vector3(0, 0.33, -0.06),
    ]);
    const hornParts: THREE.BufferGeometry[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = hornCurve.getPoint(t);
      const r = lerp(0.07, 0.025, t);
      const g = new THREE.IcosahedronGeometry(r, 2);
      g.translate(p.x, p.y, p.z);
      hornParts.push(g);
    }
    const horn = new THREE.Mesh(mergeGeometries(hornParts), shell);
    this.head.add(horn);
    hornParts.forEach((g) => g.dispose());

    // Olhos grandes com pálpebra meio baixa = olhar confiante.
    const white = clay(Colors.eyeWhite, { roughness: 0.35, sheen: 0.2, bump: 0.08 });
    const pupilMat = clay(Colors.pupil, { roughness: 0.25, sheen: 0, bump: 0 });
    const highlight = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = shell;
    const eyeGeo = claySphere(0.085, 3, 0.02, 2, 1);
    const pupilGeo = new THREE.SphereGeometry(0.046, 20, 14);
    const glintGeo = new THREE.SphereGeometry(0.013, 10, 8);
    const lidGeo = new THREE.SphereGeometry(0.093, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);

    for (const side of [1, -1] as const) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.13, 0.1, 0.16);
      eye.rotation.y = side * 0.35;
      this.head.add(eye);

      eye.add(new THREE.Mesh(eyeGeo, white));

      const pupilPivot = new THREE.Group();
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.058;
      pupil.scale.set(1, 1.1, 0.55);
      const glint = new THREE.Mesh(glintGeo, highlight);
      glint.position.set(0.018, 0.022, 0.082);
      pupilPivot.add(pupil, glint);
      eye.add(pupilPivot);
      this.pupils.push(pupilPivot);

      // Pálpebra: meia-esfera que desce (piscar) e fica meio fechada no repouso.
      const lid = new THREE.Mesh(lidGeo, lidMat);
      lid.rotation.x = -0.35;
      eye.add(lid);
      this.eyelids.push(lid);

      // Bochecha rosada.
      const cheek = new THREE.Mesh(claySphere(0.045, 2, 0.05, 2, side), clay(Colors.cheek, { roughness: 0.8, sheen: 0.6, bump: 0.1 }));
      cheek.scale.set(1, 0.55, 0.6);
      cheek.position.set(side * 0.17, 0.02, 0.2);
      this.head.add(cheek);

      // Antena: haste fina + clava lamelada (as "folhinhas" típicas dos escarabeídeos).
      const antenna = new THREE.Group();
      antenna.position.set(side * 0.1, 0.03, 0.24);
      antenna.rotation.set(-0.5, side * 0.7, 0);
      const stalk = new THREE.Mesh(clayCapsule(0.012, 0.14, 0.05, 3), clay(Colors.leg, { bump: 0.1 }));
      stalk.position.y = 0.08;
      antenna.add(stalk);
      const clubMat = clay(Colors.antennaClub, { roughness: 0.6, sheen: 0.7, bump: 0.15 });
      for (let i = 0; i < 3; i++) {
        const lamella = new THREE.Mesh(claySphere(0.038, 2, 0.05, 2, i + side), clubMat);
        lamella.scale.set(1, 0.35, 0.8);
        lamella.position.set(0, 0.17 + i * 0.022, 0.01);
        antenna.add(lamella);
      }
      this.head.add(antenna);
      this.antennae.push(antenna);
    }

    // Sorrisinho de canto (as mandíbulas, na real).
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.011, 8, 20, Math.PI * 0.7),
      clay(Colors.mouth, { bump: 0 }),
    );
    smile.position.set(0.015, -0.035, 0.28);
    smile.rotation.set(0.35, 0, Math.PI + 0.55);
    this.head.add(smile);
  }

  private buildLegs(): void {
    const legMat = clay(Colors.leg, { roughness: 0.55, sheen: 0.5, bump: 0.15 });
    const spikeGeo = new THREE.ConeGeometry(0.018, 0.06, 6);
    const footGeo = claySphere(0.03, 1, 0.05, 2, 5);

    // [z do quadril, comprimento fêmur, comprimento tíbia, yaw de repouso]
    const layout: Array<[number, number, number, number]> = [
      [0.3, 0.2, 0.26, 0.55], // dianteiras: curtas e serrilhadas (de cavar)
      [0.06, 0.22, 0.28, -0.05],
      [-0.18, 0.26, 0.34, -0.55], // traseiras: longas (de empurrar a bola)
    ];

    for (const side of [1, -1] as const) {
      layout.forEach(([hipZ, femurLen, tibiaLen, restYaw], pair) => {
        const hip = new THREE.Group();
        // Constroi tudo apontando para +X e gira 180° no lado esquerdo.
        const mount = new THREE.Group();
        mount.rotation.y = side === 1 ? 0 : Math.PI;
        mount.add(hip);
        hip.position.set(0.16, 0.25, side === 1 ? hipZ : -hipZ);

        const femur = new THREE.Group();
        hip.add(femur);
        const femurMesh = new THREE.Mesh(clayCapsule(0.035, femurLen, 0.08, pair + side), legMat);
        femurMesh.rotation.z = -Math.PI / 2;
        femurMesh.position.x = femurLen / 2;
        femur.add(femurMesh);

        const knee = new THREE.Group();
        knee.position.x = femurLen;
        femur.add(knee);
        const tibiaMesh = new THREE.Mesh(clayCapsule(pair === 0 ? 0.034 : 0.026, tibiaLen, 0.08, pair * 3 + side), legMat);
        tibiaMesh.rotation.z = -Math.PI / 2;
        tibiaMesh.position.x = tibiaLen / 2;
        knee.add(tibiaMesh);

        // Espinhos na tíbia (bem marcados nas dianteiras).
        const spikes = pair === 0 ? 3 : 2;
        for (let i = 0; i < spikes; i++) {
          const spike = new THREE.Mesh(spikeGeo, legMat);
          spike.position.set(tibiaLen * (0.35 + i * 0.25), 0.02, 0);
          spike.rotation.z = -0.6;
          knee.add(spike);
        }
        const foot = new THREE.Mesh(footGeo, legMat);
        foot.position.x = tibiaLen + 0.01;
        knee.add(foot);

        this.body.add(mount);
        this.legs.push({
          side,
          pair: pair as 0 | 1 | 2,
          hip,
          femur,
          knee,
          // Tripé: dianteira e traseira de um lado andam junto com a do meio do outro.
          phase: ((pair % 2 === 0) === (side === 1) ? 0 : Math.PI),
          restYaw,
        });
      });
    }
  }

  update(dt: number, pose: BeetlePose): void {
    this.time += dt;
    const { speed, grounded, pushBlend, pushSpeed, verticalSpeed, strain } = pose;

    // Cadência da passada acompanha a velocidade (patinha rápida quando corre).
    this.stride += dt * (grounded ? clamp(speed, 0, 9) * 3.4 : 2);
    this.pushStride += dt * clamp(pushSpeed, 0, 6) * 4.2;
    const moving = clamp(speed / 1.2, 0, 1);

    // --- squash & stretch ---
    if (grounded && !this.wasGrounded) this.landingImpulse = clamp(-verticalSpeed / 14, 0, 1);
    this.wasGrounded = grounded;
    this.landingImpulse = damp(this.landingImpulse, 0, 10, dt);
    const airStretch = grounded ? 0 : clamp(verticalSpeed / 16, -0.3, 0.35);
    const targetSquash = 1 + airStretch - this.landingImpulse * 0.35;
    this.squash = damp(this.squash, targetSquash, 18, dt);
    const breathe = Math.sin(this.time * 2.2) * 0.012 * (1 - moving);
    this.body.scale.set(1 / Math.sqrt(this.squash) + breathe, this.squash - breathe, 1 / Math.sqrt(this.squash));

    // --- corpo ---
    const bob = grounded ? Math.abs(Math.sin(this.stride)) * 0.025 * moving : 0;
    // Pose de empurrar: nariz no chão, traseira pra cima encostada na bola.
    this.body.rotation.x = lerp(Math.sin(this.stride * 2) * 0.02 * moving, 0.72, pushBlend);
    this.body.position.y = bob + pushBlend * 0.2;
    this.body.position.z = pushBlend * 0.08;
    this.body.rotation.z = Math.sin(this.stride) * 0.035 * moving + Math.sin(this.time * 38) * 0.008 * strain;

    // --- cabeça, olhos, antenas ---
    this.head.rotation.x = lerp(Math.sin(this.time * 1.3) * 0.04, -0.35, pushBlend);
    this.head.rotation.y = Math.sin(this.time * 0.7) * 0.12 * (1 - moving);
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = 2 + Math.random() * 3.5;
    }
    this.blink = damp(this.blink, 0, 14, dt);
    // Pálpebra relaxada ~ meio-fechada ("olhar de galã"); força = olho arregalado.
    const lidRest = lerp(-0.35, -0.9, strain);
    for (const lid of this.eyelids) lid.rotation.x = lerp(lidRest, 0.9, this.blink);
    const look = Math.sin(this.time * 0.5) * 0.25 * (1 - moving);
    for (const pupil of this.pupils) pupil.rotation.y = look;
    this.antennae.forEach((antenna, i) => {
      const s = i === 0 ? 1 : -1;
      antenna.rotation.x = -0.5 + Math.sin(this.time * 3 + i) * 0.12 - moving * 0.3;
      antenna.rotation.z = s * Math.sin(this.time * 2.3 + i * 2) * 0.1;
    });

    // --- patas ---
    for (const leg of this.legs) {
      const walkPhase = this.stride + leg.phase;
      const swing = Math.sin(walkPhase) * 0.5 * moving;
      const lift = Math.max(0, Math.cos(walkPhase)) * 0.45 * moving;
      const airborne = grounded ? 0 : 1;

      let yaw = leg.restYaw + swing;
      let raise = 0.45 + lift + airborne * 0.35;
      let bend = -1.5 - lift * 0.4 - airborne * 0.3;

      if (pushBlend > 0.001 && leg.pair > 0) {
        // Traseiras e do meio apoiadas na bola, pedalando em ciclo.
        const p = this.pushStride + leg.phase + leg.pair;
        const cycle = Math.sin(p);
        const pushYaw = leg.pair === 2 ? -1.75 + cycle * 0.25 : -1.15 + cycle * 0.3;
        const pushRaise = leg.pair === 2 ? 0.25 + Math.max(0, Math.cos(p)) * 0.3 : 0.35 + Math.max(0, Math.cos(p)) * 0.25;
        const pushBend = leg.pair === 2 ? -0.55 : -0.95;
        yaw = lerp(yaw, pushYaw, pushBlend);
        raise = lerp(raise, pushRaise, pushBlend);
        bend = lerp(bend, pushBend, pushBlend);
      } else if (pushBlend > 0.001) {
        // Dianteiras: caminham "de ré" no chão com o corpo inclinado.
        raise = lerp(raise, 0.1 + lift * 0.6, pushBlend);
        bend = lerp(bend, -1.25, pushBlend);
      }

      // Yaw positivo = pata para frente; no lado esquerdo o grupo está girado 180°.
      leg.hip.rotation.y = -leg.side * yaw;
      leg.femur.rotation.z = raise;
      leg.knee.rotation.z = bend;
    }
  }
}
