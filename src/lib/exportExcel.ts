import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Measurement, Plan, ReportCategoryTotal, RoomQuantitySummary } from '../types';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';
import { addStructuralSheets } from './exportStructuralExcel';
import { buildStructuralReport, type StructuralReport } from './structuralQuantities';
import { selectStructural, type ExportContent } from './exportContent';
import { addOpeningsSheet, newSheet, normalWorkbookView } from './excelReport';
import { writeNativeSchedule, writeNativeAreas } from './nativeQuantityExcel';

/* Native Excel: flat room/category records, optional material shares, openings, areas and
 * structural data. A single-plan workbook never contains a project summary. */

export async function exportQuantitiesToExcel(
  project: Plan,
  summaries: RoomQuantitySummary[],
  _totals: ReportCategoryTotal[],
  areaMeasurements: Measurement[],
  /** What the user chose to export; the caller has already emptied `summaries` / `areaMeasurements` when Finishes is off. */
  content: ExportContent,
  language: Language,
  openingPages?: Set<number>
) {
  // Concrete and rebar come from the plan itself; the caller has already limited them to the pages
  // being exported (withStructuralPages), as it limits the summaries and the area measurements.
  const workbook = buildQuantitiesWorkbook(summaries, areaMeasurements, language, selectStructural(buildStructuralReport(project), content), content.finishes ? project : undefined, openingPages);
  // A selection with nothing to write (no finishes, no structural items on those pages) has no sheet to save.
  if (workbook.worksheets.length === 0) throw new Error('The selected content has nothing to export on the selected sheets.');
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
  /** Concrete and rebar, written to one sheet after the others and only for the sections that have items. Omitted: none. */
  structural?: StructuralReport,
  /** The plan (when Finishes is chosen): names rooms, splits categories into types, holds the openings. */
  openingPlan?: Plan,
  openingPages?: Set<number>
): ExcelJS.Workbook {
  const x = exportContext(language);
  const { t } = x;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BetterCalc';
  workbook.created = new Date();
  const plan = openingPlan ?? null;
  const planName = plan?.name ?? '';
  workbook.title = planName;

  if (summaries.length > 0) {
    const sheet = newSheet(workbook, t('exports.excel.sheets.schedule'), x);
    writeNativeSchedule(sheet, [{ plan, planName, summaries }], x, false);
  }
  if (areaMeasurements.length) {
    const areas = newSheet(workbook, t('exports.excel.sheets.areas'), x);
    writeNativeAreas(areas, [{ planName, measurements: areaMeasurements }], x, false);
  }

  if (summaries.length > 0) {
    addOpeningsSheet(workbook, [{ plan, planName, summaries, pageScope: openingPages }], x, false);
  }

  if (structural) addStructuralSheets(workbook, structural, x);

  normalWorkbookView(workbook, x);
  return workbook;
}
