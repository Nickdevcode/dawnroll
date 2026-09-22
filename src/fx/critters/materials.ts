import * as THREE from 'three';
import { clay, type ClayOptions } from '../../render/clayMaterial';

/**
 * Massinha com "paleta por instância": a vertex color (r, g, b) da geometria é o
 * PESO de cada uma das três cores da instância (atributos `aPaletteA/B/C`,
 * escritos pelo `InstancedPart`). Assim uma geometria só pinta todas as
 * variantes de uma espécie (monarca, morpho, joaninha laranja...) num draw call.
 * Pesos que somam menos de 1 escurecem (sombreado assado continua funcionando).
 */
export function paletteClay(options: ClayOptions): THREE.MeshPhysicalMaterial {
  const base = clay(0xffffff, { ...options, vertexColors: true });
  const material = base.clone();
  material.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPaletteA;\nattribute vec3 aPaletteB;\nattribute vec3 aPaletteC;')
      .replace('#include <color_vertex>', 'vColor = vec4(aPaletteA * color.r + aPaletteB * color.g + aPaletteC * color.b, 1.0);');
  };
  const key = base.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}|palette`;
  return material;
}

/** Pesos prontos para pintar geometria de paleta. */
export const Weight = {
  A: new THREE.Color(1, 0, 0),
  B: new THREE.Color(0, 1, 0),
  C: new THREE.Color(0, 0, 1),
} as const;

export interface CritterMaterials {
  /** Corpo fosco de massinha (cores assadas). */
  body: THREE.MeshPhysicalMaterial;
  /** Pelúcia: tórax de abelha, corpo de borboleta (sheen alto, mosqueado fino). */
  fuzzy: THREE.MeshPhysicalMaterial;
  /** Brilhante/envernizado: formiga, olho, casca. */
  glossy: THREE.MeshPhysicalMaterial;
  /** Babado e úmido: caracol, minhoca. */
  slimy: THREE.MeshPhysicalMaterial;
  paletteBody: THREE.MeshPhysicalMaterial;
  paletteGloss: THREE.MeshPhysicalMaterial;
  /** Asa de borboleta: escamas aveludadas, dupla face. */
  paletteWing: THREE.MeshPhysicalMaterial;
  /** Asa vítrea (abelha, libélula, joaninha, mosca): transparente e furta-cor. */
  glass: THREE.MeshPhysicalMaterial;
}

let shared: CritterMaterials | null = null;

/** Materiais compartilhados por todas as espécies (poucos programas de GPU). */
export function critterMaterials(): CritterMaterials {
  shared ??= {
    body: clay(0xffffff, { vertexColors: true, roughness: 0.58, sheen: 0.6, bump: 0, mottle: 0.06, mottleScale: 24 }),
    fuzzy: clay(0xffffff, { vertexColors: true, roughness: 0.82, sheen: 1, bump: 0, mottle: 0.14, mottleScale: 70 }),
    glossy: clay(0xffffff, { vertexColors: true, roughness: 0.3, sheen: 0.3, clearcoat: 0.8, bump: 0, mottle: 0.04, mottleScale: 20 }),
    slimy: clay(0xffffff, { vertexColors: true, roughness: 0.36, sheen: 0.45, clearcoat: 0.65, bump: 0, mottle: 0.1, mottleScale: 16 }),
    paletteBody: paletteClay({ roughness: 0.58, sheen: 0.6, bump: 0, mottle: 0.07, mottleScale: 22 }),
    paletteGloss: paletteClay({ roughness: 0.28, sheen: 0.3, clearcoat: 0.8, bump: 0, mottle: 0.04, mottleScale: 16 }),
    paletteWing: paletteClay({ roughness: 0.74, sheen: 0.95, bump: 0, mottle: 0.05, mottleScale: 14, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#eef7ff',
      vertexColors: true,
      roughness: 0.15,
      metalness: 0,
      iridescence: 1,
      iridescenceIOR: 1.4,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
  return shared;
}
