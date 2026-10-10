import type { Point } from '../types';
import { polygonAreaPx, projectOntoLine } from './geometry';
import { rectangleLocalFrame } from './zoneGeometry';

export type AreaGeometryKind = 'room' | 'concrete' | 'mesh' | 'bars' | 'stirrup';

/** Rectangle corners resize along the original local axes, with the opposite corner anchored.
 * Polygon vertices move individually. Draft suggestions can force vertex-only edits and
 * temporarily invalid geometry; ordinary objects retain the existing rectangle/area guards.
 * Always derive from the drag's original geometry. */
export function reshapeArea(points: Point[], index: number, target: Point, options: { polygon?: boolean; allowInvalid?: boolean } = {}): Point[] | null {
  if (points.length < 3 || index < 0 || index >= points.length || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const frame = options.polygon ? null : rectangleLocalFrame(points);
  let result: Point[];
  if (frame) {
    const anchor = points[(index + 2) % 4];
    const local = (point: Point) => ({
      x: (point.x - anchor.x) * frame.xAxis.x + (point.y - anchor.y) * frame.xAxis.y,
      y: (point.x - anchor.x) * frame.yAxis.x + (point.y - anchor.y) * frame.yAxis.y,
    });
    const original = local(points[index]);
    const requested = local(target);
    // Keep winding and orientation; a corner cannot collapse or cross the fixed opposite corner.
    const signX = Math.sign(original.x), signY = Math.sign(original.y);
    const x = signX * Math.max(0.1, requested.x * signX);
    const y = signY * Math.max(0.1, requested.y * signY);
    result = points.map((point, vertex) => {
      if (vertex === (index + 2) % 4) return { ...anchor };
      const before = local(point);
      const nextX = Math.abs(before.x) > Math.abs(original.x) / 2 ? x : 0;
      const nextY = Math.abs(before.y) > Math.abs(original.y) / 2 ? y : 0;
      return { x: anchor.x + frame.xAxis.x * nextX + frame.yAxis.x * nextY,
        y: anchor.y + frame.xAxis.y * nextX + frame.yAxis.y * nextY };
    });
  } else {
    result = points.map((point, vertex) => vertex === index ? { ...target } : { ...point });
  }
  return options.allowInvalid || polygonAreaPx(result) > 1e-9 ? result : null;
}

export function translateArea(points: Point[], offset: Point): Point[] {
  return points.map((point) => ({ ...point, x: point.x + offset.x, y: point.y + offset.y }));
}

/** Insert on the chosen closed polygon edge, preserving its winding and source points. */
export function insertPolygonVertex(points: Point[], edge: number, target: Point): Point[] | null {
  if (points.length < 3 || !Number.isInteger(edge) || edge < 0 || edge >= points.length || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const a = points[edge], b = points[(edge + 1) % points.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-9) return null;
  const point = projectOntoLine(a, b, target);
  const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length);
  if (along <= 0 || along >= 1) return null;
  const result = points.map(p => ({ ...p }));
  result.splice(edge + 1, 0, point);
  return result;
}
