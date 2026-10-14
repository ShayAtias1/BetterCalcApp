import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useGridStore } from '../store/gridStore';
import { isPageCalibrated } from '../lib/quantities';
import { GRID_PRESETS_M, MAX_GRID_OPACITY, MIN_GRID_OPACITY, isPresetSpacing, parseGridSpacing } from '../lib/grid';
import Icon from './Icon';
import { useT } from '../i18n';

/**
 * The grid controls inside the View menu: on/off, spacing (presets or custom) and line strength.
 * `calibrated` is passed by viewers other than the takeoff one (Revision Compare), which own their scale.
 */
export default function GridMenuSection({ calibrated: calibratedOverride }: { calibrated?: boolean } = {}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const { enabled, spacingM, opacity, setEnabled, setSpacingM, setOpacity } = useGridStore();
  const [customMode, setCustomMode] = useState(!isPresetSpacing(spacingM));
  const [customText, setCustomText] = useState(String(spacingM));
  // The field is free text while typing; it follows the saved value only when that changes elsewhere.
  useEffect(() => setCustomText(String(spacingM)), [spacingM]);

  const calibrated = calibratedOverride ?? (!!project && isPageCalibrated(project, currentPage));
  const customInvalid = customMode && parseGridSpacing(customText) === null;

  return (
    <>
      <div className="menu-divider" />
      <button
        className="menu-item"
        onClick={() => setEnabled(!enabled)}
        disabled={!calibrated}
        title={calibrated ? undefined : t('topBar.gridNeedsScale')}
      >
        <span className="menu-check">{enabled && calibrated && <Icon name="check" size={13} />}</span>
        {t('topBar.grid')}
      </button>
      {!calibrated && <p className="menu-hint">{t('topBar.gridNeedsScale')}</p>}
      {calibrated && enabled && (
        <div className="grid-menu-controls">
          <div className="grid-spacing-row" role="group" aria-label={t('topBar.gridSpacing')}>
            {GRID_PRESETS_M.map((m) => (
              <button
                key={m}
                className={`btn-ghost small ${!customMode && Math.abs(spacingM - m) < 1e-9 ? 'active' : ''}`}
                onClick={() => {
                  setCustomMode(false);
                  setSpacingM(m);
                }}
              >
                {m < 1 ? t('topBar.gridCm', { n: Math.round(m * 100) }) : t('topBar.gridM', { n: m })}
              </button>
            ))}
            <button className={`btn-ghost small ${customMode ? 'active' : ''}`} onClick={() => setCustomMode(true)}>
              {t('topBar.gridCustom')}
            </button>
          </div>
          {customMode && (
            <label className="grid-custom-row">
              <span>{t('topBar.gridCustomLabel')}</span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={customText}
                aria-invalid={customInvalid}
                onChange={(e) => {
                  setCustomText(e.target.value);
                  const v = parseGridSpacing(e.target.value);
                  if (v !== null) setSpacingM(v);
                }}
              />
            </label>
          )}
          {customInvalid && <p className="menu-hint cal-missing">{t('topBar.gridCustomInvalid')}</p>}
          <label className="grid-custom-row">
            <span>{t('topBar.gridOpacity')}</span>
            <input
              type="range"
              min={MIN_GRID_OPACITY}
              max={MAX_GRID_OPACITY}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
          <p className="menu-hint">{t('topBar.gridNote')}</p>
        </div>
      )}
    </>
  );
}
