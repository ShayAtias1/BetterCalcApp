import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { buildQuantitySchedule } from '../../src/lib/quantitySchedule.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { withCatalogEntries } from '../../src/lib/workCatalog.ts';
import { BALCONY_ROW_COLOR } from '../../src/lib/reportRoomStyle.ts';
import { buildStructuralReport } from '../../src/lib/structuralQuantities.ts';
import type { Project } from '../../src/types/index.ts';

const value = (cell: ExcelJS.Cell) => typeof cell.value === 'object' && cell.value && 'result' in cell.value ? cell.value.result : cell.value;

for (const language of ['he', 'en'] as const) test(`${language}: native Excel preserves PDF quantities, materials and project scope`, async () => {
  const x = exportContext(language);
  const p = withCatalogEntries(structuredClone(PLAN_A), { specs: [{ id: 'white', categoryId: 'builtin:painting', name: 'White paint', specification: 'RAL 9010', createdAt: 1, updatedAt: 1 }], categories: [{ id: 'custom', name: 'Custom installation', method: 'manualCount', createdAt: 1, updatedAt: 1 }] });
  p.rooms[0].workItems.find(item => item.type === 'painting')!.allocations = [{ id: 'allocation', specId: 'white', quantity: null }];
  p.rooms[0].roomType = 'balcony';
  // Adjacent rooms can share a name and apartment while retaining different identities.
  p.rooms[1].name = p.rooms[0].name;
  p.rooms[0].workItems.push({ id: 'custom-work', type: 'custom', categoryId: 'custom', method: 'manualCount', manualQuantity: 3, wastePercent: 5 });
  p.concreteElements = [{ id: 'slab', kind: 'slab', mark: 'S1', grade: 'B-30', pageNumber: 1, points: p.rooms[0].points, depthM: 0.2, wastePercent: 5 }];
  p.rebarItems = [{ id: 'bars', kind: 'bars', pageNumber: 1, mark: 'R1', diameterMm: 16, count: 10, lengthM: 6, wastePercent: 5 }];
  const summaries = buildRoomSummaries(p);
  const structural = buildStructuralReport(p);
  const workbook = buildQuantitiesWorkbook(summaries, [], language, structural, p);
  const sheet = workbook.getWorksheet(x.t('exports.excel.sheets.schedule'))!;
  assert.ok(sheet.autoFilter);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].showGridLines, true);
  assert.equal(sheet.views[0].rightToLeft, language === 'he');
  const firstRoomRows = buildQuantitySchedule(p, [summaries[0]], x.t).filter(category => category.apartments.some(apt => apt.rooms.length)).length;
  assert.ok(sheet.model.merges.includes(`B2:B${firstRoomRows + 1}`));
  assert.ok(sheet.model.merges.every(range => /^([AB])\d+:\1\d+$/.test(range) || /^B\d+:D\d+$/.test(range)));
  assert.notEqual(sheet.getCell(2, 2).master.address, sheet.getCell(firstRoomRows + 2, 2).master.address);
  const dataEnd = (sheet.autoFilter as { to: { row: number } }).to.row;
  assert.equal(sheet.getRow(dataEnd + 1).hasValues, false);
  assert.equal(sheet.getRow(dataEnd + 2).hasValues, false);
  assert.equal(sheet.getRow(dataEnd + 3).hasValues, true);
  assert.equal(sheet.getCell(2, 1).master.address, sheet.getCell(firstRoomRows + 2, 1).master.address);
  const secondApartmentRow = sheet.getRows(2, dataEnd - 1)!.find(row => row.getCell(sheet.columnCount).value === JSON.stringify([0, '12']))!;
  assert.notEqual(sheet.getCell(2, 1).master.address, secondApartmentRow.getCell(1).master.address);
  assert.equal(sheet.getCell('A1').value, x.t('exports.common.apartment'));
  assert.equal(sheet.getCell('B1').value, x.t('exports.common.room'));
  assert.equal(sheet.getCell('F1').value, x.t('exports.excel.native.net'));
  const balconyFill=sheet.getCell('A2').fill;assert.equal(balconyFill.type,'pattern');
  assert.equal(balconyFill.type==='pattern'&&balconyFill.fgColor?.argb, `FF${BALCONY_ROW_COLOR.slice(1)}`);
  assert.ok(!workbook.getWorksheet(x.t('exports.excel.sheets.projectSummary')));
  for (const category of buildQuantitySchedule(p, summaries, x.t)) {
    const totals = sheet.getRows(dataEnd + 3, sheet.rowCount - dataEnd - 2)!.filter(row => row.getCell(1).value === '' && row.getCell(sheet.columnCount - 1).value === category.column);
    assert.equal(totals.length, 1);
    assert.equal(value(totals[0].getCell(6)), category.net);
    assert.equal(value(totals[0].getCell(8)), category.order);
    assert.match(totals[0].getCell(6).formula, /SUMIFS/);
  }
  const materials = workbook.getWorksheet(x.t('exports.excel.sheets.workItems'))!;
  assert.ok(materials.autoFilter);
  const typed = buildQuantitySchedule(p, summaries, x.t).flatMap(category => category.types);
  assert.equal(materials.rowCount - 1, typed.length);
  typed.forEach((type, i) => { assert.equal(value(materials.getCell(i + 2, 4)), type.net); assert.equal(value(materials.getCell(i + 2, 6)), type.order); });
  const structure = workbook.getWorksheet(x.t('exports.excel.sheets.structural'))!;
  assert.equal(value(structure.getCell('F4')), structural.concrete!.summary.volumeM3);
  assert.equal(value(structure.getCell('H4')), structural.concrete!.summary.orderM3);
  assert.equal(value(structure.getCell('I9')), structural.rebar!.summary.weightKg);
  assert.equal(value(structure.getCell('K9')), structural.rebar!.summary.orderWeightKg);
  assert.equal(structure.getTables().length, 2);

  const project = { id: 'project', name: 'Export validation', createdAt: 1, updatedAt: 1 } as Project;
  const copy = { ...structuredClone(p), id: 'second-plan', name: 'Second plan' };
  const full = buildProjectWorkbook(project, [p, copy], language);
  const consolidated = full.getWorksheet(x.t('exports.excel.sheets.projectSummary'))!;
  assert.ok(consolidated.autoFilter);
  assert.equal(full.worksheets.filter(s => s.name === consolidated.name).length, 1);
  for (const category of buildQuantitySchedule(p, summaries, x.t)) {
    const row = consolidated.getRows(2, consolidated.rowCount - 1)!.find(row => row.getCell(1).value === category.info.label)!;
    assert.equal(value(row.getCell(3)), Math.round(category.net * 2 * 100) / 100);
    assert.equal(value(row.getCell(4)), Math.round(category.order * 2 * 100) / 100);
  }
  const areas = full.getWorksheet(x.t('exports.excel.sheets.areas'))!;
  assert.ok(areas.autoFilter);
  assert.deepEqual(areas.model.merges, []);
  for (const kind of ['demolition', 'construction'] as const) {
    const source = p.measurements.filter(m => m.areaKind === kind && typeof m.areaM2 === 'number');
    const total = areas.getRows(2, areas.rowCount - 1)!.find(row => row.getCell(5).value === x.t('exports.excel.schedule.total') && row.getCell(4).value === x.t(`areaKinds.${kind}`))!;
    assert.equal(value(total.getCell(8)), Math.round(source.reduce((n, m) => n + Math.round(m.areaM2! * 100) / 100, 0) * 2 * 100) / 100);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  assert.equal(restored.worksheets.length, workbook.worksheets.length);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(xml, /state="frozen"/);
  assert.ok(!xml.includes('pageLayout'));
  assert.deepEqual([...xml.matchAll(/<mergeCell\s+ref="([^"]+)"/g)].map(match => match[1]).sort(), [...sheet.model.merges].sort());
  await mkdir('/tmp/bettercalc-native-excel', { recursive: true });
  await writeFile(`/tmp/bettercalc-native-excel/quantity-schedule-${language}.xlsx`, new Uint8Array(buffer as unknown as ArrayBuffer));
  await writeFile(`/tmp/bettercalc-native-excel/project-schedule-${language}.xlsx`, new Uint8Array(await full.xlsx.writeBuffer() as unknown as ArrayBuffer));
});

test('project formulas isolate distinct plans with identical display names',()=>{
 const first=structuredClone(PLAN_A),second=structuredClone(PLAN_A);
 second.id='second';second.name=first.name;
 second.rooms[0].points=second.rooms[0].points.map(p=>({x:p.x*2,y:p.y*2}));
 const x=exportContext('en');
 const workbook=buildProjectWorkbook({id:'project',name:'Test',createdAt:1,updatedAt:1,planIds:[first.id,second.id]},[first,second],'en');
 const sheet=workbook.getWorksheet(x.t('exports.excel.sheets.schedule'))!;
 const keyColumn=(sheet.getRow(1).values as unknown[]).indexOf('Category key');
 const rows=sheet.getRows(2,sheet.rowCount-1)!;
 const totals=rows.filter(row=>row.getCell(2).value===''&&String(row.getCell(keyColumn).value).endsWith(':tiling_regular'));
 assert.equal(totals.length,2);assert.notEqual(totals[0].getCell(keyColumn).value,totals[1].getCell(keyColumn).value);
 for(const total of totals){
  const net=total.getCell(7),key=total.getCell(keyColumn);
  assert.ok(net.formula.includes(key.address));
  const expected=rows.filter(row=>row.number<totals[0].number&&row.getCell(keyColumn).value===key.value).reduce((n,row)=>n+(typeof row.getCell(7).value==='number'?Number(row.getCell(7).value):0),0);
  assert.equal(value(net),Math.round(expected*100)/100);
 }
});
