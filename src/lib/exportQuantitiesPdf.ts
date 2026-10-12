import { ReportWriter } from './pdfReportWriter';
import { openingPdfSchedule, type OpeningPdfOptions } from './openingQuantityReport';
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
import { polygonCentroid } from './geometry';
import { drawMarkupOnCanvas, orderMarkups } from './drawMarkup';
import { drawMeasurementOnCanvas } from './drawMeasurement';
import { numberAreaMeasurements } from './areaMeasurements';
import { areaMeasurementTableRows } from './areaMeasurementTable';
import { buildStructuralReport } from './structuralQuantities';
import { buildStructuralPdfLayout, writeBlocks } from './structuralPdfLayout';
import { concreteOf, rebarOf, structuralPageNumbers } from './structuralPlan';
import { drawConcreteZonesOnCanvas, drawRebarZonesOnCanvas } from './drawStructuralZones';
import { writeRoomSchedule } from './quantitySchedulePdf';
import type { OverlayVisibility } from './overlayVisibility';
import type { ExportContent } from './exportContent';
import { pdfDrawingPages, type PdfDrawingOptions } from './pdfDrawingLayers';

export interface QuantityPdfOptions extends OpeningPdfOptions, PdfDrawingOptions {}

const FONT = "'Segoe UI', sans-serif";

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
    const items = rebarOf(project).filter((i) => i.kind === 'stirrup' ? i.placements.some((p) => p.pageNumber === pageNumber) : i.pageNumber === pageNumber);
    if (items.length > 0) drawRebarZonesOnCanvas(ctx, items, mult, headerH, exportContext(language), project.pages[pageNumber]?.calibration ?? null, pageNumber, project.pages);
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

/** Page numbers with any exportable content (rooms, markups, or measurements), sorted ascending. */
export function getExportablePageNumbers(project: Plan): number[] {
  return Array.from(
    new Set([
      ...project.rooms.map((r) => r.pageNumber),
      ...(project.openings ?? []).map(o=>o.pageNumber),
      ...(project.markups ?? []).map((m) => m.pageNumber),
      ...(project.measurements ?? []).map((m) => m.pageNumber),
      // A page that carries only concrete or rebar is a page of the report too.
      ...structuralPageNumbers(project),
    ])
  ).sort((a, b) => a - b);
}

/**
 * Appends one image page per plan sheet (the plan with the overlays the View menu shows), with the
 * plan's name, sheet and date as vector text in the header band. Returns how many pages were added.
 */
export async function appendPlanDrawingPages(pdfDoc: PDFDocument, fonts: ReportFonts, project: Plan, pageNumbers: number[], overlays: OverlayVisibility, x: ExportContext, options: PdfDrawingOptions = {}): Promise<number> {
  const { t } = x;
  const mult = 2;
  const areaMeasurements = (project.measurements ?? []).filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  let added = 0;
  for (const pageNumber of pageNumbers) {
    for (const drawing of pdfDrawingPages(overlays, options)) {
    // Each page's area measurements are numbered independently, so the badges match the area table.
    const framed = await renderFramedPlanPage(project, pageNumber, mult, drawing.overlays, numberAreaMeasurements(areaMeasurements.filter((m) => m.pageNumber === pageNumber)), x.language);
    if (!framed) continue;
    const pngBytes = await fetch(framed.dataUrl).then((r) => r.arrayBuffer());
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([framed.width, framed.height]);
    page.drawImage(pngImage, { x: 0, y: 0, width: framed.width, height: framed.height });
    // The header band's text, as real text over the image's blank band.
    const pt = new PdfPainter(page, fonts, x.direction);
    const headerStart = x.rtl ? framed.width - 16 * mult : 16 * mult;
    pt.fillText(project.name, headerStart, 26 * mult, {
      size: 18 * mult,
      bold: true,
      color: '#0f172a',
      maxWidth: framed.width - 32 * mult - logoWidth(REPORT_LOGO_HEIGHT * mult) - 24 * mult,
    });
    const layerLabel = drawing.layer ? ` · ${t(`quantityExport.drawingLayers.${drawing.layer}`)}` : '';
    pt.fillText(t('exports.quantityPdf.planPageHeader', { page: pageNumber, date: x.today() }) + layerLabel, headerStart, 46 * mult, {
      size: 12 * mult,
      color: '#8b8f99',
    });
    drawLogo(pt, x.rtl ? 16 * mult : framed.width - 16 * mult - logoWidth(REPORT_LOGO_HEIGHT * mult), 14 * mult, REPORT_LOGO_HEIGHT * mult);
    added++;
    }
  }
  return added;
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
  /** Kept for callers; the schedule sums the same rounded room figures itself. */
  _totals: ReportCategoryTotal[],
  overlays: OverlayVisibility,
  pageNumbers: number[] | undefined,
  content: ExportContent,
  language: Language,
  options: QuantityPdfOptions = {}
) {
  const x = exportContext(language);
  const { t } = x;
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedReportFonts(pdfDoc);

  const allAreaMeasurements = (project.measurements ?? []).filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const pagesInScope = getExportablePageNumbers(project).filter((p) => !pageNumbers || pageNumbers.includes(p));

  // 1. Plan pages with the overlays the View menu shows.
  if (content.plan) await appendPlanDrawingPages(pdfDoc, fonts, project, pagesInScope, overlays, x, options);

  // 2. Everything else flows through one writer: no section starts its own page unless it has to.
  // A single-plan report: this plan's schedule only — never a project summary.
  let writer: ReportWriter | null = null;
  const w = () => (writer ??= new ReportWriter(pdfDoc, fonts, t('exports.quantityPdf.title', { name: project.name }), x.today(), x));

  if (content.finishes) {
    if (summaries.length > 0) {
      w().section(t('exports.quantityPdf.schedule.title'), 4);
      w().facts(t('exports.quantityPdf.schedule.planFacts', { rooms: summaries.length, sheets: pagesInScope.join(', ') }));
      writeRoomSchedule(w(), { plan: project, summaries }, x);
      // Say plainly that rooms which could not be calculated are missing from those totals.
      const uncalibrated = summaries.filter((s) => !s.pageCalibrated).length;
      if (uncalibrated > 0) w().note(t('exports.quantityPdf.uncalibratedNote', { count: uncalibrated }));
    }
    // Demolition / new construction areas, per sheet, in the same flow.
    for (const pageNumber of pagesInScope) {
      const pageAreas = allAreaMeasurements.filter((m) => m.pageNumber === pageNumber);
      if (pageAreas.length === 0) continue;
      const table = areaMeasurementTableRows(pageAreas, x);
      w().section(t('exports.quantityPdf.schedule.areaSection', { page: pageNumber }), 4);
      w().table(table.headers, table.weights, table.rows.map((row) => ({
        cells: row.cells,
        bold: row.kind !== 'row',
        bg: row.kind === 'grand' ? '#D5F5E3' : row.kind === 'subtotal' ? '#D6E4F0' : undefined,
      })));
    }
    const schedule = openingPdfSchedule([project], x, options, new Set(pagesInScope));
    if (schedule) {
      w().section(schedule.title, 4);
      w().table(schedule.headers, schedule.widths, schedule.rows.map((cells) => ({ cells })));
    }
  }

  // 3-4. Concrete and rebar: one BOQ each (items, then a total row), in the same flow.
  if (content.concrete || content.rebar) {
    const blocks = buildStructuralPdfLayout(buildStructuralReport(project, pageNumbers ? new Set(pageNumbers) : undefined), x, { concrete: content.concrete, rebar: content.rebar });
    if (blocks.length) writeBlocks(w(), blocks);
  }

  // A selection that matches nothing on the chosen pages would save an empty file.
  if (pdfDoc.getPageCount() === 0) throw new Error('The selected content has nothing to export on the selected sheets.');

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, t('exports.quantityPdf.fileName', { name: safeName }));
}
