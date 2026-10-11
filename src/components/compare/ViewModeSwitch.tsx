import { useCompareStore } from '../../store/compareStore';
import type { CompareViewMode } from '../../types/compare';
import Icon, { type IconName } from '../Icon';
import { useT } from '../../i18n';

/** Labels come from the dictionary: `compare.viewModes.<mode>` and `<mode>Hint`. */
const MODES: { mode: CompareViewMode; icon: IconName }[] = [
  { mode: 'overlay', icon: 'layers' },
  { mode: 'swipe', icon: 'swipe' },
  { mode: 'blink', icon: 'blink' },
];

/**
 * How the two plans are compared. In the desktop header it is the centred segmented switch of the
 * approved design (text only); elsewhere the icon segmented control.
 */
export default function ViewModeSwitch({ variant = 'tools' }: { variant?: 'tools' | 'tabs' }) {
  const viewMode = useCompareStore((s) => s.viewMode);
  const setViewMode = useCompareStore((s) => s.setViewMode);
  const t = useT();

  if (variant === 'tabs') return (
    <div className="segmented-tabs top-bar-domains" role="tablist" aria-label={t('compare.viewModes.label')}>
      {MODES.map((m) => (
        <button key={m.mode} role="tab" aria-selected={viewMode === m.mode} className={viewMode === m.mode ? 'active' : ''}
          onClick={() => setViewMode(m.mode)} title={t(`compare.viewModes.${m.mode}Hint`)}>
          {t(`compare.viewModes.${m.mode}`)}
        </button>
      ))}
    </div>
  );
  return (
    <div className="segmented compact" role="group" aria-label={t('compare.viewModes.label')}>
      {MODES.map((m) => (
        <button
          key={m.mode}
          className={`tool-btn ${viewMode === m.mode ? 'active' : ''}`}
          onClick={() => setViewMode(m.mode)}
          aria-pressed={viewMode === m.mode}
          title={t(`compare.viewModes.${m.mode}Hint`)}
        >
          <Icon name={m.icon} />
          <span className="tool-label">{t(`compare.viewModes.${m.mode}`)}</span>
        </button>
      ))}
    </div>
  );
}
