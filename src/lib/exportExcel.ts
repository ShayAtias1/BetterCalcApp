import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { AreaKind, ExtraReportCategory, Measurement, Plan, ReportCategory, ReportCategoryTotal, RoomQuantitySummary } from '../types';
import type { Language } from '../i18n';
import { columnWidths, exportContext, type ExportContext } from './exportLanguage';
import { numberAreaMeasurements } from './areaMeasurements';
import { usedExtraCategories } from './quantities';
import { sheetRef } from './excelSheetRef';
import { addStructuralSheets } from './exportStructuralExcel';
import { buildStructuralReport, type StructuralReport } from './structuralQuantities';

const DASH = '—';

// Fill palette (matches the reference workbook "מטריצה מיכשווילי 2").
const C_HEADER = 'FF1F4E79'; // dark blue header (white bold text)
const C_ZEBRA_A = 'FFEBF5FB'; // dry room, even row
const C_ZEBRA_B = 'FFFDFEFE'; // dry room, odd row
const C_WET = 'FFFEF9E7'; // room with wall cladding (bathroom / wet)
const C_BALCONY = 'FFEAFAF1'; // AS tiling without cladding (balcony)
const C_TOTAL = 'FFD6E4F0'; // per-apartment totals block
const C_TOTAL_HDR = 'FFA9C4D9'; // per-apartment totals sub-header
const C_GRAND = 'FFD5F5E3'; // grand-total row on summary sheet

const NUM_FMT = '#,##0.00';

/** Data-sheet headers, columns A..Q. The order formulas below address these columns by letter. */
function dataHeaders({ t }: ExportContext): string[] {
  return [
    t('exports.common.apartment'),
    t('exports.common.room'),
    t('exports.excel.dataHeaders.tilingRegularArea'),
    t('exports.excel.dataHeaders.tilingAsArea'),
    t('exports.excel.dataHeaders.claddingArea'),
    t('exports.excel.dataHeaders.panelsArea'),
    t('exports.excel.dataHeaders.tilingRegularWaste'),
    t('exports.excel.dataHeaders.tilingAsWaste'),
    t('exports.excel.dataHeaders.claddingWaste'),
    t('exports.excel.dataHeaders.panelsWaste'),
    t('exports.excel.dataHeaders.tilingRegularOrder'),
    t('exports.excel.dataHeaders.tilingAsOrder'),
    t('exports.excel.dataHeaders.claddingOrder'),
    t('exports.excel.dataHeaders.panelsOrder'),
    t('exports.common.notes'),
    // Appended last on purpose: the order formulas below address columns by letter (C..N), so the
    // panel length gets its own column P instead of shifting any of them.
    t('exports.excel.dataHeaders.panelsLength'),
    t('exports.excel.dataHeaders.panelsOrderLength'),
  ];
}
/** Number of data-sheet columns before the later work types' — fixed, whatever the language. */
const DATA_COLUMN_COUNT = 17;
const DATA_WIDTHS = [8, 26, 17, 16, 18, 14, 15, 15, 12, 12, 15, 15, 13, 13, 26, 17, 21];

/** A category's net and to-order columns on the summary sheet — the original four and the later ones alike. */
function summaryHeadersFor(category: ReportCategory, { t }: ExportContext): string[] {
  const label = t(`reportCategories.${category}`);
  return [t('exports.excel.categoryNetM2', { label }), t('exports.excel.categoryOrderM2', { label })];
}

const BASE_CATEGORIES: ReportCategory[] = ['tiling_regular', 'tiling_as', 'cladding', 'panels'];
const SUMMARY_WIDTHS = [10, 20, 22, 18, 20, 20, 22, 16, 18];

/** 1-based column number → Excel letters (1 → A, 27 → AA). */
function colLetter(n: number): string {
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Data-sheet columns for the later work types (painting, plaster, waterproofing), appended after Q
 * only when the project uses them — three per category: net, waste %, order. Appending keeps every
 * existing column letter (and formula) exactly where it was.
 */
function extraDataColumns(extras: ExtraReportCategory[]) {
  return extras.map((category, i) => {
    const netCol = DATA_COLUMN_COUNT + 1 + i * 3;
    return { category, netCol, wasteCol: netCol + 1, orderCol: netCol + 2 };
  });
}

function setFill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumField(rooms: RoomQuantitySummary[], pick: (s: RoomQuantitySummary) => number | null): number {
  return round2(rooms.reduce((acc, s) => acc + (pick(s) ?? 0), 0));
}

const AREA_HEADER_KEYS = ['number', 'page', 'kind', 'calcMode', 'length', 'height', 'area'] as const;
const AREA_WIDTHS = [6, 8, 14, 18, 14, 14, 14];

/** Adds a "הריסה ובנייה" sheet listing every kind-tagged area/wall measurement (independent of room data) plus per-kind and grand totals. */
function addAreaMeasurementSheet(workbook: ExcelJS.Workbook, measurements: Measurement[], x: ExportContext) {
  const { t } = x;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.areas'), { views: [{ rightToLeft: x.rtl }] });
  const areaHeaders = AREA_HEADER_KEYS.map((k) => t(`exports.common.areaHeaders.${k}`));
  columnWidths(AREA_WIDTHS, areaHeaders, x.language).forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  const headerRow = sheet.addRow(areaHeaders);
  headerRow.eachCell({ includeEmpty: true }, (c) => {
    setFill(c, C_HEADER);
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const numbers = numberAreaMeasurements(measurements);
  const kinds: AreaKind[] = ['demolition', 'construction'];
  let grandTotal = 0;
  for (const kind of kinds) {
    const rows = measurements.filter((m) => m.areaKind === kind);
    if (rows.length === 0) continue;
    let subtotal = 0;
    rows.forEach((m, i) => {
      const isWall = m.calcMode === 'wall';
      subtotal += m.areaM2 ?? 0;
      const row = sheet.addRow([
        numbers.get(m.id) ?? '',
        m.pageNumber,
        t(`areaKinds.${kind}`),
        isWall ? t('exports.common.calcWall') : t('exports.common.calcFootprint'),
        isWall ? round2(m.wallLengthM ?? 0) : DASH,
        isWall ? round2(m.wallHeightM ?? 0) : DASH,
        round2(m.areaM2 ?? 0),
      ]);
      const argb = i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B;
      row.eachCell({ includeEmpty: true }, (c) => {
        setFill(c, argb);
        c.alignment = { horizontal: 'center' };
      });
      row.getCell(5).numFmt = NUM_FMT;
      row.getCell(6).numFmt = NUM_FMT;
      row.getCell(7).numFmt = NUM_FMT;
    });
    grandTotal += subtotal;
    const totalRow = sheet.addRow([t('exports.common.kindTotal', { kind: t(`areaKinds.${kind}`) }), '', '', '', '', '', round2(subtotal)]);
    totalRow.getCell(7).numFmt = NUM_FMT;
    totalRow.eachCell({ includeEmpty: true }, (c) => {
      setFill(c, C_TOTAL);
      c.font = { bold: true };
      c.alignment = { horizontal: 'center' };
    });
  }

  const grandRow = sheet.addRow([t('exports.common.grandTotal'), '', '', '', '', '', round2(grandTotal)]);
  grandRow.getCell(7).numFmt = NUM_FMT;
  grandRow.eachCell({ includeEmpty: true }, (c) => {
    setFill(c, C_GRAND);
    c.font = { bold: true };
    c.alignment = { horizontal: 'center' };
  });
}

const DEDUCTION_WIDTHS = [8, 26, 16, 14, 18, 14];

/**
 * Adds a "ניכוי פתחים" sheet showing gross − openings = net for wall-based work, one row per room
 * and work type where openings were actually deducted. Not added at all when nothing was deducted.
 */
function addOpeningDeductionSheet(workbook: ExcelJS.Workbook, summaries: RoomQuantitySummary[], x: ExportContext) {
  const { t } = x;
  const rows = summaries.flatMap((s) => s.openingDeductions.map((d) => ({ s, d })));
  if (rows.length === 0) return;
  const sheet = workbook.addWorksheet(t('exports.excel.sheets.deductions'), { views: [{ rightToLeft: x.rtl }] });
  const deductionHeaders = [
    t('exports.common.apartment'),
    t('exports.common.room'),
    t('exports.excel.deductionHeaders.workType'),
    t('exports.excel.deductionHeaders.gross'),
    t('exports.excel.deductionHeaders.deducted'),
    t('exports.excel.deductionHeaders.net'),
  ];
  columnWidths(DEDUCTION_WIDTHS, deductionHeaders, x.language).forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  const headerRow = sheet.addRow(deductionHeaders);
  headerRow.eachCell({ includeEmpty: true }, (c) => {
    setFill(c, C_HEADER);
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  rows.forEach(({ s, d }, i) => {
    const row = sheet.addRow([s.apartmentNumber || DASH, s.roomName, t(`reportCategories.${d.category}`), d.grossM2, d.deductedM2, null]);
    const r = row.number;
    // Net as a live formula, so the sheet itself shows how it was reached.
    row.getCell(6).value = { formula: `ROUND(D${r}-E${r},2)`, result: d.netM2 };
    const argb = i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B;
    row.eachCell({ includeEmpty: true }, (c) => {
      setFill(c, argb);
      c.alignment = { horizontal: 'center' };
    });
    for (const ci of [4, 5, 6]) row.getCell(ci).numFmt = NUM_FMT;
  });
}

interface ApartmentTotals {
  apartment: string;
  /** Totals-block row and cached values per extra category, in `extras` order. */
  extraRows: { row: number; net: number; ord: number }[];
  regRow: number;
  asRow: number;
  cladRow: number;
  panRow: number;
  netReg: number;
  ordReg: number;
  netAs: number;
  ordAs: number;
  netClad: number;
  ordClad: number;
  netPan: number;
  ordPan: number;
}

// _totals is kept for a stable call signature but is no longer needed:
// totals are now emitted as live SUM formulas per apartment + a grand total on the summary sheet.
export async function exportQuantitiesToExcel(
  project: Plan,
  summaries: RoomQuantitySummary[],
  _totals: ReportCategoryTotal[],
  areaMeasurements: Measurement[],
  language: Language
) {
  // Concrete and rebar come from the plan itself; the caller has already limited them to the pages
  // being exported (withStructuralPages), as it limits the summaries and the area measurements.
  const workbook = buildQuantitiesWorkbook(summaries, areaMeasurements, language, buildStructuralReport(project));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, exportContext(language).t('exports.excel.fileName', { name: safeName }));
}

/** The plan workbook exactly as `exportQuantitiesToExcel` saves it — built apart so tests can read it. */
export function buildQuantitiesWorkbook(
  summaries: RoomQuantitySummary[],
  areaMeasurements: Measurement[],
  language: Language,
  /** Concrete and rebar sheets, added after the others and only for the sections that have items. Omitted: none. */
  structural?: StructuralReport
): ExcelJS.Workbook {
  const x = exportContext(language);
  const { t } = x;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BetterCalc';
  workbook.created = new Date();

  if (summaries.length > 0) {
  /** Written into quantity cells of a room whose page has no scale, so 0 is never implied. */
  const notCalibrated = t('exports.common.notCalibrated');
  const extras = usedExtraCategories(summaries);
  const extraCols = extraDataColumns(extras);
  const dataHeaderRow = [
    ...dataHeaders(x),
    ...extras.flatMap((c) => {
      const label = t(`reportCategories.${c}`);
      return [t('exports.excel.categoryNetM2', { label }), t('exports.excel.categoryWaste', { label }), t('exports.excel.categoryOrder', { label })];
    }),
  ];
  const dataWidths = columnWidths([...DATA_WIDTHS, ...extras.flatMap(() => [15, 12, 15])], dataHeaderRow, language);
  // The per-apartment totals block names each work type in column A (the apartment column), so an
  // English workbook widens it to the longest of those names; Hebrew keeps its width.
  if (language !== 'he') {
    const itemNames = ['tiling_regular', 'tiling_as', 'cladding', 'panels', ...extras].map((c) => t(`reportCategories.${c as ReportCategory}`));
    dataWidths[0] = Math.max(dataWidths[0], Math.ceil(Math.max(...itemNames.map((n) => n.length)) * 1.1) + 3);
  }
  const summaryHeaders = [
    t('exports.common.apartment'),
    ...BASE_CATEGORIES.flatMap((c) => summaryHeadersFor(c, x)),
    ...extras.flatMap((c) => summaryHeadersFor(c, x)),
  ];
  const summaryWidths = columnWidths([...SUMMARY_WIDTHS, ...extras.flatMap(() => [16, 18])], summaryHeaders, language);
  const summaryLastCol = summaryHeaders.length;

  // Created first so the tab order is [סיכום כולל, כתב כמויות]; populated after the data sheet.
  // Sheet names: the summary sheet's formulas reach the data sheet by this same name — see `sheetRef`.
  const dataSheetName = t('exports.excel.sheets.data');
  const summarySheet = workbook.addWorksheet(t('exports.excel.sheets.summary'), { views: [{ rightToLeft: x.rtl }] });
  const dataSheet = workbook.addWorksheet(dataSheetName, { views: [{ rightToLeft: x.rtl }] });

  dataWidths.forEach((w, i) => (dataSheet.getColumn(i + 1).width = w));
  summaryWidths.forEach((w, i) => (summarySheet.getColumn(i + 1).width = w));

  // Group rooms by apartment, preserving first-seen order.
  const groups = new Map<string, RoomQuantitySummary[]>();
  const order: string[] = [];
  for (const s of summaries) {
    const key = s.apartmentNumber || '';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(s);
  }

  const apartmentTotals: ApartmentTotals[] = [];

  // ---- Data sheet: one block per apartment ----
  for (const key of order) {
    const rooms = groups.get(key)!;

    const headerRow = dataSheet.addRow(dataHeaderRow);
    headerRow.eachCell({ includeEmpty: true }, (c) => {
      setFill(c, C_HEADER);
      c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const firstDataRow = headerRow.number + 1;
    let lastDataRow = firstDataRow;

    for (const s of rooms) {
      // An uncalibrated page has no quantities to report — the cells say so in words instead of
      // printing 0. They stay text, so SUM() and the order formulas below simply skip them.
      const areaCell = (v: number | null) => (s.pageCalibrated ? v ?? DASH : notCalibrated);
      const row = dataSheet.addRow([
        s.apartmentNumber,
        s.roomName,
        areaCell(s.tilingRegularAreaM2),
        areaCell(s.tilingAsAreaM2),
        areaCell(s.claddingAreaM2),
        areaCell(s.panelsAreaM2),
        s.tilingRegularWastePercent ?? DASH,
        s.tilingAsWastePercent ?? DASH,
        s.claddingWastePercent ?? DASH,
        s.panelsWastePercent ?? DASH,
        null,
        null,
        null,
        null,
        s.notes,
        areaCell(s.panelsLengthM),
        null,
      ]);
      const r = row.number;
      lastDataRow = r;

      // Order columns K–N as formulas: area × (1 + waste/100), rounded, "—" when no area.
      row.getCell(11).value = {
        formula: `IF(ISNUMBER(C${r}),ROUND(C${r}*(1+IF(ISNUMBER(G${r}),G${r},0)/100),2),"${DASH}")`,
        result: s.tilingRegularOrderM2 ?? DASH,
      };
      row.getCell(12).value = {
        formula: `IF(ISNUMBER(D${r}),ROUND(D${r}*(1+IF(ISNUMBER(H${r}),H${r},0)/100),2),"${DASH}")`,
        result: s.tilingAsOrderM2 ?? DASH,
      };
      row.getCell(13).value = {
        formula: `IF(ISNUMBER(E${r}),ROUND(E${r}*(1+IF(ISNUMBER(I${r}),I${r},0)/100),2),"${DASH}")`,
        result: s.claddingOrderM2 ?? DASH,
      };
      row.getCell(14).value = {
        formula: `IF(ISNUMBER(F${r}),ROUND(F${r}*(1+IF(ISNUMBER(J${r}),J${r},0)/100),2),"${DASH}")`,
        result: s.panelsOrderM2 ?? DASH,
      };

      // Row colour by room "type", derived from which quantities exist.
      const argb =
        s.claddingAreaM2 != null ? C_WET : s.tilingAsAreaM2 != null ? C_BALCONY : r % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B;
      row.eachCell({ includeEmpty: true }, (c) => setFill(c, argb));

      row.getCell(16).numFmt = NUM_FMT;
      row.getCell(16).alignment = { horizontal: 'center' };
      // Same shape as the m² order columns: length × (1 + waste/100), "—" when there is no length.
      row.getCell(17).value = {
        formula: `IF(ISNUMBER(P${r}),ROUND(P${r}*(1+IF(ISNUMBER(J${r}),J${r},0)/100),2),"${DASH}")`,
        result: s.panelsOrderLengthM ?? DASH,
      };
      row.getCell(17).numFmt = NUM_FMT;
      row.getCell(17).alignment = { horizontal: 'center' };
      for (const col of extraCols) {
        const q = s.extra[col.category];
        const net = colLetter(col.netCol);
        const waste = colLetter(col.wasteCol);
        row.getCell(col.netCol).value = areaCell(q.areaM2);
        row.getCell(col.wasteCol).value = q.wastePercent ?? DASH;
        row.getCell(col.orderCol).value = {
          formula: `IF(ISNUMBER(${net}${r}),ROUND(${net}${r}*(1+IF(ISNUMBER(${waste}${r}),${waste}${r},0)/100),2),"${DASH}")`,
          result: q.orderM2 ?? DASH,
        };
        for (const ci of [col.netCol, col.wasteCol, col.orderCol]) {
          row.getCell(ci).alignment = { horizontal: 'center' };
          setFill(row.getCell(ci), argb);
        }
        row.getCell(col.netCol).numFmt = NUM_FMT;
        row.getCell(col.orderCol).numFmt = NUM_FMT;
      }
      for (let ci = 3; ci <= 14; ci++) {
        const cell = row.getCell(ci);
        cell.alignment = { horizontal: 'center' };
        if (ci <= 6 || ci >= 11) cell.numFmt = NUM_FMT;
      }
    }

    // Per-apartment totals block.
    dataSheet.addRow([]);
    const titleRow = dataSheet.addRow([t('exports.common.total')]);
    setFill(titleRow.getCell(1), C_TOTAL);
    titleRow.getCell(1).font = { bold: true };

    const subHeader = dataSheet.addRow([
      t('exports.common.item'),
      t('exports.excel.totalsHeaders.net'),
      t('exports.excel.totalsHeaders.waste'),
      t('exports.excel.totalsHeaders.order'),
      t('exports.excel.totalsHeaders.length'),
      t('exports.excel.totalsHeaders.orderLength'),
    ]);
    subHeader.eachCell({ includeEmpty: true }, (c) => {
      setFill(c, C_TOTAL_HDR);
      c.font = { bold: true };
      c.alignment = { horizontal: 'center' };
    });

    const cats = [
      { label: t('reportCategories.tiling_regular'), areaCol: 'C', orderCol: 'K', net: sumField(rooms, (s) => s.tilingRegularAreaM2), ord: sumField(rooms, (s) => s.tilingRegularOrderM2) },
      { label: t('reportCategories.tiling_as'), areaCol: 'D', orderCol: 'L', net: sumField(rooms, (s) => s.tilingAsAreaM2), ord: sumField(rooms, (s) => s.tilingAsOrderM2) },
      { label: t('reportCategories.cladding'), areaCol: 'E', orderCol: 'M', net: sumField(rooms, (s) => s.claddingAreaM2), ord: sumField(rooms, (s) => s.claddingOrderM2) },
      {
        label: t('reportCategories.panels'),
        areaCol: 'F',
        orderCol: 'N',
        lengthCol: 'P',
        orderLengthCol: 'Q',
        net: sumField(rooms, (s) => s.panelsAreaM2),
        ord: sumField(rooms, (s) => s.panelsOrderM2),
      },
      ...extraCols.map((col) => ({
        label: t(`reportCategories.${col.category}`),
        areaCol: colLetter(col.netCol),
        orderCol: colLetter(col.orderCol),
        net: sumField(rooms, (s) => s.extra[col.category].areaM2),
        ord: sumField(rooms, (s) => s.extra[col.category].orderM2),
      })),
    ];
    const catRowNums: number[] = [];
    for (const cat of cats) {
      const row = dataSheet.addRow([cat.label, null, null, null, null, null]);
      catRowNums.push(row.number);
      // Panels are the only category with a linear reading; it sums the same rows, column P.
      if ('lengthCol' in cat && cat.lengthCol) {
        row.getCell(5).value = {
          formula: `ROUND(SUM(${cat.lengthCol}${firstDataRow}:${cat.lengthCol}${lastDataRow}),2)`,
          result: sumField(rooms, (s) => s.panelsLengthM),
        };
        row.getCell(5).numFmt = NUM_FMT;
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).value = {
          formula: `ROUND(SUM(${cat.orderLengthCol}${firstDataRow}:${cat.orderLengthCol}${lastDataRow}),2)`,
          result: sumField(rooms, (s) => s.panelsOrderLengthM),
        };
        row.getCell(6).numFmt = NUM_FMT;
        row.getCell(6).alignment = { horizontal: 'center' };
      }
      row.getCell(2).value = { formula: `ROUND(SUM(${cat.areaCol}${firstDataRow}:${cat.areaCol}${lastDataRow}),2)`, result: cat.net };
      row.getCell(4).value = { formula: `ROUND(SUM(${cat.orderCol}${firstDataRow}:${cat.orderCol}${lastDataRow}),2)`, result: cat.ord };
      row.eachCell({ includeEmpty: true }, (c) => setFill(c, C_TOTAL));
      row.getCell(2).numFmt = NUM_FMT;
      row.getCell(4).numFmt = NUM_FMT;
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'center' };
    }

    apartmentTotals.push({
      apartment: key,
      extraRows: extraCols.map((_, i) => ({ row: catRowNums[4 + i], net: cats[4 + i].net, ord: cats[4 + i].ord })),
      regRow: catRowNums[0],
      asRow: catRowNums[1],
      cladRow: catRowNums[2],
      panRow: catRowNums[3],
      netReg: cats[0].net,
      ordReg: cats[0].ord,
      netAs: cats[1].net,
      ordAs: cats[1].ord,
      netClad: cats[2].net,
      ordClad: cats[2].ord,
      netPan: cats[3].net,
      ordPan: cats[3].ord,
    });

    dataSheet.addRow([]);
  }

  // ---- Summary sheet: one row per apartment, referencing the data sheet's totals ----
  const summaryHeader = summarySheet.addRow(summaryHeaders);
  summaryHeader.eachCell({ includeEmpty: true }, (c) => {
    setFill(c, C_HEADER);
    c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const REF = sheetRef(dataSheetName);
  for (const t of apartmentTotals) {
    const row = summarySheet.addRow([t.apartment, ...new Array(summaryLastCol - 1).fill(null)]);
    const rn = row.number;
    row.getCell(2).value = { formula: `${REF}B${t.regRow}`, result: t.netReg };
    row.getCell(3).value = { formula: `${REF}D${t.regRow}`, result: t.ordReg };
    row.getCell(4).value = { formula: `${REF}B${t.asRow}`, result: t.netAs };
    row.getCell(5).value = { formula: `${REF}D${t.asRow}`, result: t.ordAs };
    row.getCell(6).value = { formula: `${REF}B${t.cladRow}`, result: t.netClad };
    row.getCell(7).value = { formula: `${REF}D${t.cladRow}`, result: t.ordClad };
    row.getCell(8).value = { formula: `${REF}B${t.panRow}`, result: t.netPan };
    row.getCell(9).value = { formula: `${REF}D${t.panRow}`, result: t.ordPan };
    t.extraRows.forEach((x, i) => {
      row.getCell(10 + i * 2).value = { formula: `${REF}B${x.row}`, result: x.net };
      row.getCell(11 + i * 2).value = { formula: `${REF}D${x.row}`, result: x.ord };
    });

    const argb = rn % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B;
    row.eachCell({ includeEmpty: true }, (c) => setFill(c, argb));
    for (let ci = 2; ci <= summaryLastCol; ci++) {
      row.getCell(ci).numFmt = NUM_FMT;
      row.getCell(ci).alignment = { horizontal: 'center' };
    }
  }

  if (apartmentTotals.length > 0) {
    const firstSumRow = summaryHeader.number + 1;
    const lastSumRow = summarySheet.rowCount;
    // Cached grand-total results (col order B..I), computed directly from the per-apartment aggregates.
    const grandOrder = [
      round2(apartmentTotals.reduce((a, t) => a + t.netReg, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.ordReg, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.netAs, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.ordAs, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.netClad, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.ordClad, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.netPan, 0)),
      round2(apartmentTotals.reduce((a, t) => a + t.ordPan, 0)),
      ...extras.flatMap((_, i) => [
        round2(apartmentTotals.reduce((a, t) => a + t.extraRows[i].net, 0)),
        round2(apartmentTotals.reduce((a, t) => a + t.extraRows[i].ord, 0)),
      ]),
    ];

    const grand = summarySheet.addRow([t('exports.excel.summaryGrandTotal'), ...new Array(summaryLastCol - 1).fill(null)]);
    for (let ci = 2; ci <= summaryLastCol; ci++) {
      const col = colLetter(ci); // B..I, then the extra categories
      grand.getCell(ci).value = {
        formula: `ROUND(SUM(${col}${firstSumRow}:${col}${lastSumRow}),2)`,
        result: grandOrder[ci - 2],
      };
      grand.getCell(ci).numFmt = NUM_FMT;
      grand.getCell(ci).alignment = { horizontal: 'center' };
    }
    grand.eachCell({ includeEmpty: true }, (c) => {
      setFill(c, C_GRAND);
      c.font = { bold: true };
    });
  }

  // Say plainly that the totals above are missing whatever could not be calculated.
  const uncalibratedRooms = summaries.filter((s) => !s.pageCalibrated);
  if (uncalibratedRooms.length > 0) {
    summarySheet.addRow([]);
    const note = summarySheet.addRow([
      t('exports.excel.uncalibratedNote', {
        count: uncalibratedRooms.length,
        rooms: uncalibratedRooms.map((s) => s.roomName || t('exports.common.unnamedRoom')).join(', '),
      }),
    ]);
    note.getCell(1).font = { bold: true, color: { argb: 'FF92400E' } };
  }
  }

  addOpeningDeductionSheet(workbook, summaries, x);

  if (areaMeasurements.length > 0) {
    addAreaMeasurementSheet(workbook, areaMeasurements, x);
  }

  if (structural) addStructuralSheets(workbook, structural, x);

  return workbook;
}
