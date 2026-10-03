/**
 * The measured size of a marked zone — shared by concrete and rebar, which both work from "a zone
 * plus what exists in it". Pure: scale in, metres out. Like room geometry, a zone on a page without
 * a scale has no size (null), which is different from a size of 0; a hand-entered size override
 * needs no scale.
 */

import type { Point } from '../types';
import type { SizeOverride } from '../types/structural';
import { distancePx, polygonAreaPx } from './geometry';

/** How far from 90° (degrees) each corner of a four-sided zone may be and still count as a rectangle. */
export const RECTANGLE_ANGLE_TOLERANCE_DEG = 2;

export interface ZoneGeometry {
  areaM2: number;
  /**
   * The two side lengths when the zone is a rectangle (long ≥ short), at any rotation; null for any
   * other shape, which has no single "long side".
   */
  sides: { longM: number; shortM: number } | null;
  /** True when the size came from the user's override instead of the drawn outline. */
  fromOverride: boolean;
}

/** A number that is finite and above zero, else null — for inputs where 0 or a typo is "not entered". */
export function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** A number that is finite and not negative, else `fallback` — a negative dimension is a typo, never a quantity. */
export function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** True for exactly four distinct corners that each turn by 90° (within tolerance): a rectangle in any orientation. */
export function isRectangle(points: Point[], toleranceDeg = RECTANGLE_ANGLE_TOLERANCE_DEG): boolean {
  if (points.length !== 4) return false;
  const maxCos = Math.sin((toleranceDeg * Math.PI) / 180);
  for (let i = 0; i < 4; i++) {
    const prev = points[(i + 3) % 4];
    const cur = points[i];
    const next = points[(i + 1) % 4];
    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const lenA = Math.hypot(ax, ay);
    const lenB = Math.hypot(bx, by);
    if (lenA < 1e-9 || lenB < 1e-9) return false;
    if (Math.abs((ax * bx + ay * by) / (lenA * lenB)) > maxCos) return false;
  }
  return true;
}

function sidesOf(a: number, b: number): { longM: number; shortM: number } {
  return { longM: Math.max(a, b), shortM: Math.min(a, b) };
}

/**
 * The zone's size, or null when it cannot be known. A size override, when there is one (even a
 * half-filled one), REPLACES the outline entirely: it is used if both lengths are usable and
 * otherwise the zone has no size — never a silent fall-back to the drawn outline. Without an
 * override the outline needs a scale and at least three points.
 */
export function zoneGeometry(points: Point[], metersPerPixel: number, override?: SizeOverride | null): ZoneGeometry | null {
  if (override) {
    const lengthM = finitePositive(override.lengthM);
    const widthM = finitePositive(override.widthM);
    if (lengthM === null || widthM === null) return null;
    return { areaM2: lengthM * widthM, sides: sidesOf(lengthM, widthM), fromOverride: true };
  }

  const mpp = finitePositive(metersPerPixel);
  if (mpp === null || points.length < 3) return null;
  const areaM2 = polygonAreaPx(points) * mpp * mpp;
  const sides = isRectangle(points) ? sidesOf(distancePx(points[0], points[1]) * mpp, distancePx(points[1], points[2]) * mpp) : null;
  return { areaM2, sides, fromOverride: false };
}
