import * as THREE from 'three';
import { paintVertices } from '../../render/geometry';
import { noise3 } from '../../utils/noise';

/**
 * Formas orgânicas reaproveitadas pelo cenário e pelos detritos: folha, pétala,
 * sólidos de torno (lathe) com perfil suave. Tudo em espaço local, pronto para
 * posicionar com Object3D.
 */

export interface LeafOptions {
  /** Dobra em "V" ao longo da nervura (0 = chata). */
  fold?: number;
  /** Curvatura ao longo do comprimento (a ponta cai). */
  curl?: number;
  /** Onde fica a parte mais larga (0..1 do comprimento). */
  widest?: number;
  /** 0 = ponta fina (folha), 1 = ponta arredondada (pétala). */
  roundTip?: number;
  segmentsL?: number;
  segmentsW?: number;
  /** Nervura central mais clara pintada nos vértices. */
  vein?: boolean;
}

/**
 * Folha/pétala: grade deformada, base na origem, crescendo em +Z com a face para +Y.
 * O vertex color traz nervura clara e borda levemente mais escura.
 */
export function leafGeometry(length: number, width: number, options: LeafOptions = {}): THREE.BufferGeometry {
  const { fold = 0.25, curl = 0.3, widest = 0.4, roundTip = 0, segmentsL = 10, segmentsW = 4, vein = true } = options;
  const geometry = new THREE.PlaneGeometry(1, 1, segmentsW * 2, segmentsL);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2; // -1..1 (largura)
    const t = pos.getY(i) + 0.5; // 0..1 (comprimento)
    // Perfil da largura: sobe até `widest` e fecha na ponta (arredondada ou fina).
    const rise = Math.sin(Math.min(t / widest, 1) * Math.PI * 0.5);
    const fall = t <= widest ? 1 : Math.pow(Math.cos(((t - widest) / (1 - widest)) * Math.PI * 0.5), 0.6 + (1 - roundTip) * 0.8);
    const w = width * 0.5 * rise * fall;
    // Espelhado em X de propósito: vira o sentido dos triângulos e a face fica para +Y.
    const x = -u * w;
    const z = t * length;
    // Dobra em V e curvatura (a ponta cai para baixo).
    const y = Math.abs(u) * w * fold - t * t * curl * length * 0.5;
    pos.setXYZ(i, x, y, z);
  }
  geometry.computeVertexNormals();
  if (vein) {
    paintVertices(geometry, (p, _n, c) => {
      const across = Math.abs(p.x) / Math.max(width * 0.5, 1e-4);
      const midrib = Math.exp(-across * across * 60);
      const shade = 0.9 + across * 0.1 - Math.pow(across, 4) * 0.2;
      return c.setScalar(shade + midrib * 0.22);
    });
  }
  return geometry;
}

/**
 * Sólido de torno a partir de um perfil (raio, altura), com a costura soldada
 * e normais suaves. `radial` = segmentos em volta.
 */
export function latheGeometry(profile: Array<[number, number]>, radial = 24): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const geometry = new THREE.LatheGeometry(points, radial);
  geometry.computeVertexNormals();
  return geometry;
}

/** Suaviza uma polilinha de perfil (Catmull-Rom) para o torno ficar sem quina. */
export function smoothProfile(points: Array<[number, number]>, samples = 24): Array<[number, number]> {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(samples).map((p) => [p.x, p.y] as [number, number]);
}

/** Pinta um gradiente vertical (baixo → cima) multiplicativo nos vértices. */
export function verticalGradient(geometry: THREE.BufferGeometry, bottom: THREE.ColorRepresentation, top: THREE.ColorRepresentation): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  const span = Math.max(box.max.y - box.min.y, 1e-4);
  return paintVertices(geometry, (p, _n, c) => c.copy(a).lerp(b, (p.y - box.min.y) / span));
}

/** Manchinhas de ruído multiplicativas por cima do vertex color existente. */
export function speckle(geometry: THREE.BufferGeometry, frequency: number, amount: number, seed = 0): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) return geometry;
  for (let i = 0; i < pos.count; i++) {
    const n = noise3(pos.getX(i) * frequency + seed, pos.getY(i) * frequency, pos.getZ(i) * frequency - seed);
    const k = 1 + n * amount;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geometry;
}
