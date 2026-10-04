import type { Point } from '../types';

interface DiagramSegment { start: Point; end: Point; text: string }
interface LabelBox { x: number; y: number; width: number; height: number }

/** Deterministic PDF annotation layout; geometry is input only and never edited. */
export function placeStirrupPdfDimensions(
  segments: DiagramSegment[],
  bounds: { left: number; top: number; width: number; height: number },
  measure: (text: string) => number,
) {
  const occupied: LabelBox[] = [];
  const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  const overlaps = (a: LabelBox, b: LabelBox) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 3
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 3;
  const inside = (box: LabelBox) => box.x - box.width / 2 >= bounds.left
    && box.x + box.width / 2 <= bounds.left + bounds.width
    && box.y - box.height / 2 >= bounds.top && box.y + box.height / 2 <= bounds.top + bounds.height;
  const crossesGeometry = (box: LabelBox) => segments.some(({ start, end }) => {
    // Clip the segment against the padded text box using parameter intervals.
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y'] as const) {
      const half = (axis === 'x' ? box.width : box.height) / 2 + 2;
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-9) {
        if (start[axis] < box[axis] - half || start[axis] > box[axis] + half) return false;
      } else {
        const a = (box[axis] - half - start[axis]) / delta;
        const b = (box[axis] + half - start[axis]) / delta;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
        if (enter > exit) return false;
      }
    }
    return true;
  });
  return segments.flatMap((segment) => {
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return [];
    const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
    const normal = { x: -dy / length, y: dx / length };
    const tangent = { x: dx / length, y: dy / length };
    const preferredSide = (midpoint.x - center.x) * normal.x + (midpoint.y - center.y) * normal.y < 0 ? -1 : 1;
    const width = Math.min(measure(segment.text), bounds.width - 8), height = 10;
    const clearance = (Math.abs(normal.x) * width + Math.abs(normal.y) * height) / 2 + 5;
    const candidates: LabelBox[] = [];
    for (let stagger = 0; stagger < 6; stagger++) {
      for (const side of [preferredSide, -preferredSide]) {
        for (const slide of [0, -10, 10, -20, 20, -30, 30]) candidates.push({
          x: midpoint.x + normal.x * side * (clearance + stagger * 10) + tangent.x * slide,
          y: midpoint.y + normal.y * side * (clearance + stagger * 10) + tangent.y * slide,
          width, height,
        });
      }
    }
    const available = (box: LabelBox) => inside(box) && !occupied.some((other) => overlaps(box, other)) && !crossesGeometry(box);
    let box = candidates.find(available);
    // An unusually dense custom shape can use remaining free diagram space with a leader.
    if (!box) {
      for (let y = bounds.top + height / 2; y <= bounds.top + bounds.height - height / 2 && !box; y += 4) {
        for (let x = bounds.left + width / 2; x <= bounds.left + bounds.width - width / 2; x += 4) {
          const candidate = { x, y, width, height };
          if (available(candidate)) { box = candidate; break; }
        }
      }
    }
    // Never print an overlapping label if there is no legible space in the compact diagram.
    if (!box) return [];
    occupied.push(box);
    return [{ ...box, text: segment.text, midpoint,
      leader: Math.hypot(box.x - midpoint.x, box.y - midpoint.y) > clearance + 3 }];
  });
}
