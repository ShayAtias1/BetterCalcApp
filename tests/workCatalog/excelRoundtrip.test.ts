import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { PLAN_A, PLAN_B } from '../takeoff/fixtures.ts';
import { sectionOf } from '../takeoff/sectionView.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomSummaries, buildReportCategoryTotals } from '../../src/lib/quantities.ts';
import { buildProjectQuantities, primaryReading, reportColumnInfo, totalColumnInfo } from '../../src/lib/projectQuantities.ts';
import { buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import { buildWorkBreakdown } from '../../src/lib/workAllocation.ts';
import { buildOpeningQuantityReport } from '../../src/lib/openingQuantityReport.ts';
import { withCatalogEntries } from '../../src/lib/workCatalog.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { excelScheduleView, excelMaterialView, excelValue } from './excelScheduleView.ts';

const near = (actual: unknown, expected: number) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 0.00011, `${actual} != ${expected}`);

test('actual plan/project XLSX round trips preserve quantities, allocations, openings and structural formulas in both languages', async () => {
  const base = structuredClone(PLAN_A);
  base.rooms[0].workItems.find(w => w.type === 'painting')!.allocations = [{ id: 'white-share', specId: 'white', quantity: 10 }, { id: 'grey-share', specId: 'grey', quantity: null }];
  base.rooms[0].workItems.push(
    { id: 'wall', type: 'custom', categoryId: 'wall', method: 'wallArea', heightM: 3, wastePercent: 7 },
    { id: 'wall-second', type: 'custom', categoryId: 'wall', method: 'wallArea', heightM: 2, wastePercent: 12 },
    { id: 'strip', type: 'custom', categoryId: 'strip', method: 'perimeter', heightM: 0.15, wastePercent: 5 },
    { id: 'count', type: 'custom', categoryId: 'count', method: 'manualCount', manualQuantity: 3, wastePercent: 0, specId: 'grout' },
  );
  // Typed work stays numeric even on an uncalibrated page.
  base.rooms.at(-1)!.workItems.push({ id: 'typed', type: 'custom', categoryId: 'count', method: 'manualCount', manualQuantity: 2, wastePercent: 0, specId: 'grout' });
  const plan = withCatalogEntries(base, {
    categories: [
      { id: 'wall', name: 'Drywall', method: 'wallArea', createdAt: 1, updatedAt: 1 },
      { id: 'strip', name: 'Edge strip', method: 'perimeter', createdAt: 1, updatedAt: 1 },
      { id: 'count', name: 'Grout', method: 'manualCount', unitLabel: 'sacks', createdAt: 1, updatedAt: 1 },
    ],
    specs: [
      { id: 'white', categoryId: 'builtin:painting', name: 'White paint', specification: 'RAL 9010', createdAt: 1, updatedAt: 1 },
      { id: 'grey', categoryId: 'builtin:painting', name: 'Grey paint', createdAt: 1, updatedAt: 1 },
      { id: 'grout', categoryId: 'count', name: 'Epoxy grout', createdAt: 1, updatedAt: 1 },
    ],
  });
  plan.concreteElements = [{ id: 'slab', pageNumber: 1, kind: 'slab', mark: 'S01', points: [], sizeOverride: { lengthM: 10, widthM: 5 }, depthM: 0.2, grade: 'B30', wastePercent: 5 }];
  plan.rebarItems = [{ id: 'bars', pageNumber: 1, kind: 'bars', mark: 'R01', diameterMm: 16, count: 10, lengthM: 6, wastePercent: 10 }];
  const plans = [plan, structuredClone(PLAN_B)];
  const before = JSON.stringify(plans);
  const project = { id: 'project-1', name: 'Export verification', createdAt: 1, updatedAt: 1, planIds: plans.map(p => p.id) };
  const manifest: Record<string, { formulas: { sheet: string; address: string; result: unknown }[]; roomOrder: { sheet: string; net: string; order: string; waste: number; category: string; summary?: string; projectSummary?: string } }> = {};
  for (const language of ['he', 'en'] as const) {
    const x = exportContext(language), summaries = buildRoomSummaries(plan);
    for (const scope of ['plan', 'project'] as const) {
      const source = scope === 'plan'
        ? buildQuantitiesWorkbook(summaries, plan.measurements.filter(m => m.areaKind && typeof m.areaM2 === 'number'), language, buildStructuralReport(plan), plan)
        : buildProjectWorkbook(project, plans, language);
      const bytes = await source.xlsx.writeBuffer();
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(book.worksheets.map(s => s.name), source.worksheets.map(s => s.name));
      assert.ok(book.worksheets.every(s => s.views[0]?.rightToLeft === (language === 'he')));
      assert.ok(!book.getWorksheet(x.t('workCatalog.sheetName')));
      assert.equal(!!book.getWorksheet(x.t('exports.excel.sheets.projectSummary')), scope === 'project');
      const view = excelScheduleView(book, x);
      // Recalculating rounded inputs must not overwrite the engine's authoritative result,
      // including categories that combine work items with different waste percentages.
      let preservedOrders = 0;
      for (const row of view.rows('room')) {
        const net = row.getCell(view.column('net')), waste = row.getCell(view.column('waste'));
        const order = row.getCell(view.column('order'));
        if (typeof net.value !== 'number' || typeof waste.value !== 'number' || typeof order.result !== 'number') continue;
        const recalculated = Math.round(net.value * (1 + waste.value / 100) * 100) / 100;
        if (Math.abs(recalculated - order.result) < 0.000001) continue;
        assert.ok(order.formula.includes(`IF(AND(${net.address}=${net.value},${waste.address}=${waste.value}),${order.result},ROUND(`));
        preservedOrders++;
      }
      assert.ok(preservedOrders > 0);
      for (const p of scope === 'plan' ? [plan] : plans) {
        const ss = buildRoomSummaries(p);
        for (const total of buildReportCategoryTotals(p, ss)) {
          const info = reportColumnInfo(total.category, ss, x.t), reading = primaryReading(total, info);
          const row = view.rows('category').find(r => view.category(r) === info.label && (scope === 'plan' || r.getCell(view.column('plan')).value === p.name));
          assert.ok(row, `${p.name}: ${info.label}`);
          near(excelValue(row.getCell(view.column('net'))), reading.net!);
          near(excelValue(row.getCell(view.column('order'))), reading.order!);
          if (info.unit === 'lm' && info.hasArea) {
            near(excelValue(row.getCell(view.column('area'))), total.quantityM2!);
            near(excelValue(row.getCell(view.column('areaOrder'))), total.orderM2!);
          }
        }
        for (const group of buildWorkBreakdown([p], x.t).groups) {
          const material=excelMaterialView(book,x);
          const rows = material.rows.filter(r => r.getCell(material.column('category')).value === group.label && (scope === 'plan' || r.getCell(material.column('plan')).value === p.name));
          assert.equal(rows.length, group.lines.length);
          group.lines.forEach((line, i) => {
            near(excelValue(rows[i].getCell(material.column('net'))), line.amount.quantity);
            near(excelValue(rows[i].getCell(material.column('order'))), line.amount.order);
          });
        }
      }
      if (scope === 'project') {
        const summary = book.getWorksheet(x.t('exports.excel.sheets.projectSummary'))!;
        for (const total of buildProjectQuantities(plans, x.t).totals) {
          const reading = primaryReading(total, totalColumnInfo(total, x.t));
          let row: ExcelJS.Row | undefined;
          summary.eachRow(r => { if (r.getCell(1).value === total.label) row = r; });
          assert.ok(row);
          near(excelValue(row.getCell(3)), reading.net!);
          near(excelValue(row.getCell(4)), reading.order!);
        }
      }
      const opening = sectionOf(book, x.t('exports.excel.sheets.openings'), x.t('openingQuantities.counts'))!;
      assert.ok(opening);
      const openingReports = (scope === 'plan' ? [plan] : plans).map(p => buildOpeningQuantityReport(p));
      const countRows: ExcelJS.Row[] = [];
      opening.eachRow((row, index) => { if (index > 1) countRows.push(row); });
      assert.equal(countRows.length, openingReports.length + (scope === 'project' ? 1 : 0));
      openingReports.forEach((report, index) => {
        near(countRows[index].getCell(2).value, report.doors);
        near(countRows[index].getCell(3).value, report.windows);
      });
      if (scope === 'project') {
        near(countRows.at(-1)!.getCell(2).value, openingReports.reduce((n, r) => n + r.doors, 0));
        near(countRows.at(-1)!.getCell(3).value, openingReports.reduce((n, r) => n + r.windows, 0));
      }
      const deducted = sectionOf(book, x.t('exports.excel.sheets.openings'), x.t('exports.excel.openings.applied'))!;
      assert.ok(deducted);
      const offset = scope === 'project' ? 1 : 0;
      const master = summaries.find(s => s.roomId === 'r-master')!;
      for (const d of master.openingDeductions) {
        let found = false;
        deducted.eachRow(r => {
          if (r.getCell(2 + offset).value !== master.roomName || r.getCell(3 + offset).value !== x.t(`reportCategories.${d.category}`)) return;
          near(r.getCell(5 + offset).value, d.grossM2);
          near(r.getCell(6 + offset).value, d.deductedM2);
          near(excelValue(r.getCell(7 + offset)), d.netM2);
          assert.ok(r.getCell(7 + offset).formula);
          found = true;
        });
        assert.ok(found);
      }
      const concrete = sectionOf(book, x.t('exports.excel.sheets.structural'), x.t('exports.structural.concrete'))!;
      const rebar = sectionOf(book, x.t('exports.excel.sheets.structural'), x.t('exports.structural.rebar'))!;
      assert.ok(concrete); assert.ok(rebar);
      // 10 × 5 × .2 = 10 m³, with 5% waste, independent of the exporter.
      const netColumn = (concrete.getRow(1).values as unknown[]).indexOf(x.t('exports.projectPdf.netUnit', { unit: x.t('units.m3') }));
      assert.ok(netColumn > 0);
      near(excelValue(concrete.getRow(concrete.rowCount).getCell(netColumn)), 10);
      const structural = buildStructuralReport(plan);
      const concreteOrder = (concrete.getRow(1).values as unknown[]).indexOf(x.t('exports.projectPdf.orderUnit', { unit: x.t('units.m3') }));
      near(excelValue(concrete.getRow(concrete.rowCount).getCell(concreteOrder)), structural.concrete!.summary.orderM3);
      const rebarNet = (rebar.getRow(1).values as unknown[]).indexOf(x.t('exports.structural.headers.netWeight', { unit: x.t('units.kg') }));
      const rebarOrder = (rebar.getRow(1).values as unknown[]).indexOf(x.t('exports.projectPdf.orderUnit', { unit: x.t('units.kg') }));
      assert.ok(rebarNet > 0 && rebarOrder > 0);
      near(excelValue(rebar.getRow(rebar.rowCount).getCell(rebarNet)), structural.rebar!.summary.weightKg);
      near(excelValue(rebar.getRow(rebar.rowCount).getCell(rebarOrder)), structural.rebar!.summary.orderWeightKg!);
      const formulas: { sheet: string; address: string; result: unknown }[] = [];
      book.worksheets.forEach(sheet => sheet.eachRow(row => row.eachCell(cell => {
        if (!cell.formula) return;
        assert.ok(!cell.formula.includes('#REF!'));
        for (const match of cell.formula.matchAll(/'((?:[^']|'')+)'!/g)) assert.ok(book.getWorksheet(match[1].replace(/''/g, "'")));
        formulas.push({ sheet: sheet.name, address: cell.address, result: cell.result });
      })));
      const room = view.rows('room').find(r => r.getCell(view.column('order')).formula?.includes('IF(AND('))!;
      const category = view.rows('category').find(r => view.category(r) === view.category(room))!;
      const roomOrder = { sheet: view.sheet.name, net: room.getCell(view.column('net')).address, order: room.getCell(view.column('order')).address,
        waste: Number(room.getCell(view.column('waste')).value), category: category.getCell(view.column('order')).address };
      const name = `${scope}-${language}.xlsx`;
      manifest[name] = { formulas, roomOrder };
      if (process.env.BETTERCALC_XLSX_OUTPUT) {
        await mkdir(process.env.BETTERCALC_XLSX_OUTPUT, { recursive: true });
        await writeFile(join(process.env.BETTERCALC_XLSX_OUTPUT, name), Buffer.from(bytes as unknown as ArrayBuffer));
      }
    }
  }
  assert.equal(JSON.stringify(plans), before, 'Exports must not mutate saved plans');
  if (process.env.BETTERCALC_XLSX_OUTPUT) await writeFile(join(process.env.BETTERCALC_XLSX_OUTPUT, 'verification.json'), JSON.stringify(manifest));
});
