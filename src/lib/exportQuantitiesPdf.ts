import { PDFDocument } from 'pdf-lib';
import { drawLogo, embedReportFonts, logoWidth, PdfPainter, REPORT_LOGO_HEIGHT, type ReportFonts } from './pdfText';
import { saveAs } from 'file-saver';
import type { Plan, ReportCategoryTotal, RoomQuantitySummary } from '../types';
import { DEFAULT_AREA_KIND_COLORS } from '../types';
import type { Language } from '../i18n';
import { exportContext, type ExportContext } from './exportLanguage';
import { labelDirection } from './textDirection';
import { loadPdfPlanSource } from './planSource';
import { loadPdfBlob } from '../db/database';
import {
  groupSummariesByApartment,
  openingAreaM2,
  openingCountsText,
  roomOpeningDetails,
  usedReportCategories,
} from './quantities';
import { categoryPrimaryUnit, roomCategoryQuantity } from './projectQuantities';
import { polygonCentroid } from './geometry';
import { drawMarkupOnCanvas, orderMarkups } from './drawMarkup';
import { drawMeasurementOnCanvas } from './drawMeasurement';
import { numberAreaMeasurements } from './areaMeasurements';
import { drawAreaMeasurementTable } from './areaMeasurementTable';
import { drawStructuralPdfPages } from './exportStructuralPdf';
import { buildStructuralReport } from './structuralQuantities';
import { concreteOf, rebarOf, structuralPageNumbers } from './structuralPlan';
import { drawConcreteZonesOnCanvas, drawRebarZonesOnCanvas } from './drawStructuralZones';
import type { OverlayVisibility } from './overlayVisibility';
import type { ExportContent } from './exportContent';

const DASH = '-';
const FONT = "'Segoe UI', sans-serif";

// Same palette as the Excel export, for a consistent look across formats.
const C_HEADER = '#1F4E79';
const C_ZEBRA_A = '#EBF5FB';
const C_ZEBRA_B = '#FDFEFE';
const C_WET = '#FEF9E7';
const C_BALCONY = '#EAFAF1';
const C_TOTAL = '#D6E4F0';
const C_TOTAL_HDR = '#A9C4D9';
const C_GRAND = '#D5F5E3';
const C_BORDER = '#E2E8F0';
/** Column boundaries: a firmer line where a work-type group starts, and inside the blue header. */
const C_GROUP_LINE = '#B4C2D0';
const C_HEADER_LINE = '#4B739A';
/** Secondary line under a number (waste, m², deductions), and cells with nothing to say. */
const C_SUB = '#64748B';
const C_NONE = '#A0AEC0';
const C_WARN = '#92400E';

/**
 * Concrete and rebar zones of one page on the export canvas, each only when its View switch is on.
 * Lightweight outlines with their mark and notation - never individual bars or mesh sheets.
 */
export function drawStructuralOverlays(
  ctx: CanvasRenderingContext2D,
  project: Plan,
  pageNumber: number,
  mult: number,
  headerH: number,
  overlays: OverlayVisibility,
  language: Language
) {
  if (overlays.concrete) {
    const elements = concreteOf(project).filter((e) => e.pageNumber === pageNumber);
    if (elements.length > 0) drawConcreteZonesOnCanvas(ctx, elements, mult, headerH, exportContext(language));
  }
  if (overlays.rebar) {
    const meshes = rebarOf(project).filter((i): i is Extract<typeof i, { kind: 'mesh' }> => i.kind === 'mesh' && i.pageNumber === pageNumber);
    if (meshes.length > 0) drawRebarZonesOnCanvas(ctx, meshes, mult, headerH, exportContext(language));
  }
}

/**
 * Renders one PDF-source page (the plan itself) with its rooms overlaid, as a standalone framed
 * image. The header band on top is left blank: its title and date are drawn as vector text by the
 * caller, so only the plan and its annotations are raster.
 */
async function renderFramedPlanPage(
  project: Plan,
  pageNumber: number,
  mult: number,
  overlays: OverlayVisibility,
  areaNumbers: Map<string, number>,
  language: Language
): Promise<{ dataUrl: string; width: number; height: number; headerH: number } | null> {
  let source;
  try {
    ({ source } = await loadPdfPlanSource(project.id, () => loadPdfBlob(project.id), pageNumber));
  } catch {
    return null;
  }
  const planCanvas = document.createElement('canvas');
  const handle = source.render(planCanvas, mult);
  await handle.promise;

  const headerH = 60 * mult;
  const canvas = document.createElement('canvas');
  canvas.width = planCanvas.width;
  canvas.height = planCanvas.height + headerH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  ctx.drawImage(planCanvas, 0, headerH);

  if (overlays.finishes) {
    const rooms = project.rooms.filter((r) => r.pageNumber === pageNumber && r.points.length >= 3);
    for (const r of rooms) {
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const x = p.x * mult;
        const y = p.y * mult + headerH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = r.color;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 * mult;
      ctx.stroke();

      const centroid = polygonCentroid(r.points);
      const labelX = centroid.x * mult;
      const labelY = centroid.y * mult + headerH;
      ctx.font = `bold ${10.5 * mult}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * mult;
      ctx.strokeStyle = '#ffffff';
      // A room's name is the user's own text: it keeps its own direction (Hebrew exports: RTL as ever).
      ctx.direction = labelDirection(r.name, language);
      ctx.strokeText(r.name, labelX, labelY);
      ctx.fillStyle = r.color;
      ctx.fillText(r.name, labelX, labelY);
      ctx.direction = 'rtl';
      ctx.textBaseline = 'alphabetic';
    }
  }

  drawStructuralOverlays(ctx, project, pageNumber, mult, headerH, overlays, language);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';

  if (overlays.measurements) {
    const areaKindColors = project.areaKindColors ?? DEFAULT_AREA_KIND_COLORS;
    const measurements = (project.measurements ?? []).filter((m) => m.pageNumber === pageNumber);
    if (measurements.length > 0) {
      ctx.save();
      ctx.translate(0, headerH);
      for (const m of measurements) {
        drawMeasurementOnCanvas(ctx, m, mult, 0, 0, language, m.areaKind ? areaKindColors[m.areaKind] : undefined, areaNumbers.get(m.id));
      }
      ctx.restore();
    }
  }

  if (overlays.markups) {
    const markups = (project.markups ?? []).filter((m) => m.pageNumber === pageNumber);
    if (markups.length > 0) {
      ctx.save();
      ctx.translate(0, headerH);
      for (const m of orderMarkups(markups)) drawMarkupOnCanvas(ctx, m, mult, 0, 0);
      ctx.restore();
    }
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, headerH };
}

/** Appends the printable quantities-table pages to `doc` as vector pages (real text and table lines). */
function drawQuantityTablePages(
  doc: PDFDocument,
  fonts: ReportFonts,
  project: Plan,
  summaries: RoomQuantitySummary[],
  totals: ReportCategoryTotal[],
  x: ExportContext
): void {
  const { t } = x;
  const PAGE_W = 1600;
  const PAGE_H = 1132;
  const MARGIN = 40;
  const GROUP_ROW_H = 28;
  const SUB_ROW_H = 26;
  /** Data rows hold two lines: the number, and under it what explains it. */
  const ROW_H = 40;
  /** Totals and openings blocks: one line per row. */
  const BLOCK_ROW_H = 30;
  const usableWidth = PAGE_W - MARGIN * 2;
  const right = PAGE_W - MARGIN;
  // Everything is laid out from the reading start — the right margin for RTL, the left for LTR.
  const sign = x.rtl ? -1 : 1;
  const startX = x.rtl ? right : MARGIN;
  const textAlign = x.rtl ? 'right' : 'left';
  /** The side of the page the report's logo goes on: the one the title does not start from. */
  const logoX = x.rtl ? MARGIN : right - logoWidth(REPORT_LOGO_HEIGHT);

  // The same hierarchy as the on-screen table: identity, then one group per work type the plan uses
  // (net · to order, waste and the skirting m² under the numbers), then the room's openings and notes.
  const categories = usedReportCategories(summaries);
  const roomsById = new Map(project.rooms.map((r) => [r.id, r]));
  interface Column {
    header: string;
    weight: number;
    /** First column of a header group — drawn with a firmer boundary. */
    groupStart?: boolean;
    /** Text columns read from the RTL start; numbers are centred. */
    text?: boolean;
  }
  const columns: Column[] = [
    // 'Apartment' is a longer word than the Hebrew 'דירה', so the English column is a little wider.
    { header: t('exports.common.apartment'), weight: x.rtl ? 7 : 10 },
    { header: t('exports.common.room'), weight: 16, text: true },
    ...categories.flatMap((): Column[] => [
      { header: t('exports.quantityPdf.columns.net'), weight: 11, groupStart: true },
      { header: t('exports.quantityPdf.columns.order'), weight: 11 },
    ]),
    { header: t('exports.quantityPdf.columns.openings'), weight: 16, groupStart: true, text: true },
    { header: t('exports.common.notes'), weight: 18, text: true },
  ];
  const totalWeight = columns.reduce((a, c) => a + c.weight, 0);
  const colWidths = columns.map((c) => (usableWidth * c.weight) / totalWeight);
  /** x of each column's start edge (right for RTL, left for LTR). */
  const colStart = colWidths.map((_, i) => startX + sign * colWidths.slice(0, i).reduce((a, b) => a + b, 0));

  let pt!: PdfPainter;
  let y = 0;

  const verticals = (top: number, height: number, soft: string, firm: string) => {
    for (let i = 1; i < columns.length; i++) {
      const lx = colStart[i];
      pt.line(lx, top, lx, top + height, columns[i].groupStart ? firm : soft);
    }
  };

  const drawColumnHeader = () => {
    const top = y;
    const h = GROUP_ROW_H + SUB_ROW_H;
    pt.fillRect(MARGIN, top, usableWidth, h, C_HEADER);
    const headerText = (text: string, edge: number, w: number, baseline: number, size: number) =>
      pt.fillText(text, edge + (sign * w) / 2, baseline, { size, bold: true, color: '#ffffff', align: 'center', maxWidth: w - 8 });
    // Apartment and room span both header rows.
    headerText(columns[0].header, colStart[0], colWidths[0], top + h / 2 + 5, 12.5);
    headerText(columns[1].header, colStart[1], colWidths[1], top + h / 2 + 5, 12.5);
    // Group labels over each pair of columns.
    const groups = [
      ...categories.map((c) => t('exports.quantityPdf.categoryWithUnit', { label: t(`reportCategories.${c}`), unit: categoryPrimaryUnit(c, t) })),
      t('exports.quantityPdf.columns.details'),
    ];
    groups.forEach((label, g) => {
      const i = 2 + g * 2;
      headerText(label, colStart[i], colWidths[i] + colWidths[i + 1], top + GROUP_ROW_H / 2 + 5, 12.5);
    });
    for (let i = 2; i < columns.length; i++) {
      headerText(columns[i].header, colStart[i], colWidths[i], top + GROUP_ROW_H + SUB_ROW_H / 2 + 4, 11);
    }
    // The line under the group labels stops short of the two identity columns they do not cover.
    pt.line(x.rtl ? MARGIN : colStart[2], top + GROUP_ROW_H, x.rtl ? colStart[2] : right, top + GROUP_ROW_H, C_HEADER_LINE);
    for (let i = 1; i < columns.length; i++) {
      const lx = colStart[i];
      // Inside a group, the boundary only runs through the lower header row.
      const from = columns[i].groupStart || i === 2 || i === 1 ? top : top + GROUP_ROW_H;
      pt.line(lx, from, lx, top + h, C_HEADER_LINE);
    }
    y += h;
  };

  const newPage = (withColumnHeader: boolean) => {
    pt = new PdfPainter(doc.addPage([PAGE_W, PAGE_H]), fonts, x.direction);
    // Condensed to the room before the logo, so a long project/plan name never runs under it.
    pt.fillText(t('exports.quantityPdf.title', { name: project.name }), startX, 40, { size: 20, bold: true, color: '#0f172a', maxWidth: PAGE_W - MARGIN * 2 - logoWidth(REPORT_LOGO_HEIGHT) - 24 });
    drawLogo(pt, logoX, 28, REPORT_LOGO_HEIGHT);
    pt.fillText(x.today(), startX, 60, { size: 12, color: '#8b8f99' });
    y = 84;
    if (withColumnHeader) drawColumnHeader();
  };
  /** Starts a new page when `height` does not fit. Room rows repeat the column header; blocks bring their own. */
  const ensure = (height: number, withColumnHeader: boolean) => {
    if (y + height > PAGE_H - MARGIN) newPage(withColumnHeader);
  };

  interface Cell {
    main: string;
    sub?: string;
    color?: string;
  }
  /**
   * Splits a text cell into at most two lines that fit `width`; whatever still does not fit ends in
   * an ellipsis. Keeps long room names and notes readable instead of condensing them to a smear.
   */
  const wrapTwoLines = (text: string, size: number, width: number, bold: boolean): string[] => {
    if (pt.measure(text, size, bold) <= width) return [text];
    const words = text.split(/\s+/);
    let first = '';
    let i = 0;
    for (; i < words.length; i++) {
      const next = first ? `${first} ${words[i]}` : words[i];
      if (first && pt.measure(next, size, bold) > width) break;
      first = next;
    }
    let second = words.slice(i).join(' ');
    if (second && pt.measure(second, size, bold) > width) {
      while (second.length > 1 && pt.measure(`${second}…`, size, bold) > width) second = second.slice(0, -1).trimEnd();
      second = `${second}…`;
    }
    return second ? [first, second] : [first];
  };

  const drawRoomRow = (cells: Cell[], bg: string) => {
    pt.fillRect(MARGIN, y, usableWidth, ROW_H, bg);
    pt.strokeRect(MARGIN, y, usableWidth, ROW_H, C_BORDER);
    verticals(y, ROW_H, C_BORDER, C_GROUP_LINE);
    cells.forEach((cell, i) => {
      const w = colWidths[i];
      const text = columns[i].text;
      const cx = text ? colStart[i] + sign * 6 : colStart[i] + (sign * w) / 2;
      const align = text ? textAlign : 'center';
      const bold = i === 1;
      if (text && !cell.sub) {
        const lines = wrapTwoLines(cell.main, 11.5, w - 12, bold);
        if (lines.length === 2) {
          lines.forEach((line, l) => pt.fillText(line, cx, y + 17 + l * 14, { size: 11.5, color: cell.color, align, maxWidth: w - 12, bold }));
          return;
        }
      }
      const mainBaseline = cell.sub ? y + 17 : y + ROW_H / 2 + 4;
      pt.fillText(cell.main, cx, mainBaseline, { size: 12, color: cell.color, align, maxWidth: w - 12, bold });
      if (cell.sub) pt.fillText(cell.sub, cx, y + 32, { size: 9.5, color: C_SUB, align, maxWidth: w - 12 });
    });
    y += ROW_H;
  };

  /**
   * A self-contained block table (totals, openings): its own columns, right-aligned at the RTL
   * start, `widthFraction` of the page. `title` is a full-width band over it.
   */
  const drawBlock = (
    title: { text: string; bg: string } | null,
    headers: string[],
    weights: number[],
    rows: { cells: string[]; bg: string; bold?: boolean }[],
    widthFraction: number,
    /** Leading columns that hold labels (read from the RTL start); the rest are centred values. */
    labelColumns = 1
  ) => {
    const width = usableWidth * widthFraction;
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (width * w) / sum);
    const blockLeft = x.rtl ? right - width : MARGIN;
    const drawLine = (cells: string[], bg: string, bold: boolean, color = '#1e293b') => {
      pt.fillRect(blockLeft, y, width, BLOCK_ROW_H, bg);
      pt.strokeRect(blockLeft, y, width, BLOCK_ROW_H, C_BORDER);
      let edge = startX;
      cells.forEach((cell, i) => {
        const w = widths[i];
        if (i > 0) pt.line(edge, y, edge, y + BLOCK_ROW_H, C_BORDER);
        if (i < labelColumns) pt.fillText(cell, edge + sign * 8, y + BLOCK_ROW_H / 2 + 4, { size: 12, bold, color, maxWidth: w - 14 });
        else pt.fillText(cell, edge + (sign * w) / 2, y + BLOCK_ROW_H / 2 + 4, { size: 12, bold, color, align: 'center', maxWidth: w - 8 });
        edge += sign * w;
      });
      y += BLOCK_ROW_H;
    };
    const header = () => drawLine(headers, C_TOTAL_HDR, true);
    ensure(BLOCK_ROW_H * ((title ? 1 : 0) + 1 + Math.min(rows.length, 3)), false);
    if (title) {
      pt.fillRect(blockLeft, y, width, BLOCK_ROW_H, title.bg);
      pt.fillText(title.text, startX + sign * 8, y + BLOCK_ROW_H / 2 + 4, { size: 12.5, bold: true, color: '#0f172a' });
      y += BLOCK_ROW_H;
    }
    header();
    for (const row of rows) {
      if (y + BLOCK_ROW_H > PAGE_H - MARGIN) {
        newPage(false);
        header();
      }
      drawLine(row.cells, row.bg, !!row.bold);
    }
    y += BLOCK_ROW_H * 0.5;
  };

  /** Printed in quantity cells of a room whose page has no scale, so 0 is never implied. */
  const notCalibrated = t('exports.common.notCalibrated');
  const num = (v: number | null) => (v == null ? DASH : `${v}`);
  const r2 = (v: number) => `${Math.round(v * 100) / 100}`;

  const roomCells = (s: RoomQuantitySummary): Cell[] => {
    const openings = roomsById.get(s.roomId)?.openings ?? [];
    const openingsText = openingCountsText(openings, t);
    const openingsArea = Math.round(openings.reduce((sum, o) => sum + openingAreaM2(o), 0) * 100) / 100;
    return [
      { main: s.apartmentNumber || DASH },
      { main: s.roomName },
      ...categories.flatMap((c): Cell[] => {
        const q = roomCategoryQuantity(s, c);
        if (q.wastePercent == null) return [{ main: DASH, color: C_NONE }, { main: DASH, color: C_NONE }];
        const waste = t('exports.quantityPdf.waste', { percent: q.wastePercent });
        // No scale: say why the cell is empty instead of printing 0.
        if (!s.pageCalibrated) return [{ main: notCalibrated, color: C_WARN }, { main: notCalibrated, sub: waste, color: C_WARN }];
        if (c === 'panels') {
          const doors =
            (s.panelsDeductedLengthM ?? 0) > 0 ? ` · ${t('exports.quantityPdf.doorsDeducted', { length: s.panelsDeductedLengthM! })}` : '';
          return [
            { main: num(q.lengthM), sub: `${num(q.quantityM2)} ${t('units.m2')}${doors}` },
            { main: num(q.orderLengthM), sub: `${waste} · ${num(q.orderM2)} ${t('units.m2')}` },
          ];
        }
        const deduction = s.openingDeductions.find((d) => d.category === c);
        return [
          { main: num(q.quantityM2), sub: deduction ? t('exports.quantityPdf.openingsDeducted', { amount: deduction.deductedM2 }) : undefined },
          { main: num(q.orderM2), sub: waste },
        ];
      }),
      openingsText ? { main: openingsText, sub: `${openingsArea} ${t('units.m2')}` } : { main: DASH, color: C_NONE },
      { main: s.notes || DASH, color: s.notes ? undefined : C_NONE },
    ];
  };

  newPage(true);
  const groups = groupSummariesByApartment(summaries);
  for (const group of groups) {
    group.rooms.forEach((s, i) => {
      ensure(ROW_H, true);
      const bg = s.claddingAreaM2 != null ? C_WET : s.tilingAsAreaM2 != null ? C_BALCONY : i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B;
      drawRoomRow(roomCells(s), bg);
    });

    // Only the work types this apartment's rooms actually have — no rows of zeros.
    const cats = usedReportCategories(group.rooms).map((c) => {
      const amounts = group.rooms.map((s) => roomCategoryQuantity(s, c));
      const sum = (pick: (q: (typeof amounts)[number]) => number | null) => amounts.reduce((a, q) => a + (pick(q) ?? 0), 0);
      const linear = c === 'panels';
      return {
        label: t(`reportCategories.${c}`),
        net: sum((q) => q.quantityM2),
        ord: sum((q) => q.orderM2),
        len: linear ? sum((q) => q.lengthM) : null,
        ordLen: linear ? sum((q) => q.orderLengthM) : null,
      };
    });
    if (cats.length === 0) continue;
    y += BLOCK_ROW_H * 0.3;
    drawBlock(
      { text: t('exports.quantityPdf.apartmentTotal', { apartment: group.apartment || DASH }), bg: C_TOTAL },
      [
        t('exports.common.item'),
        t('exports.quantityPdf.totalsHeaders.length'),
        t('exports.quantityPdf.totalsHeaders.net'),
        t('exports.quantityPdf.totalsHeaders.orderLength'),
        t('exports.quantityPdf.totalsHeaders.order'),
      ],
      [18, 12, 12, 13, 12],
      cats.map((cat) => ({
        cells: [cat.label, cat.len == null ? '' : r2(cat.len), r2(cat.net), cat.ordLen == null ? '' : r2(cat.ordLen), r2(cat.ord)],
        bg: C_TOTAL,
      })),
      0.6
    );
  }

  // Grand totals.
  drawBlock(
    { text: t('exports.quantityPdf.grandTotal'), bg: C_GRAND },
    [
      t('exports.common.item'),
      t('exports.quantityPdf.totalsHeaders.length'),
      t('exports.quantityPdf.totalsHeaders.net'),
      t('exports.quantityPdf.totalsHeaders.waste'),
      t('exports.quantityPdf.totalsHeaders.orderLength'),
      t('exports.quantityPdf.totalsHeaders.order'),
    ],
    [18, 12, 12, 9, 13, 12],
    totals.map((total) => ({
      cells: [
        t(`reportCategories.${total.category}`),
        total.lengthM == null ? '' : `${total.lengthM}`,
        `${total.quantityM2}`,
        `${total.wastePercent}%`,
        total.orderLengthM == null ? '' : `${total.orderLengthM}`,
        `${total.orderM2}`,
      ],
      bg: C_GRAND,
      bold: false,
    })),
    0.6
  );

  // Openings: which doors, windows and other openings each room has, and which of its work they
  // were taken off. Only what the room stores — type, size, count; no wall position is recorded,
  // so none is printed. A plan without openings prints no such block at all.
  const openingRows = summaries.flatMap((s) => {
    const room = roomsById.get(s.roomId);
    return room ? roomOpeningDetails(room).map((d) => ({ s, d })) : [];
  });
  if (openingRows.length > 0) {
    drawBlock(
      { text: t('exports.quantityPdf.openingsBlock'), bg: C_TOTAL },
      [
        t('exports.common.apartment'),
        t('exports.common.room'),
        t('exports.quantityPdf.openingHeaders.type'),
        t('exports.quantityPdf.openingHeaders.width'),
        t('exports.quantityPdf.openingHeaders.height'),
        t('exports.quantityPdf.openingHeaders.quantity'),
        t('exports.quantityPdf.openingHeaders.area'),
        t('exports.quantityPdf.openingHeaders.deductedFrom'),
      ],
      [7, 16, 10, 8, 8, 6, 9, 26],
      openingRows.map(({ s, d }, i) => ({
        cells: [
          s.apartmentNumber || DASH,
          s.roomName,
          t(`openingTypes.${d.opening.type}`),
          num(d.opening.widthM),
          num(d.opening.heightM),
          num(d.opening.quantity),
          `${d.areaM2}`,
          d.deductedFrom.length === 0
            ? t('exports.quantityPdf.notDeducted')
            : d.deductedFrom.map((c) => (c === 'panels' ? t('exports.quantityPdf.panelsWidth') : t(`reportCategories.${c}`))).join(', '),
        ],
        bg: i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B,
      })),
      1,
      2
    );
  }

  // Gross − openings = net per room and work type, only where something was actually deducted.
  const deductionRows = summaries.flatMap((s) => [
    ...s.openingDeductions.map((d) => ({
      s,
      label: t(`reportCategories.${d.category}`),
      gross: d.grossM2,
      deducted: d.deductedM2,
      net: d.netM2,
      unit: t('units.m2'),
    })),
    ...(s.panelsLengthM != null && (s.panelsDeductedLengthM ?? 0) > 0
      ? [
          {
            s,
            label: t('reportCategories.panels'),
            gross: Math.round((s.panelsLengthM + s.panelsDeductedLengthM!) * 100) / 100,
            deducted: s.panelsDeductedLengthM!,
            net: s.panelsLengthM,
            unit: t('units.lm'),
          },
        ]
      : []),
  ]);
  if (deductionRows.length > 0) {
    drawBlock(
      { text: t('exports.quantityPdf.deductionsBlock'), bg: C_TOTAL },
      [
        t('exports.common.apartment'),
        t('exports.common.room'),
        t('exports.quantityPdf.deductionHeaders.workType'),
        t('exports.quantityPdf.deductionHeaders.gross'),
        t('exports.quantityPdf.deductionHeaders.deducted'),
        t('exports.quantityPdf.deductionHeaders.net'),
        t('exports.quantityPdf.deductionHeaders.unit'),
      ],
      [7, 16, 12, 10, 10, 10, 7],
      deductionRows.map((r, i) => ({
        cells: [r.s.apartmentNumber || DASH, r.s.roomName, r.label, `${r.gross}`, `${r.deducted}`, `${r.net}`, r.unit],
        bg: i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B,
      })),
      0.8,
      2
    );
    ensure(BLOCK_ROW_H, false);
    pt.fillText(
      t('exports.quantityPdf.deductionNote'),
      startX,
      y + 8,
      { size: 11, color: C_SUB }
    );
    y += BLOCK_ROW_H;
  }

  // Say plainly that rooms which could not be calculated are missing from those totals.
  const uncalibratedCount = summaries.filter((s) => !s.pageCalibrated).length;
  if (uncalibratedCount > 0) {
    ensure(BLOCK_ROW_H, false);
    pt.fillRect(MARGIN, y, usableWidth, BLOCK_ROW_H, C_TOTAL_HDR);
    pt.fillText(t('exports.quantityPdf.uncalibratedNote', { count: uncalibratedCount }), startX + sign * 8, y + BLOCK_ROW_H / 2 + 4, {
      size: 12,
      bold: true,
      color: '#92400e',
    });
    y += BLOCK_ROW_H;
  }
}

/** Page numbers with any exportable content (rooms, markups, or measurements), sorted ascending. */
export function getExportablePageNumbers(project: Plan): number[] {
  return Array.from(
    new Set([
      ...project.rooms.map((r) => r.pageNumber),
      ...(project.markups ?? []).map((m) => m.pageNumber),
      ...(project.measurements ?? []).map((m) => m.pageNumber),
      // A page that carries only concrete or rebar is a page of the report too.
      ...structuralPageNumbers(project),
    ])
  ).sort((a, b) => a - b);
}

/**
 * The plan PDF: the chosen sections, always in one order - plan pages with their overlays, the
 * finishes quantities, the concrete BOQ, the rebar BOQ. `overlays` (the View menu state) decides what
 * is drawn on the plan pages only; the quantity sections never depend on it. `pageNumbers` filters
 * pages for every section.
 */
export async function exportQuantitiesToPdf(
  project: Plan,
  summaries: RoomQuantitySummary[],
  totals: ReportCategoryTotal[],
  overlays: OverlayVisibility,
  pageNumbers: number[] | undefined,
  content: ExportContent,
  language: Language
) {
  const x = exportContext(language);
  const { t } = x;
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedReportFonts(pdfDoc);
  const mult = 2;

  const allAreaMeasurements = (project.measurements ?? []).filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const pagesInScope = getExportablePageNumbers(project).filter((p) => !pageNumbers || pageNumbers.includes(p));
  const areaTablesOf = (pageNumber: number) => allAreaMeasurements.filter((m) => m.pageNumber === pageNumber);

  // 1. Plan pages with the overlays the View menu shows.
  if (content.plan) {
    for (const pageNumber of pagesInScope) {
      // Each page's area measurements are numbered independently, so the badges match the Finishes table.
      const framed = await renderFramedPlanPage(project, pageNumber, mult, overlays, numberAreaMeasurements(areaTablesOf(pageNumber)), language);
      if (!framed) continue;
      const pngBytes = await fetch(framed.dataUrl).then((r) => r.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.addPage([framed.width, framed.height]);
      page.drawImage(pngImage, { x: 0, y: 0, width: framed.width, height: framed.height });
      // The header band's text, as real text over the image's blank band (same place and sizes the
      // raster header used).
      const pt = new PdfPainter(page, fonts, x.direction);
      const headerStart = x.rtl ? framed.width - 16 * mult : 16 * mult;
      pt.fillText(project.name, headerStart, 26 * mult, {
        size: 18 * mult,
        bold: true,
        color: '#0f172a',
        maxWidth: framed.width - 32 * mult - logoWidth(REPORT_LOGO_HEIGHT * mult) - 24 * mult,
      });
      pt.fillText(t('exports.quantityPdf.planPageHeader', { page: pageNumber, date: x.today() }), headerStart, 46 * mult, {
        size: 12 * mult,
        color: '#8b8f99',
      });
      drawLogo(pt, x.rtl ? 16 * mult : framed.width - 16 * mult - logoWidth(REPORT_LOGO_HEIGHT * mult), 14 * mult, REPORT_LOGO_HEIGHT * mult);
    }
  }

  // 2. Finishes quantities: the area breakdown per page, then the room table.
  if (content.finishes) {
    for (const pageNumber of pagesInScope) {
      const pageAreas = areaTablesOf(pageNumber);
      if (pageAreas.length > 0) drawAreaMeasurementTable(pdfDoc, fonts, t('exports.quantityPdf.planPageTitle', { name: project.name, page: pageNumber }), pageAreas, { showLogo: true }, language);
    }
    if (summaries.length > 0) drawQuantityTablePages(pdfDoc, fonts, project, summaries, totals, x);
  }

  // 3-4. Concrete and rebar: one BOQ each (items, then a total row), independent of the View menu.
  if (content.concrete || content.rebar) {
    drawStructuralPdfPages(pdfDoc, fonts, project.name, buildStructuralReport(project, pageNumbers ? new Set(pageNumbers) : undefined), language, {
      concrete: content.concrete,
      rebar: content.rebar,
    });
  }

  // A selection that matches nothing on the chosen pages would save an empty file.
  if (pdfDoc.getPageCount() === 0) throw new Error('The selected content has nothing to export on the selected pages.');

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, t('exports.quantityPdf.fileName', { name: safeName }));
}
