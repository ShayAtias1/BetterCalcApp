import { useAppStore } from '../store/appStore';
import { isPageCalibrated } from '../lib/quantities';
import Icon from './Icon';
import { useT } from '../i18n';

/**
 * Compact scale state pinned above the sidebar tabs: whether the page on screen carries a scale,
 * and the way to fix that (the page number lives in the top bar, and the reference distance in the
 * calibration data — neither is repeated here). Visible from every tab, so "this page is not calibrated" is never
 * something the user has to go looking for — and it never blocks drawing.
 */
export default function PageStatusBar({ readOnly = false }: { readOnly?: boolean }) {
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const t = useT();

  if (!project) return null;

  const calibrated = isPageCalibrated(project, currentPage);
  const startCalibration = () => setToolMode(toolMode === 'calibrate' ? 'select' : 'calibrate');

  return (
    <div className={`page-status ${calibrated ? '' : 'uncalibrated'}`}>
      <div className="page-status-line">
        {/* A healthy page stays quiet: muted text and a ghost action that is still always present
            (never hover-only). A page that blocks calculation says so on a warning edge, with the
            action promoted to primary. */}
        {calibrated ? (
          <span className="page-status-state page-status-ok">
            <Icon name="check" size={13} />
            {t('pageStatus.calibrated')}
          </span>
        ) : (
          <span className="page-status-state cal-missing">
            <Icon name="alert" size={13} />
            {t('pageStatus.notCalibrated')}
          </span>
        )}
        {!readOnly && <button
          className={`${calibrated ? 'btn-ghost' : 'btn-primary'} small ${toolMode === 'calibrate' ? 'active' : ''}`}
          onClick={startCalibration}
        >
          {calibrated ? t('pageStatus.recalibrate') : t('pageStatus.calibrateNow')}
        </button>}
      </div>
    </div>
  );
}
