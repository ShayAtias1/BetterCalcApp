import type { Plan } from '../types';
import type { RebarStirrup } from '../types/structural';
import { rebarWeightPerMeterKg, type RebarCalc, type RebarStatus } from './rebar';
import { finiteNonNegative, finitePositive } from './zoneGeometry';
import { prepareStirrupShape } from './stirrupShape';
import { resolveStirrupPlacement, type StirrupPlacementResult } from './stirrupPlacements';

export interface StirrupResult extends RebarCalc {
  geometricLengthM: number | null;
  effectiveUnitLength: number | null;
  lengthSource: 'geometric' | 'manual';
  placementResults: StirrupPlacementResult[];
  totalCount: number | null;
  totalSteelLength: number | null;
  kgPerMeter: number | null;
  netWeight: number | null;
  orderWeight: number | null;
}

/** Shape is measured in local metres; every placement uses its own page calibration. */
export function resolveStirrupItem(item: RebarStirrup, pages: Plan['pages']): StirrupResult {
  const shape = prepareStirrupShape(item.shape);
  const lengthSource = item.lengthMode === 'manual' ? 'manual' : 'geometric';
  const effectiveUnitLength = lengthSource === 'manual' ? finitePositive(item.manualLengthM) : shape.geometricLengthM;
  const placementResults = item.placements.map((placement) => resolveStirrupPlacement(placement, pages));
  const kgPerMeter = rebarWeightPerMeterKg(item.diameterMm);
  const wastePercent = finiteNonNegative(item.wastePercent, 0);
  const totalCount = placementResults.length > 0 && placementResults.every((placement) => placement.status === 'ok' && placement.quantity !== null)
    ? placementResults.reduce((sum, placement) => sum + placement.quantity!, 0) : null;
  const status: RebarStatus = !shape.valid || effectiveUnitLength === null || kgPerMeter === null || (totalCount !== null && !Number.isSafeInteger(totalCount))
    ? 'invalid-input' : placementResults.some((placement) => placement.status === 'no-scale') ? 'no-scale'
      : totalCount === null ? 'invalid-input' : 'ok';
  const totalSteelLength = status === 'ok' ? effectiveUnitLength! * totalCount! : null;
  const netWeight = totalSteelLength === null ? null : totalSteelLength * kgPerMeter!;
  const factor = 1 + wastePercent / 100;
  const orderWeight = netWeight === null ? null : netWeight * factor;
  return { status, geometricLengthM: shape.geometricLengthM, effectiveUnitLength, lengthSource, placementResults, totalCount,
    totalSteelLength, kgPerMeter, netWeight, orderWeight, wastePercent, estimated: false,
    totalLengthM: totalSteelLength, weightKg: netWeight, orderLengthM: totalSteelLength === null ? null : totalSteelLength * factor,
    orderWeightKg: orderWeight,
    layers: [{ layerId: item.id, spacingM: null, valid: status === 'ok', diameterMm: finitePositive(item.diameterMm),
      barCount: totalCount, cutLengthM: effectiveUnitLength, totalLengthM: totalSteelLength, weightKg: netWeight, estimated: false }],
  };
}
