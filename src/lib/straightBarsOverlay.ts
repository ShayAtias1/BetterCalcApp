import type { Calibration, Point } from '../types';
import type { RebarBars } from '../types/structural';
import type { TranslateFn } from '../i18n';
import { polygonCentroid, round } from './geometry';
import { markLabel } from './structuralMarks';
import { resolveStraightBars } from './rebar';
import { zoneBarLines } from './straightBarsGeometry';

export function prepareStraightBarsOverlay(item: RebarBars, calibration: Calibration | null, t: TranslateFn, number: (n: number) => string) {
  const resolved = resolveStraightBars(item, calibration);
  const points = item.barsZone?.points ?? [];
  const lines = zoneBarLines(item, calibration?.metersPerPixel ?? 0, resolved.effectiveLengthM);
  const center: Point | null = points.length >= 3 ? polygonCentroid(points) : null;
  const details = [`Ø${item.diameterMm}`, t('rebar.spatial.count', { count: resolved.count ?? '-' })];
  if (resolved.effectiveLengthM !== null) details.push(`${number(round(resolved.effectiveLengthM, 2))} ${t('units.m')}`);
  return { points, lines, center, rows: [markLabel(item, t), details.join(' · ')] };
}
