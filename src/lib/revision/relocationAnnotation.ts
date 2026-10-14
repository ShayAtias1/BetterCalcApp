import type { Point } from '../../types';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { editTypeOf, wallHasFootprint } from './changeEdit';
import { isValidAreaPolygon } from '../areaGeometryEditing';
import { distancePx, polygonCentroid } from '../geometry';

export const RELOCATION_COLORS = { removed: '#eab308', added: '#16a34a' };

export function isRelocationChange(change: RevisionChange): boolean {
  if (editTypeOf(change) === 'wall-relocated') return true;
  if (editTypeOf(change) !== 'opening-modified') return false;
  const before = change.doors.filter(d => d.side === 'removed');
  const after = change.doors.filter(d => d.side === 'added');
  // Resizing an opening around a fixed jamb is not a relocation.
  return before.length === 1 && after.length === 1
    && distancePx(before[0].hinge, after[0].hinge) > 0.5 && distancePx(before[0].jamb, after[0].jamb) > 0.5;
}

/** Only an unambiguous pair of actual, verified footprints supplies a movement arrow. */
export function relocationAnnotation(change: RevisionChange): { before: Point[]; after: Point[]; from: Point; to: Point } | null {
  if (!isRelocationChange(change) || change.wallCandidates?.length
    || (change.aiProposal && change.aiProposal.verification !== 'verified' && !change.edited)) return null;
  let before: Point[] | undefined, after: Point[] | undefined;
  if (editTypeOf(change) === 'wall-relocated') {
    const removed = change.walls.filter(w => w.side === 'removed');
    const added = change.walls.filter(w => w.side === 'added');
    if (removed.length !== 1 || added.length !== 1 || !wallHasFootprint(removed[0]) || !wallHasFootprint(added[0])) return null;
    before = removed[0].footprint;
    after = added[0].footprint;
  } else {
    const removed = change.doors.find(d => d.side === 'removed')!;
    const added = change.doors.find(d => d.side === 'added')!;
    if ([removed, added].some(d => d.placeholder || d.geometryVerified === false
      || (d.geometryVerified !== true && !change.edited) || !d.footprint || !isValidAreaPolygon(d.footprint))) return null;
    before = removed.footprint;
    after = added.footprint;
  }
  if (!before || !after) return null;
  const from = polygonCentroid(before), to = polygonCentroid(after);
  return distancePx(from, to) > 0.5 ? { before, after, from, to } : null;
}
