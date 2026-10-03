// The rebar engine. Scale used throughout: 1 native px = 1 cm (metersPerPixel 0.01), so a
// 1000 × 800 px rectangle is 10 m × 8 m. Count rule: ceil(span / maximum spacing) + 1, bars on both
// edges of the zone, no cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barCountForSpan, calculateRebar, rebarWeightPerMeterKg } from '../../src/lib/rebar.ts';
import type { Calibration, Point } from '../../src/types/index.ts';
import type { RebarBars, RebarLayer, RebarMesh } from '../../src/types/structural.ts';

const CAL: Calibration = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const rotate = (pts: Point[], deg: number): Point[] => {
  const a = (deg * Math.PI) / 180;
  return pts.map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a) + 300, y: p.x * Math.sin(a) + p.y * Math.cos(a) + 120 }));
};
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }]; // 27 m²

let n = 0;
const layer = (extra: Partial<RebarLayer> = {}): RebarLayer => ({ id: `l${n++}`, diameterMm: 12, spacingM: 0.2, direction: 'long', ...extra });
const mesh = (layers: RebarLayer[], extra: Partial<RebarMesh> = {}): RebarMesh => ({
  id: 'm', kind: 'mesh', pageNumber: 1, mark: 'M01', points: rect(1000, 800), layers, ...extra,
});
const bars = (extra: Partial<RebarBars> = {}): RebarBars => ({ id: 'b', kind: 'bars', pageNumber: 1, mark: 'B01', diameterMm: 16, count: 10, lengthM: 6, ...extra });
const near = (actual: number | null, expected: number, eps = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

// ---------- weight ----------

test('weight per metre: (π/4) × d² × 7850 / 1,000,000 — Ø12 ≈ 0.888, Ø16 ≈ 1.578, Ø20 ≈ 2.466', () => {
  near(rebarWeightPerMeterKg(12), 0.8878, 1e-4);
  near(rebarWeightPerMeterKg(16), 1.5783, 1e-4);
  near(rebarWeightPerMeterKg(20), 2.4661, 1e-4);
  near(rebarWeightPerMeterKg(12), (Math.PI / 4) * 144 * 7850 / 1e6, 1e-12); // the exact formula, unit conversion included
  assert.equal(rebarWeightPerMeterKg(0), null);
  assert.equal(rebarWeightPerMeterKg(-12), null);
  assert.equal(rebarWeightPerMeterKg(NaN), null);
  assert.equal(rebarWeightPerMeterKg(undefined), null);
});

// ---------- count rule ----------

test('count = ceil(span / spacing) + 1, with bars on both edges', () => {
  assert.equal(barCountForSpan(8, 0.2), 41); // exact multiple: 40 gaps → 41 bars
  assert.equal(barCountForSpan(8.01, 0.2), 42); // a hair over a multiple: one more
  assert.equal(barCountForSpan(7.99, 0.2), 41);
  assert.equal(barCountForSpan(0.1, 0.2), 2); // span under the spacing still needs both edges
  assert.equal(barCountForSpan(1.2, 0.4), 4); // 1.2 / 0.4 = 3.0000000000000004 in floating point: still 3 gaps
  assert.equal(barCountForSpan(0.6, 0.2), 4); // 0.6 / 0.2 = 2.9999999999999996
  assert.equal(barCountForSpan(0, 0.2), null);
  assert.equal(barCountForSpan(8, 0), null);
});

// ---------- rectangles ----------

test('rectangle, exact division, bars along the long side: 41 bars of 10 m', () => {
  const c = calculateRebar(mesh([layer({ direction: 'long', spacingM: 0.2 })]), CAL);
  assert.equal(c.status, 'ok');
  const l = c.layers[0];
  assert.equal(l.barCount, 41); // 8 m / 0.2 = 40 → +1
  near(l.cutLengthM, 10);
  near(l.totalLengthM, 410);
  assert.equal(l.estimated, false);
  near(c.totalLengthM, 410);
  near(c.weightKg, 410 * rebarWeightPerMeterKg(12)!);
});

test('rectangle, span just over a spacing multiple, gets one more bar', () => {
  // short side 8.01 m at 0.2 m maximum spacing
  const c = calculateRebar(mesh([layer({ direction: 'long' })], { points: rect(1000, 801) }), CAL);
  assert.equal(c.layers[0].barCount, 42);
  near(c.layers[0].totalLengthM, 420);
});

test('direction short: bars of the short length spread along the long side', () => {
  const c = calculateRebar(mesh([layer({ direction: 'short', spacingM: 0.2 })]), CAL);
  const l = c.layers[0];
  assert.equal(l.barCount, 51); // 10 m / 0.2 = 50 → +1
  near(l.cutLengthM, 8);
  near(l.totalLengthM, 408);
});

test('a rotated rectangle gives the same quantities as the unrotated one, in both directions', () => {
  for (const direction of ['long', 'short'] as const) {
    const flat = calculateRebar(mesh([layer({ direction, spacingM: 0.15 })]), CAL);
    const turned = calculateRebar(mesh([layer({ direction, spacingM: 0.15 })], { points: rotate(rect(1000, 800), 37) }), CAL);
    assert.equal(turned.layers[0].barCount, flat.layers[0].barCount);
    near(turned.layers[0].cutLengthM, flat.layers[0].cutLengthM!, 1e-6);
    near(turned.totalLengthM, flat.totalLengthM!, 1e-5);
  }
});

test('a drawn rectangle is the same whichever corner it starts from', () => {
  const pts = rect(1000, 800);
  const shifted = [pts[2], pts[3], pts[0], pts[1]];
  assert.equal(calculateRebar(mesh([layer()], { points: shifted }), CAL).totalLengthM, calculateRebar(mesh([layer()]), CAL).totalLengthM);
});

test('a square: both directions give identical quantities', () => {
  const sq = (direction: 'long' | 'short') => calculateRebar(mesh([layer({ direction, spacingM: 0.25 })], { points: rect(500, 500) }), CAL);
  const a = sq('long');
  const b = sq('short');
  assert.equal(a.layers[0].barCount, 21); // 5 / 0.25 = 20 → +1
  near(a.layers[0].cutLengthM, 5);
  near(a.totalLengthM, 105);
  assert.equal(b.layers[0].barCount, a.layers[0].barCount);
  near(b.totalLengthM, a.totalLengthM!);
});

// ---------- irregular ----------

test('an irregular polygon is an area / spacing estimate: no bar count, no cut length, flagged', () => {
  const c = calculateRebar(mesh([layer({ spacingM: 0.15, diameterMm: 12 })], { points: L_SHAPE }), CAL);
  assert.equal(c.status, 'ok');
  const l = c.layers[0];
  assert.equal(l.estimated, true);
  assert.equal(l.barCount, null);
  assert.equal(l.cutLengthM, null);
  near(l.totalLengthM, 27 / 0.15, 1e-9); // 180 m
  near(l.weightKg, 180 * rebarWeightPerMeterKg(12)!);
  assert.equal(c.estimated, true);
  // direction does not change an estimate
  const other = calculateRebar(mesh([layer({ spacingM: 0.15, direction: 'short' })], { points: L_SHAPE }), CAL);
  near(other.totalLengthM, 180);
});

test('a near-rectangle (a trapezoid) is an estimate too, never an exact count', () => {
  const trap: Point[] = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }];
  const c = calculateRebar(mesh([layer()], { points: trap }), CAL);
  assert.equal(c.estimated, true);
  assert.equal(c.layers[0].barCount, null);
});

test('a mix of exact and estimated layers: totals add, the item is flagged estimated only when needed', () => {
  assert.equal(calculateRebar(mesh([layer(), layer({ direction: 'short' })]), CAL).estimated, false);
  assert.equal(calculateRebar(mesh([layer(), layer({ direction: 'short' })], { points: L_SHAPE }), CAL).estimated, true);
});

// ---------- not calculable ----------

test('an uncalibrated mesh zone is not calculable: null, never zero', () => {
  const c = calculateRebar(mesh([layer()]), null);
  assert.equal(c.status, 'no-scale');
  assert.equal(c.totalLengthM, null);
  assert.equal(c.weightKg, null);
  assert.equal(c.orderLengthM, null);
  assert.equal(c.layers[0].totalLengthM, null);
  assert.equal(c.layers[0].valid, true); // the layer itself is fine; the zone is what is unknown
  assert.equal(calculateRebar(mesh([layer()]), { pixelDistance: 0, realDistanceMeters: 0, metersPerPixel: 0 }).status, 'no-scale');
});

test('a manual size replaces the outline, works without a scale, and a half-filled one is missing-size', () => {
  // 6 m × 4 m by hand: bars along the long side, spread across 4 m at 0.25 → 17 bars of 6 m
  const ok = calculateRebar(mesh([layer({ spacingM: 0.25 })], { points: [], sizeOverride: { lengthM: 6, widthM: 4 } }), null);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.layers[0].barCount, 17);
  near(ok.totalLengthM, 102);
  assert.equal(ok.estimated, false); // a manual size is a rectangle: exact

  // it wins over a differently sized outline on a calibrated page
  near(calculateRebar(mesh([layer({ spacingM: 0.25 })], { sizeOverride: { lengthM: 6, widthM: 4 } }), CAL).totalLengthM, 102);
  // an override on an irregular outline makes it a rectangle too
  assert.equal(calculateRebar(mesh([layer()], { points: L_SHAPE, sizeOverride: { lengthM: 6, widthM: 4 } }), CAL).estimated, false);

  const half = calculateRebar(mesh([layer()], { sizeOverride: { lengthM: 6, widthM: 0 } }), CAL);
  assert.equal(half.status, 'missing-size'); // not the outline's numbers
  assert.equal(half.totalLengthM, null);
});

test('no layers, or an unusable layer, is not calculable — and the good layers are still reported', () => {
  const none = calculateRebar(mesh([]), CAL);
  assert.equal(none.status, 'no-layers');
  assert.equal(none.totalLengthM, null);

  for (const bad of [{ spacingM: 0 }, { spacingM: -0.2 }, { spacingM: NaN }, { diameterMm: 0 }, { diameterMm: -12 }, { diameterMm: NaN }]) {
    const c = calculateRebar(mesh([layer(), layer(bad)]), CAL);
    assert.equal(c.status, 'invalid-input');
    assert.equal(c.totalLengthM, null); // no partial total
    assert.equal(c.layers[0].valid, true);
    near(c.layers[0].totalLengthM, 410); // the good layer is still shown
    assert.equal(c.layers[1].valid, false);
    assert.equal(c.layers[1].totalLengthM, null);
  }
});

test('a no-scale item is reported before a layer problem', () => {
  assert.equal(calculateRebar(mesh([layer({ spacingM: 0 })]), null).status, 'no-scale');
});

// ---------- multiple layers and waste ----------

test('several layers add up, each with its own diameter, spacing and direction', () => {
  const c = calculateRebar(mesh([
    layer({ diameterMm: 12, spacingM: 0.2, direction: 'long' }), // 41 × 10 = 410 m
    layer({ diameterMm: 10, spacingM: 0.25, direction: 'short' }), // (10/0.25 = 40 → 41) × 8 = 328 m
  ]), CAL);
  assert.equal(c.status, 'ok');
  assert.equal(c.layers.length, 2);
  near(c.layers[0].totalLengthM, 410);
  near(c.layers[1].totalLengthM, 328);
  near(c.totalLengthM, 738);
  near(c.weightKg, 410 * rebarWeightPerMeterKg(12)! + 328 * rebarWeightPerMeterKg(10)!);
  assert.deepEqual(c.layers.map((l) => l.diameterMm), [12, 10]);
});

test('waste applies to the totals (length and weight) and not to the per-layer net values', () => {
  const c = calculateRebar(mesh([layer()], { wastePercent: 5 }), CAL);
  near(c.totalLengthM, 410);
  near(c.orderLengthM, 430.5);
  near(c.orderWeightKg, c.weightKg! * 1.05);
  near(c.layers[0].totalLengthM, 410);
  assert.equal(c.wastePercent, 5);
});

test('unusable waste falls back to 0; a zero waste is a real zero', () => {
  for (const wastePercent of [NaN, -10, undefined]) {
    const c = calculateRebar(mesh([layer()], { wastePercent }), CAL);
    assert.equal(c.wastePercent, 0);
    near(c.orderLengthM, 410);
  }
});

// ---------- manual bars ----------

test('manual bars: count × length, weight by diameter, waste', () => {
  const c = calculateRebar(bars({ diameterMm: 16, count: 10, lengthM: 6, wastePercent: 10 }), null); // needs no scale
  assert.equal(c.status, 'ok');
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].barCount, 10);
  near(c.layers[0].cutLengthM, 6);
  near(c.totalLengthM, 60);
  near(c.weightKg, 60 * rebarWeightPerMeterKg(16)!);
  near(c.orderLengthM, 66);
  near(c.orderWeightKg, 66 * rebarWeightPerMeterKg(16)!);
  assert.equal(c.estimated, false);
  near(calculateRebar(bars({ diameterMm: 20, count: 4, lengthM: 12 }), null).weightKg, 48 * 2.4661, 1e-2);
});

test('manual bars: zero bars is a real zero; a missing, negative or NaN input is not calculable', () => {
  const zero = calculateRebar(bars({ count: 0 }), null);
  assert.equal(zero.status, 'ok');
  assert.equal(zero.totalLengthM, 0);
  assert.equal(zero.weightKg, 0);

  for (const bad of [{ count: NaN }, { count: -3 }, { count: undefined as unknown as number }, { lengthM: 0 }, { lengthM: -1 }, { lengthM: NaN }, { diameterMm: 0 }, { diameterMm: NaN }]) {
    const c = calculateRebar(bars(bad), null);
    assert.equal(c.status, 'invalid-input');
    assert.equal(c.totalLengthM, null);
    assert.equal(c.weightKg, null);
    assert.equal(c.orderLengthM, null);
  }
});

// ---------- purity ----------

test('calculation does not mutate its input and is repeatable', () => {
  const item = mesh([layer(), layer({ direction: 'short' })], { wastePercent: 3 });
  const before = JSON.stringify(item);
  assert.deepEqual(calculateRebar(item, CAL), calculateRebar(item, CAL));
  assert.equal(JSON.stringify(item), before);
});
