import polygonClipping from 'polygon-clipping';
import type { Polygon } from 'polygon-clipping';
import type { Point } from '../../types';
import type { RevisionChange, RevisionWall } from '../../types/revisionAnalysis';
import { isValidAreaPolygon } from '../areaGeometryEditing';
import { distancePx } from '../geometry';
import { openingFootprint, wallFromLine } from './changeEdit';

/** Alignment checks use calibrated dimensions; manual gap fills have no distance cap. */
const MAX_ALIGNMENT_OFFSET_M = 0.01;
const ANGLE_TOLERANCE = 3 * Math.PI / 180;
const polygon = (points: Point[]): Polygon => [points.map(p => [p.x, p.y])];

export interface WallGapConnector { points: Point[]; gapM: number }

/** Find matching end faces, never an arbitrary bounding box or a buffer around whole regions. */
export function wallGapConnector(a: RevisionWall, b: RevisionWall, metersPerPixel: number): WallGapConnector | null {
  if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel) || a.side !== b.side || !(a.thicknessPx > 0 && b.thicknessPx > 0)) return null;
  const lengthA = distancePx(...a.centerline), lengthB = distancePx(...b.centerline);
  if (!(lengthA > 0 && lengthB > 0)) return null;
  const ux = (a.centerline[1].x - a.centerline[0].x) / lengthA;
  const uy = (a.centerline[1].y - a.centerline[0].y) / lengthA;
  const vx = (b.centerline[1].x - b.centerline[0].x) / lengthB;
  const vy = (b.centerline[1].y - b.centerline[0].y) / lengthB;
  if (Math.abs(ux * vx + uy * vy) < Math.cos(ANGLE_TOLERANCE)) return null;
  const along = (p: Point) => p.x * ux + p.y * uy;
  const across = (p: Point) => -p.x * uy + p.y * ux;
  const bounds = (w: RevisionWall) => ({ min: Math.min(...w.footprint.map(along)), max: Math.max(...w.footprint.map(along)) });
  const ab = bounds(a), bb = bounds(b);
  const left = ab.max < bb.min ? a : bb.max < ab.min ? b : null;
  if (!left) return null;
  const right = left === a ? b : a;
  const face = (w: RevisionWall, end: 'min' | 'max'): Point[] | null => {
    const bound = bounds(w)[end];
    const edges = w.footprint.map((p, i) => [p, w.footprint[(i + 1) % w.footprint.length]])
      .filter(([p, q]) => distancePx(p, q) > 0
        && Math.abs(along(q) - along(p)) / distancePx(p, q) <= Math.sin(ANGLE_TOLERANCE)
        && Math.max(Math.abs(bound - along(p)), Math.abs(bound - along(q))) * metersPerPixel <= MAX_ALIGNMENT_OFFSET_M);
    edges.sort((x, y) => Math.abs(across(y[1]) - across(y[0])) - Math.abs(across(x[1]) - across(x[0])));
    return edges[0]?.sort((p, q) => across(p) - across(q)) ?? null;
  };
  const l = face(left, 'max'), r = face(right, 'min');
  if (!l || !r) return null;
  const lw = across(l[1]) - across(l[0]), rw = across(r[1]) - across(r[0]);
  if (!(lw > 0 && rw > 0) || Math.min(lw, rw) / Math.max(lw, rw) < 0.8) return null;
  if (Math.max(Math.abs(across(l[0]) - across(r[0])), Math.abs(across(l[1]) - across(r[1]))) * metersPerPixel > MAX_ALIGNMENT_OFFSET_M) return null;
  const gaps = [along(r[0]) - along(l[0]), along(r[1]) - along(l[1])].map(d => d * metersPerPixel);
  if (gaps.some(gap => !(gap > 0) || !Number.isFinite(gap))) return null;
  const points = [l[0], r[0], r[1], l[1]].map(p => ({ ...p }));
  return isValidAreaPolygon(points) ? { points, gapM: Math.max(...gaps) } : null;
}

/** Existing opening footprints and line-only opening evidence veto a proposed connector. */
export function bridgeCrossesOpening(points: Point[], side: RevisionWall['side'], changes: RevisionChange[], metersPerPixel: number): boolean {
  const blockers = changes.flatMap(c => {
    const footprints = c.doors.filter(d => d.side === side).map(d => openingFootprint(d)
      ?? wallFromLine(side, d.hinge, d.jamb, 0.02 / metersPerPixel).footprint);
    const proposal = c.aiProposal;
    if (proposal && /^(door|window|opening)/.test(proposal.changeType)) {
      const line = side === 'removed' ? proposal.before : proposal.after;
      if (line) footprints.push(wallFromLine(side, line[0], line[1], 0.02 / metersPerPixel).footprint);
    }
    return footprints;
  });
  return blockers.some(footprint => polygonClipping.intersection(polygon(points), polygon(footprint)).length > 0);
}
