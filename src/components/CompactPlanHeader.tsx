import { selectSaveState, useAppStore } from '../store/appStore';
import { isPageCalibrated } from '../lib/quantities';
import { OVERLAY_KEYS } from '../lib/overlayVisibility';
import { useT } from '../i18n';
import AdaptiveHeader from './AdaptiveHeader';
import GridMenuSection from './GridMenuSection';
import QuantityExportActions from './QuantityExportActions';

const overlayLabel = { finishes: 'workspace.tabs.rooms', concrete: 'workspace.tabs.concrete', rebar: 'workspace.tabs.rebar', measurements: 'workspace.tabs.measure', markups: 'workspace.tabs.markup' } as const;
export default function CompactPlanHeader() {
  const t = useT();
  const plan = useAppStore((s) => s.project);
  const plans = useAppStore((s) => s.projectPlans);
  const sheet = useAppStore((s) => s.currentPage);
  const count = useAppStore((s) => s.numPages);
  const onSheet = useAppStore((s) => s.setCurrentPage);
  const openPlan = useAppStore((s) => s.openPlan);
  const closePlan = useAppStore((s) => s.closePlan);
  const visible = useAppStore((s) => s.overlayVisible);
  const setVisible = useAppStore((s) => s.setOverlayVisible);
  const saveState = useAppStore(selectSaveState);
  if (!plan) return null;
  return <AdaptiveHeader title={plan.name} sheet={sheet} sheetCount={count} onSheet={onSheet}
    onBack={() => void closePlan()} saveState={saveState} calibrated={isPageCalibrated(plan, sheet)}
    picker={<label className="adaptive-sheet-picker">{t('topBar.plans')}<select value={plan.id} onChange={(e) => void openPlan(e.target.value)}>
      {plans.map((p) => <option key={p.id} value={p.id}>{p.id === plan.id ? plan.name : p.name}</option>)}
    </select></label>}
    view={<>{OVERLAY_KEYS.map((key) => <button className="menu-item" key={key} aria-pressed={visible[key]} onClick={() => setVisible(key, !visible[key])}>
      {visible[key] ? '✓ ' : ''}{t(overlayLabel[key])}
    </button>)}<GridMenuSection /></>}
    more={<QuantityExportActions variant="menu" />}
  />;
}
