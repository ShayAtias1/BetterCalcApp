// M8a: concrete and rebar in the plan reports. Builders and page filtering, the Excel sheets (numeric
// cells, formulas, estimate marking, dashes for missing data), the PDF layout and a real PDF run, the
// export gating, and — above all — that a plan without concrete or rebar exports exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { PLAN_A } from './fixtures.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { buildStructuralPdfLayout } from '../../src/lib/structuralPdfLayout.ts';
import { buildStructuralReport, buildConcreteItems, buildRebarItems, buildConcreteSummary, buildRebarSummary } from '../../src/lib/structuralQuantities.ts';
import { hasStructuralData, structuralPageNumbers, withStructuralPages } from '../../src/lib/structuralPlan.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { markLabel } from '../../src/lib/structuralMarks.ts';
import { translatorFor } from '../../src/i18n/index.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { ConcreteElement, RebarItem, RebarLayer } from '../../src/types/structural.ts';

// The PDF modules read the logo with DOMParser at load time, and pdf.js expects browser globals.
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
const { getExportablePageNumbers } = await import('../../src/lib/exportQuantitiesPdf.ts');
const { drawStructuralPdfPages } = await import('../../src/lib/exportStructuralPdf.ts');

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];

let n = 0;
const el = (extra: Partial<ConcreteElement>): ConcreteElement => ({ id: `c${n++}`, pageNumber: 1, kind: 'slab', mark: `S${n}`, points: rect(1000, 800), depthM: 0.2, wastePercent: 0, ...extra });
const layer = (extra: Partial<RebarLayer> = {}): RebarLayer => ({ id: `l${n++}`, diameterMm: 12, spacingM: 0.2, direction: 'long', ...extra });
const mesh = (layers: RebarLayer[], extra: Partial<Extract<RebarItem, { kind: 'mesh' }>> = {}): RebarItem => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: `M0${n}`, points: rect(1000, 800), layers, wastePercent: 0, ...extra });
const bars = (extra: Partial<Extract<RebarItem, { kind: 'bars' }>> = {}): RebarItem => ({ id: `b${n++}`, kind: 'bars', pageNumber: 1, mark: `R0${n}`, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 0, ...extra });

/** PLAN_A (with its finishes) plus structural items; pages 1 and 2 calibrated, 3 not. */
function plan(concrete?: ConcreteElement[], rebar?: RebarItem[]): Plan {
  const p = structuredClone(PLAN_A);
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  if (concrete) p.concreteElements = concrete;
  if (rebar) p.rebarItems = rebar;
  return p;
}
/** A plan with structural data only: no rooms, no measurements. */
function structuralOnly(concrete?: ConcreteElement[], rebar?: RebarItem[]): Plan {
  const p = plan(concrete, rebar);
  p.rooms = [];
  p.measurements = [];
  p.markups = [];
  return p;
}

async function reread(wb: ExcelJS.Workbook) {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
}
const TODAY = new Date().toLocaleDateString('he-IL');
async function dump(wb: ExcelJS.Workbook) {
  return (await reread(wb)).worksheets.map((sheet) => {
    const cells: Record<string, unknown> = {};
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        cells[cell.address] = cell.numFmt ? { value: typeof v === 'string' ? v.replace(TODAY, '<today>') : v, numFmt: cell.numFmt } : v;
      })
    );
    return { name: sheet.name, cells };
  });
}
const near = (a: unknown, b: number, eps = 1e-9) => assert.ok(typeof a === 'number' && Math.abs(a - b) < eps, `${String(a)} vs ${b}`);

// ---------- regression: nothing changes without structural data ----------

test('a plan with finishes only exports exactly as before — with or without the structural argument', async () => {
  const summaries = buildRoomSummaries(PLAN_A);
  const areas = PLAN_A.measurements.filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const report = buildStructuralReport(PLAN_A);
  assert.deepEqual(report, { concrete: null, rebar: null });
  for (const lang of ['he', 'en'] as const) {
    assert.deepEqual(await dump(buildQuantitiesWorkbook(summaries, areas, lang, report)), await dump(buildQuantitiesWorkbook(summaries, areas, lang)));
  }
  assert.equal(hasStructuralData(PLAN_A), false);
  assert.deepEqual(structuralPageNumbers(PLAN_A), []);
});

test('with structural data the finishes sheets are untouched and the new sheets come last', async () => {
  const p = plan([el({})], [mesh([layer()])]);
  const summaries = buildRoomSummaries(p);
  const areas = p.measurements.filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const base = await dump(buildQuantitiesWorkbook(summaries, areas, 'he'));
  const withStructural = await dump(buildQuantitiesWorkbook(summaries, areas, 'he', buildStructuralReport(p)));
  assert.deepEqual(withStructural.slice(0, base.length), base);
  assert.deepEqual(withStructural.slice(base.length).map((s) => s.name), ['בטון', 'זיון']);
});

const he = translatorFor('he');

// ---------- builders and page filter ----------

test('item rows: ordered by page, numbers null (never 0) where unknown, applied quantity and waste shown', () => {
  const rows = buildConcreteItems(plan([
    el({ pageNumber: 2, mark: 'S02' }),
    el({ pageNumber: 1, mark: 'S01', grade: ' B30 ', wastePercent: 5, quantity: 2 }),
    el({ pageNumber: 3, mark: 'S03' }), // page without a scale
    el({ pageNumber: 1, mark: 'S04', depthM: undefined }), // thickness missing
  ]));
  assert.deepEqual(rows.map((r) => markLabel(r, he)), ['תקרה 01', 'תקרה 04', 'תקרה 02', 'תקרה 03']);
  assert.equal(rows[0].grade, 'B30');
  assert.equal(rows[0].quantity, 2);
  near(rows[0].netM3, 32); // 80 m² × 0.2 × 2
  near(rows[0].orderM3, 33.6);
  assert.equal(rows[1].status, 'missing-depth');
  assert.equal(rows[1].netM3, null);
  assert.equal(rows[1].depthM, null);
  near(rows[1].footprintM2, 80);
  assert.equal(rows[3].status, 'no-scale');
  assert.equal(rows[3].footprintM2, null);
  assert.equal(rows[3].netM3, null);
});

test('rebar rows: one per mesh layer or manual-bars item; exact has counts, estimate has none, missing has nothing', () => {
  const rows = buildRebarItems(plan(undefined, [
    mesh([layer({ diameterMm: 12, spacingM: 0.2, direction: 'long' }), layer({ diameterMm: 10, spacingM: 0.25, direction: 'short' })], { mark: 'M01' }),
    mesh([layer({ spacingM: 0.15 })], { mark: 'M02', points: L_SHAPE }),
    bars({ mark: 'R01', diameterMm: 16, count: 10, lengthM: 6, wastePercent: 10 }),
    mesh([layer({ diameterMm: 0 })], { mark: 'M03' }),
    mesh([], { mark: 'M04' }),
  ]));
  assert.deepEqual(rows.map((r) => markLabel(r, he)), ['רשת 01', 'רשת 01', 'רשת 02', 'מוטות 01', 'רשת 03', 'רשת 04']);
  assert.deepEqual([rows[0].level, rows[0].diameterMm, rows[0].spacingCm, rows[0].direction, rows[0].barCount], ['bottom', 12, 20, 'long', 41]);
  near(rows[0].barLengthM, 10);
  near(rows[0].netLengthM, 410);
  assert.deepEqual([rows[1].diameterMm, rows[1].spacingCm, rows[1].direction], [10, 25, 'short']);
  // estimate: numbers but no bars
  assert.equal(rows[2].estimated, true);
  assert.equal(rows[2].barCount, null);
  assert.equal(rows[2].barLengthM, null);
  near(rows[2].netLengthM, 27 / 0.15);
  // manual bars with waste
  assert.deepEqual([rows[3].kind, rows[3].level, rows[3].spacingCm, rows[3].direction, rows[3].barCount], ['bars', null, null, null, 10]);
  near(rows[3].orderLengthM, 66);
  // not calculable: listed, numbers null, reason given
  assert.equal(rows[4].netLengthM, null);
  assert.equal(rows[4].status, 'invalid-input');
  assert.equal(rows[5].status, 'no-layers');
  assert.equal(rows[5].diameterMm, null);
});

test('page filtering: structural data follows the page set exactly like rooms do', () => {
  const p = plan(
    [el({ pageNumber: 1, mark: 'S01' }), el({ pageNumber: 2, mark: 'S02' }), el({ pageNumber: 3, mark: 'S03', sizeOverride: { lengthM: 2, widthM: 2 } })],
    [mesh([layer()], { pageNumber: 1 }), bars({ pageNumber: 2 }), bars({ pageNumber: 3 })]
  );
  assert.deepEqual(structuralPageNumbers(p), [1, 2, 3]);
  const pages = new Set([2, 3]);
  const report = buildStructuralReport(p, pages);
  assert.deepEqual(report.concrete!.items.map((i) => markLabel(i, he)), ['תקרה 02', 'תקרה 03']);
  assert.deepEqual(report.rebar!.items.map((i) => i.pageNumber), [2, 3]);
  assert.equal(report.concrete!.summary.elementCount, 2);
  assert.equal(report.rebar!.summary.itemCount, 2);
  assert.equal(buildConcreteSummary(p, new Set([1])).elementCount, 1);
  assert.equal(buildRebarSummary(p, new Set([1])).itemCount, 1);
  assert.equal(buildStructuralReport(p, new Set([9])).concrete, null);

  // the same through the plan copy the Excel export is given
  const filtered = withStructuralPages(p, new Set([1]));
  assert.deepEqual(filtered.concreteElements!.map((e) => e.mark), ['S01']);
  assert.equal(filtered.pages, p.pages); // calibration travels with the copy
  assert.equal(p.concreteElements!.length, 3); // the original is untouched
  assert.equal('rebarItems' in withStructuralPages(plan([el({})]), new Set([1])), false); // absent arrays stay absent
});

// ---------- gating ----------

test('a structural-only page is an exportable page; plans without structural data are unchanged', () => {
  const before = getExportablePageNumbers(PLAN_A);
  assert.deepEqual(getExportablePageNumbers(structuredClone(PLAN_A)), before);
  const p = structuralOnly([el({ pageNumber: 4 })], [bars({ pageNumber: 2 })]);
  assert.deepEqual(getExportablePageNumbers(p), [2, 4]);
  assert.equal(hasStructuralData(p), true);
  const mixed = plan([el({ pageNumber: 7 })]);
  assert.deepEqual(getExportablePageNumbers(mixed), [...new Set([...before, 7])].sort((a, b) => a - b));
  assert.equal(hasStructuralData(structuralOnly()), false);
});

// ---------- PDF ----------

test('PDF layout: one BOQ per domain (items then a total row), ~ on estimates, dashes and short statuses, nothing for no data', () => {
  const p = structuralOnly(
    [el({ mark: 'S01', markManual: true, grade: 'B30' }), el({ mark: 'S02', markManual: true, depthM: undefined })],
    [mesh([layer()], { mark: 'M01', markManual: true, points: L_SHAPE }), mesh([layer()], { mark: 'M02', markManual: true }), bars({ mark: 'R01', markManual: true }), mesh([layer({ diameterMm: 0 })], { mark: 'M03', markManual: true })]
  );
  const blocks = buildStructuralPdfLayout(buildStructuralReport(p), exportContext('en'));
  assert.deepEqual(blocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title), ['Concrete', 'Rebar']);
  const tables = blocks.filter((b) => b.type === 'table') as Extract<(typeof blocks)[number], { type: 'table' }>[];
  assert.equal(tables.length, 2); // no separate summary tables
  assert.equal(blocks.filter((b) => b.type === 'note').length, 0);
  for (const t of tables) for (const r of t.rows) assert.equal(r.cells.length, t.headers.length);

  const [concrete, rebar] = tables;
  assert.deepEqual(concrete.headers.slice(0, 5), ['Page', 'Type', 'Mark', 'Concrete grade', 'Dimension']);
  assert.equal(concrete.rows.length, 3); // two elements + the total
  assert.deepEqual(concrete.rows[0].cells.slice(0, 5), ['1', 'Slab', 'S01', 'B30', '20 cm']);
  assert.deepEqual(concrete.rows[1].cells.slice(3, 8), ['-', '-', '-', '-', 'Thickness missing']); // a missing element stays a row: dashes and a reason
  assert.equal(concrete.rows[0].cells[7], ''); // OK rows stay quiet
  assert.deepEqual([concrete.rows[2].cells[1], concrete.rows[2].cells[5], concrete.rows[2].cells[7]], ['Total', '16', 'Missing data: 1']);

  assert.equal(rebar.rows.length, 5); // four items + the total
  const byMark = (mark: string) => rebar.rows.find((r) => r.cells[2] === mark)!;
  assert.ok(byMark('M01').cells[7].startsWith('~ ')); // the printed estimate is marked
  assert.deepEqual([byMark('M01').cells[5], byMark('M01').cells[6], byMark('M01').cells[9]], ['-', '-', 'Estimate']); // free polygon: no sheet layout
  assert.deepEqual([byMark('M02').cells[1], byMark('M02').cells[3], byMark('M02').cells[5], byMark('M02').cells[6], byMark('M02').cells[9]], ['Mesh', 'Bottom', '10 sheets', '6.00 × 2.50 m · 80 cm', 'Exact']);
  assert.deepEqual([byMark('R01').cells[1], byMark('R01').cells[3], byMark('R01').cells[4], byMark('R01').cells[5]], ['Bars', '-', 'Ø16', '10 bars']);
  assert.equal(byMark('M03').cells[9], 'Data missing');
  assert.deepEqual([rebar.rows.at(-1)!.cells[1], rebar.rows.at(-1)!.cells[5], rebar.rows.at(-1)!.cells[9]], ['Total', '', 'Includes estimate · Missing data: 1']);
  assert.ok(!JSON.stringify(blocks).includes('Bar lines'));

  assert.deepEqual(buildStructuralPdfLayout(buildStructuralReport(PLAN_A), exportContext('he')), []);
});

test('PDF layout in Hebrew uses the Hebrew words', () => {
  const blocks = buildStructuralPdfLayout(buildStructuralReport(structuralOnly([el({})])), exportContext('he'));
  assert.deepEqual(blocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title), ['בטון']);
});

test('a real PDF is produced for both sections in both languages, and none for a plan without structural data', async () => {
  const fontFile = (name: string) => readFileSync(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${name}-normal.woff`, import.meta.url));
  const p = structuralOnly(
    [el({ mark: 'S01', grade: 'B30' }), el({ mark: 'S02', depthM: undefined })],
    [mesh([layer()], { mark: 'M01', points: L_SHAPE }), bars({ mark: 'R01' }), mesh([], { mark: 'M02' })]
  );
  for (const lang of ['he', 'en'] as const) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const embed = (name: string) => doc.embedFont(fontFile(name), { subset: true });
    const [hr, hb, lr, lb] = await Promise.all([embed('hebrew-400'), embed('hebrew-700'), embed('latin-400'), embed('latin-700')]);
    const fonts = { regular: { hebrew: hr, latin: lr }, bold: { hebrew: hb, latin: lb } };
    drawStructuralPdfPages(doc, fonts, 'Plan', buildStructuralReport(p), lang);
    assert.ok(doc.getPageCount() >= 1);
    assert.ok((await doc.save()).length > 1000);

    const empty = await PDFDocument.create();
    empty.registerFontkit(fontkit);
    drawStructuralPdfPages(empty, fonts as never, 'Plan', buildStructuralReport(PLAN_A), lang);
    assert.equal(empty.getPageCount(), 0);
  }
});
