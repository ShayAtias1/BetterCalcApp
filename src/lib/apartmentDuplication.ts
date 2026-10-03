/**
 * Helpers for the apartment view of a project.
 *
 * An "apartment" is not an entity: it is simply every room sharing an `apartmentNumber`, exactly as
 * the Excel report already groups them. Duplicating one copies its rooms as they are — same
 * geometry, same page — so the copy carries the same quantities as the original.
 */

import type { Plan, Room } from '../types';
import { isPageCalibrated } from './quantities';
import { t } from '../i18n';

/** Pages the rooms of an apartment live on. */
export function apartmentPageNumbers(project: Plan, apartmentNumber: string): number[] {
  return Array.from(
    new Set(project.rooms.filter((r) => r.apartmentNumber === apartmentNumber).map((r) => r.pageNumber))
  ).sort((a, b) => a - b);
}

/** Apartment numbers that actually exist in the project (blank is not an apartment), in page order. */
export function apartmentNumbersInProject(project: Plan): string[] {
  const seen = new Set<string>();
  for (const room of project.rooms) {
    // Read as text whatever was saved: a number-valued field (older or hand-edited data) must
    // not break the sort below.
    if (room.apartmentNumber) seen.add(String(room.apartmentNumber));
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
}

/** Key used for rooms carrying no apartment number, kept out of the real apartment list. */
export const UNASSIGNED_APARTMENT = '';

/**
 * Rooms grouped by apartment for the room list: real apartments first (same order as
 * `apartmentNumbersInProject`), then the unassigned rooms. Apartments are derived from
 * `Room.apartmentNumber` exactly as the Excel report already groups them — no new entity.
 */
export function groupRoomsByApartment(project: Plan): { apartmentNumber: string; rooms: Room[] }[] {
  const groups: { apartmentNumber: string; rooms: Room[] }[] = apartmentNumbersInProject(project).map((apartmentNumber) => ({
    apartmentNumber,
    rooms: project.rooms.filter((r) => r.apartmentNumber === apartmentNumber),
  }));
  const unassigned = project.rooms.filter((r) => !r.apartmentNumber);
  if (unassigned.length > 0) groups.push({ apartmentNumber: UNASSIGNED_APARTMENT, rooms: unassigned });
  return groups;
}

/**
 * What the user should know before duplicating this apartment. Empty array = nothing to say.
 * Never blocks: the rooms are worth copying even on an unscaled page, exactly as drawing one there
 * is allowed — only the quantities have to wait for a calibration.
 */
export function apartmentDuplicationWarnings(project: Plan, sourceApartmentNumber: string): string[] {
  const uncalibrated = apartmentPageNumbers(project, sourceApartmentNumber).filter((p) => !isPageCalibrated(project, p));
  if (uncalibrated.length === 0) return [];
  return [t('apartmentDuplication.uncalibratedWarning', { pages: uncalibrated.join(', ') })];
}
