import type { Point } from '../types';
import type { StirrupShape } from '../types/structural';

export type ShapeDrawingMode = 'orthogonal' | 'free';

/** New legs snap in the shape's local axes, independently of screen/UI direction. */
export function snapNewShapeEndpoint(start: Point, target: Point, mode: ShapeDrawingMode): Point {
  if (mode === 'free') return { ...target };
  return Math.abs(target.x - start.x) >= Math.abs(target.y - start.y)
    ? { x: target.x, y: start.y } : { x: start.x, y: target.y };
}

/** Preserve existing axis-aligned connections; diagonals introduce no constraints. */
export function moveCustomShapePoint(shape: StirrupShape, index: number, target: Point, mode: ShapeDrawingMode): StirrupShape {
  const points = shape.points.map((point) => ({ ...point }));
  if (!points[index]) return shape;
  if (mode === 'free') {
    points[index] = { ...target };
    return { ...shape, points };
  }
  const connections: [number, number][] = shape.points.slice(1).map((_, i) => [i, i + 1]);
  if (shape.closed && points.length > 2) connections.push([points.length - 1, 0]);
  // Moving a corner carries its horizontal/vertical neighbours on that axis,
  // like resizing a rectangle. It never straightens a saved diagonal segment.
  for (const axis of ['x', 'y'] as const) {
    const linked = new Set([index]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of connections) {
        if (Math.abs(shape.points[a][axis] - shape.points[b][axis]) > 1e-9) continue;
        if (linked.has(a) === linked.has(b)) continue;
        linked.add(a); linked.add(b); changed = true;
      }
    }
    for (const vertex of linked) points[vertex][axis] = target[axis];
  }
  return { ...shape, points };
}
