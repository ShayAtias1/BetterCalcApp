import type { Point } from '../types';
import { distancePx, polygonAreaPx, projectOntoLine } from './geometry';
import { rectangleLocalFrame } from './zoneGeometry';

export type AreaGeometryKind = 'room' | 'concrete' | 'mesh' | 'bars' | 'stirrup';

export function rectanglePoints(a: Point, b: Point): Point[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

/** A finite, simple polygon with distinct vertices and nonzero area. */
export function isValidAreaPolygon(points: Point[]): boolean {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polygonAreaPx(points) <= 1e-9) return false;
  const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on = (a: Point, b: Point, p: Point) => Math.abs(cross(a,b,p)) < 1e-9
    && p.x >= Math.min(a.x,b.x)-1e-9 && p.x <= Math.max(a.x,b.x)+1e-9 && p.y >= Math.min(a.y,b.y)-1e-9 && p.y <= Math.max(a.y,b.y)+1e-9;
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length];
    if (points.some((p,j) => j!==i && distancePx(a,p)<1e-9)) return false;
    for (let j=i+1;j<points.length;j++) {
      if (j===i+1 || (i===0 && j===points.length-1)) continue;
      const c=points[j], d=points[(j+1)%points.length];
      if ((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)) return false;
    }
  }
  return true;
}

export function closesPolygon(points: Point[], point: Point, zoom: number): boolean {
  return points.length >= 3 && Math.hypot(point.x - points[0].x, point.y - points[0].y) * zoom < 10;
}

/** Wall quantities follow the edited footprint; quadrilaterals use their end-face midpoints. */
export function wallFootprintGeometry(points: Point[], previous: Point[]) {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const area = polygonAreaPx(points);
  let a: Point, b: Point;
  if (points.length === 4) {
    a = { x: (points[0].x + points[3].x) / 2, y: (points[0].y + points[3].y) / 2 };
    b = { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 };
  } else {
    if (previous.length !== 2) return null;
    const length = distancePx(previous[0], previous[1]);
    if (length <= 1e-9) return null;
    const ux = (previous[1].x - previous[0].x) / length, uy = (previous[1].y - previous[0].y) / length;
    const along = points.map(p => p.x * ux + p.y * uy);
    const across = points.map(p => -p.x * uy + p.y * ux);
    const middle = (Math.min(...across) + Math.max(...across)) / 2;
    a = { x: Math.min(...along) * ux - middle * uy, y: Math.min(...along) * uy + middle * ux };
    b = { x: Math.max(...along) * ux - middle * uy, y: Math.max(...along) * uy + middle * ux };
  }
  const lengthPx = distancePx(a, b);
  return area > 1e-9 && lengthPx > 1e-9 ? { centerline: [a, b] as [Point, Point], lengthPx, thicknessPx: area / lengthPx } : null;
}

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

/** Remove a corner without collapsing the closed polygon. */
export function removePolygonVertex(points: Point[], index: number): Point[] | null {
  if (points.length <= 3 || !Number.isInteger(index) || index < 0 || index >= points.length) return null;
  const result = points.filter((_, vertex) => vertex !== index).map(p => ({ ...p }));
  return polygonAreaPx(result) > 1e-9 ? result : null;
}
