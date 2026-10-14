import AreaShapePicker from './AreaShapePicker';
import { useAppStore } from '../store/appStore';
import type { AreaCalcMode, AreaKind } from '../types';
import { MEASUREMENT_DEFAULTS } from '../config/measurementDefaults';
import { round } from '../lib/geometry';
import { measurementLabel } from '../lib/measurementValues';
import { isPageCalibrated } from '../lib/quantities';
import Icon, { type IconName } from './Icon';
import { InspectorEmpty, type PanelPart } from './PanelPart';
import { useMeasureHint } from './toolHints';
import { MEASURE_ICONS, MEASURE_TOOLS } from './toolLists';
import { useT } from '../i18n';

// Labels: `measure.shapes.<shape>` and `measure.calcModes.<mode>`.
const AREA_CALC_MODES: { mode: AreaCalcMode; icon: IconName }[] = [
  { mode: 'footprint', icon: 'square' },
  { mode: 'wall', icon: 'dimension' },
];
const AREA_KINDS: AreaKind[] = ['demolition', 'construction'];

export default function MeasureToolbar({ part }: { part?: PanelPart } = {}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const measureTool = useAppStore((s) => s.measureTool);
  const setMeasureTool = useAppStore((s) => s.setMeasureTool);
  const deleteMeasurement = useAppStore((s) => s.deleteMeasurement);
  const updateMeasurement = useAppStore((s) => s.updateMeasurement);
  const hint = useMeasureHint();

  if (!project) return null;
  const hasCalibration = isPageCalibrated(project, currentPage);
  const pageMeasurements = (project.measurements ?? []).filter((m) => m.pageNumber === currentPage);
  const areaKindColors = project.areaKindColors ?? { demolition: '#eab308', construction: '#16a34a' };
  const wallHeightDefaultM = project.wallHeightDefaultM ?? MEASUREMENT_DEFAULTS.wallHeightM;

  const areaMeasurements = (project.measurements ?? []).filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const tallyByKind = (measurements: typeof areaMeasurements) => {
    const totals: Record<AreaKind, number> = { demolition: 0, construction: 0 };
    const counts: Record<AreaKind, number> = { demolition: 0, construction: 0 };
    for (const m of measurements) {
      totals[m.areaKind!] += m.areaM2!;
      counts[m.areaKind!] += 1;
    }
    return { totals, counts };
  };
  const pageNumbersWithAreas = Array.from(new Set(areaMeasurements.map((m) => m.pageNumber))).sort((a, b) => a - b);
  const grandTally = tallyByKind(areaMeasurements);
  const currentPageTally = tallyByKind(areaMeasurements.filter((m) => m.pageNumber === currentPage));

  // Desktop inspector (approved design, board 07): the tool options live in the bar above the dock,
  // so the inspector only carries the page's calibration state. Measurements have no selection of
  // their own; they are edited and deleted in the list.
  if (part === 'detail') return (
    <div className="measure-toolbar">
      {!hasCalibration && <div className="warning-box">{t('measure.notCalibrated')}</div>}
      <InspectorEmpty text={t('workspace.inspector.empty.measure')} />
    </div>
  );

  return (
    <div className="measure-toolbar">
      {/* Tablet and phone: one panel with the tools, their options and the list. */}
      {part !== 'list' && <>
      <h4>{t('measure.title')}</h4>
      {!hasCalibration && <div className="warning-box">{t('measure.notCalibrated')}</div>}
      <div className="tool-group">
        <span className="section-label">{t('measure.tools')}</span>
        <div className="segmented grid">
          {MEASURE_TOOLS.map((tool) => (
            <button
              key={tool}
              className={`tool-btn ${toolMode === 'measure' && measureTool === tool ? 'active' : ''}`}
              onClick={() => setMeasureTool(measureTool === tool ? null : tool)}
              aria-pressed={toolMode === 'measure' && measureTool === tool}
            >
              <Icon name={MEASURE_ICONS[tool]} />
              <span className="tool-label">{t(`measureTools.${tool}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <MeasureToolOptions />
      {hint && (
        <p className="tool-hint">
          <Icon name="alert" size={13} />
          {hint}
        </p>
      )}
      </>}

      {/* The list: value-first rows, then the area summary card (approved design, board 07). */}
      {pageMeasurements.length === 0 ? (
        <div className="empty-state">
          <Icon name="ruler" size={24} />
          <p>{t('measure.empty')}</p>
        </div>
      ) : (
        <ul className="measurement-list measurement-list-compact">
          {pageMeasurements.map((m) => {
            const isWall = m.tool === 'area' && m.calcMode === 'wall';
            return (
              <li key={m.id}>
                {m.areaKind
                  ? <span className="measurement-swatch" style={{ background: areaKindColors[m.areaKind] }} />
                  : <span className="measurement-swatch line" />}
                <span className="measurement-name">
                  <span>{m.areaKind ? t(`areaKinds.${m.areaKind}`) : t(`measureTools.${m.tool}`)}</span>
                  {isWall && (
                    <small>
                      {t('measure.wallLength', { length: round(m.wallLengthM ?? 0, 2) })}{' '}
                      <input
                        type="number"
                        step="0.05"
                        min="0.1"
                        className="inline-number"
                        aria-label={t('measure.wallHeightDefault')}
                        value={m.wallHeightM ?? wallHeightDefaultM}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const h = parseFloat(e.target.value) || 0;
                          const area = round((m.wallLengthM ?? 0) * h, 2);
                          updateMeasurement(m.id, { wallHeightM: h, areaM2: area });
                        }}
                      />
                      {' '}
                      {t('units.m')})
                    </small>
                  )}
                </span>
                <strong className="measurement-value" dir="ltr">{measurementLabel(m)}</strong>
                <span className="list-item-actions">
                  <button className="icon-btn danger" title={t('measure.delete')} onClick={() => deleteMeasurement(m.id)}>
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {areaMeasurements.length > 0 && (
        <div className="area-summary">
          <h4>{t('measure.areaSummary')}</h4>
          {pageNumbersWithAreas.length > 1 && (
            <div className="area-summary-page">
              <div className="area-summary-page-title">{t('measure.currentPage', { page: currentPage })}</div>
              {AREA_KINDS.map((k) => (
                <div key={k} className="area-summary-row">
                  <div className="area-summary-row-header">
                    <span className="color-dot" style={{ background: areaKindColors[k] }} />
                    <span className="area-summary-label">{t(`areaKinds.${k}`)}</span>
                    <span className="area-summary-count">{t('measure.marks', { count: currentPageTally.counts[k] })}</span>
                  </div>
                  <span className="area-summary-total">
                    {round(currentPageTally.totals[k], 2)} {t('units.m2')}
                  </span>
                </div>
              ))}
            </div>
          )}
          {pageNumbersWithAreas.length > 1 && <div className="area-summary-page-title">{t('measure.allPages')}</div>}
          {AREA_KINDS.map((k) => (
            <div key={k} className="area-summary-row">
              <div className="area-summary-row-header">
                <span className="color-dot" style={{ background: areaKindColors[k] }} />
                <span className="area-summary-label">{t(`areaKinds.${k}`)}</span>
                <span className="area-summary-count">{t('measure.marks', { count: grandTally.counts[k] })}</span>
              </div>
              <span className="area-summary-total">
                {round(grandTally.totals[k], 2)} {t('units.m2')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The active measure tool's options. Desktop shows them in the contextual bar above the canvas
 * dock (approved design, board 07); tablet and phone keep them in the measure panel.
 */
export function MeasureToolOptions({ bar = false }: { bar?: boolean } = {}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const toolMode = useAppStore((s) => s.toolMode);
  const measureTool = useAppStore((s) => s.measureTool);
  const setMeasureTool = useAppStore((s) => s.setMeasureTool);
  const areaShape = useAppStore((s) => s.areaShape);
  const setAreaShape = useAppStore((s) => s.setAreaShape);
  const areaCalcMode = useAppStore((s) => s.areaCalcMode);
  const setAreaCalcMode = useAppStore((s) => s.setAreaCalcMode);
  const pendingAreaKind = useAppStore((s) => s.pendingAreaKind);
  const setPendingAreaKind = useAppStore((s) => s.setPendingAreaKind);
  const setAreaKindColor = useAppStore((s) => s.setAreaKindColor);
  const orthoSnap = useAppStore((s) => s.orthoSnap);
  const setOrthoSnap = useAppStore((s) => s.setOrthoSnap);
  const updateProjectMeta = useAppStore((s) => s.updateProjectMeta);
  if (!project) return null;
  const areaKindColors = project.areaKindColors ?? { demolition: '#eab308', construction: '#16a34a' };
  const wallHeightDefaultM = project.wallHeightDefaultM ?? MEASUREMENT_DEFAULTS.wallHeightM;
  return (
    <>
      {bar && (
        <div className="segmented" role="group" aria-label={t('measure.tools')}>
          {MEASURE_TOOLS.map((tool) => (
            <button
              key={tool}
              className={`tool-btn ${toolMode === 'measure' && measureTool === tool ? 'active' : ''}`}
              onClick={() => setMeasureTool(measureTool === tool ? null : tool)}
              aria-pressed={toolMode === 'measure' && measureTool === tool}
            >
              <span className="tool-label">{t(`measureTools.${tool}`)}</span>
            </button>
          ))}
        </div>
      )}
      {toolMode === 'measure' && measureTool === 'area' && (
        <>
          <div className="tool-group">
            <span className="section-label">{t('measure.calcMode')}</span>
            <div className="segmented">
              {AREA_CALC_MODES.filter(({ mode }) => areaShape !== 'line' || mode === 'wall').map(({ mode, icon }) => (
                <button
                  key={mode}
                  className={`tool-btn ${areaCalcMode === mode ? 'active' : ''}`}
                  onClick={() => setAreaCalcMode(mode)}
                  aria-pressed={areaCalcMode === mode}
                >
                  <Icon name={icon} />
                  <span className="tool-label">{t(`measure.calcModes.${mode}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <AreaShapePicker value={areaShape} onChange={setAreaShape} />
          {areaCalcMode === 'wall' && (
            <div className="form-row">
              <label>{t('measure.wallHeightDefault')}</label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                value={wallHeightDefaultM}
                onChange={(e) => updateProjectMeta({ wallHeightDefaultM: parseFloat(e.target.value) || 0 })}
              />
            </div>
          )}
          <span className="section-label">{t('measure.areaKind')}</span>
          <div className="area-kind-row">
            {AREA_KINDS.map((k) => (
              <button
                key={k}
                className={`area-kind-btn ${pendingAreaKind === k ? 'active' : ''}`}
                onClick={() => setPendingAreaKind(pendingAreaKind === k ? null : k)}
              >
                <span className="color-dot" style={{ background: areaKindColors[k] }} />
                {t(`areaKinds.${k}`)}
                <input
                  type="color"
                  value={areaKindColors[k]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setAreaKindColor(k, e.target.value)}
                  title={t('measure.changeColor')}
                />
              </button>
            ))}
          </div>
        </>
      )}

      {toolMode === 'measure' &&
        (measureTool === 'distance' || measureTool === 'perimeter' || (measureTool === 'area' && areaShape !== 'rectangle')) && (
          <label className="source-color-toggle">
            <input type="checkbox" checked={orthoSnap} onChange={(e) => setOrthoSnap(e.target.checked)} />
            {t('measure.orthoOnly')}
          </label>
        )}

    </>
  );
}
