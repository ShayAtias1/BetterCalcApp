// Export Part A (plan PDF): the content selector state, the Concrete and Rebar BOQ layout (items +
// one total row, mesh per level with its physical sheet count), page filtering, and the plan overlays
// (concrete / rebar zones drawn only when their View switch is on - the BOQ never depends on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { ALL_CONTENT, NO_CONTENT, availableContent, everything, hasAnyContent, isEverything, type ExportContent } from '../../src/lib/exportContent.ts';
import { buildStructuralPdfLayout, sheetConfigText } from '../../src/lib/structuralPdfLayout.ts';
import { buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { ALL_VISIBLE } from '../../src/lib/overlayVisibility.ts';
import { drawConcreteZonesOnCanvas, drawRebarZonesOnCanvas } from '../../src/lib/drawStructuralZones.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { ConcreteElement, MeshReinforcement, RebarItem, RebarMesh } from '../../src/types/structural.ts';

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
const { drawStructuralOverlays } = await import('../../src/lib/exportQuantitiesPdf.ts');

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
const u = (d: number, s: number): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm: d, spacingM: s } });
let n = 0;
const slab = (extra: Partial<ConcreteElement> = {}): ConcreteElement => ({ id: `c${n++}`, pageNumber: 1, kind: 'slab', mark: '', autoNumber: n, points: rect(1000, 800), depthM: 0.2, wastePercent: 0, ...extra });
const mesh = (extra: Partial<RebarMesh> = {}): RebarMesh => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: '', autoNumber: n, points: rect(1000, 400), bottom: u(12, 0.2), wastePercent: 0, ...extra });
const planOf = (concrete: ConcreteElement[], rebar: RebarItem[]): Plan => {
  const p = structuredClone(PLAN_A);
  p.rooms = [];
  p.measurements = [];
  p.markups = [];
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  p.concreteElements = concrete;
  p.rebarItems = rebar;
  return p;
};
type Table = Extract<ReturnType<typeof buildStructuralPdfLayout>[number], { type: 'table' }>;
const layout = (p: Plan, lang: 'he' | 'en' = 'en', include?: { concrete: boolean; rebar: boolean }, pages?: number[]) =>
  buildStructuralPdfLayout(buildStructuralReport(p, pages ? new Set(pages) : undefined), exportContext(lang), include);
const tables = (blocks: ReturnType<typeof layout>) => blocks.filter((b): b is Table => b.type === 'table');

// ---------- the content selector ----------

test('content selector: any combination, "Everything" selects all four, nothing selected blocks the export', () => {
  assert.equal(hasAnyContent(NO_CONTENT), false);
  for (const only of ['plan', 'finishes', 'concrete', 'rebar'] as const) assert.equal(hasAnyContent({ ...NO_CONTENT, [only]: true }), true);
  assert.deepEqual(everything(), ALL_CONTENT);
  assert.equal(isEverything(ALL_CONTENT), true);
  const planPlusConcrete: ExportContent = { ...NO_CONTENT, plan: true, concrete: true };
  assert.equal(isEverything(planPlusConcrete), false);
  assert.equal(hasAnyContent(planPlusConcrete), true);
  // Everything means everything the plan can provide
  const p = planOf([slab()], []);
  const available = availableContent(p, false, true);
  assert.deepEqual(available, { plan: true, finishes: false, concrete: true, rebar: false });
  assert.deepEqual(everything(available), available);
  assert.equal(isEverything(available, available), true);
});

test('what is exported: only the selected structural sections are laid out', () => {
  const p = planOf([slab({ mark: 'S1', markManual: true })], [mesh({ mark: 'M1', markManual: true })]);
  const titles = (blocks: ReturnType<typeof layout>) => blocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title);
  assert.deepEqual(titles(layout(p)), ['Concrete', 'Rebar']); // everything
  assert.deepEqual(titles(layout(p, 'en', { concrete: true, rebar: false })), ['Concrete']); // concrete only
  assert.deepEqual(titles(layout(p, 'en', { concrete: false, rebar: true })), ['Rebar']); // rebar only
  assert.deepEqual(layout(p, 'en', { concrete: false, rebar: false }), []); // plan only / finishes only: no structural part
  // exactly one table per domain: no Summary + Items pair
  assert.equal(tables(layout(p)).length, 2);
});

// ---------- Concrete BOQ ----------

test('concrete BOQ: one row per element, localized automatic marks, typed marks untouched, one total row', () => {
  const p = planOf(
    [slab({ autoNumber: 1 }), slab({ mark: 'קורה A', markManual: true, grade: 'B30', depthM: 0.25 }), slab({ kind: 'wall', autoNumber: 1, depthM: 3, points: rect(500, 20) }), slab({ pageNumber: 2, depthM: undefined, autoNumber: 2 })],
    []
  );
  const [t] = tables(layout(p));
  assert.equal(t.rows.length, 5); // four elements + the total
  assert.deepEqual(t.rows.slice(0, 3).map((r) => [r.cells[1], r.cells[2], r.cells[4]]), [['Slab', 'Slab 01', '20 cm'], ['Slab', 'קורה A', '25 cm'], ['Wall', 'Wall 01', '3 m']]);
  const he = tables(layout(p, 'he'))[0];
  assert.deepEqual([he.rows[0].cells[1], he.rows[0].cells[2], he.rows[1].cells[2]], ['תקרה', 'תקרה 01', 'קורה A']);
  assert.equal(t.rows[3].cells[0], '2'); // the page number appears at the first row of each page
  assert.equal(t.rows[1].cells[0], ''); // ...and not on the next row of the same page
  assert.deepEqual(t.rows[3].cells.slice(4, 8), ['-', '-', '-', 'Thickness missing']); // missing: a row with dashes and a short reason
  const total = t.rows.at(-1)!;
  assert.deepEqual([total.cells[1], total.cells[7]], ['Total', 'Missing data: 1']);
  assert.ok(total.bold);
  // the total is the sum of the calculable items only
  assert.equal(total.cells[5], '39'); // 16 (slab 1) + 20 (slab 2, 25 cm) + 3 (wall: 1 m² × 3 m)
});

// ---------- Rebar BOQ ----------

test('rebar BOQ: Mesh per level (Top and Bottom are separate rows of one mark), Bars row, sheet counts, one total row', () => {
  const p = planOf(
    [],
    [
      mesh({ autoNumber: 1, bottom: u(12, 0.2), top: u(10, 0.15) }),
      mesh({ autoNumber: 2, bottom: { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } } }),
      { id: 'b1', kind: 'bars', pageNumber: 1, mark: '', autoNumber: 1, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 0 },
    ]
  );
  const [t] = tables(layout(p));
  assert.equal(t.rows.length, 5); // Mesh 01 bottom, Mesh 01 top, Mesh 02 bottom, Bars 01, total
  assert.deepEqual(t.rows.slice(0, 2).map((r) => [r.cells[1], r.cells[2], r.cells[3], r.cells[4], r.cells[5]]), [
    ['Mesh', 'Mesh 01', 'Bottom', 'Ø12 @ 20 cm - Both directions', '4 sheets'],
    ['Mesh', 'Mesh 01', 'Top', 'Ø10 @ 15 cm - Both directions', '4 sheets'], // each level its own count, never an unexplained 8
  ]);
  assert.equal(t.rows[2].cells[4], 'Long side Ø12 @ 20 | Short side Ø10 @ 15');
  assert.deepEqual(t.rows[3].cells.slice(1, 7), ['Bars', 'Bars 01', '-', 'Ø16', '10 bars', '-']);
  const total = t.rows.at(-1)!;
  assert.equal(total.cells[5], ''); // sheets and bars are different units: no combined quantity
  assert.equal(total.cells[9], 'Exact');
  assert.ok(!JSON.stringify(layout(p)).includes('Bar lines'));
  assert.ok(!JSON.stringify(layout(p, 'he')).includes('שורות זיון'));
  // the weight total is the sum of the rows
  const sum = (col: number) => t.rows.slice(0, -1).reduce((a, r) => a + Number(r.cells[col].replace(/,/g, '')), 0);
  assert.ok(Math.abs(sum(7) - Number(total.cells[7].replace(/,/g, ''))) < 0.05);
  assert.equal(t.headers.includes('Level'), true);
  assert.deepEqual(tables(layout(p, 'he'))[0].rows[3].cells.slice(1, 6), ['מוטות', 'מוטות 01', '-', 'Ø16', '10 מוטות']);
});

test('mesh sheet configuration: defaults and custom size / overlap are printed and change the count', () => {
  const ctx = exportContext('en');
  assert.equal(sheetConfigText({ lengthM: 6, widthM: 2.5, overlapM: 0.8 }, ctx), '6.00 × 2.50 m · 80 cm');
  const base = planOf([], [mesh({ autoNumber: 1 })]);
  assert.deepEqual([tables(layout(base))[0].rows[0].cells[5], tables(layout(base))[0].rows[0].cells[6]], ['4 sheets', '6.00 × 2.50 m · 80 cm']);
  const custom = planOf([], [mesh({ autoNumber: 1, sheets: { lengthM: 12, widthM: 4, overlapM: 0.5 } })]);
  const row = tables(layout(custom))[0].rows[0];
  assert.deepEqual([row.cells[5], row.cells[6]], ['1 sheet', '12.00 × 4.00 m · 50 cm']); // the 10 × 4 m zone fits one custom sheet
  assert.equal(tables(layout(custom, 'he'))[0].rows[0].cells[5], '1 רשת');
  const twice = planOf([], [mesh({ autoNumber: 1, sheets: { lengthM: 8, widthM: 3, overlapM: 0 } })]);
  assert.equal(tables(layout(twice))[0].rows[0].cells[5], '4 sheets'); // 2 × 2 (overlap 0)
  assert.equal(tables(layout(twice, 'he'))[0].rows[0].cells[5], '4 רשתות');
  const one = planOf([], [mesh({ autoNumber: 1, points: rect(300, 200) })]);
  assert.equal(tables(layout(one, 'en'))[0].rows[0].cells[5], '1 sheet');
});

test('irregular zones have no sheet quantity (the weight stays an estimate); missing data stays a row', () => {
  const p = planOf([], [mesh({ autoNumber: 1, points: L_SHAPE }), mesh({ autoNumber: 2, bottom: u(0, 0) }), mesh({ autoNumber: 3, pageNumber: 3 })]);
  const [t] = tables(layout(p));
  const [irregular, incomplete, uncalibrated] = t.rows;
  assert.deepEqual([irregular.cells[5], irregular.cells[6], irregular.cells[9]], ['-', '-', 'Estimate']);
  assert.ok(irregular.cells[7].startsWith('~ '));
  assert.deepEqual([incomplete.cells[7], incomplete.cells[8], incomplete.cells[9]], ['-', '-', 'Data missing']);
  assert.deepEqual([uncalibrated.cells[5], uncalibrated.cells[7], uncalibrated.cells[9]], ['-', '-', 'Page not calibrated']);
});

test('old meshes (flat layers) export with the same weights as the engine', () => {
  const old = mesh({ autoNumber: 1, bottom: undefined, layers: [{ id: 'l1', diameterMm: 12, spacingM: 0.2, direction: 'long' }, { id: 'l2', diameterMm: 12, spacingM: 0.2, direction: 'short' }] });
  const report = buildStructuralReport(planOf([], [old]));
  assert.equal(report.rebar!.levels.length, 1); // read as one uniform Bottom level
  assert.ok(Math.abs(report.rebar!.levels[0].netWeightKg! - report.rebar!.summary.weightKg) < 0.01); // the summary rounds to 2 decimals
});

test('selected pages filter every section; a structural-only page is a page of the report', () => {
  const p = planOf([slab({ autoNumber: 1 }), slab({ pageNumber: 2, autoNumber: 2 })], [mesh({ autoNumber: 1 }), mesh({ pageNumber: 2, autoNumber: 2 })]);
  const [c, r] = tables(layout(p, 'en', undefined, [2]));
  assert.deepEqual(c.rows.map((x) => x.cells[2]), ['Slab 02', '']);
  assert.deepEqual(r.rows.map((x) => x.cells[2]), ['Mesh 02', '']);
  assert.deepEqual(layout(p, 'en', undefined, [3]), []);
});

// ---------- plan overlays ----------

function fakeCtx() {
  const texts: string[] = [];
  const calls: string[] = [];
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => { calls.push(k); if (k === 'fillText') texts.push(String(args[0])); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, calls };
}

test('plan overlays: concrete and rebar zones are drawn with mark and notation, each only when its View switch is on', () => {
  const p = planOf([slab({ autoNumber: 1, grade: 'B30' })], [mesh({ autoNumber: 1, bottom: u(12, 0.2), top: u(10, 0.15) })]);
  const draw = (overlays: typeof ALL_VISIBLE, lang: 'he' | 'en' = 'en') => {
    const f = fakeCtx();
    drawStructuralOverlays(f.ctx, p, 1, 2, 120, overlays, lang);
    return f.texts.join('\n');
  };
  const all = draw(ALL_VISIBLE);
  assert.match(all, /Slab 01 · 20 cm · B30/);
  assert.match(all, /Mesh 01/);
  assert.match(all, /Bottom: .*Ø12 @ 20.* - 2 directions/);
  assert.match(all, /Top: .*Ø10 @ 15/);

  const noConcrete = draw({ ...ALL_VISIBLE, concrete: false });
  assert.doesNotMatch(noConcrete, /Slab 01/);
  assert.match(noConcrete, /Mesh 01/);
  const noRebar = draw({ ...ALL_VISIBLE, rebar: false });
  assert.match(noRebar, /Slab 01/);
  assert.doesNotMatch(noRebar, /Mesh 01/);
  assert.equal(draw({ ...ALL_VISIBLE, concrete: false, rebar: false }), '');
  assert.match(draw(ALL_VISIBLE, 'he'), /תקרה 01 · 20 ס"מ · B30/);
  // the other page has nothing
  const f = fakeCtx();
  drawStructuralOverlays(f.ctx, p, 2, 2, 120, ALL_VISIBLE, 'en');
  assert.equal(f.texts.length, 0);

  // ...while the BOQ ignores the View switches altogether: it is built from the plan alone
  assert.equal(tables(layout(p)).length, 2);
});

test('plan overlays: a narrow rebar zone shows the mark and a compact B+T tag; individual bars and sheets are never drawn', () => {
  const p = planOf([], [mesh({ autoNumber: 1, points: rect(60, 40), bottom: u(12, 0.2), top: u(10, 0.15) })]);
  const f = fakeCtx();
  drawRebarZonesOnCanvas(f.ctx, p.rebarItems as RebarMesh[], 2, 0, exportContext('en'));
  assert.deepEqual(f.texts, ['Mesh 01', 'B+T']);
  // a full-size zone: mark + one line per level, still text only (no per-bar lines: one outline path + dashes)
  const big = fakeCtx();
  drawRebarZonesOnCanvas(big.ctx, [mesh({ autoNumber: 2 })], 2, 0, exportContext('en'));
  assert.equal(big.texts.length, 2);
  assert.equal(big.calls.filter((c) => c === 'stroke').length, 1); // the zone outline only
  assert.equal(big.calls.filter((c) => c === 'lineTo').length, 3); // one path around the 4 corners - no per-bar lines
  const c = fakeCtx();
  drawConcreteZonesOnCanvas(c.ctx, [slab({ autoNumber: 1 })], 2, 0, exportContext('en'));
  assert.deepEqual(c.texts, ['Slab 01 · 20 cm']);
});
