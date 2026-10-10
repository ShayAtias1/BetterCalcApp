// Export Part B: the plan Excel (content selection, item-first Concrete and Rebar sheets), the project
// Excel (same rows behind a Plan column) and the project PDF (Mesh levels and Straight Bars behind a Plan column). Every structural sheet is DETAIL rows then ONE total row - no summary blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PLAN_A, PLAN_B } from './fixtures.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { buildProjectStructural, buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import { buildProjectStructuralPdfLayout } from '../../src/lib/structuralPdfLayout.ts';
import { ALL_CONTENT, NO_CONTENT, selectStructural, type ExportContent } from '../../src/lib/exportContent.ts';
import { withStructuralPages } from '../../src/lib/structuralPlan.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import type { Plan, Point, Project } from '../../src/types/index.ts';
import type { ConcreteElement, MeshReinforcement, RebarItem, RebarMesh } from '../../src/types/structural.ts';

const cal = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
const u = (d: number, s: number): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm: d, spacingM: s } });
let n = 0;
const slab = (extra: Partial<ConcreteElement> = {}): ConcreteElement => ({ id: `c${n++}`, pageNumber: 1, kind: 'slab', mark: '', autoNumber: n, points: rect(1000, 800), depthM: 0.2, wastePercent: 0, ...extra });
const mesh = (extra: Partial<RebarMesh> = {}): RebarMesh => ({ id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: '', autoNumber: n, points: rect(1000, 400), bottom: u(12, 0.2), wastePercent: 0, ...extra });
const bars = (extra: Partial<Extract<RebarItem, { kind: 'bars' }>> = {}): RebarItem => ({ id: `b${n++}`, kind: 'bars', pageNumber: 1, mark: '', autoNumber: n, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 0, ...extra });

/** A plan with finishes untouched (PLAN_A) or stripped, plus structural items; pages 1-2 calibrated, 3 not. */
function plan(id: string, name: string, concrete: ConcreteElement[], rebar: RebarItem[], withFinishes = false): Plan {
  const p = structuredClone(PLAN_A);
  p.id = id;
  p.name = name;
  if (!withFinishes) {
    p.rooms = [];
    p.measurements = [];
    p.markups = [];
  }
  p.pages = { 1: { pageNumber: 1, calibration: cal }, 2: { pageNumber: 2, calibration: cal }, 3: { pageNumber: 3, calibration: null } };
  p.concreteElements = concrete;
  p.rebarItems = rebar;
  return p;
}

async function reread(wb: ExcelJS.Workbook) {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
}
const rowOf = (sheet: ExcelJS.Worksheet, r: number) => (sheet.getRow(r).values as unknown[]).slice(1);
const texts = (sheet: ExcelJS.Worksheet) => {
  const out: string[] = [];
  sheet.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && out.push(c.value)));
  return out;
};
const near = (a: unknown, b: number, eps = 1e-6) => assert.ok(typeof a === 'number' && Math.abs(a - b) < eps, `${String(a)} vs ${b}`);

/** The plan workbook exactly as the Excel dialog builds it: Finishes only when chosen, structural sections as chosen, on the chosen pages. */
function planWorkbook(p: Plan, content: ExportContent, lang: 'he' | 'en' = 'en', pages?: number[]) {
  const scoped = pages ? withStructuralPages(p, new Set(pages)) : p;
  const pageSet = pages ? new Set(pages) : null;
  const summaries = content.finishes ? buildRoomSummaries(p).filter((s) => !pageSet || pageSet.has(p.rooms.find((r) => r.id === s.roomId)?.pageNumber ?? -1)) : [];
  const areas = content.finishes ? p.measurements.filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number') : [];
  return buildQuantitiesWorkbook(summaries, areas, lang, selectStructural(buildStructuralReport(scoped), content));
}
const only = (...keys: (keyof ExportContent)[]): ExportContent => ({ ...NO_CONTENT, ...Object.fromEntries(keys.map((k) => [k, true])) });
const names = (wb: ExcelJS.Workbook) => wb.worksheets.map((s) => s.name);

const MIXED = () =>
  plan('a', 'Plan A', [slab({ autoNumber: 1 })], [mesh({ autoNumber: 1 }), bars({ autoNumber: 1 })], true);

// ---------- plan Excel: content selection ----------

test('plan Excel content: any combination, no sheet for an unselected domain, Finishes sheets untouched', async () => {
  const p = MIXED();
  const finishesOnly = names(planWorkbook(p, only('finishes')));
  assert.ok(finishesOnly.length > 0 && !finishesOnly.includes('Concrete') && !finishesOnly.includes('Rebar'));
  assert.deepEqual(names(planWorkbook(p, only('concrete'))), ['Concrete']);
  assert.deepEqual(names(planWorkbook(p, only('rebar'))), ['Rebar']);
  assert.deepEqual(names(planWorkbook(p, only('concrete', 'rebar'))), ['Concrete', 'Rebar']);
  assert.deepEqual(names(planWorkbook(p, ALL_CONTENT)), [...finishesOnly, 'Concrete', 'Rebar']); // structural sheets come last
  // Finishes sheets are identical whether or not structural sheets follow
  const dump = async (wb: ExcelJS.Workbook) => (await reread(wb)).worksheets.slice(0, finishesOnly.length).map((s) => JSON.stringify(s.getSheetValues()));
  assert.deepEqual(await dump(planWorkbook(p, ALL_CONTENT)), await dump(planWorkbook(p, only('finishes'))));
  // Excel has no plan section: selecting it adds nothing
  assert.deepEqual(names(planWorkbook(p, only('plan'))), []);
});

test('plan Excel pages: content and pages are separate filters; a selected domain with nothing on the pages gets no empty sheet', async () => {
  const p = plan('a', 'Plan A', [slab({ pageNumber: 1, autoNumber: 1 }), slab({ pageNumber: 2, autoNumber: 2 })], [mesh({ pageNumber: 1, autoNumber: 1 })]);
  const page2 = await reread(planWorkbook(p, ALL_CONTENT, 'en', [2]));
  assert.deepEqual(names(page2), ['Concrete']); // page 2 has no rebar: no Rebar sheet
  assert.equal(page2.getWorksheet('Concrete')!.getRow(2).getCell(3).value, 'Slab 02');
  assert.deepEqual(names(planWorkbook(p, ALL_CONTENT, 'en', [3])), []);
});

// ---------- plan Excel: Concrete ----------

test('plan Excel Concrete: one row per element, then ONE total row - no summary block; numbers numeric, missing is a dash', async () => {
  const p = plan('a', 'Plan A', [
    slab({ autoNumber: 1, grade: 'B30', wastePercent: 5 }), // 80 m² × 0.2 = 16 / 16.8
    slab({ mark: 'קורה A', markManual: true, kind: 'wall', points: rect(500, 20), depthM: 3 }), // 1 × 3 = 3
    slab({ autoNumber: 3, depthM: undefined }), // thickness missing
    slab({ autoNumber: 4, pageNumber: 3 }), // page not calibrated
  ], []);
  const sheet = (await reread(planWorkbook(p, only('concrete'), 'en'))).getWorksheet('Concrete')!;
  assert.deepEqual(rowOf(sheet, 1), ['Page', 'Type', 'Mark', 'Concrete grade', 'Dimension', 'Net (m3)'.replace('m3', 'm³'), 'Waste (%)', 'To order (m³)', 'Status']);
  assert.equal(sheet.rowCount, 1 + 4 + 1); // header + items + total: nothing underneath
  const [s1, wall, missing, uncal] = [2, 3, 4, 5].map((r) => rowOf(sheet, r));
  assert.deepEqual(s1.slice(0, 5), [1, 'Slab', 'Slab 01', 'B30', '20 cm']);
  near(s1[5], 16);
  assert.equal(typeof s1[5], 'number');
  near(s1[7], 16.8);
  assert.equal(s1[8], 'OK');
  assert.deepEqual([wall[1], wall[2], wall[4]], ['Wall', 'קורה A', '3 m']);
  assert.deepEqual([missing[4], missing[5], missing[7], missing[8]], ['-', '-', '-', 'Thickness missing']);
  assert.deepEqual([uncal[5], uncal[7], uncal[8]], ['-', '-', 'Page not calibrated']);
  // the total row: live SUM formulas, a dash is skipped; the missing count sits in the Status cell
  const total = sheet.getRow(6);
  assert.equal(total.getCell(2).value, 'Total');
  const net = total.getCell(6).value as { formula: string; result: number };
  assert.equal(net.formula, 'ROUND(SUM(F2:F5),2)');
  near(net.result, 19);
  assert.equal((total.getCell(8).value as { formula: string }).formula, 'ROUND(SUM(H2:H5),2)');
  assert.equal(total.getCell(9).value, 'Missing data: 2');
  assert.equal(sheet.getCell('F2').numFmt, '#,##0.00');
  const all = texts(sheet);
  assert.ok(!all.some((t) => /Summary|By plan|not included/i.test(t)));
  // Hebrew
  const he = (await reread(planWorkbook(p, only('concrete'), 'he'))).getWorksheet('בטון')!;
  assert.deepEqual([rowOf(he, 2)[1], rowOf(he, 2)[2], rowOf(he, 3)[2], rowOf(he, 6)[1]], ['תקרה', 'תקרה 01', 'קורה A', 'סה"כ']);
  assert.equal(he.views[0].rightToLeft, true);
});

// ---------- plan Excel: Rebar ----------

test('plan Excel Rebar: Mesh per level and Bars as items; sheet count, size and overlap; weights numeric; one total row', async () => {
  const p = plan('a', 'Plan A', [], [
    mesh({ autoNumber: 1, bottom: u(12, 0.2), top: u(10, 0.15) }), // 10 × 4 m: 4 sheets per level
    mesh({ autoNumber: 2, bottom: { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } }, sheets: { lengthM: 12, widthM: 4, overlapM: 0.5 }, wastePercent: 5 }),
    mesh({ autoNumber: 3, points: L_SHAPE }), // free polygon: estimate, no sheet count
    bars({ autoNumber: 1, wastePercent: 10 }),
    mesh({ autoNumber: 4, bottom: u(0, 0) }), // incomplete
  ]);
  const sheet = (await reread(planWorkbook(p, only('rebar'), 'en'))).getWorksheet('Rebar')!;
  assert.deepEqual(rowOf(sheet, 1), ['Page', 'Type', 'Mark', 'Level', 'Specification', 'Quantity', 'Sheet size', 'Overlap (cm)', 'Net weight (kg)', 'Waste (%)', 'To order (kg)', 'Status']);
  assert.equal(sheet.rowCount, 1 + 6 + 1); // header + (Bottom, Top, directional Bottom, irregular, bars, incomplete) + total
  const rows = [2, 3, 4, 5, 6, 7].map((r) => rowOf(sheet, r));
  const [bottom, top, dir, irregular, manual, incomplete] = rows;

  // Top and Bottom: separate rows under one mark, each with its own sheet count
  assert.deepEqual(bottom.slice(1, 8), ['Mesh', 'Mesh 01', 'Bottom', 'Ø12 @ 20 cm - Both directions', '4 sheets', '6.00 × 2.50 m', 80]);
  assert.deepEqual(top.slice(1, 8), ['Mesh', 'Mesh 01', 'Top', 'Ø10 @ 15 cm - Both directions', '4 sheets', '6.00 × 2.50 m', 80]);
  // directional: ONE row with both sides, custom sheet size and overlap
  assert.deepEqual(dir.slice(1, 8), ['Mesh', 'Mesh 02', 'Bottom', 'Long side Ø12 @ 20 | Short side Ø10 @ 15', '1 sheet', '12.00 × 4.00 m', 50]);
  // numbers stay numbers
  for (const r of [bottom, top, dir]) {
    assert.equal(typeof r[8], 'number');
    assert.equal(typeof r[10], 'number');
  }
  assert.equal(dir[9], 5);
  assert.equal(bottom[11], 'Exact');
  // irregular: weight is an estimate (numeric, ≈ format), no sheet quantity or sheet data
  assert.deepEqual([irregular[5], irregular[6], irregular[7], irregular[11]], ['-', '-', '-', 'Estimate']);
  assert.equal(typeof irregular[8], 'number');
  assert.ok(sheet.getCell('I5').numFmt.includes('≈'));
  assert.equal(sheet.getCell('I2').numFmt, '#,##0.00');
  // manual bars: no level or sheet fields
  assert.deepEqual(manual.slice(1, 8), ['Bars', 'Bars 01', '-', 'Ø16', '10 bars', '-', '-']);
  near(manual[8], 94.7, 0.05);
  // incomplete: dashes and the reason, never 0
  assert.deepEqual([incomplete[8], incomplete[10], incomplete[11]], ['-', '-', 'Data missing']);

  // one total row of weights: formulas over the item rows, status Includes estimate + missing count; no sheet/bar sum
  const total = sheet.getRow(8);
  assert.equal(total.getCell(2).value, 'Total');
  assert.equal(total.getCell(6).value, '');
  assert.equal((total.getCell(9).value as { formula: string }).formula, 'ROUND(SUM(I2:I7),2)');
  assert.equal(total.getCell(11).value, '-'); // irregular Mesh has no physical purchase weight
  assert.equal(total.getCell(12).value, 'Includes estimate · Missing data: 1');
  const all = texts(sheet);
  assert.ok(!all.some((t) => /Summary|diameter|By plan|Bar lines|not a bar count/i.test(t)));
  // Hebrew
  const he = (await reread(planWorkbook(p, only('rebar'), 'he'))).getWorksheet('זיון')!;
  assert.deepEqual(rowOf(he, 2).slice(1, 6), ['רשת', 'רשת 01', 'תחתון', 'Ø12 @ 20 ס"מ - שני הכיוונים', '4 רשתות']);
  assert.equal(rowOf(he, 6)[5], '10 מוטות');
  assert.ok(!texts(he).some((t) => t.includes('שורות זיון')));
});

test('plan Excel Rebar: old meshes (flat layers) and an estimate-only plan', async () => {
  const old = mesh({ autoNumber: 1, bottom: undefined, layers: [{ id: 'l1', diameterMm: 12, spacingM: 0.2, direction: 'long' }, { id: 'l2', diameterMm: 12, spacingM: 0.2, direction: 'short' }] });
  const sheet = (await reread(planWorkbook(plan('a', 'A', [], [old]), only('rebar')))).getWorksheet('Rebar')!;
  assert.equal(rowOf(sheet, 2)[4], 'Ø12 @ 20 cm - Both directions'); // read as one uniform Bottom level
  const est = (await reread(planWorkbook(plan('a', 'A', [], [mesh({ points: L_SHAPE })]), only('rebar')))).getWorksheet('Rebar')!;
  const total = est.getRow(3);
  assert.equal(total.getCell(12).value, 'Estimate');
  assert.ok(total.getCell(9).numFmt.includes('≈'));
});

// ---------- project Excel ----------

const PROJECT = (ids: string[]): Project => ({ id: 'p', name: 'פרויקט', createdAt: 0, updatedAt: 0, planIds: ids });

test('project Excel: one item row per element / mesh level / bars item behind a Plan column, one total row, no summary blocks', async () => {
  const a = plan('a', 'Plan A', [slab({ autoNumber: 1, grade: 'B30' }), slab({ autoNumber: 2, depthM: undefined })], [mesh({ autoNumber: 1, top: u(10, 0.15) }), bars({ autoNumber: 1 })]);
  const b = plan('b', 'Plan B', [slab({ autoNumber: 1, depthM: 0.3 })], [mesh({ autoNumber: 1, points: L_SHAPE })]);
  const wb = await reread(buildProjectWorkbook(PROJECT(['a', 'b']), [a, b], 'en'));
  assert.deepEqual(names(wb), ['Project Summary', 'Plans', 'Rooms', 'Work Types', 'Concrete', 'Rebar']);

  const cs = wb.getWorksheet('Concrete')!;
  assert.deepEqual(rowOf(cs, 1).slice(0, 4), ['Plan', 'Page', 'Type', 'Mark']);
  assert.equal(cs.rowCount, 1 + 3 + 1);
  assert.deepEqual([rowOf(cs, 2)[0], rowOf(cs, 3)[0], rowOf(cs, 4)[0]], ['Plan A', 'Plan A', 'Plan B']);
  assert.equal(rowOf(cs, 3)[9], 'Thickness missing');
  const net = cs.getRow(5).getCell(7).value as { formula: string; result: number };
  assert.equal(net.formula, 'ROUND(SUM(G2:G4),2)'); // shifted one column by Plan
  near(net.result, 16 + 24);
  assert.equal(cs.getRow(5).getCell(10).value, 'Missing data: 1');
  assert.ok(!texts(cs).some((t) => /Summary by|By plan/i.test(t)));

  const rs = wb.getWorksheet('Rebar')!;
  assert.deepEqual(rowOf(rs, 1).slice(0, 5), ['Plan', 'Page', 'Type', 'Mark', 'Level']);
  // Plan A: Mesh 01 Bottom + Top, Bars 01; Plan B: the irregular Mesh 01
  assert.equal(rs.rowCount, 1 + 4 + 1);
  assert.deepEqual([2, 3, 4, 5].map((r) => rowOf(rs, r)[0]), ['Plan A', 'Plan A', 'Plan A', 'Plan B']);
  assert.deepEqual(rowOf(rs, 2).slice(2, 8), ['Mesh', 'Mesh 01', 'Bottom', 'Ø12 @ 20 cm - Both directions', '4 sheets', '6.00 × 2.50 m']);
  assert.equal(rowOf(rs, 3)[4], 'Top');
  assert.deepEqual([rowOf(rs, 5)[6], rowOf(rs, 5)[12]], ['-', 'Estimate']);
  const total = rs.getRow(6);
  assert.equal((total.getCell(10).value as { formula: string }).formula, 'ROUND(SUM(J2:J5),2)');
  assert.equal(total.getCell(13).value, 'Includes estimate');
  assert.ok(!texts(rs).some((t) => /Summary|By plan|diameter/i.test(t)));
});

test('project Excel content: structural-only selection, structural-only project, and no regression without structural data', async () => {
  const a = plan('a', 'Plan A', [slab({ autoNumber: 1 })], [bars({ autoNumber: 1 })]);
  assert.deepEqual(names(buildProjectWorkbook(PROJECT(['a']), [a], 'en', only('concrete', 'rebar'))), ['Concrete', 'Rebar']);
  assert.deepEqual(names(buildProjectWorkbook(PROJECT(['a']), [a], 'en', only('rebar'))), ['Rebar']);
  assert.deepEqual(names(buildProjectWorkbook(PROJECT(['a']), [a], 'en', only('finishes'))), ['Project Summary', 'Plans', 'Rooms', 'Work Types']);
  // a project without structural data: exactly the old sheets, whichever sections are selected
  assert.deepEqual(names(buildProjectWorkbook(PROJECT(['plan-a', 'plan-b']), [PLAN_A, PLAN_B], 'he', ALL_CONTENT)), ['סיכום פרויקט', 'תוכניות', 'חדרים', 'סוגי עבודה']);
  assert.deepEqual(names(buildProjectWorkbook(PROJECT(['plan-a']), [PLAN_A], 'he', only('concrete', 'rebar'))), []);
  const he = await reread(buildProjectWorkbook(PROJECT(['a']), [a], 'he', only('concrete')));
  assert.equal(he.getWorksheet('בטון')!.views[0].rightToLeft, true);
  assert.equal(rowOf(he.getWorksheet('בטון')!, 1)[0], 'תוכנית');
});

// ---------- project PDF ----------

type Table = Extract<ReturnType<typeof buildProjectStructuralPdfLayout>[number], { type: 'table' }>;

test('project PDF: Mesh levels and Straight Bars items with plan context, procurement on each mesh, separate totals', () => {
  const a = plan('a', 'Plan A', [slab({ autoNumber: 1, grade: 'B30' }), slab({ autoNumber: 2, depthM: undefined })], [mesh({ autoNumber: 1, top: u(10, 0.15) }), bars({ autoNumber: 1 })]);
  const b = plan('b', 'Plan B', [slab({ autoNumber: 1, grade: 'B30', depthM: 0.3 })], [mesh({ autoNumber: 1, points: L_SHAPE }), mesh({ autoNumber: 2, sheets: { lengthM: 4, widthM: 2, overlapM: 0.5 } }), mesh({ autoNumber: 3 })]);
  const structural = buildProjectStructural([a, b]);
  const blocks = buildProjectStructuralPdfLayout(structural, exportContext('en'), [a, b]);
  assert.deepEqual(blocks.filter((x) => x.type === 'section').map((x) => (x as { title: string }).title), ['Concrete', 'Rebar - Mesh', 'Rebar - Bars']);
  assert.equal(blocks.filter((x) => x.type === 'note').length, 0);
  const [concrete, meshes, straight] = blocks.filter((x): x is Table => x.type === 'table');
  for (const table of [concrete, meshes, straight]) {
    assert.equal(table.weights.length, table.headers.length);
    for (const r of table.rows) assert.equal(r.cells.length, table.headers.length);
  }
  // Concrete remains grouped by type and grade; missing data is still counted.
  assert.deepEqual(concrete.rows.map((r) => r.cells[0]), ['Slab', 'Slab', 'Total']);
  assert.equal(concrete.rows.at(-1)!.cells[5], 'Missing data: 1');
  assert.deepEqual(meshes.headers, ['Plan', 'Page', 'Type', 'Mark', 'Level', 'Specification', 'Sheets', 'Sheet size · overlap', 'Net weight (kg)', 'To order (kg)', 'Status']);
  assert.equal(meshes.rows.length, 6); // five levels and their weight total
  assert.deepEqual(meshes.rows[0].cells.slice(0, 8), ['Plan A', '1', 'Mesh', 'Mesh 01', 'Bottom', 'Ø12 @ 20 cm - Both directions', '4 sheets', '6.00 × 2.50 m · 80 cm']);
  assert.deepEqual(meshes.rows[1].cells.slice(0, 8), ['Plan A', '1', 'Mesh', 'Mesh 01', 'Top', 'Ø10 @ 15 cm - Both directions', '4 sheets', '6.00 × 2.50 m · 80 cm']);
  assert.deepEqual(meshes.rows[2].cells.slice(0, 5), ['Plan B', '1', 'Mesh', 'Mesh 01', 'Bottom']);
  assert.deepEqual(meshes.rows[2].cells.slice(6, 8), ['-', '-']); // free polygon: no procurement count
  assert.equal(meshes.rows[2].cells[10], 'Estimate');
  assert.ok(meshes.rows[2].cells[8].startsWith('~ '));
  assert.deepEqual(meshes.rows[3].cells.slice(6, 8), ['7 sheets', '4.00 × 2.00 m · 50 cm']);
  assert.deepEqual(meshes.rows[4].cells.slice(6, 8), ['4 sheets', '6.00 × 2.50 m · 80 cm']);
  const meshTotal = meshes.rows.at(-1)!;
  assert.deepEqual(meshTotal.cells.slice(3, 8), ['', '', '', '', '']); // no total sheets or mesh lengths
  assert.equal(meshTotal.cells[10], 'Includes estimate');
  assert.ok(meshTotal.bold);
  assert.deepEqual(straight.headers, ['Plan', 'Page', 'Type', 'Mark', 'Diameter (mm)', 'Number of bars', 'Length per bar (m)', 'Total length (m)', 'Net weight (kg)', 'To order (kg)', 'Status']);
  assert.deepEqual(straight.rows[0].cells.slice(0, 8), ['Plan A', '1', 'Bars', 'Bars 01', '16', '10', '6', '60']);
  assert.equal(straight.rows.length, 2);
  assert.equal(straight.rows.at(-1)!.cells[7], '60');
  assert.equal(straight.rows.at(-1)!.cells[10], 'Exact');
  // Both product totals sum unrounded existing level weights; no quantities are lost.
  const levels = [a, b].flatMap((p) => buildStructuralReport(p).rebar!.levels);
  for (const [kind, table] of [['mesh', meshes], ['bars', straight]] as const) {
    for (const [field, column] of [['netWeightKg', 8], ['orderWeightKg', 9]] as const) {
      const included = levels.filter((d) => d.kind === kind && d.netWeightKg !== null);
      const expected = included.reduce((total, d) => total + (d[field] ?? 0), 0);
      assert.equal(table.rows.at(-1)!.cells[column], (field === 'orderWeightKg' && kind === 'mesh' ? levels.filter((d) => d.kind === kind) : included).some((d) => d[field] === null) ? '-' : exportContext('en').number(Math.round(expected * 100) / 100));
    }
  }
  const printed = JSON.stringify(blocks);
  assert.ok(!/Mesh sheets|Bar lines|layer|reinforcement length|order length/i.test(printed));
  const he = buildProjectStructuralPdfLayout(structural, exportContext('he'), [a, b]);
  assert.deepEqual(he.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title), ['בטון', 'זיון - רשת', 'זיון - מוטות']);
  assert.ok(!/יריעות רשת|שורות זיון/.test(JSON.stringify(he)));

});

test('project PDF selection: only the chosen domains; structural-only and estimate-only projects; no structural data gives nothing', () => {
  const a = plan('a', 'Plan A', [slab({ autoNumber: 1 })], [mesh({ autoNumber: 1, points: L_SHAPE })]);
  const structural = buildProjectStructural([a]);
  const x = exportContext('en');
  const titles = (include: { concrete: boolean; rebar: boolean }) => buildProjectStructuralPdfLayout(structural, x, [a], include).filter((b) => b.type === 'section').map((b) => (b as { title: string }).title);
  assert.deepEqual(titles({ concrete: true, rebar: false }), ['Concrete']);
  assert.deepEqual(titles({ concrete: false, rebar: true }), ['Rebar - Mesh']); // only the Mesh product table
  assert.deepEqual(titles({ concrete: false, rebar: false }), []);
  const rebar = buildProjectStructuralPdfLayout(structural, x, [a]).filter((b): b is Table => b.type === 'table')[1];
  assert.equal(rebar.rows.at(-1)!.cells[10], 'Estimate');
  assert.ok(rebar.rows.at(-1)!.cells[8].startsWith('~ '));
  assert.deepEqual(buildProjectStructuralPdfLayout(buildProjectStructural([PLAN_A]), x, [PLAN_A]), []);
});


test('project PDF: directional and legacy Mesh reuse level rows; missing items stay visible and excluded from separate totals', () => {
  const a = plan('a', 'Plan A', [], [
    mesh({ autoNumber: 1, mark: 'M-custom', markManual: true, pageNumber: 2, bottom: { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } }, wastePercent: 10 }),
    mesh({ id: 'missing', autoNumber: 2, bottom: u(0, 0), top: u(12, 0.2) }),
    mesh({ autoNumber: 3, bottom: undefined, layers: [{ id: 'l1', diameterMm: 12, spacingM: 0.2, direction: 'long' }, { id: 'l2', diameterMm: 12, spacingM: 0.2, direction: 'short' }] }),
    bars({ autoNumber: 1, count: 3, lengthM: 2.5, wastePercent: 20 }),
    bars({ autoNumber: 2, diameterMm: 0 }),
  ]);
  const b = plan('b', 'Plan B', [], [mesh({ id: 'missing', autoNumber: 1, pageNumber: 3 })]); // no calibration
  const x = exportContext('en');
  const [meshes, straight] = buildProjectStructuralPdfLayout(buildProjectStructural([a, b]), x, [a, b]).filter((b): b is Table => b.type === 'table');
  const dir = meshes.rows.find((r) => r.cells[3] === 'M-custom')!;
  assert.equal(dir.cells[1], '2');
  assert.equal(dir.cells[5], 'Long side Ø12 @ 20 | Short side Ø10 @ 15');
  assert.equal(meshes.rows.filter((r) => r.cells[3] === 'M-custom').length, 1);
  assert.equal(meshes.rows.find((r) => r.cells[3] === 'Mesh 03')!.cells[5], 'Ø12 @ 20 cm - Both directions');
  assert.equal(meshes.rows.at(-1)!.cells[10], 'Exact · Missing data: 2'); // two bad levels of one item counted once
  assert.deepEqual(straight.rows[0].cells.slice(5, 8), ['3', '2.5', '7.5']);
  assert.equal(straight.rows.at(-1)!.cells[7], '7.5');
  assert.equal(straight.rows.at(-1)!.cells[10], 'Exact · Missing data: 1');
  for (const [kind, table] of [['mesh', meshes], ['bars', straight]] as const) {
    const levels = [a, b].flatMap((p) => buildStructuralReport(p).rebar!.levels).filter((d) => d.kind === kind && d.netWeightKg !== null);
    for (const [field, column] of [['netWeightKg', 8], ['orderWeightKg', 9]] as const) {
      const unknownPurchase = kind === 'mesh' && field === 'orderWeightKg' && [a, b].flatMap((p) => buildStructuralReport(p).rebar!.levels).some((d) => d.kind === kind && d.orderWeightKg === null);
      assert.equal(table.rows.at(-1)!.cells[column], unknownPurchase ? '-' : x.number(Math.round(levels.reduce((n, d) => n + (d[field] ?? 0), 0) * 100) / 100));
    }
  }
  const missingOnly = plan('c', 'Missing only', [], [mesh({ bottom: u(0, 0) }), bars({ diameterMm: 0 })]);
  const missingTables = buildProjectStructuralPdfLayout(buildProjectStructural([missingOnly]), x, [missingOnly]).filter((b): b is Table => b.type === 'table');
  for (const table of missingTables) {
    assert.deepEqual(table.rows.at(-1)!.cells.slice(8, 11), ['-', '-', 'Missing data: 1']);
  }
  assert.equal(missingTables[1].rows.at(-1)!.cells[7], '-');
  const barsOnly = plan('d', 'Bars only', [], [bars({ count: 0 })]);
  const barsBlocks = buildProjectStructuralPdfLayout(buildProjectStructural([barsOnly]), x, [barsOnly]);
  const zeroBars = barsBlocks.find((b): b is Table => b.type === 'table')!;
  assert.deepEqual(zeroBars.rows[0].cells.slice(5, 10), ['0', '6', '0', '0', '0']);
  assert.deepEqual(zeroBars.rows.at(-1)!.cells.slice(7, 11), ['0', '0', '0', 'Exact']);
  assert.deepEqual(barsBlocks.filter((b) => b.type === 'section').map((b) => (b as { title: string }).title), ['Rebar - Bars']);
});
