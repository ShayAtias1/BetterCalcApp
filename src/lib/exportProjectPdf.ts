import { openingPdfSchedule, type OpeningPdfOptions } from './openingQuantityReport';
import { stampExportNotice } from './legal/pdfExportNotice';
import { PDFDocument } from 'pdf-lib';
import { embedReportFonts } from './pdfText';
import { saveAs } from 'file-saver';
import type { Plan, Project } from '../types';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';
import { buildProjectQuantities, planStatusText, totalColumnInfo } from './projectQuantities';
import { buildProjectStructural, finishesSummaryMode } from './structuralQuantities';
import { buildProjectStructuralPdfLayout, writeBlocks } from './structuralPdfLayout';
import { type ExportContent } from './exportContent';
import { ReportWriter } from './pdfReportWriter';
import { buildProjectSummaryRows, writeRoomSchedule, summaryHeaders, SUMMARY_WEIGHTS } from './quantitySchedulePdf';
import { appendPlanDrawingPages, getExportablePageNumbers } from './exportQuantitiesPdf';
import type { OverlayVisibility } from './overlayVisibility';
import type { PdfDrawingOptions } from './pdfDrawingLayers';

/*
 * The project quantity report, one continuous document: ONE consolidated project summary (only
 * when there are several plans — with a single plan its schedule already is the summary), then each
 * plan in turn (its drawings when chosen, then its quantity schedule), then the structural
 * sections. Vector text and table lines throughout (see lib/pdfText).
 */

export { ReportWriter, type TableRow, type ScheduleRow } from './pdfReportWriter';

export interface ProjectPdfOptions extends OpeningPdfOptions, PdfDrawingOptions {
  /** What the plan drawings show (the View menu state); all overlays when omitted. */
  overlays?: OverlayVisibility;
}

const ALL_OVERLAYS: OverlayVisibility = { finishes: true, measurements: true, markups: true, concrete: true, rebar: true };

export async function exportProjectToPdf(project: Project, plans: Plan[], content: ExportContent, language: Language, options: ProjectPdfOptions = {}) {
  const x = exportContext(language);
  const { t } = x;
  const q = buildProjectQuantities(plans, t);
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedReportFonts(pdfDoc);
  // Created on first use, so a report that opens with drawings does not start with an empty page.
  let writer: ReportWriter | null = null;
  const w = () => (writer ??= new ReportWriter(pdfDoc, fonts, t('exports.projectPdf.title', { name: project.name }), t('exports.projectPdf.subtitle', { count: plans.length, date: x.today() }), x));

  const structural = buildProjectStructural(plans);
  // A project with only structural data has no finishes summary; one with nothing at all says so.
  const summaryMode = finishesSummaryMode(q.totals.length, structural);

  if (content.finishes) {
    if (summaryMode === 'empty') w().note(t('exports.projectPdf.empty'));
    else if (plans.length > 1 && q.totals.length > 0) {
      w().section(t('exports.projectPdf.summary'), 4);
      w().schedule(summaryHeaders(x), SUMMARY_WEIGHTS, buildProjectSummaryRows(q.totals, (total) => totalColumnInfo(total, t), x), t('exports.quantityPdf.schedule.continued'));
      if (q.uncalibratedRoomCount > 0) w().note(t('exports.projectPdf.uncalibratedNote', { count: q.uncalibratedRoomCount }));
    }
  }

  for (const report of q.plans) {
    if (content.plan) {
      const added = await appendPlanDrawingPages(pdfDoc, fonts, report.plan, getExportablePageNumbers(report.plan), options.overlays ?? ALL_OVERLAYS, x, options);
      // The plan's schedule continues after its drawings, never on a page before them.
      if (added && writer) (writer as ReportWriter).startPage();
    }
    if (!content.finishes || summaryMode === 'empty' || report.summaries.length === 0) continue;
    w().section(t('exports.projectPdf.planSection', { name: report.plan.name }), 4);
    w().facts(t('exports.projectPdf.planFacts', { rooms: report.roomCount, calibrated: report.calibratedPageCount, status: planStatusText(report, t) }));
    writeRoomSchedule(w(), { plan: report.plan, summaries: report.summaries }, x);
    // The project summary already says it for several plans; a single plan says it here.
    if (plans.length === 1 && report.uncalibratedRoomCount > 0) w().note(t('exports.projectPdf.uncalibratedNote', { count: report.uncalibratedRoomCount }));
  }

  if (content.finishes) {
    const schedule = openingPdfSchedule(plans, x, options);
    if (schedule) {
      w().section(schedule.title, 4);
      w().table(schedule.headers, schedule.widths, schedule.rows.map((cells) => ({ cells })));
    }
  }

  // After the finishes: concrete aggregates and Rebar item/level tables with plan context.
  const blocks = buildProjectStructuralPdfLayout(structural, x, plans, { concrete: content.concrete, rebar: content.rebar });
  if (blocks.length) writeBlocks(w(), blocks);
  if (!content.finishes && !content.plan && !(content.concrete && structural.concrete) && !(content.rebar && structural.rebar)) throw new Error('The selected content has nothing to export.');
  if (pdfDoc.getPageCount() === 0) w();

  stampExportNotice(pdfDoc, fonts, language);
  const bytes = await pdfDoc.save();
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(
    new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' }),
    t('exports.projectPdf.fileName', { name: safeName })
  );
}
