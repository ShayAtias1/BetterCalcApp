import { useRef, useState } from 'react';
import { compareScaleFor, useCompareStore } from '../../store/compareStore';
import type { AreaKind, MarkupTool, MeasureTool } from '../../types/compare';
import Icon, { type IconName } from '../Icon';
import ResponsivePopover from '../ResponsivePopover';
import { useT } from '../../i18n';

const CHANGE_KINDS: AreaKind[] = ['demolition', 'construction'];
const MEASURE_TOOLS: MeasureTool[] = ['distance', 'area', 'perimeter'];
const MEASURE_ICONS: Record<MeasureTool, IconName> = { distance: 'ruler', area: 'square', perimeter: 'circle' };
const MARKUP_TOOLS: MarkupTool[] = ['cloud', 'arrow', 'rectangle', 'text', 'dimension', 'mask'];
const MARKUP_ICONS: Record<MarkupTool, IconName> = { cloud: 'cloud', arrow: 'arrow', rectangle: 'rectangle', text: 'text', dimension: 'dimension', mask: 'mask' };

export type CompareSidebarTab = 'layers' | 'measure' | 'markup';

/**
 * The compare canvas dock — the same floating pattern as the takeoff dock, with this workspace's own
 * tools: view · align · measure (changes first) / markup · calibrate. Measure and markup open their
 * tool list above the dock; the detailed options stay in the inspector.
 */
export default function CompareToolDock({ onPanelTab }: { onPanelTab: (tab: CompareSidebarTab) => void }) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const toolMode = useCompareStore((s) => s.toolMode);
  const setToolMode = useCompareStore((s) => s.setToolMode);
  const measureTool = useCompareStore((s) => s.measureTool);
  const setMeasureTool = useCompareStore((s) => s.setMeasureTool);
  const pendingAreaKind = useCompareStore((s) => s.pendingAreaKind);
  const setPendingAreaKind = useCompareStore((s) => s.setPendingAreaKind);
  const startChangeMeasurement = useCompareStore((s) => s.startChangeMeasurement);
  const markupTool = useCompareStore((s) => s.markupTool);
  const setMarkupTool = useCompareStore((s) => s.setMarkupTool);
  const startCalibration = useCompareStore((s) => s.startCalibration);
  const [menu, setMenu] = useState<'measure' | 'markup' | null>(null);
  const measureRef = useRef<HTMLButtonElement>(null);
  const markupRef = useRef<HTMLButtonElement>(null);

  if (!comparison) return null;
  const scale = compareScaleFor(comparison, currentPageKey);
  const canMeasure = scale.state === 'calibrated';
  const blockedReason = scale.state === 'ambiguous' ? t('compare.measure.ambiguousScale') : t('compare.measure.notCalibrated');
  const armedKind = toolMode === 'measure' && measureTool === 'area' ? pendingAreaKind : null;
  const hasRevision = comparison.revisions.length > 0;

  const plainButton = (mode: 'select' | 'pan', icon: IconName) => (
    <button
      className={`tool-btn ${toolMode === mode ? 'active' : ''}`}
      onClick={() => setToolMode(mode)}
      aria-label={t(`compare.tools.${mode}`)}
      aria-pressed={toolMode === mode}
      title={t(`compare.tools.${mode}Hint`)}
    >
      <Icon name={icon} size={20} />
    </button>
  );
  const menuButton = (kind: 'measure' | 'markup', icon: IconName) => (
    <button
      ref={kind === 'measure' ? measureRef : markupRef}
      className={`tool-btn tool-btn-labeled ${toolMode === kind || menu === kind ? 'active' : ''}`}
      title={t(`workspace.dock.${kind}`)}
      aria-pressed={toolMode === kind}
      aria-expanded={menu === kind}
      aria-haspopup="true"
      onClick={() => setMenu(menu === kind ? null : kind)}
    >
      <Icon name={icon} size={18} />
      <span>{t(`workspace.dock.${kind}`)}</span>
      <Icon name="chevron-up" size={10} />
    </button>
  );
  const pick = (run: () => void) => {
    run();
    setMenu(null);
  };

  return (
    <>
      <div className="toolbar tool-dock" role="toolbar" aria-label={t('workspace.tools')}>
        {plainButton('select', 'select')}
        {plainButton('pan', 'pan')}
        <span className="toolbar-sep" />
        {/* Dragging the revised layer into place is a canvas interaction; the numeric controls stay in the inspector. */}
        <button
          className={`tool-btn tool-btn-labeled ${toolMode === 'align' ? 'active' : ''}`}
          onClick={() => setToolMode(toolMode === 'align' ? 'select' : 'align')}
          disabled={!hasRevision}
          aria-label={t('compare.tools.align')}
          aria-pressed={toolMode === 'align'}
          title={t('compare.tools.alignHint')}
        >
          <Icon name="move" size={18} />
          <span>{t('compare.tools.align')}</span>
        </button>
        {menuButton('measure', 'dimension')}
        {menuButton('markup', 'edit')}
        <span className="toolbar-sep" />
        <button
          className={`tool-btn ${toolMode === 'calibrate' ? 'active' : ''}`}
          onClick={() => (toolMode === 'calibrate' ? setToolMode('select') : startCalibration('original'))}
          aria-label={t('toolbar.calibrate')}
          aria-pressed={toolMode === 'calibrate'}
          title={canMeasure ? t('compare.context.calibrateOriginalHint') : blockedReason}
        >
          <Icon name="ruler" size={20} />
          {!canMeasure && <span className="tool-attention-dot" />}
        </button>
      </div>

      {menu && (
        <ResponsivePopover
          id="compare-dock-tool-menu"
          label={t(`workspace.dock.${menu}`)}
          anchorRef={menu === 'measure' ? measureRef : markupRef}
          onClose={() => setMenu(null)}
          desktopMaxWidth={240}
        >
          {menu === 'measure' ? <>
            {/* Recording demolition and new construction is this workspace's main job, so it comes first. */}
            <p className="menu-hint menu-section-title">{t('compare.measure.changes')}</p>
            {CHANGE_KINDS.map((kind) => (
              <button key={kind} className={`menu-item ${armedKind === kind ? 'active' : ''}`} disabled={!canMeasure} title={canMeasure ? undefined : blockedReason}
                onClick={() => pick(() => (armedKind === kind ? setPendingAreaKind(null) : startChangeMeasurement(kind)))}>
                <span className="menu-check"><span className="color-dot" style={{ background: comparison.areaKindColors[kind] }} /></span>
                {t(`areaKinds.${kind}`)}
              </button>
            ))}
            <div className="menu-divider" />
            {MEASURE_TOOLS.map((tool) => {
              const active = toolMode === 'measure' && !armedKind && measureTool === tool;
              return (
                <button key={tool} className={`menu-item ${active ? 'active' : ''}`} disabled={!canMeasure} title={canMeasure ? undefined : blockedReason}
                  onClick={() => pick(() => setMeasureTool(active ? null : tool))}>
                  <span className="menu-check"><Icon name={MEASURE_ICONS[tool]} size={14} /></span>
                  {t(`measureTools.${tool}`)}
                </button>
              );
            })}
          </> : MARKUP_TOOLS.map((tool) => (
            <button key={tool} className={`menu-item ${toolMode === 'markup' && markupTool === tool ? 'active' : ''}`}
              onClick={() => pick(() => setMarkupTool(toolMode === 'markup' && markupTool === tool ? null : tool))}>
              <span className="menu-check"><Icon name={MARKUP_ICONS[tool]} size={14} /></span>
              {t(`markupTools.${tool}`)}
            </button>
          ))}
          <div className="menu-divider" />
          <button className="menu-item" onClick={() => pick(() => onPanelTab(menu))}>
            <span className="menu-check"><Icon name="settings" size={14} /></span>
            {t('workspace.moreOptions')}
          </button>
        </ResponsivePopover>
      )}
    </>
  );
}
