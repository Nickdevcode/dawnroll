import * as THREE from 'three';
import { claySphere, clayCapsule, paintVertices, taperedTube } from '../../render/geometry';
import { clay } from '../../render/clayMaterial';
import { smoothstep } from '../../utils/math';
import { brim, Mat, extrude, flatRing, joint, lathe, part, starShape } from './parts';
import { CHIN_ANGLE, collarPoint } from './neckWear';
import type { AccessoryModel, OutfitPose } from './types';

/**
 * Só em baú: os exclusivos que dão vontade de abrir mais um. Chapéu de sapo,
 * disco voador, visor neon, o amuleto de escaravelho e as asas de anjo.
 */

/** Chapéu de sapinho: pescador verde com os olhões em cima, bochechas rosadas e o sorriso. */
export function frogHat(): AccessoryModel {
  const object = new THREE.Group();
  const green = Mat.felt('#6cc24a');
  const crown = lathe(
    [
      [0.118, -0.004],
      [0.117, 0.05],
      [0.108, 0.098],
      [0.084, 0.118],
      [0, 0.122],
    ],
    44,
    0.003,
    31,
  );
  object.add(part(crown, green));
  object.add(part(brim(0.112, 0.19, 0.014, (_a, t) => -t * 0.045), Mat.felt('#5aad3a')));
  for (const side of [1, -1]) {
    const eye = joint([side * 0.055, 0.115, 0.03]);
    eye.add(part(claySphere(0.042, 3, 0.03, 2, side), green, [0, 0, 0], [0, 0, 0], [1, 0.9, 1]));
    eye.add(part(claySphere(0.03, 3, 0.01), Mat.clay('#fbf6ee'), [0, 0.012, 0.022]));
    eye.add(part(claySphere(0.016, 2, 0), Mat.glossy('#1f1c24'), [0, 0.014, 0.046]));
    eye.add(part(claySphere(0.006, 1, 0), Mat.glossy('#ffffff'), [-0.006, 0.022, 0.058]));
    object.add(eye);
    object.add(part(claySphere(0.018, 2, 0), Mat.clay('#ff9fb3'), [side * 0.078, 0.045, 0.086], [0, 0, 0], [1, 0.6, 0.4]));
  }
  const smile = new THREE.TorusGeometry(0.04, 0.005, 6, 20, Math.PI * 0.8);
  object.add(part(smile, Mat.clay('#2f5a1c'), [0, 0.06, 0.112], [0.25, 0, Math.PI + Math.PI * 0.1]));
  object.rotation.set(0.02, 0, 0.06);
  return { object, hidesHorn: true };
}

/**
 * Disco voador pairando em cima da cabeça: cúpula de vidro com um ETzinho,
 * luzes piscando em volta e girando devagar.
 */
export function ufo(): AccessoryModel {
  const object = new THREE.Group();
  const hover = joint([0, 0.17, -0.02], [0, 0, 0], true);
  const saucer = lathe(
    [
      [0.001, -0.03],
      [0.06, -0.028],
      [0.15, -0.006],
      [0.17, 0.004],
      [0.15, 0.016],
      [0.08, 0.03],
      [0.001, 0.034],
    ],
    48,
    0.002,
    37,
  );
  const spin = joint([0, 0, 0], [0, 0, 0], true);
  spin.add(part(saucer, Mat.metal('#b9c3d1')));
  spin.add(part(flatRing(0.155, 0.008, 8, 48), Mat.metal('#7e8a9c'), [0, 0.006, 0]));
  // Luzes: duas turmas que piscam alternadas.
  const onMat = Mat.glow('#ffe36b', 2.6);
  const offMat = Mat.glow('#6bf0ff', 2.6);
  const lights: THREE.Mesh[] = [];
  const bulb = new THREE.SphereGeometry(0.011, 10, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const light = part(bulb, i % 2 ? onMat : offMat, [Math.cos(a) * 0.152, 0.013, Math.sin(a) * 0.152]);
    light.userData.keep = true;
    lights.push(light);
    spin.add(light);
  }
  hover.add(spin);
  // Cúpula de vidro com o piloto.
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfefff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false });
  hover.add(part(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0, 0.028, 0]));
  const alien = joint([0, 0.03, 0]);
  alien.add(part(claySphere(0.03, 3, 0.03), Mat.clay('#8fe36b'), [0, 0.03, 0], [0, 0, 0], [1, 1.1, 1]));
  for (const side of [1, -1]) {
    alien.add(part(claySphere(0.011, 2, 0), Mat.glossy('#1f1c24'), [side * 0.012, 0.036, 0.024], [0, 0, side * 0.5], [1, 1.4, 0.6]));
    alien.add(part(taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(side * 0.01, 0.055, 0), new THREE.Vector3(side * 0.02, 0.075, 0), new THREE.Vector3(side * 0.026, 0.085, 0.004)), 6, () => 0.002, 4), Mat.clay('#6cc24a')));
    alien.add(part(new THREE.SphereGeometry(0.005, 8, 6), Mat.glow('#fff4a8', 2), [side * 0.026, 0.087, 0.004]));
  }
  hover.add(alien);
  object.add(hover);
  return {
    object,
    // O chifre subia até o disco e parecia um pé segurando o OVNI.
    hidesHorn: true,
    update: (pose: OutfitPose) => {
      hover.position.y = 0.17 + Math.sin(pose.time * 2.1) * 0.015;
      hover.rotation.z = Math.sin(pose.time * 1.3) * 0.08;
      hover.rotation.x = -pose.headPitch * 0.5 + Math.sin(pose.time * 1.7) * 0.05;
      spin.rotation.y = pose.time * 1.8;
      alien.rotation.y = Math.sin(pose.time * 0.8) * 0.6;
      const blink = Math.floor(pose.time * 3) % 2;
      lights.forEach((light, i) => light.scale.setScalar(i % 2 === blink ? 1.25 : 0.55));
    },
  };
}

/** Visor neon: faixa escura espelhada abraçando os olhos, com a luz de varredura indo e voltando. */
export function cyberVisor(): AccessoryModel {
  const object = new THREE.Group();
  const R = 0.26;
  const ARC = 1.9;
  const band = new THREE.CylinderGeometry(R, R, 0.075, 40, 1, true, -ARC / 2, ARC);
  const visor = joint([0, 0.005, -0.09]);
  // Vidro fumê: dá pra ver os olhos atrás, meio escondidos.
  visor.add(part(band, new THREE.MeshPhysicalMaterial({ color: '#2a2450', roughness: 0.08, metalness: 0.3, clearcoat: 1, transparent: true, opacity: 0.72, side: THREE.DoubleSide })));
  // Bordas de cima e de baixo (tubinhos).
  for (const y of [0.0375, -0.0375]) {
    const edge = new THREE.EllipseCurve(0, 0, R, R, Math.PI / 2 - ARC / 2, Math.PI / 2 + ARC / 2, false, 0);
    const points = edge.getPoints(30).map((p) => new THREE.Vector3(p.x, y, p.y));
    visor.add(part(taperedTube(new THREE.CatmullRomCurve3(points), 30, () => 0.006, 6), Mat.plastic('#c9d2e0')));
  }
  object.add(visor);
  const scanMat = Mat.glow('#35f2ff', 3.2);
  const scan = joint([0, 0.005, -0.09], [0, 0, 0], true);
  const scanner = part(clayCapsule(0.009, 0.03, 0, 0, 8), scanMat, [0, 0, R + 0.004]);
  scanner.userData.keep = true;
  scan.add(scanner);
  object.add(scan);
  return {
    object,
    update: (pose: OutfitPose) => {
      scan.rotation.y = Math.sin(pose.time * 2.2) * (ARC / 2 - 0.08);
    },
  };
}

/**
 * Amuleto de escaravelho: colar de contas (ouro, lápis-lazúli e turquesa) e o
 * pingente do escaravelho alado, com as asas abertas em faixas de lápis,
 * turquesa e ouro e o sol de cornalina aceso que ele empurra. Largo e curto:
 * o queixo do besouro fica quase no chão (um pingente comprido some na grama).
 */
export function scarabAmulet(): AccessoryModel {
  const object = new THREE.Group();
  const goldMat = Mat.metal('#f2c14e');
  const deepGold = Mat.metal('#c9901f');
  const lapisMat = Mat.glossy('#2a4fb8');
  const turquoiseMat = Mat.glossy('#3fc6c0');
  // Colar: contas redondas de ouro e turquesa com canutilhos de lápis entre elas.
  const round = new THREE.SphereGeometry(0.0125, 12, 8);
  const tube = new THREE.CylinderGeometry(0.009, 0.009, 0.026, 10);
  const COUNT = 34;
  for (let i = 0; i < COUNT; i++) {
    const at = (i / COUNT) * Math.PI * 2;
    const p = collarPoint(at, 0.014);
    if (i % 2 === 1) {
      const next = collarPoint(at + 0.02, 0.014);
      const bead = part(tube, lapisMat, p.toArray() as [number, number, number]);
      bead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), next.sub(p).normalize());
      object.add(bead);
    } else object.add(part(round, i % 4 === 0 ? goldMat : turquoiseMat, p.toArray() as [number, number, number]));
  }
  const chin = collarPoint(CHIN_ANGLE, 0.03);
  const pivot = joint(chin.toArray() as [number, number, number], [-0.25, 0, 0], true);
  pivot.add(part(new THREE.TorusGeometry(0.012, 0.0045, 8, 16), goldMat, [0, -0.008, 0]));
  const pendant = joint([0, -0.05, 0.006]);
  // Corpo: élitros com a sutura, o pronoto e a cabeça com o "escudinho".
  pendant.add(part(claySphere(0.034, 3, 0.02), goldMat, [0, -0.012, 0], [0, 0, 0], [0.78, 1, 0.42]));
  pendant.add(part(new THREE.BoxGeometry(0.003, 0.05, 0.004), deepGold, [0, -0.014, 0.014]));
  pendant.add(part(claySphere(0.022, 2, 0.02), goldMat, [0, 0.022, 0.002], [0, 0, 0], [1.05, 0.62, 0.42]));
  pendant.add(part(claySphere(0.014, 2, 0.02), goldMat, [0, 0.038, 0.004], [0, 0, 0], [1.2, 0.55, 0.4]));
  for (const side of [1, -1]) {
    for (const [y, a] of [
      [0.012, 0.5],
      [-0.006, 0.15],
      [-0.028, -0.35],
    ] as const) {
      pendant.add(part(clayCapsule(0.0032, 0.024, 0, 0, 4), deepGold, [side * 0.03, y, 0.004], [0, 0, side * (Math.PI / 2 - a)]));
    }
  }
  // Asas abertas (o escaravelho alado): o braço de ouro no bordo de cima e três
  // fileiras de penas apontando pra fora, ouro curtinhas, turquesa e lápis compridas.
  const feather = claySphere(1, 2, 0.02, 2, 5);
  const tiers: Array<{ mat: THREE.Material; y: number; length: number; width: number; angle: number; z: number }> = [
    { mat: lapisMat, y: -0.018, length: 0.074, width: 0.022, angle: -0.34, z: -0.004 },
    { mat: turquoiseMat, y: -0.002, length: 0.058, width: 0.02, angle: -0.2, z: 0 },
    { mat: goldMat, y: 0.014, length: 0.04, width: 0.018, angle: -0.08, z: 0.004 },
  ];
  for (const side of [1, -1]) {
    // Braço: sobe em curva do ombro do escaravelho até a ponta.
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.02, 0.018, 0.002),
      new THREE.Vector3(side * 0.07, 0.034, 0),
      new THREE.Vector3(side * 0.125, 0.034, -0.006),
    ]);
    pendant.add(part(taperedTube(arm, 16, (t) => 0.0065 - t * 0.003, 6), goldMat));
    for (const tier of tiers) {
      const COUNT = 7;
      for (let k = 0; k < COUNT; k++) {
        const t = k / (COUNT - 1);
        // Raiz ao longo do braço; as de fora mais compridas e mais pra baixo (o leque).
        const rootX = 0.024 + t * 0.085;
        const rootY = tier.y + 0.028 * Math.sin(t * Math.PI * 0.8) - t * 0.01;
        const length = tier.length * (0.8 + t * 0.45);
        const angle = tier.angle - t * 0.35;
        const dx = Math.cos(angle) * side;
        const dy = Math.sin(angle);
        const mesh = part(feather, tier.mat, [side * rootX + (dx * length) / 2, rootY + (dy * length) / 2, tier.z - t * 0.006], [0, 0, side > 0 ? angle : Math.PI - angle], [length / 2, tier.width / 2, 0.0042]);
        pendant.add(mesh);
      }
    }
  }
  // O sol que o escaravelho empurra: cornalina acesa na frente da cabeça, com o aro de ouro.
  pendant.add(part(new THREE.TorusGeometry(0.019, 0.0045, 8, 24), goldMat, [0, 0.062, 0.004]));
  const sunMat = Mat.glow('#ff8a4a', 1.8);
  const sun = part(claySphere(0.016, 2, 0), sunMat, [0, 0.062, 0.006], [0, 0, 0], [1, 1, 0.5]);
  sun.userData.keep = true;
  pendant.add(sun);
  pendant.scale.setScalar(1.25);
  pivot.add(pendant);
  object.add(pivot);
  let swing = 0;
  let velocity = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      const push = Math.sin(pose.time * (4 + pose.speed * 2)) * Math.min(pose.speed / 3, 1) * 5 + pose.airborne * 3;
      velocity += (push - swing * 55 - velocity * 4) * pose.dt;
      swing += velocity * pose.dt;
      pivot.rotation.x = -0.25 + swing * 0.4 - pose.headPitch * 0.85;
      pivot.rotation.z = Math.sin(pose.time * 1.6) * 0.04 + swing * 0.2;
      sun.scale.set(0.9 + 0.2 * (0.5 + 0.5 * Math.sin(pose.time * 2.4)), 0.9 + 0.2 * (0.5 + 0.5 * Math.sin(pose.time * 2.4)), 0.5);
    },
  };
}

/**
 * Pena de asa: lâmina achatada de ponta arredondada (mais larga no terço de
 * cima, estreita na base), deitada no plano XY com a base na origem e a ponta
 * em +Y, e a ponta curvando de leve pra +Z (a asa fica côncava vista de trás).
 * Creme na base, branca no corpo e dourada na ponta (`gilt` = quanto de ouro).
 */
function featherBlade(length: number, width: number, gilt: number): THREE.BufferGeometry {
  const h = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h * 0.32, 0);
  shape.bezierCurveTo(-h * 0.85, length * 0.18, -h * 1.02, length * 0.52, -h * 0.92, length * 0.76);
  shape.bezierCurveTo(-h * 0.78, length * 0.96, -h * 0.25, length * 1.03, h * 0.08, length);
  shape.bezierCurveTo(h * 0.62, length * 0.95, h * 0.88, length * 0.78, h * 0.84, length * 0.56);
  shape.bezierCurveTo(h * 0.8, length * 0.3, h * 0.6, length * 0.1, h * 0.32, 0);
  shape.closePath();
  // Sem bisel: com 4,5 mm de espessura ele não aparece e multiplicava os triângulos (são ~100 penas).
  const geometry = extrude(shape, 0.0045, 0, 5);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / length);
    // Ponta curvando pra trás da asa e as bordas levemente viradas (pena "em canoa").
    pos.setZ(i, pos.getZ(i) + t * t * length * 0.16 + (pos.getX(i) / h) ** 2 * width * 0.08);
  }
  geometry.computeVertexNormals();
  const cream = new THREE.Color('#efe3cc');
  const white = new THREE.Color('#fffdf8');
  const gold = new THREE.Color('#f0c35a');
  return paintVertices(geometry, (p, _n, c) => {
    const t = p.y / length;
    return c.copy(cream).lerp(white, smoothstep(0.02, 0.38, t)).lerp(gold, smoothstep(0.8, 1, t) * gilt);
  });
}

interface FeatherRow {
  count: number;
  /** Onde a pena nasce no braço (k de 0 a 1 ao longo da fileira), no plano da asa. */
  root: (k: number) => THREE.Vector2;
  /** Direção da pena (graus: 0 = pra fora, -90 = pra baixo). */
  angle: (k: number) => number;
  length: (k: number) => number;
  width: number;
  /** Camada (mais negativo = mais perto da câmera de trás, por cima). */
  z: number;
  gilt: number;
  /** Com a raque (o cabinho da pena) desenhada por cima. */
  shaft: boolean;
}


/**
 * Asas de anjo: asa de ave de verdade, em camadas. O braço (bordo de ataque)
 * sobe do ombro, faz o cotovelo e o punho e segue na mão; as primárias saem
 * compridas da mão em leque, as secundárias pendem do antebraço, e por cima
 * delas duas fileiras de coberteiras curtas cobrem as bases, com as plumas
 * pequenas (marginais) arredondando o bordo. Pontas douradas de leve e umas
 * cintilas de luz subindo das pontas. A asa fica de frente pra câmera de trás
 * do jogo e "respira" devagar (abre e fecha); correndo bate mais e fecha pra
 * trás; empurrando a bola dobra pra não entrar nela.
 */
export function angelWings(): AccessoryModel {
  const object = new THREE.Group();
  // Luz própria bem de leve: o lado da sombra (o que a câmera de trás vê) continua branco-creme, não cinza.
  const featherMat = clay(0xffffff, { vertexColors: true, roughness: 0.6, sheen: 0.7, bump: 0.25, mottle: 0.05, mottleScale: 24, unique: true });
  featherMat.emissive.set('#fff1d6').multiplyScalar(0.16);
  const armMat = clay('#fffaf1', { roughness: 0.72, sheen: 0.55, bump: 0.25, mottle: 0.08, mottleScale: 24, unique: true });
  armMat.emissive.set('#fff1d6').multiplyScalar(0.14);
  const shaftMat = Mat.clay('#ecd7a4');
  // Esqueleto da asa no plano dela (x = pra fora, y = pra cima): ombro, cotovelo, punho, ponta da mão.
  const SHOULDER = new THREE.Vector2(0, 0);
  const ELBOW = new THREE.Vector2(0.06, 0.18);
  const WRIST = new THREE.Vector2(0.16, 0.31);
  const TIP = new THREE.Vector2(0.27, 0.37);
  const along = (a: THREE.Vector2, b: THREE.Vector2, k: number) => a.clone().lerp(b, k);
  const DEG = Math.PI / 180;
  const rows: FeatherRow[] = [
    // Primárias: da mão, abrindo em leque até quase na horizontal.
    { count: 8, root: (k) => along(WRIST, TIP, k), angle: (k) => -62 + k * 78, length: (k) => 0.24 + k * 0.07, width: 0.058, z: 0, gilt: 0.85, shaft: true },
    // Secundárias: do antebraço, pendendo pra baixo e pra fora.
    { count: 7, root: (k) => along(ELBOW, WRIST, k), angle: (k) => -86 + k * 18, length: (k) => 0.19 + k * 0.03, width: 0.062, z: -0.004, gilt: 0.55, shaft: true },
    // Terciárias: curtas, perto do ombro.
    { count: 3, root: (k) => along(SHOULDER, ELBOW, 0.45 + k * 0.4), angle: (k) => -78 + k * 4, length: (k) => 0.12 + k * 0.03, width: 0.06, z: -0.006, gilt: 0.25, shaft: false },
    // Coberteiras maiores: cobrem as bases das secundárias e das primárias.
    {
      count: 11,
      root: (k) => (k < 0.55 ? along(ELBOW, WRIST, k / 0.55) : along(WRIST, TIP, ((k - 0.55) / 0.45) * 0.8)).add(new THREE.Vector2(0, -0.035)),
      angle: (k) => -84 + k * 60,
      length: () => 0.105,
      width: 0.056,
      z: -0.011,
      gilt: 0.1,
      shaft: false,
    },
    // Coberteiras menores: a fileira de cima, mais curtas.
    {
      count: 10,
      root: (k) => (k < 0.4 ? along(SHOULDER, ELBOW, 0.35 + (k / 0.4) * 0.65) : along(ELBOW, TIP, ((k - 0.4) / 0.6) * 0.72)).add(new THREE.Vector2(0, -0.012)),
      angle: (k) => -80 + k * 40,
      length: () => 0.068,
      width: 0.05,
      z: -0.016,
      gilt: 0,
      shaft: false,
    },
  ];
  /** Plumas marginais: escamas pequenas logo abaixo do bordo, arredondando o braço. */
  const MARGINALS = 12;
  const bladeCache = new Map<string, THREE.BufferGeometry>();
  const blade = (length: number, width: number, gilt: number) => {
    const key = `${length.toFixed(3)}:${width}:${gilt}`;
    let g = bladeCache.get(key);
    if (!g) bladeCache.set(key, (g = featherBlade(length, width, gilt)));
    return g;
  };
  const hinges: THREE.Group[] = [];
  const tips: Array<{ hinge: THREE.Group; at: THREE.Vector3 }> = [];
  for (const side of [1, -1] as const) {
    const hinge = joint([side * 0.05, 0.075, -0.13], [0, 0, 0], true);
    const wing = new THREE.Group();
    wing.scale.setScalar(1.06);
    const place = (geometry: THREE.BufferGeometry, material: THREE.Material, root: THREE.Vector2, angle: number, z: number) => {
      // A pena aponta pra +Y no desenho: gira pra direção pedida (espelhada do outro lado).
      const rot = side * (angle * DEG - Math.PI / 2);
      wing.add(part(geometry, material, [side * root.x, root.y, z], [0, 0, rot]));
    };
    rows.forEach((row, r) => {
      for (let i = 0; i < row.count; i++) {
        const k = row.count === 1 ? 0 : i / (row.count - 1);
        const length = row.length(k);
        const root = row.root(k);
        // Cada pena um tiquinho à frente da vizinha de fora (sem brigar no mesmo plano).
        const z = row.z - (row.count - i) * 0.0007 - r * 0.0002;
        place(blade(length, row.width, row.gilt), featherMat, root, row.angle(k), z);
        if (row.shaft) {
          // Cilindro simples (a cápsula de massinha faz um anel a cada raio de comprimento: ~800 triângulos por raque).
          const shaft = new THREE.CylinderGeometry(0.0016, 0.0026, length * 0.8, 5, 1).translate(0, length * 0.42, 0);
          place(shaft, shaftMat, root, row.angle(k), z - 0.0035);
        }
        if (r === 0 && i % 2 === 1) {
          const a = row.angle(k) * DEG;
          tips.push({ hinge, at: new THREE.Vector3(side * (root.x + Math.cos(a) * length), root.y + Math.sin(a) * length, z).multiplyScalar(wing.scale.x) });
        }
      }
    });
    // Braço: tubo branco arredondado seguindo o bordo de ataque (a curva de cima da asa).
    const arm = new THREE.CatmullRomCurve3([SHOULDER, ELBOW, WRIST, TIP].map((p) => new THREE.Vector3(side * p.x, p.y, -0.014)));
    wing.add(part(taperedTube(arm, 28, (t) => 0.024 - t * 0.012, 8), armMat));
    wing.add(part(claySphere(0.026, 2, 0.02), armMat, [0, 0, -0.014]));
    wing.add(part(claySphere(0.013, 2, 0.02), armMat, [side * TIP.x, TIP.y, -0.014]));
    for (let i = 0; i < MARGINALS; i++) {
      const t = 0.08 + (i / (MARGINALS - 1)) * 0.86;
      const p = arm.getPointAt(t);
      const tangent = arm.getTangentAt(t);
      // Aponta "pra baixo do bordo" (perpendicular ao braço, pro lado de dentro da asa).
      const down = Math.atan2(tangent.y, tangent.x * side) / DEG - 90;
      place(blade(0.042, 0.04, 0), featherMat, new THREE.Vector2(p.x * side, p.y + 0.012), down + 8, -0.021 - i * 0.0006);
    }
    hinge.add(wing);
    hinges.push(hinge);
    object.add(hinge);
  }
  // Cintilas: estrelinhas de luz própria que nascem nas pontas das primárias e sobem sumindo.
  const SPARKS = 8;
  const sparks = new THREE.InstancedMesh(extrude(starShape(4, 0.016, 0.005), 0.003, 0.001), Mat.glow('#fff1bf', 2.4), SPARKS);
  sparks.userData.keep = true;
  sparks.frustumCulled = false;
  object.add(sparks);
  const matrix = new THREE.Matrix4();
  const spin = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  let fold = 0;
  return {
    object,
    update: (pose: OutfitPose) => {
      const run = Math.min(pose.speed / 4, 1);
      fold += (pose.pushBlend - fold) * Math.min(1, pose.dt * 5);
      // Respira devagar parado; correndo e no ar bate mais rápido e mais aberto.
      const beat = Math.sin(pose.time * (1.6 + run * 4.5 + pose.airborne * 5));
      const sweep = 0.36 + beat * (0.1 + run * 0.1 + pose.airborne * 0.14) + run * 0.18 + fold * 0.55;
      hinges.forEach((hinge, i) => {
        const side = i === 0 ? 1 : -1;
        hinge.rotation.set(-0.16 - run * 0.14 - fold * 0.2, side * sweep, side * (0.06 + beat * 0.05 - fold * 0.25));
        hinge.updateMatrix();
      });
      for (let i = 0; i < SPARKS; i++) {
        // Cada cintila tem seu ciclo: nasce numa ponta, sobe devagar girando e apaga.
        const CYCLE = 2.6;
        const t = ((pose.time + i * (CYCLE / SPARKS)) % CYCLE) / CYCLE;
        const tip = tips[(i * 3) % tips.length];
        at.copy(tip.at).applyMatrix4(tip.hinge.matrix);
        at.y += t * 0.16;
        at.x += Math.sin(pose.time * 2 + i) * 0.015;
        const s = Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(pose.time * 9 + i * 2));
        spin.setFromEuler(euler.set(0, pose.time * 1.5 + i, pose.time * 2 + i));
        sparks.setMatrixAt(i, matrix.compose(at, spin, size.setScalar(Math.max(0.001, s))));
      }
      sparks.instanceMatrix.needsUpdate = true;
    },
  };
}
