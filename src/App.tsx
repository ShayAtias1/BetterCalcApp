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
import PageStatusBar from './components/PageStatusBar';
import MeasureToolbar from './components/MeasureToolbar';
import MarkupToolbar from './components/MarkupToolbar';
import ConcretePanel from './components/ConcretePanel';
import RebarPanel from './components/RebarPanel';
import CompareWorkspace from './components/compare/CompareWorkspace';
import BrandLogo from './components/BrandLogo';
import LanguageSwitch from './components/LanguageSwitch';
import { useT } from './i18n';

/** Quantities is no longer one of these — it has the full-width bottom panel instead. */
type SidebarTab = 'rooms' | 'measure' | 'markup' | 'concrete' | 'rebar';

function Workspace() {
  const t = useT();
  const [tab, setTab] = useState<SidebarTab>('rooms');
  const planId = useAppStore((s) => s.project?.id);

  // The Concrete and Rebar tabs are what make a finished polygon or rectangle a concrete or rebar
  // zone; every other tab keeps the original behavior (a room). Each tab clears the selections of
  // the others, so only one kind of item is ever open. Re-asserted when the plan changes, because
  // opening or closing a plan resets the store's target while this tab state survives.
  useEffect(() => {
    const store = useAppStore.getState();
    store.setDrawTarget(tab === 'concrete' ? 'concrete' : tab === 'rebar' ? 'rebar' : 'room');
    if (tab === 'concrete' || tab === 'rebar') store.setSelectedRoomId(null);
    if (tab !== 'concrete') store.setSelectedConcreteId(null);
    if (tab !== 'rebar') store.setSelectedRebarId(null);
  }, [tab, planId]);

  return (
    <div className="workspace">
      <TopBar />
      {/* Canvas + sidebar on one row; the quantities panel is a sibling BELOW that row, so opening
          it shortens the row instead of covering the plan, and the canvas gets the space back when
          it closes. Nothing here changes the canvas transform. */}
      <div className="workspace-body">
        <Toolbar />
        <div className="viewer-area">
          <PdfViewer />
          <CalibrationDialog />
        </div>
        <div className="sidebar">
          {/* Page + calibration state sits above the tabs, so it is present in every tab. */}
          <PageStatusBar />
          <div className="sidebar-tabs content-sized">
            <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>
              {t('workspace.tabs.rooms')}
            </button>
            <button className={tab === 'concrete' ? 'active' : ''} onClick={() => setTab('concrete')}>
              {t('workspace.tabs.concrete')}
            </button>
            <button className={tab === 'rebar' ? 'active' : ''} onClick={() => setTab('rebar')}>
              {t('workspace.tabs.rebar')}
            </button>
            <button className={tab === 'measure' ? 'active' : ''} onClick={() => setTab('measure')}>
              {t('workspace.tabs.measure')}
            </button>
            <button className={tab === 'markup' ? 'active' : ''} onClick={() => setTab('markup')}>
              {t('workspace.tabs.markup')}
            </button>
          </div>
          <div className="sidebar-content">
            {tab === 'rooms' && <RoomPanel />}
            {tab === 'measure' && <MeasureToolbar />}
            {tab === 'markup' && <MarkupToolbar />}
            {tab === 'concrete' && <ConcretePanel />}
            {tab === 'rebar' && <RebarPanel />}
          </div>
        </div>
      </div>
      <QuantitiesPanel />
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

export default function App() {
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
