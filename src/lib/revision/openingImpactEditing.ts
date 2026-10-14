import type { Point } from '../../types';
import type { RevisionChange } from '../../types/revisionAnalysis';
import type { OpeningPortion } from './openingImpact';
import { wallFootprintGeometry } from '../areaGeometryEditing';
import { distancePx } from '../geometry';
import { wallFromLine } from './changeEdit';

/** Adapt the shared rectangle editor to the opening endpoints that define its difference.
 * The difference remains derived geometry; no independent wall or quantity is introduced.
 */
export function editOpeningImpactFootprint(change: RevisionChange, portion: OpeningPortion, points: Point[], move = false): RevisionChange {
  const geometry = wallFootprintGeometry(points, portion.centerline);
  const source = change.doors[portion.element.index];
  if (!geometry || !source || points.length !== 4) return change;
  const [a, b] = portion.centerline;
  const length = distancePx(a, b);
  if (!(length > 0)) return change;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const [nextA, nextB] = geometry.centerline;
  const delta = { x: nextA.x - a.x, y: nextA.y - a.y };
  const normal = -delta.x * uy + delta.y * ux;
  const alongA = delta.x * ux + delta.y * uy;
  const alongB = (nextB.x - b.x) * ux + (nextB.y - b.y) * uy;
  const onWall = (p: Point) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) <= 0.5;
  return { ...change, doors: change.doors.map(d => {
    if (!onWall(d.hinge) || !onWall(d.jamb)) return d;
    const edit = (p: Point) => {
      if (move) return { x: p.x + delta.x, y: p.y + delta.y };
      const along = distancePx(p, a) <= 0.5 ? alongA : distancePx(p, b) <= 0.5 ? alongB : 0;
      return { x: p.x + ux * along - uy * normal, y: p.y + uy * along + ux * normal };
    };
    const hinge = edit(d.hinge), jamb = edit(d.jamb);
    // Existing verified height/sill values remain untouched; the user just edited the wall footprint.
    return { ...d, hinge, jamb, radiusPx: distancePx(hinge, jamb), wallThicknessPx: geometry.thicknessPx,
      ...(d.footprint ? { footprint: wallFromLine(d.side, hinge, jamb, geometry.thicknessPx).footprint } : {}) };
  }) };
}
