import type { GardenPlan } from './gardenLayout';
import type { PickableRecord } from './scenery/SceneryLayer';

/**
 * Impressão digital do que importa pro jogo num jardim: cada arrancável (tipo,
 * espécie, tamanho, volume e onde encosta, na ordem do id), os cantinhos e as
 * bolas de tênis. Enfeite sem colisão (pedrinha, escama de pinha) fica de fora
 * de propósito: ele pode variar com o aparelho.
 *
 * No online, cada jogador monta o jardim pela mesma semente; se as impressões
 * não baterem, um "engoliu o arrancável 12" apontaria pra coisas diferentes em
 * cada tela. Os números são arredondados (0,01 u ≈ 0,2 mm) pra um último bit
 * diferente na trigonometria de outro navegador não acusar diferença à toa.
 */
export function gardenChecksum(pickables: readonly PickableRecord[], plan: GardenPlan): string {
  const hash = new Fnv1a();
  hash.int(pickables.length);
  for (const record of pickables) {
    hash.text(record.kind);
    hash.text(record.variant ?? '');
    hash.num(record.size);
    hash.num(record.volume);
    hash.num(record.probeRadius);
    hash.num(record.probeA.x).num(record.probeA.y).num(record.probeA.z);
    hash.num(record.probeB.x).num(record.probeB.y).num(record.probeB.z);
  }
  hash.int(plan.zones.length);
  for (const zone of plan.zones) hash.text(zone.kind).num(zone.x).num(zone.z).num(zone.radius);
  hash.int(plan.tennisBalls.length);
  for (const ball of plan.tennisBalls) hash.num(ball.x).num(ball.y);
  return hash.hex();
}

/** FNV-1a de 32 bits: rápido, sem dependência e estável entre navegadores (só inteiros). */
class Fnv1a {
  private h = 0x811c9dc5;

  int(value: number): this {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      this.h = Math.imul(this.h ^ (v & 0xff), 0x01000193);
      v >>>= 8;
    }
    return this;
  }

  /** Número arredondado a 0,01 (ver o comentário do `gardenChecksum`). */
  num(value: number): this {
    return this.int(Math.round(value * 100));
  }

  text(value: string): this {
    for (let i = 0; i < value.length; i++) this.h = Math.imul(this.h ^ value.charCodeAt(i), 0x01000193);
    return this.int(value.length);
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
