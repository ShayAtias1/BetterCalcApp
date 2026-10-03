import type { PDFDocument } from 'pdf-lib';
import type { ReportFonts } from './pdfText';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';
import { ReportWriter } from './exportProjectPdf';
import { buildStructuralPdfLayout, writeBlocks, type StructuralInclude } from './structuralPdfLayout';
import type { StructuralReport } from './structuralQuantities';

/**
 * Appends the plan's concrete and rebar tables to the quantity report as vector pages (the layout
 * itself is `buildStructuralPdfLayout`). Writes nothing when the report has no structural section.
 */
export function drawStructuralPdfPages(doc: PDFDocument, fonts: ReportFonts, planName: string, report: StructuralReport, language: Language, include?: StructuralInclude): void {
  const x = exportContext(language);
  const blocks = buildStructuralPdfLayout(report, x, include);
  if (blocks.length === 0) return;
  const writer = new ReportWriter(doc, fonts, planName, x.today(), x);
  writeBlocks(writer, blocks);
}
