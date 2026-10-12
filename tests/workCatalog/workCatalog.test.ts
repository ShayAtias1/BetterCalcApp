import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan, WorkCategory, WorkItem, WorkSpec } from '../../src/types/index.ts';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { buildReportCategoryTotals, buildRoomSummaries, calculateWorkItem } from '../../src/lib/quantities.ts';
import { allocateWorkItem, buildWorkBreakdown, planUsesWorkBreakdown } from '../../src/lib/workAllocation.ts';
import { applyCatalogUpdates, catalogUpdates, sanitizeCatalog, withCatalogEntries, workItemLabel } from '../../src/lib/workCatalog.ts';
import { workItemDefinition } from '../../src/lib/workTypes.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildMaterialRows } from '../../src/lib/quantitySchedulePdf.ts';
import { en } from '../../src/i18n/en.ts';
import { excelScheduleView, excelMaterialView, excelValue } from './excelScheduleView.ts';

/** One 4 m × 4 m room (16 m² floor, 16 m perimeter) on a calibrated page, no openings. */
function plan(items: WorkItem[] = []): Plan {
  const p = structuredClone(PLAN_A);
  p.pages = { 1: { pageNumber: 1, calibration: { metersPerPixel: 1, pixelDistance: 1, realDistanceMeters: 1 } } };
  p.rooms = [{ ...p.rooms[0], id: 'room', name: 'Living', pageNumber: 1, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], closed: true, openings: [], workItems: items }];
  p.openings = [];
  p.measurements = [];
  return p;
}
const spec = (id: string, categoryId: string, name: string, specification?: string): WorkSpec => ({ id, categoryId, name, ...(specification ? { specification } : {}), createdAt: 1, updatedAt: 1 });
const category = (id: string, name: string, method: WorkCategory['method'], unitLabel?: string): WorkCategory => ({ id, name, method, ...(unitLabel ? { unitLabel } : {}), createdAt: 1, updatedAt: 1 });
const paint = (allocations?: WorkItem['allocations']): WorkItem => ({ id: 'paint', type: 'painting', heightM: 3, wastePercent: 10, ...(allocations ? { allocations } : {}) });
const withSpecs = (p: Plan) => withCatalogEntries(p, { specs: [spec('white', 'builtin:painting', 'White paint', 'RAL 9010'), spec('grey', 'builtin:painting', 'Grey paint')] });

test('splitting a calculated quantity never double-counts it: 30 m² white + remainder grey = 48 m² total', () => {
  const p = withSpecs(plan([paint([{ id: 'a', specId: 'white', quantity: 30 }, { id: 'b', specId: 'grey', quantity: null }])]));
  const a = allocateWorkItem(p.rooms[0].workItems[0], p.rooms[0], p)!;
  assert.equal(a.baseline, 48);
  assert.deepEqual(a.lines.map((l) => [l.specId, l.quantity, l.manual]), [['white', 30, true], ['grey', 18, false]]);
  assert.equal(a.unassigned, 0);
  assert.equal(a.over, 0);
  const g = buildWorkBreakdown([p]).groups.find((x) => x.key === 'painting')!;
  assert.equal(g.total.quantity, 48);
  assert.equal(g.total.order, 52.8);
  assert.deepEqual(g.lines.map((l) => [l.label, l.amount.quantity, l.amount.order, l.source]), [['White paint', 30, 33, 'manual'], ['Grey paint', 18, 19.8, 'auto']]);
  // The legacy report and totals are untouched by allocations.
  assert.deepEqual(buildRoomSummaries(p), buildRoomSummaries(plan([paint()])));
  assert.equal(buildReportCategoryTotals(p, buildRoomSummaries(p)).find((t) => t.category === 'painting')!.quantityM2, 48);
});

test('allocations beyond the calculated quantity are flagged, and the total stays the calculated one', () => {
  const p = withSpecs(plan([paint([{ id: 'a', specId: 'white', quantity: 30 }, { id: 'b', specId: 'grey', quantity: 30 }])]));
  const a = allocateWorkItem(p.rooms[0].workItems[0], p.rooms[0], p)!;
  assert.equal(a.over, 12);
  assert.equal(a.unassigned, 0);
  const g = buildWorkBreakdown([p]).groups[0];
  assert.equal(g.total.quantity, 48);
  assert.equal(g.over, 12);
});

test('without a remainder share, the uncovered quantity is reported as unassigned', () => {
  const p = withSpecs(plan([paint([{ id: 'a', specId: 'white', quantity: 20 }])]));
  const a = allocateWorkItem(p.rooms[0].workItems[0], p.rooms[0], p)!;
  assert.equal(a.unassigned, 28);
  const lines = buildWorkBreakdown([p]).groups[0].lines;
  assert.deepEqual(lines.map((l) => [l.specId, l.amount.quantity]), [['white', 20], [null, 28]]);
  // Only the first share without a number is the remainder; a second one counts as 0.
  const two = withSpecs(plan([paint([{ id: 'a', specId: 'white', quantity: null }, { id: 'b', specId: 'grey', quantity: null }])]));
  assert.deepEqual(allocateWorkItem(two.rooms[0].workItems[0], two.rooms[0], two)!.lines.map((l) => l.quantity), [48, 0]);
});

test('every calculation method of a custom category: floor, wall, ceiling, perimeter and manual', () => {
  const cats = [category('floor', 'Porcelain', 'floorArea'), category('wall', 'Wallpaper', 'wallArea'), category('ceil', 'Ceiling paint', 'ceilingArea'),
    category('strip', 'Edge strip', 'perimeter'), category('ma', 'Drywall walls', 'manualArea'), category('ml', 'Tracks', 'manualLength'), category('mc', 'Grout', 'manualCount', 'sacks')];
  const item = (id: string, method: WorkCategory['method'], extra: Partial<WorkItem> = {}): WorkItem => ({ id, type: 'custom', categoryId: id, method, ...extra });
  let p = plan([item('floor', 'floorArea'), item('wall', 'wallArea', { heightM: 2 }), item('ceil', 'ceilingArea'), item('strip', 'perimeter'),
    item('ma', 'manualArea', { manualQuantity: 12.5 }), item('ml', 'manualLength', { manualQuantity: 30 }), item('mc', 'manualCount', { manualQuantity: 4 })]);
  p = withCatalogEntries(p, { categories: cats });
  const groups = new Map(buildWorkBreakdown([p]).groups.map((g) => [g.key, g]));
  assert.equal(groups.get('custom:floor|floorArea')!.total.quantity, 16);
  assert.equal(groups.get('custom:wall|wallArea')!.total.quantity, 32);
  assert.equal(groups.get('custom:ceil|ceilingArea')!.total.quantity, 16);
  assert.equal(groups.get('custom:ceil|ceilingArea')!.method, 'ceilingArea');
  assert.equal(groups.get('custom:strip|perimeter')!.total.quantity, 16);
  assert.equal(groups.get('custom:strip|perimeter')!.unit, 'lm');
  assert.equal(groups.get('custom:ma|manualArea')!.total.quantity, 12.5);
  assert.equal(groups.get('custom:ml|manualLength')!.total.quantity, 30);
  assert.equal(groups.get('custom:mc|manualCount')!.total.quantity, 4);
  assert.equal(groups.get('custom:mc|manualCount')!.unitLabel, 'sacks');
  // Floor, ceiling and wall stay separate groups; custom categories never enter the built-in columns
  // (they get their own, see report-integration tests).
  const builtIn = buildReportCategoryTotals(p, buildRoomSummaries(p)).filter((t) => !String(t.category).startsWith('custom:'));
  assert.ok(builtIn.every((t) => t.quantityM2 === 0 && t.orderM2 === 0));
  assert.equal(workItemLabel(p.rooms[0].workItems[2], p), 'Ceiling paint');
});

test('a custom wall method deducts openings like paint; a custom strip deducts doors like skirting', () => {
  let p = plan([{ id: 'w', type: 'custom', categoryId: 'wall', method: 'wallArea', heightM: 3 }, { id: 's', type: 'custom', categoryId: 'strip', method: 'perimeter' }, paint()]);
  p.rooms[0].openings = [{ id: 'd', type: 'door', widthM: 1, heightM: 2, quantity: 1 }];
  p = withCatalogEntries(p, { categories: [category('wall', 'Wallpaper', 'wallArea'), category('strip', 'Edge strip', 'perimeter')] });
  const room = p.rooms[0];
  const calc = (i: number) => calculateWorkItem(room.workItems[i], room, 16, 16, p);
  assert.equal(calc(0).netM2, calc(2).netM2);
  assert.equal(calc(0).deductedM2, 2);
  assert.equal(calc(1).lengthM, 15);
});

test('manual quantities need no page scale; measured ones on an uncalibrated sheet are left out and counted', () => {
  let p = plan([{ id: 'm', type: 'custom', categoryId: 'mc', method: 'manualCount', manualQuantity: 3 }, { id: 'f', type: 'custom', categoryId: 'floor', method: 'floorArea' }]);
  p.pages = { 1: { pageNumber: 1, calibration: null } };
  p = withCatalogEntries(p, { categories: [category('mc', 'Grout', 'manualCount'), category('floor', 'Porcelain', 'floorArea')] });
  const b = buildWorkBreakdown([p]);
  assert.equal(b.groups.find((g) => g.key === 'custom:mc|manualCount')!.total.quantity, 3);
  const floor = b.groups.find((g) => g.key === 'custom:floor|floorArea')!;
  assert.equal(floor.uncalculated, 1);
  assert.equal(floor.total.quantity, 0);
  assert.equal(b.rooms.find((r) => r.category === 'Porcelain')!.quantity, null);
});

test('a custom item without a valid method is flagged, never silently zero', () => {
  const p = plan([{ id: 'x', type: 'custom', categoryId: 'gone' }, { id: 'y', type: 'custom', categoryId: 'gone', method: 'bogus' as never }]);
  assert.equal(workItemDefinition(p.rooms[0].workItems[0]), undefined);
  assert.equal(buildWorkBreakdown([p]).invalidItems, 2);
  assert.equal(buildRoomSummaries(p)[0].tilingRegularAreaM2, null);
});

test('built-in category totals in the breakdown equal the existing report totals; skirting keeps lm and m²', () => {
  const p = plan([{ id: 't', type: 'tiling', tilingCategory: 'as', wastePercent: 5 }, { id: 'k', type: 'panels', heightM: 0.1, wastePercent: 10, allocations: [{ id: 'a', specId: 'oak', quantity: 6 }] }, paint()]);
  const b = buildWorkBreakdown([withCatalogEntries(p, { specs: [spec('oak', 'builtin:panels', 'Oak skirting')] })]);
  const totals = buildReportCategoryTotals(p, buildRoomSummaries(p));
  for (const g of b.groups) {
    const legacy = totals.find((t) => t.category === g.key)!;
    if (g.unit === 'lm') {
      assert.equal(g.total.quantity, legacy.lengthM);
      assert.equal(g.total.order, legacy.orderLengthM);
      assert.equal(g.total.areaM2, legacy.quantityM2);
    } else {
      assert.equal(g.total.quantity, legacy.quantityM2);
      assert.equal(g.total.order, legacy.orderM2);
    }
  }
  const skirting = b.groups.find((g) => g.key === 'panels')!;
  assert.deepEqual(skirting.lines.map((l) => [l.specId, l.amount.quantity, l.amount.areaM2]), [['oak', 6, 0.6], [null, 10, 1]]);
  assert.equal(skirting.lines[0].label, 'Oak skirting');
});

test('plan snapshots: the plan keeps its copy; catalog edits apply only when explicitly accepted', () => {
  const original = category('c', 'Drywall', 'manualArea');
  let p = withCatalogEntries(plan([{ id: 'i', type: 'custom', categoryId: 'c', method: 'manualArea', manualQuantity: 10 }]), { categories: [original] });
  // A second copy attempt never replaces the plan's version.
  assert.equal(withCatalogEntries(p, { categories: [{ ...original, name: 'Renamed' }] }), p);
  const edited = { ...original, name: 'Drywall partitions', method: 'manualLength' as const, updatedAt: 2 };
  const updates = catalogUpdates(p, { categories: [edited], specs: [] });
  assert.equal(updates.categories.length, 1);
  assert.equal(workItemLabel(p.rooms[0].workItems[0], p), 'Drywall');
  p = applyCatalogUpdates(p, updates);
  assert.equal(workItemLabel(p.rooms[0].workItems[0], p), 'Drywall partitions');
  assert.equal(p.rooms[0].workItems[0].method, 'manualLength');
  assert.equal(catalogUpdates(p, { categories: [edited], specs: [] }).categories.length, 0);
});

test('stored catalogs are read tolerantly', () => {
  const c = sanitizeCatalog({ categories: [{ id: 'a', name: 'A', method: 'floorArea' }, { id: 'b', method: 'nope' }, null], specs: [{ id: 's', categoryId: 'a', name: 'S' }, { id: 1 }] });
  assert.deepEqual(c.categories.map((x) => x.id), ['a']);
  assert.deepEqual(c.specs.map((x) => x.id), ['s']);
  assert.deepEqual(sanitizeCatalog('garbage'), { categories: [], specs: [] });
});

test('exports: material shares stay separate from additive room totals, with live formulas', () => {
  const legacy = plan([paint()]);
  assert.equal(planUsesWorkBreakdown(legacy), false);
  const legacyBook = buildQuantitiesWorkbook(buildRoomSummaries(legacy), [], 'en', undefined, legacy);
  assert.ok(!legacyBook.worksheets.some((s) => s.name === en.workCatalog.sheetName));
  assert.ok(!buildMaterialRows({ plan: legacy, summaries: buildRoomSummaries(legacy) }, exportContext('en')).some((r) => r.kind === 'type'));

  const p = withSpecs(plan([paint([{ id: 'a', specId: 'white', quantity: 30 }, { id: 'b', specId: 'grey', quantity: null }])]));
  for (const language of ['he', 'en'] as const) {
    const x = exportContext(language);
    const book = buildQuantitiesWorkbook(buildRoomSummaries(p), [], language, undefined, p);
    const project = buildProjectWorkbook({ id: 'project-1', name: 'P', createdAt: 0, updatedAt: 0 } as never, [p], language);
    for (const workbook of [book, project]) {
      assert.ok(!workbook.getWorksheet(x.t('workCatalog.sheetName')));
      const view = excelScheduleView(workbook, x);
      const material=excelMaterialView(workbook,x);
      const types = material.rows;
      assert.deepEqual(types.map(row => [row.getCell(material.column('item')).value, excelValue(row.getCell(material.column('net'))), excelValue(row.getCell(material.column('order')))]),
        [['White paint · RAL 9010', 30, 33], ['Grey paint', 18, 19.8]]);
      const [total] = view.rows('category');
      assert.equal(excelValue(total.getCell(view.column('net'))), 48);
      assert.equal(excelValue(total.getCell(view.column('order'))), 52.8);
      const [room] = view.rows('room');
      assert.equal(excelValue(room.getCell(view.column('net'))), 48);
      assert.equal(excelValue(room.getCell(view.column('order'))), 52.8);
      const order = room.getCell(view.column('order'));
      assert.ok(order.formula.includes(room.getCell(view.column('net')).address));
      assert.ok(order.formula.includes(room.getCell(view.column('waste')).address));
      // The category SUM uses room figures, never its material shares as well.
      assert.ok(total.getCell(view.column('net')).formula.includes('SUMIFS'));
      assert.ok(total.getCell(view.column('net')).formula.includes(`$${room.getCell(view.column('net')).address.replace(/(\d+)/,'$$$1')}`));
      assert.ok(!total.getCell(view.column('net')).formula.includes(material.sheet.name));
    }
    const rows = buildMaterialRows({ plan: p, summaries: buildRoomSummaries(p) }, x);
    assert.deepEqual(rows.filter((r) => r.kind === 'type').map((r) => [r.cells[0], r.cells[1]]), [['White paint · RAL 9010', x.number(30)], ['Grey paint', x.number(18)]]);
  }
});

test('the starting catalog: paint, flooring, drywall and grout types, never replacing what the user has', async () => {
  const { seedCatalog, withSeedEntries } = await import('../../src/lib/workCatalog.ts');
  const x = exportContext('en');
  const seed = seedCatalog(x.t);
  const byId = new Map(seed.specs.map((s) => [s.id, s]));
  assert.deepEqual(seed.specs.filter((s) => s.categoryId === 'builtin:painting').map((s) => [s.name, s.method]), [['White paint', undefined], ['Grey paint', undefined], ['Ceiling paint', 'ceilingArea']]);
  assert.equal(seed.specs.filter((s) => s.categoryId === 'builtin:tiling').length, 3);
  assert.deepEqual(seed.categories.map((c) => [c.id, c.name, c.method]), [['seed:drywall', 'Drywall', 'wallArea'], ['seed:grout', 'Grout', 'manualCount']]);
  assert.deepEqual(['seed:drywall-ceilings', 'seed:drywall-tracks', 'seed:drywall-studs'].map((id) => byId.get(id)!.method), ['ceilingArea', 'manualLength', 'manualCount']);
  assert.deepEqual(seed.specs.filter((s) => s.categoryId === 'seed:grout').map((s) => s.name), ['Cementitious grout', 'Epoxy grout']);
  const edited = { categories: [{ ...seed.categories[0], name: 'My drywall' }], specs: [] };
  const merged = withSeedEntries(edited, seed);
  assert.equal(merged.categories.find((c) => c.id === 'seed:drywall')!.name, 'My drywall');
  assert.equal(merged.specs.length, seed.specs.length);
  assert.equal(seedCatalog(exportContext('he').t).specs[0].name, 'צבע לבן');
});
