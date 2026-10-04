import ExcelJS from 'exceljs';
import { columnWidths, type ExportContext } from './exportLanguage';
import { markLabel } from './structuralMarks';
import { basisText, concreteStatusText, levelSpecification, levelQuantity, levelStatus, levelText, overlapCm, sheetSizeText } from './structuralExportText';
import type { ConcreteItemRow, ProjectConcrete, ProjectRebar, RebarBasis, RebarLevelRow, StructuralReport } from './structuralQuantities';

/*
 * The concrete and rebar sheets of the plan and project workbooks - item-first, like the Quantities
 * panel and the plan PDF: one row per concrete element / mesh level / manual-bars item, then ONE
 * total row. No summary block under the items. Only written when there are items, and after every
 * existing sheet, so a workbook without them is exactly what it always was.
 *
 * Calculable quantities are real numbers in every cell - an estimate is marked by the Status column
 * and a "≈" number format, never by turning the number into text. A quantity that cannot be known is
 * a dash (text, which SUM ignores), never 0. Totals are live SUM formulas over the item rows.
 */

const DASH = '-';
const NUM_FMT = '#,##0.00';
const PCT_FMT = '#,##0.##';
/** Same number, shown with ≈ - the cell value stays numeric. */
const ESTIMATE_FMT = '"≈ "#,##0.00';

// Same palette as the other sheets.
const C_HEADER = 'FF1F4E79';
const C_ZEBRA_A = 'FFEBF5FB';
const C_ZEBRA_B = 'FFFDFEFE';
const C_GRAND = 'FFD5F5E3';

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

/**
 * A quantity as a worksheet number, or a dash where it cannot be known. Rounded to 4 decimals only to
 * drop floating-point noise (1.2000000000000002): the cell stays a true number, and a SUM of these
 * cells still equals the report's own totals to well under what is displayed.
 */
const num = (v: number | null) => (v === null ? DASH : Math.round(v * 10000) / 10000);

/** 1-based column number → Excel letters. */
function colLetter(n: number): string {
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------- the two entry points ----------

/** One plan's concrete and rebar sheets (the plan workbook). */
export function addStructuralSheets(workbook: ExcelJS.Workbook, report: StructuralReport, x: ExportContext) {
  if (report.concrete) {
    const { items, summary } = report.concrete;
    addConcreteSheet(workbook, items.map((item) => ({ item })), { volumeM3: summary.volumeM3, orderM3: summary.orderM3, missingCount: summary.missingCount }, false, x);
  }
  if (report.rebar) {
    const { levels, summary } = report.rebar;
    addRebarSheet(workbook, levels.map((row) => ({ row })), summary, summary.missingItemCount, false, x);
  }
}

/**
 * The project workbook's concrete and rebar sheets: the same item rows as a plan's behind a Plan
 * column (every plan's items, in plan order), then the project total. `sources` holds each plan's
 * own report, `project` the cross-plan totals (summed from unrounded values).
 */
export function addProjectStructuralSheets(
  workbook: ExcelJS.Workbook,
  sources: { planName: string; report: StructuralReport }[],
  project: { concrete: ProjectConcrete | null; rebar: ProjectRebar | null },
  x: ExportContext
) {
  if (project.concrete) {
    const c = project.concrete;
    addConcreteSheet(
      workbook,
      sources.flatMap((s) => (s.report.concrete?.items ?? []).map((item) => ({ planName: s.planName, item }))),
      { volumeM3: c.volumeM3, orderM3: c.orderM3, missingCount: c.missingCount },
      true,
      x
    );
  }
  if (project.rebar) {
    const r = project.rebar;
    addRebarSheet(workbook, sources.flatMap((s) => (s.report.rebar?.levels ?? []).map((row) => ({ planName: s.planName, row }))), r, r.missingItemCount, true, x);
  }
}

const PLAN_WIDTH = 22;

// ---------- concrete ----------

const CONCRETE_WIDTHS = [8, 12, 18, 16, 14, 14, 10, 14, 22];

function addConcreteSheet(
  workbook: ExcelJS.Workbook,
  items: { planName?: string; item: ConcreteItemRow }[],
  totals: { volumeM3: number; orderM3: number; missingCount: number },
  withPlan: boolean,
  x: ExportContext
) {
  const { t } = x;
  const o = withPlan ? 1 : 0; // every column after Plan moves one to the right
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.concrete'), { views: [{ rightToLeft: x.rtl }] });
  const m3 = t('units.m3');
  const base = [
    t('exports.structural.headers.page'),
    t('exports.structural.headers.type'),
    t('exports.structural.headers.mark'),
    t('exports.structural.headers.grade'),
    t('exports.structural.headers.dimension'),
    t('exports.projectPdf.netUnit', { unit: m3 }),
    t('exports.structural.headers.waste'),
    t('exports.projectPdf.orderUnit', { unit: m3 }),
    t('exports.structural.headers.status'),
  ];
  const headers = withPlan ? [t('exports.common.plan'), ...base] : base;
  columnWidths(withPlan ? [PLAN_WIDTH, ...CONCRETE_WIDTHS] : CONCRETE_WIDTHS, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  const rowFor = (planName: string | undefined, cells: (string | number | null)[]) => sheet.addRow(withPlan ? [planName ?? '', ...cells] : cells);
  const col = (c: number) => c + o; // a plan-sheet column number → this sheet's

  // A slab's thickness is read in centimetres (as it is typed); a wall, beam or column's height in metres.
  const dimension = (it: ConcreteItemRow) =>
    it.depthM === null ? DASH : it.kind === 'slab' ? `${x.number(Math.round(it.depthM * 10000) / 100)} ${t('units.cm')}` : `${x.number(Math.round(it.depthM * 100) / 100)} ${t('units.m')}`;

  const first = sheet.rowCount + 1;
  items.forEach(({ planName, item: it }, i) => {
    const row = rowFor(planName, [
      it.pageNumber,
      t(`concrete.kinds.${it.kind}`),
      markLabel(it, t),
      it.grade || DASH,
      dimension(it),
      num(it.netM3),
      it.wastePercent,
      num(it.orderM3),
      concreteStatusText(it.status, it.kind, x),
    ]);
    row.getCell(col(6)).numFmt = NUM_FMT;
    row.getCell(col(7)).numFmt = PCT_FMT;
    row.getCell(col(8)).numFmt = NUM_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  // The total: live formulas over the item rows (a not-calculable row holds a dash, which SUM skips).
  const netL = colLetter(col(6));
  const orderL = colLetter(col(8));
  const total = sheet.addRow([...new Array(headers.length).fill('')]);
  total.getCell(col(2)).value = t('concrete.summary.total');
  total.getCell(col(6)).value = { formula: `ROUND(SUM(${netL}${first}:${netL}${last}),2)`, result: totals.volumeM3 };
  total.getCell(col(8)).value = { formula: `ROUND(SUM(${orderL}${first}:${orderL}${last}),2)`, result: totals.orderM3 };
  total.getCell(col(6)).numFmt = NUM_FMT;
  total.getCell(col(8)).numFmt = NUM_FMT;
  if (totals.missingCount > 0) total.getCell(col(9)).value = t('exports.structural.missingShort', { count: totals.missingCount });
  styleRow(total, C_GRAND, true);
}

// ---------- rebar ----------

interface RebarTotals {
  weightKg: number;
  orderWeightKg: number | null;
  basis: RebarBasis | null;
}

const REBAR_WIDTHS = [8, 9, 14, 11, 34, 12, 16, 11, 14, 10, 14, 26];

function addRebarSheet(
  workbook: ExcelJS.Workbook,
  rows: { planName?: string; row: RebarLevelRow }[],
  totals: RebarTotals,
  missingItemCount: number,
  withPlan: boolean,
  x: ExportContext
) {
  const { t } = x;
  const o = withPlan ? 1 : 0;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.rebar'), { views: [{ rightToLeft: x.rtl }] });
  const kg = t('units.kg');
  const base = [
    t('exports.structural.headers.page'),
    t('exports.structural.headers.type'),
    t('exports.structural.headers.mark'),
    t('exports.structural.headers.levelShort'),
    t('exports.structural.headers.specification'),
    t('exports.structural.headers.quantity'),
    t('exports.structural.headers.sheetSizeOnly'),
    t('exports.structural.headers.overlap', { unit: t('units.cm') }),
    t('exports.structural.headers.netWeight', { unit: kg }),
    t('exports.structural.headers.waste'),
    t('exports.projectPdf.orderUnit', { unit: kg }),
    t('exports.structural.headers.status'),
  ];
  const headers = withPlan ? [t('exports.common.plan'), ...base] : base;
  columnWidths(withPlan ? [PLAN_WIDTH, ...REBAR_WIDTHS] : REBAR_WIDTHS, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  const rowFor = (planName: string | undefined, cells: (string | number | null)[]) => sheet.addRow(withPlan ? [planName ?? '', ...cells] : cells);
  const col = (c: number) => c + o;

  const first = sheet.rowCount + 1;
  rows.forEach(({ planName, row: d }, i) => {
    // Sheet size and overlap only where a sheet count was made; manual bars and free polygons have none.
    const counted = d.sheets !== null && d.sheets.count !== null;
    const row = rowFor(planName, [
      d.pageNumber,
      t(d.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars'),
      markLabel(d, t),
      levelText(d.level, x) || DASH,
      levelSpecification(d, x),
      levelQuantity(d, x),
      counted ? sheetSizeText(d.sheets!.settings, x) : DASH,
      counted ? overlapCm(d.sheets!.settings) : DASH,
      num(d.netWeightKg),
      d.parts[0].wastePercent,
      num(d.orderWeightKg),
      levelStatus(d, x),
    ]);
    // The numbers stay numbers; an estimate is shown with a ≈ format and the Status column.
    const qty = d.estimated ? ESTIMATE_FMT : NUM_FMT;
    row.getCell(col(8)).numFmt = PCT_FMT;
    row.getCell(col(9)).numFmt = qty;
    row.getCell(col(10)).numFmt = PCT_FMT;
    row.getCell(col(11)).numFmt = NUM_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  // One total row: weights only (sheets and bars are different units, so no combined quantity).
  const totalFmt = totals.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
  const total = sheet.addRow([...new Array(headers.length).fill('')]);
  total.getCell(col(2)).value = t('rebar.summary.total');
  for (const [c, result] of [[9, totals.weightKg], [11, totals.orderWeightKg]] as const) {
    const letter = colLetter(col(c));
    total.getCell(col(c)).value = result === null ? DASH : { formula: `ROUND(SUM(${letter}${first}:${letter}${last}),2)`, result };
    total.getCell(col(c)).numFmt = c === 11 ? NUM_FMT : totalFmt;
  }
  total.getCell(col(12)).value = [totals.basis ? basisText(totals.basis, x) : '', missingItemCount > 0 ? t('exports.structural.missingShort', { count: missingItemCount }) : ''].filter(Boolean).join(' · ') || DASH;
  styleRow(total, C_GRAND, true);
}
