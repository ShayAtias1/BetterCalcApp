import type { Room } from '../types';

export const BALCONY_ROW_COLOR = '#E8F4E8';

/** Explicit room types take precedence; legacy rooms can still be identified by their names. */
export function isBalconyRoom(room: Pick<Room, 'roomType' | 'name' | 'detectedType'> | undefined): boolean {
  if (!room) return false;
  const type = room.roomType || room.detectedType;
  if (type) return type === 'balcony' || type === 'service_balcony' || /מרפסת|\bbalcony\b/i.test(type);
  return /מרפסת|\bbalcony\b/i.test(room.name);
}
