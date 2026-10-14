import type { AreaKind } from '../../types/compare';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { familyOf, editTypeOf } from './changeEdit';
import { isOpeningDifference, openingImpact } from './openingImpact';
import { openingWallFootprints } from './openingGeometry';

/** A new opening removes wall; an old opening is filled. Walls use the opposite work action. */
export function elementWorkKind(list: 'walls' | 'doors', side: 'added' | 'removed'): AreaKind {
  return list === 'walls' ? (side === 'added' ? 'construction' : 'demolition')
    : side === 'added' ? 'demolition' : 'construction';
}

export function elementWorkKinds(change: RevisionChange, list: 'walls' | 'doors', index: number): AreaKind[] {
  const element = change[list][index];
  if (!element) return [];
  if (list === 'doors' && isOpeningDifference(change)) {
    // Work classification is scale independent; calculation and verification stay in their engines.
    const calculated = openingImpact(change, 1).portions;
    const portions = calculated.length ? calculated : openingWallFootprints(change);
    return [...new Set(portions.filter(p => 'element' in p ? p.element.index === index : p.index === index).map(p => p.areaKind))];
  }
  return [elementWorkKind(list, element.side)];
}

export function revisionWorkKinds(change: RevisionChange): AreaKind[] {
  const kinds = [...change.walls.flatMap((_, i) => elementWorkKinds(change, 'walls', i)),
    ...change.doors.flatMap((_, i) => elementWorkKinds(change, 'doors', i))];
  if (!change.walls.length && !change.doors.length) {
    const family = familyOf(editTypeOf(change));
    if (family !== 'other') {
      const list = family === 'opening' ? 'doors' : 'walls';
      if (change.removedSegments.length || change.aiProposal?.before) kinds.push(elementWorkKind(list, 'removed'));
      if (change.addedSegments.length || change.aiProposal?.after) kinds.push(elementWorkKind(list, 'added'));
    }
  }
  return [...new Set(kinds)];
}
