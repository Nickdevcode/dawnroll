import { t, type MessageKey } from '../i18n';
import { friendRoomBlock, type Friend, type FriendProfile } from '../online/Friends';
import type { RoomMode } from '../online/Rooms';
import { DEFAULT_SKIN, isSkinId, skin } from '../progression/skins';
import { skinIcon } from './lookIcons';

/**
 * Pedacinhos dos amigos que aparecem em mais de um lugar (placa dos amigos,
 * lobby, central online, aviso de convite): o besouro de cada um e a frase de
 * onde ele está.
 */

/** O casco do amigo (o mesmo do ranking); casco desconhecido vira o padrão. */
export function friendAvatar(profile: FriendProfile): string {
  return skinIcon(skin(isSkinId(profile.skin) ? profile.skin : DEFAULT_SKIN));
}

export function modeName(mode: RoomMode): string {
  return t(mode === 'match' ? 'online.mode.match' : 'online.mode.garden');
}

/** "Numa sala · Jardim livre · 3/6", "Jogando sozinho", "Offline"… */
export function friendWhere(friend: Friend, myRoomCode: string | null): string {
  const room = friend.room;
  if (friend.status !== 'room' || !room) return t(`friends.status.${friend.status === 'room' ? 'offline' : friend.status}` as MessageKey);
  switch (friendRoomBlock(friend, myRoomCode)) {
    case 'same':
      return t('friends.status.roomSame');
    case 'full':
      return t('friends.status.roomFull', { n: room.players, max: room.max });
    case 'locked':
      return t('friends.status.roomLocked');
    default:
      return t('friends.status.room', { mode: modeName(room.mode), n: room.players, max: room.max });
  }
}
