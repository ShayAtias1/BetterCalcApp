import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PLAN_A } from './fixtures.ts';
import type { Plan, Project } from '../../src/types/index.ts';
import type { RebarMesh, RebarBars } from '../../src/types/structural.ts';
import { calculateRebar, rebarWeightPerMeterKg } from '../../src/lib/rebar.ts';
import { calculatePhysicalMeshSheetWeight, resolveMeshProcurement } from '../../src/lib/meshSheets.ts';
import { editManualMeshLayout } from '../../src/lib/manualMeshLayout.ts';
import { buildStructuralReport, buildRebarItems, buildRebarLevelRows, buildRebarSummary, buildProjectStructural } from '../../src/lib/structuralQuantities.ts';
import { buildStructuralPdfLayout, buildProjectStructuralPdfLayout } from '../../src/lib/structuralPdfLayout.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const mesh: RebarMesh = { id: 'm', kind: 'mesh', pageNumber: 1, mark: 'M1',
  points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }],
  bottom: { mode: 'uniform', spec: { diameterMm: 12, spacingM: 0.2 } }, wastePercent: 20 };
const plan = (item: RebarMesh | RebarBars): Plan => ({ ...structuredClone(PLAN_A), rooms: [], measurements: [], rebarItems: [item], pages: { 1: { pageNumber: 1, calibration: CAL } } });
const near = (value: number | null, expected: number, eps = 1e-9) => assert.ok(value !== null && Math.abs(value - expected) < eps, `${value} vs ${expected}`);
const bottomWeight = (14 * 6 + 31 * 2.5) * rebarWeightPerMeterKg(12)!;
const topWeight = (18 * 6 + 41 * 2.5) * rebarWeightPerMeterKg(10)!;

test('one full uniform physical sheet uses both edge-bar groups and existing kg/m', () => {
  const result = calculatePhysicalMeshSheetWeight(6, 2.5, mesh.bottom!);
  assert.deepEqual(result.layers.map((l) => [l.barCount, l.cutLengthM]), [[14, 6], [31, 2.5]]);
  near(result.sheetWeightKg, bottomWeight);
  const small = { ...mesh, sizeOverride: { lengthM: 1, widthM: 1 } };
  const one = resolveMeshProcurement(small, CAL);
  assert.equal(one.levels[0].source, 'automatic'); assert.equal(one.levels[0].sheets, 1);
  near(one.procurementWeightKg, bottomWeight);
  assert.ok(one.procurementWeightKg! > calculateRebar(small, CAL).weightKg!);
  const multiple = resolveMeshProcurement(mesh, CAL);
  assert.equal(multiple.levels[0].sheets, 4);
  near(multiple.procurementWeightKg, 4 * bottomWeight);
});

test('custom sheet sizes and directional diameters/spacings use the full physical sheet', () => {
  const reinforcement = { mode: 'directional', long: { diameterMm: 16, spacingM: 0.25 }, short: { diameterMm: 10, spacingM: 0.3 } } as const;
  const sheet = calculatePhysicalMeshSheetWeight(4, 2.2, reinforcement);
  assert.deepEqual(sheet.layers.map((l) => [l.barCount, l.cutLengthM, l.diameterMm]), [[10, 4, 16], [15, 2.2, 10]]);
  const expected = 40 * rebarWeightPerMeterKg(16)! + 33 * rebarWeightPerMeterKg(10)!;
  near(sheet.sheetWeightKg, expected);
  const resolved = resolveMeshProcurement({ ...mesh, bottom: reinforcement, sheets: { lengthM: 4, widthM: 2.2, overlapM: 0.2 } }, CAL);
  near(resolved.procurementWeightKg, resolved.levels[0].sheets! * expected);
  near(resolved.levels[0].purchasedAreaM2, resolved.levels[0].sheets! * 4 * 2.2);
  assert.equal(calculatePhysicalMeshSheetWeight(0, 2.2, reinforcement).sheetWeightKg, null);
  assert.equal(calculatePhysicalMeshSheetWeight(4, 2.2, { mode: 'uniform', spec: { diameterMm: 0, spacingM: 0.2 } }).sheetWeightKg, null);
});

test('manual add/remove changes count, purchased area and purchase weight; move/rotate preserve all three and net engineering', () => {
  const before = structuredClone(mesh), engineering = calculateRebar(mesh, CAL);
  const added = editManualMeshLayout(mesh, CAL, 'bottom', { type: 'add' }, () => 'added');
  const initial = resolveMeshProcurement(mesh, CAL), purchase = resolveMeshProcurement(added, CAL);
  assert.equal(purchase.levels[0].source, 'manual');
  assert.equal(purchase.totalSheets, 5); assert.equal(purchase.purchasedAreaM2, 75);
  near(purchase.procurementWeightKg! - initial.procurementWeightKg!, bottomWeight);
  const moved = editManualMeshLayout(added, CAL, 'bottom', { type: 'move', id: 'added', x: -30, y: 50 }, () => 'unused');
  const rotated = editManualMeshLayout(moved, CAL, 'bottom', { type: 'rotate', id: 'added' }, () => 'unused');
  for (const item of [added, moved, rotated]) {
    assert.deepEqual(calculateRebar(item, CAL), engineering);
    assert.deepEqual(resolveMeshProcurement(item, CAL), purchase);
  }
  const removed = editManualMeshLayout(rotated, CAL, 'bottom', { type: 'remove', id: 'added' }, () => 'unused');
  near(resolveMeshProcurement(removed, CAL).procurementWeightKg, initial.procurementWeightKg!);
  assert.equal(resolveMeshProcurement(removed, CAL).purchasedAreaM2, 60);
  assert.deepEqual(calculateRebar(removed, CAL), engineering);
  assert.deepEqual(mesh, before);
});

test('Bottom and Top specifications and sources are resolved independently; waste is not applied twice', () => {
  const both = { ...mesh, top: { mode: 'uniform', spec: { diameterMm: 10, spacingM: 0.15 } } } as RebarMesh;
  const manual = editManualMeshLayout(both, CAL, 'top', { type: 'add' }, () => 'top-added');
  const result = resolveMeshProcurement(manual, CAL);
  assert.deepEqual(result.levels.map((l) => [l.source, l.sheets]), [['automatic', 4], ['manual', 5]]);
  near(result.levels[0].sheetWeightKg, bottomWeight); near(result.levels[1].sheetWeightKg, topWeight);
  near(result.procurementWeightKg, 4 * bottomWeight + 5 * topWeight);
  assert.deepEqual(resolveMeshProcurement({ ...manual, wastePercent: 0 }, CAL), result);
  assert.deepEqual(resolveMeshProcurement({ ...manual, wastePercent: 80 }, CAL), result);
  const reset = editManualMeshLayout(manual, CAL, 'top', { type: 'reset' }, () => 'unused');
  near(resolveMeshProcurement(reset, CAL).procurementWeightKg, 4 * (bottomWeight + topWeight));
});

test('irregular Mesh retains estimated engineering net but has no invented purchase weight', () => {
  const irregular = { ...mesh, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 400 }] };
  const engineering = calculateRebar(irregular, CAL), procurement = resolveMeshProcurement(irregular, CAL);
  assert.equal(engineering.estimated, true); assert.ok(engineering.weightKg! > 0);
  assert.equal(procurement.levels[0].sheets, null); assert.equal(procurement.procurementWeightKg, null);
  const p = plan(irregular);
  assert.equal(buildRebarLevelRows(p)[0].orderWeightKg, null);
  assert.equal(buildRebarLevelRows(p)[0].netWeightKg, engineering.weightKg);
  assert.equal(buildRebarSummary(p).orderWeightKg, null);
  assert.equal(buildProjectStructural([p]).rebar!.orderWeightKg, null);
});

test('Straight Bars still use engineering weight plus waste in every report builder', () => {
  const bars: RebarBars = { id: 'bars', kind: 'bars', mark: 'B1', pageNumber: 1, diameterMm: 16, count: 10, lengthM: 6, wastePercent: 15 };
  const engineering = calculateRebar(bars, CAL), p = plan(bars);
  near(buildRebarItems(p)[0].orderWeightKg, engineering.orderWeightKg!);
  near(buildRebarLevelRows(p)[0].orderWeightKg, engineering.orderWeightKg!);
  near(buildRebarSummary(p).orderWeightKg, engineering.orderWeightKg!, 0.005);
  near(buildProjectStructural([p]).rebar!.orderWeightKg, engineering.orderWeightKg!, 0.005);
});

test('purchase source reaches plan/project summaries, PDF cells and numeric Excel cells without changing layout', async () => {
  const manual = editManualMeshLayout(mesh, CAL, 'bottom', { type: 'add' }, () => 'extra');
  const p = plan(manual), purchase = 5 * bottomWeight, engineering = calculateRebar(mesh, CAL);
  const report = buildStructuralReport(p), project = buildProjectStructural([p]);
  near(report.rebar!.levels[0].orderWeightKg, purchase);
  near(report.rebar!.levels[0].netWeightKg, engineering.weightKg!);
  near(report.rebar!.summary.orderWeightKg, purchase, 0.005);
  near(project.rebar!.orderWeightKg, purchase, 0.005);
  for (const language of ['en', 'he'] as const) {
    const context = exportContext(language), text = context.number(Math.round(purchase * 100) / 100);
    for (const blocks of [buildStructuralPdfLayout(report, context), buildProjectStructuralPdfLayout(project, context, [p])]) {
      const cells = blocks.flatMap((b) => b.type === 'table' ? b.rows.flatMap((r) => r.cells) : []);
      assert.ok(cells.includes(text));
    }
    const metadata: Project = { id: 'project', name: 'Project', createdAt: 0, updatedAt: 0, planIds: [p.id] };
    for (const [wb, offset] of [[buildQuantitiesWorkbook([], [], language, report), 0], [buildProjectWorkbook(metadata, [p], language), 1]] as const) {
      const read = new ExcelJS.Workbook(); await read.xlsx.load(await wb.xlsx.writeBuffer());
      const sheet = read.getWorksheet(context.t('exports.excel.sheets.rebar'))!;
      near(sheet.getCell(2, 11 + offset).value as number, purchase, 0.0001);
      near(sheet.getCell(2, 9 + offset).value as number, engineering.weightKg!, 0.0001);
    }
  }
});
