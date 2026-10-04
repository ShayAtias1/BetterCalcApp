import { PDFDocument } from 'pdf-lib';
import { drawLogo, embedReportFonts, logoWidth, PdfPainter, REPORT_LOGO_HEIGHT, type ReportFonts } from './pdfText';
import { saveAs } from 'file-saver';
import type { Plan, Project } from '../types';
import type { Language } from '../i18n';
import { exportContext, type ExportContext } from './exportLanguage';
import { buildProjectQuantities, planStatusLabel, roomCategoryQuantity, type CategoryAmount } from './projectQuantities';
import { buildProjectStructural, finishesSummaryMode } from './structuralQuantities';
import { buildProjectStructuralPdfLayout, writeBlocks, type StirrupShapeCard } from './structuralPdfLayout';
import { type ExportContent } from './exportContent';

/*
 * The project quantity report: vector text and table lines throughout (see lib/pdfText — Hebrew is
 * drawn as real text in an embedded font). Tables only: the marked-up plan images stay in each
 * plan's own report.
 */

const PAGE_W = 1600;
const PAGE_H = 1132;
const MARGIN = 40;
const ROW_H = 30;
const DASH = '-';

// Same palette as the other exports.
const C_HEADER = '#1F4E79';
const C_ZEBRA_A = '#EBF5FB';
const C_ZEBRA_B = '#FDFEFE';
const C_TOTAL = '#D6E4F0';
const C_BORDER = '#E2E8F0';

export interface TableRow {
  cells: string[];
  bg?: string;
  bold?: boolean;
}


/** Paginated vector writer: section titles and tables, a new page whenever one fills up. */
export class ReportWriter {
  private pt!: PdfPainter;
  private y = 0;
  private doc: PDFDocument;
  private fonts: ReportFonts;
  private title: string;
  private subtitle: string;
  private x: ExportContext;
  /** Where lines of text and table rows begin: the right margin for RTL, the left for LTR. */
  private startX: number;
  private sign: 1 | -1;

  constructor(doc: PDFDocument, fonts: ReportFonts, title: string, subtitle: string, x: ExportContext) {
    this.x = x;
    this.startX = x.rtl ? PAGE_W - MARGIN : MARGIN;
    this.sign = x.rtl ? -1 : 1;
    this.doc = doc;
    this.fonts = fonts;
    this.title = title;
    this.subtitle = subtitle;
    this.newPage();
  }

  private newPage() {
    this.pt = new PdfPainter(this.doc.addPage([PAGE_W, PAGE_H]), this.fonts, this.x.direction);
    this.pt.fillText(this.title, this.startX, 40, { size: 20, bold: true, color: '#0f172a', maxWidth: PAGE_W - MARGIN * 2 - logoWidth(REPORT_LOGO_HEIGHT) - 24 });
    this.pt.fillText(this.subtitle, this.startX, 60, { size: 12, color: '#8b8f99' });
    drawLogo(this.pt, this.x.rtl ? MARGIN : PAGE_W - MARGIN - logoWidth(REPORT_LOGO_HEIGHT), 28, REPORT_LOGO_HEIGHT);
    this.y = 84;
  }

  private ensure(rows: number) {
    if (this.y + rows * ROW_H > PAGE_H - MARGIN) this.newPage();
  }

  private drawCells(cells: string[], widths: number[], bg: string, color: string, bold: boolean) {
    const usable = PAGE_W - MARGIN * 2;
    this.pt.fillRect(MARGIN, this.y, usable, ROW_H, bg);
    this.pt.strokeRect(MARGIN, this.y, usable, ROW_H, C_BORDER);
    let edge = this.startX;
    cells.forEach((cell, i) => {
      const w = widths[i] ?? 0;
      this.pt.fillText(cell, edge + (this.sign * w) / 2, this.y + ROW_H / 2 + 4, { size: 12, bold, color, align: 'center', maxWidth: w - 6 });
      edge += this.sign * w;
    });
    this.y += ROW_H;
  }

  section(title: string) {
    this.ensure(3);
    this.y += 10;
    this.pt.fillText(title, this.startX, this.y + 16, { size: 15, bold: true, color: '#0f172a' });
    this.y += 26;
  }

  table(headers: string[], weights: number[], rows: TableRow[]) {
    const usable = PAGE_W - MARGIN * 2;
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (usable * w) / total);
    const header = () => this.drawCells(headers, widths, C_HEADER, '#ffffff', true);
    this.ensure(2);
    header();
    rows.forEach((row, i) => {
      if (this.y + ROW_H > PAGE_H - MARGIN) {
        this.newPage();
        header(); // repeat the header on every page the table continues onto
      }
      this.drawCells(row.cells, widths, row.bg ?? (i % 2 === 0 ? C_ZEBRA_A : C_ZEBRA_B), '#1e293b', !!row.bold);
    });
    this.y += ROW_H * 0.5;
  }

  shapeCard(card: StirrupShapeCard) {
    const height = 108;
    // Keep the compact card with the following placement header and first row.
    this.ensure((height + 4 + ROW_H * 2) / ROW_H);
    const top = this.y;
    const width = Math.min(PAGE_W - MARGIN * 2, 780);
    const left = this.x.rtl ? PAGE_W - MARGIN - width : MARGIN;
    const diagramX = this.x.rtl ? left + width - 112 : left + 8;
    this.pt.strokeRect(left, top, width, height, C_BORDER);
    const points = card.shape.points;
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 0;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : 0;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 0;
    const scale = 64 / Math.max(maxX - minX, maxY - minY, 1);
    // A fixed visual area, centred without ever mirroring the saved geometry in RTL.
    const screenX = (x: number) => diagramX + 52 + (x - (minX + maxX) / 2) * scale;
    const screenY = (y: number) => top + 47 + (y - (minY + maxY) / 2) * scale;
    for (const segment of card.shape.segments) {
      this.pt.line(screenX(segment.normalizedStart.x), screenY(segment.normalizedStart.y),
        screenX(segment.normalizedEnd.x), screenY(segment.normalizedEnd.y), '#c2410c', 1.5);
    }
    // Main leg dimensions only; the complete true vector remains visible for custom shapes.
    card.shape.segments.slice(0, 6).forEach((segment) => {
      const midX = (segment.normalizedStart.x + segment.normalizedEnd.x) / 2;
      const midY = (segment.normalizedStart.y + segment.normalizedEnd.y) / 2;
      const vertical = Math.abs(segment.normalizedEnd.y - segment.normalizedStart.y)
        > Math.abs(segment.normalizedEnd.x - segment.normalizedStart.x);
      this.pt.fillText(this.x.number(Math.round(segment.lengthM * 1000) / 10),
        screenX(midX) + (vertical ? (midX < (minX + maxX) / 2 ? -7 : 7) : 0),
        screenY(midY) + (vertical ? 3 : (midY < (minY + maxY) / 2 ? -5 : 10)),
        { size: 8, direction: 'ltr', align: vertical ? (midX < (minX + maxX) / 2 ? 'right' : 'left') : 'center', color: '#78716c' });
    });
    this.pt.fillText(this.x.t('units.cm'), diagramX + 52, top + 101,
      { size: 8, direction: 'ltr', align: 'center', color: '#78716c' });
    const textWidth = width - 140;
    const textX = this.x.rtl ? diagramX - 12 : left + 128;
    this.pt.fillText(card.title, textX, top + 21, { size: 14, bold: true, maxWidth: textWidth });
    const columnWidth = textWidth / 2;
    card.details.forEach((detail, index) => this.pt.fillText(detail,
      textX + this.sign * (index % 2) * columnWidth, top + 44 + Math.floor(index / 2) * 22,
      { size: 11, maxWidth: columnWidth - 12 }));
    if (card.note) this.pt.fillText(card.note, textX, top + 94,
      { size: 8, color: '#78716c', maxWidth: textWidth });
    this.y += height + 4;
  }

  note(text: string) {
    this.ensure(1);
    this.pt.fillText(text, this.startX, this.y + 16, { size: 12, bold: true, color: '#92400e' });
    this.y += ROW_H;
  }
}

const amountHeaders = ({ t }: ExportContext) => {
  const m2 = t('units.m2');
  const lm = t('units.lm');
  return [
    t('exports.projectPdf.netUnit', { unit: m2 }),
    t('exports.projectPdf.orderUnit', { unit: m2 }),
    t('exports.projectPdf.netUnit', { unit: lm }),
    t('exports.projectPdf.orderUnit', { unit: lm }),
  ];
};
const amountCells = (a: CategoryAmount, fmt: (v: number | null | undefined) => string) => [fmt(a.quantityM2), fmt(a.orderM2), fmt(a.lengthM), fmt(a.orderLengthM)];

export async function exportProjectToPdf(project: Project, plans: Plan[], content: ExportContent, language: Language) {
  const x = exportContext(language);
  const { t } = x;
  const fmt = (v: number | null | undefined) => (v == null ? DASH : x.number(v));
  const q = buildProjectQuantities(plans, t);
  const date = x.today();
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedReportFonts(pdfDoc);
  const report = new ReportWriter(
    pdfDoc,
    fonts,
    t('exports.projectPdf.title', { name: project.name }),
    t('exports.projectPdf.subtitle', { count: plans.length, date }),
    x
  );
  const AMOUNT_HEADERS = amountHeaders(x);
  const notCalibrated = t('exports.common.notCalibrated');

  // Concrete and rebar across the plans. The "no quantities" note below is only true when there is
  // neither finishes work nor structural data.
  const structural = buildProjectStructural(plans);
  const summaryMode = finishesSummaryMode(q.totals.length, structural);

  // Finishes: left out entirely when the user did not choose them.
  if (content.finishes) {
    if (summaryMode !== 'skip') {
      report.section(t('exports.projectPdf.summary'));
      if (summaryMode === 'empty') {
        report.note(t('exports.projectPdf.empty'));
      } else {
        report.table([t('exports.common.item'), ...AMOUNT_HEADERS], [18, 12, 12, 12, 12], q.totals.map((total) => ({ cells: [total.label, ...amountCells(total, fmt)] })));
      }
    }
    if (q.uncalibratedRoomCount > 0) report.note(t('exports.projectPdf.uncalibratedNote', { count: q.uncalibratedRoomCount }));

    report.section(t('exports.projectPdf.plans'));
    report.table(
      [
        t('exports.common.plan'),
        t('exports.projectPdf.planHeaders.rooms'),
        t('exports.projectPdf.planHeaders.calibratedPages'),
        t('exports.projectPdf.planHeaders.uncalibratedRooms'),
        t('exports.projectPdf.planHeaders.status'),
      ],
      [22, 8, 10, 10, 14],
      q.plans.map((r) => ({
        cells: [r.plan.name, `${r.roomCount}`, `${r.calibratedPageCount}`, `${r.uncalibratedRoomCount}`, planStatusLabel(r.status, t)],
      }))
    );

    if (q.totals.length > 0) {
      report.section(t('exports.projectPdf.byPlan'));
      report.table(
        [t('exports.common.item'), t('exports.common.plan'), ...AMOUNT_HEADERS],
        [16, 20, 12, 12, 12, 12],
        q.totals.flatMap((total) => [
          { cells: [total.label, t('exports.common.total'), ...amountCells(total, fmt)], bg: C_TOTAL, bold: true },
          ...total.perPlan.map((p) => ({ cells: ['', p.planName, ...amountCells(p, fmt)] })),
        ])
      );

      report.section(t('exports.projectPdf.byRoom'));
      const categories = q.totals.map((total) => total.category);
      const labels = new Map(q.totals.map((total) => [total.category, total.label]));
      report.table(
        [t('exports.common.plan'), t('exports.common.apartment'), t('exports.common.room'), t('exports.common.item'), ...AMOUNT_HEADERS],
        [16, 7, 16, 12, 10, 10, 10, 10],
        q.plans.flatMap((r) =>
          r.summaries.flatMap((s) =>
            categories.flatMap((c) => {
              const v = roomCategoryQuantity(s, c);
              if (v.wastePercent == null) return [];
              const cells = s.pageCalibrated
                ? [fmt(v.quantityM2), fmt(v.orderM2), fmt(v.lengthM), fmt(v.orderLengthM)]
                : [notCalibrated, notCalibrated, DASH, DASH];
              return [{ cells: [r.plan.name, s.apartmentNumber || DASH, s.roomName, labels.get(c)!, ...cells] }];
            })
          )
        )
      );
    }
  }

  // After the finishes: concrete aggregates and Rebar item/level tables with plan context.
  writeBlocks(report, buildProjectStructuralPdfLayout(structural, x, plans, { concrete: content.concrete, rebar: content.rebar }));
  if (!content.finishes && !(content.concrete && structural.concrete) && !(content.rebar && structural.rebar)) throw new Error('The selected content has nothing to export.');

  const bytes = await pdfDoc.save();
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(
    new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' }),
    t('exports.projectPdf.fileName', { name: safeName })
  );
}
