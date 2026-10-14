import polygonClipping from 'polygon-clipping';
import type { Polygon } from 'polygon-clipping';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { isValidAreaPolygon } from '../areaGeometryEditing';
import { finalizeEditedChange, wallFromFootprint } from './changeEdit';

export interface WallRegionRef { changeId: string; index: number }
export type WallMergeError = 'incompatible' | 'separated' | 'holes' | 'invalid';
export type WallMergeResult = { ok: true; change: RevisionChange; changeIds: string[] } | { ok: false; error: WallMergeError };

/** Exact boolean union, with no snapping, convex hull, or bridge across an empty gap. */
export function prepareWallRegionMerge(changes: RevisionChange[], selection: WallRegionRef[]): WallMergeResult {
  const refs = [...new Map(selection.map(ref => [`${ref.changeId}:${ref.index}`, ref])).values()];
  if (refs.length < 2) return { ok: false, error: 'incompatible' };
  const regions = refs.map(ref => {
    const change = changes.find(c => c.id === ref.changeId);
    const wall = Number.isInteger(ref.index) ? change?.walls[ref.index] : undefined;
    return { ref, change, wall };
  });
  const first = regions[0];
  if (!first.change || !first.wall || regions.some(({ change, wall }) => !change || !wall
    || change.status === 'applied' || change.status !== first.change!.status || change.doors.length
    || wall.placeholder || wall.side !== first.wall!.side)) return { ok: false, error: 'incompatible' };
  if (regions.some(({ wall }) => !isValidAreaPolygon(wall!.footprint))) return { ok: false, error: 'invalid' };
  const polygons: Polygon[] = regions.map(({ wall }) => [wall!.footprint.map(p => [p.x, p.y])]);
  let union;
  try { union = polygonClipping.union(polygons[0], ...polygons.slice(1)); }
  catch { return { ok: false, error: 'invalid' }; }
  if (union.length !== 1) return { ok: false, error: 'separated' };
  // The current editable polygon model has one ring. Never silently fill a hole in the union.
  if (union[0].length !== 1) return { ok: false, error: 'holes' };
  const footprint = union[0][0].slice(0, -1).map(([x, y]) => ({ x, y }));
  const mergedWall = wallFromFootprint(first.wall.side, footprint);
  if (!mergedWall) return { ok: false, error: 'invalid' };
  const changeIds = [...new Set(refs.map(ref => ref.changeId))];
  const affected = changes.filter(c => changeIds.includes(c.id));
  // Keep all unselected geometry, especially the opposite version of relocated walls.
  const walls = [mergedWall, ...affected.flatMap(c => c.walls.filter((_, index) =>
    !refs.some(ref => ref.changeId === c.id && ref.index === index)))];
  const added = walls.some(w => w.side === 'added'), removed = walls.some(w => w.side === 'removed');
  const change = finalizeEditedChange({ ...first.change,
    walls, userType: added && removed ? 'wall-relocated' : added ? 'wall-added' : 'wall-removed',
    measurementIds: undefined,
    addedSegments: affected.flatMap(c => c.addedSegments), removedSegments: affected.flatMap(c => c.removedSegments),
    evidence: [...new Set(affected.flatMap(c => c.evidence))],
  });
  return { ok: true, change, changeIds };
}
