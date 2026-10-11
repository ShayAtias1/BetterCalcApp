import { useEffect } from 'react';
import { compareScaleFor, useCompareStore } from '../../store/compareStore';
import type { AreaCalcMode, AreaKind, AreaShape, MeasureTool } from '../../types/compare';
import { round } from '../../lib/geometry';
import { measurementLabel } from '../../lib/measurementValues';
import { changeMeasurements, isChangeMeasurement } from '../../lib/changeMeasurements';
import Icon, { type IconName } from '../Icon';
import { useT } from '../../i18n';
import type { PanelPart } from '../PanelPart';

const MEASURE_TOOLS: MeasureTool[] = ['distance', 'area', 'perimeter'];
const MEASURE_ICONS: Record<MeasureTool, IconName> = { distance: 'ruler', area: 'square', perimeter: 'circle' };
const AREA_KINDS: AreaKind[] = ['demolition', 'construction'];
// Labels: `measure.shapes.<shape>` and `measure.calcModes.<mode>`.
const AREA_SHAPES: { shape: AreaShape; icon: IconName }[] = [
  { shape: 'polygon', icon: 'polygon' },
  { shape: 'rectangle', icon: 'rectangle' },
];
const AREA_CALC_MODES: { mode: AreaCalcMode; icon: IconName }[] = [
  { mode: 'footprint', icon: 'square' },
  { mode: 'wall', icon: 'dimension' },
];

export default function MeasureToolbar({ part }: { part?: PanelPart } = {}) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const toolMode = useCompareStore((s) => s.toolMode);
  const measureTool = useCompareStore((s) => s.measureTool);
  const setMeasureTool = useCompareStore((s) => s.setMeasureTool);
  const measurePoints = useCompareStore((s) => s.measurePoints);
  const pendingAreaKind = useCompareStore((s) => s.pendingAreaKind);
  const setPendingAreaKind = useCompareStore((s) => s.setPendingAreaKind);
  const areaShape = useCompareStore((s) => s.areaShape);
  const setAreaShape = useCompareStore((s) => s.setAreaShape);
  const areaCalcMode = useCompareStore((s) => s.areaCalcMode);
  const setAreaCalcMode = useCompareStore((s) => s.setAreaCalcMode);
  const orthoSnap = useCompareStore((s) => s.orthoSnap);
  const setOrthoSnap = useCompareStore((s) => s.setOrthoSnap);
  const deleteMeasurement = useCompareStore((s) => s.deleteMeasurement);
  const updateMeasurement = useCompareStore((s) => s.updateMeasurement);
  const updateComparisonMeta = useCompareStore((s) => s.updateComparisonMeta);
  const startChangeMeasurement = useCompareStore((s) => s.startChangeMeasurement);
  const setChangesOpen = useCompareStore((s) => s.setChangesOpen);

  // Losing the scale — switching to an uncalibrated page, or re-aligning a layer whose legacy
  // calibration can no longer be interpreted — puts the measure tool away instead of leaving it
  // armed over a page where it can only discard what the user draws.
  const measurableScale = comparison ? compareScaleFor(comparison, currentPageKey).state === 'calibrated' : false;
  useEffect(() => {
    if (!measurableScale && measureTool) setMeasureTool(null);
  }, [measurableScale, measureTool, setMeasureTool]);

  if (!comparison) return null;
  // One scale rule for the whole feature: a measurement is only allowed when it can be converted
  // to real-world units correctly — see resolveCompareScale.
  const scale = compareScaleFor(comparison, currentPageKey);
  const canMeasure = scale.state === 'calibrated';
  const blockedReason =
    scale.state === 'ambiguous'
      ? t('compare.measure.ambiguousScale')
      : t('compare.measure.notCalibrated');
  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
  // Measurements belong to a source page: page 2 must not list page 1's work. Demolition and new
  // construction are reviewed in the שינויים panel, so this list keeps to plain measurements
  // instead of being a second, competing list of the same change items.
  const pageMeasurements = (activeRevision?.measurements ?? []).filter((m) => m.pageNumber === currentPageKey);
  const measurements = pageMeasurements.filter((m) => !isChangeMeasurement(m));
  const pageChangeCount = changeMeasurements(pageMeasurements).length;
  const armedKind = toolMode === 'measure' && measureTool === 'area' ? pendingAreaKind : null;
  const showAreaOptions = toolMode === 'measure' && measureTool === 'area';
  const wallHeightDefaultM = comparison.wallHeightDefaultM;

  return (
    <div className="measure-toolbar">
      {/* Desktop split: tools and settings in the inspector, the page's measurements in the side panel. */}
      {part !== 'list' && <>
      {/* Calibration itself is reported once, in the context strip above the tabs; what belongs
          here is only whether measuring is allowed at all right now. */}
      {!canMeasure && (
        <div className="warning-box">
          <Icon name="alert" size={13} />
          {blockedReason}
        </div>
      )}

      {/* The workspace's main job: recording what is demolished and what is built. One deliberate
          click each — not a classification hidden three levels inside a generic area tool. Both
          arm the same area/wall drawing infrastructure, already classified. */}
      <div className="tool-group">
        <span className="section-label">{t('compare.measure.changes')}</span>
        <div className="segmented change-kinds">
          {AREA_KINDS.map((k) => (
            <button
              key={k}
              className={`tool-btn change-kind ${k} ${armedKind === k ? 'active' : ''}`}
              onClick={() => (armedKind === k ? setPendingAreaKind(null) : startChangeMeasurement(k))}
              disabled={!canMeasure}
              aria-pressed={armedKind === k}
              title={canMeasure ? t('compare.measure.markKind', { kind: t(`areaKinds.${k}`) }) : blockedReason}
            >
              <span className="color-dot" style={{ background: comparison.areaKindColors[k] }} />
              <span className="tool-label">{t(`areaKinds.${k}`)}</span>
            </button>
          ))}
        </div>

        {armedKind && (
          <p className={`tool-hint armed ${armedKind}`}>
            <Icon name="scan" size={13} />
            {t('compare.measure.armed', { kind: t(`areaKinds.${armedKind}`), mode: t(`measure.calcModes.${areaCalcMode}`) })}
          </p>
        )}

        {!part && <button className="btn-ghost small full-width changes-panel-open" onClick={() => setChangesOpen(true)}>
          <Icon name="table" />
          {pageChangeCount > 0 ? t('compare.measure.changesPanelCount', { count: pageChangeCount }) : t('compare.measure.changesPanel')}
        </button>}
      </div>

      {/* Secondary: plain, unclassified measurements. */}
      <div className="tool-group">
        <span className="section-label">{t('measure.tools')}</span>
        <div className="segmented grid">
          {MEASURE_TOOLS.map((tool) => (
            <button
              key={tool}
              className={`tool-btn ${toolMode === 'measure' && !armedKind && measureTool === tool ? 'active' : ''}`}
              onClick={() => setMeasureTool(measureTool === tool && !armedKind ? null : tool)}
              disabled={!canMeasure}
              aria-pressed={toolMode === 'measure' && !armedKind && measureTool === tool}
              title={canMeasure ? t(`measureTools.${tool}`) : blockedReason}
            >
              <Icon name={MEASURE_ICONS[tool]} />
              <span className="tool-label">{t(`measureTools.${tool}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* How an area is measured — shared by a classified change and a plain area measurement. */}
      {showAreaOptions && (
        <>
          <div className="tool-group">
            <span className="section-label">{t('measure.calcMode')}</span>
            <div className="segmented">
              {AREA_CALC_MODES.map(({ mode, icon }) => (
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
          <div className="tool-group">
            <span className="section-label">{t('measure.shape')}</span>
            <div className="segmented">
              {AREA_SHAPES.map(({ shape, icon }) => (
                <button
                  key={shape}
                  className={`tool-btn ${areaShape === shape ? 'active' : ''}`}
                  onClick={() => setAreaShape(shape)}
                  aria-pressed={areaShape === shape}
                >
                  <Icon name={icon} />
                  <span className="tool-label">{t(`measure.shapes.${shape}`)}</span>
                </button>
              ))}
            </div>
          </div>
          {areaCalcMode === 'wall' && (
            <div className="form-row">
              <label>{t('measure.wallHeightDefault')}</label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                value={wallHeightDefaultM}
                onChange={(e) => updateComparisonMeta({ wallHeightDefaultM: parseFloat(e.target.value) || 0 })}
              />
            </div>
          )}
        </>
      )}

      {toolMode === 'measure' && (measureTool === 'perimeter' || (measureTool === 'area' && areaShape === 'polygon')) && (
        <label className="source-color-toggle">
          <input type="checkbox" checked={orthoSnap} onChange={(e) => setOrthoSnap(e.target.checked)} />
          {t('measure.orthoOnly')}
        </label>
      )}

      {toolMode === 'measure' && measureTool && (
        <p className="tool-hint">
          <Icon name="alert" size={13} />
          {measureTool === 'distance'
            ? t('measure.hintDistance')
            : measureTool === 'area' && areaShape === 'rectangle'
              ? t('measure.hintRectangle')
              : t('measure.hintPolygon', { count: measurePoints.length })}
        </p>
      )}

      </>}
      {part !== 'detail' && <>
      {part === 'list' && <button className="btn-ghost small full-width changes-panel-open" onClick={() => setChangesOpen(true)}>
        <Icon name="table" />
        {pageChangeCount > 0 ? t('compare.measure.changesPanelCount', { count: pageChangeCount }) : t('compare.measure.changesPanel')}
      </button>}
      {measurements.length === 0 ? (
        <div className="empty-state">
          <Icon name="ruler" size={24} />
          <p>{t('compare.measure.empty')}</p>
        </div>
      ) : (
        <ul className="measurement-list">
          {measurements.map((m) => {
            const isWall = m.tool === 'area' && m.calcMode === 'wall';
            return (
              <li key={m.id}>
                <span>
                  {t(`measureTools.${m.tool}`)}: <strong>{measurementLabel(m)}</strong>
                  {isWall && (
                    <>
                      {' '}
                      {t('measure.wallLength', { length: round(m.wallLengthM ?? 0, 2) })}{' '}
                      <input
                        type="number"
                        step="0.05"
                        min="0.1"
                        className="inline-number"
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
                    </>
                  )}
                </span>
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
      </>}
    </div>
  );
}
