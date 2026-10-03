// Rebar mesh levels: Bottom / Top, uniform / directional — how old data is read, what the engine
// is fed, what the summaries, rows, Excel and PDF say, and that none of it changes a quantity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { PLAN_A } from './fixtures.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { meshLayers, normalizeMesh } from '../../src/lib/rebarMesh.ts';
import { rebarOf } from '../../src/lib/structuralPlan.ts';
import { buildProjectStructural, buildRebarItems, buildRebarLevelRows, buildRebarSummary, buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import { buildStructuralPdfLayout } from '../../src/lib/structuralPdfLayout.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { MeshReinforcement, RebarLayer, RebarMesh } from '../../src/types/structural.ts';

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
const near = (a: unknown, b: number, eps = 1e-9) => assert.ok(typeof a === 'number' && Math.abs(a - b) < eps, `${String(a)} vs ${b}`);

let n = 0;
const uniform = (diameterMm: number, spacingM: number): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm, spacingM } });
const directional = (long?: [number, number], short?: [number, number]): MeshReinforcement => ({
  mode: 'directional',
  ...(long ? { long: { diameterMm: long[0], spacingM: long[1] } } : {}),
  ...(short ? { short: { diameterMm: short[0], spacingM: short[1] } } : {}),
});
/** A 10 × 8 m mesh zone (rectangle). */
const mesh = (extra: Partial<RebarMesh>): RebarMesh => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: '', autoNumber: n, points: rect(1000, 800), wastePercent: 0, ...extra });
const oldLayer = (diameterMm: number, spacingM: number, direction: 'long' | 'short'): RebarLayer => ({ id: `l${n++}`, diameterMm, spacingM, direction });
const planWith = (items: RebarMesh[]): Plan => {
  const p = structuredClone(PLAN_A);
  p.rooms = [];
  p.measurements = [];
  p.markups = [];
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: null } };
  p.rebarItems = items;
  return p;
};
const calc = (m: RebarMesh) => calculateRebar(m, cal);

// Rectangle 10 × 8 m: along the long side bars are 10 m and spread across 8 m; along the short side 8 m across 10 m.
const LONG_200 = 41 * 10; // 8 / 0.2 = 40 → 41 bars × 10 m
const SHORT_200 = 51 * 8; // 10 / 0.2 = 50 → 51 bars × 8 m

// ---------- how old data is read ----------

test('old meshes: every layer was Bottom; the reading is fixed and never changes a quantity', () => {
  const read = (layers: RebarLayer[]) => normalizeMesh(mesh({ layers }));

  // no layers → no level at all
  assert.equal(read([]).bottom, undefined);
  assert.equal(read([]).top, undefined);
  assert.equal(calc(read([])).status, 'no-layers');

  // long + short with the same diameter and spacing → uniform
  assert.deepEqual(read([oldLayer(12, 0.2, 'long'), oldLayer(12, 0.2, 'short')]).bottom, uniform(12, 0.2));
  // different diameter or spacing → directional, each side its own
  assert.deepEqual(read([oldLayer(12, 0.2, 'long'), oldLayer(10, 0.15, 'short')]).bottom, directional([12, 0.2], [10, 0.15]));
  assert.deepEqual(read([oldLayer(12, 0.2, 'long'), oldLayer(12, 0.15, 'short')]).bottom, directional([12, 0.2], [12, 0.15]));
  // a single layer: only that direction (the old mesh never had the other)
  assert.deepEqual(read([oldLayer(12, 0.2, 'short')]).bottom, directional(undefined, [12, 0.2]));
  assert.deepEqual(read([oldLayer(12, 0.2, 'long')]).bottom, directional([12, 0.2]));
  // an incomplete pair is not "equal": it stays directional so nothing is invented
  assert.deepEqual(read([oldLayer(0, 0, 'long'), oldLayer(0, 0, 'short')]).bottom, directional([0, 0], [0, 0]));
  // two layers in one direction: the first is the side, the second is kept as an extra and still counts
  const twice = read([oldLayer(12, 0.2, 'long'), oldLayer(10, 0.25, 'long')]);
  assert.equal(twice.bottom?.mode, 'directional');
  assert.equal((twice.bottom as { extra: RebarLayer[] }).extra.length, 1);
  near(calc(twice).totalLengthM, LONG_200 + 33 * 10); // 8 / 0.25 = 32 → 33 bars × 10 m
  // the old key is gone, there is no Top, and the other fields are kept
  const m = mesh({ layers: [oldLayer(12, 0.2, 'long')], wastePercent: 5 });
  const r = normalizeMesh(m);
  assert.equal('layers' in r, false);
  assert.equal(r.top, undefined);
  assert.equal(r.wastePercent, 5);
  assert.equal(r.id, m.id);
});

test('old and new meshes calculate identically', () => {
  const legacy = mesh({ layers: [oldLayer(12, 0.2, 'long'), oldLayer(10, 0.25, 'short')] });
  const levelled = mesh({ bottom: directional([12, 0.2], [10, 0.25]) });
  const a = calc(legacy);
  const b = calc(levelled);
  assert.equal(a.status, 'ok');
  near(a.totalLengthM, LONG_200 + 41 * 8);
  assert.equal(a.totalLengthM, b.totalLengthM);
  assert.equal(a.weightKg, b.weightKg);
  assert.equal(a.orderWeightKg, b.orderWeightKg);
  // two equal layers = one uniform level
  const two = calc(mesh({ layers: [oldLayer(12, 0.2, 'long'), oldLayer(12, 0.2, 'short')] }));
  const uni = calc(mesh({ bottom: uniform(12, 0.2) }));
  near(two.totalLengthM, LONG_200 + SHORT_200);
  assert.equal(two.totalLengthM, uni.totalLengthM);
  assert.equal(two.weightKg, uni.weightKg);
});

test('reading never writes: the stored plan is untouched, and readers get stable objects', () => {
  const p = planWith([mesh({ layers: [oldLayer(12, 0.2, 'long'), oldLayer(10, 0.25, 'short')] })]);
  const before = JSON.stringify(p);
  const first = rebarOf(p);
  assert.equal(JSON.stringify(p), before);
  assert.equal(rebarOf(p), first);
  assert.equal('layers' in first[0], false);
  // an already-levelled plan is returned as it is
  const q = planWith([mesh({ bottom: uniform(12, 0.2) })]);
  assert.equal(rebarOf(q), q.rebarItems);
});

// ---------- the engine is fed by the levels ----------

test('uniform: one specification feeds BOTH directions; directional feeds each side; Top + Bottom add up', () => {
  const u = calc(mesh({ bottom: uniform(12, 0.2) }));
  assert.deepEqual(u.layers.map((l) => [l.level, l.direction, l.uniform]), [['bottom', 'long', true], ['bottom', 'short', true]]);
  near(u.totalLengthM, LONG_200 + SHORT_200);

  const d = calc(mesh({ bottom: directional([12, 0.2], [10, 0.15]) }));
  assert.deepEqual(d.layers.map((l) => [l.diameterMm, l.spacingM, l.uniform]), [[12, 0.2, false], [10, 0.15, false]]);
  near(d.totalLengthM, LONG_200 + 68 * 8); // 10 / 0.15 = 66.7 → 67 → 68 bars

  const both = calc(mesh({ bottom: uniform(12, 0.2), top: directional([10, 0.25], [10, 0.25]) }));
  assert.equal(both.status, 'ok');
  near(both.totalLengthM, LONG_200 + SHORT_200 + 33 * 10 + 41 * 8);
  assert.deepEqual([...new Set(both.layers.map((l) => l.level))], ['bottom', 'top']);
  // weight and waste are the existing maths, applied to the sum
  const withWaste = calc(mesh({ bottom: uniform(12, 0.2), top: uniform(12, 0.2), wastePercent: 10 }));
  near(withWaste.orderLengthM, 2 * (LONG_200 + SHORT_200) * 1.1, 1e-6);
  near(withWaste.weightKg, 2 * (LONG_200 + SHORT_200) * ((Math.PI / 4) * 144 * 7850) / 1e6, 1e-6);
  assert.equal(meshLayers(mesh({ bottom: uniform(12, 0.2) })).length, 2);
});

test('a non-rectangular zone stays an estimate (area ÷ spacing) per direction, whichever level', () => {
  const c = calc(mesh({ points: L_SHAPE, bottom: uniform(12, 0.15), top: directional([10, 0.2]) }));
  assert.equal(c.estimated, true);
  assert.deepEqual(c.layers.map((l) => l.barCount), [null, null, null]);
  near(c.totalLengthM, 27 / 0.15 + 27 / 0.15 + 27 / 0.2); // area 27 m² per direction
});

test('an enabled level that is incomplete makes the item incomplete — never a partial total; a level not enabled does not', () => {
  const ok = calc(mesh({ bottom: uniform(12, 0.2) }));
  assert.equal(ok.status, 'ok');
  const topEmpty = calc(mesh({ bottom: uniform(12, 0.2), top: uniform(0, 0) }));
  assert.equal(topEmpty.status, 'invalid-input');
  assert.equal(topEmpty.totalLengthM, null);
  assert.equal(topEmpty.weightKg, null);
  const half = calc(mesh({ bottom: uniform(12, 0.2), top: directional([10, 0.25], [0, 0]) }));
  assert.equal(half.status, 'invalid-input');
  assert.equal(half.totalLengthM, null);
  assert.equal(calc(mesh({ top: uniform(10, 0.2) })).status, 'ok'); // Top alone is fine
});

// ---------- summaries stay by diameter, with the levels merged into the totals ----------

test('summary by diameter: Top and Bottom both contribute; the level stays in the item rows', () => {
  const p = planWith([mesh({ bottom: uniform(12, 0.2), top: directional([12, 0.2], [10, 0.25]) })]);
  const s = buildRebarSummary(p);
  const rows = s.pages[0].rows;
  assert.deepEqual(rows.map((r) => r.diameterMm), [10, 12]);
  const d12 = rows.find((r) => r.diameterMm === 12)!;
  near(d12.lengthM, 2 * LONG_200 + SHORT_200);
  near(rows.find((r) => r.diameterMm === 10)!.lengthM, 41 * 8);

  const items = buildRebarItems(p);
  assert.deepEqual(items.map((r) => [r.level, r.direction]), [['bottom', 'both'], ['top', 'long'], ['top', 'short']]);
});

test('an incomplete enabled level is counted once per specification, and the item is excluded from totals', () => {
  const p = planWith([mesh({ bottom: uniform(12, 0.2), top: uniform(0, 0) }), mesh({ bottom: uniform(16, 0.2) })]);
  const s = buildRebarSummary(p);
  assert.equal(s.missingItemCount, 1);
  assert.equal(s.incompleteSpecCount, 1); // the uniform Top is one entry, not two directions
  assert.deepEqual(s.pages[0].rows.map((r) => r.diameterMm), [16]); // the complete mesh only
});

test('project totals aggregate by diameter across levels and plans', () => {
  const a = planWith([mesh({ bottom: uniform(12, 0.2), top: uniform(12, 0.2) })]);
  const b = planWith([mesh({ bottom: directional([12, 0.2], [12, 0.2]) })]);
  const project = buildProjectStructural([{ ...a, id: 'a', name: 'A' }, { ...b, id: 'b', name: 'B' }]);
  const rows = project.rebar!.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].diameterMm, 12);
  near(rows[0].lengthM, 3 * (LONG_200 + SHORT_200));
});

// ---------- item rows ----------

test('rows: a uniform level is ONE row that says "both directions"; directional keeps long / short; spacing is in cm', () => {
  const p = planWith([mesh({ bottom: uniform(12, 0.2), top: directional([12, 0.2], [10, 0.125]) })]);
  const rows = buildRebarItems(p);
  assert.equal(rows.length, 3); // Bottom (uniform: one row) + Top long + Top short
  const [b, tl, ts] = rows;
  assert.deepEqual([b.level, b.direction, b.diameterMm, b.spacingCm], ['bottom', 'both', 12, 20]);
  assert.equal(b.barCount, 41 + 51); // bars of both directions together
  assert.equal(b.barLengthM, null); // the two directions differ in length
  near(b.netLengthM, LONG_200 + SHORT_200);
  assert.deepEqual([tl.level, tl.direction, tl.spacingCm], ['top', 'long', 20]);
  assert.deepEqual([ts.level, ts.direction, ts.diameterMm, ts.spacingCm], ['top', 'short', 10, 12.5]);
  near(tl.barLengthM, 10);
});

// ---------- Excel ----------


// ---------- PDF ----------

test('PDF: Top and Bottom are separate level rows of one mark; uniform says "both directions", directional lists long and short', () => {
  const p = planWith([mesh({ autoNumber: 1, bottom: uniform(12, 0.2), top: directional([12, 0.2], [10, 0.15]) })]);
  const blocks = buildStructuralPdfLayout(buildStructuralReport(p), exportContext('en'));
  const table = blocks.filter((b) => b.type === 'table').at(-1) as Extract<(typeof blocks)[number], { type: 'table' }>;
  // Mark, level, specification: one row per level - the two directions of Top are one row.
  assert.deepEqual(table.rows.slice(0, 2).map((r) => [r.cells[2], r.cells[3], r.cells[4]]), [
    ['Mesh 01', 'Bottom', 'Ø12 @ 20 cm - Both directions'],
    ['Mesh 01', 'Top', 'Long side Ø12 @ 20 | Short side Ø10 @ 15'],
  ]);
  const he = buildStructuralPdfLayout(buildStructuralReport(p), exportContext('he'));
  const hTable = he.filter((b) => b.type === 'table').at(-1) as Extract<(typeof he)[number], { type: 'table' }>;
  assert.deepEqual([hTable.rows[0].cells[1], hTable.rows[0].cells[2], hTable.rows[0].cells[3]], ['רשת', 'רשת 01', 'תחתון']);
  assert.equal(hTable.rows[0].cells[4], 'Ø12 @ 20 ס"מ - שני הכיוונים');
  assert.equal(hTable.rows[1].cells[4], 'צלע ארוכה Ø12 @ 20 | צלע קצרה Ø10 @ 15');
});

test('every character the level texts print has a glyph in the report fonts', () => {
  const fonts = ['hebrew-400', 'latin-400', 'hebrew-700', 'latin-700'].map((name) =>
    fontkit.create(readFileSync(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${name}-normal.woff`, import.meta.url))) as { hasGlyphForCodePoint(cp: number): boolean }
  );
  const covered = (ch: string) => ch === '\n' || fonts.some((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!));
  const p = planWith([mesh({ bottom: uniform(12, 0.2), top: directional([12, 0.2], [10, 0.125]) })]);
  for (const lang of ['he', 'en'] as const) {
    const blocks = buildStructuralPdfLayout(buildStructuralReport(p), exportContext(lang));
    const printed = blocks.flatMap((blk) => (blk.type === 'section' ? [blk.title] : blk.type === 'note' ? [blk.text] : [...blk.headers, ...blk.rows.flatMap((r) => r.cells)]));
    for (const text of printed) for (const ch of text) assert.ok(covered(ch), `U+${ch.codePointAt(0)!.toString(16)} (${ch}) in "${text}" [${lang}]`);
  }
});

test('level rows: one row per level with its directions folded in; weights are the sums of the item rows', () => {
  const m = mesh({ bottom: { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } }, top: uniform(10, 0.15), wastePercent: 5 });
  const plan = planWith([m]);
  const rows = buildRebarItems(plan);
  const levels = buildRebarLevelRows(plan);
  assert.deepEqual(levels.map((l) => [l.level, l.parts.length]), [['bottom', 2], ['top', 1]]);
  const [bottom, top] = levels;
  near(bottom.netWeightKg, rows[0].netWeightKg! + rows[1].netWeightKg!);
  near(bottom.orderWeightKg, rows[0].orderWeightKg! + rows[1].orderWeightKg!);
  assert.equal(top.netWeightKg, rows[2].netWeightKg);
  // nothing changes in total: the levels add up to the engine's weight
  near(bottom.netWeightKg! + top.netWeightKg!, calc(m).weightKg!);
  // a level with an uncalculable part has no weight at all
  assert.equal(buildRebarLevelRows(planWith([mesh({ bottom: uniform(0, 0) })]))[0].netWeightKg, null);
});
