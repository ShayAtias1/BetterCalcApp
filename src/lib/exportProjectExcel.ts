import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Plan, Project } from '../types';
import type { Language } from '../i18n';
import { exportContext } from './exportLanguage';
import { addExcelNotice } from './legal/exportNotice';
import { buildProjectQuantities } from './projectQuantities';
import { addProjectStructuralSheets } from './exportStructuralExcel';
import { buildProjectStructural, buildStructuralReport } from './structuralQuantities';
import { ALL_CONTENT, type ExportContent } from './exportContent';
import { addOpeningsSheet, newSheet, normalWorkbookView } from './excelReport';
import { writeNativeSchedule, writeNativeProjectSummary, writeNativeAreas } from './nativeQuantityExcel';

/* Native project workbook: one filterable schedule across plans and one consolidated
 * project summary, plus only the supporting datasets that exist. */

export async function exportProjectToExcel(project: Project, plans: Plan[], content: ExportContent, language: Language) {
  const workbook = buildProjectWorkbook(project, plans, language, content);
  // A selection with nothing to write would save a file Excel cannot open.
  if (workbook.worksheets.length === 0) throw new Error('The selected content has nothing to export.');
  addExcelNotice(workbook, language, exportContext(language).rtl);
  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(new Blob([buffer], { type: 'application/octet-stream' }), exportContext(language).t('exports.excel.projectFileName', { name: safeName }));
}

/** The project workbook exactly as `exportProjectToExcel` saves it — built apart so tests can read it. */
export function buildProjectWorkbook(project: Project, plans: Plan[], language: Language, content: ExportContent = ALL_CONTENT): ExcelJS.Workbook {
  const x = exportContext(language);
  const { t } = x;
  const q = buildProjectQuantities(plans, t);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BetterCalc';
  workbook.title = project.name;
  workbook.created = new Date();
  if (content.finishes) {
    const summary = plans.length > 1 && q.totals.length > 0 ? newSheet(workbook, t('exports.excel.sheets.projectSummary'), x) : null;
    const entries = q.plans.map(report => ({ plan: report.plan, planName: report.plan.name, summaries: report.summaries }));
    const scheduleName = t('exports.excel.sheets.schedule');
    if (entries.some(entry => entry.summaries.length)) {
      const schedule = newSheet(workbook, scheduleName, x);
      const layouts = writeNativeSchedule(schedule, entries, x, plans.length > 1);
      if (summary) writeNativeProjectSummary(summary, q, layouts, scheduleName, x);
    }
    const areaPlans = plans.filter(plan => (plan.measurements ?? []).some(m => m.areaKind && typeof m.areaM2 === 'number'));
    if (areaPlans.length) {
      const areas = newSheet(workbook, t('exports.excel.sheets.areas'), x);
      writeNativeAreas(areas, areaPlans.map(plan => ({ planName: plan.name, measurements: (plan.measurements ?? []).filter(m => m.areaKind && typeof m.areaM2 === 'number') })), x, plans.length > 1);
    }

    addOpeningsSheet(workbook, entries, x, true);
  }

  // Concrete and rebar, after every finishes sheet and only when selected and some plan has such items.
  const structural = buildProjectStructural(plans);
  const selected = { concrete: content.concrete ? structural.concrete : null, rebar: content.rebar ? structural.rebar : null };
  if (selected.concrete || selected.rebar) {
    addProjectStructuralSheets(workbook, plans.map((p) => ({ planName: p.name, report: buildStructuralReport(p) })), selected, x);
  }
  normalWorkbookView(workbook, x);
  return workbook;
}
