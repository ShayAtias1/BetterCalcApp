import { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { useCompareStore } from './store/compareStore';
import StartScreen from './components/StartScreen';
import ProjectOverview from './components/ProjectOverview';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import PdfViewer from './components/PdfViewer';
import CalibrationDialog from './components/CalibrationDialog';
import RoomPanel from './components/RoomPanel';
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

/** Quantities is no longer one of these — it has the full-width bottom panel instead. */
type SidebarTab = 'rooms' | 'measure' | 'markup' | 'concrete' | 'rebar';

function Workspace() {
  const t = useT();
  const [tab, setTab] = useState<SidebarTab>('rooms');
  const planId = useAppStore((s) => s.project?.id);

  const { layout, reviewOnly } = useWorkspaceLayout();
  const [destination, setDestination] = useState<'plan' | 'items' | 'quantities'>('plan');
  const drawTarget = useAppStore((s) => s.drawTarget);
  const activeTab = tab === 'measure' || tab === 'markup' ? tab : drawTarget === 'room' ? 'rooms' : drawTarget;
  // Only an explicit context choice changes the authoring domain. Panel visibility is independent.
  const chooseTab = (next: SidebarTab) => {
    setTab(next);
    const store = useAppStore.getState();
    const target = next === 'concrete' ? 'concrete' : next === 'rebar' ? 'rebar' : 'room';
    if (store.drawTarget !== target && store.toolMode !== 'select' && store.toolMode !== 'pan') store.setToolMode('select');
    store.setDrawTarget(target);
  };
  useEffect(() => { setTab('rooms'); setDestination('plan'); }, [planId]);

  return (
    <div className="workspace">
      {layout === 'expanded' && !reviewOnly ? <TopBar /> : <CompactPlanHeader />}
      {layout !== 'expanded' && <div className="compact-workspace-actions">
        <span className="muted">{t('adaptive.browse')}</span>
        <button className="btn-ghost" aria-expanded={destination === 'items'} onClick={() => setDestination(destination === 'items' ? 'plan' : 'items')}>{t('adaptive.items')}</button>
        <button className="btn-ghost" aria-expanded={destination === 'quantities'} onClick={() => setDestination(destination === 'quantities' ? 'plan' : 'quantities')}>{t('adaptive.quantities')}</button>
      </div>}
      {/* Canvas + sidebar on one row; the quantities panel is a sibling BELOW that row, so opening
          it shortens the row instead of covering the plan, and the canvas gets the space back when
          it closes. Nothing here changes the canvas transform. */}
      <div className="workspace-body">
        {!reviewOnly && <Toolbar />}
        <div className="viewer-area">
          <PdfViewer />
          {!reviewOnly && <CalibrationDialog />}
        </div>
        <AdaptiveInspector open={destination === 'items'} onClose={() => setDestination('plan')} title={t('adaptive.items')}>
          {/* Page + calibration state sits above the tabs, so it is present in every tab. */}
          <PageStatusBar readOnly={reviewOnly} />
          {layout === 'expanded' ? <div className="sidebar-tabs content-sized">
            {(['rooms', 'concrete', 'rebar', 'measure', 'markup'] as const).filter((next) => !reviewOnly || (next !== 'measure' && next !== 'markup')).map((next) =>
              <button key={next} className={activeTab === next ? 'active' : ''} onClick={() => chooseTab(next)}>{t(`workspace.tabs.${next}`)}</button>)}
          </div> : <label className="adaptive-domain-picker">{t('adaptive.domain')}
            <select value={activeTab} onChange={(e) => chooseTab(e.target.value as SidebarTab)}>
              {(['rooms', 'concrete', 'rebar', 'measure', 'markup'] as const).filter((next) => !reviewOnly || (next !== 'measure' && next !== 'markup')).map((next) =>
                <option key={next} value={next}>{t(`workspace.tabs.${next}`)}</option>)}
            </select>
          </label>}
          {reviewOnly && <p className="adaptive-review-note muted">{t('adaptive.reviewOnly')}</p>}
          <div className="sidebar-content">
            {activeTab === 'rooms' && <RoomPanel readOnly={reviewOnly} />}
            {!reviewOnly && activeTab === 'measure' && <MeasureToolbar />}
            {!reviewOnly && activeTab === 'markup' && <MarkupToolbar />}
            {activeTab === 'concrete' && <ConcretePanel readOnly={reviewOnly} />}
            {activeTab === 'rebar' && <RebarPanel readOnly={reviewOnly} />}
          </div>
        </AdaptiveInspector>
      </div>
      <QuantitiesPanel mobileOpen={destination === 'quantities'} onMobileClose={() => setDestination('plan')} />
      {layout === 'narrow' && <nav className="mobile-destinations" aria-label={t('adaptive.plan')}>
        {(['plan', 'items', 'quantities'] as const).map((next) => <button key={next} aria-current={destination === next ? 'page' : undefined} onClick={() => setDestination(next)}>{t(`adaptive.${next}`)}</button>)}
      </nav>
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
          {/* Two separate claims, both true: plan and project data never leave this browser;
              anonymous usage statistics (no plan content) may be sent — see docs/ANALYTICS.md. */}
          <span className="muted home-top-note">{t('home.privacyNote')}</span>
          <LanguageSwitch />
        </div>
      </div>

      {/* Projects are the one entrance: quantity plans and revision comparisons both live inside them. */}
      <div className="home-body">
        <div className="home-content">
          <StartScreen />
        </div>
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
  return <WorkspaceLayoutProvider><AppContent /></WorkspaceLayoutProvider>;
}
