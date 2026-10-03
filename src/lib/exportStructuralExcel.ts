import ExcelJS from 'exceljs';
import { columnWidths, type ExportContext } from './exportLanguage';
import { basisText, concreteStatusText, rebarStatusText } from './structuralExportText';
import type { StructuralReport } from './structuralQuantities';

/*
 * The concrete and rebar sheets of the plan workbook. Only written when the plan has such items, and
 * after every existing sheet, so a workbook without them is exactly what it always was.
 *
 * Calculable quantities are real numbers in every cell — an estimate is marked by the Basis column and
 * a "≈" number format, never by turning the number into text. A quantity that cannot be known is a
 * dash (text, which SUM ignores), never 0. Totals are live SUM formulas over the item rows.
 */

const DASH = '—';
const NUM_FMT = '#,##0.00';
const PCT_FMT = '#,##0.##';
/** Same number, shown with ≈ — the cell value stays numeric. */
const ESTIMATE_FMT = '"≈ "#,##0.00';

// Same palette as the other sheets.
const C_HEADER = 'FF1F4E79';
const C_ZEBRA_A = 'FFEBF5FB';
const C_ZEBRA_B = 'FFFDFEFE';
const C_TOTAL = 'FFD6E4F0';
const C_GRAND = 'FFD5F5E3';

const round2 = (n: number) => Math.round(n * 100) / 100;

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function headerRow(sheet: ExcelJS.Worksheet, labels: string[]) {
  const row = sheet.addRow(labels);
  row.eachCell({ includeEmpty: true }, (c) => {
    fill(c, C_HEADER);
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

function styleRow(row: ExcelJS.Row, argb: string, bold = false) {
  row.eachCell({ includeEmpty: true }, (c) => {
    fill(c, argb);
    c.alignment = { horizontal: 'center' };
    if (bold) c.font = { bold: true };
  });
}

function sectionTitle(sheet: ExcelJS.Worksheet, text: string) {
  sheet.addRow([]);
  const row = sheet.addRow([text]);
  row.getCell(1).font = { bold: true, size: 12 };
}

function note(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  row.getCell(1).font = { bold: true, color: { argb: 'FF92400E' } };
}

/**
 * A quantity as a worksheet number, or a dash where it cannot be known. Rounded to 4 decimals only to
 * drop floating-point noise (1.2000000000000002): the cell stays a true number, and a SUM of these
 * cells still equals the report's own totals to well under what is displayed.
 */
const num = (v: number | null) => (v === null ? DASH : Math.round(v * 10000) / 10000);

export function addStructuralSheets(workbook: ExcelJS.Workbook, report: StructuralReport, x: ExportContext) {
  if (report.concrete) addConcreteSheet(workbook, report.concrete, x);
  if (report.rebar) addRebarSheet(workbook, report.rebar, x);
}

// ---------- concrete ----------

const CONCRETE_WIDTHS = [8, 14, 14, 18, 16, 18, 10, 14, 10, 14, 24];

function addConcreteSheet(workbook: ExcelJS.Workbook, concrete: NonNullable<StructuralReport['concrete']>, x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.concrete'), { views: [{ rightToLeft: x.rtl }] });
  const m2 = t('units.m2');
  const m3 = t('units.m3');
  const headers = [
    t('exports.structural.headers.page'),
    t('exports.structural.headers.mark'),
    t('exports.structural.headers.type'),
    t('exports.structural.headers.grade'),
    t('exports.structural.headers.footprint', { unit: m2 }),
    t('exports.structural.headers.thicknessHeight', { unit: t('units.m') }),
    t('exports.structural.headers.quantity'),
    t('exports.projectPdf.netUnit', { unit: m3 }),
    t('exports.structural.headers.waste'),
    t('exports.projectPdf.orderUnit', { unit: m3 }),
    t('exports.structural.headers.status'),
  ];
  columnWidths(CONCRETE_WIDTHS, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  const { items, summary } = concrete;
  const noGrade = t('concrete.summary.noGrade');
  const first = sheet.rowCount + 1;
  items.forEach((it, i) => {
    const row = sheet.addRow([
      it.pageNumber,
      it.mark,
      t(`concrete.kinds.${it.kind}`),
      it.grade || noGrade,
      num(it.footprintM2),
      num(it.depthM),
      it.quantity,
      num(it.netM3),
      it.wastePercent,
      num(it.orderM3),
      concreteStatusText(it.status, it.kind, x),
    ]);
    for (const c of [5, 6, 8, 10]) row.getCell(c).numFmt = NUM_FMT;
    row.getCell(7).numFmt = PCT_FMT;
    row.getCell(9).numFmt = PCT_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  // Totals: live formulas over the item rows. A not-calculable row holds a dash, which SUM skips.
  const total = sheet.addRow([t('exports.common.grandTotal'), '', '', '', '', '', summary.elementCount, null, '', null, '']);
  total.getCell(8).value = { formula: `ROUND(SUM(H${first}:H${last}),2)`, result: summary.volumeM3 };
  total.getCell(10).value = { formula: `ROUND(SUM(J${first}:J${last}),2)`, result: summary.orderM3 };
  total.getCell(8).numFmt = NUM_FMT;
  total.getCell(10).numFmt = NUM_FMT;
  styleRow(total, C_GRAND, true);

  // By type and grade — the same columns, so the numbers sit under their headings.
  sectionTitle(sheet, t('exports.structural.concreteByGrade'));
  headerRow(sheet, headers.map((h, i) => (i === 1 ? '' : i === 6 ? t('exports.structural.headers.elements') : i === 10 ? t('exports.structural.headers.notCalculable') : [0, 2, 3, 7, 9].includes(i) ? h : '')));
  summary.rows.forEach((r, i) => {
    const calculable = r.elementCount > r.missingCount;
    const row = sheet.addRow([
      r.pageNumber,
      '',
      t(`concrete.kinds.${r.kind}`),
      r.grade || noGrade,
      '',
      '',
      r.elementCount,
      calculable ? r.volumeM3 : DASH,
      '',
      calculable ? r.orderM3 : DASH,
      r.missingCount > 0 ? r.missingCount : '',
    ]);
    row.getCell(8).numFmt = NUM_FMT;
    row.getCell(10).numFmt = NUM_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const sumTotal = sheet.addRow([t('exports.common.grandTotal'), '', '', '', '', '', summary.elementCount, summary.volumeM3, '', summary.orderM3, summary.missingCount > 0 ? summary.missingCount : '']);
  sumTotal.getCell(8).numFmt = NUM_FMT;
  sumTotal.getCell(10).numFmt = NUM_FMT;
  styleRow(sumTotal, C_TOTAL, true);

  if (summary.missingCount > 0) {
    sheet.addRow([]);
    note(sheet, t('exports.structural.missing', { count: summary.missingCount }));
  }
}

// ---------- rebar ----------

const REBAR_WIDTHS = [8, 14, 12, 10, 12, 16, 10, 14, 14, 14, 10, 14, 14, 18, 22];

function addRebarSheet(workbook: ExcelJS.Workbook, rebar: NonNullable<StructuralReport['rebar']>, x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.rebar'), { views: [{ rightToLeft: x.rtl }] });
  const lm = t('units.lm');
  const kg = t('units.kg');
  const headers = [
    t('exports.structural.headers.page'),
    t('exports.structural.headers.mark'),
    t('exports.structural.headers.kind'),
    t('exports.structural.headers.diameter'),
    t('exports.structural.headers.spacing'),
    t('exports.structural.headers.direction'),
    t('exports.structural.headers.bars'),
    t('exports.structural.headers.barLength', { unit: lm }),
    t('exports.projectPdf.netUnit', { unit: lm }),
    t('exports.projectPdf.netUnit', { unit: kg }),
    t('exports.structural.headers.waste'),
    t('exports.projectPdf.orderUnit', { unit: lm }),
    t('exports.projectPdf.orderUnit', { unit: kg }),
    t('exports.structural.headers.basis'),
    t('exports.structural.headers.status'),
  ];
  columnWidths(REBAR_WIDTHS, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  const { items, summary } = rebar;
  const first = sheet.rowCount + 1;
  items.forEach((it, i) => {
    const calculable = it.netLengthM !== null;
    const row = sheet.addRow([
      it.pageNumber,
      it.mark,
      t(it.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars'),
      num(it.diameterMm),
      num(it.spacingMm),
      it.direction === null ? DASH : t(it.direction === 'long' ? 'exports.structural.longSide' : 'exports.structural.shortSide'),
      num(it.barCount),
      num(it.barLengthM),
      num(it.netLengthM),
      num(it.netWeightKg),
      it.wastePercent,
      num(it.orderLengthM),
      num(it.orderWeightKg),
      calculable ? basisText(it.estimated ? 'estimated' : 'exact', x) : DASH,
      rebarStatusText(it.status, x),
    ]);
    // The numbers stay numbers; an estimate is shown with a ≈ format and the Basis column.
    const qty = it.estimated ? ESTIMATE_FMT : NUM_FMT;
    for (const c of [9, 10, 12, 13]) row.getCell(c).numFmt = qty;
    row.getCell(8).numFmt = NUM_FMT;
    row.getCell(11).numFmt = PCT_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  const totalFmt = summary.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
  const total = sheet.addRow([t('exports.common.grandTotal'), '', '', '', '', '', '', '', null, null, '', null, null, summary.basis ? basisText(summary.basis, x) : DASH, '']);
  const sums: [number, string, number][] = [
    [9, 'I', summary.lengthM],
    [10, 'J', summary.weightKg],
    [12, 'L', summary.orderLengthM],
    [13, 'M', summary.orderWeightKg],
  ];
  for (const [col, letter, result] of sums) {
    total.getCell(col).value = { formula: `ROUND(SUM(${letter}${first}:${letter}${last}),2)`, result };
    total.getCell(col).numFmt = totalFmt;
  }
  styleRow(total, C_GRAND, true);

  // By page and diameter.
  sectionTitle(sheet, t('exports.structural.rebarByDiameter'));
  headerRow(sheet, headers.map((h, i) => ([0, 3, 8, 9, 11, 12, 13].includes(i) ? h : i === 14 ? t('exports.structural.headers.status') : '')));
  summary.pages.forEach((page) =>
    page.rows.forEach((r, i) => {
      const row = sheet.addRow([r.pageNumber, '', '', r.diameterMm, '', '', '', '', r.lengthM, r.weightKg, '', r.orderLengthM, r.orderWeightKg, basisText(r.basis, x), '']);
      if (r.basis === 'mixed') {
        row.getCell(15).value = t('exports.structural.estimateNote', {
          length: `${x.number(round2(r.estimatedLengthM))} ${lm}`,
          weight: `${x.number(round2(r.estimatedWeightKg))} ${kg}`,
        });
      }
      for (const c of [9, 10, 12, 13]) row.getCell(c).numFmt = r.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
      styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
    })
  );
  const sumTotal = sheet.addRow([t('exports.common.grandTotal'), '', '', '', '', '', '', '', summary.lengthM, summary.weightKg, '', summary.orderLengthM, summary.orderWeightKg, summary.basis ? basisText(summary.basis, x) : DASH, '']);
  for (const c of [9, 10, 12, 13]) sumTotal.getCell(c).numFmt = totalFmt;
  styleRow(sumTotal, C_TOTAL, true);

  if (summary.basis === 'mixed') {
    sheet.addRow([]);
    note(
      sheet,
      t('exports.structural.estimateNote', {
        length: `${x.number(round2(summary.estimatedLengthM))} ${lm}`,
        weight: `${x.number(round2(summary.estimatedWeightKg))} ${kg}`,
      })
    );
  } else if (summary.basis === 'estimated') {
    sheet.addRow([]);
    note(sheet, t('exports.structural.estimateOnlyNote'));
  }
  if (summary.missingItemCount > 0) {
    if (summary.basis !== 'mixed' && summary.basis !== 'estimated') sheet.addRow([]);
    note(sheet, t('exports.structural.missing', { count: summary.missingItemCount }));
  }
}
