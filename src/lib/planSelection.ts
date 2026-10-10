import type { Point } from '../types';
export type SelectionBox = { x: number; y: number; width: number; height: number };
export function selectionBox(a: Point, b: Point): SelectionBox {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
/** Clip a segment against the selection rectangle, including boundary touches. */
export function segmentInSelection(a: Point, b: Point, box: SelectionBox): boolean {
  let low = 0, high = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}
export function polygonInSelection(points: Point[], box: SelectionBox): boolean {
  if (!points.length) return false;
  if (points.some((p, i) => segmentInSelection(p, points[(i + 1) % points.length], box))) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > box.y) !== (b.y > box.y) && box.x < (b.x - a.x) * (box.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
