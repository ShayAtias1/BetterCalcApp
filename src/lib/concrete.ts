/**
 * Concrete takeoff: the quantity of one marked zone, from its footprint, its one vertical
 * dimension and the page scale. Pure — no store, no persistence. Kept apart from the finishes work
 * types: a volume is not a surface, and nothing here touches `lib/quantities`.
 *
 *   volume = footprint area (m²) × depth (m) × quantity          → m³
 *   order  = volume × (1 + waste % / 100)
 *
 * `depth` is the slab's thickness or the wall's, beam's or column's height. A wall or a beam is its
 * plan footprint (length × thickness), so footprint × height is length × thickness × height.
 *
 * Values are returned unrounded; rounding is the summaries' job, as for finishes.
 */

import type { Calibration } from '../types';
import type { ConcreteElement } from '../types/structural';
import { finiteNonNegative, finitePositive, zoneGeometry } from './zoneGeometry';

/**
 * Why a quantity is missing — "not calculable" is never reported as 0:
 * - no-scale: the zone is measured off the plan and its page has no scale (and no size override).
 * - missing-size: a manual size is switched on but its length or width is not entered yet.
 * - missing-depth: the thickness/height has not been entered (or is not above zero).
 * Checked in that order: the footprint is needed before the depth can matter.
 */
export type ConcreteStatus = 'ok' | 'no-scale' | 'missing-size' | 'missing-depth';

export interface ConcreteCalc {
  status: ConcreteStatus;
  /** Footprint in m²; null when the zone has no size. */
  footprintM2: number | null;
  /** Net volume in m³; null unless status is 'ok'. */
  volumeM3: number | null;
  /** Volume with waste in m³; null unless status is 'ok'. */
  orderM3: number | null;
  /** The waste % actually applied (0 when absent or unusable). */
  wastePercent: number;
  /** The quantity actually applied (1 when absent or unusable). */
  quantity: number;
}

export function calculateConcrete(element: ConcreteElement, calibration: Calibration | null): ConcreteCalc {
  const wastePercent = finiteNonNegative(element.wastePercent, 0);
  const quantity = finiteNonNegative(element.quantity, 1);
  const zone = zoneGeometry(element.points, calibration?.metersPerPixel ?? 0, element.sizeOverride);
  const depthM = finitePositive(element.depthM);

  const base = { footprintM2: zone?.areaM2 ?? null, wastePercent, quantity };
  if (!zone) return { ...base, status: element.sizeOverride ? 'missing-size' : 'no-scale', volumeM3: null, orderM3: null };
  if (depthM === null) return { ...base, status: 'missing-depth', volumeM3: null, orderM3: null };

  const volumeM3 = zone.areaM2 * depthM * quantity;
  return { ...base, status: 'ok', volumeM3, orderM3: volumeM3 * (1 + wastePercent / 100) };
}
