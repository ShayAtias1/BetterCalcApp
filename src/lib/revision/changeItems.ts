import type { Point } from '../../types';
import type { AreaKind } from '../../types/compare';
import type { ComparisonContext, RevisionChange } from '../../types/revisionAnalysis';
import { OPENING_DEFAULT_SIZES } from '../../config/measurementDefaults';
import { longestEdgePx, polygonAreaM2, polygonPerimeterPx, pxToMeters, round, distancePx } from '../geometry';
import { sidesOf, openingGeometryNeedsVerification } from './changeEdit';
import { isOpeningDifference, openingImpact } from './openingImpact';

/**
 * The demolition / new-construction items an approved change stands for — computed locally from
 * the change's verified geometry and the page calibration, never from AI output.
 *
 * - A wall added in the revision is new construction (both contexts).
 * - A wall removed is demolition only during construction; in a design revision it is merely no
 *   longer built, so it produces no item (the reduction shows in the review, not as demolition).
 * - During construction a new door in an existing wall is a break-through (demolition) and a
 *   removed door is an infill (construction). Door changes in a design revision are handled as
 *   openings when applied to a takeoff plan.
 */
export interface ChangeItem {
  areaKind: AreaKind;
  points: Point[];
  centerline: Point[];
  wallLengthM: number;
  wallHeightM: number;
  areaM2: number;
  source: 'wall' | 'door';
  /** The change's line this item measures. */
  element: { list: 'walls' | 'doors'; index: number; part?: number };
}

/**
 * Before/after quantities of a relocated wall from the verified lengths, for display and for the
 * design-revision difference. Area uses the given wall height; nothing else is assumed.
 */
export function relocationQuantities(change: RevisionChange, metersPerPixel: number, wallHeightM: number) {
  const r = change.relocation;
  if (!r || !(metersPerPixel > 0) || change.wallCandidates?.length || change.walls.some((w) => w.placeholder)) return null;
  const before = round(pxToMeters(r.beforeLengthPx, metersPerPixel), 2);
  const after = round(pxToMeters(r.afterLengthPx, metersPerPixel), 2);
  return {
    offsetM: round(pxToMeters(r.offsetPx, metersPerPixel), 2),
    beforeLengthM: before,
    afterLengthM: after,
    deltaLengthM: round(after - before, 2),
    beforeAreaM2: round(before * wallHeightM, 2),
    afterAreaM2: round(after * wallHeightM, 2),
    deltaAreaM2: round((after - before) * wallHeightM, 2),
  };
}

/** AI may contradict the local wall evidence; a confident "not a wall" keeps quantities off. */
export function wallsAllowed(change: RevisionChange): boolean {
  // Geometry the user corrected or placed is theirs to approve; AI labels no longer veto it.
  if (change.edited) return true;
  const ai = change.ai;
  return !(ai && ai.confidence >= 0.7 && !['wall', 'room-boundary', 'structure'].includes(ai.category));
}

export function doorsAllowed(change: RevisionChange): boolean {
  if (openingGeometryNeedsVerification(change)) return false;
  if (change.edited) return true;
  const ai = change.ai;
  return !(ai && ai.confidence >= 0.7 && !['door', 'opening-other'].includes(ai.category));
}

function strip(a: Point, b: Point, halfWidth: number): Point[] {
  const len = distancePx(a, b) || 1;
  const nx = (-(b.y - a.y) / len) * halfWidth;
  const ny = ((b.x - a.x) / len) * halfWidth;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

export function changeItems(change: RevisionChange, context: ComparisonContext, metersPerPixel: number, wallHeightM: number): ChangeItem[] {
  if (!(metersPerPixel > 0)) return [];
  if (isOpeningDifference(change)) return context === 'construction' && !openingGeometryNeedsVerification(change)
    ? openingImpact(change, metersPerPixel).portions.map(p => ({ ...p, source: 'door' as const })) : [];
  if (change.userType?.startsWith('wall') && sidesOf(change.userType).some(side => !change.walls.some(w => w.side === side))) return [];
  const items: ChangeItem[] = [];
  // Wall geometry still awaiting manual confirmation: no wall quantity until the user confirms it,
  // rather than a length taken from an incompletely drawn wall.
  if (wallsAllowed(change) && !change.wallCandidates?.length) {
    change.walls.forEach((w, index) => {
      // A starting line the user never placed is not a measurement.
      if (w.placeholder) return;
      if (w.side === 'removed' && context !== 'construction') return;
      // A relocated wall in a design revision is a quantity difference (new length − old length),
      // not new construction on top of the old wall: its added side produces no item here.
      if (w.side === 'added' && context === 'design' && change.relocation) return;
      const lengthM = round(pxToMeters(w.lengthPx, metersPerPixel), 2);
      const height = w.heightM ?? wallHeightM;
      items.push({
        areaKind: w.side === 'added' ? 'construction' : 'demolition',
        points: w.footprint,
        centerline: [...w.centerline],
        wallLengthM: lengthM,
        wallHeightM: height,
        areaM2: round(lengthM * height, 2),
        source: 'wall',
        element: { list: 'walls', index },
      });
    });
  }
  if (context === 'construction' && doorsAllowed(change)) {
    for (const [index, d] of change.doors.entries()) {
      if (d.placeholder) continue;
      const height = d.heightM ?? OPENING_DEFAULT_SIZES[d.opening ?? 'door'].heightM;
      const widthM = round(pxToMeters(distancePx(d.hinge, d.jamb), metersPerPixel), 2);
      if (!(widthM > 0)) continue;
      items.push({
        areaKind: d.side === 'added' ? 'demolition' : 'construction',
        points: strip(d.hinge, d.jamb, 0.05 / metersPerPixel),
        centerline: [d.hinge, d.jamb],
        wallLengthM: widthM,
        wallHeightM: height,
        areaM2: round(widthM * height, 2),
        source: 'door',
        element: { list: 'doors', index },
      });
    }
  }
  return items;
}

interface RecomputableMeasurement {
  tool: string;
  points: Point[];
  calcMode?: 'footprint' | 'wall';
  centerline?: Point[];
  wallHeightM?: number;
  lengthM?: number;
  areaM2?: number;
  wallLengthM?: number;
}

/**
 * Quantities derived again from geometry and the current scale, so a recalibration never leaves a
 * stale stored value behind. A wall item with a measured centre line uses its exact length.
 */
export function recomputeMeasurement<T extends RecomputableMeasurement>(m: T, metersPerPixel: number): T {
  if (!(metersPerPixel > 0) || m.points.length < 2) return m;
  if (m.tool === 'distance') {
    return { ...m, lengthM: round(pxToMeters(distancePx(m.points[0], m.points[1]), metersPerPixel), 2) };
  }
  if (m.tool === 'perimeter') {
    return { ...m, lengthM: round(pxToMeters(polygonPerimeterPx(m.points, true), metersPerPixel), 2) };
  }
  if (m.tool === 'area' && m.calcMode === 'wall') {
    const lengthPx = m.centerline && m.centerline.length >= 2 ? polygonPerimeterPx(m.centerline, false) : longestEdgePx(m.points);
    const wallLengthM = round(pxToMeters(lengthPx, metersPerPixel), 2);
    return { ...m, wallLengthM, areaM2: round(wallLengthM * (m.wallHeightM ?? 0), 2) };
  }
  if (m.tool === 'area') return { ...m, areaM2: round(polygonAreaM2(m.points, metersPerPixel), 2) };
  return m;
}
