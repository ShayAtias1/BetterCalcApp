import { PDFDocument } from 'pdf-lib';
import { stampExportNotice } from './legal/pdfExportNotice';
import { embedReportFonts } from './pdfText';
import { saveAs } from 'file-saver';
import type { ExportRegion, Plan } from '../types';
import { DEFAULT_AREA_KIND_COLORS } from '../types';
import { exportCoverageWarning, loadPlanDrawing } from './revision/backdrop';
import { polygonCentroid } from './geometry';
import { drawMarkupOnCanvas, orderMarkups } from './drawMarkup';
import { drawMeasurementOnCanvas } from './drawMeasurement';
import { numberAreaMeasurements } from './areaMeasurements';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';
import { labelDirection } from './textDirection';

const FONT = "'Segoe UI', sans-serif";

/**
 * Renders one plan page — optionally cropped to `region` — with its room markings and measurements
 * (each subject to its own visibility flag) onto a fresh canvas. `region` is in native page
 * coordinates; pass null for the whole page.
 */
async function renderRegionCanvas(
  project: Plan,
  pageNumber: number,
  region: ExportRegion | null,
  showMarkings: boolean,
  showMeasurements: boolean,
  language: Language
): Promise<HTMLCanvasElement | null> {
  const mult = 2;
  const source = await loadPlanDrawing(project, pageNumber);
  const planCanvas = document.createElement('canvas');
  const handle = source.render(planCanvas, mult);
  await handle.promise;

  const nativeW = planCanvas.width / mult;
  const nativeH = planCanvas.height / mult;
  const rx = region ? Math.max(0, Math.min(region.x, nativeW)) : 0;
  const ry = region ? Math.max(0, Math.min(region.y, nativeH)) : 0;
  const rw = region ? Math.max(0, Math.min(region.width, nativeW - rx)) : nativeW;
  const rh = region ? Math.max(0, Math.min(region.height, nativeH - ry)) : nativeH;
  if (rw <= 0 || rh <= 0) return null;

  // A revised drawing whose changes are not all in the quantities carries a banner above the plan.
  const warning = exportCoverageWarning(project, pageNumber);
  const bannerH = warning ? 28 * mult : 0;
  const canvas = document.createElement('canvas');
  canvas.width = rw * mult;
  canvas.height = rh * mult + bannerH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(planCanvas, rx * mult, ry * mult, rw * mult, rh * mult, 0, bannerH, rw * mult, rh * mult);
  if (warning) {
    ctx.fillStyle = '#fef2f2';
    ctx.fillRect(0, 0, canvas.width, bannerH);
    ctx.fillStyle = '#b91c1c';
    ctx.font = `bold ${11 * mult}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = language === 'he' ? 'right' : 'left';
    ctx.direction = language === 'he' ? 'rtl' : 'ltr';
    ctx.fillText(exportContext(language).t('exports.common.drawingPartial', { ...warning }), language === 'he' ? canvas.width - 8 * mult : 8 * mult, bannerH / 2, canvas.width - 16 * mult);
    ctx.direction = 'inherit';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'start';
    // Everything below is drawn in plan coordinates, below the banner.
    ctx.translate(0, bannerH);
  }

  if (showMarkings) {
    const rooms = project.rooms.filter((r) => r.pageNumber === pageNumber && r.points.length >= 3);
    for (const r of rooms) {
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const x = (p.x - rx) * mult;
        const y = (p.y - ry) * mult;
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
      const labelX = (centroid.x - rx) * mult;
      const labelY = (centroid.y - ry) * mult;
      ctx.font = `bold ${10.5 * mult}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * mult;
      ctx.strokeStyle = '#ffffff';
      // A room's name is the user's own text and keeps its own direction. The Hebrew export keeps the
      // canvas default it has always drawn these with.
      ctx.direction = language === 'he' ? 'inherit' : labelDirection(r.name, language);
      ctx.strokeText(r.name, labelX, labelY);
      ctx.fillStyle = r.color;
      ctx.fillText(r.name, labelX, labelY);
      ctx.direction = 'inherit';
      ctx.textBaseline = 'alphabetic';
    }
  }

  if (showMeasurements) {
    const areaKindColors = project.areaKindColors ?? DEFAULT_AREA_KIND_COLORS;
    const measurements = (project.measurements ?? []).filter((m) => m.pageNumber === pageNumber);
    const areaNumbers = numberAreaMeasurements(measurements);
    for (const m of measurements) {
      drawMeasurementOnCanvas(ctx, m, mult, rx, ry, language, m.areaKind ? areaKindColors[m.areaKind] : undefined, areaNumbers.get(m.id));
    }
  }

  if (showMarkings) {
    const markups = (project.markups ?? []).filter((m) => m.pageNumber === pageNumber);
    for (const m of orderMarkups(markups)) drawMarkupOnCanvas(ctx, m, mult, rx, ry);
  }

  return canvas;
}

async function addCanvasPage(pdfDoc: PDFDocument, canvas: HTMLCanvasElement) {
  const pngBytes = await fetch(canvas.toDataURL('image/png')).then((r) => r.arrayBuffer());
  const pngImage = await pdfDoc.embedPng(pngBytes);
  const page = pdfDoc.addPage([canvas.width, canvas.height]);
  page.drawImage(pngImage, { x: 0, y: 0, width: canvas.width, height: canvas.height });
}

async function savePdf(pdfDoc: PDFDocument, fileName: string, language: Language) {
  stampExportNotice(pdfDoc, await embedReportFonts(pdfDoc), language);
  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  saveAs(blob, fileName);
}

/**
 * Exports a single plan page as a standalone PDF — the plan image with its markings/measurements
 * (if visible), nothing else: no title block, no quantities table. Pass the page's export region
 * to crop to it, or null to export the whole page.
 */
export async function exportPlanPageToPdf(
  project: Plan,
  pageNumber: number,
  region: ExportRegion | null,
  showMarkings: boolean,
  showMeasurements: boolean,
  language: Language
) {
  const { t } = exportContext(language);
  const canvas = await renderRegionCanvas(project, pageNumber, region, showMarkings, showMeasurements, language);
  if (!canvas) return;
  const pdfDoc = await PDFDocument.create();
  await addCanvasPage(pdfDoc, canvas);
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  await savePdf(
    pdfDoc,
    region ? t('exports.planPdf.regionFileName', { name: safeName }) : t('exports.planPdf.pageFileName', { page: pageNumber, name: safeName }),
    language
  );
}

/**
 * Exports every plan page in one go as a single multi-page PDF — each page cropped to its own
 * export region when one was selected, and shown in full otherwise, so the user doesn't have to
 * pick a region and export page by page.
 */
export async function exportAllPlanPagesToPdf(
  project: Plan,
  numPages: number,
  exportRegions: Record<number, ExportRegion>,
  showMarkings: boolean,
  showMeasurements: boolean,
  language: Language
) {
  const { t } = exportContext(language);
  const pdfDoc = await PDFDocument.create();
  let added = 0;
  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    const canvas = await renderRegionCanvas(
      project,
      pageNumber,
      exportRegions[pageNumber] ?? null,
      showMarkings,
      showMeasurements,
      language
    );
    if (!canvas) continue;
    await addCanvasPage(pdfDoc, canvas);
    added += 1;
  }
  if (added === 0) return;
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  await savePdf(pdfDoc, t('exports.planPdf.allPagesFileName', { name: safeName }), language);
}
