import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Plan, Project, ReportCategory } from '../types';
import type { Language } from '../i18n';
import { columnWidths, exportContext, type ExportContext } from './exportLanguage';
import { calculateWorkItem, effectiveWastePercent, roomMetrics } from './quantities';
import { buildProjectQuantities, planStatusLabel, roomCategoryQuantity, type ProjectQuantities } from './projectQuantities';
import { workTypeDefinition } from './workTypes';
import { round } from './geometry';
import { sheetRef } from './excelSheetRef';
import { addProjectStructuralSheets } from './exportStructuralExcel';
import { buildProjectStructural, buildStructuralReport } from './structuralQuantities';
import { ALL_CONTENT, type ExportContent } from './exportContent';

// Same palette as the single-plan workbook (exportExcel.ts).
const C_HEADER = 'FF1F4E79';
const C_ZEBRA_A = 'FFEBF5FB';
const C_ZEBRA_B = 'FFFDFEFE';
const C_GRAND = 'FFD5F5E3';
const NUM_FMT = '#,##0.00';
const DASH = '-';

function colLetter(n: number): string {
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  row.height = 32;
}

function styleBody(row: ExcelJS.Row, argb: string, numericFrom: number) {
  row.eachCell({ includeEmpty: true }, (c, ci) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    c.alignment = { horizontal: 'center' };
    if (ci >= numericFrom) c.numFmt = NUM_FMT;
  });
}

/** Column groups per category: m² net + order, and for skirting its running metres too. */
function categoryColumns(categories: ReportCategory[], { t }: ExportContext) {
  return categories.flatMap((c) => {
    const label = t(`reportCategories.${c}`);
    const cols: { category: ReportCategory; field: 'quantityM2' | 'orderM2' | 'lengthM' | 'orderLengthM'; header: string }[] = [
      { category: c, field: 'quantityM2', header: t('exports.excel.categoryNetM2', { label }) },
      { category: c, field: 'orderM2', header: t('exports.excel.categoryOrderM2', { label }) },
    ];
    if (c === 'panels') {
      cols.push({ category: c, field: 'lengthM', header: t('exports.excel.categoryNetLm', { label }) });
      cols.push({ category: c, field: 'orderLengthM', header: t('exports.excel.categoryOrderLm', { label }) });
    }
    return cols;
  });
}

/** Per plan: rooms, calibration, status and each category's totals, with a SUM row the summary sheet reads. */
function addPlansSheet(workbook: ExcelJS.Workbook, q: ProjectQuantities, categories: ReportCategory[], x: ExportContext) {
  const { t } = x;
  // The summary sheet's formulas reach this sheet by this same name — see `sheetRef`.
  const plansSheet = t('exports.excel.sheets.plans');
  const sheet = workbook.addWorksheet(plansSheet, { views: [{ rightToLeft: x.rtl }] });
  const cols = categoryColumns(categories, x);
  const fixed = [
    t('exports.common.plan'),
    t('exports.excel.project.planHeaders.rooms'),
    t('exports.excel.project.planHeaders.calibratedPages'),
    t('exports.excel.project.planHeaders.uncalibratedRooms'),
    t('exports.excel.project.planHeaders.status'),
  ];
  const plansHeaders = [...fixed, ...cols.map((c) => c.header)];
  styleHeader(sheet.addRow(plansHeaders));
  columnWidths([22, 8, 12, 12, 18, ...cols.map(() => 15)], plansHeaders, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  const first = sheet.rowCount + 1;
  q.plans.forEach((r, i) => {
    const row = sheet.addRow([
      r.plan.name,
      r.roomCount,
      r.calibratedPageCount,
      r.uncalibratedRoomCount,
      planStatusLabel(r.status, t),
      ...cols.map((c) => r.byCategory[c.category]?.[c.field] ?? 0),
    ]);
    styleBody(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B, fixed.length + 1);
  });
  const last = sheet.rowCount;

  const totalRow = sheet.addRow([t('exports.excel.project.projectTotal')]);
  cols.forEach((c, i) => {
    const ci = fixed.length + 1 + i;
    const L = colLetter(ci);
    const total = q.totals.find((t) => t.category === c.category)?.[c.field] ?? 0;
    totalRow.getCell(ci).value = { formula: `ROUND(SUM(${L}${first}:${L}${last}),2)`, result: total };
  });
  styleBody(totalRow, C_GRAND, fixed.length + 1);
  totalRow.font = { bold: true };

  // Where each category's totals landed, for the summary sheet's references.
  const totalCell = new Map(cols.map((c, i) => [`${c.category}:${c.field}`, `${sheetRef(plansSheet)}${colLetter(fixed.length + 1 + i)}${totalRow.number}`]));
  return totalCell;
}

function addSummarySheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  q: ProjectQuantities,
  totalCell: Map<string, string>,
  x: ExportContext
) {
  const { t } = x;
  const title = sheet.addRow([t('exports.excel.project.title', { name: project.name })]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([t('exports.excel.project.planCountDate', { count: q.plans.length, date: x.today() })]).font = { color: { argb: 'FF8B8F99' } };
  sheet.addRow([]);

  const summaryHeaders = [
    t('exports.common.item'),
    t('exports.excel.project.summaryHeaders.net'),
    t('exports.excel.project.summaryHeaders.order'),
    t('exports.excel.project.summaryHeaders.length'),
    t('exports.excel.project.summaryHeaders.orderLength'),
  ];
  columnWidths([22, 16, 18, 16, 18], summaryHeaders, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  styleHeader(sheet.addRow(summaryHeaders));
  q.totals.forEach((total, i) => {
    const row = sheet.addRow([total.label]);
    const ref = (field: string, result: number | null, ci: number) => {
      const cell = totalCell.get(`${total.category}:${field}`);
      row.getCell(ci).value = cell && result != null ? { formula: cell, result } : DASH;
    };
    ref('quantityM2', total.quantityM2, 2);
    ref('orderM2', total.orderM2, 3);
    ref('lengthM', total.lengthM, 4);
    ref('orderLengthM', total.orderLengthM, 5);
    styleBody(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B, 2);
  });

  if (q.uncalibratedRoomCount > 0) {
    sheet.addRow([]);
    const note = sheet.addRow([t('exports.excel.project.uncalibratedNote', { count: q.uncalibratedRoomCount })]);
    note.getCell(1).font = { bold: true, color: { argb: 'FF92400E' } };
  }
}

/** Every room of every plan: floor area, perimeter and each category's quantities. */
function addRoomsSheet(workbook: ExcelJS.Workbook, q: ProjectQuantities, categories: ReportCategory[], x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.rooms'), { views: [{ rightToLeft: x.rtl }] });
  const cols = categoryColumns(categories, x);
  const fixed = [
    t('exports.common.plan'),
    t('exports.common.apartment'),
    t('exports.common.room'),
    t('exports.excel.project.roomHeaders.floorArea'),
    t('exports.excel.project.roomHeaders.perimeter'),
  ];
  const notCalibrated = t('exports.common.notCalibrated');
  const roomsHeaders = [...fixed, ...cols.map((c) => c.header)];
  styleHeader(sheet.addRow(roomsHeaders));
  columnWidths([20, 8, 22, 14, 12, ...cols.map(() => 15)], roomsHeaders, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  let i = 0;
  for (const r of q.plans) {
    const roomsById = new Map(r.plan.rooms.map((room) => [room.id, room]));
    for (const s of r.summaries) {
      const room = roomsById.get(s.roomId)!;
      const { areaM2, perimeterM } = roomMetrics(room, r.plan.pages[room.pageNumber]?.calibration ?? null);
      const cell = (v: number | null) => (s.pageCalibrated ? (v ?? DASH) : notCalibrated);
      const row = sheet.addRow([
        r.plan.name,
        s.apartmentNumber || DASH,
        s.roomName,
        cell(round(areaM2, 2)),
        cell(round(perimeterM, 2)),
        ...cols.map((c) => cell(roomCategoryQuantity(s, c.category)[c.field])),
      ]);
      styleBody(row, i++ % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B, 4);
    }
  }
}

/**
 * One row per work item: gross, openings deducted, net, waste and a live "to order" formula — the
 * detail behind every total. Skirting is listed in running metres (its unit), everything else in m².
 */
function addWorkItemsSheet(workbook: ExcelJS.Workbook, plans: Plan[], x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.workItems'), { views: [{ rightToLeft: x.rtl }] });
  const workItemHeaders = [
      t('exports.common.plan'),
      t('exports.common.apartment'),
      t('exports.common.room'),
      t('exports.excel.project.workItemHeaders.workType'),
      t('exports.excel.project.workItemHeaders.unit'),
      t('exports.excel.project.workItemHeaders.gross'),
      t('exports.excel.project.workItemHeaders.deducted'),
      t('exports.excel.project.workItemHeaders.net'),
      t('exports.excel.project.workItemHeaders.waste'),
      t('exports.excel.project.workItemHeaders.order'),
  ];
  styleHeader(sheet.addRow(workItemHeaders));
  const notCalibrated = t('exports.common.notCalibrated');
  columnWidths([20, 8, 22, 16, 8, 12, 13, 12, 10, 13], workItemHeaders, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  let i = 0;
  for (const plan of plans) {
    for (const room of plan.rooms) {
      const calibration = plan.pages[room.pageNumber]?.calibration ?? null;
      const calibrated = (calibration?.metersPerPixel ?? 0) > 0;
      const { areaM2, perimeterM } = roomMetrics(room, calibration);
      for (const item of room.workItems) {
        const def = workTypeDefinition(item.type);
        if (!def) continue;
        const calc = calculateWorkItem(item, room, areaM2, perimeterM, plan);
        const linear = calc.lengthM != null;
        const gross = linear ? calc.grossLengthM! : calc.grossM2;
        const deducted = linear ? calc.deductedLengthM! : calc.deductedM2;
        const net = linear ? calc.lengthM! : calc.netM2;
        const label = item.type === 'tiling' && item.tilingCategory === 'as' ? t('reportCategories.tiling_as') : t(`workTypes.${def.id}`);
        const qty = (v: number) => (calibrated ? round(v, 2) : notCalibrated);
        const waste = effectiveWastePercent(item, plan);
        const row = sheet.addRow([plan.name, room.apartmentNumber || DASH, room.name, label, t(`units.${def.unit}`), qty(gross), qty(deducted), qty(net), waste, null]);
        const r = row.number;
        row.getCell(10).value = {
          formula: `IF(ISNUMBER(H${r}),ROUND(H${r}*(1+I${r}/100),2),"${DASH}")`,
          result: calibrated ? round(net * (1 + waste / 100), 2) : DASH,
        };
        styleBody(row, i++ % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B, 6);
        row.getCell(9).numFmt = '0.##';
      }
    }
  }
}

/** The whole project in one workbook: summary, per-plan totals, rooms and work items. */
export async function exportProjectToExcel(project: Project, plans: Plan[], content: ExportContent, language: Language) {
  const workbook = buildProjectWorkbook(project, plans, language, content);
  // A selection with nothing to write would save a file Excel cannot open.
  if (workbook.worksheets.length === 0) throw new Error('The selected content has nothing to export.');
  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(new Blob([buffer], { type: 'application/octet-stream' }), exportContext(language).t('exports.excel.projectFileName', { name: safeName }));
}

/** The project workbook exactly as `exportProjectToExcel` saves it — built apart so tests can read it. */
export function buildProjectWorkbook(project: Project, plans: Plan[], language: Language, content: ExportContent = ALL_CONTENT): ExcelJS.Workbook {
  const x = exportContext(language);
  const { t } = x;
  const q = buildProjectQuantities(plans, t);
  const categories = q.totals.map((t) => t.category);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BetterCalc';
  workbook.created = new Date();
  if (content.finishes) {
    // Created first so it is the first tab; filled once the plans sheet exists to reference.
    const summary = workbook.addWorksheet(t('exports.excel.sheets.projectSummary'), { views: [{ rightToLeft: x.rtl }] });
    const totalCell = addPlansSheet(workbook, q, categories, x);
    addSummarySheet(summary, project, q, totalCell, x);
    addRoomsSheet(workbook, q, categories, x);
    addWorkItemsSheet(workbook, plans, x);
  }

  // Concrete and rebar sheets, after every existing one and only when selected and some plan has such items.
  const structural = buildProjectStructural(plans);
  const selected = { concrete: content.concrete ? structural.concrete : null, rebar: content.rebar ? structural.rebar : null };
  if (selected.concrete || selected.rebar) {
    addProjectStructuralSheets(workbook, plans.map((p) => ({ planName: p.name, report: buildStructuralReport(p) })), selected, x);
  }
  return workbook;
}
