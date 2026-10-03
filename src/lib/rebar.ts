/**
 * Rebar takeoff: quantities of one rebar item, from its zone, the page scale and the entered
 * reinforcement. Pure — no store, no persistence, no drawing. A takeoff, not a design: it counts
 * what the user says exists in the zone and never decides what should.
 *
 * ── Mesh (a marked zone plus layers) ───────────────────────────────────────────────────────────
 * Each layer is bars of one diameter at one MAXIMUM spacing, running along the zone's long side or
 * its short side. For a RECTANGULAR zone (any rotation) with sides long ≥ short:
 *
 *   direction 'long'  : bars of length `long`,  spread across the short side → span = short
 *   direction 'short' : bars of length `short`, spread along the long side   → span = long
 *
 *   count       = ceil(span / spacing) + 1          (spacing is a maximum, so the count rounds UP)
 *   totalLength = count × barLength
 *
 * Edge assumption: the first and last bar lie ON the two edges of the zone, and the others are
 * spread evenly between them at or under the maximum spacing. There is NO cover in V1 — bars span the
 * full zone — and no laps or hooks. A span that is an exact multiple of the spacing therefore gets
 * span/spacing + 1 bars (8 m at 0.2 m → 41), and a span a hair over a multiple gets one more.
 * Ratios within COUNT_EPSILON of a whole number count as whole, so floating-point noise
 * (1.2 / 0.4 = 3.0000000000000004) never adds a phantom bar.
 *
 * For any other shape the bars are not generated or clipped. Summing every bar's length over a
 * zone tends to area / spacing, so:
 *
 *   totalLength = area / spacing    — flagged `estimated`, bar count and cut length unavailable.
 *
 * Direction does not matter for that estimate. A rectangle given by a manual size override is exact.
 *
 * ── Manual bars (no geometry) ──────────────────────────────────────────────────────────────────
 *   totalLength = count × length per bar
 *
 * ── Weight and waste ───────────────────────────────────────────────────────────────────────────
 *   kg/m = (π / 4) × diameterMm² × 7850 / 1,000,000        (Ø12 ≈ 0.888, Ø16 ≈ 1.578, Ø20 ≈ 2.466)
 *   order = net × (1 + waste % / 100), for both length and weight
 *
 * A quantity that cannot be known is null, never 0: a real zero (zero bars) stays 0.
 * Values are unrounded; rounding is the summaries' job.
 */

import type { Calibration } from '../types';
import type { RebarBars, RebarItem, RebarLayer, RebarMesh } from '../types/structural';
import { finiteNonNegative, finitePositive, zoneGeometry } from './zoneGeometry';

/** Steel density, kg/m³. */
export const STEEL_DENSITY_KG_M3 = 7850;

/** A span / spacing ratio this close to a whole number is that whole number (see the count rule). */
export const COUNT_EPSILON = 1e-9;

/** Weight of one metre of bar, in kg, or null when the diameter is not a positive number. */
export function rebarWeightPerMeterKg(diameterMm: number | null | undefined): number | null {
  const d = finitePositive(diameterMm);
  return d === null ? null : ((Math.PI / 4) * d * d * STEEL_DENSITY_KG_M3) / 1_000_000;
}

/**
 * Bars needed to cover `spanM` with the first and last on the edges and no gap over `spacingM`:
 * `ceil(span / spacing) + 1`. Both must be positive; otherwise null.
 */
export function barCountForSpan(spanM: number, spacingM: number): number | null {
  const span = finitePositive(spanM);
  const spacing = finitePositive(spacingM);
  if (span === null || spacing === null) return null;
  return Math.ceil(span / spacing - COUNT_EPSILON) + 1;
}

/**
 * Why an item has no totals — never reported as 0:
 * - no-scale: a mesh zone measured off the plan whose page has no scale (and no size override).
 * - missing-size: a manual size is switched on but its length or width is not entered.
 * - no-layers: a mesh without any layer.
 * - invalid-input: a layer (or the manual bars) lacks a usable diameter, spacing, count or length.
 * Checked in that order.
 */
export type RebarStatus = 'ok' | 'no-scale' | 'missing-size' | 'no-layers' | 'invalid-input';

/** One layer of a mesh, or the single group of a manual-bars row. All quantities are net (no waste). */
export interface RebarLayerCalc {
  layerId: string;
  /** The layer's own inputs are usable. Totals still need the zone to be known too. */
  valid: boolean;
  diameterMm: number | null;
  /** Bars in the layer; null for an estimated layer and for anything not calculable. */
  barCount: number | null;
  /** Length of each bar in metres; null for an estimated layer and for anything not calculable. */
  cutLengthM: number | null;
  totalLengthM: number | null;
  weightKg: number | null;
  /** The total is `area / spacing` for a non-rectangular zone, not a count of real bars. */
  estimated: boolean;
}

export interface RebarCalc {
  status: RebarStatus;
  layers: RebarLayerCalc[];
  /** Net totals over all layers; null unless status is 'ok'. */
  totalLengthM: number | null;
  weightKg: number | null;
  /** The same with waste applied — what to order; null unless status is 'ok'. */
  orderLengthM: number | null;
  orderWeightKg: number | null;
  /** True when any layer is an estimate. */
  estimated: boolean;
  /** The waste % actually applied (0 when absent or unusable). */
  wastePercent: number;
}

const emptyLayer = (layerId: string, valid: boolean, diameterMm: number | null): RebarLayerCalc => ({
  layerId, valid, diameterMm, barCount: null, cutLengthM: null, totalLengthM: null, weightKg: null, estimated: false,
});

function layerResult(layerId: string, diameterMm: number, barCount: number | null, cutLengthM: number | null, totalLengthM: number, estimated: boolean): RebarLayerCalc {
  return { layerId, valid: true, diameterMm, barCount, cutLengthM, totalLengthM, weightKg: totalLengthM * rebarWeightPerMeterKg(diameterMm)!, estimated };
}

function finish(status: RebarStatus, layers: RebarLayerCalc[], wastePercent: number): RebarCalc {
  if (status !== 'ok') {
    return { status, layers, totalLengthM: null, weightKg: null, orderLengthM: null, orderWeightKg: null, estimated: false, wastePercent };
  }
  const totalLengthM = layers.reduce((sum, l) => sum + l.totalLengthM!, 0);
  const weightKg = layers.reduce((sum, l) => sum + l.weightKg!, 0);
  const factor = 1 + wastePercent / 100;
  return {
    status, layers, totalLengthM, weightKg, orderLengthM: totalLengthM * factor, orderWeightKg: weightKg * factor,
    estimated: layers.some((l) => l.estimated), wastePercent,
  };
}

function calculateMesh(item: RebarMesh, calibration: Calibration | null): RebarCalc {
  const wastePercent = finiteNonNegative(item.wastePercent, 0);
  const layers = Array.isArray(item.layers) ? item.layers : [];
  const zone = zoneGeometry(item.points, calibration?.metersPerPixel ?? 0, item.sizeOverride);

  const results = layers.map((layer) => calculateLayer(layer, zone));
  if (!zone) return finish(item.sizeOverride ? 'missing-size' : 'no-scale', results, wastePercent);
  if (layers.length === 0) return finish('no-layers', results, wastePercent);
  if (results.some((r) => !r.valid)) return finish('invalid-input', results, wastePercent);
  return finish('ok', results, wastePercent);
}

function calculateLayer(layer: RebarLayer, zone: ReturnType<typeof zoneGeometry>): RebarLayerCalc {
  const diameterMm = finitePositive(layer.diameterMm);
  const spacingM = finitePositive(layer.spacingM);
  if (diameterMm === null || spacingM === null) return emptyLayer(layer.id, false, diameterMm);
  if (!zone) return emptyLayer(layer.id, true, diameterMm);

  if (zone.sides) {
    const alongLong = layer.direction !== 'short';
    const barLengthM = alongLong ? zone.sides.longM : zone.sides.shortM;
    const spanM = alongLong ? zone.sides.shortM : zone.sides.longM;
    const count = barCountForSpan(spanM, spacingM)!;
    return layerResult(layer.id, diameterMm, count, barLengthM, count * barLengthM, false);
  }
  // Not a rectangle: no bars are generated; the total is the area-based estimate.
  return layerResult(layer.id, diameterMm, null, null, zone.areaM2 / spacingM, true);
}

function calculateBars(item: RebarBars): RebarCalc {
  const wastePercent = finiteNonNegative(item.wastePercent, 0);
  const diameterMm = finitePositive(item.diameterMm);
  const lengthM = finitePositive(item.lengthM);
  // Zero bars is a real zero; a missing or negative count is not.
  const count = typeof item.count === 'number' && Number.isFinite(item.count) && item.count >= 0 ? item.count : null;
  if (diameterMm === null || lengthM === null || count === null) {
    return finish('invalid-input', [emptyLayer(item.id, false, diameterMm)], wastePercent);
  }
  return finish('ok', [layerResult(item.id, diameterMm, count, lengthM, count * lengthM, false)], wastePercent);
}

export function calculateRebar(item: RebarItem, calibration: Calibration | null): RebarCalc {
  return item.kind === 'mesh' ? calculateMesh(item, calibration) : calculateBars(item);
}
