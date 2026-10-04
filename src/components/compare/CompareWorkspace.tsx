import { useWorkspaceLayout } from '../../hooks/useWorkspaceLayout';
import AdaptiveInspector from '../AdaptiveInspector';
import CompareCompactHeader from './CompareCompactHeader';
import ViewModeSwitch from './ViewModeSwitch';
import { useRef, useState } from 'react';
import CompareTopBar from './CompareTopBar';
import CompareCanvas, { type CompareCanvasHandle } from './CompareCanvas';
import LayerPanel from './LayerPanel';
import AlignmentTools from './AlignmentTools';
import MeasureToolbar from './MeasureToolbar';
import MarkupToolbar from './MarkupToolbar';
import CompareCalibrationDialog from './CompareCalibrationDialog';
import CompareContextBar from './CompareContextBar';
import ChangesPanel from './ChangesPanel';
import Icon from '../Icon';
import { useCompareStore } from '../../store/compareStore';
import { exportCompositesAsPdf, type ChangeTable, type CompositeImage } from '../../lib/exportComparePdf';
import { changeTableFor, planCompareExport } from '../../lib/compareExportPlan';
import { trackedExport } from '../../lib/analytics';
import { notifyExportFailed } from '../../lib/exportFailure';
import { useLanguage, useT } from '../../i18n';
import { exportContext } from '../../lib/exportLanguage';

type SidebarTab = 'layers' | 'measure' | 'markup';

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
  const toolMode = useCompareStore((s) => s.toolMode);
  const setToolMode = useCompareStore((s) => s.setToolMode);
  const comparison = useCompareStore((s) => s.comparison);
  const setActiveRevisionId = useCompareStore((s) => s.setActiveRevisionId);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const setCurrentPageKey = useCompareStore((s) => s.setCurrentPageKey);
  const originalNumPages = useCompareStore((s) => s.originalNumPages);
  const [tab, setTab] = useState<SidebarTab>('layers');
  const canvasRef = useRef<CompareCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);

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
        alert(skipped.length > 0 ? t('compare.exportNothingSkipped', { skipped: skipped.join(', ') }) : t('compare.exportNothing'));
        return null;
      }
      if (skipped.length > 0) {
        alert(t('compare.exportSkipped', { skipped: skipped.join(', ') }));
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

  return (
    <div className="workspace">
      {layout === 'expanded' && !reviewOnly ? <CompareTopBar onExport={runExport} exporting={exporting} /> : <CompareCompactHeader />}
      {layout !== 'expanded' && <div className="compact-workspace-actions">
        <span className="muted">{t('adaptive.browse')}</span>
        <button className="btn-ghost" onClick={() => setPanel(panel === 'items' ? 'plan' : 'items')}>{t('adaptive.view')}</button>
        <button className="btn-ghost" onClick={() => setPanel(panel === 'quantities' ? 'plan' : 'quantities')}>{t('compare.changes.title')}</button>
      </div>}
      <div className="workspace-body">
        {/* The same icon-only rail as the takeoff workspace: canvas interaction only, the tool
            name carried by the tooltip. */}
        {!review && <div className="toolbar">
          <button
            className={`tool-btn ${toolMode === 'select' ? 'active' : ''}`}
            onClick={() => setToolMode('select')}
            aria-label={t('compare.tools.select')}
            aria-pressed={toolMode === 'select'}
            title={t('compare.tools.selectHint')}
          >
            <Icon name="select" size={20} />
          </button>
          <button
            className={`tool-btn ${toolMode === 'pan' ? 'active' : ''}`}
            onClick={() => setToolMode('pan')}
            aria-label={t('compare.tools.pan')}
            aria-pressed={toolMode === 'pan'}
            title={t('compare.tools.panHint')}
          >
            <Icon name="pan" size={20} />
          </button>

          <span className="toolbar-sep" />

          {/* Aligning the revised layer is a canvas interaction, so its drag mode belongs on the
              rail next to the other two; the numeric controls stay in the sidebar. */}
          <button
            className={`tool-btn ${toolMode === 'align' ? 'active' : ''}`}
            onClick={() => setToolMode(toolMode === 'align' ? 'select' : 'align')}
            aria-label={t('compare.tools.align')}
            aria-pressed={toolMode === 'align'}
            title={t('compare.tools.alignHint')}
          >
            <Icon name="move" size={20} />
          </button>
        </div>}
        <div className="viewer-area">
          <CompareCanvas ref={canvasRef} />
          {!review && <CompareCalibrationDialog />}
        </div>
        <AdaptiveInspector open={panel === 'items'} onClose={() => setPanel('plan')} title={t('adaptive.view')}>
          {/* Comparison context (revision, page mapping, scale, alignment) above the tabs, so it is
              present in every tab rather than buried in the layer panel. */}
          {!review && <CompareContextBar />}
          {!review && <div className="sidebar-tabs">
            <button className={!review && tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>
              {t('compare.tabs.layers')}
            </button>
            <button className={!review && tab === 'measure' ? 'active' : ''} onClick={() => setTab('measure')}>
              {t('compare.tabs.measure')}
            </button>
            <button className={!review && tab === 'markup' ? 'active' : ''} onClick={() => setTab('markup')}>
              {t('compare.tabs.markup')}
            </button>
          </div>}
          <div className="sidebar-content">
            {review && <><p className="muted">{t('adaptive.reviewOnly')}</p><ViewModeSwitch /></>}
            {!review && tab === 'layers' && (
              <>
                <LayerPanel />
                <AlignmentTools />
              </>
            )}
            {!review && tab === 'measure' && <MeasureToolbar />}
            {!review && tab === 'markup' && <MarkupToolbar />}
          </div>
        </AdaptiveInspector>
      </div>
      {/* Demolition / new construction review, across the full workspace width under the canvas. */}
      <ChangesPanel mobileOpen={panel === 'quantities'} onMobileClose={() => setPanel('plan')} />
      {layout === 'narrow' && <nav className="mobile-destinations">
        {(['plan', 'items', 'quantities'] as const).map((next) => <button key={next} aria-current={panel === next ? 'page' : undefined} onClick={() => setPanel(next)}>{t(`adaptive.${next}`)}</button>)}
      </nav>
    </div>
  );
}
