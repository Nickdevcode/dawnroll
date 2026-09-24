import * as THREE from 'three';
import type { AccessoryId } from '../../progression/accessories';
import { mergeStaticTree } from '../../render/mergeStatic';
import { flattenStatic } from './parts';
import { beanie, cangaceiroHat, cap, chefHat, cowboyHat, crown, flowerCrown, gnomeHat, halo, minerHelmet, partyHat, propellerCap, strawHat, topHat, vikingHelmet, wizardHat } from './hats';
import { backpack, bottleRocket, butterflyWings, cape, flag } from './backWear';
import { heartGlasses, monocle, mustache, roundGlasses, starGlasses, sunglasses } from './faceWear';
import { bandana, bowTie, cowbell, lei, medal, scarf } from './neckWear';
import type { AccessoryModel } from './types';

/** Quem monta cada acessório (o TypeScript cobra se faltar algum). */
const BUILDERS: Record<AccessoryId, () => AccessoryModel> = {
  partyHat,
  cap,
  beanie,
  strawHat,
  flowerCrown,
  cowboy: cowboyHat,
  topHat,
  chefHat,
  gnomeHat,
  miner: minerHelmet,
  viking: vikingHelmet,
  propeller: propellerCap,
  wizardHat,
  halo,
  cangaceiro: cangaceiroHat,
  crown,
  sunglasses,
  roundGlasses,
  heartGlasses,
  starGlasses,
  mustache,
  monocle,
  bowTie,
  bandana,
  scarf,
  cowbell,
  lei,
  medal,
  flag,
  backpack,
  cape,
  butterflyWings,
  bottleRocket,
};

/**
 * Monta o acessório: sombra ligada em tudo e as peças paradas que dividem
 * material fundidas num draw call só, mesmo vindas de grupos diferentes (as
 * juntas animadas continuam separadas).
 */
export function buildAccessory(id: AccessoryId): AccessoryModel {
  const model = BUILDERS[id]();
  model.object.name = `accessory-${id}`;
  model.object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Luz própria (auréola, chama) não faz sombra nem recebe.
    const glowing = mesh.material instanceof THREE.MeshBasicMaterial;
    mesh.castShadow = !glowing;
    mesh.receiveShadow = !glowing;
  });
  flattenStatic(model.object);
  mergeStaticTree(model.object);
  return model;
}
