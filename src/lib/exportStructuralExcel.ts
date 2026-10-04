import ExcelJS from 'exceljs';
import type { prepareStirrupShape } from './stirrupShape';
import { columnWidths, type ExportContext } from './exportLanguage';
import { markLabel } from './structuralMarks';
import { basisText, concreteStatusText, levelReportSpecification, levelQuantity, levelStatus, levelText, overlapCm, sheetSizeText } from './structuralExportText';
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
    addRebarAndStirrupSheets(workbook, levels.map((row) => ({ row })), summary, summary.missingItemCount, false, x);
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
    addRebarAndStirrupSheets(workbook, sources.flatMap((s) => (s.report.rebar?.levels ?? []).map((row) => ({ planName: s.planName, row }))), r, r.missingItemCount, true, x);
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
  const meshOnly = rows.length > 0 && rows.every(({ row }) => row.kind === 'mesh');
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
    t(meshOnly ? 'rebar.requiredWeightHeader' : 'exports.structural.headers.netWeight', { unit: kg }),
    t('exports.structural.headers.waste'),
    t(meshOnly ? 'rebar.purchaseWeightHeader' : 'exports.projectPdf.orderUnit', { unit: kg }),
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
      t(d.kind === 'mesh' ? 'rebar.mesh' : d.kind === 'stirrup' ? 'rebar.stirrupName' : 'rebar.bars'),
      markLabel(d, t),
      levelText(d.level, x) || DASH,
      levelReportSpecification(d, x),
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
    if (!meshOnly && d.kind === 'mesh') {
      // Presentation prefixes keep the underlying Excel cells numeric.
      row.getCell(col(9)).numFmt = `"${t('rebar.requiredWeightShort').replace(/"/g, '""')}: "${qty}`;
      row.getCell(col(11)).numFmt = `"${t('rebar.purchaseWeightShort').replace(/"/g, '""')}: "${NUM_FMT}`;
    }
    styleRow(row, i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B);
    if (d.kind === 'bars') row.getCell(col(5)).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
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

/** Stirrups have a numerical execution sheet; existing Mesh/Bars spreadsheets keep their columns. */
function addRebarAndStirrupSheets(workbook: ExcelJS.Workbook, rows: { planName?: string; row: RebarLevelRow }[], totals: RebarTotals, missing: number, withPlan: boolean, x: ExportContext) {
  const stirrups = rows.filter(({ row }) => row.kind === 'stirrup');
  const regular = rows.filter(({ row }) => row.kind !== 'stirrup');
  if (regular.length) {
    const calculated = regular.filter(({ row }) => row.netWeightKg !== null);
    const estimated = calculated.filter(({ row }) => row.estimated).length;
    const separated: RebarTotals = { weightKg: calculated.reduce((sum, { row }) => sum + row.netWeightKg!, 0),
      orderWeightKg: regular.some(({ row }) => row.orderWeightKg === null) ? null : regular.reduce((sum, { row }) => sum + row.orderWeightKg!, 0),
      basis: !calculated.length ? null : !estimated ? 'exact' : estimated === calculated.length ? 'estimated' : 'mixed' };
    addRebarSheet(workbook, regular, stirrups.length ? separated : totals,
      stirrups.length ? new Set(regular.filter(({ row }) => row.status !== 'ok').map(({ planName, row }) => `${planName}|${row.itemId}`)).size : missing, withPlan, x);
  }
  if (stirrups.length) addStirrupSheet(workbook, stirrups, withPlan, x);
}

/** Rasterise the shared report vectors only at Excel's PNG embedding boundary. */
function stirrupThumbnailPng(shape: ReturnType<typeof prepareStirrupShape>): string {
  const canvas = document.createElement('canvas');
  canvas.width = 168;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to render the Stirrup shape thumbnail.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(144 / Math.max(maxX - minX, 1), 88 / Math.max(maxY - minY, 1));
  const x = (value: number) => 84 + (value - (minX + maxX) / 2) * scale;
  const y = (value: number) => 56 + (value - (minY + maxY) / 2) * scale;
  ctx.strokeStyle = '#c2410c';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const segment of shape.segments) {
    ctx.moveTo(x(segment.normalizedStart.x), y(segment.normalizedStart.y));
    ctx.lineTo(x(segment.normalizedEnd.x), y(segment.normalizedEnd.y));
  }
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

function addStirrupSheet(workbook: ExcelJS.Workbook, rows: { planName?: string; row: RebarLevelRow }[], withPlan: boolean, x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('rebar.stirrup.excelSheet'), { views: [{ rightToLeft: x.rtl }] });
  const headers = [t('exports.structural.headers.page'), t('concrete.mark'), t('rebar.stirrup.shape'), t('rebar.stirrup.report.shapeType'), t('rebar.diameter'),
    `${t('rebar.stirrup.geometricLength')} (${t('units.m')})`, `${t('rebar.stirrup.lengthUsed')} (${t('units.m')})`,
    t('rebar.stirrup.lengthSource'), t('rebar.stirrup.quantity'), `${t('rebar.totalLength')} (${t('units.m')})`,
    `${t('quantitiesPanel.cols.netWeight')} (${t('units.kg')})`, `${t('quantitiesPanel.cols.orderWeight')} (${t('units.kg')})`, t('exports.structural.headers.status')];
  if (withPlan) headers.unshift(t('exports.common.plan'));
  const widths = [12, 20, 14, 40, 12, 18, 18, 20, 12, 18, 18, 18, 24];
  if (withPlan) widths.unshift(PLAN_WIDTH);
  columnWidths(widths, headers, x.language, 2).forEach((width, index) => sheet.getColumn(index + 1).width = width);
  headerRow(sheet, headers);
  const offset = withPlan ? 1 : 0;
  // Preserve the existing value columns, shifted only by the new thumbnail column.
  const column = (original: number) => original + offset + (original >= 3 ? 1 : 0);
  const first = sheet.rowCount + 1;
  rows.forEach(({ planName, row: d }, index) => {
    const part = d.parts[0], data = part.stirrup;
    const shape = data?.shape;
    const pages = data ? [...new Set(data.placements.map((p) => p.placement.pageNumber))].join(', ') : String(d.pageNumber);
    const description = shape ? `${t(`rebar.stirrup.templates.${shape.template}`)} · ${x.number(Math.round(shape.widthM * 1000) / 10)} × ${x.number(Math.round(shape.heightM * 1000) / 10)} ${t('units.cm')}` : DASH;
    const cells = [pages, markLabel(d, t), '', description, num(part.diameterMm), num(data?.geometricLengthM ?? null), num(part.barLengthM),
      t(data?.lengthSource === 'manual' ? 'rebar.stirrup.manualLength' : 'rebar.stirrup.geometricLength'), num(part.barCount), num(part.netLengthM),
      num(d.netWeightKg), num(d.orderWeightKg), levelStatus(d, x)];
    const row = sheet.addRow(withPlan ? [planName ?? '', ...cells] : cells);
    styleRow(row, index % 2 ? C_ZEBRA_B : C_ZEBRA_A);
    row.getCell(column(3)).alignment = { horizontal: 'center', wrapText: true };
    [4, 5, 6, 8, 9, 10, 11].forEach((original) => row.getCell(column(original)).numFmt = original === 4 || original === 8 ? PCT_FMT : NUM_FMT);
    row.height = 48;
    if (shape?.segments.length) {
      const imageId = workbook.addImage({ base64: stirrupThumbnailPng(shape), extension: 'png' });
      sheet.addImage(imageId, {
        tl: { col: 2 + offset + 0.07, row: row.number - 1 + 0.06 },
        ext: { width: 84, height: 56 },
        editAs: 'oneCell',
      });
    }
  });
  const last = sheet.rowCount;
  const total = sheet.addRow(new Array(headers.length).fill(''));
  total.getCell(column(2)).value = t('rebar.summary.total');
  for (const original of [8, 9, 10, 11]) {
    const values = rows.map(({ row }) => original === 8 ? row.parts[0].barCount : original === 9 ? row.parts[0].netLengthM : original === 10 ? row.netWeightKg : row.orderWeightKg);
    const letter = colLetter(column(original));
    total.getCell(column(original)).value = values.some((v) => v === null) ? DASH : {
      formula: `ROUND(SUM(${letter}${first}:${letter}${last}),2)`, result: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    };
    total.getCell(column(original)).numFmt = original === 8 ? PCT_FMT : NUM_FMT;
  }
  const missing = rows.filter(({ row }) => row.status !== 'ok').length;
  if (missing) total.getCell(column(12)).value = t('exports.structural.missingShort', { count: missing });
  styleRow(total, C_GRAND, true);
}
