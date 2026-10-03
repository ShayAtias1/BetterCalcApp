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
const build = (p: Plan, lang: 'he' | 'en' = 'he') => buildQuantitiesWorkbook([], [], lang, buildStructuralReport(p));
/** Row `r` of a sheet as an array of cell values (formulas as `{formula, result}`). */
const rowOf = (sheet: ExcelJS.Worksheet, r: number) => (sheet.getRow(r).values as unknown[]).slice(1);
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

// ---------- Excel: concrete ----------

test('concrete sheet: a structural-only plan gets just that sheet; values are numbers, missing is a dash, totals are formulas', async () => {
  const p = structuralOnly([
    el({ pageNumber: 1, mark: 'S01', kind: 'slab', grade: 'B30', depthM: 0.2, wastePercent: 5 }), // 16 / 16.8
    el({ pageNumber: 1, mark: 'C01', kind: 'column', points: [], sizeOverride: { lengthM: 0.4, widthM: 0.4 }, depthM: 3, quantity: 4 }), // 1.92
    el({ pageNumber: 3, mark: 'S02', kind: 'slab' }), // page without a scale
    el({ pageNumber: 3, mark: 'C02', kind: 'column', points: [], sizeOverride: { lengthM: 0.5, widthM: 0.5 }, depthM: 2, quantity: 2 }), // manual size on an uncalibrated page: 1
    el({ pageNumber: 1, mark: 'W01', kind: 'wall', points: rect(500, 20), depthM: undefined }), // height missing
  ]);
  const wb = await reread(build(p));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['בטון']);
  const sheet = wb.getWorksheet('בטון')!;
  assert.equal(sheet.views[0].rightToLeft, true);

  // header + 5 items + total
  assert.equal(rowOf(sheet, 1).length, 11);
  const [s01, c01, w01, s02, c02] = [2, 3, 4, 5, 6].map((r) => rowOf(sheet, r));
  assert.deepEqual(s01.slice(0, 4), [1, 'תקרה 01', 'תקרה', 'B30']);
  assert.equal(typeof s01[7], 'number');
  near(s01[7], 16);
  near(s01[9], 16.8);
  assert.equal(s01[10], 'תקין');
  near(c01[7], 1.92); // 0.16 m² × 3 × 4
  assert.equal(c01[3], 'ללא דרגה');
  // not calculable: dashes, a reason, never 0
  assert.deepEqual([w01[7], w01[9], w01[10]], ['-', '-', 'חסר גובה']);
  assert.equal((w01[4] as number) > 0, true); // the footprint is still known
  assert.deepEqual([s02[4], s02[5] === 0.2, s02[7], s02[9], s02[10]], ['-', true, '-', '-', 'העמוד לא מכויל']);
  // manual size works on the uncalibrated page
  near(c02[7], 1);
  assert.equal(c02[10], 'תקין');

  // totals: live formulas over the item rows, with cached results; the dashes are skipped
  const total = sheet.getRow(7);
  assert.equal(total.getCell(1).value, 'סה"כ כללי');
  const net = total.getCell(8).value as { formula: string; result: number };
  assert.equal(net.formula, 'ROUND(SUM(H2:H6),2)');
  near(net.result, 16 + 1.92 + 1);
  const order = total.getCell(10).value as { formula: string; result: number };
  assert.equal(order.formula, 'ROUND(SUM(J2:J6),2)');
  near(order.result, 16.8 + 1.92 + 1);
  assert.equal(total.getCell(7).value, 5);

  // by type and grade, then the missing note
  const texts: string[] = [];
  sheet.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && texts.push(c.value)));
  assert.ok(texts.includes('סיכום לפי סוג ודרגה'));
  assert.ok(texts.some((t) => t.includes('חסרים נתונים: 2')));
  // numeric cells carry number formats, not text
  assert.equal(sheet.getCell('H2').numFmt, '#,##0.00');
});

test('concrete sheet in English', async () => {
  const sheet = (await reread(build(structuralOnly([el({ mark: 'S01', grade: 'B30' })]), 'en'))).getWorksheet('Concrete')!;
  assert.deepEqual(rowOf(sheet, 1).slice(0, 4), ['Page', 'Mark', 'Type', 'Concrete grade']);
  assert.deepEqual(rowOf(sheet, 2).slice(1, 4), ['Slab 01', 'Slab', 'B30']);
  assert.equal(sheet.views[0].rightToLeft, false);
  assert.equal(sheet.getRow(3).getCell(1).value, 'Grand total');
});

// ---------- Excel: rebar ----------

test('rebar sheet: numbers stay numbers, estimates are marked by format and Basis, missing is a dash, totals are formulas', async () => {
  const p = structuralOnly(undefined, [
    mesh([layer({ diameterMm: 12, spacingM: 0.2, direction: 'long' }), layer({ diameterMm: 10, spacingM: 0.25, direction: 'short' })], { mark: 'M01' }), // 410 + 328 (directional Bottom)
    mesh([layer({ diameterMm: 12, spacingM: 0.15 })], { mark: 'M02', points: L_SHAPE }), // estimate 180
    bars({ mark: 'R01', diameterMm: 16, count: 10, lengthM: 6, wastePercent: 10 }), // 60 / 66
    mesh([layer({ diameterMm: 0 })], { mark: 'M03' }), // incomplete
    mesh([layer()], { mark: 'M04', pageNumber: 3, points: [], sizeOverride: { lengthM: 6, widthM: 4 } }), // manual size, uncalibrated page: 21 × 6 = 126
  ]);
  const wb = await reread(build(p));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['זיון']);
  const sheet = wb.getWorksheet('זיון')!;
  assert.equal(rowOf(sheet, 1).length, 16);
  assert.deepEqual(rowOf(sheet, 1).slice(0, 7), ['עמוד', 'סימון', 'סוג', 'מפלס זיון', 'קוטר (מ"מ)', 'מרווח (ס"מ)', 'כיוון']);
  const rows = [2, 3, 4, 5, 6, 7].map((r) => rowOf(sheet, r));
  const [l1, l2, est, man, bad, size] = rows;

  // columns: 0 page, 1 mark, 2 type, 3 level, 4 diameter, 5 spacing, 6 direction, 7 bars, 8 bar length, 9 net, 10 net kg, 11 waste, 12 order, 13 order kg, 14 basis, 15 status
  assert.deepEqual([l1[1], l1[2], l1[3], l1[4], l1[5], l1[6]], ['רשת 01', 'רשת', 'תחתון', 12, 20, 'צלע ארוכה']);
  assert.equal(l1[7], 41); // bars (numeric)
  near(l1[8], 10); // bar length
  near(l1[9], 410);
  assert.equal(l1[14], 'מדויק');
  near(l2[9], 328);
  assert.deepEqual([l2[3], l2[4], l2[5], l2[6]], ['תחתון', 10, 25, 'צלע קצרה']);

  // the estimate: still true numbers, no bar count, ≈ number format, Basis says Estimate
  assert.equal(typeof est[9], 'number');
  assert.equal(typeof est[10], 'number');
  near(est[9], 180);
  assert.deepEqual([est[7], est[8]], ['-', '-']);
  assert.equal(est[14], 'הערכה');
  for (const addr of ['J4', 'K4', 'M4', 'N4']) assert.ok(sheet.getCell(addr).numFmt.includes('≈'), addr);
  assert.equal(sheet.getCell('J2').numFmt, '#,##0.00'); // an exact row has no ≈

  // manual bars: no level, spacing or direction
  assert.deepEqual([man[1], man[2], man[3], man[4], man[5], man[6]], ['מוטות 01', 'מוטות', '-', 16, '-', '-']);
  assert.equal(man[7], 10);
  near(man[9], 60);
  near(man[12], 66);

  // not calculable: dashes and the reason, not 0
  assert.deepEqual([bad[9], bad[10], bad[12], bad[13], bad[14], bad[15]], ['-', '-', '-', '-', '-', 'נתונים חסרים']);

  // manual size on the uncalibrated page is calculated
  assert.equal(size[0], 3);
  near(size[9], 126);
  assert.equal(size[15], 'תקין');

  // totals: formulas over the item rows (text is skipped), exact + estimate = "includes estimate"
  const total = sheet.getRow(8);
  const len = total.getCell(10).value as { formula: string; result: number };
  assert.equal(len.formula, 'ROUND(SUM(J2:J7),2)');
  near(len.result, 410 + 328 + 180 + 60 + 126);
  assert.equal((total.getCell(11).value as { formula: string }).formula, 'ROUND(SUM(K2:K7),2)');
  assert.equal((total.getCell(13).value as { formula: string }).formula, 'ROUND(SUM(M2:M7),2)');
  assert.equal((total.getCell(14).value as { formula: string }).formula, 'ROUND(SUM(N2:N7),2)');
  assert.equal(total.getCell(15).value, 'כולל הערכה');

  const texts: string[] = [];
  sheet.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && texts.push(c.value)));
  assert.ok(texts.includes('סיכום לפי קוטר'));
  assert.ok(texts.some((t) => t.startsWith('כולל הערכה: 180')));
  assert.ok(texts.some((t) => t.includes('חסרים נתונים: 1')));
});

test('an estimate-only rebar plan: totals carry the ≈ format, Basis says Estimate, and a note says so', async () => {
  const wb = await reread(build(structuralOnly(undefined, [mesh([layer()], { points: L_SHAPE })]), 'en'));
  const sheet = wb.getWorksheet('Rebar')!;
  const total = sheet.getRow(3);
  assert.equal(total.getCell(15).value, 'Estimate');
  assert.ok(total.getCell(10).numFmt.includes('≈'));
  assert.equal(typeof (total.getCell(10).value as { result: number }).result, 'number');
  const texts: string[] = [];
  sheet.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && texts.push(c.value)));
  assert.ok(texts.some((t) => t.includes('not a bar count')));
});

test('concrete and rebar together: both sheets, selected-page filtering applies to both', async () => {
  const p = structuralOnly(
    [el({ pageNumber: 1, mark: 'S01' }), el({ pageNumber: 2, mark: 'S02' })],
    [bars({ pageNumber: 1, mark: 'R01' }), bars({ pageNumber: 2, mark: 'R02' })]
  );
  const all = await reread(buildQuantitiesWorkbook([], [], 'he', buildStructuralReport(p)));
  assert.deepEqual(all.worksheets.map((s) => s.name), ['בטון', 'זיון']);
  const filtered = await reread(buildQuantitiesWorkbook([], [], 'he', buildStructuralReport(withStructuralPages(p, new Set([2])))));
  assert.equal(filtered.getWorksheet('בטון')!.getRow(2).getCell(2).value, 'תקרה 02');
  assert.equal(filtered.getWorksheet('בטון')!.getRow(3).getCell(1).value, 'סה"כ כללי');
  assert.equal(filtered.getWorksheet('זיון')!.getRow(2).getCell(2).value, 'מוטות 02');
  // a page with nothing structural: no structural sheets at all
  assert.equal((await reread(buildQuantitiesWorkbook([], [], 'he', buildStructuralReport(withStructuralPages(p, new Set([9])))))).worksheets.length, 0);
});

// ---------- PDF ----------

test('PDF layout: summary and item tables, ~ on estimates, dashes and a missing note, nothing for no data', () => {
  const p = structuralOnly(
    [el({ mark: 'S01', grade: 'B30' }), el({ mark: 'S02', depthM: undefined })],
    [mesh([layer()], { mark: 'M01', points: L_SHAPE }), mesh([layer()], { mark: 'M02' }), bars({ mark: 'R01' }), mesh([layer({ diameterMm: 0 })], { mark: 'M03' })]
  );
  const blocks = buildStructuralPdfLayout(buildStructuralReport(p), exportContext('en'));
  const sections = blocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title);
  assert.deepEqual(sections, ['Concrete - Summary by type and grade', 'Concrete - Concrete elements', 'Rebar - Summary by diameter', 'Rebar - Rebar items']);
  const tables = blocks.filter((b) => b.type === 'table') as Extract<(typeof blocks)[number], { type: 'table' }>[];
  assert.equal(tables.length, 4);
  for (const t of tables) for (const r of t.rows) assert.equal(r.cells.length, t.headers.length);

  const [cSummary, cItems, rSummary, rItems] = tables;
  assert.deepEqual(cSummary.rows.at(-1)!.cells.slice(0, 4), ['Grand total', '', '', '2']);
  assert.equal(cSummary.rows.at(-1)!.cells[6], '1'); // one not calculable
  assert.equal(cItems.rows[1].cells[6], '-'); // net of the missing one: a dash
  assert.equal(cItems.rows[1].cells[8], 'Height missing'.replace('Height', 'Thickness')); // slab → thickness
  assert.equal(cItems.rows[0].cells[8], ''); // OK rows stay quiet

  const mixedTotal = rSummary.rows.at(-1)!;
  assert.equal(mixedTotal.cells[6], 'Includes estimate');
  const est = rItems.rows.find((r) => r.cells[1] === 'Mesh 01 - Bottom')!;
  assert.ok(est.cells[4].startsWith('~ ')); // the printed estimate is marked
  assert.equal(est.cells[3], '-'); // no bar count
  assert.equal(est.cells[7], 'Estimate');
  assert.equal(rItems.rows.find((r) => r.cells[1] === 'Mesh 02 - Bottom')!.cells[3], '41 × 10');
  assert.equal(rItems.rows.find((r) => r.cells[1] === 'Mesh 03 - Bottom')!.cells[7], 'Data missing');
  const notes = blocks.filter((b) => b.type === 'note').map((b) => (b as { text: string }).text);
  assert.ok(notes.some((t) => t.startsWith('Includes estimate: ')));
  assert.ok(notes.some((t) => t === 'Missing data: 1 - not included in the totals.'));

  assert.deepEqual(buildStructuralPdfLayout(buildStructuralReport(PLAN_A), exportContext('he')), []);
});

test('PDF layout in Hebrew uses the Hebrew words', () => {
  const blocks = buildStructuralPdfLayout(buildStructuralReport(structuralOnly([el({})])), exportContext('he'));
  assert.deepEqual(blocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title), ['בטון - סיכום לפי סוג ודרגה', 'בטון - אלמנטי בטון']);
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
