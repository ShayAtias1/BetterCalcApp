import type { Point } from '../types';
import { polygonAreaPx } from './geometry';
import { rectangleLocalFrame } from './zoneGeometry';

export type AreaGeometryKind = 'room' | 'concrete' | 'mesh' | 'bars';

/** Rectangle corners resize along the original local axes, with the opposite corner anchored.
 * Polygon vertices move individually. Always derive from the drag's original geometry. */
export function reshapeArea(points: Point[], index: number, target: Point): Point[] | null {
  if (points.length < 3 || index < 0 || index >= points.length || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const frame = rectangleLocalFrame(points);
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
  return polygonAreaPx(result) > 1e-9 ? result : null;
}

export function translateArea(points: Point[], offset: Point): Point[] {
  return points.map((point) => ({ ...point, x: point.x + offset.x, y: point.y + offset.y }));
}
