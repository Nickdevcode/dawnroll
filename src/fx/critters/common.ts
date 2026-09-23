import * as THREE from 'three';
import { terrainHeight, PLAY_RADIUS } from '../../world/Terrain';
import type { CritterContext, CritterPuddle } from './types';

/**
 * Ajudantes de comportamento compartilhados pelas espécies: onde nascer, para
 * onde voar, o que é perigo (besouro e bola), água das poças e o "empurrão" da
 * bola em quem está no caminho.
 */

export const UP = new THREE.Vector3(0, 1, 0);

const tmp = new THREE.Vector3();

/**
 * Voador colado na lente vira um borrão gigante na tela: empurra para longe da câmera.
 * Devolve true se precisou empurrar (o bicho deve escolher outro destino).
 */
export function repelFromCamera(position: THREE.Vector3, camera: THREE.Vector3, dt: number, reach = 3.2): boolean {
  const away = tmp.copy(position).sub(camera);
  const dist = away.length();
  if (dist > reach) return false;
  position.addScaledVector(away.divideScalar(Math.max(dist, 1e-3)), (reach - dist) * 6 * dt);
  return true;
}

/** O ponto de pouso ainda existe? (a flor dona dele pode ter sido arrancada pela bola). */
export function spotAlive(ctx: CritterContext, spot: THREE.Vector3): boolean {
  return ctx.spots.includes(spot);
}

/**
 * Sorteia um ponto de pouso perto do jogador. Devolve a REFERÊNCIA do ponto
 * (a lista é viva) ou null se nenhum estiver perto o bastante.
 */
export function pickSpotNear(ctx: CritterContext, maxDistance: number, avoid: THREE.Vector3 | null = null): THREE.Vector3 | null {
  const spots = ctx.spots;
  if (spots.length === 0) return null;
  for (let i = 0; i < 16; i++) {
    const s = spots[Math.floor(ctx.rng.next() * spots.length)];
    if (s === avoid) continue;
    if (Math.hypot(s.x - ctx.world.player.x, s.z - ctx.world.player.z) < maxDistance) return s;
  }
  return null;
}

/** Ponto no ar perto do jogador. */
export function airPointNear(ctx: CritterContext, radius: number, minH: number, maxH: number, target: THREE.Vector3): THREE.Vector3 {
  const a = ctx.rng.next() * Math.PI * 2;
  const d = ctx.rng.range(radius * 0.3, radius);
  const x = THREE.MathUtils.clamp(ctx.world.player.x + Math.cos(a) * d, -PLAY_RADIUS, PLAY_RADIUS);
  const z = THREE.MathUtils.clamp(ctx.world.player.z + Math.sin(a) * d, -PLAY_RADIUS, PLAY_RADIUS);
  return target.set(x, terrainHeight(x, z) + ctx.rng.range(minH, maxH), z);
}

/** Ponto bem longe do jogador (para onde os voadores fogem da chuva, ou de onde voltam). */
export function farPoint(ctx: CritterContext, distance: number, height: number, target: THREE.Vector3): THREE.Vector3 {
  const a = ctx.rng.next() * Math.PI * 2;
  const x = ctx.world.player.x + Math.cos(a) * distance;
  const z = ctx.world.player.z + Math.sin(a) * distance;
  return target.set(x, terrainHeight(THREE.MathUtils.clamp(x, -70, 70), THREE.MathUtils.clamp(z, -70, 70)) + height, z);
}

/** Poça (com água) cobrindo este ponto do chão agora, ou null. */
export function puddleAt(ctx: CritterContext, x: number, z: number, margin = 0): CritterPuddle | null {
  for (const p of ctx.world.puddles) {
    if (p.fill < 0.03) continue;
    if (Math.hypot(x - p.x, z - p.z) > p.radius * 1.05 + margin) continue;
    if (terrainHeight(x, z) < p.level + 0.02 + margin * 0.25) return p;
  }
  return null;
}

/** Dentro da bacia de alguma poça, cheia ou seca (para coisas fixas, como formigueiro). */
export function insideBasin(ctx: CritterContext, x: number, z: number, margin = 0): boolean {
  for (const p of ctx.world.puddles) {
    if (Math.hypot(x - p.x, z - p.z) < p.radius + margin) return true;
  }
  return false;
}

/** Aproximação barata de "a câmera está vendo este ponto?" (cone horizontal + distância). */
export function inView(ctx: CritterContext, x: number, z: number, maxDistance = 48): boolean {
  const cam = ctx.world.camera;
  const dx = x - cam.x;
  const dz = z - cam.z;
  const d = Math.hypot(dx, dz);
  if (d > maxDistance) return false;
  if (d < 3) return true;
  return (dx * ctx.viewDir.x + dz * ctx.viewDir.z) / d > 0.35;
}

/**
 * Ponto livre no chão, entre `minDist` e `maxDist` do jogador. Com `hidden`,
 * prefere lugar fora da vista da câmera (o bicho "já estava lá").
 * Devolve false se não achou nada (o bicho tenta de novo depois).
 */
export function groundSpotNear(
  ctx: CritterContext,
  minDist: number,
  maxDist: number,
  hidden: boolean,
  target: THREE.Vector3,
  accept?: (x: number, z: number) => boolean,
): boolean {
  const player = ctx.world.player;
  for (let i = 0; i < 44; i++) {
    const a = ctx.rng.next() * Math.PI * 2;
    const d = ctx.rng.range(minDist, maxDist);
    const x = player.x + Math.cos(a) * d;
    const z = player.z + Math.sin(a) * d;
    if (Math.hypot(x, z) > PLAY_RADIUS - 2) continue;
    if (!ctx.isGroundFree(x, z)) continue;
    if (hidden && i < 32 && inView(ctx, x, z)) continue;
    if (accept && !accept(x, z)) continue;
    if (puddleAt(ctx, x, z, 0.5)) continue;
    target.set(x, terrainHeight(x, z), z);
    return true;
  }
  return false;
}

/**
 * Perigo mais próximo para um bicho de chão: o besouro ou a bola. Devolve a
 * distância até a "borda" do perigo e escreve em `away` a direção (no plano) para fugir.
 */
export function threatAt(ctx: CritterContext, x: number, y: number, z: number, away: THREE.Vector3): number {
  const w = ctx.world;
  const px = x - w.player.x;
  const pz = z - w.player.z;
  let best = Math.hypot(px, pz) - 0.45;
  away.set(px, 0, pz);

  const r = w.ballRadius;
  const dy = y - w.ballPosition.y;
  // Raio da seção da bola na altura do bicho; bola grande assusta mesmo passando por cima.
  const section = Math.sqrt(Math.max(0, r * r - dy * dy));
  const bx = x - w.ballPosition.x;
  const bz = z - w.ballPosition.z;
  const db = Math.hypot(bx, bz) - Math.max(section, r * 0.6);
  if (db < best) {
    best = db;
    away.set(bx, 0, bz);
  }
  if (away.lengthSq() < 1e-8) away.set(1, 0, 0);
  away.normalize();
  return best;
}

/**
 * A bola não atravessa bicho: se ela estiver por cima de quem está no chão,
 * empurra o bicho (no plano) para a borda da seção dela. Devolve true se empurrou.
 */
export function shoveFromBall(ctx: CritterContext, position: THREE.Vector3, bodyRadius: number, height: number): boolean {
  const w = ctx.world;
  const r = w.ballRadius;
  const dy = position.y + height * 0.5 - w.ballPosition.y;
  const section2 = r * r - dy * dy;
  if (section2 <= 0) return false;
  const reach = Math.sqrt(section2) + bodyRadius;
  const dx = position.x - w.ballPosition.x;
  const dz = position.z - w.ballPosition.z;
  const d = Math.hypot(dx, dz);
  if (d >= reach) return false;
  const nx = d < 1e-4 ? 1 : dx / d;
  const nz = d < 1e-4 ? 0 : dz / d;
  position.x = w.ballPosition.x + nx * reach;
  position.z = w.ballPosition.z + nz * reach;
  return true;
}

/** Suavização exponencial de um vetor (independente de framerate). */
export function dampVector(current: THREE.Vector3, target: THREE.Vector3, rate: number, dt: number): THREE.Vector3 {
  return current.lerp(target, 1 - Math.exp(-rate * dt));
}

// ---------------------------------------------------------------------------
// Katamari de bicho

/** Alcance (unidades) do poder "Fedor irresistível" em cada nível. */
const ATTRACT_REACH = [0, 10, 16] as const;
/** Quanto mais rápido o bicho anda quando vai atrás do fedor. */
const ATTRACT_HURRY = [0, 1.25, 1.8] as const;

/**
 * Poder "Fedor irresistível": bicho de chão que gruda, dentro do alcance, vai
 * ATÉ a bola em vez de fugir. Devolve o multiplicador de velocidade (0 = não
 * está atraído) e escreve em `toward` a direção no plano até a bola.
 */
export function attraction(ctx: CritterContext, x: number, z: number, toward: THREE.Vector3): number {
  const level = ctx.attract;
  if (level === 0) return 0;
  const ball = ctx.world.ballPosition;
  const dx = ball.x - x;
  const dz = ball.z - z;
  const d = Math.hypot(dx, dz);
  if (d > ATTRACT_REACH[level] || d < 1e-4) return 0;
  toward.set(dx / d, 0, dz / d);
  return ATTRACT_HURRY[level];
}

/**
 * Regra geral do Katamari de bicho: a bola precisa ser bem maior que o bicho
 * (raio ≥ 1,6× o tamanho efetivo) e estar encostando nele (`reach` = meia
 * espessura do bicho em volta do ponto testado).
 */
export function ballTakes(center: THREE.Vector3, radius: number, size: number, x: number, y: number, z: number, reach: number): boolean {
  if (radius < size * 1.6) return false;
  const dx = x - center.x;
  const dy = y - center.y;
  const dz = z - center.z;
  const r = radius + reach;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/** Malha de mundo para grudar na bola, na mesma pose (matriz) em que o bicho estava. */
export function collectedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}
