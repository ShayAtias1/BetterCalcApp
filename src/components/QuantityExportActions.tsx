import { useMemo, useState } from 'react';
import Icon from './Icon';
import ExportContentPicker from './ExportContentPicker';
import { useAppStore } from '../store/appStore';
import { planForReport } from '../lib/reportTitle';
import { buildReportCategoryTotals, buildRoomSummaries } from '../lib/quantities';
import { exportQuantitiesToExcel } from '../lib/exportExcel';
import { exportQuantitiesToPdf, getExportablePageNumbers } from '../lib/exportQuantitiesPdf';
import { quantityExportDetails, trackedExport } from '../lib/analytics';
import { notifyExportFailed } from '../lib/exportFailure';
import { hasStructuralData, withStructuralPages } from '../lib/structuralPlan';
import { EXPORT_SECTIONS, availableContent, everything, hasAnyContent, type ExportContent } from '../lib/exportContent';
import { useLanguage, useT } from '../i18n';

/** The workbook has no plan drawing, so no plan section. */
const EXCEL_SECTIONS = ['finishes', 'concrete', 'rebar'] as const;

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
  const overlayVisible = useAppStore((s) => s.overlayVisible);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // The PDF dialog: what to export (sections) and which pages - two separate choices.
  const [pdfDialog, setPdfDialog] = useState<{ pages: Set<number>; content: ExportContent } | null>(null);
  const [excelDialog, setExcelDialog] = useState<{ mode: 'specific' | 'all'; page: number; content: ExportContent } | null>(null);

  const summaries = useMemo(() => (project ? buildRoomSummaries(project) : []), [project]);

  if (!project) return null;

  const hasAreaMeasurements = (project.measurements ?? []).some((m) => m.tool === 'area' && m.areaKind);
  // Concrete and rebar are exportable on their own: a plan with only those still has a report.
  const canExport = summaries.length > 0 || hasAreaMeasurements || hasStructuralData(project);
  const exportablePages = getExportablePageNumbers(project);
  const available = availableContent(project, summaries.length > 0 || hasAreaMeasurements, exportablePages.length > 0);
  // The workbook has no plan drawing: only the three quantity domains.
  const excelAvailable: ExportContent = { ...available, plan: false };
  const surface = variant === 'menu' ? 'topbar_menu' : 'quantities_panel';

  const runExportExcel = async (pageNumbers: number[], content: ExportContent) => {
    setExportingExcel(true);
    try {
      const roomPageById = new Map(project.rooms.map((r) => [r.id, r.pageNumber]));
      const pageSet = new Set(pageNumbers);
      // Finishes only when chosen: without it the workbook carries neither rooms nor area measurements.
      const filteredSummaries = content.finishes ? summaries.filter((s) => pageSet.has(roomPageById.get(s.roomId) ?? -1)) : [];
      const filteredTotals = buildReportCategoryTotals(project, filteredSummaries);
      const filteredAreaMeasurements = (content.finishes ? project.measurements ?? [] : []).filter(
        (m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number' && pageSet.has(m.pageNumber)
      );
      await trackedExport(
        { export_kind: 'quantity_excel', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToExcel(withStructuralPages(planForReport(project, projectName), pageSet), filteredSummaries, filteredTotals, filteredAreaMeasurements, content, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingExcel(false);
    }
  };

  // Always asks what to export; the page choice (a page or all) is part of the same dialog.
  const handleExportExcel = () => {
    onPicked?.();
    setExcelDialog({ mode: exportablePages.length > 1 ? 'specific' : 'all', page: exportablePages.includes(currentPage) ? currentPage : exportablePages[0], content: everything(excelAvailable) });
  };


  const runExportPdf = async (pageNumbers: number[], content: ExportContent) => {
    setExportingPdf(true);
    try {
      const roomPageById = new Map(project.rooms.map((r) => [r.id, r.pageNumber]));
      const pageSet = new Set(pageNumbers);
      const filteredSummaries = summaries.filter((s) => pageSet.has(roomPageById.get(s.roomId) ?? -1));
      const filteredTotals = buildReportCategoryTotals(project, filteredSummaries);
      await trackedExport(
        { export_kind: 'quantity_pdf', surface, ...quantityExportDetails(project, filteredSummaries, pageNumbers, exportablePages.length) },
        () => exportQuantitiesToPdf(planForReport(project, projectName), filteredSummaries, filteredTotals, overlayVisible, pageNumbers, content, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingPdf(false);
    }
  };

  // Always asks what to export; the page list is only shown when there is more than one page.
  const handleExportPdf = () => {
    onPicked?.();
    setPdfDialog({
      pages: new Set(exportablePages.length > 1 && exportablePages.includes(currentPage) ? [currentPage] : exportablePages),
      content: everything(available),
    });
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

      {pdfDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{t('quantityExport.pdfTitle')}</h3>
            <ExportContentPicker sections={EXPORT_SECTIONS} labels="pdf" content={pdfDialog.content} available={available} onChange={(content) => setPdfDialog({ ...pdfDialog, content })} />
            <p className="muted">{t('quantityExport.contentHint')}</p>
            {exportablePages.length > 1 && (
              <>
                <span className="section-label">{t('quantityExport.whichPages')}</span>
                <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                  <button className="btn-secondary small" onClick={() => setPdfDialog({ ...pdfDialog, pages: new Set(exportablePages) })}>
                    {t('quantityExport.selectAll')}
                  </button>
                  <button className="btn-secondary small" onClick={() => setPdfDialog({ ...pdfDialog, pages: new Set() })}>
                    {t('quantityExport.clearSelection')}
                  </button>
                </div>
                <ul className="page-checkbox-list">
                  {exportablePages.map((p) => (
                    <li key={p}>
                      <label>
                        <input
                          type="checkbox"
                          checked={pdfDialog.pages.has(p)}
                          onChange={(e) => {
                            const next = new Set(pdfDialog.pages);
                            if (e.target.checked) next.add(p);
                            else next.delete(p);
                            setPdfDialog({ ...pdfDialog, pages: next });
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
              <button className="btn-secondary" onClick={() => setPdfDialog(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!hasAnyContent(pdfDialog.content) || pdfDialog.pages.size === 0}
                onClick={() => {
                  const pages = Array.from(pdfDialog.pages).sort((a, b) => a - b);
                  const content = pdfDialog.content;
                  setPdfDialog(null);
                  void runExportPdf(pages, content);
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
            <h3>{t('quantityExport.excelTitle')}</h3>
            <ExportContentPicker
              sections={EXCEL_SECTIONS}
              content={excelDialog.content}
              available={excelAvailable}
              onChange={(content) => setExcelDialog({ ...excelDialog, content })}
            />
            {exportablePages.length > 1 && (
              <>
                <span className="section-label">{t('quantityExport.whichPages')}</span>
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
                    <select value={excelDialog.page} onChange={(e) => setExcelDialog({ ...excelDialog, page: parseInt(e.target.value, 10) })}>
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
                    <input type="radio" name="excel-export-mode" checked={excelDialog.mode === 'all'} onChange={() => setExcelDialog({ ...excelDialog, mode: 'all' })} />{' '}
                    {t('quantityExport.allPagesSummary')}
                  </label>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setExcelDialog(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                disabled={!hasAnyContent(excelDialog.content)}
                onClick={() => {
                  const pages = excelDialog.mode === 'all' ? exportablePages : [excelDialog.page];
                  const content = excelDialog.content;
                  setExcelDialog(null);
                  void runExportExcel(pages, content);
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
