import { useMemo, useState } from 'react';
import Icon from './Icon';
import { useAppStore } from '../store/appStore';
import { planForReport } from '../lib/reportTitle';
import { buildReportCategoryTotals, buildRoomSummaries } from '../lib/quantities';
import { exportQuantitiesToExcel } from '../lib/exportExcel';
import { exportQuantitiesToPdf, getExportablePageNumbers } from '../lib/exportQuantitiesPdf';
import { quantityExportDetails, trackedExport } from '../lib/analytics';
import { notifyExportFailed } from '../lib/exportFailure';
import { hasStructuralData, withStructuralPages } from '../lib/structuralPlan';
import { useLanguage, useT } from '../i18n';

/**
 * The two actions that produce BetterCalc's main deliverable — the quantity report — plus their
 * page-selection dialogs. Extracted from the quantities tab so the exact same behaviour can be
 * offered from the top bar's export menu as well, without a second implementation.
 *
 * `variant` only changes the trigger markup: 'menu' renders menu items for TopBarMenu, 'buttons'
 * renders the toolbar buttons the quantities tab has always had.
 */
export default function QuantityExportActions({ variant, onPicked }: { variant: 'menu' | 'buttons'; onPicked?: () => void }) {
  const t = useT();
  // Exports are written in the language the app is showing (Phase 6 may add a separate choice).
  const language = useLanguage();
  const project = useAppStore((s) => s.project);
  const projectName = useAppStore((s) => s.currentProject?.name);
  const currentPage = useAppStore((s) => s.currentPage);
  const annotationsVisible = useAppStore((s) => s.annotationsVisible);
  const measurementsVisible = useAppStore((s) => s.measurementsVisible);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pageDialogPages, setPageDialogPages] = useState<Set<number> | null>(null);
  const [excelDialog, setExcelDialog] = useState<{ mode: 'specific' | 'all'; page: number } | null>(null);

  const summaries = useMemo(() => (project ? buildRoomSummaries(project) : []), [project]);

  if (!project) return null;

  const hasAreaMeasurements = (project.measurements ?? []).some((m) => m.tool === 'area' && m.areaKind);
  // Concrete and rebar are exportable on their own: a plan with only those still has a report.
  const canExport = summaries.length > 0 || hasAreaMeasurements || hasStructuralData(project);
  const exportablePages = getExportablePageNumbers(project);
  const surface = variant === 'menu' ? 'topbar_menu' : 'quantities_panel';

  const runExportExcel = async (pageNumbers: number[]) => {
    setExportingExcel(true);
    try {
      const roomPageById = new Map(project.rooms.map((r) => [r.id, r.pageNumber]));
      const pageSet = new Set(pageNumbers);
      const filteredSummaries = summaries.filter((s) => pageSet.has(roomPageById.get(s.roomId) ?? -1));
      const filteredTotals = buildReportCategoryTotals(project, filteredSummaries);
      const filteredAreaMeasurements = (project.measurements ?? []).filter(
        (m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number' && pageSet.has(m.pageNumber)
      );
      await trackedExport(
        { export_kind: 'quantity_excel', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToExcel(withStructuralPages(planForReport(project, projectName), pageSet), filteredSummaries, filteredTotals, filteredAreaMeasurements, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportExcel = () => {
    onPicked?.();
    if (exportablePages.length <= 1) {
      void runExportExcel(exportablePages);
      return;
    }
    setExcelDialog({ mode: 'specific', page: exportablePages.includes(currentPage) ? currentPage : exportablePages[0] });
  };

  const runExportPdf = async (pageNumbers: number[]) => {
    setExportingPdf(true);
    try {
      const roomPageById = new Map(project.rooms.map((r) => [r.id, r.pageNumber]));
      const pageSet = new Set(pageNumbers);
      const filteredSummaries = summaries.filter((s) => pageSet.has(roomPageById.get(s.roomId) ?? -1));
      const filteredTotals = buildReportCategoryTotals(project, filteredSummaries);
      await trackedExport(
        { export_kind: 'quantity_pdf', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToPdf(planForReport(project, projectName), filteredSummaries, filteredTotals, annotationsVisible, pageNumbers, measurementsVisible, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportPdf = () => {
    onPicked?.();
    if (exportablePages.length <= 1) {
      void runExportPdf(exportablePages);
      return;
    }
    setPageDialogPages(new Set(exportablePages.includes(currentPage) ? [currentPage] : exportablePages));
  };

  return (
    <>
      {variant === 'menu' ? (
        <>
          <button className="menu-item" onClick={handleExportExcel} disabled={!canExport || exportingExcel}>
            <span className="menu-check">
              <Icon name="sheet" size={13} />
            </span>
            {exportingExcel ? t('common.exporting') : t('quantityExport.excelMenu')}
          </button>
          <button className="menu-item" onClick={handleExportPdf} disabled={!canExport || exportingPdf}>
            <span className="menu-check">
              <Icon name="file" size={13} />
            </span>
            {exportingPdf ? t('common.exporting') : t('quantityExport.pdfMenu')}
          </button>
        </>
      ) : (
        <>
          <button className="btn-secondary small" onClick={handleExportPdf} disabled={!canExport || exportingPdf}>
            <Icon name="file" />
            {exportingPdf ? t('common.exporting') : t('quantityExport.pdfButton')}
          </button>
          <button className="btn-primary small" onClick={handleExportExcel} disabled={!canExport || exportingExcel}>
            <Icon name="sheet" />
            {exportingExcel ? t('common.exporting') : t('quantityExport.excelButton')}
          </button>
        </>
      )}

      {pageDialogPages && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{t('quantityExport.whichPages')}</h3>
            <p>{t('quantityExport.pdfPagesIntro')}</p>
            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button className="btn-secondary small" onClick={() => setPageDialogPages(new Set(exportablePages))}>
                {t('quantityExport.selectAll')}
              </button>
              <button className="btn-secondary small" onClick={() => setPageDialogPages(new Set())}>
                {t('quantityExport.clearSelection')}
              </button>
            </div>
            <ul className="page-checkbox-list">
              {exportablePages.map((p) => (
                <li key={p}>
                  <label>
                    <input
                      type="checkbox"
                      checked={pageDialogPages.has(p)}
                      onChange={(e) => {
                        const next = new Set(pageDialogPages);
                        if (e.target.checked) next.add(p);
                        else next.delete(p);
                        setPageDialogPages(next);
                      }}
                    />
                    {p === currentPage ? t('quantityExport.pageCurrent', { page: p }) : t('quantityExport.page', { page: p })}
                  </label>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setPageDialogPages(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={pageDialogPages.size === 0}
                onClick={() => {
                  const pages = Array.from(pageDialogPages).sort((a, b) => a - b);
                  setPageDialogPages(null);
                  void runExportPdf(pages);
                }}
              >
                {t('common.export')}
              </button>
            </div>
          </div>
        </div>
      )}

      {excelDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{t('quantityExport.whichPages')}</h3>
            <p>{t('quantityExport.excelPagesIntro')}</p>
            <div className="form-row">
              <label>
                <input
                  type="radio"
                  name="excel-export-mode"
                  checked={excelDialog.mode === 'specific'}
                  onChange={() => setExcelDialog({ ...excelDialog, mode: 'specific' })}
                />{' '}
                {t('quantityExport.specificPage')}
              </label>
              {excelDialog.mode === 'specific' && (
                <select
                  value={excelDialog.page}
                  onChange={(e) => setExcelDialog({ ...excelDialog, page: parseInt(e.target.value, 10) })}
                >
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
                <input
                  type="radio"
                  name="excel-export-mode"
                  checked={excelDialog.mode === 'all'}
                  onChange={() => setExcelDialog({ ...excelDialog, mode: 'all' })}
                />{' '}
                {t('quantityExport.allPagesSummary')}
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setExcelDialog(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const pages = excelDialog.mode === 'all' ? exportablePages : [excelDialog.page];
                  setExcelDialog(null);
                  void runExportExcel(pages);
                }}
              >
                {t('common.export')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
