import BulkTakeoff from './components/BulkTakeoff';
import AppDialogs from './components/AppDialogs';
import MultiPlanAi from './components/MultiPlanAi';
import AiReviewWorkspace from './components/AiReviewWorkspace';
import AiOpeningsReviewWorkspace from './components/AiOpeningsReviewWorkspace';
import { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { useCompareStore } from './store/compareStore';
import StartScreen from './components/StartScreen';
import ProjectOverview from './components/ProjectOverview';
import TopBar, { type WorkDomain } from './components/TopBar';
import Toolbar from './components/Toolbar';
import PdfViewer from './components/PdfViewer';
import CalibrationDialog from './components/CalibrationDialog';
import RoomPanel from './components/RoomPanel';
import PhoneReview from './components/PhoneReview';
import QuantitiesPanel from './components/QuantitiesPanel';
import QuantityExportDialogs from './components/QuantityExportDialogs';
import PageStatusBar from './components/PageStatusBar';
import MeasureToolbar from './components/MeasureToolbar';
import MarkupToolbar from './components/MarkupToolbar';
import ConcretePanel from './components/ConcretePanel';
import RebarPanel from './components/RebarPanel';
import CompareWorkspace from './components/compare/CompareWorkspace';
import BrandLogo from './components/BrandLogo';
import AdaptiveInspector from './components/AdaptiveInspector';
import CompactPlanHeader from './components/CompactPlanHeader';
import { WorkspaceLayoutProvider, useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import LanguageSwitch from './components/LanguageSwitch';
import { useT } from './i18n';
import type { PanelPart } from './components/PanelPart';
import { useAiReviewMode, useAiReviewSync, useOpeningReviewSummary, useSpaceReviewSummary } from './components/aiReviewState';
import { PanelResizer, PanelRestoreButtons } from './components/WorkspacePanels';
import ViewerWidthWatcher from './components/ViewerWidthWatcher';
import { usePanelGridStyle, usePanelLayout } from './components/panelLayout';

/** The side panel's tabs: the active domain's objects (and openings, in finishes), then measurements and markups. */
type PanelTab = 'objects' | 'openings' | 'measure' | 'markup';
/** The compact layout keeps one picker over all five destinations. */
type CompactDestination = 'rooms' | 'measure' | 'markup' | 'concrete' | 'rebar';

function Workspace() {
  const t = useT();
  const [panelTab, setPanelTab] = useState<PanelTab>('objects');
  const planId = useAppStore((s) => s.project?.id);
  const currentPage = useAppStore((s) => s.currentPage);

  const { layout, reviewOnly, touchInput } = useWorkspaceLayout();
  const [destination, setDestination] = useState<'plan' | 'items' | 'quantities'>('plan');
  // The domain is the store's draw target, so selecting a concrete zone or rebar item on the plan
  // moves the panel with it.
  const domain = useAppStore((s) => s.drawTarget);
  const chooseDomain = (next: WorkDomain) => {
    setPanelTab('objects');
    const store = useAppStore.getState();
    if (store.drawTarget !== next && store.toolMode !== 'select' && store.toolMode !== 'pan') store.setToolMode('select');
    store.setDrawTarget(next);
  };
  // Openings are a finishes tab; in another domain the same choice means that domain's objects.
  const tab: PanelTab = panelTab === 'openings' && domain !== 'room' ? 'objects' : panelTab;
  // Rooms ⇄ openings is a change of what is being edited: drop a half-placed opening and its selection.
  const choosePanel = (next: PanelTab) => {
    const finishesObjects = (value: PanelTab) => value === 'objects' || value === 'openings';
    if (finishesObjects(next) && finishesObjects(tab) && next !== tab) {
      const store = useAppStore.getState();
      store.cancelOpeningPlacement();
      store.setToolMode('select');
      if (next === 'objects') store.selectPlanOpening(null);
    }
    setPanelTab(next);
  };
  // Selecting an opening (or starting to place one) shows the openings tab; selecting a room shows rooms.
  const selectedOpeningId = useAppStore((s) => s.selectedOpeningId);
  const openingPlacement = useAppStore((s) => s.openingPlacement);
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  useEffect(() => { if (selectedOpeningId || openingPlacement) setPanelTab((current) => current === 'objects' ? 'openings' : current); }, [selectedOpeningId, openingPlacement]);
  useEffect(() => { if (selectedRoomId) setPanelTab((current) => current === 'openings' ? 'objects' : current); }, [selectedRoomId]);
  const compactValue: CompactDestination = tab === 'measure' || tab === 'markup' ? tab : domain === 'room' ? 'rooms' : domain;
  const chooseCompact = (next: CompactDestination) => {
    if (next === 'measure' || next === 'markup') setPanelTab(next);
    else chooseDomain(next === 'rooms' ? 'room' : next);
  };
  useEffect(() => { setPanelTab('objects'); setDestination('plan'); }, [planId]);

  // Saved AI results are reviewed from the header's AI menu; while a review is open the side panels
  // show its queue and the selected suggestion (desktop only — tablet keeps the review window).
  const expanded = layout === 'expanded';
  useAiReviewSync(expanded);
  const reviewMode = useAiReviewMode((s) => s.mode);
  const setReviewMode = useAiReviewMode((s) => s.setMode);
  const spaceReview = useSpaceReviewSummary();
  const openingReview = useOpeningReviewSummary();
  const reviewing = expanded && reviewMode !== null;
  useEffect(() => {
    if (!reviewMode) return;
    const gone = reviewMode === 'spaces' ? !spaceReview.available : !openingReview.available;
    if (gone || domain !== 'room' || !expanded) setReviewMode(null);
  }, [reviewMode, spaceReview.available, openingReview.available, domain, expanded, setReviewMode]);
  const panelGridStyle = usePanelGridStyle();
  const panelOpen = usePanelLayout((s) => s.open);
  // Openings belong to the finishes objects; tablet and phone show them inside the rooms panel.
  const showObjects = tab === 'objects' || tab === 'openings';
  const desktopTabs: PanelTab[] = domain === 'room' ? ['objects', 'openings', 'measure', 'markup'] : ['objects', 'measure', 'markup'];
  // Measure and markup carry the dock's own short names, so four tabs fit the list panel in either language.
  const tabLabel = (value: PanelTab) => value === 'objects' ? t(`workspace.objects.${domain}`) : value === 'openings' ? t('workspace.objects.openings') : t(`workspace.dock.${value}`);
  /** One half of the desktop split: the list (inline start) or the selected item's details (inline end). */
  const desktopPanel = (part: PanelPart) => {
    if (tab === 'measure') return <MeasureToolbar part={part} />;
    if (tab === 'markup') return <MarkupToolbar part={part} />;
    if (domain === 'concrete') return <ConcretePanel part={part} />;
    if (domain === 'rebar') return <RebarPanel part={part} />;
    return <RoomPanel part={part} section={tab === 'openings' ? 'openings' : 'rooms'} />;
  };

  return (
    <div className="workspace takeoff-workspace" style={expanded ? panelGridStyle : undefined}>
      {layout === 'expanded' && !reviewOnly ? <TopBar domain={domain} onDomainChange={chooseDomain} /> : <CompactPlanHeader />}
      {layout !== 'expanded' && <div className="compact-workspace-actions">
        <span className="muted">{t('adaptive.browse')}</span>
        <button className="btn-ghost" aria-expanded={destination === 'items'} onClick={() => setDestination(destination === 'items' ? 'plan' : 'items')}>{t('adaptive.items')}</button>
        <button className="btn-ghost" aria-expanded={destination === 'quantities'} onClick={() => setDestination(destination === 'quantities' ? 'plan' : 'quantities')}>{t('adaptive.quantities')}</button>
      </div>}
      {/* Side panel + canvas on one row; the quantities panel sits under the canvas, so opening it
          shortens the canvas instead of covering the plan. Nothing here changes the canvas transform. */}
      <div className="workspace-body">
        <div className="viewer-area">
          <PdfViewer />
          {!reviewOnly && !touchInput && <Toolbar onPanelTab={choosePanel} openings={tab === 'openings' && expanded} contextBar={expanded} />}
          {!reviewOnly && <CalibrationDialog />}
          {expanded && <PanelRestoreButtons />}
          {expanded && <ViewerWidthWatcher />}
        </div>
        {reviewing && <div className="ai-review-bar" role="region" aria-label={t(reviewMode === 'spaces' ? 'aiReviewWorkspace.title' : 'openingAiReview.title')}>
          <strong>{t('aiMenu.reviewing', { title: t(reviewMode === 'spaces' ? 'aiReviewWorkspace.title' : 'openingAiReview.title'), page: currentPage })}</strong>
          <span className="ai-review-bar-chip">{t('aiMenu.savedResults')}</span>
          {/* Approved design (board 10): progress as a bar beside its count. */}
          <progress className="ai-review-bar-progress" max={Math.max(1, reviewMode === 'spaces' ? spaceReview.total : openingReview.total)}
            value={reviewMode === 'spaces' ? spaceReview.resolved : openingReview.resolved} aria-hidden="true" />
          <span className="muted" role="status">{reviewMode === 'spaces'
            ? t('aiReviewWorkspace.progress', { resolved: spaceReview.resolved, total: spaceReview.total })
            : t('openingAiReview.progress', { resolved: openingReview.resolved, total: openingReview.total })}</span>
          {reviewMode === 'spaces' && openingReview.available && <button className="btn-ghost small" onClick={() => setReviewMode('openings')}>
            {t('aiMenu.switchTo', { title: t('openingAiReview.title'), count: openingReview.pending })}</button>}
          {reviewMode === 'openings' && spaceReview.available && <button className="btn-ghost small" onClick={() => setReviewMode('spaces')}>
            {t('aiMenu.switchTo', { title: t('aiReviewWorkspace.title'), count: spaceReview.pending })}</button>}
          <button className="btn-primary small ai-review-bar-finish" onClick={() => setReviewMode(null)}>{t('aiMenu.finish')}</button>
        </div>}
        {layout === 'expanded' ? <>
          {/* Desktop: the list at the inline start, the selected item's details at the inline end. */}
          {panelOpen.list && <aside className="sidebar object-panel" aria-label={reviewing ? t(reviewMode === 'spaces' ? 'aiReviewWorkspace.title' : 'openingAiReview.title') : tabLabel(tab)}>
            {reviewing ? <div className="panel-head">
              <strong>{t(reviewMode === 'spaces' ? 'aiReviewWorkspace.title' : 'openingAiReview.title')}</strong>
            </div> : <div className="sidebar-tabs-row">
              <div className="sidebar-tabs" role="tablist">
                {desktopTabs.map((next) =>
                  <button key={next} role="tab" aria-selected={tab === next} className={tab === next ? 'active' : ''} onClick={() => choosePanel(next)}>
                    {tabLabel(next)}
                  </button>)}
              </div>
            </div>}
            {/* Desktop: the sheet's calibration state lives in the top bar beside the sheet navigation. */}
            <div className="sidebar-content">{reviewing
              ? reviewMode === 'spaces' ? <AiReviewWorkspace key={`${planId}:queue`} part="queue" /> : <AiOpeningsReviewWorkspace key={`${planId}:queue`} part="queue" />
              : desktopPanel('list')}</div>
            <PanelResizer side="list" />
          </aside>}
          {panelOpen.inspector && <aside className="sidebar inspector-panel" aria-label={t('workspace.inspector.label')}>
            <div className="panel-head">
              <strong>{t('workspace.inspector.label')}</strong>
            </div>
            <div className="sidebar-content">{reviewing
              ? reviewMode === 'spaces' ? <AiReviewWorkspace key={`${planId}:detail`} part="detail" /> : <AiOpeningsReviewWorkspace key={`${planId}:detail`} part="detail" />
              : desktopPanel('detail')}</div>
            <PanelResizer side="inspector" />
          </aside>}
        </> : <AdaptiveInspector open={destination === 'items'} onClose={() => setDestination('plan')} title={t('adaptive.items')}>
          <label className="adaptive-domain-picker">{t('adaptive.domain')}
            <select value={compactValue} onChange={(e) => chooseCompact(e.target.value as CompactDestination)}>
              {(['rooms', 'concrete', 'rebar', 'measure', 'markup'] as const).filter((next) => !reviewOnly || (next !== 'measure' && next !== 'markup')).map((next) =>
                <option key={next} value={next}>{t(`workspace.tabs.${next}`)}</option>)}
            </select>
          </label>
          {/* Page + calibration state sits under the tabs, so it is present in every tab. */}
          <PageStatusBar readOnly={reviewOnly} />
          {reviewOnly && <p className="adaptive-review-note muted">{t('adaptive.reviewOnly')}</p>}
          <div className="sidebar-content">
            {reviewOnly && <PhoneReview domain={domain} onShowPlan={() => setDestination('plan')} />}
            {!reviewOnly && showObjects && domain === 'room' && <RoomPanel />}
            {!reviewOnly && tab === 'measure' && <MeasureToolbar />}
            {!reviewOnly && tab === 'markup' && <MarkupToolbar />}
            {!reviewOnly && showObjects && domain === 'concrete' && <ConcretePanel />}
            {!reviewOnly && showObjects && domain === 'rebar' && <RebarPanel />}
          </div>
        </AdaptiveInspector>}
      </div>
      {!expanded && !reviewOnly && showObjects && domain === 'room' && <div className="ai-review-workspaces-row">
        <AiReviewWorkspace key={planId} />
        <AiOpeningsReviewWorkspace key={planId} />
      </div>}
      <QuantitiesPanel onMobileOpen={() => setDestination('quantities')} mobileOpen={destination === 'quantities'} onMobileClose={() => setDestination('plan')} />
      {layout === 'narrow' && <nav className="mobile-destinations" aria-label={t('adaptive.plan')}>
        {(['plan', 'items', 'quantities'] as const).map((next) => <button key={next} aria-current={destination === next ? 'page' : undefined} onClick={() => setDestination(next)}>{t(`adaptive.${next}`)}</button>)}
      </nav>}
      <QuantityExportDialogs />
    </div>
  );
}

function Home() {
  const t = useT();
  return (
    <div className="workspace home">
      {/* The same bar as the two workspaces, so the entrance and the rooms behind it are
          recognisably one product. */}
      <div className="top-bar">
        <div className="top-bar-group identity">
          <div className="app-brand" title="BetterCalc">
            <BrandLogo />
          </div>
        </div>
        <div className="top-bar-group grow" />
        <div className="top-bar-group output">
          <LanguageSwitch />
        </div>
      </div>

      {/* Projects are the one entrance: quantity plans and revision comparisons both live inside them. */}
      <div className="home-body">
        <div className="home-content">
          <StartScreen />
        </div>
        {/* Two separate claims, both true: plan and project data never leave this browser;
            anonymous usage statistics (no plan content) may be sent — see docs/ANALYTICS.md. */}
        <p className="muted home-footer-note">{t('home.privacyNote')}</p>
      </div>
    </div>
  );
}

/**
 * Warns before a close/refresh only while the project or the open comparison holds work that is not
 * on disk yet. The listener is attached solely while something is dirty, so read-only work and
 * in-app navigation never trigger it.
 */
function useUnsavedChangesGuard() {
  // Both stores are subscribed unconditionally — either side can hold unsaved work.
  const projectDirty = useAppStore((s) => s.dirty);
  const comparisonDirty = useCompareStore((s) => s.dirty);
  const dirty = projectDirty || comparisonDirty;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

function AppContent() {
  // `project` is the open plan; `currentProject` the project folder around it.
  const plan = useAppStore((s) => s.project);
  const currentProject = useAppStore((s) => s.currentProject);
  const comparison = useCompareStore((s) => s.comparison);
  useUnsavedChangesGuard();
  if (plan) return <Workspace />;
  if (comparison) return <CompareWorkspace />;
  if (currentProject) return <ProjectOverview />;
  return <Home />;
}

export default function App() {
  return <WorkspaceLayoutProvider><AppContent /><MultiPlanAi /><BulkTakeoff /><AppDialogs /></WorkspaceLayoutProvider>;
}
