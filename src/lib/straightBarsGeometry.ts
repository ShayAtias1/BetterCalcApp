import type { Point } from '../types';
import type { RebarBars } from '../types/structural';
import { distancePx } from './geometry';
import { finitePositive, rectangleLocalFrame } from './zoneGeometry';

export interface StraightBarLine { start: Point; end: Point }

/** Native plan geometry only; both UI and exports consume these same prepared lines. */
export function zoneBarLines(item: RebarBars, metersPerPixel: number, effectiveLengthM: number | null): StraightBarLine[] {
  const zone = item.barsZone;
  const frame = zone && rectangleLocalFrame(zone.points);
  if (!zone || !frame || !Number.isSafeInteger(item.count) || item.count < 1) return [];
  const a = distancePx(zone.points[0], zone.points[1]);
  const b = distancePx(zone.points[1], zone.points[2]);
  const long = Math.max(a, b), short = Math.min(a, b);
  const alongLong = zone.direction !== 'short';
  const automatic = zone.lengthMode !== 'manual';
  const scale = finitePositive(metersPerPixel);
  const lengthPx = automatic ? (alongLong ? long : short) : scale && effectiveLengthM !== null ? effectiveLengthM / scale : null;
  if (lengthPx === null || !Number.isFinite(lengthPx) || lengthPx <= 0) return [];
  const toPlan = (x: number, y: number): Point => ({
    x: frame.originPx.x + frame.xAxis.x * x + frame.yAxis.x * y,
    y: frame.originPx.y + frame.xAxis.y * x + frame.yAxis.y * y,
  });
  return Array.from({ length: item.count }, (_, index) => {
    const across = item.count === 1 ? 0.5 : index / (item.count - 1);
    const x = alongLong ? long / 2 : across * long;
    const y = alongLong ? across * short : short / 2;
    return alongLong
      ? { start: toPlan(x - lengthPx / 2, y), end: toPlan(x + lengthPx / 2, y) }
      : { start: toPlan(x, y - lengthPx / 2), end: toPlan(x, y + lengthPx / 2) };
  });
}
