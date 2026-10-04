import type { Point } from '../types';
import type { StirrupShape, StirrupTemplate } from '../types/structural';
import { distancePx } from './geometry';
import { finitePositive } from './zoneGeometry';

export function stirrupTemplate(template: StirrupTemplate, widthM = 0.3, heightM = 0.5): StirrupShape {
  const points = template === 'l' ? [{ x: 0, y: 0 }, { x: 0, y: heightM }, { x: widthM, y: heightM }]
    : [{ x: 0, y: 0 }, { x: 0, y: heightM }, { x: widthM, y: heightM }, { x: widthM, y: 0 }];
  return { template, points, closed: template === 'rectangle' };
}

/** One normalized vector model for editor, placement glyphs and execution reports. */
export function prepareStirrupShape(shape: StirrupShape) {
  const validPoints = shape.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const segments = shape.points.slice(1).map((end, index) => ({ start: shape.points[index], end, index, lengthM: distancePx(shape.points[index], end) }));
  if (shape.closed && shape.points.length > 2) segments.push({ start: shape.points.at(-1)!, end: shape.points[0], index: shape.points.length - 1, lengthM: distancePx(shape.points.at(-1)!, shape.points[0]) });
  const valid = validPoints && shape.points.length >= (shape.closed ? 3 : 2) && segments.every((segment) => finitePositive(segment.lengthM) !== null);
  const xs = shape.points.map((p) => p.x), ys = shape.points.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0, minY = ys.length ? Math.min(...ys) : 0;
  const widthM = xs.length ? Math.max(...xs) - minX : 0, heightM = ys.length ? Math.max(...ys) - minY : 0;
  const scale = 70 / Math.max(widthM, heightM, 0.01);
  const normalize = (p: Point) => ({ x: 15 + (p.x - minX) * scale, y: 15 + (p.y - minY) * scale });
  return { valid, geometricLengthM: valid ? segments.reduce((total, segment) => total + segment.lengthM, 0) : null,
    widthM, heightM, points: validPoints ? shape.points.map(normalize) : [],
    segments: validPoints ? segments.map((segment) => ({ ...segment, normalizedStart: normalize(segment.start), normalizedEnd: normalize(segment.end) })) : [],
    closed: shape.closed, template: shape.template };
}

/** Edit a segment's real endpoint along its existing direction; adjacent segments follow the vertex. */
export function resizeStirrupSegment(shape: StirrupShape, index: number, lengthM: number): StirrupShape {
  const segment = prepareStirrupShape(shape).segments[index];
  if (!segment || !finitePositive(lengthM) || segment.lengthM < 1e-9) return shape;
  const endIndex = (index + 1) % shape.points.length;
  const factor = lengthM / segment.lengthM;
  const end = { x: segment.start.x + (segment.end.x - segment.start.x) * factor,
    y: segment.start.y + (segment.end.y - segment.start.y) * factor };
  return { ...shape, template: 'custom', points: shape.points.map((point, vertex) => vertex === endIndex ? end : { ...point }) };
}
