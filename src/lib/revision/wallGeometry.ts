import type { Comparison, Measurement } from '../../types/compare';
import type { RevisionChange, RevisionWall } from '../../types/revisionAnalysis';
import { isValidAreaPolygon } from '../areaGeometryEditing';
import { distancePx, polygonAreaPx } from '../geometry';
import { isAiWallChange, sidesOf, editTypeOf, wallFromFootprint, wallFromLine } from './changeEdit';

/** Restore persisted evidence, never thickness inferred from an AI location box. */
export function normalizeRevisionWallGeometry(change: RevisionChange, measurements: Measurement[] = []): RevisionChange {
  if (!isAiWallChange(change)) return change;
  const source = change.walls ?? [];
  let changed = change.walls == null;
  const walls = source.map(w => {
    const footprintValid = Array.isArray(w.footprint) && w.footprint.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) && isValidAreaPolygon(w.footprint);
    const lineValid = Array.isArray(w.centerline) && w.centerline.length === 2
      && w.centerline.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      && distancePx(w.centerline[0], w.centerline[1]) > 0;
    const knownThickness = Number.isFinite(w.thicknessPx) && w.thicknessPx > 0;
    // Legacy display strips can have a valid ring but omit most of the verified wall thickness.
    // Never replace a footprint the user edited or manually drew.
    const thinDisplayStrip = footprintValid && lineValid && knownThickness && !change.edited && !w.manual
      && polygonAreaPx(w.footprint) / distancePx(w.centerline[0], w.centerline[1]) <= w.thicknessPx * 0.5;
    let repaired: RevisionWall | null = null;
    if (knownThickness && (!footprintValid || thinDisplayStrip) && lineValid) {
      const geometry = wallFromLine(w.side, w.centerline[0], w.centerline[1], w.thicknessPx);
      repaired = { ...w, footprint: geometry.footprint, lengthPx: geometry.lengthPx };
    } else if (footprintValid && (!lineValid || w.thicknessPx == null)
      && (knownThickness || (change.aiProposal?.verification === 'verified' && w.thicknessPx !== 0 && !w.placeholder))) {
      const geometry = wallFromFootprint(w.side, w.footprint);
      if (geometry) repaired = { ...w, ...geometry, manual: w.manual };
    } else if (footprintValid && lineValid && knownThickness && !(Number.isFinite(w.lengthPx) && w.lengthPx > 0)) {
      repaired = { ...w, lengthPx: distancePx(w.centerline[0], w.centerline[1]) };
    }
    if (repaired) changed = true;
    return repaired ?? w;
  });
  // Some old verified results retain the real polygon only in a linked wall item.
  // User edits/deletions win; stale items must never resurrect their geometry.
  if (!change.edited && change.aiProposal?.verification === 'verified') {
    for (const side of sidesOf(editTypeOf(change))) {
      if (walls.some(w => w.side === side)) continue;
      const kind = side === 'removed' ? 'demolition' : 'construction';
      for (const m of measurements) {
        if (!(m.revisionChangeId === change.id || (change.measurementIds ?? []).includes(m.id))
          || m.pageNumber !== change.pageNumber || m.areaKind !== kind || m.tool !== 'area' || m.calcMode !== 'wall'
          || (m.revisionElement && m.revisionElement.list !== 'walls') || !Array.isArray(m.points) || !isValidAreaPolygon(m.points)) continue;
        const wall = wallFromFootprint(side, m.points);
        if (wall) { walls.push({ ...wall, manual: undefined, ...(m.wallHeightM ? { heightM: m.wallHeightM } : {}) }); changed = true; }
      }
    }
  }
  return changed ? { ...change, walls } : change;
}

/** Lazy, immutable and idempotent saved-document repair. Review states and AI answers stay intact. */
export function withComparisonWallGeometry(comparison: Comparison): Comparison {
  let changed = false;
  const revisions = comparison.revisions.map(r => {
    if (!r.analysis) return r;
    let touched = false;
    const pages = Object.fromEntries(Object.entries(r.analysis.pages).map(([key, page]) => {
      const changes = page.changes.map(c => {
        const normalized = normalizeRevisionWallGeometry(c, r.measurements);
        if (normalized !== c) touched = true;
        return normalized;
      });
      return [key, changes.some((c, i) => c !== page.changes[i]) ? { ...page, changes } : page];
    }));
    if (!touched) return r;
    changed = true;
    return { ...r, analysis: { ...r.analysis, pages } };
  });
  return changed ? { ...comparison, revisions } : comparison;
}
