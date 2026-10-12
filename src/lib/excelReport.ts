/**
 * The compact workbook: a few sheets, each made of clearly headed sections.
 *
 * - Quantity Schedule: (a plan's summary,) then every work category with its total, the types that
 *   split it and its apartments / rooms — numbers and live formulas, never formatted text. Category
 *   and apartment totals are SUMs over the room rows only, so type shares are never counted twice.
 * - Openings & Deductions: opening counts, the opening schedule, applied deductions and unresolved
 *   openings, as sections of one sheet.
 * - Project Summary (project workbooks only): plans and one consolidated total per category,
 *   referencing the schedule's category totals.
 *
 * Figures come from the shared schedule model (lib/quantitySchedule) and the opening report; nothing
 * is recalculated here.
 */

import type ExcelJS from 'exceljs';
import { borderTableRow } from './excelTableBorders';
import type { Measurement, Plan, Project, ReportColumn, RoomQuantitySummary } from '../types';
import { columnWidths, type ExportContext } from './exportLanguage';
import { sheetRef } from './excelSheetRef';
import { apartmentTotal, buildQuantitySchedule, roomNotesText, type ScheduleCategory } from './quantitySchedule';
import { calculateWorkItem, roomMetrics } from './quantities';
import { planStatusText, primaryReading, totalColumnInfo, type ProjectQuantities } from './projectQuantities';
import { buildOpeningQuantityReport, openingReportTables } from './openingQuantityReport';
import type { OpeningScheduleRow } from './openingQuantities';
import { numberAreaMeasurements } from './areaMeasurements';
import { itemUnitLabel, workItemLabel } from './workCatalog';
import { workItemDefinition } from './workTypes';
import { BALCONY_ROW_COLOR, isBalconyRoom } from './reportRoomStyle';

export const DASH = '-';
export const NUM_FMT = '#,##0.00';
const PCT_FMT = '0.##';

export const XL = {
  header: 'FF1F4E79',
  category: 'FFD6E4F0',
  group: 'FFEEF3F8',
  type: 'FFF5F9FD',
  zebraA: 'FFEBF5FB',
  zebraB: 'FFFDFEFE',
  grand: 'FFD5F5E3',
  warn: 'FF92400E',
  muted: 'FF64748B',
};

export function colLetter(n: number): string {
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function fillRow(row: ExcelJS.Row, argb: string, count: number, bold = false) {
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    if (bold) cell.font = { ...(cell.font ?? {}), bold: true };
  }
  borderTableRow(row, count, argb === XL.category || argb === XL.grand || argb === XL.group && bold ? 'total' : 'data');
}

export function styleHeader(row: ExcelJS.Row, count: number) {
  row.height = 36;
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.header } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  borderTableRow(row, count, 'header');
}

/** A section's heading: bold, larger, with a blank line before it (except at the top of a sheet). */
export function sectionTitle(sheet: ExcelJS.Worksheet, text: string) {
  if (sheet.rowCount > 0) sheet.addRow([]);
  const row = sheet.addRow([text]);
  row.getCell(1).font = { bold: true, size: 13, color: { argb: XL.header } };
  row.height = 22;
  return row;
}

/** The sheet's own title and subtitle lines. */
export function sheetTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string) {
  const row = sheet.addRow([title]);
  row.getCell(1).font = { bold: true, size: 15 };
  row.height = 24;
  sheet.addRow([subtitle]).getCell(1).font = { color: { argb: 'FF8B8F99' } };
}

/** Column widths shared by several sections: each column keeps the widest any section needs. */
export function widen(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.max(column.width ?? 0, w);
  });
}

export function newSheet(workbook: ExcelJS.Workbook, name: string, x: ExportContext): ExcelJS.Worksheet {
  return workbook.addWorksheet(name.slice(0, 31), {
    views: [{ rightToLeft: x.rtl, showGridLines: true, state: 'normal' }],
  });
}

/** Keep gridlines and only the column headers frozen, without a PDF-style worksheet view. */
export function normalWorkbookView(workbook: ExcelJS.Workbook, x: ExportContext) {
  for (const sheet of workbook.worksheets) {
    const header = sheet.views.find(view => view.state === 'frozen');
    sheet.views = [{ state: 'frozen', ySplit: header && 'ySplit' in header ? header.ySplit ?? 1 : 1, rightToLeft: x.rtl, showGridLines: true, showRowColHeaders: true }];
  }
}

// ---------------------------------------------------------------------------------------------
// Quantity Schedule
// ---------------------------------------------------------------------------------------------

type ColumnKey = 'plan' | 'category' | 'item' | 'apartment' | 'net' | 'unit' | 'waste' | 'order' | 'area' | 'areaOrder' | 'level' | 'details';
const WIDTH: Record<ColumnKey, number> = { plan: 20, category: 22, item: 30, apartment: 10, net: 13, unit: 8, waste: 9, order: 13, area: 12, areaOrder: 14, level: 16, details: 34 };

export interface ScheduleEntry {
  plan: Plan | null;
  planName: string;
  summaries: RoomQuantitySummary[];
}

/** Where a plan's category totals landed, for the project summary's references. */
export type CategoryCells = Map<ReportColumn, { row: number }>;

export interface ScheduleLayout {
  /** 1-based column of each figure. */
  col: Record<'net' | 'order' | 'area' | 'areaOrder', number | null>;
  /** Per entry (plan), its category total rows. */
  categories: CategoryCells[];
}

function scheduleColumns(withPlan: boolean, withArea: boolean): ColumnKey[] {
  return [
    'item', 'unit', 'net',
    ...(withPlan ? (['plan'] as const) : []),
    'category', 'apartment', 'waste', 'order',
    ...(withArea ? (['area', 'areaOrder'] as const) : []),
    'level', 'details',
  ];
}

/**
 * Writes the schedule table of the given plans into `sheet`, from its next row: one header, then per
 * plan (a plan row when there are several) its categories. Returns where the totals are.
 */
export function writeScheduleTable(sheet: ExcelJS.Worksheet, entries: ScheduleEntry[], x: ExportContext, withPlan: boolean): ScheduleLayout {
  const { t } = x;
  const models = entries.map((e) => buildQuantitySchedule(e.plan, e.summaries, t));
  // Area columns only when some category is a strip (skirting and the like).
  const withArea = models.some((m) => m.some((c) => c.strip));
  const keys = scheduleColumns(withPlan, withArea);
  const at = (k: ColumnKey) => keys.indexOf(k) + 1;
  const L = (k: ColumnKey) => colLetter(at(k));
  const headers = keys.map((k) => t(`exports.excel.schedule.headers.${k}`));
  widen(sheet, columnWidths(keys.map((k) => WIDTH[k]), headers, x.language, 2));
  const header = sheet.addRow(headers);
  styleHeader(header, keys.length);
  const firstData = header.number + 1;
  const layout: ScheduleLayout = { col: { net: at('net'), order: at('order'), area: withArea ? at('area') : null, areaOrder: withArea ? at('areaOrder') : null }, categories: [] };

  const put = (row: ExcelJS.Row, k: ColumnKey, value: ExcelJS.CellValue) => {
    if (keys.includes(k)) row.getCell(at(k)).value = value;
  };
  const numeric = (row: ExcelJS.Row) => {
    for (const k of ['net', 'order', 'area', 'areaOrder'] as const) if (keys.includes(k)) row.getCell(at(k)).numFmt = NUM_FMT;
    row.getCell(at('waste')).numFmt = PCT_FMT;
    for (const k of ['net', 'unit', 'waste', 'order', 'area', 'areaOrder', 'level', 'apartment'] as const) {
      if (keys.includes(k)) row.getCell(at(k)).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  };
  /** Keep the engine's order amount until inputs change: it applies waste before rounding and
   * may combine several work items with different waste percentages in the same room/category. */
  const orderFormula = (r: number, net: ColumnKey, amount: number | null, waste: number | null, result: number | null) => {
    const n = `${L(net)}${r}`, w = `${L('waste')}${r}`;
    const calculated = `ROUND(${n}*(1+IF(ISNUMBER(${w}),${w},0)/100),2)`;
    const differs = amount !== null && result !== null && Math.abs(Math.round(amount * (1 + (waste ?? 0) / 100) * 100) / 100 - result) > 0.000001;
    const order = differs ? `IF(AND(${n}=${amount},${w}=${waste ?? 0}),${result},${calculated})` : calculated;
    return { formula: `IF(ISNUMBER(${n}),${order},"${DASH}")`, result: result ?? DASH };
  };
  // A total of rooms that are all on unscaled sheets is a dash, not a 0.
  const sumOf = (refs: string, result: number | null) => ({ formula: `IF(COUNT(${refs})=0,"${DASH}",ROUND(SUM(${refs}),2))`, result: result ?? DASH });
  const level = (key: 'category' | 'type' | 'apartment' | 'room') => t(`exports.excel.schedule.levels.${key}`);

  entries.forEach((entry, e) => {
    const cells: CategoryCells = new Map();
    layout.categories.push(cells);
    if (withPlan && entries.length > 1) {
      const row = sheet.addRow([]);
      put(row, 'plan', entry.planName);
      put(row, 'category', t('exports.projectPdf.planSection', { name: entry.planName }));
      fillRow(row, XL.group, keys.length, true);
    }
    for (const c of models[e]) {
      const unit = c.info.unitLabel;
      const base = (row: ExcelJS.Row) => {
        put(row, 'plan', entry.planName);
        put(row, 'category', c.info.label);
        put(row, 'unit', unit);
      };
      // Category total — its figures are filled in once its room rows exist.
      const catRow = sheet.addRow([]);
      base(catRow);
      put(catRow, 'item', t('exports.excel.schedule.total'));
      put(catRow, 'waste', c.waste ?? '');
      put(catRow, 'level', level('category'));
      put(catRow, 'details', [c.manual ? t('workCatalog.manualBadge') : '', c.over > 0 ? t('workCatalog.overAllocated', { amount: x.number(c.over), unit }) : ''].filter(Boolean).join(' · '));
      cells.set(c.column, { row: catRow.number });

      // Types: shares of the category's total (values; never part of any SUM).
      c.types.forEach((type) => {
        const row = sheet.addRow([]);
        base(row);
        put(row, 'item', type.specification ? `${type.label} · ${type.specification}` : type.label);
        put(row, 'net', type.net);
        put(row, 'order', type.order);
        put(row, 'area', type.areaNet ?? '');
        put(row, 'areaOrder', type.areaOrder ?? '');
        put(row, 'level', level('type'));
        put(row, 'details', t(`workCatalog.sources.${type.source}`));
        numeric(row);
        fillRow(row, XL.type, keys.length);
        row.getCell(at('item')).font = { color: { argb: XL.header } };
        row.getCell(at('item')).alignment = { indent: 1 };
      });

      // Rooms, under apartment subtotals when the category spans several apartments.
      const totalsRefs: Record<'net' | 'order' | 'area' | 'areaOrder', string[]> = { net: [], order: [], area: [], areaOrder: [] };
      let zebra = 0;
      for (const apartment of c.apartments) {
        const aptRow = c.grouped ? sheet.addRow([]) : null;
        const firstRoom = sheet.rowCount + 1;
        for (const room of apartment.rooms) {
          const row = sheet.addRow([]);
          base(row);
          const r = row.number;
          put(row, 'item', room.name);
          put(row, 'apartment', room.apartment || DASH);
          put(row, 'net', room.unavailable ? t('exports.common.notCalibrated') : room.net);
          put(row, 'waste', room.waste);
          put(row, 'order', orderFormula(r, 'net', room.net, room.waste, room.order));
          if (c.strip) {
            put(row, 'area', room.unavailable ? t('exports.common.notCalibrated') : room.areaNet);
            put(row, 'areaOrder', orderFormula(r, 'area', room.areaNet, room.waste, room.areaOrder));
          }
          put(row, 'level', level('room'));
          put(row, 'details', roomNotesText(room.notes, t, x.number).join(' · '));
          numeric(row);
          const balcony = isBalconyRoom(entry.plan?.rooms.find(r => r.id === room.summary.roomId));
          fillRow(row, balcony ? `FF${BALCONY_ROW_COLOR.slice(1)}` : zebra % 2 ? XL.zebraB : XL.zebraA, keys.length);
          zebra++;
          row.getCell(at('item')).alignment = { indent: c.grouped ? 2 : 1 };
          if (room.unavailable) row.getCell(at('net')).font = { color: { argb: XL.warn } };
        }
        const lastRoom = sheet.rowCount;
        if (aptRow) {
          const total = apartmentTotal(apartment);
          base(aptRow);
          put(aptRow, 'item', apartment.apartment ? t('rooms.apartment', { apartment: apartment.apartment }) : t('rooms.unassigned'));
          put(aptRow, 'apartment', apartment.apartment || DASH);
          put(aptRow, 'net', sumOf(`${L('net')}${firstRoom}:${L('net')}${lastRoom}`, total.net));
          put(aptRow, 'order', sumOf(`${L('order')}${firstRoom}:${L('order')}${lastRoom}`, total.order));
          if (c.strip) {
            put(aptRow, 'area', sumOf(`${L('area')}${firstRoom}:${L('area')}${lastRoom}`, total.areaNet));
            put(aptRow, 'areaOrder', sumOf(`${L('areaOrder')}${firstRoom}:${L('areaOrder')}${lastRoom}`, total.areaOrder));
          }
          put(aptRow, 'level', level('apartment'));
          numeric(aptRow);
          fillRow(aptRow, XL.group, keys.length, true);
          aptRow.getCell(at('item')).alignment = { indent: 1 };
          for (const k of ['net', 'order', 'area', 'areaOrder'] as const) totalsRefs[k].push(`${L(k)}${aptRow.number}`);
        } else {
          for (const k of ['net', 'order', 'area', 'areaOrder'] as const) totalsRefs[k].push(`${L(k)}${firstRoom}:${L(k)}${lastRoom}`);
        }
      }
      // Cached results match what the formulas give: a dash when no room of the category has a number.
      const none = c.apartments.every((a) => a.rooms.every((r) => r.unavailable));
      put(catRow, 'net', sumOf(totalsRefs.net.join(','), none ? null : c.net));
      put(catRow, 'order', sumOf(totalsRefs.order.join(','), none ? null : c.order));
      if (c.strip) {
        put(catRow, 'area', sumOf(totalsRefs.area.join(','), none ? null : c.areaNet));
        put(catRow, 'areaOrder', sumOf(totalsRefs.areaOrder.join(','), none ? null : c.areaOrder));
      }
      numeric(catRow);
      fillRow(catRow, XL.category, keys.length, true);
    }
  });

  const last = sheet.rowCount;
  if (last >= firstData) sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: last, column: keys.length } };
  return layout;
}

/**
 * A plan's summary: one row per category, its figures referencing the category totals of the
 * schedule below. Written first (its rows reserved), filled once the schedule exists.
 */
export function reservePlanSummary(sheet: ExcelJS.Worksheet, model: ScheduleCategory[], x: ExportContext) {
  const { t } = x;
  sectionTitle(sheet, t('exports.excel.schedule.summaryTitle'));
  const header = sheet.addRow([]);
  const rows = model.map(() => sheet.addRow([]));
  return (layout: ScheduleLayout, withPlan: boolean) => {
    const o = withPlan ? 1 : 0;
    const keys: [string, number | null][] = [
      [t('exports.excel.schedule.headers.category'), 1 + o],
      [t('exports.excel.schedule.headers.net'), layout.col.net],
      [t('exports.excel.schedule.headers.unit'), layout.col.net! + 1],
      [t('exports.excel.schedule.headers.order'), layout.col.order],
      [t('exports.excel.schedule.headers.area'), layout.col.area],
      [t('exports.excel.schedule.headers.areaOrder'), layout.col.areaOrder],
    ];
    for (const [label, c] of keys) if (c) header.getCell(c).value = label;
    const width = layout.col.areaOrder ?? layout.col.order!;
    styleHeader(header, width);
    model.forEach((c, i) => {
      const row = rows[i];
      const target = layout.categories[0].get(c.column)!.row;
      row.getCell(1 + o).value = c.info.label;
      row.getCell(layout.col.net! + 1).value = c.info.unitLabel;
      const ref = (col: number | null, result: number | null) => {
        if (col && result !== null) row.getCell(col).value = { formula: `${colLetter(col)}${target}`, result };
      };
      ref(layout.col.net, c.net);
      ref(layout.col.order, c.order);
      if (c.strip) {
        ref(layout.col.area, c.areaNet);
        ref(layout.col.areaOrder, c.areaOrder);
      }
      for (const col of [layout.col.net, layout.col.order, layout.col.area, layout.col.areaOrder]) if (col) row.getCell(col).numFmt = NUM_FMT;
      fillRow(row, i % 2 ? XL.zebraB : XL.zebraA, width, true);
    });
  };
}

/** Demolition / new construction areas of one sheet: a row per marked area, per-kind and grand totals (live). */
export function writeAreaSection(sheet: ExcelJS.Worksheet, measurements: Measurement[], x: ExportContext, title = x.t('exports.excel.sheets.areas')) {
  const { t } = x;
  const keys = ['number', 'page', 'kind', 'calcMode', 'length', 'height', 'area'] as const;
  const headers = keys.map((k) => t(`exports.common.areaHeaders.${k}`));
  widen(sheet, columnWidths([6, 8, 14, 18, 14, 14, 14], headers, x.language));
  sectionTitle(sheet, title);
  styleHeader(sheet.addRow(headers), keys.length);
  const numbers = numberAreaMeasurements(measurements);
  const subtotalRefs: { area: string; length: string }[] = [];
  let grandArea = 0, grandLength = 0;
  for (const kind of ['demolition', 'construction'] as const) {
    const rows = measurements.filter((m) => m.areaKind === kind);
    if (!rows.length) continue;
    const first = sheet.rowCount + 1;
    let area = 0, length = 0;
    rows.forEach((m, i) => {
      const wall = m.calcMode === 'wall';
      const r = sheet.addRow([numbers.get(m.id) ?? '', m.pageNumber, t(`areaKinds.${kind}`), wall ? t('exports.common.calcWall') : t('exports.common.calcFootprint'),
        wall ? Math.round((m.wallLengthM ?? 0) * 100) / 100 : DASH, wall ? Math.round((m.wallHeightM ?? 0) * 100) / 100 : DASH, Math.round((m.areaM2 ?? 0) * 100) / 100]);
      area += Math.round((m.areaM2 ?? 0) * 100) / 100;
      if (wall) length += Math.round((m.wallLengthM ?? 0) * 100) / 100;
      for (const c of [5, 6, 7]) r.getCell(c).numFmt = NUM_FMT;
      fillRow(r, i % 2 ? XL.zebraB : XL.zebraA, keys.length);
      r.eachCell({ includeEmpty: true }, (cell) => (cell.alignment = { horizontal: 'center' }));
    });
    const last = sheet.rowCount;
    const total = sheet.addRow([t('exports.common.kindTotal', { kind: t(`areaKinds.${kind}`) }), '', '', '', null, '', null]);
    total.getCell(5).value = { formula: `ROUND(SUM(E${first}:E${last}),2)`, result: Math.round(length * 100) / 100 };
    total.getCell(7).value = { formula: `ROUND(SUM(G${first}:G${last}),2)`, result: Math.round(area * 100) / 100 };
    for (const c of [5, 7]) total.getCell(c).numFmt = NUM_FMT;
    fillRow(total, XL.category, keys.length, true);
    subtotalRefs.push({ area: `G${total.number}`, length: `E${total.number}` });
    grandArea += area;
    grandLength += length;
  }
  const grand = sheet.addRow([t('exports.common.grandTotal'), '', '', '', null, '', null]);
  grand.getCell(5).value = { formula: `ROUND(SUM(${subtotalRefs.map((r) => r.length).join(',') || 0}),2)`, result: Math.round(grandLength * 100) / 100 };
  grand.getCell(7).value = { formula: `ROUND(SUM(${subtotalRefs.map((r) => r.area).join(',') || 0}),2)`, result: Math.round(grandArea * 100) / 100 };
  for (const c of [5, 7]) grand.getCell(c).numFmt = NUM_FMT;
  fillRow(grand, XL.grand, keys.length, true);
}

/** A note line (warnings): bold, amber. */
export function noteRow(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  row.getCell(1).font = { bold: true, color: { argb: XL.warn } };
}

// ---------------------------------------------------------------------------------------------
// Openings & Deductions
// ---------------------------------------------------------------------------------------------

export interface OpeningsInput {
  plan: Plan | null;
  planName: string;
  summaries: RoomQuantitySummary[];
  pageScope?: Set<number>;
}

/**
 * The openings sheet: opening counts and schedule (plans with physical opening records), the
 * deductions actually applied (gross − deducted = net, live), and openings not deducted or still
 * unresolved. Nothing is written — and no sheet added — when there is nothing to say.
 */
export function addOpeningsSheet(workbook: ExcelJS.Workbook, inputs: OpeningsInput[], x: ExportContext, withPlan: boolean): ExcelJS.Worksheet | null {
  const { t } = x;
  const plans = inputs.flatMap((i) => (i.plan ? [i.plan] : []));
  const pageScope = inputs.length === 1 ? inputs[0].pageScope : undefined;
  const tables = plans.length ? openingReportTables(plans, x, undefined, pageScope) : [];
  const counts = tables.find((tb) => tb.title === t('openingQuantities.counts'));
  const schedule = tables.find((tb) => tb.title === t('openingQuantities.schedule'));
  const exclusions = tables.find((tb) => tb.title === t('openingQuantities.exclusions'));
  const applied = appliedDeductions(inputs, x);
  if (!counts && !schedule && !exclusions && !applied.length) return null;

  const sheet = newSheet(workbook, t('exports.excel.sheets.openings'), x);
  const reports = plans.map((plan) => buildOpeningQuantityReport(plan, undefined, pageScope));
  const warnings = new Map<OpeningScheduleRow['reasons'][number], string>();
  const warningCode = (reason: OpeningScheduleRow['reasons'][number]) => {
    if (!warnings.has(reason)) warnings.set(reason, `W${warnings.size + 1}`);
    return warnings.get(reason)!;
  };

  const textTable = (table: { headers: string[]; widths: number[]; rows: string[][] }, numberCells?: (row: ExcelJS.Row, i: number) => void) => {
    widen(sheet, columnWidths(table.widths, table.headers, x.language, 2));
    const header = sheet.addRow(table.headers);
    styleHeader(header, table.headers.length);
    if (!sheet.views.some(view => view.state === 'frozen')) sheet.views = [{ state: 'frozen', ySplit: header.number, rightToLeft: x.rtl, showGridLines: true }];
    table.rows.forEach((values, i) => {
      const row = sheet.addRow(values);
      fillRow(row, i % 2 ? XL.zebraB : XL.zebraA, table.headers.length);
      row.height = 30;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'center' };
        if (typeof cell.value === 'number') cell.numFmt = NUM_FMT;
      });
      numberCells?.(row, i);
    });
    sheet.addTable({ name: `Openings_${sheet.id}_${header.number}`, ref: `A${header.number}`, headerRow: true,
      columns: table.headers.map(name => ({ name, filterButton: true })),
      rows: table.rows.map((_, i) => table.headers.map((_, c) => sheet.getRow(header.number + 1 + i).getCell(c + 1).value)),
      style: { theme: 'TableStyleLight1', showRowStripes: false },
    });
  };

  if (counts) {
    sectionTitle(sheet, counts.title);
    // Counts stay numbers.
    textTable(counts, (row, i) => {
      row.getCell(2).value = reports[i]?.doors ?? reports.reduce((n, r) => n + r.doors, 0);
      row.getCell(3).value = reports[i]?.windows ?? reports.reduce((n, r) => n + r.windows, 0);
      row.getCell(2).numFmt = '#,##0'; row.getCell(3).numFmt = '#,##0';
      if (i >= reports.length) fillRow(row, XL.grand, 4, true);
    });
  }
  if (schedule) {
    sectionTitle(sheet, schedule.title);
    const rows = reports.flatMap((r) => r.listed);
    textTable(schedule, (row, i) => {
      const source = rows[i];
      [source.widthM, source.heightM, source.baseM, source.quantity, source.countedQuantity].forEach((n, j) => (row.getCell(j + 3).value = n));
      row.getCell(6).numFmt = '#,##0'; row.getCell(7).numFmt = '#,##0';
      if (source.reasons.length) {
        const countOverride = source.countedQuantity !== null && source.countKind !== source.kind ? ` · ${t('openingQuantities.counted')}: ${t(source.countKind === 'door' ? 'openingQuantities.door' : source.countKind === 'window' ? 'openingQuantities.windows' : 'openingTools.custom')}` : '';
        row.getCell(9).value = source.reasons.map(warningCode).join(', ') + countOverride;
      }
    });
  }
  if (applied.length) {
    sectionTitle(sheet, t('exports.excel.openings.applied'));
    const headers = [
      ...(withPlan ? [t('exports.common.plan')] : []),
      t('exports.common.apartment'), t('exports.common.room'), t('exports.excel.deductionHeaders.workType'), t('exports.quantityPdf.deductionHeaders.unit'),
      t('exports.quantityPdf.deductionHeaders.gross'), t('exports.quantityPdf.deductionHeaders.deducted'), t('exports.quantityPdf.deductionHeaders.net'),
    ];
    const o = withPlan ? 1 : 0;
    widen(sheet, columnWidths([...(withPlan ? [20] : []), 10, 24, 18, 8, 12, 14, 12], headers, x.language, 2));
    styleHeader(sheet.addRow(headers), headers.length);
    applied.forEach((d, i) => {
      const row = sheet.addRow([...(withPlan ? [d.planName] : []), d.apartment || DASH, d.room, d.work, d.unit, d.gross, d.deducted, null]);
      const r = row.number;
      const g = colLetter(5 + o), dd = colLetter(6 + o);
      // Net as a live formula, so the sheet itself shows how it was reached.
      row.getCell(7 + o).value = { formula: `ROUND(${g}${r}-${dd}${r},2)`, result: d.net };
      fillRow(row, i % 2 ? XL.zebraB : XL.zebraA, headers.length);
      row.eachCell({ includeEmpty: true }, (cell) => (cell.alignment = { horizontal: 'center' }));
      for (const c of [5, 6, 7]) row.getCell(c + o).numFmt = NUM_FMT;
    });
    sheet.addRow([t('exports.quantityPdf.deductionNote')]).getCell(1).font = { italic: true, color: { argb: XL.muted } };
  }
  if (exclusions) {
    sectionTitle(sheet, exclusions.title);
    textTable(exclusions);
  }
  if (plans.some((plan) => buildOpeningQuantityReport(plan, undefined, pageScope).incomplete)) {
    sheet.addRow([]);
    noteRow(sheet, t('openingQuantities.partialNote'));
  }
  for (const [reason, code] of warnings) {
    const row = sheet.addRow([code]);
    row.getCell(9).value = t(`openingQuantities.${reason}`);
    row.getCell(9).alignment = { wrapText: true, vertical: 'middle' };
    row.height = Math.max(30, Math.ceil(String(row.getCell(9).value).length / 45) * 13);
  }
  return sheet;
}

interface AppliedDeduction { planName: string; apartment: string; room: string; work: string; unit: string; gross: number; deducted: number; net: number }

/**
 * Every work item whose quantity openings actually reduced: built-in ones from the room summaries
 * (as the reports total them, per category), skirting's door widths, and custom wall / strip work.
 */
function appliedDeductions(inputs: OpeningsInput[], x: ExportContext): AppliedDeduction[] {
  const { t } = x;
  const out: AppliedDeduction[] = [];
  for (const input of inputs) {
    const rooms = new Map((input.plan?.rooms ?? []).map((r) => [r.id, r]));
    for (const s of input.summaries) {
      const base = { planName: input.planName, apartment: s.apartmentNumber, room: s.roomName || t('exports.common.unnamedRoom') };
      for (const d of s.openingDeductions) {
        out.push({ ...base, work: t(`reportCategories.${d.category}`), unit: t('units.m2'), gross: d.grossM2, deducted: d.deductedM2, net: d.netM2 });
      }
      if (s.panelsLengthM != null && (s.panelsDeductedLengthM ?? 0) > 0) {
        const gross = Math.round((s.panelsLengthM + s.panelsDeductedLengthM!) * 100) / 100;
        out.push({ ...base, work: t('reportCategories.panels'), unit: t('units.lm'), gross, deducted: s.panelsDeductedLengthM!, net: s.panelsLengthM });
      }
      // Custom wall and strip work deducts openings too; it is not in the built-in summaries.
      const room = rooms.get(s.roomId);
      if (!room || !s.pageCalibrated || !input.plan) continue;
      const { areaM2, perimeterM } = roomMetrics(room, input.plan.pages[room.pageNumber]?.calibration ?? null);
      for (const item of room.workItems) {
        if (item.type !== 'custom') continue;
        const def = workItemDefinition(item);
        if (!def || (def.basis !== 'wallArea' && def.basis !== 'perimeter')) continue;
        const calc = calculateWorkItem(item, room, areaM2, perimeterM, input.plan);
        const linear = def.basis === 'perimeter';
        const deducted = linear ? calc.deductedLengthM ?? 0 : calc.deductedM2;
        if (!(deducted > 0)) continue;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        out.push({
          ...base, work: workItemLabel(item, input.plan, t), unit: itemUnitLabel(item, input.plan, t),
          gross: r2(linear ? calc.grossLengthM ?? 0 : calc.grossM2), deducted: r2(deducted), net: r2(linear ? calc.lengthM ?? 0 : calc.netM2),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Project Summary
// ---------------------------------------------------------------------------------------------

/**
 * The one project-wide summary: the plans, then each category's total across all plans — a plan row
 * per plan referencing that plan's category total in the schedule, and a category row summing them.
 */
export function writeProjectSummary(sheet: ExcelJS.Worksheet, project: Project, q: ProjectQuantities, scheduleSheet: string, layout: ScheduleLayout, x: ExportContext) {
  const { t } = x;
  sheetTitle(sheet, t('exports.excel.project.title', { name: project.name }), t('exports.excel.project.planCountDate', { count: q.plans.length, date: x.today() }));

  sectionTitle(sheet, t('exports.excel.sheets.plans'));
  const planHeaders = [
    t('exports.common.plan'),
    t('exports.excel.project.planHeaders.rooms'),
    t('exports.excel.project.planHeaders.calibratedPages'),
    t('exports.excel.project.planHeaders.uncalibratedRooms'),
    t('exports.excel.project.planHeaders.status'),
  ];
  widen(sheet, columnWidths([26, 12, 14, 14, 22], planHeaders, x.language, 2));
  styleHeader(sheet.addRow(planHeaders), planHeaders.length);
  q.plans.forEach((r, i) => {
    const row = sheet.addRow([r.plan.name, r.roomCount, r.calibratedPageCount, r.uncalibratedRoomCount, planStatusText(r, t)]);
    fillRow(row, i % 2 ? XL.zebraB : XL.zebraA, planHeaders.length);
    for (const c of [2, 3, 4]) row.getCell(c).alignment = { horizontal: 'center' };
  });

  if (q.totals.length === 0) return;
  sectionTitle(sheet, t('exports.excel.schedule.summaryTitle'));
  const headers = [
    t('exports.excel.schedule.headers.category'), t('exports.common.plan'), t('exports.excel.schedule.headers.net'), t('exports.excel.schedule.headers.unit'),
    t('exports.excel.schedule.headers.order'), t('exports.excel.schedule.headers.area'), t('exports.excel.schedule.headers.areaOrder'),
  ];
  widen(sheet, columnWidths([26, 26, 14, 10, 14, 12, 14], headers, x.language, 2));
  styleHeader(sheet.addRow(headers), headers.length);
  const REF = sheetRef(scheduleSheet);
  const several = q.plans.length > 1;
  for (const total of q.totals) {
    const info = totalColumnInfo(total, t);
    const strip = info.unit === 'lm' && info.hasArea;
    const reading = primaryReading(total, info);
    const catRow = sheet.addRow([total.label, several ? t('exports.common.total') : q.plans[0].plan.name, null, info.unitLabel]);
    const planRows: number[] = [];
    const refsFor = (planIndex: number) => layout.categories[planIndex]?.get(total.category)?.row;
    const fillFigures = (row: ExcelJS.Row, values: { net: number | null; order: number | null; area: number | null; areaOrder: number | null }, formula: (col: number | null) => string | null) => {
      const set = (c: number, col: number | null, result: number | null) => {
        const f = formula(col);
        row.getCell(c).value = f && result !== null ? { formula: f, result } : result ?? DASH;
        row.getCell(c).numFmt = NUM_FMT;
        row.getCell(c).alignment = { horizontal: 'center' };
      };
      set(3, layout.col.net, values.net);
      set(5, layout.col.order, values.order);
      if (strip) {
        set(6, layout.col.area, values.area);
        set(7, layout.col.areaOrder, values.areaOrder);
      }
    };
    if (several) {
      q.plans.forEach((r, i) => {
        const amount = r.byCategory[total.category];
        const target = refsFor(i);
        if (!amount || !target) return;
        const row = sheet.addRow(['', r.plan.name, null, info.unitLabel]);
        const pr = primaryReading(amount, info);
        fillFigures(row, { net: pr.net, order: pr.order, area: amount.quantityM2, areaOrder: amount.orderM2 }, (col) => (col ? `${REF}${colLetter(col)}${target}` : null));
        row.getCell(4).alignment = { horizontal: 'center' };
        fillRow(row, planRows.length % 2 ? XL.zebraB : XL.zebraA, headers.length);
        row.getCell(2).alignment = { indent: 1 };
        planRows.push(row.number);
      });
      const sumOfPlans = (c: number) => (planRows.length ? `ROUND(SUM(${planRows.map((n) => `${colLetter(c)}${n}`).join(',')}),2)` : null);
      fillFigures(catRow, { net: reading.net, order: reading.order, area: total.quantityM2, areaOrder: total.orderM2 }, (col) => (col ? sumOfPlans(col === layout.col.net ? 3 : col === layout.col.order ? 5 : col === layout.col.area ? 6 : 7) : null));
    } else {
      const target = refsFor(0);
      fillFigures(catRow, { net: reading.net, order: reading.order, area: total.quantityM2, areaOrder: total.orderM2 }, (col) => (col && target ? `${REF}${colLetter(col)}${target}` : null));
    }
    catRow.getCell(4).alignment = { horizontal: 'center' };
    // The category row is drawn last above its plan rows' position: move nothing, just style it.
    fillRow(catRow, XL.category, headers.length, true);
  }
  if (q.uncalibratedRoomCount > 0) {
    sheet.addRow([]);
    noteRow(sheet, t('exports.excel.project.uncalibratedNote', { count: q.uncalibratedRoomCount }));
  }
  if (q.openingTotalsIncomplete) noteRow(sheet, t('openingQuantities.partialNote'));
}
