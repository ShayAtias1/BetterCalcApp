import { PDFDocument } from 'pdf-lib';
import { saveAs } from 'file-saver';
import type { Measurement } from '../types/compare';
import { drawAreaMeasurementTable } from './areaMeasurementTable';
import { embedReportFonts } from './pdfText';
import { stampExportNotice } from './legal/pdfExportNotice';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';

/**
 * One demolition/new-construction table to append after the plan pages. Each carries its own
 * revision's rows and that revision's numbering, so a multi-revision export never attributes one
 * revision's quantities to another.
 */
export interface ChangeTable {
  title: string;
  measurements: Measurement[];
  /** Numbering built from the revision's whole measurement list — see `changeNumbering`. */
  numbering?: Map<string, number>;
}

/** One composite raster per revision (or page), each becoming its own PDF page, in the order given. */
export interface CompositeImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Wrap the already-rendered composite rasters (PNG data URLs produced by the canvas viewer — all
 * text and labels are rasterized there, in `language`, so this stays free of PDF font/encoding
 * concerns, notably Hebrew, which pdf-lib's standard fonts cannot encode) into one downloadable PDF, followed by the
 * demolition/new-construction tables that belong to them.
 *
 * One composite per exported source-page/revision pair, in the order the export walked them, with
 * `changeTables` carrying the matching table for each pair.
 */
export async function exportCompositesAsPdf(
  composites: CompositeImage[],
  fileBaseName: string,
  changeTables: ChangeTable[],
  language: Language
) {
  const { t } = exportContext(language);
  if (composites.length === 0) return;
  const pdfDoc = await PDFDocument.create();

  for (const composite of composites) {
    const pngBytes = await fetch(composite.dataUrl).then((r) => r.arrayBuffer());
    const pngImage = await pdfDoc.embedPng(pngBytes);
    // Treat raster pixels as PDF points 1:1 so the exported page matches the plan's native scale.
    const page = pdfDoc.addPage([composite.width, composite.height]);
    page.drawImage(pngImage, { x: 0, y: 0, width: composite.width, height: composite.height });
  }

  // One table per revision, in the same order as the rasters above, each titled with the revision
  // it belongs to.
  const tables = changeTables.filter((t) => t.measurements.length > 0);
  // Fonts are embedded only when a table is actually printed; the tables are vector text.
  const fonts = tables.length > 0 ? await embedReportFonts(pdfDoc) : null;
  for (const table of tables) {
    drawAreaMeasurementTable(pdfDoc, fonts!, table.title, table.measurements, {
      numbering: table.numbering,
      showPage: true,
    }, language);
  }

  stampExportNotice(pdfDoc, fonts ?? (await embedReportFonts(pdfDoc)), language);
  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  const safeName = fileBaseName.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, t('exports.comparePdf.fileName', { name: safeName }));
}
