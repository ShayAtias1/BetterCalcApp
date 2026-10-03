import { useEffect, useState } from 'react';
import { selectCompareSaveState, useCompareStore } from '../../store/compareStore';
import { useAppStore } from '../../store/appStore';
import TopBarMenu, { type MenuId } from '../TopBarMenu';
import Icon, { type IconName } from '../Icon';
import { BrandHomeLink } from '../BrandLogo';
import ViewModeSwitch from './ViewModeSwitch';
import LanguageSwitch from '../LanguageSwitch';
import { useT } from '../../i18n';

export default function CompareTopBar({
  onExport,
  exporting,
}: {
  onExport: (revisionScope: 'active' | 'all', pageScope: 'current' | 'all') => void;
  exporting: boolean;
}) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const setComparison = useCompareStore((s) => s.setComparison);
  const updateComparisonMeta = useCompareStore((s) => s.updateComparisonMeta);
  const persist = useCompareStore((s) => s.persist);
  const currentProject = useAppStore((s) => s.currentProject);
  const toolMode = useCompareStore((s) => s.toolMode);
  const setToolMode = useCompareStore((s) => s.setToolMode);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const setCurrentPageKey = useCompareStore((s) => s.setCurrentPageKey);
  // The original defines the page keys; each revision maps its own page onto them.
  const numPages = useCompareStore((s) => s.originalNumPages);
  const exportRegions = useCompareStore((s) => s.exportRegions);
  const setExportRegion = useCompareStore((s) => s.setExportRegion);
  const setActiveRevisionId = useCompareStore((s) => s.setActiveRevisionId);
  const saveState = useCompareStore(selectCompareSaveState);
  const annotationsVisible = useCompareStore((s) => s.annotationsVisible);
  const toggleAnnotationsVisible = useCompareStore((s) => s.toggleAnnotationsVisible);
  const measurementsVisible = useCompareStore((s) => s.measurementsVisible);
  const toggleMeasurementsVisible = useCompareStore((s) => s.toggleMeasurementsVisible);
  const canUndo = useCompareStore((s) => s.history.length > 0);
  const canRedo = useCompareStore((s) => s.future.length > 0);
  const undo = useCompareStore((s) => s.undo);
  const redo = useCompareStore((s) => s.redo);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  // Which source pages an export covers. Session state of the menu, deliberately not persisted.
  const [pageScope, setPageScope] = useState<'current' | 'all'>('current');
  // Draft text of the page box, re-synced whenever the page changes some other way.
  const [pageInput, setPageInput] = useState(String(currentPageKey));
  useEffect(() => {
    setPageInput(String(currentPageKey));
  }, [currentPageKey]);

  // Enter (via blur) jumps to the typed page: out-of-range clamps, unparsable snaps back.
  const commitPageJump = () => {
    const parsed = parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPageKey));
      return;
    }
    const target = Math.min(Math.max(parsed, 1), numPages);
    setPageInput(String(target));
    if (target !== currentPageKey) setCurrentPageKey(target);
  };

  if (!comparison) return null;

  const exportRegion = exportRegions[currentPageKey] ?? null;
  const pagesLabel = pageScope === 'all' ? t('compare.topBar.allPages', { count: numPages }) : t('common.page', { page: currentPageKey });
  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);

  // Same status vocabulary as the takeoff bar: quiet when normal, colour only where attention is
  // actually required.
  const saveLabels: Record<typeof saveState, { text: string; title: string; icon: IconName }> = {
    saving: { text: t('topBar.save.saving'), title: t('topBar.save.savingComparison'), icon: 'reset' },
    saved: { text: t('topBar.save.saved'), title: t('topBar.save.savedHint'), icon: 'check' },
    unsaved: { text: t('topBar.save.unsaved'), title: t('topBar.save.unsavedHint'), icon: 'alert' },
    error: { text: t('topBar.save.error'), title: t('topBar.save.errorHint'), icon: 'alert' },
  };

  // Leaving saves first; closing drops back to the project overview (or home, with no project open).
  const close = async () => {
    await persist();
    // If the save failed the work is still only in memory — stay in the comparison.
    if (useCompareStore.getState().saveError) return;
    setComparison(null);
  };

  const runExport = (revisionScope: 'active' | 'all') => {
    setOpenMenu(null);
    onExport(revisionScope, pageScope);
  };

  return (
    <div className="top-bar" data-save-state={saveState}>
      {/* Group 1 — identity: the same mark and name field as the takeoff bar, plus the one piece
          of comparison context that must never require opening the sidebar. */}
      <div className="top-bar-group identity">
        <BrandHomeLink title={t('topBar.goHome')} />
        {currentProject && (
          <>
            <button className="btn-ghost small breadcrumb-project" onClick={() => void close()} title={t('topBar.backToOverview')}>
              {currentProject.name || t('topBar.unnamedProject')}
            </button>
            <Icon name="chevron-next" size={13} />
          </>
        )}
        <input
          className="project-name-input"
          dir="auto"
          value={comparison.name}
          onChange={(e) => updateComparisonMeta({ name: e.target.value })}
          title={t('compare.topBar.comparisonName')}
        />
        <input
          className="project-name-input apt-input"
          value={comparison.apartmentNumber}
          onChange={(e) => updateComparisonMeta({ apartmentNumber: e.target.value })}
          placeholder={t('compare.topBar.apartment')}
          title={t('compare.topBar.apartmentNumber')}
        />
        {/* Context, not a heading: what is compared against what, and where new revision-specific
            work lands. */}
        <span className="compare-context-chip" title={t('compare.topBar.revisionContext')}>
          <span className="muted">{t('compare.topBar.original')}</span>
          <Icon name="link" size={13} />
          {comparison.revisions.length > 0 ? (
            <select
              className="compare-revision-select"
              value={comparison.activeRevisionId}
              onChange={(e) => setActiveRevisionId(e.target.value)}
              aria-label={t('compare.topBar.revision')}
            >
              {comparison.revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="cal-missing">{t('compare.topBar.noRevision')}</span>
          )}
        </span>
      </div>

      {/* Group 2 — the document: where we are in it, how we look at it, and its history. */}
      <div className="top-bar-group grow">
        {/* Previous comes first in reading order, so it sits on the right under RTL and the left under LTR. */}
        <div className="page-nav">
          <button disabled={currentPageKey <= 1} onClick={() => setCurrentPageKey(currentPageKey - 1)} title={t('topBar.previousPage')}>
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
          <button disabled={currentPageKey >= numPages} onClick={() => setCurrentPageKey(currentPageKey + 1)} title={t('topBar.nextPage')}>
            <Icon name="chevron-next" />
          </button>
        </div>

        <span className="top-bar-sep" />

        {/* How the two plans are compared — the defining interaction of this workspace. */}
        <ViewModeSwitch />

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

      {/* Group 3 — output: what is drawn on the plan, what leaves the app, and the way out. */}
      <div className="top-bar-group output">
        <span className={`save-state save-state-${saveState}`} title={saveLabels[saveState].title}>
          <Icon name={saveLabels[saveState].icon} size={13} />
          {saveLabels[saveState].text}
        </span>

        <TopBarMenu
          id="view"
          openId={openMenu}
          setOpenId={setOpenMenu}
          icon={annotationsVisible && measurementsVisible ? 'eye' : 'eye-off'}
          label={t('topBar.view')}
          variant="ghost"
          title={t('compare.topBar.viewHint')}
          highlighted={!annotationsVisible || !measurementsVisible}
        >
          <button className="menu-item" onClick={toggleAnnotationsVisible}>
            <span className="menu-check">{annotationsVisible && <Icon name="check" size={13} />}</span>
            {t('compare.topBar.changeMarks')}
          </button>
          <button className="menu-item" onClick={toggleMeasurementsVisible}>
            <span className="menu-check">{measurementsVisible && <Icon name="check" size={13} />}</span>
            {t('topBar.measurements')}
          </button>
          <p className="menu-hint">{t('compare.topBar.viewNote')}</p>
        </TopBarMenu>

        {/* Export is the strongest action in the bar — the one filled control. */}
        <TopBarMenu
          id="export"
          openId={openMenu}
          setOpenId={setOpenMenu}
          icon="download"
          label={exporting ? t('common.exporting') : t('common.export')}
          title={t('compare.topBar.exportHint')}
          variant="primary"
          highlighted={!!exportRegion}
        >
          {/* Which pages, then which revisions — the two choices that define an export. */}
          <p className="menu-hint menu-section-title">{t('compare.topBar.pageRange')}</p>
          <button className={`menu-item ${pageScope === 'current' ? 'active' : ''}`} onClick={() => setPageScope('current')}>
            <span className="menu-check">{pageScope === 'current' && <Icon name="check" size={13} />}</span>
            {t('compare.topBar.currentPage', { page: currentPageKey })}
          </button>
          <button className={`menu-item ${pageScope === 'all' ? 'active' : ''}`} onClick={() => setPageScope('all')}>
            <span className="menu-check">{pageScope === 'all' && <Icon name="check" size={13} />}</span>
            {t('compare.topBar.allPagesCount', { count: numPages })}
          </button>

          <div className="menu-divider" />
          <p className="menu-hint menu-section-title">{t('common.export')}</p>
          <button className="menu-item" onClick={() => runExport('active')} disabled={exporting}>
            <span className="menu-check">
              <Icon name="file" size={13} />
            </span>
            {pagesLabel} - {activeRevision?.label ?? t('compare.topBar.activeRevision')}
          </button>
          <button
            className="menu-item"
            onClick={() => runExport('all')}
            disabled={exporting || comparison.revisions.length < 2}
            title={comparison.revisions.length < 2 ? t('compare.topBar.onlyOneRevision') : t('compare.topBar.allRevisionsHint')}
          >
            <span className="menu-check">
              <Icon name="layers" size={13} />
            </span>
            {pagesLabel} - {t('compare.topBar.allRevisions', { count: comparison.revisions.length })}
          </button>

          <div className="menu-divider" />
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
            <button className="menu-item" onClick={() => setExportRegion(currentPageKey, null)}>
              <span className="menu-check">
                <Icon name="close" size={13} />
              </span>
              {t('topBar.clearRegion')}
            </button>
          )}
          <p className="menu-hint">
            {exportRegion
              ? t('compare.topBar.regionNote')
              : t('compare.topBar.noRegionNote')}
          </p>
        </TopBarMenu>

        <button className="btn-ghost small" onClick={close} title={currentProject ? t('topBar.backToOverview') : t('compare.topBar.exitHint')}>
          <Icon name="exit" />
          <span className="btn-label">{currentProject ? t('topBar.projectOverviewShort') : t('compare.topBar.exit')}</span>
        </button>
        <LanguageSwitch />
      </div>
    </div>
  );
}
