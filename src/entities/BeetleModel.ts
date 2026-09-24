import * as THREE from 'three';
import { clay } from '../render/clayMaterial';
import { DEFAULT_CLUB, DEFAULT_SKIN, skin, type SkinDef } from '../progression/skins';
import type { Outfit } from '../progression/accessories';
import { claySphere, clayCapsule, displace, paintVertices, taperedTube } from '../render/geometry';
import { mergeStaticTree } from '../render/mergeStatic';
import { SkinPart, applySkinUniforms, createSkinUniforms, installSkinShader, type SkinPartId, type SkinUniforms } from '../render/skinShader';
import { noise3 } from '../utils/noise';
import { clamp, damp, lerp, smoothstep } from '../utils/math';
import { BeetleOutfit } from './outfit/BeetleOutfit';
import type { OutfitAnchors, OutfitPose } from './outfit/types';

/**
 * Modelo procedural do besouro rola-bosta.
 *
 * Convenção local: +Z = frente (cabeça), +Y = cima, origem no chão sob o corpo.
 * Não há esqueleto nem arquivo externo: as patas são cadeias de grupos
 * (quadril → fêmur → joelho → tíbia → tarso) animadas por fase, e a pose de
 * "empurrar a bola" é uma segunda pose misturada por `pushBlend`.
 *
 * O visual (casco e acessórios) troca na hora: o casco é um material só, com o
 * desenho no shader (`render/skinShader.ts`); os acessórios encaixam em quatro
 * pontos (`anchors`) e são montados por `BeetleOutfit`.
 */

/** Cores que não mudam com o casco (olhos, bochecha, boca). */
const Colors = {
  eyeWhite: '#fbf6ee',
  pupil: '#151019',
  cheek: '#ff9aa8',
  mouth: '#1b1424',
};

interface Leg {
  side: 1 | -1;
  /** 0 = dianteira, 1 = meio, 2 = traseira */
  pair: 0 | 1 | 2;
  hip: THREE.Group;
  femur: THREE.Group;
  knee: THREE.Group;
  tarsus: THREE.Group;
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

/**
 * O degradê do casco e das patas é assado nos vértices só como SOMBRA (tons de
 * cinza); a cor vem do material (e, no casco, do desenho no shader). Assim
 * trocar de casco não repinta malha nenhuma (e as peças fundidas continuam fundidas).
 *
 * `EDGE_SHADE` = quanto a borda de baixo é mais escura que o topo: a razão de
 * luminância (linear) entre as duas cores do casco índigo original.
 */
const luminance = (hex: string) => {
  const c = new THREE.Color(hex);
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
};
const EDGE_SHADE = luminance('#1c1842') / luminance('#3d3689');
const LEG_TIP_SHADE = luminance('#1f1830') / luminance('#352a4d');
const WHITE = new THREE.Color(1, 1, 1);

/** Tempos da piscada (s): a pálpebra desce rápido, segura um instante e sobe sem pressa. */
const BLINK = { close: 0.06, hold: 0.04, open: 0.13 } as const;

/** Quanto a pálpebra está fechada (0..1) `t` segundos depois do começo da piscada. */
function blinkClosure(t: number): number {
  if (t < BLINK.close) return smoothstep(0, BLINK.close, t);
  if (t < BLINK.close + BLINK.hold) return 1;
  return 1 - smoothstep(0, BLINK.open, t - BLINK.close - BLINK.hold);
}

/**
 * Esfera com os polos no eixo Z (o comprimento do besouro): os anéis da malha
 * correm ao longo do corpo, então as estrias do élitro saem retinhas.
 */
function zSphere(widthSegments: number, heightSegments: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Sombra do casco: claro em cima, quase preto na borda de baixo, sulcos mais escuros. */
function paintShell(geometry: THREE.BufferGeometry, grooveAt?: (p: THREE.Vector3) => number): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  paintVertices(geometry, (p, n, c) => {
    const h = (p.y - box.min.y) / Math.max(box.max.y - box.min.y, 1e-4);
    c.setScalar(EDGE_SHADE).lerp(WHITE, smoothstep(0.1, 0.85, h) * 0.8 + smoothstep(0.2, 1, n.y) * 0.2);
    if (grooveAt) c.multiplyScalar(1 - grooveAt(p) * 0.3);
    return c;
  });
}

const tmpMatrix = new THREE.Matrix4();
const tmpVertex = new THREE.Vector3();

export class BeetleModel {
  readonly root = new THREE.Group();
  /** Onde os acessórios encaixam (cabeça, rosto, pescoço, costas). */
  readonly anchors: OutfitAnchors;
  /** Acessórios vestidos agora. */
  readonly outfit: BeetleOutfit;
  /** Corpo inteiro (inclina na pose de empurrar). */
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  /** Chifre (some quando o chapéu cobre o topo da cabeça). */
  private readonly horn = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly antennae: THREE.Group[] = [];
  private readonly eyelids: THREE.Mesh[] = [];
  private readonly pupils: THREE.Group[] = [];
  /**
   * Materiais do visual, próprios deste besouro (fora do cache da massinha):
   * trocar de casco mexe neles sem repintar mais nada do jardim.
   */
  private readonly shellMat: THREE.MeshPhysicalMaterial;
  private readonly bellyMat: THREE.MeshPhysicalMaterial;
  private readonly legMat: THREE.MeshPhysicalMaterial;
  private readonly stalkMat: THREE.MeshPhysicalMaterial;
  private readonly clubMat: THREE.MeshPhysicalMaterial;
  private readonly skinUniforms: SkinUniforms = createSkinUniforms();
  private readonly outfitPose: OutfitPose = { time: 0, dt: 0, speed: 0, pushBlend: 0, airborne: 0, verticalSpeed: 0, headPitch: 0 };

  private time = 0;
  private stride = 0;
  private pushStride = 0;
  private blinkTimer = 2.5;
  /** Segundos desde o começo da piscada em curso (negativo = olho aberto). */
  private blinkAge = -1;
  private squash = 1;
  private landingImpulse = 0;
  private wasGrounded = true;

  constructor(initialSkin: SkinDef = skin(DEFAULT_SKIN)) {
    // Casco inteiro (élitros, pronoto, cabeça, chifre e pálpebras) num material só:
    // a cor de cada parte e o desenho saem do shader, pelo `skinPos` de cada vértice.
    this.shellMat = clay('#ffffff', { vertexColors: true, roughness: 0.4, sheen: 0.55, iridescence: 0.85, clearcoat: 0.55, bump: 0.2, mottle: 0.05, mottleScale: 7, unique: true });
    installSkinShader(this.shellMat, this.skinUniforms);
    this.bellyMat = clay(initialSkin.belly, { roughness: 0.5, sheen: 0.5, iridescence: 0.5, bump: 0.25, mottleScale: 8, unique: true });
    this.legMat = clay(initialSkin.leg, { vertexColors: true, roughness: 0.5, sheen: 0.5, bump: 0.15, clearcoat: 0.2, mottleScale: 12, unique: true });
    this.stalkMat = clay(initialSkin.leg, { bump: 0.1, mottleScale: 20, unique: true });
    this.clubMat = clay(DEFAULT_CLUB, { roughness: 0.5, sheen: 0.7, bump: 0.12, clearcoat: 0.3, mottleScale: 20, unique: true });
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
    // Antes de fundir: cada peça do casco guarda onde ela fica no corpo em repouso.
    this.bakeSkinPositions();
    // ~150 peças viram ~45 draw calls: enfeites presos na mesma junta são fundidos.
    mergeStaticTree(this.root);

    this.anchors = this.buildAnchors();
    this.outfit = new BeetleOutfit(this.anchors, (visible) => (this.horn.visible = visible));
    this.setSkin(initialSkin);
  }

  /** Troca o casco: cores, brilho e desenho dos materiais (nada é reconstruído nem recompilado). */
  setSkin(def: SkinDef): void {
    applySkinUniforms(this.skinUniforms, def);
    this.shellMat.iridescence = def.iridescence;
    this.shellMat.roughness = def.roughness;
    this.shellMat.metalness = def.metalness ?? 0;
    this.bellyMat.color.set(def.belly);
    this.legMat.color.set(def.leg);
    this.stalkMat.color.set(def.leg);
    this.clubMat.color.set(def.club ?? DEFAULT_CLUB);
  }

  /** Veste os acessórios (os que já estavam e não mudaram ficam como estão). */
  setOutfit(outfit: Readonly<Outfit>): void {
    this.outfit.set(outfit);
  }

  /** Posição de mundo da testa (de onde pinga o suor quando faz força). */
  getHeadPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(target);
  }

  /**
   * Quantas vezes um trio de patas já pousou no chão (marcha em tripé: a pata
   * desce quando o cosseno da fase dela cruza zero, a cada meia volta da
   * passada). O som dos passos conta os incrementos e fica no ritmo da animação.
   */
  get footfalls(): number {
    return Math.floor(this.stride / Math.PI + 0.5);
  }

  /** Peça do casco: material do casco e a parte dela (o desenho muda por parte). */
  private shellMesh(geometry: THREE.BufferGeometry, part: SkinPartId): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.shellMat);
    mesh.userData.skinPart = part;
    return mesh;
  }

  /**
   * Grava em cada vértice do casco a posição dele no espaço do corpo em repouso
   * (e a parte, no `w`). Geometria dividida entre peças (as duas metades do
   * élitro, os dentes da pá, as pálpebras) vira cópia: cada peça tem a sua.
   */
  private bakeSkinPositions(): void {
    this.root.updateMatrixWorld(true);
    const toBody = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.skinPart === undefined) return;
      mesh.geometry = mesh.geometry.clone();
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const data = new Float32Array(pos.count * 4);
      tmpMatrix.multiplyMatrices(toBody, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        tmpVertex.fromBufferAttribute(pos, i).applyMatrix4(tmpMatrix);
        data[i * 4] = tmpVertex.x;
        data[i * 4 + 1] = tmpVertex.y;
        data[i * 4 + 2] = tmpVertex.z;
        data[i * 4 + 3] = mesh.userData.skinPart;
      }
      mesh.geometry.setAttribute('skinPos', new THREE.BufferAttribute(data, 4));
    });
  }

  private buildAnchors(): OutfitAnchors {
    const anchor = (parent: THREE.Object3D, name: string, x: number, y: number, z: number) => {
      const group = new THREE.Group();
      group.name = `anchor-${name}`;
      group.position.set(x, y, z);
      parent.add(group);
      return group;
    };
    return {
      head: anchor(this.head, 'head', 0, 0.19, 0.1),
      face: anchor(this.head, 'face', 0, 0.1, 0.16),
      neck: anchor(this.head, 'neck', 0, 0, 0),
      back: anchor(this.body, 'back', 0, 0.58, 0.1),
    };
  }

  private buildShell(): void {
    const belly = this.bellyMat;

    // Élitros: duas metades com estrias longitudinais que se encostam no meio (sutura).
    const STRIAE = 26;
    const grooveAt = (p: THREE.Vector3) => {
      const theta = Math.atan2(p.y, p.x);
      const s = Math.abs(Math.sin(theta * STRIAE * 0.5));
      return (1 - smoothstep(0, 0.3, s)) * smoothstep(0.97, 0.72, Math.abs(p.z));
    };
    const elytraGeo = displace(zSphere(104, 48), (x, y, z) => {
      const p = new THREE.Vector3(x, y, z);
      return -grooveAt(p) * 0.028 + noise3(x * 3, y * 3, z * 3) * 0.012;
    });
    paintShell(elytraGeo, grooveAt);
    for (const side of [1, -1]) {
      const half = this.shellMesh(elytraGeo, SkinPart.elytra);
      half.scale.set(0.205, 0.25, 0.43);
      half.position.set(side * 0.172, 0.36, -0.13);
      half.rotation.set(0.12, side * 0.05, side * -0.08);
      this.body.add(half);
    }
    // Escutelo: o triangulinho entre os élitros, logo atrás do pronoto.
    const scutellumGeo = claySphere(1, 4, 0.03);
    paintShell(scutellumGeo);
    const scutellum = this.shellMesh(scutellumGeo, SkinPart.elytra);
    scutellum.scale.set(0.05, 0.03, 0.08);
    scutellum.position.set(0, 0.6, 0.12);
    scutellum.rotation.x = 0.35;
    this.body.add(scutellum);

    // Barriga escura por baixo: dá volume e esconde a junção das patas.
    const bellyMesh = new THREE.Mesh(claySphere(1, 6, 0.04, 2, 8), belly);
    bellyMesh.scale.set(0.3, 0.13, 0.46);
    bellyMesh.position.set(0, 0.24, -0.05);
    this.body.add(bellyMesh);
    // Segmentos do abdômen: placas sobrepostas por baixo, aparecendo só na traseira.
    const plateGeo = claySphere(1, 5, 0.03, 2, 21);
    for (let i = 0; i < 4; i++) {
      const plate = new THREE.Mesh(plateGeo, belly);
      plate.scale.set(0.27 - i * 0.035, 0.07, 0.12);
      plate.position.set(0, 0.2 + i * 0.018, -0.18 - i * 0.075);
      plate.rotation.x = -0.25 - i * 0.12;
      this.body.add(plate);
    }

    // Pronoto (o "escudo" do tórax): largo, com a borda levantada e pontinhos.
    const pronotumGeo = displace(zSphere(72, 36), (x, y, z) => {
      const rim = Math.exp(-(((y + 0.05) / 0.16) ** 2)) * 0.05;
      const pits = -Math.max(0, noise3(x * 16, y * 16, z * 16) - 0.35) * 0.06;
      return rim + pits;
    });
    paintShell(pronotumGeo);
    const pronotum = this.shellMesh(pronotumGeo, SkinPart.pronotum);
    pronotum.scale.set(0.33, 0.2, 0.22);
    pronotum.position.set(0, 0.37, 0.28);
    pronotum.rotation.x = -0.15;
    this.body.add(pronotum);
  }

  private buildHead(): void {
    this.head.position.set(0, 0.3, 0.46);
    this.body.add(this.head);

    // Cabeça em forma de pá (clípeo) — é com ela que o rola-bosta molda a bola.
    const shovelGeo = claySphere(1, 8, 0.03, 2, 17);
    paintShell(shovelGeo);
    const shovel = this.shellMesh(shovelGeo, SkinPart.head);
    shovel.scale.set(0.25, 0.1, 0.19);
    shovel.position.set(0, 0, 0.1);
    this.head.add(shovel);
    // Serrilhado da borda da pá.
    const toothGeo = claySphere(0.035, 3, 0.1, 3, 2);
    paintShell(toothGeo);
    for (let i = -3; i <= 3; i++) {
      const tooth = this.shellMesh(toothGeo, SkinPart.head);
      const a = i * 0.26;
      tooth.position.set(Math.sin(a) * 0.235, -0.02, 0.1 + Math.cos(a) * 0.175);
      tooth.scale.set(i === 0 ? 1.2 : 0.9, 0.55, 1.1);
      this.head.add(tooth);
    }

    // Chifre em "topete": o charme do bonitão. Tubo afinando + pontinha arredondada.
    // Grupo próprio (um draw call a mais): chapéu que cobre o topo da cabeça esconde ele.
    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.04, 0.08),
      new THREE.Vector3(0, 0.18, 0.13),
      new THREE.Vector3(0, 0.3, 0.06),
      new THREE.Vector3(0, 0.34, -0.07),
    ]);
    const hornGeo = taperedTube(hornCurve, 24, (t) => lerp(0.068, 0.022, Math.pow(t, 0.8)), 14);
    paintShell(hornGeo);
    this.horn.name = 'horn';
    this.horn.add(this.shellMesh(hornGeo, SkinPart.head));
    const hornTipGeo = claySphere(0.023, 3, 0.02);
    paintShell(hornTipGeo);
    const hornTip = this.shellMesh(hornTipGeo, SkinPart.head);
    hornTip.position.copy(hornCurve.getPoint(1));
    this.horn.add(hornTip);
    this.head.add(this.horn);

    // Olhos grandes com pálpebra meio baixa = olhar confiante.
    const white = clay(Colors.eyeWhite, { roughness: 0.3, sheen: 0.2, bump: 0.05, clearcoat: 0.6, mottle: 0.02 });
    const pupilMat = clay(Colors.pupil, { roughness: 0.2, sheen: 0, bump: 0, clearcoat: 1, mottle: 0 });
    const highlight = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeGeo = claySphere(0.085, 6, 0.015, 2, 1);
    const pupilGeo = new THREE.SphereGeometry(0.046, 24, 16);
    const glintGeo = new THREE.SphereGeometry(0.011, 10, 8);
    // Pálpebra: meia-esfera lisa, com "sombra" branca (a cor e o desenho vêm do casco).
    const lidGeo = paintVertices(new THREE.SphereGeometry(0.094, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), (_p, _n, c) => c.copy(WHITE));

    for (const side of [1, -1] as const) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.13, 0.1, 0.16);
      eye.rotation.y = side * 0.35;
      this.head.add(eye);

      eye.add(new THREE.Mesh(eyeGeo, white));

      // Pupila: lente achatada cuja borda encosta na superfície do olho (raio 0,085) e
      // o centro sobressai ~2 mm, acima até das ondulações da massinha. Tudo nela
      // (e nos brilhos) fica a menos de 0,093 do centro: a pálpebra (0,094) cobre ao piscar.
      const pupilPivot = new THREE.Group();
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.0716;
      pupil.scale.set(1, 1.1, 0.35);
      // Brilhos achatados, meio afundados na pupila (de pé eles vazavam pela pálpebra fechada).
      const glint = new THREE.Mesh(glintGeo, highlight);
      glint.scale.set(1, 1, 0.45);
      glint.position.set(0.016, 0.02, 0.083);
      const glintSmall = new THREE.Mesh(glintGeo, highlight);
      glintSmall.scale.set(0.5, 0.5, 0.225);
      glintSmall.position.set(-0.013, -0.015, 0.0853);
      pupilPivot.add(pupil, glint, glintSmall);
      eye.add(pupilPivot);
      this.pupils.push(pupilPivot);

      // Pálpebra: meia-esfera que desce (piscar) e fica meio fechada no repouso.
      const lid = this.shellMesh(lidGeo, SkinPart.head);
      lid.rotation.x = -0.35;
      lid.userData.keep = true; // animada (piscar): não pode ser fundida
      eye.add(lid);
      this.eyelids.push(lid);

      // Bochecha rosada.
      const cheek = new THREE.Mesh(claySphere(0.045, 4, 0.05, 2, side), clay(Colors.cheek, { roughness: 0.8, sheen: 0.6, bump: 0.1, mottleScale: 20 }));
      cheek.scale.set(1, 0.55, 0.6);
      cheek.position.set(side * 0.17, 0.02, 0.2);
      this.head.add(cheek);

      // Antena: haste fina curvada + clava lamelada em leque (as "folhinhas" dos escarabeídeos).
      const antenna = new THREE.Group();
      antenna.position.set(side * 0.1, 0.03, 0.24);
      antenna.rotation.set(-0.5, side * 0.7, 0);
      const stalkCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.09, -0.02), new THREE.Vector3(0, 0.155, 0.015));
      const stalk = new THREE.Mesh(taperedTube(stalkCurve, 10, (t) => lerp(0.014, 0.009, t), 6), this.stalkMat);
      antenna.add(stalk);
      const lamellaGeo = claySphere(0.04, 4, 0.05, 2, side);
      for (let i = 0; i < 3; i++) {
        const lamella = new THREE.Mesh(lamellaGeo, this.clubMat);
        lamella.scale.set(1, 0.3, 0.85);
        lamella.position.set(0, 0.165 + i * 0.02, 0.018);
        lamella.rotation.set((i - 1) * 0.25, 0, (i - 1) * 0.12);
        antenna.add(lamella);
      }
      this.head.add(antenna);
      this.antennae.push(antenna);
    }

    // Sorrisinho de canto (as mandíbulas, na real).
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 10, 24, Math.PI * 0.7), clay(Colors.mouth, { bump: 0, mottle: 0 }));
    smile.position.set(0.015, -0.035, 0.28);
    smile.rotation.set(0.35, 0, Math.PI + 0.55);
    this.head.add(smile);
  }

  private buildLegs(): void {
    const legMat = this.legMat;
    /** Sombra ao longo do eixo X local: base na cor da pata, ponta mais escura. */
    const paintAlong = (geometry: THREE.BufferGeometry, from: number, to: number) =>
      paintVertices(geometry, (p, n, c) => c.setScalar(1 + (LEG_TIP_SHADE - 1) * clamp((p.x - from) / (to - from), 0, 1) * 0.7).multiplyScalar(0.92 + n.y * 0.12));

    const spikeGeo = paintAlong(new THREE.ConeGeometry(0.016, 0.07, 6).rotateZ(-Math.PI / 2).translate(0.035, 0, 0), 0, 0.07);
    const toothGeo = paintAlong(new THREE.ConeGeometry(0.024, 0.075, 6).rotateZ(-Math.PI / 2).translate(0.037, 0, 0), 0, 0.075);
    const hairGeo = paintAlong(new THREE.ConeGeometry(0.005, 0.05, 3).rotateZ(-Math.PI / 2).translate(0.025, 0, 0), 0, 0.05);
    const jointGeo = paintAlong(claySphere(0.038, 4, 0.05, 2, 5), -0.04, 0.04);
    const tarsusGeo = paintAlong(clayCapsule(0.016, 0.03, 0.05, 2, 8).rotateZ(-Math.PI / 2).translate(0.03, 0, 0), 0, 0.06);
    const clawGeo = paintAlong(
      taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0, 0), new THREE.Vector3(0.045, -0.025, 0)), 6, (t) => lerp(0.008, 0.002, t), 5),
      0,
      0.05,
    );

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

        // Coxa: "bolinha" de encaixe no corpo.
        const coxa = new THREE.Mesh(jointGeo, legMat);
        coxa.scale.setScalar(1.3);
        hip.add(coxa);

        const femur = new THREE.Group();
        hip.add(femur);
        // Fêmur mais grosso no meio (músculo), afinando nas pontas.
        const femurGeo = paintAlong(
          displace(new THREE.CapsuleGeometry(0.036, femurLen, 6, 12, 6).rotateZ(-Math.PI / 2), (x) => Math.sin(clamp(x / femurLen + 0.5, 0, 1) * Math.PI) * 0.01),
          -femurLen / 2,
          femurLen / 2,
        );
        const femurMesh = new THREE.Mesh(femurGeo, legMat);
        femurMesh.position.x = femurLen / 2;
        femur.add(femurMesh);

        const knee = new THREE.Group();
        knee.position.x = femurLen;
        femur.add(knee);
        knee.add(new THREE.Mesh(jointGeo, legMat));
        const tibiaRadius = pair === 0 ? 0.034 : 0.026;
        const tibiaGeo = paintAlong(
          displace(new THREE.CapsuleGeometry(tibiaRadius, tibiaLen, 6, 12, 6).rotateZ(-Math.PI / 2), (x) => (x / tibiaLen) * 0.008),
          -tibiaLen / 2,
          tibiaLen / 2,
        );
        const tibiaMesh = new THREE.Mesh(tibiaGeo, legMat);
        tibiaMesh.position.x = tibiaLen / 2;
        knee.add(tibiaMesh);

        // Dianteiras: dentes grandes na borda de fora (pá de cavar). Outras: espinhos.
        const teeth = pair === 0 ? 4 : 3;
        for (let i = 0; i < teeth; i++) {
          const spike = new THREE.Mesh(pair === 0 ? toothGeo : spikeGeo, legMat);
          spike.position.set(tibiaLen * (0.3 + i * (0.6 / teeth)), 0.015, pair === 0 ? 0.012 : 0);
          spike.rotation.set(0, pair === 0 ? -0.5 : 0, 0.9 + i * 0.1);
          knee.add(spike);
        }
        // Pelinhos (cerdas) na parte de baixo da tíbia.
        for (let i = 0; i < 4; i++) {
          const hair = new THREE.Mesh(hairGeo, legMat);
          hair.position.set(tibiaLen * (0.2 + i * 0.18), -tibiaRadius * 0.7, (i % 2 ? 1 : -1) * tibiaRadius * 0.5);
          hair.rotation.set((i % 2 ? 1 : -1) * 0.5, 0, -1.1);
          knee.add(hair);
        }
        // Esporão na ponta da tíbia.
        const spur = new THREE.Mesh(spikeGeo, legMat);
        spur.position.set(tibiaLen, -0.01, 0);
        spur.rotation.z = -0.9;
        knee.add(spur);

        // Tarso: três segmentinhos dobrando para o chão + duas garras.
        const tarsus = new THREE.Group();
        tarsus.position.x = tibiaLen + 0.015;
        tarsus.rotation.z = -0.55;
        knee.add(tarsus);
        let parent: THREE.Object3D = tarsus;
        for (let i = 0; i < 3; i++) {
          const seg = new THREE.Group();
          seg.position.x = i === 0 ? 0 : 0.055;
          seg.rotation.z = i === 0 ? 0 : -0.18;
          seg.add(new THREE.Mesh(tarsusGeo, legMat));
          parent.add(seg);
          parent = seg;
        }
        for (const claw of [1, -1]) {
          const c = new THREE.Mesh(clawGeo, legMat);
          c.position.x = 0.055;
          c.rotation.y = claw * 0.35;
          parent.add(c);
        }

        this.body.add(mount);
        this.legs.push({
          side,
          pair: pair as 0 | 1 | 2,
          hip,
          femur,
          knee,
          tarsus,
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
    // O chapéu desconta boa parte do "levantar a cabeça": senão a aba de trás afunda no pronoto.
    this.anchors.head.rotation.x = -this.head.rotation.x * 0.75;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkAge = 0;
      this.blinkTimer = 2 + Math.random() * 3.5;
    }
    let blink = 0;
    if (this.blinkAge >= 0) {
      blink = blinkClosure(this.blinkAge);
      this.blinkAge += dt;
      if (this.blinkAge >= BLINK.close + BLINK.hold + BLINK.open) this.blinkAge = -1;
    }
    // Pálpebra relaxada ~ meio-fechada ("olhar de galã"); força = olho arregalado.
    const lidRest = lerp(-0.35, -0.9, strain);
    for (const lid of this.eyelids) lid.rotation.x = lerp(lidRest, 0.9, blink);
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
      // O tarso "procura" o chão: dobra mais quando a pata desce, estica no ar.
      leg.tarsus.rotation.z = -0.55 + lift * 0.5 - airborne * 0.2;
    }

    // --- acessórios (capa, hélice, asas...) ---
    const o = this.outfitPose;
    o.time = this.time;
    o.dt = dt;
    o.speed = speed;
    o.pushBlend = pushBlend;
    o.airborne = grounded ? 0 : clamp(Math.abs(verticalSpeed) / 3, 0, 1);
    o.verticalSpeed = verticalSpeed;
    o.headPitch = this.body.rotation.x + this.head.rotation.x;
    this.outfit.update(o);
  }
}
