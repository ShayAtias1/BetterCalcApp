import assert from 'node:assert/strict';
import type ExcelJS from 'exceljs';
import type { ExportContext } from '../../src/lib/exportLanguage.ts';

type Key = 'plan' | 'category' | 'item' | 'apartment' | 'net' | 'unit' | 'waste' | 'order' | 'area' | 'areaOrder' | 'details';

/** Locate native spreadsheet records by public headers instead of layout-dependent addresses. */
export function excelScheduleView(book: ExcelJS.Workbook, x: ExportContext) {
  const sheet = book.getWorksheet(x.t('exports.excel.sheets.schedule'));
  assert.ok(sheet, 'Quantity Schedule must exist');
  const headers = sheet.getRow(1).values as unknown[];
  const labels: Record<Key,string> = {
    plan:x.t('exports.common.plan'),category:x.t('exports.excel.schedule.headers.category'),item:x.t('exports.common.room'),
    apartment:x.t('exports.common.apartment'),net:x.t('exports.excel.native.net'),unit:x.t('exports.excel.schedule.headers.unit'),
    waste:x.t('exports.excel.schedule.headers.waste'),order:x.t('exports.excel.schedule.headers.order'),
    area:x.t('exports.excel.schedule.headers.area'),areaOrder:x.t('exports.excel.schedule.headers.areaOrder'),details:x.t('exports.common.notes'),
  };
  const column = (key: Key) => {const index=headers.indexOf(labels[key]);assert.ok(index>0,`Missing schedule column: ${key}`);return index;};
  const rows = (level: 'category' | 'apartment' | 'room') => {
    const result: ExcelJS.Row[]=[];
    sheet.eachRow(row=>{
      if(row.number===1)return;
      const item=row.getCell(column('item')).value;
      const keyColumn=headers.indexOf('Category key');
      if(!row.getCell(keyColumn).value)return;
      const total=typeof item==='string'&&item.startsWith(`${x.t('exports.excel.schedule.total')} · `);
      const apartment=total&&!!row.getCell(column('apartment')).value;
      if(level==='category'?total&&!apartment:level==='apartment'?apartment:!total)result.push(row);
    });return result;
  };
  const category=(row:ExcelJS.Row)=>{const text=String(row.getCell(column('category')).value);return text.startsWith(`${x.t('exports.excel.schedule.total')} · `)?text.slice(x.t('exports.excel.schedule.total').length+3):text;};
  return {sheet,column,rows,category};
}

/** Material shares form a separate dataset, never additional additive room quantities. */
export function excelMaterialView(book: ExcelJS.Workbook,x:ExportContext) {
 const sheet=book.getWorksheet(x.t('exports.excel.sheets.workItems'));assert.ok(sheet,'Material dataset must exist');
 const headers=sheet.getRow(1).values as unknown[];
 const labels={plan:x.t('exports.common.plan'),category:x.t('exports.excel.schedule.headers.category'),item:x.t('exports.excel.native.specification'),net:x.t('exports.excel.native.net'),order:x.t('exports.excel.schedule.headers.order')};
 const column=(key:keyof typeof labels)=>{const index=headers.indexOf(labels[key]);assert.ok(index>0,`Missing material column: ${key}`);return index;};
 const rows:ExcelJS.Row[]=[];sheet.eachRow(row=>{if(row.number>1)rows.push(row);});
 return {sheet,column,rows};
}
export function excelValue(cell: ExcelJS.Cell) {return cell.type === 6 ? cell.result : cell.value;}
