// M8b: concrete and rebar across a project's plans — the aggregation (from the same item rows the plan
// reports use, summed unrounded), the project workbook's structural sheets, the project PDF's layout
// and a real PDF run, and that a project without structural data is exactly what it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { PLAN_A, PLAN_B } from './fixtures.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildProjectStructural, buildRebarSummary, buildStructuralReport, finishesSummaryMode } from '../../src/lib/structuralQuantities.ts';
import { buildProjectStructuralPdfLayout, buildStructuralPdfLayout, writeBlocks } from '../../src/lib/structuralPdfLayout.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { rebarWeightPerMeterKg } from '../../src/lib/rebar.ts';
import type { Plan, Point, Project } from '../../src/types/index.ts';
import type { ConcreteElement, RebarItem, RebarLayer } from '../../src/types/structural.ts';

Object.assign(globalThis, {
  DOMMatrix: class {},
  DOMPoint: class {},
  DOMRect: class {},
  Path2D: class {},
  DOMParser: class {
    parseFromString() {
      return { documentElement: { getAttribute: () => '0 0 1 1' }, querySelectorAll: () => [] };
    }
  },
});
const { ReportWriter } = await import('../../src/lib/exportProjectPdf.ts');

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }]; // 27 m²
const W12 = rebarWeightPerMeterKg(12)!;

let n = 0;
const el = (extra: Partial<ConcreteElement>): ConcreteElement => ({ id: `c${n++}`, pageNumber: 1, kind: 'slab', mark: `S${n}`, points: rect(1000, 800), depthM: 0.2, wastePercent: 0, ...extra });
const layer = (extra: Partial<RebarLayer> = {}): RebarLayer => ({ id: `l${n++}`, diameterMm: 12, spacingM: 0.2, direction: 'long', ...extra });
const mesh = (layers: RebarLayer[], extra: Partial<Extract<RebarItem, { kind: 'mesh' }>> = {}): RebarItem => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: `M0${n}`, points: rect(1000, 800), layers, wastePercent: 0, ...extra });
const bars = (extra: Partial<Extract<RebarItem, { kind: 'bars' }>> = {}): RebarItem => ({ id: `b${n++}`, kind: 'bars', pageNumber: 1, mark: `R0${n}`, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 0, ...extra });

/** A bare plan (no rooms): pages 1–2 calibrated, page 3 not. */
function plan(id: string, name: string, concrete?: ConcreteElement[], rebar?: RebarItem[]): Plan {
  const p = structuredClone(PLAN_A);
  p.id = id;
  p.name = name;
  p.rooms = [];
  p.measurements = [];
  p.markups = [];
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  delete p.concreteElements;
  delete p.rebarItems;
  if (concrete) p.concreteElements = concrete;
  if (rebar) p.rebarItems = rebar;
  return p;
}
const near = (a: number | undefined | null, b: number, eps = 1e-9) => assert.ok(typeof a === 'number' && Math.abs(a - b) < eps, `${String(a)} vs ${b}`);
const PROJECT = (planIds: string[]): Project => ({ id: 'p', name: 'פרויקט', createdAt: 0, updatedAt: 0, planIds });

// ---------- aggregation ----------

test('no plans, or plans without structural data, have no structural part', () => {
  assert.deepEqual(buildProjectStructural([]), { concrete: null, rebar: null });
  assert.deepEqual(buildProjectStructural([PLAN_A, PLAN_B]), { concrete: null, rebar: null });
  assert.deepEqual(buildProjectStructural([plan('x', 'X', [], [])]), { concrete: null, rebar: null });
});

test('concrete across plans: the same type and grade add up, other grades stay apart, each plan keeps its share', () => {
  const a = plan('a', 'Plan A', [
    el({ kind: 'slab', grade: 'B30', depthM: 0.2, wastePercent: 5 }), // 16 / 16.8
    el({ kind: 'slab', grade: 'B30', pageNumber: 2, depthM: 0.1 }), // 8
    el({ kind: 'wall', points: rect(500, 20), depthM: 3 }), // 3
  ]);
  const b = plan('b', 'Plan B', [
    el({ kind: 'slab', grade: 'B30', depthM: 0.3 }), // 24
    el({ kind: 'slab', grade: 'B40', depthM: 0.2 }), // 16
    el({ kind: 'slab', grade: 'B30', pageNumber: 3 }), // no scale: missing
  ]);
  const c = buildProjectStructural([a, b]).concrete!;
  assert.deepEqual(c.rows.map((r) => `${r.kind}/${r.grade || '-'}`), ['slab/B30', 'slab/B40', 'wall/-']);
  const b30 = c.rows[0];
  assert.equal(b30.elementCount, 4);
  assert.equal(b30.missingCount, 1);
  near(b30.volumeM3, 16 + 8 + 24);
  near(b30.orderM3, 16.8 + 8 + 24);
  assert.deepEqual(b30.perPlan.map((p) => [p.planName, p.itemCount, p.missingCount, p.volumeM3]), [['Plan A', 2, 0, 24], ['Plan B', 2, 1, 24]]);
  // project totals and per-plan totals; the missing item is attributed to its plan and never summed
  near(c.volumeM3, 24 + 24 + 16 + 3);
  assert.equal(c.elementCount, 6);
  assert.equal(c.missingCount, 1);
  assert.deepEqual(c.perPlan.map((p) => [p.planId, p.itemCount, p.missingCount]), [['a', 3, 0], ['b', 3, 1]]);
});

test('rebar across plans: the same diameter adds up over plans and pages; exact + estimated is mixed, and says how much', () => {
  const a = plan('a', 'Plan A', undefined, [
    mesh([layer({ diameterMm: 12 })]), // 41 × 10 = 410, exact
    bars({ pageNumber: 2, diameterMm: 12, count: 4, lengthM: 3 }), // 12
    bars({ diameterMm: 16 }), // 60
  ]);
  const b = plan('b', 'Plan B', undefined, [
    mesh([layer({ diameterMm: 12, spacingM: 0.15 })], { points: L_SHAPE, wastePercent: 10 }), // estimate 180, order 198
    mesh([layer({ diameterMm: 10 })], { pageNumber: 3 }), // no scale: missing
  ]);
  const r = buildProjectStructural([a, b]).rebar!;
  assert.deepEqual(r.rows.map((x) => x.diameterMm), [12, 16]);
  const d12 = r.rows[0];
  assert.equal(d12.basis, 'mixed');
  near(d12.lengthM, 410 + 12 + 180);
  near(d12.estimatedLengthM, 180);
  near(d12.weightKg, (410 + 12 + 180) * W12, 0.005);
  near(d12.orderLengthM, 410 + 12 + 198);
  assert.deepEqual(d12.perPlan.map((p) => [p.planName, p.basis]), [['Plan A', 'exact'], ['Plan B', 'estimated']]);
  assert.equal(r.rows[1].basis, 'exact');
  assert.equal(r.basis, 'mixed');
  near(r.estimatedLengthM, 180);
  // the missing item is counted, attributed, and in no total
  assert.equal(r.missingItemCount, 1);
  assert.deepEqual(r.perPlan.map((p) => [p.planName, p.itemCount, p.missingItemCount]), [['Plan A', 3, 0], ['Plan B', 2, 1]]);
  assert.equal(r.rows.some((x) => x.diameterMm === 10), false);
  near(r.lengthM, 410 + 12 + 180 + 60);
});

test('an estimate-only project is estimated; a plan with only missing items has no basis of its own', () => {
  const r = buildProjectStructural([
    plan('a', 'A', undefined, [mesh([layer()], { points: L_SHAPE })]),
    plan('b', 'B', undefined, [mesh([layer()], { pageNumber: 3 })]),
  ]).rebar!;
  assert.equal(r.basis, 'estimated');
  assert.equal(r.rows[0].basis, 'estimated');
  assert.equal(r.perPlan[1].basis, null);
  assert.equal(r.perPlan[1].lengthM, 0);
  assert.equal(r.perPlan[1].missingItemCount, 1);
});

test('nothing calculable: a section exists (items are there) with no rows, no basis and everything missing', () => {
  const r = buildProjectStructural([plan('a', 'A', [el({ pageNumber: 3 })], [bars({ count: NaN })])]);
  assert.equal(r.concrete!.rows.length, 1);
  assert.equal(r.concrete!.volumeM3, 0);
  assert.equal(r.concrete!.missingCount, 1);
  assert.equal(r.rebar!.rows.length, 0);
  assert.equal(r.rebar!.basis, null);
  assert.equal(r.rebar!.missingItemCount, 1);
});

test('summing is of unrounded values: the plans\' rounded figures would give a different project total', () => {
  // three plans, one 0.004 lm bar row each: every plan rounds to 0.00, the project is 0.012 → 0.01
  const plans = ['a', 'b', 'c'].map((id) => plan(id, id, undefined, [bars({ diameterMm: 12, count: 1, lengthM: 0.004 })]));
  assert.equal(plans.reduce((sum, p) => sum + buildRebarSummary(p).lengthM, 0), 0);
  assert.equal(buildProjectStructural(plans).rebar!.lengthM, 0.01);
  // concrete: 3 × 0.0004 m³ (a 0.02 m² zone, 0.02 m thick)
  const slabs = ['a', 'b', 'c'].map((id) => plan(id, id, [el({ points: [], sizeOverride: { lengthM: 0.2, widthM: 0.1 }, depthM: 0.02 })]));
  assert.equal(buildProjectStructural(slabs).concrete!.volumeM3, 0); // 0.0004 × 3 = 0.0012 → 0.00
  const bigger = ['a', 'b', 'c'].map((id) => plan(id, id, [el({ points: [], sizeOverride: { lengthM: 0.4, widthM: 0.1 }, depthM: 0.1 })]));
  assert.equal(buildProjectStructural(bigger).concrete!.volumeM3, 0.01); // 0.004 × 3 = 0.012 → 0.01 (each plan alone rounds to 0.00)
});

test('the aggregation does not depend on plan order for its totals, and does not mutate the plans', () => {
  const a = plan('a', 'A', [el({ grade: 'B30' })], [bars()]);
  const b = plan('b', 'B', [el({ grade: 'B30', depthM: 0.3 })], [bars({ diameterMm: 12 })]);
  const before = JSON.stringify([a, b]);
  const ab = buildProjectStructural([a, b]);
  const ba = buildProjectStructural([b, a]);
  assert.equal(ab.concrete!.volumeM3, ba.concrete!.volumeM3);
  assert.equal(ab.rebar!.weightKg, ba.rebar!.weightKg);
  assert.deepEqual(ab.rebar!.rows.map((r) => r.diameterMm), [12, 16]);
  assert.equal(JSON.stringify([a, b]), before);
});

test('finishes summary mode: only a project with neither finishes nor structural data says "no quantities"', () => {
  const none = buildProjectStructural([PLAN_A]);
  const some = buildProjectStructural([plan('a', 'A', [el({})])]);
  assert.equal(finishesSummaryMode(0, none), 'empty');
  assert.equal(finishesSummaryMode(3, none), 'table');
  assert.equal(finishesSummaryMode(0, some), 'skip');
  assert.equal(finishesSummaryMode(3, some), 'table');
});

// ---------- project Excel ----------


test('a project without concrete or rebar has exactly the sheets it always had', async () => {
  const wb = buildProjectWorkbook(PROJECT(['plan-a', 'plan-b']), [PLAN_A, PLAN_B], 'he');
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['סיכום פרויקט', 'תוכניות', 'חדרים', 'סוגי עבודה']);
});

// ---------- project PDF ----------

test('a real project PDF page set is produced with the report writer, in both languages', async () => {
  const a = plan('a', 'Plan A', [el({ mark: 'S01', grade: 'B30' })], [mesh([layer()], { points: L_SHAPE }), bars()]);
  const fontFile = (name: string) => readFileSync(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${name}-normal.woff`, import.meta.url));
  for (const lang of ['he', 'en'] as const) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const embed = (name: string) => doc.embedFont(fontFile(name), { subset: true });
    const [hr, hb, lr, lb] = await Promise.all([embed('hebrew-400'), embed('hebrew-700'), embed('latin-400'), embed('latin-700')]);
    const x = exportContext(lang);
    const writer = new ReportWriter(doc, { regular: { hebrew: hr, latin: lr }, bold: { hebrew: hb, latin: lb } }, 'Project', x.today(), x);
    writeBlocks(writer, buildProjectStructuralPdfLayout(buildProjectStructural([a]), x));
    assert.ok(doc.getPageCount() >= 1);
    assert.ok((await doc.save()).length > 1000);
  }
  // sanity: the plan-level report builder is unaffected by the project one
  assert.ok(buildStructuralReport(a).concrete);
});

test('every character the structural PDF layouts print has a glyph in the report fonts (no "≈"-style tofu)', () => {
  const fonts = ['hebrew-400', 'latin-400', 'hebrew-700', 'latin-700'].map((name) =>
    fontkit.create(readFileSync(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${name}-normal.woff`, import.meta.url))) as { hasGlyphForCodePoint(cp: number): boolean }
  );
  const covered = (ch: string) => ch === '\n' || fonts.some((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!));
  const a = plan('a', 'Plan A', [el({ mark: 'S01', grade: 'B30' }), el({ mark: 'S02', pageNumber: 3 })], [mesh([layer()], { mark: 'M01', points: L_SHAPE }), mesh([layer()], { mark: 'M02' }), bars({ mark: 'R01' }), mesh([], { mark: 'M03' })]);
  const b = plan('b', 'Plan B', [el({})], [mesh([layer({ diameterMm: 12 })], { points: L_SHAPE })]);
  for (const lang of ['he', 'en'] as const) {
    const x = exportContext(lang);
    const blocks = [...buildProjectStructuralPdfLayout(buildProjectStructural([a, b]), x), ...buildStructuralPdfLayout(buildStructuralReport(a), x)];
    const printed = blocks.flatMap((blk) => (blk.type === 'section' ? [blk.title] : blk.type === 'note' ? [blk.text] : [...blk.headers, ...blk.rows.flatMap((r) => r.cells)]));
    for (const text of printed) for (const ch of text) assert.ok(covered(ch), `U+${ch.codePointAt(0)!.toString(16)} (${ch}) in "${text}" [${lang}]`);
  }
});
