import { useAppStore } from '../store/appStore';
import type { ToolMode } from '../types';
import { isPageCalibrated } from '../lib/quantities';
import Icon, { type IconName } from './Icon';
import { useT } from '../i18n';
import { useRef, useState } from 'react';
import ResponsivePopover from './ResponsivePopover';
import { useOpeningPreset } from './openingPresetStore';
import { MeasureToolOptions } from './MeasureToolbar';
import { MarkupToolOptions } from './MarkupToolbar';
import { useMarkupHint, useMeasureHint } from './toolHints';
import { MARKUP_ICONS, MARKUP_TOOLS, MEASURE_ICONS, MEASURE_TOOLS } from './toolLists';

/** A rail tool: its name (`toolbar.<key>`) and tooltip (`toolbar.<key>Hint`) come from the dictionary. */
interface RailTool {
  mode: ToolMode;
  key: 'select' | 'pan' | 'draw' | 'drawRect';
  icon: IconName;
}

/** Canvas tools, in workflow order. Separators mark the three groups: view · scale · draw. */
const NAVIGATE_TOOLS: RailTool[] = [
  { mode: 'select', key: 'select', icon: 'select' },
  { mode: 'pan', key: 'pan', icon: 'pan' },
];

const DRAW_TOOLS: RailTool[] = [
  { mode: 'draw', key: 'draw', icon: 'polygon' },
  { mode: 'draw-rect', key: 'drawRect', icon: 'rectangle' },
];

/**
 * The canvas tool dock, floating at the bottom centre of the plan: view · draw · measure/markup · scale.
 * Measure and markup open a tool list above the dock; on desktop the active tool's options follow in
 * a contextual bar above it.
 */
export default function Toolbar({ onPanelTab, openings = false, contextBar = false }: {
  onPanelTab?: (next: 'objects' | 'measure' | 'markup') => void;
  /** Desktop: the active measure/markup tool's options sit in a bar right above the dock. */
  contextBar?: boolean;
  /** The openings tab is showing: the dock swaps the room shapes for the opening placement tool. */
  openings?: boolean;
}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const drawingPoints = useAppStore((s) => s.drawingPoints);
  const finishDrawing = useAppStore((s) => s.finishDrawing);
  const clearDrawingPoints = useAppStore((s) => s.clearDrawingPoints);
  const measureTool = useAppStore((s) => s.measureTool);
  const setMeasureTool = useAppStore((s) => s.setMeasureTool);
  const markupTool = useAppStore((s) => s.markupTool);
  const setMarkupTool = useAppStore((s) => s.setMarkupTool);
  const openingPlacement = useAppStore((s) => s.openingPlacement);
  const multiSelection = useAppStore((s) => s.selectedRoomIds.length + s.selectedOpeningIds.length > 0);
  const openingPreset = useOpeningPreset((s) => s.preset);
  const measureHint = useMeasureHint();
  const markupHint = useMarkupHint();
  const [menu, setMenu] = useState<'measure' | 'markup' | null>(null);
  const measureRef = useRef<HTMLButtonElement>(null);
  const markupRef = useRef<HTMLButtonElement>(null);

  const calibrated = !!project && isPageCalibrated(project, currentPage);

  // The rail is icon-only: the name of the tool is its tooltip and its accessible name, which is
  // what lets the rail come down to 56px without losing anything.
  const toolButton = (tool: RailTool) => (
    <button
      key={tool.mode}
      className={`tool-btn ${toolMode === tool.mode ? 'active' : ''}`}
      title={t(`toolbar.${tool.key}Hint`)}
      aria-label={t(`toolbar.${tool.key}`)}
      aria-pressed={toolMode === tool.mode}
      onClick={() => setToolMode(tool.mode)}
    >
      <Icon name={tool.icon} size={20} />
    </button>
  );

  // Measure and markup open their tool list right above the dock; the side-panel tab keeps the
  // detailed options (area type, colours, sizes) and is reachable from the bottom of the list.
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
        {NAVIGATE_TOOLS.map(toolButton)}
        <span className="toolbar-sep" />
        {openings ? (
          <button
            className={`tool-btn tool-btn-labeled ${openingPlacement ? 'active' : ''}`}
            title={t('openingTools.planMethod')}
            aria-pressed={!!openingPlacement}
            onClick={() => {
              const store = useAppStore.getState();
              if (store.openingPlacement) store.cancelOpeningPlacement();
              else store.beginOpeningPlacement(openingPreset);
            }}
          >
            <Icon name="door" size={18} />
            <span>{t('workspace.dock.opening')}</span>
          </button>
        ) : DRAW_TOOLS.map(toolButton)}
        <span className="toolbar-sep" />
        {menuButton('measure', 'dimension')}
        {menuButton('markup', 'edit')}
        <span className="toolbar-sep" />
        {/* Calibration is a canvas tool and lives with the others. "Needs a scale" is a dot, not a
            background: the tool can be active AND flagged at the same time. */}
        <button
          className={`tool-btn ${toolMode === 'calibrate' ? 'active' : ''}`}
          title={calibrated ? t('toolbar.calibrateHint') : t('toolbar.calibrateHintMissing')}
          aria-label={t('toolbar.calibrate')}
          aria-pressed={toolMode === 'calibrate'}
          onClick={() => setToolMode(toolMode === 'calibrate' ? 'select' : 'calibrate')}
        >
          <Icon name="ruler" size={20} />
          {!calibrated && <span className="tool-attention-dot" />}
        </button>
      </div>

      {menu && (
        <ResponsivePopover
          id="dock-tool-menu"
          label={t(`workspace.dock.${menu}`)}
          anchorRef={menu === 'measure' ? measureRef : markupRef}
          onClose={() => setMenu(null)}
          desktopMaxWidth={240}
        >
          {menu === 'measure'
            ? MEASURE_TOOLS.map((tool) => (
                <button key={tool} className={`menu-item ${toolMode === 'measure' && measureTool === tool ? 'active' : ''}`}
                  onClick={() => pick(() => setMeasureTool(toolMode === 'measure' && measureTool === tool ? null : tool))}>
                  <span className="menu-check"><Icon name={MEASURE_ICONS[tool]} size={14} /></span>
                  {t(`measureTools.${tool}`)}
                </button>
              ))
            : MARKUP_TOOLS.map((tool) => (
                <button key={tool} className={`menu-item ${toolMode === 'markup' && markupTool === tool ? 'active' : ''}`}
                  onClick={() => pick(() => setMarkupTool(toolMode === 'markup' && markupTool === tool ? null : tool))}>
                  <span className="menu-check"><Icon name={MARKUP_ICONS[tool]} size={14} /></span>
                  {t(`markupTools.${tool}`)}
                </button>
              ))}
          {onPanelTab && <>
            <div className="menu-divider" />
            <button className="menu-item" onClick={() => pick(() => onPanelTab(menu))}>
              <span className="menu-check"><Icon name="settings" size={14} /></span>
              {t('workspace.moreOptions')}
            </button>
          </>}
        </ResponsivePopover>
      )}

      {/* Approved design (boards 07 / 12): the active tool's options in a contextual bar above the dock. */}
      {contextBar && ((toolMode === 'measure' && measureTool) || (toolMode === 'markup' && markupTool)) && (
        <div className="tool-context-bar" role="toolbar" aria-label={t(`workspace.dock.${toolMode === 'measure' ? 'measure' : 'markup'}`)}>
          {toolMode === 'measure' ? <MeasureToolOptions bar /> : <MarkupToolOptions />}
        </div>
      )}

      {/* Tool guidance sits at the top centre of the plan, clear of the dock. */}
      {contextBar && measureHint && <div className="draw-hint">{measureHint}</div>}
      {contextBar && markupHint && <div className="draw-hint" title={markupHint.long ?? markupHint.short}>{markupHint.short}</div>}
      {/* Approved design: no persistent hint in select mode — the selection shortcuts appear only
          while a multi-selection is active. */}
      {toolMode === 'select' && multiSelection && <span className="draw-hint">{t('planSelection.hint')}</span>}

      {toolMode === 'calibrate' && <div className="draw-hint">{t('toolbar.calibrateInstruction')}</div>}

      {toolMode === 'draw' && drawingPoints.length > 0 && (
        <div className="draw-hint">
          {drawingPoints.length >= 3
            ? t('toolbar.drawProgressClose', { count: drawingPoints.length })
            : t('toolbar.drawProgressAdd', { count: drawingPoints.length })}
          <button className="btn-ghost small" onClick={() => clearDrawingPoints()}>
            {t('toolbar.clear')}
          </button>
          {drawingPoints.length >= 3 && (
            <button className="btn-primary small" onClick={() => finishDrawing()}>
              {t('toolbar.closeArea')}
            </button>
          )}
        </div>
      )}

      {toolMode === 'draw-rect' && (
        <div className="draw-hint">
          {drawingPoints.length === 0 ? t('toolbar.rectFirstCorner') : t('toolbar.rectOppositeCorner')}
          {drawingPoints.length > 0 && (
            <button className="btn-ghost small" onClick={() => clearDrawingPoints()}>
              {t('toolbar.clear')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
