import { useState } from 'react';
import ExportContentPicker from './ExportContentPicker';
import { useAppStore } from '../store/appStore';
import { useQuantityExportInfo } from '../hooks/useQuantityExportInfo';
import { planForReport } from '../lib/reportTitle';
import { buildReportCategoryTotals } from '../lib/quantities';
import { exportQuantitiesToExcel } from '../lib/exportExcel';
import { exportQuantitiesToPdf } from '../lib/exportQuantitiesPdf';
import { quantityExportDetails, trackedExport } from '../lib/analytics';
import { notifyExportFailed } from '../lib/exportFailure';
import { withStructuralPages } from '../lib/structuralPlan';
import { EXPORT_SECTIONS, everything, hasAnyContent, type ExportContent } from '../lib/exportContent';
import { useLanguage, useT } from '../i18n';

/** The workbook has no plan drawing, so no plan section. */
const EXCEL_SECTIONS = ['finishes', 'concrete', 'rebar'] as const;

type Info = NonNullable<ReturnType<typeof useQuantityExportInfo>>;

/**
 * The plan export dialogs (what to export + which pages), mounted ONCE in the plan workspace and
 * opened through the store. They used to live inside the export buttons themselves, so the top bar's
 * export menu - which closes and unmounts its items the moment one is clicked - took the dialog down
 * with it: clicking "Quantity report - PDF / Excel" there appeared to do nothing. Now both entry points
 * (the Quantities panel buttons and that menu) only set `quantityExportDialog`, and this component
 * outlives them.
 */
export default function QuantityExportDialogs() {
  const info = useQuantityExportInfo();
  const dialog = useAppStore((s) => s.quantityExportDialog);
  if (!info || !dialog) return null;
  return dialog.kind === 'pdf' ? <PdfDialog info={info} surface={dialog.surface} /> : <ExcelDialog info={info} surface={dialog.surface} />;
}

function useExportRunner(info: Info, surface: 'topbar_menu' | 'quantities_panel') {
  // Exports are written in the language the app is showing.
  const language = useLanguage();
  const projectName = useAppStore((s) => s.currentProject?.name);
  const overlayVisible = useAppStore((s) => s.overlayVisible);
  const setBusy = useAppStore((s) => s.setQuantityExportBusy);
  const { project, summaries, exportablePages } = info;

  const scoped = (pageNumbers: number[], finishes: boolean) => {
    const roomPageById = new Map(project.rooms.map((r) => [r.id, r.pageNumber]));
    const pageSet = new Set(pageNumbers);
    // Finishes only when chosen: without it the workbook carries neither rooms nor area measurements.
    const filteredSummaries = finishes ? summaries.filter((s) => pageSet.has(roomPageById.get(s.roomId) ?? -1)) : [];
    return { pageSet, filteredSummaries, filteredTotals: buildReportCategoryTotals(project, filteredSummaries) };
  };

  const runExcel = async (pageNumbers: number[], content: ExportContent) => {
    setBusy('excel');
    try {
      const { pageSet, filteredSummaries, filteredTotals } = scoped(pageNumbers, content.finishes);
      const filteredAreaMeasurements = (content.finishes ? project.measurements ?? [] : []).filter(
        (m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number' && pageSet.has(m.pageNumber)
      );
      await trackedExport(
        { export_kind: 'quantity_excel', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToExcel(withStructuralPages(planForReport(project, projectName), pageSet), filteredSummaries, filteredTotals, filteredAreaMeasurements, content, language, pageSet)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setBusy(null);
    }
  };

  const runPdf = async (pageNumbers: number[], content: ExportContent, includeOpeningDetails = false) => {
    setBusy('pdf');
    try {
      const { filteredSummaries, filteredTotals } = scoped(pageNumbers, true);
      await trackedExport(
        { export_kind: 'quantity_pdf', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToPdf(planForReport(project, projectName), filteredSummaries, filteredTotals, overlayVisible, pageNumbers, content, language, {includeOpeningDetails})
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setBusy(null);
    }
  };
  return { runExcel, runPdf };
}

function PdfDialog({ info, surface }: { info: Info; surface: 'topbar_menu' | 'quantities_panel' }) {
  const t = useT();
  const currentPage = useAppStore((s) => s.currentPage);
  const close = useAppStore((s) => s.setQuantityExportDialog);
  const { runPdf } = useExportRunner(info, surface);
  const [includeOpeningDetails,setIncludeOpeningDetails]=useState(false);
  const { exportablePages, available } = info;
  // What to export (sections) and which pages are two separate choices.
  const [state, setState] = useState<{ pages: Set<number>; content: ExportContent }>(() => ({
    pages: new Set(exportablePages.length > 1 && exportablePages.includes(currentPage) ? [currentPage] : exportablePages),
    content: everything(available),
  }));

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{t('quantityExport.pdfTitle')}</h3>
        <ExportContentPicker sections={EXPORT_SECTIONS} labels="pdf" content={state.content} available={available} onChange={(content) => setState({ ...state, content })} />
        <p className="muted">{t('quantityExport.contentHint')}</p>
        {state.content.finishes && <label className="opening-review-check"><input type="checkbox" checked={includeOpeningDetails} onChange={e=>setIncludeOpeningDetails(e.target.checked)}/>{t('openingQuantities.includeDetails')}</label>}
        {exportablePages.length > 1 && (
          <>
            <span className="section-label">{t('quantityExport.whichPages')}</span>
            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button className="btn-secondary small" onClick={() => setState({ ...state, pages: new Set(exportablePages) })}>
                {t('quantityExport.selectAll')}
              </button>
              <button className="btn-secondary small" onClick={() => setState({ ...state, pages: new Set() })}>
                {t('quantityExport.clearSelection')}
              </button>
            </div>
            <ul className="page-checkbox-list">
              {exportablePages.map((p) => (
                <li key={p}>
                  <label>
                    <input
                      type="checkbox"
                      checked={state.pages.has(p)}
                      onChange={(e) => {
                        const next = new Set(state.pages);
                        if (e.target.checked) next.add(p);
                        else next.delete(p);
                        setState({ ...state, pages: next });
                      }}
                    />
                    {p === currentPage ? t('quantityExport.pageCurrent', { page: p }) : t('quantityExport.page', { page: p })}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => close(null)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            disabled={!hasAnyContent(state.content) || state.pages.size === 0}
            onClick={() => {
              const pages = Array.from(state.pages).sort((a, b) => a - b);
              close(null);
              void runPdf(pages, state.content, includeOpeningDetails);
            }}
          >
            {t('common.export')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExcelDialog({ info, surface }: { info: Info; surface: 'topbar_menu' | 'quantities_panel' }) {
  const t = useT();
  const currentPage = useAppStore((s) => s.currentPage);
  const close = useAppStore((s) => s.setQuantityExportDialog);
  const { runExcel } = useExportRunner(info, surface);
  const { exportablePages, excelAvailable } = info;
  const [state, setState] = useState<{ mode: 'specific' | 'all'; page: number; content: ExportContent }>(() => ({
    mode: exportablePages.length > 1 ? 'specific' : 'all',
    page: exportablePages.includes(currentPage) ? currentPage : exportablePages[0],
    content: everything(excelAvailable),
  }));

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{t('quantityExport.excelTitle')}</h3>
        <ExportContentPicker sections={EXCEL_SECTIONS} content={state.content} available={excelAvailable} onChange={(content) => setState({ ...state, content })} />
        {exportablePages.length > 1 && (
          <>
            <span className="section-label">{t('quantityExport.whichPages')}</span>
            <p>{t('quantityExport.excelPagesIntro')}</p>
            <div className="form-row">
              <label>
                <input type="radio" name="excel-export-mode" checked={state.mode === 'specific'} onChange={() => setState({ ...state, mode: 'specific' })} /> {t('quantityExport.specificPage')}
              </label>
              {state.mode === 'specific' && (
                <select value={state.page} onChange={(e) => setState({ ...state, page: parseInt(e.target.value, 10) })}>
                  {exportablePages.map((p) => (
                    <option key={p} value={p}>
                      {p === currentPage ? t('quantityExport.pageCurrent', { page: p }) : t('quantityExport.page', { page: p })}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-row">
              <label>
                <input type="radio" name="excel-export-mode" checked={state.mode === 'all'} onChange={() => setState({ ...state, mode: 'all' })} /> {t('quantityExport.allPagesSummary')}
              </label>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => close(null)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            disabled={!hasAnyContent(state.content)}
            onClick={() => {
              const pages = state.mode === 'all' ? exportablePages : [state.page];
              close(null);
              void runExcel(pages, state.content);
            }}
          >
            {t('common.export')}
          </button>
        </div>
      </div>
    </div>
  );
}
