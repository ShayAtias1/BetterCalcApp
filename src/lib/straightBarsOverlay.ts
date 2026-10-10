import type { Calibration, Plan, Point } from '../types';
import type { RebarBars } from '../types/structural';
import type { TranslateFn } from '../i18n';
import { polygonCentroid, round } from './geometry';
import { markLabel } from './structuralMarks';
import { resolveStraightBars } from './rebar';
import { zoneBarLines } from './straightBarsGeometry';

export function prepareStraightBarsOverlay(item: RebarBars, calibration: Calibration | null, t: TranslateFn, number: (n: number) => string, pageNumber = item.pageNumber, pages?: Plan['pages']) {
  const resolved = resolveStraightBars(item, calibration, pages);
  const points = item.barsZone?.pageNumber === pageNumber ? item.barsZone.points : [];
  const lines = (item.drawnBars?.filter((bar) => bar.pageNumber === pageNumber)
    ?? zoneBarLines(item, calibration?.metersPerPixel ?? 0, resolved.effectiveLengthM))
    .map((line) => ({ start: line.start, end: line.end, physicalId: 'id' in line ? String(line.id) : null }));
  const center: Point | null = points.length >= 3 ? polygonCentroid(points) : lines.length ? lines[0].start : null;
  const details = [`Ø${item.diameterMm}`, t('rebar.spatial.count', { count: resolved.count ?? '-' })];
  if (resolved.effectiveLengthM !== null) details.push(`${number(round(resolved.effectiveLengthM, 2))} ${t('units.m')}`);
  return { points, lines, center, rows: [markLabel(item, t), details.join(' · ')] };
}
