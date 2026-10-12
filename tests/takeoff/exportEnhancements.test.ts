import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomMatrices, writeRoomSchedule } from '../../src/lib/quantitySchedulePdf.ts';
import type { ReportWriter } from '../../src/lib/pdfReportWriter.ts';
import { withCatalogEntries } from '../../src/lib/workCatalog.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { excelScheduleView } from '../workCatalog/excelScheduleView.ts';
import { BALCONY_ROW_COLOR, isBalconyRoom } from '../../src/lib/reportRoomStyle.ts';
import { ALL_VISIBLE } from '../../src/lib/overlayVisibility.ts';
import { pdfDrawingPages } from '../../src/lib/pdfDrawingLayers.ts';

test('separate drawing pages isolate selected layers in architectural/finishes/concrete/rebar order', () => {
  const hidden = { ...ALL_VISIBLE, finishes: false, concrete: false, rebar: false };
  assert.deepEqual(pdfDrawingPages(hidden), [{ layer: null, overlays: hidden }]);
  const pages = pdfDrawingPages(hidden, { drawingMode: 'separate', drawingLayers: ['rebar', 'architectural', 'finishes', 'concrete'] });
  assert.deepEqual(pages.map(p => p.layer), ['architectural', 'finishes', 'concrete', 'rebar']);
  assert.ok(Object.values(pages[0].overlays).every(value => !value));
  assert.deepEqual(pages.slice(1).map(p => [p.overlays.finishes, p.overlays.concrete, p.overlays.rebar]), [[true, false, false], [false, true, false], [false, false, true]]);
  assert.deepEqual(pdfDrawingPages(hidden, { drawingMode: 'separate', drawingLayers: ['concrete'] }).map(p => p.layer), ['concrete']);
  assert.deepEqual(pdfDrawingPages(hidden, { drawingMode: 'separate', drawingLayers: [] }), []);
});

for (const language of ['he', 'en'] as const) test(`${language}: balcony row fills and type/unit/net order preserve plan/project quantities`, () => {
  const p = structuredClone(PLAN_A);
  p.rooms[0].roomType = 'service_balcony';
  p.rooms[1].name = 'Balcony';
  p.rooms[2].name = 'Living room beside balcony'; // Explicit living type takes precedence.
  const plan = withCatalogEntries(p, { categories: [], specs: [{ id: 'white', categoryId: 'builtin:painting', name: 'White', createdAt: 1, updatedAt: 1 }] });
  plan.rooms[0].workItems.find(w => w.type === 'painting')!.specId = 'white';
  const before = JSON.stringify(plan), summaries = buildRoomSummaries(plan), x = exportContext(language);
  assert.deepEqual(plan.rooms.slice(0, 3).map(isBalconyRoom), [true, true, false]);
  const matrix = buildRoomMatrices({ plan, summaries }, x)[0];
  assert.deepEqual(matrix.rows.slice(0, 3).map(r => r.bg), [BALCONY_ROW_COLOR, BALCONY_ROW_COLOR, undefined]);
  assert.ok(!matrix.rows.at(-1)!.bg);
  for (const book of [buildQuantitiesWorkbook(summaries, [], language, undefined, plan), buildProjectWorkbook({ id: 'project-1', name: 'Fixture', createdAt: 1, updatedAt: 1, planIds: [plan.id] }, [plan], language)]) {
    const view = excelScheduleView(book, x);
    assert.deepEqual(['item', 'unit', 'net'].map(k => view.column(k as 'item' | 'unit' | 'net')), [2, 5, 6]);
    for (const row of view.rows('room')) {
      const expected = row.getCell(view.column('item')).value === plan.rooms[0].name || row.getCell(view.column('item')).value === plan.rooms[1].name;
      for (let c = 1; c <= view.column('details'); c++) {
        const fill = row.getCell(c).fill;
        assert.equal(fill.type === 'pattern' && fill.fgColor?.argb === `FF${BALCONY_ROW_COLOR.slice(1)}`, expected);
      }
    }
  }
  let typeMatrix: unknown[] | undefined;
  writeRoomSchedule({ section() {}, note() {}, matrix(...args: unknown[]) { if (!args[4]) typeMatrix = args; } } as unknown as ReportWriter, { plan, summaries }, x);
  assert.ok(typeMatrix);
  assert.deepEqual(typeMatrix[0], [x.t('exports.quantityPdf.schedule.byType'), x.t('exports.quantityPdf.schedule.headers.unit')]);
  assert.deepEqual(typeMatrix[5], { weights: [220, 80], labelColumn: 0 });
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(buildRoomSummaries(plan), summaries);
});
