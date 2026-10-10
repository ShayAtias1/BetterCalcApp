import { selectCompareSaveState, useCompareStore } from '../../store/compareStore';
import { useT } from '../../i18n';
import AdaptiveHeader from '../AdaptiveHeader';
import ViewModeSwitch from './ViewModeSwitch';

export default function CompareCompactHeader() {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const sheet = useCompareStore((s) => s.currentPageKey);
  const count = useCompareStore((s) => s.originalNumPages);
  const setSheet = useCompareStore((s) => s.setCurrentPageKey);
  const setRevision = useCompareStore((s) => s.setActiveRevisionId);
  const saveState = useCompareStore(selectCompareSaveState);
  const annotations = useCompareStore((s) => s.annotationsVisible);
  const measurements = useCompareStore((s) => s.measurementsVisible);
  if (!comparison) return null;
  const close = async () => {
    const store = useCompareStore.getState();
    await store.persist();
    if (!useCompareStore.getState().saveError) store.setComparison(null);
  };
  return <AdaptiveHeader title={comparison.name} sheet={sheet} sheetCount={count} onSheet={setSheet}
    onBack={() => void close()} saveState={saveState} calibrated={!!comparison.pages[sheet]?.originalCalibration}
    picker={<label className="adaptive-sheet-picker">{t('adaptive.revision')}<select value={comparison.activeRevisionId ?? ''} onChange={(e) => setRevision(e.target.value)}>
      {comparison.revisions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select></label>}
    view={<><ViewModeSwitch />
      <button className="menu-item" aria-pressed={annotations} onClick={() => useCompareStore.getState().toggleAnnotationsVisible()}>{t('workspace.tabs.markup')}</button>
      <button className="menu-item" aria-pressed={measurements} onClick={() => useCompareStore.getState().toggleMeasurementsVisible()}>{t('workspace.tabs.measure')}</button>
    </>}
  />;
}
