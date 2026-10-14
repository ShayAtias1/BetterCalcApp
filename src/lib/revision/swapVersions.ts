import type { RevisionChange, RevisionEditType, RevisionAiChangeType } from '../../types/revisionAnalysis';
import { editTypeOf, finalizeEditedChange } from './changeEdit';

const opposite = (side: 'added' | 'removed') => side === 'added' ? 'removed' as const : 'added' as const;
function reverseType<T extends RevisionEditType | RevisionAiChangeType>(type: T): T {
  return (type.endsWith('-added') ? type.replace(/-added$/, '-removed')
    : type.endsWith('-removed') ? type.replace(/-removed$/, '-added') : type) as T;
}

/** Coordinates already share native source space. Only this change's version ownership moves. */
export function swapChangeVersions(change: RevisionChange): RevisionChange {
  const swapped = {
    ...change,
    userType: reverseType(editTypeOf(change)),
    walls: change.walls.map(w => ({ ...w, side: opposite(w.side) })),
    doors: change.doors.map(d => ({ ...d, side: opposite(d.side) })),
    addedSegments: change.removedSegments,
    removedSegments: change.addedSegments,
    addedLengthPx: change.removedLengthPx,
    removedLengthPx: change.addedLengthPx,
    textChanges: change.textChanges && { before: change.textChanges.after, after: change.textChanges.before },
    ai: change.ai && { ...change.ai, summary: '', changeType: change.ai.changeType === 'added' ? 'removed' as const
      : change.ai.changeType === 'removed' ? 'added' as const : change.ai.changeType },
    aiProposal: change.aiProposal && { ...change.aiProposal, changeType: reverseType(change.aiProposal.changeType),
      before: change.aiProposal.after, after: change.aiProposal.before },
  };
  const result = finalizeEditedChange(swapped);
  // Swapping ownership does not verify missing geometry or discard unresolved candidates.
  return { ...result, ...(result.userType === 'other' ? { category: change.category,
    kind: change.kind === 'added' ? 'removed' as const : change.kind === 'removed' ? 'added' as const : change.kind } : {}), wallCandidates: change.wallCandidates?.map(w => ({ ...w, side: opposite(w.side) })) };
}
