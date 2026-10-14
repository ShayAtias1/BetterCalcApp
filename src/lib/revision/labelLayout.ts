import type { Point } from '../../types';

export interface LabelBox { x: number; y: number; width: number; height: number }
export interface LabelBounds { left: number; top: number; right: number; bottom: number }

function overlap(a: LabelBox, b: LabelBox, gap = 0): number {
  return Math.max(0, Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x - gap, b.x - gap))
    * Math.max(0, Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y - gap, b.y - gap));
}

/** Search locally in screen-sized steps. Viewport edges never become distant placement targets. */
export function placeRevisionLabel(tip: Point, width: number, height: number, zoom: number,
  occupied: LabelBox[], geometry: LabelBox[], bounds: LabelBounds, arrowPenalty?: (box: LabelBox) => number): Point {
  const gap = 8 / zoom;
  const radius = 128 / zoom;
  const xs = [tip.x + gap, tip.x - width - gap, tip.x - width / 2];
  const ys = [tip.y - height - gap, tip.y + gap, tip.y - height / 2];
  for (let offset = width + gap; offset <= radius; offset += width + gap) {
    xs.push(tip.x + gap + offset, tip.x - width - gap - offset);
  }
  for (let offset = height + gap; offset <= radius; offset += height + gap) {
    ys.push(tip.y + gap + offset, tip.y - height - gap - offset);
  }
  const viewport = { x: bounds.left, y: bounds.top, width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) };
  const candidates = xs.flatMap(x => ys.map(y => ({ x, y, width, height }))).map(box => {
    const distance = Math.hypot(Math.max(box.x - tip.x, tip.x - box.x - width, 0), Math.max(box.y - tip.y, tip.y - box.y - height, 0));
    return { box, distance, labels: occupied.reduce((sum, other) => sum + overlap(box, other, 3 / zoom), 0),
      geometry: geometry.reduce((sum, other) => sum + overlap(box, other, 2 / zoom), 0) };
  }).filter(candidate => candidate.distance <= radius);
  const clearLabels = candidates.filter(candidate => candidate.labels === 0);
  const clearGeometry = clearLabels.filter(candidate => candidate.geometry === 0);
  const pool = clearGeometry.length ? clearGeometry : clearLabels.length ? clearLabels : candidates;
  const score = (candidate: typeof candidates[number]) => candidate.distance * zoom
    + (candidate.labels * 120 + candidate.geometry * 40) / (width * height)
    + (1 - overlap(candidate.box, viewport) / (width * height)) * 16
    + (arrowPenalty?.(candidate.box) ?? 0);
  return pool.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best).box;
}
