import type * as THREE from 'three';
import { ACCESSORY_SLOTS, type AccessoryId, type AccessorySlot, type Outfit } from '../../progression/accessories';
import { buildAccessory } from './registry';
import type { AccessoryModel, OutfitAnchors, OutfitPose } from './types';

interface Worn {
  id: AccessoryId;
  model: AccessoryModel;
}

/**
 * O que o besouro está vestindo. Monta cada acessório na primeira vez que ele é
 * pedido e guarda (trocar e voltar no guarda-roupa não refaz nada), encaixa no
 * lugar certo, esconde o chifre embaixo de chapéu e anima quem se mexe.
 *
 * Material novo precisa de shader novo: com `compile`, a peça só entra em cena
 * depois de compilada em segundo plano (sem engasgar o quadro); até lá o lugar
 * fica com o que estava.
 */
export class BeetleOutfit {
  /** Compila os shaders de uma peça antes dela aparecer (o jogo liga no renderizador). */
  compile: ((object: THREE.Object3D) => Promise<void>) | null = null;

  private readonly worn = new Map<AccessorySlot, Worn>();
  private readonly cache = new Map<AccessoryId, AccessoryModel>();
  private readonly ready = new Set<AccessoryId>();
  private wanted: Readonly<Outfit> | null = null;

  constructor(
    private readonly anchors: OutfitAnchors,
    private readonly setHornVisible: (visible: boolean) => void,
  ) {}

  /** Veste o conjunto (lugar que não mudou fica como está). */
  set(outfit: Readonly<Outfit>): void {
    this.wanted = { ...outfit };
    for (const slot of ACCESSORY_SLOTS) {
      const id = outfit[slot];
      if (this.worn.get(slot)?.id === id) continue;
      if (id === null) {
        this.takeOff(slot);
        continue;
      }
      const model = this.model(id);
      if (this.ready.has(id) || !this.compile) {
        this.ready.add(id);
        this.putOn(slot, id, model);
        continue;
      }
      this.compile(model.object)
        .catch(() => undefined)
        .then(() => {
          this.ready.add(id);
          // Pode ter trocado de novo enquanto compilava.
          if (this.wanted?.[slot] === id) this.putOn(slot, id, model);
        });
    }
    this.syncHorn();
  }

  update(pose: OutfitPose): void {
    for (const { model } of this.worn.values()) model.update?.(pose);
  }

  private model(id: AccessoryId): AccessoryModel {
    let model = this.cache.get(id);
    if (!model) {
      model = buildAccessory(id);
      this.cache.set(id, model);
    }
    return model;
  }

  private putOn(slot: AccessorySlot, id: AccessoryId, model: AccessoryModel): void {
    this.takeOff(slot);
    this.anchors[slot].add(model.object);
    this.worn.set(slot, { id, model });
    this.syncHorn();
  }

  private takeOff(slot: AccessorySlot): void {
    const current = this.worn.get(slot);
    if (!current) return;
    this.anchors[slot].remove(current.model.object);
    this.worn.delete(slot);
    this.syncHorn();
  }

  private syncHorn(): void {
    let hidden = false;
    for (const { model } of this.worn.values()) hidden ||= model.hidesHorn === true;
    this.setHornVisible(!hidden);
  }
}
