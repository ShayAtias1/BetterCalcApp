import { notify } from '../../lib/appDialogs';
import { useWorkspaceLayout } from '../../hooks/useWorkspaceLayout';
import AdaptiveInspector from '../AdaptiveInspector';
import CompareCompactHeader from './CompareCompactHeader';
import ViewModeSwitch from './ViewModeSwitch';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import CompareTopBar from './CompareTopBar';
import CompareCanvas, { type CompareCanvasHandle } from './CompareCanvas';
import LayerPanel from './LayerPanel';
import AlignmentTools from './AlignmentTools';
import MeasureToolbar from './MeasureToolbar';
import MarkupToolbar from './MarkupToolbar';
import CompareCalibrationDialog from './CompareCalibrationDialog';
import CompareContextBar from './CompareContextBar';
import ChangesPanel from './ChangesPanel';
import RevisionDetectPanel from './RevisionDetectPanel';
import { DEFAULT_AREA_KIND_COLORS } from '../../types';
import { resumeRevisionAi, useRevisionUi } from '../../lib/revision/revisionWorkflow';
import CompareToolDock, { type CompareSidebarTab } from './CompareToolDock';
import { PanelResizer, PanelRestoreButtons } from '../WorkspacePanels';
import { usePanelGridStyle, usePanelLayout } from '../panelLayout';
import ViewerWidthWatcher from '../ViewerWidthWatcher';
import type { PanelPart } from '../PanelPart';
import { useCompareStore } from '../../store/compareStore';
import { exportCompositesAsPdf, type ChangeTable, type CompositeImage } from '../../lib/exportComparePdf';
import { changeTableFor, planCompareExport } from '../../lib/compareExportPlan';
import { trackedExport } from '../../lib/analytics';
import { notifyExportFailed } from '../../lib/exportFailure';
import { useLanguage, useT } from '../../i18n';
import { exportContext } from '../../lib/exportLanguage';

type SidebarTab = CompareSidebarTab;

/** Polls `check` until it passes or the timeout elapses; returns whether it passed. */
async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      // One more frame so React has committed the overlay that goes with this raster.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

export default function CompareWorkspace() {
  const { layout, reviewOnly } = useWorkspaceLayout();
  const review = reviewOnly || layout !== 'expanded';
  const [panel, setPanel] = useState<'plan' | 'items' | 'quantities'>('plan');
  const t = useT();
  const language = useLanguage();
  const comparison = useCompareStore((s) => s.comparison);
  const setActiveRevisionId = useCompareStore((s) => s.setActiveRevisionId);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const setCurrentPageKey = useCompareStore((s) => s.setCurrentPageKey);
  const originalNumPages = useCompareStore((s) => s.originalNumPages);
  const [tab, setTab] = useState<SidebarTab>('layers');
  const selectedChangeId = useRevisionUi((s) => s.selectedChangeId);
  const placingType = useRevisionUi((s) => s.placingType);
  useEffect(() => {
    if (!placingType) return;
    setTab('detect');
    usePanelLayout.getState().setOpen('inspector', true);
  }, [placingType]);
  useEffect(() => {
    if (!selectedChangeId) return;
    setTab('detect');
    usePanelLayout.getState().setOpen('inspector', true);
    usePanelLayout.getState().setOpen('list', true);
  }, [selectedChangeId]);
  const canvasRef = useRef<CompareCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);
  // Classifications in flight when the comparison was last open are recovered by free status reads.
  const comparisonId = comparison?.id;
  useEffect(() => {
    if (comparisonId) resumeRevisionAi();
  }, [comparisonId]);

  /**
   * The one export path, for all four combinations of revision scope × page scope.
   *
   * The canvas shows one source page of one revision at a time, so the export walks the planned
   * pairs, waits for *both* layers to finish rasterizing that exact pair (`isReadyFor`), captures
   * it, and collects that pair's own change table. `canvasRef.current` is re-read after every await
   * so each capture uses the handle from the newest render, and the page and revision the user was
   * on are restored at the end.
   *
   * A pair whose mapped revised page does not exist in that revision's PDF is skipped and reported
   * — never exported as a source-only page dressed up as a comparison.
   */
  const runExport = async (revisionScope: 'active' | 'all', pageScope: 'current' | 'all') => {
    if (!comparison) return;
    const restoreRevisionId = comparison.activeRevisionId;
    const restorePageKey = currentPageKey;
    const pairs = planCompareExport(comparison, { revisionScope, pageScope, currentPageKey, originalNumPages });

    // Walks the planned pairs and writes the PDF; returns null when nothing could be exported.
    const exportPairs = async () => {
      const composites: CompositeImage[] = [];
      const tables: ChangeTable[] = [];
      const skipped: string[] = [];
      let shownRevisionId = comparison.activeRevisionId;
      for (const { revision, pageKey, label } of pairs) {
        if (revision && revision.id !== shownRevisionId) {
          setActiveRevisionId(revision.id);
          shownRevisionId = revision.id;
        }
        setCurrentPageKey(pageKey);
        const ready = await waitFor(() => canvasRef.current?.isReadyFor(revision?.id ?? '', pageKey) === true);
        if (!ready) {
          skipped.push(label);
          continue;
        }
        // The canvas renders the mapped revised page for this pair; this only refuses the pairs
        // where that mapped page is out of range for the revision's own PDF.
        if (revision && canvasRef.current?.isRevisedPageMissing()) {
          skipped.push(label);
          continue;
        }
        const composite = await canvasRef.current?.exportComposite(language);
        if (!composite) {
          skipped.push(label);
          continue;
        }
        composites.push(composite);
        tables.push(changeTableFor(comparison.name, revision, pageKey, language));
      }

      if (composites.length === 0) {
        notify(skipped.length > 0 ? t('compare.exportNothingSkipped', { skipped: skipped.join(', ') }) : t('compare.exportNothing'));
        return null;
      }
      if (skipped.length > 0) {
        notify(t('compare.exportSkipped', { skipped: skipped.join(', ') }));
      }
      const exportT = exportContext(language).t;
      const scopeName = pageScope === 'all' ? exportT('compare.exportScopeAll') : exportT('compare.exportScopePage', { page: restorePageKey });
      await exportCompositesAsPdf(composites, `${comparison.name}-${scopeName}`, tables, language);
      return { pages_count: composites.length };
    };

    const exportRegions = useCompareStore.getState().exportRegions;
    setExporting(true);
    try {
      await trackedExport(
        {
          export_kind: 'compare_pdf',
          surface: 'compare',
          comparison_id: comparison.id,
          project_id: comparison.projectId,
          page_scope: pageScope,
          revision_scope: revisionScope,
          revision_count: comparison.revisions.length,
          region_cropped: pageScope === 'current' ? !!exportRegions[restorePageKey] : Object.keys(exportRegions).length > 0,
        },
        exportPairs
      );
    } catch (err) {
      notifyExportFailed(err);
    } finally {
      if (restoreRevisionId) setActiveRevisionId(restoreRevisionId);
      setCurrentPageKey(restorePageKey);
      setExporting(false);
    }
  };

  const expanded = layout === 'expanded' && !reviewOnly;
  const panelOpen = usePanelLayout((s) => s.open);
  const panelGridStyle = usePanelGridStyle();
  const tabs: SidebarTab[] = ['layers', 'measure', 'markup', 'detect'];
  /** One half of the desktop split: the page's items at the inline start, tools and settings at the inline end. */
  const desktopPanel = (part: PanelPart) => {
    if (tab === 'measure') return <MeasureToolbar part={part} />;
    if (tab === 'markup') return <MarkupToolbar part={part} />;
    if (tab === 'detect') return <RevisionDetectPanel part={part} />;
    return part === 'list' ? <LayerPanel /> : <AlignmentTools />;
  };

  return (
    <div className="workspace compare-workspace" style={{
      ...(expanded ? panelGridStyle : {}),
      '--revision-demolition': (comparison?.areaKindColors ?? DEFAULT_AREA_KIND_COLORS).demolition,
      '--revision-construction': (comparison?.areaKindColors ?? DEFAULT_AREA_KIND_COLORS).construction,
    } as CSSProperties}>
      {expanded ? <CompareTopBar onExport={runExport} exporting={exporting} onDetectChanges={() => {
        setTab('detect');
        usePanelLayout.getState().setOpen('inspector', true);
        usePanelLayout.getState().setOpen('list', true);
      }} /> : <CompareCompactHeader />}
      {layout !== 'expanded' && <div className="compact-workspace-actions">
        <span className="muted">{t('adaptive.browse')}</span>
        <button className="btn-ghost" onClick={() => setPanel(panel === 'items' ? 'plan' : 'items')}>{t('adaptive.view')}</button>
        <button className="btn-ghost" onClick={() => setPanel(panel === 'quantities' ? 'plan' : 'quantities')}>{t('compare.changes.title')}</button>
      </div>}
      {/* The same frame as the takeoff workspace: layers and lists at the inline start, tools and
          settings at the inline end, the plan with its dock between them and the changes panel under
          the plan. Opening or hiding a panel resizes the plan; the canvas transform is untouched. */}
      <div className="workspace-body">
        <div className="viewer-area">
          <CompareCanvas ref={canvasRef} />
          {!review && <CompareToolDock onPanelTab={(next) => {
            setTab(next);
            usePanelLayout.getState().setOpen('inspector', true);
            if (next === 'detect') usePanelLayout.getState().setOpen('list', true);
          }} />}
          {!review && <CompareCalibrationDialog />}
          {expanded && <PanelRestoreButtons />}
          {expanded && <ViewerWidthWatcher />}
        </div>
        {expanded ? <>
          {panelOpen.list && <aside className="sidebar object-panel" aria-label={t(`compare.tabs.${tab}`)}>
            <div className="sidebar-tabs-row">
              <div className="sidebar-tabs" role="tablist">
                {tabs.map((next) => (
                  <button key={next} role="tab" aria-selected={tab === next} className={tab === next ? 'active' : ''} onClick={() => setTab(next)}>
                    {t(`compare.tabs.${next}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* Revision page, scale and alignment of the page on screen, present in every tab — the
                counterpart of the takeoff page-status strip. */}
            <CompareContextBar />
            <div className="sidebar-content">{desktopPanel('list')}</div>
            <PanelResizer side="list" />
          </aside>}
          {panelOpen.inspector && <aside className="sidebar inspector-panel" aria-label={t('workspace.inspector.tools')}>
            <div className="panel-head">
              <strong>{tab === 'layers' ? t('compare.alignment.title') : tab === 'detect' ? t('revisionAi.title') : t('workspace.inspector.tools')}</strong>
            </div>
            <div className="sidebar-content">{desktopPanel('detail')}</div>
            <PanelResizer side="inspector" />
          </aside>}
        </> : <AdaptiveInspector open={panel === 'items'} onClose={() => setPanel('plan')} title={t('adaptive.view')}>
          <div className="sidebar-content">
            <p className="muted">{t('adaptive.reviewOnly')}</p>
            <ViewModeSwitch />
            <RevisionDetectPanel part="list" readOnly />
          </div>
        </AdaptiveInspector>}
      </div>
      {/* Demolition / new construction review under the plan, in the same bottom panel as the quantities. */}
      <ChangesPanel mobileOpen={panel === 'quantities'} onMobileClose={() => setPanel('plan')} />
      {layout === 'narrow' && <nav className="mobile-destinations">
        {(['plan', 'items', 'quantities'] as const).map((next) => <button key={next} aria-current={panel === next ? 'page' : undefined} onClick={() => setPanel(next)}>{t(`adaptive.${next}`)}</button>)}
      </nav>}
    </div>
  );
}
