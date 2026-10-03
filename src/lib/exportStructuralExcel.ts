import ExcelJS from 'exceljs';
import { columnWidths, type ExportContext } from './exportLanguage';
import { markLabel } from './structuralMarks';
import { basisText, concreteStatusText, rebarStatusText } from './structuralExportText';
import type {
  ConcreteItemRow,
  ProjectConcrete,
  ProjectRebar,
  RebarBasis,
  RebarItemRow,
  StructuralReport,
} from './structuralQuantities';
import type { ConcreteKind } from '../types/structural';

/*
 * The concrete and rebar sheets of the plan workbook. Only written when the plan has such items, and
 * after every existing sheet, so a workbook without them is exactly what it always was.
 *
 * Calculable quantities are real numbers in every cell — an estimate is marked by the Basis column and
 * a "≈" number format, never by turning the number into text. A quantity that cannot be known is a
 * dash (text, which SUM ignores), never 0. Totals are live SUM formulas over the item rows.
 */

const DASH = '-';
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
    addConcreteSheet(
      workbook,
      {
        items: items.map((item) => ({ item })),
        summaryRows: summary.rows.map((r) => ({ page: r.pageNumber, kind: r.kind, grade: r.grade, count: r.elementCount, missing: r.missingCount, net: r.volumeM3, order: r.orderM3 })),
        totals: { elementCount: summary.elementCount, missingCount: summary.missingCount, volumeM3: summary.volumeM3, orderM3: summary.orderM3 },
      },
      false,
      x
    );
  }
  if (report.rebar) {
    const { items, summary } = report.rebar;
    addRebarSheet(
      workbook,
      {
        items: items.map((row) => ({ row })),
        summaryRows: summary.pages.flatMap((page) => page.rows.map((r) => ({ page: r.pageNumber, ...r }))),
        totals: summary,
        missingItemCount: summary.missingItemCount,
      },
      false,
      x
    );
  }
}

/**
 * The project workbook's concrete and rebar sheets: the same columns as a plan's, behind a Plan
 * column, one row per element / layer / bars row of every plan, then a project summary (no page: a
 * page belongs to one plan), a by-plan block, totals and the notes. `sources` holds each plan's own
 * report (its items), `project` the cross-plan aggregate (summed from unrounded values).
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
      {
        items: sources.flatMap((s) => (s.report.concrete?.items ?? []).map((item) => ({ planName: s.planName, item }))),
        summaryRows: c.rows.map((r) => ({ kind: r.kind, grade: r.grade, count: r.elementCount, missing: r.missingCount, net: r.volumeM3, order: r.orderM3 })),
        totals: { elementCount: c.elementCount, missingCount: c.missingCount, volumeM3: c.volumeM3, orderM3: c.orderM3 },
        perPlan: c.perPlan.map((p) => ({ planName: p.planName, count: p.itemCount, missing: p.missingCount, net: p.volumeM3, order: p.orderM3 })),
      },
      true,
      x
    );
  }
  if (project.rebar) {
    const r = project.rebar;
    addRebarSheet(
      workbook,
      {
        items: sources.flatMap((s) => (s.report.rebar?.items ?? []).map((row) => ({ planName: s.planName, row }))),
        summaryRows: r.rows.map((row) => ({ ...row })),
        totals: r,
        missingItemCount: r.missingItemCount,
        perPlan: r.perPlan.map((p) => ({ planName: p.planName, length: p.lengthM, weight: p.weightKg, orderLength: p.orderLengthM, orderWeight: p.orderWeightKg, basis: p.basis, missing: p.missingItemCount, estimatedLengthM: p.estimatedLengthM, estimatedWeightKg: p.estimatedWeightKg })),
      },
      true,
      x
    );
  }
}

// ---------- concrete ----------

interface ConcreteSheetData {
  items: { planName?: string; item: ConcreteItemRow }[];
  summaryRows: { page?: number; kind: ConcreteKind; grade: string; count: number; missing: number; net: number; order: number }[];
  totals: { elementCount: number; missingCount: number; volumeM3: number; orderM3: number };
  /** Project workbook only: each plan's own totals. */
  perPlan?: { planName: string; count: number; missing: number; net: number; order: number }[];
}

const PLAN_WIDTH = 22;
const CONCRETE_WIDTHS = [8, 14, 14, 18, 16, 18, 10, 14, 10, 14, 24];

function addConcreteSheet(workbook: ExcelJS.Workbook, data: ConcreteSheetData, withPlan: boolean, x: ExportContext) {
  const { t } = x;
  const o = withPlan ? 1 : 0; // every column after Plan moves one to the right
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.concrete'), { views: [{ rightToLeft: x.rtl }] });
  const m2 = t('units.m2');
  const m3 = t('units.m3');
  const base = [
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
  const headers = withPlan ? [t('exports.common.plan'), ...base] : base;
  const widths = withPlan ? [PLAN_WIDTH, ...CONCRETE_WIDTHS] : CONCRETE_WIDTHS;
  columnWidths(widths, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  /** A row of `cells` (given from the Page column on), with the plan name in front for the project sheet. */
  const rowFor = (planName: string | undefined, cells: (string | number | null)[]) => sheet.addRow(withPlan ? [planName ?? '', ...cells] : cells);
  const col = (c: number) => c + o; // a plan-sheet column number → this sheet's

  const noGrade = t('concrete.summary.noGrade');
  const first = sheet.rowCount + 1;
  data.items.forEach(({ planName, item: it }, i) => {
    const row = rowFor(planName, [
      it.pageNumber,
      markLabel(it, t),
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
    for (const c of [5, 6, 8, 10]) row.getCell(col(c)).numFmt = NUM_FMT;
    row.getCell(col(7)).numFmt = PCT_FMT;
    row.getCell(col(9)).numFmt = PCT_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  // Totals: live formulas over the item rows. A not-calculable row holds a dash, which SUM skips.
  const netL = colLetter(col(8));
  const orderL = colLetter(col(10));
  // The label goes in the first column (the Plan column in the project workbook).
  const total = sheet.addRow([t('exports.common.grandTotal'), ...new Array(headers.length - 1).fill('')]);
  total.getCell(col(7)).value = data.totals.elementCount;
  total.getCell(col(8)).value = { formula: `ROUND(SUM(${netL}${first}:${netL}${last}),2)`, result: data.totals.volumeM3 };
  total.getCell(col(10)).value = { formula: `ROUND(SUM(${orderL}${first}:${orderL}${last}),2)`, result: data.totals.orderM3 };
  total.getCell(col(8)).numFmt = NUM_FMT;
  total.getCell(col(10)).numFmt = NUM_FMT;
  styleRow(total, C_GRAND, true);

  // By type and grade — the same columns, so the numbers sit under their headings.
  sectionTitle(sheet, t('exports.structural.concreteByGrade'));
  const keep = new Set([0, 2, 3, 7, 9]); // Page, Type, Grade, Net, To order keep their headings
  headerRow(
    sheet,
    headers.map((h, i) => {
      const k = i - o;
      if (k < 0) return withPlan && i === 0 ? '' : h;
      return k === 6 ? t('exports.structural.headers.elements') : k === 10 ? t('exports.structural.headers.notCalculable') : keep.has(k) && !(withPlan && k === 0) ? h : '';
    })
  );
  data.summaryRows.forEach((r, i) => {
    const calculable = r.count > r.missing;
    const row = rowFor(undefined, [r.page ?? '', '', t(`concrete.kinds.${r.kind}`), r.grade || noGrade, '', '', r.count, calculable ? r.net : DASH, '', calculable ? r.order : DASH, r.missing > 0 ? r.missing : '']);
    row.getCell(col(8)).numFmt = NUM_FMT;
    row.getCell(col(10)).numFmt = NUM_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const sumTotal = sheet.addRow([t('exports.common.grandTotal'), ...new Array(headers.length - 1).fill('')]);
  sumTotal.getCell(col(7)).value = data.totals.elementCount;
  sumTotal.getCell(col(8)).value = data.totals.volumeM3;
  sumTotal.getCell(col(10)).value = data.totals.orderM3;
  sumTotal.getCell(col(11)).value = data.totals.missingCount > 0 ? data.totals.missingCount : '';
  sumTotal.getCell(col(8)).numFmt = NUM_FMT;
  sumTotal.getCell(col(10)).numFmt = NUM_FMT;
  styleRow(sumTotal, C_TOTAL, true);

  // Project workbook: each plan's own share, so a missing item can be traced to its plan.
  if (data.perPlan && data.perPlan.length > 0) {
    sectionTitle(sheet, t('exports.structural.byPlan'));
    headerRow(sheet, headers.map((h, i) => (i === 0 ? h : i === col(7) - 1 ? t('exports.structural.headers.elements') : i === col(8) - 1 || i === col(10) - 1 ? h : i === col(11) - 1 ? t('exports.structural.headers.notCalculable') : '')));
    data.perPlan.forEach((p, i) => {
      const cells: (string | number)[] = new Array(11).fill('');
      cells[6] = p.count;
      cells[7] = p.count > p.missing ? p.net : DASH;
      cells[9] = p.count > p.missing ? p.order : DASH;
      cells[10] = p.missing > 0 ? p.missing : '';
      const row = rowFor(p.planName, cells);
      row.getCell(col(8)).numFmt = NUM_FMT;
      row.getCell(col(10)).numFmt = NUM_FMT;
      styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
    });
  }

  if (data.totals.missingCount > 0) {
    sheet.addRow([]);
    note(sheet, t('exports.structural.missing', { count: data.totals.missingCount }));
  }
}

// ---------- rebar ----------

interface RebarTotals {
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number;
  estimatedLengthM: number;
  estimatedWeightKg: number;
  basis: RebarBasis | null;
}
interface RebarSheetData {
  items: { planName?: string; row: RebarItemRow }[];
  summaryRows: { page?: number; diameterMm: number; lengthM: number; weightKg: number; orderLengthM: number; orderWeightKg: number; estimatedLengthM: number; estimatedWeightKg: number; basis: RebarBasis }[];
  totals: RebarTotals;
  missingItemCount: number;
  perPlan?: { planName: string; length: number; weight: number; orderLength: number; orderWeight: number; basis: RebarBasis | null; missing: number; estimatedLengthM: number; estimatedWeightKg: number }[];
}

const REBAR_WIDTHS = [8, 14, 12, 12, 10, 12, 16, 10, 14, 14, 14, 10, 14, 14, 18, 22];

function addRebarSheet(workbook: ExcelJS.Workbook, data: RebarSheetData, withPlan: boolean, x: ExportContext) {
  const { t } = x;
  const o = withPlan ? 1 : 0;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.rebar'), { views: [{ rightToLeft: x.rtl }] });
  const lm = t('units.lm');
  const kg = t('units.kg');
  const base = [
    t('exports.structural.headers.page'),
    t('exports.structural.headers.mark'),
    t('exports.structural.headers.kind'),
    t('exports.structural.headers.level'),
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
  const headers = withPlan ? [t('exports.common.plan'), ...base] : base;
  const widths = withPlan ? [PLAN_WIDTH, ...REBAR_WIDTHS] : REBAR_WIDTHS;
  columnWidths(widths, headers, x.language, 2).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  headerRow(sheet, headers);

  const rowFor = (planName: string | undefined, cells: (string | number | null)[]) => sheet.addRow(withPlan ? [planName ?? '', ...cells] : cells);
  const col = (c: number) => c + o;

  const first = sheet.rowCount + 1;
  data.items.forEach(({ planName, row: it }, i) => {
    const calculable = it.netLengthM !== null;
    const row = rowFor(planName, [
      it.pageNumber,
      markLabel(it, t),
      t(it.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars'),
      it.level === null ? DASH : t(it.level === 'bottom' ? 'exports.structural.levelBottom' : 'exports.structural.levelTop'),
      num(it.diameterMm),
      num(it.spacingCm),
      it.direction === null ? DASH : t(it.direction === 'both' ? 'exports.structural.bothDirections' : it.direction === 'long' ? 'exports.structural.longSide' : 'exports.structural.shortSide'),
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
    for (const c of [10, 11, 13, 14]) row.getCell(col(c)).numFmt = qty;
    row.getCell(col(9)).numFmt = NUM_FMT;
    row.getCell(col(12)).numFmt = PCT_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const last = sheet.rowCount;

  const { totals } = data;
  const totalFmt = totals.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
  const total = sheet.addRow([t('exports.common.grandTotal'), ...new Array(headers.length - 1).fill('')]);
  total.getCell(col(15)).value = totals.basis ? basisText(totals.basis, x) : DASH;
  const sums: [number, number][] = [[10, totals.lengthM], [11, totals.weightKg], [13, totals.orderLengthM], [14, totals.orderWeightKg]];
  for (const [c, result] of sums) {
    const letter = colLetter(col(c));
    total.getCell(col(c)).value = { formula: `ROUND(SUM(${letter}${first}:${letter}${last}),2)`, result };
    total.getCell(col(c)).numFmt = totalFmt;
  }
  styleRow(total, C_GRAND, true);

  // By diameter (by page and diameter in a plan workbook; across all plans in the project's).
  sectionTitle(sheet, t('exports.structural.rebarByDiameter'));
  const keep = new Set([0, 4, 9, 10, 12, 13, 14]);
  headerRow(
    sheet,
    headers.map((h, i) => {
      const k = i - o;
      if (k < 0) return withPlan ? '' : h;
      return k === 15 ? t('exports.structural.headers.status') : keep.has(k) && !(withPlan && k === 0) ? h : '';
    })
  );
  data.summaryRows.forEach((r, i) => {
    const cells: (string | number)[] = new Array(16).fill('');
    cells[0] = r.page ?? '';
    cells[4] = r.diameterMm;
    cells[9] = r.lengthM;
    cells[10] = r.weightKg;
    cells[12] = r.orderLengthM;
    cells[13] = r.orderWeightKg;
    cells[14] = basisText(r.basis, x);
    const row = rowFor(undefined, cells);
    if (r.basis === 'mixed') {
      row.getCell(col(16)).value = t('exports.structural.estimateNote', {
        length: `${x.number(round2(r.estimatedLengthM))} ${lm}`,
        weight: `${x.number(round2(r.estimatedWeightKg))} ${kg}`,
      });
    }
    for (const c of [10, 11, 13, 14]) row.getCell(col(c)).numFmt = r.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
  });
  const sumTotal = sheet.addRow([t('exports.common.grandTotal'), ...new Array(headers.length - 1).fill('')]);
  sumTotal.getCell(col(10)).value = totals.lengthM;
  sumTotal.getCell(col(11)).value = totals.weightKg;
  sumTotal.getCell(col(13)).value = totals.orderLengthM;
  sumTotal.getCell(col(14)).value = totals.orderWeightKg;
  sumTotal.getCell(col(15)).value = totals.basis ? basisText(totals.basis, x) : DASH;
  for (const c of [10, 11, 13, 14]) sumTotal.getCell(col(c)).numFmt = totalFmt;
  styleRow(sumTotal, C_TOTAL, true);

  if (data.perPlan && data.perPlan.length > 0) {
    sectionTitle(sheet, t('exports.structural.byPlan'));
    headerRow(sheet, headers.map((h, i) => (i === 0 ? h : [col(10), col(11), col(13), col(14), col(15)].includes(i + 1) ? h : i + 1 === col(16) ? t('exports.structural.headers.status') : '')));
    data.perPlan.forEach((p, i) => {
      const cells: (string | number)[] = new Array(16).fill('');
      cells[9] = p.length;
      cells[10] = p.weight;
      cells[12] = p.orderLength;
      cells[13] = p.orderWeight;
      cells[14] = p.basis ? basisText(p.basis, x) : DASH;
      cells[15] = p.missing > 0 ? t('exports.structural.missingShort', { count: p.missing }) : '';
      const row = rowFor(p.planName, cells);
      for (const c of [10, 11, 13, 14]) row.getCell(col(c)).numFmt = p.basis === 'estimated' ? ESTIMATE_FMT : NUM_FMT;
      styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
    });
  }

  if (totals.basis === 'mixed') {
    sheet.addRow([]);
    note(sheet, t('exports.structural.estimateNote', { length: `${x.number(round2(totals.estimatedLengthM))} ${lm}`, weight: `${x.number(round2(totals.estimatedWeightKg))} ${kg}` }));
  } else if (totals.basis === 'estimated') {
    sheet.addRow([]);
    note(sheet, t('exports.structural.estimateOnlyNote'));
  }
  if (data.missingItemCount > 0) {
    if (totals.basis !== 'mixed' && totals.basis !== 'estimated') sheet.addRow([]);
    note(sheet, t('exports.structural.missing', { count: data.missingItemCount }));
  }
}
