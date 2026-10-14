import type { RevisionChange } from '../../types/revisionAnalysis';

export function bboxIou(a: RevisionChange['bbox'], b: RevisionChange['bbox']): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - w * h;
  return union > 0 ? (w * h) / union : 0;
}

/**
 * Two proposals for the same physical change: same element family, same direction (an element
 * added next to one removed is a different change), overlapping regions.
 */
export function sameChange(a: RevisionChange, b: RevisionChange): boolean {
  const family = (c: RevisionChange) => (c.ai?.category === 'door' || c.ai?.category === 'window' || c.category === 'opening' ? 'opening' : c.category === 'wall' ? 'wall' : 'other');
  return family(a) === family(b) && a.kind === b.kind && bboxIou(a.bbox, b.bbox) >= 0.3;
}
