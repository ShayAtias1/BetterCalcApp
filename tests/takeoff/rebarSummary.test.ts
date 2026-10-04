import { resolveMeshProcurement } from '../../src/lib/meshSheets.ts';
// Rebar summary: grouped by page and diameter from the engine's own output; mesh layers and manual
// bars add into the same diameter; estimates are flagged, never hidden; items that cannot be
// calculated are counted as missing and never as zero. Scale: page 1 and 2 are 1 px = 1 cm; page 3
// has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { buildRebarSummary } from '../../src/lib/structuralQuantities.ts';
import { calculateRebar, rebarWeightPerMeterKg } from '../../src/lib/rebar.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { RebarBars, RebarItem, RebarLayer, RebarMesh } from '../../src/types/structural.ts';

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }]; // 27 m²

let n = 0;
const layer = (extra: Partial<RebarLayer> = {}): RebarLayer => ({ id: `l${n++}`, diameterMm: 12, spacingM: 0.2, direction: 'long', ...extra });
const mesh = (layers: RebarLayer[], extra: Partial<RebarMesh> = {}): RebarMesh => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: `M${n}`, points: rect(1000, 800), layers, wastePercent: 0, ...extra });
const bars = (extra: Partial<RebarBars> = {}): RebarBars => ({ id: `b${n++}`, kind: 'bars', pageNumber: 1, mark: `R${n}`, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 0, ...extra });
const planWith = (items?: RebarItem[]): Plan => {
  const p = structuredClone(PLAN_A);
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  if (items) p.rebarItems = items;
  else delete p.rebarItems;
  return p;
};
const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(typeof a === 'number' && Math.abs(a - b) < eps, `${a} vs ${b}`);
const W12 = rebarWeightPerMeterKg(12)!;
const W16 = rebarWeightPerMeterKg(16)!;
const W10 = rebarWeightPerMeterKg(10)!;

test('empty plan, and a plan saved before rebar existed: nothing, no basis', () => {
  for (const p of [planWith(undefined), planWith([])]) {
    assert.deepEqual(buildRebarSummary(p), {
      pages: [], itemCount: 0, missingItemCount: 0, incompleteSpecCount: 0, lengthM: 0, weightKg: 0, orderLengthM: 0, orderWeightKg: 0,
      estimatedLengthM: 0, estimatedWeightKg: 0, basis: null,
    });
  }
});

test('one mesh, two layers of different diameters: one row per diameter, ascending, from the engine', () => {
  const m = mesh([layer({ diameterMm: 12, spacingM: 0.2, direction: 'long' }), layer({ diameterMm: 10, spacingM: 0.25, direction: 'short' })]);
  const s = buildRebarSummary(planWith([m]));
  assert.equal(s.pages.length, 1);
  const [r10, r12] = s.pages[0].rows;
  assert.equal(r10.diameterMm, 10);
  assert.equal(r12.diameterMm, 12);
  near(r12.lengthM, 410); // 41 × 10 m
  near(r10.lengthM, 328); // 41 × 8 m
  near(r12.weightKg, 410 * W12, 0.005);
  near(r10.weightKg, 328 * W10, 0.005);
  // identical to what the engine says for the item
  const calc = calculateRebar(m, cal);
  near(s.lengthM, calc.totalLengthM!);
  near(s.weightKg, calc.weightKg!, 0.005);
  assert.equal(s.basis, 'exact');
});

test('the same diameter across several meshes, layers and manual bars adds into one row', () => {
  const s = buildRebarSummary(planWith([
    mesh([layer({ diameterMm: 12, direction: 'long' }), layer({ diameterMm: 12, direction: 'short' })]), // 410 + 408
    mesh([layer({ diameterMm: 12 })], { points: rect(500, 400) }), // 5 m × 4 m, long: 21 bars × 5 = 105
    bars({ diameterMm: 12, count: 4, lengthM: 3 }), // 12
    bars({ diameterMm: 16, count: 10, lengthM: 6 }), // 60
  ]));
  const [r12, r16] = s.pages[0].rows;
  assert.equal(r12.lineCount, 4);
  near(r12.lengthM, 410 + 408 + 105 + 12);
  assert.equal(r16.lineCount, 1);
  near(r16.lengthM, 60);
  near(r16.weightKg, 60 * W16, 0.005);
  assert.equal(s.itemCount, 4);
});

test('net engineering quantities agree by diameter while Mesh procurement uses full sheets', () => {
  const viaMesh = buildRebarSummary(planWith([mesh([layer({ diameterMm: 16, spacingM: 0.2 })], { points: [], sizeOverride: { lengthM: 6, widthM: 2 } })])); // 11 bars × 6 m = 66
  const viaBars = buildRebarSummary(planWith([bars({ diameterMm: 16, count: 11, lengthM: 6 })]));
  const values = (s: ReturnType<typeof buildRebarSummary>) => s.pages[0].rows.map((r) => ({ ...r, lineCount: 0, orderWeightKg: 0 }));
  assert.deepEqual(values(viaMesh), values(viaBars));
});

test('waste still applies to Bars and internal order length; Mesh purchase weight uses full sheets', () => {
  const item = mesh([layer({ diameterMm: 12 })], { wastePercent: 5 });
  const p = planWith([
    item, // 410 m
    bars({ diameterMm: 12, count: 10, lengthM: 6, wastePercent: 10 }), // 60 m
  ]);
  const s = buildRebarSummary(p);
  const r = s.pages[0].rows[0];
  near(r.lengthM, 470);
  near(r.orderLengthM, 410 * 1.05 + 60 * 1.1); // 430.5 + 66
  near(r.orderWeightKg, resolveMeshProcurement(item, p.pages[item.pageNumber]?.calibration ?? null).procurementWeightKg! + 60 * 1.1 * W12, 0.005);
  near(s.orderLengthM, 496.5);
});

test('pages are never merged and are sorted; page then diameter', () => {
  const s = buildRebarSummary(planWith([
    bars({ pageNumber: 2, diameterMm: 20, count: 1, lengthM: 1 }),
    bars({ pageNumber: 1, diameterMm: 25, count: 1, lengthM: 1 }),
    bars({ pageNumber: 2, diameterMm: 8, count: 1, lengthM: 1 }),
    bars({ pageNumber: 1, diameterMm: 8, count: 1, lengthM: 1 }),
    bars({ pageNumber: 1, diameterMm: 8, count: 2, lengthM: 1 }),
  ]));
  assert.deepEqual(s.pages.map((p) => p.pageNumber), [1, 2]);
  assert.deepEqual(s.pages.flatMap((p) => p.rows.map((r) => `${r.pageNumber}:${r.diameterMm}:${r.lengthM}`)), ['1:8:3', '1:25:1', '2:8:1', '2:20:1']);
});

test('estimated layers are flagged: exact + estimated is "mixed" with the estimated part shown; estimates alone are "estimated"', () => {
  // exact: 41 × 10 = 410 m; estimated: 27 m² / 0.2 = 135 m, same diameter
  const mixed = buildRebarSummary(planWith([mesh([layer({ diameterMm: 12 })]), mesh([layer({ diameterMm: 12 })], { points: L_SHAPE })]));
  const r = mixed.pages[0].rows[0];
  assert.equal(r.basis, 'mixed');
  near(r.lengthM, 545);
  near(r.estimatedLengthM, 135);
  near(r.estimatedWeightKg, 135 * W12, 0.005);
  assert.equal(mixed.basis, 'mixed');
  near(mixed.estimatedLengthM, 135);

  const only = buildRebarSummary(planWith([mesh([layer({ diameterMm: 12 })], { points: L_SHAPE })]));
  assert.equal(only.pages[0].rows[0].basis, 'estimated');
  near(only.pages[0].rows[0].estimatedLengthM, 135);
  assert.equal(only.basis, 'estimated');

  // an estimate on one diameter does not taint another diameter's row
  const split = buildRebarSummary(planWith([mesh([layer({ diameterMm: 12 })], { points: L_SHAPE }), bars({ diameterMm: 16 })]));
  assert.deepEqual(split.pages[0].rows.map((x) => [x.diameterMm, x.basis]), [[12, 'estimated'], [16, 'exact']]);
  assert.equal(split.basis, 'mixed');
  assert.equal(buildRebarSummary(planWith([bars()])).pages[0].rows[0].basis, 'exact');
});

test('not-calculable items are counted as missing and never as zero or in a total', () => {
  const good = bars({ diameterMm: 16, count: 10, lengthM: 6 }); // 60 m
  const noScale = mesh([layer({ diameterMm: 12 })], { pageNumber: 3 }); // page without scale
  const noLayers = mesh([], {});
  const badLayer = mesh([layer({ diameterMm: 12 }), layer({ diameterMm: 0 }), layer({ spacingM: 0 })]); // two incomplete layers
  const badBars = bars({ diameterMm: 10, count: NaN });
  const halfSize = mesh([layer()], { sizeOverride: { lengthM: 4, widthM: 0 } });
  const s = buildRebarSummary(planWith([good, noScale, noLayers, badLayer, badBars, halfSize]));

  assert.equal(s.itemCount, 6);
  assert.equal(s.missingItemCount, 5);
  assert.equal(s.incompleteSpecCount, 2);
  near(s.lengthM, 60);
  near(s.weightKg, 60 * W16, 0.005);
  assert.deepEqual(s.pages.find((p) => p.pageNumber === 1)!.rows.map((r) => r.diameterMm), [16]); // none of the missing items made a row
  // missing items are reported on their own page, a page with only missing items still appears
  const p3 = s.pages.find((p) => p.pageNumber === 3)!;
  assert.equal(p3.rows.length, 0);
  assert.equal(p3.missingItemCount, 1);
  assert.equal(s.pages.find((p) => p.pageNumber === 1)!.missingItemCount, 4);
});

test('nothing calculable: totals are 0 with no basis, and every item is missing', () => {
  const s = buildRebarSummary(planWith([mesh([layer()], { pageNumber: 3 }), bars({ count: NaN })]));
  assert.equal(s.basis, null);
  assert.equal(s.missingItemCount, 2);
  assert.equal(s.lengthM, 0);
  assert.equal(s.pages.every((p) => p.rows.length === 0), true);
});

test('a real zero (zero manual bars) is calculable and is not missing', () => {
  const s = buildRebarSummary(planWith([bars({ count: 0 })]));
  assert.equal(s.missingItemCount, 0);
  assert.equal(s.pages[0].rows[0].lengthM, 0);
  assert.equal(s.basis, 'exact');
});

test('manual bars and a manual-size mesh are calculable on a page without a scale', () => {
  const s = buildRebarSummary(planWith([
    bars({ pageNumber: 3, diameterMm: 12, count: 5, lengthM: 2 }),
    mesh([layer({ diameterMm: 12, spacingM: 0.25 })], { pageNumber: 3, points: [], sizeOverride: { lengthM: 6, widthM: 4 } }), // 17 × 6 = 102
  ]));
  assert.equal(s.missingItemCount, 0);
  near(s.pages[0].rows[0].lengthM, 112);
});

test('rounding happens once, after summing unrounded values', () => {
  // 3 rows of 0.004 m: each would round to 0.00, the sum 0.012 rounds to 0.01
  const tiny = [1, 2, 3].map(() => bars({ diameterMm: 12, count: 1, lengthM: 0.004 }));
  const s = buildRebarSummary(planWith(tiny));
  assert.equal(s.pages[0].rows[0].lengthM, 0.01);
  assert.equal(s.lengthM, 0.01);
  // order values are summed from unrounded numbers too: 3 × 0.004 × 1.5
  const waste = buildRebarSummary(planWith([1, 2, 3].map(() => bars({ diameterMm: 12, count: 1, lengthM: 0.004, wastePercent: 50 }))));
  assert.equal(waste.pages[0].rows[0].orderLengthM, 0.02); // 0.018 → 0.02, not 3 × round(0.006) = 0.03
});

test('pure: independent of persistence — the same plan after a clone gives the same summary, and the plan is not mutated', () => {
  const plan = planWith([mesh([layer(), layer({ diameterMm: 10, direction: 'short' })], { wastePercent: 3 }), bars()]);
  const before = JSON.stringify(plan);
  const a = buildRebarSummary(plan);
  assert.deepEqual(a, buildRebarSummary(structuredClone(plan)));
  assert.deepEqual(a, buildRebarSummary(JSON.parse(JSON.stringify(plan)) as Plan));
  assert.equal(JSON.stringify(plan), before);
});
