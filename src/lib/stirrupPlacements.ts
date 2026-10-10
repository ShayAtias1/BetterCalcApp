import type { Plan, Point } from '../types';
import type { RebarStirrup, StirrupPlacement } from '../types/structural';
import { distancePx, pxToMeters, polygonCentroid } from './geometry';
import { barCountForSpan, type RebarStatus } from './rebar';
import { finitePositive, rectangleLocalFrame, zoneGeometry } from './zoneGeometry';
import { prepareStirrupShape } from './stirrupShape';
import { markLabel } from './structuralMarks';
import type { TranslateFn } from '../i18n';

export interface StirrupPlacementResult {
  placement: StirrupPlacement;
  status: RebarStatus;
  quantity: number | null;
  distributionLengthM: number | null;
  areaM2: number | null;
  countX: number | null;
  countY: number | null;
  anchors: Point[];
  anchorGapPx: number;
}
const MAX_DISPLAY_ANCHORS = 1500;

export function resolveStirrupPlacement(placement: StirrupPlacement, pages: Plan['pages']): StirrupPlacementResult {
  const result: StirrupPlacementResult = { placement, status: 'invalid-input', quantity: null, distributionLengthM: null,
    areaM2: null, countX: null, countY: null, anchors: [], anchorGapPx: 0 };
  const scale = finitePositive(pages[placement.pageNumber]?.calibration?.metersPerPixel);
  if (placement.kind === 'area') {
    const frame = rectangleLocalFrame(placement.points);
    if (!frame) return result;
    const geometry = zoneGeometry(placement.points, scale ?? 0);
    result.areaM2 = geometry?.areaM2 ?? null;
    if (placement.quantityMode === 'manual') {
      const quantity = placement.manualQuantity;
      if (quantity !== undefined && Number.isSafeInteger(quantity) && quantity >= 0) return { ...result, status: 'ok', quantity };
      return result;
    }
    if (!scale) return { ...result, status: 'no-scale' };
    if (!geometry?.sides) return result;
    const countX = barCountForSpan(geometry.sides.longM, placement.spacingXM);
    const countY = barCountForSpan(geometry.sides.shortM, placement.spacingYM);
    if (!countX || !countY || !Number.isSafeInteger(countX * countY)) return result;
    const quantity = countX * countY;
    const longPx = geometry.sides.longM / scale, shortPx = geometry.sides.shortM / scale;
    result.quantity = quantity;
    result.countX = countX; result.countY = countY;
    result.status = 'ok';
    result.anchorGapPx = Math.min(longPx / (countX - 1), shortPx / (countY - 1));
    const anchor = (index: number): Point => {
      const x = Math.floor(index / countY) * longPx / (countX - 1), y = (index % countY) * shortPx / (countY - 1);
      return { x: frame.originPx.x + x * frame.xAxis.x + y * frame.yAxis.x,
        y: frame.originPx.y + x * frame.xAxis.y + y * frame.yAxis.y };
    };
    const stride = Math.max(1, Math.ceil(quantity / MAX_DISPLAY_ANCHORS));
    for (let index = 0; index < quantity; index += stride) result.anchors.push(anchor(index));
    if ((quantity - 1) % stride !== 0) result.anchors.push(anchor(quantity - 1));
    return result;
  }
  const pixels = distancePx(placement.start, placement.end);
  if (!Number.isFinite(pixels) || pixels < 1e-9) return result;
  result.distributionLengthM = scale ? pxToMeters(pixels, scale) : null;
  const manual = placement.quantityMode === 'manual';
  const quantity = manual ? placement.manualQuantity ?? null : result.distributionLengthM === null ? null : barCountForSpan(result.distributionLengthM, placement.spacingM);
  result.quantity = quantity;
  if (!scale && !manual) return { ...result, status: 'no-scale' };
  if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0) return result;
  result.status = 'ok';
  if (!manual && quantity > 0) {
    result.anchorGapPx = quantity > 1 ? pixels / (quantity - 1) : pixels;
    // Render a deterministic subset of actual positions when too dense; quantity is never capped.
    const stride = Math.max(1, Math.ceil(quantity / MAX_DISPLAY_ANCHORS));
    for (let index = 0; index < quantity; index += stride) {
      const t = quantity === 1 ? 0.5 : index / (quantity - 1);
      result.anchors.push({ x: placement.start.x + (placement.end.x - placement.start.x) * t,
        y: placement.start.y + (placement.end.y - placement.start.y) * t });
    }
    if (quantity > 1 && (quantity - 1) % stride !== 0) result.anchors.push({ ...placement.end });
  }
  return result;
}

export function prepareStirrupPlacement(item: RebarStirrup, placement: StirrupPlacement, pages: Plan['pages'], t: TranslateFn, number: (n: number) => string, zoom = 1) {
  const resolved = resolveStirrupPlacement(placement, pages);
  const shape = prepareStirrupShape(item.shape);
  const center = placement.kind === 'line' ? { x: (placement.start.x + placement.end.x) / 2, y: (placement.start.y + placement.end.y) / 2 } : polygonCentroid(placement.points);
  const spacing = placement.quantityMode === 'manual' ? t('rebar.stirrup.manualQuantity')
    : placement.kind === 'line' ? `@${number(placement.spacingM * 100)}` : `@${number(placement.spacingXM * 100)} × ${number(placement.spacingYM * 100)}`;
  return { ...resolved, shape, center, label: `${markLabel(item, t)} · Ø${item.diameterMm} ${spacing}`,
    glyphs: resolved.anchorGapPx * zoom >= 18 && shape.valid && resolved.anchors.length <= 300 };
}
