import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan, WorkCategory, WorkItem, WorkSpec } from '../../src/types/index.ts';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { buildReportCategoryTotals, buildRoomSummaries, usedReportCategories } from '../../src/lib/quantities.ts';
import { buildProjectQuantities, primaryReading, readingUnavailable, reportColumnInfo, roomCategoryQuantity, totalColumnInfo } from '../../src/lib/projectQuantities.ts';
import { buildWorkBreakdown } from '../../src/lib/workAllocation.ts';
import { applyCatalogUpdates, compatibleSpecs, ownMethodSpecs, withCatalogEntries, workItemLabel } from '../../src/lib/workCatalog.ts';
import { bulkConfigKey, materializeBulkTakeoff, planBulkTakeoff, validBulkConfig, type BulkWorkConfig } from '../../src/lib/bulkTakeoff.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { excelScheduleView, excelValue } from './excelScheduleView.ts';

/** Rooms of 4 m × 4 m (16 m² floor, 16 m perimeter) on a calibrated page, no openings. */
function plan(items: WorkItem[] = [], rooms = 1): Plan {
  const p = structuredClone(PLAN_A);
  p.pages = { 1: { pageNumber: 1, calibration: { metersPerPixel: 1, pixelDistance: 1, realDistanceMeters: 1 } }, 2: { pageNumber: 2, calibration: null } };
  p.rooms = Array.from({ length: rooms }, (_, i) => ({ ...p.rooms[0], id: `room-${i}`, name: `Room ${i}`, apartmentNumber: '1', pageNumber: 1, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], closed: true, openings: [], workItems: structuredClone(items), notes: '' }));
  p.openings = [];
  p.measurements = [];
  return p;
}
const spec = (id: string, categoryId: string, name: string, extra: Partial<WorkSpec> = {}): WorkSpec => ({ id, categoryId, name, createdAt: 1, updatedAt: 1, ...extra });
const category = (id: string, name: string, method: WorkCategory['method'], unitLabel?: string): WorkCategory => ({ id, name, method, ...(unitLabel ? { unitLabel } : {}), createdAt: 1, updatedAt: 1 });
const ceilingPaint = spec('ceiling', 'builtin:painting', 'Ceiling paint', { method: 'ceilingArea' });
const wallWhite = spec('white', 'builtin:painting', 'White paint');
const ceilingWhite = spec('ceil-white', 'builtin:painting', 'Ceiling white', { method: 'ceilingArea' });
const paint: WorkItem = { id: 'paint', type: 'painting', heightM: 3, wastePercent: 10 };
const ceilingItem: WorkItem = { id: 'c', type: 'custom', categoryId: 'builtin:painting', method: 'ceilingArea', specId: 'ceiling', wastePercent: 5 };
const CEILING_KEY = 'custom:builtin:painting|ceilingArea' as const;

test('a work item can define its own method: ceiling paint under Paint, separate from wall paint', () => {
  const p = withCatalogEntries(plan([paint, ceilingItem]), { specs: [ceilingPaint, wallWhite, ceilingWhite] });
  const [summary] = buildRoomSummaries(p);
  // The built-in Paint column is still wall paint only.
  assert.equal(summary.extra.painting.areaM2, 48);
  const ceiling = summary.custom![CEILING_KEY]!;
  assert.deepEqual([ceiling.quantity, ceiling.order, ceiling.unit, ceiling.showMethod], [16, 16.8, 'm2', true]);
  assert.equal(reportColumnInfo(CEILING_KEY, [summary], exportContext('en').t).label, 'Paint · Ceiling area');
  assert.equal(workItemLabel(p.rooms[0].workItems[1], p), 'Ceiling paint');
  // Splits only offer work items measured the same way.
  assert.deepEqual(compatibleSpecs(p, { categories: [], specs: [] }, p.rooms[0].workItems[0]).map((s) => s.id), ['white']);
  assert.deepEqual(compatibleSpecs(p, { categories: [], specs: [] }, p.rooms[0].workItems[1]).map((s) => s.id), ['ceiling', 'ceil-white']);
  assert.deepEqual(ownMethodSpecs(p, { categories: [], specs: [] }).map((s) => s.id), ['ceiling', 'ceil-white']);
  // The breakdown names it by its own work item, in its own column.
  const group = buildWorkBreakdown([p], exportContext('en').t).groups.find((g) => g.key === CEILING_KEY)!;
  assert.equal(group.label, 'Paint · Ceiling area');
  assert.deepEqual(group.lines.map((l) => [l.label, l.amount.quantity]), [['Ceiling paint', 16]]);
});

test('a spec method change applies to its room items only when the plan is explicitly updated', () => {
  const p = withCatalogEntries(plan([ceilingItem]), { specs: [ceilingPaint] });
  const updated = applyCatalogUpdates(p, { categories: [], specs: [{ ...ceilingPaint, method: 'manualArea', updatedAt: 2 }] });
  assert.equal(p.rooms[0].workItems[0].method, 'ceilingArea');
  assert.equal(updated.rooms[0].workItems[0].method, 'manualArea');
});

test('custom categories appear in the main summaries and totals, read in their own unit', () => {
  const items: WorkItem[] = [
    paint,
    { id: 'f', type: 'custom', categoryId: 'floor', method: 'floorArea', wastePercent: 10 },
    { id: 's', type: 'custom', categoryId: 'strip', method: 'perimeter', heightM: 0.1 },
    { id: 'l', type: 'custom', categoryId: 'tracks', method: 'manualLength', manualQuantity: 12 },
    { id: 'g', type: 'custom', categoryId: 'grout', method: 'manualCount', manualQuantity: 3, wastePercent: 0 },
  ];
  const p = withCatalogEntries(plan(items, 2), { categories: [category('floor', 'Porcelain', 'floorArea'), category('strip', 'Edge strip', 'perimeter'), category('tracks', 'Drywall tracks', 'manualLength'), category('grout', 'Grout', 'manualCount', 'sacks')] });
  const summaries = buildRoomSummaries(p);
  const columns = usedReportCategories(summaries);
  assert.deepEqual(columns, ['painting', 'custom:floor|floorArea', 'custom:strip|perimeter', 'custom:tracks|manualLength', 'custom:grout|manualCount']);
  const totals = new Map(buildReportCategoryTotals(p, summaries).map((t) => [t.category, t]));
  assert.equal(totals.get('custom:floor|floorArea')!.quantityM2, 32);
  assert.equal(totals.get('custom:floor|floorArea')!.orderM2, 35.2);
  assert.deepEqual([totals.get('custom:strip|perimeter')!.lengthM, totals.get('custom:strip|perimeter')!.quantityM2], [32, 3.2]);
  assert.equal(totals.get('custom:tracks|manualLength')!.lengthM, 24);
  assert.deepEqual([totals.get('custom:grout|manualCount')!.count, totals.get('custom:grout|manualCount')!.orderCount], [6, 6]);
  const x = exportContext('en');
  const grout = reportColumnInfo('custom:grout|manualCount', summaries, x.t);
  assert.deepEqual([grout.label, grout.unit, grout.unitLabel, grout.hasArea], ['Grout', 'unit', 'sacks', false]);
  assert.deepEqual(primaryReading(roomCategoryQuantity(summaries[0], 'custom:grout|manualCount'), grout), { net: 3, order: 3 });

  // Project totals: one row per custom column, with each plan's share.
  const project = buildProjectQuantities([p, p], x.t);
  const total = project.totals.find((t) => t.category === 'custom:grout|manualCount')!;
  assert.deepEqual([total.label, total.unit, total.count, total.perPlan.length], ['Grout', 'sacks', 12, 2]);
  assert.equal(totalColumnInfo(total, x.t).unit, 'unit');
  assert.equal(project.totals.find((t) => t.category === 'custom:floor|floorArea')!.quantityM2, 64);
  // Built-in totals carry no `info`, exactly as before.
  assert.equal('info' in project.totals.find((t) => t.category === 'painting')!, false);
});

test('legacy plans are unchanged: no custom field on summaries, no custom columns', () => {
  const p = plan([paint]);
  const [summary] = buildRoomSummaries(p);
  assert.equal('custom' in summary, false);
  assert.deepEqual(usedReportCategories([summary]), ['painting']);
});

test('typed quantities stay available on an unscaled sheet; measured ones are not calculable', () => {
  let p = plan([{ id: 'g', type: 'custom', categoryId: 'grout', method: 'manualCount', manualQuantity: 2 }, { id: 'f', type: 'custom', categoryId: 'floor', method: 'floorArea' }]);
  p.rooms[0].pageNumber = 2;
  p = withCatalogEntries(p, { categories: [category('grout', 'Grout', 'manualCount'), category('floor', 'Porcelain', 'floorArea')] });
  const [s] = buildRoomSummaries(p);
  const grout = roomCategoryQuantity(s, 'custom:grout|manualCount');
  const floor = roomCategoryQuantity(s, 'custom:floor|floorArea');
  assert.equal(readingUnavailable(s, grout), false);
  assert.equal(grout.count, 2);
  assert.equal(readingUnavailable(s, floor), true);
  assert.equal(floor.quantityM2, null);
});

test('exports: custom quantities and count units survive the unified plan/project schedule', () => {
  const p = withCatalogEntries(plan([paint, { id: 'f', type: 'custom', categoryId: 'floor', method: 'floorArea' }, ceilingItem, { id: 'g', type: 'custom', categoryId: 'grout', method: 'manualCount', manualQuantity: 3 }]), {
    categories: [category('floor', 'Porcelain', 'floorArea'), category('grout', 'Grout', 'manualCount', 'sacks')], specs: [ceilingPaint],
  });
  for (const language of ['he', 'en'] as const) {
    const x = exportContext(language), summaries = buildRoomSummaries(p);
    const books = [buildQuantitiesWorkbook(summaries, [], language, undefined, p), buildProjectWorkbook({ id: 'project-1', name: 'P', createdAt: 0, updatedAt: 0 } as never, [p], language)];
    for (const book of books) {
      const view = excelScheduleView(book, x);
      for (const [key, net, unit] of [['custom:floor|floorArea', 16, x.t('units.m2')], [CEILING_KEY, 16, x.t('units.m2')], ['custom:grout|manualCount', 3, 'sacks']] as const) {
        const label = reportColumnInfo(key, summaries, x.t).label;
        const total = view.rows('category').find(row => view.category(row) === label)!;
        assert.ok(total, label);
        assert.equal(excelValue(total.getCell(view.column('net'))), net);
        assert.equal(total.getCell(view.column('unit')).value, unit);
      }
      assert.equal(view.sheet.views[0]?.rightToLeft, language === 'he');
    }
    const legacy = buildProjectWorkbook({ id: 'project-1', name: 'P', createdAt: 0, updatedAt: 0 } as never, [plan([paint])], language);
    const view = excelScheduleView(legacy, x);
    assert.equal(view.rows('category').length, 1);
    assert.equal(view.rows('category')[0].getCell(view.column('unit')).value, x.t('units.m2'));
  }
});

test('bulk assignment adds custom categories and own-method work items, keyed by category, method and item', () => {
  const p = plan([], 2);
  p.rooms[1].workItems = [{ id: 'existing', type: 'custom', categoryId: 'floor', method: 'floorArea', wastePercent: 3 }];
  const configs: BulkWorkConfig[] = [
    { type: 'custom', categoryId: 'floor', method: 'floorArea', wastePercent: 5 },
    { type: 'custom', categoryId: 'builtin:painting', method: 'ceilingArea', specId: 'ceiling', wastePercent: 0 },
  ];
  assert.ok(configs.every((c) => validBulkConfig(c, p)));
  assert.equal(validBulkConfig({ type: 'custom', method: 'floorArea' }, p), false);
  assert.equal(validBulkConfig({ type: 'custom', categoryId: 'x' }, p), false);
  const preview = planBulkTakeoff(p, ['room-0', 'room-1'], configs, 'add-missing');
  assert.deepEqual(preview.entries[1].conflicts, [bulkConfigKey(configs[0])]);
  assert.equal(preview.entries[0].additions.length, 2);
  assert.equal(preview.entries[1].additions.length, 1);
  let id = 0;
  const next = materializeBulkTakeoff(p, preview, () => `new-${++id}`, { categories: [category('floor', 'Porcelain', 'floorArea')], specs: [ceilingPaint] });
  assert.deepEqual(next.rooms[0].workItems.map((w) => [w.type, w.categoryId, w.method, w.specId]), [['custom', 'floor', 'floorArea', undefined], ['custom', 'builtin:painting', 'ceilingArea', 'ceiling']]);
  assert.equal(next.rooms[1].workItems.find((w) => w.id === 'existing')!.wastePercent, 3);
  assert.deepEqual(next.workCatalog!.categories.map((c) => c.id), ['floor']);
  assert.deepEqual(next.workCatalog!.specs.map((s) => s.id), ['ceiling']);
  assert.equal(buildRoomSummaries(next)[0].custom!['custom:floor|floorArea']!.quantity, 16);
  // Update-existing replaces only the matching custom item's settings.
  const updates = planBulkTakeoff(p, ['room-1'], [configs[0]], 'update-existing');
  assert.deepEqual(updates.entries[0].updates.map((u) => u.itemId), ['existing']);
});

test('bulk assignment of typed quantities does not require a page scale; measured work still does', () => {
  const p = plan([], 1);
  p.rooms[0].pageNumber = 2;
  const manual: BulkWorkConfig = { type: 'custom', categoryId: 'grout', method: 'manualCount' };
  assert.equal(planBulkTakeoff(p, ['room-0'], [manual], 'add-missing').entries[0].status, 'updated');
  assert.deepEqual(planBulkTakeoff(p, ['room-0'], [manual, { type: 'painting' }], 'add-missing').entries[0].issues, ['calibration']);
  // Built-in configurations keep their exact shape.
  assert.deepEqual(Object.keys(planBulkTakeoff(plan([]), ['room-0'], [{ type: 'painting', wastePercent: 5 }], 'add-missing').entries[0].additions[0]).sort(), ['deductOpenings', 'heightM', 'tilingCategory', 'type', 'wastePercent']);
});
