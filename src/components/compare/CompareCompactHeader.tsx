import { selectCompareSaveState, useCompareStore } from '../../store/compareStore';
import { useT } from '../../i18n';
import Icon from '../Icon';
import AdaptiveHeader from '../AdaptiveHeader';
import ViewModeSwitch from './ViewModeSwitch';
import Select from '../Select';

export default function CompareCompactHeader({ onExport, exporting }: {
  onExport: (revisionScope: 'active' | 'all', pageScope: 'current' | 'all') => void;
  exporting: boolean;
}) {
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
  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
  const multiRevision = comparison.revisions.length > 1;
  // The same four exports as the desktop Export menu (page range x revisions), in this overflow menu.
  const exportItem = (pageScope: 'current' | 'all', revisionScope: 'active' | 'all') => {
    const pages = pageScope === 'all' ? t('compare.topBar.allPagesCount', { count }) : t('compare.topBar.currentPage', { page: sheet });
    const revisions = revisionScope === 'all' ? t('compare.topBar.allRevisions', { count: comparison.revisions.length }) : activeRevision?.label ?? t('compare.topBar.activeRevision');
    const blocked = revisionScope === 'all' && !multiRevision;
    return <button key={`${pageScope}-${revisionScope}`} className="menu-item" disabled={exporting || blocked}
      title={blocked ? t('compare.topBar.onlyOneRevision') : undefined} onClick={() => onExport(revisionScope, pageScope)}>
      <span className="menu-check"><Icon name={revisionScope === 'all' ? 'layers' : 'file'} size={13} /></span>{pages} - {revisions}
    </button>;
  };
  const close = async () => {
    const store = useCompareStore.getState();
    await store.persist();
    if (!useCompareStore.getState().saveError) store.setComparison(null);
  };
  return <AdaptiveHeader title={comparison.name} sheet={sheet} sheetCount={count} onSheet={setSheet}
    onBack={() => void close()} saveState={saveState} calibrated={!!comparison.pages[sheet]?.originalCalibration}
    picker={<label className="adaptive-sheet-picker">{t('adaptive.revision')}<Select value={comparison.activeRevisionId ?? ''} onChange={(e) => setRevision(e.target.value)}>
      {comparison.revisions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </Select></label>}
    more={<>
      <p className="menu-hint menu-section-title">{exporting ? t('common.exporting') : t('common.export')}</p>
      {exportItem('current', 'active')}{exportItem('current', 'all')}{exportItem('all', 'active')}{exportItem('all', 'all')}
    </>}
    view={<><ViewModeSwitch />
      <button className="menu-item" aria-pressed={annotations} onClick={() => useCompareStore.getState().toggleAnnotationsVisible()}>{t('workspace.tabs.markup')}</button>
      <button className="menu-item" aria-pressed={measurements} onClick={() => useCompareStore.getState().toggleMeasurementsVisible()}>{t('workspace.tabs.measure')}</button>
    </>}
  />;
}
