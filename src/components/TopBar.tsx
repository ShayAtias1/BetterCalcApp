import { useEffect, useState } from 'react';
import { selectSaveState, useAppStore } from '../store/appStore';
import QuantityExportActions from './QuantityExportActions';
import LanguageSwitch from './LanguageSwitch';
import GridMenuSection from './GridMenuSection';
import TopBarMenu, { type MenuId } from './TopBarMenu';
import Icon, { type IconName } from './Icon';
import { BrandHomeLink } from './BrandLogo';
import { exportAllPlanPagesToPdf, exportPlanPageToPdf } from '../lib/exportRegionPdf';
import { planForReport } from '../lib/reportTitle';
import { trackedExport } from '../lib/analytics';
import { notifyExportFailed } from '../lib/exportFailure';
import { useLanguage, useT } from '../i18n';
import { OVERLAY_KEYS, exportAnnotationsVisible } from '../lib/overlayVisibility';

const OVERLAY_LABEL = {
  finishes: 'workspace.tabs.rooms',
  concrete: 'workspace.tabs.concrete',
  rebar: 'workspace.tabs.rebar',
  measurements: 'workspace.tabs.measure',
  markups: 'workspace.tabs.markup',
} as const;

export default function TopBar() {
  const t = useT();
  // Exports are written in the language the app is showing (Phase 6 may add a separate choice).
  const language = useLanguage();
  const project = useAppStore((s) => s.project);
  const currentProject = useAppStore((s) => s.currentProject);
  const projectPlans = useAppStore((s) => s.projectPlans);
  const openPlan = useAppStore((s) => s.openPlan);
  const closePlan = useAppStore((s) => s.closePlan);
  const duplicatePlan = useAppStore((s) => s.duplicatePlan);
  const currentPage = useAppStore((s) => s.currentPage);
  const numPages = useAppStore((s) => s.numPages);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const updateProjectMeta = useAppStore((s) => s.updateProjectMeta);
  const saveState = useAppStore(selectSaveState);
  const overlayVisible = useAppStore((s) => s.overlayVisible);
  const setOverlayVisible = useAppStore((s) => s.setOverlayVisible);
  // The plan exports have one switch for rooms and markups together: hidden only when both are.
  const annotationsVisible = exportAnnotationsVisible(overlayVisible);
  const measurementsVisible = overlayVisible.measurements;
  const allVisible = OVERLAY_KEYS.every((k) => overlayVisible[k]);
  const canUndo = useAppStore((s) => s.history.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const exportRegions = useAppStore((s) => s.exportRegions);
  const setExportRegion = useAppStore((s) => s.setExportRegion);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [exportingPage, setExportingPage] = useState(false);
  const [exportingAllPages, setExportingAllPages] = useState(false);
  // Draft text of the page box. Kept as a string so the field can be empty/mid-typing, and re-synced
  // whenever the page changes some other way (prev/next buttons, clicking a room in the list).
  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Enter (via blur) jumps to the typed page: out-of-range values clamp, anything unparsable just
  // snaps the box back to the current page. Goes through the same setCurrentPage as prev/next.
  const commitPageJump = () => {
    const parsed = parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }
    const target = Math.min(Math.max(parsed, 1), numPages);
    setPageInput(String(target));
    if (target !== currentPage) setCurrentPage(target);
  };

  if (!project) return null;

  const exportRegion = exportRegions[currentPage] ?? null;
  const exporting = exportingPage || exportingAllPages;

  // Just this page — cropped to its export region if one was chosen for it, full page otherwise.
  const handleExportPage = async () => {
    setOpenMenu(null);
    setExportingPage(true);
    try {
      await trackedExport(
        {
          export_kind: 'plan_page_pdf',
          surface: 'topbar_menu',
          plan_id: project.id,
          project_id: project.projectId,
          pages_count: 1,
          page_scope: 'current',
          region_cropped: !!exportRegion,
        },
        () => exportPlanPageToPdf(planForReport(project, currentProject?.name), currentPage, exportRegion, annotationsVisible, measurementsVisible, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingPage(false);
    }
  };

  // Every page in one PDF — each page cropped to its own export region if one was chosen, full page otherwise.
  const handleExportAllPages = async () => {
    setOpenMenu(null);
    setExportingAllPages(true);
    try {
      await trackedExport(
        {
          export_kind: 'plan_all_pages_pdf',
          surface: 'topbar_menu',
          plan_id: project.id,
          project_id: project.projectId,
          pages_count: numPages,
          page_scope: 'all',
          region_cropped: Object.keys(exportRegions).length > 0,
        },
        () => exportAllPlanPagesToPdf(planForReport(project, currentProject?.name), numPages, exportRegions, annotationsVisible, measurementsVisible, language)
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      setExportingAllPages(false);
    }
  };

  // Leaving a plan always saves it first; if the save failed the work is still only in memory, so
  // the store keeps the plan open rather than dropping it.
  const backToOverview = () => void closePlan();
  const switchPlan = (planId: string) => {
    setOpenMenu(null);
    void openPlan(planId);
  };
  const duplicateThisPlan = async () => {
    setOpenMenu(null);
    const copy = await duplicatePlan(project.id);
    if (copy) await openPlan(copy.id);
  };

  // The save state was already tracked; it is shown in the bar, but quietly — it is a status,
  // not an action, so only the states that need attention carry colour.
  const saveLabels: Record<typeof saveState, { text: string; title: string; icon: IconName }> = {
    saving: { text: t('topBar.save.saving'), title: t('topBar.save.savingPlan'), icon: 'reset' },
    saved: { text: t('topBar.save.saved'), title: t('topBar.save.savedHint'), icon: 'check' },
    unsaved: { text: t('topBar.save.unsaved'), title: t('topBar.save.unsavedHint'), icon: 'alert' },
    error: { text: t('topBar.save.error'), title: t('topBar.save.errorHint'), icon: 'alert' },
  };

  return (
    <div className="top-bar" data-save-state={saveState}>
      {/* Group 1 — identity: where we are. Logo (home), back to the project overview, then the plan (editable name). */}
      <div className="top-bar-group identity">
        <BrandHomeLink title={t('topBar.goHome')} />
        {currentProject && (
          <button className="btn-ghost small back-to-overview" onClick={backToOverview} title={t('topBar.backToOverview')}>
            <Icon name="chevron-previous" size={13} />
            {t('topBar.projectOverview')}
          </button>
        )}
        <input
          className="project-name-input"
          dir="auto"
          value={project.name}
          onChange={(e) => updateProjectMeta({ name: e.target.value })}
          title={t('topBar.planName')}
        />
      </div>

      {/* Group 2 — the document: where we are in it, and moving through its history. */}
      <div className="top-bar-group grow">
        {/* Plan switcher heads the document group — the identity group clips overflow, so its
            dropdown would be cut off there. */}
        <TopBarMenu id="plans" openId={openMenu} setOpenId={setOpenMenu} icon="layers" label={t('topBar.plans')} variant="ghost" title={t('topBar.plansHint')}>
          {projectPlans.map((p) => (
            <button key={p.id} className={`menu-item ${p.id === project.id ? 'active' : ''}`} onClick={() => switchPlan(p.id)}>
              <span className="menu-check">{p.id === project.id && <Icon name="check" size={13} />}</span>
              {p.id === project.id ? project.name : p.name}
            </button>
          ))}
          <div className="menu-divider" />
          <button className="menu-item" onClick={() => void duplicateThisPlan()}>
            <span className="menu-check">
              <Icon name="copy" size={13} />
            </span>
            {t('topBar.duplicatePlan')}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpenMenu(null);
              backToOverview();
            }}
          >
            <span className="menu-check">
              <Icon name="home" size={13} />
            </span>
            {t('topBar.projectOverview')}
          </button>
        </TopBarMenu>

        <span className="top-bar-sep" />

        {/* Previous comes first in reading order, so it sits on the right under RTL and the left under LTR. */}
        <div className="page-nav">
          <button disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)} title={t('topBar.previousPage')}>
            <Icon name="chevron-previous" />
          </button>
          <span>
            {t('topBar.page')}
            <input
              className="page-jump-input"
              type="number"
              min={1}
              max={numPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={commitPageJump}
              title={t('topBar.pageJumpHint', { count: numPages })}
            />
            / {numPages}
          </span>
          {/* Calibration state is not repeated here — the page-status strip above the sidebar tabs
              is the single place that reports it and offers the action. */}
          <button disabled={currentPage >= numPages} onClick={() => setCurrentPage(currentPage + 1)} title={t('topBar.nextPage')}>
            <Icon name="chevron-next" />
          </button>
        </div>

        <span className="top-bar-sep" />

        <div className="undo-redo-group">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title={t('topBar.undo')}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title={t('topBar.redo')}>
            <Icon name="redo" />
          </button>
        </div>
      </div>

      {/* Group 3 — output: what is on the plan, what leaves the app, and the way out. */}
      <div className="top-bar-group output">
        <span className={`save-state save-state-${saveState}`} title={saveLabels[saveState].title}>
          <Icon name={saveLabels[saveState].icon} size={13} />
          {saveLabels[saveState].text}
        </span>

        <TopBarMenu
          id="view"
          openId={openMenu}
          setOpenId={setOpenMenu}
          icon={allVisible ? 'eye' : 'eye-off'}
          label={t('topBar.view')}
          variant="ghost"
          title={t('topBar.viewHint')}
          highlighted={!allVisible}
        >
          {OVERLAY_KEYS.map((key) => (
            <button key={key} className="menu-item" onClick={() => setOverlayVisible(key, !overlayVisible[key])}>
              <span className="menu-check">{overlayVisible[key] && <Icon name="check" size={13} />}</span>
              {t(OVERLAY_LABEL[key])}
            </button>
          ))}
          <p className="menu-hint">{t('topBar.viewNote')}</p>
          <GridMenuSection />
        </TopBarMenu>

        {/* Export is the strongest action in the bar — the one filled control. */}
        <TopBarMenu
          id="export"
          openId={openMenu}
          setOpenId={setOpenMenu}
          icon="download"
          label={exporting ? t('common.exporting') : t('common.export')}
          title={t('topBar.exportHint')}
          variant="primary"
          highlighted={!!exportRegion}
        >
          {/* The quantity report is the product's main output, so it heads the menu. */}
          <p className="menu-hint menu-section-title">{t('topBar.quantityReport')}</p>
          <QuantityExportActions variant="menu" onPicked={() => setOpenMenu(null)} />

          <div className="menu-divider" />
          <p className="menu-hint menu-section-title">{t('topBar.markedPlan')}</p>
          <button className="menu-item" onClick={handleExportPage} disabled={exporting}>
            <span className="menu-check">
              <Icon name="map" size={13} />
            </span>
            {exportRegion ? t('topBar.selectedRegion', { page: currentPage }) : t('topBar.pageOnly', { page: currentPage })}
          </button>
          <button className="menu-item" onClick={handleExportAllPages} disabled={exporting || numPages <= 1}>
            <span className="menu-check">
              <Icon name="layers" size={13} />
            </span>
            {t('topBar.allPagesOneFile', { count: numPages })}
          </button>
          <button
            className={`menu-item ${toolMode === 'export-region' ? 'active' : ''}`}
            onClick={() => {
              setToolMode(toolMode === 'export-region' ? 'select' : 'export-region');
              setOpenMenu(null);
            }}
          >
            <span className="menu-check">
              <Icon name="crop" size={13} />
            </span>
            {exportRegion ? t('topBar.changeRegion') : t('topBar.chooseRegion')}
          </button>
          {exportRegion && (
            <button className="menu-item" onClick={() => setExportRegion(currentPage, null)}>
              <span className="menu-check">
                <Icon name="close" size={13} />
              </span>
              {t('topBar.clearRegion')}
            </button>
          )}
          <p className="menu-hint">
            {exportRegion
              ? t('topBar.regionNote')
              : t('topBar.noRegionNote')}
          </p>
        </TopBarMenu>

        <LanguageSwitch />
      </div>
    </div>
  );
}
