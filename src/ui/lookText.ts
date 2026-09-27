import { formatInteger, t, tn, type MessageKey } from '../i18n';
import type { AchievementId } from '../progression/achievements';
import { lookKey, type Look } from '../progression/looks';
import { passTierOf } from '../progression/seasons';
import { priceParts, type Currency, type Price, type Rarity, type SeasonId, type Unlock } from '../progression/unlocks';
import { achievementName, isHiddenAchievement } from './achievementText';

/** Nome do visual (casco ou acessório). */
export function lookName(look: Look): string {
  return t(`${look.kind === 'skin' ? 'skin' : 'acc'}.${look.id}.name` as MessageKey);
}

/** Descrição curta do visual. */
export function lookDesc(look: Look): string {
  return t(`${look.kind === 'skin' ? 'skin' : 'acc'}.${look.id}.desc` as MessageKey);
}

export function rarityName(rarity: Rarity): string {
  return t(`rarity.${rarity}` as MessageKey);
}

/** "1.250 moedas" / "45 gotas de orvalho". */
export function amountText(currency: Currency, amount: number): string {
  return tn(currency === 'coins' ? 'money.coins' : 'money.dew', amount);
}

/** Preço por extenso (ver `amountText`). */
export function priceText(price: Price): string {
  const { currency, amount } = priceParts(price);
  return amountText(currency, amount);
}

/** Número curto pros chips (1.250, 12,5 mil...). */
export function compactNumber(n: number): string {
  return n >= 100_000 ? t('money.thousands', { n: formatInteger(Math.floor(n / 1000)) }) : formatInteger(n);
}

export function seasonName(id: SeasonId): string {
  return t(`season.${id}.name` as MessageKey);
}

/** Nome do baú pela raridade (madeira, prata, cristal, Sol). */
export function chestName(rarity: Rarity): string {
  return t(`chest.${rarity}` as MessageKey);
}

/**
 * Como liberar: "Libera com: <conquista>", "Libera no nível N", "Na Feirinha:
 * 900 moedas", "Passe Florada, nível 12" ou "Só em baú". Conquista secreta
 * ainda não feita continua secreta aqui também.
 */
export function unlockText(look: Look, unlock: Unlock, hasAchievement: (id: AchievementId) => boolean): string {
  if ('level' in unlock) return t('wardrobe.unlockLevel', { n: unlock.level });
  if ('achievement' in unlock) {
    const hidden = isHiddenAchievement(unlock.achievement, hasAchievement(unlock.achievement));
    return t('wardrobe.unlockAchievement', { name: achievementName(unlock.achievement, hidden) });
  }
  if ('shop' in unlock) return t('wardrobe.unlockShop', { price: priceText(unlock.shop) });
  if ('pass' in unlock) {
    const at = passTierOf(lookKey(look));
    return t('wardrobe.unlockPass', { season: seasonName(unlock.pass), n: at?.tier ?? '?' });
  }
  return t('wardrobe.unlockChest');
}

/** "Novo visual: X, Y" pros avisos (conquista, refeição que subiu de nível). */
export function looksNotice(looks: readonly Look[]): string {
  return t('wardrobe.notice', { names: looks.map(lookName).join(', ') });
}
