import type ExcelJS from 'exceljs';
import type { Project, ReportColumn } from '../types';
import type { ExportContext } from './exportLanguage';
import { buildRoomMatrices, summaryHeaders } from './quantitySchedulePdf';
import { primaryReading, totalColumnInfo, type ProjectQuantities } from './projectQuantities';
import { sheetRef } from './excelSheetRef';
import { colLetter, DASH, fillRow, noteRow, NUM_FMT, sectionTitle, sheetTitle, styleHeader, writeScheduleTable, XL, type ScheduleEntry } from './excelReport';

export type MatrixTotals = Map<ReportColumn, { net: string; order: string; area?: string; areaOrder?: string }>;
const BORDER = { style: 'thin' as const, color: { argb: 'FFE2E8F0' } };
const argb = (color: string) => `FF${color.replace('#', '')}`;

function body(row: ExcelJS.Row, columns: number, color: string, bold = false) {
  fillRow(row, color, columns, bold);
  row.height = 48;
  for (let c = 1; c <= columns; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Arial', size: 11, bold, color: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  }
}

/** Keep explanatory text out of Excel number formats, which have strict syntax and length limits. */
function readingNotes(sheet: ExcelJS.Worksheet, cells: { sub?: string }[], columns: number, color: string) {
  const notes = cells.slice(2, columns - 2).map(cell => cell.sub || '');
  if (!notes.some(Boolean)) return;
  const row = sheet.addRow(['', '', ...notes]);
  body(row, columns, color);
  row.height = Math.max(32, Math.max(...notes.map(text => Math.ceil(text.length / 20))) * 14);
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: 'Arial', size: 10, color: { argb: XL.muted } };
  });
  row.outlineLevel = 1;
  return row;
}

function separateRoom(sheet: ExcelJS.Worksheet, main: ExcelJS.Row, notes: ExcelJS.Row | undefined, columns: number) {
  const separator = { style: 'medium' as const, color: { argb: 'FF94A3B8' } };
  for (let c = 1; c <= columns; c++) {
    main.getCell(c).border = { ...main.getCell(c).border, top: separator, bottom: notes ? undefined : separator };
    if (notes) notes.getCell(c).border = { ...notes.getCell(c).border, top: undefined, bottom: separator };
  }
  if (notes) for (const c of [1, 2, columns - 1, columns]) {
    sheet.mergeCells(main.number, c, notes.number, c);
    main.getCell(c).border = { ...main.getCell(c).border, bottom: separator };
  }
}

/** The engine calculates before rounding and can combine work items with different waste rates. */
function orderFormula(net: string, wasteCell: string, amount: number | null, waste: number | null, result: number | null): ExcelJS.CellValue {
  const calculate = `ROUND(${net}*(1+IF(ISNUMBER(${wasteCell}),${wasteCell},0)/100),2)`;
  const differs = amount !== null && result !== null && Math.abs(Math.round(amount * (1 + (waste ?? 0) / 100) * 100) / 100 - result) > .000001;
  const value = differs ? `IF(AND(${net}=${amount},${wasteCell}=${waste ?? 0}),${result},${calculate})` : calculate;
  return { formula: `IF(ISNUMBER(${net}),${value},"${DASH}")`, result: result ?? DASH };
}

/** Same bands, room order, paired readings and details as PDF; quantities remain numeric cells. */
export function writeRoomMatrix(sheet: ExcelJS.Worksheet, entry: ScheduleEntry, x: ExportContext): MatrixTotals {
  const totals: MatrixTotals = new Map();
  // Legacy callers without a document cannot supply room notes/types/openings.
  if (!entry.plan) {
    const layout = writeScheduleTable(sheet, [entry], x, false);
    layout.categories[0]?.forEach((value, category) => totals.set(category, {
      net: `${colLetter(layout.col.net!)}${value.row}`, order: `${colLetter(layout.col.order!)}${value.row}`,
      ...(layout.col.area ? { area: `${colLetter(layout.col.area)}${value.row}`, areaOrder: `${colLetter(layout.col.areaOrder!)}${value.row}` } : {}),
    }));
    return totals;
  }
  const matrices = buildRoomMatrices({ plan: entry.plan, summaries: entry.summaries }, x);
  sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const metadata: (() => void)[] = [];
  let visibleColumns = 4;
  for (const matrix of matrices) {
    sectionTitle(sheet, x.t('exports.quantityPdf.schedule.title'));
    const top = sheet.addRow([]), bottom = sheet.addRow([]);
    const columns = 4 + matrix.categories.length * 2;
    visibleColumns = Math.max(visibleColumns, columns);
    styleHeader(top, columns); styleHeader(bottom, columns);
    top.height = 30; bottom.height = 24;
    const merge = (first: number, last: number, text: string, vertical = false) => {
      sheet.mergeCells(top.number, first, vertical ? bottom.number : top.number, last);
      top.getCell(first).value = text;
    };
    merge(1, 1, x.t('exports.common.apartment'), true);
    merge(2, 2, x.t('exports.common.room'), true);
    sheet.getColumn(1).width = 12; sheet.getColumn(2).width = 32;
    matrix.categories.forEach((category, i) => {
      const c = 3 + i * 2;
      merge(c, c + 1, x.t('exports.quantityPdf.categoryWithUnit', { label: category.info.label, unit: category.info.unitLabel }));
      bottom.getCell(c).value = x.t('exports.quantityPdf.columns.net');
      bottom.getCell(c + 1).value = x.t('exports.quantityPdf.columns.order');
      sheet.getColumn(c).width = 17; sheet.getColumn(c + 1).width = 17;
    });
    merge(columns - 1, columns, x.t('exports.quantityPdf.columns.details'));
    bottom.getCell(columns - 1).value = x.t('exports.quantityPdf.columns.openings');
    bottom.getCell(columns).value = x.t('exports.common.notes');
    sheet.getColumn(columns - 1).width = Math.max(sheet.getColumn(columns - 1).width ?? 0, 28);
    sheet.getColumn(columns).width = Math.max(sheet.getColumn(columns).width ?? 0, 32);
    const categoryRooms = matrix.categories.map(category => new Map(category.apartments.flatMap(a => a.rooms).map(room => [room.summary.roomId, room])));
    const summaries = entry.summaries.filter(s => categoryRooms.some(rooms => rooms.has(s.roomId)));
    const first = sheet.rowCount + 1;
    const areaReferences = matrix.categories.map(() => [] as { net: string; order: string }[]);
    matrix.rows.filter(r => !r.total).forEach((view, index) => {
      const row = sheet.addRow([]);
      body(row, columns, view.bg ? argb(view.bg) : index % 2 ? XL.zebraB : XL.zebraA);
      view.cells.forEach((value, i) => {
        const cell = row.getCell(i + 1);
        cell.value = [value.main, value.sub].filter(Boolean).join('\n');
        if (value.color) cell.font = { ...cell.font, color: { argb: argb(value.color) } };
      });
      row.getCell(2).font = { ...row.getCell(2).font, bold: true };
      for (const c of [2, columns - 1, columns]) row.getCell(c).alignment = { horizontal: x.rtl ? 'right' : 'left', vertical: 'middle', wrapText: true };
      matrix.categories.forEach((category, i) => {
        const room = categoryRooms[i].get(summaries[index].roomId), net = row.getCell(3 + i * 2), order = row.getCell(4 + i * 2);
        if (!room || room.unavailable) return;
        net.value = room.net ?? DASH; net.numFmt = NUM_FMT;
        order.value = room.order ?? DASH; order.numFmt = NUM_FMT;
        // Hidden calculation rows preserve editable numeric inputs without widening the report.
        metadata.push(() => {
          const inputs = sheet.addRow([room.waste, room.areaNet, room.areaOrder]); inputs.hidden = true;
          const waste = inputs.getCell(1).address;
          order.value = orderFormula(net.address, waste, room.net, room.waste, room.order);
          if (category.strip) {
            inputs.getCell(3).value = orderFormula(inputs.getCell(2).address, waste, room.areaNet, room.waste, room.areaOrder);
            areaReferences[i].push({ net: inputs.getCell(2).address, order: inputs.getCell(3).address });
          }
        });
      });
      const notes = readingNotes(sheet, view.cells, columns, view.bg ? argb(view.bg) : index % 2 ? XL.zebraB : XL.zebraA);
      separateRoom(sheet, row, notes, columns);
    });
    const last = sheet.rowCount, total = sheet.addRow([]);
    body(total, columns, XL.category, true); total.getCell(2).value = x.t('exports.common.total');
    matrix.categories.forEach((category, i) => {
      const net = total.getCell(3 + i * 2), order = total.getCell(4 + i * 2);
      for (const [cell, result] of [[net, category.net], [order, category.order]] as const) {
        const letter = colLetter(Number(cell.col));
        cell.value = { formula: `ROUND(SUM(${letter}${first}:${letter}${last}),2)`, result };
      }
      net.numFmt = NUM_FMT;
      order.numFmt = NUM_FMT;
      const cells = { net: net.address, order: order.address };
      totals.set(category.column, cells);
      if (category.strip) metadata.push(() => {
        const area = sheet.addRow([]); area.hidden = true;
        const refs = areaReferences[i];
        area.getCell(2).value = { formula: `ROUND(SUM(${refs.map(r => r.net).join(',') || '0'}),2)`, result: category.areaNet ?? 0 };
        area.getCell(3).value = { formula: `ROUND(SUM(${refs.map(r => r.order).join(',') || '0'}),2)`, result: category.areaOrder ?? 0 };
        totals.set(category.column, { ...cells, area: area.getCell(2).address, areaOrder: area.getCell(3).address });
      });
    });
    readingNotes(sheet, matrix.rows.at(-1)!.cells, columns, XL.category);
  }
  const categories = matrices.flatMap(m => m.categories);
  const materials = categories.filter(c => c.types.some(type => type.specId !== null));
  if (materials.length) {
    sectionTitle(sheet, x.t('exports.quantityPdf.schedule.byType'));
    const header = sheet.addRow([x.t('exports.quantityPdf.schedule.byType'), '', x.t('exports.quantityPdf.schedule.headers.unit'), x.t('exports.quantityPdf.columns.net'), x.t('exports.quantityPdf.columns.order')]);
    styleHeader(header, 5); sheet.mergeCells(header.number, 1, header.number, 2);
    visibleColumns = Math.max(visibleColumns, 5);
    let index = 0;
    for (const category of materials) for (const type of category.types) {
      const name = type.specId === null ? x.t('workCatalog.sources.unassigned') : type.specification ? `${type.label} · ${type.specification}` : type.label;
      const area = category.strip ? x.t('exports.quantityPdf.schedule.areaReading', { net: x.number(type.areaNet ?? 0), order: x.number(type.areaOrder ?? 0), unit: x.t('units.m2') }) : '';
      const row = sheet.addRow([[name, category.info.label, area].filter(Boolean).join('\n'), '', category.info.unitLabel, type.net, type.order]);
      body(row, 5, index++ % 2 ? XL.zebraB : XL.zebraA); row.height = 60;
      sheet.mergeCells(row.number, 1, row.number, 2);
      row.getCell(1).alignment = { horizontal: x.rtl ? 'right' : 'left', vertical: 'middle', wrapText: true };
      row.getCell(4).numFmt = NUM_FMT; row.getCell(5).numFmt = NUM_FMT;
    }
  }
  for (const category of categories) if (category.over > 0) noteRow(sheet, `${category.info.label}: ${x.t('workCatalog.overAllocated', { amount: x.number(category.over), unit: category.info.unitLabel })}`);
  const printEnd = sheet.rowCount;
  metadata.forEach(write => write());
  sheet.pageSetup = { ...sheet.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:${colLetter(visibleColumns)}${printEnd}` };
  return totals;
}

/** PDF's single consolidated summary, with live references to each plan's matrix total. */
export function writeMatrixProjectSummary(sheet: ExcelJS.Worksheet, project: Project, q: ProjectQuantities, layouts: MatrixTotals[], scheduleName: string, x: ExportContext) {
  sheetTitle(sheet, x.t('exports.projectPdf.title', { name: project.name }), x.t('exports.projectPdf.subtitle', { count: q.plans.length, date: x.today() }));
  sectionTitle(sheet, x.t('exports.projectPdf.summary'));
  styleHeader(sheet.addRow(summaryHeaders(x)), 5);
  [34, 17, 12, 17, 45].forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  const ref = sheetRef(scheduleName);
  for (const total of q.totals) {
    const info = totalColumnInfo(total, x.t), reading = primaryReading(total, info);
    if (!reading.net && !reading.order && !total.quantityM2) continue;
    const details = info.unit === 'lm' && info.hasArea ? x.t('exports.quantityPdf.schedule.areaReading', { net: x.number(total.quantityM2 ?? 0), order: x.number(total.orderM2 ?? 0), unit: x.t('units.m2') }) : '';
    const row = sheet.addRow([total.label, reading.net ?? 0, info.unitLabel, reading.order ?? 0, details]);
    body(row, 5, XL.group, true);
    for (const [column, key, result] of [[2, 'net', reading.net], [4, 'order', reading.order]] as const) {
      const refs = layouts.flatMap(layout => { const cell = layout.get(total.category)?.[key]; return cell ? [`${ref}${cell}`] : []; });
      if (refs.length) row.getCell(column).value = { formula: `ROUND(SUM(${refs.join(',')}),2)`, result: result ?? 0 };
      row.getCell(column).numFmt = NUM_FMT;
    }
  }
  if (q.uncalibratedRoomCount) noteRow(sheet, x.t('exports.projectPdf.uncalibratedNote', { count: q.uncalibratedRoomCount }));
  sheet.pageSetup = { ...sheet.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}
