import type { PDFDocument } from 'pdf-lib';
import type { Language } from '../../i18n';
import { PdfPainter, type ReportFonts } from '../pdfText';
import { EXPORT_NOTICE } from './exportNotice';

function wrap(painter: PdfPainter, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && painter.measure(next, size) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Adds the notice in a strip under every page: the page grows by the strip's height and its content is moved up by the
 * same amount, so drawings and tables are neither covered nor resized.
 */
export function stampExportNotice(pdfDoc: PDFDocument, fonts: ReportFonts, language: Language, date?: string): void {
  const direction = language === 'he' ? 'rtl' : 'ltr';
  const { headline, body } = EXPORT_NOTICE[language];
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(6.5, width * 0.0085);
    const margin = size * 2.4;
    const painter = new PdfPainter(page, fonts, direction);
    const bodyLines = wrap(painter, date ? `${body} · ${date}` : body, size, width - margin * 2);
    const lineHeight = size * 1.4;
    const strip = (bodyLines.length + 1) * lineHeight + size * 1.8;
    // Drawn first, below the current bottom edge (y measured from the top of the page as it is now), and then the whole
    // page, notice included, is moved up by the strip: pdf-lib wraps every stream that exists when translateContent runs.
    const top = height;
    painter.line(margin, top + size * 0.5, width - margin, top + size * 0.5, '#cbd5e1', 0.6);
    painter.fillText(headline, width / 2, top + size * 0.5 + lineHeight * 1.05, { size, bold: true, color: '#1e293b', align: 'center' });
    bodyLines.forEach((line, i) => painter.fillText(line, width / 2, top + size * 0.5 + lineHeight * (2.05 + i), { size, color: '#475569', align: 'center' }));
    page.setSize(width, height + strip);
    page.translateContent(0, strip);
  }
}
