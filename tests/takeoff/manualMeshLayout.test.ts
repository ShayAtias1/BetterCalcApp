import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PLAN_A } from './fixtures.ts';
import type { Plan, Project } from '../../src/types/index.ts';
import type { RebarMesh, RebarLevel } from '../../src/types/structural.ts';
import { editManualMeshLayout, type ManualMeshEdit } from '../../src/lib/manualMeshLayout.ts';
import { calculateMeshSheets, resolveMeshProcurement, type MeshProcurementResult } from '../../src/lib/meshSheets.ts';
import { calculateMeshSheetPlacements } from '../../src/lib/meshSheetPlacement.ts';
import { prepareMeshLayoutPreview } from '../../src/lib/meshLayoutPreview.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { updateRebarItem } from '../../src/lib/structuralMutations.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import { buildRebarLevelRows, buildProjectStructural, buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import { buildStructuralPdfLayout, buildProjectStructuralPdfLayout } from '../../src/lib/structuralPdfLayout.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';

// V2D count invariants still hold; the resolver now also carries purchase weights.
const counts = ({ procurementWeightKg: _weight, levels, ...rest }: MeshProcurementResult) => ({ ...rest,
  levels: levels.filter((l) => l.sheets !== null).map(({ level, sheets, purchasedAreaM2 }) => ({ level, sheets, purchasedAreaM2 })) });
const withoutLayerIds = (result: MeshProcurementResult) => ({ ...result, levels: result.levels.map((l) => ({ ...l,
  layerProcurementWeightsKg: Object.values(l.layerProcurementWeightsKg) })) });

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const original: RebarMesh = { id: 'mesh', kind: 'mesh', pageNumber: 1, mark: 'Mesh 01',
  points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }],
  bottom: { mode: 'uniform', spec: { diameterMm: 12, spacingM: 0.2 } },
  top: { mode: 'uniform', spec: { diameterMm: 10, spacingM: 0.15 } }, wastePercent: 12 };
const plan = (mesh: RebarMesh): Plan => ({ ...structuredClone(PLAN_A), rooms: [], measurements: [], rebarItems: [mesh], pages: { 1: { pageNumber: 1, calibration: CAL } } });
let seq = 0;
const edit = (mesh: RebarMesh, level: RebarLevel, action: ManualMeshEdit) => editManualMeshLayout(mesh, CAL, level, action, () => `new-${seq++}`);
function firstId(level: RebarLevel) {
  const layout = calculateMeshSheetPlacements(original, CAL);
  assert.equal(layout.status, 'ok');
  return layout.placementsByLevel[level]![0].id;
}

test('old data and viewing remain automatic without writing any manual layout', () => {
  const before = structuredClone(original);
  assert.deepEqual(counts(resolveMeshProcurement(original, CAL)), calculateMeshSheets(original, CAL));
  prepareMeshLayoutPreview(original, CAL);
  assert.deepEqual(original, before);
  assert.equal(original.manualLayouts, undefined);
  assert.equal(edit(original, 'bottom', { type: 'move', id: firstId('bottom'), x: 0, y: 0 }), original);
});

test('first edit seeds only that level; moved and rotated positions survive JSON reload with stable IDs', () => {
  const before = structuredClone(original);
  const moved = edit(original, 'bottom', { type: 'move', id: firstId('bottom'), x: -12, y: 30 });
  assert.equal(moved.manualLayouts?.top, undefined);
  assert.deepEqual(moved.manualLayouts?.bottom?.sheets[0], { id: firstId('bottom'), x: -12, y: 30, rotation: 0 });
  const rotated = edit(moved, 'bottom', { type: 'rotate', id: firstId('bottom') });
  assert.deepEqual(rotated.manualLayouts?.bottom?.sheets[0], { id: firstId('bottom'), x: -10.25, y: 28.25, rotation: 90 });
  const reloaded: RebarMesh = JSON.parse(JSON.stringify(rotated));
  assert.deepEqual(prepareMeshLayoutPreview(reloaded, CAL), prepareMeshLayoutPreview(rotated, CAL));
  assert.deepEqual(resolveMeshProcurement(reloaded, CAL), resolveMeshProcurement(rotated, CAL));
  assert.deepEqual(original, before);
});

for (const level of ['bottom', 'top'] as const) {
  test(`${level} manual procurement coexists with the other automatic level, add/remove and purchased area`, () => {
    const added = edit(original, level, { type: 'add' });
    const result = resolveMeshProcurement(added, CAL);
    assert.equal(result.levels.find((l) => l.level === level)?.source, 'manual');
    assert.equal(result.levels.find((l) => l.level !== level)?.source, 'automatic');
    assert.equal(result.levels.find((l) => l.level === level)?.sheets, 5);
    assert.equal(result.totalSheets, 9);
    assert.equal(result.purchasedAreaM2, 135);
    const id = added.manualLayouts![level]!.sheets.at(-1)!.id;
    assert.deepEqual(added.manualLayouts![level]!.sheets.at(-1), { id, x: 0, y: 0, rotation: 0 });
    const removed = edit(added, level, { type: 'remove', id });
    assert.equal(resolveMeshProcurement(removed, CAL).totalSheets, 8);
    const reset = edit(removed, level, { type: 'reset' });
    assert.equal(reset.manualLayouts, undefined);
    assert.deepEqual(counts(resolveMeshProcurement(reset, CAL)), calculateMeshSheets(original, CAL));
  });
}

test('both levels manual, zero-sheet layout and reset remain independent', () => {
  let mesh = edit(edit(original, 'bottom', { type: 'add' }), 'top', { type: 'add' });
  const top = mesh.manualLayouts!.top;
  for (const sheet of mesh.manualLayouts!.bottom!.sheets) mesh = edit(mesh, 'bottom', { type: 'remove', id: sheet.id });
  assert.deepEqual(mesh.manualLayouts!.bottom!.sheets, []);
  assert.equal(resolveMeshProcurement(mesh, CAL).totalSheets, 5);
  assert.equal(resolveMeshProcurement(mesh, CAL).levels[0].sheets, 0);
  const preview = prepareMeshLayoutPreview(mesh, CAL);
  assert.equal(preview.status, 'ready');
  assert.deepEqual(preview.sheetsByLevel.bottom, []);
  mesh = edit(mesh, 'bottom', { type: 'reset' });
  assert.equal(mesh.manualLayouts!.top, top);
  assert.equal(resolveMeshProcurement(mesh, CAL).totalSheets, 9);
});

test('all physical layout operations preserve reinforcement calculations and V2A automatic procurement', () => {
  const weights = calculateRebar(original, CAL), automatic = calculateMeshSheets(original, CAL);
  let mesh = original;
  for (const action of [
    { type: 'move', id: firstId('bottom'), x: -100, y: 200 },
    { type: 'rotate', id: firstId('bottom') }, { type: 'add' },
    { type: 'remove', id: firstId('bottom') }, { type: 'reset' },
  ] as const) {
    mesh = edit(mesh, 'bottom', action);
    assert.deepEqual(calculateRebar(mesh, CAL), weights);
    assert.deepEqual(calculateMeshSheets(mesh, CAL), automatic);
  }
});

test('dimension changes clear both levels; overlap-only changes retain positions and counts', () => {
  const mesh = edit(edit(original, 'bottom', { type: 'add' }), 'top', { type: 'add' });
  const p = plan(mesh);
  for (const sheets of [{ lengthM: 5 }, { widthM: 3 }, { lengthM: 0 }]) {
    const changed = updateRebarItem(p, mesh.id, { sheets }).rebarItems![0] as RebarMesh;
    assert.equal(changed.manualLayouts, undefined);
    assert.deepEqual(counts(resolveMeshProcurement(changed, CAL)), calculateMeshSheets(changed, CAL));
  }
  const overlap = updateRebarItem(p, mesh.id, { sheets: { overlapM: 0.2 } }).rebarItems![0] as RebarMesh;
  assert.deepEqual(overlap.manualLayouts, mesh.manualLayouts);
  assert.equal(resolveMeshProcurement(overlap, CAL).totalSheets, 10);
  const custom = edit({ ...original, sheets: { lengthM: 4, widthM: 2 } }, 'bottom', { type: 'add' });
  assert.equal((updateRebarItem(plan(custom), custom.id, { sheets: undefined }).rebarItems![0] as RebarMesh).manualLayouts, undefined);
  const stale = { ...mesh, sheets: { lengthM: 5 } };
  assert.equal(resolveMeshProcurement(stale, CAL).status, 'invalid-settings');
  assert.equal(prepareMeshLayoutPreview(stale, CAL).status, 'unavailable');
  assert.equal(resolveMeshProcurement({ ...mesh, sheets: { overlapM: 3 } }, CAL).status, 'invalid-settings');
  assert.equal(resolveMeshProcurement({ ...mesh, sheets: { widthM: NaN } }, CAL).totalSheets, null);
});

test('duplication deep-copies geometry and regenerates every persisted sheet ID', () => {
  const mesh = edit(edit(original, 'bottom', { type: 'add' }), 'top', { type: 'add' });
  const source = plan(mesh), copy = clonePlanForDuplicate(source, 'Copy');
  const cloned = copy.rebarItems![0] as RebarMesh;
  assert.notEqual(cloned.id, mesh.id);
  const oldIds = new Set(Object.values(mesh.manualLayouts!).flatMap((l) => l.sheets.map((s) => s.id)));
  for (const level of ['bottom', 'top'] as const) {
    const a = mesh.manualLayouts![level]!, b = cloned.manualLayouts![level]!;
    assert.notEqual(a, b);
    assert.deepEqual(b.sheets.map(({ x, y, rotation }) => ({ x, y, rotation })), a.sheets.map(({ x, y, rotation }) => ({ x, y, rotation })));
    assert.ok(b.sheets.every((s) => !oldIds.has(s.id)));
  }
  assert.deepEqual(withoutLayerIds(resolveMeshProcurement(cloned, CAL)), withoutLayerIds(resolveMeshProcurement(mesh, CAL)));
  cloned.manualLayouts!.bottom!.sheets[0].x = 99;
  assert.notEqual(mesh.manualLayouts!.bottom!.sheets[0].x, 99);
});

test('resolved counts reach plan/project quantity builders, PDF tables and real Excel workbooks', async () => {
  let mesh = edit(original, 'bottom', { type: 'add' });
  mesh = edit(mesh, 'bottom', { type: 'add' });
  mesh = edit(mesh, 'bottom', { type: 'add' }); // seven physical sheets, four automatic on Top
  const p = plan(mesh), report = buildStructuralReport(p), aggregate = buildProjectStructural([p]);
  assert.deepEqual(buildRebarLevelRows(p).map((l) => l.sheets?.count), [7, 4]);
  assert.equal(aggregate.rebar?.sheetGroups[0].sheets, 11);
  for (const lang of ['en', 'he'] as const) {
    const context = exportContext(lang);
    for (const blocks of [buildStructuralPdfLayout(report, context), buildProjectStructuralPdfLayout(aggregate, context, [p])]) {
      const cells = blocks.flatMap((b) => b.type === 'table' ? b.rows.flatMap((r) => r.cells) : []);
      assert.ok(cells.includes(context.t('quantitiesPanel.sheetsQty', { count: 7 }))); 
      assert.ok(!cells.some((c) => c.includes('-100'))); // geometry is not exported
    }
    const project: Project = { id: 'project', name: 'Project', createdAt: 0, updatedAt: 0, planIds: [p.id] };
    for (const workbook of [buildQuantitiesWorkbook([], [], lang, report), buildProjectWorkbook(project, [p], lang)]) {
      const bytes = await workbook.xlsx.writeBuffer();
      const read = new ExcelJS.Workbook(); await read.xlsx.load(bytes);
      const cells: unknown[] = [];
      read.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(cell.value))));
      assert.ok(cells.includes(context.t('quantitiesPanel.sheetsQty', { count: 7 })), 'manual count reaches the existing Excel quantity cell');
    }
  }
});

test('saved manual quarter-turns preserve an automatic width-along-long proposal after overlap changes', () => {
  const mesh = { ...original, points: [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 600 }, { x: 0, y: 600 }] };
  const automatic = calculateMeshSheetPlacements(mesh, CAL);
  assert.equal(automatic.status, 'ok');
  assert.equal(automatic.orientation, 'width-along-long');
  const id = automatic.placementsByLevel.bottom![0].id;
  const saved = edit(mesh, 'bottom', { type: 'move', id, x: -5, y: 7 });
  assert.equal(saved.manualLayouts!.bottom!.sheets[0].rotation, 90);
  const first = prepareMeshLayoutPreview(saved, CAL);
  assert.equal(first.status, 'ready');
  assert.equal(first.placementsByLevel.bottom![0].width, 2.5);
  assert.equal(first.placementsByLevel.bottom![0].height, 6);
  const changed = updateRebarItem(plan(saved), mesh.id, { sheets: { overlapM: 0 } }).rebarItems![0] as RebarMesh;
  const preview = prepareMeshLayoutPreview(changed, CAL);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.sheetsByLevel.bottom![0].points, first.sheetsByLevel.bottom![0].points);
});

test('saved procurement remains available without drawable geometry when every level is manual', () => {
  const saved = edit(edit(original, 'bottom', { type: 'add' }), 'top', { type: 'add' });
  assert.equal(resolveMeshProcurement(saved, null).totalSheets, 10);
  assert.equal(resolveMeshProcurement(saved, null).purchasedAreaM2, 150);
  assert.equal(prepareMeshLayoutPreview(saved, null).status, 'no-plan-geometry');
  const partial = edit(original, 'bottom', { type: 'add' });
  assert.equal(resolveMeshProcurement(partial, null).totalSheets, null);
  assert.equal(resolveMeshProcurement(partial, null).levels[0].sheets, 5);
});
