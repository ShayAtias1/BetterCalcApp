/**
 * Room type profiles — the shared catalogue of room kinds and the work they usually imply.
 *
 * These started out inside roomDetection.ts, where they are matched against plan text. They now
 * live here because the same catalogue backs the *manual* room-type picker in the sidebar, and
 * `buildWorkItemsForProfile` is the single place that turns a profile into work items (used by the
 * manual picker and by the auto-detection "calculate quantities" pass; future callers such as
 * duplicate-room should use it too rather than re-deriving the rules).
 *
 * A profile is a classification plus defaults. It is NOT a room name: the user names rooms freely,
 * and `Room.roomType` only records which profile they picked. The type's display name is in the
 * dictionary (`roomTypes.<key>`); `labels` are not UI text but detection data — the Hebrew words
 * architectural plans write in rooms — and stay here whatever the UI language.
 */

import { v4 as uuid } from 'uuid';
import type { Plan, WorkItem } from '../types';
import { t, type TranslateFn } from '../i18n';

export type TilingCategoryKey = 'regular' | 'as';

export type RoomProfileKey = 'bath' | 'wc' | 'service' | 'kitchen' | 'balcony' | 'service_balcony' | 'safe' | 'living' | 'bedroom' | 'hall' | 'storage';

export interface RoomProfile {
  key: RoomProfileKey;
  /** Name keywords (Hebrew). Matched as substrings against text found inside the room. */
  labels: string[];
  tiling: TilingCategoryKey;
  cladding: boolean;
  panels: boolean;
  /** Wall painting (net of openings, at the plan's default wall height). */
  painting?: boolean;
  /** Floor waterproofing (wet areas). */
  waterproofing?: boolean;
  /**
   * Optional per-profile overrides for the work items this profile creates. Intentionally unset on
   * every profile today: with no value here, items fall back to the project's own defaults
   * (waste % per work type, cladding height), which is exactly how they behaved before.
   */
  defaultWastePercent?: number;
  defaultCladdingHeightM?: number;
}

/** Ordered roughly specific→generic; matching prefers the longest label so "חדר רחצה" beats "חדר". */
export const ROOM_PROFILES: RoomProfile[] = [
  { key: 'bath', labels: ['חדר רחצה', 'חדר אמבטיה', 'אמבטיה', 'מקלחת', 'רחצה'], tiling: 'as', cladding: true, panels: false, waterproofing: true },
  { key: 'wc', labels: ['שירותי אורחים', 'שרותי אורחים', 'שירותים', 'שרותים', 'אסלה', 'שירות אורחים'], tiling: 'as', cladding: true, panels: false, waterproofing: true },
  { key: 'service', labels: ['חדר שירות', 'חדר כביסה', 'כביסה', 'חדר רחצה שירות'], tiling: 'as', cladding: false, panels: false, waterproofing: true },
  { key: 'kitchen', labels: ['מטבח', 'מטבחון'], tiling: 'regular', cladding: true, panels: true, painting: true },
  { key: 'service_balcony', labels: ['מרפסת שירות'], tiling: 'as', cladding: false, panels: false, waterproofing: true },
  { key: 'balcony', labels: ['מרפסת שמש', 'מרפסת'], tiling: 'as', cladding: false, panels: false, waterproofing: true },
  { key: 'safe', labels: ['ממ"ד', 'ממ״ד', 'ממד', 'מרחב מוגן', 'מקלט'], tiling: 'regular', cladding: false, panels: true, painting: true },
  { key: 'living', labels: ['סלון', 'חדר מגורים', 'מגורים', 'פינת אוכל'], tiling: 'regular', cladding: false, panels: true, painting: true },
  { key: 'bedroom', labels: ['חדר שינה', 'חדר הורים', 'חדר ילדים', 'חדר שינה הורים', 'שינה', 'חדר'], tiling: 'regular', cladding: false, panels: true, painting: true },
  { key: 'hall', labels: ['פרוזדור', 'מסדרון', 'הול', 'כניסה', 'לובי'], tiling: 'regular', cladding: false, panels: true, painting: true },
  { key: 'storage', labels: ['מחסן', 'ארון', 'אחסון'], tiling: 'regular', cladding: false, panels: false, painting: true },
];

export function getRoomProfile(key: string | undefined | null): RoomProfile | null {
  if (!key) return null;
  return ROOM_PROFILES.find((p) => p.key === key) ?? null;
}

/** A profile's display name — shown in the type picker, and used by detection to name a room it matched. */
export function roomProfileName(profile: RoomProfile, tr: TranslateFn = t): string {
  return tr(`roomTypes.${profile.key}`);
}

/** Display label for a type key — falls back to the raw key if a saved project references an unknown one. */
export function roomProfileLabel(key: string | undefined | null, tr: TranslateFn = t): string | null {
  if (!key) return null;
  const profile = getRoomProfile(key);
  return profile ? roomProfileName(profile, tr) : key;
}

/**
 * The work items a profile implies, with the project's defaults filled in (a profile-level override
 * wins over the project default when one is defined). This is the only place that rule lives.
 */
export function buildWorkItemsForProfile(profile: RoomProfile, project: Plan): WorkItem[] {
  // Left off the item entirely when the profile has no opinion, so the item keeps following the
  // project default rather than freezing a copy of it.
  const waste = profile.defaultWastePercent != null ? { wastePercent: profile.defaultWastePercent } : {};
  const items: WorkItem[] = [];
  items.push({ id: uuid(), type: 'tiling', tilingCategory: profile.tiling, ...waste });
  if (profile.cladding) {
    items.push({
      id: uuid(),
      type: 'cladding',
      heightM: profile.defaultCladdingHeightM ?? project.defaultCladdingHeightM,
      ...waste,
    });
  }
  // Panel height is deliberately left unset so the item follows the project's default panel height.
  if (profile.panels) items.push({ id: uuid(), type: 'panels', ...waste });
  // Heights left unset for the same reason: painting follows the plan's wall height, waterproofing its upturn default.
  if (profile.painting) items.push({ id: uuid(), type: 'painting', ...waste });
  if (profile.waterproofing) items.push({ id: uuid(), type: 'waterproofing', ...waste });
  return items;
}
