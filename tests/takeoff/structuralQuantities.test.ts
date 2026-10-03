// Concrete summary: grouping by page / kind / grade, totals with waste, and not-calculable elements
// counted but never added as zero. Scale: page 1 and 2 are 1 px = 1 cm; page 3 has no scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { buildConcreteSummary } from '../../src/lib/structuralQuantities.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { ConcreteElement } from '../../src/types/structural.ts';

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

let n = 0;
const el = (extra: Partial<ConcreteElement>): ConcreteElement => ({
  id: `e${n++}`, pageNumber: 1, kind: 'slab', mark: `M${n}`, points: rect(1000, 800), depthM: 0.2, wastePercent: 0, ...extra,
});

const planWith = (elements: ConcreteElement[] | undefined): Plan => {
  const base = structuredClone(PLAN_A);
  base.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  if (elements) base.concreteElements = elements;
  else delete base.concreteElements;
  return base;
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('an empty plan, and a plan saved before concrete existed, summarise to nothing', () => {
  for (const plan of [planWith(undefined), planWith([])]) {
    const s = buildConcreteSummary(plan);
    assert.deepEqual(s, { rows: [], elementCount: 0, missingCount: 0, volumeM3: 0, orderM3: 0 });
  }
});

test('the same kind and grade across several elements is one row that adds up, waste included', () => {
  // 80 m² × 0.2 = 16 m³ (+5% = 16.8); 10 m² × 0.3 = 3 m³ (+10% = 3.3)
  const s = buildConcreteSummary(planWith([
    el({ grade: 'B30', depthM: 0.2, wastePercent: 5 }),
    el({ grade: 'B30', points: rect(1000, 100), depthM: 0.3, wastePercent: 10 }),
  ]));
  assert.equal(s.rows.length, 1);
  assert.deepEqual(s.rows[0], { pageNumber: 1, kind: 'slab', grade: 'B30', elementCount: 2, missingCount: 0, volumeM3: 19, orderM3: 20.1 });
  assert.equal(s.volumeM3, 19);
  assert.equal(s.orderM3, 20.1);
  assert.equal(s.elementCount, 2);
});

test('different kinds and different grades are different rows; the grade is the user\'s text, trimmed', () => {
  const s = buildConcreteSummary(planWith([
    el({ kind: 'slab', grade: 'B30' }),
    el({ kind: 'slab', grade: '  B30 ' }), // same grade once trimmed
    el({ kind: 'slab', grade: 'B40' }),
    el({ kind: 'slab', grade: 'b30' }), // compared exactly: not the same as B30
    el({ kind: 'wall', grade: 'B30', points: rect(500, 20), depthM: 3 }),
    el({ kind: 'slab' }), // unspecified
    el({ kind: 'slab', grade: '   ' }), // blank = unspecified
  ]));
  const key = (r: (typeof s.rows)[number]) => `${r.kind}/${r.grade || '-'}/${r.elementCount}`;
  assert.deepEqual(s.rows.map(key), ['slab/B30/2', 'slab/B40/1', 'slab/b30/1', 'slab/-/2', 'wall/B30/1']);
});

test('rows sort by page, then kind, then grade with unspecified last — and pages are never merged', () => {
  const s = buildConcreteSummary(planWith([
    el({ pageNumber: 2, kind: 'slab', grade: 'B30' }),
    el({ pageNumber: 1, kind: 'column', points: rect(40, 40), depthM: 3 }),
    el({ pageNumber: 1, kind: 'beam', points: rect(600, 30), depthM: 0.5 }),
    el({ pageNumber: 1, kind: 'slab' }),
    el({ pageNumber: 1, kind: 'slab', grade: 'B30' }),
    el({ pageNumber: 1, kind: 'wall', points: rect(500, 20), depthM: 3 }),
  ]));
  assert.deepEqual(s.rows.map((r) => `${r.pageNumber}:${r.kind}:${r.grade || '-'}`), [
    '1:slab:B30', '1:slab:-', '1:wall:-', '1:beam:-', '1:column:-', '2:slab:B30',
  ]);
});

test('hand-checked volumes for every kind', () => {
  const s = buildConcreteSummary(planWith([
    el({ kind: 'slab', depthM: 0.2 }), // 16
    el({ kind: 'wall', points: rect(500, 20), depthM: 3 }), // 3
    el({ kind: 'beam', points: rect(600, 30), depthM: 0.5 }), // 0.9
    el({ kind: 'column', points: rect(40, 40), depthM: 3, quantity: 4 }), // 1.92
  ]));
  near(s.volumeM3, 21.82);
  assert.equal(s.rows.length, 4);
});

test('manual-size elements count on an uncalibrated page', () => {
  const s = buildConcreteSummary(planWith([
    el({ pageNumber: 3, kind: 'column', points: [], sizeOverride: { lengthM: 0.4, widthM: 0.4 }, depthM: 3, quantity: 4, grade: 'B30' }),
  ]));
  assert.equal(s.missingCount, 0);
  assert.equal(s.rows[0].volumeM3, 1.92);
  assert.equal(s.volumeM3, 1.92);
});

test('not-calculable elements are counted and flagged, never added as zero', () => {
  const s = buildConcreteSummary(planWith([
    el({ grade: 'B30' }), // 16 m³
    el({ grade: 'B30', depthM: undefined }), // missing thickness
    el({ grade: 'B30', pageNumber: 3 }), // page without a scale
    el({ grade: 'B30', sizeOverride: { lengthM: 2, widthM: 0 } }), // half-filled manual size
    el({ kind: 'beam', points: rect(600, 30), depthM: undefined }), // a row with nothing calculable
  ]));
  assert.equal(s.elementCount, 5);
  assert.equal(s.missingCount, 4);
  assert.equal(s.volumeM3, 16);
  assert.equal(s.orderM3, 16);

  const slab = s.rows.find((r) => r.pageNumber === 1 && r.kind === 'slab')!;
  assert.deepEqual([slab.elementCount, slab.missingCount, slab.volumeM3], [3, 2, 16]);
  const beam = s.rows.find((r) => r.kind === 'beam')!;
  assert.deepEqual([beam.elementCount, beam.missingCount, beam.volumeM3], [1, 1, 0]); // consumers tell "0" from "nothing calculable" by missingCount === elementCount
  const page3 = s.rows.find((r) => r.pageNumber === 3)!;
  assert.deepEqual([page3.elementCount, page3.missingCount], [1, 1]);
});

test('the summary does not change when the plan is not touched, and never mutates it', () => {
  const plan = planWith([el({ grade: 'B30' }), el({ kind: 'wall', points: rect(500, 20), depthM: 3 })]);
  const before = JSON.stringify(plan);
  const a = buildConcreteSummary(plan);
  const b = buildConcreteSummary(plan);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(plan), before);
});
